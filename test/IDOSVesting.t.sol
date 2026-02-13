// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test, console} from "forge-std/Test.sol";
import {IDOSToken} from "../contracts/IDOSToken.sol";
import {IDOSVesting} from "../contracts/IDOSVesting.sol";

contract IDOSVestingTest is Test {
    IDOSToken idosToken;
    IDOSVesting idosVesting;
    address owner;
    address alice;

    function setUp() public {
        owner = makeAddr("owner");
        alice = makeAddr("alice");
        vm.prank(owner);
        idosToken = new IDOSToken(owner);
    }

    function test_WorksWithoutCliff() public {
        uint256 now_ = block.timestamp;
        uint256 start = now_ + 10 days;
        uint256 vestingDuration = 100 days;
        uint256 cliffDuration = 0;

        idosVesting = new IDOSVesting(
            alice,
            uint64(start),
            uint64(vestingDuration),
            uint64(cliffDuration)
        );

        vm.prank(owner);
        idosToken.transfer(address(idosVesting), 100);

        // before start
        assertEq(idosVesting.releasable(address(idosToken)), 0);
        vm.warp(now_ + 9 days);
        assertEq(idosVesting.releasable(address(idosToken)), 0);
        vm.warp(now_ + 10 days);
        assertEq(idosVesting.releasable(address(idosToken)), 0);

        // after cliff (no cliff, so immediately after start)
        vm.warp(now_ + 11 days);
        assertEq(idosVesting.releasable(address(idosToken)), 1);
        vm.warp(now_ + 19 days);
        assertEq(idosVesting.releasable(address(idosToken)), 9);
        vm.warp(now_ + 20 days);
        assertEq(idosVesting.releasable(address(idosToken)), 10);
        vm.warp(now_ + 100 days);
        assertEq(idosVesting.releasable(address(idosToken)), 90);
        vm.warp(now_ + 110 days);
        assertEq(idosVesting.releasable(address(idosToken)), 100);

        // after end
        vm.warp(now_ + 111 days);
        assertEq(idosVesting.releasable(address(idosToken)), 100);
        vm.warp(now_ + 1000 days);
        assertEq(idosVesting.releasable(address(idosToken)), 100);
    }

    function test_WorksWithCliff() public {
        uint256 now_ = block.timestamp;
        uint256 start = now_ + 10 days;
        uint256 vestingDuration = 100 days;
        uint256 cliffDuration = 10 days;

        idosVesting = new IDOSVesting(
            alice,
            uint64(start),
            uint64(vestingDuration),
            uint64(cliffDuration)
        );

        vm.prank(owner);
        idosToken.transfer(address(idosVesting), 100);

        // before start
        assertEq(idosVesting.releasable(address(idosToken)), 0);
        vm.warp(now_ + 1 days);
        assertEq(idosVesting.releasable(address(idosToken)), 0);
        vm.warp(now_ + 9 days);
        assertEq(idosVesting.releasable(address(idosToken)), 0);
        vm.warp(now_ + 10 days);
        assertEq(idosVesting.releasable(address(idosToken)), 0);

        // before cliff
        vm.warp(now_ + 11 days);
        assertEq(idosVesting.releasable(address(idosToken)), 0);
        vm.warp(now_ + 19 days);
        assertEq(idosVesting.releasable(address(idosToken)), 0);

        // after cliff
        vm.warp(now_ + 20 days);
        assertEq(idosVesting.releasable(address(idosToken)), 10);
        vm.warp(now_ + 100 days);
        assertEq(idosVesting.releasable(address(idosToken)), 90);
        vm.warp(now_ + 110 days);
        assertEq(idosVesting.releasable(address(idosToken)), 100);

        // after end
        vm.warp(now_ + 111 days);
        assertEq(idosVesting.releasable(address(idosToken)), 100);
        vm.warp(now_ + 1000 days);
        assertEq(idosVesting.releasable(address(idosToken)), 100);
    }
}
