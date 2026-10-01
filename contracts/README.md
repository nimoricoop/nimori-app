# NIMORI contracts

Solidity for the NIMORI protocol on **Robinhood Chain (4663)**. Foundry, solc 0.8.26.

## Deployed

| Contract | Address | Source |
|---|---|---|
| `NimoriArcade` | [`0x3341b6130eB70A39e2304Cf5eCB6B1fd533dA959`](https://robinhoodchain.blockscout.com/address/0x3341b6130eB70A39e2304Cf5eCB6B1fd533dA959) | Sourcify exact match |
| `$NIMORI` (Pons V2) | [`0x168A0935Fa187Ddd75473A469282B7b8461aa99e`](https://robinhoodchain.blockscout.com/address/0x168A0935Fa187Ddd75473A469282B7b8461aa99e) | staking token of the Arcade |

## NimoriArcade: stake $NIMORI, earn ETH

- Any ETH sent to the Arcade (creator tax, protocol share of co-op fees) is **queued**, then `kick()` streams it
  to stakers pro rata over a reward period (7 days by default). A stake placed one block before a deposit
  cannot snipe it.
- `kick()` is permissionless once a period has ended. The owner can also kick mid-period: the leftover rolls
  into the new period.
- **Withdraw is always open**: no pause, no lock-up. The owner has no path to staked tokens or to ETH already
  owed to stakers.
- The staking token is set **after** deployment and can be changed only until the first stake, then it is
  locked forever.
- ETH streamed while nobody is staked goes back to the queue instead of being lost.
- Stakes are credited by what actually arrives (balance delta), not by the amount asked for.

## Run

```bash
git submodule update --init --recursive
cd contracts && forge test
```

## Ops

`ops/01_deploy.sh` (deploy), `ops/02_verify.sh` (Sourcify, Blockscout fallback),
`ops/03_set_token.sh <token>` (set the staking token). Real-chain runs require `MAINNET=yes`; a local fork
is detected by its host. The key is read from outside the repo and never written to it.

## Coming next

Co-op lobbies: 1P deposits ETH, 2P deposits $NIMORI, matched first-in first-out into one Uniswap v4 position,
two seat NFTs, mover rule at exit. See `../docs/nimori-docs.md`.
