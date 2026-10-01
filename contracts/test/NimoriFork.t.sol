// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {HookMiner} from "v4-periphery/test/shared/HookMiner.sol";

import {NimoriLobby} from "../src/NimoriLobby.sol";
import {NimoriArcade} from "../src/NimoriArcade.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolOps} from "./utils/PoolOps.sol";

interface IOracle {
    function consult(bytes32 id, uint32 secondsAgo) external view returns (int24, uint32);
    function poolManager() external view returns (address);
}

/// @notice End to end on a fork of Robinhood Chain against the REAL PoolManager and the REAL deployed Arcade:
///         mine + CREATE2-deploy the hook from its artifact, deploy the lobby (mock token), open the pool,
///         deposit, match, trade through our own swapper, collect, unplug, claim.
/// @dev    Needs RH_RPC in the environment; skipped otherwise.
contract NimoriForkTest is Test {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    IPoolManager constant PM = IPoolManager(0x8366a39CC670B4001A1121B8F6A443A643e40951);
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    NimoriArcade constant ARCADE = NimoriArcade(payable(0x3341b6130eB70A39e2304Cf5eCB6B1fd533dA959));
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    /// @dev The real $NIMORI and its real Pons V2 pool (native ETH, fee 0, spacing 200, Pons hook).
    IERC20 constant NIM = IERC20(0x168A0935Fa187Ddd75473A469282B7b8461aa99e);
    address constant PONS_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;

    NimoriLobby lobby;
    IERC20 nim = NIM;
    uint160 ponsSqrt;
    PoolOps ops;
    PoolKey key;
    PoolKey refKey;
    address hook;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    receive() external payable {}

    function _queued(address) internal view returns (uint256 q) {
        // bob's unmatched remainder (if above the minimum) is still queued in deposit 2
        (,,, uint128 a,,) = lobby.deposits(2);
        (uint128 o1, uint128 o2) = lobby.owed(bob);
        o1;
        return uint256(a) + o2;
    }

    function setUp() public {
        string memory rpc = vm.envOr("RH_RPC", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        require(block.chainid == 4663, "not RH");
        vm.deal(address(this), 1e9 ether);

        bytes memory code = vm.getCode("out/NimoriHook.sol/NimoriHook.json");
        uint160 flags = uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG);
        (address predicted, bytes32 salt) = HookMiner.find(CREATE2_DEPLOYER, flags, code, abi.encode(address(PM)));
        (bool ok, bytes memory ret) = CREATE2_DEPLOYER.call(abi.encodePacked(salt, code, abi.encode(address(PM))));
        require(ok && address(bytes20(ret)) == predicted, "hook");
        hook = predicted;
        assertEq(IOracle(hook).poolManager(), address(PM));

        lobby = new NimoriLobby(PM, IHooks(hook), address(nim), address(0), address(ARCADE), 1000e18, address(this));
        key = lobby.poolKey();

        // The REAL Pons pool of $NIMORI is the reference; the co-op pool opens at its price.
        refKey = PoolKey(Currency.wrap(address(0)), Currency.wrap(address(nim)), 0, 200, IHooks(PONS_HOOK));
        (ponsSqrt,,,) = PM.getSlot0(refKey.toId());
        assertGt(ponsSqrt, 0, "Pons pool not live");
        assertGt(PM.getLiquidity(refKey.toId()), 0, "Pons pool has no liquidity");
        lobby.initializePool(ponsSqrt);

        ops = new PoolOps(PM);
        deal(address(nim), address(this), 1e30); // the live price moves fast: plenty for any price
        nim.approve(address(ops), type(uint256).max);
        ops.modifyLiquidity{value: 1e3 ether}(key, -887200, 887200, 4e22, 0); // ~10 ETH + matching NIMORI
        lobby.setReferencePool(refKey);
        (bool okp,,,, bool ru,) = lobby.priceStatus();
        assertTrue(okp && ru, "guarded against the real Pons price");
        vm.warp(block.timestamp + 31 minutes);
    }

    function test_fork_fullCycle() public {
        // deposit, match
        vm.deal(alice, 2 ether);
        vm.prank(alice);
        lobby.deposit1P{value: 2 ether}(0);
        uint256 nAmt = (2 ether * uint256(ponsSqrt) / (1 << 96)) * uint256(ponsSqrt) / (1 << 96); // ~2 ETH of NIMORI
        deal(address(nim), bob, nAmt);
        vm.startPrank(bob);
        nim.approve(address(lobby), type(uint256).max);
        uint256 g = gasleft();
        lobby.deposit2P(0, nAmt); // auto-matches
        uint256 matchGas = g - gasleft();
        vm.stopPrank();
        assertEq(lobby.ownerOf(2), alice);
        assertEq(lobby.ownerOf(3), bob);
        (,,,,, uint128 liq, uint128 e0, uint128 n0) = lobby.sessions(1);
        (uint128 inPm,,) = PM.getPositionInfo(key.toId(), address(lobby), -887200, 887200, bytes32(uint256(1)));
        assertEq(inPm, liq, "position lives in the real PoolManager");

        // trade through our own swapper, both ways
        (uint160 start,,,) = PM.getSlot0(key.toId());
        ops.swap{value: 0.3 ether}(key, true, -0.3 ether, 0);
        ops.swap(key, false, -int256(1e40), start);

        // collect: 10% ETH to the real Arcade, 10% NIMORI burned
        uint256 q = ARCADE.queuedRewards();
        uint256 dead0 = nim.balanceOf(DEAD);
        g = gasleft();
        lobby.collectFees(1);
        uint256 collectGas = g - gasleft();
        assertGt(ARCADE.queuedRewards(), q, "Arcade received the protocol share");
        assertGt(nim.balanceOf(DEAD), dead0, "NIMORI share burned");

        // the oracle saw the trades
        (, int24 spot,,) = PM.getSlot0(key.toId());
        (int24 m,) = IOracle(hook).consult(bytes32(abi.encode(key.toId())), 1800);
        assertApproxEqAbs(m, spot, 1);

        // unplug after 24 h, claim both seats
        vm.warp(block.timestamp + 25 hours);
        vm.prank(alice);
        g = gasleft();
        lobby.unplug(2);
        uint256 unplugGas = g - gasleft();
        (uint128 ce1, uint128 cn1) = lobby.credits(2);
        (uint128 ce2, uint128 cn2) = lobby.credits(3);
        assertApproxEqAbs(uint256(ce1), e0, e0 / 100, "1P ~ its deposit back plus fees");
        assertLt(cn1, n0 / 100);
        assertApproxEqAbs(cn2, n0, n0 / 100, "2P ~ its deposit back plus fees");
        uint256 ab = alice.balance;
        vm.prank(alice);
        lobby.claim(2);
        assertEq(alice.balance - ab, ce1);
        vm.prank(bob);
        lobby.claim(3);
        assertEq(nim.balanceOf(bob), nAmt - n0 + cn2 - _queued(bob));
        (uint256 le, uint256 ln) = lobby.liabilities();
        assertEq(address(lobby).balance, le);
        assertEq(nim.balanceOf(address(lobby)), ln);
        ce2;

        console2.log("gas deposit2P + auto-match (1 pair):", matchGas);
        console2.log("gas collectFees:", collectGas);
        console2.log("gas unplug:", unplugGas);
        console2.log("hook:", hook);
    }
}
