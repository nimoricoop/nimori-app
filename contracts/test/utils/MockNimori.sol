// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Stand-in for $NIMORI: a plain 18-decimal ERC-20, like a Pons token.
contract MockNimori is ERC20 {
    constructor() ERC20("NIMORI", "NIMORI") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
