// SPDX-License-Identifier: MIT
// cSpell:words overdisbursement

pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title CCADisbursementTracker
 * @author Paulo Koch <pkoch@idos.network>
 * @notice Tracks the disbursements awarded by a CCA contract for sales with non-uniform disbursement conditions.
 *
 * A CCA contract assumes that all tokens are sold on equal terms throughout the whole sale. However, it's very
 * common for sales to have phases with different disbursement conditions (e.g. early bird bonuses or discounts,
 * some phases might follow a vesting schedule, etc.). For those cases, this contract is meant to be a stand-in for
 * the token being sold by the CCA (the "original token"). It will record the amounts that the CCA contract wanted
 * to send to each holder, but no movement of tokens will actually take place -- neither of this one or of the original.
 * A disburser is meant to enact them independently of this contract after the sale is fully claimed, and use this contract
 * to record how those disbursements have been made.
 *
 * Note well: in case that there's any logic around discount, bonus, or anything that affects the amount of tokens,
 * that's to be handled independently. To keep the design simple, this contract only remembers the amounts the CCA is
 * aware of.
 *
 * You should mint a total supply of this token that matches the original token's intended amount to be sold by the CCA.
 * Remember to align CCA's `totalSupply` with this contract's `initialSupply`, since that's a hard requirement for CCA.
 * See <https://github.com/Uniswap/continuous-clearing-auction/blob/0f758dd5260f2dad2ce6f6e7358c65c15bcf5168/docs/TechnicalDocumentation.md#extra-funds-sent-to-the-auction-are-not-recoverable>.
 * Then, you construct the CCA and let it run as usual.
 *
 * Every time that the CCA contract wants to transfer tokens to a holder, instead it:
 * - Burns that amount of this token
 * - No movement of the original token takes place
 * - This contract keeps track that that amount should be later on disbursed to the holder. These are called "missing
 * disbursements".
 *
 * This contract only allows disbursements to be recorded after the sale is fully claimed. It considers the sale fully
 * claimed when the total supply of this token is 0. This is achieved by calling `sweepUnsoldTokens` and by ensuring
 * that all `claimTokens` or `claimTokensBatch` calls have been made.
 *
 * Note well: `claimTokensBatch` makes things harder to track 1:1 with this contract, since that can make a single
 * transfer that contains bids from different phases of the sale.
 *
 * The disburser should call the `recordDisbursements` function to record disbursements, providing the txHash where the
 * actual disbursement took place and the amount disbursed, so that the original token distribution can be verified. A
 * disburser might choose to split disbursements in tranches, either because the allocation was done in different
 * phases of the sales, or for any other reason. The uniqueness and non-zero-ness of txHash isn't enforced
 * by design to allow for flexibility in the disburser's strategy.
 */

contract CCADisbursementTracker is ERC20 {
    /// @notice Address of the CCA contract; only this address can hold tokens.
    address immutable _CCA_CONTRACT;
    /// @notice Address authorized to record disbursements after the sale is fully claimed.
    address immutable _DISBURSER;
    /// @notice Total supply minted at deployment; must match the CCA's totalSupply requirement.
    uint256 immutable _INITIAL_SUPPLY;

    /// @notice Returns the CCA contract address.
    function ccaContract() public view returns (address) {
        return _CCA_CONTRACT;
    }

    /// @notice Returns the disburser address.
    function disburser() public view returns (address) {
        return _DISBURSER;
    }

    /// @notice Returns the initial supply minted at deployment.
    function initialSupply() public view returns (uint256) {
        return _INITIAL_SUPPLY;
    }

    /// @dev Set to true after the initial mint in the constructor; prevents further minting.
    bool private _initialMintDone;

    error ZeroAddressCCAContract();
    error ZeroAddressDisburser();
    error NoInitialSupply();

    /// @notice Constructs the CCADisbursementTracker and mints the initial supply to the CCA contract.
    /// @param name ERC20 token name.
    /// @param symbol ERC20 token symbol.
    /// @param initialSupply_ Total supply to mint; must match the CCA's totalSupply requirement.
    /// @param ccaContract_ Address of the CCA contract that will hold and sell the tokens.
    /// @param disburser_ Address authorized to record disbursements after the sale is fully claimed.
    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply_,
        address ccaContract_,
        address disburser_
    ) ERC20(name, symbol) {
        if (ccaContract_ == address(0)) revert ZeroAddressCCAContract();
        if (disburser_ == address(0)) revert ZeroAddressDisburser();
        if (initialSupply_ == 0) revert NoInitialSupply();

        _CCA_CONTRACT = ccaContract_;
        _DISBURSER = disburser_;
        _INITIAL_SUPPLY = initialSupply_;
        super._mint(ccaContract_, initialSupply_);
        _initialMintDone = true;
    }

    error CCASelfTransferNotAllowed();
    error InitialMintAlreadyDone();
    error SimpleBurnsNotAllowed();
    error TokenIsUntransferable();

    /// @dev Overrides ERC20._update to make tokens effectively untransferable except for:
    ///      - Initial mint to the CCA contract
    ///      - Burns when the CCA transfers to a holder (sale), which records missing disbursements
    function _update(address from, address to, uint256 value) internal virtual override {
        if (from == address(0) && to == _CCA_CONTRACT && !_initialMintDone) return super._update(from, to, value); // mint
        if (from == address(0) && _initialMintDone) revert InitialMintAlreadyDone();

        if (from == _CCA_CONTRACT && to == _CCA_CONTRACT) revert CCASelfTransferNotAllowed();
        if (from == _CCA_CONTRACT && to == address(0)) revert SimpleBurnsNotAllowed();
        if (from == _CCA_CONTRACT) {
            super._update(from, address(0), value); // burn sold tokens
            _recordMissingDisbursement(to, value); // register missing disbursement
            return;
        }

        revert TokenIsUntransferable();
    }

    /// @notice Returns true when the sale is fully claimed (total supply is zero).
    /// @dev Expects sweepUnsoldTokens to have been called and all bid tokens claimed via claimTokens/claimTokensBatch.
    function saleFullyClaimed() public view returns (bool) {
        return totalSupply() == 0;
    }

    /// @notice Returns true when the sale is fully disbursed (total supply is zero and all missing disbursements recorded).
    /// @dev Expects sweepUnsoldTokens to have been called, all bid tokens claimed, and all disbursements recorded via recordDisbursements.
    function saleFullyDisbursed() public view returns (bool) {
        return totalSupply() == 0 && _totalMissingDisbursements == 0;
    }

    /// @dev Sum of all unrecorded disbursements across all accounts.
    uint256 private _totalMissingDisbursements;
    /// @dev Per-account amount of tokens sold that have not yet had disbursements recorded.
    mapping(address account => uint256 value) private _missingDisbursements;

    /// @notice A recorded disbursement with its amount and transaction reference.
    /// @param value Amount disbursed
    /// @param txHash Transaction hash where the on-chain disbursement occurred
    struct Disbursement {
        uint256 value;
        bytes32 txHash;
    }
    /// @dev Per-account list of recorded disbursements for verification.
    mapping(address account => Disbursement[]) private _disbursements;

    error NoZeroDisbursementsAllowed();
    error NoZeroAddressRecipientAllowed();
    error OnlyDisburserCanRecordDisbursements();
    error OverdisbursementDetected();
    error SaleNotFullyClaimed();
    error ArrayLengthMismatch();

    event MissingDisbursementRecorded(address indexed to, uint256 value);
    event DisbursementCompleted(address indexed to, uint256 value, bytes32 txHash);

    /// @dev Records a missing disbursement when the CCA transfers tokens to a holder during the sale.
    /// @param to Address that should receive the disbursement.
    /// @param value Amount to be disbursed.
    function _recordMissingDisbursement(address to, uint256 value) internal {
        _missingDisbursements[to] += value;
        _totalMissingDisbursements += value;
        emit MissingDisbursementRecorded(to, value);
    }

    /// @notice Returns the total amount of unrecorded disbursements across all accounts.
    function totalMissingDisbursements() external view returns (uint256) {
        return _totalMissingDisbursements;
    }

    /// @notice Returns the amount of unrecorded disbursements for an account.
    /// @param account Address to query.
    function missingDisbursementTo(address account) external view returns (uint256) {
        return _missingDisbursements[account];
    }

    /// @notice Returns all disbursements for an account. May run out of gas for accounts with many disbursements; use
    ///         disbursementsToRange for paginated access.
    /// @param account Address to query.
    /// @return Array of all disbursements recorded for the account.
    function disbursementsTo(address account) external view returns (Disbursement[] memory) {
        return _disbursements[account];
    }

    /// @notice Returns the number of disbursements for an account.
    /// @param account Address to query.
    /// @return Number of disbursements recorded for the account.
    function disbursementsToCount(address account) external view returns (uint256) {
        return _disbursements[account].length;
    }

    /// @notice Returns a paginated slice of disbursements for an account.
    /// @param account Address to query
    /// @param offset Starting index (inclusive)
    /// @param count Number of items to return
    /// @return Disbursements in the requested range. Returns fewer than `count` if the range extends past the end.
    function disbursementsToRange(address account, uint256 offset, uint256 count)
        external
        view
        returns (Disbursement[] memory)
    {
        Disbursement[] storage arr = _disbursements[account];
        uint256 len = arr.length;
        if (offset >= len) return new Disbursement[](0);

        uint256 end = offset + count;
        if (end > len) end = len;
        uint256 resultLen = end - offset;

        Disbursement[] memory result = new Disbursement[](resultLen);
        for (uint256 i; i < resultLen;) {
            result[i] = arr[offset + i];
            unchecked {
                ++i;
            }
        }
        return result;
    }

    /// @notice Records disbursements made off-chain, reducing the missing disbursement balances.
    /// @dev Only callable by the disburser after the sale is fully claimed. Reverts on overdisbursement or zero amounts.
    /// @param recipients Addresses to record disbursements for
    /// @param values Amounts disbursed to each recipient
    /// @param txHashes Transaction hashes where the on-chain disbursements occurred
    function recordDisbursements(address[] calldata recipients, uint256[] calldata values, bytes32[] calldata txHashes)
        external
    {
        if (!saleFullyClaimed()) revert SaleNotFullyClaimed();
        if (msg.sender != _DISBURSER) revert OnlyDisburserCanRecordDisbursements();
        uint256 len = recipients.length;
        if (len != values.length || len != txHashes.length) revert ArrayLengthMismatch();

        for (uint256 i; i < len;) {
            address to = recipients[i];
            uint256 value = values[i];
            if (to == address(0)) revert NoZeroAddressRecipientAllowed();
            if (value == 0) revert NoZeroDisbursementsAllowed();
            if (_missingDisbursements[to] < value) revert OverdisbursementDetected();
            // txHash is intentionally not checked for 0x0 or uniqueness to allow for flexibility.

            unchecked {
                _missingDisbursements[to] -= value;
            }
            _totalMissingDisbursements -= value;
            _disbursements[to].push(Disbursement({value: value, txHash: txHashes[i]}));

            emit DisbursementCompleted(to, value, txHashes[i]);

            unchecked {
                ++i;
            }
        }
    }

    /// @dev Reverts; this contract does not accept ETH.
    receive() external payable {
        revert();
    }

    /// @dev Reverts; this contract does not accept ETH.
    fallback() external payable {
        revert();
    }
}
