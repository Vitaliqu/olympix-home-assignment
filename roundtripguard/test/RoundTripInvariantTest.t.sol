// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/MockVulnerablePool.sol";
import "../src/MockFixedPool.sol";
import "./RoundTripHandler.sol";
import "./MultiPoolHandler.sol";

/// @title RoundTripInvariantTest
/// @notice Stateful invariant fuzzer for AMM rounding correctness.
///
/// Reserve size matters: attack only fires when balances are small enough for
/// mulDown(amountOut, 1e12) to round to 0. At 8 wei, the very first
/// swapMicro() call returns amountIn=0 — counterexample on first attack call.
///
/// Two invariants checked after every call sequence:
///   1. ghost_totalOut ≤ ghost_totalIn   (no profitable round-trip)
///   2. ghost_freeSwaps == 0             (no zero-cost extractions)
///
/// The vulnerable pool fails both immediately. The fixed pool passes 1000 runs.
contract RoundTripInvariantTest is Test {
    RoundTripHandler handler;
    MockVulnerablePool vulnerablePool;

    function setUp() public {
        // 8 wei reserves — exact attack precondition:
        // mulDown(1, 1e12) = (1 * 1e12) / 1e18 = 0 → scaledIn = 0 → amountIn = 0
        vulnerablePool = new MockVulnerablePool(8, 8, 1e12);
        handler = new RoundTripHandler(vulnerablePool, 1e12);

        targetContract(address(handler));

        // swapMicro listed twice → 2× selection weight relative to other actions
        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = RoundTripHandler.deposit.selector;
        selectors[1] = RoundTripHandler.swapGivenOut.selector;
        selectors[2] = RoundTripHandler.swapMicro.selector;
        selectors[3] = RoundTripHandler.swapMicro.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
    }

    /// @notice Primary invariant: total value out ≤ total value in.
    /// Fails on vulnerable pool — counterexample found on the first swapMicro call.
    function invariant_noRoundTripProfit() public view {
        assertLe(
            handler.ghost_totalOut(),
            handler.ghost_totalIn(),
            string.concat(
                "ROUND_TRIP_PROFIT_DETECTED after ",
                vm.toString(handler.ghost_swapCount()),
                " swaps: out=",
                vm.toString(handler.ghost_totalOut()),
                " in=",
                vm.toString(handler.ghost_totalIn())
            )
        );
    }

    /// @notice Secondary invariant: no swap may return amountIn=0 when amountOut>0.
    /// Directly fingerprints the Balancer rounding bug — fails before any accumulation needed.
    function invariant_noFreeExtraction() public view {
        assertEq(
            handler.ghost_freeSwaps(),
            0,
            string.concat(
                "FREE_EXTRACTION_DETECTED: ",
                vm.toString(handler.ghost_freeSwaps()),
                " zero-cost swap(s) across ",
                vm.toString(handler.ghost_swapCount()),
                " total"
            )
        );
    }
}

/// @notice Handler for the fixed pool — same attack surface as RoundTripHandler.
/// Fixed pool uses raw ceiling division, so swapMicro(1) returns amountIn=2 (not 0).
contract MockFixedHandler is CommonBase, StdCheats, StdUtils {
    MockFixedPool public pool;
    uint256 public ghost_totalIn;
    uint256 public ghost_totalOut;
    uint256 public ghost_swapCount;
    uint256 public ghost_freeSwaps;

    constructor(MockFixedPool _pool) { pool = _pool; }

    function deposit(uint256 amount) external {
        amount = bound(amount, 1, 100);
        pool.deposit(0, amount);
        ghost_totalIn += amount;
    }

    function swapGivenOut(uint256 amountOut) external {
        if (pool.reserve1() <= 1) return;
        amountOut = bound(amountOut, 1, pool.reserve1() - 1);
        uint256 amountIn = pool.swapGivenOut(amountOut);
        _recordSwap(amountIn, amountOut);
    }

    function swapMicro() external {
        if (pool.reserve1() == 0) return;
        uint256 amountIn = pool.swapGivenOut(1);
        _recordSwap(amountIn, 1);
    }

    function _recordSwap(uint256 amountIn, uint256 amountOut) internal {
        ghost_totalIn += amountIn;
        ghost_totalOut += amountOut;
        ghost_swapCount++;
        if (amountIn == 0 && amountOut > 0) ghost_freeSwaps++;
    }
}

contract RoundTripFixedInvariantTest is Test {
    MockFixedHandler handler;

    function setUp() public {
        // Same 8 wei reserves — fixed pool must survive the identical attack precondition
        MockFixedPool fixedPool = new MockFixedPool(8, 8);
        handler = new MockFixedHandler(fixedPool);
        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = MockFixedHandler.deposit.selector;
        selectors[1] = MockFixedHandler.swapGivenOut.selector;
        selectors[2] = MockFixedHandler.swapMicro.selector;
        selectors[3] = MockFixedHandler.swapMicro.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
    }

    function invariant_fixedPoolNoProfit() public view {
        assertLe(
            handler.ghost_totalOut(),
            handler.ghost_totalIn(),
            "FIXED POOL FAILED: should never profit"
        );
    }

    function invariant_fixedPoolNoFreeExtraction() public view {
        assertEq(
            handler.ghost_freeSwaps(),
            0,
            "FIXED POOL FAILED: free extraction detected"
        );
    }
}

/// @notice Invariant fuzzer that sweeps six economically realistic scaling factors.
/// For each rate, the pool is seeded at exactly the truncation boundary:
///   threshold = ceil(1e18 / scalingFactor) + 1
/// The attack fires as long as reserve1 <= threshold - 1 (amountOut=1 truncates to 0).
/// All six handler/pool pairs are registered as targets; invariants check all of them.
contract RoundTripRateSweepTest is Test {
    uint256 constant RATE_COUNT = 6;
    RoundTripHandler[RATE_COUNT] handlers;

    function setUp() public {
        uint256[6] memory rates = [
            uint256(1e6),
            uint256(1e9),
            uint256(1e12),
            uint256(1e15),
            uint256(105e10),
            uint256(2e12)
        ];

        for (uint256 i = 0; i < RATE_COUNT; i++) {
            uint256 sf = rates[i];
            // ceil(1e18 / sf) + 1 — exact truncation boundary for this rate
            uint256 threshold = (1e18 + sf - 1) / sf + 1;

            MockVulnerablePool pool = new MockVulnerablePool(threshold, threshold, sf);
            handlers[i] = new RoundTripHandler(pool, sf);

            bytes4[] memory selectors = new bytes4[](4);
            selectors[0] = RoundTripHandler.deposit.selector;
            selectors[1] = RoundTripHandler.swapGivenOut.selector;
            selectors[2] = RoundTripHandler.swapMicro.selector;
            selectors[3] = RoundTripHandler.swapMicro.selector;
            targetContract(address(handlers[i]));
            targetSelector(FuzzSelector({ addr: address(handlers[i]), selectors: selectors }));
        }
    }

    /// @notice Primary invariant across all six rate scenarios:
    /// total value extracted must never exceed total value deposited + paid in.
    function invariant_sweep_noRoundTripProfit() public view {
        for (uint256 i = 0; i < RATE_COUNT; i++) {
            assertLe(
                handlers[i].ghost_totalOut(),
                handlers[i].ghost_totalIn(),
                string.concat(
                    "ROUND_TRIP_PROFIT at rate index ",
                    vm.toString(i),
                    ": out=",
                    vm.toString(handlers[i].ghost_totalOut()),
                    " in=",
                    vm.toString(handlers[i].ghost_totalIn())
                )
            );
        }
    }

    /// @notice Secondary invariant: no swap may return amountIn=0 when amountOut>0.
    /// Directly fingerprints the Balancer rounding bug at every tested rate.
    function invariant_sweep_noFreeExtraction() public view {
        for (uint256 i = 0; i < RATE_COUNT; i++) {
            assertEq(
                handlers[i].ghost_freeSwaps(),
                0,
                string.concat(
                    "FREE_EXTRACTION at rate index ",
                    vm.toString(i),
                    ": ",
                    vm.toString(handlers[i].ghost_freeSwaps()),
                    " zero-cost swap(s)"
                )
            );
        }
    }
}

/// @notice Stateful invariant fuzzer for sequential cross-pool drain.
/// Models an attacker who drains pool 0 and re-deploys proceeds to drain pool 1.
/// Per-pool invariants cannot detect this: combined ghost accounting across both
/// pools reveals the total value leak.
contract MultiPoolInvariantTest is Test {
    MultiPoolHandler handler;

    function setUp() public {
        // Both pools seeded at the 1e12 attack boundary (8 wei < 1_000_001 threshold)
        MockVulnerablePool pool0 = new MockVulnerablePool(8, 8, 1e12);
        MockVulnerablePool pool1 = new MockVulnerablePool(8, 8, 1e12);
        handler = new MultiPoolHandler(pool0, pool1);

        targetContract(address(handler));

        // swapMicro weighted 4× — direct attack vector, fuzzer should hit it often
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = MultiPoolHandler.deposit.selector;
        selectors[1] = MultiPoolHandler.swapGivenOut.selector;
        selectors[2] = MultiPoolHandler.swapMicro.selector;
        selectors[3] = MultiPoolHandler.swapMicro.selector;
        selectors[4] = MultiPoolHandler.swapMicro.selector;
        selectors[5] = MultiPoolHandler.swapMicro.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
    }

    /// @notice Primary invariant: total value extracted across both pools must
    /// never exceed total value deposited + paid in.
    function invariant_multiPool_noRoundTripProfit() public view {
        assertLe(
            handler.ghost_totalOut(),
            handler.ghost_totalIn(),
            string.concat(
                "MULTI_POOL_PROFIT_DETECTED after ",
                vm.toString(handler.ghost_swapCount()),
                " swaps: out=",
                vm.toString(handler.ghost_totalOut()),
                " in=",
                vm.toString(handler.ghost_totalIn())
            )
        );
    }

    /// @notice Secondary invariant: no swap across either pool may return
    /// amountIn=0 when amountOut>0. Fingerprints the rounding bug in both pools.
    function invariant_multiPool_noFreeExtraction() public view {
        assertEq(
            handler.ghost_freeSwaps(),
            0,
            string.concat(
                "MULTI_POOL_FREE_EXTRACTION: ",
                vm.toString(handler.ghost_freeSwaps()),
                " zero-cost swap(s) across ",
                vm.toString(handler.ghost_swapCount()),
                " total"
            )
        );
    }
}
