// SPDX-License-Identifier: MIT
// cSpell:words idOS
pragma solidity ^0.8.27;

import {Test, console} from "forge-std/Test.sol";
import {IDOSToken} from "../src/IDOSToken.sol";

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

    function test_PreMint1BTokens() public view {
        assertEq(idosToken.totalSupply(), TOTAL_SUPPLY);
    }

    function test_NoMinting() public {
        (bool success,) = address(idosToken).call(
            abi.encodeWithSignature("mint(address,uint256)", owner, 1)
        );
        assertFalse(success);
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
