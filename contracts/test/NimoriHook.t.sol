// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {SwapParams} from "v4-core/src/types/PoolOperation.sol";

import {NimoriHook} from "../src/NimoriHook.sol";
import {LobbyBase} from "./utils/LobbyBase.sol";

/// @notice The oracle, asserted against ticks HELD FAR FROM the opening tick for known durations, with
///         exact expected values (an oracle tested only near a constant passes with the sign flipped).
contract NimoriHookTest is LobbyBase {
    using PoolIdLibrary for PoolKey;

    PoolId internal id;
    uint256 internal t0; // pool opening time (oracle anchor)

    function setUp() public override {
        super.setUp();
        id = key.toId();
        (uint32 ts,,) = hook.latest(id);
        t0 = ts;
    }

    function _goTo(int24 tick) internal {
        _moveTo(key, TickMath.getSqrtPriceAtTick(tick));
        (, int24 t) = _spot();
        assertEq(t, tick, "pool not at the target tick");
    }

    function _floorDiv(int256 a, int256 b) internal pure returns (int24) {
        int256 q = a / b;
        if (a < 0 && a % b != 0) q--;
        return int24(q);
    }

    function test_consult_weightsHeldTicksByTime() public {
        int24 t1Tick = INIT_TICK + 4000;
        int24 t2Tick = INIT_TICK - 3000;
        uint256 t1 = _now();
        _goTo(t1Tick); // write at t1 credits INIT_TICK
        vm.warp(t1 + 600);
        _goTo(t2Tick); // write at t1+600 credits t1Tick for 600 s
        vm.warp(t1 + 1800);

        int24 expected = _floorDiv(int256(t1Tick) * 600 + int256(t2Tick) * 1200, 1800);
        (int24 m, uint32 w) = hook.consult(id, 1800);
        assertEq(w, 1800);
        assertEq(m, expected, "1800 s window");

        // A window that starts between two entries extends back to the older one: exact, never interpolated.
        (m, w) = hook.consult(id, 1700);
        assertEq(w, 1800, "window must start at the entry at or before the target");
        assertEq(m, expected, "1700 s window = same 1800 s span");

        (m, w) = hook.consult(id, 1200);
        assertEq(w, 1200);
        assertEq(m, t2Tick, "last 1200 s held at t2");

        // Longer than the swaps: the opening tick is credited from the anchor.
        uint256 sinceOpen = _now() - t0;
        (m, w) = hook.consult(id, uint32(sinceOpen));
        assertEq(w, sinceOpen);
        int256 sum = int256(INIT_TICK) * int256(t1 - t0) + int256(t1Tick) * 600 + int256(t2Tick) * 1200;
        assertEq(m, _floorDiv(sum, int256(sinceOpen)), "since opening");
    }

    function test_consult_roundsTowardNegativeInfinity() public {
        uint256 t1 = _now();
        _goTo(-1001);
        vm.warp(t1 + 600);
        _goTo(-1000);
        vm.warp(t1 + 1800);
        // (-1001*600 - 1000*1200) / 1800 = -1000.33 -> -1001, not -1000.
        (int24 m,) = hook.consult(id, 1800);
        assertEq(m, -1001);
    }

    /// @notice The attack the pre-swap design exists for: push the price and bring it back inside one
    ///         timestamp. The write for that timestamp happened BEFORE the first swap, with the honest tick.
    function test_sameBlockRoundTrip_recordsNothing() public {
        uint256 t1 = _now();
        (uint160 honest,) = _spot();
        _goTo(INIT_TICK + 8000); // +122% in one swap
        _moveTo(key, honest); // and back, same timestamp
        (uint32 ts, int56 cum,) = hook.latest(id);
        assertEq(ts, t1);
        assertEq(cum, int56(INIT_TICK) * int56(int256(t1 - t0)), "cumulative must hold the PRE-swap tick only");

        vm.warp(t1 + 1800);
        (int24 m,) = hook.consult(id, 1800);
        assertEq(m, INIT_TICK, "a same-block round trip moved the TWAP");
    }

    /// @notice Counterpart: a tick that survives into the next timestamp IS credited, for exactly that long.
    function test_tickHeldIntoNextTimestamp_isCredited() public {
        uint256 t1 = _now();
        (uint160 honest,) = _spot();
        _goTo(INIT_TICK + 8000);
        vm.warp(t1 + 1);
        _moveTo(key, honest);
        vm.warp(t1 + 1800);
        (int24 m,) = hook.consult(id, 1800);
        assertEq(m, _floorDiv(int256(INIT_TICK + 8000) + int256(INIT_TICK) * 1799, 1800));
    }

    function test_freshPool_notEnoughHistory_thenAvailable() public {
        PoolKey memory k2 = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(nim)), 3000, 60, IHooks(address(hook)));
        PoolId id2 = k2.toId();
        vm.expectRevert(NimoriHook.OracleNotInitialized.selector);
        hook.consult(id2, 1800);
        pm.initialize(k2, TickMath.getSqrtPriceAtTick(-5000));
        vm.expectRevert(NimoriHook.NotEnoughHistory.selector);
        hook.consult(id2, 1800);
        vm.expectRevert(NimoriHook.ZeroWindow.selector);
        hook.consult(id2, 0);
        vm.warp(_now() + 1800);
        (int24 m,) = hook.consult(id2, 1800);
        assertEq(m, -5000, "independent oracle per pool");
        // the co-op pool's oracle is untouched by the second pool
        (m,) = hook.consult(id, 1800);
        assertEq(m, INIT_TICK);
    }

    /// @notice A busy pool (a swap every 20 s for 3 h) keeps more than two hours of history: the ring holds
    ///         entries >= SPACING apart, so its coverage does not shrink with traffic.
    function test_busyPool_ringKeepsTwoHours() public {
        (uint160 base,) = _spot();
        uint256 start = _now();
        for (uint256 i; i < 540; i++) {
            vm.warp(start + i * 20);
            if (i % 2 == 0) ops.swap{value: 0.01 ether}(key, true, -0.01 ether, 0);
            else _moveTo(key, base);
        }
        (,, uint16 count) = hook.latest(id);
        assertEq(count, hook.CARDINALITY(), "ring should be full");
        // Half the time at the base tick, half one 0.01 ETH sell below it (~20 ticks): mean ~10 under.
        (int24 m, uint32 w) = hook.consult(id, 2 hours);
        assertGe(w, 2 hours);
        assertLt(m, INIT_TICK);
        assertGt(m, INIT_TICK - 25);
        (m,) = hook.consult(id, 1800);
        assertLt(m, INIT_TICK);
        assertGt(m, INIT_TICK - 25);
        vm.expectRevert(NimoriHook.NotEnoughHistory.selector);
        hook.consult(id, 4 hours);
    }

    function test_onlyPoolManager() public {
        SwapParams memory p = SwapParams(true, -1, 0);
        vm.expectRevert(NimoriHook.NotPoolManager.selector);
        hook.beforeSwap(address(this), key, p, "");
        vm.expectRevert(NimoriHook.NotPoolManager.selector);
        hook.afterInitialize(address(this), key, 0, 0);
    }

    function test_noFeeNoDelta_swapMatchesHooklessPool() public {
        // Same liquidity, same fee, no hook: identical output.
        PoolKey memory plain = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(nim)), 10_000, 200, IHooks(address(0)));
        pm.initialize(plain, TickMath.getSqrtPriceAtTick(INIT_TICK));
        _seed(plain, 200, SEED_L);
        uint256 b0 = nim.balanceOf(address(this));
        ops.swap{value: 1 ether}(key, true, -1 ether, 0);
        uint256 viaHook = nim.balanceOf(address(this)) - b0;
        b0 = nim.balanceOf(address(this));
        ops.swap{value: 1 ether}(plain, true, -1 ether, 0);
        assertEq(viaHook, nim.balanceOf(address(this)) - b0);
    }
}
