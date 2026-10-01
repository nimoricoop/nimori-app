// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/src/libraries/Hooks.sol";
import {HookMiner} from "v4-periphery/test/shared/HookMiner.sol";
import {NimoriLobby} from "../src/NimoriLobby.sol";

interface IHookView {
    function poolManager() external view returns (address);
}

/// @notice Mines and deploys the NIMORI hook through the CREATE2 deployer, then deploys the Lobby.
/// @dev    Env: PRIVATE_KEY, TOKEN (NIMORI), ARCADE, optional WETH (default 0), MIN_NIMORI (default 1000e18),
///         OUT_FILE (where the addresses are written for the shell script to read back and check on chain).
/// @dev    🔴 The hook's init code is read from its ARTIFACT (legacy pipeline), not from `type(NimoriHook)`:
///         this script imports the via-IR lobby, so a `new NimoriHook` here would compile the hook through
///         via-IR too, and the deployed bytes would no longer match the verified source settings.
contract DeployLobby is Script {
    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    uint256 constant CHAIN_ID = 4663;

    function run() external {
        require(block.chainid == CHAIN_ID, "not Robinhood Chain (or a fork of it)");
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address me = vm.addr(pk);
        address token = vm.envAddress("TOKEN");
        address arcade = vm.envAddress("ARCADE");
        address weth = vm.envOr("WETH", address(0));
        uint256 minNim = vm.envOr("MIN_NIMORI", uint256(1000e18));
        require(token.code.length > 0, "TOKEN has no code");
        require(arcade.code.length > 0, "ARCADE has no code");
        require(POOL_MANAGER.code.length > 0, "no PoolManager");
        require(CREATE2_DEPLOYER.code.length > 0, "no CREATE2 deployer");

        bytes memory hookCode = vm.getCode("out/NimoriHook.sol/NimoriHook.json");
        bytes memory args = abi.encode(POOL_MANAGER);
        uint160 flags = uint160(Hooks.AFTER_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG);
        (address predicted, bytes32 salt) = HookMiner.find(CREATE2_DEPLOYER, flags, hookCode, args);
        console2.log("hook salt", uint256(salt));

        vm.startBroadcast(pk);
        (bool ok, bytes memory ret) = CREATE2_DEPLOYER.call(abi.encodePacked(salt, hookCode, args));
        require(ok && ret.length == 20 && address(bytes20(ret)) == predicted, "hook deploy failed");
        NimoriLobby lobby = new NimoriLobby(
            IPoolManager(POOL_MANAGER), IHooks(predicted), token, weth, arcade, minNim, me
        );
        vm.stopBroadcast();

        require(IHookView(predicted).poolManager() == POOL_MANAGER, "hook bound to the wrong PoolManager");
        require(uint160(predicted) & Hooks.ALL_HOOK_MASK == flags, "hook address flags");
        require(address(lobby.nimori()) == token && lobby.arcade() == arcade && lobby.owner() == me, "lobby wiring");

        string memory out = vm.envOr("OUT_FILE", string("lobby.out.env"));
        vm.writeFile(
            out,
            string.concat(
                "HOOK=", vm.toString(predicted), "\n",
                "HOOK_SALT=", vm.toString(salt), "\n",
                "LOBBY=", vm.toString(address(lobby)), "\n",
                "TOKEN=", vm.toString(token), "\n",
                "POOL_ID=", vm.toString(abi.encode(lobby.poolId())), "\n"
            )
        );
        console2.log("HOOK ", predicted);
        console2.log("LOBBY", address(lobby));
    }
}
