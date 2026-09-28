// Docs illustrations: inline SVG, drawn in the clean palette. Numbers come from the worked example in the docs
// (1 ETH at $2,000 + 20,000 NIMORI at $0.10, full range), so every bar is computed, not typed in.
const C = {
  ink: '#1e1512', ink2: '#5b4b43', ink3: '#8f7c70', line: '#f1e4cf', card: '#ffffff',
  red: '#e60211', red50: '#fdecea', amber: '#d98a00', amber50: '#fff4d6', ok: '#1f9d55', ok50: '#e3f6ea', bg: '#fff8ec',
};
const T = (x, y, s, { size = 13, w = 600, fill = C.ink, anchor = 'start' } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${w}" fill="${fill}" text-anchor="${anchor}">${s}</text>`;
const box = (x, y, w, h, { fill = C.card, stroke = C.line, r = 14 } = {}) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}"/>`;
const arrow = (x1, y1, x2, y2, color = C.ink3) =>
  `<path d="M${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" marker-end="url(#ah)"/>`;
const defs = `<defs><marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="${C.ink3}"/></marker></defs>`;
const svg = (vb, body, label) =>
  `<figure class="fig"><svg viewBox="${vb}" role="img" aria-label="${label}" font-family="Plus Jakarta Sans, system-ui, sans-serif">${defs}${body}</svg><figcaption>${label}</figcaption></figure>`;
const chip = (x, y, txt, fill, color) => `<circle cx="${x}" cy="${y}" r="17" fill="${fill}"/>${T(x, y + 4.5, txt, { size: 12, w: 800, fill: color, anchor: 'middle' })}`;

// 1. one match: two deposits -> one position -> two seats
export function figMatch() {
  return svg('0 0 720 214', `
    ${box(8, 18, 190, 74)}${chip(40, 55, '1P', C.red50, C.red)}${T(66, 50, 'Player 1')}${T(66, 70, 'brings 1 ETH', { size: 12, w: 500, fill: C.ink3 })}
    ${box(8, 122, 190, 74)}${chip(40, 159, '2P', C.amber50, C.amber)}${T(66, 154, 'Player 2')}${T(66, 174, 'brings 20,000 NIMORI', { size: 12, w: 500, fill: C.ink3 })}
    ${arrow(200, 55, 262, 100)}${arrow(200, 159, 262, 114)}
    ${box(266, 52, 188, 110, { fill: C.red50, stroke: '#fbd9d5', r: 18 })}
    ${T(360, 88, 'One position', { size: 16, w: 800, anchor: 'middle' })}
    ${T(360, 108, 'NIMORI pool · Uniswap v4', { size: 11.5, w: 500, fill: C.ink2, anchor: 'middle' })}
    <rect x="300" y="124" width="120" height="8" rx="4" fill="#fbd9d5"/><rect x="330" y="124" width="60" height="8" rx="4" fill="${C.red}"/>
    ${T(360, 150, 'fees accrue here', { size: 11, w: 500, fill: C.ink3, anchor: 'middle' })}
    ${arrow(456, 100, 518, 55)}${arrow(456, 114, 518, 159)}
    ${box(522, 18, 190, 74)}${chip(554, 55, '1P', C.red50, C.red)}${T(580, 50, 'Seat 1P')}${T(580, 70, 'ERC-721 · save file', { size: 12, w: 500, fill: C.ink3 })}
    ${box(522, 122, 190, 74)}${chip(554, 159, '2P', C.amber50, C.amber)}${T(580, 154, 'Seat 2P')}${T(580, 174, 'ERC-721 · save file', { size: 12, w: 500, fill: C.ink3 })}
  `, 'Example: a match turns two single-asset deposits into one position and two tradable seats.');
}

// 2. difficulty: the same price path against three range widths
export function figDifficulty() {
  const path = [0.5, 0.56, 0.47, 0.6, 0.52, 0.66, 0.58, 0.71, 0.63, 0.78, 0.7];
  const panel = (x, label, lo, hi, note) => {
    const w = 220, h = 96, y = 30;
    const pts = path.map((v, i) => `${x + 12 + i * ((w - 24) / (path.length - 1))},${y + h - v * h}`).join(' ');
    const outIdx = path.findIndex((v) => v > hi || v < lo);
    const out = outIdx >= 0 ? path.slice(outIdx).map((v, i) => `${x + 12 + (outIdx + i) * ((w - 24) / (path.length - 1))},${y + h - v * h}`).join(' ') : '';
    return `
      ${box(x, 6, w, 150, { r: 16 })}
      ${T(x + 14, 26, label, { size: 14, w: 800 })}${T(x + w - 14, 26, note, { size: 11, w: 600, fill: C.ink3, anchor: 'end' })}
      <rect x="${x + 8}" y="${y + h - hi * h}" width="${w - 16}" height="${(hi - lo) * h}" rx="6" fill="${C.amber50}"/>
      <polyline points="${pts}" fill="none" stroke="${C.ink2}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${out ? `<polyline points="${out}" fill="none" stroke="${C.red}" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>` : ''}
      ${T(x + 14, 146, out ? 'price left the range: no more fees' : 'price stays in range: earning', { size: 11, w: 600, fill: out ? C.red : C.ok })}`;
  };
  return svg('0 0 720 164', panel(8, 'Easy', 0, 1, 'full range') + panel(250, 'Normal', 0.3, 0.8, 'wide') + panel(492, 'Hard', 0.44, 0.64, 'narrow'),
    'Same price path, three range widths. Narrower earns more per trade but can fall out of range.');
}

// 3. session timeline
export function figTimeline() {
  return svg('0 0 720 110', `
    <rect x="20" y="40" width="330" height="26" rx="13" fill="${C.red50}"/>
    <rect x="352" y="40" width="348" height="26" rx="13" fill="${C.ok50}"/>
    ${T(185, 58, 'Rage quit: 1% of your seat to your partner', { size: 12, w: 700, fill: C.red, anchor: 'middle' })}
    ${T(526, 58, 'Unplug: free · hot swap if someone waits', { size: 12, w: 700, fill: C.ok, anchor: 'middle' })}
    <circle cx="20" cy="53" r="7" fill="${C.ink}"/>${T(20, 90, 'Match', { size: 12, w: 700, anchor: 'middle' })}
    <line x1="351" y1="30" x2="351" y2="76" stroke="${C.ink}" stroke-width="2" stroke-dasharray="3 3"/>${T(351, 22, '24 h', { size: 12, w: 800, anchor: 'middle' })}
    ${T(351, 94, 'minimum session', { size: 11, w: 500, fill: C.ink3, anchor: 'middle' })}
    ${T(700, 90, 'as long as you like', { size: 12, w: 600, fill: C.ink3, anchor: 'end' })}
  `, 'A session: leaving before 24 h is a rage quit, after 24 h unplugging is free.');
}

// 4. mover rule payouts, computed from the full-range formula
function payouts(ratio) { // ratio = NIMORI price change, ETH flat
  const value = 4000 * Math.sqrt(ratio);
  const p1 = Math.min(2000, value);
  return { p1, p2: value - p1 };
}
export function figPayouts() {
  const cases = [['NIMORI ×2', 2], ['NIMORI −50%', 0.5], ['NIMORI −80%', 0.2]];
  const y0 = 212, top = 44, max = 4000, H = y0 - top;
  const yv = (v) => y0 - (v / max) * H;
  const bw = 56;
  let body = `
    <circle cx="28" cy="16" r="6" fill="${C.red}"/>${T(40, 20, '1P gets (deposited $2,000 of ETH)', { size: 12, w: 600, fill: C.ink2 })}
    <circle cx="300" cy="16" r="6" fill="${C.amber}"/>${T(312, 20, '2P gets (deposited $2,000 of NIMORI)', { size: 12, w: 600, fill: C.ink2 })}`;
  [0, 1000, 2000, 3000, 4000].forEach((v) => {
    body += `<line x1="70" x2="712" y1="${yv(v)}" y2="${yv(v)}" stroke="${v ? C.line : C.ink3}" stroke-width="1"/>${T(62, yv(v) + 4, '$' + (v / 1000) + 'k', { size: 11, w: 500, fill: C.ink3, anchor: 'end' })}`;
  });
  body += `<line x1="70" x2="712" y1="${yv(2000)}" y2="${yv(2000)}" stroke="${C.ink}" stroke-width="1.4" stroke-dasharray="4 4"/>${T(712, yv(2000) - 6, 'each deposit: $2,000', { size: 11, w: 700, fill: C.ink2, anchor: 'end' })}`;
  cases.forEach(([label, r], i) => {
    const { p1, p2 } = payouts(r);
    const cx = 170 + i * 205;
    const bar = (x, v, fill, who) => {
      const h = Math.max(0, y0 - yv(v));
      const shape = h > 4
        ? `<path d="M${x} ${y0} V${y0 - h + 4} a4 4 0 0 1 4 -4 H${x + bw - 4} a4 4 0 0 1 4 4 V${y0} Z" fill="${fill}"/>`
        : `<rect x="${x}" y="${y0 - 2}" width="${bw}" height="2" fill="${fill}"/>`;
      return `<g>${shape}<rect x="${x - 6}" y="${top}" width="${bw + 12}" height="${H}" fill="transparent"><title>${label} · ${who} gets $${v.toFixed(2)}</title></rect>${T(x + bw / 2, y0 - h - 7, '$' + Math.round(v).toLocaleString('en-US'), { size: 12, w: 800, anchor: 'middle' })}</g>`;
    };
    body += bar(cx - bw - 1, p1, C.red, '1P') + bar(cx + 1, p2, C.amber, '2P');
    body += T(cx, y0 + 22, label, { size: 12.5, w: 800, anchor: 'middle' });
    body += T(cx, y0 + 40, p1 < 2000 ? 'cap applies: 1P gets less' : '1P repaid in full', { size: 11, w: 600, fill: p1 < 2000 ? C.red : C.ok, anchor: 'middle' });
  });
  return svg('0 0 720 262', body, 'Worked example: 1 ETH at $2,000 + 20,000 NIMORI at $0.10, full range, ETH flat, before fees. The token moved more, so 2P carries the IL until the position no longer covers 1P.');
}

// 5. hot swap
export function figHotSwap() {
  return svg('0 0 720 130', `
    ${box(8, 30, 170, 70)}${chip(40, 65, '1P', C.red50, C.red)}${T(66, 61, 'Seat 1P')}${T(66, 80, 'keeps playing', { size: 12, w: 500, fill: C.ok })}
    ${box(275, 30, 170, 70, { fill: C.bg, stroke: '#e6d4b6' })}${chip(307, 65, '2P', C.amber50, C.amber)}${T(333, 61, 'Seat 2P')}${T(333, 80, 'unplugs, paid out', { size: 12, w: 500, fill: C.ink3 })}
    ${box(542, 30, 170, 70)}${chip(574, 65, '2P', C.amber50, C.amber)}${T(600, 61, 'Next in queue')}${T(600, 80, 'takes the seat', { size: 12, w: 500, fill: C.ink3 })}
    ${arrow(540, 65, 448, 65, C.amber)}
    ${T(360, 122, 'Same side, same difficulty: no unwind, no swap, no slippage.', { size: 12, w: 600, fill: C.ink2, anchor: 'middle' })}
  `, 'Hot swap: a waiting player takes the empty seat and the position stays open.');
}

// 6. where the trading fees go
export function figFees() {
  return svg('0 0 720 150', `
    ${box(8, 45, 170, 60, { fill: C.red50, stroke: '#fbd9d5' })}${T(93, 72, 'Trading fees', { size: 14, w: 800, anchor: 'middle' })}${T(93, 91, 'earned by the position', { size: 11.5, w: 500, fill: C.ink2, anchor: 'middle' })}
    ${arrow(180, 62, 270, 36)}${arrow(180, 88, 270, 114)}
    ${box(274, 8, 190, 56)}${T(290, 32, '10% · Arcade', { size: 13.5, w: 800 })}${T(290, 50, '$NIMORI stakers', { size: 11.5, w: 500, fill: C.ink3 })}
    ${box(274, 86, 190, 56)}${T(290, 110, '90% · the two seats', { size: 13.5, w: 800 })}${T(290, 128, 'split 50/50 by default', { size: 11.5, w: 500, fill: C.ink3 })}
    ${arrow(466, 114, 530, 114)}
    ${box(534, 86, 178, 56, { fill: C.amber50, stroke: '#f5e2b0' })}${T(548, 110, 'Seat bonus', { size: 13.5, w: 800 })}${T(548, 128, 'scarce side up to 70/30', { size: 11.5, w: 500, fill: C.ink2 })}
  `, 'Where fees go: 10% to Arcade stakers, the rest split between the two seats.');
}
