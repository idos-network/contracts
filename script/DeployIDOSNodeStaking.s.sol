// SPDX-License-Identifier: MIT
// cSpell:words idOS
pragma solidity ^0.8.27;

import {IDOSToken} from "../src/IDOSToken.sol";
import {DeployIDOSToken} from "./DeployIDOSToken.s.sol";

/// @notice Deployment script for IDOSToken and IDOSNodeStaking.
/// @dev Uses forge-std Config with deployments.toml for address lookup.
///      Skips deployment when addresses exist for this chain; writes new addresses after deploy.
contract DeployIDOSNodeStaking is DeployIDOSToken {
    // forge-lint: disable-next-line(mixed-case-function) -- IDOS is the token name
    function deployIDOSNodeStaking(IDOSToken idosToken, address initialOwner, uint48 startTime, uint256 epochReward)
        internal
        returns (address)
    {
        return getOrDeploy(
            block.chainid,
            "IDOSNodeStaking",
            "src/IDOSNodeStaking.sol:IDOSNodeStaking",
            abi.encode(idosToken, initialOwner, startTime, epochReward)
        );
    }

    function run() external override {
        _loadConfig("./deployments.toml", true);

        address initialOwner = vm.envAddress("INITIAL_OWNER");

        IDOSToken idosToken = deployIDOSToken(initialOwner);

        deployIDOSNodeStaking(
            idosToken,
            initialOwner,
            uint48(vm.envOr("START_TIME", uint256(block.timestamp))),
            vm.envOr("EPOCH_REWARD", uint256(0))
        );
    }
}
