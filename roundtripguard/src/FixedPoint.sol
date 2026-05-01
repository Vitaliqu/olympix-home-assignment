// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal fixed-point math library mirroring Balancer's FixedPoint.sol
/// All operations use 1e18 as ONE. mulDown/divDown round toward zero (floor).
/// mulUp/divUp round away from zero (ceil).
library FixedPoint {
    uint256 internal constant ONE = 1e18;

    function mulDown(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a * b) / ONE;
    }

    function mulUp(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 product = a * b;
        return product == 0 ? 0 : (product - 1) / ONE + 1;
    }

    function divDown(uint256 a, uint256 b) internal pure returns (uint256) {
        return (a * ONE) / b;
    }

    function divUp(uint256 a, uint256 b) internal pure returns (uint256) {
        uint256 aInflated = a * ONE;
        return aInflated == 0 ? 0 : (aInflated - 1) / b + 1;
    }
}
