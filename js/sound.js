// Arcade sound effects, synthesised with WebAudio (square / triangle waves + a noise burst). No audio files.
// The AudioContext is created on the first user gesture, as browsers require.
let ctx = null;
let master = null;
let noiseBuf = null;
let muted = false;
try { muted = localStorage.getItem('nimori-muted') === '1'; } catch { /* storage blocked: sound stays on */ }

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.6, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// one note: frequency (optionally sliding), start offset, duration, wave, volume
function tone(f, at, dur, { type = 'square', vol = 1, to = null } = {}) {
  const t0 = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}
function noise(at, dur, { vol = 0.5, from = 400, to = 3000 } = {}) {
  const t0 = ctx.currentTime + at;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.setValueAtTime(from, t0);
  f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t0);
  s.stop(t0 + dur + 0.02);
}

const N = { C5: 523.25, E5: 659.25, G5: 783.99, A5: 880, B5: 987.77, C6: 1046.5, E6: 1318.5, G6: 1568, C4: 261.63, G4: 392 };
const SOUNDS = {
  blip: () => tone(N.A5, 0, 0.05, { vol: 0.5, to: 1320 }),
  select: () => { tone(N.E5, 0, 0.05, { vol: 0.5 }); tone(N.B5, 0.05, 0.08, { vol: 0.5 }); },
  open: () => tone(440, 0, 0.12, { type: 'triangle', vol: 0.9, to: 880 }),
  back: () => tone(660, 0, 0.1, { type: 'triangle', vol: 0.8, to: 330 }),
  coin: () => { tone(N.B5, 0, 0.08, { vol: 0.55 }); tone(N.E6, 0.08, 0.35, { vol: 0.55 }); },
  plug: () => [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone(f, i * 0.06, 0.09, { vol: 0.5 })),
  matched: () => {
    [N.C5, N.E5, N.G5, N.C6, N.G5, N.C6].forEach((f, i) => tone(f, i * 0.09, i === 5 ? 0.4 : 0.1, { vol: 0.5 }));
    [N.C4, N.G4, N.C4].forEach((f, i) => tone(f, i * 0.18, 0.16, { type: 'triangle', vol: 0.9 }));
  },
  lid: () => { tone(180, 0, 0.45, { type: 'triangle', vol: 0.7, to: 720 }); noise(0, 0.4, { vol: 0.25, from: 300, to: 2400 }); },
  close: () => { tone(600, 0, 0.3, { type: 'triangle', vol: 0.6, to: 160 }); noise(0, 0.25, { vol: 0.2, from: 2000, to: 300 }); },
  ragequit: () => { tone(440, 0, 0.55, { type: 'sawtooth', vol: 0.45, to: 70 }); noise(0.05, 0.4, { vol: 0.35, from: 1200, to: 150 }); },
  unplug: () => [N.C6, N.G5, N.E5, N.C5].forEach((f, i) => tone(f, i * 0.07, 0.1, { vol: 0.45 })),
  boot: () => { [N.G5, N.C6, N.E6, N.G6].forEach((f, i) => tone(f, i * 0.05, i === 3 ? 0.3 : 0.07, { type: i === 3 ? 'triangle' : 'square', vol: 0.4 })); },
  error: () => { tone(140, 0, 0.09, { vol: 0.5 }); tone(140, 0.12, 0.12, { vol: 0.5 }); },
};

let lastAt = 0;
export function sfx(name) {
  if (muted || !SOUNDS[name]) return;
  // browsers only allow audio after a user gesture: stay silent until the page has been clicked once
  if (!ctx && navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  if (!ac()) return;
  lastAt = performance.now();
  SOUNDS[name]();
}
// true if a sound already played in this click (so the generic click blip does not double it)
export const playedJustNow = () => performance.now() - lastAt < 40;
export const isMuted = () => muted;
export function setMuted(m) {
  muted = !!m;
  try { localStorage.setItem('nimori-muted', muted ? '1' : '0'); } catch { /* ignore */ }
}
