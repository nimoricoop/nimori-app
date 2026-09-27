// NIMORI demo — app shell + hash router.
// The router rewrites the side panel (Lobby) or the page laid over the console screen. The 3D console (#stage) is mounted once.
// Nothing here is on-chain: queues, prices, the match and staking are simulated in this file.
import { createScene } from './scene.js';
import { sfx, playedJustNow, isMuted, setMuted } from './sound.js';
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
function openModal({ icon = I.info, tone = '', title, explain = '', rows = [], note = '', body = '', cancel = 'Cancel', confirm = null, onConfirm = null }) {
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
    <p class="demo-note">Demo · simulated. Nothing is signed or sent.</p>`;
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

function session() {
  if (!state.plugged) {
    return `
      <p class="eyebrow">Session</p>
      <h1>No save file yet.</h1>
      <p class="lede">A seat is minted for each side when a match opens a position. Plug in and the console opens on your save file.</p>
      <div class="card empty-state">
        <div class="ico">${I.save}</div>
        <b>Port 2 is empty</b>
        <p>You bring ${fmt(parseFloat(state.amount) || 0)} NIMORI on ${DIFF[state.difficulty].label}. Head of the 1P queue: ${head()[1]}.</p>
        <div class="actions" style="width:100%;max-width:440px">
          <button class="btn btn-primary" type="button" data-plug>${I.plug} Plug in as 2P</button>
          <button class="btn" type="button" data-go="lobby">Change in the lobby</button>
        </div>
      </div>
      ${moverRule()}
    `;
  }
  const unlocked = sessionAge() >= DAY;
  return `
    <p class="eyebrow">Session · NIMORI / ETH · ${DIFF[state.difficulty].label}</p>
    <h1>Save file #0142</h1>
    <p class="lede">Your seat is an ERC-721. Sell it and the buyer inherits the session.</p>

    <div class="card save" style="margin-top:22px">
      <div class="save-head"><div class="ico amber">${I.save}</div><div><b>Seat 2P</b><span class="muted">NIMORI side · partner 1P ${head()[0]}</span></div><span class="tag">Live</span></div>
      <dl class="kv">
        <dt>Your deposit</dt><dd>${fmt(parseFloat(state.amount) || 0)} NIMORI</dd>
        <dt>Partner deposit</dt><dd>${head()[1]}</dd>
        <dt>Entry prices</dt><dd>ETH $${fmt(SIM.ethUsd)} · NIMORI $${SIM.tokenUsd.toFixed(2)} (sim.)</dd>
        <dt>Range</dt><dd>${DIFF[state.difficulty].label} ${rangeViz(state.difficulty)}</dd>
      </dl>
      <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--c-ink-3)"><span>Fee split · you 50%</span><span>partner 50%</span></div>
      <div class="split"><i style="width:50%;background:var(--amber)"></i><i style="width:50%;background:var(--red)"></i></div>
      <div style="display:flex;justify-content:space-between;align-items:end;gap:10px;margin-top:16px">
        <div><div class="muted">Time played</div><div class="clock" data-clock>${clockText()}</div></div>
        <div class="muted" style="text-align:right">${unlocked ? 'Unplug is free now' : 'Unplug unlocks at 24:00:00'}</div>
      </div>
      <div class="actions">
        ${unlocked
          ? `<button class="btn btn-primary" type="button" data-unplug>${I.exit} Unplug</button><button class="btn" type="button" data-sell>Sell seat</button>`
          : `<button class="btn" type="button" data-ragequit>Rage quit (−1%)</button><button class="btn" type="button" data-sell>Sell seat</button>`}
      </div>
      ${unlocked ? '' : '<p style="margin:12px 0 0"><button class="linkbtn" type="button" data-skip>Demo: skip to 24 h</button></p>'}
    </div>
    ${moverRule()}
  `;
}
function moverRule() {
  return `
    <h2>At unplug: the mover rule</h2>
    <ol class="steps">
      <li><span class="n">1</span><span>Compare each asset's USD move since entry.</span></li>
      <li><span class="n">2</span><span>The asset that moved more is the <b>mover</b>.</span></li>
      <li><span class="n">3</span><span>The non-mover gets their deposit back in their own asset, <b>as long as the position covers it</b>.</span></li>
      <li><span class="n">4</span><span>The mover gets the rest. Each seat then adds its share of fees.</span></li>
    </ol>`;
}

function arcade() {
  const staking = STAKE.mode === 'stake';
  return `
    <p class="eyebrow">Arcade · $NIMORI staking</p>
    <h1>Stake to play first.</h1>
    <p class="lede">$NIMORI launched on Pons, the Robinhood Chain launchpad. Staking it is the Arcade.</p>

    <h2>What staking gives you</h2>
    <div class="perks">
      <div class="card perk"><div class="ico">${I.split}</div><b>Fee share</b><span>10% of trading fees earned by co-op positions, paid in ETH and pair tokens.</span></div>
      <div class="card perk"><div class="ico amber">${I.bolt}</div><b>Priority pass</b><span>Stakers get matched first in lobby queues.</span></div>
      <div class="card perk"><div class="ico ok">${I.vote}</div><b>Pair vote</b><span>Stakers choose which pairs open a lobby.</span></div>
    </div>

    <h2>Insert coin</h2>
    <div class="card action">
      <div class="seg" role="group" aria-label="Stake or unstake">
        <button type="button" data-smode="stake" aria-pressed="${staking}">Stake</button>
        <button type="button" data-smode="unstake" aria-pressed="${!staking}">Unstake</button>
      </div>
      <label class="field">
        <input inputmode="decimal" placeholder="0" aria-label="Amount of NIMORI" data-samt>
        <span class="unit">NIMORI</span>
        <button type="button" class="max" data-smax>MAX</button>
      </label>
      <dl class="kv">
        <dt>Demo wallet</dt><dd>${fmt(STAKE.wallet)} NIMORI</dd>
        <dt>Staked</dt><dd>${fmt(STAKE.staked)} NIMORI</dd>
        <dt>Fee share rate</dt><dd>Depends on real volume</dd>
      </dl>
      <button class="btn btn-primary btn-block" type="button" data-sgo>${staking ? 'Stake NIMORI' : 'Unstake NIMORI'}</button>
      <p class="muted" style="margin:12px 0 0">No APR is shown: there is no live volume yet, so any number would be made up.</p>
    </div>

    <h2>Next lobby vote</h2>
    <div class="card action">
      ${[['WETH / Pair A', 46], ['WETH / Pair B', 31], ['WETH / Pair C', 23]].map(([n, v]) => `
        <div class="vote"><span>${n}</span><span class="mono">${v}%</span><span class="bar"><i style="width:${v}%"></i></span></div>`).join('')}
      <p class="muted" style="margin:10px 0 0">Candidate pairs, simulated tallies.</p>
    </div>
    <div class="note">${I.info}<span><b>Staking risk.</b> Staked NIMORI is exposed to the token price and to smart contract risk. No audit is claimed here.</span></div>
  `;
}

function docs() {
  return `
    <p class="eyebrow">Docs</p>
    <h1>Liquidity, two-player mode.</h1>
    <p class="lede">Player 1 deposits ETH. Player 2 deposits the token. NIMORI matches them, opens one position on Robinhood Chain and splits the fees between two seats.</p>
    <nav class="toc" aria-label="Docs sections">
      <a href="#/docs" data-anchor="d-match">Match</a><a href="#/docs" data-anchor="d-diff">Difficulty</a><a href="#/docs" data-anchor="d-session">Session</a>
      <a href="#/docs" data-anchor="d-exit">Mover rule</a><a href="#/docs" data-anchor="d-swap">Hot swap</a><a href="#/docs" data-anchor="d-token">$NIMORI</a><a href="#/docs" data-anchor="d-risk">Risks</a>
    </nav>
    <div class="card doc">
      <h2 id="d-match">1. The match</h2>
      <p>Every pair has two queues: 1P (ETH) and 2P (token). A deposit waits until one arrives on the other side; while waiting it earns nothing and can be withdrawn anytime, free. Matching is FIFO by value at the pool price, with TWAP checked against spot.</p>
      ${figMatch()}
      <h2 id="d-diff">2. Difficulty</h2>
      <p>Both players pick the same range width. Easy is full range, Normal is wide around spot, Hard is narrow.</p>
      ${figDifficulty()}
      <h2 id="d-session">3. The session</h2>
      <p>Each seat is an ERC-721 save file with the entry snapshot and the fee split. Sell it and the buyer inherits the session.</p>
      ${figTimeline()}
      <h2 id="d-exit">4. At unplug: the mover rule</h2>
      <p>Compare each asset's USD move since entry. The one that moved more is the mover and carries the IL. The non-mover gets their deposit back in their own asset, <b>as long as the position covers it</b>.</p>
      ${figPayouts()}
      <h2 id="d-swap">5. Hot swap</h2>
      <p>When one player leaves, the position does not have to close.</p>
      ${figHotSwap()}
      <h2 id="d-token">6. $NIMORI and fees</h2>
      <p>$NIMORI launched on Pons. Pons pools pay no swap fees to LPs, so co-op positions live in NIMORI pools instead.</p>
      ${figFees()}
      <h2 id="d-risk">Risks</h2>
      <ol class="steps">
        <li><span class="n">!</span><span><b>Smart contracts</b> can have bugs. Audit status is published before deposits open.</span></li>
        <li><span class="n">!</span><span><b>Mover risk.</b> If your asset moves more than your partner's, you carry the IL.</span></li>
        <li><span class="n">!</span><span><b>Cap.</b> Past roughly −75% on one asset (full range), the non-mover is not repaid in full.</span></li>
        <li><span class="n">!</span><span><b>Range (Hard).</b> Narrow positions can go out of range and stop earning.</span></li>
        <li><span class="n">!</span><span><b>Lobby wait.</b> If the other queue is empty, your deposit earns nothing.</span></li>
      </ol>
    </div>
  `;
}

const ROUTES = { lobby, session, arcade, docs };

// ---------- console screen content (drawn inside the 3D scene, never an HTML overlay) ----------
function screenFor(route) {
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
const lidOpenFor = (route) => route === 'arcade' || route === 'docs' || (route === 'session' && state.plugged);

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
}

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

$('[data-connect]').addEventListener('click', () => openModal({
  icon: I.wallet,
  title: 'Connect wallet',
  explain: 'Contracts are not deployed yet, so wallets are off in this demo.',
  body: `<div class="wallets">${['MetaMask', 'Rabby', 'Coinbase Wallet', 'WalletConnect'].map((w) => `<button type="button" disabled>${w}<small>Soon</small></button>`).join('')}</div>`,
  cancel: 'Close',
}));
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
