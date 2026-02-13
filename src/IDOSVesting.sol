// SPDX-License-Identifier: MIT

pragma solidity ^0.8.20;

import {VestingWallet} from "@openzeppelin/contracts/finance/VestingWallet.sol";
import {VestingWalletCliff} from "@openzeppelin/contracts/finance/VestingWalletCliff.sol";

contract IDOSVesting is VestingWallet, VestingWalletCliff {
    constructor(
        address beneficiary,
        uint64 startTimestamp,
        uint64 durationSeconds,
        uint64 cliffSeconds
    )
        payable
        VestingWallet(beneficiary, startTimestamp, durationSeconds)
        VestingWalletCliff(cliffSeconds)
    {}

    /**
     * @dev Virtual implementation of the vesting formula. This returns the amount vested, as a function of time, for
     * an asset given its total historical allocation. Returns 0 if the {cliff} timestamp is not met.
     *
     * IMPORTANT: The cliff not only makes the schedule return 0, but it also ignores every possible side
     * effect from calling the inherited implementation (i.e. `super._vestingSchedule`). Carefully consider
     * this caveat if the overridden implementation of this function has any (e.g. writing to memory or reverting).
     */
    function _vestingSchedule(
        uint256 totalAllocation,
        uint64 timestamp
    )
        internal view override(VestingWallet, VestingWalletCliff)
        returns (uint256)
    {
        return timestamp < cliff() ? 0 : super._vestingSchedule(totalAllocation, timestamp);
    }
}
