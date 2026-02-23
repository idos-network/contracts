// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IDOSVesting} from "./IDOSVesting.sol";

contract WhaleDisburser {
    using SafeERC20 for IERC20;

    uint64 public constant VESTING_DURATION = 150 days;
    uint64 public constant VESTING_CLIFF = 30 days;

    error TotalAmountIsZero();
    error ZeroAddressBeneficiary();

    event Disbursed(
        address indexed beneficiary,
        uint256 totalAmount,
        uint256 immediateAmount,
        address vestingWallet,
        uint256 vestedAmount
    );

    function disburse(
        IERC20 token,
        address beneficiary,
        uint256 totalAmount,
        uint64 vestingStart
    ) external returns (address) {
        if (totalAmount == 0) revert TotalAmountIsZero();
        if (beneficiary == address(0)) revert ZeroAddressBeneficiary();

        uint256 immediateAmount = totalAmount / 6;
        if (immediateAmount > 0) {
            token.safeTransferFrom(msg.sender, beneficiary, immediateAmount);
        }

        address vestingWallet;
        uint256 vestedAmount = totalAmount - immediateAmount;
        if (vestedAmount > 0) {
            vestingWallet = address(new IDOSVesting(
                beneficiary,
                vestingStart,
                VESTING_DURATION,
                VESTING_CLIFF
            ));
            token.safeTransferFrom(msg.sender, vestingWallet, vestedAmount);
        }

        emit Disbursed(beneficiary, totalAmount, immediateAmount, vestingWallet, vestedAmount);

        return vestingWallet;
    }
}
