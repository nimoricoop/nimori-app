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
