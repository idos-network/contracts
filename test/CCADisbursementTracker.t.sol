// SPDX-License-Identifier: MIT
// cSpell:words overdisbursement

pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {CCADisbursementTracker, MAX_ALLOWABLE_DUST_WEI} from "../src/CCADisbursementTracker.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import {ContinuousClearingAuction} from "continuous-clearing-auction/ContinuousClearingAuction.sol";
import {AuctionParameters} from "continuous-clearing-auction/interfaces/IContinuousClearingAuction.sol";
import {ConstantsLib} from "continuous-clearing-auction/libraries/ConstantsLib.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {FixedPoint96} from "continuous-clearing-auction/libraries/FixedPoint96.sol";

contract TestERC20 is ERC20 {
    constructor() ERC20("Test Currency", "TCUR") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract CCADisbursementTrackerUnitTest is Test {
    CCADisbursementTracker tracker;

    address cca;
    address disburser_;
    address holder1;
    address holder2;
    address nobody;

    uint256 constant SUPPLY = 1_000_000 ether;

    function setUp() public {
        cca = makeAddr("cca");
        disburser_ = makeAddr("disburser");
        holder1 = makeAddr("holder1");
        holder2 = makeAddr("holder2");
        nobody = makeAddr("nobody");

        tracker = new CCADisbursementTracker("Tracker", "TRK", SUPPLY, disburser_);
        tracker.initialize(cca);
    }

    // --- Constructor ---

    function test_Constructor_SetsState() public view {
        assertEq(tracker.ccaContract(), cca);
        assertEq(tracker.disburser(), disburser_);
        assertEq(tracker.initialSupply(), SUPPLY);
        assertEq(tracker.totalSupply(), SUPPLY);
        assertEq(tracker.balanceOf(cca), SUPPLY);
        assertFalse(tracker.saleFullyClaimed());
        assertFalse(tracker.saleFullyDisbursed());
    }

    function test_Constructor_RevertsOnZeroSupply() public {
        vm.expectRevert(CCADisbursementTracker.NoInitialSupply.selector);
        new CCADisbursementTracker("T", "T", 0, disburser_);
    }

    function test_Constructor_RevertsOnZeroDisburser() public {
        vm.expectRevert(CCADisbursementTracker.ZeroAddressDisburser.selector);
        new CCADisbursementTracker("T", "T", SUPPLY, address(0));
    }

    // --- Initialize ---

    function test_Initialize_RevertsOnZeroCCA() public {
        CCADisbursementTracker t = new CCADisbursementTracker("T", "T", SUPPLY, disburser_);
        vm.expectRevert(CCADisbursementTracker.ZeroAddressCCAContract.selector);
        t.initialize(address(0));
    }

    function test_Initialize_RevertsIfCalledTwice() public {
        CCADisbursementTracker t = new CCADisbursementTracker("T", "T", SUPPLY, disburser_);
        t.initialize(cca);
        vm.expectRevert(CCADisbursementTracker.AlreadyInitialized.selector);
        t.initialize(cca);
    }

    function test_Initialize_RevertsIfNotDeployer() public {
        CCADisbursementTracker t = new CCADisbursementTracker("T", "T", SUPPLY, disburser_);
        vm.prank(nobody);
        vm.expectRevert(CCADisbursementTracker.OnlyDeployerCanInitialize.selector);
        t.initialize(cca);
    }

    // --- Transfer Restrictions ---

    function test_Update_TransferBetweenNonCCAReverts() public {
        vm.prank(holder1);
        vm.expectRevert(CCADisbursementTracker.TokenIsUntransferable.selector);
        assertFalse(tracker.transfer(holder2, 1));
    }

    function test_Update_CCA_SelfTransferReverts() public {
        vm.prank(cca);
        vm.expectRevert(CCADisbursementTracker.CCASelfTransferNotAllowed.selector);
        assertFalse(tracker.transfer(cca, 1));
    }

    function test_Update_CCA_TransferToZeroHitsOZGuard() public {
        // OZ ERC20._transfer reverts before reaching _update when `to` is address(0).
        // SimpleBurnsNotAllowed guards against direct _update(cca, address(0), ...) calls,
        // which would be reachable via _burn() if the contract were extended.
        vm.prank(cca);
        vm.expectRevert(abi.encodeWithSignature("ERC20InvalidReceiver(address)", address(0)));
        assertFalse(tracker.transfer(address(0), 1));
    }

    function test_Update_CCA_TransferFromByApproved_BurnsAndRecords() public {
        // transferFrom by an approved spender from the CCA is equivalent to a CCA transfer:
        // tokens get burned and missing disbursement is recorded.
        vm.prank(cca);
        tracker.approve(holder1, 100);

        vm.prank(holder1);
        assertTrue(tracker.transferFrom(cca, holder1, 100));

        assertEq(tracker.balanceOf(cca), SUPPLY - 100);
        assertEq(tracker.missingDisbursementTo(holder1), 100);
    }

    // --- CCA Transfer -> Missing Disbursements ---

    function _ccaTransfer(address to, uint256 amount) internal {
        vm.prank(cca);

        assertTrue(tracker.transfer(to, amount));
    }

    function test_CCATransfer_BurnsAndRecordsMissingDisbursement() public {
        assertEq(tracker.balanceOf(cca), SUPPLY);
        assertEq(tracker.balanceOf(holder1), 0);

        uint256 amount = 1000;
        _ccaTransfer(holder1, amount);

        assertEq(tracker.balanceOf(cca), SUPPLY - amount);
        assertEq(tracker.balanceOf(holder1), 0);
        assertEq(tracker.totalSupply(), SUPPLY - amount);
        assertEq(tracker.missingDisbursementTo(holder1), amount);
        assertEq(tracker.totalMissingDisbursements(), amount);
    }

    function test_CCATransfer_EmitsMissingDisbursementEvent() public {
        vm.expectEmit();
        emit CCADisbursementTracker.MissingDisbursementRecorded(holder1, 500);
        _ccaTransfer(holder1, 500);
    }

    function test_CCATransfer_AccumulatesForSameHolder() public {
        _ccaTransfer(holder1, 300);
        _ccaTransfer(holder1, 700);

        assertEq(tracker.missingDisbursementTo(holder1), 1000);
        assertEq(tracker.totalMissingDisbursements(), 1000);
    }

    function test_CCATransfer_TracksMultipleHolders() public {
        _ccaTransfer(holder1, 400);
        _ccaTransfer(holder2, 600);

        assertEq(tracker.missingDisbursementTo(holder1), 400);
        assertEq(tracker.missingDisbursementTo(holder2), 600);
        assertEq(tracker.totalMissingDisbursements(), 1000);
    }

    function test_CCATransfer_FullSupplyBurnCompletesSale() public {
        _ccaTransfer(holder1, SUPPLY);

        assertTrue(tracker.saleFullyClaimed());
        assertFalse(tracker.saleFullyDisbursed());
        assertEq(tracker.totalSupply(), 0);
    }

    // --- recordDisbursement Guards ---
    function _completeSale() internal {
        _ccaTransfer(holder1, SUPPLY / 2);
        _ccaTransfer(holder2, SUPPLY / 2);
    }

    function _recordSingle(address to, uint256 value, bytes32 txHash) internal {
        vm.prank(disburser_);
        tracker.recordDisbursement(to, value, txHash);
    }

    function test_RecordDisbursement_RevertsIfSaleNotFullyClaimed() public {
        _ccaTransfer(holder1, SUPPLY / 2);

        vm.expectRevert(CCADisbursementTracker.SaleNotFullyClaimed.selector);
        _recordSingle(holder1, 1, bytes32(uint256(1)));
    }

    function test_RecordDisbursement_RevertsIfNotDisburser() public {
        _completeSale();

        vm.prank(nobody);
        vm.expectRevert(CCADisbursementTracker.OnlyDisburserCanRecordDisbursements.selector);
        tracker.recordDisbursement(holder1, 1, bytes32(uint256(1)));
    }

    function test_RecordDisbursement_RevertsOnZeroAddress() public {
        _completeSale();

        vm.expectRevert(CCADisbursementTracker.NoZeroAddressRecipientAllowed.selector);
        _recordSingle(address(0), 1, bytes32(uint256(1)));
    }

    function test_RecordDisbursement_RevertsOnZeroAmount() public {
        _completeSale();

        vm.expectRevert(CCADisbursementTracker.NoZeroDisbursementsAllowed.selector);
        _recordSingle(holder1, 0, bytes32(uint256(1)));
    }

    function test_RecordDisbursement_RevertsOnOverdisbursement() public {
        _completeSale();

        vm.expectRevert(CCADisbursementTracker.OverdisbursementDetected.selector);
        _recordSingle(holder1, SUPPLY / 2 + 1, bytes32(uint256(1)));
    }

    function test_RecordDisbursement_RevertsOnOverdisbursementByOneWei() public {
        _completeSale();
        _recordSingle(holder1, SUPPLY / 2, bytes32(uint256(1)));

        vm.expectRevert(CCADisbursementTracker.OverdisbursementDetected.selector);
        _recordSingle(holder1, 1, bytes32(uint256(2)));
    }

    function test_RecordDisbursement_RevertsForAccountWithNoMissing() public {
        _completeSale();

        vm.expectRevert(CCADisbursementTracker.OverdisbursementDetected.selector);
        _recordSingle(nobody, 1, bytes32(uint256(1)));
    }

    // --- recordDisbursement Happy Path ---

    function test_RecordDisbursement_ReducesMissingDisbursements() public {
        _completeSale();
        uint256 half = SUPPLY / 2;
        uint256 quarter = SUPPLY / 4;

        _recordSingle(holder1, quarter, bytes32(uint256(1)));
        assertEq(tracker.missingDisbursementTo(holder1), half - quarter);
        assertEq(tracker.totalMissingDisbursements(), SUPPLY - quarter);
    }

    function test_RecordDisbursement_FullDisbursementZerosOut() public {
        _completeSale();
        uint256 half = SUPPLY / 2;

        _recordSingle(holder1, half, bytes32(uint256(1)));
        assertEq(tracker.missingDisbursementTo(holder1), 0);
        assertFalse(tracker.saleFullyDisbursed());

        _recordSingle(holder2, half, bytes32(uint256(2)));
        assertEq(tracker.missingDisbursementTo(holder2), 0);
        assertEq(tracker.totalMissingDisbursements(), 0);
        assertTrue(tracker.saleFullyDisbursed());
    }

    function test_RecordDisbursement_MultipleTranches() public {
        _completeSale();
        uint256 half = SUPPLY / 2;

        _recordSingle(holder1, half / 4, bytes32(uint256(1)));
        _recordSingle(holder1, half / 4, bytes32(uint256(2)));
        _recordSingle(holder1, half / 4, bytes32(uint256(3)));
        _recordSingle(holder1, half / 4, bytes32(uint256(4)));

        assertEq(tracker.missingDisbursementTo(holder1), 0);
        assertEq(tracker.disbursementsToCount(holder1), 4);
    }

    function test_RecordDisbursement_EmitsEvent() public {
        _completeSale();
        bytes32 txHash = bytes32(uint256(42));

        vm.expectEmit();
        emit CCADisbursementTracker.DisbursementCompleted(holder1, 100, txHash);
        _recordSingle(holder1, 100, txHash);
    }

    function test_RecordDisbursement_MultipleRecipients() public {
        _completeSale();
        uint256 half = SUPPLY / 2;

        _recordSingle(holder1, half, bytes32(uint256(1)));
        _recordSingle(holder2, half, bytes32(uint256(2)));

        assertEq(tracker.totalMissingDisbursements(), 0);
        assertTrue(tracker.saleFullyDisbursed());
    }

    // --- disbursementsTo / disbursementsToRange ---

    function test_DisbursementsTo_ReturnsAll() public {
        _completeSale();
        _recordSingle(holder1, 100, bytes32(uint256(1)));
        _recordSingle(holder1, 200, bytes32(uint256(2)));

        CCADisbursementTracker.Disbursement[] memory d = tracker.disbursementsTo(holder1);
        assertEq(d.length, 2);
        assertEq(d[0].value, 100);
        assertEq(d[0].txHash, bytes32(uint256(1)));
        assertEq(d[1].value, 200);
        assertEq(d[1].txHash, bytes32(uint256(2)));
    }

    function test_DisbursementsToRange_OffsetPastEnd() public {
        _completeSale();
        _recordSingle(holder1, 100, bytes32(uint256(1)));

        CCADisbursementTracker.Disbursement[] memory d = tracker.disbursementsToRange(holder1, 5, 3);
        assertEq(d.length, 0);
    }

    function test_DisbursementsToRange_CountExceedsLength() public {
        _completeSale();
        _recordSingle(holder1, 100, bytes32(uint256(1)));
        _recordSingle(holder1, 200, bytes32(uint256(2)));

        CCADisbursementTracker.Disbursement[] memory d = tracker.disbursementsToRange(holder1, 0, 100);
        assertEq(d.length, 2);
    }

    function test_DisbursementsToRange_Pagination() public {
        _completeSale();
        uint256 half = SUPPLY / 2;
        uint256 perRecord = half / 5;

        for (uint256 i; i < 5; i++) {
            _recordSingle(holder1, perRecord, bytes32(i + 1));
        }

        CCADisbursementTracker.Disbursement[] memory page1 = tracker.disbursementsToRange(holder1, 0, 2);
        assertEq(page1.length, 2);
        assertEq(page1[0].value, perRecord);
        assertEq(page1[1].value, perRecord);

        CCADisbursementTracker.Disbursement[] memory page2 = tracker.disbursementsToRange(holder1, 2, 2);
        assertEq(page2.length, 2);

        CCADisbursementTracker.Disbursement[] memory page3 = tracker.disbursementsToRange(holder1, 4, 2);
        assertEq(page3.length, 1);
    }

    function test_DisbursementsToRange_EmptyAccount() public view {
        CCADisbursementTracker.Disbursement[] memory d = tracker.disbursementsToRange(holder1, 0, 10);
        assertEq(d.length, 0);
    }

    // --- ETH rejection ---

    function test_Receive_Reverts() public {
        vm.deal(nobody, 1 ether);
        vm.prank(nobody);
        (bool ok,) = address(tracker).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_Fallback_Reverts() public {
        vm.deal(nobody, 1 ether);
        vm.prank(nobody);
        (bool ok,) = address(tracker).call{value: 1 ether}(hex"deadbeef");
        assertFalse(ok);
    }

    function test_Fallback_RevertsWithoutValue() public {
        vm.prank(nobody);
        (bool ok,) = address(tracker).call(hex"deadbeef");
        assertFalse(ok);
    }
}

contract CCADisbursementTrackerIntegrationTest is Test {
    CCADisbursementTracker tracker;
    ContinuousClearingAuction auction;

    address disburser_;
    address tokensRecipient;
    address fundsRecipient;
    address bidder1;
    address bidder2;
    address bidder3;

    uint128 constant TOKEN_SUPPLY = 1_000 ether;
    // Q96-scaled prices, matching CCA's own test conventions.
    uint256 constant Q96 = 2 ** 96;
    uint256 constant TICK_SPACING = 100 * Q96;
    uint256 constant FLOOR_PRICE = 10 * TICK_SPACING;
    uint128 constant REQUIRED_RAISE = 1 ether;

    uint64 startBlock;
    uint64 endBlock;
    uint64 claimBlock;

    function _buildStepsData(uint24 auctionLength) internal pure returns (bytes memory) {
        uint24 mpsPerBlock = uint24(ConstantsLib.MPS / auctionLength);
        return abi.encodePacked(mpsPerBlock, uint40(auctionLength));
    }

    function _deployAuction(
        address token_,
        uint128 supply_,
        uint64 start_,
        uint64 end_,
        uint64 claim_,
        uint128 requiredRaise_,
        bytes memory stepsData_
    ) internal returns (ContinuousClearingAuction) {
        AuctionParameters memory params = AuctionParameters({
            currency: address(0),
            tokensRecipient: tokensRecipient,
            fundsRecipient: fundsRecipient,
            startBlock: start_,
            endBlock: end_,
            claimBlock: claim_,
            tickSpacing: TICK_SPACING,
            validationHook: address(0),
            floorPrice: FLOOR_PRICE,
            requiredCurrencyRaised: requiredRaise_,
            auctionStepsData: stepsData_
        });
        return new ContinuousClearingAuction(token_, supply_, params);
    }

    function setUp() public {
        disburser_ = makeAddr("disburser");
        tokensRecipient = makeAddr("tokensRecipient");
        fundsRecipient = makeAddr("fundsRecipient");
        bidder1 = makeAddr("bidder1");
        bidder2 = makeAddr("bidder2");
        bidder3 = makeAddr("bidder3");

        startBlock = uint64(block.number + 10);
        uint24 auctionLength = 100;
        endBlock = startBlock + uint64(auctionLength);
        claimBlock = endBlock + 10;

        bytes memory stepsData = _buildStepsData(auctionLength);

        tracker = new CCADisbursementTracker(
            "CCA Tracker", "CCAT", TOKEN_SUPPLY, disburser_
        );

        auction = _deployAuction(
            address(tracker), TOKEN_SUPPLY,
            startBlock, endBlock, claimBlock,
            REQUIRED_RAISE, stepsData
        );

        tracker.initialize(address(auction));
        auction.onTokensReceived();

        vm.deal(bidder1, 100_000 ether);
        vm.deal(bidder2, 100_000 ether);
        vm.deal(bidder3, 100_000 ether);
    }

    function _submitBid(address bidder, uint256 maxPrice, uint128 amount) internal returns (uint256) {
        vm.prank(bidder);
        return auction.submitBid{value: amount}(maxPrice, amount, bidder, FLOOR_PRICE, "");
    }

    function _exitBid(uint256 bidId) internal {
        auction.exitBid(bidId);
    }

    // --- Scenario 1: Graduated auction, full claim, then disburse ---

    function test_Integration_GraduatedAuction_FullLifecycle() public {
        vm.roll(startBlock);
        uint256 bidPrice = FLOOR_PRICE + TICK_SPACING;
        uint256 bid1Id = _submitBid(bidder1, bidPrice, 1_000 ether);
        vm.roll(block.number + 5);
        uint256 bid2Id = _submitBid(bidder2, bidPrice, 500 ether);

        // Exit bids and checkpoint.
        vm.roll(endBlock);
        auction.checkpoint();
        _exitBid(bid1Id);
        _exitBid(bid2Id);

        // Claim tokens and sweep.
        vm.roll(claimBlock);
        uint256 expectedBidder1Tokens = 1 ether;
        uint256 expectedBidder2Tokens = 0.5 ether;
        uint256 expectedSweepTokens = TOKEN_SUPPLY - expectedBidder1Tokens - expectedBidder2Tokens;

        assertFalse(tracker.saleFullyClaimed());
        assertFalse(tracker.saleFullyDisbursed());
        assertEq(tracker.totalMissingDisbursements(), 0);

        auction.claimTokens(bid1Id);
        assertEq(tracker.missingDisbursementTo(bidder1), expectedBidder1Tokens);

        auction.claimTokens(bid2Id);
        assertEq(tracker.missingDisbursementTo(bidder2), expectedBidder2Tokens);

        auction.sweepUnsoldTokens();
        assertEq(tracker.missingDisbursementTo(tokensRecipient), expectedSweepTokens);

        assertTrue(tracker.saleFullyClaimed());
        assertFalse(tracker.saleFullyDisbursed());
        assertEq(tracker.totalMissingDisbursements(), TOKEN_SUPPLY);

        // Record disbursements.
        _recordSingle(bidder1, expectedBidder1Tokens, bytes32(uint256(0xaa)));
        _recordSingle(bidder2, expectedBidder2Tokens, bytes32(uint256(0xbb)));
        _recordSingle(tokensRecipient, expectedSweepTokens, bytes32(uint256(0xcc)));

        // Confirm tracker is empty.
        assertEq(tracker.missingDisbursementTo(bidder1), 0);
        assertEq(tracker.missingDisbursementTo(bidder2), 0);
        assertEq(tracker.missingDisbursementTo(tokensRecipient), 0);
        assertEq(tracker.totalMissingDisbursements(), 0);
        assertTrue(tracker.saleFullyDisbursed());
    }

    // --- Scenario 2: Non-graduated auction (all refunded) ---

    function test_Integration_NonGraduatedAuction() public {
        vm.roll(startBlock);
        vm.deal(bidder1, 100 ether);
        vm.prank(bidder1);
        uint256 bidId = auction.submitBid{value: 0.5 ether}(FLOOR_PRICE + TICK_SPACING, 0.5 ether, bidder1, FLOOR_PRICE, "");

        vm.roll(endBlock);
        auction.exitBid(bidId);
        auction.sweepUnsoldTokens();

        assertTrue(tracker.saleFullyClaimed());
        assertEq(tracker.missingDisbursementTo(tokensRecipient), TOKEN_SUPPLY);

        _recordSingle(tokensRecipient, TOKEN_SUPPLY, bytes32(uint256(0xff)));

        assertTrue(tracker.saleFullyDisbursed());
    }

    // --- Scenario 3: Batch claim ---

    function test_Integration_BatchClaim() public {
        vm.roll(startBlock);
        uint256 bidPrice = FLOOR_PRICE + TICK_SPACING;
        uint256 bid1 = _submitBid(bidder1, bidPrice, 200 ether);
        uint256 bid2 = _submitBid(bidder1, bidPrice + TICK_SPACING, 100 ether);

        vm.roll(endBlock);
        auction.checkpoint();
        _exitBid(bid1);
        _exitBid(bid2);

        vm.roll(claimBlock);
        uint256[] memory bidIds = new uint256[](2);
        (bidIds[0], bidIds[1]) = (bid1, bid2);
        auction.claimTokensBatch(bidder1, bidIds);

        assertEq(tracker.missingDisbursementTo(bidder1), 0.3 ether);
    }

    // --- Scenario 4: Partial disbursements in tranches ---

    function test_Integration_PartialDisbursementsInTranches() public {
        vm.roll(startBlock);
        uint256 bidPrice = FLOOR_PRICE + TICK_SPACING;
        uint256 bid1Id = _submitBid(bidder1, bidPrice, 1_000 ether);

        vm.roll(endBlock);
        auction.checkpoint();
        _exitBid(bid1Id);

        vm.roll(claimBlock);
        auction.claimTokens(bid1Id);
        auction.sweepUnsoldTokens();
        assertTrue(tracker.saleFullyClaimed());

        uint256 totalMissing1 = tracker.missingDisbursementTo(bidder1);
        assertEq(totalMissing1, 1 ether);

        uint256 tranche1 = totalMissing1 / 3;
        uint256 tranche2 = totalMissing1 / 3;
        uint256 tranche3 = totalMissing1 - tranche1 - tranche2;

        assertEq(tracker.missingDisbursementTo(bidder1), tranche1 + tranche2 + tranche3);

        _recordSingle(bidder1, tranche1, bytes32(uint256(1)));
        assertEq(tracker.missingDisbursementTo(bidder1), tranche2 + tranche3);
        assertEq(tracker.disbursementsToCount(bidder1), 1);

        _recordSingle(bidder1, tranche2, bytes32(uint256(2)));
        assertEq(tracker.missingDisbursementTo(bidder1), tranche3);
        assertEq(tracker.disbursementsToCount(bidder1), 2);

        _recordSingle(bidder1, tranche3, bytes32(uint256(3)));
        assertEq(tracker.missingDisbursementTo(bidder1), 0);
        assertEq(tracker.disbursementsToCount(bidder1), 3);

        _recordSingle(tokensRecipient, TOKEN_SUPPLY - totalMissing1, bytes32(uint256(0xff)));
        assertTrue(tracker.saleFullyDisbursed());
    }

    // --- Scenario 5: Outbid mid-auction, early exit, then full lifecycle ---

    function test_Integration_OutbidMidAuction_EarlyExit() public {
        vm.roll(startBlock);

        // Bidder1 bids at a low price.
        uint256 lowPrice = FLOOR_PRICE + TICK_SPACING;
        uint256 bid1Id = _submitBid(bidder1, lowPrice, 1 ether);

        // Bidder2 bids enough currency at a higher tick to buy the entire token
        // supply, outbidding bidder1.
        // Bid2's maxPrice is set one tick above that so it's strictly above the
        // final clearing price, allowing a clean exitBid().
        uint256 outbidPrice = lowPrice + TICK_SPACING;
        uint256 highPrice = outbidPrice + TICK_SPACING;
        uint128 spendAmount = uint128(FixedPointMathLib.fullMulDivUp(TOKEN_SUPPLY, outbidPrice, FixedPoint96.Q96));
        vm.deal(bidder2, spendAmount);
        uint256 bid2Id = _submitBid(bidder2, highPrice, spendAmount);

        // Advance to endBlock - 1 and checkpoint so the clearing price rises
        // above bidder1's maxPrice (the CCA needs supply schedule blocks to
        // process the demand).
        vm.roll(endBlock - 1);
        auction.checkpoint();

        vm.roll(endBlock);
        auction.checkpoint();

        // Bidder1 exits: outbid (clearing price > lowPrice). The outbid block
        // is endBlock - 1, the first checkpoint where the price exceeds lowPrice.
        auction.exitPartiallyFilledBid(bid1Id, uint64(startBlock), endBlock - 1);

        // Bid2's exits cleanly.
        auction.exitBid(bid2Id);

        // Claim and sweep.
        vm.roll(claimBlock);
        auction.claimTokens(bid2Id);
        auction.sweepUnsoldTokens();

        // The CCA's Q96 fixed-point arithmetic intentionally rounds up when
        // converting currency to tokens (see ContinuousClearingAuction.sol L270-272),
        // which can leave a small amount of token dust after sweep+claim.
        // The CCA's own tests tolerate up to MAX_ALLOWABLE_DUST_WEI = 1e18
        // (see AuctionBaseTest.sol L53, SweepUnsoldTokens.t.sol L144-148).
        assertLe(tracker.totalSupply(), MAX_ALLOWABLE_DUST_WEI);
        assertTrue(tracker.saleFullyClaimed());

        uint256 bid2Tokens = TOKEN_SUPPLY - MAX_ALLOWABLE_DUST_WEI;
        assertEq(tracker.missingDisbursementTo(bidder1), 0);
        assertEq(tracker.missingDisbursementTo(bidder2), bid2Tokens);
        assertEq(tracker.missingDisbursementTo(tokensRecipient), 0);

        _recordSingle(bidder2, bid2Tokens, bytes32(uint256(0xff)));
        assertTrue(tracker.saleFullyDisbursed());
    }

    function _recordSingle(address to, uint256 value, bytes32 txHash) internal {
        vm.prank(disburser_);
        tracker.recordDisbursement(to, value, txHash);
    }
}
