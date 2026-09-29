#!/usr/bin/env node
/* NIMORI pre-launch draw: verifiable, in three public steps.

   1. snapshot   After registration closes, freeze the entry list:
                   node scripts/draw.js snapshot
                 -> draw/snapshot.json (sorted addresses + sha256). Publish the file and its hash
                    BEFORE the seed block exists, together with the snapshot block and the seed block.

   2. eligible   Apply the anti-farming rule at the announced snapshot block:
                   node scripts/draw.js eligible --snapshot-block 1234567
                 -> draw/eligible.json. Rule: at least 1 transaction sent and some ETH for gas
                    on Robinhood Chain at that block (see ELIGIBILITY in api/_shared.js).

   3. run        Pick the winners from the hash of the announced seed block (a future block when announced):
                   node scripts/draw.js run --seed-block 1234999 --winners 50
                 -> draw/winners.json

   Anyone can re-run steps 2 and 3 from the published snapshot and get the same winners.
   Needs an RPC that serves historical state for step 2 (set RH_RPC to an archive endpoint). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { keccak256, concat, toHex } = require('viem');
const shared = require('../api/_shared');

const OUT = path.join(__dirname, '..', 'draw');
const arg = (name) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : null; };
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const write = (file, obj) => { fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, file), JSON.stringify(obj, null, 2) + '\n'); };
const read = (file) => JSON.parse(fs.readFileSync(path.join(OUT, file), 'utf8'));

async function allEntries() {
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { list } = require('@vercel/blob');
    const out = [];
    let cursor;
    do {
      const page = await list({ prefix: shared.PREFIX, limit: 1000, cursor });
      out.push(...page.blobs.map((b) => b.pathname.slice(shared.PREFIX.length).replace(/\.json$/, '')));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return out;
  }
  const file = process.env.NIMORI_LOCAL_STORE || '/tmp/nimori-draw.json';
  return Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')));
}

// the address list is canonical: lowercase, unique, sorted; its hash is what gets published
const canonical = (addrs) => [...new Set(addrs.map((a) => a.toLowerCase()).filter((a) => /^0x[0-9a-f]{40}$/.test(a)))].sort();
const listHash = (addrs) => sha256(addrs.join('\n'));

async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all([...Array(n)].map(async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

async function main() {
  const cmd = process.argv[2];

  if (cmd === 'snapshot') {
    const addresses = canonical(await allEntries());
    const snap = { takenAt: new Date().toISOString(), count: addresses.length, sha256: listHash(addresses), addresses };
    write('snapshot.json', snap);
    console.log(`snapshot: ${snap.count} entries\nsha256:   ${snap.sha256}\n-> draw/snapshot.json (publish it with this hash)`);
    return;
  }

  if (cmd === 'eligible') {
    const block = Number(arg('snapshot-block'));
    if (!Number.isInteger(block) || block <= 0) throw new Error('--snapshot-block <number> is required');
    const snap = read('snapshot.json');
    if (listHash(snap.addresses) !== snap.sha256) throw new Error('snapshot.json does not match its own sha256');
    const tag = '0x' + block.toString(16);
    const facts = await pool(snap.addresses, 8, (a) => shared.chainFacts(a, tag).catch((e) => ({ error: String(e.message || e) })));
    const failed = facts.filter((f) => f.error);
    if (failed.length) throw new Error(`${failed.length} RPC reads failed (first: ${failed[0].error}). Use an archive RPC in RH_RPC and retry.`);
    const eligible = snap.addresses.filter((_, i) => shared.eligible(facts[i]));
    write('eligible.json', { snapshotSha256: snap.sha256, snapshotBlock: block, rule: shared.ELIGIBILITY, count: eligible.length, sha256: listHash(eligible), addresses: eligible });
    console.log(`eligible at block ${block}: ${eligible.length} / ${snap.addresses.length}\n-> draw/eligible.json`);
    return;
  }

  if (cmd === 'run') {
    const block = Number(arg('seed-block'));
    const winners = Number(arg('winners'));
    if (!Number.isInteger(block) || block <= 0) throw new Error('--seed-block <number> is required');
    if (!Number.isInteger(winners) || winners <= 0) throw new Error('--winners <number> is required');
    const el = read('eligible.json');
    if (listHash(el.addresses) !== el.sha256) throw new Error('eligible.json does not match its own sha256');
    const b = await shared.rpc('eth_getBlockByNumber', ['0x' + block.toString(16), false]);
    if (!b || !b.hash) throw new Error(`block ${block} not found yet`);
    // partial Fisher-Yates driven by keccak256(seedHash || i): same inputs, same winners, for anyone
    const bag = el.addresses.slice();
    const picked = [];
    for (let i = 0; i < Math.min(winners, bag.length); i++) {
      const r = BigInt(keccak256(concat([b.hash, toHex(i, { size: 32 })])));
      const j = i + Number(r % BigInt(bag.length - i));
      [bag[i], bag[j]] = [bag[j], bag[i]];
      picked.push({ rank: i + 1, address: bag[i], ticket: shared.ticketFor(bag[i]).code });
    }
    write('winners.json', { eligibleSha256: el.sha256, seedBlock: block, seedHash: b.hash, winners: picked });
    console.log(`seed block ${block} ${b.hash}\n${picked.length} winners -> draw/winners.json`);
    picked.slice(0, 10).forEach((w) => console.log(`  #${w.rank} ${w.ticket} ${w.address}`));
    return;
  }

  console.log('usage: node scripts/draw.js snapshot | eligible --snapshot-block N | run --seed-block N --winners W');
  process.exitCode = 1;
}

main().catch((e) => { console.error('error:', e.message || e); process.exit(1); });
