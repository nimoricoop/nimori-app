#!/usr/bin/env bash
# Rehearsal of the lobby launch on an anvil FORK of Robinhood Chain, with the REAL ops scripts
# (04_deploy_lobby, 05_init_pool, 06_set_reference) and the real key, then a full cycle in cast:
# deposit -> match -> trades -> collect -> unplug -> claim. Nothing leaves this machine except fork reads.
# The REAL $NIMORI and its REAL Pons V2 pool (read from the Pons factory) are used; the deployer's NIMORI for
# the smoke cycle is lent by the PoolManager, impersonated on the fork only.
# Verdict: PASS only if the lobby holds exactly its liabilities, the position is gone and both seats were paid.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$ROOT"
PORT=8547
RH_RPC="$(sed -n 's/^RH_RPC=//p' "$HOME/.nimori-keys/launch.env")"
[ -n "$RH_RPC" ] || { echo "no RH_RPC"; exit 1; }
export RPC="http://127.0.0.1:$PORT"
lsof -ti tcp:$PORT >/dev/null 2>&1 && { echo "port $PORT busy (orphan anvil?)"; exit 1; }

# Keep the real deployment state and broadcasts out of reach of the rehearsal, restore them on any exit.
BK="$(mktemp -d)"
[ -f deployment.fork.env ] && cp deployment.fork.env "$BK/"
[ -d broadcast/DeployLobby.s.sol ] && mv broadcast/DeployLobby.s.sol "$BK/bc"
cleanup() {
  [ -n "${APID:-}" ] && kill "$APID" 2>/dev/null || true
  rm -rf broadcast/DeployLobby.s.sol
  [ -d "$BK/bc" ] && mv "$BK/bc" broadcast/DeployLobby.s.sol
  if [ -f "$BK/deployment.fork.env" ]; then cp "$BK/deployment.fork.env" deployment.fork.env; else rm -f deployment.fork.env; fi
  rm -rf "$BK" .lobby.out.env .lobby.deploy.log
}
trap cleanup EXIT

anvil --fork-url "$RH_RPC" --port $PORT --silent &
APID=$!
for _ in $(seq 1 60); do cast chain-id --rpc-url "$RPC" >/dev/null 2>&1 && break; sleep 0.5; done
[ "$(cast chain-id --rpc-url "$RPC")" = 4663 ] || { echo "fork did not come up"; exit 1; }

source ops/env.sh   # RPC is local: IS_FORK=1, DEPF=deployment.fork.env
[ "$IS_FORK" = 1 ] || { echo "NOT A FORK, abort"; exit 1; }
cast rpc anvil_setBalance "$DEPLOYER" 0x56BC75E2D63100000 --rpc-url "$RPC" >/dev/null   # 100 ETH on the fork
# The Arcade is the one really deployed on RH.
grep -q '^ARCADE=' "$DEPF" 2>/dev/null || upsert ARCADE 0x3341b6130eB70A39e2304Cf5eCB6B1fd533dA959
ARCADE=$(sed -n 's/^ARCADE=//p' "$DEPF")
grep -v -E '^(HOOK|HOOK_SALT|LOBBY|TOKEN|POOL_ID|REF_ID)=' "$DEPF" > "$DEPF.t" || true; mv "$DEPF.t" "$DEPF"

# 🔴 --constructor-args swallows every argument after it: the caller's args go LAST.
fc() { forge create --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --legacy --gas-price "$(gas_price)" --broadcast --json "$@" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["deployedTo"])'; }
TOKEN=0x168A0935Fa187Ddd75473A469282B7b8461aa99e
OPS=$(fc test/utils/PoolOps.sol:PoolOps --constructor-args "$POOL_MANAGER")
echo "== NIMORI $TOKEN   test swapper $OPS"
# Sizes follow the LIVE price (it moves a lot): E wei of ETH per leg, and its NIMORI equivalent at the Pons price.
source "$(dirname "$0")/pons_key.sh" >/dev/null
read -r PSQRT _ <<< "$(slot0 "$PONS_ID")"
PMBAL=$(cast call "$TOKEN" 'balanceOf(address)(uint256)' "$POOL_MANAGER" --rpc-url "$RPC" | awk '{print $1}')
read -r E SEED_L NDEP LEND <<< "$(python3 -c "
s=$PSQRT; Q=1<<96; p=s*s/(Q*Q)          # NIMORI per ETH
E=int(min(1e18, $PMBAL/(6*p)))          # keep total NIMORI needs under a third of what the PoolManager holds
print(E, int(E*2*s/Q), int(E*p*1.05), int(E*p*5))")"
echo "== sizes: $E wei ETH per leg at $(python3 -c "print(f'{($PSQRT/(1<<96))**2:,.0f}')") NIMORI/ETH"
cast rpc anvil_impersonateAccount "$POOL_MANAGER" --rpc-url "$RPC" >/dev/null
cast rpc anvil_setBalance "$POOL_MANAGER" 0x56BC75E2D63100000 --rpc-url "$RPC" >/dev/null
cast send "$TOKEN" 'transfer(address,uint256)' "$DEPLOYER" "$LEND" --from "$POOL_MANAGER" --unlocked --rpc-url "$RPC" >/dev/null
cast rpc anvil_stopImpersonatingAccount "$POOL_MANAGER" --rpc-url "$RPC" >/dev/null
send "$TOKEN" 'approve(address,uint256)' "$OPS" "$(cast max-uint)" >/dev/null
MOCK=$TOKEN
echo "== 04_deploy_lobby"
ops/04_deploy_lobby.sh "$TOKEN"
source "$DEPF"
echo "== 05_init_pool (at the live Pons price)"
ops/05_init_pool.sh --from-pons
KEY="(0x0000000000000000000000000000000000000000,$TOKEN,10000,200,$HOOK)"
# outside liquidity in the co-op pool, so the trades below have depth (~1.7 ETH full range at ~35M NIMORI per ETH)
send --value 10ether "$OPS" 'modifyLiquidity((address,address,uint24,int24,address),int24,int24,int256,bytes32)' \
  "$KEY" -- -887200 887200 "$SEED_L" 0x0000000000000000000000000000000000000000000000000000000000000000 >/dev/null
echo "== 06_set_reference (Pons key read from the Pons factory)"
ops/06_set_reference.sh

cast rpc evm_increaseTime 1860 --rpc-url "$RPC" >/dev/null; cast rpc evm_mine --rpc-url "$RPC" >/dev/null
echo "== cycle"
R=$(send --value "$E" "$LOBBY" 'deposit1P(uint8)' 0); echo "deposit1P            gas ${R#* }"
send "$MOCK" 'approve(address,uint256)' "$LOBBY" "$(cast max-uint)" >/dev/null
R=$(send "$LOBBY" 'deposit2P(uint8,uint256)' 0 "$NDEP"); echo "deposit2P + match    gas ${R#* }"
[ "$(cast call "$LOBBY" 'nextSessionId()(uint256)' --rpc-url "$RPC")" = 2 ] || { echo "FAIL: no session"; exit 1; }
cast call "$LOBBY" 'sessions(uint256)(uint8,bool,int24,int24,uint64,uint128,uint128,uint128)' 1 --rpc-url "$RPC" | tr '\n' ' '; echo
read -r S0 _ <<< "$(slot0 "$POOL_ID")"
SW=$((E / 3))
send --value "$SW" "$OPS" 'swap((address,address,uint24,int24,address),bool,int256,uint160)' "$KEY" true -- -"$SW" 0 >/dev/null
send "$OPS" 'swap((address,address,uint24,int24,address),bool,int256,uint160)' "$KEY" false -- -1000000000000000000000000000000 "$S0" >/dev/null
Q0=$(cast call "$ARCADE" 'queuedRewards()(uint256)' --rpc-url "$RPC" | awk '{print $1}')
R=$(send "$LOBBY" 'collectFees(uint256)' 1); echo "collectFees          gas ${R#* }"
Q1=$(cast call "$ARCADE" 'queuedRewards()(uint256)' --rpc-url "$RPC" | awk '{print $1}')
echo "arcade queued +$(python3 -c "print($Q1-$Q0)") wei   burned $(cast call "$MOCK" 'balanceOf(address)(uint256)' 0x000000000000000000000000000000000000dEaD --rpc-url "$RPC" | awk '{print $1}')"
cast rpc evm_increaseTime 90000 --rpc-url "$RPC" >/dev/null; cast rpc evm_mine --rpc-url "$RPC" >/dev/null
R=$(send "$LOBBY" 'unplug(uint256)' 2); echo "unplug               gas ${R#* }"
cast call "$LOBBY" 'credits(uint256)(uint128,uint128)' 2 --rpc-url "$RPC" | tr '\n' ' '; echo " <- seat 2 (1P) credit"
cast call "$LOBBY" 'credits(uint256)(uint128,uint128)' 3 --rpc-url "$RPC" | tr '\n' ' '; echo " <- seat 3 (2P) credit"
R=$(send "$LOBBY" 'claim(uint256)' 2); echo "claim 1P             gas ${R#* }"
R=$(send "$LOBBY" 'claim(uint256)' 3); echo "claim 2P             gas ${R#* }"

# Verdict
LIAB=$(cast call "$LOBBY" 'liabilities()(uint256,uint256)' --rpc-url "$RPC" | awk '{print $1}' | tr '\n' ' ')
read -r LE LN <<< "$LIAB"
BE=$(cast balance "$LOBBY" --rpc-url "$RPC")
BN=$(cast call "$MOCK" 'balanceOf(address)(uint256)' "$LOBBY" --rpc-url "$RPC" | awk '{print $1}')
SLOT=$(cast call "$LOBBY" 'sessions(uint256)(uint8,bool,int24,int24,uint64,uint128,uint128,uint128)' 1 --rpc-url "$RPC" | sed -n 2p)
echo "lobby ETH $BE / owes $LE   NIMORI $BN / owes $LN   session open=$SLOT"
if [ "$BE" = "$LE" ] && [ "$BN" = "$LN" ] && [ "$SLOT" = false ] && [ "$(python3 -c "print(int($Q1>$Q0))")" = 1 ]; then
  echo "REHEARSAL PASS"
else
  echo "REHEARSAL FAIL"; exit 1
fi
