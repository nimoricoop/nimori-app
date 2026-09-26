/* NIMORI · OPUS mockup — vanilla JS, no build step. Every number here is simulated. */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ data (simulated) */
  var ETH_USD = 2000;            // entry reference price (demo)
  var ETH_USD_NOW = 2036;        // "current" simulated price (+1.8%)
  var DIFFS = {
    easy:   { name: 'Easy',   range: 'Full range',              fees: 'Lower fees',   risk: 'Lowest IL',                  k: 1e9,  w: 100 },
    normal: { name: 'Normal', range: 'Wide range around spot',  fees: 'Medium fees',  risk: 'Medium IL',                  k: 3,    w: 58 },
    hard:   { name: 'Hard',   range: 'Narrow range around spot',fees: 'Highest fees', risk: 'Highest IL, can go out of range', k: 1.35, w: 22 }
  };
  // Queues: only one side can be deep at a time (if both had deposits, they would already be matched).
  // q = { side waiting: 1 | 2 | 0, value in ETH, deposits, bonus % for the scarce side }
  var PAIRS = [
    { id: 'nimori', sym: 'NIMORI', usd: 0.0004,  usdNow: 0.000312, q: {
      easy:   { side: 1, eth: 14.2, n: 11, bonus: 64 },
      normal: { side: 1, eth: 6.85, n: 7,  bonus: 58 },
      hard:   { side: 2, eth: 1.9,  n: 3,  bonus: 55 } } },
    { id: 'mochi', sym: 'MOCHI', usd: 0.0125, usdNow: 0.0131, q: {
      easy:   { side: 2, eth: 4.4,  n: 5,  bonus: 60 },
      normal: { side: 2, eth: 9.1,  n: 9,  bonus: 67 },
      hard:   { side: 0, eth: 0,    n: 0,  bonus: 50 } } },
    { id: 'hoot', sym: 'HOOT', usd: 0.087, usdNow: 0.081, q: {
      easy:   { side: 1, eth: 3.05, n: 4,  bonus: 57 },
      normal: { side: 0, eth: 0,    n: 0,  bonus: 50 },
      hard:   { side: 1, eth: 0.8,  n: 2,  bonus: 53 } } },
    { id: 'crane', sym: 'CRANE', usd: 1.42, usdNow: 1.47, q: {
      easy:   { side: 1, eth: 22.6, n: 17, bonus: 70 },
      normal: { side: 1, eth: 5.4,  n: 6,  bonus: 61 },
      hard:   { side: 2, eth: 2.2,  n: 2,  bonus: 56 } } }
  ];
  var WALLET = { eth: 3.5, nimori: 420000, tokEth: 1.5 }; // token balances expressed as ETH value

  var state = {
    pair: PAIRS[0], diff: 'easy', side: 1, amount: '0.50',
    mine: [],                       // my unmatched lobby deposits
    connected: false,
    matchAnim: false,
    slots: [], slot: 0,
    whatIf: { e: 1.8, t: -22 },
    stake: { staked: 0, total: 186400000, input: '100000' },
    votes: [
      { pair: 'ETH / LUMA',  w: 41200000 },
      { pair: 'ETH / KOI',   w: 33800000 },
      { pair: 'ETH / PIXEL', w: 21500000 },
      { pair: 'ETH / TOFU',  w: 9700000 }
    ],
    myVote: -1
  };

  var HOUR = 3600e3, now = Date.now();
  state.slots.push({
    no: 1, pair: PAIRS[0], side: 1, diff: 'easy', ethDep: 1, tokDep: 5000000,
    split: [50, 50], started: now - (31 * HOUR + 13 * 60e3 + 5e3), fees: { eth: 0.0142, tok: 71200 }, seat: 412, partner: 413
  });
  state.slots.push({
    no: 2, pair: PAIRS[1], side: 2, diff: 'normal', ethDep: 0.75, tokDep: 120000,
    split: [38, 62], started: now - (5 * HOUR + 40 * 60e3), fees: { eth: 0.0031, tok: 1840 }, seat: 588, partner: 587
  });

  /* ------------------------------------------------------------------ helpers */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function nf(x, d) { return Number(x).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); }
  function eth(x) { return nf(x, x < 1 ? 4 : 2); }
  function usd(x) { return (x < 0 ? '−$' : '$') + nf(Math.abs(x), 2); }
  function compact(x) {
    if (x >= 1e9) return nf(x / 1e9, 2) + 'B';
    if (x >= 1e6) return nf(x / 1e6, 2) + 'M';
    if (x >= 1e4) return nf(x / 1e3, 1) + 'K';
    return nf(x, x < 10 ? 2 : 0);
  }
  function pct(x) { return (x > 0 ? '+' : x < 0 ? '−' : '') + nf(Math.abs(x), 1) + '%'; }
  function tokOfEth(p, e) { return e * ETH_USD / p.usd; }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var toastT;
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }

  /* ------------------------------------------------------------------ router + D-pad */
  var ROUTES = ['lobby', 'session', 'arcade', 'docs'];
  var ARROWS = { ArrowUp: 'lobby', ArrowRight: 'session', ArrowDown: 'arcade', ArrowLeft: 'docs' };
  function route() {
    var r = (location.hash.replace(/^#\/?/, '') || 'lobby').split('/')[0];
    if (ROUTES.indexOf(r) < 0) r = 'lobby';
    $$('.screen').forEach(function (s) { s.classList.toggle('is-on', s.getAttribute('data-screen') === r); });
    $$('[data-nav]').forEach(function (a) {
      var on = a.getAttribute('data-nav') === r;
      a.classList.toggle('is-on', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = 'NIMORI · ' + r.charAt(0).toUpperCase() + r.slice(1);
    if (r === 'session') renderSession();
    if (r === 'arcade') renderArcade();
    window.scrollTo(0, 0); $('#toast').classList.remove('show');
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (!$('#modal').hidden) { if (e.key === 'Escape') closeModal(); return; }
    var to = ARROWS[e.key];
    if (to) { e.preventDefault(); location.hash = '#/' + to; }
  });

  /* ------------------------------------------------------------------ LOBBY: ports visual */
  function coilPath(x0, y0, x1, y1, cx, cy, loops, r) {
    // telephone cord: a helix projected along a quadratic bezier
    var pts = [], N = loops * 24;
    for (var i = 0; i <= N; i++) {
      var t = i / N, u = 1 - t;
      var bx = u * u * x0 + 2 * u * t * cx + t * t * x1;
      var by = u * u * y0 + 2 * u * t * cy + t * t * y1;
      var a = t * loops * Math.PI * 2;
      var rr = r * Math.min(1, t * 6);
      pts.push((bx + Math.cos(a) * rr).toFixed(1) + ',' + (by + Math.sin(a) * rr * 0.62).toFixed(1));
    }
    return 'M' + pts.join(' L');
  }
  function plug(cx, dir, cls) {
    var coil = dir < 0
      ? coilPath(cx, 262, cx - 150, 380, cx - 10, 330, 7, 13)
      : coilPath(cx, 262, cx + 140, 380, cx + 20, 330, 7, 13);
    return '<g class="' + cls + '">' +
      '<path d="' + coil + '" fill="none" stroke="#9C7F46" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="' + coil + '" fill="none" stroke="url(#gCable)" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M' + (cx - 26) + ',214 L' + (cx + 26) + ',214 L' + (cx + 15) + ',268 Q' + cx + ',274 ' + (cx - 15) + ',268 Z" fill="url(#gCream)" stroke="#9C7F46" stroke-width="2.5"/>' +
      '<rect x="' + (cx - 58) + '" y="164" width="116" height="56" rx="13" fill="url(#gCream)" stroke="#9C7F46" stroke-width="2.5"/>' +
      '<rect x="' + (cx - 50) + '" y="168" width="100" height="7" rx="3.5" fill="#fff" opacity=".6"/>' +
      '<g stroke="#C9B07A" stroke-width="2.5" stroke-linecap="round">' +
        '<line x1="' + (cx - 30) + '" y1="190" x2="' + (cx + 30) + '" y2="190"/>' +
        '<line x1="' + (cx - 30) + '" y1="198" x2="' + (cx + 30) + '" y2="198"/>' +
        '<line x1="' + (cx - 30) + '" y1="206" x2="' + (cx + 30) + '" y2="206"/></g>' +
      '</g>';
  }
  function port(cx, label) {
    var pins = '';
    for (var i = 0; i < 5; i++) pins += '<rect x="' + (cx - 30 + i * 13) + '" y="183" width="8" height="13" rx="1.5" fill="url(#gPin)"/>';
    return '' +
      '<text x="' + cx + '" y="121" text-anchor="middle" font-family="Bungee" font-size="34" fill="#FF5A5F" opacity=".55">' + label + '</text>' +
      '<text x="' + cx + '" y="119" text-anchor="middle" font-family="Bungee" font-size="34" fill="#A7000C">' + label + '</text>' +
      '<rect x="' + (cx - 88) + '' + '" y="137" width="176" height="110" rx="30" fill="url(#gBezel)"/>' +
      '<rect x="' + (cx - 88) + '" y="137" width="176" height="110" rx="30" fill="none" stroke="#FF6A6E" stroke-opacity=".35" stroke-width="2" transform="translate(0,1.5)"/>' +
      '<rect x="' + (cx - 66) + '" y="158" width="132" height="68" rx="17" fill="url(#gSock)"/>' +
      '<rect x="' + (cx - 66) + '" y="158" width="132" height="68" rx="17" fill="none" stroke="#000" stroke-opacity=".5" stroke-width="3"/>' +
      '<rect x="' + (cx - 38) + '" y="178" width="76" height="24" rx="5" fill="#2E2C2E"/>' + pins;
  }
  function portsSVG(q, anim) {
    // plugged: which ports hold a cable. The waiting side is plugged, the scarce side is empty (+ blinking LED)
    var p1 = q.side === 1 || anim, p2 = q.side === 2 || anim;
    var ledX1 = 190 - 118, ledX2 = 450 + 118;
    function led(x, blinking, on) {
      return '<circle cx="' + x + '" cy="192" r="19" fill="' + (blinking ? '#FF7A1A' : '#F3AE15') + '" opacity="' + (on ? '.35' : '0') + '" filter="url(#fBlur)" class="' + (blinking ? 'blinking' : '') + '"/>' +
        '<circle cx="' + x + '" cy="192" r="11" fill="#6B0B04"/>' +
        '<circle cx="' + x + '" cy="192" r="8" class="led-dot ' + (blinking ? 'blinking' : '') + '" fill="' + (blinking ? '#FF7A1A' : '#F3AE15') + '"/>' +
        (on ? '<circle cx="' + (x - 2.5) + '" cy="189" r="2.6" fill="#FFE2B8" class="' + (blinking ? 'blinking' : '') + '"/>' : '');
    }
    return '<svg class="ports-svg" viewBox="0 0 640 330" role="img" aria-label="Controller ports: 1P ' + (p1 ? 'connected' : 'empty') + ', 2P ' + (p2 ? 'connected' : 'empty') + '">' +
      '<defs>' +
        '<linearGradient id="gFace" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F11722"/><stop offset="1" stop-color="#C9000E"/></linearGradient>' +
        '<linearGradient id="gTop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FF4148"/><stop offset="1" stop-color="#EE0A17"/></linearGradient>' +
        '<linearGradient id="gBezel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9A000A"/><stop offset=".55" stop-color="#C4000E"/><stop offset="1" stop-color="#E0020F"/></linearGradient>' +
        '<linearGradient id="gSock" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#060101"/><stop offset="1" stop-color="#2B0906"/></linearGradient>' +
        '<linearGradient id="gPin" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FBDC84"/><stop offset="1" stop-color="#B07A00"/></linearGradient>' +
        '<linearGradient id="gCream" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFBEE"/><stop offset="1" stop-color="#E8D099"/></linearGradient>' +
        '<linearGradient id="gCable" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFF6DC"/><stop offset="1" stop-color="#E9D29C"/></linearGradient>' +
        '<filter id="fBlur" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="6"/></filter>' +
      '</defs>' +
      '<rect width="640" height="330" rx="22" fill="url(#gFace)"/>' +
      '<path d="M0 22 Q0 0 22 0 H618 Q640 0 640 22 V70 H0 Z" fill="url(#gTop)"/>' +
      '<rect y="70" width="640" height="3" fill="#FFFFFF" opacity=".35"/>' +
      '<rect y="73" width="640" height="14" fill="#6A0200" opacity=".14"/>' +
      '<g opacity=".5">' + [0, 1, 2, 3, 4, 5, 6, 7].map(function (i) { return '<rect x="' + (234 + i * 22) + '" y="26" width="12" height="26" rx="6" fill="#B8000D"/>'; }).join('') + '</g>' +
      port(190, '1P') + port(450, '2P') +
      led(ledX1, !p1, true) + led(ledX2, !p2, true) +
      (p1 ? plug(190, -1, 'plug1') : '') +
      (p2 ? plug(450, 1, 'plug2') : '') +
      '</svg>';
  }

  /* ------------------------------------------------------------------ LOBBY render */
  function curQ() { return state.pair.q[state.diff]; }
  function sideVal(q, s) { return q.side === s ? q.eth : 0; }
  function sideN(q, s) { return q.side === s ? q.n : 0; }

  function renderCarts() {
    $('#carts').innerHTML = PAIRS.map(function (p) {
      var qs = ['easy', 'normal', 'hard'].reduce(function (a, d) { return a + p.q[d].n; }, 0);
      return '<button class="cart' + (p === state.pair ? ' is-on' : '') + '" role="tab" aria-selected="' + (p === state.pair) + '" data-pair="' + p.id + '">' +
        '<span class="label"><span class="pair">ETH / ' + p.sym + '</span><span class="meta">' + qs + ' deposits waiting</span></span></button>';
    }).join('');
  }
  function renderPorts() {
    var q = curQ(), p = state.pair;
    $('#portsWrap').innerHTML = portsSVG(q, state.matchAnim);
    var cap;
    if (state.matchAnim) cap = 'match! two seats minted';
    else if (q.side === 1) cap = 'waiting for player 2';
    else if (q.side === 2) cap = 'waiting for player 1';
    else cap = 'lobby empty · press start';
    var sides = [1, 2].map(function (s) {
      var v = sideVal(q, s), n = sideN(q, s), max = Math.max(q.eth, 0.0001);
      var segs = v ? Math.max(1, Math.round((v / max) * 10)) : 0, cells = '';
      for (var i = 0; i < 10; i++) cells += '<i class="' + (i < segs ? 'on' : '') + '"></i>';
      var amt = !v ? 'Empty' : s === 1 ? eth(v) + ' <small>ETH</small>' : compact(tokOfEth(p, v)) + ' <small>' + p.sym + '</small>';
      var sub = v ? (s === 2 ? '≈ ' + eth(v) + ' ETH · ' : '') + 'deposits wait, earn nothing, withdraw free'
                  : 'next ' + s + 'P deposit matches instantly';
      return '<div class="q well"><div class="q-top"><span class="q-side">' + s + 'P queue</span><span class="q-n">' + n + ' deposit' + (n === 1 ? '' : 's') + '</span></div>' +
        '<div class="q-amt">' + amt + '</div><div class="q-sub">' + sub + '</div><div class="meter' + (s === 2 ? ' m2' : '') + '">' + cells + '</div></div>';
    });
    $('#queues').innerHTML = sides.join('');
    var scarce = q.side === 1 ? 2 : q.side === 2 ? 1 : 0;
    var s1 = scarce === 1 ? q.bonus : scarce === 2 ? 100 - q.bonus : 50, s2 = 100 - s1;
    $('#bonusStrip').className = 'bonus-strip sticker';
    $('#bonusStrip').innerHTML = '<div class="b-txt"><span class="blinkline" style="color:var(--maroon)">' + cap + (scarce ? '<span class="cells js-cells">▮▮▮▯▯</span>' : '') + '</span><br>' +
      (scarce ? 'Seat bonus on: the next <b>' + scarce + 'P</b> gets <b>' + q.bonus + '%</b> of session fees (max 70).' : 'Queues balanced: default split <b>50 / 50</b>.') + '</div>' +
      '<div class="splitbar" aria-label="Fee split if matched now"><span class="s1" style="width:' + s1 + '%">1P ' + s1 + '</span><span class="s2" style="width:' + s2 + '%">2P ' + s2 + '</span></div>';
    var railLed = $('#railLed');
    railLed.className = 'led ' + (scarce ? 'led-blink' : 'led-solid');
    $('#railLedTxt').textContent = scarce ? 'P' + scarce + ' WAITING' : 'BALANCED';
  }
  function renderDiff() {
    $('#diffMenu').innerHTML = Object.keys(DIFFS).map(function (k) {
      var d = DIFFS[k], on = k === state.diff, q = state.pair.q[k];
      var l = (100 - d.w) / 2;
      return '<button class="diff' + (on ? ' is-on' : '') + '" role="radio" aria-checked="' + on + '" data-diff="' + k + '">' +
        '<span class="cur">▶</span><span><span class="nm">' + d.name + '</span><span class="ds">' + d.range + ' · ' + d.fees + ' · ' + d.risk + '</span></span>' +
        '<span class="rng" title="Range width"><b style="left:calc(' + l + '% + 3px);right:calc(' + l + '% + 3px)"></b><em></em></span></button>';
    }).join('');
  }
  function amountNum() { var n = parseFloat(String(state.amount).replace(/,/g, '')); return isFinite(n) && n > 0 ? n : 0; }
  function amountEth() { var n = amountNum(); return state.side === 1 ? n : n * state.pair.usd / ETH_USD; }
  function renderDeposit() {
    var p = state.pair, q = curQ(), s = state.side, d = DIFFS[state.diff];
    var unit = s === 1 ? 'ETH' : p.sym;
    var bal = s === 1 ? WALLET.eth : tokOfEth(p, WALLET.tokEth);
    var other = s === 1 ? 2 : 1, otherVal = sideVal(q, other), sameVal = sideVal(q, s);
    var v = amountEth(), instant = Math.min(v, otherVal);
    var eta;
    if (otherVal > 0) eta = instant >= v ? 'Instant match' : 'Partial: ' + eth(instant) + ' ETH now, rest waits';
    else eta = 'Waits for ' + other + 'P · you are #' + (sideN(q, s) + 1);
    var scarce = q.side === 1 ? 2 : q.side === 2 ? 1 : 0;
    var mySplit = scarce === s ? q.bonus : scarce ? 100 - q.bonus : 50;
    $('#deposit').innerHTML =
      '<div class="plate-head"><span class="etch">Insert deposit</span><span class="mini-demo">DEMO · simulated</span></div>' +
      '<div class="switch well" role="tablist">' +
        '<button role="tab" aria-selected="' + (s === 1) + '" class="' + (s === 1 ? 'is-on' : '') + '" data-side="1">1P<small>bring ETH</small></button>' +
        '<button role="tab" aria-selected="' + (s === 2) + '" class="' + (s === 2 ? 'is-on' : '') + '" data-side="2">2P<small>bring ' + p.sym + '</small></button></div>' +
      '<label class="lcd"><input id="amt" inputmode="decimal" autocomplete="off" aria-label="Amount in ' + unit + '" value="' + esc(state.amount) + '"><span class="unit">' + unit + '</span></label>' +
      '<div class="chips"><button class="chip" data-frac=".25">25%</button><button class="chip" data-frac=".5">50%</button><button class="chip" data-frac="1">MAX</button>' +
        '<span class="chip-note">Wallet: ' + (s === 1 ? eth(bal) : compact(bal)) + ' ' + unit + '</span></div>' +
      '<div class="summary sticker">' +
        '<div class="row"><span>Lobby</span><b>ETH / ' + p.sym + ' · ' + d.name + '</b></div>' +
        '<div class="row"><span>Match</span><b>' + eta + '</b></div>' +
        '<div class="row"><span>Your fee share if matched now</span><b>' + mySplit + '%' + (mySplit > 50 ? ' (seat bonus)' : '') + '</b></div>' +
        '<div class="row"><span>While unmatched</span><b>Earns nothing · withdraw free</b></div>' +
      '</div>' +
      '<div class="ab"><p class="ab-note">A deposits into the ' + s + 'P queue. B withdraws your last unmatched deposit.</p>' +
        '<div class="ab-btns"><div class="round"><button class="round-btn b" id="btnB" aria-label="Withdraw last deposit"' + (state.mine.length ? '' : ' disabled') + '>B</button><span>WITHDRAW</span></div>' +
        '<div class="round"><button class="round-btn" id="btnA" aria-label="Deposit"' + (v > 0 ? '' : ' disabled') + '>A</button><span>DEPOSIT</span></div></div></div>' +
      '<p class="risk">' + (s === 1
        ? 'As 1P you get your ETH back at unplug as long as the position covers it. If the token falls more than about 75% on Easy, the cap applies and you receive the whole position instead.'
        : 'As 2P you carry the IL whenever your token moves more than ETH. That is what the seat bonus pays for.') + '</p>';
  }
  function renderMine() {
    var rows = state.mine.map(function (m, i) {
      return '<div class="mine-row well"><span class="seat-chip' + (m.side === 2 ? ' p2' : '') + '">' + m.side + 'P</span>' +
        '<span><span class="t">' + (m.side === 1 ? eth(m.amt) + ' ETH' : compact(m.amt) + ' ' + m.pair.sym) + ' · ETH / ' + m.pair.sym + ' · ' + DIFFS[m.diff].name + '</span><br>' +
        '<span class="s">Queue position #' + m.pos + ' · unmatched · earns nothing until matched</span></span>' +
        '<button class="key key-cream key-sm" data-withdraw="' + i + '">Withdraw</button></div>';
    }).join('');
    $('#mine').innerHTML = '<div class="plate-head"><span class="etch">Your lobby deposits</span><span class="mini-demo">DEMO · simulated</span></div>' +
      (rows ? '<div class="mine-list">' + rows + '</div>' : '<p class="empty">Nothing waiting. Deposits you make on the side that is already queued show up here until someone joins the other side.</p>');
  }
  function renderLobby() { renderCarts(); renderPorts(); renderDiff(); renderDeposit(); renderMine(); }

  function doDeposit() {
    var v = amountEth(); if (!(v > 0)) return;
    var p = state.pair, q = curQ(), s = state.side, other = s === 1 ? 2 : 1;
    var n = amountNum();
    var bal = s === 1 ? WALLET.eth : tokOfEth(p, WALLET.tokEth);
    if (n > bal + 1e-9) { toast('Not enough in the demo wallet. Try MAX.'); return; }
    var otherVal = sideVal(q, other);
    if (otherVal > 0) {
      var matched = Math.min(v, otherVal);
      q.eth = +(otherVal - matched).toFixed(6);
      if (q.eth <= 1e-6) { q.eth = 0; q.n = 0; q.side = 0; } else { q.n = Math.max(1, q.n - Math.ceil(q.n * matched / otherVal)); }
      var rest = v - matched;
      var scarceBonus = q.bonus;
      state.slots.push({
        no: state.slots.length + 1, pair: p, side: s, diff: state.diff,
        ethDep: matched, tokDep: tokOfEth(p, matched),
        split: s === 1 ? [scarceBonus, 100 - scarceBonus] : [100 - scarceBonus, scarceBonus],
        started: Date.now(), fees: { eth: 0, tok: 0 }, seat: 900 + state.slots.length, partner: 899 + state.slots.length, fresh: true
      });
      if (rest > 1e-6) {
        q.side = s; q.eth = +rest.toFixed(6); q.n = 1;
        state.mine.push({ pair: p, diff: state.diff, side: s, amt: s === 1 ? rest : tokOfEth(p, rest), pos: 1, q: q });
      }
      state.matchAnim = true;
      renderLobby();
      toast('Matched ' + eth(matched) + ' ETH of value · seat #' + (899 + state.slots.length) + ' minted (simulated). See Session ▶');
      setTimeout(function () { state.matchAnim = false; renderPorts(); }, 2600);
    } else {
      q.side = s; q.eth = +(q.eth + v).toFixed(6); q.n += 1;
      state.mine.push({ pair: p, diff: state.diff, side: s, amt: n, ethv: v, pos: q.n, q: q });
      renderLobby();
      toast('Deposited into the ' + s + 'P queue · #' + q.n + ' in line (simulated)');
    }
  }
  function doWithdraw(i) {
    var m = state.mine[i]; if (!m) return;
    var q = m.q, v = m.side === 1 ? m.amt : m.amt * m.pair.usd / ETH_USD;
    if (q.side === m.side) {
      q.eth = Math.max(0, +(q.eth - v).toFixed(6)); q.n = Math.max(0, q.n - 1);
      if (q.n === 0 || q.eth <= 1e-6) { q.eth = 0; q.n = 0; q.side = 0; }
    }
    state.mine.splice(i, 1);
    renderLobby();
    toast('Withdrawn, free. Nothing was matched, nothing earned.');
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-pair],[data-diff],[data-side],[data-frac],#btnA,#btnB,[data-withdraw],[data-slot],#btnUnplug,#btnSell,[data-close],#btnConfirm,#connect,[data-stake],[data-vote]');
    if (!t) return;
    if (t.hasAttribute('data-pair')) { state.pair = PAIRS.filter(function (p) { return p.id === t.getAttribute('data-pair'); })[0]; renderLobby(); }
    else if (t.hasAttribute('data-diff')) { state.diff = t.getAttribute('data-diff'); renderPorts(); renderDiff(); renderDeposit(); }
    else if (t.hasAttribute('data-side')) { state.side = +t.getAttribute('data-side'); state.amount = state.side === 1 ? '0.50' : String(Math.round(tokOfEth(state.pair, 0.5))); renderDeposit(); }
    else if (t.hasAttribute('data-frac')) {
      var f = +t.getAttribute('data-frac'), bal = state.side === 1 ? WALLET.eth : tokOfEth(state.pair, WALLET.tokEth);
      state.amount = state.side === 1 ? (bal * f).toFixed(4).replace(/0+$/, '').replace(/\.$/, '') : String(Math.floor(bal * f));
      renderDeposit();
    }
    else if (t.id === 'btnA') doDeposit();
    else if (t.id === 'btnB') doWithdraw(state.mine.length - 1);
    else if (t.hasAttribute('data-withdraw')) doWithdraw(+t.getAttribute('data-withdraw'));
    else if (t.hasAttribute('data-slot')) { state.slot = +t.getAttribute('data-slot'); var sl = state.slots[state.slot]; state.whatIf = defaultWhatIf(sl); renderSession(); }
    else if (t.id === 'btnUnplug') openUnplug();
    else if (t.id === 'btnSell') toast('Seats are ERC-721: list it on any marketplace, the buyer inherits the session. (Not live in this demo.)');
    else if (t.hasAttribute('data-close')) closeModal();
    else if (t.id === 'btnConfirm') confirmUnplug();
    else if (t.id === 'connect') { state.connected = !state.connected; t.innerHTML = state.connected ? '0xD3M0…0001 <small>demo</small>' : 'Connect <small>demo</small>'; toast(state.connected ? 'Demo wallet connected. No real wallet is touched.' : 'Demo wallet disconnected.'); }
    else if (t.hasAttribute('data-stake')) doStake(t.getAttribute('data-stake'));
    else if (t.hasAttribute('data-vote')) doVote(+t.getAttribute('data-vote'));
  });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'amt') {
      state.amount = e.target.value.replace(/[^0-9.,]/g, '');
      // refresh summary + button without rebuilding the input (keeps focus and caret)
      var pos = e.target.selectionStart;
      renderDeposit();
      var inp = $('#amt'); inp.focus(); try { inp.setSelectionRange(pos, pos); } catch (x) {}
    } else if (e.target.id === 'wiE' || e.target.id === 'wiT') {
      state.whatIf[e.target.id === 'wiE' ? 'e' : 't'] = +e.target.value;
      renderPreview();
    } else if (e.target.id === 'stakeAmt') {
      state.stake.input = e.target.value.replace(/[^0-9]/g, '');
    }
  });
  $('#modal').addEventListener('click', function (e) { if (e.target.id === 'modal') closeModal(); });

  /* ------------------------------------------------------------------ SESSION: math */
  // Uniswap v3/v4-style concentrated position, symmetric range in log space: [p0/k, p0*k], p = token price in ETH.
  function positionValueUsd(sl, e, t) {
    var k = DIFFS[sl.diff].k;
    var p0 = sl.pair.usd / ETH_USD, p1 = p0 * (1 + t / 100) / (1 + e / 100);
    var s0 = Math.sqrt(p0), sa = Math.sqrt(p0 / k), sb = Math.sqrt(p0 * k);
    var L = sl.ethDep / (s0 - sa);
    var s = Math.min(Math.max(Math.sqrt(p1), sa), sb);
    var x = L * (1 / s - 1 / sb), y = L * (s - sa);
    var ethUsd1 = ETH_USD * (1 + e / 100);
    return { value: (x * p1 + y) * ethUsd1, inRange: Math.sqrt(p1) > sa && Math.sqrt(p1) < sb };
  }
  function exitSplit(sl, e, t) {
    var ethUsd1 = ETH_USD * (1 + e / 100), tokUsd1 = sl.pair.usd * (1 + t / 100);
    var pv = positionValueUsd(sl, e, t), V = pv.value;
    var hold1 = sl.ethDep * ethUsd1, hold2 = sl.tokDep * tokUsd1;
    var mover = Math.abs(t) > Math.abs(e) ? 2 : 1;
    var nmHold = mover === 2 ? hold1 : hold2;
    var nm = Math.min(nmHold, V), mv = V - nm;
    var feesUsd = sl.fees.eth * ethUsd1 + sl.fees.tok * tokUsd1;
    var f1 = feesUsd * sl.split[0] / 100, f2 = feesUsd * sl.split[1] / 100;
    var r1 = (mover === 2 ? nm : mv) + f1, r2 = (mover === 2 ? mv : nm) + f2;
    return { V: V, inRange: pv.inRange, hold1: hold1, hold2: hold2, mover: mover, covered: nmHold <= V + 1e-9, r1: r1, r2: r2, f1: f1, f2: f2, feesUsd: feesUsd };
  }
  function defaultWhatIf(sl) {
    return { e: +(((ETH_USD_NOW / ETH_USD) - 1) * 100).toFixed(1), t: +(((sl.pair.usdNow / sl.pair.usd) - 1) * 100).toFixed(1) };
  }
  function played(sl) { return Date.now() - sl.started; }
  function fmtPlayed(ms) {
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
    return h + 'h ' + String(m).padStart(2, '0') + 'm ' + String(ss).padStart(2, '0') + 's';
  }

  /* ------------------------------------------------------------------ SESSION render */
  function renderSession() {
    var slotsEl = $('#slots'), body = $('#sessionBody');
    if (!state.slots.length) {
      slotsEl.innerHTML = '';
      body.innerHTML = '<div class="plate"><div class="plate-head"><span class="etch">No save files</span></div><p class="explain">You are not in a session. Go to the Lobby and fill a seat.</p><a class="key key-cream" href="#/lobby">▲ Lobby</a></div>';
      return;
    }
    if (state.slot >= state.slots.length) state.slot = 0;
    slotsEl.innerHTML = state.slots.map(function (sl, i) {
      var early = played(sl) < 24 * HOUR;
      return '<button class="slot' + (i === state.slot ? ' is-on' : '') + '" role="tab" aria-selected="' + (i === state.slot) + '" data-slot="' + i + '">' +
        '<span class="seat-chip' + (sl.side === 2 ? ' p2' : '') + '" style="width:38px;height:38px;font-size:12px">' + sl.side + 'P</span>' +
        '<span><span class="no">SAVE ' + String(sl.no).padStart(2, '0') + '</span><span class="nm">ETH / ' + sl.pair.sym + ' · ' + DIFFS[sl.diff].name + '</span>' +
        '<span class="st">' + (early ? 'under 24h · rage quit only' : 'unplug ready') + '</span></span></button>';
    }).join('');

    var sl = state.slots[state.slot], p = sl.pair, d = DIFFS[sl.diff];
    var me = sl.side, early = played(sl) < 24 * HOUR;
    var gate = Math.min(100, played(sl) / (24 * HOUR) * 100);
    body.innerHTML =
      '<div class="save">' +
        '<div class="save-notch"><span class="pins"><i></i><i></i><i></i><i></i><i></i><i></i></span><span class="tagline">SEAT NFT #' + sl.seat + '</span></div>' +
        '<div class="save-label sticker">' +
          '<div class="save-top"><span class="seat-chip' + (me === 2 ? ' p2' : '') + '">' + me + 'P</span>' +
            '<div><h2>SAVE ' + String(sl.no).padStart(2, '0') + ' · ETH / ' + p.sym + '</h2><div class="sub">' + d.name + ' · ' + d.range + ' · partner seat #' + sl.partner + '</div></div>' +
            '<span class="mini-demo">DEMO · simulated</span></div>' +
          '<div class="sec-h">Entry snapshot</div>' +
          '<dl class="snap">' +
            '<div><dt>1P deposit</dt><dd>' + eth(sl.ethDep) + ' ETH</dd></div>' +
            '<div><dt>2P deposit</dt><dd>' + compact(sl.tokDep) + ' ' + p.sym + '</dd></div>' +
            '<div><dt>Position</dt><dd>' + usd(sl.ethDep * ETH_USD * 2) + '</dd></div>' +
            '<div><dt>ETH / USD</dt><dd>' + usd(ETH_USD) + '</dd></div>' +
            '<div><dt>' + p.sym + ' / USD</dt><dd>$' + (p.usd < 0.01 ? p.usd.toFixed(6) : p.usd.toFixed(4)) + '</dd></div>' +
            '<div><dt>Pool price</dt><dd>' + compact(ETH_USD / p.usd) + ' ' + p.sym + '/ETH</dd></div>' +
          '</dl>' +
          '<div class="sec-h">Fee split · fixed at match</div>' +
          '<div class="splitbar"><span class="s1" style="width:' + sl.split[0] + '%">1P ' + sl.split[0] + '</span><span class="s2" style="width:' + sl.split[1] + '%">2P ' + sl.split[1] + '</span></div>' +
          '<div class="fees"><span>Fees accrued: ' + eth(sl.fees.eth) + ' ETH</span><span>+ ' + compact(sl.fees.tok) + ' ' + p.sym + '</span><span>10% protocol fee already taken</span></div>' +
          '<div class="sec-h">Time played</div>' +
          '<div class="clock"><span class="digits" id="clock">' + fmtPlayed(played(sl)) + '</span>' +
            '<span class="state" id="clockState">' + (early ? 'Minimum session is 24h. Leaving now is a rage quit.' : 'Past 24h: you can unplug with no penalty.') + '</span></div>' +
          '<div class="gate" aria-label="Progress to 24 hours"><b id="gateBar" style="width:' + gate + '%"></b></div>' +
        '</div>' +
      '</div>' +
      '<div class="stack">' +
        '<div class="plate">' +
          '<div class="plate-head"><span class="etch">Mover check · since entry</span><span class="mini-demo">DEMO · simulated</span></div>' +
          '<div class="mover" id="moverBox"></div>' +
          '<p class="explain" id="moverTxt"></p>' +
          '<div class="slider-row"><label for="wiE">What if ETH moves <b id="wiEv"></b></label><input type="range" id="wiE" min="-60" max="150" step="0.5" value="' + state.whatIf.e + '"></div>' +
          '<div class="slider-row"><label for="wiT">What if ' + p.sym + ' moves <b id="wiTv"></b></label><input type="range" id="wiT" min="-95" max="300" step="0.5" value="' + state.whatIf.t + '"></div>' +
          '<div class="payout" id="payout"></div>' +
          '<div id="cover"></div>' +
        '</div>' +
        '<div class="plate actions">' +
          '<div class="plate-head" style="margin-bottom:0"><span class="etch">' + (early ? 'Rage quit' : 'Unplug') + '</span></div>' +
          (early ? '<div class="rage"><b>RAGE QUIT</b>Unplugging before 24h costs 1% of your seat value, paid to your partner (≈ <span id="ragePen"></span> at current simulated prices).</div>' : '') +
          '<div class="row"><button class="key ' + (early ? 'key-red' : 'key-cream') + '" id="btnUnplug">' + (early ? 'Rage quit' : 'Unplug') + '</button>' +
          '<button class="key key-red" id="btnSell">Sell seat</button></div>' +
          '<p class="hot" id="hotTxt"></p>' +
        '</div>' +
      '</div>';
    renderPreview();
  }
  function hotSwapInfo(sl) {
    var q = sl.pair.q[sl.diff];
    return q.side === sl.side ? { yes: true, n: q.n } : { yes: false };
  }
  function renderPreview() {
    var sl = state.slots[state.slot]; if (!sl || !$('#payout')) return;
    var p = sl.pair, w = state.whatIf, r = exitSplit(sl, w.e, w.t), me = sl.side;
    $('#wiEv').textContent = pct(w.e); $('#wiTv').textContent = pct(w.t);
    $('#moverBox').innerHTML =
      '<div class="mv well' + (r.mover === 1 ? ' is-mover' : '') + '"><div class="k">ETH</div><div class="v">' + pct(w.e) + '</div>' + (r.mover === 1 ? '<span class="tag">MOVER</span>' : '') + '</div>' +
      '<div class="mv well' + (r.mover === 2 ? ' is-mover' : '') + '"><div class="k">' + p.sym + '</div><div class="v">' + pct(w.t) + '</div>' + (r.mover === 2 ? '<span class="tag">MOVER</span>' : '') + '</div>';
    var moverSide = r.mover, youMover = moverSide === me;
    $('#moverTxt').textContent = youMover
      ? 'Your asset moved more, so you are the mover: your partner gets their hold value back first and you receive the rest of the position.'
      : 'Your partner\'s asset moved more, so they are the mover: you get your hold value back as long as the position covers it.';
    $('#payout').innerHTML = [1, 2].map(function (s) {
      var val = s === 1 ? r.r1 : r.r2, hold = s === 1 ? r.hold1 : r.hold2;
      return '<div class="po sticker' + (s === me ? ' you' : '') + '"><div class="k">' + s + 'P' + (s === me ? ' · YOU' : '') + '</div><div class="v">' + usd(val) + '</div>' +
        '<div class="s">hold ' + usd(hold) + ' · fees ' + usd(s === 1 ? r.f1 : r.f2) + '</div></div>';
    }).join('');
    var nmSide = moverSide === 1 ? 2 : 1;
    var cov = r.covered
      ? '<div class="cover ok"><i></i><span>Position ' + usd(r.V) + ' covers ' + nmSide + 'P\'s hold value. ' + (r.inRange ? '' : 'Out of range: this position stopped earning fees. ') + (sl.diff === 'easy' ? 'On Easy the cap starts when the token is down about 75% vs ETH.' : '') + '</span></div>'
      : '<div class="cover cap"><i></i><span>Cap applies: the position (' + usd(r.V) + ') no longer covers ' + nmSide + 'P\'s hold value. ' + nmSide + 'P receives the whole position, ' + moverSide + 'P receives only fees.' + (r.inRange ? '' : ' Out of range.') + '</span></div>';
    $('#cover').innerHTML = cov + '<p class="explain" style="margin-top:10px;font-size:12px;opacity:.85">Preview at chosen prices, fees at today\'s simulated amount. ' + DIFFS[sl.diff].name + ' uses a ' + (sl.diff === 'easy' ? 'full-range' : 'symmetric ' + (sl.diff === 'normal' ? '÷3 / ×3' : '÷1.35 / ×1.35')) + ' price range.</p>';
    // current-price values for rage penalty + hot swap line
    var cur = defaultWhatIf(sl), rc = exitSplit(sl, cur.e, cur.t), mine = me === 1 ? rc.r1 : rc.r2;
    var pen = $('#ragePen'); if (pen) pen.textContent = usd(mine * 0.01);
    var hs = hotSwapInfo(sl);
    $('#hotTxt').innerHTML = hs.yes
      ? '<b>Hot swap available:</b> ' + hs.n + ' ' + sl.side + 'P deposit' + (hs.n === 1 ? '' : 's') + ' waiting on ' + DIFFS[sl.diff].name + '. The next one takes your seat at current value; your partner keeps playing, no unwind.'
      : '<b>No hot swap:</b> nobody is waiting on your side and difficulty, so unplugging unwinds the position and pays both players.';
  }
  setInterval(function () {
    var sl = state.slots[state.slot], c = $('#clock');
    if (sl && c && c.offsetParent) {
      c.textContent = fmtPlayed(played(sl));
      var g = $('#gateBar'); if (g) g.style.width = Math.min(100, played(sl) / (24 * HOUR) * 100) + '%';
    }
    // waiting cells ▮▮▮▯▯
    var k = Math.floor(Date.now() / 500) % 6, cells = '';
    for (var i = 0; i < 5; i++) cells += i < k ? '▮' : '▯';
    $$('.js-cells,#footCells').forEach(function (el) { el.textContent = cells; });
  }, 500);

  /* ------------------------------------------------------------------ unplug modal */
  function openUnplug() {
    var sl = state.slots[state.slot]; if (!sl) return;
    var cur = defaultWhatIf(sl), r = exitSplit(sl, cur.e, cur.t), me = sl.side;
    var early = played(sl) < 24 * HOUR, mine = me === 1 ? r.r1 : r.r2, pen = early ? mine * 0.01 : 0;
    var hs = hotSwapInfo(sl);
    $('#modalCard').innerHTML =
      '<h2 class="wm" style="font-size:26px">' + (early ? 'Rage quit?' : 'Unplug?') + '</h2>' +
      '<p class="explain">At current simulated prices (ETH ' + pct(cur.e) + ', ' + sl.pair.sym + ' ' + pct(cur.t) + ' since entry).</p>' +
      '<div class="summary sticker">' +
        '<div class="row"><span>Mover</span><b>' + (r.mover === 1 ? 'ETH (1P)' : sl.pair.sym + ' (2P)') + '</b></div>' +
        '<div class="row"><span>Your seat value</span><b>' + usd(mine) + '</b></div>' +
        (early ? '<div class="row"><span>Rage quit penalty (1%, to partner)</span><b>−' + usd(pen) + '</b></div>' : '') +
        '<div class="row"><span>You receive</span><b>' + usd(mine - pen) + '</b></div>' +
        '<div class="row"><span>After you leave</span><b>' + (hs.yes ? 'Hot swap: next ' + sl.side + 'P takes the seat' : 'Position unwinds') + '</b></div>' +
      '</div>' +
      (r.covered ? '' : '<p class="risk">The position does not cover the non-mover\'s hold value at these prices: the cap applies.</p>') +
      '<div class="row2"><button class="key key-cream" data-close>Keep playing</button><button class="key key-red" id="btnConfirm">' + (early ? 'Rage quit' : 'Unplug') + '</button></div>';
    $('#modal').hidden = false;
    $('#btnConfirm').focus();
  }
  function closeModal() { $('#modal').hidden = true; }
  function confirmUnplug() {
    var sl = state.slots[state.slot], hs = hotSwapInfo(sl);
    if (hs.yes) { var q = sl.pair.q[sl.diff]; q.n -= 1; q.eth = Math.max(0, q.eth - sl.ethDep); if (q.n <= 0 || q.eth <= 1e-6) { q.n = 0; q.eth = 0; q.side = 0; } }
    state.slots.splice(state.slot, 1); state.slot = 0;
    if (state.slots[0]) state.whatIf = defaultWhatIf(state.slots[0]);
    closeModal(); renderSession(); renderPorts(); renderCarts();
    toast(hs.yes ? 'Unplugged. A waiting player hot-swapped into your seat (simulated).' : 'Unplugged. Position unwound, both seats paid (simulated).');
  }

  /* ------------------------------------------------------------------ ARCADE */
  var ROUTED = { eth: 1.84, nimori: 9600000, mochi: 212000 };
  function renderArcade() {
    var st = state.stake, share = st.staked / (st.total + 0);
    var totalVotes = state.votes.reduce(function (a, v) { return a + v.w; }, 0);
    $('#arcadeBody').innerHTML =
      '<div class="stack">' +
        '<div class="marquee sticker"><span class="coin"><span class="wm wm-sm">NIMO<br>RI</span></span>' +
          '<div style="min-width:0;flex:1 1 200px"><h2>Insert coin</h2><p>$NIMORI is the protocol token, launched on Pons, the Robinhood Chain launchpad.</p>' +
          '<span class="pons">Launched on Pons · contract not deployed in this demo</span></div></div>' +
        '<div class="plate">' +
          '<div class="plate-head"><span class="etch">Stake</span><span class="mini-demo">DEMO · simulated</span></div>' +
          '<div class="bal"><div class="well"><div class="k">Wallet</div><div class="v">' + nf(WALLET.nimori) + '</div></div>' +
          '<div class="well"><div class="k">Staked</div><div class="v">' + nf(st.staked) + '</div></div></div>' +
          '<div class="slot-mouth"><span class="mouth"></span><label class="lcd" style="flex:1;margin:0"><input id="stakeAmt" inputmode="numeric" aria-label="Amount of NIMORI" value="' + esc(st.input) + '"><span class="unit">NIMORI</span></label></div>' +
          '<div class="row2" style="display:flex;gap:12px;flex-wrap:wrap"><button class="key key-cream" style="flex:1 1 140px" data-stake="in">Stake</button><button class="key key-red" style="flex:1 1 140px" data-stake="out"' + (st.staked ? '' : ' disabled') + '>Unstake</button></div>' +
          '<p class="risk">Staking earns a share of what co-op positions actually earn in fees. No fixed yield is promised and none is shown here.</p>' +
        '</div>' +
      '</div>' +
      '<div class="stack">' +
        '<div class="perks">' +
          '<div class="perk sticker"><span class="ico">10%</span><h3>Fee share</h3><p>10% of all trading fees from co-op positions, paid in ETH and pair tokens.</p><span class="st' + (st.staked ? ' on' : '') + '">' + (st.staked ? 'YOUR SHARE ' + nf(share * 100, 3) + '%' : 'NOT STAKED') + '</span></div>' +
          '<div class="perk sticker"><span class="ico">1ST</span><h3>Priority pass</h3><p>Stakers get matched first in the lobby queue.</p><span class="st' + (st.staked ? ' on' : '') + '">' + (st.staked ? 'PASS ON' : 'PASS OFF') + '</span></div>' +
          '<div class="perk sticker"><span class="ico">✚</span><h3>Pair vote</h3><p>Stakers vote on which pairs open a lobby next.</p><span class="st' + (st.staked ? ' on' : '') + '">' + (st.staked ? 'VOTE ' + compact(st.staked) : 'NO WEIGHT') + '</span></div>' +
        '</div>' +
        '<div class="plate">' +
          '<div class="plate-head"><span class="etch">Routed to stakers · this epoch</span><span class="mini-demo">DEMO · simulated</span></div>' +
          '<div class="routed"><span>' + eth(ROUTED.eth) + ' ETH</span><span>' + compact(ROUTED.nimori) + ' NIMORI</span><span>' + compact(ROUTED.mochi) + ' MOCHI</span></div>' +
          '<p class="explain" style="margin-top:10px">Your cut: ' + (st.staked ? eth(ROUTED.eth * share) + ' ETH + ' + compact(ROUTED.nimori * share) + ' NIMORI + ' + compact(ROUTED.mochi * share) + ' MOCHI' : 'stake to earn a cut') + ' · total staked ' + compact(st.total) + ' NIMORI</p>' +
        '</div>' +
        '<div class="plate">' +
          '<div class="plate-head"><span class="etch">Next lobby · high scores</span><span class="mini-demo">DEMO · simulated</span></div>' +
          '<div class="votes">' + state.votes.map(function (v, i) {
            return '<div class="vote well"><span class="rk">' + (i + 1) + '</span><span><span class="nm">' + v.pair + '<span>' + compact(v.w) + (state.myVote === i ? ' · your vote' : '') + '</span></span>' +
              '<span class="bar"><b style="width:' + (v.w / totalVotes * 100) + '%"></b></span></span>' +
              '<button class="key key-cream key-sm" data-vote="' + i + '"' + (st.staked ? '' : ' disabled title="Stake to vote"') + '>' + (state.myVote === i ? 'Voted' : 'Vote') + '</button></div>';
          }).join('') + '</div>' +
          (st.staked ? '' : '<p class="explain" style="margin-top:12px">Stake any amount to vote. Your weight = your staked $NIMORI.</p>') +
        '</div>' +
      '</div>';
  }
  function doStake(dir) {
    var st = state.stake, n = parseInt(st.input || '0', 10) || 0;
    if (!n) { toast('Enter an amount.'); return; }
    if (dir === 'in') {
      if (n > WALLET.nimori) { toast('Not enough $NIMORI in the demo wallet.'); return; }
      WALLET.nimori -= n; st.staked += n; st.total += n;
      if (state.myVote >= 0) state.votes[state.myVote].w += n;
      toast('Staked ' + nf(n) + ' NIMORI (simulated). Priority pass on.');
    } else {
      n = Math.min(n, st.staked); WALLET.nimori += n; st.staked -= n; st.total -= n;
      if (state.myVote >= 0) { state.votes[state.myVote].w -= n; if (!st.staked) state.myVote = -1; }
      toast('Unstaked ' + nf(n) + ' NIMORI (simulated).');
    }
    renderArcade();
  }
  function doVote(i) {
    var st = state.stake; if (!st.staked || state.myVote === i) return;
    if (state.myVote >= 0) state.votes[state.myVote].w -= st.staked;
    var picked = state.votes[i]; picked.w += st.staked;
    state.votes.sort(function (a, b) { return b.w - a.w; });
    state.myVote = state.votes.indexOf(picked);
    renderArcade();
    toast('Vote cast for ' + picked.pair + ' (simulated).');
  }

  /* ------------------------------------------------------------------ DOCS */
  function renderDocs() {
    $('#docsBody').innerHTML =
      '<div class="page sticker"><h2><span class="pg">P.1</span>How to play</h2><ol>' +
        '<li><b>Pick a pair.</b> Every pair has a lobby with two queues: 1P (ETH) and 2P (the token).</li>' +
        '<li><b>Pick a side.</b> Bring one asset only. Nobody sells half a bag to become an LP.</li>' +
        '<li><b>Pick a difficulty.</b> You only match players on the same difficulty.</li>' +
        '<li><b>Match.</b> FIFO by value at the pool price, TWAP checked against spot. The bigger deposit is partially filled, the rest keeps waiting.</li>' +
        '<li><b>Session.</b> One Uniswap v4 position, two Seat NFTs, one entry snapshot. Fees split 50/50, up to 70/30 for the scarce side.</li>' +
        '<li><b>Unplug.</b> Any time after 24h. Before that it is a rage quit.</li></ol></div>' +
      '<div class="page sticker"><h2><span class="pg">P.2</span>Difficulty</h2><table class="tbl"><thead><tr><th>Mode</th><th>Range</th><th>Fees</th><th>Risk</th></tr></thead><tbody>' +
        '<tr><td><b>Easy</b></td><td>Full range</td><td>Lower</td><td>Lowest IL</td></tr>' +
        '<tr><td><b>Normal</b></td><td>Wide, around spot</td><td>Medium</td><td>Medium IL</td></tr>' +
        '<tr><td><b>Hard</b></td><td>Narrow, around spot</td><td>Highest</td><td>Highest IL, can go out of range</td></tr></tbody></table>' +
        '<p style="margin-top:12px">While a deposit waits in the lobby it earns nothing and can be withdrawn at any time, free.</p></div>' +
      '<div class="page sticker"><h2><span class="pg">P.3</span>Unplug: the mover rule</h2><ol>' +
        '<li>For each asset, take its USD change since entry.</li>' +
        '<li>The <b>mover</b> is the asset that moved more, up or down.</li>' +
        '<li>The <b>non-mover</b> gets their hold value back: what they deposited, in their own asset, <b>as long as the position covers it</b>.</li>' +
        '<li>The mover gets the rest. Each seat then adds its share of fees.</li></ol>' +
        '<p>The non-mover\'s claim is capped at the whole position. On Easy with ETH flat, that cap starts when the token is down about 75%.</p></div>' +
      '<div class="page sticker"><h2><span class="pg">P.4</span>Worked example</h2>' +
        '<p>ETH $2,000, token $0.10, Easy. 1P brings 1 ETH, 2P brings 20,000 tokens. Position $4,000, split 50/50.</p>' +
        '<table class="tbl"><thead><tr><th>Case</th><th>Position</th><th>1P gets</th><th>2P gets</th></tr></thead><tbody>' +
        '<tr><td>Token ×2</td><td>$5,656.85</td><td>$2,000 (1 ETH)</td><td>$3,656.85</td></tr>' +
        '<tr><td>Token ÷2</td><td>$2,828.43</td><td>$2,000 (1 ETH)</td><td>$828.43</td></tr></tbody></table>' +
        '<p style="margin-top:10px">Fees on top in both cases. The token side carries the volatility and is paid for it by the seat bonus.</p></div>' +
      '<div class="page sticker"><h2><span class="pg">P.5</span>Parameters</h2><table class="tbl"><tbody>' +
        '<tr><td>Chain</td><td><b>Robinhood Chain</b></td></tr><tr><td>AMM</td><td>Uniswap v4</td></tr>' +
        '<tr><td>Minimum session</td><td>24 hours</td></tr><tr><td>Rage quit</td><td>1% of seat value, to partner</td></tr>' +
        '<tr><td>Fee split</td><td>50 / 50, seat bonus up to 70 / 30</td></tr><tr><td>Protocol fee</td><td>10% of trading fees, to $NIMORI stakers</td></tr>' +
        '<tr><td>Lobby withdrawal</td><td>Free, anytime</td></tr><tr><td>Prices</td><td>ETH/USD oracle + pool TWAP</td></tr></tbody></table>' +
        '<p style="margin-top:10px">Initial values, adjustable by governance.</p></div>' +
      '<div class="page sticker"><h2><span class="pg">P.6</span>Risks</h2><ul>' +
        '<li><b>Smart contracts</b> can have bugs. Contracts are not deployed; audits will be published before launch.</li>' +
        '<li><b>Mover risk:</b> if your asset moves more than your partner\'s, you carry the IL.</li>' +
        '<li><b>Cap:</b> in extreme moves the position may not cover the non-mover\'s deposit.</li>' +
        '<li><b>Range (Hard):</b> narrow positions can go out of range and stop earning.</li>' +
        '<li><b>Oracle:</b> bad prices could misassign IL. TWAP checks and staleness guards reduce this.</li>' +
        '<li><b>Lobby wait:</b> if the other queue is empty, your deposit waits and earns nothing.</li></ul></div>' +
      '<div class="page sticker wide"><h2><span class="pg">P.7</span>Controls</h2><div class="ctrl">' +
        '<div><b>1P</b>The ETH side of a session</div><div><b>2P</b>The token side</div><div><b>Lobby</b>Where deposits wait to be matched</div>' +
        '<div><b>Session</b>An active co-op position</div><div><b>Seat</b>ERC-721 for one side, tradable, burned at unplug</div><div><b>Difficulty</b>Range width of the position</div>' +
        '<div><b>Mover</b>The asset with the larger price change</div><div><b>Unplug</b>Exit a session</div><div><b>Hot swap</b>A waiting player takes the empty seat, no unwind</div>' +
        '<div><b>Rage quit</b>Exit before 24h, 1% to partner</div><div><b>Seat bonus</b>Bigger fee share for the scarce side</div><div><b>Arcade</b>$NIMORI staking</div>' +
      '</div></div>';
  }

  /* ------------------------------------------------------------------ boot */
  state.whatIf = defaultWhatIf(state.slots[0]);
  renderLobby(); renderDocs(); renderArcade(); renderSession();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { renderPorts(); });
  route();
})();
