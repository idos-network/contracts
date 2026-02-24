// SPDX-License-Identifier: MIT
// cSpell:words overdisbursement

pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {CCADisbursementTracker, MAX_ALLOWABLE_DUST_WEI} from "../src/CCADisbursementTracker.sol";

import {ContinuousClearingAuction} from "continuous-clearing-auction/ContinuousClearingAuction.sol";
import {AuctionParameters} from "continuous-clearing-auction/interfaces/IContinuousClearingAuction.sol";
import {Bid} from "continuous-clearing-auction/libraries/BidLib.sol";
import {Checkpoint} from "continuous-clearing-auction/libraries/CheckpointLib.sol";
import {ConstantsLib} from "continuous-clearing-auction/libraries/ConstantsLib.sol";
import {FixedPoint96} from "continuous-clearing-auction/libraries/FixedPoint96.sol";
import {FixedPointMathLib} from "solady/utils/FixedPointMathLib.sol";
import {SafeCastLib} from "solady/utils/SafeCastLib.sol";

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

        vm.prank(disburser);
        tracker.recordDisbursement(recipient, value, txHash);

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

// --- Full-lifecycle invariant test: fuzzes the auction, then settles and disburses ---

contract FullLifecycleHandler is Test {
    using FixedPointMathLib for *;

    ContinuousClearingAuction public auction;
    CCADisbursementTracker public tracker;
    address public disburser;

    address[] public actors;
    address public currentActor;

    uint256[] public bidIds;
    uint256 public bidCount;

    uint256 public ghostTotalDisbursed;
    uint256 public ghostTotalTranches;
    mapping(address => uint256) public ghostDisbursedTo;
    mapping(address => uint256) public ghostTrancheCount;

    uint256 public lastSeenClearingPrice;
    uint256 public unexitedBids;

    // ~10% of fuzz calls advance the block, concentrating most actions
    // intra-block to exercise batched-bid scenarios.
    uint256 constant ROLL_DENOMINATOR = 10;
    uint256 constant ROLL_STEP = 1;

    function updateLastSeenClearingPrice(uint256 price) external {
        if (price > lastSeenClearingPrice) lastSeenClearingPrice = price;
    }

    bool public settled;

    constructor(
        ContinuousClearingAuction auction_,
        CCADisbursementTracker tracker_,
        address disburser_,
        address[] memory actors_
    ) {
        auction = auction_;
        tracker = tracker_;
        disburser = disburser_;
        actors = actors_;
    }

    modifier givenAuctionHasStarted() {
        if (block.number < auction.startBlock()) {
            vm.roll(auction.startBlock());
        }
        _;
    }

    modifier useActor(uint256 actorIndexSeed) {
        currentActor = actors[bound(actorIndexSeed, 0, actors.length - 1)];
        vm.startPrank(currentActor);
        _;
        vm.stopPrank();
    }

    function _getLowerTick(uint256 maxPrice) internal view returns (uint256) {
        uint256 price = auction.floorPrice();
        if (maxPrice <= price) return 0;
        uint256 cached = price;
        while (price < maxPrice) {
            uint256 next = auction.ticks(price).next;
            if (next == 0 || next == type(uint256).max) break;
            price = next;
            if (price >= maxPrice) break;
            cached = price;
        }
        return cached;
    }

    function _getLowerUpperCheckpointHints(uint256 maxPrice) internal view returns (uint64 lower, uint64 upper) {
        uint64 currentBlock = auction.lastCheckpointedBlock();
        while (currentBlock != 0) {
            Checkpoint memory cp = auction.checkpoints(currentBlock);
            if (cp.clearingPrice > maxPrice) upper = currentBlock;
            if (cp.clearingPrice < maxPrice && lower == 0) lower = currentBlock;
            currentBlock = cp.prev;
        }
    }

    function _useAmountMaxPrice(uint128 amount, uint256 clearingPrice, uint8 tickNumber)
        internal
        view
        returns (uint128, uint256)
    {
        uint256 tickSpacing = auction.tickSpacing();
        uint256 floorPrice = auction.floorPrice();
        tickNumber = uint8(bound(uint256(tickNumber), 1, type(uint8).max));
        uint256 tickNumberPrice = floorPrice + uint256(tickNumber) * tickSpacing;

        uint256 minPrice = clearingPrice + tickSpacing;
        uint256 rem = minPrice % tickSpacing;
        if (rem != 0) minPrice += tickSpacing - rem;

        uint256 maxPrice = bound(tickNumberPrice, minPrice, type(uint128).max * FixedPoint96.Q96);
        maxPrice -= (maxPrice % tickSpacing);
        uint128 inputAmount;
        if (amount > (type(uint128).max * FixedPoint96.Q96) / maxPrice) {
            inputAmount = type(uint128).max;
        } else {
            inputAmount = SafeCastLib.toUint128(uint256(amount).fullMulDivUp(maxPrice, FixedPoint96.Q96));
        }
        return (inputAmount, maxPrice);
    }

    // --- Fuzzed handler actions ---

    function handleRoll(uint256 seed) public {
        if (seed % ROLL_DENOMINATOR == 0) vm.roll(block.number + ROLL_STEP);
    }

    function handleCheckpoint() public givenAuctionHasStarted {
        if (block.number >= auction.endBlock()) return;
        Checkpoint memory cp = auction.checkpoint();

        // Track clearing price from checkpoints only (not from forceIterateOverTicks,
        // which can set a temporary value that a subsequent checkpoint corrects).
        if (cp.clearingPrice > lastSeenClearingPrice) lastSeenClearingPrice = cp.clearingPrice;
    }

    function handleForceIterateOverTicks(uint8 tickNumber) public givenAuctionHasStarted {
        if (block.number >= auction.endBlock()) return;

        uint256 floorPrice = auction.floorPrice();
        uint256 tickSpacing = auction.tickSpacing();
        uint256 targetTickPrice = floorPrice + uint256(tickNumber) * tickSpacing;
        uint256 prevTickPrice = _getLowerTick(targetTickPrice);

        if (prevTickPrice == 0 || prevTickPrice <= auction.nextActiveTickPrice()) {
            prevTickPrice = type(uint256).max;
        }

        try auction.forceIterateOverTicks(prevTickPrice) {} catch {}
    }

    function handleSubmitBid(uint256 actorIndexSeed, uint128 bidAmount, uint8 tickNumber)
        public
        payable
        useActor(actorIndexSeed)
        givenAuctionHasStarted
    {
        if (block.number >= auction.endBlock()) return;

        (uint128 inputAmount, uint256 maxPrice) = _useAmountMaxPrice(bidAmount, lastSeenClearingPrice, tickNumber);
        if (inputAmount == 0) return;

        vm.deal(currentActor, uint256(inputAmount));
        uint256 prevTickPrice = _getLowerTick(maxPrice);
        uint256 nextBidId = auction.nextBidId();

        try auction.submitBid{value: inputAmount}(maxPrice, inputAmount, currentActor, prevTickPrice, "") {
            bidIds.push(nextBidId);
            bidCount++;
        } catch {}
    }

    function handleEarlyExitPartiallyFilledBid(uint256 actorIndexSeed) public useActor(actorIndexSeed) {
        if (!auction.isGraduated()) return;

        for (uint256 i; i < bidCount; i++) {
            Bid memory bid = auction.bids(bidIds[i]);
            if (bid.exitedBlock != 0) continue;
            if (bid.maxPrice >= lastSeenClearingPrice) continue;

            (uint64 lower, uint64 upper) = _getLowerUpperCheckpointHints(bid.maxPrice);
            if (upper == 0) continue;

            try auction.exitPartiallyFilledBid(bidIds[i], lower, upper) {} catch {}
            return;
        }
    }

    // --- Settlement helpers (called from invariant functions, not by fuzzer) ---

    function settleAuction_claimThenSweep() external {
        if (settled) return;
        settled = true;

        vm.roll(auction.endBlock());
        auction.checkpoint();
        _exitAllBids();

        if (auction.isGraduated()) {
            vm.roll(auction.claimBlock());
            _claimAllBids();
        }

        auction.sweepUnsoldTokens();
    }

    function settleAuction_sweepThenClaim() external {
        if (settled) return;
        settled = true;

        vm.roll(auction.endBlock());
        auction.checkpoint();
        _exitAllBids();

        auction.sweepUnsoldTokens();

        if (auction.isGraduated()) {
            vm.roll(auction.claimBlock());
            _claimAllBids();
        }
    }

    function _exitAllBids() internal {
        uint256 cp = auction.clearingPrice();

        for (uint256 i; i < bidCount; i++) {
            Bid memory bid = auction.bids(bidIds[i]);
            if (bid.exitedBlock != 0) continue;

            if (bid.maxPrice > cp) {
                auction.exitBid(bidIds[i]);
            } else {
                (uint64 lower, uint64 upper) = _getLowerUpperCheckpointHints(bid.maxPrice);
                try auction.exitPartiallyFilledBid(bidIds[i], lower, upper) {}
                catch {
                    try auction.exitPartiallyFilledBid(bidIds[i], lower, 0) {}
                    catch { unexitedBids++; }
                }
            }
        }
    }

    function _claimAllBids() internal {
        for (uint256 i; i < bidCount; i++) {
            Bid memory bid = auction.bids(bidIds[i]);
            if (bid.exitedBlock == 0 || bid.tokensFilled == 0) continue;
            auction.claimTokens(bidIds[i]);
        }
    }

    function disburseAll() external {
        address tokensRecipient = auction.tokensRecipient();
        for (uint256 i; i < actors.length; i++) {
            _disburseFor(actors[i]);
        }
        _disburseFor(tokensRecipient);
    }

    function disburseInTranches(uint256 trancheCountSeed) external {
        uint256 maxTranches = bound(trancheCountSeed, 2, 5);
        address tokensRecipient = auction.tokensRecipient();
        for (uint256 i; i < actors.length; i++) {
            _disburseInTranches(actors[i], maxTranches);
        }
        _disburseInTranches(tokensRecipient, maxTranches);
    }

    function _disburseFor(address account) internal {
        uint256 missing = tracker.missingDisbursementTo(account);
        if (missing == 0) return;

        vm.prank(disburser);
        tracker.recordDisbursement(account, missing, keccak256(abi.encodePacked(account, missing)));

        ghostTotalDisbursed += missing;
        ghostDisbursedTo[account] += missing;
        ghostTotalTranches++;
        ghostTrancheCount[account]++;
    }

    function _disburseInTranches(address account, uint256 numTranches) internal {
        uint256 total = tracker.missingDisbursementTo(account);
        if (total == 0) return;

        uint256 perTranche = total / numTranches;
        if (perTranche == 0) {
            numTranches = 1;
            perTranche = total;
        }

        for (uint256 i; i < numTranches; i++) {
            uint256 amount = (i == numTranches - 1) ? total - perTranche * i : perTranche;

            vm.prank(disburser);
            tracker.recordDisbursement(
                account, amount, keccak256(abi.encodePacked(account, amount, i))
            );

            ghostTotalDisbursed += amount;
            ghostDisbursedTo[account] += amount;
            ghostTotalTranches++;
            ghostTrancheCount[account]++;
        }
    }

    function actorsLength() external view returns (uint256) {
        return actors.length;
    }
}

abstract contract FullLifecycleInvariantBase is Test {
    CCADisbursementTracker tracker;
    ContinuousClearingAuction auction;
    FullLifecycleHandler handler;

    address disburser;
    address tokensRecipient;
    address fundsRecipient;

    address[] actors;

    uint128 constant TOKEN_SUPPLY = 1_000 ether;
    uint256 constant Q96 = 2 ** 96;
    uint256 constant TICK_SPACING = 100 * Q96;
    uint256 constant FLOOR_PRICE = 10 * TICK_SPACING;
    uint128 constant REQUIRED_RAISE = 1 ether;

    function _buildStepsData(uint24 auctionLength) internal pure returns (bytes memory) {
        uint24 mpsPerBlock = uint24(ConstantsLib.MPS / auctionLength);
        return abi.encodePacked(mpsPerBlock, uint40(auctionLength));
    }

    function setUp() public {
        disburser = makeAddr("disburser");
        tokensRecipient = makeAddr("tokensRecipient");
        fundsRecipient = makeAddr("fundsRecipient");

        actors.push(makeAddr("bidder1"));
        actors.push(makeAddr("bidder2"));
        actors.push(makeAddr("bidder3"));
        actors.push(makeAddr("bidder4"));
        actors.push(makeAddr("bidder5"));

        uint64 startBlock = uint64(block.number + 10);
        uint24 auctionLength = 100;
        uint64 endBlock = startBlock + uint64(auctionLength);
        uint64 claimBlock = endBlock + 10;

        bytes memory stepsData = _buildStepsData(auctionLength);

        tracker = new CCADisbursementTracker("CCA Tracker", "CCAT", TOKEN_SUPPLY, disburser);

        AuctionParameters memory params = AuctionParameters({
            currency: address(0),
            tokensRecipient: tokensRecipient,
            fundsRecipient: fundsRecipient,
            startBlock: startBlock,
            endBlock: endBlock,
            claimBlock: claimBlock,
            tickSpacing: TICK_SPACING,
            validationHook: address(0),
            floorPrice: FLOOR_PRICE,
            requiredCurrencyRaised: REQUIRED_RAISE,
            auctionStepsData: stepsData
        });

        auction = new ContinuousClearingAuction(address(tracker), TOKEN_SUPPLY, params);
        tracker.initialize(address(auction));
        auction.onTokensReceived();

        handler = new FullLifecycleHandler(auction, tracker, disburser, actors);

        targetContract(address(handler));

        bytes4[] memory excluded = new bytes4[](6);
        excluded[0] = FullLifecycleHandler.settleAuction_claimThenSweep.selector;
        excluded[1] = FullLifecycleHandler.settleAuction_sweepThenClaim.selector;
        excluded[2] = FullLifecycleHandler.disburseAll.selector;
        excluded[3] = FullLifecycleHandler.disburseInTranches.selector;
        excluded[4] = FullLifecycleHandler.actorsLength.selector;
        excluded[5] = FullLifecycleHandler.updateLastSeenClearingPrice.selector;
        excludeSelector(FuzzSelector({addr: address(handler), selectors: excluded}));
    }

    function _assertPostSettlementInvariants() internal view {
        assertTrue(tracker.saleFullyClaimed(), "Sale should be fully claimed after settlement");
        assertEq(handler.unexitedBids(), 0, "All bids should have been exited during settlement");

        uint256 sum;
        for (uint256 i; i < actors.length; i++) {
            sum += tracker.missingDisbursementTo(actors[i]);
        }
        sum += tracker.missingDisbursementTo(tokensRecipient);
        assertEq(tracker.totalMissingDisbursements(), sum, "Per-account missing should sum to total");

        assertApproxEqAbs(
            tracker.initialSupply(),
            tracker.totalSupply() + tracker.totalMissingDisbursements(),
            MAX_ALLOWABLE_DUST_WEI,
            "Supply conservation: initialSupply ~= totalSupply + totalMissing"
        );

        assertEq(
            tracker.balanceOf(address(auction)), tracker.totalSupply(),
            "All remaining tracker tokens should be dust in the auction"
        );
    }

    function _assertPostDisbursementInvariants() internal view {
        assertTrue(tracker.saleFullyDisbursed(), "Sale should be fully disbursed after recording all");
        assertEq(tracker.totalMissingDisbursements(), 0);

        for (uint256 i; i < actors.length; i++) {
            assertEq(tracker.missingDisbursementTo(actors[i]), 0);
            assertEq(
                tracker.disbursementsToCount(actors[i]),
                handler.ghostTrancheCount(actors[i]),
                "Disbursement record count should match ghost"
            );
        }
        assertEq(tracker.missingDisbursementTo(tokensRecipient), 0);
        assertEq(
            tracker.disbursementsToCount(tokensRecipient),
            handler.ghostTrancheCount(tokensRecipient)
        );

        assertEq(
            handler.ghostTotalDisbursed(),
            tracker.initialSupply() - tracker.totalSupply(),
            "Total disbursed should equal burned supply"
        );
    }

    function invariant_FullLifecycle_MissingEqualsBurnedBeforeClaim() public view {
        if (!tracker.saleFullyClaimed()) {
            assertEq(tracker.totalMissingDisbursements(), tracker.initialSupply() - tracker.totalSupply());
        }
    }

    // Non-view: updates the handler baseline so every invocation compares
    // against the most recently observed checkpoint, not just ones the fuzzer
    // happened to trigger via handleCheckpoint().
    function invariant_FullLifecycle_CheckpointClearingPriceNonDecreasing() public {
        uint64 latestBlock = auction.lastCheckpointedBlock();
        if (latestBlock == 0) return;

        Checkpoint memory latest = auction.checkpoints(latestBlock);
        assertGe(latest.clearingPrice, handler.lastSeenClearingPrice());
        handler.updateLastSeenClearingPrice(latest.clearingPrice);
    }
}

contract FullLifecycleClaimThenSweepInvariantTest is FullLifecycleInvariantBase {
    function invariant_FullLifecycle_ClaimThenSweep_DisburseAll() public {
        handler.settleAuction_claimThenSweep();
        _assertPostSettlementInvariants();

        handler.disburseAll();
        _assertPostDisbursementInvariants();
    }
}

contract FullLifecycleSweepThenClaimInvariantTest is FullLifecycleInvariantBase {
    function invariant_FullLifecycle_SweepThenClaim_DisburseInTranches() public {
        handler.settleAuction_sweepThenClaim();
        _assertPostSettlementInvariants();

        handler.disburseInTranches(block.timestamp);
        _assertPostDisbursementInvariants();
    }
}
