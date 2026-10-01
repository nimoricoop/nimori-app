// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Compiles the PoolManager on the default (legacy) pipeline. Tests deploy it from this artifact with
// `deployCode`, because a test that imports both the via-IR lobby and the PoolManager would force the
// PoolManager through via-IR too, where it does not compile (stack too deep).
import {PoolManager} from "v4-core/src/PoolManager.sol";
