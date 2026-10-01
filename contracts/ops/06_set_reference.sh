#!/usr/bin/env bash
# Usage: ops/06_set_reference.sh              pin the Pons pool of TOKEN (read from the Pons factory)
#        REF_KEY="c0 c1 fee spacing hooks" ops/06_set_reference.sh     pin an explicit pool key
# Once only. Matching and exits are refused until a reference (or 30 min of TWAP) exists.
source "$(dirname "$0")/env.sh"
: "${LOBBY:?no LOBBY in $DEPF}"
source "$(dirname "$0")/pons_key.sh"
[ "$(cast call "$LOBBY" 'referenceSet()(bool)' --rpc-url "$RPC")" = false ] || { echo "reference already set"; exit 1; }
R=$(send "$LOBBY" 'setReferencePool((address,address,uint24,int24,address))' \
  "($PONS_C0,$PONS_C1,$PONS_FEE,$PONS_SPACING,$PONS_HOOKS)")
read -r TX GAS <<< "$R"
echo "tx $TX  gas $GAS"
GOT=$(cast call "$LOBBY" 'referenceId()(bytes32)' --rpc-url "$RPC")
[ "$GOT" = "$PONS_ID" ] || { echo "referenceId $GOT != $PONS_ID"; exit 1; }
INV=$(cast call "$LOBBY" 'referenceInverted()(bool)' --rpc-url "$RPC")
upsert REF_ID "$PONS_ID"
echo "reference $PONS_ID inverted=$INV"
cast call "$LOBBY" 'priceStatus()(bool,int24,bool,int24,bool,int24)' --rpc-url "$RPC" | tr '\n' ' '; echo " <- ok spot twapUsed twap refUsed ref"
