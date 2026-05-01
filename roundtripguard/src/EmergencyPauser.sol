// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IPausablePool {
    function pause() external;
}

/// @title EmergencyPauser
/// @notice Holds pause() authority over registered pools. Triggered by any
/// whitelisted keeper reacting to a CircuitBreakerTripped event from
/// InvariantMonitor, or directly by the guardian multisig.
///
/// @dev Keeper whitelist replaces a single keeper EOA to eliminate the
/// single-point-of-failure risk. The guardian can add or remove keepers
/// at any time. The monitor itself needs zero privileged access — this
/// separation minimises the attack surface of the monitoring system.
contract EmergencyPauser {

    // -------------------------------------------------------
    // State
    // -------------------------------------------------------

    /// @notice Guardian multisig — can always pause and manage keepers.
    address public immutable guardian;

    /// @notice Whitelisted keeper EOAs — any may call pause().
    mapping(address => bool) public keepers;

    /// @notice Pool address indexed by poolId.
    mapping(bytes32 => address) public registeredPools;

    // -------------------------------------------------------
    // Events
    // -------------------------------------------------------

    /// @notice Emitted when a pool is paused.
    event PoolPaused(bytes32 indexed poolId, address indexed caller);

    /// @notice Emitted when a pool is registered.
    event PoolRegistered(bytes32 indexed poolId, address poolAddress);

    /// @notice Emitted when a keeper is added to the whitelist.
    event KeeperAdded(address indexed keeper);

    /// @notice Emitted when a keeper is removed from the whitelist.
    event KeeperRemoved(address indexed keeper);

    // -------------------------------------------------------
    // Constructor
    // -------------------------------------------------------

    /// @notice Deploy the pauser.
    /// @param _guardian      Multisig with permanent pause and keeper-management rights.
    /// @param _initialKeeper First keeper EOA to whitelist (address(0) to skip).
    constructor(address _guardian, address _initialKeeper) {
        guardian = _guardian;
        if (_initialKeeper != address(0)) {
            keepers[_initialKeeper] = true;
            emit KeeperAdded(_initialKeeper);
        }
    }

    // -------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------

    modifier onlyGuardian() {
        require(msg.sender == guardian, "GUARDIAN_ONLY");
        _;
    }

    modifier onlyAuthorized() {
        require(keepers[msg.sender] || msg.sender == guardian, "UNAUTHORIZED");
        _;
    }

    // -------------------------------------------------------
    // Keeper management (guardian-only)
    // -------------------------------------------------------

    /// @notice Add an address to the keeper whitelist.
    /// @param keeper Address to whitelist.
    function addKeeper(address keeper) external onlyGuardian {
        keepers[keeper] = true;
        emit KeeperAdded(keeper);
    }

    /// @notice Remove an address from the keeper whitelist.
    /// @param keeper Address to remove.
    function removeKeeper(address keeper) external onlyGuardian {
        keepers[keeper] = false;
        emit KeeperRemoved(keeper);
    }

    // -------------------------------------------------------
    // Pool management
    // -------------------------------------------------------

    /// @notice Register a pool so it can be paused by poolId.
    /// @param poolId      Unique pool identifier.
    /// @param poolAddress Address of the pausable pool contract.
    function registerPool(bytes32 poolId, address poolAddress) external onlyGuardian {
        registeredPools[poolId] = poolAddress;
        emit PoolRegistered(poolId, poolAddress);
    }

    /// @notice Pause a registered pool. Called by any whitelisted keeper or the guardian.
    /// @param poolId  Identifier of the pool to pause.
    function pause(bytes32 poolId) external onlyAuthorized {
        address poolAddress = registeredPools[poolId];
        require(poolAddress != address(0), "POOL_NOT_REGISTERED");
        IPausablePool(poolAddress).pause();
        emit PoolPaused(poolId, msg.sender);
    }
}
