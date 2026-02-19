// SPDX-License-Identifier: MIT
// cSpell:words overdisbursement

pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {CCADisbursementTracker} from "../src/CCADisbursementTracker.sol";

contract DisbursementHandler is Test {
    CCADisbursementTracker public tracker;
    address public disburser;
    address[] public recipients;

    uint256 public ghostTotalDisbursed;
    mapping(address => uint256) public ghostDisbursedTo;
    mapping(address => uint256) public ghostOriginalMissing;

    constructor(CCADisbursementTracker tracker_, address disburser_, address[] memory recipients_) {
        tracker = tracker_;
        disburser = disburser_;
        recipients = recipients_;

        for (uint256 i; i < recipients_.length; i++) {
            ghostOriginalMissing[recipients_[i]] = tracker.missingDisbursementTo(recipients_[i]);
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

        vm.prank(disburser);
        tracker.recordDisbursements(r, v, t);

        ghostTotalDisbursed += value;
        ghostDisbursedTo[recipient] += value;
    }
}

contract CCADisbursementTrackerInvariantTest is Test {
    CCADisbursementTracker tracker;
    DisbursementHandler handler;

    address cca;
    address disburser;
    address holder1;
    address holder2;
    address holder3;

    uint256 constant SUPPLY = 1_000_000 ether;
    uint256 totalOriginalMissing;

    function setUp() public {
        cca = makeAddr("cca");
        disburser = makeAddr("disburser");
        holder1 = makeAddr("holder1");
        holder2 = makeAddr("holder2");
        holder3 = makeAddr("holder3");

        tracker = new CCADisbursementTracker("Tracker", "TRK", SUPPLY, disburser);
        tracker.initialize(cca);

        vm.startPrank(cca);
        assertTrue(tracker.transfer(holder1, SUPPLY * 40 / 100));
        assertTrue(tracker.transfer(holder2, SUPPLY * 35 / 100));
        assertTrue(tracker.transfer(holder3, SUPPLY * 25 / 100));
        vm.stopPrank();

        assertTrue(tracker.saleFullyClaimed());
        totalOriginalMissing = tracker.totalMissingDisbursements();
        assertEq(totalOriginalMissing, SUPPLY);

        address[] memory recipients = new address[](3);
        recipients[0] = holder1;
        recipients[1] = holder2;
        recipients[2] = holder3;

        handler = new DisbursementHandler(tracker, disburser, recipients);
        targetContract(address(handler));
    }

    function invariant_AccountingSumMatchesTotal() public view {
        uint256 sum = tracker.missingDisbursementTo(holder1)
            + tracker.missingDisbursementTo(holder2)
            + tracker.missingDisbursementTo(holder3);
        assertEq(tracker.totalMissingDisbursements(), sum);
    }

    function invariant_NeverOverdisbursed() public view {
        assertLe(handler.ghostDisbursedTo(holder1), handler.ghostOriginalMissing(holder1));
        assertLe(handler.ghostDisbursedTo(holder2), handler.ghostOriginalMissing(holder2));
        assertLe(handler.ghostDisbursedTo(holder3), handler.ghostOriginalMissing(holder3));
    }

    function invariant_MonotonicallyDecreasing() public view {
        assertLe(tracker.totalMissingDisbursements(), totalOriginalMissing);
    }

    function invariant_SupplyConservation() public view {
        assertEq(
            tracker.initialSupply(),
            tracker.totalSupply() + tracker.totalMissingDisbursements() + handler.ghostTotalDisbursed()
        );
    }
}
