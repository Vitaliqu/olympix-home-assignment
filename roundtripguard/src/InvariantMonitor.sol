// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMonitoredPool {
    function getLastInvariant() external view returns (uint256 invariant, uint256 ampFactor);
    function reserve1() external view returns (uint256);
}

/*
 * ============================================================
 * IBalancerVault — adapter notes for real Balancer V2 pools
 * ============================================================
 *
 * To adapt InvariantMonitor for real Balancer V2 ComposableStablePools:
 *
 * Step 1 — Replace pool.getLastInvariant() with vault.getPoolTokens(poolId):
 *
 *   interface IBalancerVault {
 *       function getPoolTokens(bytes32 poolId)
 *           external view
 *           returns (
 *               address[] memory tokens,
 *               uint256[] memory balances,
 *               uint256 lastChangeBlock
 *           );
 *   }
 *
 * Step 2 — Compute the StableSwap invariant D via Newton-Raphson over the
 *   rate-normalised balances. Reference: Balancer's
 *   contracts/pools/stable/math/StableMath.sol:_calculateInvariant.
 *   This replaces the constant-product k = r0 x r1 used in this PoC.
 *
 * Step 3 — Normalise each token balance by its rate provider before computing D:
 *   normalised[i] = balances[i] * IRateProvider(rateProviders[i]).getRate() / 1e18
 *   Ensures rate-scaled tokens (e.g. wstETH, cbETH) are compared on a common
 *   economic basis across checkpoints.
 * ============================================================
 */

/// @title InvariantMonitor
/// @notice Read-only on-chain sentinel that checkpoints the pool invariant after
/// each swap and emits CircuitBreakerTripped when drift or low-liquidity conditions
/// are met. Permissionless — no privileged access required. Enforcement is delegated
/// to EmergencyPauser.
///
/// @dev Storage layout — two 256-bit slots per pool (was four with unpacked uint256s):
///   Slot 0: lastInvariant (uint128) | cumulativeDrift (uint128) | [0 bits free]
///   Slot 1: swapsSinceReset (uint32) | circuitBreakerTripped (bool) |
///           lastTripTimestamp (uint32) | [184 bits free]
///   Happy path: 1 cold SLOAD (slot 0) + 1 warm SLOAD (slot 1) — ~2,100 gas saved
///   vs. the 4-slot unpacked layout (~4 cold SLOADs = ~8,400 gas).
///
///   EIP-1153 upgrade path (requires ^0.8.28):
///   Replace cumulativeDrift storage writes with TSTORE/TLOAD transient storage
///   so the accumulator resets automatically each transaction, eliminating the
///   storage write on every non-trip call.
contract InvariantMonitor {

    // -------------------------------------------------------
    // Types
    // -------------------------------------------------------

    /// @dev Packed pool state — two EVM storage slots.
    struct PoolState {
        uint128 lastInvariant;        // invariant k at last checkpoint
        uint128 cumulativeDrift;      // accumulated drift since last reset
        // --- slot boundary ---
        uint32  swapsSinceReset;      // swap count since last low-liquidity reset
        bool    circuitBreakerTripped;// latched true on first trip
        uint32  lastTripTimestamp;    // unix timestamp of most recent trip
    }

    /// @dev Global threshold configuration. All values must be non-zero; use
    /// the built-in defaults by passing 0 to the constructor or setter.
    struct GlobalConfig {
        uint256 driftBpsThreshold;    // max single-swap drift (bps)
        uint256 cumulativeDriftBps;   // max cumulative drift (bps)
        uint256 lowLiquidityWei;      // reserve1 below this = low-liquidity danger zone
        uint256 maxSwapsLowLiquidity; // allowed swaps before trip at low liquidity
        uint256 tripCooldown;         // seconds before monitoring resumes after a trip
    }

    /// @dev Per-pool threshold overrides. A zero field means "use global default".
    struct PoolConfig {
        uint256 driftBpsThreshold;
        uint256 cumulativeDriftBps;
        uint256 lowLiquidityWei;
        uint256 maxSwapsLowLiquidity;
        uint256 tripCooldown;
    }

    // -------------------------------------------------------
    // Built-in fallback defaults (used when a config field is 0)
    // -------------------------------------------------------

    uint256 private constant _DEFAULT_DRIFT_BPS        = 1;     // 0.01% per swap
    uint256 private constant _DEFAULT_CUMULATIVE_BPS   = 5;     // 0.05% cumulative
    uint256 private constant _DEFAULT_LOW_LIQ_WEI      = 100;   // wei
    uint256 private constant _DEFAULT_MAX_SWAPS_LOW_LIQ = 5;
    uint256 private constant _DEFAULT_TRIP_COOLDOWN    = 3600;  // 1 hour

    // -------------------------------------------------------
    // State
    // -------------------------------------------------------

    /// @notice Deployer address; may update global and per-pool config.
    address public immutable owner;

    /// @notice Active global thresholds (may be updated by owner).
    GlobalConfig public globalConfig;

    /// @notice Per-pool state indexed by poolId.
    mapping(bytes32 => PoolState)  public poolStates;

    /// @notice Per-pool threshold overrides (zero field = use global default).
    mapping(bytes32 => PoolConfig) public poolConfigs;

    // -------------------------------------------------------
    // Events
    // -------------------------------------------------------

    /// @notice Emitted whenever the invariant drops by more than 0 bps.
    event InvariantDriftDetected(bytes32 indexed poolId, uint256 driftBps, uint256 currentInvariant);

    /// @notice Emitted when the circuit breaker latches. Keeper should call EmergencyPauser.pause().
    event CircuitBreakerTripped(bytes32 indexed poolId, uint256 cumulativeDrift);

    /// @notice Emitted when the owner updates global thresholds.
    event GlobalConfigUpdated(GlobalConfig config);

    /// @notice Emitted when the owner sets a per-pool override.
    event PoolConfigUpdated(bytes32 indexed poolId, PoolConfig config);

    // -------------------------------------------------------
    // Constructor
    // -------------------------------------------------------

    /// @notice Deploy with custom thresholds. Pass 0 for any param to use the built-in default.
    /// @param driftBpsThreshold    Max single-swap drift in bps (default 1).
    /// @param cumulativeDriftBps   Max cumulative drift in bps (default 5).
    /// @param lowLiquidityWei      reserve1 threshold for low-liquidity mode (default 100).
    /// @param maxSwapsLowLiquidity Max swaps in low-liquidity mode before trip (default 5).
    /// @param tripCooldown         Seconds after a trip before monitoring resumes (default 3600).
    constructor(
        uint256 driftBpsThreshold,
        uint256 cumulativeDriftBps,
        uint256 lowLiquidityWei,
        uint256 maxSwapsLowLiquidity,
        uint256 tripCooldown
    ) {
        owner = msg.sender;
        globalConfig = GlobalConfig({
            driftBpsThreshold:    driftBpsThreshold    != 0 ? driftBpsThreshold    : _DEFAULT_DRIFT_BPS,
            cumulativeDriftBps:   cumulativeDriftBps   != 0 ? cumulativeDriftBps   : _DEFAULT_CUMULATIVE_BPS,
            lowLiquidityWei:      lowLiquidityWei      != 0 ? lowLiquidityWei      : _DEFAULT_LOW_LIQ_WEI,
            maxSwapsLowLiquidity: maxSwapsLowLiquidity != 0 ? maxSwapsLowLiquidity : _DEFAULT_MAX_SWAPS_LOW_LIQ,
            tripCooldown:         tripCooldown         != 0 ? tripCooldown         : _DEFAULT_TRIP_COOLDOWN
        });
    }

    // -------------------------------------------------------
    // Owner-gated configuration
    // -------------------------------------------------------

    modifier onlyOwner() {
        require(msg.sender == owner, "OWNER_ONLY");
        _;
    }

    /// @notice Update global thresholds. Pass 0 for any param to restore its built-in default.
    /// @param driftBpsThreshold    New single-swap drift limit (0 = reset to default 1 bps).
    /// @param cumulativeDriftBps   New cumulative drift limit (0 = reset to default 5 bps).
    /// @param lowLiquidityWei      New low-liquidity threshold (0 = reset to default 100 wei).
    /// @param maxSwapsLowLiquidity New low-liquidity swap cap (0 = reset to default 5).
    /// @param tripCooldown         New cooldown in seconds (0 = reset to default 3600 s).
    function setGlobalConfig(
        uint256 driftBpsThreshold,
        uint256 cumulativeDriftBps,
        uint256 lowLiquidityWei,
        uint256 maxSwapsLowLiquidity,
        uint256 tripCooldown
    ) external onlyOwner {
        globalConfig = GlobalConfig({
            driftBpsThreshold:    driftBpsThreshold    != 0 ? driftBpsThreshold    : _DEFAULT_DRIFT_BPS,
            cumulativeDriftBps:   cumulativeDriftBps   != 0 ? cumulativeDriftBps   : _DEFAULT_CUMULATIVE_BPS,
            lowLiquidityWei:      lowLiquidityWei      != 0 ? lowLiquidityWei      : _DEFAULT_LOW_LIQ_WEI,
            maxSwapsLowLiquidity: maxSwapsLowLiquidity != 0 ? maxSwapsLowLiquidity : _DEFAULT_MAX_SWAPS_LOW_LIQ,
            tripCooldown:         tripCooldown         != 0 ? tripCooldown         : _DEFAULT_TRIP_COOLDOWN
        });
        emit GlobalConfigUpdated(globalConfig);
    }

    /// @notice Set per-pool threshold overrides. Zero fields inherit the global default.
    /// @param poolId  Pool identifier.
    /// @param config  Per-pool overrides (zero field = use global default).
    function setPoolConfig(bytes32 poolId, PoolConfig calldata config) external onlyOwner {
        poolConfigs[poolId] = config;
        emit PoolConfigUpdated(poolId, config);
    }

    // -------------------------------------------------------
    // Core logic
    // -------------------------------------------------------

    /// @notice Checkpoint pool invariant after a swap. Permissionless.
    /// @param poolId       Unique pool identifier (e.g. keccak256 of pool address).
    /// @param poolAddress  Address of the monitored pool.
    function checkAfterSwap(bytes32 poolId, address poolAddress) external {
        PoolState storage state = poolStates[poolId];

        // Cooldown: if the breaker tripped recently, return early.
        // Once cooldown expires the breaker auto-resets and monitoring resumes.
        // This prevents a griefer from immediately re-tripping after a guardian reset.
        if (state.circuitBreakerTripped) {
            (, , , , uint256 cooldown) = _resolveConfig(poolId);
            // forge-lint: disable-next-line(block-timestamp)
            if (block.timestamp - state.lastTripTimestamp < cooldown) return;
            // Cooldown expired — reset breaker and resume monitoring
            state.circuitBreakerTripped = false;
            state.cumulativeDrift       = 0;
            state.swapsSinceReset       = 0;
        }

        (
            uint256 driftBpsThresh,
            uint256 cumBpsThresh,
            uint256 lowLiqWei,
            uint256 maxSwapLowLiq,
        ) = _resolveConfig(poolId);

        IMonitoredPool pool = IMonitoredPool(poolAddress);
        (uint256 currentInvariant,) = pool.getLastInvariant();

        // Low-liquidity guard
        if (pool.reserve1() < lowLiqWei) {
            state.swapsSinceReset++;
            if (state.swapsSinceReset > maxSwapLowLiq) {
                _trip(poolId, 0);
                return;
            }
        }

        // First call: establish baseline
        if (state.lastInvariant == 0) {
            // forge-lint: disable-next-line(unsafe-typecast)
            state.lastInvariant = uint128(currentInvariant); // safe: AMM invariants fit uint128 for realistic reserves
            return;
        }

        // Drift check
        if (currentInvariant < state.lastInvariant) {
            uint256 drift    = state.lastInvariant - currentInvariant;
            uint256 driftBps = (drift * 10_000) / state.lastInvariant;
            // forge-lint: disable-next-line(unsafe-typecast)
            state.cumulativeDrift += uint128(drift); // safe: drift < lastInvariant which is uint128
            // Denominator is the most-recent checkpoint invariant (not the original baseline).
            // lastInvariant advances on every non-tripping swap, so cumulBps measures
            // accumulated drift relative to the latest reference — correct for monotonic
            // decline; conservative (understates risk) if invariant oscillates.
            uint256 cumulBps = (uint256(state.cumulativeDrift) * 10_000) / state.lastInvariant;

            emit InvariantDriftDetected(poolId, driftBps, currentInvariant);

            if (driftBps > driftBpsThresh || cumulBps > cumBpsThresh) {
                _trip(poolId, cumulBps);
                return;
            }
        }

        // forge-lint: disable-next-line(unsafe-typecast)
        state.lastInvariant = uint128(currentInvariant); // safe: AMM invariants fit uint128 for realistic reserves
    }

    /// @notice Returns true if the circuit breaker is currently latched for poolId.
    /// @param poolId  Pool identifier.
    /// @return tripped True if the breaker is active.
    function isTripped(bytes32 poolId) external view returns (bool tripped) {
        return poolStates[poolId].circuitBreakerTripped;
    }

    // -------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------

    /// @dev Latch the circuit breaker for poolId.
    function _trip(bytes32 poolId, uint256 drift) internal {
        PoolState storage state = poolStates[poolId];
        state.circuitBreakerTripped = true;
        state.lastTripTimestamp     = uint32(block.timestamp);
        emit CircuitBreakerTripped(poolId, drift);
    }

    /// @dev Return the effective thresholds for poolId: per-pool override if non-zero, else global.
    function _resolveConfig(bytes32 poolId) internal view returns (
        uint256 driftBps,
        uint256 cumBps,
        uint256 lowLiq,
        uint256 maxSwaps,
        uint256 cooldown
    ) {
        PoolConfig  storage pc = poolConfigs[poolId];
        GlobalConfig storage gc = globalConfig;
        driftBps  = pc.driftBpsThreshold    != 0 ? pc.driftBpsThreshold    : gc.driftBpsThreshold;
        cumBps    = pc.cumulativeDriftBps   != 0 ? pc.cumulativeDriftBps   : gc.cumulativeDriftBps;
        lowLiq    = pc.lowLiquidityWei      != 0 ? pc.lowLiquidityWei      : gc.lowLiquidityWei;
        maxSwaps  = pc.maxSwapsLowLiquidity != 0 ? pc.maxSwapsLowLiquidity : gc.maxSwapsLowLiquidity;
        cooldown  = pc.tripCooldown         != 0 ? pc.tripCooldown         : gc.tripCooldown;
    }
}
