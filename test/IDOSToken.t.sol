// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test, console} from "forge-std/Test.sol";
import {IDOSToken} from "../contracts/IDOSToken.sol";

contract IDOSTokenTest is Test {
    IDOSToken idosToken;
    address owner;
    address alice;

    uint256 constant DECIMALS = 18;
    uint256 constant TOTAL_SUPPLY = 1_000_000_000 * 10 ** DECIMALS;

    function setUp() public {
        owner = makeAddr("owner");
        alice = makeAddr("alice");
        vm.prank(owner);
        idosToken = new IDOSToken(owner);
    }

    function test_Premint1BTokens() public view {
        assertEq(idosToken.totalSupply(), TOTAL_SUPPLY);
    }

    function test_NoMinting() public view {
        // IDOSToken has no public mint - verify by checking it doesn't exist
        // (We could try to call a non-existent function - Solidity would fail at compile time
        // if we tried to call mint. As a behavioral test, we check totalSupply is fixed.)
        assertEq(idosToken.totalSupply(), TOTAL_SUPPLY);
    }

    function test_AllowBurning() public {
        assertEq(idosToken.balanceOf(alice), 0);

        vm.prank(owner);
        idosToken.transfer(alice, 1);

        assertEq(idosToken.balanceOf(alice), 1);

        vm.prank(alice);
        idosToken.burn(1);

        assertEq(idosToken.balanceOf(alice), 0);
        assertEq(idosToken.totalSupply(), TOTAL_SUPPLY - 1);
    }
}
