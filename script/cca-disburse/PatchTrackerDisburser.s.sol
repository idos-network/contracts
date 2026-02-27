// SPDX-License-Identifier: MIT
// Deploys a CCADisbursementTracker with the same name/symbol/initialSupply as an existing
// tracker but a new disburser, then writes the deployed address to patch-tracker-address.txt.
// Used with a local Anvil fork so you can then anvil_setCode the tracker to this bytecode.
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {CCADisbursementTracker} from "../../src/CCADisbursementTracker.sol";

contract PatchTrackerDisburser is Script {
    function run() external {
        address trackerAddress = vm.envAddress("TRACKER_ADDRESS");
        address patchDisburser = vm.envAddress("PATCH_DISBURSER");

        CCADisbursementTracker tracker = CCADisbursementTracker(payable(trackerAddress));
        string memory name = tracker.name();
        string memory symbol = tracker.symbol();
        uint256 initialSupply = tracker.initialSupply();

        vm.startBroadcast();
        CCADisbursementTracker patch = new CCADisbursementTracker(name, symbol, initialSupply, patchDisburser);
        vm.stopBroadcast();

        vm.writeFile("patch-tracker-address.txt", vm.toString(address(patch)));
        console.log("Patch tracker deployed at: %s", address(patch));
    }
}
