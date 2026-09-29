/* Pre-launch draw: everything that decides an entry lives HERE, on the server.
   A ticket the browser could mint by itself would not be a ticket. */
const { keccak256, toBytes } = require('viem');
const fs = require('fs');

const RPC = process.env.RH_RPC || 'https://rpc.mainnet.chain.robinhood.com';
const PREFIX = 'draw/';
const LOCAL_FILE = process.env.NIMORI_LOCAL_STORE || '/tmp/nimori-draw.json';
const useBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

/* The exact bytes the wallet signs. Rebuilt on the server and checked against the signature. */
function entryMessage({ address, issued }) {
  return [
    'NIMORI - pre-launch draw',
    '',
    'address: ' + address.toLowerCase(),
    'issued: ' + issued,
    '',
    'Signing is free and sends nothing. It enters this wallet in the $NIMORI draw: one ticket per wallet.',
  ].join('\n');
}

/* The ticket depends on the address only, so it cannot be re-rolled by signing again. */
function ticketFor(address) {
  const h = keccak256(toBytes('nimori-draw-v1:' + address.toLowerCase()));
  const code = 'NMR-' + h.slice(2, 8).toUpperCase();
  const cart = ['Easy', 'Normal', 'Hard'][parseInt(h.slice(8, 10), 16) % 3]; // cosmetic only, odds are equal
  return { code, cart };
}

/* Anti-farming rule, announced on the draw page and in the README, applied at the snapshot block:
   the wallet must have sent at least one transaction on Robinhood Chain and hold some ETH for gas.
   Creating wallets is free; a real history on the chain is not. */
const ELIGIBILITY = 'At least 1 transaction sent and some ETH for gas on Robinhood Chain, checked at the snapshot block.';
const eligible = (c) => !!c && c.nonce > 0 && BigInt(c.balanceWei || '0') > 0n;

/* Registration closes at DRAW_CLOSES_AT (ISO time) when it is set. */
const closesAt = () => { const t = Date.parse(process.env.DRAW_CLOSES_AT || ''); return Number.isFinite(t) ? t : null; };

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || 'rpc error');
  return j.result;
}
/* Recorded with the entry, never used as a gate: newcomers are exactly who a launch wants. */
async function chainFacts(address, block = 'latest') {
  const [n, b] = await Promise.all([rpc('eth_getTransactionCount', [address, block]), rpc('eth_getBalance', [address, block])]);
  return { nonce: Number(BigInt(n)), balanceWei: BigInt(b).toString() };
}

/* ---------- storage: Vercel Blob in production, a JSON file for local dev ---------- */
const countCache = { n: 0, at: 0 };
function readLocal() { try { return JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8')); } catch { return {}; } }
const store = {
  async get(address) {
    const a = address.toLowerCase();
    if (!useBlob()) return readLocal()[a] || null;
    const { list } = require('@vercel/blob');
    const { blobs } = await list({ prefix: PREFIX + a, limit: 5 });
    if (!blobs.length) return null;
    try { return await (await fetch(blobs[0].url, { cache: 'no-store' })).json(); } catch { return null; }
  },
  async put(record) {
    if (!useBlob()) {
      const all = readLocal(); all[record.address] = record;
      fs.writeFileSync(LOCAL_FILE, JSON.stringify(all, null, 2));
      return;
    }
    const { put } = require('@vercel/blob');
    await put(PREFIX + record.address + '.json', JSON.stringify(record, null, 2), {
      access: 'public', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false,
    });
  },
  // Counting lists every entry, so it is cached per instance for 30 s (and GET responses are CDN-cached):
  // a flood of page views can no longer turn into a flood of storage listings.
  async count() {
    if (countCache.at && Date.now() - countCache.at < 30000) return countCache.n;
    countCache.n = await this.countNow(); countCache.at = Date.now();
    return countCache.n;
  },
  bump() { if (countCache.at) countCache.n += 1; },
  async countNow() {
    if (!useBlob()) return Object.keys(readLocal()).length;
    const { list } = require('@vercel/blob');
    let n = 0, cursor;
    do {
      const page = await list({ prefix: PREFIX, limit: 1000, cursor });
      n += page.blobs.length; cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return n;
  },
};

module.exports = { entryMessage, ticketFor, chainFacts, store, rpc, eligible, ELIGIBILITY, closesAt, PREFIX };
