// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/StdUtils.sol";
import "forge-std/StdCheats.sol";
import "forge-std/Base.sol";
import "../src/MockVulnerablePool.sol";

/// @title RoundTripHandler
/// @notice Foundry invariant handler that models a single attacker interacting with an AMM.
///
/// The attacker has three actions:
///   deposit(amount)      — add token1 liquidity (models LP deposits)
///   swapGivenOut(amount) — extract token1, pay token0 amountIn
///   swapMicro()          — always requests amountOut=1; the exact Balancer V2 attack vector
///
/// Ghost variables track the attacker's running net position:
///   ghost_totalIn   = all token1 deposited + all token0 paid as amountIn
///   ghost_totalOut  = all token1 received from swaps
///
/// The invariant ghost_totalOut ≤ ghost_totalIn must hold for any sequence.
/// On the vulnerable pool, swapMicro() returns amountIn=0 → ghost_totalOut grows
/// faster than ghost_totalIn → counterexample found immediately.
///
/// Secondary invariant:
///   ghost_freeSwaps = 0  (no swap should ever succeed with amountIn=0 and amountOut>0)
/// This directly fingerprints the Balancer rounding bug without requiring an accumulation.
contract RoundTripHandler is CommonBase, StdCheats, StdUtils {
    MockVulnerablePool public pool;
    uint256 public immutable scalingFactor;

    // --- ghost variables -------------------------------------------------

    /// @dev Total value put IN to the pool by this actor (deposits + swap payments)
    uint256 public ghost_totalIn;

    /// @dev Total token1 received OUT from the pool by this actor (swap proceeds)
    uint256 public ghost_totalOut;

    /// @dev Number of swaps executed (diagnostic)
    uint256 public ghost_swapCount;

    /// @dev Number of swaps where amountIn == 0 but amountOut > 0 ("free" extractions)
    uint256 public ghost_freeSwaps;

    // --- deprecated aliases kept for backward-compatibility with test assertions ---
    uint256 public ghost_totalDeposited; // = ghost_totalIn
    uint256 public ghost_totalExtracted; // = ghost_totalOut

    constructor(MockVulnerablePool _pool, uint256 _scalingFactor) {
        require(_scalingFactor == _pool.SCALING_FACTOR(), "SF_MISMATCH");
        pool = _pool;
        scalingFactor = _scalingFactor;
    }

    // -------------------------------------------------------------------------
    // Actions available to the fuzzer
    // -------------------------------------------------------------------------

    /// @notice Deposit token1 into the pool. Represents legitimate LP activity.
    /// Bounded to prevent overflow; small enough to keep pool in low-liquidity range.
    function deposit(uint256 amount) external {
        amount = bound(amount, 1, 100);
        pool.deposit(0, amount);
        ghost_totalIn += amount;
        ghost_totalDeposited += amount;
    }

    /// @notice Arbitrary-size GIVEN_OUT swap. Fuzzer varies amountOut each call.
    /// Bounded to leave at least 1 wei in reserve1 so the pool doesn't become unusable.
    function swapGivenOut(uint256 amountOut) external {
        uint256 reserve1 = pool.reserve1();
        if (reserve1 <= 1) return;
        amountOut = bound(amountOut, 1, reserve1 - 1);

        uint256 amountIn = pool.swapGivenOut(amountOut);

        _recordSwap(amountIn, amountOut);
    }

    /// @notice Micro-swap: always requests exactly 1 wei of token1.
    /// This is the precise Balancer V2 attack vector:
    ///   mulDown(1, 1e12) = (1 * 1e12) / 1e18 = 0  →  scaledOut = 0
    ///   scaledIn = (r0 * 0) / (r1 - 0) = 0         →  amountIn = 0
    /// Result: 1 wei extracted, 0 wei paid — violation on first call.
    function swapMicro() external {
        if (pool.reserve1() == 0) return;

        uint256 amountIn = pool.swapGivenOut(1);
        _recordSwap(amountIn, 1);
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    function _recordSwap(uint256 amountIn, uint256 amountOut) internal {
        ghost_totalIn += amountIn;
        ghost_totalOut += amountOut;
        ghost_totalDeposited += amountIn;
        ghost_totalExtracted += amountOut;
        ghost_swapCount++;

        // Track "free" extractions: protocol paid amountOut but received nothing
        if (amountIn == 0 && amountOut > 0) {
            ghost_freeSwaps++;
        }
    }
}
