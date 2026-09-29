# Security

## Scope

NIMORI is **pre-launch**. No protocol contract is deployed. The only live component is the pre-launch draw:

- the site at <https://playnimori.com>
- the draw API (`api/plug.js`) that verifies a wallet signature and stores one ticket per address

## What the draw will never do

- ask for a transaction, a token approval, a seed phrase or a private key
- send you a DM first
- ask you to sign anything other than the plain-text message shown in your wallet:

```
NIMORI - pre-launch draw

address: 0x…
issued: <ISO time>

Signing is free and sends nothing. It enters this wallet in the $NIMORI draw: one ticket per wallet.
```

If a site or account asks for more than this, it is not us.

## Draw integrity

- One ticket per wallet, derived from the address; the signature is verified server-side.
- Eligibility at the snapshot block: at least 1 transaction and some ETH for gas on Robinhood Chain.
- The entry list is published with its SHA-256 before the seed block; `scripts/draw.js` reproduces the winners.
- `/api/plug` is rate-limited per IP and the player count is cached.

## Reporting a vulnerability

Please report privately by DM to [@nimoricoop](https://x.com/nimoricoop) on X, or with a GitHub private security advisory on this repository. Do not open a public issue for security problems.

Include what you found, how to reproduce it, and the impact. We will acknowledge within 72 hours.
