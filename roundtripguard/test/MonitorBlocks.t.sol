// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/MockVulnerablePool.sol";
import "../src/InvariantMonitor.sol";
import "../src/EmergencyPauser.sol";

contract MonitorBlocks is Test {
    MockVulnerablePool pool;
    InvariantMonitor monitor;
    EmergencyPauser pauser;

    address guardian = address(0xDEAD);
    address keeper = address(0xBEEF);
    bytes32 constant POOL_ID = keccak256("test-pool");

    function setUp() public {
        // Pool starts with 8 wei — below LOW_LIQUIDITY_WEI (100), attack precondition
        pool = new MockVulnerablePool(8, 8, 1e12);
        monitor = new InvariantMonitor(0, 0, 0, 0, 0);
        pauser = new EmergencyPauser(guardian, keeper);

        // Guardian registers the pool
        vm.prank(guardian);
        pauser.registerPool(POOL_ID, address(pool));
    }

    /// @notice Without monitor: attack extracts phantom value freely.
    function test_withoutMonitor_attackSucceeds() public {
        uint256 extracted;
        uint256 paid;

        // Drain the pool — no monitor involved
        for (uint256 i = 0; i < 8 && pool.reserve1() > 0; i++) {
            uint256 amountIn = pool.swapGivenOut(1);
            extracted += 1;
            paid += amountIn;
        }

        assertGt(extracted, paid, "attack should profit without monitor");
    }

    /// @notice With monitor: circuit breaker trips after invariant drift is detected
    /// on the 2nd swap (driftBps >> DRIFT_BPS_THRESHOLD), keeper pauses pool,
    /// next swap reverts BAL#211.
    ///
    /// InvariantMonitor has two trip paths:
    ///   1. Low-liquidity counter: swapsSinceReset > MAX_SWAPS_LOW_LIQUIDITY (5)
    ///   2. Invariant drift: driftBps > DRIFT_BPS_THRESHOLD (1 bps) OR cumulBps > CUMULATIVE_DRIFT_BPS (5 bps)
    ///
    /// With reserve0=8, reserve1=8 (invariant=64):
    ///   - Swap 1: invariant baseline set (64). No drift check yet.
    ///   - Swap 2: invariant drops to 48. drift=8, driftBps=1333 >> 1 bps → TRIPS here.
    function test_withMonitor_circuitBreakerTripsAndBlocksSwap() public {
        // --- Swap 1: establishes the baseline invariant ---
        pool.swapGivenOut(1);
        monitor.checkAfterSwap(POOL_ID, address(pool));
        assertFalse(monitor.isTripped(POOL_ID), "should not be tripped after baseline swap");

        // --- Swap 2: invariant drift is massive (>1 bps threshold) → trips the breaker ---
        pool.swapGivenOut(1);

        vm.expectEmit(true, false, false, false, address(monitor));
        emit InvariantMonitor.CircuitBreakerTripped(POOL_ID, 0);
        monitor.checkAfterSwap(POOL_ID, address(pool));

        assertTrue(monitor.isTripped(POOL_ID), "circuit breaker must be tripped after 2nd check");

        // Keeper sees the event and pauses the pool
        vm.prank(keeper);
        pauser.pause(POOL_ID);
        assertTrue(pool.paused(), "pool must be paused");

        // Any further swap reverts — pool is paused
        // First deposit some liquidity so the swap would otherwise succeed
        pool.deposit(1000, 1000);
        vm.expectRevert("BAL#211");
        pool.swapGivenOut(1);
    }
}
