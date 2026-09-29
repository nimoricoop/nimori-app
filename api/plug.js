/* GET  /api/plug                -> { players }            (real count of stored entries)
   GET  /api/plug?address=0x..   -> { entry | null, players }
   POST /api/plug {address, issued, signature} -> { ok, ticket, players }
   One entry per wallet. The signature is checked BEFORE anything touches the RPC or the store. */
const { verifyMessage } = require('viem');
const { entryMessage, ticketFor, chainFacts, store, eligible, ELIGIBILITY, closesAt } = require('./_shared');

const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || '');
// `eligibleNow` is a hint from the chain at entry time; the rule is applied again at the snapshot block
const pub = (r) => r && { address: r.address, ticket: r.ticket, enteredAt: r.enteredAt, eligibleNow: eligible(r.chain) };
const meta = () => ({ rule: ELIGIBILITY, closesAt: closesAt() ? new Date(closesAt()).toISOString() : null });

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://x');
      const address = url.searchParams.get('address');
      const players = await store.count().catch(() => null);
      if (!address) {
        res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
        return res.status(200).json({ players, ...meta() });
      }
      if (!isAddr(address)) return res.status(400).json({ error: 'bad address' });
      const entry = await store.get(address);
      if (entry && !entry.chain) { try { entry.chain = await chainFacts(address); } catch { /* keep null */ } }
      return res.status(200).json({ entry: pub(entry), players, ...meta() });
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST only' });

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad json' }); } }
    const { address, issued, signature } = body || {};
    if (closesAt() && Date.now() > closesAt()) return res.status(403).json({ error: 'registration is closed' });
    if (!isAddr(address)) return res.status(400).json({ error: 'bad address' });
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature || '')) return res.status(400).json({ error: 'bad signature' });
    const t = Date.parse(issued || '');
    if (!Number.isFinite(t) || Math.abs(Date.now() - t) > 30 * 60 * 1000) return res.status(400).json({ error: 'this signature is too old, sign again' });

    let valid = false;
    try { valid = await verifyMessage({ address, message: entryMessage({ address, issued }), signature }); } catch { valid = false; }
    if (!valid) return res.status(400).json({ error: 'the signature does not match this wallet' });

    const existing = await store.get(address);
    if (existing) return res.status(200).json({ ok: true, already: true, ...pub(existing), players: await store.count().catch(() => null) });

    let chain = null;
    try { chain = await chainFacts(address); } catch { chain = null; }
    const record = {
      address: address.toLowerCase(),
      ticket: ticketFor(address),
      enteredAt: new Date().toISOString(),
      issued, signature, chain,
    };
    await store.put(record);
    store.bump();
    return res.status(200).json({ ok: true, ...pub(record), players: await store.count().catch(() => null), ...meta() });
  } catch (e) {
    return res.status(500).json({ error: 'the entry could not be stored: ' + String((e && e.message) || e) });
  }
};
