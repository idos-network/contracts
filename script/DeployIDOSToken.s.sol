// SPDX-License-Identifier: MIT
// cSpell:words idOS
pragma solidity ^0.8.27;

import {IDOSToken} from "../src/IDOSToken.sol";
import {RecordingDeployer} from "./RecordingDeployer.s.sol";

/// @notice Deployment script for IDOSToken.
contract DeployIDOSToken is RecordingDeployer {
    // forge-lint: disable-next-line(mixed-case-function) -- IDOS is the token name
    function deployIDOSToken(address initialOwner) internal returns (IDOSToken) {
        address payable tokenAddr =
            payable(getOrDeploy(block.chainid, "IDOSToken", "src/IDOSToken.sol:IDOSToken", abi.encode(initialOwner)));
        return IDOSToken(tokenAddr);
    }

    function run() external virtual {
        _loadConfig("./deployments.toml", true);

        deployIDOSToken(vm.envAddress("INITIAL_OWNER"));
    }
}
