// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/src/types/BeforeSwapDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";

/// @title  NIMORI hook: a time-weighted average tick oracle for any pool that uses it.
///
/// @notice Two callbacks only: `afterInitialize` (opens the oracle) and `beforeSwap` (writes it). The hook
///         takes no fee, returns no delta, never donates and never holds a token. It is token-agnostic:
///         every pool that names it gets its own independent oracle, keyed by pool id.
///
/// @dev    🔑 WHAT IS CREDITED. At the first swap of a new timestamp, the hook reads the pool tick BEFORE that
///         swap executes and credits it for the whole time elapsed since the previous write. That tick is the
///         one that prevailed over the interval (only swaps move a v4 price), so the accumulator is exact.
///         A tick reached by a swap is credited only if it survives into a LATER timestamp, i.e. only if it
///         sat in the open for arbitrageurs. A buy-then-sell inside one transaction or one block credits
///         nothing: the write for that timestamp already happened, with the pre-swap tick, before the first
///         swap moved the price. Crediting the POST-swap tick instead would let one atomic round trip stamp
///         a chosen tick over the whole elapsed interval.
///
/// @dev    🔑 STORAGE. The cumulative is updated at most once per timestamp (one write per block, at most).
///         The ring buffer keeps entries at least `SPACING` seconds apart: the newest entry "floats" (it is
///         overwritten in place) until it is `SPACING` older than the entry before it, then a new slot opens.
///         So `CARDINALITY` entries always cover at least `(CARDINALITY - 2) * SPACING` seconds of history,
///         however busy the pool is. A per-block ring of fixed size would instead shrink its coverage to a
///         few minutes on a chain with sub-second blocks, and every consumer of the oracle would start to
///         revert exactly when the pool is busiest.
contract NimoriHook is IHooks {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// @notice Minimum distance between two frozen ring entries.
    uint32 public constant SPACING = 60;
    /// @notice Ring size. 128 entries at >= 60 s apart = more than two hours of history.
    uint16 public constant CARDINALITY = 128;

    struct Observation {
        uint32 timestamp;
        int56 tickCumulative;
    }

    struct OracleState {
        uint16 index; // slot of the newest entry
        uint16 count; // entries written so far, capped at CARDINALITY
        bool initialized;
    }

    IPoolManager public immutable poolManager;

    mapping(PoolId => OracleState) public oracleState;
    mapping(PoolId => Observation[CARDINALITY]) internal _observations;

    event OracleOpened(PoolId indexed id, int24 tick, uint32 timestamp);

    error NotPoolManager();
    error HookNotImplemented();
    error OracleNotInitialized();
    error NotEnoughHistory();
    error ZeroWindow();

    constructor(IPoolManager pm) {
        poolManager = pm;
        Hooks.validateHookPermissions(
            IHooks(address(this)),
            Hooks.Permissions({
                beforeInitialize: false,
                afterInitialize: true,
                beforeAddLiquidity: false,
                afterAddLiquidity: false,
                beforeRemoveLiquidity: false,
                afterRemoveLiquidity: false,
                beforeSwap: true,
                afterSwap: false,
                beforeDonate: false,
                afterDonate: false,
                beforeSwapReturnDelta: false,
                afterSwapReturnDelta: false,
                afterAddLiquidityReturnDelta: false,
                afterRemoveLiquidityReturnDelta: false
            })
        );
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        _;
    }

    // ------------------------------------------------------------------ the two callbacks

    function afterInitialize(address, PoolKey calldata key, uint160, int24 tick)
        external
        onlyPoolManager
        returns (bytes4)
    {
        PoolId id = key.toId();
        // A v4 pool can only be initialized once, so this runs once per pool id.
        _observations[id][0] = Observation({timestamp: uint32(block.timestamp), tickCumulative: 0});
        oracleState[id] = OracleState({index: 0, count: 1, initialized: true});
        emit OracleOpened(id, tick, uint32(block.timestamp));
        return IHooks.afterInitialize.selector;
    }

    function beforeSwap(address, PoolKey calldata key, SwapParams calldata, bytes calldata)
        external
        onlyPoolManager
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        PoolId id = key.toId();
        OracleState memory st = oracleState[id];
        if (st.initialized) {
            Observation memory last = _observations[id][st.index];
            uint32 nowTs = uint32(block.timestamp);
            if (last.timestamp != nowTs) {
                // The tick BEFORE this swap: it has held since the last swap of an earlier timestamp.
                (, int24 tick,,) = poolManager.getSlot0(id);
                Observation memory next = Observation({
                    timestamp: nowTs,
                    tickCumulative: last.tickCumulative + int56(tick) * int56(uint56(nowTs - last.timestamp))
                });
                uint16 slot = st.index;
                if (st.count == 1) {
                    slot = 1; // keep the opening entry as an anchor
                } else {
                    Observation memory prev = _observations[id][(st.index + CARDINALITY - 1) % CARDINALITY];
                    if (last.timestamp - prev.timestamp >= SPACING) slot = (st.index + 1) % CARDINALITY;
                }
                _observations[id][slot] = next;
                if (slot != st.index) {
                    st.index = slot;
                    if (st.count < CARDINALITY) st.count += 1;
                    oracleState[id] = st;
                }
            }
        }
        return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    // ------------------------------------------------------------------ reads

    /// @notice Arithmetic-mean tick over a window of AT LEAST `secondsAgo` seconds ending now.
    /// @dev    The window starts at the newest ring entry at or before `now - secondsAgo`, so it is exact
    ///         (no interpolation) and can be longer than asked when the pool is quiet. Reverts with
    ///         {NotEnoughHistory} when the oracle is younger than `secondsAgo`.
    function consult(PoolId id, uint32 secondsAgo) external view returns (int24 meanTick, uint32 window) {
        if (secondsAgo == 0) revert ZeroWindow();
        OracleState memory st = oracleState[id];
        if (!st.initialized) revert OracleNotInitialized();

        uint32 nowTs = uint32(block.timestamp);
        if (nowTs < secondsAgo) revert NotEnoughHistory();
        uint32 target = nowTs - secondsAgo;

        Observation memory head = _observations[id][st.index];
        (, int24 spot,,) = poolManager.getSlot0(id);
        // No swap since `head` (any swap at a later timestamp would have written), so the spot tick is the
        // tick that has held since then.
        int56 cumNow = head.tickCumulative + int56(spot) * int56(uint56(nowTs - head.timestamp));

        Observation memory start = _atOrBefore(id, st, target);
        window = nowTs - start.timestamp;
        int56 delta = cumNow - start.tickCumulative;
        int56 w = int56(uint56(window));
        meanTick = int24(delta / w);
        // Round toward negative infinity, like the v3 oracle.
        if (delta < 0 && (delta % w != 0)) meanTick--;
    }

    /// @notice The newest observation and the number of ring entries, for monitoring.
    function latest(PoolId id) external view returns (uint32 timestamp, int56 tickCumulative, uint16 count) {
        OracleState memory st = oracleState[id];
        Observation memory o = _observations[id][st.index];
        return (o.timestamp, o.tickCumulative, st.count);
    }

    function observation(PoolId id, uint16 slot) external view returns (Observation memory) {
        return _observations[id][slot % CARDINALITY];
    }

    /// @dev Binary search over the ring, oldest to newest, for the newest entry with timestamp <= target.
    function _atOrBefore(PoolId id, OracleState memory st, uint32 target) internal view returns (Observation memory) {
        Observation[CARDINALITY] storage obs = _observations[id];
        uint256 n = st.count;
        uint256 oldest = n < CARDINALITY ? 0 : (uint256(st.index) + 1) % CARDINALITY;

        Observation memory first = obs[oldest];
        if (first.timestamp > target) revert NotEnoughHistory();

        // Invariant: logical index lo is <= target; hi is the last logical index.
        uint256 lo = 0;
        uint256 hi = n - 1;
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            if (obs[(oldest + mid) % CARDINALITY].timestamp <= target) lo = mid;
            else hi = mid - 1;
        }
        return obs[(oldest + lo) % CARDINALITY];
    }

    // ------------------------------------------------------------------ unused callbacks

    function beforeInitialize(address, PoolKey calldata, uint160) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function beforeAddLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeRemoveLiquidity(address, PoolKey calldata, ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function afterSwap(address, PoolKey calldata, SwapParams calldata, BalanceDelta, bytes calldata)
        external
        pure
        returns (bytes4, int128)
    {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }
}
