// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Vm} from "forge-std/Vm.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {LiquidityAmounts} from "v4-periphery/src/libraries/LiquidityAmounts.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {NimoriLobby} from "../src/NimoriLobby.sol";
import {LobbyBase} from "./utils/LobbyBase.sol";
import {MockNimori} from "./utils/MockNimori.sol";
import {UnguardedLobby, Attacker} from "./utils/Harness.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";

/// @dev Shared by the guarded and the unguarded sandwich tests, so both run the exact same attack.
abstract contract SandwichBase is LobbyBase {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    /// @dev Divergence of the reference pool only: the lobby's auto-match is skipped, deposits still queue.
    function _breakReference() internal returns (uint160 refBefore) {
        (refBefore,,,) = pm.getSlot0(refKey.toId());
        _moveTo(refKey, TickMath.getSqrtPriceAtTick(INIT_TICK + 900));
    }

    /// @dev Victims queue 100 ETH and ~100 ETH of NIMORI (auto-match skipped), the market settles at the opening
    ///      price, and an attacker gets 100 ETH and 1e8 NIMORI.
    function sandwichPrepare() public returns (Attacker atk, uint160 high, uint160 p0) {
        p0 = TickMath.getSqrtPriceAtTick(INIT_TICK);
        high = TickMath.getSqrtPriceAtTick(INIT_TICK + 13_800); // ~4x NIMORI per ETH
        _breakReference();
        _dep1(alice, 0, 100 ether);
        _dep2(bob, 0, 100_000_000e18);
        _setPrice(INIT_TICK);
        atk = new Attacker(ops, nim);
        nim.mint(address(atk), 100_000_000e18);
        vm.deal(address(atk), 100 ether);
    }

}

contract NimoriLobbyTest is SandwichBase {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    uint8 constant EASY = 0;
    uint8 constant NORMAL = 1;
    uint8 constant HARD = 2;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    bytes32 constant UNPLUGGED_SIG = keccak256("Unplugged(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool)");
    bytes32 constant FEES_SIG = keccak256("FeesCollected(uint256,uint256,uint256,uint256,uint256)");

    struct S {
        uint8 difficulty;
        bool open;
        int24 lower;
        int24 upper;
        uint64 start;
        uint128 liquidity;
        uint128 e0;
        uint128 n0;
    }

    struct U {
        uint256 a;
        uint256 b;
        uint256 eth1;
        uint256 nim1;
        uint256 eth2;
        uint256 nim2;
        bool rage;
        uint256 fee0;
        uint256 fee1;
    }

    function _s(uint256 sid) internal view returns (S memory s) {
        (s.difficulty, s.open, s.lower, s.upper, s.start, s.liquidity, s.e0, s.n0) = lobby.sessions(sid);
    }

    function _credit(uint256 seat) internal view returns (uint256 eth, uint256 n) {
        (uint128 e, uint128 x) = lobby.credits(seat);
        return (e, x);
    }

    function _amount(uint256 depId) internal view returns (uint256 amt) {
        (,,, uint128 a,,) = lobby.deposits(depId);
        return a;
    }

    /// @dev Unplugs and decodes the settlement and the fees collected on the way out.
    function _unplug(address who, uint256 seat) internal returns (U memory u) {
        vm.recordLogs();
        vm.prank(who);
        lobby.unplug(seat);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(lobby)) continue;
            if (logs[i].topics[0] == UNPLUGGED_SIG) {
                (u.a, u.b, u.eth1, u.nim1, u.eth2, u.nim2, u.rage) =
                    abi.decode(logs[i].data, (uint256, uint256, uint256, uint256, uint256, uint256, bool));
            } else if (logs[i].topics[0] == FEES_SIG) {
                (u.fee0, u.fee1,,) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
            }
        }
    }

    /// @dev Credits = settlement + fee share. Fee shares: 90% of fees, 1P gets the floor half.
    function _feeShares(U memory u) internal pure returns (uint256 fe1, uint256 fn1, uint256 fe2, uint256 fn2) {
        uint256 r0 = u.fee0 - u.fee0 / 10;
        uint256 r1 = u.fee1 - u.fee1 / 10;
        fe1 = r0 / 2;
        fn1 = r1 / 2;
        fe2 = r0 - fe1;
        fn2 = r1 - fn1;
    }

    function _match1(uint8 d, uint256 eth, uint256 n) internal returns (uint256 sid) {
        sid = lobby.nextSessionId();
        _dep1(alice, d, eth);
        _dep2(bob, d, n);
        assertEq(lobby.nextSessionId(), sid + 1, "no session opened");
    }

    function _assertSolvent() internal view {
        (uint256 le, uint256 ln) = lobby.liabilities();
        assertEq(address(lobby).balance, le, "ETH balance != liabilities");
        assertEq(nim.balanceOf(address(lobby)), ln, "NIMORI balance != liabilities");
    }

    // ================================================================== deposits and queues

    function test_deposit_minimumsAndDifficulty() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(NimoriLobby.BelowMinimum.selector);
        lobby.deposit1P{value: 0.001 ether - 1}(EASY);
        vm.prank(alice);
        vm.expectRevert(NimoriLobby.BadDifficulty.selector);
        lobby.deposit1P{value: 0.01 ether}(3);
        nim.mint(bob, MIN_NIM);
        vm.startPrank(bob);
        nim.approve(address(lobby), MIN_NIM);
        vm.expectRevert(NimoriLobby.BelowMinimum.selector);
        lobby.deposit2P(EASY, MIN_NIM - 1);
        vm.stopPrank();
        uint256 id = _dep1(alice, EASY, 0.001 ether);
        assertEq(_amount(id), 0.001 ether);
        _assertSolvent();
    }

    function test_fifo_matchesInArrivalOrder() public {
        _dep1(alice, EASY, 1 ether);
        _dep1(carol, EASY, 1 ether);
        // ~3 ETH worth of NIMORI: matches alice, then carol, and keeps the rest at the head.
        uint256 bobId = _dep2(bob, EASY, 3_000_000e18);
        assertEq(lobby.ownerOf(2), alice, "session 1, 1P");
        assertEq(lobby.ownerOf(3), bob, "session 1, 2P");
        assertEq(lobby.ownerOf(4), carol, "session 2, 1P");
        assertEq(lobby.ownerOf(5), bob, "session 2, 2P");
        (uint64 h2,) = lobby.queueHead(EASY, 1);
        assertEq(h2, bobId, "bob's remainder stays at the head");
        assertApproxEqRel(_amount(bobId), 1_000_000e18, 0.01e18);
        (uint64 h1,) = lobby.queueHead(EASY, 0);
        assertEq(h1, 0, "1P queue drained");
        _assertSolvent();
    }

    function test_partialFill_remainderStaysAtHead() public {
        uint256 aId = _dep1(alice, NORMAL, 2 ether);
        _dep2(bob, NORMAL, 1_000_000e18);
        S memory s = _s(1);
        assertGt(s.e0, 0.9 ether);
        assertLt(s.e0, 1.1 ether);
        assertEq(_amount(aId), 2 ether - s.e0, "remainder");
        (uint64 h1,) = lobby.queueHead(NORMAL, 0);
        assertEq(h1, aId);
        assertEq(lobby.totalQueuedEth(), 2 ether - s.e0);
        _assertSolvent();
    }

    function test_dustRemainder_refundedToOwed() public {
        uint256 aId = _dep1(alice, EASY, 1 ether);
        // Far more NIMORI than needed: alice's ETH is the limiting side and is used up to a few wei.
        _dep2(bob, EASY, 5_000_000e18);
        S memory s = _s(1);
        (uint128 owedEth,) = lobby.owed(alice);
        assertEq(uint256(s.e0) + owedEth, 1 ether, "used + refunded == deposited");
        assertLt(owedEth, lobby.minEthDeposit());
        assertEq(_amount(aId), 0, "alice is out of the queue");
        (uint64 h1,) = lobby.queueHead(EASY, 0);
        assertEq(h1, 0);
        uint256 before = alice.balance;
        vm.prank(alice);
        lobby.withdrawOwed();
        assertEq(alice.balance - before, owedEth);
        _assertSolvent();
    }

    function test_withdrawQueued_fromMiddle_keepsOrder_andWorksWhenPaused() public {
        _breakReference(); // keep everything queued
        uint256 a = _dep1(alice, HARD, 1 ether);
        uint256 c = _dep1(carol, HARD, 1 ether);
        uint256 d = _dep1(dave, HARD, 1 ether);
        lobby.setPaused(true);
        vm.prank(alice);
        vm.expectRevert(NimoriLobby.NotDepositor.selector);
        lobby.withdrawQueued(c);
        uint256 before = carol.balance;
        vm.prank(carol);
        lobby.withdrawQueued(c);
        assertEq(carol.balance - before, 1 ether);
        vm.prank(carol);
        vm.expectRevert(NimoriLobby.NotDepositor.selector);
        lobby.withdrawQueued(c);
        lobby.setPaused(false);
        _setPrice(INIT_TICK); // reference back in line
        _dep2(bob, HARD, 2_000_000e18);
        assertEq(lobby.ownerOf(2), alice);
        assertEq(lobby.ownerOf(4), dave, "carol was skipped, dave is next");
        assertEq(_amount(a), 0);
        assertEq(_amount(d) == 0 || _amount(d) > 0, true);
        _assertSolvent();
    }

    function test_withdrawQueued_tokenSide() public {
        _breakReference();
        uint256 id = _dep2(bob, NORMAL, 50_000e18);
        vm.prank(bob);
        lobby.withdrawQueued(id);
        assertEq(nim.balanceOf(bob), 50_000e18);
        assertEq(lobby.totalQueuedNimori(), 0);
    }

    // ================================================================== matching

    function test_match_positionHasExpectedLiquidity_allDifficulties() public {
        int24[3] memory lowers = [int24(-887200), INIT_TICK - 6000, INIT_TICK - 2000];
        int24[3] memory uppers = [int24(887200), INIT_TICK + 6000, INIT_TICK + 2000];
        for (uint8 d; d < 3; d++) {
            (uint160 sqrtP,) = _spot();
            uint128 expected = LiquidityAmounts.getLiquidityForAmounts(
                sqrtP, TickMath.getSqrtPriceAtTick(lowers[d]), TickMath.getSqrtPriceAtTick(uppers[d]), 1 ether, 800_000e18
            );
            uint256 sid = _match1(d, 1 ether, 800_000e18);
            S memory s = _s(sid);
            assertEq(s.lower, lowers[d], "lower");
            assertEq(s.upper, uppers[d], "upper");
            assertEq(s.liquidity, expected, "liquidity");
            (uint128 inPm,,) = pm.getPositionInfo(key.toId(), address(lobby), s.lower, s.upper, bytes32(sid));
            assertEq(inPm, expected, "position in the PoolManager");
            assertLe(s.e0, 1 ether);
            assertLe(s.n0, 800_000e18);
        }
        _assertSolvent();
    }

    function test_rangeFor_floorsNegativeTicks() public view {
        (int24 l, int24 u) = lobby.rangeFor(HARD, -1);
        assertEq(l, -2200);
        assertEq(u, 1800);
        (l, u) = lobby.rangeFor(NORMAL, 399);
        assertEq(l, -5800);
        assertEq(u, 6200);
        (l, u) = lobby.rangeFor(HARD, -887000);
        assertEq(l, -887200, "clamped to the usable range");
    }

    function test_matchQueue_permissionless_andNothingToMatch() public {
        _breakReference();
        _dep1(alice, EASY, 1 ether);
        _dep2(bob, EASY, 1_000_000e18);
        assertEq(lobby.nextSessionId(), 1, "guard skipped the auto-match");
        _setPrice(INIT_TICK);
        vm.prank(dave);
        assertEq(lobby.matchQueue(EASY, 5), 1);
        vm.expectRevert(NimoriLobby.NothingToMatch.selector);
        lobby.matchQueue(EASY, 5);
    }

    // ================================================================== fees

    function test_collectFees_tenPercentSplit_ethToArcade_nimoriBurned() public {
        uint256 sid = _match1(EASY, 5 ether, 5_000_000e18);
        _churn(3 ether);
        uint256 queuedBefore = arcade.queuedRewards();
        vm.recordLogs();
        vm.prank(dave); // anyone
        lobby.collectFees(sid);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 f0;
        uint256 f1;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(lobby) && logs[i].topics[0] == FEES_SIG) {
                (f0, f1,,) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
            }
        }
        assertGt(f0, 0, "ETH fees");
        assertGt(f1, 0, "NIMORI fees");
        uint256 p0 = f0 / 10;
        uint256 p1 = f1 / 10;
        assertEq(arcade.queuedRewards() - queuedBefore, p0, "10% ETH to the Arcade");
        assertEq(nim.balanceOf(DEAD), p1, "10% NIMORI burned");
        (uint256 e1, uint256 n1) = _credit(sid * 2);
        (uint256 e2, uint256 n2) = _credit(sid * 2 + 1);
        assertEq(e1, (f0 - p0) / 2);
        assertEq(e1 + e2, f0 - p0);
        assertEq(n1, (f1 - p1) / 2);
        assertEq(n1 + n2, f1 - p1);
        // the session's share of the 1% fee on ~3 ETH each way, a quarter of the depth is the session's
        assertGt(f0, 0.001 ether);
        _assertSolvent();
    }

    /// @notice "I arrive, nothing happens, I leave": fees earned by the pool BEFORE the session existed must not
    ///         leak into it (callerDelta is already net of fees). Strictly no gain.
    function test_enterNothingHappensExit_noGain() public {
        _churn(5 ether); // fees accrue to the seed LP before the session
        uint256 sid = _match1(EASY, 2 ether, 2_000_000e18);
        S memory s = _s(sid);
        vm.warp(_now() + 25 hours);
        U memory u = _unplug(alice, sid * 2);
        assertEq(u.fee0, 0, "no fee0");
        assertEq(u.fee1, 0, "no fee1");
        (uint256 e1, uint256 n1) = _credit(sid * 2);
        (uint256 e2, uint256 n2) = _credit(sid * 2 + 1);
        assertLe(e1 + e2, s.e0, "ETH out > ETH in");
        assertLe(n1 + n2, s.n0, "NIMORI out > NIMORI in");
        assertGe(e1 + e2 + 2, s.e0);
        assertGe(n1 + n2 + 2, s.n0);
        _assertSolvent();
    }

    // ================================================================== exit: mover rule

    function _checkMover(U memory u, S memory s) internal pure {
        assertEq(u.eth1 + u.eth2, u.a, "ETH conserved");
        assertEq(u.nim1 + u.nim2, u.b, "NIMORI conserved");
        if (u.a >= s.e0) {
            assertEq(u.eth1, s.e0, "1P repaid its ETH");
            assertEq(u.nim1, 0);
        } else {
            assertEq(u.nim2, u.b < s.n0 ? u.b : s.n0, "2P repaid its NIMORI");
            assertEq(u.eth2, 0);
        }
    }

    function test_unplug_nimoriRises_1PRepaidInEth_allDifficulties() public {
        for (uint8 d; d < 3; d++) {
            _setPrice(INIT_TICK);
            uint256 sid = _match1(d, 1 ether, 1_000_000e18);
            S memory s = _s(sid);
            _setPrice(INIT_TICK - 1500); // fewer NIMORI per ETH: NIMORI rose
            vm.warp(_now() + 24 hours);
            U memory u = _unplug(bob, sid * 2 + 1);
            assertFalse(u.rage);
            assertGe(u.a, s.e0, "a >= e0 when NIMORI rose");
            assertLt(u.b, s.n0);
            _checkMover(u, s);
            assertEq(u.eth1, s.e0, "1P gets exactly e0 ETH");
            assertEq(u.nim1, 0);
            assertEq(u.eth2, u.a - s.e0);
            assertEq(u.nim2, u.b);
            (uint256 fe1, uint256 fn1, uint256 fe2, uint256 fn2) = _feeShares(u);
            (uint256 e1, uint256 n1) = _credit(sid * 2);
            (uint256 e2, uint256 n2) = _credit(sid * 2 + 1);
            assertEq(e1, s.e0 + fe1, "credit = settlement + fee share");
            assertEq(n1, fn1);
            assertEq(e2, u.a - s.e0 + fe2);
            assertEq(n2, u.b + fn2);
        }
        _assertSolvent();
    }

    function test_unplug_ethRises_2PRepaidInNimori_allDifficulties() public {
        for (uint8 d; d < 3; d++) {
            _setPrice(INIT_TICK);
            uint256 sid = _match1(d, 1 ether, 1_000_000e18);
            S memory s = _s(sid);
            _setPrice(INIT_TICK + 1500);
            vm.warp(_now() + 24 hours);
            U memory u = _unplug(alice, sid * 2);
            assertLt(u.a, s.e0);
            assertGe(u.b, s.n0, "b >= n0 when ETH rose");
            _checkMover(u, s);
            assertEq(u.nim2, s.n0, "2P gets exactly n0 NIMORI");
            assertEq(u.eth2, 0);
            assertEq(u.eth1, u.a);
            assertEq(u.nim1, u.b - s.n0);
            (uint256 fe1, uint256 fn1, uint256 fe2, uint256 fn2) = _feeShares(u);
            (uint256 e1, uint256 n1) = _credit(sid * 2);
            (uint256 e2, uint256 n2) = _credit(sid * 2 + 1);
            assertEq(n2, s.n0 + fn2, "credit = settlement + fee share");
            assertEq(e2, fe2);
            assertEq(e1, u.a + fe1);
            assertEq(n1, u.b - s.n0 + fn1);
        }
        _assertSolvent();
    }

    function test_unplug_priceUnchanged_bothGetTheirOwnBack() public {
        for (uint8 d; d < 3; d++) {
            uint256 sid = _match1(d, 1 ether, 1_000_000e18);
            S memory s = _s(sid);
            vm.warp(_now() + 24 hours);
            U memory u = _unplug(alice, sid * 2);
            _checkMover(u, s);
            (uint256 e1, uint256 n1) = _credit(sid * 2);
            (uint256 e2, uint256 n2) = _credit(sid * 2 + 1);
            assertApproxEqAbs(e1, s.e0, 2);
            assertApproxEqAbs(n2, s.n0, 2);
            assertEq(e2, 0);
            assertLe(n1, 2);
        }
        _assertSolvent();
    }

    function test_unplug_hardOutOfRange_above_allNimori() public {
        uint256 sid = _match1(HARD, 1 ether, 1_000_000e18);
        S memory s = _s(sid);
        _setPrice(INIT_TICK + 5000); // above the upper tick: the position is all NIMORI
        vm.warp(_now() + 24 hours);
        U memory u = _unplug(alice, sid * 2);
        assertEq(u.a, 0, "out of range above: no ETH left");
        assertGt(u.b, s.n0);
        _checkMover(u, s);
        assertEq(u.nim2, s.n0);
        assertEq(u.eth1, 0);
        assertEq(u.nim1, u.b - s.n0, "1P (the mover) takes the rest, in NIMORI");
        _assertSolvent();
    }

    function test_unplug_hardOutOfRange_below_allEth() public {
        uint256 sid = _match1(HARD, 1 ether, 1_000_000e18);
        S memory s = _s(sid);
        _setPrice(INIT_TICK - 5000);
        vm.warp(_now() + 24 hours);
        U memory u = _unplug(bob, sid * 2 + 1);
        assertEq(u.b, 0, "out of range below: no NIMORI left");
        assertGt(u.a, s.e0);
        _checkMover(u, s);
        assertEq(u.eth1, s.e0);
        assertEq(u.eth2, u.a - s.e0);
        assertEq(u.nim2, 0);
        _assertSolvent();
    }

    function test_unplug_onlySeatOwner_once() public {
        uint256 sid = _match1(EASY, 1 ether, 1_000_000e18);
        vm.prank(carol);
        vm.expectRevert(NimoriLobby.NotSeatOwner.selector);
        lobby.unplug(sid * 2);
        _unplug(alice, sid * 2);
        vm.prank(bob);
        vm.expectRevert(NimoriLobby.SessionClosed.selector);
        lobby.unplug(sid * 2 + 1);
        vm.expectRevert(NimoriLobby.SessionClosed.selector);
        lobby.collectFees(sid);
    }

    // ================================================================== exit guard and escape hatch

    function _pushCoop(int24 by) internal {
        (, int24 t) = _spot();
        _moveTo(key, TickMath.getSqrtPriceAtTick(t + by));
    }

    function test_exitGuard_onlyTwap_ignoresPonsDivergence() public {
        uint256 sid = _match1(EASY, 1 ether, 1_000_000e18);
        vm.warp(_now() + 25 hours);
        _moveTo(refKey, TickMath.getSqrtPriceAtTick(INIT_TICK + 900)); // Pons 900 ticks away: matching would stop
        (bool okM,,,,,) = lobby.priceStatus();
        assertFalse(okM);
        _unplug(alice, sid * 2); // exit only checks our own TWAP
    }

    function test_exitGuard_bandIs1000Ticks() public {
        uint256 sid = _match1(EASY, 1 ether, 1_000_000e18);
        vm.warp(_now() + 25 hours);
        _pushCoop(1001);
        (bool ok,,,) = lobby.exitPriceStatus();
        assertFalse(ok, "1001 ticks off the TWAP");
        vm.prank(alice);
        vm.expectRevert();
        lobby.unplug(sid * 2);
        _pushCoop(-1);
        (ok,,,) = lobby.exitPriceStatus();
        assertTrue(ok, "1000 ticks off the TWAP");
        _unplug(alice, sid * 2);
    }

    function test_escape_requestThenUnplugAfterOneHourWithoutGuard() public {
        uint256 sid = _match1(EASY, 1 ether, 1_000_000e18);
        vm.warp(_now() + 25 hours);
        _pushCoop(1500);
        vm.prank(alice);
        vm.expectRevert();
        lobby.unplug(sid * 2);
        // guard failing -> request allowed (only by a seat owner, once)
        vm.prank(carol);
        vm.expectRevert(NimoriLobby.NotSeatOwner.selector);
        lobby.requestUnplug(sid * 2);
        uint256 t0 = _now();
        vm.prank(bob);
        lobby.requestUnplug(sid * 2 + 1);
        assertEq(lobby.unplugRequestedAt(sid), t0);
        vm.prank(alice);
        vm.expectRevert(NimoriLobby.AlreadyRequested.selector);
        lobby.requestUnplug(sid * 2);
        // 1 s short of the delay: still guarded (price kept off the TWAP)
        vm.warp(t0 + 1 hours - 1);
        _pushCoop(1500);
        vm.prank(alice);
        vm.expectRevert();
        lobby.unplug(sid * 2);
        // at the delay: the PARTNER (not the requester) exits with the guard still failing
        vm.warp(t0 + 1 hours);
        _pushCoop(1500);
        (bool ok,,,) = lobby.exitPriceStatus();
        assertFalse(ok, "the guard is still failing");
        U memory u = _unplug(alice, sid * 2);
        assertFalse(u.rage);
        _checkMover(u, _s(sid));
        _assertSolvent();
    }

    function test_escape_requestRefusedWhileGuardPasses() public {
        uint256 sid = _match1(EASY, 1 ether, 1_000_000e18);
        vm.prank(alice);
        vm.expectRevert(NimoriLobby.GuardPasses.selector);
        lobby.requestUnplug(sid * 2);
    }

    function test_escape_doesNotDodgeRageQuit() public {
        uint256 sid = _match1(EASY, 1 ether, 1_000_000e18);
        S memory s = _s(sid);
        _pushCoop(1500);
        vm.prank(alice);
        lobby.requestUnplug(sid * 2);
        vm.warp(_now() + 1 hours);
        U memory u = _unplug(alice, sid * 2); // 1 h into the session: still a rage quit
        assertTrue(u.rage);
        (uint256 x1, uint256 y1, uint256 x2, uint256 y2) = lobby.settle(u.a, u.b, s.e0, s.n0);
        assertEq(u.eth1, x1 - x1 / 100);
        assertEq(u.nim1, y1 - y1 / 100);
        assertEq(u.eth2, x2 + x1 / 100);
        assertEq(u.nim2, y2 + y1 / 100);
        _assertSolvent();
    }

    function test_escape_requestOnClosedSession_reverts() public {
        uint256 sid = _match1(EASY, 1 ether, 1_000_000e18);
        _unplug(alice, sid * 2);
        vm.prank(bob);
        vm.expectRevert(NimoriLobby.SessionClosed.selector);
        lobby.requestUnplug(sid * 2 + 1);
    }

    // ================================================================== rage quit

    function test_rageQuit_1PPaysOnePercentToPartner() public {
        uint256 sid = _match1(EASY, 1 ether, 1_000_000e18);
        S memory s = _s(sid);
        _setPrice(INIT_TICK + 1500); // ETH rose: 1P gets ETH + extra NIMORI
        U memory u = _unplug(alice, sid * 2);
        assertTrue(u.rage);
        (uint256 x1, uint256 y1, uint256 x2, uint256 y2) = lobby.settle(u.a, u.b, s.e0, s.n0);
        assertEq(u.eth1, x1 - x1 / 100);
        assertEq(u.nim1, y1 - y1 / 100);
        assertEq(u.eth2, x2 + x1 / 100);
        assertEq(u.nim2, y2 + y1 / 100);
        _assertSolvent();
    }

    function test_rageQuit_2PPaysOnePercentToPartner() public {
        uint256 sid = _match1(EASY, 1 ether, 1_000_000e18);
        S memory s = _s(sid);
        _setPrice(INIT_TICK - 1500);
        U memory u = _unplug(bob, sid * 2 + 1);
        assertTrue(u.rage);
        (uint256 x1, uint256 y1, uint256 x2, uint256 y2) = lobby.settle(u.a, u.b, s.e0, s.n0);
        assertEq(u.eth2, x2 - x2 / 100);
        assertEq(u.nim2, y2 - y2 / 100);
        assertEq(u.eth1, x1 + x2 / 100);
        assertEq(u.nim1, y1 + y2 / 100);
    }

    function test_rageQuit_24hBoundary() public {
        uint256 s1 = _match1(EASY, 1 ether, 1_000_000e18);
        uint256 s2 = _match1(NORMAL, 1 ether, 1_000_000e18);
        uint256 start = _s(s1).start;
        vm.warp(start + 24 hours - 1);
        assertTrue(_unplug(alice, s1 * 2).rage, "1 s before 24 h is a rage quit");
        vm.warp(start + 24 hours);
        assertFalse(_unplug(alice, s2 * 2).rage, "at 24 h it is not");
    }

    // ================================================================== claims and seats

    function test_claim_byNewOwnerAfterTransfer_thenSeatBurned() public {
        uint256 sid = _match1(EASY, 1 ether, 1_000_000e18);
        _churn(2 ether);
        vm.prank(alice);
        lobby.transferFrom(alice, carol, sid * 2);
        vm.warp(_now() + 24 hours);
        _unplug(carol, sid * 2);
        (uint256 e1, uint256 n1) = _credit(sid * 2);
        assertGt(e1, _s(sid).e0, "principal plus fees");
        vm.prank(alice);
        vm.expectRevert(NimoriLobby.NotSeatOwner.selector);
        lobby.claim(sid * 2);
        uint256 before = carol.balance;
        vm.prank(carol);
        lobby.claim(sid * 2);
        assertEq(carol.balance - before, e1);
        assertEq(nim.balanceOf(carol), n1);
        vm.expectRevert();
        lobby.ownerOf(sid * 2); // burned once paid out on a closed session
        // the partner claims independently
        (uint256 e2, uint256 n2) = _credit(sid * 2 + 1);
        uint256 nb = nim.balanceOf(bob);
        vm.prank(bob);
        lobby.claimTo(sid * 2 + 1, dave);
        assertEq(dave.balance, e2);
        assertEq(nim.balanceOf(bob), nb);
        assertEq(nim.balanceOf(dave), n2);
        _assertSolvent();
        assertEq(lobby.totalCreditEth(), 0);
        assertEq(lobby.totalCreditNimori(), 0);
    }

    function test_claim_feesWhileOpen_keepsSeat() public {
        uint256 sid = _match1(EASY, 1 ether, 1_000_000e18);
        _churn(2 ether);
        lobby.collectFees(sid);
        (uint256 e1,) = _credit(sid * 2);
        assertGt(e1, 0);
        uint256 before = alice.balance;
        vm.prank(alice);
        lobby.claim(sid * 2);
        assertEq(alice.balance - before, e1);
        assertEq(lobby.ownerOf(sid * 2), alice, "open session: the seat stays");
    }

    // ================================================================== pause

    function test_pause_blocksNewDepositsAndMatches_notExits() public {
        uint256 sid = _match1(EASY, 1 ether, 1_000_000e18);
        _breakReference();
        uint256 q = _dep1(carol, EASY, 1 ether);
        _setPrice(INIT_TICK);
        _churn(1 ether);
        lobby.setPaused(true);

        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(NimoriLobby.Paused.selector);
        lobby.deposit1P{value: 1 ether}(EASY);
        vm.expectRevert(NimoriLobby.Paused.selector);
        lobby.matchQueue(EASY, 1);

        lobby.collectFees(sid);
        vm.prank(carol);
        lobby.withdrawQueued(q);
        vm.prank(alice);
        lobby.claim(sid * 2);
        _unplug(bob, sid * 2 + 1);
        vm.prank(alice);
        lobby.claim(sid * 2);
        vm.prank(bob);
        lobby.claim(sid * 2 + 1);
        _assertSolvent();
    }

    // ================================================================== price guards

    function test_guard_pumpThenMatch_sameTx_reverts() public {
        _breakReference();
        _dep1(alice, EASY, 10 ether);
        _dep2(bob, EASY, 10_000_000e18);
        _setPrice(INIT_TICK);
        Attacker atk = new Attacker(ops, nim);
        nim.mint(address(atk), 1e30);
        uint160 high = TickMath.getSqrtPriceAtTick(INIT_TICK + 400);
        vm.expectRevert(); // PriceGuard: spot moved 400 ticks away from the TWAP and from the reference
        atk.pumpThenMatch(lobby, key, high, EASY);
        // Without the pump the same match goes through.
        assertEq(lobby.matchQueue(EASY, 1), 1);
    }

    function test_guard_pumpThenUnplug_sameTx_reverts() public {
        Attacker atk = new Attacker(ops, nim);
        nim.mint(address(atk), 1e30);
        _dep1(address(atk), EASY, 1 ether);
        _dep2(bob, EASY, 1_000_000e18);
        uint160 high = TickMath.getSqrtPriceAtTick(INIT_TICK + 1500); // beyond the 1000-tick exit band
        vm.expectRevert();
        atk.pumpThenUnplug(lobby, key, high, 2);
        vm.prank(address(atk));
        lobby.unplug(2);
    }

    function test_guard_exactBoundaries() public {
        _breakReference();
        _dep1(alice, EASY, 1 ether);
        _dep2(bob, EASY, 1_000_000e18);
        // TWAP guard: spot exactly 200 ticks off a settled TWAP passes, 201 fails. Reference follows spot.
        _setPrice(INIT_TICK);
        _moveTo(key, TickMath.getSqrtPriceAtTick(INIT_TICK + 201));
        _moveTo(refKey, TickMath.getSqrtPriceAtTick(INIT_TICK + 201));
        (bool ok,, bool tu, int24 tw,,) = lobby.priceStatus();
        assertTrue(tu);
        assertEq(tw, INIT_TICK);
        assertFalse(ok, "201 ticks off the TWAP");
        _moveTo(key, TickMath.getSqrtPriceAtTick(INIT_TICK + 200));
        (ok,,,,,) = lobby.priceStatus();
        assertTrue(ok, "200 ticks off the TWAP");
        // Reference guard: 600 passes, 601 fails (TWAP in line).
        _setPrice(INIT_TICK);
        _moveTo(refKey, TickMath.getSqrtPriceAtTick(INIT_TICK + 601));
        (ok,,,,,) = lobby.priceStatus();
        assertFalse(ok, "601 ticks off the reference");
        _moveTo(refKey, TickMath.getSqrtPriceAtTick(INIT_TICK - 600));
        (ok,,,,,) = lobby.priceStatus();
        assertTrue(ok, "600 ticks off the reference");
        assertEq(lobby.matchQueue(EASY, 1), 1);
    }

    /// @notice The guard is load-bearing: the one-transaction sandwich below is measured PROFITABLE against a
    ///         lobby without the guard (see {UnguardedSandwichTest}) and reverts against the real one.
    function test_sandwich_revertsWithGuard() public {
        (Attacker atk, uint160 high, uint160 p0) = sandwichPrepare();
        vm.expectRevert();
        atk.sandwichMatch(lobby, key, high, p0, EASY);
    }

    // ================================================================== owner powers

    function test_owner_bounds_and_onceOnly() public {
        vm.expectRevert(NimoriLobby.OutOfBounds.selector);
        lobby.setMaxDeviation(49, 600);
        vm.expectRevert(NimoriLobby.OutOfBounds.selector);
        lobby.setMaxDeviation(200, 1001);
        lobby.setMaxDeviation(50, 1000);
        assertEq(lobby.maxDeviationTicks(), 50);
        vm.expectRevert(NimoriLobby.OutOfBounds.selector);
        lobby.setMinimums(1e9 - 1, 1);
        vm.expectRevert(NimoriLobby.OutOfBounds.selector);
        lobby.setMinimums(1e9, 0);
        lobby.setMinimums(1e9, 1);
        vm.expectRevert(NimoriLobby.OutOfBounds.selector);
        lobby.setMaxExitDeviation(199);
        vm.expectRevert(NimoriLobby.OutOfBounds.selector);
        lobby.setMaxExitDeviation(2001);
        lobby.setMaxExitDeviation(2000);
        assertEq(lobby.maxExitDeviationTicks(), 2000);
        vm.expectRevert(NimoriLobby.AlreadySet.selector);
        lobby.setReferencePool(refKey);
        vm.expectRevert(NimoriLobby.AlreadySet.selector);
        lobby.initializePool(TickMath.getSqrtPriceAtTick(0));
        vm.expectRevert(NimoriLobby.ZeroAddress.selector);
        lobby.setArcade(address(0));

        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        lobby.setPaused(true);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        lobby.setArcade(alice);
        vm.stopPrank();

        // two-step ownership
        lobby.transferOwnership(alice);
        assertEq(lobby.owner(), address(this));
        vm.prank(alice);
        lobby.acceptOwnership();
        assertEq(lobby.owner(), alice);
    }

    function test_arcadeThatReverts_doesNotBlockExit_ethKeptForRetry() public {
        uint256 sid = _match1(EASY, 1 ether, 1_000_000e18);
        _churn(2 ether);
        Reverter r = new Reverter();
        lobby.setArcade(address(r));
        vm.warp(_now() + 24 hours);
        U memory u = _unplug(alice, sid * 2);
        assertGt(u.fee0, 0);
        assertEq(lobby.protocolEthPending(), u.fee0 / 10, "kept, not lost");
        _assertSolvent();
        lobby.setArcade(address(arcade));
        uint256 q = arcade.queuedRewards();
        lobby.pushProtocol();
        assertEq(arcade.queuedRewards() - q, u.fee0 / 10);
        assertEq(lobby.protocolEthPending(), 0);
        _assertSolvent();
    }

    function test_skim_onlyToSinks() public {
        _dep1(alice, EASY, 1 ether);
        nim.mint(address(lobby), 777e18); // a stray transfer
        vm.deal(address(lobby), address(lobby).balance + 3 ether); // forced ETH
        uint256 q = arcade.queuedRewards();
        lobby.skim();
        assertEq(nim.balanceOf(DEAD), 777e18);
        assertEq(arcade.queuedRewards() - q, 3 ether);
        _assertSolvent();
    }

    function test_receive_onlyPoolManager() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(lobby).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_unlockCallback_onlyPoolManager() public {
        vm.expectRevert(NimoriLobby.NotPoolManager.selector);
        lobby.unlockCallback(abi.encode(uint8(2), uint256(1), int24(0), int24(0), int256(0)));
    }

    // ================================================================== fuzz

    function testFuzz_settle_onlySplitsWhatCameOut(uint128 a, uint128 b, uint128 e0, uint128 n0) public view {
        (uint256 x1, uint256 y1, uint256 x2, uint256 y2) = lobby.settle(a, b, e0, n0);
        assertEq(x1 + x2, a);
        assertEq(y1 + y2, b);
        if (a >= e0) {
            assertEq(x1, e0);
            assertEq(y1, 0);
        } else {
            assertEq(y2, b < n0 ? b : n0);
            assertEq(x2, 0);
        }
    }

    /// @notice Any difficulty, any price move (in or out of range), any size, either seat, any time: the
    ///         settlement splits exactly what came out, each seat gets at most the principal plus its fee share,
    ///         and the lobby holds every credit.
    function testFuzz_unplug_solvent(uint8 d, int24 move, uint96 eth, uint96 nimAmt, bool by1P, uint32 wait, uint96 churn)
        public
    {
        d = uint8(bound(d, 0, 2));
        move = int24(bound(move, -20_000, 20_000));
        uint256 e = bound(eth, 0.001 ether, 50 ether);
        uint256 n = bound(nimAmt, MIN_NIM, 50_000_000e18);
        uint256 c = bound(churn, 0, 5 ether);
        uint256 sid = lobby.nextSessionId();
        _dep1(alice, d, e);
        _dep2(bob, d, n);
        if (lobby.nextSessionId() == sid) return; // one side too small to mint liquidity: refunded, nothing to test
        S memory s = _s(sid);
        if (c > 0) _churn(c);
        _setPrice(INIT_TICK + move);
        vm.warp(_now() + bound(wait, 0, 3 days));
        U memory u = _unplug(by1P ? alice : bob, by1P ? sid * 2 : sid * 2 + 1);
        _checkMoverRage(u, s);
        (uint256 e1, uint256 n1) = _credit(sid * 2);
        (uint256 e2, uint256 n2) = _credit(sid * 2 + 1);
        uint256 fe = u.fee0 - u.fee0 / 10;
        uint256 fn = u.fee1 - u.fee1 / 10;
        assertEq(e1 + e2, u.a + fe, "ETH credits == principal out + 90% of fees");
        assertEq(n1 + n2, u.b + fn, "NIMORI credits == principal out + 90% of fees");
        assertLe(e1, u.a + fe);
        assertLe(n2, u.b + fn);
        _assertSolvent();
        vm.prank(alice);
        lobby.claim(sid * 2);
        vm.prank(bob);
        lobby.claim(sid * 2 + 1);
        _assertSolvent();
    }

    function _checkMoverRage(U memory u, S memory s) internal pure {
        assertEq(u.eth1 + u.eth2, u.a, "ETH conserved");
        assertEq(u.nim1 + u.nim2, u.b, "NIMORI conserved");
        if (!u.rage) _checkMover(u, s);
    }
}

contract Reverter {
    receive() external payable {
        revert("no");
    }
}

/// @notice The guard switched off, to measure what it prevents: same setup, same attack transaction.
contract UnguardedSandwichTest is SandwichBase {
    function _deployLobby() internal override returns (NimoriLobby) {
        return new UnguardedLobby(pm, IHooks(address(hook)), address(nim), address(arcade), MIN_NIM, address(this));
    }

    function _valueInEth(address who, uint160 sqrtP) internal view returns (uint256) {
        uint256 n = nim.balanceOf(who);
        // NIMORI -> ETH at sqrtP^2 / 2^192 NIMORI per ETH
        return who.balance + FullMath.mulDiv(FullMath.mulDiv(n, 1 << 96, sqrtP), 1 << 96, sqrtP);
    }

    function test_sandwich_profitableWithoutGuard() public {
        (Attacker atk, uint160 high, uint160 p0) = sandwichPrepare();
        uint256 before = _valueInEth(address(atk), p0);
        atk.sandwichMatch(lobby, key, high, p0, 0);
        uint256 afterV = _valueInEth(address(atk), p0);
        assertEq(lobby.nextSessionId(), 2, "the victims were matched at the manipulated price");
        assertGt(afterV, before + 10 ether, "without the guard the sandwich nets > 10 ETH");
        emit log_named_decimal_uint("unguarded sandwich profit (ETH)", afterV - before, 18);
    }
}
