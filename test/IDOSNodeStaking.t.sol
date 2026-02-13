// SPDX-License-Identifier: MIT
// cSpell:words idOS
pragma solidity ^0.8.27;

import {Test, console} from "forge-std/Test.sol";
import {IDOSToken} from "../contracts/IDOSToken.sol";
import {IDOSNodeStaking} from "../contracts/IDOSNodeStaking.sol";

contract IDOSNodeStakingTest is Test {
    IDOSToken idosToken;
    IDOSNodeStaking idosStaking;

    address owner;
    address user1;
    address user2;
    address user3;
    address node1;
    address node2;
    address node3;

    uint256 constant START_TIME = 365 days; // To avoid underflow in withdrawUnstaked (it uses block.timestamp - UNSTAKE_DELAY).
    uint256 constant EPOCH_REWARD = 100;

    function setUp() public {
        owner = makeAddr("owner");
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        user3 = makeAddr("user3");
        node1 = makeAddr("node1");
        node2 = makeAddr("node2");
        node3 = makeAddr("node3");

        vm.prank(owner);
        idosToken = new IDOSToken(owner);

        idosStaking = new IDOSNodeStaking(address(idosToken), owner, uint48(START_TIME), EPOCH_REWARD);

        vm.prank(owner);
        idosToken.transfer(address(idosStaking), 10_000);

        address[] memory users = new address[](3);
        (users[0], users[1], users[2]) = (user1, user2, user3);
        for (uint256 i = 0; i < users.length; i++) {
            vm.prank(owner);
            idosToken.transfer(users[i], 1_000);
            vm.prank(users[i]);
            idosToken.approve(address(idosStaking), 1_000);
        }
    }

    function allowNode(address node) internal {
        vm.prank(owner);
        idosStaking.allowNode(node);
    }

    function stake(address user, address node, uint256 amount) internal {
        vm.prank(user);
        idosStaking.stake(address(0), node, amount);
    }

    function unstake(address user, address node, uint256 amount) internal {
        vm.prank(user);
        idosStaking.unstake(node, amount);
    }

    function slash(address node) internal {
        vm.prank(owner);
        idosStaking.slash(node);
    }

    function pause() internal {
        vm.prank(owner);
        idosStaking.pause();
    }

    function unpause() internal {
        vm.prank(owner);
        idosStaking.unpause();
    }

    function withdrawSlashedStakes() internal {
        vm.prank(owner);
        idosStaking.withdrawSlashedStakes();
    }

    function setEpochReward(uint256 amount) internal {
        vm.prank(owner);
        idosStaking.setEpochReward(amount);
    }

    function withdrawReward(address user) internal {
        vm.prank(user);
        idosStaking.withdrawReward();
    }

    function withdrawUnstaked(address user) internal {
        vm.prank(user);
        idosStaking.withdrawUnstaked();
    }

    function createEpochCheckpoint(address user) internal {
        vm.prank(user);
        idosStaking.createEpochCheckpoint(user);
    }

    function withdrawableReward(address user) internal view returns (uint256 amount) {
        (amount,,,) = idosStaking.withdrawableReward(user);
    }

    // --- Pausing ---

    function test_WhenNotPaused_CanPausedByOwner() public {
        vm.prank(owner);
        idosStaking.pause();
    }

    function test_WhenNotPaused_CanPausedOnlyByOwner() public {
        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", user1));
        idosStaking.pause();
    }

    function setup_WhenPaused() public {
        pause();
    }

    function test_WhenPaused_CanBeUnpausedByOwner() public {
        setup_WhenPaused();

        unpause();
    }

    function test_Pause_WhenPaused_CantAllowNode() public {
        setup_WhenPaused();

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        idosStaking.allowNode(node1);
    }

    function test_Pause_WhenPaused_CantDisallowNode() public {
        setup_WhenPaused();

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        idosStaking.disallowNode(node1);
    }

    function test_Pause_WhenPaused_CantStake() public {
        setup_WhenPaused();

        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        stake(user1, node1, 100);
    }

    function test_Pause_WhenPaused_CantUnstake() public {
        setup_WhenPaused();

        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        unstake(user1, node1, 100);
    }

    function test_Pause_WhenPaused_CantWithdrawUnstaked() public {
        setup_WhenPaused();

        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        idosStaking.withdrawUnstaked();
    }

    function test_Pause_WhenPaused_CantWithdrawSlashedStakes() public {
        setup_WhenPaused();

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        idosStaking.withdrawSlashedStakes();
    }

    function test_Pause_WhenPaused_CantWithdrawReward() public {
        setup_WhenPaused();

        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        idosStaking.withdrawReward();
    }

    // --- Allowlisting ---

    function test_Allowlisting_NodeCanBeAllowedOnlyByOwner() public {
        allowNode(node1);

        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", user1));
        idosStaking.allowNode(node1);
    }

    function test_Allowlisting_NodeCanBeDisallowedOnlyByOwner() public {
        vm.prank(owner);
        idosStaking.disallowNode(node1);

        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", user1));
        idosStaking.disallowNode(node1);
    }

    function test_Allowlisting_EmitsEvents() public {
        vm.expectEmit();
        emit IDOSNodeStaking.Allowed(node1);
        allowNode(node1);

        vm.prank(owner);
        vm.expectEmit();
        emit IDOSNodeStaking.Disallowed(node2);
        idosStaking.disallowNode(node2);
    }

    // --- Staking ---

    function test_Staking_BeforeStarting_CantStakeYet() public {
        allowNode(node1);

        vm.expectRevert(abi.encodeWithSignature("NotStarted()"));
        stake(user1, node1, 100);
    }

    function setup_Staking_AfterStarting() public {
        vm.warp(START_TIME);
    }

    function test_Staking_AfterStarting_EpochsLast1Day() public {
        setup_Staking_AfterStarting();

        assertEq(idosStaking.EPOCH_LENGTH(), 1 days);

        for (uint256 i = 0; i < 10; i++) {
            assertEq(idosStaking.currentEpoch(), i * 100);
            vm.warp(START_TIME + (i + 1) * 100 days);
        }
    }

    function test_Staking_AfterStarting_CantStakeAgainstZeroAddress() public {
        setup_Staking_AfterStarting();

        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSignature("ZeroAddressNode()"));

        idosStaking.stake(address(0), address(0), 100);
    }

    function test_Staking_AfterStarting_CantStakeAgainstSlashedNode() public {
        setup_Staking_AfterStarting();

        allowNode(node1);
        stake(user1, node1, 1);
        slash(node1);

        vm.expectRevert(abi.encodeWithSignature("NodeIsSlashed(address)", node1));
        stake(user1, node1, 100);
    }

    function test_Staking_AfterStarting_CantStakeAgainstNonAllowedNode() public {
        setup_Staking_AfterStarting();

        vm.expectRevert(abi.encodeWithSignature("NodeIsNotAllowed(address)", node1));
        stake(user1, node1, 100);
    }

    function test_Staking_AfterStarting_CanOnlyStakePositiveAmounts() public {
        setup_Staking_AfterStarting();

        allowNode(node1);
        vm.expectRevert(abi.encodeWithSignature("AmountNotPositive(uint256)", 0));
        stake(user1, node1, 0);
    }

    function test_Staking_AfterStarting_EmitsEvents() public {
        setup_Staking_AfterStarting();

        allowNode(node1);

        vm.expectEmit();
        emit IDOSNodeStaking.Staked(user1, node1, 100);
        stake(user1, node1, 100);
    }

    function test_Staking_AfterStarting_Works() public {
        setup_Staking_AfterStarting();

        allowNode(node1);
        allowNode(node2);

        stake(user1, node1, 100);

        assertEq(idosStaking.stakeByNodeByUser(user1, node1), 100);
        assertEq(idosStaking.getNodeStake(node1), 100);
        (uint256 active,) = idosStaking.getUserStake(user1);
        assertEq(active, 100);
        assertEq(idosToken.balanceOf(user1), 900);
        assertEq(idosToken.balanceOf(address(idosStaking)), 10_100);

        stake(user1, node1, 100);

        assertEq(idosStaking.stakeByNodeByUser(user1, node1), 200);
        assertEq(idosStaking.getNodeStake(node1), 200);
        (active,) = idosStaking.getUserStake(user1);
        assertEq(active, 200);
        assertEq(idosToken.balanceOf(user1), 800);
        assertEq(idosToken.balanceOf(address(idosStaking)), 10_200);

        stake(user1, node2, 100);

        assertEq(idosStaking.stakeByNodeByUser(user1, node2), 100);
        assertEq(idosStaking.getNodeStake(node2), 100);
        (active,) = idosStaking.getUserStake(user1);
        assertEq(active, 300);
        assertEq(idosToken.balanceOf(user1), 700);
        assertEq(idosToken.balanceOf(address(idosStaking)), 10_300);

        stake(user2, node2, 100);

        assertEq(idosStaking.stakeByNodeByUser(user2, node2), 100);
        assertEq(idosStaking.getNodeStake(node2), 200);
        (active,) = idosStaking.getUserStake(user2);
        assertEq(active, 100);
        assertEq(idosToken.balanceOf(user2), 900);
        assertEq(idosToken.balanceOf(address(idosStaking)), 10_400);
    }

    // --- Unstaking ---

    function test_Unstaking_BeforeStarting_CantUnstakeYet() public {
        vm.expectRevert(abi.encodeWithSignature("NotStarted()"));
        unstake(user1, node1, 100);
    }

    function setup_Unstaking_AfterStarting() public {
        vm.warp(START_TIME);
        allowNode(node1);
        stake(user1, node1, 100);
    }

    function test_Unstaking_AfterStarting_CantUnstakeFromZeroAddress() public {
        setup_Unstaking_AfterStarting();

        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSignature("ZeroAddressNode()"));
        idosStaking.unstake(address(0), 100);
    }

    function test_Unstaking_AfterStarting_CantUnstakeFromSlashedNode() public {
        setup_Unstaking_AfterStarting();

        slash(node1);

        vm.expectRevert(abi.encodeWithSignature("NodeIsSlashed(address)", node1));
        unstake(user1, node1, 100);
    }

    function test_Unstaking_AfterStarting_CanOnlyUnstakePositiveAmounts() public {
        setup_Unstaking_AfterStarting();

        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSignature("AmountNotPositive(uint256)", 0));
        idosStaking.unstake(node1, 0);
    }

    function test_Unstaking_AfterStarting_CanOnlyUnstakeUpToStakedAmount() public {
        setup_Unstaking_AfterStarting();

        vm.expectRevert(abi.encodeWithSignature("AmountExceedsStake(uint256,uint256)", 1000, 100));
        unstake(user1, node1, 1000);

        assertEq(idosStaking.stakeByNodeByUser(user1, node1), 100);

        stake(user1, node1, 900);
        unstake(user1, node1, 1000);

        assertEq(idosStaking.stakeByNodeByUser(user1, node1), 0);
    }

    function test_Unstaking_AfterStarting_EmitsEvents() public {
        setup_Unstaking_AfterStarting();

        vm.expectEmit();
        emit IDOSNodeStaking.Unstaked(user1, node1, 100);
        unstake(user1, node1, 100);
    }

    function test_Unstaking_AfterStarting_Works() public {
        setup_Unstaking_AfterStarting();

        unstake(user1, node1, 10);

        assertEq(idosStaking.stakeByNodeByUser(user1, node1), 90);
    }

    function test_Unstaking_AfterStarting_Withdrawal_CantWithdrawBeforeDelay() public {
        setup_Unstaking_AfterStarting();

        unstake(user1, node1, 10);

        vm.expectRevert(abi.encodeWithSignature("NoWithdrawableStake()"));
        withdrawUnstaked(user1);
    }

    function test_Unstaking_AfterStarting_Withdrawal_EmitsEvents() public {
        setup_Unstaking_AfterStarting();

        unstake(user1, node1, 100);

        skip(15 days); // !!!: was 14 in the original tests.

        vm.expectEmit();
        emit IDOSNodeStaking.UnstakedWithdraw(user1, 100);
        withdrawUnstaked(user1);
    }

    function test_Unstaking_AfterStarting_Withdrawal_Works() public {
        setup_Unstaking_AfterStarting();

        unstake(user1, node1, 10);

        skip(1 days);

        unstake(user1, node1, 10);

        skip(14 days); // !!!: was 13 in the original tests.

        withdrawUnstaked(user1);

        assertEq(idosToken.balanceOf(user1), 910);

        skip(1 days);

        withdrawUnstaked(user1);

        assertEq(idosToken.balanceOf(user1), 920);
    }

    // --- Slashing ---

    function setup_Slashing() public {
      vm.warp(START_TIME);
      allowNode(node1);
    }

    function test_Slashing_UnknownNodesCantBeSlashed() public {
        setup_Slashing();

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSignature("NodeIsUnknown(address)", node1));
        idosStaking.slash(node1);

        address randomAddr = makeAddr("random");
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSignature("NodeIsUnknown(address)", randomAddr));
        idosStaking.slash(randomAddr);
    }

    function test_Slashing_SlashedNodesCantBeSlashed() public {
        setup_Slashing();

        stake(user1, node1, 100);
        slash(node1);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSignature("NodeIsSlashed(address)", node1));
        idosStaking.slash(node1);
    }

    function test_Slashing_KnownNodesCanBeSlashedOnlyByOwner() public {
        setup_Slashing();

        stake(user1, node1, 100);

        slash(node1);

        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", user1));
        idosStaking.slash(node1);
    }

    function setup_Slashing_WithdrawingSlashedStakes() public {
        setup_Slashing();

        stake(user1, node1, 100);
        slash(node1);
    }

    function test_Slashing_WithdrawingSlashedStakes_CanBeDoneOnlyByOwner() public {
        setup_Slashing_WithdrawingSlashedStakes();

        withdrawSlashedStakes();

        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", user1));
        idosStaking.withdrawSlashedStakes();
    }

    function test_Slashing_WithdrawingSlashedStakes_EmitsEvents() public {
        setup_Slashing_WithdrawingSlashedStakes();

        vm.expectEmit();
        emit IDOSNodeStaking.SlashedWithdraw(100);
        withdrawSlashedStakes();
    }

    function test_Slashing_WithdrawingSlashedStakes_Works() public {
        setup_Slashing_WithdrawingSlashedStakes();

        uint256 prevBalance = idosToken.balanceOf(owner);
        withdrawSlashedStakes();
        assertEq(idosToken.balanceOf(owner), prevBalance + 100);

        vm.expectRevert(abi.encodeWithSignature("NoWithdrawableSlashedStakes()"));
        withdrawSlashedStakes();
    }

    // --- Rewards ---

    function setup_Rewards() public {
        vm.warp(START_TIME);
        allowNode(node1);
        allowNode(node2);
        allowNode(node3);
    }

    // Ensure sniping prevention: first staker in epoch
    // could otherwise immediately withdraw all rewards
    function test_Rewards_CountOnlyPastEpochs() public {
        setup_Rewards();

        assertEq(withdrawableReward(user1), 0);
    }

    function test_Rewards_IgnoreSlashedStakes() public {
        setup_Rewards();

        stake(user1, node1, 50);
        stake(user1, node2, 50);
        stake(user2, node2, 300);
        slash(node1);
        skip(1 days);

        assertEq(withdrawableReward(user1), 14);
        assertEq(withdrawableReward(user2), 85);
    }

    function test_Rewards_ChangesValueAccordingToEpochReward() public {
        setup_Rewards();

        stake(user1, node1, 100);
        // Set to 100 at constructor
        skip(1 days);

        assertEq(withdrawableReward(user1), 100);
        withdrawReward(user1);
        assertEq(idosToken.balanceOf(user1), 1000 - 100 + 100);

        setEpochReward(200);
        skip(1 days);
        assertEq(withdrawableReward(user1), 200);
    }

    function test_Rewards_ChangesValueAndKeepsTrackOfPastEpochRewards() public {
        setup_Rewards();

        stake(user1, node1, 100);
        // Set to 100 at constructor
        skip(1 days);

        assertEq(withdrawableReward(user1), 100);

        setEpochReward(200);
        skip(1 days);
        assertEq(withdrawableReward(user1), 100 + 200);

        setEpochReward(300);
        skip(1 days);
        assertEq(withdrawableReward(user1), 100 + 200 + 300);
    }

    function test_Rewards_WorksI() public {
        setup_Rewards();

        stake(user1, node1, 100);
        stake(user2, node1, 300);
        skip(1 days);

        assertEq(withdrawableReward(user1), 25);
        withdrawReward(user1);
        assertEq(idosToken.balanceOf(user1), 1000 - 100 + 25);

        assertEq(withdrawableReward(user2), 75);
        withdrawReward(user2);
        assertEq(idosToken.balanceOf(user2), 1000 - 300 + 75);

        vm.expectRevert(abi.encodeWithSignature("NoWithdrawableRewards()"));
        withdrawReward(user1);
    }

    function test_Rewards_WorksII() public {
        setup_Rewards();

        stake(user1, node1, 50);
        stake(user1, node2, 50);
        stake(user2, node2, 300);

        skip(1 days);

        assertEq(withdrawableReward(user1), 25);
        assertEq(withdrawableReward(user2), 75);
        assertEq(withdrawableReward(user3), 0);

        skip(9 days);

        assertEq(withdrawableReward(user1), 250);
        assertEq(withdrawableReward(user2), 750);
        assertEq(withdrawableReward(user3), 0);

        slash(node2);

        skip(1 days);

        assertEq(withdrawableReward(user1), 350);
        assertEq(withdrawableReward(user2), 750);
        assertEq(withdrawableReward(user3), 0);

        skip(10 days);

        assertEq(withdrawableReward(user1), 1350);
        assertEq(withdrawableReward(user2), 750);
        assertEq(withdrawableReward(user3), 0);

        stake(user2, node1, 100);
        stake(user3, node1, 100);
        stake(user3, node3, 200);

        skip(1 days);

        assertEq(withdrawableReward(user1), 1361);
        assertEq(withdrawableReward(user2), 772);
        assertEq(withdrawableReward(user3), 66);
    }

    function test_Rewards_WorksIII() public {
        setup_Rewards();

        stake(user1, node1, 50);
        stake(user1, node2, 50);
        stake(user2, node2, 300);

        skip(10 days);

        assertEq(withdrawableReward(user1), 250);
        assertEq(withdrawableReward(user2), 750);
        assertEq(withdrawableReward(user3), 0);

        stake(user3, node1, 100);
        unstake(user1, node2, 50);

        withdrawReward(user1);

        assertEq(withdrawableReward(user1), 0);
        assertEq(withdrawableReward(user2), 750);
        assertEq(withdrawableReward(user3), 0);

        skip(10 days);

        assertEq(withdrawableReward(user1), 110);
        assertEq(withdrawableReward(user2), 1410);
        assertEq(withdrawableReward(user3), 220);

        skip(5 days);

        withdrawUnstaked(user1);

        skip(5 days);

        assertEq(withdrawableReward(user1), 220);
        assertEq(withdrawableReward(user2), 2070);
        assertEq(withdrawableReward(user3), 440);
    }

    // PoC from audit — should pass this test
    function test_Rewards_EpochRewardsComputation() public {
        setup_Rewards();

        stake(user1, node1, 100);

        //this is correct, we have 100 tokens/ day * 5 days
        skip(5 days);
        assertEq(withdrawableReward(user1), 500);

        //at epoch 5 the admin updates the rewards. From here on, each epoch should yield 200 tokens/day
        setEpochReward(200);

        //we advance to epoch 7
        skip(2 days);

        //we checkpoint the user at epoch 7, and their total rewards are correct
        //(5 * 100) + (2 * 200) = 900 tokens
        createEpochCheckpoint(user1);
        assertEq(withdrawableReward(user1), 900);

        // from here on, rewards are wrong
        skip(3 days);
        uint256 withdrawable = withdrawableReward(user1);

        // With correct sticky semantics:
        // - epochs 0–4: 5 * 100 = 500
        // - epochs 5–9: 5 * 200 = 1000
        //   => total = 1500
        //
        // The current implementation incorrectly re-initializes epochReward to the
        // default value at index 0 when starting from checkpoint.epoch = 7,
        // and since there is no epochRewardChanges[7/8/9], it uses 100 instead of 200
        // for epochs 7–9, giving:
        //   500 (epochs 0–4) + 400 (epochs 5–6) + 300 (epochs 7–9) = 1200.

        //assertEq(withdrawable, 1200);
        assertEq(withdrawable, 1500);
    }
}
