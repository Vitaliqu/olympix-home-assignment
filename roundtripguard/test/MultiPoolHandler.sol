// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/StdUtils.sol";
import "forge-std/StdCheats.sol";
import "forge-std/Base.sol";
import "../src/MockVulnerablePool.sol";

/// @title MultiPoolHandler
/// @notice Models sequential drain across two identical vulnerable pools.
/// An attacker extracts from pool 0, re-deploys proceeds to drain pool 1.
/// Ghost variables accumulate across BOTH pools to detect the cross-pool
/// value leak that single-pool invariants cannot detect.
contract MultiPoolHandler is CommonBase, StdCheats, StdUtils {
    MockVulnerablePool[2] public pools;

    uint256 public ghost_totalIn;
    uint256 public ghost_totalOut;
    uint256 public ghost_swapCount;
    uint256 public ghost_freeSwaps;

    constructor(MockVulnerablePool _pool0, MockVulnerablePool _pool1) {
        require(address(_pool0) != address(_pool1), "SAME_POOL");
        pools[0] = _pool0;
        pools[1] = _pool1;
    }

    /// @notice Micro-swap on pool 0 or pool 1 (poolIndex is bounded to 0–1).
    function swapMicro(uint8 poolIndex) external {
        MockVulnerablePool pool = pools[poolIndex % 2];
        if (pool.reserve1() == 0) return;
        uint256 amountIn = pool.swapGivenOut(1);
        _record(amountIn, 1);
    }

    /// @notice Deposit token1 into pool 0 or pool 1.
    function deposit(uint8 poolIndex, uint256 amount) external {
        amount = bound(amount, 1, 100);
        pools[poolIndex % 2].deposit(0, amount);
        ghost_totalIn += amount;
    }

    /// @notice Arbitrary-size GIVEN_OUT swap on pool 0 or pool 1.
    function swapGivenOut(uint8 poolIndex, uint256 amount) external {
        MockVulnerablePool pool = pools[poolIndex % 2];
        if (pool.reserve1() <= 1) return;
        amount = bound(amount, 1, pool.reserve1() - 1);
        uint256 amountIn = pool.swapGivenOut(amount);
        _record(amountIn, amount);
    }

    function _record(uint256 amountIn, uint256 amountOut) internal {
        ghost_totalIn += amountIn;
        ghost_totalOut += amountOut;
        ghost_swapCount++;
        if (amountIn == 0 && amountOut > 0) ghost_freeSwaps++;
    }
}
