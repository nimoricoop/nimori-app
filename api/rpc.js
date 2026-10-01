/* POST /api/rpc  JSON-RPC proxy to Robinhood Chain, READ-ONLY.
   The public RPC sits behind a Cloudflare challenge that browsers' fetch cannot pass, so the page reads
   through here. Only read methods are forwarded; transactions are always signed and sent by the user's wallet. */
const ALLOWED = new Set(['eth_call', 'eth_chainId', 'eth_blockNumber', 'eth_getBalance', 'eth_getTransactionReceipt']);
const UPSTREAM = process.env.RH_RPC || 'https://rpc.mainnet.chain.robinhood.com';

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const body = req.body;
  const calls = Array.isArray(body) ? body : [body];
  if (!calls.length || calls.length > 20) return res.status(400).json({ error: '1 to 20 calls' });
  for (const c of calls) {
    if (!c || !ALLOWED.has(c.method)) return res.status(400).json({ error: 'method not allowed' });
  }
  try {
    const r = await fetch(UPSTREAM, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    return res.status(200).json(j);
  } catch {
    return res.status(502).json({ error: 'upstream unavailable' });
  }
};
