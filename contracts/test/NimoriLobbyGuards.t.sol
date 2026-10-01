// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";

import {NimoriLobby} from "../src/NimoriLobby.sol";
import {LobbyBase} from "./utils/LobbyBase.sol";
import {MockNimori} from "./utils/MockNimori.sol";

/// @notice Guard edge cases on fresh lobbies (each with its own token, so its own fresh pool and oracle).
contract NimoriLobbyGuardsTest is LobbyBase {
    function _fresh(address weth) internal returns (NimoriLobby l, MockNimori t) {
        t = new MockNimori();
        l = new NimoriLobby(pm, IHooks(address(hook)), address(t), weth, address(arcade), MIN_NIM, address(this));
        l.initializePool(TickMath.getSqrtPriceAtTick(INIT_TICK));
    }

    /// @notice A WETH-paired reference listing NIMORI as currency0 quotes WETH per NIMORI: the lobby must invert
    ///         it before comparing, or every match and exit would be refused (or a wrong price accepted).
    function test_reference_wethPairedAndInverted() public {
        MockNimori x = new MockNimori();
        MockNimori y = new MockNimori();
        (MockNimori tok, MockNimori weth) = address(x) < address(y) ? (x, y) : (y, x);
        NimoriLobby l = new NimoriLobby(pm, IHooks(address(hook)), address(tok), address(weth), address(arcade), MIN_NIM, address(this));
        l.initializePool(TickMath.getSqrtPriceAtTick(INIT_TICK));
        PoolKey memory rk = PoolKey(Currency.wrap(address(tok)), Currency.wrap(address(weth)), 0, 60, IHooks(address(0)));
        pm.initialize(rk, TickMath.getSqrtPriceAtTick(-INIT_TICK)); // WETH per NIMORI = 1e-6
        tok.mint(address(this), 1e36);
        weth.mint(address(this), 1e36);
        tok.approve(address(ops), type(uint256).max);
        weth.approve(address(ops), type(uint256).max);
        ops.modifyLiquidity(rk, -887220, 887220, 1e22, 0);
        l.setReferencePool(rk);
        assertTrue(l.referenceInverted());
        (bool ok,,,, bool refUsed, int24 ref) = l.priceStatus();
        assertTrue(refUsed);
        assertEq(ref, INIT_TICK, "inverted reference read back in NIMORI per ETH");
        assertTrue(ok);
    }

    function test_reference_rejectsForeignPairs() public {
        (NimoriLobby l, MockNimori t) = _fresh(address(0));
        MockNimori other = new MockNimori();
        PoolKey memory bad = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(other)), 0, 60, IHooks(address(0)));
        pm.initialize(bad, TickMath.getSqrtPriceAtTick(0));
        vm.expectRevert(NimoriLobby.BadReference.selector);
        l.setReferencePool(bad);
        // its own co-op pool is not a reference
        PoolKey memory own = l.poolKey();
        vm.expectRevert(NimoriLobby.BadReference.selector);
        l.setReferencePool(own);
        // uninitialized pool
        PoolKey memory ghost = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(t)), 0, 10, IHooks(address(0)));
        vm.expectRevert(NimoriLobby.BadReference.selector);
        l.setReferencePool(ghost);
    }

    /// @notice No reference and no 30 minutes of TWAP yet: no guard can run, so nothing matches.
    function test_noGuardAvailable_refusesToMatch_thenTwapAlone() public {
        (NimoriLobby l, MockNimori t) = _fresh(address(0));
        (bool ok,, bool tu,, bool ru,) = l.priceStatus();
        assertFalse(tu);
        assertFalse(ru);
        assertFalse(ok, "no guard at all must mean NOT ok");
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        l.deposit1P{value: 1 ether}(0);
        t.mint(bob, 1_000_000e18);
        vm.startPrank(bob);
        t.approve(address(l), type(uint256).max);
        l.deposit2P(0, 1_000_000e18);
        vm.stopPrank();
        assertEq(l.nextSessionId(), 1, "auto-match must not run unguarded");
        vm.expectRevert();
        l.matchQueue(0, 1);
        vm.warp(_now() + 30 minutes);
        (ok,, tu,,,) = l.priceStatus();
        assertTrue(tu && ok, "TWAP alone passes the status check (it is what exits rely on)");
        // ...but a MATCH also needs the live reference: an empty pool's TWAP is free to drag.
        vm.expectRevert();
        l.matchQueue(0, 1);
        PoolKey memory rk = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(t)), 0, 60, IHooks(address(0)));
        pm.initialize(rk, TickMath.getSqrtPriceAtTick(INIT_TICK));
        t.mint(address(this), 1e36);
        t.approve(address(ops), type(uint256).max);
        ops.modifyLiquidity{value: 1e6 ether}(rk, -887220, 887220, 1e22, 0);
        l.setReferencePool(rk);
        assertEq(l.matchQueue(0, 1), 1);
    }

    /// @notice Fresh pool, reference set: the reference guard alone runs before the TWAP exists.
    function test_freshPool_referenceAloneGuards() public {
        (NimoriLobby l, MockNimori t) = _fresh(address(0));
        PoolKey memory rk = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(t)), 0, 60, IHooks(address(0)));
        pm.initialize(rk, TickMath.getSqrtPriceAtTick(INIT_TICK + 700));
        t.mint(address(this), 1e36);
        t.approve(address(ops), type(uint256).max);
        ops.modifyLiquidity{value: 1e6 ether}(rk, -887220, 887220, 1e22, 0);
        l.setReferencePool(rk);
        (bool ok,, bool tu,, bool ru,) = l.priceStatus();
        assertFalse(tu);
        assertTrue(ru);
        assertFalse(ok, "700 ticks off the reference");
        _moveTo(rk, TickMath.getSqrtPriceAtTick(INIT_TICK + 100));
        (ok,,,,,) = l.priceStatus();
        assertTrue(ok);
    }

    /// @notice A reference pool with no in-range liquidity is ignored (it has no price worth defending), and
    ///         the TWAP guard still applies.
    function test_deadReference_ignored_twapStillGuards() public {
        (NimoriLobby l, MockNimori t) = _fresh(address(0));
        PoolKey memory rk = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(t)), 0, 60, IHooks(address(0)));
        pm.initialize(rk, TickMath.getSqrtPriceAtTick(-50_000)); // absurd price, no liquidity
        l.setReferencePool(rk);
        vm.warp(_now() + 31 minutes);
        (bool ok,, bool tu,, bool ru,) = l.priceStatus();
        assertTrue(tu);
        assertFalse(ru, "dead reference must be skipped");
        assertTrue(ok, "exits stay open on the TWAP alone");
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        l.deposit1P{value: 1 ether}(0);
        t.mint(bob, 1_000_000e18);
        vm.startPrank(bob);
        t.approve(address(l), type(uint256).max);
        l.deposit2P(0, 1_000_000e18);
        vm.stopPrank();
        assertEq(l.nextSessionId(), 1, "no match on a dead reference");
        vm.expectRevert();
        l.matchQueue(0, 1);
    }
}
