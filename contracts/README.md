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

## NimoriHook + NimoriLobby: co-op liquidity (built, NOT deployed)

**Pool**: native ETH / $NIMORI, 1% LP fee, tick spacing 200, hook = `NimoriHook`. Pons V2 pools pay zero LP fee,
so co-op positions live in this pool. The Lobby holds every position directly in the PoolManager
(`modifyLiquidity`, salt = session id): no PositionManager.

**`NimoriHook`** (mined address, flags `afterInitialize | beforeSwap`) is a TWAP oracle and nothing else: no fee,
no delta, no donate, no custody, token-agnostic (one independent oracle per pool id). At the first swap of a new
timestamp it credits the tick **before** that swap for the time elapsed, so a price pushed and pulled back inside
one block credits nothing. Ring of 128 entries kept >= 60 s apart (>= 2 h of history however busy the pool),
`consult(poolId, secondsAgo)` returns the exact mean over a window of at least `secondsAgo`.

**`NimoriLobby`** (also the ERC-721 "NIMORI Seat", SEAT):
- Queues per difficulty (Easy full range, Normal ±6000 ticks, Hard ±2000 ticks) and per side, FIFO, doubly linked.
  `deposit1P` (ETH) / `deposit2P` (NIMORI, credited by balance delta), minimums against dust spam,
  `withdrawQueued` any time (paused or not).
- `matchQueue(difficulty, maxPairs)` is permissionless and also runs (2 pairs max) inside each deposit. Liquidity
  from both heads at the current price; what the PoolManager actually took is subtracted; a remainder under the
  minimum is refunded as owed dust (`withdrawOwed`).
- **Price guard on every match and every exit**: |spot − 30-min TWAP| ≤ 200 ticks and |spot − Pons pool| ≤ 600 ticks
  (both owner-tunable within [50, 1000]) on every MATCH, which also needs the live reference pool (an empty co-op
  pool's TWAP is free to drag) plus the TWAP once it has 30 minutes of history.
- **Exit guard**: our own 30-min TWAP only, |spot − TWAP| ≤ 1000 ticks (~10.5%, owner-set within [200, 2000]); the
  Pons pool is not consulted at exit. **Escape hatch**: when the exit guard refuses, a seat owner calls
  `requestUnplug(seatId)` (once per session); 1 hour later either seat holder can `unplug` with no price guard. The
  rage-quit fee still counts from session start to the actual exit. A guard can delay an exit, never lock it.
- `collectFees(sessionId)` (anyone): 10% off the top, ETH to the Arcade, NIMORI to `0x…dEaD`; the rest 50/50.
- `unplug(seatId)`: removes the position, settles both seats in kind with the **mover rule in ratio form**
  (`a >= e0` → 1P gets e0 ETH, else 2P gets n0 NIMORI; the other seat takes the rest). Before 24 h: 1% of the
  leaving seat's settlement goes to the partner. `settle()` is public and pure.
- `claim(seatId)` / `claimTo` by whoever holds the seat (pull). A paid-out seat of a closed session is burned.
- Owner: minimums, deviation bands, Arcade address, reference pool (once), pool init (once), pause new deposits and
  matches. No owner path to queued funds, positions or credits; no arbitrary call. `skim()` can only push surplus
  above recorded liabilities to the Arcade (ETH) or burn it (NIMORI). Ownable2Step, ReentrancyGuard.

Compiled with via-IR (lobby only, `compilation_restrictions` in `foundry.toml`) to fit EIP-170 (21.8 KB).

### Tests

```bash
forge test                                   # unit, fuzz, invariants (fork test skipped)
RH_RPC=<url> forge test --match-contract Fork # end to end on a fork of Robinhood Chain
python3 test/mutation/mutate.py              # mutation testing of oracle, guards and mover rule
ops/rehearse_lobby.sh                        # the real 04/05/06 scripts on an anvil fork, full cycle
```

### Ops (lobby)

`ops/04_deploy_lobby.sh <token> [weth]` mines the hook against the CREATE2 deployer, deploys hook + lobby, reads
everything back from the chain and writes `HOOK`, `LOBBY`, `POOL_ID` into the deployment env.
`ops/05_init_pool.sh <tick> | --sqrt <x96> | --from-pons` opens the pool (once).
`ops/06_set_reference.sh` pins the Pons pool of the token (read from the Pons factory, after graduation), or
`REF_KEY="c0 c1 fee spacing hooks"`.

## Coming next

Hot swap, seat bonus (time-weighted, not instantaneous), more pairs. See `../docs/nimori-docs.md`.
