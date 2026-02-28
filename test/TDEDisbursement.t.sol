// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IDOSVesting} from "../src/IDOSVesting.sol";
import {TDEDisbursement, Modality} from "../src/TDEDisbursement.sol";

contract TestToken is ERC20 {
    constructor() ERC20("Test Token", "TST") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract TDEDisbursementTest is Test {
    TDEDisbursement tde;
    TestToken token;

    address disburser;
    address alice;
    address bob;
    address stranger;

    function setUp() public {
        disburser = makeAddr("disburser");
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        stranger = makeAddr("stranger");

        token = new TestToken();
        tde = new TDEDisbursement(IERC20(address(token)), disburser);

        token.mint(disburser, 1_000_000 ether);
        vm.prank(disburser);
        token.approve(address(tde), type(uint256).max);
    }

    // ---------------------------------------------------------------
    // Constructor validation
    // ---------------------------------------------------------------

    function test_RevertsWithZeroAddressToken() public {
        vm.expectRevert(TDEDisbursement.ZeroAddressToken.selector);
        new TDEDisbursement(IERC20(address(0)), disburser);
    }

    function test_RevertsWithZeroAddressDisburser() public {
        vm.expectRevert(TDEDisbursement.ZeroAddressDisburser.selector);
        new TDEDisbursement(IERC20(address(token)), address(0));
    }

    function test_SetsImmutablesCorrectly() public view {
        assertEq(address(tde.IDOS_TOKEN()), address(token));
        assertEq(tde.DISBURSER(), disburser);
    }

    // ---------------------------------------------------------------
    // Access control
    // ---------------------------------------------------------------

    function test_DisburseRevertsForNonDisburser() public {
        vm.prank(stranger);
        vm.expectRevert(TDEDisbursement.OnlyCallableByDisburser.selector);
        tde.disburse(alice, 100 ether, Modality.DIRECT);
    }

    function test_EnsureVestingContractExistsRevertsForNonDisburser() public {
        vm.prank(stranger);
        vm.expectRevert(TDEDisbursement.OnlyCallableByDisburser.selector);
        tde.ensureVestingContractExists(alice, Modality.VESTED_0_12);
    }

    // ---------------------------------------------------------------
    // VESTING_PARAMS_FOR_MODALITY
    // ---------------------------------------------------------------

    function test_VestingParamsRevertsForDirect() public {
        vm.expectRevert(TDEDisbursement.DirectIsNotVested.selector);
        tde.VESTING_PARAMS_FOR_MODALITY(Modality.DIRECT);
    }

    function test_VestingParamsReturnsCorrectValues() public view {
        _assertParams(Modality.VESTED_0_12, 1770303600, 31536000, 2419200);
        _assertParams(Modality.VESTED_0_120, 1770303600, 315532800, 2419200);
        _assertParams(Modality.VESTED_1_5, 1772722800, 13219200, 2678400);
        _assertParams(Modality.VESTED_1_6, 1772722800, 15897600, 2678400);
        _assertParams(Modality.VESTED_1_60, 1772722800, 157766400, 2678400);
        _assertParams(Modality.VESTED_6_12, 1785942000, 31536000, 2678400);
        _assertParams(Modality.VESTED_6_24, 1785942000, 63158400, 2678400);
        _assertParams(Modality.VESTED_12_24, 1801839600, 63158400, 2419200);
        _assertParams(Modality.VESTED_12_36, 1801839600, 94694400, 2419200);
    }

    function _assertParams(Modality modality, uint64 expectedStart, uint64 expectedDuration, uint64 expectedCliff)
        internal
        view
    {
        (uint64 start, uint64 duration, uint64 cliff) = tde.VESTING_PARAMS_FOR_MODALITY(modality);
        assertEq(start, expectedStart);
        assertEq(duration, expectedDuration);
        assertEq(cliff, expectedCliff);
    }

    function test_VestingParamsRevertsForUnknownModality() public {
        // Solidity 0.8.x panics (0x21) on out-of-range enum conversion at the
        // ABI decoding level, so we must use a raw call to observe the revert
        // as if it was called from inside the contract.
        (bool success,) = address(tde).call(abi.encodeWithSelector(tde.VESTING_PARAMS_FOR_MODALITY.selector, uint8(10)));
        assertFalse(success);
    }

    // ---------------------------------------------------------------
    // ensureVestingContractExists
    // ---------------------------------------------------------------

    function test_EnsureCreatesNewContract() public {
        vm.prank(disburser);
        (IDOSVesting vestingContract, bool created) = tde.ensureVestingContractExists(alice, Modality.VESTED_0_12);

        assertTrue(created);
        assertTrue(address(vestingContract) != address(0));
    }

    function test_EnsureIsIdempotent() public {
        vm.prank(disburser);
        (IDOSVesting first, bool created1) = tde.ensureVestingContractExists(alice, Modality.VESTED_0_12);
        assertTrue(created1);

        vm.prank(disburser);
        (IDOSVesting second, bool created2) = tde.ensureVestingContractExists(alice, Modality.VESTED_0_12);
        assertFalse(created2);

        assertEq(address(first), address(second));
    }

    function test_EnsureDeploysCorrectVestingParams() public {
        vm.prank(disburser);
        (IDOSVesting v,) = tde.ensureVestingContractExists(alice, Modality.VESTED_0_12);

        (uint64 expectedStart, uint64 expectedDuration, uint64 expectedCliff) =
            tde.VESTING_PARAMS_FOR_MODALITY(Modality.VESTED_0_12);

        assertEq(v.owner(), alice);
        assertEq(v.start(), expectedStart);
        assertEq(v.duration(), expectedDuration);
        assertEq(v.cliff(), uint256(expectedStart) + uint256(expectedCliff));
    }

    function test_EnsureStoresInMapping() public {
        vm.prank(disburser);
        (IDOSVesting v,) = tde.ensureVestingContractExists(alice, Modality.VESTED_1_6);

        assertEq(address(tde.vestingContracts(alice, Modality.VESTED_1_6)), address(v));
    }

    function test_DifferentBeneficiariesGetDifferentContracts() public {
        vm.prank(disburser);
        (IDOSVesting vAlice,) = tde.ensureVestingContractExists(alice, Modality.VESTED_0_12);

        vm.prank(disburser);
        (IDOSVesting vBob,) = tde.ensureVestingContractExists(bob, Modality.VESTED_0_12);

        assertTrue(address(vAlice) != address(vBob));
    }

    function test_SameBeneficiaryDifferentModalitiesGetDifferentContracts() public {
        vm.prank(disburser);
        (IDOSVesting v1,) = tde.ensureVestingContractExists(alice, Modality.VESTED_0_12);

        vm.prank(disburser);
        (IDOSVesting v2,) = tde.ensureVestingContractExists(alice, Modality.VESTED_12_36);

        assertTrue(address(v1) != address(v2));
    }

    function test_EnsureRevertsForDirectModality() public {
        vm.prank(disburser);
        vm.expectRevert(TDEDisbursement.DirectIsNotVested.selector);
        tde.ensureVestingContractExists(alice, Modality.DIRECT);
    }

    // ---------------------------------------------------------------
    // disburse
    // ---------------------------------------------------------------

    function test_DisburseRevertsForZeroAddressBeneficiary() public {
        vm.prank(disburser);
        vm.expectRevert(TDEDisbursement.ZeroAddressBeneficiary.selector);
        tde.disburse(address(0), 100 ether, Modality.DIRECT);
    }

    function test_DisburseVestedRevertsForZeroAddressBeneficiary() public {
        vm.prank(disburser);
        vm.expectRevert(TDEDisbursement.ZeroAddressBeneficiary.selector);
        tde.disburse(address(0), 100 ether, Modality.VESTED_0_12);
    }

    function test_DisburseDirectTransfersToBeneficiary() public {
        uint256 amount = 500 ether;

        vm.prank(disburser);
        tde.disburse(alice, amount, Modality.DIRECT);

        assertEq(token.balanceOf(alice), amount);
        assertEq(address(tde.vestingContracts(alice, Modality.DIRECT)), address(0));
    }

    function test_DisburseVestedCreatesContractAndTransfers() public {
        uint256 amount = 500 ether;

        vm.prank(disburser);
        tde.disburse(alice, amount, Modality.VESTED_0_12);

        address vestingAddr = address(tde.vestingContracts(alice, Modality.VESTED_0_12));
        assertTrue(vestingAddr != address(0));
        assertEq(token.balanceOf(vestingAddr), amount);
        assertEq(token.balanceOf(alice), 0);
    }

    function test_DisburseVestedUsesExistingContract() public {
        vm.prank(disburser);
        tde.disburse(alice, 100 ether, Modality.VESTED_1_5);
        address vestingAddr = address(tde.vestingContracts(alice, Modality.VESTED_1_5));

        vm.prank(disburser);
        tde.disburse(alice, 200 ether, Modality.VESTED_1_5);

        assertEq(address(tde.vestingContracts(alice, Modality.VESTED_1_5)), vestingAddr);
        assertEq(token.balanceOf(vestingAddr), 300 ether);
    }

    function test_DisburseDirectEmitsDisbursedEvent() public {
        uint256 amount = 500 ether;

        vm.prank(disburser);
        vm.expectEmit();
        emit TDEDisbursement.Disbursed(alice, alice, amount, Modality.DIRECT);
        tde.disburse(alice, amount, Modality.DIRECT);
    }

    function test_DisburseVestedEmitsDisbursedEvent() public {
        uint256 amount = 500 ether;

        vm.prank(disburser);
        tde.disburse(alice, amount, Modality.VESTED_0_12);
        address vestingAddr = address(tde.vestingContracts(alice, Modality.VESTED_0_12));

        vm.prank(disburser);
        vm.expectEmit();
        emit TDEDisbursement.Disbursed(alice, vestingAddr, 200 ether, Modality.VESTED_0_12);
        tde.disburse(alice, 200 ether, Modality.VESTED_0_12);
    }

    function test_DisburseRevertsWithInsufficientAllowance() public {
        address noApproval = makeAddr("noApproval");
        token.mint(noApproval, 1000 ether);

        TDEDisbursement tde2 = new TDEDisbursement(IERC20(address(token)), noApproval);

        vm.prank(noApproval);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, tde2, 0, 100 ether));
        tde2.disburse(alice, 100 ether, Modality.DIRECT);
    }

    // ---------------------------------------------------------------
    // Integration: vesting release over time
    // ---------------------------------------------------------------

    function test_VestingContractReleasesTokensCorrectly() public {
        uint256 amount = 1000 ether;

        vm.prank(disburser);
        tde.disburse(alice, amount, Modality.VESTED_0_12);

        IDOSVesting v = IDOSVesting(payable(address(tde.vestingContracts(alice, Modality.VESTED_0_12))));

        (uint64 startTs, uint64 durationSecs, uint64 cliffSecs) = tde.VESTING_PARAMS_FOR_MODALITY(Modality.VESTED_0_12);

        // Before start: nothing releasable.
        vm.warp(startTs - 1);
        assertEq(v.releasable(address(token)), 0);

        // Before cliff: nothing releasable.
        vm.warp(startTs + cliffSecs - 1);
        assertEq(v.releasable(address(token)), 0);

        // At cliff: proportional amount unlocked.
        vm.warp(startTs + cliffSecs);
        uint256 atCliff = v.releasable(address(token));
        assertGt(atCliff, 0);
        assertEq(atCliff, (amount * uint256(cliffSecs)) / uint256(durationSecs));

        // After full duration: everything releasable.
        vm.warp(startTs + durationSecs);
        assertEq(v.releasable(address(token)), amount);

        // Actually release and verify alice receives the tokens.
        uint256 aliceBefore = token.balanceOf(alice);
        v.release(address(token));
        assertEq(token.balanceOf(alice), aliceBefore + amount);
        assertEq(token.balanceOf(address(v)), 0);
    }
}
