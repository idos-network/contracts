// SPDX-License-Identifier: MIT
// cSpell:words idOS
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {Config} from "forge-std/Config.sol";
import {IDOSToken} from "../src/IDOSToken.sol";
import {IDOSNodeStaking} from "../src/IDOSNodeStaking.sol";

/// @notice Deployment script for IDOSToken and IDOSNodeStaking.
/// @dev Uses forge-std Config with deployments.toml for address lookup.
///      Skips deployment when addresses exist for this chain; writes new addresses after deploy.
contract DeployIDOSNodeStaking is Script, Config {
    function run() external {
        _loadConfig("./deployments.toml", true);
        uint256 chainId = block.chainid;
        address initialOwner = vm.envAddress("INITIAL_OWNER");

        address payable tokenAddr =
            payable(_getOrDeploy(chainId, "IDOSToken", "src/IDOSToken.sol:IDOSToken", abi.encode(initialOwner)));
        IDOSToken idosToken = IDOSToken(tokenAddr);

        _getOrDeploy(
            chainId,
            "IDOSNodeStaking",
            "src/IDOSNodeStaking.sol:IDOSNodeStaking",
            abi.encode(
                idosToken,
                initialOwner,
                uint48(vm.envOr("START_TIME", uint256(block.timestamp))),
                uint256(vm.envOr("EPOCH_REWARD", uint256(0)))
            )
        );
    }

    /// @dev Returns the contract address: from config if already deployed, otherwise deploys via vm.deployCode.
    function _getOrDeploy(
        uint256 chainId,
        string memory configKey,
        string memory artifactPath,
        bytes memory constructorArgs
    ) internal returns (address addr) {
        if (config.exists(chainId, configKey)) {
            addr = config.get(chainId, configKey).toAddress();
        }

        if (addr != address(0)) {
            console.log("%s present on chain %s at %s", configKey, chainId, addr);
            return addr;
        }

        vm.startBroadcast();
        addr = vm.deployCode(artifactPath, constructorArgs);
        if (chainId != 31337) config.set(chainId, configKey, addr);
        vm.stopBroadcast();

        console.log("%s deployed on chain %s at %s", configKey, chainId, addr);
    }
}
