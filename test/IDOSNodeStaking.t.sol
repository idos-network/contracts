// SPDX-License-Identifier: MIT
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

    uint256 constant START_TIME = 1 days;
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

        for (uint256 i = 0; i < 3; i++) {
            address u = i == 0 ? user1 : (i == 1 ? user2 : user3);
            vm.prank(owner);
            idosToken.transfer(u, 1_000);
            vm.prank(u);
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

    function withdrawableReward(address user) internal view returns (uint256) {
        (uint256 amount,,,) = idosStaking.withdrawableReward(user);
        return amount;
    }

    // --- Pausing ---

    function test_Pause_CanBePausedOnlyByOwner() public {
        vm.prank(owner);
        idosStaking.pause();

        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", user1));
        idosStaking.pause();
    }

    function test_Pause_WhenPaused_CanBeUnpausedByOwner() public {
        vm.prank(owner);
        idosStaking.pause();
        vm.prank(owner);
        idosStaking.unpause();
    }

    function test_Pause_WhenPaused_CantAllowNode() public {
        vm.prank(owner);
        idosStaking.pause();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        idosStaking.allowNode(node1);
    }

    function test_Pause_WhenPaused_CantDisallowNode() public {
        vm.prank(owner);
        idosStaking.pause();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        idosStaking.disallowNode(node1);
    }

    function test_Pause_WhenPaused_CantStake() public {
        allowNode(node1);
        vm.prank(owner);
        idosStaking.pause();
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        stake(user1, node1, 100);
    }

    function test_Pause_WhenPaused_CantUnstake() public {
        allowNode(node1);
        vm.warp(START_TIME);
        stake(user1, node1, 100);
        vm.prank(owner);
        idosStaking.pause();
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        unstake(user1, node1, 100);
    }

    function test_Pause_WhenPaused_CantWithdrawUnstaked() public {
        allowNode(node1);
        vm.warp(START_TIME);
        stake(user1, node1, 100);
        unstake(user1, node1, 100);
        vm.prank(owner);
        idosStaking.pause();
        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        idosStaking.withdrawUnstaked();
    }

    function test_Pause_WhenPaused_CantWithdrawSlashedStakes() public {
        allowNode(node1);
        vm.warp(START_TIME);
        stake(user1, node1, 100);
        slash(node1);
        vm.prank(owner);
        idosStaking.pause();
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        idosStaking.withdrawSlashedStakes();
    }

    function test_Pause_WhenPaused_CantWithdrawReward() public {
        allowNode(node1);
        vm.warp(START_TIME);
        stake(user1, node1, 100);
        vm.warp(START_TIME + 1 days);
        vm.prank(owner);
        idosStaking.pause();
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
        allowNode(node1);
        vm.prank(owner);
        idosStaking.disallowNode(node1);

        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", user1));
        idosStaking.disallowNode(node1);
    }

    function test_Allowlisting_EmitsEvents() public {
        vm.expectEmit(true, true, true, true);
        emit IDOSNodeStaking.Allowed(node1);
        allowNode(node1);

        allowNode(node2);
        vm.expectEmit(true, true, true, true);
        emit IDOSNodeStaking.Disallowed(node2);
        vm.prank(owner);
        idosStaking.disallowNode(node2);
    }

    // --- Staking ---

    function test_Staking_BeforeStarting_CantStakeYet() public {
        allowNode(node1);
        vm.expectRevert(abi.encodeWithSignature("NotStarted()"));
        stake(user1, node1, 100);
    }

    function test_Staking_AfterStarting_EpochsLast1Day() public {
        allowNode(node1);
        vm.warp(START_TIME);
        assertEq(idosStaking.EPOCH_LENGTH(), 1 days);

        for (uint256 i = 0; i < 10; i++) {
            assertEq(idosStaking.currentEpoch(), i * 100);
            vm.warp(START_TIME + (i + 1) * 100 days);
        }
    }

    function test_Staking_AfterStarting_CantStakeAgainstZeroAddress() public {
        allowNode(node1);
        vm.warp(START_TIME);
        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSignature("ZeroAddressNode()"));
        idosStaking.stake(address(0), address(0), 100);
    }

    function test_Staking_AfterStarting_CantStakeAgainstSlashedNode() public {
        allowNode(node1);
        vm.warp(START_TIME);
        stake(user1, node1, 1);
        slash(node1);
        vm.expectRevert(abi.encodeWithSignature("NodeIsSlashed(address)", node1));
        stake(user1, node1, 100);
    }

    function test_Staking_AfterStarting_CantStakeAgainstNonAllowedNode() public {
        vm.warp(START_TIME);
        vm.expectRevert(abi.encodeWithSignature("NodeIsNotAllowed(address)", node1));
        stake(user1, node1, 100);
    }

    function test_Staking_AfterStarting_CanOnlyStakePositiveAmounts() public {
        allowNode(node1);
        vm.warp(START_TIME);
        vm.expectRevert(abi.encodeWithSignature("AmountNotPositive(uint256)", 0));
        stake(user1, node1, 0);
    }

    function test_Staking_AfterStarting_EmitsEvents() public {
        allowNode(node1);
        vm.warp(START_TIME);
        vm.expectEmit(true, true, true, true);
        emit IDOSNodeStaking.Staked(user1, node1, 100);
        stake(user1, node1, 100);
    }

    function test_Staking_AfterStarting_Works() public {
        allowNode(node1);
        allowNode(node2);
        vm.warp(START_TIME);

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

    function test_Unstaking_AfterStarting_CantUnstakeFromZeroAddress() public {
        allowNode(node1);
        vm.warp(START_TIME);
        stake(user1, node1, 100);
        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSignature("ZeroAddressNode()"));
        idosStaking.unstake(address(0), 100);
    }

    function test_Unstaking_AfterStarting_CantUnstakeFromSlashedNode() public {
        allowNode(node1);
        vm.warp(START_TIME);
        stake(user1, node1, 100);
        slash(node1);
        vm.expectRevert(abi.encodeWithSignature("NodeIsSlashed(address)", node1));
        unstake(user1, node1, 100);
    }

    function test_Unstaking_AfterStarting_CanOnlyUnstakePositiveAmounts() public {
        allowNode(node1);
        vm.warp(START_TIME);
        stake(user1, node1, 100);
        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSignature("AmountNotPositive(uint256)", 0));
        idosStaking.unstake(node1, 0);
    }

    function test_Unstaking_AfterStarting_CanOnlyUnstakeUpToStakedAmount() public {
        allowNode(node1);
        vm.warp(START_TIME);
        stake(user1, node1, 100);
        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSignature("AmountExceedsStake(uint256,uint256)", 1000, 100));
        idosStaking.unstake(node1, 1000);
        assertEq(idosStaking.stakeByNodeByUser(user1, node1), 100);

        stake(user1, node1, 900);
        vm.prank(user1);
        idosStaking.unstake(node1, 1000);
        assertEq(idosStaking.stakeByNodeByUser(user1, node1), 0);
    }

    function test_Unstaking_AfterStarting_EmitsEvents() public {
        allowNode(node1);
        vm.warp(START_TIME);
        stake(user1, node1, 100);
        vm.expectEmit(true, true, true, true);
        emit IDOSNodeStaking.Unstaked(user1, node1, 100);
        unstake(user1, node1, 100);
    }

    function test_Unstaking_AfterStarting_Works() public {
        allowNode(node1);
        vm.warp(START_TIME);
        stake(user1, node1, 100);
        unstake(user1, node1, 10);
        assertEq(idosStaking.stakeByNodeByUser(user1, node1), 90);
    }

    function test_Unstaking_Withdrawal_CantWithdrawBeforeDelay() public {
        allowNode(node1);
        vm.warp(START_TIME);
        stake(user1, node1, 100);
        unstake(user1, node1, 10);
        // Warp to 14 days to avoid underflow in withdrawUnstaked (it uses block.timestamp - UNSTAKE_DELAY).
        // At 14 days, the unstake from START_TIME (1 day) is still not withdrawable.
        vm.warp(14 days);
        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSignature("NoWithdrawableStake()"));
        idosStaking.withdrawUnstaked();
    }

    function test_Unstaking_Withdrawal_EmitsEvents() public {
        allowNode(node1);
        vm.warp(START_TIME);
        stake(user1, node1, 100);
        unstake(user1, node1, 100);
        // Need > 14 days for timestamp < block.timestamp - UNSTAKE_DELAY to be true
        vm.warp(block.timestamp + 14 days + 1);
        vm.expectEmit(true, true, true, true);
        emit IDOSNodeStaking.UnstakedWithdraw(user1, 100);
        vm.prank(user1);
        idosStaking.withdrawUnstaked();
    }

    function test_Unstaking_Withdrawal_Works() public {
        allowNode(node1);
        vm.warp(START_TIME);
        stake(user1, node1, 100);
        unstake(user1, node1, 10);
        vm.warp(block.timestamp + 1 days);
        unstake(user1, node1, 10);
        // First unstake needs 14 days; warp 14 days so first 10 is withdrawable
        vm.warp(block.timestamp + 14 days);
        vm.prank(user1);
        idosStaking.withdrawUnstaked();
        assertEq(idosToken.balanceOf(user1), 910);
        // Second unstake needs 14 more days
        vm.warp(block.timestamp + 14 days);
        vm.prank(user1);
        idosStaking.withdrawUnstaked();
        assertEq(idosToken.balanceOf(user1), 920);
    }

    // --- Slashing ---

    function test_Slashing_UnknownNodesCantBeSlashed() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSignature("NodeIsUnknown(address)", node1));
        idosStaking.slash(node1);

        address randomAddr = makeAddr("random");
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSignature("NodeIsUnknown(address)", randomAddr));
        idosStaking.slash(randomAddr);
    }

    function test_Slashing_SlashedNodesCantBeSlashed() public {
        allowNode(node1);
        vm.warp(START_TIME);
        stake(user1, node1, 100);
        slash(node1);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSignature("NodeIsSlashed(address)", node1));
        idosStaking.slash(node1);
    }

    function test_Slashing_KnownNodesCanBeSlashedOnlyByOwner() public {
        allowNode(node1);
        vm.warp(START_TIME);
        stake(user1, node1, 100);
        vm.prank(owner);
        idosStaking.slash(node1);
        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", user1));
        idosStaking.slash(node1);
    }

    function test_Slashing_WithdrawingSlashedStakes_CanBeDoneOnlyByOwner() public {
        allowNode(node1);
        vm.warp(START_TIME);
        stake(user1, node1, 100);
        slash(node1);
        vm.prank(owner);
        idosStaking.withdrawSlashedStakes();
        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSignature("OwnableUnauthorizedAccount(address)", user1));
        idosStaking.withdrawSlashedStakes();
    }

    function test_Slashing_WithdrawingSlashedStakes_EmitsEvents() public {
        allowNode(node1);
        vm.warp(START_TIME);
        stake(user1, node1, 100);
        slash(node1);
        vm.expectEmit(true, true, true, true);
        emit IDOSNodeStaking.SlashedWithdraw(100);
        vm.prank(owner);
        idosStaking.withdrawSlashedStakes();
    }

    function test_Slashing_WithdrawingSlashedStakes_Works() public {
        allowNode(node1);
        vm.warp(START_TIME);
        stake(user1, node1, 100);
        slash(node1);
        uint256 prevBalance = idosToken.balanceOf(owner);
        vm.prank(owner);
        idosStaking.withdrawSlashedStakes();
        assertEq(idosToken.balanceOf(owner), prevBalance + 100);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSignature("NoWithdrawableSlashedStakes()"));
        idosStaking.withdrawSlashedStakes();
    }

    // --- Rewards ---

    function test_Rewards_CountOnlyPastEpochs() public {
        allowNode(node1);
        allowNode(node2);
        allowNode(node3);
        vm.warp(START_TIME);
        stake(user1, node1, 100);
        assertEq(withdrawableReward(user1), 0);
    }

    function test_Rewards_IgnoreSlashedStakes() public {
        allowNode(node1);
        allowNode(node2);
        allowNode(node3);
        vm.warp(START_TIME);
        stake(user1, node1, 50);
        stake(user1, node2, 50);
        stake(user2, node2, 300);
        slash(node1);
        vm.warp(block.timestamp + 1 days);
        assertEq(withdrawableReward(user1), 14);
        assertEq(withdrawableReward(user2), 85);
    }

    function test_Rewards_ChangesValueAccordingToEpochReward() public {
        allowNode(node1);
        allowNode(node2);
        allowNode(node3);
        vm.warp(START_TIME);
        stake(user1, node1, 100);
        vm.warp(block.timestamp + 1 days);
        assertEq(withdrawableReward(user1), 100);
        vm.prank(user1);
        idosStaking.withdrawReward();
        assertEq(idosToken.balanceOf(user1), 1000 - 100 + 100);
        vm.prank(owner);
        idosStaking.setEpochReward(200);
        vm.warp(block.timestamp + 1 days);
        assertEq(withdrawableReward(user1), 200);
    }

    function test_Rewards_ChangesValueAndKeepsTrackOfPastEpochRewards() public {
        allowNode(node1);
        allowNode(node2);
        allowNode(node3);
        vm.warp(START_TIME);
        stake(user1, node1, 100);
        vm.warp(block.timestamp + 1 days);
        assertEq(withdrawableReward(user1), 100);
        vm.prank(owner);
        idosStaking.setEpochReward(200);
        vm.warp(block.timestamp + 1 days);
        assertEq(withdrawableReward(user1), 100 + 200);
        vm.prank(owner);
        idosStaking.setEpochReward(300);
        vm.warp(block.timestamp + 1 days);
        assertEq(withdrawableReward(user1), 100 + 200 + 300);
    }

    function test_Rewards_WorksI() public {
        allowNode(node1);
        allowNode(node2);
        allowNode(node3);
        vm.warp(START_TIME);
        stake(user1, node1, 100);
        stake(user2, node1, 300);
        vm.warp(block.timestamp + 1 days);
        assertEq(withdrawableReward(user1), 25);
        vm.prank(user1);
        idosStaking.withdrawReward();
        assertEq(idosToken.balanceOf(user1), 1000 - 100 + 25);
        assertEq(withdrawableReward(user2), 75);
        vm.prank(user2);
        idosStaking.withdrawReward();
        assertEq(idosToken.balanceOf(user2), 1000 - 300 + 75);
        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSignature("NoWithdrawableRewards()"));
        idosStaking.withdrawReward();
    }

    function test_Rewards_WorksII() public {
        allowNode(node1);
        allowNode(node2);
        allowNode(node3);
        vm.warp(START_TIME);
        stake(user1, node1, 50);
        stake(user1, node2, 50);
        stake(user2, node2, 300);
        vm.warp(block.timestamp + 1 days);
        assertEq(withdrawableReward(user1), 25);
        assertEq(withdrawableReward(user2), 75);
        assertEq(withdrawableReward(user3), 0);
        vm.warp(block.timestamp + 9 days);
        assertEq(withdrawableReward(user1), 250);
        assertEq(withdrawableReward(user2), 750);
        assertEq(withdrawableReward(user3), 0);
        slash(node2);
        vm.warp(block.timestamp + 1 days);
        assertEq(withdrawableReward(user1), 350);
        assertEq(withdrawableReward(user2), 750);
        assertEq(withdrawableReward(user3), 0);
        vm.warp(block.timestamp + 10 days);
        assertEq(withdrawableReward(user1), 1350);
        assertEq(withdrawableReward(user2), 750);
        assertEq(withdrawableReward(user3), 0);
        stake(user2, node1, 100);
        stake(user3, node1, 100);
        stake(user3, node3, 200);
        vm.warp(block.timestamp + 1 days);
        assertEq(withdrawableReward(user1), 1361);
        assertEq(withdrawableReward(user2), 772);
        assertEq(withdrawableReward(user3), 66);
    }

    function test_Rewards_WorksIII() public {
        allowNode(node1);
        allowNode(node2);
        allowNode(node3);
        vm.warp(START_TIME);
        stake(user1, node1, 50);
        stake(user1, node2, 50);
        stake(user2, node2, 300);
        vm.warp(block.timestamp + 10 days);
        assertEq(withdrawableReward(user1), 250);
        assertEq(withdrawableReward(user2), 750);
        assertEq(withdrawableReward(user3), 0);
        stake(user3, node1, 100);
        unstake(user1, node2, 50);
        vm.prank(user1);
        idosStaking.withdrawReward();
        assertEq(withdrawableReward(user1), 0);
        assertEq(withdrawableReward(user2), 750);
        assertEq(withdrawableReward(user3), 0);
        vm.warp(block.timestamp + 10 days);
        assertEq(withdrawableReward(user1), 110);
        assertEq(withdrawableReward(user2), 1410);
        assertEq(withdrawableReward(user3), 220);
        vm.warp(block.timestamp + 5 days);
        vm.prank(user1);
        idosStaking.withdrawUnstaked();
        vm.warp(block.timestamp + 5 days);
        assertEq(withdrawableReward(user1), 220);
        assertEq(withdrawableReward(user2), 2070);
        assertEq(withdrawableReward(user3), 440);
    }

    function test_Rewards_EpochRewardsComputation() public {
        allowNode(node1);
        allowNode(node2);
        allowNode(node3);
        vm.warp(START_TIME);
        stake(user1, node1, 100);
        vm.warp(block.timestamp + 5 days);
        assertEq(withdrawableReward(user1), 500);
        vm.prank(owner);
        idosStaking.setEpochReward(200);
        vm.warp(block.timestamp + 2 days);
        vm.prank(user1);
        idosStaking.createEpochCheckpoint(user1);
        assertEq(withdrawableReward(user1), 900);
        vm.warp(block.timestamp + 3 days);
        uint256 withdrawable = withdrawableReward(user1);
        assertEq(withdrawable, 1500);
    }
}
