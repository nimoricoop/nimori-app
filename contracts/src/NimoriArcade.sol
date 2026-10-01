// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title NIMORI Arcade
/// @notice Stake $NIMORI, earn ETH. Every wei of ETH sent to this contract is queued, then streamed to
///         stakers pro rata over a reward period (default 7 days), so a deposit cannot be front-run by a
///         stake placed one block before it.
/// @dev    The staking token is set AFTER deployment (the token does not exist yet when the Arcade is
///         deployed). It can be changed until the first stake, then it is locked forever.
///         Stakers can always withdraw: there is no pause, no lock-up and no owner path to staked tokens or
///         to ETH already owed to stakers.
contract NimoriArcade is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant PRECISION = 1e18;
    uint256 public constant MIN_DURATION = 1 days;
    uint256 public constant MAX_DURATION = 30 days;

    /// @notice The token being staked. address(0) until the owner sets it.
    IERC20 public stakingToken;
    /// @notice True once anyone has staked: the staking token can no longer change.
    bool public tokenLocked;

    uint256 public rewardsDuration = 7 days;
    uint256 public periodFinish;
    /// @notice ETH per second, scaled by 1e18.
    uint256 public rewardRateScaled;
    uint256 public lastUpdateTime;
    uint256 public rewardPerTokenStored;

    /// @notice ETH received but not yet streamed. Starts the next period.
    uint256 public queuedRewards;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public userRewardPerTokenPaid;
    mapping(address => uint256) public rewards;

    event StakingTokenSet(address indexed token);
    event RewardReceived(address indexed from, uint256 amount);
    event RewardPeriodStarted(uint256 amount, uint256 duration, uint256 periodFinish);
    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event RewardPaid(address indexed user, address indexed to, uint256 amount);
    event RewardsDurationSet(uint256 duration);
    event QueuedRescued(address indexed to, uint256 amount);
    event TokenRecovered(address indexed token, address indexed to, uint256 amount);

    error TokenNotSet();
    error TokenIsLocked();
    error NotAContract();
    error ZeroAmount();
    error ZeroAddress();
    error PeriodActive();
    error NothingQueued();
    error BadDuration();
    error StakersPresent();
    error CannotRecoverStakingToken();
    error EthTransferFailed();

    constructor(address owner_) Ownable(owner_) {}

    // ------------------------------------------------------------------ rewards in

    /// @notice Any ETH sent here (creator tax, protocol fees) is queued for the next period.
    receive() external payable {
        queuedRewards += msg.value;
        emit RewardReceived(msg.sender, msg.value);
    }

    /// @notice Starts a new reward period with everything queued.
    /// @dev Anyone may call it once the current period is over. The owner may also call it during a period:
    ///      the leftover of the running period is rolled into the new one.
    function kick() external nonReentrant {
        if (address(stakingToken) == address(0)) revert TokenNotSet();
        if (block.timestamp < periodFinish && msg.sender != owner()) revert PeriodActive();
        _updateReward(address(0));

        uint256 amount = queuedRewards;
        if (amount == 0) revert NothingQueued();
        queuedRewards = 0;

        uint256 total = amount;
        if (block.timestamp < periodFinish) {
            total += ((periodFinish - block.timestamp) * rewardRateScaled) / PRECISION;
        }
        rewardRateScaled = (total * PRECISION) / rewardsDuration;
        lastUpdateTime = block.timestamp;
        periodFinish = block.timestamp + rewardsDuration;
        emit RewardPeriodStarted(total, rewardsDuration, periodFinish);
    }

    // ------------------------------------------------------------------ staking

    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        IERC20 token = stakingToken;
        if (address(token) == address(0)) revert TokenNotSet();
        _updateReward(msg.sender);
        if (!tokenLocked) tokenLocked = true;

        // Credit what actually arrived, not what was asked for.
        uint256 before = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = token.balanceOf(address(this)) - before;
        if (received == 0) revert ZeroAmount();

        totalSupply += received;
        balanceOf[msg.sender] += received;
        emit Staked(msg.sender, received);
    }

    function withdraw(uint256 amount) public nonReentrant {
        _withdraw(amount);
    }

    function claim() external nonReentrant {
        _claim(msg.sender, msg.sender);
    }

    /// @notice Claim to another address (for stakers whose address cannot receive ETH).
    function claimTo(address to) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        _claim(msg.sender, to);
    }

    function exit() external nonReentrant {
        _withdraw(balanceOf[msg.sender]);
        _claim(msg.sender, msg.sender);
    }

    // ------------------------------------------------------------------ views

    function lastTimeRewardApplicable() public view returns (uint256) {
        return block.timestamp < periodFinish ? block.timestamp : periodFinish;
    }

    function rewardPerToken() public view returns (uint256) {
        if (totalSupply == 0) return rewardPerTokenStored;
        return rewardPerTokenStored + ((lastTimeRewardApplicable() - lastUpdateTime) * rewardRateScaled) / totalSupply;
    }

    function earned(address account) public view returns (uint256) {
        return rewards[account]
            + (balanceOf[account] * (rewardPerToken() - userRewardPerTokenPaid[account])) / PRECISION;
    }

    /// @notice ETH still to be streamed in the running period.
    function remainingInPeriod() external view returns (uint256) {
        if (block.timestamp >= periodFinish) return 0;
        return ((periodFinish - block.timestamp) * rewardRateScaled) / PRECISION;
    }

    // ------------------------------------------------------------------ owner

    /// @notice Sets the staking token. Allowed until the first stake, then locked forever.
    function setStakingToken(address token) external onlyOwner {
        if (tokenLocked) revert TokenIsLocked();
        if (token.code.length == 0) revert NotAContract();
        stakingToken = IERC20(token);
        emit StakingTokenSet(token);
    }

    function setRewardsDuration(uint256 duration) external onlyOwner {
        if (block.timestamp < periodFinish) revert PeriodActive();
        if (duration < MIN_DURATION || duration > MAX_DURATION) revert BadDuration();
        rewardsDuration = duration;
        emit RewardsDurationSet(duration);
    }

    /// @notice Returns QUEUED ETH (never ETH owed to stakers) when nobody is staking and no period runs.
    ///         Exists so ETH sent before anyone stakes can never be stuck.
    function rescueQueued(address payable to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (totalSupply != 0) revert StakersPresent();
        if (block.timestamp < periodFinish) revert PeriodActive();
        _updateReward(address(0));
        uint256 amount = queuedRewards;
        if (amount == 0) revert NothingQueued();
        queuedRewards = 0;
        _sendEth(to, amount);
        emit QueuedRescued(to, amount);
    }

    /// @notice Recovers a token sent here by mistake. Never the staking token.
    function recoverERC20(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(stakingToken)) revert CannotRecoverStakingToken();
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit TokenRecovered(token, to, amount);
    }

    // ------------------------------------------------------------------ internal

    function _updateReward(address account) internal {
        uint256 applicable = lastTimeRewardApplicable();
        if (totalSupply == 0) {
            // Nobody staked: what would have streamed goes back to the queue instead of being lost.
            if (applicable > lastUpdateTime) {
                queuedRewards += ((applicable - lastUpdateTime) * rewardRateScaled) / PRECISION;
            }
        } else {
            rewardPerTokenStored = rewardPerToken();
        }
        lastUpdateTime = applicable;
        if (account != address(0)) {
            rewards[account] = earned(account);
            userRewardPerTokenPaid[account] = rewardPerTokenStored;
        }
    }

    function _withdraw(uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        _updateReward(msg.sender);
        balanceOf[msg.sender] -= amount;
        totalSupply -= amount;
        stakingToken.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function _claim(address account, address to) internal {
        _updateReward(account);
        uint256 reward = rewards[account];
        if (reward == 0) return;
        rewards[account] = 0;
        _sendEth(to, reward);
        emit RewardPaid(account, to, reward);
    }

    function _sendEth(address to, uint256 amount) internal {
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }
}
