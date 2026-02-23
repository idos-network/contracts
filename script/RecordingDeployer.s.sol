// SPDX-License-Identifier: MIT
// cSpell:words idOS
pragma solidity ^0.8.27;

import {Script, console} from "forge-std/Script.sol";
import {Config} from "forge-std/Config.sol";

/// @notice Base script that deploys contracts via `vm.deployCode` and records addresses in a TOML config.
/// @dev Subclasses call `getOrDeploy` to skip re-deploying contracts that already have an address on this chain.
contract RecordingDeployer is Script, Config {
    /// @dev Returns the contract address: from config if already deployed, otherwise deploys via vm.deployCode.
    function getOrDeploy(
        uint256 chainId,
        string memory contractName,
        string memory artifactPath,
        bytes memory constructorArgs
    ) internal returns (address addr) {
        if (config.exists(chainId, contractName)) {
            addr = config.get(chainId, contractName).toAddress();
        }

        if (addr != address(0)) {
            console.log("%s present on chain %s at %s", contractName, chainId, addr);
            return addr;
        }

        vm.startBroadcast();
        addr = vm.deployCode(artifactPath, constructorArgs);
        if (chainId != 31337 && chainId != 421614) config.set(chainId, contractName, addr);
        vm.stopBroadcast();

        console.log("%s deployed on chain %s at %s", contractName, chainId, addr);
    }
}
