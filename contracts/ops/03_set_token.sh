#!/usr/bin/env bash
# Usage: ops/03_set_token.sh <NIMORI token address>. Allowed until the first stake.
source "$(dirname "$0")/env.sh"
TOKEN="${1:?usage: 03_set_token.sh <token>}"
: "${ARCADE:?no ARCADE}"
echo "token   $TOKEN  symbol=$(cast call "$TOKEN" 'symbol()(string)' --rpc-url "$RPC")  decimals=$(cast call "$TOKEN" 'decimals()(uint8)' --rpc-url "$RPC")"
OUT=$(cast send "$ARCADE" 'setStakingToken(address)' "$TOKEN" --rpc-url "$RPC" --private-key "$PRIVATE_KEY" \
  --legacy --gas-price "$(gas_price)" --json)
echo "status  $(echo "$OUT" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["status"], d["transactionHash"])')"
echo "now     $(cast call "$ARCADE" 'stakingToken()(address)' --rpc-url "$RPC")"
