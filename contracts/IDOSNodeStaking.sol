// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Arrays.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableMap.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

error AmountExceedsStake(uint256 amount, uint256 stake);
error AmountNotPositive(uint256 amount);
error EpochRewardDidntChange();
error ERC20TransferAmountMismatch(uint256 expected, uint256 received);
error NoWithdrawableRewards();
error NoWithdrawableSlashedStakes();
error NoWithdrawableStake();
error NodeIsNotAllowed(address node);
error NodeIsSlashed(address node);
error NodeIsUnknown(address node);
error NotContractAddress(address notContract);
error NotStarted();
error ZeroAddressNode();
error ZeroAddressToken();

contract IDOSNodeStaking is ReentrancyGuard, Pausable, Ownable {
    using EnumerableMap for EnumerableMap.AddressToUintMap;
    using EnumerableMap for EnumerableMap.UintToUintMap;
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;

    uint48 public constant EPOCH_LENGTH = 1 days;
    uint48 public constant UNSTAKE_DELAY = 14 days;
    uint48 public immutable startTime;
    IERC20 public immutable idosToken;
    uint256 public slashedStakeWithdrawn;

    struct Unstake { uint256 amount; uint48 timestamp; }
    struct NodeStake { address node; uint256 stake; }
    struct EpochCheckpoint {
        uint48 epoch;
        uint256 rewardAcc;
        uint256 userStakeAcc;
        uint256 totalStakeAcc;
    }

    EnumerableMap.AddressToUintMap private stakeByNode;
    EnumerableMap.AddressToUintMap private stakeByUser;
    EnumerableMap.AddressToUintMap private rewardWithdrawalsByUser;
    EnumerableSet.AddressSet private slashedNodes;
    EnumerableSet.AddressSet private allowlistedNodes;
    mapping(address => mapping(address => uint256)) public stakeByNodeByUser;
    // Key is the epoch where the reward was set.
    EnumerableMap.UintToUintMap private epochRewardChanges;
    mapping(uint48 => uint256) public stakedByEpoch;
    mapping(uint48 => uint256) public unstakedByEpoch;
    mapping(uint48 => EnumerableSet.AddressSet) private slashesByEpoch;
    mapping(uint48 => mapping(address => uint256)) public stakeByUserByEpoch;
    mapping(uint48 => mapping(address => uint256)) public unstakeByUserByEpoch;
    mapping(address => Unstake[]) public unstakesByUser;
    mapping(address => EpochCheckpoint) private epochCheckpointByUser;

    event Allowed(address indexed node);
    event Disallowed(address indexed node);
    event Slashed(address indexed node, uint256 amount);
    event Staked(address indexed user, address indexed node, uint256 amount);
    event Unstaked(address indexed user, address indexed node, uint256 amount);
    event RewardWithdraw(address indexed user, uint256 amount);
    event UnstakedWithdraw(address indexed user, uint256 amount);
    event SlashedWithdraw(uint256 amount);
    event EpochRewardChanged(uint48 epoch, uint256 prevReward, uint256 newReward);

    constructor(address idosTokenAddress, address initialOwner, uint48 startTime_, uint256 epochReward_)
        Ownable(initialOwner)
    {
        if (idosTokenAddress == address(0)) revert ZeroAddressToken();
        if (idosTokenAddress.code.length == 0) revert NotContractAddress(idosTokenAddress);

        idosToken = IERC20(idosTokenAddress);
        startTime = startTime_;
        epochRewardChanges.set(0, epochReward_);
    }

    function allowNode(address node)
        external whenNotPaused onlyOwner
    {
        allowlistedNodes.add(node);

        emit Allowed(node);
    }

    function disallowNode(address node)
        external whenNotPaused onlyOwner
    {
        allowlistedNodes.remove(node);

        emit Disallowed(node);
    }

    function stake(address user, address node, uint256 amount)
        external nonReentrant whenNotPaused
    {
        require(node != address(0), ZeroAddressNode());
        require(allowlistedNodes.contains(node), NodeIsNotAllowed(node));
        require(!slashedNodes.contains(node), NodeIsSlashed(node));
        require(amount > 0, AmountNotPositive(amount));
        require(block.timestamp >= startTime, NotStarted());

        if (user == address(0)) user = msg.sender;

        // guard against non-standard tokens
        uint256 prevBalance = idosToken.balanceOf(address(this));
        idosToken.safeTransferFrom(user, address(this), amount);
        uint256 received = idosToken.balanceOf(address(this)) - prevBalance;
        if (received != amount) revert ERC20TransferAmountMismatch(amount, received);

        stakeByNodeByUser[user][node] += amount;
        stakeByUserByEpoch[currentEpoch()][user] += amount;
        stakedByEpoch[currentEpoch()] += amount;

        (, uint256 nodeStake) = stakeByNode.tryGet(node);
        stakeByNode.set(node, nodeStake + amount);

        (, uint256 userStake) = stakeByUser.tryGet(user);
        stakeByUser.set(user, userStake + amount);

        createEpochCheckpoint(user);

        emit Staked(user, node, amount);
    }

    function unstake(address node, uint256 amount)
        external nonReentrant whenNotPaused
    {
        require(node != address(0), ZeroAddressNode());
        require(!slashedNodes.contains(node), NodeIsSlashed(node));
        require(amount > 0, AmountNotPositive(amount));
        require(block.timestamp >= startTime, NotStarted());

        uint256 currentStake = stakeByNodeByUser[msg.sender][node];

        require(amount <= currentStake, AmountExceedsStake(amount, currentStake));

        stakeByNodeByUser[msg.sender][node] -= amount;
        unstakeByUserByEpoch[currentEpoch()][msg.sender] += amount;
        unstakedByEpoch[currentEpoch()] += amount;

        uint256 newNodeStake = getNodeStake(node) - amount;
        if (newNodeStake > 0) {
            stakeByNode.set(node, newNodeStake);
        } else {
            stakeByNode.remove(node);
        }

        (uint256 activeStake, uint256 slashedStake) = getUserStake(msg.sender);
        uint256 newUserStake = activeStake + slashedStake - amount;
        if (newUserStake > 0) {
            stakeByUser.set(msg.sender, newUserStake);
        } else {
            stakeByUser.remove(msg.sender);
        }

        unstakesByUser[msg.sender].push(Unstake(amount, uint48(block.timestamp)));

        createEpochCheckpoint(msg.sender);

        emit Unstaked(msg.sender, node, amount);
    }

    function withdrawUnstaked()
        external nonReentrant whenNotPaused
        returns (uint256 withdrawableAmount)
    {
        withdrawableAmount;
        for (uint i; i < unstakesByUser[msg.sender].length; i++)
            if (unstakesByUser[msg.sender][i].timestamp < uint48(block.timestamp) - UNSTAKE_DELAY) {
                withdrawableAmount += unstakesByUser[msg.sender][i].amount;
                delete unstakesByUser[msg.sender][i];
            }

        require(withdrawableAmount > 0, NoWithdrawableStake());

        idosToken.safeTransfer(msg.sender, withdrawableAmount);

        emit UnstakedWithdraw(msg.sender, withdrawableAmount);
    }

    function slash(address node)
        external onlyOwner nonReentrant whenNotPaused
    {
        require(node != address(0), ZeroAddressNode());
        require(stakeByNode.contains(node), NodeIsUnknown(node));
        require(!slashedNodes.contains(node), NodeIsSlashed(node));

        slashedNodes.add(node);
        slashesByEpoch[currentEpoch()].add(node);

        emit Slashed(node, getNodeStake(node));
    }

    function withdrawSlashedStakes()
        external onlyOwner nonReentrant whenNotPaused
    {
        NodeStake[] memory slashedStakes = getSlashedNodeStakes();

        uint256 amount;
        for (uint i; i < slashedStakes.length; i++)
            amount += slashedStakes[i].stake;

        amount -= slashedStakeWithdrawn;
        require(amount > 0, NoWithdrawableSlashedStakes());

        slashedStakeWithdrawn += amount;

        idosToken.safeTransfer(msg.sender, amount);

        emit SlashedWithdraw(amount);
    }

    // TODO nodes should be able to set a % they take from delegates
    function withdrawableReward(address user)
        public view
        returns (uint256 withdrawableAmount, uint256 rewardAcc, uint256 userStakeAcc, uint256 totalStakeAcc)
    {
        EpochCheckpoint memory checkpoint = epochCheckpointByUser[user];
        rewardAcc = checkpoint.rewardAcc;
        userStakeAcc = checkpoint.userStakeAcc;
        totalStakeAcc = checkpoint.totalStakeAcc;
        uint256 epochReward = epochRewardChanges.get(0);

        for (uint48 i = checkpoint.epoch; i < currentEpoch(); i++) {
            (bool exists, uint256 rewardAtEpoch) = epochRewardChanges.tryGet(i);
            if (exists) epochReward = rewardAtEpoch;

            userStakeAcc += stakeByUserByEpoch[i][user];
            userStakeAcc -= unstakeByUserByEpoch[i][user];

            totalStakeAcc += stakedByEpoch[i];
            totalStakeAcc -= unstakedByEpoch[i];

            address[] memory slashedNodesThisEpoch = slashesByEpoch[i].values();
            for (uint j; j < slashedNodesThisEpoch.length; j++) {
                userStakeAcc -= stakeByNodeByUser[user][slashedNodesThisEpoch[j]];
                totalStakeAcc -= stakeByNode.get(slashedNodesThisEpoch[j]);
            }

            if (totalStakeAcc == 0) continue;
            rewardAcc += (userStakeAcc * epochReward) / totalStakeAcc;
        }

        (, uint256 withdrawnAlready) = rewardWithdrawalsByUser.tryGet(user);
        withdrawableAmount = rewardAcc - withdrawnAlready;
    }

    function createEpochCheckpoint(address user)
        public
        returns (uint256)
    {
        (
            uint256 withdrawableAmount,
            uint256 rewardAcc,
            uint256 userStakeAcc,
            uint256 totalStakeAcc
        ) = withdrawableReward(user);

        epochCheckpointByUser[user] = EpochCheckpoint(
            currentEpoch(),
            rewardAcc,
            userStakeAcc,
            totalStakeAcc
        );

        return withdrawableAmount;
    }

    /// @notice Set the reward per epoch
    /// @param newReward The new reward value
    function setEpochReward(uint256 newReward) external onlyOwner {
        (, uint256 prevReward) = epochRewardChanges.at(epochRewardChanges.length()-1);
        require(newReward != prevReward, EpochRewardDidntChange());

        epochRewardChanges.set(currentEpoch(), newReward);
        emit EpochRewardChanged(currentEpoch(), prevReward, newReward);
    }

    function withdrawReward()
        external nonReentrant whenNotPaused
        returns (uint256 withdrawableAmount)
    {
        withdrawableAmount = createEpochCheckpoint(msg.sender);

        require(withdrawableAmount > 0, NoWithdrawableRewards());

        (,uint256 prev) = rewardWithdrawalsByUser.tryGet(msg.sender);
        rewardWithdrawalsByUser.set(msg.sender, prev + withdrawableAmount);

        idosToken.safeTransfer(msg.sender, withdrawableAmount);

        emit RewardWithdraw(msg.sender, withdrawableAmount);
    }

    function getNodeStake(address node)
        public view
        returns (uint256 nodeStake)
    {
        (, nodeStake) = stakeByNode.tryGet(node);
    }

    function getUserStake(address user)
        public view
        returns (uint256 activeStake, uint256 slashedStake)
    {
        (, uint256 totalStake) = stakeByUser.tryGet(user);

        for (uint i; i < slashedNodes.length(); i++)
            slashedStake += stakeByNodeByUser[user][slashedNodes.at(i)];

        activeStake = totalStake - slashedStake;
    }

    function getNodeStakes()
        public view
        returns (NodeStake[] memory unslashedNodeStakes)
    {
        unslashedNodeStakes = new NodeStake[](stakeByNode.length() - slashedNodes.length());

        uint returnIndex;
        for (uint j; j < stakeByNode.length() && returnIndex < unslashedNodeStakes.length; j++) {
            (address node, uint256 stake_) = stakeByNode.at(j);
            if (slashedNodes.contains(node)) continue;
            unslashedNodeStakes[returnIndex++] = NodeStake(node, stake_);
        }
    }

    function getSlashedNodeStakes()
        public view
        returns (NodeStake[] memory nodeStakes)
    {
        nodeStakes = new NodeStake[](slashedNodes.length());

        for (uint i; i < slashedNodes.length(); i++)
            nodeStakes[i] = NodeStake(slashedNodes.at(i), stakeByNode.get(slashedNodes.at(i)));
    }

    function currentEpoch()
        public view
        returns (uint48 epoch)
    {
        require(block.timestamp >= startTime, NotStarted());

        epoch = uint48((uint48(block.timestamp) - startTime) / EPOCH_LENGTH);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // Prevent accidental ETH transfers
    receive() external payable { revert(); }
    fallback() external payable { revert(); }
}
