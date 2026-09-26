# NIMORI

**Co-op liquidity on Robinhood Chain.**
You bring ETH. We match the token.

---

## 1. Overview

Providing liquidity has always been a solo game. To open a position on a pair, you need both sides: half ETH, half token. Most people only hold one.

NIMORI turns liquidity into a two-player mode.

- **Player 1** deposits ETH.
- **Player 2** deposits the token.
- NIMORI matches them, builds one full position in a NIMORI Uniswap v4 pool on Robinhood Chain, and splits the fees between the two seats.
- At exit, **impermanent loss is carried by the player whose asset moved the most**, as long as the position is worth enough to cover the other side (see 3.6).

Nobody has to sell half their bag to become an LP.

---

## 2. Why co-op

| Solo LP | Co-op LP |
|---|---|
| Needs both assets | One asset per player |
| Swap half your bag to enter | Deposit as is |
| IL shared by the pool, blindly | IL assigned to the side that moved |
| One owner per position | Two seats, each tradable |

For token communities, NIMORI means deeper ETH liquidity without anyone dumping to pair.
For ETH holders, it means earning fees on a pair without buying the token.

---

## 3. How it works

### 3.1 The Lobby

Every supported pair has a lobby with two queues:

- **1P queue**: ETH deposits
- **2P queue**: token deposits

A deposit sits in the lobby until a matching deposit arrives on the other side. While waiting, it earns nothing and can be withdrawn at any time, free.

### 3.2 Difficulty

When joining, each player picks a difficulty. Players are only matched with someone on the same difficulty.

| Difficulty | Range | Fees | Risk |
|---|---|---|---|
| **Easy** | Full range | Lower | Lowest IL |
| **Normal** | Wide range around spot | Medium | Medium IL |
| **Hard** | Narrow range around spot | Highest | Highest IL, can go out of range |

### 3.3 Matching

The matcher pairs deposits FIFO, by value, at the current pool price (TWAP checked against spot to prevent manipulation).

If deposits differ in size, the larger one is partially filled. The remainder stays in the lobby for the next match.

### 3.4 The Session

Once matched, NIMORI:

1. Opens one Uniswap v4 position with both deposits, in a NIMORI pool (see 3.9).
2. Mints two **Seat NFTs** (1P and 2P), each representing one side of the position.
3. Records the entry snapshot: amounts, pool price, ETH/USD and token/USD prices.

This is the **session**. Fees accrue to the position and are split between the two seats.

### 3.5 Fee split

The fee split is fixed at match time and written into both seats.

- Default split: **50 / 50**
- **Seat bonus**: when one queue is much longer than the other, the scarce side gets a bigger share, up to **70 / 30**. This keeps the lobby balanced without emissions.

A protocol fee of **10% of trading fees** is taken before the split (see Section 6).

### 3.6 Unplug (exit)

Either player can unplug at any time after the minimum session length.

At unplug, the position value is split with the **mover rule**:

1. For each asset, compute its USD price change since entry.
2. The **mover** is the asset with the larger absolute change.
3. The **non-mover** receives their hold value: exactly what they deposited, in their own asset.
4. The **mover** receives the rest of the position.
5. Each seat then adds its share of accrued fees.

The non-mover's claim is capped at the total position value, so the mover's claim can never go below zero. **On a full-range position this cap is hit when one asset falls about 75% against the other**: past that point the non-mover takes the whole position and still gets back less than they deposited.

If the position does not hold enough of the non-mover's asset, part of the mover's side is swapped at exit to pay them in their own asset. That swap goes through the pool and pays its price impact, borne by the mover.

### 3.7 Hot swap

When one player unplugs, the position doesn't have to close.

If the lobby has a deposit on the same side and difficulty, the new player takes over the empty seat at current value. The remaining player keeps playing, no unwind, no swap, no slippage.

If nobody is waiting, the position is unwound and both players are paid out.

### 3.8 Rage quit

Unplugging before the minimum session length is a **rage quit**: a penalty of **1% of the seat value** is paid to the partner.

### 3.9 Where positions live

Co-op positions do not sit in launchpad pools. Pools created by Pons route all swap fees to the Pons hook and pay **zero** to LPs, so a position there would earn nothing. Each NIMORI lobby opens its own Uniswap v4 pool on Robinhood Chain, with a swap fee paid to LPs and the NIMORI hook recording the price history used by the matcher and at exit.

---

## 4. Worked example

Starting prices: ETH = $2,000, token = $0.10. Difficulty: Easy (full range).

- **1P** deposits 1 ETH ($2,000).
- **2P** deposits 20,000 tokens ($2,000).
- Position value: $4,000. Fee split: 50 / 50.

### Case A: token doubles, ETH flat

- Position value: $5,656.85
- Hold value: $2,000 + $4,000 = $6,000
- IL: $343.15
- Mover: token (+100% vs 0%)

| Seat | Receives | Hold value | Result |
|---|---|---|---|
| 1P | $2,000 (1 ETH) | $2,000 | Repaid in full |
| 2P | $3,656.85 | $4,000 | +82.8% on entry, carries the IL |

### Case B: token halves, ETH flat

- Position value: $2,828.43
- Hold value: $2,000 + $1,000 = $3,000
- IL: $171.57
- Mover: token (−50% vs 0%)

| Seat | Receives | Hold value |
|---|---|---|
| 1P | $2,000 (1 ETH) | $2,000 |
| 2P | $828.43 | $1,000 |

### Case C: token falls 80%, ETH flat

- Position value: $1,788.85
- Hold value: $2,000 + $400 = $2,400
- Mover: token (−80% vs 0%)
- The position no longer covers 1P's $2,000: the cap applies.

| Seat | Receives | Hold value |
|---|---|---|
| 1P | $1,788.85 (whole position) | $2,000 |
| 2P | $0 | $400 |

Fees are added on top in all cases. The token side carries the volatility risk and is paid for it through the seat bonus when the 2P queue runs short.

---

## 5. Seat NFTs

Each seat is an ERC-721 token.

- Holds the session data: side, difficulty, entry snapshot, fee split.
- **Tradable**: sell your seat on any marketplace, the buyer inherits the session.
- Burned at unplug.

A seat is a save file. You can hand it to someone else mid-game.

---

## 6. $NIMORI

$NIMORI is the protocol token. It launches on **Pons**, the Robinhood Chain launchpad.

- **Protocol fee**: 10% of all trading fees earned by co-op positions is routed to $NIMORI stakers, paid in ETH and in the pair tokens.
- **Priority pass**: staked $NIMORI gives priority in the lobby queue. Stakers get matched first.
- **Pair listing**: $NIMORI stakers vote on which pairs open a lobby.

No snapshot, no pre-launch tier. Advantage comes from playing: staking and depositing.

---

## 7. Parameters

| Parameter | Value |
|---|---|
| Chain | Robinhood Chain (4663) |
| AMM | Uniswap v4, NIMORI pools |
| $NIMORI launch | Pons |
| Minimum session length | 24 hours |
| Rage quit penalty | 1% of seat value, paid to partner |
| Default fee split | 50 / 50 |
| Max seat bonus | 70 / 30 |
| Protocol fee | 10% of trading fees |
| Lobby withdrawal | Free, anytime |
| Price sources | NIMORI hook TWAP for token/ETH, ETH/USD reference feed (to be confirmed on Robinhood Chain) |

Values are initial and can be adjusted by governance.

---

## 8. Architecture

| Contract | Role |
|---|---|
| `Lobby` | Holds unmatched deposits, manages queues per pair and difficulty |
| `Matcher` | Pairs deposits, checks price, opens positions |
| `Session` | Holds the v4 position, tracks fees, applies the mover rule at exit |
| `Seat` | ERC-721 for 1P and 2P seats |
| `Hook` | NIMORI v4 hook: records price history, gates the pool to the Session contract |
| `Oracle` | Reads the hook TWAP and the ETH/USD feed, rejects stale or manipulated prices |
| `Arcade` | $NIMORI staking, protocol fee distribution, priority pass |

---

## 9. Risks

- **Smart contract risk**: code can have bugs. Audit status is published here before deposits open.
- **Mover risk**: if your asset moves more than your partner's, you carry the IL.
- **Cap risk**: if one asset falls about 75% or more against the other on a full-range position, the non-mover's repayment is capped at what the position is worth.
- **Exit swap**: paying the non-mover in their own asset can require a swap at exit, with price impact.
- **Range risk (Hard)**: narrow positions can go out of range and stop earning fees.
- **Oracle risk**: bad price data could misassign IL. Mitigated by TWAP checks and staleness guards.
- **Lobby wait**: if the other queue is empty, your deposit waits unmatched and earns nothing.

---

## 10. Glossary

| Term | Meaning |
|---|---|
| **1P** | The ETH side of a session |
| **2P** | The token side of a session |
| **Lobby** | Where deposits wait to be matched |
| **Session** | An active co-op position |
| **Seat** | NFT representing one side of a session |
| **Difficulty** | Range width of the position |
| **Mover** | The asset with the larger price change since entry |
| **Unplug** | Exit a session |
| **Hot swap** | A new player takes an empty seat without closing the position |
| **Rage quit** | Exit before the minimum session length |
| **Seat bonus** | Extra fee share for the scarce side |

---

## 11. FAQ

**Do I need both assets?**
No. One side only.

**What if nobody matches me?**
Your deposit waits in the lobby. Withdraw anytime, free.

**Can I lose money as the non-mover?**
You get your deposit back as long as the position covers it. On a full-range position, that stops when one asset falls about 75% against the other (see Case C).

**Can I leave early?**
Yes, with a 1% rage quit penalty paid to your partner.

**Can I sell my position?**
Yes. Sell your seat NFT.

---

*waiting for player 2...*
