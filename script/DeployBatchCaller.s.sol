// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {BatchCaller} from "../src/BatchCaller.sol";
import {RecordingDeployer} from "./RecordingDeployer.s.sol";

/// @notice Deployment script for BatchCaller.
contract DeployBatchCaller is RecordingDeployer {
    // forge-lint: disable-next-line(mixed-case-function): use the contract name as is.
    function deployBatchCaller() internal returns (BatchCaller) {
        address payable callerAddr =
            payable(getOrDeploy(block.chainid, "BatchCaller", "src/BatchCaller.sol:BatchCaller", ""));
        return BatchCaller(callerAddr);
    }

    function run() external virtual {
        _loadConfig("./deployments.toml", true);

        deployBatchCaller();
    }
}
