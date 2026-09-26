(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const SCREENS = ['lobby', 'session', 'arcade', 'docs'];

  /* ---------- hash router: one screen at a time ---------- */
  function route() {
    const h = location.hash.replace('#', '');
    // anchors inside the docs (#d-...) keep the docs screen
    const screen = SCREENS.includes(h) ? h : (h.startsWith('d-') ? 'docs' : 'lobby');
    const changed = document.body.dataset.screen !== screen;
    document.body.dataset.screen = screen;
    $$('.tabs a').forEach(a => { if (a.dataset.tab === screen) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (changed && !h.startsWith('d-')) window.scrollTo(0, 0);
  }
  addEventListener('hashchange', route);
  route();

  addEventListener('scroll', () => document.body.classList.toggle('scrolled', scrollY > 8), { passive: true });

  /* ---------- toast ---------- */
  let tt;
  function toast(html) {
    const t = $('#toast');
    t.innerHTML = html;
    t.classList.add('show');
    clearTimeout(tt);
    tt = setTimeout(() => t.classList.remove('show'), 3600);
  }

  /* ---------- segmented radios ---------- */
  function seg(id, onChange) {
    const g = $('#' + id);
    g.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      $$('button', g).forEach(x => x.setAttribute('aria-checked', x === b ? 'true' : 'false'));
      onChange(b.dataset.v);
    });
    return () => $('button[aria-checked="true"]', g).dataset.v;
  }

  /* ---------- lobby (all numbers simulated) ---------- */
  const PAIRS = {
    NIMORI: { q1: [12.40, 7], q2: [4.10, 3], bal2: '120,000 NIMORI' },
    USDG:   { q1: [3.05, 4], q2: [9.80, 11], bal2: '8,400.00 USDG' },
  };
  const DIFF = {
    easy: 'Full range. Lowest fees, lowest IL. Never out of range.',
    normal: 'Wide range around spot. Medium fees, medium IL.',
    hard: 'Narrow range around spot. Highest fees, highest IL. Can go out of range and stop earning.',
  };
  const state = { pair: 'NIMORI', side: '1P', diff: 'easy', queued: 0 };

  function meter(el, v, max) {
    const on = Math.max(1, Math.round((v / max) * 10));
    el.innerHTML = Array.from({ length: 10 }, (_, i) => `<span class="${i < on ? 'on' : ''}"></span>`).join('');
  }

  function renderLobby() {
    const p = PAIRS[state.pair], tok = state.pair;
    const q1 = p.q1[0] + (state.side === '1P' ? state.queued : 0);
    const q2 = p.q2[0];
    const max = Math.max(q1, q2) * 1.15;
    meter($('#m1'), q1, max); meter($('#m2'), q2, max);
    $('#q1v').textContent = q1.toFixed(2) + ' ETH';
    $('#q1n').textContent = p.q1[1] + (state.side === '1P' && state.queued ? 1 : 0) + ' deposits';
    $('#q2v').textContent = '≈ ' + q2.toFixed(2) + ' ETH';
    $('#q2n').textContent = p.q2[1] + ' deposits';
    $('#q2label').textContent = tok + ' queue';
    $$('.tok').forEach(e => (e.textContent = tok));
    $('#unit').textContent = state.side === '1P' ? 'ETH' : tok;
    $('#bal').textContent = state.side === '1P' ? '3.2000 ETH' : p.bal2;
    $('#diffHint').textContent = DIFF[state.diff];

    const mine = state.side === '1P' ? p.q1 : p.q2;
    const other = state.side === '1P' ? q2 : p.q1[0];
    const scarce = state.side === '1P' ? q1 < q2 : q2 < p.q1[0];
    $('#place').textContent = `#${mine[1] + 1} of ${mine[1] + 1}`;
    // seat bonus: the scarce side earns more, capped at 70 / 30
    const ratio = Math.max(q1, q2) / Math.min(q1, q2);
    const bonus = Math.min(20, Math.round((ratio - 1) * 4));
    const me = scarce ? 50 + bonus : 50 - bonus;
    $('#split').textContent = bonus ? `${me} / ${100 - me}${scarce ? ' · your bonus' : ' · ' + (state.side === '1P' ? '2P' : '1P') + ' bonus'}` : '50 / 50';

    $('#deposit').textContent = `Plug in as ${state.side}`;
    $('#riskCopy').innerHTML = state.side === '1P'
      ? `As 1P you get your ETH back at unplug <em>as long as the position covers it</em>. If ${tok} falls hard (around −75% or more), the cap applies and you get less.`
      : `As 2P, if ${tok} moves more than ETH (up or down), you are the mover and carry the IL. Fees are added on top. ${other ? '' : 'The 1P queue is empty: you may wait.'}`;
  }

  $('#pair').addEventListener('change', e => { state.pair = e.target.value; state.queued = 0; renderLobby(); });
  seg('side', v => { state.side = v; renderLobby(); });
  seg('diff', v => { state.diff = v; renderLobby(); });
  $('#max').addEventListener('click', () => { $('#amt').value = state.side === '1P' ? '3.20' : PAIRS[state.pair].bal2.split(' ')[0]; });
  $('#deposit').addEventListener('click', () => {
    const v = parseFloat(($('#amt').value || '0').replace(/,/g, '')) || 0;
    if (state.side === '1P') state.queued += v;
    renderLobby();
    toast(`<b>Simulated.</b> Nothing was sent: contracts are not deployed. You would now wait in the ${state.side} queue (${state.diff}), free to withdraw.`);
  });
  renderLobby();

  /* ---------- session ---------- */
  function renderSession(age) {
    const early = age < 24;
    $('#ageV').textContent = early ? `${age} h · unplug opens at 24 h` : `${age} h · unplug open`;
    $('#unplug').disabled = early;
    $('#ragequit').disabled = !early;
    $('#rqHint').textContent = early
      ? 'Leaving now is a rage quit: 1% of your seat value is paid to your partner.'
      : 'Rage quit only exists before 24 h: 1% of seat value is paid to your partner.';
  }
  seg('age', v => renderSession(+v));
  renderSession(31);
  $('#unplug').addEventListener('click', () => toast('<b>Simulated.</b> Unplug would burn Seat #0042 and pay 1.000 ETH + fees, as long as the position covers it.'));
  $('#ragequit').addEventListener('click', () => toast('<b>Simulated.</b> Rage quit would pay 1% of your seat value to 2P, then settle with the mover rule.'));

  /* ---------- arcade ---------- */
  $('#stake').addEventListener('click', () => {
    $('#staked').textContent = $('#stakeAmt').value;
    toast('<b>Simulated.</b> No token was moved. Staking goes live with the Arcade contract.');
  });

  /* ---------- wallet ---------- */
  $('#connect').addEventListener('click', e => {
    const on = e.currentTarget.classList.toggle('on');
    e.currentTarget.textContent = on ? 'Demo wallet' : 'Connect wallet';
    toast(on ? '<b>Demo wallet.</b> No real wallet is connected; balances on this page are simulated.' : 'Disconnected.');
  });
})();
