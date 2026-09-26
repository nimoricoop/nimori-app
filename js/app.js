// NIMORI mockup — app shell + hash router. The router only swaps #screen; the canvas in #stage is never touched.
import { createScene } from './scene.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// ---------- simulated state (nothing here is on-chain) ----------
const state = {
  difficulty: 'normal',
  amount: '16000',
  plugged: false,
  matchedAt: 0,
};
const SIM = {
  tokenUsd: 0.1, // simulated NIMORI price
  ethUsd: 2000,  // simulated ETH price
  queues: {
    easy: { p1: [['0x3f1…a91c', '1.20 ETH', '41m'], ['0x9b0…07e2', '0.50 ETH', '12m']], p2: [] },
    normal: { p1: [['0x5d7…c3b8', '0.80 ETH', '18m'], ['0xa04…11f9', '0.35 ETH', '6m']], p2: [] },
    hard: { p1: [['0x71e…9d02', '0.40 ETH', '2h 04m']], p2: [] },
  },
};
const DIFF = {
  easy: { label: 'Easy', range: [1, 1, 1, 1, 1], note: 'Full range. Lower fees, lowest IL.' },
  normal: { label: 'Normal', range: [0, 1, 1, 1, 0], note: 'Wide range around spot. Medium fees, medium IL.' },
  hard: { label: 'Hard', range: [0, 0, 1, 0, 0], note: 'Narrow range. Highest fees, highest IL, can go out of range and stop earning.' },
};

// ---------- scene (created once) ----------
let scene = null;
try {
  scene = createScene($('#stage'));
  window.__nimoriScene = scene;
} catch (err) {
  console.warn('WebGL unavailable, showing the flat stage instead.', err);
}

// ---------- helpers ----------
const fmt = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const rangeViz = (d) => `<span class="rangeviz" aria-hidden="true">${DIFF[d].range.map((o) => `<i class="${o ? 'on' : ''}"></i>`).join('')}</span>`;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}
// ---------- modal (pattern from the OPUS mockup) ----------
let lastFocus = null;
function openModal({ title, explain = '', rows = [], risk = '', body = '', cancel = 'Cancel', confirm = null, onConfirm = null }) {
  lastFocus = document.activeElement;
  $('#modalCard').innerHTML = `
    <h2 id="modalTitle">${title}</h2>
    ${explain ? `<p class="explain">${explain}</p>` : ''}
    ${rows.length ? `<div class="summary">${rows.map(([k, v]) => `<div class="row"><span>${k}</span><b>${v}</b></div>`).join('')}</div>` : ''}
    ${body}
    ${risk ? `<p class="risk">${risk}</p>` : ''}
    <div class="row2">
      <button class="btn btn-cream" type="button" data-close>${cancel}</button>
      ${confirm ? `<button class="btn btn-red" type="button" data-confirm>${confirm}</button>` : ''}
    </div>
    <p class="demo-note">DEMO · simulated. Nothing is signed or sent.</p>`;
  $('#modal').hidden = false;
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
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

// Seat value at simulated current prices, full-range math + mover rule (docs 3.6).
// Prices drift a little with session time so the numbers are not frozen.
function seatQuote() {
  const eth = parseFloat(SIM.queues[state.difficulty].p1[0][1]);
  const tokens = parseFloat(state.amount) || 0;
  const mins = (Date.now() - state.matchedAt) / 60000;
  const dEth = 0.012, dTok = 0.048 + Math.min(mins, 600) * 0.0001; // simulated moves since entry
  const e1 = SIM.ethUsd * (1 + dEth), t1 = SIM.tokenUsd * (1 + dTok);
  // full-range x*y=k: value = 2*sqrt(k * pTok * pEth) in USD, entry k from the two deposits
  const k = (eth * SIM.ethUsd / SIM.ethUsd) * tokens; // eth units * token units
  const ratio = t1 / e1; // token price in ETH
  const ethOut = Math.sqrt(k * ratio), tokOut = Math.sqrt(k / ratio);
  const value = ethOut * e1 + tokOut * t1;
  const hold1 = eth * e1, hold2 = tokens * t1;
  const tokenMover = Math.abs(dTok) >= Math.abs(dEth);
  const covered = value >= (tokenMover ? hold1 : hold2);
  const p1 = tokenMover ? Math.min(hold1, value) : value - Math.min(hold2, value);
  const p2 = value - p1;
  return { dEth, dTok, value, p1, p2, tokenMover, covered };
}
const usd = (n) => '$' + fmt(n, 2);
const pct = (n) => (n >= 0 ? '+' : '') + (n * 100).toFixed(1) + '%';

function setHud() {
  const hud = $('#hud');
  hud.classList.toggle('ok', state.plugged);
  $('#hud-label').textContent = state.plugged ? 'player 2 connected · session live' : 'waiting for player 2';
  $('#hud-bar').textContent = state.plugged ? '▮▮▮▮▮' : '▮▮▮▯▯';
}

// ---------- screens ----------
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
      <div class="savefile empty">
        <div class="slot">EMPTY SLOT</div>
        <p style="color:#c9a98a;margin:8px 0 0">A seat NFT is minted for each side when a match opens a position.</p>
      </div>
      <button class="btn btn-block" type="button" data-go="lobby" style="margin-top:12px">Go to the lobby</button>
      ${sessionRules()}
    `;
  }
  const eth = parseFloat(SIM.queues[state.difficulty].p1[0][1]);
  const tokens = parseFloat(state.amount) || 0;
  const unlocked = Date.now() - state.matchedAt >= 24 * 3600 * 1000;
  return `
    <p class="eyebrow">Session · NIMORI / ETH · ${DIFF[state.difficulty].label}</p>
    <h1>Save file #0142</h1>
    <p class="lede">Your seat is an ERC-721. Sell it and the buyer inherits the session.</p>

    <div class="savefile">
      <div class="savefile-h"><span class="slot">SEAT 2P</span><span class="badge">NIMORI SIDE</span></div>
      <dl class="kv">
        <dt>Partner</dt><dd>1P · ${SIM.queues[state.difficulty].p1[0][0]}</dd>
        <dt>Your deposit</dt><dd>${fmt(tokens)} NIMORI</dd>
        <dt>Partner deposit</dt><dd>${eth} ETH</dd>
        <dt>Entry ETH / USD</dt><dd>$${fmt(SIM.ethUsd)} (sim.)</dd>
        <dt>Entry NIMORI / USD</dt><dd>$${SIM.tokenUsd.toFixed(2)} (sim.)</dd>
        <dt>Range</dt><dd>${DIFF[state.difficulty].label} ${rangeViz(state.difficulty)}</dd>
      </dl>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:#c9a98a"><span>fee split 2P</span><span>1P</span></div>
      <div class="split"><i style="width:50%;background:#f3ae15"></i><i style="width:50%;background:#fef3d5"></i></div>
      <div style="display:flex;justify-content:space-between;font-size:12px"><span>50%</span><span>50%</span></div>
      <hr style="border-color:rgba(254,243,213,.15)">
      <div style="display:flex;justify-content:space-between;align-items:end;gap:10px">
        <div><div style="color:#c9a98a;font-size:12px">session clock</div><div class="clock" data-clock>00:00:00</div></div>
        <div style="text-align:right;color:#c9a98a;font-size:12px">${unlocked ? 'unplug<br>unlocked' : 'unplug unlocks<br>at 24:00:00'}</div>
      </div>
    </div>

    <div class="actions">
      ${unlocked
        ? '<button class="btn btn-cream" type="button" data-unplug>Unplug</button>'
        : '<button class="btn btn-cream" type="button" disabled title="Available after 24 h">Unplug</button><button class="btn" type="button" data-ragequit>Rage quit (−1%)</button>'}
    </div>
    ${unlocked ? '' : '<p style="margin:8px 0 0"><button class="linkbtn" type="button" data-skip>demo: skip to 24 h</button></p>'}
    <p class="muted" style="margin-top:10px">Rage quit before 24 h pays 1% of your seat value to your partner. After 24 h, unplug is free. If a 2P is waiting on the same difficulty, they hot-swap into your seat and the position stays open.</p>
    ${sessionRules()}
  `;
}
function sessionRules() {
  return `
    <h2>At unplug: the mover rule</h2>
    <ol class="list">
      <li><span class="n">1</span><span>Compare each asset's USD move since entry.</span></li>
      <li><span class="n">2</span><span>The asset that moved more is the <b>mover</b>.</span></li>
      <li><span class="n">3</span><span>The non-mover gets their deposit back in their own asset, <b>as long as the position covers it</b>.</span></li>
      <li><span class="n">4</span><span>The mover gets the rest. Each seat then adds its share of fees.</span></li>
    </ol>
    <p class="risk"><b>Example (simulated).</b> Token doubles, ETH flat: 1P gets 1 ETH back, 2P gets $3,656.85 on a $2,000 entry and carries the $343.15 of IL. Token −50%: 1P gets 1 ETH, 2P gets $828.43. Past roughly −75% on the token, the position no longer covers 1P in full.</p>
  `;
}

function arcade() {
  return `
    <p class="eyebrow">Arcade · $NIMORI staking</p>
    <h1>Stake to play first.</h1>
    <p class="lede">$NIMORI launched on Pons, the Robinhood Chain launchpad. Staking it is the Arcade.</p>

    <ol class="list">
      <li><span class="n">1</span><span><b>Fee share.</b> 10% of trading fees earned by co-op positions goes to stakers, paid in ETH and pair tokens.</span></li>
      <li><span class="n">2</span><span><b>Priority pass.</b> Stakers get matched first in the lobby queue.</span></li>
      <li><span class="n">3</span><span><b>Pair vote.</b> Stakers vote on which pairs open a lobby.</span></li>
    </ol>

    <h2>Stake</h2>
    <label class="field">
      <input inputmode="decimal" aria-label="Stake amount" placeholder="0" data-stake>
      <span class="unit">NIMORI</span>
    </label>
    <dl class="kv">
      <dt>Wallet balance</dt><dd>— connect wallet</dd>
      <dt>Your stake</dt><dd>0</dd>
      <dt>Fee share rate</dt><dd>depends on real volume</dd>
    </dl>
    <button class="btn btn-block" type="button" data-stakebtn>Stake NIMORI</button>
    <p class="muted" style="margin-top:8px">No APR is shown: there is no live volume yet, and a number here would be made up.</p>

    <h2>Next lobby vote</h2>
    <p class="muted">Candidate pairs, simulated tallies.</p>
    ${[['WETH / Pair A', 46], ['WETH / Pair B', 31], ['WETH / Pair C', 23]].map(([n, v]) => `
      <div class="vote"><span>${n}</span><span class="mono">${v}%</span><span class="bar"><i style="width:${v}%"></i></span></div>`).join('')}
    <p class="risk"><b>Staking risk.</b> Staked NIMORI is exposed to the token price and to smart contract risk. Audits will be published before launch; none is claimed here.</p>
  `;
}

function docs() {
  return `
    <p class="eyebrow">Docs</p>
    <h1>Liquidity, two-player mode.</h1>
    <p class="lede">Player 1 deposits ETH. Player 2 deposits the token. NIMORI matches them, opens one Uniswap v4 position on Robinhood Chain and splits the fees between two seats.</p>
    <nav class="toc" aria-label="Docs sections">
      <a href="#/docs" data-anchor="d-lobby">Lobby</a><a href="#/docs" data-anchor="d-diff">Difficulty</a><a href="#/docs" data-anchor="d-session">Session</a>
      <a href="#/docs" data-anchor="d-exit">Exit</a><a href="#/docs" data-anchor="d-token">$NIMORI</a><a href="#/docs" data-anchor="d-risk">Risks</a>
    </nav>

    <h2 id="d-lobby">The lobby</h2>
    <p>Every pair has two queues: 1P (ETH) and 2P (token). A deposit waits until one arrives on the other side. While waiting it earns nothing and can be withdrawn anytime, free. Matching is FIFO by value at the pool price, with TWAP checked against spot. A larger deposit is partly filled; the rest stays in line.</p>

    <h2 id="d-diff">Difficulty</h2>
    <table class="tbl">
      <tr><th>Mode</th><th>Range</th><th>Fees</th><th>Risk</th></tr>
      <tr><td>Easy</td><td>Full</td><td>Lower</td><td>Lowest IL</td></tr>
      <tr><td>Normal</td><td>Wide</td><td>Medium</td><td>Medium IL</td></tr>
      <tr><td>Hard</td><td>Narrow</td><td>Highest</td><td>Highest IL, can go out of range</td></tr>
    </table>

    <h2 id="d-session">Session and seats</h2>
    <p>A match opens one v4 position and mints two Seat NFTs, 1P and 2P, with the entry snapshot and the fee split. Default split 50/50. When one queue is much longer, the scarce side gets a seat bonus, up to 70/30. A protocol fee of 10% of trading fees is taken before the split.</p>

    <h2 id="d-exit">Unplug, hot swap, rage quit</h2>
    <p><b>Unplug</b> after the 24 h minimum. The mover carries the IL; the non-mover gets their deposit back as long as the position covers it. <b>Hot swap</b>: a player waiting on the same side and difficulty takes the empty seat, no unwind. <b>Rage quit</b> before 24 h costs 1% of seat value, paid to the partner.</p>

    <h2 id="d-token">$NIMORI</h2>
    <p>Launched on Pons. Staking gives a share of the 10% protocol fee, lobby priority and pair votes. No snapshot, no pre-launch tier.</p>

    <h2 id="d-risk">Risks</h2>
    <ul class="list">
      <li><span class="n">!</span><span><b>Smart contracts</b> can have bugs. Audits will be published before launch.</span></li>
      <li><span class="n">!</span><span><b>Mover risk.</b> If your asset moves more than your partner's, you carry the IL.</span></li>
      <li><span class="n">!</span><span><b>Cap.</b> The non-mover's claim is capped at the position value. Past roughly −75% on the token, 1P is not repaid in full.</span></li>
      <li><span class="n">!</span><span><b>Range (Hard).</b> Narrow positions can go out of range and stop earning.</span></li>
      <li><span class="n">!</span><span><b>Oracle.</b> Bad price data could misassign IL. TWAP checks and staleness guards reduce it.</span></li>
      <li><span class="n">!</span><span><b>Lobby wait.</b> If the other queue is empty, your deposit earns nothing.</span></li>
    </ul>
  `;
}

const ROUTES = { lobby, session, arcade, docs };

// ---------- router ----------
const screen = $('#screen');
let clockTimer = 0;
function render() {
  const name = (location.hash.replace(/^#\/?/, '').split('/')[0]) || 'lobby';
  const route = ROUTES[name] ? name : 'lobby';
  screen.innerHTML = ROUTES[route]();
  screen.scrollTop = 0;
  $$('.tabs a').forEach((a) => (a.dataset.route === route ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  document.title = `NIMORI · ${route[0].toUpperCase() + route.slice(1)}`;
  scene?.setView(route);
  scene?.setDifficulty(state.difficulty);
  bind(route);
  clearInterval(clockTimer);
  if (route === 'session' && state.plugged) {
    const el = $('[data-clock]', screen);
    const tick = () => {
      const s = Math.floor((Date.now() - state.matchedAt) / 1000);
      el.textContent = [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, '0')).join(':');
    };
    tick();
    clockTimer = setInterval(tick, 1000);
  }
}

function bind(route) {
  $$('[data-diff]', screen).forEach((b) => b.addEventListener('click', () => {
    state.difficulty = b.dataset.diff;
    scene?.setDifficulty(state.difficulty);
    render();
  }));
  const amt = $('[data-amount]', screen);
  if (amt) amt.addEventListener('input', () => {
    state.amount = amt.value.replace(/[^\d.]/g, '');
    const usd = (parseFloat(state.amount) || 0) * SIM.tokenUsd;
    $('[data-usd]', screen).textContent = `≈ $${fmt(usd)}`;
  });
  $('[data-plug]', screen)?.addEventListener('click', confirmPlug);
  $('[data-reset]', screen)?.addEventListener('click', () => {
    state.plugged = false;
    scene?.unplug2P();
    setHud();
    render();
  });
  $$('[data-go]', screen).forEach((b) => b.addEventListener('click', () => { location.hash = `#/${b.dataset.go}`; }));
  $('[data-ragequit]', screen)?.addEventListener('click', () => openExit(true));
  $('[data-unplug]', screen)?.addEventListener('click', () => openExit(false));
  $('[data-skip]', screen)?.addEventListener('click', () => { state.matchedAt -= 24 * 3600 * 1000; render(); toast('Demo clock moved forward 24 h.'); });
  $('[data-stakebtn]', screen)?.addEventListener('click', () => {
    const n = parseFloat(($('[data-stake]', screen).value || '').replace(/[^\d.]/g, ''));
    if (!(n > 0)) { toast('Enter an amount to stake.'); return; }
    openModal({
      title: 'Insert coin?',
      explain: 'Staking puts you in the Arcade.',
      rows: [
        ['You stake', `${fmt(n)} NIMORI`],
        ['Fee share', '10% of co-op trading fees, pro rata'],
        ['Priority pass', 'matched first in lobby queues'],
        ['Pair vote', 'on'],
      ],
      risk: 'Staked NIMORI stays exposed to the token price and to smart contract risk.',
      cancel: 'Back',
      confirm: 'Stake',
      onConfirm: () => toast(`Staked ${fmt(n)} NIMORI (simulated). Priority pass on.`),
    });
  });
  $$('[data-anchor]', screen).forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const target = $(`#${a.dataset.anchor}`, screen);
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

function confirmPlug() {
  if (!(parseFloat(state.amount) > 0)) { toast('Enter an amount first.'); return; }
  const head = SIM.queues[state.difficulty].p1[0];
  const tokens = parseFloat(state.amount);
  openModal({
    title: 'Plug in as 2P?',
    explain: `You join the NIMORI queue on ${DIFF[state.difficulty].label}. The head of the 1P queue is waiting, so this matches right away.`,
    rows: [
      ['You deposit', `${fmt(tokens)} NIMORI`],
      ['Value at pool price', `≈ $${fmt(tokens * SIM.tokenUsd)}`],
      ['Matched with', `1P · ${head[0]} · ${head[1]}`],
      ['Range', DIFF[state.difficulty].label],
      ['Fee split', '50 / 50'],
      ['Min session', '24 h, then unplug is free'],
    ],
    risk: '<b>You are 2P.</b> If NIMORI moves more than ETH, you carry the IL. 1P gets their ETH back as long as the position covers it.',
    cancel: 'Not yet',
    confirm: 'Plug in',
    onConfirm: plugIn,
  });
}

function openExit(early) {
  const q = seatQuote();
  const pen = early ? q.p2 * 0.01 : 0;
  const hot = SIM.queues[state.difficulty].p2.length > 0;
  openModal({
    title: early ? 'Rage quit?' : 'Unplug?',
    explain: `At current simulated prices (ETH ${pct(q.dEth)}, NIMORI ${pct(q.dTok)} since entry).`,
    rows: [
      ['Mover', q.tokenMover ? 'NIMORI (2P, you)' : 'ETH (1P)'],
      ['Position value', usd(q.value)],
      ['Your seat value', usd(q.p2)],
      ...(early ? [['Rage quit penalty (1%, to 1P)', '−' + usd(pen)]] : []),
      ['You receive', usd(q.p2 - pen)],
      ['After you leave', hot ? 'Hot swap: next 2P takes your seat' : 'Position unwinds, both seats paid'],
    ],
    risk: q.covered ? '' : 'The position does not cover the non-mover\'s deposit at these prices: the cap applies.',
    cancel: 'Keep playing',
    confirm: early ? 'Rage quit' : 'Unplug',
    onConfirm: () => {
      state.plugged = false;
      scene?.unplug2P();
      setHud();
      location.hash = '#/lobby';
      render();
      toast(early ? `Rage quit. ${usd(pen)} paid to 1P (simulated).` : 'Unplugged. Position unwound, both seats paid (simulated).');
    },
  });
}

function plugIn() {
  if (state.plugged) return;
  if (!(parseFloat(state.amount) > 0)) { toast('Enter an amount first.'); return; }
  state.plugged = true;
  state.matchedAt = Date.now();
  scene?.plug2P();
  const btn = $('[data-plug]', screen);
  if (btn) { btn.disabled = true; btn.textContent = 'Plugging in…'; }
  setTimeout(() => {
    const m = $('#matched');
    m.classList.add('show');
    setHud();
    render();
    setTimeout(() => m.classList.remove('show'), 2400);
  }, scene ? 1500 : 200);
}

$('[data-connect]').addEventListener('click', () => openModal({
  title: 'Connect wallet',
  explain: 'Contracts are not deployed yet, so wallets are off in this demo.',
  body: `<div class="wallets">${['MetaMask', 'Rabby', 'Coinbase Wallet', 'WalletConnect'].map((w) => `<button type="button" disabled>${w}<small>soon</small></button>`).join('')}</div>`,
  cancel: 'Close',
}));
window.addEventListener('hashchange', render);
if (!location.hash) history.replaceState(null, '', '#/lobby');
setHud();
render();
