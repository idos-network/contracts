// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title RewardDistributor - Kwil Reward distribution contract.
contract RewardDistributor is ReentrancyGuard {
    /// @dev Use SafeERC20 to support non-standard ERC20 tokens like USDT.
    using SafeERC20 for IERC20;

    /// @notice Hardcoded limit for posterFee.
    /// @dev 0.01 Ether is unreasonably high enough.
    uint256 public constant maxPosterFee = 1e16; // 0.01 Ether

    /// @notice Mapping to keep track of the poster of rewards(merkle tree root).
    /// @dev The leaf node encoding of the merkle tree is (recipient, amount, contract_address, kwil_block_hash), which
    /// ensures a unique reward hash per contract in a Kwil network. The amount of each leaf is not the same.
    /// @dev To see construction of merkle tree, see here: https://github.com/kwilteam/rewards_contracts/blob/98272b6c5c5f4b8c3206532ca791df2690498356/peripheral/lib/reward.ts#L15
    mapping(bytes32 => address) public rewardPoster;
    /// @notice Mapping to keep track of the amount left to be claimed of a reward.
    mapping(bytes32 => uint256) public rewardLeft;
    /// @notice Mapping to keep track of if a leaf reward is claimed. The structure is: treeRoot => leaf => bool.
    mapping(bytes32 => mapping(bytes32 => bool)) public isLeafRewardClaimed;
    /// @notice Total amount of all rewards that can be claimed.
    /// @dev It can never exceed the total balance of the token owned by the contract.
    uint256 public totalReward;

    /// @notice The GnosisSafe wallet address. Only this wallet can postReward/updatePosterFee. Cannot be changed once set.
    /// @dev The Safe wallet cannot work in ERC4337 compatible mode, as the tx.origin will always be the bundler.
    address public safe;
    /// @notice The fee that User will pay to the 'reward poster' per claim.
    /// @dev If a reward has 100 recipients, the total compensation the `reward poster`
    /// will get for posting this reward is 100 * posterFee.
    uint256 public posterFee;
    /// @notice The address of the ERC20 token used for rewards. Cannot be changed once set.
    /// @dev Rebasing token cannot be used as reward token.
    IERC20 public rewardToken;

    event RewardPosted(bytes32 root, uint256 amount, address poster);
    event RewardClaimed(address recipient, uint256 amount, address claimer);
    event PosterFeeUpdated(uint256 oldFee, uint256 newFee);

    /// @notice Initialize the contract with given parameters.
    /// @dev This function should be called within the same tx this contract is created.
    /// @dev The factory contract uses Openzeppelin cloneDeterministic(https://github.com/OpenZeppelin/openzeppelin-contracts/blob/441dc141ac99622de7e535fa75dfc74af939019c/contracts/proxy/Clones.sol#L74) to create new contract.
    /// @param _safe The GnosisSafe wallet address.
    /// @param _posterFee The fee for a poster post reward on chain.
    /// @param _rewardToken The erc20 reward token address.
    function setup(address _safe, uint256 _posterFee, address _rewardToken) external {
        // ensure `setup` can only be called once
        require(safe == address(0), "Already initialized");
        // valid parameters
        require(_safe != address(0), "ZERO ADDRESS");
        require(_rewardToken != address(0), "ZERO ADDRESS");
        require(_posterFee > 0, "Fee zero");
        require(_posterFee < maxPosterFee, "Fee too high");

        posterFee = _posterFee;
        rewardToken = IERC20(_rewardToken);
        safe = _safe;
    }

    /// @param root The merkle tree root of an epoch reward.
    /// @param amount The total value of this reward.
    function postReward(bytes32 root, uint256 amount) external {
        require(msg.sender == safe, "Not allowed");
        require(amount > 0, "Total amount zero");
        require(rewardPoster[root] == address(0), "Already posted");
        require(rewardToken.balanceOf(address(this)) >= totalReward + amount, "Insufficient contract reward balance");

        // We use the wallet that initiates this TX through gnosis-safe, so the wallet will get compensated.
        rewardPoster[root] = tx.origin;
        totalReward += amount;
        rewardLeft[root] = amount;

        emit RewardPosted(root, amount, tx.origin);
    }

    /// @param newFee The new poster fee to be set.
    function updatePosterFee(uint256 newFee) external {
        require(msg.sender == safe, "Not allowed");
        require(newFee > 0, "Fee zero");
        require(newFee < maxPosterFee, "Fee too high");

        uint256 oldFee = posterFee;
        posterFee = newFee;

        emit PosterFeeUpdated(oldFee, newFee);
    }

    /// @notice This allows a user on behalf of the recipient to claim reward by providing
    /// the leaf data and corresponding Merkle proofs. The reward must exist and not claimed.
    /// User calling this function will pay a fee(in eth) to whoever post this reward on chain.
    /// @dev This is the only method transferring reward token out of this contract.
    /// @dev On success, the recipient will receive 'amount' reward tokens. If the caller
    /// is not the recipient, there is no reimbursement for the caller; if needed,
    /// it'll be settled off-chain.
    /// @dev Since we need to know the amount of token to transfer to the recipient,
    /// we have to regenerate and verify the leaf in the contract to ensure the authenticity.
    /// @param recipient The wallet address the reward will be send to.
    /// @param amount The amount of reward to be claimed.
    /// @param kwilBlockHash The block hash of Kwil network when the epoch reward was created.
    /// @param rewardRoot The merkle tree root of the targeting epoch reward.
    /// @param proofs A list of merkle proofs of the reward leaf node.
    function claimReward(
        address recipient,
        uint256 amount,
        bytes32 kwilBlockHash,
        bytes32 rewardRoot,
        bytes32[] calldata proofs
    )
        external
        payable
        nonReentrant
    {
        address payable poster = payable(rewardPoster[rewardRoot]);
        require(poster != address(0), "Reward root not posted");

        require(totalReward >= amount, "Not enough reward");
        require(rewardLeft[rewardRoot] >= amount, "Not enough reward left");

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(recipient, amount, address(this), kwilBlockHash))));
        require(!isLeafRewardClaimed[rewardRoot][leaf], "Reward already claimed");

        // verify the Merkle proof
        require(MerkleProof.verify(proofs, rewardRoot, leaf), "Invalid proof");

        uint256 feeToPoster = posterFee; // save gas cost;
        // Optimized payment and refund logic in claimReward
        require(msg.value >= feeToPoster, "Insufficient payment for poster");

        // Calculate any excess ETH to refund to the sender
        uint256 excess;
        unchecked {
            // above checks ensure this is safe; save gas
            excess = msg.value - feeToPoster;
        }

        // Use call to transfer ETH to the poster (recommended for flexibility with gas limits)
        (bool success, ) = poster.call{value: feeToPoster}("");

        require(success, "Poster reward transfer failed");

        // Refund any excess ETH to the caller if applicable
        if (excess > 0) {
            (bool refundSuccess, ) = msg.sender.call{value: excess}("");
            require(refundSuccess, "Refund failed");
        }

        // Update claim, transfer the reward to recipient
        isLeafRewardClaimed[rewardRoot][leaf] = true;
        unchecked {
            // above checks ensure this is safe; save gas
            totalReward -= amount;
            rewardLeft[rewardRoot] -= amount;
        }

        rewardToken.safeTransfer(recipient, amount);
        emit RewardClaimed(recipient, amount, msg.sender);
    }
}
