// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./FixedPoint.sol";

/// @notice Simplified AMM that replicates the rounding mechanics of the Balancer V2
/// ComposableStablePool exploit (November 3, 2025, ~$120M loss).
///
/// SIMPLIFICATIONS VS. THE REAL ATTACK:
///   - Uses constant-product math (k = r0 × r1). The real pool used StableSwap
///     invariant D (Curve-style with amplification factor).
///   - Uses a fixed SCALING_FACTOR = 1e12, modelling a 6-decimal token like USDC.
///     Real Composable Stable Pools hold LST tokens (wstETH, cbETH, rETH) whose
///     scaling factor is composite: 10^(18-decimals) × rateProvider.getRate().
///     For cbETH with staking yield ~1.05, scalingFactor ≈ 1.05e12 × ONE — dynamic
///     and non-unitary, which amplified the rounding effect.
///   - Models direct value extraction from reserve1. The real attack eroded the
///     StableSwap invariant D, deflating BPT price (= D/totalSupply), and profited
///     via BPT round-trips — not a simple drain.
///
/// WHAT IS ACCURATELY MODELLED:
///   The essential rounding mechanic is faithfully reproduced:
///     _upscale(amountOut) uses mulDown → rounds to 0 at sub-threshold values
///     invariantMath(0)    returns 0
///     _downscaleUp(0)     using divDown → amountIn = 0 (attacker pays nothing)
///
/// The fix is the same in both formulations: use mulUp for the upscale of amountOut
/// in GIVEN_OUT swaps, so the non-zero amountOut signal is never silently zeroed.
contract MockVulnerablePool {
    using FixedPoint for uint256;

    uint256 public reserve0; // token0 balance
    uint256 public reserve1; // token1 balance
    uint256 public immutable SCALING_FACTOR; // scale factor (6-dec -> 18-dec)
    bool public paused;

    event Swap(address indexed caller, uint256 amountIn, uint256 amountOut);

    /// @param _reserve0 Initial token0 reserve.
    /// @param _reserve1 Initial token1 reserve.
    /// @param _scalingFactor Fixed-point scaling factor (e.g. 1e12 for a 6-decimal token).
    constructor(uint256 _reserve0, uint256 _reserve1, uint256 _scalingFactor) {
        reserve0 = _reserve0;
        reserve1 = _reserve1;
        SCALING_FACTOR = _scalingFactor;
    }

    /// @notice GIVEN_OUT swap: caller specifies amountOut, contract computes amountIn.
    ///
    /// BUG REPRODUCTION (mirrors real ComposableStablePool._onSwapGivenOut):
    ///   Step 1 — _upscaleArray(reserves): uses mulUp — reserves preserved safely.
    ///   Step 2 — _upscale(amountOut):     uses mulDown — rounds to 0 for amountOut < 1e6.
    ///                                     mulDown(1, 1e12) = (1×1e12)/1e18 = 0
    ///   Step 3 — invariantMath(0):        constant-product with scaledOut=0 → scaledIn=0.
    ///                                     (Real pool: StableMath._calcInGivenOut(amp,0)=0)
    ///   Step 4 — _downscaleUp(0):         divDown(0, 1e12) = 0 → amountIn = 0.
    ///
    ///   Truncation range: any amountOut < ceil(ONE / SCALING_FACTOR) = 1e6 truncates to 0.
    ///   At reserve1 < 1e6, every swapGivenOut(1) is free — pool drains in O(reserve1) steps.
    /// @param amountOut Token1 amount the caller wishes to receive.
    /// @return amountIn Token0 amount the caller must pay (0 when the bug fires).
    function swapGivenOut(uint256 amountOut) external returns (uint256 amountIn) {
        require(!paused, "BAL#211");
        require(amountOut <= reserve1, "INSUFFICIENT_LIQUIDITY");

        // Reserves upscaled with mulUp — preserved (ceil to 1 for small values)
        uint256 scaledR0 = reserve0.mulUp(SCALING_FACTOR);
        uint256 scaledR1 = reserve1.mulUp(SCALING_FACTOR);
        // BUG: amountOut upscaled with mulDown — rounds to 0 for values < 1e6
        uint256 scaledOut = amountOut.mulDown(SCALING_FACTOR);

        // Constant product: amountIn = r0 * amountOut / (r1 - amountOut)
        // With scaledOut=0: scaledIn = 0, denominator = scaledR1 (nonzero)
        uint256 scaledIn = (scaledR0 * scaledOut) / (scaledR1 - scaledOut);

        // BUG: divDown rounds down — caller pays less than they should
        amountIn = scaledIn.divDown(SCALING_FACTOR);

        reserve0 += amountIn;
        reserve1 -= amountOut;
        emit Swap(msg.sender, amountIn, amountOut);
    }

    /// @notice Returns the constant-product invariant k = reserve0 * reserve1 and a placeholder amp factor.
    /// @return invariant k = reserve0 * reserve1.
    /// @return ampFactor Always 0 (constant-product, no amplification).
    function getLastInvariant() external view returns (uint256, uint256) {
        return (reserve0 * reserve1, 0);
    }

    /// @notice Pause the pool. Subsequent swaps revert with BAL#211.
    function pause() external {
        paused = true;
    }

    /// @notice Add liquidity to both reserves directly (no LP tokens, test-only).
    /// @param amount0 Token0 amount to add.
    /// @param amount1 Token1 amount to add.
    function deposit(uint256 amount0, uint256 amount1) external {
        reserve0 += amount0;
        reserve1 += amount1;
    }
}
