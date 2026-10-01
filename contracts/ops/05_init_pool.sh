#!/usr/bin/env bash
# Usage: ops/05_init_pool.sh <tick>          open the co-op pool at a tick (NIMORI per ETH = 1.0001^tick)
#        ops/05_init_pool.sh --sqrt <sqrtPriceX96>
#        ops/05_init_pool.sh --from-pons     open it at the current price of the Pons pool of TOKEN
# Once only (the Lobby refuses a second call).
source "$(dirname "$0")/env.sh"
: "${LOBBY:?no LOBBY in $DEPF}"
[ "$(cast call "$LOBBY" 'poolInitialized()(bool)' --rpc-url "$RPC")" = false ] || { echo "already initialized"; exit 1; }
case "${1:?usage: 05_init_pool.sh <tick> | --sqrt <x96> | --from-pons}" in
  --sqrt) SQRT="${2:?sqrt}" ;;
  --from-pons)
    source "$(dirname "$0")/pons_key.sh"
    read -r RSQRT RTICK < <(slot0 "$PONS_ID")
    if [ "$PONS_INVERTED" = 1 ]; then SQRT=$(python3 -c "print((1<<192)//$RSQRT)"); else SQRT=$RSQRT; fi
    echo "pons pool tick $RTICK (inverted=$PONS_INVERTED)" ;;
  *) SQRT=$(python3 -c "
from decimal import Decimal, getcontext; getcontext().prec=80
print(int(Decimal('1.0001')**(Decimal($1)/2) * (1<<96)))") ;;
esac
echo "initializePool($SQRT)"
R=$(send "$LOBBY" 'initializePool(uint160)' "$SQRT")
read -r TX GAS <<< "$R"
echo "tx $TX  gas $GAS"
[ "$(cast call "$LOBBY" 'poolInitialized()(bool)' --rpc-url "$RPC")" = true ] || { echo "NOT initialized"; exit 1; }
read -r S T < <(slot0 "$POOL_ID")
[ "$S" != 0 ] || { echo "pool slot0 is empty"; exit 1; }
echo "pool $POOL_ID  sqrtPriceX96 $S  tick $T  (~$(python3 -c "print(f'{1.0001**$T:,.2f}')") NIMORI per ETH)"
echo "TWAP guard live in 30 min; matching also needs ops/06_set_reference.sh"
