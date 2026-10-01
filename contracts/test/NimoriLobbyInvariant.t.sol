// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {console2} from "forge-std/console2.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";

import {NimoriLobby} from "../src/NimoriLobby.sol";
import {LobbyBase} from "./utils/LobbyBase.sol";
import {MockNimori} from "./utils/MockNimori.sol";
import {PoolOps} from "./utils/PoolOps.sol";

/// @notice Drives random sequences of deposits, matches, swaps, time, fee collection, exits, claims and
///         withdrawals. Every path counts its successes so a silently dead path (a consumed prank, a guard that
///         always fails) shows up in the summary instead of passing vacuously.
contract LobbyHandler is Test {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    bytes32 constant UNPLUGGED_SIG = keccak256("Unplugged(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool)");
    bytes32 constant FEES_SIG = keccak256("FeesCollected(uint256,uint256,uint256,uint256,uint256)");

    NimoriLobby public lobby;
    MockNimori public nim;
    PoolOps public ops;
    IPoolManager public pm;
    PoolKey public key;
    PoolKey public refKey;

    address[4] public actors;
    uint256[] public depositIds;
    uint256[] public sessionIds;

    mapping(bytes32 => uint256) public ok;
    mapping(bytes32 => uint256) internal ok_;

    function okCount(bytes32 k) external view returns (uint256) {
        return ok[k] + ok_[k];
    }
    bool public conservationBroken;
    bool public overpaid;
    uint256 public time;

    constructor(NimoriLobby l, MockNimori n, PoolOps o, IPoolManager p, PoolKey memory k, PoolKey memory rk) {
        lobby = l;
        nim = n;
        ops = o;
        pm = p;
        key = k;
        refKey = rk;
        actors = [makeAddr("a1"), makeAddr("a2"), makeAddr("a3"), makeAddr("a4")];
        nim.approve(address(ops), type(uint256).max);
        time = vm.getBlockTimestamp();
    }

    receive() external payable {}

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % 4];
    }

    function dep1(uint256 who, uint8 d, uint256 amt) external {
        address a = _actor(who);
        d = uint8(bound(d, 0, 2));
        amt = bound(amt, 0.001 ether, 20 ether);
        vm.deal(a, a.balance + amt);
        uint256 next = lobby.nextSessionId();
        vm.prank(a);
        try lobby.deposit1P{value: amt}(d) returns (uint256 id) {
            depositIds.push(id);
            ok["dep1"]++;
        } catch {}
        _recordNewSessions(next);
    }

    function dep2(uint256 who, uint8 d, uint256 amt) external {
        address a = _actor(who);
        d = uint8(bound(d, 0, 2));
        amt = bound(amt, 1000e18, 20_000_000e18);
        nim.mint(a, amt);
        vm.prank(a);
        nim.approve(address(lobby), amt);
        uint256 next = lobby.nextSessionId();
        vm.prank(a);
        try lobby.deposit2P(d, amt) returns (uint256 id) {
            depositIds.push(id);
            ok["dep2"]++;
        } catch {}
        _recordNewSessions(next);
    }

    function matchQ(uint8 d) external {
        d = uint8(bound(d, 0, 2));
        uint256 next = lobby.nextSessionId();
        try lobby.matchQueue(d, 3) {
            ok["match"]++;
        } catch {}
        _recordNewSessions(next);
    }

    function _recordNewSessions(uint256 from) internal {
        uint256 to = lobby.nextSessionId();
        for (uint256 s = from; s < to; s++) {
            sessionIds.push(s);
        }
    }

    /// @dev A trade on the co-op pool. Half the time the reference pool follows (arbitraged), half not.
    function swap(bool zeroForOne, uint256 amt, bool arb) external {
        amt = bound(amt, 0.001 ether, 5 ether);
        if (zeroForOne) {
            ops.swap{value: amt}(key, true, -int256(amt), 0);
        } else {
            (uint160 sp,,,) = pm.getSlot0(key.toId());
            // same ETH-equivalent in NIMORI
            uint256 nAmt = (amt * uint256(sp) / (1 << 96)) * uint256(sp) / (1 << 96);
            if (nAmt == 0) return;
            nim.mint(address(this), nAmt);
            ops.swap(key, false, -int256(nAmt), 0);
        }
        ok["swap"]++;
        if (arb) _arbRef();
    }

    function _arbRef() internal {
        (uint160 sp,,,) = pm.getSlot0(key.toId());
        (uint160 rp,,,) = pm.getSlot0(refKey.toId());
        if (sp < rp) ops.swap{value: 1e7 ether}(refKey, true, -int256(1e7 ether), sp);
        else if (sp > rp) {
            nim.mint(address(this), 1e34);
            ops.swap(refKey, false, -int256(1e34), sp);
        }
    }

    function warp(uint256 secs) external {
        secs = bound(secs, 1, 3 days);
        time += secs;
        vm.warp(time);
        ok["warp"]++;
    }

    /// @dev Market settles: reference arbitraged to spot, 31 minutes pass so the TWAP catches up.
    function calm() external {
        _arbRef();
        time += 31 minutes;
        vm.warp(time);
        ok["calm"]++;
    }

    function collect(uint256 idx) external {
        if (sessionIds.length == 0) return;
        uint256 sid = sessionIds[idx % sessionIds.length];
        try lobby.collectFees(sid) {
            ok["collect"]++;
        } catch {}
    }

    function unplug(uint256 idx, bool side2) external {
        if (sessionIds.length == 0) return;
        uint256 sid = sessionIds[idx % sessionIds.length];
        uint256 seat = sid * 2 + (side2 ? 1 : 0);
        (,,,,,, uint128 e0, uint128 n0) = lobby.sessions(sid);
        address owner_;
        try lobby.ownerOf(seat) returns (address o) {
            owner_ = o;
        } catch {
            return;
        }
        (uint128 c1e, uint128 c1n) = lobby.credits(sid * 2);
        (uint128 c2e, uint128 c2n) = lobby.credits(sid * 2 + 1);
        vm.recordLogs();
        vm.prank(owner_);
        try lobby.unplug(seat) {
            ok["unplug"]++;
        } catch {
            return;
        }
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256[9] memory v; // a, b, eth1, nim1, eth2, nim2, fee0, fee1, rage
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter != address(lobby)) continue;
            if (logs[i].topics[0] == UNPLUGGED_SIG) {
                bool rage;
                (v[0], v[1], v[2], v[3], v[4], v[5], rage) =
                    abi.decode(logs[i].data, (uint256, uint256, uint256, uint256, uint256, uint256, bool));
                v[8] = rage ? 1 : 0;
            } else if (logs[i].topics[0] == FEES_SIG) {
                (v[6], v[7],,) = abi.decode(logs[i].data, (uint256, uint256, uint256, uint256));
            }
        }
        if (v[2] + v[4] != v[0] || v[3] + v[5] != v[1]) conservationBroken = true;
        // Each seat: at most everything that came out (principal) plus 90% of the fees.
        (uint128 d1e, uint128 d1n) = lobby.credits(sid * 2);
        (uint128 d2e, uint128 d2n) = lobby.credits(sid * 2 + 1);
        uint256 fe = v[6] - v[6] / 10;
        uint256 fn = v[7] - v[7] / 10;
        if (d1e - c1e > v[0] + fe || d2e - c2e > v[0] + fe) overpaid = true;
        if (d1n - c1n > v[1] + fn || d2n - c2n > v[1] + fn) overpaid = true;
        if ((d1e - c1e) + (d2e - c2e) != v[0] + fe) conservationBroken = true;
        if ((d1n - c1n) + (d2n - c2n) != v[1] + fn) conservationBroken = true;
        // Mover rule (no rage quit): the non-mover gets exactly its deposit back in kind.
        if (v[8] == 0) {
            if (v[0] >= e0 && v[2] != e0) conservationBroken = true;
            if (v[0] < e0 && v[5] != (v[1] < n0 ? v[1] : n0)) conservationBroken = true;
        }
    }

    /// @dev Pushes the co-op pool off its TWAP (exit guard fails), then a seat owner files an escape request.
    function requestEscape(uint256 idx, bool side2) external {
        if (sessionIds.length == 0) return;
        uint256 sid = sessionIds[idx % sessionIds.length];
        uint256 seat = sid * 2 + (side2 ? 1 : 0);
        address owner_;
        try lobby.ownerOf(seat) returns (address o) {
            owner_ = o;
        } catch {
            return;
        }
        (bool ok,,,) = lobby.exitPriceStatus();
        if (ok) {
            nim.mint(address(this), 1e34);
            (, int24 t,,) = pm.getSlot0(key.toId());
            ops.swap(key, false, -int256(1e34), TickMath.getSqrtPriceAtTick(t + 1500));
        }
        vm.prank(owner_);
        try lobby.requestUnplug(seat) {
            ok_["request"]++;
        } catch {}
    }

    function claim(uint256 idx, bool side2) external {
        if (sessionIds.length == 0) return;
        uint256 sid = sessionIds[idx % sessionIds.length];
        uint256 seat = sid * 2 + (side2 ? 1 : 0);
        address owner_;
        try lobby.ownerOf(seat) returns (address o) {
            owner_ = o;
        } catch {
            return;
        }
        vm.prank(owner_);
        try lobby.claim(seat) {
            ok["claim"]++;
        } catch {}
    }

    function transferSeat(uint256 idx, uint256 to) external {
        if (sessionIds.length == 0) return;
        uint256 seat = sessionIds[idx % sessionIds.length] * 2 + (to % 2);
        address owner_;
        try lobby.ownerOf(seat) returns (address o) {
            owner_ = o;
        } catch {
            return;
        }
        address dst = _actor(to);
        vm.prank(owner_);
        lobby.transferFrom(owner_, dst, seat);
        ok["transfer"]++;
    }

    function withdrawQueued(uint256 idx) external {
        if (depositIds.length == 0) return;
        uint256 id = depositIds[idx % depositIds.length];
        (address o,,, uint128 amt,,) = lobby.deposits(id);
        if (amt == 0) return;
        vm.prank(o);
        lobby.withdrawQueued(id);
        ok["withdrawQueued"]++;
    }

    function withdrawOwed(uint256 who) external {
        address a = _actor(who);
        vm.prank(a);
        lobby.withdrawOwed();
        ok["withdrawOwed"]++;
    }

    function sessionCount() external view returns (uint256) {
        return sessionIds.length;
    }
}

contract NimoriLobbyInvariantTest is LobbyBase {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    LobbyHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new LobbyHandler(lobby, nim, ops, pm, key, refKey);
        vm.deal(address(handler), 1e9 ether);
        nim.mint(address(handler), 1e30);
        targetContract(address(handler));
        bytes4[] memory sel = new bytes4[](14);
        sel[0] = LobbyHandler.dep1.selector;
        sel[1] = LobbyHandler.dep2.selector;
        sel[2] = LobbyHandler.matchQ.selector;
        sel[3] = LobbyHandler.swap.selector;
        sel[4] = LobbyHandler.warp.selector;
        sel[5] = LobbyHandler.calm.selector;
        sel[6] = LobbyHandler.collect.selector;
        sel[7] = LobbyHandler.unplug.selector;
        sel[8] = LobbyHandler.claim.selector;
        sel[9] = LobbyHandler.transferSeat.selector;
        sel[10] = LobbyHandler.withdrawQueued.selector;
        sel[11] = LobbyHandler.withdrawOwed.selector;
        sel[12] = LobbyHandler.calm.selector; // weighted: give the guards a settled market often
        sel[13] = LobbyHandler.requestEscape.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sel}));
    }

    /// @notice The lobby holds exactly what it owes: queued deposits, seat credits, dust refunds and the
    ///         pending protocol share. Positions live in the PoolManager and back nothing else.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 120
    function invariant_balancesEqualLiabilities() public view {
        (uint256 le, uint256 ln) = lobby.liabilities();
        assertEq(address(lobby).balance, le, "ETH");
        assertEq(nim.balanceOf(address(lobby)), ln, "NIMORI");
    }

    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 120
    function invariant_settlementsConserveAndNeverOverpay() public view {
        assertFalse(handler.conservationBroken(), "settlement does not split exactly what came out");
        assertFalse(handler.overpaid(), "a seat got more than principal out + fees");
    }

    /// @notice Every open session still owns exactly its liquidity in the PoolManager.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 120
    function invariant_openSessionsBackedInPoolManager() public view {
        uint256 n = handler.sessionCount();
        for (uint256 i; i < n; i++) {
            uint256 sid = handler.sessionIds(i);
            (, bool open, int24 lo, int24 up,, uint128 liq,,) = lobby.sessions(sid);
            (uint128 inPm,,) = pm.getPositionInfo(key.toId(), address(lobby), lo, up, bytes32(sid));
            assertEq(inPm, open ? liq : 0, "position liquidity");
        }
    }

    /// @notice Every handler path succeeds at least once on a scripted sequence: an invariant that holds only
    ///         because a path always reverts would be vacuous.
    function test_handlerProbe_everyPathLive() public {
        handler.dep1(0, 0, 1 ether);
        handler.dep2(1, 0, 1_000_000e18); // auto-matches
        handler.dep1(2, 1, 1 ether);
        handler.calm();
        handler.swap(true, 1 ether, true);
        handler.swap(false, 1 ether, true);
        handler.calm();
        handler.collect(0);
        handler.transferSeat(0, 2);
        handler.dep2(3, 1, 1_000_000e18);
        handler.dep1(0, 2, 1 ether);
        handler.calm();
        handler.dep2(3, 2, 500_000e18);
        handler.calm();
        handler.warp(1 days);
        handler.calm();
        handler.unplug(0, true);
        handler.requestEscape(1, false);
        handler.warp(1 hours);
        handler.unplug(1, true);
        handler.claim(0, false);
        handler.claim(0, true);
        handler.withdrawQueued(0);
        handler.withdrawOwed(0);
        // An unarbitraged 5 ETH dump knocks the guards out: deposits queue without auto-matching...
        handler.swap(true, 5 ether, false);
        handler.dep1(0, 1, 1 ether);
        handler.dep2(1, 1, 3_000_000e18);
        // ...until the market settles and anyone calls matchQueue.
        handler.calm();
        handler.matchQ(1);
        string[13] memory k = ["dep1", "dep2", "match", "swap", "warp", "calm", "collect", "unplug", "claim", "transfer", "withdrawQueued", "withdrawOwed", "request"];
        for (uint256 i; i < 13; i++) {
            assertGt(handler.okCount(bytes32(bytes(k[i]))), 0, k[i]);
        }
        assertGe(handler.okCount("unplug"), 2, "an escape unplug ran");
        invariant_balancesEqualLiabilities();
        invariant_settlementsConserveAndNeverOverpay();
        invariant_openSessionsBackedInPoolManager();
    }

    function afterInvariant() external view {
        string[13] memory k = ["dep1", "dep2", "match", "swap", "warp", "calm", "collect", "unplug", "claim", "transfer", "withdrawQueued", "withdrawOwed", "request"];
        for (uint256 i; i < 13; i++) {
            console2.log(k[i], handler.okCount(bytes32(bytes(k[i]))));
        }
        console2.log("sessions", handler.sessionCount());
    }
}
