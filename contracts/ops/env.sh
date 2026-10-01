#!/usr/bin/env bash
# NIMORI contracts: chain, RPC, key loading and guards. BASH ONLY.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; export ROOT; cd "$ROOT"
export CHAIN_ID=4663
# Key lives outside the repo, never in .env.
if [ -z "${PRIVATE_KEY:-}" ] && [ -f "$HOME/.nimori-keys/launch.env" ]; then
  PRIVATE_KEY="$(sed -n 's/^NIMORI_PK=//p' "$HOME/.nimori-keys/launch.env")"; export PRIVATE_KEY
fi
[ -n "${PRIVATE_KEY:-}" ] || { echo "no PRIVATE_KEY"; exit 1; }
# The public RPC sits behind a Cloudflare challenge: default to the private Alchemy URL.
RH_RPC="$(sed -n 's/^RH_RPC=//p' "$HOME/.nimori-keys/launch.env" 2>/dev/null || true)"
export RPC="${RPC:-${RH_RPC:-https://rpc.mainnet.chain.robinhood.com}}"
DEPLOYER="$(cast wallet address --private-key "$PRIVATE_KEY")"; export DEPLOYER
# 🔴 A fork answers with the mainnet chain id: classify by HOST, and demand MAINNET=yes for a real chain.
case "$RPC" in
  *127.0.0.1*|*localhost*) export IS_FORK=1 ;;
  *) export IS_FORK=0; [ "${MAINNET:-}" = "yes" ] || { echo "real chain RPC ($RPC): set MAINNET=yes"; exit 1; } ;;
esac
[ "$(cast chain-id --rpc-url "$RPC")" = "$CHAIN_ID" ] || { echo "RPC is not chain $CHAIN_ID"; exit 1; }
# Gas follows the live base fee (never a fixed cap). Robinhood Chain wants legacy txs.
gas_price() { echo $(( $(cast gas-price --rpc-url "$RPC") * 2 )); }
if [ "$IS_FORK" = 1 ]; then DEPF="$ROOT/deployment.fork.env"; else DEPF="$ROOT/deployment.env"; fi; export DEPF
[ -f "$DEPF" ] && source "$DEPF" || true

# Contracts the lobby scripts talk to (Robinhood Chain, and the same on a fork of it).
export POOL_MANAGER=0x8366a39CC670B4001A1121B8F6A443A643e40951
export PONS_FACTORY=0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e
# upsert KEY VALUE into the deployment env file, keeping every other line.
upsert() {
  local k="$1" v="$2"
  touch "$DEPF"
  grep -v "^${k}=" "$DEPF" > "$DEPF.tmp" || true
  printf '%s=%s\n' "$k" "$v" >> "$DEPF.tmp"
  mv "$DEPF.tmp" "$DEPF"
}
# cast send + check status; prints "<txhash> <gasUsed>". Never parse cast's text output for the hash.
send() {
  local out
  # options FIRST: a caller's "--" (for negative numbers) would turn anything after it into positionals.
  out=$(cast send --rpc-url "$RPC" --private-key "$PRIVATE_KEY" --legacy --gas-price "$(gas_price)" --json "$@")
  echo "$out" | python3 -c 'import json,sys
d=json.load(sys.stdin)
ok=str(d.get("status")) in ("0x1","1")
print(d["transactionHash"], int(d["gasUsed"],16) if str(d["gasUsed"]).startswith("0x") else d["gasUsed"])
sys.exit(0 if ok else 1)'
}
# slot0 of a v4 pool by id, read straight from the PoolManager: prints "<sqrtPriceX96> <tick>".
slot0() {
  local id="$1" slot raw
  slot=$(cast keccak "$(cast abi-encode 'f(bytes32,uint256)' "$id" 6)")
  raw=$(cast call "$POOL_MANAGER" 'extsload(bytes32)(bytes32)' "$slot" --rpc-url "$RPC")
  python3 -c "
r=int('$raw',16); s=r&((1<<160)-1); t=(r>>160)&0xffffff
t=t-(1<<24) if t>=(1<<23) else t
print(s,t)"
}
