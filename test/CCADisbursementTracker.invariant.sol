// SPDX-License-Identifier: MIT
// cSpell:words overdisbursement

pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {CCADisbursementTracker} from "../src/CCADisbursementTracker.sol";

contract DisbursementHandler is Test {
    CCADisbursementTracker public tracker;
    address public disburser_;
    address[] public recipients;

    uint256 public ghost_totalDisbursed;
    mapping(address => uint256) public ghost_disbursedTo;
    mapping(address => uint256) public ghost_originalMissing;

    constructor(CCADisbursementTracker tracker_, address disburser__, address[] memory recipients_) {
        tracker = tracker_;
        disburser_ = disburser__;
        recipients = recipients_;

        for (uint256 i; i < recipients_.length; i++) {
            ghost_originalMissing[recipients_[i]] = tracker.missingDisbursementTo(recipients_[i]);
        }
    }

    function recordDisbursement(uint256 recipientSeed, uint256 valueSeed, bytes32 txHash) external {
        address recipient = recipients[recipientSeed % recipients.length];
        uint256 available = tracker.missingDisbursementTo(recipient);
        if (available == 0) return;

        uint256 value = bound(valueSeed, 1, available);

        address[] memory r = new address[](1);
        uint256[] memory v = new uint256[](1);
        bytes32[] memory t = new bytes32[](1);
        r[0] = recipient;
        v[0] = value;
        t[0] = txHash;

        vm.prank(disburser_);
        tracker.recordDisbursements(r, v, t);

        ghost_totalDisbursed += value;
        ghost_disbursedTo[recipient] += value;
    }
}

contract CCADisbursementTrackerInvariantTest is Test {
    CCADisbursementTracker tracker;
    DisbursementHandler handler;

    address cca;
    address disburser_;
    address holder1;
    address holder2;
    address holder3;

    uint256 constant SUPPLY = 1_000_000 ether;
    uint256 totalOriginalMissing;

    function setUp() public {
        cca = makeAddr("cca");
        disburser_ = makeAddr("disburser");
        holder1 = makeAddr("holder1");
        holder2 = makeAddr("holder2");
        holder3 = makeAddr("holder3");

        tracker = new CCADisbursementTracker("Tracker", "TRK", SUPPLY, cca, disburser_);

        vm.startPrank(cca);
        tracker.transfer(holder1, SUPPLY * 40 / 100);
        tracker.transfer(holder2, SUPPLY * 35 / 100);
        tracker.transfer(holder3, SUPPLY * 25 / 100);
        vm.stopPrank();

        assertTrue(tracker.saleFullyClaimed());
        totalOriginalMissing = tracker.totalMissingDisbursements();
        assertEq(totalOriginalMissing, SUPPLY);

        address[] memory recipients = new address[](3);
        recipients[0] = holder1;
        recipients[1] = holder2;
        recipients[2] = holder3;

        handler = new DisbursementHandler(tracker, disburser_, recipients);
        targetContract(address(handler));
    }

    function invariant_AccountingSumMatchesTotal() public view {
        uint256 sum = tracker.missingDisbursementTo(holder1)
            + tracker.missingDisbursementTo(holder2)
            + tracker.missingDisbursementTo(holder3);
        assertEq(tracker.totalMissingDisbursements(), sum);
    }

    function invariant_NeverOverdisbursed() public view {
        assertLe(handler.ghost_disbursedTo(holder1), handler.ghost_originalMissing(holder1));
        assertLe(handler.ghost_disbursedTo(holder2), handler.ghost_originalMissing(holder2));
        assertLe(handler.ghost_disbursedTo(holder3), handler.ghost_originalMissing(holder3));
    }

    function invariant_MonotonicallyDecreasing() public view {
        assertLe(tracker.totalMissingDisbursements(), totalOriginalMissing);
    }

    function invariant_SupplyConservation() public view {
        assertEq(
            tracker.initialSupply(),
            tracker.totalSupply() + tracker.totalMissingDisbursements() + handler.ghost_totalDisbursed()
        );
    }
}
