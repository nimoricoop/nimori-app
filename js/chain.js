// Robinhood Chain reads and writes without a library.
// Reads go through our own /api/rpc proxy (the public RPC sits behind a Cloudflare challenge).
// Writes go through the connected wallet (eth_sendTransaction), after switching it to chain 4663.
export const CHAIN_ID = 4663;
export const ARCADE = '0x3341b6130eB70A39e2304Cf5eCB6B1fd533dA959';
export const EXPLORER = 'https://robinhoodchain.blockscout.com';
const ZERO = '0x0000000000000000000000000000000000000000';

const SEL = {
  stakingToken: '0x72f702f3', totalSupply: '0x18160ddd', queuedRewards: '0x63d38c3b', periodFinish: '0xebe2b12b',
  remainingInPeriod: '0xb5b80f12', rewardRateScaled: '0x8ba732dc', rewardsDuration: '0x386a9525',
  balanceOf: '0x70a08231', earned: '0x008cc262', allowance: '0xdd62ed3e', decimals: '0x313ce567',
  approve: '0x095ea7b3', stake: '0xa694fc3a', withdraw: '0x2e1a7d4d', claim: '0x4e71d92d', exit: '0xe9fad8ee', kick: '0x7a67b479',
};
const word = (v) => BigInt(v).toString(16).padStart(64, '0');
const addrWord = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const data = (sel, ...args) => sel + args.map((a) => (typeof a === 'string' && a.startsWith('0x') && a.length === 42 ? addrWord(a) : word(a))).join('');

let rpcId = 0;
async function rpc(method, params) {
  const r = await fetch('/api/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error?.message || j.error || 'RPC error');
  return j.result;
}
const call = (to, d) => rpc('eth_call', [{ to, data: d }, 'latest']);
const uint = async (to, d) => BigInt(await call(to, d));
const addr = async (to, d) => '0x' + (await call(to, d)).slice(-40);

// Everything the Arcade page shows, read off the chain. `user` is optional.
export async function arcadeState(user) {
  const [token, staked, queued, finish, remaining, rate, duration] = await Promise.all([
    addr(ARCADE, SEL.stakingToken), uint(ARCADE, SEL.totalSupply), uint(ARCADE, SEL.queuedRewards),
    uint(ARCADE, SEL.periodFinish), uint(ARCADE, SEL.remainingInPeriod), uint(ARCADE, SEL.rewardRateScaled),
    uint(ARCADE, SEL.rewardsDuration),
  ]);
  const s = { token: token === ZERO ? null : token, staked, queued, finish: Number(finish), remaining, rate, duration: Number(duration), decimals: 18, user: null };
  if (s.token) s.decimals = Number(await uint(s.token, SEL.decimals));
  if (user) {
    const [mine, earned] = await Promise.all([uint(ARCADE, data(SEL.balanceOf, user)), uint(ARCADE, data(SEL.earned, user))]);
    s.user = { mine, earned, wallet: 0n, allowance: 0n };
    if (s.token) {
      [s.user.wallet, s.user.allowance] = await Promise.all([uint(s.token, data(SEL.balanceOf, user)), uint(s.token, data(SEL.allowance, user, ARCADE))]);
    }
  }
  return s;
}

// ---------- writes ----------
async function ensureChain(provider) {
  const hex = '0x' + CHAIN_ID.toString(16);
  if ((await provider.request({ method: 'eth_chainId' })) === hex) return;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hex }] });
  } catch (e) {
    if (e?.code !== 4902) throw e;
    await provider.request({ method: 'wallet_addEthereumChain', params: [{
      chainId: hex, chainName: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'], blockExplorerUrls: [EXPLORER],
    }] });
  }
}
async function send(acc, to, d) {
  await ensureChain(acc.provider);
  const hash = await acc.provider.request({ method: 'eth_sendTransaction', params: [{ from: acc.address, to, data: d }] });
  // wait for the receipt through our proxy, so the page reloads real state, not an optimistic guess
  for (let i = 0; i < 90; i++) {
    const r = await rpc('eth_getTransactionReceipt', [hash]).catch(() => null);
    if (r) { if (r.status !== '0x1') throw new Error('Transaction reverted'); return hash; }
    await new Promise((res) => setTimeout(res, 1500));
  }
  return hash; // sent but not seen yet: the page refresh will catch up
}
export const tx = {
  approve: (acc, token, amount) => send(acc, token, data(SEL.approve, ARCADE, amount)),
  stake: (acc, amount) => send(acc, ARCADE, data(SEL.stake, amount)),
  withdraw: (acc, amount) => send(acc, ARCADE, data(SEL.withdraw, amount)),
  claim: (acc) => send(acc, ARCADE, SEL.claim),
  exit: (acc) => send(acc, ARCADE, SEL.exit),
  kick: (acc) => send(acc, ARCADE, SEL.kick),
};

// ---------- amounts ----------
export function units(str, decimals) {
  const s = String(str).trim().replace(/,/g, '');
  if (!/^\d*(\.\d*)?$/.test(s) || s === '' || s === '.') throw new Error('Enter a number.');
  const [i, f = ''] = s.split('.');
  return BigInt(i || '0') * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0');
}
export function fmtUnits(v, decimals, shown = 4) {
  const base = 10n ** BigInt(decimals);
  const i = v / base;
  let f = (v % base).toString().padStart(decimals, '0').slice(0, shown).replace(/0+$/, '');
  return i.toLocaleString('en-US') + (f ? '.' + f : '');
}
