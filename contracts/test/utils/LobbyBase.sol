// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";

import {NimoriHook} from "../../src/NimoriHook.sol";
import {NimoriLobby} from "../../src/NimoriLobby.sol";
import {NimoriArcade} from "../../src/NimoriArcade.sol";
import {MockNimori} from "./MockNimori.sol";
import {PoolOps} from "./PoolOps.sol";

/// @notice Local PoolManager, mined-address hook, real Arcade, mock NIMORI, a seeded co-op pool and a seeded
///         "Pons" reference pool (fee 0, no hook) for the same token.
abstract contract LobbyBase is Test {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    int24 internal constant INIT_TICK = 138200; // ~1,000,000 NIMORI per ETH
    uint256 internal constant SEED_L = 1e22; // ~10 ETH + ~10M NIMORI, full range
    uint256 internal constant MIN_NIM = 1000e18;

    IPoolManager internal pm;
    NimoriHook internal hook;
    NimoriLobby internal lobby;
    NimoriArcade internal arcade;
    MockNimori internal nim;
    PoolOps internal ops;
    PoolKey internal key;
    PoolKey internal refKey;

    address internal alice = makeAddr("alice"); // 1P
    address internal bob = makeAddr("bob"); // 2P
    address internal carol = makeAddr("carol"); // 1P
    address internal dave = makeAddr("dave"); // 2P

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        vm.deal(address(this), 1e9 ether);
        pm = IPoolManager(deployCode("out/PoolManager.sol/PoolManager.json", abi.encode(address(this))));
        address hookAddr = address(uint160(0x4444 << 144) | Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG);
        deployCodeTo("NimoriHook.sol:NimoriHook", abi.encode(address(pm)), hookAddr);
        hook = NimoriHook(hookAddr);
        nim = new MockNimori();
        arcade = new NimoriArcade(address(this));
        lobby = _deployLobby();
        key = lobby.poolKey();
        lobby.initializePool(TickMath.getSqrtPriceAtTick(INIT_TICK));

        refKey = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(address(nim)),
            fee: 0,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        pm.initialize(refKey, TickMath.getSqrtPriceAtTick(INIT_TICK));

        ops = new PoolOps(pm);
        nim.mint(address(this), 1e36);
        nim.approve(address(ops), type(uint256).max);
        _seed(key, 200, SEED_L);
        _seed(refKey, 60, SEED_L * 10);
        lobby.setReferencePool(refKey);
        vm.warp(_now() + 31 minutes); // the TWAP needs 30 minutes of history
    }

    function _deployLobby() internal virtual returns (NimoriLobby) {
        return new NimoriLobby(IPoolManager(address(pm)), IHooks(address(hook)), address(nim), address(0), address(arcade), MIN_NIM, address(this));
    }

    receive() external payable {}

    /// @dev 🔴 Never `block.timestamp` in tests: this suite compiles via-IR (it imports the lobby), and via-IR
    ///      may re-read TIMESTAMP at each use, so a "saved" time silently moves with every vm.warp.
    function _now() internal view returns (uint256) {
        return vm.getBlockTimestamp();
    }

    // ------------------------------------------------------------------ helpers

    function _seed(PoolKey memory k, int24 spacing, uint256 liq) internal {
        ops.modifyLiquidity{value: 1e7 ether}(
            k, TickMath.minUsableTick(spacing), TickMath.maxUsableTick(spacing), int256(liq), bytes32(0)
        );
    }

    function _dep1(address who, uint8 d, uint256 amount) internal returns (uint256 id) {
        vm.deal(who, who.balance + amount);
        vm.prank(who);
        id = lobby.deposit1P{value: amount}(d);
    }

    function _dep2(address who, uint8 d, uint256 amount) internal returns (uint256 id) {
        nim.mint(who, amount);
        vm.startPrank(who);
        nim.approve(address(lobby), amount);
        id = lobby.deposit2P(d, amount);
        vm.stopPrank();
    }

    function _spot() internal view returns (uint160 sqrtP, int24 tick) {
        (sqrtP, tick,,) = pm.getSlot0(key.toId());
    }

    /// @dev Moves a pool to an exact sqrt price with a capped-size swap.
    function _moveTo(PoolKey memory k, uint160 target) internal {
        (uint160 cur,,,) = pm.getSlot0(k.toId());
        if (target == cur) return;
        if (target < cur) ops.swap{value: 1e8 ether}(k, true, -int256(1e8 ether), target);
        else ops.swap(k, false, -int256(1e40), target);
    }

    /// @dev Moves BOTH pools to a tick and lets the TWAP catch up: a settled market at a new price.
    function _setPrice(int24 tick) internal {
        uint160 s = TickMath.getSqrtPriceAtTick(tick);
        _moveTo(key, s);
        _moveTo(refKey, s);
        vm.warp(_now() + 31 minutes);
    }

    /// @dev Round-trip swap volume to generate fees, ending at the starting price.
    function _churn(uint256 ethIn) internal {
        (uint160 start,) = _spot();
        ops.swap{value: ethIn}(key, true, -int256(ethIn), 0);
        _moveTo(key, start);
    }
}
