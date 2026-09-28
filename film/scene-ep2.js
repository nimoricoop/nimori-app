// NIMORI — FILM EP.2 (copied from film/scene-film.js). Everything is a pure function of time t via renderAt(t). Do not use in the app.
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
  scrCanvas.width = 2048; scrCanvas.height = Math.round(2048 * scrH / scrW);
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

  // ---- boot (the app's own boot screen) ----
  function drawBoot(t, B) {
    bgRadial(LW / 2, LH * 0.42, '#2a0405', '#0a0101', LW * 0.62);
    const lp = lin(B.logoA, B.logoB, t);
    if (lp > 0 && bootLogo.naturalWidth) {
      const st = Math.min(5, Math.floor(lp * 5 + 1)) / 5; // steps(5)
      const s = 0.6 + 0.4 * st, lw = 440 * s, lh = lw * bootLogo.naturalHeight / bootLogo.naturalWidth;
      g.globalAlpha = st;
      g.save(); g.shadowColor = 'rgba(230,2,17,.45)'; g.shadowBlur = 30; g.shadowOffsetY = 8;
      g.drawImage(bootLogo, (LW - lw) / 2, LH * 0.36 - lh / 2, lw, lh); g.restore();
      g.globalAlpha = 1;
    }
    if (t >= B.logoB) {
      const bw = 330, bh = 26, bx = (LW - bw) / 2, by = LH * 0.6;
      g.fillStyle = '#000'; g.fillRect(bx - 6.5, by - 6.5, bw + 13, bh + 13);
      g.fillStyle = INK; g.fillRect(bx - 3.5, by - 3.5, bw + 7, bh + 7);
      g.fillStyle = '#000'; g.fillRect(bx, by, bw, bh);
      const p = barFill(t, B);
      const fw = Math.floor((bw - 6) * p / 15) * 15;
      for (let x = 0; x < fw; x += 15) { g.fillStyle = '#e60211'; g.fillRect(bx + 3 + x, by + 3, 12, bh - 6); g.fillStyle = '#b8000d'; g.fillRect(bx + 15 + x, by + 3, 3, bh - 6); }
      const ready = t >= B.start;
      const on = !ready || Math.floor((t - B.start) / 0.2) % 2 === 0;
      if (on) txt(ready ? 'PRESS START' : 'LOADING', LW / 2, by + 72, { size: 18, color: AMB, align: 'center', ls: 0.12 });
      txt('CO-OP LIQUIDITY · ROBINHOOD CHAIN', LW / 2, LH - 30, { size: 10, color: '#8a6a55', align: 'center', ls: 0.14 });
    }
    scanlines(0.2);
  }
  function barFill(t, B) {
    const u = lin(B.barA, B.barB, t);
    return Math.min(1, Math.floor((0.12 + 0.88 * easeOutCubic(u)) * 8) / 8 + (u >= 1 ? 1 : 0));
  }

  // ---- ticket reels: each char scrolls like a slot reel and locks left to right ----
  const HEX = '0123456789ABCDEF';
  const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return (h ^ (h >>> 16)) >>> 0; };
  function reelPos(t, t0, L, v = 16, tau = 0.32) {
    const f = (s) => (s > tau ? v * (s - tau / 2) : (v * s * s) / (2 * tau));
    const Kf = Math.ceil(f(L - t0)) + 1;
    if (t >= L) { const d = t - L; return { K: Kf, pos: Kf + 0.14 * Math.sin(d * 34) * Math.exp(-d * 11) }; }
    return { K: Kf, pos: Kf - f(L - Math.max(t, t0)) };
  }
  function drawCode(code, x, y, t, M, size) {
    // "NMR-" fixed, then 6 reels
    const cw = size * 1.0;
    txt('NMR-', x, y, { size, color: '#fff', ls: 0, shadow: [4, 4, MAR] });
    const x0 = x + cw * 4;
    const tail = code.slice(4);
    for (let i = 0; i < 6; i++) {
      const L = M.locks[i];
      const { K, pos } = reelPos(t, M.rollA, L);
      const locked = t >= L;
      const cx = x0 + i * cw;
      g.save(); g.beginPath(); g.rect(cx - 2, y - size - 6, cw + 4, size + 14); g.clip();
      const base = Math.floor(pos), fr = pos - base;
      for (const k of [base - 1, base, base + 1]) {
        const ch = k === K ? tail[i] : HEX[hash(k, i + 7) & 15];
        const yy = y + (k - pos) * (size * 2.2);
        txt(ch, cx, yy, { size, color: locked ? '#fff' : AMB, ls: 0, shadow: [4, 4, MAR] });
      }
      g.restore();
      // lock flash under each reel
      if (locked && t - L < 0.25) { g.fillStyle = `rgba(255,248,220,${(0.55 * (1 - (t - L) / 0.25)).toFixed(3)})`; g.fillRect(cx - 3, y - size - 8, cw + 4, size + 18); }
    }
  }

  // ---- the draw menu ----
  const ITEMS = ['CONNECT', 'PLUG IN', 'MY TICKET', 'SHARE ON X', 'RULES'];
  const ADDR = '0x71C4…ab12';
  function drawMenu(t, M) {
    bgRadial(LW / 2, LH * 0.3, '#2a0405', '#120202', LW * 0.7);
    const connected = t >= M.connected, signed = t >= M.signed, ticket = t >= M.toTicket;
    let sel = 0; if (t >= M.toPlug) sel = 1; if (t >= M.toTicket) sel = 2;
    // header
    txt('PRE-LAUNCH DRAW', 30, 50, { size: 24, color: AMB, ls: 0.06, shadow: [3, 3, MAR] });
    txt(signed ? 'P2 ●' : 'P2 ○', LW - 30, 48, { size: 15, color: signed ? INK : DIM, align: 'right', ls: 0.06 });
    // left menu
    const mx = 30, my = 76, mw = 262, rh = 48;
    win(mx, my, mw, 26 + rh * ITEMS.length);
    ITEMS.forEach((lab, i) => {
      const label = i === 0 && connected ? 'WALLET ✓' : lab;
      const enabled = i === 0 || i === 4 || (i === 1 && connected) || (i >= 2 && i <= 3 && signed);
      const y = my + 13 + i * rh;
      if (i === sel) { g.fillStyle = 'rgba(254,243,213,.09)'; g.beginPath(); g.roundRect(mx + 9, y, mw - 18, rh - 4, 4); g.fill(); }
      txt(label, mx + 46, y + rh / 2 + 7, { size: 16, color: i === sel ? INK : enabled ? DIM : OFF, ls: 0.04 });
    });
    // cursor: slides between rows in 3 frames, blinks while resting
    const moves = [[M.toPlug, 0, 1], [M.toTicket, 1, 2]];
    let cy = sel, moving = false;
    for (const [tm, a, b] of moves) if (t >= tm && t < tm + 0.1) { cy = a + (b - a) * easeOutCubic((t - tm) / 0.1); moving = true; }
    const rest = t - Math.max(M.menu, ...moves.map((m) => (t >= m[0] ? m[0] : -1)));
    const blinkOn = moving || rest < 0.25 || Math.floor((rest - 0.25) / 0.45) % 2 === 0;
    if (blinkOn) txt('▶', mx + 20, my + 13 + cy * rh + rh / 2 + 7, { size: 15, color: AMB, ls: 0 });
    // right window
    const wx = 308, wy = 76, ww = LW - 30 - wx, wh = LH - 76 - 58;
    win(wx, wy, ww, wh);
    const ix = wx + 26, iw = ww - 52;
    txt(sel === 0 ? (connected ? 'WALLET ✓' : 'CONNECT') : ITEMS[sel], ix, wy + 44, { size: 17, color: AMB, ls: 0.05 });
    let y = wy + 90;
    if (sel === 0) {
      if (!connected) {
        y = wrap('Plug a wallet into port 2. Any EVM wallet works. Connecting only reads your address.', ix, y, iw);
        const pressed = t >= M.connectPress && t < M.connectPress + 0.14;
        gbtn('▶ CONNECT WALLET', ix, y + 6, { pressed, pulse: Math.floor(t / 0.7) % 2 === 0 });
      } else {
        const a = Math.min(1, (t - M.connected) / 0.3);
        kv('WALLET', ADDR.slice(0, Math.ceil(ADDR.length * a)), ix, y, iw);
        kv('APP', 'BROWSER WALLET', ix, y + 34, iw);
        wrap('Connecting only reads your address.', ix, y + 84, iw, { size: 25, color: DIM });
      }
    } else if (sel === 1) {
      kv('WALLET', ADDR, ix, y, iw);
      y += 50;
      if (!signed) {
        y = wrap('Sign one free message. No transaction, no approval, nothing leaves your wallet.', ix, y, iw);
        const busy = t >= M.plugPress + 0.14;
        const pressed = t >= M.plugPress && t < M.plugPress + 0.14;
        gbtn(busy ? 'CHECK YOUR WALLET…' : '▶ PLUG IN', ix, y + 6, { pressed, pulse: !busy && Math.floor(t / 0.7) % 2 === 0, face: busy ? '#b9892a' : AMB });
      } else {
        wrap('This wallet is plugged in. One wallet, one ticket.', ix, y, iw);
        kv('STATUS', 'SIGNED ✓', ix, y + 80, iw, { vcol: '#9dff6a' });
      }
    } else {
      // ticket card
      const tx = ix, ty = y - 26, tw = Math.min(520, iw), th = 196;
      const lockAll = M.locks[5];
      const glow = t >= lockAll ? Math.exp(-(t - lockAll) * 4) : 0;
      if (glow > 0.01) { g.save(); g.shadowColor = `rgba(243,174,21,${(0.9 * glow).toFixed(3)})`; g.shadowBlur = 40; g.fillStyle = '#e60211'; g.beginPath(); g.roundRect(tx, ty, tw, th, 7); g.fill(); g.restore(); }
      g.fillStyle = '#000'; g.beginPath(); g.roundRect(tx - 2.5, ty - 2.5, tw + 5, th + 5, 8); g.fill();
      const grd = g.createLinearGradient(0, ty, 0, ty + th); grd.addColorStop(0, '#e60211'); grd.addColorStop(1, '#8f000a');
      g.fillStyle = grd; g.beginPath(); g.roundRect(tx, ty, tw, th, 7); g.fill();
      g.lineWidth = 3.5; g.strokeStyle = INK; g.beginPath(); g.roundRect(tx + 1.75, ty + 1.75, tw - 3.5, th - 3.5, 6); g.stroke();
      if (bootLogo.naturalWidth) { const lh = 26, lw = lh * bootLogo.naturalWidth / bootLogo.naturalHeight; g.drawImage(bootLogo, tx + 18, ty + 16, lw, lh); }
      txt('SAMPLE TICKET', tx + tw - 18, ty + 36, { size: 10, color: INK, align: 'right', ls: 0.06 });
      drawCode('NMR-PLAYR2', tx + 18, ty + 102, t, M, 38);
      kv('WALLET', ADDR, tx + 18, ty + 144, tw - 36, { size: 26 });
      kv('CARTRIDGE', 'NORMAL', tx + 18, ty + 176, tw - 36, { size: 26 });
      if (t >= M.shareBtn) {
        const st = Math.min(1, Math.floor(((t - M.shareBtn) / 0.12) * 3 + 1) / 3);
        g.globalAlpha = st;
        gbtn('▶ SHARE ON X', tx, ty + th + 22, { pulse: Math.floor(t / 0.7) % 2 === 0 });
        g.globalAlpha = 1;
      }
      // pixel sparkles on lock
      if (t >= lockAll && t < lockAll + 0.7) {
        const d = t - lockAll;
        for (let k = 0; k < 14; k++) {
          const a = (k / 14) * Math.PI * 2 + 0.3, r = 40 + d * 520 * (0.7 + 0.3 * ((k * 7) % 5) / 5);
          const sx = tx + tw / 2 + Math.cos(a) * r * 1.4, sy = ty + th / 2 + Math.sin(a) * r * 0.75;
          const s = Math.floor(8 * (1 - d / 0.7)) + 2;
          g.fillStyle = k % 2 ? AMB : INK; g.globalAlpha = 1 - d / 0.7;
          g.fillRect(Math.round(sx), Math.round(sy), s, s);
        }
        g.globalAlpha = 1;
      }
    }
    // footer
    txt('▲▼ MOVE    ENTER SELECT', LW - 30, LH - 24, { size: 11, color: DIM, align: 'right', ls: 0.06 });

    // SIGN dialog (wallet prompt)
    if (t >= M.signA && t < M.signB) {
      const pop = Math.min(1, Math.floor(((t - M.signA) / 0.1) * 3 + 1) / 3);
      const out = t >= M.signB - 0.1 ? Math.max(0, (M.signB - t) / 0.1) : 1;
      const s = (0.85 + 0.15 * pop) * (0.9 + 0.1 * out);
      g.fillStyle = `rgba(0,0,0,${(0.55 * pop * out).toFixed(3)})`; g.fillRect(0, 0, LW, LH);
      g.save(); g.globalAlpha = pop * out; g.translate(LW / 2, LH / 2 + 10); g.scale(s, s);
      const dw = 460, dh = 214;
      win(-dw / 2, -dh / 2, dw, dh);
      g.strokeStyle = AMB; g.lineWidth = 2.5; g.strokeRect(-dw / 2 + 24, -dh / 2 + 26, 38, 38);
      txt('▣', -dw / 2 + 29, -dh / 2 + 55, { size: 26, color: AMB, ls: 0 });
      txt('SIGN MESSAGE', -dw / 2 + 78, -dh / 2 + 55, { size: 18, color: AMB, ls: 0.05 });
      wrap('Free signature. No gas, no approval.', -dw / 2 + 26, -dh / 2 + 104, dw - 52, { size: 27 });
      const done = t >= M.signed;
      if (!done) {
        const dots = '.'.repeat(1 + (Math.floor((t - M.signA) / 0.16) % 3));
        txt('WAITING' + dots, -dw / 2 + 26, dh / 2 - 34, { size: 14, color: DIM, ls: 0.06 });
      } else {
        const fl = Math.exp(-(t - M.signed) * 10);
        gbtn('✓ SIGNED', -dw / 2 + 24, dh / 2 - 66, { face: fl > 0.3 ? '#fff' : '#9dff6a', lip: '#3f8a1c', ink: '#0d2a00' });
      }
      g.restore();
    }
    scanlines(0.16);
  }

  // CRT power-on over the dark boot: a hot line that opens vertically
  function drawPower(p) {
    if (p <= 0 || p >= 1) return;
    const openH = Math.max(3, LH * smooth(0.25, 1, p));
    const lineW = LW * smooth(0, 0.3, p);
    g.globalAlpha = 1 - smooth(0.55, 1, p);
    g.fillStyle = '#fff8ec'; g.fillRect((LW - lineW) / 2, (LH - openH) / 2, lineW, openH);
    g.globalAlpha = 1;
  }

  function drawScreen(t, B, M) {
    g.setTransform(K, 0, 0, K, 0, 0);
    g.imageSmoothingEnabled = true;
    g.fillStyle = '#070101'; g.fillRect(0, 0, LW, LH);
    if (t < B.power) { /* dark */ }
    else if (t < M.menu) { drawBoot(t, B); drawPower(lin(B.power, B.power + 0.3, t)); }
    else {
      drawMenu(t, M);
      // start-press transition: 3 stepped frames of a cream wipe collapsing
      const d = t - M.menu;
      if (d < 0.12) { g.fillStyle = `rgba(254,243,213,${(0.8 * (1 - d / 0.12)).toFixed(3)})`; g.fillRect(0, 0, LW, LH); }
    }
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



  // ================= FILM CONTROLLER ep.2: everything below is a pure function of t =================
  cable2.visible = true;
  cable2.position.copy(cable2Home);
  screenMat.roughness = 0.42;
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

  // ---- timeline (seconds, global film time) ----
  const B = { power: 2.55, logoA: 2.85, logoB: 3.2, barA: 3.3, barB: 4.1, start: 4.2 };
  const M = {
    menu: 5.0,
    connectPress: 5.75, connected: 5.95,
    toPlug: 6.75, plugPress: 7.3, signA: 7.5, signed: 8.2, signB: 8.65,
    toTicket: 9.0, rollA: 9.15, locks: [9.95, 10.2, 10.45, 10.7, 10.95, 11.3],
    shareBtn: 11.75,
  };
  const T = { B, M, sceneIn: 2.0, cut: 13.4 };

  function spline(keys) {
    const n = keys.length;
    const tan = keys.map((k, i) => {
      const a = keys[Math.max(0, i - 1)], b = keys[Math.min(n - 1, i + 1)];
      return k[1].map((_, c) => (b[1][c] - a[1][c]) / (b[0] - a[0]));
    });
    return (t) => {
      if (t <= keys[0][0]) return keys[0][1].slice();
      if (t >= keys[n - 1][0]) return keys[n - 1][1].slice();
      let i = 0; while (t > keys[i + 1][0]) i++;
      const [t0, p0] = keys[i], [t1, p1] = keys[i + 1];
      const h = t1 - t0, s = (t - t0) / h, s2 = s * s, s3 = s2 * s;
      const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
      return p0.map((v, c) => h00 * v + h10 * h * tan[i][c] + h01 * p1[c] + h11 * h * tan[i + 1][c]);
    };
  }
  // starts on ep.1's last console pose, then a slow push straight into the screen
  const CAM = spline([
    [2.0,  [0.00, 3.45, 5.05,   0.00, 1.92, -1.30,  28]],
    [5.0,  [0.16, 3.40, 4.30,   0.02, 1.97, -1.31,  28]],
    [9.0,  [0.05, 3.29, 3.72,   0.00, 1.99, -1.31,  28]],
    [13.4, [-0.08, 3.19, 3.26,  -0.01, 2.00, -1.31, 28]],
  ]);

  const green = new THREE.Color(C.ledOk);
  function renderAt(t) {
    const c = CAM(t);
    camera.position.set(c[0], c[1], c[2]);
    camera.fov = c[6];
    camera.updateProjectionMatrix();
    camera.lookAt(c[3], c[4], c[5]);

    renderer.toneMappingExposure = 1.02;
    scene.environmentIntensity = 0.7;
    key.intensity = 1.6;

    // player 2 is plugged since ep.1: green LED, range strip full
    ledMat.emissive.copy(green); ledMat.emissiveIntensity = 2.6;
    haloMat.color.copy(green); haloMat.opacity = 0.7;
    ledLight.color.copy(green); ledLight.intensity = 0.4;
    halo.scale.setScalar(0.3);
    rangeLeds.forEach((s) => { s.material.emissiveIntensity = 1.5; });

    lid.rotation.x = -1.83;
    const on = t >= B.power;
    screenMat.emissiveIntensity = 1.0;
    screenGlow.color.set(0xff4a2a);
    screenGlow.intensity = on ? 1.1 : 0.0;
    slotMat.emissiveIntensity = 1.6 + Math.sin(t * 2.4) * 0.4;
    drawScreen(t, B, M);
    composer.render();
  }

  return { renderAt, ready: Promise.all(pending), T, renderer };
}
