// NIMORI demo — app shell + hash router.
// The router rewrites the side panel (Lobby) or the page laid over the console screen. The 3D console (#stage) is mounted once.
// Nothing here is on-chain: queues, prices, the match and staking are simulated in this file.
import { createScene } from './scene.js';
import { sfx, playedJustNow, isMuted, setMuted } from './sound.js';
import * as W from './wallet.js';
import { figMatch, figDifficulty, figTimeline, figPayouts, figHotSwap, figFees } from './figs.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmt = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const usd = (n) => '$' + fmt(n, 2);
const pct = (n) => (n >= 0 ? '+' : '') + (n * 100).toFixed(1) + '%';

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

// ---------- simulated state ----------
const state = { difficulty: 'normal', amount: '16000', plugged: false, matchedAt: 0 };
const SIM = {
  tokenUsd: 0.1,
  ethUsd: 2000,
  queues: {
    easy: { p1: [['0x3f1…a91c', '1.20 ETH', '41m'], ['0x9b0…07e2', '0.50 ETH', '12m']], p2: [] },
    normal: { p1: [['0x5d7…c3b8', '0.80 ETH', '18m'], ['0xa04…11f9', '0.35 ETH', '6m']], p2: [] },
    hard: { p1: [['0x71e…9d02', '0.40 ETH', '2h 04m']], p2: [] },
  },
};
const DIFF = {
  easy: { label: 'Easy', range: [1, 1, 1, 1, 1], note: 'Full range. Lower fees, lowest IL.' },
  normal: { label: 'Normal', range: [0, 1, 1, 1, 0], note: 'Wide range around spot. Medium fees, medium IL.' },
  hard: { label: 'Hard', range: [0, 0, 1, 0, 0], note: 'Narrow range. Highest fees, can go out of range.' },
};
const STAKE = { wallet: 50000, staked: 0, mode: 'stake' };
const DAY = 24 * 3600 * 1000;
const rangeViz = (d) => `<span class="rangeviz" aria-hidden="true">${DIFF[d].range.map((o) => `<i class="${o ? 'on' : ''}"></i>`).join('')}</span>`;
const head = () => SIM.queues[state.difficulty].p1[0];
const sessionAge = () => Date.now() - state.matchedAt;
const clockText = () => {
  const s = Math.max(0, Math.floor(sessionAge() / 1000));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
};

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
function openModal({ icon = I.info, tone = '', title, explain = '', rows = [], note = '', body = '', cancel = 'Cancel', confirm = null, onConfirm = null, demo = true }) {
  lastFocus = document.activeElement;
  $('#modalCard').innerHTML = `
    <div class="ico ${tone}">${icon}</div>
    <h2 id="modalTitle">${title}</h2>
    ${explain ? `<p class="explain">${explain}</p>` : ''}
    ${rows.length ? `<div class="summary">${rows.map(([k, v]) => `<div class="row"><span>${k}</span><b>${v}</b></div>`).join('')}</div>` : ''}
    ${body}
    ${note ? `<div class="note">${I.info}<span>${note}</span></div>` : ''}
    <div class="row2 ${confirm ? '' : 'single'}">
      <button class="btn" type="button" data-close>${cancel}</button>
      ${confirm ? `<button class="btn btn-primary" type="button" data-confirm>${confirm}</button>` : ''}
    </div>
    ${demo ? '<p class="demo-note">Demo · simulated. Nothing is signed or sent.</p>' : ''}`;
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

// Seat value at simulated prices: full-range x*y=k and the mover rule (docs 3.6).
function seatQuote() {
  const eth = parseFloat(head()[1]);
  const tokens = parseFloat(state.amount) || 0;
  const mins = sessionAge() / 60000;
  const dEth = 0.012, dTok = 0.048 + Math.min(mins, 600) * 0.0001;
  const e1 = SIM.ethUsd * (1 + dEth), t1 = SIM.tokenUsd * (1 + dTok);
  const k = eth * tokens;
  const ratio = t1 / e1;
  const value = Math.sqrt(k * ratio) * e1 + Math.sqrt(k / ratio) * t1;
  const hold1 = eth * e1, hold2 = tokens * t1;
  const tokenMover = Math.abs(dTok) >= Math.abs(dEth);
  const covered = value >= (tokenMover ? hold1 : hold2);
  const p1 = tokenMover ? Math.min(hold1, value) : value - Math.min(hold2, value);
  return { dEth, dTok, value, p1, p2: value - p1, tokenMover, covered };
}

// ---------- pages ----------
function lobby() {
  const q = SIM.queues[state.difficulty];
  const head = q.p1[0];
  const usd = (parseFloat(state.amount) || 0) * SIM.tokenUsd;
  const p1rows = q.p1.map((r) => `<li><span class="addr">${r[0]}</span><span>${r[1]}</span></li>`).join('');
  const p2rows = state.plugged
    ? `<li class="you"><span class="addr">you</span><span>${fmt(state.amount)}</span></li>`
    : `<li class="empty"><span>empty seat</span><span>—</span></li>`;
  return `
    <a class="draw-banner" href="#/draw"><span>PRE-LAUNCH</span><b>Plug in your wallet, get a ticket for the $NIMORI draw</b><i>→</i></a>
    <p class="eyebrow">Lobby · NIMORI / ETH</p>
    <h1>${state.plugged ? 'Player 2 connected.' : 'Player 1 is waiting.'}</h1>
    <p class="lede">You bring the token. Player 1 already brought the ETH. One Uniswap v4 position, two seats.</p>

    <div class="pairbar">
      <span class="pair"><span class="coin eth">Ξ</span><span class="coin">N</span>NIMORI / ETH</span>
      <span class="muted">More lobbies open by Arcade vote.</span>
    </div>

    <h2>Difficulty</h2>
    <div class="seg" role="group" aria-label="Difficulty">
      ${Object.entries(DIFF).map(([k, v]) => `<button type="button" data-diff="${k}" aria-pressed="${k === state.difficulty}" ${state.plugged ? 'disabled' : ''}>${v.label}</button>`).join('')}
    </div>
    <div class="seg-note">${rangeViz(state.difficulty)}<span>${DIFF[state.difficulty].note} Shown on the console's RANGE strip.</span></div>

    <div class="queues">
      <div class="queue">
        <div class="queue-h"><b>1P</b><span>ETH queue · ${DIFF[state.difficulty].label}</span></div>
        <ol>${p1rows}</ol>
      </div>
      <div class="queue">
        <div class="queue-h"><b>2P</b><span>NIMORI queue</span></div>
        <ol>${p2rows}</ol>
      </div>
    </div>
    <p class="muted" style="margin-top:8px">Matched FIFO by value, same difficulty only. Head of the 1P queue: <span class="mono">${head[0]}</span>, ${head[1]}, waiting ${head[2]}.</p>

    <div class="status ${state.plugged ? 'ok' : ''}">
      <span class="dot"></span>
      <span>${state.plugged ? 'MATCHED · save file #0142 minted (simulated)' : 'port 2 empty · waiting for player 2 ▮▮▮▯▯'}</span>
    </div>

    ${state.plugged ? `
      <button class="btn btn-ok btn-block" type="button" data-go="session">Open your save file →</button>
      <button class="btn btn-cream btn-block" type="button" data-reset style="margin-top:10px">Reset demo</button>
    ` : `
      <label class="field">
        <input inputmode="decimal" aria-label="Deposit amount in NIMORI" value="${state.amount}" data-amount>
        <span class="unit">NIMORI</span>
      </label>
      <dl class="kv">
        <dt>Value at pool price</dt><dd data-usd>≈ $${fmt(usd)}</dd>
        <dt>Fee split</dt><dd>50 / 50 (2P queue is short)</dd>
        <dt>Min session</dt><dd>24 h</dd>
        <dt>While unmatched</dt><dd>withdraw anytime, free</dd>
      </dl>
      <button class="btn btn-block" type="button" data-plug>Plug in as 2P</button>
    `}

    <p class="risk"><b>Who carries what.</b> The side whose asset moved more carries the IL. If the token moves more, 2P carries it, and 1P gets their ETH back <b>as long as the position covers it</b>. Past roughly −75% on the token, the cap applies and 1P gets less.</p>
    <p class="muted" style="margin-top:12px">Demo: queues, prices and the match are simulated. No contract is deployed.</p>
  `;
}

// ---------- retro game menu (used by every page drawn on the console screen) ----------
// Left: a menu list with a blinking cursor. Right: a dialog window for the selected entry.
// Arrow keys move, Enter selects, mouse works too. An entry with `action` runs it when chosen again or on Enter.
const MENU_SEL = { session: 0, arcade: 0, docs: 0, draw: 0 };
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
      <div class="gm-foot"><span>▲▼ MOVE</span><span>ENTER SELECT</span><span>${state.plugged ? 'P2 ●' : 'P2 ○'}</span></div>
    </div>`;
}

function session() {
  if (!state.plugged) {
    return gameMenu('session', {
      title: 'SESSION',
      status: 'NO SAVE FILE',
      items: [
        { label: 'PLUG IN', body: () => `<p class="gm-text">Port 2 is empty. You bring ${fmt(parseFloat(state.amount) || 0)} NIMORI on ${DIFF[state.difficulty].label.toUpperCase()}. The head of the 1P queue brings ${head()[1]}.</p>${gbtn('▶ PLUG IN AS 2P', 'data-plug', 'go')}`, action: confirmPlug },
        { label: 'LOBBY', body: () => `<p class="gm-text">Change the amount or the difficulty before you plug in.</p>${gbtn('▶ GO TO LOBBY', 'data-go="lobby"')}`, action: () => { location.hash = '#/lobby'; } },
        { label: 'MOVER RULE', body: moverRule },
      ],
    });
  }
  const unlocked = sessionAge() >= DAY;
  return gameMenu('session', {
    title: 'SAVE FILE #0142',
    status: `TIME <b data-clock>${clockText()}</b>`,
    items: [
      { label: 'SEAT 2P', body: () => `
        ${dots('SIDE', 'NIMORI · 2P')}
        ${dots('PARTNER', '1P ' + head()[0])}
        ${dots('YOUR DEPOSIT', fmt(parseFloat(state.amount) || 0) + ' NIMORI')}
        ${dots('PARTNER DEPOSIT', head()[1])}
        ${dots('ENTRY ETH', '$' + fmt(SIM.ethUsd) + ' (SIM)')}
        ${dots('ENTRY NIMORI', '$' + SIM.tokenUsd.toFixed(2) + ' (SIM)')}
        ${dots('RANGE', DIFF[state.difficulty].label.toUpperCase())}
        <p class="gm-text small">Your seat is an ERC-721. Sell it and the buyer inherits the session.</p>` },
      { label: 'FEE SPLIT', body: () => `
        <div class="gm-bar"><i style="width:50%"></i></div>
        ${dots('YOU (2P)', '50%')}${dots('PARTNER (1P)', '50%')}
        <p class="gm-text small">10% of trading fees go to Arcade stakers first. The scarce side can earn a seat bonus, up to 70/30.</p>` },
      unlocked
        ? { label: 'UNPLUG', body: () => `<p class="gm-text">24 h played. Unplugging is free. The mover rule settles both seats.</p>${gbtn('▶ UNPLUG', 'data-unplug', 'go')}`, action: () => openExit(false) }
        : { label: 'RAGE QUIT', body: () => `<p class="gm-text">Unplug unlocks at 24:00:00. Leaving now costs 1% of your seat, paid to your partner.</p>${gbtn('▶ RAGE QUIT (−1%)', 'data-ragequit', 'warn')}<p class="gm-text small"><button class="gm-link" type="button" data-skip>DEMO: SKIP TO 24 H</button></p>`, action: () => openExit(true) },
      { label: 'SELL SEAT', body: () => `<p class="gm-text">List your save file on any NFT marketplace. The buyer takes your seat, your share of fees and your side of the mover rule.</p>${gbtn('▶ SELL SEAT', 'data-sell')}` },
      { label: 'MOVER RULE', body: moverRule },
    ],
  });
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
  const stakeBody = (mode) => () => { STAKE.mode = mode; return `
    <label class="gm-field">
      <input inputmode="decimal" placeholder="0" aria-label="Amount of NIMORI" data-samt>
      <span>NIMORI</span><button type="button" class="gm-max" data-smax>MAX</button>
    </label>
    ${dots('DEMO WALLET', fmt(STAKE.wallet))}${dots('STAKED', fmt(STAKE.staked))}${dots('PRIORITY PASS', STAKE.staked ? '<span class="on">ON</span>' : 'OFF')}
    ${gbtn(mode === 'stake' ? '▶ INSERT COIN' : '◀ CASH OUT', 'data-sgo', 'go')}
    <p class="gm-text small">No APR shown: there is no live volume yet, so any number would be made up.</p>`; };
  return gameMenu('arcade', {
    title: 'ARCADE',
    status: `STAKED <b>${fmt(STAKE.staked)}</b>`,
    items: [
      { label: 'STAKE', body: stakeBody('stake') },
      { label: 'UNSTAKE', disabled: !STAKE.staked, body: stakeBody('unstake') },
      { label: 'PERKS', body: () => `
        <ol class="gm-list">
          <li><b>FEE SHARE.</b> 10% of co-op trading fees, paid in ETH and pair tokens.</li>
          <li><b>PRIORITY PASS.</b> Stakers get matched first in lobby queues.</li>
          <li><b>PAIR VOTE.</b> Stakers choose which pairs open a lobby.</li>
        </ol>
        <p class="gm-text small">$NIMORI launched on Pons, the Robinhood Chain launchpad.</p>` },
      { label: 'PAIR VOTE', body: () => `
        ${[['WETH / PAIR A', 46], ['WETH / PAIR B', 31], ['WETH / PAIR C', 23]].map(([n, v]) => `<div class="gm-vote"><span>${n}</span><b>${v}%</b><div class="gm-bar"><i style="width:${v}%"></i></div></div>`).join('')}
        <p class="gm-text small">Candidate pairs, simulated tallies.</p>` },
      { label: 'RISK', body: () => `<p class="gm-text">Staked NIMORI is exposed to the token price and to smart contract risk. No audit is claimed here.</p>` },
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
async function refreshDraw() {
  try {
    const a = W.account()?.address;
    const j = await drawApi(a ? '?address=' + a : '');
    DRAW.players = j.players;
    DRAW.entry = j.entry || null;
    if (DRAW.entry) { DRAW.rolled = true; MENU_SEL.draw = 2; }
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
      { label: 'MY TICKET', disabled: !e, body: () => `${ticketCard(e, !DRAW.rolled)}${gbtn('▶ SHARE ON X', 'data-wshare', 'go')}` },
      { label: 'SHARE ON X', disabled: !e, body: () => `<div class="gm-tweet">${esc(tweetText(e)).replace(/\n/g, '<br>')}</div>${gbtn('▶ POST IT', 'data-wshare', 'go')}`, action: shareOnX },
      { label: 'RULES', body: () => `
        <ol class="gm-list">
          <li><b>ONE WALLET, ONE TICKET.</b> Same odds for every ticket. The cartridge is cosmetic.</li>
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
    DRAW.entry = { address: j.address, ticket: j.ticket, enteredAt: j.enteredAt };
    DRAW.players = j.players;
    DRAW.rolled = !!j.already;
    MENU_SEL.draw = 2;
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
    demo: false,
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
  MENU_SEL.draw = a ? 1 : 0;
  refreshDraw();
  if (routeName() !== 'draw') render();
});

const ROUTES = { lobby, session, arcade, docs, draw };

// ---------- console screen content (drawn inside the 3D scene, never an HTML overlay) ----------
function screenFor(route) {
  if (route === 'draw') return DRAW.entry && DRAW.rolled
    ? { title: 'PRE-LAUNCH DRAW', big: DRAW.entry.ticket.code, lines: ['YOUR TICKET', '1 WALLET · 1 TICKET'] }
    : { title: 'PRE-LAUNCH DRAW', big: 'PLUG IN', lines: ['GET A TICKET', `${DRAW.players ?? '—'} PLAYERS PLUGGED IN`] };
  if (route === 'session') return { title: 'SAVE FILE #0142', big: clockText(), lines: ['TIME PLAYED', `FEE SPLIT 50/50 · ${DIFF[state.difficulty].label.toUpperCase()}`] };
  if (route === 'arcade') return { title: 'ARCADE', big: STAKE.staked ? fmt(STAKE.staked) : 'INSERT COIN', lines: [STAKE.staked ? 'NIMORI STAKED' : 'STAKE $NIMORI', `PRIORITY PASS ${STAKE.staked ? 'ON' : 'OFF'}`] };
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
  const name = (location.hash.replace(/^#\/?/, '').split('/')[0]) || 'lobby';
  return ROUTES[name] ? name : 'lobby';
};
const lidOpenFor = (route) => route === 'draw' || route === 'arcade' || route === 'docs' || (route === 'session' && state.plugged);

let wasOpen = false;
function render() {
  const route = routeName();
  const desktop = window.innerWidth >= 1000;
  const open = !!scene && lidOpenFor(route);
  const onScreen = open && desktop;
  document.body.dataset.mode = onScreen ? 'screen' : 'panel';
  if (open !== wasOpen) { sfx(open ? 'lid' : 'close'); wasOpen = open; }
  scene?.setLid(open);
  scene?.setView(open ? 'screen' : route);
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
  clearInterval(clockTimer);
  if (state.plugged) {
    clockTimer = setInterval(() => {
      $$('[data-clock]').forEach((el) => { el.textContent = clockText(); });
      if (route === 'session' && !onScreen && open) scene?.setScreen(screenFor(route));
    }, 1000);
  }
}
window.addEventListener('resize', () => {
  const d = window.innerWidth >= 1000;
  if (d !== wasDesktop) { wasDesktop = d; render(); }
});

function setHud() {
  $('#hud').classList.toggle('ok', state.plugged);
  $('#hud-label').textContent = state.plugged ? 'player 2 connected · session live' : 'waiting for player 2';
  $('#hud-bar').textContent = state.plugged ? '▮▮▮▮▮' : '▮▮▮▯▯';
}

function bind(root) {
  $$('[data-diff]', root).forEach((b) => b.addEventListener('click', () => { state.difficulty = b.dataset.diff; render(); }));
  const amt = $('[data-amount]', root);
  if (amt) amt.addEventListener('input', () => {
    state.amount = amt.value.replace(/[^\d.]/g, '');
    $('[data-usd]', root).textContent = `≈ $${fmt((parseFloat(state.amount) || 0) * SIM.tokenUsd)}`;
  });
  $$('[data-plug]', root).forEach((b) => b.addEventListener('click', confirmPlug));
  $('[data-reset]', root)?.addEventListener('click', () => { state.plugged = false; scene?.unplug2P(); render(); });
  $$('[data-go]', root).forEach((b) => b.addEventListener('click', () => { location.hash = `#/${b.dataset.go}`; }));
  $('[data-ragequit]', root)?.addEventListener('click', () => openExit(true));
  $('[data-unplug]', root)?.addEventListener('click', () => openExit(false));
  $('[data-sell]', root)?.addEventListener('click', () => toast('Seats are ERC-721: list yours on any marketplace. Not live in this demo.'));
  $('[data-skip]', root)?.addEventListener('click', () => { state.matchedAt -= DAY; render(); toast('Demo clock moved forward 24 h.'); });
  $$('[data-anchor]', root).forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    $(`#${a.dataset.anchor}`, root)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  bindStake(root);
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

function bindStake(root) {
  const amt = $('[data-samt]', root);
  if (!amt) return;
  $$('[data-smode]', root).forEach((b) => b.addEventListener('click', () => { STAKE.mode = b.dataset.smode; render(); }));
  $('[data-smax]', root).addEventListener('click', () => { amt.value = String(STAKE.mode === 'stake' ? STAKE.wallet : STAKE.staked); });
  $('[data-sgo]', root).addEventListener('click', () => {
    const n = parseFloat((amt.value || '').replace(/[^\d.]/g, ''));
    const staking = STAKE.mode === 'stake';
    const cap = staking ? STAKE.wallet : STAKE.staked;
    if (!(n > 0)) { toast('Enter an amount first.', 'error'); amt.focus(); return; }
    if (n > cap) { toast(staking ? 'Not enough NIMORI in the demo wallet. Try MAX.' : 'You have less than that staked.', 'error'); return; }
    openModal({
      icon: staking ? I.coin : I.exit,
      tone: 'amber',
      title: staking ? 'Stake NIMORI?' : 'Unstake NIMORI?',
      explain: staking ? 'Staking puts you in the Arcade.' : 'Unstaking takes you out of the priority queue.',
      rows: staking ? [
        ['You stake', `${fmt(n)} NIMORI`],
        ['Fee share', '10% of co-op fees, pro rata'],
        ['Priority pass', 'On'],
        ['Pair vote', 'On'],
      ] : [
        ['You unstake', `${fmt(n)} NIMORI`],
        ['Left staked', `${fmt(STAKE.staked - n)} NIMORI`],
        ['Priority pass', STAKE.staked - n > 0 ? 'Still on' : 'Off'],
      ],
      note: staking ? 'Staked NIMORI stays exposed to the token price and to smart contract risk.' : '',
      cancel: 'Back',
      confirm: staking ? 'Stake' : 'Unstake',
      onConfirm: () => {
        if (staking) { STAKE.wallet -= n; STAKE.staked += n; } else { STAKE.wallet += n; STAKE.staked -= n; }
        render();
        toast(staking ? `Staked ${fmt(n)} NIMORI (simulated). Priority pass on.` : `Unstaked ${fmt(n)} NIMORI (simulated).`);
      },
    });
  });
}

function confirmPlug() {
  if (!(parseFloat(state.amount) > 0)) { toast('Enter an amount first.', 'error'); return; }
  const tokens = parseFloat(state.amount);
  openModal({
    icon: I.plug,
    title: 'Plug in as 2P?',
    explain: `You join the NIMORI queue on ${DIFF[state.difficulty].label}. Player 1 is already waiting, so this matches right away.`,
    rows: [
      ['You deposit', `${fmt(tokens)} NIMORI`],
      ['Value at pool price', `≈ $${fmt(tokens * SIM.tokenUsd)}`],
      ['Matched with', `${head()[0]} · ${head()[1]}`],
      ['Range', DIFF[state.difficulty].label],
      ['Fee split', '50 / 50'],
      ['Minimum session', '24 h'],
    ],
    note: 'If NIMORI moves more than ETH, you carry the IL. 1P gets their ETH back as long as the position covers it.',
    cancel: 'Not yet',
    confirm: 'Plug in',
    onConfirm: plugIn,
  });
}

function openExit(early) {
  const q = seatQuote();
  const pen = early ? q.p2 * 0.01 : 0;
  openModal({
    icon: I.exit,
    title: early ? 'Rage quit?' : 'Unplug?',
    explain: `At current simulated prices: ETH ${pct(q.dEth)}, NIMORI ${pct(q.dTok)} since entry.`,
    rows: [
      ['Mover', q.tokenMover ? 'NIMORI (you, 2P)' : 'ETH (1P)'],
      ['Position value', usd(q.value)],
      ['Your seat value', usd(q.p2)],
      ...(early ? [['Penalty (1%, to 1P)', '−' + usd(pen)]] : []),
      ['You receive', usd(q.p2 - pen)],
      ['After you leave', 'Position unwinds, both paid'],
    ],
    note: q.covered ? '' : 'The position does not cover the non-mover\'s deposit at these prices: the cap applies.',
    cancel: 'Keep playing',
    confirm: early ? 'Rage quit' : 'Unplug',
    onConfirm: () => {
      sfx(early ? 'ragequit' : 'unplug');
      state.plugged = false;
      scene?.unplug2P();
      location.hash = '#/lobby';
      render();
      toast(early ? `Rage quit. ${usd(pen)} paid to 1P (simulated).` : 'Unplugged. Position unwound, both seats paid (simulated).');
    },
  });
}

function plugIn() {
  if (state.plugged) return;
  state.plugged = true;
  state.matchedAt = Date.now();
  scene?.plug2P();
  setTimeout(() => sfx('plug'), 250);
  $$('[data-plug]').forEach((b) => { b.disabled = true; b.textContent = 'Plugging in…'; });
  setTimeout(() => {
    const m = $('#matched');
    m.classList.add('show');
    sfx('matched');
    setHud();
    setTimeout(() => {
      m.classList.remove('show');
      // the second cable is in: the lid opens on the save file
      if (routeName() === 'session') render(); else location.hash = '#/session';
    }, 1300);
  }, scene ? 1500 : 200);
}

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
  else if (el.matches('[data-diff], [data-smode], [data-smax], .toc a, [data-anchor]')) sfx('select');
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
