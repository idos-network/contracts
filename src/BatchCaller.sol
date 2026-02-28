// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

/// @notice EIP-7702 delegation target that batches arbitrary calls from the
///         delegating EOA. `execute` requires `msg.sender == address(this)`,
///         meaning only the EOA itself can call it (since, under EIP-7702,
///         `address(this)` resolves to the delegating EOA). This prevents
///         third parties from using the delegation to make the EOA perform
///         unintended actions.
contract BatchCaller {
    struct Call {
        address target;
        bytes data;
    }

    error OnlyCallableBySelf();
    error CallFailed(uint256 index, bytes returnData);

    function execute(Call[] calldata calls) external {
        if (msg.sender != address(this)) revert OnlyCallableBySelf();

        for (uint256 i = 0; i < calls.length; i++) {
            (bool success, bytes memory returnData) = calls[i].target.call(calls[i].data);
            if (!success) revert CallFailed(i, returnData);
        }
    }
}
