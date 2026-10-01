#!/usr/bin/env bash
# Sourced. Derives the Pons V2 pool key of $TOKEN from the Pons factory (must have graduated), or takes it
# from REF_KEY="c0 c1 fee spacing hooks". Sets PONS_C0 PONS_C1 PONS_FEE PONS_SPACING PONS_HOOKS PONS_ID PONS_INVERTED.
: "${TOKEN:?no TOKEN}"
if [ -n "${REF_KEY:-}" ]; then
  read -r PONS_C0 PONS_C1 PONS_FEE PONS_SPACING PONS_HOOKS <<< "$REF_KEY"
else
  L=$(cast call "$PONS_FACTORY" 'getLaunchedToken(address)((address,address,address,address,address,uint256,uint24,int24,uint16,bool,uint8,uint256,uint256,uint256,bool))' "$TOKEN" --rpc-url "$RPC")
  read -r PAIR FEE SPACING PHASE EXISTS < <(echo "$L" | python3 -c '
import sys,re
s=sys.stdin.read().strip().strip("()")
f=[x.strip() for x in s.split(",")]
print(f[4], f[6].split()[0], f[7].split()[0], f[10].split()[0], f[14])')
  [ "$EXISTS" = true ] || { echo "TOKEN is not a Pons V2 launch"; exit 1; }
  [ "$PHASE" = 2 ] || { echo "Pons launch not graduated yet (phase $PHASE): no v4 pool to reference"; exit 1; }
  HOOKS=$(cast call "$PONS_FACTORY" 'memeHook()(address)' --rpc-url "$RPC")
  if python3 -c "import sys; sys.exit(0 if int('$PAIR',16) < int('$TOKEN',16) else 1)"; then
    PONS_C0=$PAIR; PONS_C1=$TOKEN; else PONS_C0=$TOKEN; PONS_C1=$PAIR; fi
  PONS_FEE=$FEE; PONS_SPACING=$SPACING; PONS_HOOKS=$HOOKS
fi
PONS_ID=$(cast keccak "$(cast abi-encode 'f(address,address,uint24,int24,address)' "$PONS_C0" "$PONS_C1" "$PONS_FEE" "$PONS_SPACING" "$PONS_HOOKS")")
if [ "$(echo "$PONS_C0" | tr A-F a-f)" = "$(echo "$TOKEN" | tr A-F a-f)" ]; then PONS_INVERTED=1; else PONS_INVERTED=0; fi
echo "pons key ($PONS_C0, $PONS_C1, $PONS_FEE, $PONS_SPACING, $PONS_HOOKS) id $PONS_ID"
