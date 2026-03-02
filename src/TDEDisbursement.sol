// SPDX-License-Identifier: MIT
// cSpell:words keccak256

pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IDOSVesting} from "./IDOSVesting.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

enum Modality {
    DIRECT,
    VESTED_0_12,
    VESTED_0_120,
    VESTED_1_5,
    VESTED_1_6,
    VESTED_1_60,
    VESTED_6_12,
    VESTED_6_24,
    VESTED_12_24,
    VESTED_12_36
}

/// @title TDEDisbursement
/// @notice Disburses IDOS tokens to beneficiaries, either directly or through
///         per-beneficiary vesting contracts. Each (beneficiary, modality) pair
///         gets at most one deterministically deployed IDOSVesting contract,
///         enabling multiple disbursements to accumulate in the same vesting wallet.
contract TDEDisbursement {
    using SafeERC20 for IERC20;

    IERC20 public immutable IDOS_TOKEN;
    address public immutable DISBURSER;

    mapping(address beneficiary => mapping(Modality modality => IDOSVesting vestingWallet)) public vestingContracts;

    event Disbursed(address indexed beneficiary, address transferTarget, uint256 amount, Modality modality);

    error DirectIsNotVested();
    error UnknownModality(Modality modality);
    error ZeroAddressToken();
    error ZeroAddressDisburser();
    error ZeroAddressBeneficiary();
    error OnlyCallableByDisburser();

    constructor(IERC20 idosToken, address disburser) {
        if (address(idosToken) == address(0)) revert ZeroAddressToken();
        if (disburser == address(0)) revert ZeroAddressDisburser();

        IDOS_TOKEN = idosToken;
        DISBURSER = disburser;
    }

    function _onlyDisburser() internal view {
        if (msg.sender != DISBURSER) revert OnlyCallableByDisburser();
    }

    modifier onlyDisburser() {
        _onlyDisburser();
        _;
    }

    /// @notice Disburse tokens to a beneficiary. For DIRECT modality, tokens go
    ///         straight to the beneficiary. For vested modalities, tokens go to a
    ///         deterministic IDOSVesting contract (created on first use).
    /// @param beneficiary The address that will ultimately receive/own the tokens.
    /// @param amount The number of tokens (in wei) to transfer.
    /// @param modality The disbursement modality, which determines whether tokens
    ///        are sent directly or locked in a vesting schedule.
    function disburse(address beneficiary, uint256 amount, Modality modality) external onlyDisburser {
        if (beneficiary == address(0)) revert ZeroAddressBeneficiary();
        address transferTarget = beneficiary;

        if (modality != Modality.DIRECT) {
            (IDOSVesting vestingContract,) = ensureVestingContractExists(beneficiary, modality);
            transferTarget = address(vestingContract);
        }

        IDOS_TOKEN.safeTransferFrom(DISBURSER, transferTarget, amount);

        emit Disbursed(beneficiary, transferTarget, amount, modality);
    }

    /// @notice Returns (or creates) the vesting contract for a given beneficiary
    ///         and modality. Uses CREATE2 with a salt derived from the beneficiary
    ///         and modality, so the address is deterministic.
    /// @param beneficiary The address that will own the vesting contract.
    /// @param modality The vesting schedule to use (must not be DIRECT).
    /// @return vestingContract The IDOSVesting contract for this (beneficiary, modality) pair.
    /// @return created True if the contract was deployed in this call.
    function ensureVestingContractExists(address beneficiary, Modality modality)
        public
        onlyDisburser
        returns (IDOSVesting vestingContract, bool created)
    {
        created = false;
        vestingContract = vestingContracts[beneficiary][modality];

        if (address(vestingContract) == address(0)) {
            (uint64 startTimestamp, uint64 durationSeconds, uint64 cliffSeconds) = VESTING_PARAMS_FOR_MODALITY(modality);

            created = true;
            vestingContract = new IDOSVesting{salt: keccak256(abi.encode(beneficiary, modality))}(
                beneficiary, startTimestamp, durationSeconds, cliffSeconds
            );

            vestingContracts[beneficiary][modality] = vestingContract;
        }
    }

    /// @notice Returns the vesting schedule parameters for a given modality.
    /// @param modality The vesting modality (must not be DIRECT).
    /// @return startTimestamp Unix timestamp when vesting accumulation begins.
    /// @return durationSeconds Total vesting duration in seconds.
    /// @return cliffSeconds Cliff period in seconds before any tokens are claimable.
    // forge-lint: disable-next-line(mixed-case-function): I want it to look like an immutable mapping.
    function VESTING_PARAMS_FOR_MODALITY(Modality modality)
        public
        pure
        returns (uint64 startTimestamp, uint64 durationSeconds, uint64 cliffSeconds)
    {
        if (modality == Modality.DIRECT) revert DirectIsNotVested();

        // In some cases, the accumulation start is 1 month before TDE. That's on purpose, in
        // order to have a full month of vesting claimable at TDE date.
        // Vesting schedule parameters:              accumulation start, duration, cliff
        if (modality == Modality.VESTED_0_12) {
            return (1770303600, 31536000, 2419200); //  TDE - 1mo + 0mo,    ~12mo,   28d
        }
        if (modality == Modality.VESTED_0_120) {
            return (1770303600, 315532800, 2419200); // TDE - 1mo + 0mo,     ~10y,   28d
        }
        if (modality == Modality.VESTED_1_5) {
            return (1772722800, 13219200, 2678400); //  TDE - 1mo + 1mo,     ~5mo,   31d
        }
        if (modality == Modality.VESTED_1_6) {
            return (1772722800, 15897600, 2678400); //  TDE - 1mo + 1mo,     ~6mo,   31d
        }
        if (modality == Modality.VESTED_1_60) {
            return (1772722800, 157766400, 2678400); // TDE - 1mo + 1mo,      ~5y,   31d
        }
        if (modality == Modality.VESTED_6_12) {
            return (1785942000, 31536000, 2678400); //  TDE - 1mo + 6mo,    ~12mo,   31d
        }
        if (modality == Modality.VESTED_6_24) {
            return (1785942000, 63158400, 2678400); //  TDE - 1mo + 6mo,      ~2y,   31d
        }
        if (modality == Modality.VESTED_12_24) {
            return (1801839600, 63158400, 2419200); //  TDE - 1mo + 12mo,     ~2y,   28d
        }
        if (modality == Modality.VESTED_12_36) {
            return (1801839600, 94694400, 2419200); //  TDE - 1mo + 12mo,     ~3y,   28d
        }

        revert UnknownModality(modality);
    }
}
