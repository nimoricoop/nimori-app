# Liquidity Needs a Player 2

You bring ETH. Player 2 brings the token. NIMORI turns liquidity into a co-op game on Robinhood Chain.

[IMAGE: 01-header.png]

## Stop playing both sides

Providing liquidity has always been a solo game. To open a position on a pair you need both sides, half ETH and half token. Most people only hold one.

So you sell half your bag just to press start.

NIMORI makes it a two-player mode. An ETH holder and a token holder get matched, and their deposits go into one shared position. Nobody has to sell anything to become an LP.

First, the status check. NIMORI is pre-launch. The protocol contracts are not deployed yet, so no deposit is possible today. Lobbies and staking open at launch. The only live feature right now is the $NIMORI pre-launch draw.

## Pick a side. Wait for player 2.

At launch, every supported pair gets a lobby with two queues. Player 1 deposits ETH. Player 2 deposits the token.

Each player also picks a difficulty, and you only match with someone on the same one. Easy is full range, lowest impermanent loss. Normal is a wide range around spot. Hard is a narrow range: the most fees, the most IL, and it can go out of range.

Deposits are matched first in, first out. While you wait, your deposit earns nothing, and you can withdraw it anytime, for free.

When the match lands, NIMORI opens one Uniswap v4 position with both deposits and mints two Seat NFTs, one per side.

[IMAGE: 02-how-it-works.png]

## Seats are save files

Each seat is an ERC-721. It holds your side, your difficulty, the entry snapshot and your fee split.

It is tradable. Sell your seat mid-game and the buyer inherits the session.

## The mover rule

Shared positions need a fair way to split impermanent loss. NIMORI uses the mover rule.

At exit, NIMORI compares each asset's USD move since entry. The asset that moved more is the mover.

The non-mover gets their deposit back, in their own asset, as long as the position covers it. The mover gets the rest. Each seat then adds its share of fees.

That condition matters. The rule decides who carries the loss, it does not create value the position no longer has. On a full-range position, the non-mover stops being repaid in full once one asset falls about 75% against the other.

## Run the numbers

Worked example: 1 ETH at $2,000 plus 20,000 NIMORI at $0.10. Full range, ETH flat, before fees. The token is the mover in every case.

- Token x2: position $5,656.85. 1P gets $2,000. 2P gets $3,656.85.
- Token -50%: position $2,828.43. 1P gets $2,000. 2P gets $828.43.
- Token -80%: position $1,788.85. The cap applies: 1P gets $1,788.85, 2P gets $0.

The last line is the boundary. The whole position is worth less than 1P's deposit, so 1P takes all of it and still gets back less than they put in.

Co-op changes how a position's value is split between two players. It does not remove market risk.

[IMAGE: 03-mover-rule.png]

## Fees, rage quits and hot swaps

10% of trading fees goes to $NIMORI stakers in the Arcade. The rest is split between the two seats, 50/50 by default.

When one queue is much longer than the other, the scarce side earns a seat bonus, up to 70/30. That keeps the lobby balanced without emissions.

Sessions have a 24 h minimum. Unplug before that and it is a rage quit: 1% of your seat value goes to your partner.

When you unplug after 24 h, the position does not have to close. If someone is waiting on your side at the same difficulty, they hot swap into your seat. Your partner keeps playing, no unwind. If nobody is waiting, the position unwinds and both players are paid out.

## Why not a Pons pool?

$NIMORI launches on Pons, the Robinhood Chain launchpad.

But Pons pools route all swap fees to the Pons hook and pay zero to LPs. A co-op position there would earn nothing.

So every NIMORI lobby opens its own Uniswap v4 pool on Robinhood Chain, with swap fees paid to LPs and a NIMORI hook recording the price history used for matching and exits.

## The live part: the $NIMORI draw

The draw is open now, and it takes a minute:

1. Connect any EVM wallet.
2. Plug in with one free signature. No transaction, no approval, nothing leaves your wallet.
3. Get your ticket, NMR-XXXXXX. One wallet, one ticket. Signing again never re-rolls it.
4. Share it on X.

Anti-farming: at the snapshot block, a wallet needs at least 1 transaction sent and some ETH for gas on Robinhood Chain. Fresh empty wallets do not count. The app shows whether your wallet is eligible right now.

The draw is verifiable. The entry list is frozen and published with its SHA-256 before the seed block exists. Winners come from an announced Robinhood Chain block hash, using the open-source scripts/draw.js. Anyone can re-run it and get the same winners, the team included.

Winners receive a $NIMORI airdrop after launch. The amount and the number of winners are announced before the draw.

Stay safe: the draw never asks for a transaction, an approval or a seed phrase, and the team never DMs first.

## Press start

The console is on. Port 1 is taken.

waiting for player 2 ▮▮▮▯▯

Plug in and get your ticket at playnimori.com
