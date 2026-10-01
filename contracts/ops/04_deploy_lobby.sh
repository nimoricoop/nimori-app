#!/usr/bin/env bash
# Usage: ops/04_deploy_lobby.sh <NIMORI token> [WETH, default none]
# Mines the hook address (CREATE2 deployer), deploys the hook and the Lobby, reads everything back off the
# chain and writes HOOK / LOBBY / POOL_ID into the deployment env. ARCADE comes from that same file.
source "$(dirname "$0")/env.sh"
TOKEN="${1:?usage: 04_deploy_lobby.sh <token> [weth]}"
WETH="${2:-0x0000000000000000000000000000000000000000}"
: "${ARCADE:?no ARCADE in $DEPF}"
if [ -n "${LOBBY:-}" ] && [ "$(cast codesize "$LOBBY" --rpc-url "$RPC")" -gt 0 ]; then
  echo "LOBBY already deployed at $LOBBY"; exit 1; fi
[ "$(cast codesize "$TOKEN" --rpc-url "$RPC")" -gt 0 ] || { echo "TOKEN $TOKEN has no code"; exit 1; }
DEC=$(cast call "$TOKEN" 'decimals()(uint8)' --rpc-url "$RPC")
[ "$DEC" = 18 ] || { echo "TOKEN decimals $DEC, the lobby's minimums assume 18"; exit 1; }
echo "token    $TOKEN  $(cast call "$TOKEN" 'symbol()(string)' --rpc-url "$RPC")"
echo "arcade   $ARCADE   weth $WETH"
echo "deployer $DEPLOYER  balance $(cast balance "$DEPLOYER" --ether --rpc-url "$RPC") ETH  fork=$IS_FORK"

forge build -q
OUT_FILE="$ROOT/.lobby.out.env"; rm -f "$OUT_FILE"
TOKEN="$TOKEN" ARCADE="$ARCADE" WETH="$WETH" OUT_FILE="$OUT_FILE" \
  forge script script/DeployLobby.s.sol:DeployLobby --rpc-url "$RPC" --broadcast --slow \
  --legacy --with-gas-price "$(gas_price)" > "$ROOT/.lobby.deploy.log" 2>&1 \
  || { grep -vE 'https?://' "$ROOT/.lobby.deploy.log" | tail -30; exit 1; }
source "$OUT_FILE"; rm -f "$OUT_FILE" "$ROOT/.lobby.deploy.log"

# 🔴 Read back off the chain, not out of forge's output.
fail() { echo "READ-BACK FAILED: $*"; exit 1; }
[ "$(cast codesize "$HOOK" --rpc-url "$RPC")" -gt 0 ] || fail "no code at hook $HOOK"
[ "$(cast codesize "$LOBBY" --rpc-url "$RPC")" -gt 0 ] || fail "no code at lobby $LOBBY"
lc() { cast call "$LOBBY" "$@" --rpc-url "$RPC"; }
[ "$(cast call "$HOOK" 'poolManager()(address)' --rpc-url "$RPC")" = "$POOL_MANAGER" ] || fail "hook PoolManager"
[ "$(lc 'hook()(address)')" = "$HOOK" ] || fail "lobby.hook"
[ "$(lc 'nimori()(address)' | tr A-F a-f)" = "$(echo "$TOKEN" | tr A-F a-f)" ] || fail "lobby.nimori"
[ "$(lc 'arcade()(address)' | tr A-F a-f)" = "$(echo "$ARCADE" | tr A-F a-f)" ] || fail "lobby.arcade"
[ "$(lc 'owner()(address)')" = "$DEPLOYER" ] || fail "lobby.owner"
[ "$(lc 'poolManager()(address)')" = "$POOL_MANAGER" ] || fail "lobby.poolManager"
FLAGS=$(python3 -c "print(int('$HOOK',16) & 0x3fff)")
[ "$FLAGS" = $(( (1<<12) | (1<<7) )) ] || fail "hook flags $FLAGS"
POOL_ID=$(lc 'poolId()(bytes32)')
upsert HOOK "$HOOK"; upsert HOOK_SALT "$HOOK_SALT"; upsert LOBBY "$LOBBY"; upsert TOKEN "$TOKEN"; upsert POOL_ID "$POOL_ID"
echo "HOOK     $HOOK  (flags afterInitialize|beforeSwap)"
echo "LOBBY    $LOBBY  owner $DEPLOYER"
echo "POOL_ID  $POOL_ID  (not initialized yet: ops/05_init_pool.sh)"
echo "-> $DEPF"
