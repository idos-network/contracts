// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IDOSVesting} from "../src/IDOSVesting.sol";
import {WhaleDisburser} from "../src/WhaleDisburser.sol";

contract TestToken is ERC20 {
    constructor() ERC20("Test Token", "TST") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract WhaleDisburserTest is Test {
    WhaleDisburser wd;
    TestToken token;

    address caller;
    address alice;
    address bob;

    uint64 vestingStart;

    function setUp() public {
        wd = new WhaleDisburser();
        token = new TestToken();

        caller = makeAddr("caller");
        alice = makeAddr("alice");
        bob = makeAddr("bob");

        vestingStart = uint64(block.timestamp + 1 days);

        token.mint(caller, 10_000 ether);
        vm.prank(caller);
        token.approve(address(wd), type(uint256).max);
    }

    function test_TransfersImmediateAmountToBeneficiary() public {
        uint256 total = 400 ether;
        vm.prank(caller);
        wd.disburse(IERC20(address(token)), alice, total, vestingStart);

        assertEq(token.balanceOf(alice), total / 6);
    }

    function test_DeploysVestingWalletWithCorrectParams() public {
        vm.prank(caller);
        address wallet = wd.disburse(IERC20(address(token)), alice, 400 ether, vestingStart);

        IDOSVesting v = IDOSVesting(payable(wallet));
        assertEq(v.owner(), alice);
        assertEq(v.start(), vestingStart);
        assertEq(v.duration(), 150 days);
        assertEq(v.cliff(), uint256(vestingStart) + 30 days);
    }

    function test_TransfersVestedAmountToVestingWallet() public {
        uint256 total = 400 ether;
        vm.prank(caller);
        address wallet = wd.disburse(IERC20(address(token)), alice, total, vestingStart);

        assertEq(token.balanceOf(wallet), total - total / 6);
    }

    function test_EmitsDisbursedEvent() public {
        uint256 total = 400 ether;
        address expectedWallet = vm.computeCreateAddress(address(wd), vm.getNonce(address(wd)));

        vm.prank(caller);
        vm.expectEmit();
        emit WhaleDisburser.Disbursed(alice, total, total / 6, expectedWallet, total - total / 6);
        wd.disburse(IERC20(address(token)), alice, total, vestingStart);
    }

    function test_RevertsWithoutApproval() public {
        address noApproval = makeAddr("noApproval");
        token.mint(noApproval, 1000 ether);

        vm.prank(noApproval);
        vm.expectRevert();
        wd.disburse(IERC20(address(token)), alice, 400 ether, vestingStart);
    }

    function test_TwoCallsForSameBeneficiaryCreateSeparateWallets() public {
        uint256 total1 = 600 ether;
        uint256 total2 = 300 ether;

        vm.prank(caller);
        address wallet1 = wd.disburse(IERC20(address(token)), alice, total1, vestingStart);

        vm.prank(caller);
        address wallet2 = wd.disburse(IERC20(address(token)), alice, total2, vestingStart);

        assertTrue(wallet1 != wallet2, "wallets should be distinct");
        assertEq(token.balanceOf(wallet1), total1 - total1 / 6);
        assertEq(token.balanceOf(wallet2), total2 - total2 / 6);
        assertEq(token.balanceOf(alice), total1 / 6 + total2 / 6);
    }

    function test_SplitWithTotalAmountZero() public {
        uint256 aliceBefore = token.balanceOf(alice);

        vm.prank(caller);
        vm.expectEmit();
        emit WhaleDisburser.Disbursed(alice, 0, 0, address(0), 0);
        address wallet = wd.disburse(IERC20(address(token)), alice, 0, vestingStart);

        assertEq(wallet, address(0));
        assertEq(token.balanceOf(alice), aliceBefore);
    }

    function test_SplitWithTotalAmountOne() public {
        vm.prank(caller);
        address wallet = wd.disburse(IERC20(address(token)), alice, 1, vestingStart);

        assertEq(token.balanceOf(alice), 0);
        assertEq(token.balanceOf(wallet), 1);
    }

    function test_SplitWithTotalAmountSix() public {
        vm.prank(caller);
        address wallet = wd.disburse(IERC20(address(token)), alice, 6, vestingStart);

        assertEq(token.balanceOf(alice), 1);
        assertEq(token.balanceOf(wallet), 5);
    }

    function test_SplitWithTotalAmountFive() public {
        vm.prank(caller);
        address wallet = wd.disburse(IERC20(address(token)), alice, 5, vestingStart);

        assertEq(token.balanceOf(alice), 0);
        assertEq(token.balanceOf(wallet), 5);
    }

    function test_VestingWalletReleasesTokensCorrectly() public {
        uint256 total = 600 ether;
        vm.prank(caller);
        address wallet = wd.disburse(IERC20(address(token)), alice, total, vestingStart);

        IDOSVesting v = IDOSVesting(payable(wallet));
        uint256 immediateAmount = total / 6;
        uint256 vestedAmount = total - immediateAmount;

        // Before vesting start: nothing releasable.
        vm.warp(vestingStart - 1);
        assertEq(v.releasable(address(token)), 0);

        // Before cliff: nothing releasable.
        vm.warp(vestingStart + 30 days - 1);
        assertEq(v.releasable(address(token)), 0);

        // At cliff: exactly 30/150 of vested amount unlocked.
        vm.warp(vestingStart + 30 days);
        assertEq(v.releasable(address(token)), vestedAmount / 5);

        // Halfway through vesting (75 days).
        vm.warp(vestingStart + 75 days);
        assertEq(v.releasable(address(token)), vestedAmount / 2);

        // Full duration: everything releasable.
        vm.warp(vestingStart + 150 days);
        assertEq(v.releasable(address(token)), vestedAmount);

        // Actually release and verify alice receives the tokens.
        uint256 aliceBalanceBefore = token.balanceOf(alice);
        v.release(address(token));
        assertEq(token.balanceOf(alice), aliceBalanceBefore + vestedAmount);
        assertEq(token.balanceOf(wallet), 0);
    }
}
