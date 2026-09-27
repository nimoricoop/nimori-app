// Wallet connection without a library: EIP-6963 discovery (every installed wallet announces itself),
// with window.ethereum as a fallback. Only two calls are ever made: eth_requestAccounts and personal_sign.
const found = new Map(); // rdns -> { info, provider }
window.addEventListener('eip6963:announceProvider', (e) => {
  const d = e.detail;
  if (d?.info?.rdns && d.provider) found.set(d.info.rdns, d);
});
window.dispatchEvent(new Event('eip6963:requestProvider'));

let current = null; // { provider, address, name }
const listeners = new Set();
const emit = () => listeners.forEach((f) => f(current));

export function wallets() {
  const list = [...found.values()].map((d) => ({ id: d.info.rdns, name: d.info.name, icon: d.info.icon, provider: d.provider }));
  if (!list.length && window.ethereum) list.push({ id: 'injected', name: 'Browser wallet', icon: '', provider: window.ethereum });
  return list;
}
export const account = () => current;
export const onChange = (f) => { listeners.add(f); return () => listeners.delete(f); };

export async function connect(w) {
  const accs = await w.provider.request({ method: 'eth_requestAccounts' });
  if (!accs || !accs[0]) throw new Error('No account returned by the wallet.');
  current = { provider: w.provider, address: accs[0], name: w.name };
  w.provider.on?.('accountsChanged', (a) => { current = a && a[0] ? { ...current, address: a[0] } : null; emit(); });
  emit();
  return current;
}
export function disconnect() { current = null; emit(); }

export async function sign(message) {
  if (!current) throw new Error('Connect a wallet first.');
  // personal_sign takes the message as hex; UTF-8 encode it so every wallet shows the same readable text
  const hex = '0x' + [...new TextEncoder().encode(message)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return current.provider.request({ method: 'personal_sign', params: [hex, current.address] });
}
export const short = (a) => a ? a.slice(0, 6) + '…' + a.slice(-4) : '';
