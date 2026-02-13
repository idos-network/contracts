// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {IDOSToken} from "../contracts/IDOSToken.sol";
import {IDOSNodeStaking} from "../contracts/IDOSNodeStaking.sol";

/// @notice Deployment script for IDOSToken and IDOSNodeStaking.
/// @dev For chains 42161 (Arbitrum One) and 421614 (Arbitrum Sepolia), contracts are already
///      deployed. Addresses are in script/deployments.json (migrated from Hardhat Ignition).
contract DeployIDOSNodeStaking is Script {
    address constant ARB_ONE_TOKEN = 0x68731d6F14B827bBCfFbEBb62b19Daa18de1d79c;
    address constant ARB_ONE_STAKING = 0x6132F2EE66deC6bdf416BDA9588D663EaCeec337;
    address constant ARB_SEPOLIA_TOKEN = 0xdb3b7BB52dD6cfE1157022bde6dfc28D8101e180;
    address constant ARB_SEPOLIA_STAKING = 0xA07742fd930A8dF8dF35eE483aEe933545f84378;

    function run() external {
        uint256 chainId = block.chainid;

        // Skip deployment if already deployed (Arbitrum One or Arbitrum Sepolia)
        if (chainId == 42161) {
            console.log("Already deployed on Arbitrum One (chain 42161)");
            console.log("IDOSToken:", ARB_ONE_TOKEN);
            console.log("IDOSNodeStaking:", ARB_ONE_STAKING);
            return;
        }
        if (chainId == 421614) {
            console.log("Already deployed on Arbitrum Sepolia (chain 421614)");
            console.log("IDOSToken:", ARB_SEPOLIA_TOKEN);
            console.log("IDOSNodeStaking:", ARB_SEPOLIA_STAKING);
            return;
        }

        address initialOwner = vm.envAddress("INITIAL_OWNER");
        uint48 startTime = uint48(vm.envOr("START_TIME", block.timestamp));
        uint256 epochReward = vm.envOr("EPOCH_REWARD", uint256(0));

        vm.startBroadcast();

        IDOSToken idosToken = new IDOSToken(initialOwner);
        IDOSNodeStaking nodeStaking = new IDOSNodeStaking(
            address(idosToken),
            initialOwner,
            startTime,
            epochReward
        );

        vm.stopBroadcast();

        console.log("IDOSToken deployed at:", address(idosToken));
        console.log("IDOSNodeStaking deployed at:", address(nodeStaking));
    }
}
