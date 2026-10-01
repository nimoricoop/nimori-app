// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NimoriLobby} from "../../src/NimoriLobby.sol";
import {PoolOps} from "./PoolOps.sol";

/// @notice The lobby with its price guard switched OFF. Exists only to prove the guard is load-bearing: the
///         same sandwich that reverts against {NimoriLobby} turns a profit against this one.
contract UnguardedLobby is NimoriLobby {
    constructor(IPoolManager pm_, IHooks hook_, address nimori_, address arcade_, uint256 minNim, address owner_)
        NimoriLobby(pm_, hook_, nimori_, address(0), arcade_, minNim, owner_)
    {}

    function _requirePrice() internal view override {}
}

/// @notice One-transaction attacker: move the pool, make the lobby act at the manipulated price, move it back.
contract Attacker {
    PoolOps public immutable ops;
    IERC20 public immutable nim;

    constructor(PoolOps ops_, IERC20 nim_) {
        ops = ops_;
        nim = nim_;
        nim_.approve(address(ops_), type(uint256).max);
    }

    /// @dev Sells NIMORI to push the price (NIMORI per ETH) up to `high`, lets the lobby match there, then sells
    ///      ETH to bring it back to `back`.
    function sandwichMatch(NimoriLobby lobby, PoolKey calldata key, uint160 high, uint160 back, uint8 d) external {
        ops.swap(key, false, -int256(1e40), high);
        lobby.matchQueue(d, 1);
        ops.swap{value: address(this).balance}(key, true, -int256(address(this).balance), back);
    }

    /// @dev Moves the price, then unplugs a seat this contract owns, in the same transaction.
    function pumpThenUnplug(NimoriLobby lobby, PoolKey calldata key, uint160 high, uint256 seatId) external {
        ops.swap(key, false, -int256(1e40), high);
        lobby.unplug(seatId);
    }

    function pumpThenMatch(NimoriLobby lobby, PoolKey calldata key, uint160 high, uint8 d) external {
        ops.swap(key, false, -int256(1e40), high);
        lobby.matchQueue(d, 1);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    receive() external payable {}
}
