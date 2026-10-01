// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";

/// @notice Test-only swapper and liquidity adder for v4 pools with native ETH as currency0. The caller pays
///         (ETH as msg.value, tokens by allowance to this contract) and receives what comes out.
contract PoolOps is IUnlockCallback {
    IPoolManager public immutable pm;

    constructor(IPoolManager pm_) {
        pm = pm_;
    }

    struct Call {
        uint8 kind; // 0 swap, 1 modify liquidity
        PoolKey key;
        SwapParams swap;
        ModifyLiquidityParams liq;
        address payer;
    }

    /// @notice Exact-in when amountSpecified < 0. sqrtLimit 0 means "no limit".
    function swap(PoolKey memory key, bool zeroForOne, int256 amountSpecified, uint160 sqrtLimit)
        public
        payable
        returns (BalanceDelta delta)
    {
        if (sqrtLimit == 0) sqrtLimit = zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        Call memory c;
        c.kind = 0;
        c.key = key;
        c.swap = SwapParams({zeroForOne: zeroForOne, amountSpecified: amountSpecified, sqrtPriceLimitX96: sqrtLimit});
        c.payer = msg.sender;
        delta = abi.decode(pm.unlock(abi.encode(c)), (BalanceDelta));
        _refund();
    }

    function modifyLiquidity(PoolKey memory key, int24 lower, int24 upper, int256 liquidity, bytes32 salt)
        external
        payable
        returns (BalanceDelta delta)
    {
        Call memory c;
        c.kind = 1;
        c.key = key;
        c.liq = ModifyLiquidityParams({tickLower: lower, tickUpper: upper, liquidityDelta: liquidity, salt: salt});
        c.payer = msg.sender;
        delta = abi.decode(pm.unlock(abi.encode(c)), (BalanceDelta));
        _refund();
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        require(msg.sender == address(pm), "only pm");
        Call memory c = abi.decode(data, (Call));
        BalanceDelta d;
        if (c.kind == 0) d = pm.swap(c.key, c.swap, "");
        else (d,) = pm.modifyLiquidity(c.key, c.liq, "");
        _settle(c.key.currency0, d.amount0(), c.payer);
        _settle(c.key.currency1, d.amount1(), c.payer);
        return abi.encode(d);
    }

    function _settle(Currency cur, int128 amt, address payer) internal {
        if (amt < 0) {
            uint256 owe = uint256(uint128(-amt));
            if (cur.isAddressZero()) {
                pm.settle{value: owe}();
            } else {
                pm.sync(cur);
                IERC20(Currency.unwrap(cur)).transferFrom(payer, address(pm), owe);
                pm.settle();
            }
        } else if (amt > 0) {
            pm.take(cur, payer, uint256(uint128(amt)));
        }
    }

    function _refund() internal {
        if (address(this).balance > 0) {
            (bool ok,) = msg.sender.call{value: address(this).balance}("");
            require(ok, "refund");
        }
    }

    receive() external payable {}
}
