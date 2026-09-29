// NIMORI — app shell + hash router.
// The router rewrites the side panel (Lobby) or the page laid over the console screen. The 3D console (#stage) is mounted once.
// Pre-launch: no contract is live, so nothing here shows a number that is not real. The draw is the only live feature.
import { createScene } from './scene.js';
import { sfx, playedJustNow, isMuted, setMuted } from './sound.js';
import * as W from './wallet.js';
import { figMatch, figDifficulty, figTimeline, figPayouts, figHotSwap, figFees } from './figs.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

// ---------- icons (inline, stroke = currentColor) ----------
const I = {
  pad: '<svg viewBox="0 0 24 24"><path d="M6 11h4M8 9v4M15 12h.01M18 10h.01M17.3 5H6.7a4 4 0 0 0-3.96 3.46l-.74 5.3A3 3 0 0 0 7.1 16.6l1.4-1.6h7l1.4 1.6a3 3 0 0 0 5.1-2.84l-.74-5.3A4 4 0 0 0 17.3 5z"/></svg>',
  eth: '<svg viewBox="0 0 24 24"><path d="M12 2 5 12l7 4 7-4z"/><path d="m5 13.5 7 8.5 7-8.5-7 4z"/></svg>',
  coin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  plug: '<svg viewBox="0 0 24 24"><path d="M9 2v6M15 2v6M6 8h12v3a6 6 0 0 1-12 0zM12 17v5"/></svg>',
  split: '<svg viewBox="0 0 24 24"><path d="M12 3v18M5 8h4M5 16h4M15 8h4M15 16h4"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>',
  vote: '<svg viewBox="0 0 24 24"><path d="M9 12l2 2 4-4"/><rect x="3" y="4" width="18" height="16" rx="3"/></svg>',
  bolt: '<svg viewBox="0 0 24 24"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
  wallet: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M16 14h2"/></svg>',
  range: '<svg viewBox="0 0 24 24"><path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/></svg>',
  ticket: '<svg viewBox="0 0 24 24"><path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4z"/><path d="M9 6v12" stroke-dasharray="2 2"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M4 4l16 16M20 4 4 20"/></svg>',
  exit: '<svg viewBox="0 0 24 24"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l-5-5 5-5M5 12h11"/></svg>',
};

// ---------- state (pre-launch: no simulated queues, prices or balances) ----------
// `plugged` = this browser's wallet is entered in the draw: the second cable goes in for real.
const state = { difficulty: 'normal', plugged: false };
const DIFF = {
  easy: { label: 'Easy', range: [1, 1, 1, 1, 1], note: 'Full range. Lower fees, lowest IL.' },
  normal: { label: 'Normal', range: [0, 1, 1, 1, 0], note: 'Wide range around spot. Medium fees, medium IL.' },
  hard: { label: 'Hard', range: [0, 0, 1, 0, 0], note: 'Narrow range. Highest fees, can go out of range.' },
};
const rangeViz = (d) => `<span class="rangeviz" aria-hidden="true">${DIFF[d].range.map((o) => `<i class="${o ? 'on' : ''}"></i>`).join('')}</span>`;
// ---------- scene (created once) ----------
let scene = null;
const crtEl = document.createElement('div');
crtEl.className = 'crt';
crtEl.innerHTML = '<div class="crt-body clean" data-crt-body tabindex="-1"></div>';
$('#stage').appendChild(crtEl);
try {
  scene = createScene($('#stage'), crtEl, { onBootStart: () => sfx('boot') });
  window.__nimoriScene = scene;
} catch (err) {
  console.warn('WebGL unavailable, showing the flat card instead.', err);
}

// ---------- toast + modal ----------
function toast(msg, kind = '') {
  if (kind === 'error') sfx('error');
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2800);
}
let lastFocus = null;
function openModal({ icon = I.info, tone = '', title, explain = '', rows = [], note = '', body = '', cancel = 'Cancel', confirm = null, onConfirm = null }) {
  lastFocus = document.activeElement;
  // retro arcade dialog: RPG window, pixel title, dotted rows, pixel buttons
  $('#modalCard').innerHTML = `
    <div class="md-head"><span class="md-ico">${icon}</span><h2 id="modalTitle">${String(title).toUpperCase()}</h2></div>
    ${explain ? `<p class="explain">${explain}</p>` : ''}
    ${rows.length ? `<div class="summary">${rows.map(([k, v]) => `<div class="gm-kv"><span>${k}</span><i></i><b>${v}</b></div>`).join('')}</div>` : ''}
    ${body}
    ${note ? `<p class="md-note">! ${note}</p>` : ''}
    <div class="row2 ${confirm ? '' : 'single'}">
      <button class="gb" type="button" data-close>${String(cancel).toUpperCase()}</button>
      ${confirm ? `<button class="gb go" type="button" data-confirm>▶ ${String(confirm).toUpperCase()}</button>` : ''}
    </div>
`;
  $('#modal').hidden = false;
  sfx('open');
  $('[data-close]', $('#modalCard')).addEventListener('click', closeModal);
  const ok = $('[data-confirm]', $('#modalCard'));
  if (ok) ok.addEventListener('click', () => { closeModal(); onConfirm?.(); });
  (ok || $('[data-close]', $('#modalCard'))).focus();
}
function closeModal() {
  if ($('#modal').hidden) return;
  $('#modal').hidden = true;
  lastFocus?.focus?.();
}
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') { sfx('back'); closeModal(); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').hidden) { sfx('back'); closeModal(); } });

// ---------- pages ----------
function lobby() {
  const e = DRAW.entry;
  return `
    <a class="draw-banner" href="#/draw"><span>PRE-LAUNCH</span><b>${e ? 'You are plugged in. Ticket ' + e.ticket.code : 'Plug in your wallet, get a ticket for the $NIMORI draw'}</b><i>→</i></a>
    <p class="eyebrow">Lobby · NIMORI / ETH</p>
    <h1>${e ? 'Player 2 connected.' : 'Waiting for player 2.'}</h1>
    <p class="lede">Player 1 brings ETH, player 2 brings the token. NIMORI matches them into one position with two seats. Lobbies open at launch.</p>

    <div class="pairbar">
      <span class="pair"><span class="coin eth">Ξ</span><span class="coin">N</span>NIMORI / ETH</span>
      <span class="muted">First lobby. More open by Arcade vote.</span>
    </div>

    <h2>Difficulty</h2>
    <div class="seg" role="group" aria-label="Difficulty">
      ${Object.entries(DIFF).map(([k, v]) => `<button type="button" data-diff="${k}" aria-pressed="${k === state.difficulty}">${v.label}</button>`).join('')}
    </div>
    <div class="seg-note">${rangeViz(state.difficulty)}<span>${DIFF[state.difficulty].note} Shown on the console's RANGE strip.</span></div>

    <div class="queues">
      <div class="queue">
        <div class="queue-h"><b>1P</b><span>ETH queue · ${DIFF[state.difficulty].label}</span></div>
        <ol><li class="empty"><span>opens at launch</span><span>—</span></li></ol>
      </div>
      <div class="queue">
        <div class="queue-h"><b>2P</b><span>NIMORI queue</span></div>
        <ol><li class="empty"><span>opens at launch</span><span>—</span></li></ol>
      </div>
    </div>
    <p class="muted" style="margin-top:8px">At launch: deposits are matched FIFO by value, same difficulty only. Unmatched deposits can be withdrawn anytime, free.</p>

    <div class="status ${e ? 'ok' : ''}">
      <span class="dot"></span>
      <span>${e ? 'plugged in · ticket ' + e.ticket.code : 'port 2 empty · waiting for player 2 ▮▮▮▯▯'}</span>
    </div>
    <button class="btn btn-block" type="button" data-go="draw">${e ? 'See my ticket' : 'Plug in to the draw'}</button>

    <p class="risk"><b>Who carries what.</b> The side whose asset moved more carries the IL. If the token moves more, 2P carries it, and 1P gets their ETH back <b>as long as the position covers it</b>. Past roughly −75% on the token, the cap applies and 1P gets less.</p>
  `;
}

// ---------- retro game menu (used by every page drawn on the console screen) ----------
// Left: a menu list with a blinking cursor. Right: a dialog window for the selected entry.
// Arrow keys move, Enter selects, mouse works too. An entry with `action` runs it when chosen again or on Enter.
const MENU_SEL = { arcade: 0, docs: 0, draw: 0 };
const MENUS = {};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dots = (k, v) => `<div class="gm-kv"><span>${k}</span><i></i><b>${v}</b></div>`;
const gbtn = (label, attrs = '', kind = '') => `<button type="button" class="gb ${kind}" ${attrs}>${label}</button>`;

function gameMenu(route, { title, status = '', items }) {
  MENUS[route] = items;
  let sel = Math.min(MENU_SEL[route] || 0, items.length - 1);
  if (items[sel]?.disabled) sel = Math.max(0, items.findIndex((it) => !it.disabled));
  MENU_SEL[route] = sel;
  const it = items[sel];
  return `
    <div class="gm" data-gm="${route}">
      <div class="gm-head"><span class="gm-title">${title}</span><span class="gm-status">${status}</span></div>
      <div class="gm-body">
        <ul class="gm-menu" role="menu" aria-label="${esc(title)} menu">
          ${items.map((m, i) => `<li><button type="button" role="menuitem" class="gm-item ${i === sel ? 'sel' : ''}" data-mi="${i}" ${m.disabled ? 'disabled' : ''}>${m.label}</button></li>`).join('')}
        </ul>
        <div class="gm-win" data-gmwin>
          <div class="gm-win-title">${it.label}</div>
          ${it.body()}
        </div>
      </div>
      <div class="gm-foot"><span>▲▼ MOVE</span><span>ENTER SELECT</span><span>${DRAW.entry ? 'P2 ●' : 'P2 ○'}</span></div>
    </div>`;
}

function moverRule() {
  return `
    <ol class="gm-list">
      <li>Compare each asset's USD move since entry.</li>
      <li>The asset that moved more is the <b>mover</b>. It carries the IL.</li>
      <li>The non-mover gets their deposit back, <b>as long as the position covers it</b>.</li>
      <li>The mover gets the rest. Each seat adds its share of fees.</li>
    </ol>`;
}

function arcade() {
  return gameMenu('arcade', {
    title: 'ARCADE',
    status: 'OPENS AT LAUNCH',
    items: [
      { label: 'STAKE', body: () => `
        <p class="gm-text">Staking $NIMORI opens once the token is live on Pons, the Robinhood Chain launchpad.</p>
        ${dots('FEE SHARE', '10% OF CO-OP FEES')}${dots('PRIORITY PASS', 'STAKERS FIRST')}${dots('PAIR VOTE', 'ON')}
        <p class="gm-text small">No APR is shown: there is no volume yet, so any number would be made up.</p>
        ${gbtn('▶ ENTER THE DRAW', 'data-go="draw"', 'go')}` },
      { label: 'PERKS', body: () => `
        <ol class="gm-list">
          <li><b>FEE SHARE.</b> 10% of co-op trading fees, paid in ETH and pair tokens.</li>
          <li><b>PRIORITY PASS.</b> Stakers get matched first in lobby queues.</li>
          <li><b>PAIR VOTE.</b> Stakers choose which pairs open a lobby.</li>
        </ol>` },
      { label: 'PAIR VOTE', body: () => `<p class="gm-text">The first lobby is NIMORI / ETH. Stakers vote on the next pairs after launch.</p>` },
      { label: 'RISK', body: () => `<p class="gm-text">Staked NIMORI will be exposed to the token price and to smart contract risk. No audit is claimed here.</p>` },
    ],
  });
}

function docs() {
  const page = (text, fig = '') => () => `<p class="gm-text">${text}</p>${fig ? `<div class="gm-fig">${fig}</div>` : ''}`;
  return gameMenu('docs', {
    title: 'MANUAL',
    status: 'HOW TO PLAY',
    items: [
      { label: 'THE MATCH', body: page('Player 1 deposits ETH, Player 2 deposits the token. A deposit waits in the lobby until one arrives on the other side; while waiting it earns nothing and can be withdrawn anytime, free.', figMatch()) },
      { label: 'DIFFICULTY', body: page('Both players pick the same range. Easy is full range, Normal is wide around spot, Hard is narrow: more fees per trade, but it can fall out of range.', figDifficulty()) },
      { label: 'SESSION', body: page('Each seat is an ERC-721 save file with the entry snapshot and the fee split. Sell it and the buyer inherits the session.', figTimeline()) },
      { label: 'MOVER RULE', body: page('The asset that moved more since entry carries the IL. The non-mover gets their deposit back in their own asset, as long as the position covers it.', figPayouts()) },
      { label: 'HOT SWAP', body: page('When one player leaves, a player waiting on the same side and difficulty takes the empty seat. No unwind.', figHotSwap()) },
      { label: '$NIMORI', body: page('$NIMORI launched on Pons. Pons pools pay no swap fees to LPs, so co-op positions live in NIMORI pools instead.', figFees()) },
      { label: 'RISKS', body: () => `
        <ol class="gm-list">
          <li><b>CONTRACTS</b> can have bugs. Audit status is published before deposits open.</li>
          <li><b>MOVER RISK.</b> If your asset moves more, you carry the IL.</li>
          <li><b>CAP.</b> Past about −75% on one asset (full range), the non-mover is not repaid in full.</li>
          <li><b>RANGE.</b> Hard positions can go out of range and stop earning.</li>
          <li><b>LOBBY WAIT.</b> An unmatched deposit earns nothing.</li>
        </ol>` },
    ],
  });
}

// ---------- pre-launch draw ----------
// Connect -> sign one free message -> the server verifies it and stores ONE ticket per wallet.
// Sharing on X only comes after that, from a real entry.
const DRAW = { entry: null, players: null, busy: false, rolled: false, error: '' };
const drawMessage = (address, issued) => [
  'NIMORI - pre-launch draw',
  '',
  'address: ' + address.toLowerCase(),
  'issued: ' + issued,
  '',
  'Signing is free and sends nothing. It enters this wallet in the $NIMORI draw: one ticket per wallet.',
].join('\n'); // must stay byte-identical to entryMessage() in api/_shared.js

async function drawApi(path = '', init) {
  const r = await fetch('/api/plug' + path, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Server error');
  return j;
}
// the second cable goes in for real once this wallet has a stored entry
function syncCable(withFanfare = false) {
  const on = !!DRAW.entry;
  if (on === state.plugged) return;
  state.plugged = on;
  if (on) {
    scene?.plug2P();
    if (withFanfare) {
      setTimeout(() => sfx('plug'), 250);
      setTimeout(() => { const m = $('#matched'); m.classList.add('show'); setTimeout(() => m.classList.remove('show'), 1800); }, scene ? 1500 : 100);
    }
  } else scene?.unplug2P();
  setHud();
}

async function refreshDraw() {
  try {
    const a = W.account()?.address;
    const j = await drawApi(a ? '?address=' + a : '');
    DRAW.players = j.players;
    DRAW.entry = j.entry || null;
    if (DRAW.entry) { DRAW.rolled = true; MENU_SEL.draw = 2; }
    syncCable(false);
  } catch { DRAW.players = null; }
  if (routeName() === 'draw') render();
}

function ticketCard(e, rolling = false) {
  return `
    <div class="gm-ticket ${rolling ? 'rolling' : ''}" data-ticket>
      <div class="gm-ticket-top"><img src="img/wordmark.webp" alt="NIMORI"><span>PRE-LAUNCH DRAW</span></div>
      <div class="gm-ticket-code" data-code>${rolling ? 'NMR-??????' : e.ticket.code}</div>
      ${dots('WALLET', W.short(e.address))}${dots('CARTRIDGE', e.ticket.cart.toUpperCase())}
    </div>`;
}
const tweetText = (e) => `Plugged in to @nimoricoop 🎮\n\nTicket ${e.ticket.code} · waiting for player 2 ▮▮▮▮▯`;

function draw() {
  const acc = W.account();
  const e = DRAW.entry;
  return gameMenu('draw', {
    title: 'PRE-LAUNCH DRAW',
    status: `PLAYERS <b>${DRAW.players ?? '—'}</b>`,
    items: [
      { label: acc ? 'WALLET ✓' : 'CONNECT', body: () => acc
          ? `${dots('WALLET', W.short(acc.address))}${dots('APP', esc(acc.name))}<p class="gm-text small">Connecting only reads your address.</p>${gbtn('CHANGE WALLET', 'data-wdisconnect')}`
          : `<p class="gm-text">Plug a wallet into port 2. Any EVM wallet works. Connecting only reads your address.</p>${gbtn('▶ CONNECT WALLET', 'data-wconnect', 'go')}`,
        action: acc ? null : openWalletPicker },
      { label: 'PLUG IN', disabled: !acc, body: () => e
          ? `<p class="gm-text">This wallet is plugged in. One wallet, one ticket.</p>`
          : `<p class="gm-text">Sign one free message. No transaction, no approval, nothing leaves your wallet.</p>${gbtn(DRAW.busy ? 'CHECK YOUR WALLET…' : '▶ PLUG IN', `data-wsign ${DRAW.busy ? 'disabled' : ''}`, 'go')}${DRAW.error ? `<p class="gm-text warn">${esc(DRAW.error)}</p>` : ''}`,
        action: e ? null : doSign },
      { label: 'MY TICKET', disabled: !e, body: () => `${ticketCard(e, !DRAW.rolled)}
          ${dots('ELIGIBLE NOW', e.eligibleNow ? '<span class="on">YES</span>' : '<span class="warn">NOT YET</span>')}
          <p class="gm-text small">${e.eligibleNow ? 'This wallet has history and gas on Robinhood Chain. Keep it that way until the snapshot.' : 'To be eligible at the snapshot, this wallet needs at least 1 transaction and some ETH for gas on Robinhood Chain.'}</p>
          ${gbtn('▶ SHARE ON X', 'data-wshare', 'go')}` },
      { label: 'SHARE ON X', disabled: !e, body: () => `<div class="gm-tweet">${esc(tweetText(e)).replace(/\n/g, '<br>')}</div>${gbtn('▶ POST IT', 'data-wshare', 'go')}`, action: shareOnX },
      { label: 'RULES', body: () => `
        <ol class="gm-list">
          <li><b>ONE WALLET, ONE TICKET.</b> Same odds for every ticket. The cartridge is cosmetic.</li>
          <li><b>ELIGIBILITY.</b> At the snapshot block, a wallet needs at least 1 transaction sent and some ETH for gas on Robinhood Chain. Fresh empty wallets do not count.</li>
          <li><b>VERIFIABLE.</b> Before the draw we publish the full entry list and its hash. The draw script is open source, anyone can re-run it and get the same winners.</li>
          <li><b>DRAWN AT LAUNCH, IN PUBLIC.</b> From a Robinhood Chain block hash announced in advance: nobody can pick the winners, us included.</li>
          <li><b>WINNERS GET A $NIMORI AIRDROP.</b> Amount and number of winners announced before the draw.</li>
          <li><b>STAY SAFE.</b> The draw never asks for a transaction, an approval or a seed phrase. We never DM first.</li>
        </ol>` },
    ],
  });
}

async function doSign() {
  const acc = W.account();
  if (!acc || DRAW.busy) return;
  DRAW.busy = true; DRAW.error = ''; render();
  try {
    const issued = new Date().toISOString();
    const signature = await W.sign(drawMessage(acc.address, issued));
    const j = await drawApi('', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address: acc.address, issued, signature }) });
    DRAW.entry = { address: j.address, ticket: j.ticket, enteredAt: j.enteredAt, eligibleNow: j.eligibleNow };
    DRAW.players = j.players;
    DRAW.rolled = !!j.already;
    MENU_SEL.draw = 2;
    syncCable(true);
    sfx('coin');
  } catch (err) {
    DRAW.error = /reject|denied|4001/i.test(String(err?.message || err)) ? 'Signature cancelled in the wallet.' : String(err?.message || err);
    sfx('error');
  }
  DRAW.busy = false;
  render();
  if (DRAW.entry && !DRAW.rolled) rollTicket();
}

// slot-machine reveal of the ticket code on the card (and on the console screen)
function rollTicket() {
  const el = $('[data-code]');
  const code = DRAW.entry.ticket.code;
  const hex = '0123456789ABCDEF';
  const t0 = performance.now(), dur = 1500;
  let lastTick = 0;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const fixed = Math.floor(k * 6);
    const s = 'NMR-' + code.slice(4, 4 + fixed) + [...Array(6 - fixed)].map(() => hex[(Math.random() * 16) | 0]).join('');
    if (el) el.textContent = s;
    if (now - lastTick > 70 && k < 1) { sfx('blip'); lastTick = now; }
    if (k < 1) requestAnimationFrame(step);
    else {
      DRAW.rolled = true;
      $('[data-ticket]')?.classList.remove('rolling');
      sfx('matched');
      const r = routeName();
      if (lidOpenFor(r)) scene?.setScreen(screenFor(r));
    }
  };
  requestAnimationFrame(step);
}

function shareOnX() {
  const e = DRAW.entry;
  if (!e) return;
  const site = /localhost|127\.0\.0\.1/.test(location.hostname) ? '' : '\n\n' + location.origin;
  const text = tweetText(e) + site;
  window.open('https://x.com/intent/post?text=' + encodeURIComponent(text), '_blank', 'noopener');
}

function openWalletPicker() {
  const list = W.wallets();
  openModal({
    icon: I.wallet,
    title: 'Connect wallet',
    explain: list.length ? 'Pick a wallet. Connecting only reads your address; nothing is signed yet.' : 'No wallet found in this browser. Install one (Rabby, MetaMask, Coinbase Wallet) or open this page in your wallet app.',
    body: list.length ? `<div class="wallets">${list.map((w, i) => `<button type="button" class="wallet-opt" data-wpick="${i}">${w.icon ? `<img src="${w.icon}" alt="">` : ''}<span>${w.name}</span><small>Detected</small></button>`).join('')}</div>` : '',
    cancel: 'Close',
  });
  $$('[data-wpick]', $('#modalCard')).forEach((b) => b.addEventListener('click', async () => {
    const w = list[+b.dataset.wpick];
    closeModal();
    try { await W.connect(w); sfx('select'); } catch (err) { toast(/reject|denied|4001/i.test(String(err?.message)) ? 'Connection cancelled.' : String(err?.message || err), 'error'); }
  }));
}
W.onChange(() => {
  const a = W.account();
  const btn = $('[data-connect]');
  btn.textContent = a ? W.short(a.address) : 'Connect wallet';
  DRAW.entry = null; DRAW.rolled = false; DRAW.error = '';
  syncCable(false);
  MENU_SEL.draw = a ? 1 : 0;
  refreshDraw();
  if (routeName() !== 'draw') render();
});

const ROUTES = { lobby, arcade, docs, draw };

// ---------- console screen content (drawn inside the 3D scene, never an HTML overlay) ----------
function screenFor(route) {
  if (route === 'draw') return DRAW.entry && DRAW.rolled
    ? { title: 'PRE-LAUNCH DRAW', big: DRAW.entry.ticket.code, lines: ['YOUR TICKET', '1 WALLET · 1 TICKET'] }
    : { title: 'PRE-LAUNCH DRAW', big: 'PLUG IN', lines: ['GET A TICKET', `${DRAW.players ?? '—'} PLAYERS PLUGGED IN`] };
  if (route === 'arcade') return { title: 'ARCADE', big: 'SOON', lines: ['STAKING OPENS AT LAUNCH', 'LAUNCHING ON PONS'] };
  return { title: 'HOW TO PLAY', big: '1P + 2P', lines: ['ETH + TOKEN = ONE POSITION', 'THE MOVER CARRIES THE IL'] };
}

// ---------- router ----------
// Lobby: console closed, page in the side panel.
// Session (once 2P is plugged in), Arcade, Docs: the lid opens and the page sits on the console screen.
// Phones: the screen is too small for a page, so it shows a title card and the page stays below.
const panel = $('#screen');
const crtBody = $('[data-crt-body]', crtEl);
let clockTimer = 0;
let wasDesktop = window.innerWidth >= 1000;
const routeName = () => {
  let name = (location.hash.replace(/^#\/?/, '').split('/')[0]) || 'lobby';
  if (name === 'session') name = 'lobby'; // the session now lives in the lobby
  return ROUTES[name] ? name : 'lobby';
};
// the lobby opens the console too once player 2 is in: the screen then shows the live session clock
const lidOpenFor = (route) => route === 'draw' || route === 'arcade' || route === 'docs';

let wasOpen = false;
function render() {
  const route = routeName();
  const desktop = window.innerWidth >= 1000;
  const open = !!scene && lidOpenFor(route);
  const onScreen = open && desktop && route !== 'lobby';
  document.body.dataset.mode = onScreen ? 'screen' : 'panel';
  if (open !== wasOpen) { sfx(open ? 'lid' : 'close'); wasOpen = open; }
  scene?.setLid(open);
  scene?.setView(route === 'lobby' ? (open ? 'lobbyOpen' : 'lobby') : open ? 'screen' : route);
  scene?.setDifficulty(state.difficulty);
  scene?.setOverlay(onScreen);
  if (open) scene?.setScreen(onScreen ? {} : screenFor(route));
  scene?.relayout();

  const html = ROUTES[route]();
  const clean = route !== 'lobby';
  panel.classList.toggle('clean', clean && !onScreen);
  panel.classList.toggle('retro', clean && !onScreen);
  panel.innerHTML = onScreen ? '' : html;
  crtBody.innerHTML = onScreen ? html : '';
  crtBody.scrollTop = 0;
  panel.scrollTop = 0;
  const root = onScreen ? crtBody : panel;
  $$('.tabs a').forEach((a) => (a.dataset.route === route ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  document.title = `NIMORI · ${route[0].toUpperCase() + route.slice(1)}`;
  setHud();
  bind(root);
}
window.addEventListener('resize', () => {
  const d = window.innerWidth >= 1000;
  if (d !== wasDesktop) { wasDesktop = d; render(); }
});

function setHud() {
  $('#hud').classList.toggle('ok', state.plugged);
  $('#hud-label').textContent = state.plugged ? 'player 2 connected · plugged in' : 'waiting for player 2';
  $('#hud-bar').textContent = state.plugged ? '▮▮▮▮▮' : '▮▮▮▯▯';
}

function bind(root) {
  $$('[data-diff]', root).forEach((b) => b.addEventListener('click', () => { state.difficulty = b.dataset.diff; render(); }));
  $$('[data-go]', root).forEach((b) => b.addEventListener('click', () => { location.hash = `#/${b.dataset.go}`; }));
  $$('[data-anchor]', root).forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    $(`#${a.dataset.anchor}`, root)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  $$('[data-mi]', root).forEach((b) => b.addEventListener('click', () => menuPick(+b.dataset.mi, true)));
  $('[data-wconnect]', root)?.addEventListener('click', openWalletPicker);
  $('[data-wdisconnect]', root)?.addEventListener('click', () => { W.disconnect(); });
  $('[data-wsign]', root)?.addEventListener('click', doSign);
  $('[data-wshare]', root)?.addEventListener('click', shareOnX);
}

function menuPick(i, fromClick = false) {
  const route = routeName();
  const items = MENUS[route];
  if (!items || !items[i] || items[i].disabled) return;
  const again = MENU_SEL[route] === i;
  MENU_SEL[route] = i;
  sfx(again && items[i].action ? 'coin' : 'select');
  if (again && items[i].action) { items[i].action(); return; }
  render();
  if (!fromClick) $(`[data-mi="${i}"]`)?.focus();
}
function menuMove(d) {
  const route = routeName();
  const items = MENUS[route];
  if (!items) return;
  let i = MENU_SEL[route];
  for (let k = 0; k < items.length; k++) {
    i = (i + d + items.length) % items.length;
    if (!items[i].disabled) break;
  }
  MENU_SEL[route] = i;
  sfx('blip');
  render();
  $(`[data-mi="${i}"]`)?.focus();
}
document.addEventListener('keydown', (e) => {
  if (!$('#modal').hidden || !MENUS[routeName()] || !$('[data-gm]')) return;
  if (e.target.matches('input, textarea')) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); menuMove(1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); menuMove(-1); }
  else if (e.key === 'Enter' && e.target.matches('.gm-item, body')) {
    e.preventDefault();
    const it = MENUS[routeName()][MENU_SEL[routeName()]];
    if (it.action) { sfx('coin'); it.action(); } else $('[data-gmwin] .gb:not([disabled])')?.click();
  }
});

$('[data-connect]').addEventListener('click', () => (W.account() ? (location.hash = '#/draw') : openWalletPicker()));
window.addEventListener('hashchange', render);
if (!location.hash) history.replaceState(null, '', '#/lobby');
document.fonts?.ready.then(() => { const r = routeName(); if (lidOpenFor(r)) scene?.setScreen(screenFor(r)); });
render();

// ---------- arcade click sounds ----------
// Runs after the element's own handler (bubble phase): if that handler already played a sound, stay quiet.
document.addEventListener('click', (e) => {
  const el = e.target.closest('button, a');
  if (!el || el.disabled || playedJustNow()) return;
  if (el.matches('[data-confirm]')) sfx('coin');
  else if (el.matches('[data-close]')) sfx('back');
  else if (el.matches('[data-diff], .toc a, [data-anchor]')) sfx('select');
  else sfx('blip');
});
const muteBtn = $('[data-mute]');
const paintMute = () => {
  muteBtn.setAttribute('aria-pressed', String(!isMuted()));
  muteBtn.title = isMuted() ? 'Sound off' : 'Sound on';
  muteBtn.innerHTML = isMuted()
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4zM22 9l-6 6M16 9l6 6"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4zM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
};
muteBtn.addEventListener('click', () => { setMuted(!isMuted()); paintMute(); if (!isMuted()) sfx('coin'); });
paintMute();
refreshDraw();

// ---------- boot screen ----------
// The bar follows real work: fonts, the logo image, then two rendered frames of the 3D console.
(function boot() {
  const el = $('#boot'); if (!el) return;
  const fill = $('#bootFill'), txt = $('#bootTxt');
  const t0 = performance.now();
  let shown = 0;
  const set = (v) => { shown = Math.max(shown, v); fill.style.width = Math.round(shown * 100) + '%'; };
  set(0.12);
  const logo = new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = 'img/wordmark.webp'; });
  const frames = new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const steps = [document.fonts ? document.fonts.ready : Promise.resolve(), logo, frames];
  let done = 0;
  steps.forEach((s) => s.then(() => set(0.12 + (++done / steps.length) * 0.78)));
  const timeout = new Promise((r) => setTimeout(r, 5000));
  Promise.race([Promise.all(steps), timeout]).then(() => {
    const wait = Math.max(0, 1400 - (Date.now() - (window.__bootT0 || Date.now()))); // from first paint of the boot screen: long enough to read the logo
    setTimeout(() => {
      set(1);
      txt.textContent = 'PRESS START';
      txt.classList.add('start');
      sfx('boot');
      setTimeout(() => el.classList.add('gone'), 650);
    }, wait);
  });
})();
