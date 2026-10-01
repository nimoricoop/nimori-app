#!/usr/bin/env bash
# Verify on Sourcify (works on Robinhood Chain), Blockscout as a fallback.
source "$(dirname "$0")/env.sh"
: "${ARCADE:?no ARCADE in deployment.env}"
ARGS=$(cast abi-encode 'constructor(address)' "$DEPLOYER")
forge verify-contract "$ARCADE" src/NimoriArcade.sol:NimoriArcade --chain-id "$CHAIN_ID" \
  --verifier sourcify --constructor-args "$ARGS" --watch || \
forge verify-contract "$ARCADE" src/NimoriArcade.sol:NimoriArcade --chain-id "$CHAIN_ID" \
  --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/ \
  --constructor-args "$ARGS" --skip-is-verified-check
