// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/FixedPoint.sol";
import "../src/MockVulnerablePool.sol";
import "../src/MockFixedPool.sol";
import "../src/InvariantMonitor.sol";
import "../src/EmergencyPauser.sol";

// ─────────────────────────────────────────────────────────────
// FixedPoint arithmetic — unit-level properties
// ─────────────────────────────────────────────────────────────
contract FixedPointTest is Test {
    using FixedPoint for uint256;

    uint256 constant ONE = 1e18;

    // ── zero identity ─────────────────────────────────────────
    function test_mulDown_zero_a() public pure {
        assertEq(uint256(0).mulDown(1e12), 0);
    }

    function test_mulDown_zero_b() public pure {
        assertEq(uint256(1e12).mulDown(0), 0);
    }

    function test_mulUp_zero_a() public pure {
        assertEq(uint256(0).mulUp(1e12), 0);
    }

    function test_mulUp_zero_b() public pure {
        assertEq(uint256(1e12).mulUp(0), 0);
    }

    function test_divDown_zero_numerator() public pure {
        assertEq(uint256(0).divDown(1e12), 0);
    }

    function test_divUp_zero_numerator() public pure {
        assertEq(uint256(0).divUp(1e12), 0);
    }

    // ── THE EXPLOIT PRECONDITION ──────────────────────────────
    // mulDown(1, 1e12) = (1 × 1e12) / 1e18 = 0 — rounds to zero.
    // This is why amountIn = 0 for the first 8 swaps on a tiny pool.
    function test_mulDown_exploit_precondition() public pure {
        uint256 result = uint256(1).mulDown(1e12);
        assertEq(result, 0, "mulDown(1, 1e12) must truncate to 0 - this IS the bug");
    }

    // THE FIX: mulUp rounds up, so mulUp(1, 1e12) = ceil(1e12 / 1e18) = 1.
    function test_mulUp_fix_postcondition() public pure {
        uint256 result = uint256(1).mulUp(1e12);
        assertEq(result, 1, "mulUp(1, 1e12) must be 1 - ceiling prevents free extraction");
    }

    // ── ordering: mulUp(a,b) >= mulDown(a,b) always ───────────
    function test_mulUp_ge_mulDown(uint128 a, uint128 b) public pure {
        // Constrain to avoid overflow: a * b must fit in uint256
        // a, b are uint128 so a*b <= 2^256 — safe
        assertGe(uint256(a).mulUp(b), uint256(a).mulDown(b));
    }

    // ── ordering: divUp(a,b) >= divDown(a,b) always ───────────
    function test_divUp_ge_divDown(uint128 a, uint128 b) public pure {
        vm.assume(b > 0);
        assertGe(uint256(a).divUp(b), uint256(a).divDown(b));
    }

    // ── identity: mulDown(x, ONE) == x ────────────────────────
    function test_mulDown_identity(uint128 x) public pure {
        assertEq(uint256(x).mulDown(ONE), uint256(x));
    }

    // ── identity: mulUp(x, ONE) == x ─────────────────────────
    function test_mulUp_identity(uint128 x) public pure {
        assertEq(uint256(x).mulUp(ONE), uint256(x));
    }

    // ── identity: divDown(x, ONE) == x ────────────────────────
    function test_divDown_identity(uint128 x) public pure {
        assertEq(uint256(x).divDown(ONE), uint256(x));
    }

    // ── identity: divUp(x, ONE) == x ─────────────────────────
    function test_divUp_identity(uint128 x) public pure {
        assertEq(uint256(x).divUp(ONE), uint256(x));
    }

    // ── divDown vs divUp: at most 1 apart for exact divisors ──
    function test_div_at_most_one_apart(uint128 a, uint128 b) public pure {
        vm.assume(b > 0);
        uint256 down = uint256(a).divDown(b);
        uint256 up   = uint256(a).divUp(b);
        assertLe(up - down, 1);
    }

    // ── mulDown vs mulUp: at most 1 apart ─────────────────────
    function test_mul_at_most_one_apart(uint128 a, uint128 b) public pure {
        uint256 down = uint256(a).mulDown(b);
        uint256 up   = uint256(a).mulUp(b);
        assertLe(up - down, 1);
    }

    // ── small values that trigger the scaling truncation ──────
    function test_mulDown_small_values_truncate_to_zero() public pure {
        // Any value < 1e6 with SCALING_FACTOR=1e12 truncates to 0 via mulDown
        for (uint256 v = 1; v < 1_000_000; v += 99_999) {
            uint256 result = v.mulDown(1e12);
            assertEq(result, 0, "values below 1e6 must round to 0 with 1e12 scaling");
        }
    }

    // ── mulUp never truncates at the scaling boundary ─────────
    function test_mulUp_scaling_boundary_nonzero() public pure {
        // Any nonzero value × 1e12 via mulUp gives at least 1
        for (uint256 v = 1; v <= 10; v++) {
            uint256 result = v.mulUp(1e12);
            assertGe(result, 1, "mulUp must never truncate nonzero x 1e12 to 0");
        }
    }
}

// ─────────────────────────────────────────────────────────────
// MockVulnerablePool — specific swap behaviour
// ─────────────────────────────────────────────────────────────
contract VulnerablePoolTest is Test {
    MockVulnerablePool pool;

    function setUp() public {
        pool = new MockVulnerablePool(8, 65, 1e12);
    }

    // The exploit: swapGivenOut(1) returns amountIn=0 at tiny reserves
    function test_swapGivenOut_amountIn_is_zero() public {
        uint256 amountIn = pool.swapGivenOut(1);
        assertEq(amountIn, 0, "exploit: attacker pays nothing");
    }

    // Pool loses reserve1 even though it received nothing
    function test_swapGivenOut_drains_reserve() public {
        uint256 before = pool.reserve1();
        pool.swapGivenOut(1);
        assertEq(pool.reserve1(), before - 1, "reserve1 must decrease by 1");
        assertEq(pool.reserve0(), 8,           "reserve0 unchanged when amountIn=0");
    }

    // After 65 swaps reserve1 is fully drained
    function test_full_drain_65_swaps() public {
        uint256 totalPaid;
        for (uint256 i = 0; i < 65; i++) {
            if (pool.reserve1() == 0) break;
            totalPaid += pool.swapGivenOut(1);
        }
        assertEq(pool.reserve1(), 0,  "pool fully drained");
        assertEq(totalPaid,       0,  "attacker paid nothing at all");
    }

    // Insufficient liquidity reverts
    // NOTE: precompute the argument before vm.expectRevert — Forge intercepts the
    // very next external call, which would otherwise be the reserve1() read.
    function test_swapGivenOut_reverts_insufficient_liquidity() public {
        uint256 overflow = pool.reserve1() + 1;
        vm.expectRevert("INSUFFICIENT_LIQUIDITY");
        pool.swapGivenOut(overflow);
    }

    // Paused pool reverts
    function test_swapGivenOut_reverts_when_paused() public {
        pool.pause();
        vm.expectRevert("BAL#211");
        pool.swapGivenOut(1);
    }

    // Invariant decreases on every free swap (leakage is measurable)
    function test_invariant_decreases_on_free_swap() public {
        (uint256 kBefore,) = pool.getLastInvariant();
        pool.swapGivenOut(1);
        (uint256 kAfter,) = pool.getLastInvariant();
        assertLt(kAfter, kBefore, "invariant must fall when attacker pays nothing");
    }

    // deposit increases reserves correctly
    function test_deposit_updates_reserves() public {
        pool.deposit(10, 20);
        assertEq(pool.reserve0(), 18);
        assertEq(pool.reserve1(), 85);
    }
}

// ─────────────────────────────────────────────────────────────
// MockFixedPool — ceiling-division fix properties
// ─────────────────────────────────────────────────────────────
contract FixedPoolTest is Test {
    MockFixedPool pool;

    function setUp() public {
        pool = new MockFixedPool(8, 65);
    }

    // The fix: swapGivenOut(1) must return amountIn >= 1
    function test_swapGivenOut_amountIn_ge_one() public {
        uint256 amountIn = pool.swapGivenOut(1);
        assertGe(amountIn, 1, "fix: caller must pay at least 1 wei");
    }

    // Fixed pool: attacker cannot profit (extracts <= pays)
    function test_no_free_extraction_65_swaps() public {
        uint256 totalOut;
        uint256 totalIn;
        for (uint256 i = 0; i < 65; i++) {
            if (pool.reserve1() <= 1) break;
            uint256 amountIn = pool.swapGivenOut(1);
            totalOut += 1;
            totalIn  += amountIn;
        }
        assertLe(totalOut, totalIn, "fix: can never extract more than you pay");
    }

    // Ceiling math: amountIn = ceil(r0 * amountOut / (r1 - amountOut))
    function test_ceiling_formula_correctness() public {
        // reserves: (8, 65), amountOut=1
        // amountIn = ceil(8 * 1 / (65 - 1)) = ceil(8/64) = ceil(0.125) = 1
        uint256 amountIn = pool.swapGivenOut(1);
        assertEq(amountIn, 1);
    }

    // Paused pool reverts
    function test_swapGivenOut_reverts_when_paused() public {
        pool.pause();
        vm.expectRevert("BAL#211");
        pool.swapGivenOut(1);
    }

    // Insufficient liquidity (fixed pool requires amountOut < reserve1 strict)
    function test_swapGivenOut_reverts_insufficient_liquidity() public {
        uint256 atLimit = pool.reserve1(); // fixed pool: require(amountOut < reserve1)
        vm.expectRevert("INSUFFICIENT_LIQUIDITY");
        pool.swapGivenOut(atLimit);
    }

    // Fuzz: for any reserve config and small amountOut, protocol never gets free extraction.
    // The fix ensures amountIn >= 1 (ceiling), not amountIn >= amtOut (that would be wrong —
    // a fair constant-product price can be < amtOut when r0 << r1).
    function testFuzz_fixed_pool_no_free_extraction(uint64 r0, uint64 r1, uint64 amtOut) public {
        vm.assume(r0 > 0 && r1 > 2 && amtOut > 0 && amtOut < r1);
        MockFixedPool p = new MockFixedPool(r0, r1);
        uint256 amountIn = p.swapGivenOut(amtOut);
        assertGe(amountIn, 1, "fix: never free - attacker always pays at least 1 wei");
    }
}

// ─────────────────────────────────────────────────────────────
// EmergencyPauser — access control
// ─────────────────────────────────────────────────────────────
contract EmergencyPauserTest is Test {
    EmergencyPauser pauser;
    MockVulnerablePool pool;

    address guardian = address(0xDEAD);
    address keeper   = address(0xBEEF);
    address random   = address(0x1234);
    bytes32 constant POOL_ID = keccak256("test-pool");

    function setUp() public {
        pauser = new EmergencyPauser(guardian, keeper);
        pool   = new MockVulnerablePool(8, 8, 1e12);

        vm.prank(guardian);
        pauser.registerPool(POOL_ID, address(pool));
    }

    // Guardian can pause
    function test_guardian_can_pause() public {
        vm.prank(guardian);
        pauser.pause(POOL_ID);
        assertTrue(pool.paused());
    }

    // Keeper can pause
    function test_keeper_can_pause() public {
        vm.prank(keeper);
        pauser.pause(POOL_ID);
        assertTrue(pool.paused());
    }

    // Random address cannot pause
    function test_random_cannot_pause() public {
        vm.prank(random);
        vm.expectRevert("UNAUTHORIZED");
        pauser.pause(POOL_ID);
    }

    // Non-guardian cannot register a pool
    function test_keeper_cannot_register_pool() public {
        bytes32 newId = keccak256("new-pool");
        vm.prank(keeper);
        vm.expectRevert("GUARDIAN_ONLY");
        pauser.registerPool(newId, address(pool));
    }

    // Random address cannot register a pool
    function test_random_cannot_register_pool() public {
        bytes32 newId = keccak256("new-pool");
        vm.prank(random);
        vm.expectRevert("GUARDIAN_ONLY");
        pauser.registerPool(newId, address(pool));
    }

    // Pausing unregistered pool reverts
    function test_pause_unregistered_pool_reverts() public {
        bytes32 badId = keccak256("not-registered");
        vm.prank(guardian);
        vm.expectRevert("POOL_NOT_REGISTERED");
        pauser.pause(badId);
    }

    // PoolPaused event is emitted
    function test_pause_emits_event() public {
        vm.expectEmit(true, true, false, false, address(pauser));
        emit EmergencyPauser.PoolPaused(POOL_ID, keeper);
        vm.prank(keeper);
        pauser.pause(POOL_ID);
    }

    // PoolRegistered event is emitted during registerPool
    function test_registerPool_emits_event() public {
        bytes32 newId = keccak256("new");
        MockVulnerablePool newPool = new MockVulnerablePool(1, 1, 1e12);

        vm.expectEmit(true, false, false, false, address(pauser));
        emit EmergencyPauser.PoolRegistered(newId, address(newPool));
        vm.prank(guardian);
        pauser.registerPool(newId, address(newPool));
    }

    // registeredPools mapping is set correctly
    function test_registerPool_stores_address() public {
        bytes32 newId = keccak256("another-pool");
        MockVulnerablePool newPool = new MockVulnerablePool(1, 1, 1e12);

        vm.prank(guardian);
        pauser.registerPool(newId, address(newPool));

        assertEq(pauser.registeredPools(newId), address(newPool));
    }

    // Second keeper (added after deploy) can pause
    function test_second_keeper_can_pause() public {
        address keeper2 = address(0x5678);
        vm.prank(guardian);
        pauser.addKeeper(keeper2);

        vm.prank(keeper2);
        pauser.pause(POOL_ID);
        assertTrue(pool.paused());
    }

    // Removed keeper can no longer pause
    function test_removed_keeper_cannot_pause() public {
        vm.prank(guardian);
        pauser.removeKeeper(keeper);

        vm.prank(keeper);
        vm.expectRevert("UNAUTHORIZED");
        pauser.pause(POOL_ID);
    }
}

// ─────────────────────────────────────────────────────────────
// InvariantMonitor — trip logic edge cases
// ─────────────────────────────────────────────────────────────
contract InvariantMonitorTest is Test {
    InvariantMonitor monitor;
    MockVulnerablePool pool;
    bytes32 constant PID = keccak256("pid");

    function setUp() public {
        pool    = new MockVulnerablePool(8, 8, 1e12);
        monitor = new InvariantMonitor(0, 0, 0, 0, 0);
    }

    // Fresh pool: isTripped is false
    function test_fresh_pool_not_tripped() public view {
        assertFalse(monitor.isTripped(PID));
    }

    // Baseline swap: checkAfterSwap sets lastInvariant, does not trip
    function test_first_check_sets_baseline_no_trip() public {
        pool.swapGivenOut(1);
        monitor.checkAfterSwap(PID, address(pool));
        assertFalse(monitor.isTripped(PID), "baseline check must not trip");
    }

    // Second swap: drift is massive → trips immediately
    function test_second_check_trips_on_large_drift() public {
        pool.swapGivenOut(1);
        monitor.checkAfterSwap(PID, address(pool)); // baseline

        pool.swapGivenOut(1);
        vm.expectEmit(true, false, false, false, address(monitor));
        emit InvariantMonitor.CircuitBreakerTripped(PID, 0);
        monitor.checkAfterSwap(PID, address(pool));

        assertTrue(monitor.isTripped(PID));
    }

    // Already-tripped: checkAfterSwap is idempotent — no second event
    function test_already_tripped_idempotent() public {
        // Trip it
        pool.swapGivenOut(1);
        monitor.checkAfterSwap(PID, address(pool));
        pool.swapGivenOut(1);
        monitor.checkAfterSwap(PID, address(pool));
        assertTrue(monitor.isTripped(PID));

        // Further calls must not throw and must not change state
        // (if it re-emitted it would revert the expectEmit; not checking event = fine)
        pool.deposit(1000, 1000); // restore liquidity
        monitor.checkAfterSwap(PID, address(pool)); // must not revert
        assertTrue(monitor.isTripped(PID), "once tripped, stays tripped");
    }

    // Low-liquidity counter: trips after > MAX_SWAPS_LOW_LIQUIDITY (5) swaps at reserve1 < 100
    function test_low_liquidity_counter_trips_at_swap_6() public {
        // Pool starts at (8, 8): reserve1=8 < 100 = LOW_LIQUIDITY_WEI
        // Each checkAfterSwap increments swapsSinceReset; trips at > 5 (i.e. 6th check)
        pool.swapGivenOut(1); monitor.checkAfterSwap(PID, address(pool)); // swap 1 (sets baseline)
        assertFalse(monitor.isTripped(PID));

        // Deposit to keep enough liquidity to keep swapping, but keep reserve1 < 100
        pool.deposit(0, 4); // reserve1 = 8 + 4 - 1 = 11 after first swap

        for (uint256 i = 2; i <= 5; i++) {
            pool.deposit(0, 1);
            pool.swapGivenOut(1);
            monitor.checkAfterSwap(PID, address(pool));
        }
        assertFalse(monitor.isTripped(PID), "not yet tripped after 5 checks");

        // Swap 6 — should trip
        pool.deposit(0, 1);
        pool.swapGivenOut(1);

        vm.expectEmit(true, false, false, false, address(monitor));
        emit InvariantMonitor.CircuitBreakerTripped(PID, 0);
        monitor.checkAfterSwap(PID, address(pool));

        assertTrue(monitor.isTripped(PID), "must trip on 6th swap at low liquidity");
    }

    // Rising invariant does NOT trip the breaker
    function test_rising_invariant_does_not_trip() public {
        // Establish baseline with a swap, then do only deposits (which raise invariant)
        MockVulnerablePool bigPool = new MockVulnerablePool(1000, 1000, 1e12);
        bytes32 bigPid = keccak256("big");

        // Baseline
        bigPool.swapGivenOut(1);
        monitor.checkAfterSwap(bigPid, address(bigPool));

        // Add liquidity — invariant goes up
        bigPool.deposit(500, 500);
        monitor.checkAfterSwap(bigPid, address(bigPool));
        bigPool.deposit(500, 500);
        monitor.checkAfterSwap(bigPid, address(bigPool));

        assertFalse(monitor.isTripped(bigPid), "rising invariant must never trip breaker");
    }

    // InvariantDriftDetected event is emitted before trip
    function test_drift_event_emitted_before_trip() public {
        pool.swapGivenOut(1);
        monitor.checkAfterSwap(PID, address(pool)); // baseline

        pool.swapGivenOut(1);
        vm.expectEmit(true, false, false, false, address(monitor));
        emit InvariantMonitor.InvariantDriftDetected(PID, 0, 0);
        monitor.checkAfterSwap(PID, address(pool));
    }

    // Multiple independent pools tracked independently
    function test_independent_pool_states() public {
        MockVulnerablePool pool2 = new MockVulnerablePool(8, 8, 1e12);
        bytes32 PID2 = keccak256("pid2");

        // Trip PID1
        pool.swapGivenOut(1);
        monitor.checkAfterSwap(PID, address(pool));
        pool.swapGivenOut(1);
        monitor.checkAfterSwap(PID, address(pool));

        // PID2 should remain untouched
        assertFalse(monitor.isTripped(PID2), "other pool must not be affected");

        // PID2 still works normally
        pool2.swapGivenOut(1);
        monitor.checkAfterSwap(PID2, address(pool2));
        assertFalse(monitor.isTripped(PID2), "pid2 baseline check must not trip");
    }

    // setGlobalConfig / setPoolConfig overrides take effect in checkAfterSwap
    function test_setGlobalConfig_customThresholds_take_effect() public {
        // Deploy monitor with very high thresholds (won't trip on normal drift)
        InvariantMonitor strictMonitor = new InvariantMonitor(10_000, 10_000, 1, 1, 3600);

        MockVulnerablePool p = new MockVulnerablePool(8, 8, 1e12);
        bytes32 pid = keccak256("strict");

        p.swapGivenOut(1);
        strictMonitor.checkAfterSwap(pid, address(p));   // baseline

        p.swapGivenOut(1);
        strictMonitor.checkAfterSwap(pid, address(p));   // large drift but threshold=10000 bps
        assertFalse(strictMonitor.isTripped(pid), "high threshold: must not trip");

        // Lower the threshold to 1 bps — same drift now exceeds it
        vm.prank(strictMonitor.owner());
        strictMonitor.setGlobalConfig(1, 1, 100, 5, 3600);

        p.swapGivenOut(1);
        strictMonitor.checkAfterSwap(pid, address(p));   // trips now
        assertTrue(strictMonitor.isTripped(pid), "after config update: must trip");
    }

    // Cooldown auto-reset: breaker clears and monitoring resumes after tripCooldown seconds
    function test_cooldown_autoreset_after_warp() public {
        // Short cooldown (10 seconds) so we can warp past it easily
        InvariantMonitor m = new InvariantMonitor(0, 0, 0, 0, 10);

        MockVulnerablePool p = new MockVulnerablePool(8, 8, 1e12);
        bytes32 pid = keccak256("cooldown");

        // Trip the breaker
        p.swapGivenOut(1);
        m.checkAfterSwap(pid, address(p));  // baseline
        p.swapGivenOut(1);
        m.checkAfterSwap(pid, address(p));  // trips
        assertTrue(m.isTripped(pid), "must be tripped");

        // Still tripped immediately after
        p.deposit(0, 100);
        m.checkAfterSwap(pid, address(p));
        assertTrue(m.isTripped(pid), "must still be tripped within cooldown");

        // Warp past cooldown — auto-reset kicks in on next checkAfterSwap
        vm.warp(block.timestamp + 11);
        p.swapGivenOut(1);
        m.checkAfterSwap(pid, address(p));   // this call auto-resets and sets new baseline
        assertFalse(m.isTripped(pid), "must be reset after cooldown");
    }
}

// ─────────────────────────────────────────────────────────────
// End-to-end: attack blocked by full circuit breaker stack
// ─────────────────────────────────────────────────────────────
contract EndToEndCircuitBreakerTest is Test {
    MockVulnerablePool pool;
    InvariantMonitor   monitor;
    EmergencyPauser    pauser;

    address guardian = address(0xDEAD);
    address keeper   = address(0xBEEF);
    address attacker = address(0xBAD);
    bytes32 constant POOL_ID = keccak256("e2e-pool");

    function setUp() public {
        pool    = new MockVulnerablePool(8, 65, 1e12);
        monitor = new InvariantMonitor(0, 0, 0, 0, 0);
        pauser  = new EmergencyPauser(guardian, keeper);

        vm.prank(guardian);
        pauser.registerPool(POOL_ID, address(pool));
    }

    /// Full scenario: attacker starts draining, monitor detects, keeper pauses, subsequent swaps revert.
    function test_full_attack_blocked() public {
        // Attacker: swap 1 — monitor establishes baseline (no trip)
        vm.prank(attacker);
        pool.swapGivenOut(1);
        monitor.checkAfterSwap(POOL_ID, address(pool));
        assertFalse(monitor.isTripped(POOL_ID));

        // Attacker: swap 2 — massive drift, breaker trips
        vm.prank(attacker);
        pool.swapGivenOut(1);
        monitor.checkAfterSwap(POOL_ID, address(pool));
        assertTrue(monitor.isTripped(POOL_ID), "breaker must trip after swap 2");

        // Keeper reacts to CircuitBreakerTripped event and pauses the pool
        vm.prank(keeper);
        pauser.pause(POOL_ID);
        assertTrue(pool.paused());

        // All further swap attempts revert — attack stopped
        pool.deposit(1000, 1000); // ensure liquidity isn't the stopper
        vm.expectRevert("BAL#211");
        vm.prank(attacker);
        pool.swapGivenOut(1);
    }

    /// Verify that without the circuit breaker, the same pool is fully drained
    function test_without_circuit_breaker_pool_drained() public {
        uint256 totalPaid;
        vm.startPrank(attacker);
        for (uint256 i = 0; i < 65; i++) {
            if (pool.reserve1() == 0) break;
            totalPaid += pool.swapGivenOut(1);
        }
        vm.stopPrank();

        assertEq(pool.reserve1(), 0, "pool fully drained without protection");
        assertEq(totalPaid,       0, "attacker paid nothing");
    }
}
