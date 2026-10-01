// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "v4-core/src/types/PoolOperation.sol";
import {LiquidityAmounts} from "v4-periphery/src/libraries/LiquidityAmounts.sol";

interface INimoriOracle {
    function consult(PoolId id, uint32 secondsAgo) external view returns (int24 meanTick, uint32 window);
}

/// @title  NIMORI Lobby: co-op liquidity. 1P brings ETH, 2P brings $NIMORI, the lobby pairs them into one
///         Uniswap v4 position and hands each side a Seat NFT.
///
/// @notice Flow: deposit into a queue (per difficulty, per side) -> FIFO match into a v4 position held by this
///         contract in the PoolManager (salt = session id) -> fees collected and split 50/50 after a 10% protocol
///         fee -> either seat unplugs, the position is removed and settled in kind with the mover rule -> each
///         seat owner pulls its credit with {claim}.
///
/// @dev    🔑 MOVER RULE, RATIO FORM. Removed principal is (a ETH, b NIMORI); at entry the position took e0 ETH
///         (from 1P) and n0 NIMORI (from 2P). Along a v4 position the ETH leg falls and the NIMORI leg rises as
///         the price (NIMORI per ETH) rises, so exactly one of `a >= e0` or `b >= n0` holds (up to a wei of
///         rounding). If a >= e0, NIMORI rose against ETH: 1P is repaid e0 ETH and 2P takes the rest. Otherwise
///         ETH rose: 2P is repaid n0 NIMORI (capped at b) and 1P takes the rest. Both branches only split (a, b),
///         so a settlement can never pay out more than the position returned. No USD oracle is involved.
///
/// @dev    🔑 PRINCIPAL vs FEES. `modifyLiquidity` returns `callerDelta` ALREADY NET of `feesAccrued`. Fees are
///         split by the fee rule, the principal by the mover rule, and the principal is `callerDelta - fees`.
///
/// @dev    🔑 NO OWNER PATH TO MONEY. The owner can tune bounded parameters, set the reference pool once,
///         initialize the pool once and pause NEW deposits and matches. Withdrawals of queued deposits, fee
///         collection, exits and claims never stop. There is no arbitrary call, no token rescue to an address,
///         no upgrade. Surplus (anything above recorded liabilities) can only be pushed to the Arcade (ETH) or
///         burned (NIMORI) by {skim}.
contract NimoriLobby is ERC721, Ownable2Step, ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    // ------------------------------------------------------------------ constants

    uint24 public constant LP_FEE = 10_000; // 1%
    int24 public constant TICK_SPACING = 200;
    int24 public constant NORMAL_HALF_WIDTH = 6000;
    int24 public constant HARD_HALF_WIDTH = 2000;
    uint32 public constant TWAP_WINDOW = 30 minutes;
    uint256 public constant MIN_SESSION = 24 hours;
    uint256 public constant RAGE_QUIT_BPS = 100; // 1%
    uint256 public constant PROTOCOL_FEE_BPS = 1000; // 10%
    uint256 public constant BPS = 10_000;
    uint256 public constant AUTO_MATCH_PAIRS = 2;
    uint256 public constant MAX_PAIRS_PER_CALL = 20;
    int24 public constant MIN_DEVIATION = 50;
    int24 public constant MAX_DEVIATION = 1000;
    uint256 public constant MIN_ETH_FLOOR = 1e9;
    uint256 public constant MIN_ETH_CEILING = 100 ether;
    address public constant BURN = 0x000000000000000000000000000000000000dEaD;
    /// @dev Gas handed to the Arcade on the protocol-fee push: enough for its `receive()` (one SSTORE and an
    ///      event), not enough for an Arcade address to grief exits by burning the whole transaction's gas.
    uint256 public constant ARCADE_GAS = 100_000;

    uint8 public constant EASY = 0;
    uint8 public constant NORMAL = 1;
    uint8 public constant HARD = 2;
    uint8 internal constant P1 = 0; // ETH side
    uint8 internal constant P2 = 1; // NIMORI side

    // ------------------------------------------------------------------ immutables

    IPoolManager public immutable poolManager;
    IHooks public immutable hook;
    IERC20 public immutable nimori;
    /// @notice The chain's WETH, accepted as the ETH leg of the reference pool. May be zero.
    address public immutable weth;

    // ------------------------------------------------------------------ parameters

    address public arcade;
    uint256 public minEthDeposit = 0.001 ether;
    uint256 public minNimoriDeposit;
    int24 public maxDeviationTicks = 200; // spot vs TWAP, ~2%
    /// @dev Spot vs the Pons pool. Its own knob because Pons charges a creator tax + hook fee on every swap
    ///      (4% for $NIMORI): arbitrage between the two pools only closes the gap down to roughly that tax plus
    ///      our 1% LP fee, so a 2% band would block every match and exit for as long as the gap sits at 3-5%.
    int24 public maxRefDeviationTicks = 600; // ~6%
    /// @dev EXIT guard: spot vs the TWAP only, wider. A memecoin crosses 2% against a 30-minute mean routinely;
    ///      an exit must not wait on that, and the Pons reference (kept apart by its swap tax) is not used at exit.
    int24 public maxExitDeviationTicks = 1000; // ~10.5%
    bool public paused;

    bool public poolInitialized;
    bool public referenceSet;
    PoolId public referenceId;
    /// @notice True when the reference pool lists NIMORI as currency0, i.e. its price is ETH per NIMORI.
    bool public referenceInverted;

    // ------------------------------------------------------------------ queues

    struct Deposit {
        address owner;
        uint8 difficulty;
        uint8 side;
        uint128 amount; // remaining, unmatched
        uint64 prev;
        uint64 next;
    }

    struct Queue {
        uint64 head;
        uint64 tail;
    }

    uint64 public nextDepositId = 1;
    mapping(uint256 => Deposit) public deposits;
    /// @dev queues[difficulty][side]
    Queue[2][3] internal _queues;

    // ------------------------------------------------------------------ sessions

    struct Session {
        uint8 difficulty;
        bool open;
        int24 tickLower;
        int24 tickUpper;
        uint64 start;
        uint128 liquidity;
        uint128 e0; // ETH put in by 1P
        uint128 n0; // NIMORI put in by 2P
    }

    struct Credit {
        uint128 eth;
        uint128 nimori;
    }

    uint256 public nextSessionId = 1;
    mapping(uint256 => Session) public sessions;
    /// @notice Claimable per seat: fee shares and, after unplug, the settlement.
    mapping(uint256 => Credit) public credits;
    /// @notice Unmatched dust returned to depositors, pulled with {withdrawOwed}.
    mapping(address => Credit) public owed;

    // ------------------------------------------------------------------ liabilities (for solvency and skim)

    uint256 public totalQueuedEth;
    uint256 public totalQueuedNimori;
    uint256 public totalCreditEth;
    uint256 public totalCreditNimori;
    uint256 public totalOwedEth;
    uint256 public totalOwedNimori;
    uint256 public protocolEthPending;

    /// @notice Time of the pending escape request of a session (0 = none). After UNPLUG_DELAY, either seat holder
    ///         may unplug WITHOUT the price guard: a guard can delay an exit, never lock it.
    mapping(uint256 => uint64) public unplugRequestedAt;
    uint256 public constant UNPLUG_DELAY = 1 hours;
    int24 public constant MIN_EXIT_DEVIATION = 200;
    int24 public constant MAX_EXIT_DEVIATION = 2000;

    // ------------------------------------------------------------------ events and errors

    event Deposited(uint256 indexed depositId, address indexed owner, uint8 difficulty, uint8 side, uint256 amount);
    event WithdrawnQueued(uint256 indexed depositId, address indexed owner, uint256 amount);
    event DustRefunded(uint256 indexed depositId, address indexed owner, uint8 side, uint256 amount);
    event Matched(
        uint256 indexed sessionId,
        uint256 indexed deposit1P,
        uint256 indexed deposit2P,
        uint128 liquidity,
        uint256 e0,
        uint256 n0
    );
    event SessionOpened(uint256 indexed sessionId, uint8 difficulty, int24 tickLower, int24 tickUpper);
    event FeesCollected(uint256 indexed sessionId, uint256 fee0, uint256 fee1, uint256 protocolEth, uint256 burned);
    event Unplugged(
        uint256 indexed sessionId,
        uint256 indexed bySeat,
        uint256 a,
        uint256 b,
        uint256 eth1P,
        uint256 nimori1P,
        uint256 eth2P,
        uint256 nimori2P,
        bool rageQuit
    );
    event Claimed(uint256 indexed seatId, address indexed to, uint256 eth, uint256 nimori);
    event OwedWithdrawn(address indexed who, uint256 eth, uint256 nimori);
    event ProtocolPushed(address indexed arcade, uint256 amount, bool ok);
    event PoolInitialized(uint160 sqrtPriceX96, bool byLobby);
    event ReferenceSet(PoolId indexed id, bool inverted);
    event ArcadeSet(address arcade);
    event MinimumsSet(uint256 minEth, uint256 minNimori);
    event DeviationSet(int24 twapTicks, int24 refTicks);
    event ExitDeviationSet(int24 ticks);
    event UnplugRequested(uint256 indexed sessionId, uint256 indexed bySeat, uint256 executableAt);
    event UnplugEscaped(uint256 indexed sessionId, uint256 indexed bySeat);
    event PausedSet(bool paused);
    event Skimmed(uint256 eth, uint256 nimori);

    error Paused();
    error BadDifficulty();
    error BelowMinimum();
    error TooLarge();
    error NotDepositor();
    error NotQueued();
    error NotSeatOwner();
    error SessionClosed();
    error PoolNotReady();
    error PriceGuard(int24 spot, int24 twap, bool twapUsed, int24 ref, bool refUsed);
    error NotPoolManager();
    error EthTransferFailed();
    error ZeroAddress();
    error AlreadySet();
    error BadReference();
    error OutOfBounds();
    error NothingToMatch();
    error UnusedAmount();
    error ExitGuard(int24 spot, int24 twap, bool twapUsed);
    error AlreadyRequested();
    error GuardPasses();

    // ------------------------------------------------------------------ construction

    constructor(
        IPoolManager pm_,
        IHooks hook_,
        address nimori_,
        address weth_,
        address arcade_,
        uint256 minNimori_,
        address owner_
    ) ERC721("NIMORI Seat", "SEAT") Ownable(owner_) {
        if (address(pm_) == address(0) || address(hook_) == address(0) || nimori_ == address(0)) {
            revert ZeroAddress();
        }
        if (arcade_ == address(0)) revert ZeroAddress();
        if (minNimori_ == 0 || minNimori_ > type(uint128).max) revert OutOfBounds();
        // The hook must carry exactly the oracle flags in its address, or the PoolManager will never call it.
        uint160 flags = uint160(address(hook_)) & Hooks.ALL_HOOK_MASK;
        if (flags != (Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG)) revert BadReference();
        poolManager = pm_;
        hook = hook_;
        nimori = IERC20(nimori_);
        weth = weth_;
        arcade = arcade_;
        minNimoriDeposit = minNimori_;
    }

    /// @notice The co-op pool: native ETH / NIMORI, 1% LP fee, spacing 200, the NIMORI hook.
    function poolKey() public view returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(nimori)),
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: hook
        });
    }

    function poolId() public view returns (PoolId) {
        return poolKey().toId();
    }

    /// @dev ETH only ever arrives from the PoolManager (take) or through the payable deposit.
    receive() external payable {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
    }

    // ------------------------------------------------------------------ owner, all bounded

    /// @notice Opens the co-op pool. Once.
    /// @dev    Anyone can initialize a v4 pool for any key. If someone did it first, the lobby adopts the pool
    ///         as is: its price is whatever the market made of it, and every match and exit is still held to the
    ///         price guards, so a bad opening price only blocks matching until it is arbitraged.
    function initializePool(uint160 sqrtPriceX96) external onlyOwner {
        if (poolInitialized) revert AlreadySet();
        poolInitialized = true;
        (uint160 current,,,) = poolManager.getSlot0(poolId());
        bool byLobby = current == 0;
        if (byLobby) poolManager.initialize(poolKey(), sqrtPriceX96);
        emit PoolInitialized(byLobby ? sqrtPriceX96 : current, byLobby);
    }

    /// @notice Pins the Pons pool of NIMORI as the reference price. Once.
    function setReferencePool(PoolKey calldata key) external onlyOwner {
        if (referenceSet) revert AlreadySet();
        address c0 = Currency.unwrap(key.currency0);
        address c1 = Currency.unwrap(key.currency1);
        address n = address(nimori);
        bool inverted;
        if (c1 == n && (c0 == address(0) || (weth != address(0) && c0 == weth))) {
            inverted = false; // price = NIMORI per ETH, same orientation as the co-op pool
        } else if (c0 == n && weth != address(0) && c1 == weth) {
            inverted = true; // price = WETH per NIMORI
        } else {
            revert BadReference();
        }
        PoolId id = key.toId();
        if (PoolId.unwrap(id) == PoolId.unwrap(poolId())) revert BadReference();
        (uint160 sqrtP,,,) = poolManager.getSlot0(id);
        if (sqrtP == 0) revert BadReference();
        referenceSet = true;
        referenceId = id;
        referenceInverted = inverted;
        emit ReferenceSet(id, inverted);
    }

    function setArcade(address arcade_) external onlyOwner {
        if (arcade_ == address(0)) revert ZeroAddress();
        arcade = arcade_;
        emit ArcadeSet(arcade_);
    }

    function setMinimums(uint256 minEth, uint256 minNimori) external onlyOwner {
        if (minEth < MIN_ETH_FLOOR || minEth > MIN_ETH_CEILING) revert OutOfBounds();
        if (minNimori == 0 || minNimori > type(uint128).max) revert OutOfBounds();
        minEthDeposit = minEth;
        minNimoriDeposit = minNimori;
        emit MinimumsSet(minEth, minNimori);
    }

    function setMaxExitDeviation(int24 ticks) external onlyOwner {
        if (ticks < MIN_EXIT_DEVIATION || ticks > MAX_EXIT_DEVIATION) revert OutOfBounds();
        maxExitDeviationTicks = ticks;
        emit ExitDeviationSet(ticks);
    }

    function setMaxDeviation(int24 twapTicks, int24 refTicks) external onlyOwner {
        if (twapTicks < MIN_DEVIATION || twapTicks > MAX_DEVIATION) revert OutOfBounds();
        if (refTicks < MIN_DEVIATION || refTicks > MAX_DEVIATION) revert OutOfBounds();
        maxDeviationTicks = twapTicks;
        maxRefDeviationTicks = refTicks;
        emit DeviationSet(twapTicks, refTicks);
    }

    /// @notice Pauses NEW deposits and matches only. Withdrawals, fees, exits and claims never pause.
    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    // ------------------------------------------------------------------ queue

    /// @notice 1P: queue ETH on a difficulty.
    function deposit1P(uint8 difficulty) external payable nonReentrant returns (uint256 id) {
        if (paused) revert Paused();
        if (difficulty > HARD) revert BadDifficulty();
        if (msg.value < minEthDeposit) revert BelowMinimum();
        if (msg.value > type(uint128).max) revert TooLarge();
        id = _enqueue(msg.sender, difficulty, P1, msg.value);
        totalQueuedEth += msg.value;
        _autoMatch(difficulty);
    }

    /// @notice 2P: queue NIMORI on a difficulty. Credited by what actually arrives.
    function deposit2P(uint8 difficulty, uint256 amount) external nonReentrant returns (uint256 id) {
        if (paused) revert Paused();
        if (difficulty > HARD) revert BadDifficulty();
        uint256 before = nimori.balanceOf(address(this));
        nimori.safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = nimori.balanceOf(address(this)) - before;
        if (received < minNimoriDeposit) revert BelowMinimum();
        if (received > type(uint128).max) revert TooLarge();
        id = _enqueue(msg.sender, difficulty, P2, received);
        totalQueuedNimori += received;
        _autoMatch(difficulty);
    }

    /// @notice Takes back the unmatched remainder of a deposit. Any time, paused or not.
    function withdrawQueued(uint256 depositId) external nonReentrant {
        Deposit memory d = deposits[depositId];
        if (d.owner != msg.sender) revert NotDepositor();
        if (d.amount == 0) revert NotQueued();
        _unlink(d);
        delete deposits[depositId];
        if (d.side == P1) {
            totalQueuedEth -= d.amount;
            _sendEth(msg.sender, d.amount);
        } else {
            totalQueuedNimori -= d.amount;
            nimori.safeTransfer(msg.sender, d.amount);
        }
        emit WithdrawnQueued(depositId, msg.sender, d.amount);
    }

    /// @notice Pulls dust refunds (remainders under the minimum after a partial fill).
    function withdrawOwed() external nonReentrant {
        Credit memory c = owed[msg.sender];
        delete owed[msg.sender];
        totalOwedEth -= c.eth;
        totalOwedNimori -= c.nimori;
        if (c.nimori > 0) nimori.safeTransfer(msg.sender, c.nimori);
        if (c.eth > 0) _sendEth(msg.sender, c.eth);
        emit OwedWithdrawn(msg.sender, c.eth, c.nimori);
    }

    // ------------------------------------------------------------------ matching

    /// @notice Pairs up to `maxPairs` heads of the two queues of a difficulty. Permissionless.
    function matchQueue(uint8 difficulty, uint256 maxPairs) external nonReentrant returns (uint256 matched) {
        if (paused) revert Paused();
        if (difficulty > HARD) revert BadDifficulty();
        _requirePrice();
        matched = _matchLoop(difficulty, maxPairs);
        if (matched == 0) revert NothingToMatch();
    }

    function _autoMatch(uint8 difficulty) internal {
        if (!poolInitialized) return;
        (bool ok,,,, bool refUsed,) = priceStatus();
        if (!ok || !refUsed) return;
        _matchLoop(difficulty, AUTO_MATCH_PAIRS);
    }

    struct MatchCtx {
        uint8 difficulty;
        int24 lower;
        int24 upper;
        uint160 sqrtP;
        uint160 sqrtA;
        uint160 sqrtB;
    }

    function _matchLoop(uint8 difficulty, uint256 maxPairs) internal returns (uint256 matched) {
        if (!poolInitialized) revert PoolNotReady();
        if (maxPairs > MAX_PAIRS_PER_CALL) maxPairs = MAX_PAIRS_PER_CALL;
        MatchCtx memory c;
        c.difficulty = difficulty;
        int24 tick;
        (c.sqrtP, tick,,) = poolManager.getSlot0(poolId());
        (c.lower, c.upper) = _range(difficulty, tick);
        c.sqrtA = TickMath.getSqrtPriceAtTick(c.lower);
        c.sqrtB = TickMath.getSqrtPriceAtTick(c.upper);

        // Every iteration removes at least one head (a full fill, a dust refund or a zero-liquidity refund),
        // so the loop always progresses; `steps` bounds the work, `matched` counts real sessions.
        for (uint256 steps; steps < maxPairs * 2 && matched < maxPairs; steps++) {
            uint64 h1 = _queues[difficulty][P1].head;
            uint64 h2 = _queues[difficulty][P2].head;
            if (h1 == 0 || h2 == 0) break;
            if (_matchOne(c, h1, h2)) matched++;
        }
    }

    function _matchOne(MatchCtx memory c, uint64 h1, uint64 h2) internal returns (bool) {
        uint256 amt1 = deposits[h1].amount;
        uint256 amt2 = deposits[h2].amount;

        uint128 liq = LiquidityAmounts.getLiquidityForAmounts(c.sqrtP, c.sqrtA, c.sqrtB, amt1, amt2);
        if (liq == 0) {
            // One side is too small to mint any liquidity at this price: hand it back, keep the other.
            // The range is always built around the current tick, so the price is strictly inside it.
            uint128 l0 = LiquidityAmounts.getLiquidityForAmount0(c.sqrtP, c.sqrtB, amt1);
            _refundHead(l0 == 0 ? h1 : h2);
            return false;
        }

        uint256 sid = nextSessionId++;
        (uint256 e0, uint256 n0) = abi.decode(
            poolManager.unlock(abi.encode(uint8(0), sid, c.lower, c.upper, int256(uint256(liq)))), (uint256, uint256)
        );
        if (e0 > amt1 || n0 > amt2) revert UnusedAmount();

        sessions[sid] = Session({
            difficulty: c.difficulty,
            open: true,
            tickLower: c.lower,
            tickUpper: c.upper,
            start: uint64(block.timestamp),
            liquidity: liq,
            e0: uint128(e0),
            n0: uint128(n0)
        });
        totalQueuedEth -= e0;
        totalQueuedNimori -= n0;
        address o1 = deposits[h1].owner;
        address o2 = deposits[h2].owner;
        _consume(h1, amt1 - e0, minEthDeposit);
        _consume(h2, amt2 - n0, minNimoriDeposit);
        _mint(o1, sid * 2);
        _mint(o2, sid * 2 + 1);
        emit SessionOpened(sid, c.difficulty, c.lower, c.upper);
        emit Matched(sid, h1, h2, liq, e0, n0);
        return true;
    }

    /// @notice The position range for a difficulty around a tick.
    function rangeFor(uint8 difficulty, int24 tick) external pure returns (int24, int24) {
        return _range(difficulty, tick);
    }

    function _range(uint8 difficulty, int24 tick) internal pure returns (int24 lower, int24 upper) {
        int24 minT = TickMath.minUsableTick(TICK_SPACING);
        int24 maxT = TickMath.maxUsableTick(TICK_SPACING);
        if (difficulty == EASY) return (minT, maxT);
        int24 half = difficulty == NORMAL ? NORMAL_HALF_WIDTH : HARD_HALF_WIDTH;
        int24 base = tick / TICK_SPACING;
        if (tick < 0 && tick % TICK_SPACING != 0) base--; // floor, not truncation
        base *= TICK_SPACING;
        lower = base - half;
        upper = base + half;
        if (lower < minT) lower = minT;
        if (upper > maxT) upper = maxT;
    }

    // ------------------------------------------------------------------ fees

    /// @notice Collects the session's trading fees and credits them to both seats. Anyone may call.
    function collectFees(uint256 sessionId) external nonReentrant {
        Session memory s = sessions[sessionId];
        if (!s.open) revert SessionClosed();
        (uint256 f0, uint256 f1) =
            abi.decode(poolManager.unlock(abi.encode(uint8(1), sessionId, s.tickLower, s.tickUpper, int256(0))), (uint256, uint256));
        uint256 burned = _creditFees(sessionId, f0, f1);
        _afterProtocol(burned);
    }

    /// @dev 10% off the top (ETH to the Arcade, NIMORI burned), the rest 50/50. Returns the NIMORI to burn.
    function _creditFees(uint256 sid, uint256 f0, uint256 f1) internal returns (uint256 p1) {
        uint256 p0 = (f0 * PROTOCOL_FEE_BPS) / BPS;
        p1 = (f1 * PROTOCOL_FEE_BPS) / BPS;
        uint256 r0 = f0 - p0;
        uint256 r1 = f1 - p1;
        uint256 half0 = r0 / 2;
        uint256 half1 = r1 / 2;
        _credit(sid * 2, half0, half1);
        _credit(sid * 2 + 1, r0 - half0, r1 - half1);
        protocolEthPending += p0;
        emit FeesCollected(sid, f0, f1, p0, p1);
    }

    // ------------------------------------------------------------------ exit

    /// @notice Ends the session. Callable by the owner of either seat. Before 24 h it is a rage quit: 1% of the
    ///         caller's settlement goes to the partner seat.
    function unplug(uint256 seatId) external nonReentrant {
        if (ownerOf(seatId) != msg.sender) revert NotSeatOwner();
        uint256 sid = seatId / 2;
        Session memory s = sessions[sid];
        if (!s.open) revert SessionClosed();
        uint256 req = unplugRequestedAt[sid];
        if (req != 0 && block.timestamp >= req + UNPLUG_DELAY) {
            emit UnplugEscaped(sid, seatId); // escape hatch: no price guard
        } else {
            _requireExitPrice();
        }

        sessions[sid].open = false;
        (uint256 a, uint256 b, uint256 f0, uint256 f1) = abi.decode(
            poolManager.unlock(
                abi.encode(uint8(2), sid, s.tickLower, s.tickUpper, -int256(uint256(s.liquidity)))
            ),
            (uint256, uint256, uint256, uint256)
        );
        uint256 burned = _creditFees(sid, f0, f1);

        (uint256 eth1, uint256 nim1, uint256 eth2, uint256 nim2) = settle(a, b, s.e0, s.n0);

        bool rage = block.timestamp < uint256(s.start) + MIN_SESSION;
        if (rage) {
            if (seatId % 2 == 0) {
                uint256 pe = (eth1 * RAGE_QUIT_BPS) / BPS;
                uint256 pn = (nim1 * RAGE_QUIT_BPS) / BPS;
                eth1 -= pe;
                nim1 -= pn;
                eth2 += pe;
                nim2 += pn;
            } else {
                uint256 pe = (eth2 * RAGE_QUIT_BPS) / BPS;
                uint256 pn = (nim2 * RAGE_QUIT_BPS) / BPS;
                eth2 -= pe;
                nim2 -= pn;
                eth1 += pe;
                nim1 += pn;
            }
        }
        _credit(sid * 2, eth1, nim1);
        _credit(sid * 2 + 1, eth2, nim2);
        emit Unplugged(sid, seatId, a, b, eth1, nim1, eth2, nim2, rage);
        _afterProtocol(burned);
    }

    /// @notice The mover rule, in kind. Pure so it can be read (and fuzzed) on its own.
    /// @return eth1 ETH to 1P, nim1 NIMORI to 1P, eth2 ETH to 2P, nim2 NIMORI to 2P. Always eth1 + eth2 == a
    ///         and nim1 + nim2 == b.
    function settle(uint256 a, uint256 b, uint256 e0, uint256 n0)
        public
        pure
        returns (uint256 eth1, uint256 nim1, uint256 eth2, uint256 nim2)
    {
        if (a >= e0) {
            // NIMORI rose against ETH: 2P is the mover, 1P is repaid its ETH.
            eth1 = e0;
            eth2 = a - e0;
            nim2 = b;
        } else {
            // ETH rose against NIMORI: 1P is the mover, 2P is repaid its NIMORI (capped at what came out).
            nim2 = b < n0 ? b : n0;
            eth1 = a;
            nim1 = b - nim2;
        }
    }

    /// @notice When the exit guard refuses an unplug, a seat owner starts a 1-hour clock; after it, either seat
    ///         holder can unplug without the guard. The rage-quit fee still counts from session start to the
    ///         actual exit. One request per session; it is not reset.
    function requestUnplug(uint256 seatId) external {
        if (ownerOf(seatId) != msg.sender) revert NotSeatOwner();
        uint256 sid = seatId / 2;
        if (!sessions[sid].open) revert SessionClosed();
        if (unplugRequestedAt[sid] != 0) revert AlreadyRequested();
        (bool ok,,,) = exitPriceStatus();
        if (ok) revert GuardPasses();
        unplugRequestedAt[sid] = uint64(block.timestamp);
        emit UnplugRequested(sid, seatId, block.timestamp + UNPLUG_DELAY);
    }

    // ------------------------------------------------------------------ claims

    /// @notice Sends a seat's credit (fees, and the settlement once unplugged) to its owner.
    function claim(uint256 seatId) external nonReentrant {
        _claim(seatId, msg.sender);
    }

    /// @notice Same as {claim} to another address, for an owner that cannot receive ETH.
    function claimTo(uint256 seatId, address to) external nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        _claim(seatId, to);
    }

    function _claim(uint256 seatId, address to) internal {
        if (ownerOf(seatId) != msg.sender) revert NotSeatOwner();
        Credit memory c = credits[seatId];
        delete credits[seatId];
        totalCreditEth -= c.eth;
        totalCreditNimori -= c.nimori;
        // A closed session's seat has nothing left to earn: retire it once paid out.
        if (!sessions[seatId / 2].open) _burn(seatId);
        if (c.nimori > 0) nimori.safeTransfer(to, c.nimori);
        if (c.eth > 0) _sendEth(to, c.eth);
        emit Claimed(seatId, to, c.eth, c.nimori);
    }

    /// @notice Retries the protocol ETH push to the Arcade if an earlier one failed. Anyone may call.
    function pushProtocol() external nonReentrant {
        _pushProtocol();
    }

    /// @notice Pushes anything above recorded liabilities to the existing sinks: ETH to the Arcade, NIMORI to
    ///         the burn address. No address argument: there is nowhere else it can go.
    function skim() external nonReentrant {
        (uint256 le, uint256 ln) = liabilities();
        uint256 be = address(this).balance;
        uint256 bn = nimori.balanceOf(address(this));
        uint256 se = be > le ? be - le : 0;
        uint256 sn = bn > ln ? bn - ln : 0;
        protocolEthPending += se;
        emit Skimmed(se, sn);
        if (sn > 0) nimori.safeTransfer(BURN, sn);
        _pushProtocol();
    }

    // ------------------------------------------------------------------ views

    /// @notice What the lobby owes, in ETH and NIMORI. Its balances must always cover these.
    function liabilities() public view returns (uint256 eth, uint256 nim) {
        eth = totalQueuedEth + totalCreditEth + totalOwedEth + protocolEthPending;
        nim = totalQueuedNimori + totalCreditNimori + totalOwedNimori;
    }

    function queueHead(uint8 difficulty, uint8 side) external view returns (uint64 head, uint64 tail) {
        Queue memory q = _queues[difficulty][side];
        return (q.head, q.tail);
    }

    /// @notice The EXIT guard: spot within maxExitDeviationTicks of the 30-minute TWAP. Not ok while the TWAP has
    ///         no history yet (the escape hatch covers that case too).
    function exitPriceStatus() public view returns (bool ok, int24 spot, bool twapUsed, int24 twap) {
        (, spot,,) = poolManager.getSlot0(poolId());
        try INimoriOracle(address(hook)).consult(poolId(), TWAP_WINDOW) returns (int24 t, uint32) {
            twapUsed = true;
            twap = t;
            ok = _absDiff(spot, t) <= uint24(maxExitDeviationTicks);
        } catch {}
    }

    /// @notice The MATCH price guard. `ok` requires at least one usable guard and every usable guard within bounds:
    ///         - spot vs the hook's 30-minute TWAP (usable once the oracle has 30 minutes of history);
    ///         - spot vs the Pons reference pool (usable once set, while it has in-range liquidity).
    function priceStatus()
        public
        view
        returns (bool ok, int24 spot, bool twapUsed, int24 twap, bool refUsed, int24 ref)
    {
        (, spot,,) = poolManager.getSlot0(poolId());
        ok = true;
        try INimoriOracle(address(hook)).consult(poolId(), TWAP_WINDOW) returns (int24 t, uint32) {
            twapUsed = true;
            twap = t;
            if (_absDiff(spot, t) > uint24(maxDeviationTicks)) ok = false;
        } catch {}
        if (referenceSet && poolManager.getLiquidity(referenceId) > 0) {
            (, int24 r,,) = poolManager.getSlot0(referenceId);
            ref = referenceInverted ? -r : r;
            refUsed = true;
            if (_absDiff(spot, ref) > uint24(maxRefDeviationTicks)) ok = false;
        }
        if (!twapUsed && !refUsed) ok = false;
    }

    // ------------------------------------------------------------------ v4 callback

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        (uint8 action, uint256 sid, int24 lower, int24 upper, int256 liqDelta) =
            abi.decode(data, (uint8, uint256, int24, int24, int256));
        PoolKey memory key = poolKey();
        (BalanceDelta delta, BalanceDelta fees) = poolManager.modifyLiquidity(
            key,
            ModifyLiquidityParams({tickLower: lower, tickUpper: upper, liquidityDelta: liqDelta, salt: bytes32(sid)}),
            ""
        );
        if (action == 0) {
            // Fresh position (unique salt): no fees, the delta is the principal owed.
            uint256 owe0 = _neg(delta.amount0());
            uint256 owe1 = _neg(delta.amount1());
            if (owe0 > 0) poolManager.settle{value: owe0}();
            if (owe1 > 0) {
                poolManager.sync(key.currency1);
                nimori.safeTransfer(address(poolManager), owe1);
                poolManager.settle();
            }
            return abi.encode(owe0, owe1);
        }
        uint256 got0 = _pos(delta.amount0());
        uint256 got1 = _pos(delta.amount1());
        if (got0 > 0) poolManager.take(key.currency0, address(this), got0);
        if (got1 > 0) poolManager.take(key.currency1, address(this), got1);
        if (action == 1) return abi.encode(got0, got1); // poke: all of it is fees
        uint256 fee0 = _pos(fees.amount0());
        uint256 fee1 = _pos(fees.amount1());
        // callerDelta = principal + fees: the principal is what is left after the fees.
        return abi.encode(got0 - fee0, got1 - fee1, fee0, fee1);
    }

    // ------------------------------------------------------------------ internals

    /// @dev A MATCH needs the live reference pool on top of the TWAP: an empty co-op pool's TWAP costs nothing
    ///      to drag and hold, so before the first sessions it is the Pons pool that anchors the price.
    function _requirePrice() internal view virtual {
        if (!poolInitialized) revert PoolNotReady();
        (bool ok, int24 spot, bool tu, int24 t, bool ru, int24 r) = priceStatus();
        if (!ok || !ru) revert PriceGuard(spot, t, tu, r, ru);
    }

    function _requireExitPrice() internal view virtual {
        (bool ok, int24 spot, bool tu, int24 t) = exitPriceStatus();
        if (!ok) revert ExitGuard(spot, t, tu);
    }

    function _enqueue(address owner_, uint8 difficulty, uint8 side, uint256 amount) internal returns (uint256 id) {
        uint64 id64 = nextDepositId++;
        Queue storage q = _queues[difficulty][side];
        deposits[id64] = Deposit({
            owner: owner_,
            difficulty: difficulty,
            side: side,
            amount: uint128(amount),
            prev: q.tail,
            next: 0
        });
        if (q.tail == 0) q.head = id64;
        else deposits[q.tail].next = id64;
        q.tail = id64;
        emit Deposited(id64, owner_, difficulty, side, amount);
        return id64;
    }

    function _unlink(Deposit memory d) internal {
        Queue storage q = _queues[d.difficulty][d.side];
        if (d.prev == 0) q.head = d.next;
        else deposits[d.prev].next = d.next;
        if (d.next == 0) q.tail = d.prev;
        else deposits[d.next].prev = d.prev;
    }

    /// @dev Sets a matched head to its remainder; under the minimum it is refunded as owed dust.
    function _consume(uint64 id, uint256 remaining, uint256 minimum) internal {
        if (remaining >= minimum) {
            deposits[id].amount = uint128(remaining);
            return;
        }
        deposits[id].amount = uint128(remaining);
        _refundHead(id);
    }

    /// @dev Removes a deposit from its queue and moves what it has left to its owner's owed balance (pull).
    function _refundHead(uint64 id) internal {
        Deposit memory d = deposits[id];
        _unlink(d);
        delete deposits[id];
        if (d.amount == 0) return;
        if (d.side == P1) {
            totalQueuedEth -= d.amount;
            totalOwedEth += d.amount;
            owed[d.owner].eth += d.amount;
        } else {
            totalQueuedNimori -= d.amount;
            totalOwedNimori += d.amount;
            owed[d.owner].nimori += d.amount;
        }
        emit DustRefunded(id, d.owner, d.side, d.amount);
    }

    function _credit(uint256 seatId, uint256 eth, uint256 nim) internal {
        Credit storage c = credits[seatId];
        c.eth += uint128(eth);
        c.nimori += uint128(nim);
        totalCreditEth += eth;
        totalCreditNimori += nim;
    }

    function _afterProtocol(uint256 burned) internal {
        if (burned > 0) nimori.safeTransfer(BURN, burned);
        _pushProtocol();
    }

    function _pushProtocol() internal {
        uint256 amt = protocolEthPending;
        if (amt == 0) return;
        protocolEthPending = 0;
        address to = arcade;
        (bool ok,) = to.call{value: amt, gas: ARCADE_GAS}("");
        if (!ok) protocolEthPending = amt; // kept for a later {pushProtocol}
        emit ProtocolPushed(to, amt, ok);
    }

    function _sendEth(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }

    function _absDiff(int24 x, int24 y) internal pure returns (uint24) {
        int256 d = int256(x) - int256(y);
        return uint24(uint256(d < 0 ? -d : d));
    }

    function _neg(int128 v) internal pure returns (uint256) {
        return v < 0 ? uint256(uint128(-v)) : 0;
    }

    function _pos(int128 v) internal pure returns (uint256) {
        return v > 0 ? uint256(uint128(v)) : 0;
    }
}
