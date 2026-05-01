// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./FixedPoint.sol";

/// @notice MockFixedPool demonstrates the corrected GIVEN_OUT swap path.
///
/// THE FIX — two equivalent approaches:
///   Option A (preferred): use mulUp for the upscale of amountOut.
///     scaledOut = mulUp(amountOut, scalingFactor)
///     mulUp(1, 1e12) = 1 (never zero) → StableMath sees a real value → amountIn > 0.
///
///   Option B (this contract): bypass scaling entirely and apply ceiling division directly
///     on the raw constant-product formula. Equivalent in effect, cleaner for demo purposes.
///     amountIn = ceil(r0 * amountOut / (r1 - amountOut))
///
/// WHY CEILING DIVISION IS CORRECT:
///   The true constant-product price is r0*amountOut/(r1-amountOut), which is generally
///   non-integer. Floor rounding (divDown) charges the caller less than the true price —
///   systematic undercharge across many swaps. Ceiling rounding (divUp) ensures the
///   protocol always collects at least the true price. The attacker can never profit.
///
/// The FixedPoint library is imported for interface parity with MockVulnerablePool only;
/// it is not used in swapGivenOut. In production, the fix belongs at the _upscale call site.
contract MockFixedPool {
    using FixedPoint for uint256; // imported for interface parity; not called in swapGivenOut

    uint256 public reserve0; // token0 balance
    uint256 public reserve1; // token1 balance
    bool public paused;

    /// @param _reserve0 Initial token0 reserve.
    /// @param _reserve1 Initial token1 reserve.
    constructor(uint256 _reserve0, uint256 _reserve1) {
        reserve0 = _reserve0;
        reserve1 = _reserve1;
    }

    /// @notice GIVEN_OUT swap with fix: ceiling division ensures protocol is never shortchanged.
    /// @param amountOut Token1 amount the caller wishes to receive.
    /// @return amountIn Token0 amount the caller must pay (always >= 1 with the ceiling fix).
    function swapGivenOut(uint256 amountOut) external returns (uint256 amountIn) {
        require(!paused, "BAL#211");
        require(amountOut < reserve1, "INSUFFICIENT_LIQUIDITY");

        uint256 numerator = reserve0 * amountOut;
        uint256 denominator = reserve1 - amountOut;

        // FIX: divUp (ceiling) — protocol always collects at least the true amount
        // ceil(numerator / denominator) = (numerator + denominator - 1) / denominator
        amountIn = (numerator + denominator - 1) / denominator;

        reserve0 += amountIn;
        reserve1 -= amountOut;
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
