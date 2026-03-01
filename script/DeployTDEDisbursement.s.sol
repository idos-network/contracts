// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {TDEDisbursement} from "../src/TDEDisbursement.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RecordingDeployer} from "./RecordingDeployer.s.sol";

/// @notice Deployment script for TDEDisbursement.
contract DeployTDEDisbursement is RecordingDeployer {
    // forge-lint: disable-next-line(mixed-case-function): use the contract name as is.
    function deployTDEDisbursement(IERC20 idosToken, address disburser) internal returns (TDEDisbursement) {
        address payable disbursementAddr = payable(getOrDeploy(
                block.chainid,
                "TDEDisbursement",
                "src/TDEDisbursement.sol:TDEDisbursement",
                abi.encode(idosToken, disburser)
            ));
        return TDEDisbursement(disbursementAddr);
    }

    function run() external virtual {
        _loadConfig("./deployments.toml", true);

        IERC20 idosToken = IERC20(config.get(block.chainid, "IDOSToken").toAddress());
        deployTDEDisbursement(idosToken, vm.envAddress("DISBURSER_ADDRESS"));
    }
}
