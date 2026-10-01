// NIMORI — STILLS for X posts (copied from film/scene-ep4.js). Static: renderStill(spec) draws one screen and renders one frame. Do not use in the app.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
const smoothGeo = (g, a = Math.PI / 3) => toCreasedNormals(g, a);

const C = {
  red: 0xe60211,
  cream: 0xfef3d5,
  amber: 0xf3ae15,
  maroon: 0x6a0200,
  led: 0xff7a1a,
  ledOk: 0x8cff5a,
};

// ---------- small helpers ----------
function roundedRectShape(w, h, r, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  const x = cx - w / 2, y = cy - h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}
function roundedRectPath(w, h, r) {
  const p = new THREE.Path();
  const x = -w / 2, y = -h / 2;
  p.moveTo(x + r, y);
  p.lineTo(x + w - r, y);
  p.quadraticCurveTo(x + w, y, x + w, y + r);
  p.lineTo(x + w, y + h - r);
  p.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  p.lineTo(x + r, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - r);
  p.lineTo(x, y + r);
  p.quadraticCurveTo(x, y, x + r, y);
  return p;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function noiseTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 118 + rnd() * 20;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 3);
  return t;
}

function textTexture(lines, { w = 512, h = 128, font = '700 72px Rubik, sans-serif', color = '#000', align = 'center' } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = color;
  g.font = font;
  g.textAlign = align;
  g.textBaseline = 'middle';
  const arr = Array.isArray(lines) ? lines : [lines];
  arr.forEach((l, i) => g.fillText(l, align === 'center' ? w / 2 : 8, (h / (arr.length + 1)) * (i + 1)));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function radialTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)', size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Coiled phone-style cable: a helix wound around a base path, with a straight lead near the plug.
function coiledCurve(points, { pitch = 0.07, coilR = 0.07, lead = 0.35, samplesPerTurn = 14 } = {}) {
  const base = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.5);
  const L = base.getLength();
  const N = Math.ceil((L / pitch) * samplesPerTurn);
  const frames = base.computeFrenetFrames(N, false);
  const out = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    base.getPointAt(u, p);
    const s = u * L;
    const ramp = smooth(lead, lead + 0.35, s);
    const a = (2 * Math.PI * s) / pitch;
    const n = frames.normals[i], b = frames.binormals[i];
    out.push(new THREE.Vector3(
      p.x + (n.x * Math.cos(a) + b.x * Math.sin(a)) * coilR * ramp,
      p.y + (n.y * Math.cos(a) + b.y * Math.sin(a)) * coilR * ramp,
      p.z + (n.z * Math.cos(a) + b.z * Math.sin(a)) * coilR * ramp,
    ));
  }
  return { curve: new THREE.CatmullRomCurve3(out, false, 'catmullrom', 0.5), N };
}

// ---------- scene ----------
export function createFilmScene(mount, { width = 1920, height = 1080 } = {}) {
  const pending = [];
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  mount.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const scene = new THREE.Scene();
  const bg = new THREE.Color(0x5e0005);
  scene.background = bg;
  scene.fog = new THREE.Fog(bg, 12, 30);

  // studio environment: dark room + softboxes, so the clearcoat picks up crisp product-shot highlights
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(20, 32, 16), new THREE.MeshBasicMaterial({ color: 0x2a0806, side: THREE.BackSide })));
  const box = (w, h, color, intensity, pos, look) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity), side: THREE.DoubleSide }));
    m.position.copy(pos); m.lookAt(look); env.add(m);
  };
  const O = new THREE.Vector3(0, 0, 0);
  box(9, 4, 0xffffff, 2.2, new THREE.Vector3(-2, 9, 3), O);      // overhead softbox
  box(2.2, 10, 0xfff0e0, 3.0, new THREE.Vector3(-9, 3, 4), O);   // left strip
  box(2.2, 10, 0xffd9c0, 2.0, new THREE.Vector3(9, 3, -2), O);   // right strip, warm
  box(12, 3, 0xffffff, 1.2, new THREE.Vector3(0, 2, 12), O);     // front bounce card
  box(30, 30, 0x9a0008, 0.6, new THREE.Vector3(0, -6, 0), new THREE.Vector3(0, 0, 0)); // red floor bounce
  scene.environment = pmrem.fromScene(env, 0.02).texture;
  scene.environmentIntensity = 0.7;

  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 60);

  // lights: big soft key from top-left, warm fill, rim from behind
  const key = new THREE.DirectionalLight(0xfff1e0, 1.6);
  key.position.set(-4, 8, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -6; key.shadow.camera.right = 6;
  key.shadow.camera.top = 6; key.shadow.camera.bottom = -6;
  key.shadow.camera.near = 1; key.shadow.camera.far = 20;
  key.shadow.radius = 6;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.02;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xffd2b0, 1.2);
  rim.position.set(3, 3.5, -6);
  scene.add(rim);
  const fill = new THREE.HemisphereLight(0xffe7d6, 0x5a0005, 0.2);
  scene.add(fill);

  // ---------- materials ----------
  const bump = noiseTexture();
  const redPlastic = new THREE.MeshPhysicalMaterial({
    color: 0xd4000e, roughness: 0.34, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.06,
    bumpMap: bump, bumpScale: 0.35,
  });
  const redMould = redPlastic.clone(); // D-pad and buttons: same plastic, slightly glossier
  redMould.roughness = 0.3;
  redMould.clearcoatRoughness = 0.08;
  const blackPlastic = new THREE.MeshPhysicalMaterial({ color: 0x120404, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4 });
  const cavity = new THREE.MeshStandardMaterial({ color: 0x050101, roughness: 0.9 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 1, roughness: 0.28 });
  const creamPlastic = new THREE.MeshPhysicalMaterial({ color: 0xf2dfb4, roughness: 0.45, clearcoat: 0.35, clearcoatRoughness: 0.35 });
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x8c0008, roughness: 0.7, metalness: 0, envMapIntensity: 0.6 });

  // ---------- floor (seamless studio sweep fading into fog) ----------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const console3d = new THREE.Group();
  scene.add(console3d);

  // ---------- body ----------
  const W = 4.4, D = 2.8, H = 0.92, bev = 0.15, cornerR = 0.5;
  const bodyGeo = new THREE.ExtrudeGeometry(roundedRectShape(W - 2 * bev, D - 2 * bev, cornerR - bev), {
    depth: H - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 10, curveSegments: 28,
  });
  bodyGeo.rotateX(-Math.PI / 2);
  bodyGeo.translate(0, bev, 0);
  const body = new THREE.Mesh(smoothGeo(bodyGeo), redPlastic);
  body.castShadow = true; body.receiveShadow = true;
  console3d.add(body);
  const zf = D / 2; // front wall plane
  const topY = H;

  // parting line (thin dark seam around the body, like a moulded shell)
  const seamGeo = new THREE.ExtrudeGeometry(roundedRectShape(W + 0.004, D + 0.004, cornerR), { depth: 0.012, bevelEnabled: false, curveSegments: 28 });
  seamGeo.rotateX(-Math.PI / 2);
  const seam = new THREE.Mesh(seamGeo, new THREE.MeshStandardMaterial({ color: 0x3a0002, roughness: 0.7 }));
  seam.position.y = 0.34;
  console3d.add(seam);

  // raised top deck = the LID: everything from here to the vents is re-parented to a hinge (Arcade opens it)
  const lidFrom = console3d.children.length;
  const deckGeo = new RoundedBoxGeometry(W - 0.62, 0.12, D - 0.66, 6, 0.055);
  const deck = new THREE.Mesh(deckGeo, redPlastic);
  deck.position.set(0, topY + 0.02, -0.06);
  deck.castShadow = true; deck.receiveShadow = true;
  console3d.add(deck);
  const deckTop = topY + 0.08;

  // D-pad (ton-sur-ton, embossed)
  const arm = 0.27, len = 0.86, cr = 0.045;
  const cross = new THREE.Shape();
  const a = arm / 2, l = len / 2;
  cross.moveTo(-a + cr, l); cross.lineTo(a - cr, l); cross.quadraticCurveTo(a, l, a, l - cr);
  cross.lineTo(a, a); cross.lineTo(l - cr, a); cross.quadraticCurveTo(l, a, l, a - cr);
  cross.lineTo(l, -a + cr); cross.quadraticCurveTo(l, -a, l - cr, -a); cross.lineTo(a, -a);
  cross.lineTo(a, -l + cr); cross.quadraticCurveTo(a, -l, a - cr, -l); cross.lineTo(-a + cr, -l);
  cross.quadraticCurveTo(-a, -l, -a, -l + cr); cross.lineTo(-a, -a); cross.lineTo(-l + cr, -a);
  cross.quadraticCurveTo(-l, -a, -l, -a + cr); cross.lineTo(-l, a - cr); cross.quadraticCurveTo(-l, a, -l + cr, a);
  cross.lineTo(-a, a); cross.lineTo(-a, l - cr); cross.quadraticCurveTo(-a, l, -a + cr, l);
  const dpadGeo = new THREE.ExtrudeGeometry(cross, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.035, bevelSize: 0.03, bevelSegments: 6, curveSegments: 8 });
  dpadGeo.rotateX(-Math.PI / 2);
  const dpad = new THREE.Mesh(smoothGeo(dpadGeo), redMould);
  dpad.position.set(-1.12, deckTop - 0.005, 0.05);
  dpad.castShadow = true; dpad.receiveShadow = true;
  console3d.add(dpad);
  // shallow moulded dish around the d-pad
  const dish = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.62, 0.012, 64), new THREE.MeshPhysicalMaterial({ color: 0xc40010, roughness: 0.55, clearcoat: 0.4 }));
  dish.position.set(-1.12, deckTop - 0.001, 0.05);
  dish.receiveShadow = true;
  console3d.add(dish);
  // centre dimple on d-pad
  const dimple = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), redMould);
  dimple.scale.set(1, 0.18, 1);
  dimple.position.set(-1.12, deckTop + 0.062, 0.05);
  console3d.add(dimple);

  // Round buttons (domed, lathe profile)
  const prof = [];
  const R = 0.19, bh = 0.12;
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    prof.push(new THREE.Vector2(R * Math.cos(t * Math.PI / 2) * (t < 0.2 ? 1 : 1), bh * Math.sin(t * Math.PI / 2)));
  }
  prof.unshift(new THREE.Vector2(R, 0));
  prof.reverse();
  const btnGeo = new THREE.LatheGeometry(prof, 48);
  const btnWell = new THREE.CylinderGeometry(R + 0.06, R + 0.075, 0.012, 64);
  const buttons = [];
  [[1.02, 0.22], [1.5, -0.12]].forEach(([x, z]) => {
    const b = new THREE.Mesh(btnGeo, redMould);
    b.position.set(x, deckTop, z);
    b.castShadow = true;
    console3d.add(b);
    const w = new THREE.Mesh(btnWell, dish.material);
    w.position.set(x, deckTop - 0.005, z);
    console3d.add(w);
    buttons.push(b);
  });
  // start / select pills
  [-0.28, 0.12].forEach((x) => {
    const p = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.18, 6, 16), redMould);
    p.rotation.z = Math.PI / 2;
    p.rotation.y = 0.35;
    p.scale.set(1, 1, 0.5);
    p.position.set(x, deckTop + 0.012, 0.42);
    p.castShadow = true;
    console3d.add(p);
  });

  // debossed wordmark on the deck
  // the real wordmark (same letters as the logo) as a printed badge on the lid
  let logoTex; pending.push(new THREE.TextureLoader().loadAsync(new URL('../img/wordmark.webp', import.meta.url).href).then((tx) => { logoTex.image = tx.image; logoTex.needsUpdate = true; }));
  logoTex = new THREE.Texture();
  logoTex.colorSpace = THREE.SRGBColorSpace;
  logoTex.anisotropy = 8;
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.318), new THREE.MeshStandardMaterial({ map: logoTex, transparent: true, roughness: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  logo.rotation.x = -Math.PI / 2;
  logo.position.set(-0.08, deckTop + 0.001, -0.62);
  console3d.add(logo);

  // vent slots at the back of the deck
  const ventMat = new THREE.MeshStandardMaterial({ color: 0x2a0002, roughness: 0.8 });
  for (let i = 0; i < 7; i++) {
    const v = new THREE.Mesh(new RoundedBoxGeometry(0.055, 0.02, 0.42, 2, 0.01), ventMat);
    v.position.set(0.95 + i * 0.13, deckTop - 0.001, -0.78);
    console3d.add(v);
  }

  // ---------- lid: hinge at the back edge of the deck ----------
  const lidTo = console3d.children.length;
  const hingeZ = -0.06 - (D - 0.66) / 2;
  const lid = new THREE.Group();
  lid.position.set(0, topY + 0.02, hingeZ);
  console3d.add(lid);
  console3d.updateMatrixWorld(true);
  console3d.children.slice(lidFrom, lidTo).forEach((o) => lid.attach(o));

  // inside of the lid: bezel + screen, facing down while closed
  const scrW = W - 1.02, scrH = D - 1.02;
  const scrZ = (D - 0.66) / 2; // centre of the deck, from the hinge
  const bezel = new THREE.Mesh(new RoundedBoxGeometry(scrW + 0.24, 0.03, scrH + 0.24, 4, 0.012), blackPlastic);
  bezel.position.set(0, -0.075, scrZ);
  lid.add(bezel);
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x120202, emissive: new THREE.Color(0x3a0806), emissiveIntensity: 1, roughness: 0.15 });
  const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(scrW, scrH), screenMat);
  screenMesh.rotation.x = Math.PI / 2; // faces -y, top edge towards the front of the lid
  screenMesh.position.set(0, -0.092, scrZ);
  lid.add(screenMesh);
  const screenGlow = new THREE.PointLight(0xffb060, 0, 3.2, 2);
  screenGlow.position.set(0, -0.6, scrZ);
  lid.add(screenGlow);

  // tray revealed when the lid is up: dark well + a cartridge slot glowing amber
  const trayGeo = new THREE.ExtrudeGeometry(roundedRectShape(W - 0.8, D - 0.84, 0.12), { depth: 0.01, bevelEnabled: false, curveSegments: 16 });
  trayGeo.rotateX(-Math.PI / 2);
  const tray = new THREE.Mesh(trayGeo, new THREE.MeshStandardMaterial({ color: 0x1a0303, roughness: 0.8 }));
  tray.position.set(0, topY + 0.04, -0.06);
  console3d.add(tray);
  const slotMat = new THREE.MeshStandardMaterial({ color: 0x220800, emissive: new THREE.Color(C.amber), emissiveIntensity: 0, roughness: 0.4 });
  const slot = new THREE.Mesh(new RoundedBoxGeometry(1.6, 0.03, 0.14, 2, 0.01), slotMat);
  slot.position.set(0, topY + 0.055, 0.3);
  console3d.add(slot);


  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const lin = (a, b, x) => clamp01((x - a) / (b - a));

  // ================= EP.2 SCREEN: boot + retro draw menu, drawn by t into a canvas texture =================
  const scrCanvas = document.createElement('canvas');
  scrCanvas.width = 3072; scrCanvas.height = Math.round(3072 * scrH / scrW);
  const scrTex = new THREE.CanvasTexture(scrCanvas);
  scrTex.colorSpace = THREE.SRGBColorSpace;
  scrTex.anisotropy = 16;
  screenMat.map = scrTex;
  screenMat.emissiveMap = scrTex;
  screenMat.emissive.set(0xffffff);
  screenMat.color.set(0x000000);
  screenMat.toneMapped = false;
  screenMesh.material = new THREE.MeshBasicMaterial({ map: scrTex, toneMapped: false }); // unlit: exact app colours, no light hotspot
  const bootLogo = new Image();
  pending.push(new Promise((res) => { bootLogo.onload = res; bootLogo.onerror = res; bootLogo.src = new URL('../img/wordmark-lg.webp', import.meta.url).href; }).then(() => bootLogo.decode?.().catch(() => {})));

  const LW = 1000, LH = 1000 * scrH / scrW; // logical units (like CSS px), canvas is 2.048x
  const K = scrCanvas.width / LW;
  const g = scrCanvas.getContext('2d');
  const PX = '"Press Start 2P", monospace', CRT = '"VT323", monospace';
  const INK = '#fef3d5', DIM = '#c9a98a', OFF = '#6d4a40', AMB = '#f3ae15', MAR = '#6a0200';

  function bgRadial(cx, cy, c0, c1, r) {
    const grd = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grd.addColorStop(0, c0); grd.addColorStop(1, c1);
    g.fillStyle = grd; g.fillRect(0, 0, LW, LH);
  }
  function scanlines(a = 0.16) {
    g.fillStyle = `rgba(0,0,0,${a})`;
    for (let y = 0; y < LH; y += 5) g.fillRect(0, y, LW, 2.2);
  }
  // pixel glyphs the pixel font lacks (drawn on a 7x7 grid, advance = 1em)
  const GLY = {
    '▶': ['1000000','1110000','1111100','1111111','1111100','1110000','1000000'],
    '▲': ['0000000','0001000','0011100','0111110','1111111','0000000','0000000'],
    '▼': ['0000000','0000000','1111111','0111110','0011100','0001000','0000000'],
    '✓': ['0000001','0000011','1000110','1101100','0111000','0010000','0000000'],
    '●': ['0011100','0111110','1111111','1111111','1111111','0111110','0011100'],
    '▣': ['0000000','1111111','1000001','1000111','1000101','1111111','0000000'],
    '○': ['0011100','0100010','1000001','1000001','1000001','0100010','0011100'],
  };
  function glyph(ch, x, y, size, color, shadow) {
    const rows = GLY[ch], c = (size * 0.78) / 7, top = y - size * 0.86;
    const paint = (dx, dy, col) => { g.fillStyle = col; rows.forEach((r, j) => { for (let i = 0; i < 7; i++) if (r[i] === '1') g.fillRect(x + dx + i * c, top + dy + j * c, c + 0.4, c + 0.4); }); };
    if (shadow) paint(shadow[0], shadow[1], shadow[2]);
    paint(0, 0, color);
  }
  function txt(s, x, y, { font = PX, size = 16, color = INK, align = 'left', ls = 0.04, shadow = null, measure = false } = {}) {
    g.font = `${size}px ${font}`;
    const lsp = ls * size;
    g.letterSpacing = lsp.toFixed(2) + 'px';
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    const segs = []; let buf = '';
    for (const ch of s) { if (GLY[ch]) { if (buf) segs.push(buf); buf = ''; segs.push({ g: ch }); } else buf += ch; }
    if (buf) segs.push(buf);
    const segW = (sg) => (typeof sg === 'string' ? g.measureText(sg).width : size + lsp);
    const total = segs.reduce((a, sg) => a + segW(sg), 0);
    if (measure) { g.letterSpacing = '0px'; return total; }
    let xx = align === 'right' ? x - total : align === 'center' ? x - total / 2 : x;
    for (const sg of segs) {
      if (typeof sg === 'string') {
        if (shadow) { g.fillStyle = shadow[2]; g.fillText(sg, xx + shadow[0], y + shadow[1]); }
        g.fillStyle = color; g.fillText(sg, xx, y);
      } else glyph(sg.g, xx, y, size, color, shadow);
      xx += segW(sg);
    }
    g.letterSpacing = '0px'; return total;
  }
  function wrap(s, x, y, maxW, { size = 30, color = INK, lh = 1.08 } = {}) {
    g.font = `${size}px ${CRT}`; g.letterSpacing = '0px';
    const words = s.split(' '); let line = '', yy = y;
    for (const w of words) {
      const test = line ? line + ' ' + w : w;
      if (g.measureText(test).width > maxW && line) { txt(line, x, yy, { font: CRT, size, color, ls: 0 }); line = w; yy += size * lh; }
      else line = test;
    }
    if (line) { txt(line, x, yy, { font: CRT, size, color, ls: 0 }); yy += size * lh; }
    return yy;
  }
  // RPG window: red gradient, cream double border
  function win(x, y, w, h) {
    g.fillStyle = '#000'; g.beginPath(); g.roundRect(x, y + 5, w, h, 9); g.fill();          // 0 4px 0 #000
    const grd = g.createLinearGradient(0, y, 0, y + h); grd.addColorStop(0, '#5a0006'); grd.addColorStop(1, '#2a0003');
    g.fillStyle = grd; g.beginPath(); g.roundRect(x, y, w, h, 9); g.fill();
    g.lineWidth = 3.5; g.strokeStyle = INK; g.beginPath(); g.roundRect(x + 1.75, y + 1.75, w - 3.5, h - 3.5, 8); g.stroke();
    g.lineWidth = 2; g.strokeStyle = '#000'; g.beginPath(); g.roundRect(x + 4.5, y + 4.5, w - 9, h - 9, 6); g.stroke();
    g.lineWidth = 2; g.strokeStyle = 'rgba(254,243,213,.25)'; g.beginPath(); g.roundRect(x + 6.5, y + 6.5, w - 13, h - 13, 5); g.stroke();
  }
  // amber pixel button (.gb.go); pressed = pushed down 3px
  function gbtn(label, x, y, { pressed = false, pulse = false, ink = '#2a0600', face = AMB, lip = '#9a6400', size = 15 } = {}) {
    const tw0 = txt(label, 0, -999, { size, ls: 0.05, measure: true });
    const w = tw0 + 36, h = size + 26, dy = pressed ? 4 : 0;
    g.fillStyle = '#000'; g.beginPath(); g.roundRect(x - 2.5, y - 2.5 + dy, w + 5, h + 5 + (pressed ? 1 : 6), 6); g.fill();
    g.fillStyle = lip; g.beginPath(); g.roundRect(x, y + dy + 5, w, h, 5); g.fill();
    g.fillStyle = face; g.beginPath(); g.roundRect(x, y + dy, w, h, 5); g.fill();
    if (pulse) { g.fillStyle = 'rgba(255,255,255,.14)'; g.beginPath(); g.roundRect(x, y + dy, w, h, 5); g.fill(); }
    txt(label, x + 18, y + dy + h / 2 + size / 2, { size, color: ink, ls: 0.05 });
    g.letterSpacing = '0px';
    return w;
  }
  function kv(k, v, x, y, w, { size = 28, vcol = INK } = {}) {
    const kw = txt(k, x, y, { font: CRT, size, color: DIM, ls: 0 });
    const vw = txt(v, 0, 0, { font: CRT, size, ls: 0, measure: true });
    txt(v, x + w, y, { font: CRT, size, color: vcol, align: 'right', ls: 0 });
    g.fillStyle = 'rgba(254,243,213,.35)';
    for (let xx = x + kw + 10; xx < x + w - vw - 10; xx += 6) g.fillRect(xx, y - 6, 2.5, 2.5);
  }


  // ================= STILLS: one static screen per post (logical 1000 x ~527) =================
  GLY['→'] = ['0000000','0001000','0001100','1111110','0001100','0001000','0000000'];
  GLY['←'] = ['0000000','0001000','0011000','0111111','0011000','0001000','0000000'];
  GLY['↓'] = ['0011100','0011100','0011100','1111111','0111110','0011100','0001000'];
  function frameTop(label) {
    bgRadial(LW / 2, LH * 0.55, '#4a0508', '#120202', LW * 0.72);
    g.fillStyle = 'rgba(230,2,17,0.08)';
    for (let yy = 104; yy < LH - 10; yy += 26) for (let xx = 14 + ((yy / 26) % 2) * 13; xx < LW; xx += 26) g.fillRect(xx, yy, 4, 4);
    if (bootLogo.naturalWidth) { const lw = 150, lh = lw * bootLogo.naturalHeight / bootLogo.naturalWidth; g.drawImage(bootLogo, 36, 26, lw, lh); }
    txt(label, LW - 36, 62, { size: 22, color: AMB, align: 'right', ls: 0.06, shadow: [3, 3, MAR] });
    g.fillStyle = 'rgba(254,243,213,.25)'; g.fillRect(36, 88, LW - 72, 3);
  }
  function ui(x, y, w, h, { top = '#5a0006', bot = '#2a0003', edge = INK, r = 10, lw = 3.5, drop = 6 } = {}) {
    g.fillStyle = '#000'; g.beginPath(); g.roundRect(x, y + drop, w, h, r); g.fill();
    const grd = g.createLinearGradient(0, y, 0, y + h); grd.addColorStop(0, top); grd.addColorStop(1, bot);
    g.fillStyle = grd; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
    if (edge) { g.lineWidth = lw; g.strokeStyle = edge; g.beginPath(); g.roundRect(x + lw / 2, y + lw / 2, w - lw, h - lw, r - 1); g.stroke(); }
  }
  // pixel coin: octagon-ish disc on a 9x9 grid
  const COIN = ['001111100','011111110','111111111','111111111','111111111','111111111','111111111','011111110','001111100'];
  function coin(cx, cy, size, face, rim, mark) {
    const c = size / 9, x0 = cx - size / 2, y0 = cy - size / 2;
    g.fillStyle = '#000'; COIN.forEach((r, j) => { for (let i = 0; i < 9; i++) if (r[i] === '1') g.fillRect(x0 + i * c + 4, y0 + j * c + 5, c + 0.5, c + 0.5); });
    COIN.forEach((r, j) => { for (let i = 0; i < 9; i++) if (r[i] === '1') { const edge = j === 0 || j === 8 || i === 0 || i === 8 || r[i - 1] !== '1' || r[i + 1] !== '1' || (COIN[j - 1] || '')[i] !== '1' || (COIN[j + 1] || '')[i] !== '1'; g.fillStyle = edge ? rim : face; g.fillRect(x0 + i * c, y0 + j * c, c + 0.5, c + 0.5); } });
    if (mark) txt(mark, cx + 1, cy + size * 0.2, { size: size * 0.42, color: rim, align: 'center', ls: 0 });
  }
  function arrowR(x0, x1, y, col = AMB) { // chunky pixel arrow pointing right
    g.fillStyle = MAR; for (let x = x0; x < x1 - 30; x += 22) g.fillRect(x + 4, y - 5, 14, 14);
    g.fillStyle = col; for (let x = x0; x < x1 - 30; x += 22) g.fillRect(x, y - 9, 14, 14);
    const hx = x1 - 30; g.fillStyle = MAR; for (let i = 0; i < 4; i++) g.fillRect(hx + i * 7 + 4, y - 26 + i * 7 + 4, 8, 48 - i * 14);
    g.fillStyle = col; for (let i = 0; i < 4; i++) g.fillRect(hx + i * 7, y - 26 + i * 7, 8, 48 - i * 14);
  }
  function arrowL(x0, x1, y, col = AMB) { // pointing left, from x1 to x0
    g.save(); g.translate(x0 + x1, 0); g.scale(-1, 1);
    // draw mirrored, with the shadow kept to the right-bottom by drawing it un-mirrored offset
    g.restore();
    g.fillStyle = MAR; for (let x = x1; x > x0 + 30; x -= 22) g.fillRect(x - 14 + 4, y - 5, 14, 14);
    g.fillStyle = col; for (let x = x1; x > x0 + 30; x -= 22) g.fillRect(x - 14, y - 9, 14, 14);
    const hx = x0 + 30; g.fillStyle = MAR; for (let i = 0; i < 4; i++) g.fillRect(hx - i * 7 - 8 + 4, y - 26 + i * 7 + 4, 8, 48 - i * 14);
    g.fillStyle = col; for (let i = 0; i < 4; i++) g.fillRect(hx - i * 7 - 8, y - 26 + i * 7, 8, 48 - i * 14);
  }

  const SCREENS = {
    // 1. two FIFO queues -> one shared position
    lobby() {
      frameTop('LOBBY');
      const cy = 300;
      // queue labels
      txt('1P', 175, 160, { size: 40, color: AMB, align: 'center', ls: 0, shadow: [4, 4, MAR] });
      txt('ETH', 175, 204, { size: 24, color: INK, align: 'center', ls: 0.04, shadow: [3, 3, '#000'] });
      txt('2P', 825, 160, { size: 40, color: AMB, align: 'center', ls: 0, shadow: [4, 4, MAR] });
      txt('$NIMORI', 825, 204, { size: 24, color: INK, align: 'center', ls: 0.04, shadow: [3, 3, '#000'] });
      // queues: front of the queue = nearest the middle, brightest
      [70, 160, 250].forEach((x, i) => { g.globalAlpha = [0.45, 0.7, 1][i]; coin(x + 15, cy, 74, '#d9d2c2', '#5a5560', null); g.globalAlpha = 1; });
      [750, 840, 930].forEach((x, i) => { g.globalAlpha = [1, 0.7, 0.45][i]; coin(x - 15, cy, 74, '#e60211', '#f3ae15', null); g.globalAlpha = 1; });
      arrowR(310, 380, cy + 2);
      arrowL(620, 690, cy + 2);
      // the shared position
      ui(390, cy - 92, 220, 184, { top: '#fff8e6', bot: '#f3d9a0', edge: INK, r: 12, drop: 8 });
      txt('1', 500, cy + 6, { size: 64, color: '#c40010', align: 'center', ls: 0, shadow: [4, 4, '#f3ae15'] });
      txt('POSITION', 500, cy + 56, { size: 21, color: MAR, align: 'center', ls: 0.02 });
      txt('UNISWAP V4', 500, cy + 140, { size: 22, color: DIM, align: 'center', ls: 0.06, shadow: [2, 2, '#000'] });
      txt('FIRST IN · FIRST OUT', LW / 2, LH - 36, { size: 22, color: AMB, align: 'center', ls: 0.06, shadow: [3, 3, MAR] });
      scanlines(0.12);
    },
    // 2. two save slots
    seats() {
      frameTop('SAVE FILES');
      const slot = (x, who, side, accent) => {
        const w = 400, y = 122, h = 300;
        ui(x, y, w, h, { r: 12, drop: 8 });
        g.lineWidth = 2; g.strokeStyle = '#000'; g.beginPath(); g.roundRect(x + 5, y + 5, w - 10, h - 10, 8); g.stroke();
        // cartridge tab
        ui(x + 24, y + 22, 92, 62, { top: accent, bot: accent === AMB ? '#c98400' : '#8a0008', edge: INK, r: 8, drop: 4 });
        txt(who, x + 70, y + 66, { size: 26, color: accent === AMB ? MAR : INK, align: 'center', ls: 0 });
        txt('SEAT', x + 140, y + 66, { size: 30, color: INK, ls: 0.04, shadow: [4, 4, '#000'] });
        txt('NFT', x + w - 30, y + 66, { size: 18, color: AMB, align: 'right', ls: 0.04 });
        g.fillStyle = 'rgba(254,243,213,.25)'; g.fillRect(x + 24, y + 104, w - 48, 3);
        kv('SIDE', side, x + 28, y + 160, w - 56, { size: 46, vcol: AMB });
        kv('ENTRY', '--', x + 28, y + 214, w - 56, { size: 46 });
        kv('FEES', '--', x + 28, y + 268, w - 56, { size: 46 });
      };
      slot(70, '1P', 'ETH', AMB);
      slot(530, '2P', '$NIMORI', '#e60211');
      txt('▶ TRADABLE: YOU CAN SELL IT', LW / 2, LH - 38, { size: 22, color: AMB, align: 'center', ls: 0.05, shadow: [3, 3, MAR] });
      scanlines(0.12);
    },
    // 3. mover rule: the asset that moved most carries the IL
    mover() {
      frameTop('EXIT RULE');
      const base = 380;
      g.fillStyle = 'rgba(254,243,213,.45)'; g.fillRect(120, base + 6, 760, 4);
      ui(116, 112, 160, 40, { top: '#2a0003', bot: '#2a0003', edge: DIM, r: 6, lw: 2.5, drop: 0 }); txt('EXAMPLE', 196, 141, { size: 18, color: DIM, align: 'center', ls: 0.06 });
      const bar = (cx, h, label, col, top) => {
        const w = 150;
        g.fillStyle = '#000'; g.fillRect(cx - w / 2 + 7, base - h + 7, w, h);
        g.fillStyle = col; g.fillRect(cx - w / 2, base - h, w, h);
        g.fillStyle = top; g.fillRect(cx - w / 2, base - h, w, 12);
        g.fillStyle = 'rgba(0,0,0,.18)'; for (let yy = base - h + 24; yy < base; yy += 24) g.fillRect(cx - w / 2, yy, w, 4);
        txt(label, cx, base + 50, { size: 24, color: INK, align: 'center', ls: 0.04, shadow: [3, 3, '#000'] });
      };
      bar(290, 84, 'ETH', '#c9c2b4', '#f5efe2');
      bar(640, 210, '$NIMORI', '#e60211', '#ff6a5a');
      txt('MOVED LESS', 290, base - 108, { size: 22, color: DIM, align: 'center', ls: 0.04, shadow: [2, 2, '#000'] });
      // the IL weight hangs on the bigger mover
      const wx = 800, wy = 196;
      g.fillStyle = AMB; g.fillRect(715, base - 210 + 30, 46, 8); g.fillRect(753, base - 210 + 30, 8, wy - (base - 210 + 30) + 6);
      g.fillStyle = '#000'; g.beginPath(); g.moveTo(wx - 58 + 6, wy + 120 + 6); g.lineTo(wx + 58 + 6, wy + 120 + 6); g.lineTo(wx + 40 + 6, wy + 6 + 14); g.lineTo(wx - 40 + 6, wy + 6 + 14); g.closePath(); g.fill();
      g.fillStyle = AMB; g.beginPath(); g.moveTo(wx - 58, wy + 120); g.lineTo(wx + 58, wy + 120); g.lineTo(wx + 40, wy + 14); g.lineTo(wx - 40, wy + 14); g.closePath(); g.fill();
      g.fillStyle = '#c98400'; g.fillRect(wx - 58, wy + 108, 116, 12);
      g.lineWidth = 8; g.strokeStyle = AMB; g.beginPath(); g.arc(wx, wy + 8, 18, Math.PI, 0); g.stroke();
      txt('IL', wx + 2, wy + 92, { size: 40, color: MAR, align: 'center', ls: 0 });
      txt('MOVED MORE', 640, base - 232, { size: 22, color: AMB, align: 'center', ls: 0.04, shadow: [2, 2, MAR] });
      txt('BIGGER MOVE CARRIES THE IL', LW / 2, LH - 30, { size: 22, color: AMB, align: 'center', ls: 0.04, shadow: [3, 3, MAR] });
      scanlines(0.12);
    },
    // 4. 24h timer: before = rage quit 1% to partner, after = unplug free
    timer() {
      frameTop('SESSION');
      const x0 = 70, x1 = 930, xm = 560, y = 300, h = 64;
      // before 24H
      ui(x0, y - h / 2, xm - x0, h, { top: '#e60211', bot: '#8a0008', edge: null, r: 8 });
      g.fillStyle = 'rgba(0,0,0,.22)'; for (let xx = x0 + 10; xx < xm - 10; xx += 26) { g.beginPath(); g.moveTo(xx, y + h / 2); g.lineTo(xx + 16, y + h / 2); g.lineTo(xx + 34, y - h / 2); g.lineTo(xx + 18, y - h / 2); g.closePath(); g.fill(); }
      // after 24H
      ui(xm, y - h / 2, x1 - xm, h, { top: '#f3ae15', bot: '#c98400', edge: null, r: 8 });
      g.lineWidth = 3.5; g.strokeStyle = INK; g.beginPath(); g.roundRect(x0, y - h / 2, x1 - x0, h, 8); g.stroke();
      // 24H flag
      g.fillStyle = INK; g.fillRect(xm - 4, y - 120, 8, 160);
      ui(xm - 70, y - 176, 140, 64, { top: '#fff8e6', bot: '#f3d9a0', edge: INK, r: 8, drop: 5 });
      txt('24H', xm, y - 128, { size: 32, color: '#c40010', align: 'center', ls: 0 });
      // pixel clock
      const cx = 200, cy = 170, r = 46;
      g.fillStyle = '#000'; g.beginPath(); g.arc(cx + 5, cy + 6, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#2a0003'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      g.lineWidth = 6; g.strokeStyle = INK; g.beginPath(); g.arc(cx, cy, r - 3, 0, Math.PI * 2); g.stroke();
      g.fillStyle = INK; g.fillRect(cx - 3, cy - 30, 7, 34); g.fillRect(cx - 3, cy - 3, 26, 7);
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.fillRect(cx + Math.cos(a) * 33 - 2, cy + Math.sin(a) * 33 - 2, 4, 4); }
      // labels
      txt('RAGE QUIT', (x0 + xm) / 2, y + 90, { size: 28, color: INK, align: 'center', ls: 0.02, shadow: [3, 3, '#000'] });
      txt('1% TO YOUR PARTNER', (x0 + xm) / 2, y + 138, { size: 22, color: '#ff8a7a', align: 'center', ls: 0.04, shadow: [2, 2, '#000'] });
      txt('UNPLUG', (xm + x1) / 2, y + 90, { size: 28, color: AMB, align: 'center', ls: 0.02, shadow: [3, 3, MAR] });
      txt('FREE', (xm + x1) / 2, y + 138, { size: 22, color: AMB, align: 'center', ls: 0.06, shadow: [2, 2, MAR] });
      txt('PLUG IN', x0 + 4, y - 52, { size: 18, color: DIM, ls: 0.04 });
      scanlines(0.12);
    },
    // open source: retro terminal with the real repo files
    terminal() {
      frameTop('TERMINAL');
      const L = 52, x = 54; let y = 150;
      const S = 44;
      const line = (parts) => { let xx = x; for (const [s, c] of parts) { txt(s, xx, y, { font: CRT, size: S, color: c, ls: 0 }); xx += txt(s, 0, 0, { font: CRT, size: S, ls: 0, measure: true }); } y += L; return xx; };
      line([['$ ', AMB], ['git clone github.com/nimoricoop/nimori-app', INK]]);
      line([['$ ', AMB], ['ls', INK]]);
      const row = (f, d) => { txt(f, x + 28, y, { font: CRT, size: S, color: INK, ls: 0 }); txt(d, x + 440, y, { font: CRT, size: S, color: DIM, ls: 0 }); y += L; };
      row('api/plug.js', '# the plug-in endpoint');
      row('scripts/draw.js', '# picks the winners');
      row('js/scene.js', '# the 3D console');
      row('docs/nimori-docs.md', '# the rules');
      const ex = line([['$ ', AMB], ['node scripts/draw.js', INK]]);
      g.fillStyle = AMB; g.fillRect(ex + 14, y - L - 32, 20, 36);
      scanlines(0.12);
    },
  };
  function drawStill(name) {
    g.setTransform(K, 0, 0, K, 0, 0);
    g.imageSmoothingEnabled = true;
    g.fillStyle = '#070101'; g.fillRect(0, 0, LW, LH);
    SCREENS[name]();
    scrTex.needsUpdate = true;
  }
  // ---------- front: controller ports ----------
  const portY = 0.47;
  const ports = [];
  function makePort(x) {
    const g = new THREE.Group();
    // outer red frame, protruding from the wall
    const fs = roundedRectShape(0.62, 0.36, 0.1);
    fs.holes.push(roundedRectPath(0.46, 0.24, 0.06));
    const frameGeo = new THREE.ExtrudeGeometry(fs, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.022, bevelSegments: 5, curveSegments: 16 });
    const frame = new THREE.Mesh(smoothGeo(frameGeo), redPlastic);
    frame.castShadow = true;
    g.add(frame);
    // black sleeve inside the frame
    const ss = roundedRectShape(0.46, 0.24, 0.06);
    ss.holes.push(roundedRectPath(0.4, 0.19, 0.045));
    const sleeve = new THREE.Mesh(new THREE.ExtrudeGeometry(ss, { depth: 0.05, bevelEnabled: false, curveSegments: 16 }), blackPlastic);
    sleeve.position.z = 0.005;
    g.add(sleeve);
    // cavity back
    const back = new THREE.Mesh(new THREE.ShapeGeometry(roundedRectShape(0.44, 0.22, 0.05)), cavity);
    back.position.z = 0.003;
    g.add(back);
    // tongue + pins
    const tongue = new THREE.Mesh(new RoundedBoxGeometry(0.27, 0.065, 0.04, 2, 0.012), new THREE.MeshStandardMaterial({ color: 0x1c1616, roughness: 0.5 }));
    tongue.position.set(0, 0, 0.022);
    g.add(tongue);
    for (let i = 0; i < 5; i++) {
      const pin = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.026, 0.01), gold);
      pin.position.set(-0.09 + i * 0.045, 0, 0.043);
      g.add(pin);
    }
    g.position.set(x, portY, zf);
    console3d.add(g);
    return g;
  }
  const P1X = -0.5, P2X = 0.36;
  ports.push(makePort(P1X), makePort(P2X));

  // embossed "1P" / "2P" labels under ports
  [[P1X, '1P'], [P2X, '2P']].forEach(([x, t]) => {
    const tex = textTexture(t, { w: 256, h: 128, font: '400 96px "Lilita One", Rubik, sans-serif', color: '#ffffff' });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1), new THREE.MeshStandardMaterial({ map: tex, color: 0x5c0002, transparent: true, opacity: 0.7, roughness: 0.5, depthWrite: false }));
    m.position.set(x, portY - 0.265, zf + 0.001);
    console3d.add(m);
  });

  // status LED next to port 2
  const ledMat = new THREE.MeshStandardMaterial({ color: 0x331100, emissive: new THREE.Color(C.led), emissiveIntensity: 3, roughness: 0.2 });
  const led = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.03, 32), ledMat);
  led.rotation.x = Math.PI / 2;
  led.position.set(P2X + 0.43, portY, zf + 0.012);
  console3d.add(led);
  const ledRing = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.01, 10, 40), blackPlastic);
  ledRing.position.copy(led.position).add(new THREE.Vector3(0, 0, -0.004));
  console3d.add(ledRing);
  const haloMat = new THREE.SpriteMaterial({ map: radialTexture('rgba(255,160,70,0.95)', 'rgba(255,90,20,0)'), color: C.led, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.set(0.34, 0.34, 1);
  halo.position.copy(led.position).add(new THREE.Vector3(0, 0, 0.03));
  console3d.add(halo);
  const ledLight = new THREE.PointLight(C.led, 0.6, 1.2, 2);
  ledLight.position.copy(led.position).add(new THREE.Vector3(0, 0, 0.12));
  console3d.add(ledLight);

  // range LED strip (difficulty): 5 segments on the front right
  const rangeLeds = [];
  const rangeX0 = 1.18;
  for (let i = 0; i < 5; i++) {
    const m = new THREE.MeshStandardMaterial({ color: 0x2a0503, emissive: new THREE.Color(C.amber), emissiveIntensity: 0, roughness: 0.3 });
    const seg = new THREE.Mesh(new RoundedBoxGeometry(0.12, 0.07, 0.03, 2, 0.012), m);
    seg.position.set(rangeX0 + i * 0.16, portY + 0.03, zf + 0.012);
    console3d.add(seg);
    rangeLeds.push(seg);
  }
  const rangeLbl = new THREE.Mesh(new THREE.PlaneGeometry(0.78, 0.1), new THREE.MeshStandardMaterial({
    map: textTexture('RANGE', { w: 512, h: 64, font: '700 44px "IBM Plex Mono", monospace', color: '#ffffff' }),
    color: 0x5c0002, transparent: true, opacity: 0.75, depthWrite: false,
  }));
  rangeLbl.position.set(rangeX0 + 0.32, portY - 0.1, zf + 0.001);
  console3d.add(rangeLbl);
  const rangeBezel = new THREE.Mesh(new RoundedBoxGeometry(0.86, 0.13, 0.02, 3, 0.03), blackPlastic);
  rangeBezel.position.set(rangeX0 + 0.32, portY + 0.03, zf + 0.002);
  console3d.add(rangeBezel);

  // power switch on the front left
  const sw = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.1, 0.05, 3, 0.03), redMould);
  sw.position.set(-1.55, portY, zf + 0.02);
  console3d.add(sw);
  const swLed = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.02, 20), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2a10, emissiveIntensity: 2 }));
  swLed.rotation.x = Math.PI / 2;
  swLed.position.set(-1.25, portY, zf + 0.01);
  console3d.add(swLed);

  // feet
  [[-1.7, -1.0], [1.7, -1.0], [-1.7, 1.0], [1.7, 1.0]].forEach(([x, z]) => {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.04, 24), blackPlastic);
    f.position.set(x, 0.02, z);
    console3d.add(f);
  });
  body.position.y = 0.035;

  // contact shadow under the body
  const ao = new THREE.Mesh(new THREE.PlaneGeometry(W * 1.35, D * 1.5), new THREE.MeshBasicMaterial({
    map: radialTexture('rgba(20,0,0,0.75)', 'rgba(20,0,0,0)'), transparent: true, depthWrite: false,
  }));
  ao.rotation.x = -Math.PI / 2;
  ao.position.y = 0.002;
  scene.add(ao);

  // ---------- plugs + coiled cables ----------
  function makePlug() {
    const g = new THREE.Group();
    const tip = new THREE.Mesh(new RoundedBoxGeometry(0.36, 0.165, 0.2, 3, 0.03), creamPlastic);
    tip.position.z = 0.06;
    g.add(tip);
    const grip = new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.23, 0.2, 5, 0.07), creamPlastic);
    grip.position.z = 0.24;
    grip.castShadow = true;
    g.add(grip);
    for (let i = 0; i < 4; i++) {
      const r = new THREE.Mesh(new RoundedBoxGeometry(0.455, 0.018, 0.018, 2, 0.008), creamPlastic);
      r.position.set(0, 0.07 - i * 0.046, 0.24);
      g.add(r);
    }
    const reliefGeo = new THREE.CylinderGeometry(0.042, 0.08, 0.2, 28, 1);
    reliefGeo.rotateX(Math.PI / 2);
    const relief = new THREE.Mesh(reliefGeo, creamPlastic);
    relief.position.z = 0.43;
    relief.castShadow = true;
    g.add(relief);
    return g;
  }
  function makeCable(points) {
    const { curve, N } = coiledCurve(points, { pitch: 0.068, coilR: 0.07, lead: 0.28 });
    const geo = new THREE.TubeGeometry(curve, Math.min(N * 2, 4000), 0.03, 10, false);
    const m = new THREE.Mesh(geo, creamPlastic);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  const floorY = 0.1;
  // 1P: plugged, cable runs forward then off to the left
  const cable1 = new THREE.Group();
  const plug1 = makePlug();
  cable1.add(plug1);
  cable1.add(makeCable([
    new THREE.Vector3(0, 0, 0.5), new THREE.Vector3(0, -0.02, 0.72), new THREE.Vector3(-0.06, -0.22, 1.05),
    new THREE.Vector3(-0.3, floorY - portY, 1.5), new THREE.Vector3(-0.9, floorY - portY, 1.95),
    new THREE.Vector3(-1.8, floorY - portY, 2.05), new THREE.Vector3(-2.7, floorY - portY, 1.6),
    new THREE.Vector3(-3.6, floorY - portY, 1.3), new THREE.Vector3(-5.2, floorY - portY, 1.6),
  ]));
  cable1.position.set(P1X, portY, zf);
  console3d.add(cable1);

  // 2P: hidden until "plug in", slides in from the front, cable off to the right
  const cable2 = new THREE.Group();
  cable2.add(makePlug());
  cable2.add(makeCable([
    new THREE.Vector3(0, 0, 0.5), new THREE.Vector3(0, -0.02, 0.74), new THREE.Vector3(0.08, -0.22, 1.1),
    new THREE.Vector3(0.35, floorY - portY, 1.6), new THREE.Vector3(1.0, floorY - portY, 2.05),
    new THREE.Vector3(2.0, floorY - portY, 2.1), new THREE.Vector3(3.0, floorY - portY, 1.7),
    new THREE.Vector3(4.2, floorY - portY, 1.9), new THREE.Vector3(5.6, floorY - portY, 2.4),
  ]));
  const cable2Home = new THREE.Vector3(P2X, portY, zf);
  cable2.position.copy(cable2Home);
  cable2.visible = false;
  console3d.add(cable2);


  // port-1 status LED (ep.3: both players plugged, both LEDs green)
  const led1Mat = ledMat.clone();
  const led1 = new THREE.Mesh(led.geometry, led1Mat);
  led1.rotation.x = Math.PI / 2;
  led1.position.set(P1X + 0.43, portY, zf + 0.012);
  console3d.add(led1);
  const led1Ring = new THREE.Mesh(ledRing.geometry, blackPlastic);
  led1Ring.position.copy(led1.position).add(new THREE.Vector3(0, 0, -0.004));
  console3d.add(led1Ring);
  const halo1Mat = haloMat.clone();
  const halo1 = new THREE.Sprite(halo1Mat);
  halo1.position.copy(led1.position).add(new THREE.Vector3(0, 0, 0.03));
  console3d.add(halo1);
  const led1Light = new THREE.PointLight(C.led, 0.6, 1.2, 2);
  led1Light.position.copy(led1.position).add(new THREE.Vector3(0, 0, 0.12));
  console3d.add(led1Light);


  // ================= STILLS CONTROLLER: static lighting, camera square to the screen =================
  cable2.visible = true;
  cable2.position.copy(cable2Home);
  const W_ = width, H_ = height;
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(W_, H_, false);
  renderer.domElement.style.width = W_ + 'px';
  renderer.domElement.style.height = H_ + 'px';
  camera.aspect = W_ / H_;
  camera.updateProjectionMatrix();
  const pr = renderer.getPixelRatio();
  const rt = new THREE.WebGLRenderTarget(W_ * pr, H_ * pr, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(pr);
  composer.setSize(W_, H_);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W_, H_), 0.32, 0.4, 1.15);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  lid.rotation.x = -1.83;
  console3d.updateMatrixWorld(true);
  const green = new THREE.Color(C.ledOk);
  const scrC = new THREE.Vector3(), scrN = new THREE.Vector3(), q = new THREE.Quaternion();
  // still = { screen, dist, yaw (deg), pitch (deg, extra), fov, shiftY (fraction of frame height, + = screen moves down) }
  function renderStill({ screen, dist = 6.3, yaw = 0, pitch = 0, fov = 26, shiftY = 0.11, shiftX = 0 }) {
    screenMesh.getWorldPosition(scrC);
    screenMesh.getWorldQuaternion(q);
    scrN.set(0, 0, 1).applyQuaternion(q); // plane normal (front face)
    const dir = scrN.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(yaw));
    const side = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    dir.applyAxisAngle(side, THREE.MathUtils.degToRad(-pitch));
    camera.fov = fov;
    camera.position.copy(scrC).addScaledVector(dir, dist);
    camera.lookAt(scrC);
    camera.setViewOffset(W_, H_, -shiftX * W_, -shiftY * H_, W_, H_);
    camera.updateProjectionMatrix();

    renderer.toneMappingExposure = 1.12;
    scene.environmentIntensity = 0.8;
    key.intensity = 2.1;
    rim.intensity = 1.8;
    bloom.strength = 0.34;
    for (const [m, hm, hs, ll] of [[ledMat, haloMat, halo, ledLight], [led1Mat, halo1Mat, halo1, led1Light]]) {
      m.emissive.copy(green); m.emissiveIntensity = 2.8;
      hm.color.copy(green); hm.opacity = 0.75;
      ll.color.copy(green); ll.intensity = 0.55;
      hs.scale.setScalar(0.32);
    }
    rangeLeds.forEach((s, i) => { s.material.emissiveIntensity = i < 3 ? 2.2 : 0.15; });
    screenMat.emissiveIntensity = 1.0;
    screenGlow.color.set(0xff4a2a);
    screenGlow.intensity = 1.4;
    slotMat.emissiveIntensity = 2.0;
    drawStill(screen);
    composer.render();
  }

  return { renderStill, ready: Promise.all(pending), renderer, camera, screenMesh };
}
