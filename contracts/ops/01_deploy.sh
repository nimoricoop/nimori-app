#!/usr/bin/env bash
# Deploy the Arcade with NO staking token. Owner = deployer.
source "$(dirname "$0")/env.sh"
if [ -n "${ARCADE:-}" ] && [ "$(cast code "$ARCADE" --rpc-url "$RPC" | wc -c)" -gt 4 ]; then
  echo "ARCADE already deployed at $ARCADE"; exit 1; fi
echo "deployer $DEPLOYER  balance $(cast balance "$DEPLOYER" --ether --rpc-url "$RPC") ETH  fork=$IS_FORK"
OUT=$(forge create src/NimoriArcade.sol:NimoriArcade --rpc-url "$RPC" --private-key "$PRIVATE_KEY" \
  --legacy --gas-price "$(gas_price)" --broadcast --json --constructor-args "$DEPLOYER")
ADDR=$(echo "$OUT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["deployedTo"])')
TX=$(echo "$OUT" | python3 -c 'import json,sys; print(json.load(sys.stdin)["transactionHash"])')
# Read back off the chain, not out of forge's output.
[ "$(cast code "$ADDR" --rpc-url "$RPC" | wc -c)" -gt 4 ] || { echo "NO CODE at $ADDR"; exit 1; }
printf 'ARCADE=%s\nARCADE_TX=%s\n' "$ADDR" "$TX" > "$DEPF"
echo "ARCADE  $ADDR  tx $TX  -> $DEPF"
echo "owner   $(cast call "$ADDR" 'owner()(address)' --rpc-url "$RPC")"
echo "token   $(cast call "$ADDR" 'stakingToken()(address)' --rpc-url "$RPC")  (zero until 03_set_token)"
