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
- At exit, **impermanent loss is carried by the player whose asset went up against the other one**; the other player gets back exactly what they put in, counted in their own asset (see 3.6).

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

The matcher pairs deposits FIFO, by value, at the current pool price. Every match and every exit is refused unless the spot price sits within a band of the NIMORI hook's 30-minute TWAP (about 2%) and of the $NIMORI Pons pool (about 6%: the Pons swap tax keeps the two pools a few percent apart). Matching is permissionless and also runs, bounded, inside each deposit.

If deposits differ in size, the larger one is partially filled. The remainder stays in the lobby for the next match.

### 3.4 The Session

Once matched, NIMORI:

1. Opens one Uniswap v4 position with both deposits, in a NIMORI pool (see 3.9).
2. Mints two **Seat NFTs** (1P and 2P), each representing one side of the position.
3. Records the entry snapshot: the range, the liquidity, the ETH put in by 1P (e0) and the token put in by 2P (n0).

This is the **session**. Fees accrue to the position and are split between the two seats.

### 3.5 Fee split

The fee split is fixed at match time and written into both seats.

- Split in v1: **50 / 50**, fixed.
- **Seat bonus: not in v1.** A bonus driven by queue imbalance can be gamed in one transaction (stuff the other queue, match, withdraw). TODO for v2: a bonus measured over time, not at the instant of the match.

A protocol fee of **10% of trading fees** is taken before the split: the ETH part goes to the Arcade (stakers), the $NIMORI part is burned. Fees are collected by anyone with `collectFees`, and credited to the seats.

### 3.6 Unplug (exit)

Either player can unplug at any time. An exit is refused only while the pool price sits more than ~10% from its own 30-minute average; in that case a player can request the exit, and one hour later either player can unplug regardless of price. The whole position is removed and both seats are settled **in kind**, with the **mover rule in ratio form** (no USD price, no oracle):

- At entry the position took **e0 ETH** from 1P and **n0 $NIMORI** from 2P. At exit it returns **a ETH** and **b $NIMORI**.
- If **a ≥ e0**, $NIMORI rose against ETH: 2P is the mover. **1P gets exactly e0 ETH back**, 2P gets the rest (a − e0 ETH and all b $NIMORI).
- Otherwise ETH rose against $NIMORI: 1P is the mover. **2P gets exactly n0 $NIMORI back**, 1P gets the rest (all a ETH and b − n0 $NIMORI).
- Each seat also gets its fee share.

Both branches only split what came out of the position, so a settlement can never pay more than the position holds. Along a Uniswap position the ETH leg and the token leg always move in opposite directions, so exactly one side can be repaid in full: the other side carries the impermanent loss. Nobody is paid in an asset they did not hold through a swap at exit.

Settlements and fees are **pulled**: each seat's owner calls `claim`. Seats are transferable, and whoever holds the seat claims.

### 3.7 Hot swap

**Not in v1.** Handing a seat to a new player at current value needs a valuation at that moment, which reopens the oracle risk the ratio rule removes. A seat can still be sold as an NFT.

### 3.8 Rage quit

Unplugging before 24 hours is a **rage quit**: **1% of the leaving seat's settlement** (in kind) is paid to the partner seat. From 24 hours on there is no penalty.

### 3.9 Where positions live

Co-op positions do not sit in launchpad pools. Pools created by Pons route all swap fees to the Pons hook and pay **zero** to LPs, so a position there would earn nothing. Each NIMORI lobby opens its own Uniswap v4 pool on Robinhood Chain, with a swap fee paid to LPs and the NIMORI hook recording the price history used by the matcher and at exit.

---

## 4. Worked example

Starting prices: ETH = $2,000, token = $0.10, so 20,000 tokens per ETH. Difficulty: Easy (full range).

- **1P** deposits 1 ETH ($2,000).
- **2P** deposits 20,000 tokens ($2,000).
- Position value: $4,000. Fee split: 50 / 50.

### Case A: token doubles, ETH flat (10,000 tokens per ETH)

The position now holds 1.4142 ETH and 14,142 tokens ($5,656.85). It holds more ETH than 1P put in, so the token is the mover.

| Seat | Receives | Value | Hold value |
|---|---|---|---|
| 1P | 1 ETH | $2,000 | $2,000 |
| 2P | 0.4142 ETH + 14,142 tokens | $3,656.85 | $4,000 |

### Case B: token halves, ETH flat (40,000 tokens per ETH)

The position now holds 0.7071 ETH and 28,284 tokens ($2,828.43). It holds more tokens than 2P put in, so ETH (against the token) is the mover.

| Seat | Receives | Value | Hold value |
|---|---|---|---|
| 1P | 0.7071 ETH + 8,284 tokens | $1,828.43 | $2,000 |
| 2P | 20,000 tokens | $1,000 | $1,000 |

### Case C: token falls 80%, ETH flat (100,000 tokens per ETH)

The position holds 0.4472 ETH and 44,721 tokens ($1,788.85).

| Seat | Receives | Value | Hold value |
|---|---|---|---|
| 1P | 0.4472 ETH + 24,721 tokens | $1,388.85 | $2,000 |
| 2P | 20,000 tokens | $400 | $400 |

The rule always pays out exactly what the position holds, so there is no cap and no exit swap. Fees are added on top in all cases.

---

## 5. Seat NFTs

Each seat is an ERC-721 token.

- Points to its session: side (even id = 1P, odd id = 2P), difficulty, range, e0 and n0.
- **Tradable**: sell your seat on any marketplace, the buyer inherits the session.
- Claims its fees while the session runs; after unplug, claims its settlement, and is burned once paid out.

A seat is a save file. You can hand it to someone else mid-game.

---

## 6. $NIMORI

$NIMORI is the protocol token. It launches on **Pons**, the Robinhood Chain launchpad.

- **Protocol fee**: 10% of all trading fees earned by co-op positions: the ETH part is streamed to $NIMORI stakers by the Arcade, the $NIMORI part is burned.
- **Priority pass** (not in v1): staked $NIMORI gives priority in the lobby queue.
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
| Rage quit penalty | 1% of the leaving seat's settlement, paid to partner |
| Fee split | 50 / 50 (v1) |
| Seat bonus | none in v1 |
| Protocol fee | 10% of trading fees |
| Lobby withdrawal | Free, anytime |
| Price guards | spot within ~2% of the hook's 30-min TWAP and ~6% of the Pons pool; no USD feed |
| Pool | native ETH / $NIMORI, 1% LP fee, tick spacing 200 |
| Ranges | Easy full range, Normal ±6,000 ticks, Hard ±2,000 ticks |

Values are initial and can be adjusted by governance.

---

## 8. Architecture

**v1 as built** (`contracts/`): `NimoriHook` (TWAP oracle, no fees, no custody) and `NimoriLobby` (queues, matching, positions held directly in the PoolManager, Seat NFTs, mover rule, claims). The table below is the original plan.

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
- **Mover risk is large for the mover**: the non-mover is repaid in full in its own asset, so the mover carries all of the impermanent loss, and on a narrow range (Hard) that can be most of its deposit.
- **Guard delays**: matches wait while the spot price is outside the guard bands. An exit only checks the pool's own 30-minute average (~10% band); if that refuses, either player can request an exit and, one hour later, leave without any price check.
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
Yes, with a 1% rage quit penalty paid to your partner (before 24 hours).

**Can I sell my position?**
Yes. Sell your seat NFT.

---

*waiting for player 2...*
