# NIMORI

**Co-op liquidity on Ethereum.**
You bring ETH. We match the token.

---

## 1. Overview

Providing liquidity has always been a solo game. To open a position on a pair, you need both sides: half ETH, half token. Most people only hold one.

NIMORI turns liquidity into a two-player mode.

- **Player 1** deposits ETH.
- **Player 2** deposits the token.
- NIMORI matches them, builds one full position on Uniswap v4, and splits the fees between the two seats.
- At exit, **impermanent loss is carried by the player whose asset moved the most.**

Nobody has to sell half their bag to become an LP. Nobody pays for a move they didn't make.

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

1. Opens one Uniswap v4 position with both deposits.
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

The non-mover's claim is capped at the total position value, so the mover's claim can never go below zero.

### 3.7 Hot swap

When one player unplugs, the position doesn't have to close.

If the lobby has a deposit on the same side and difficulty, the new player takes over the empty seat at current value. The remaining player keeps playing, no unwind, no swap, no slippage.

If nobody is waiting, the position is unwound and both players are paid out.

### 3.8 Rage quit

Unplugging before the minimum session length is a **rage quit**: a penalty of **1% of the seat value** is paid to the partner.

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
| 1P | $2,000 (1 ETH) | $2,000 | Protected |
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

Fees are added on top in both cases. The token side carries the volatility risk and is paid for it through the seat bonus when the 2P queue runs short.

---

## 5. Seat NFTs

Each seat is an ERC-721 token.

- Holds the session data: side, difficulty, entry snapshot, fee split.
- **Tradable**: sell your seat on any marketplace, the buyer inherits the session.
- Burned at unplug.

A seat is a save file. You can hand it to someone else mid-game.

---

## 6. $NIMORI

$NIMORI is the protocol token.

- **Protocol fee**: 10% of all trading fees earned by co-op positions is routed to $NIMORI stakers, paid in ETH and in the pair tokens.
- **Priority pass**: staked $NIMORI gives priority in the lobby queue. Stakers get matched first.
- **Pair listing**: $NIMORI stakers vote on which pairs open a lobby.

No snapshot, no pre-launch tier. Advantage comes from playing: staking and depositing.

---

## 7. Parameters

| Parameter | Value |
|---|---|
| Chain | Ethereum mainnet |
| AMM | Uniswap v4 |
| Minimum session length | 24 hours |
| Rage quit penalty | 1% of seat value, paid to partner |
| Default fee split | 50 / 50 |
| Max seat bonus | 70 / 30 |
| Protocol fee | 10% of trading fees |
| Lobby withdrawal | Free, anytime |
| Price sources | Chainlink ETH/USD, pool TWAP for token/ETH |

Values are initial and can be adjusted by governance.

---

## 8. Architecture

| Contract | Role |
|---|---|
| `Lobby` | Holds unmatched deposits, manages queues per pair and difficulty |
| `Matcher` | Pairs deposits, checks price, opens positions |
| `Session` | Holds the v4 position, tracks fees, applies the mover rule at exit |
| `Seat` | ERC-721 for 1P and 2P seats |
| `Oracle` | Reads Chainlink and TWAP, rejects stale or manipulated prices |
| `Arcade` | $NIMORI staking, protocol fee distribution, priority pass |

---

## 9. Risks

- **Smart contract risk**: code can have bugs. Audits will be published before launch.
- **Mover risk**: if your asset moves more than your partner's, you carry the IL.
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
You get your deposit back as long as the position covers it. In extreme cases the cap applies.

**Can I leave early?**
Yes, with a 1% rage quit penalty paid to your partner.

**Can I sell my position?**
Yes. Sell your seat NFT.

---

*waiting for player 2...*
