// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {CCADisbursementTracker} from "../src/CCADisbursementTracker.sol";
import {RecordingDeployer} from "./RecordingDeployer.s.sol";

/// @notice Deployment script for CCADisbursementTracker.
contract DeployCCADisbursementTracker is RecordingDeployer {
    function deployCCADisbursementTracker(
        string memory name,
        string memory symbol,
        uint256 initialSupply,
        address disburser
    ) internal returns (CCADisbursementTracker) {
        address payable trackerAddr = payable(getOrDeploy(
            block.chainid,
            "CCADisbursementTracker",
            "src/CCADisbursementTracker.sol:CCADisbursementTracker",
            abi.encode(name, symbol, initialSupply, disburser)
        ));
        return CCADisbursementTracker(trackerAddr);
    }

    function run() external virtual {
        _loadConfig("./deployments.toml", true);

        deployCCADisbursementTracker(
            vm.envOr("TRACKER_NAME", string("rIDOS")),
            vm.envOr("TRACKER_SYMBOL", string("rIDOS")),
            vm.envOr("TRACKER_INITIAL_SUPPLY", uint256(10_000_000 ether)),
            vm.envAddress("TRACKER_DISBURSER")
        );
    }
}
