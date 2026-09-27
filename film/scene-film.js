// NIMORI — FILM COPY of js/scene.js. Everything is a pure function of time t via renderAt(t). Do not use in the app.
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


  // ---------- screen picture (film): CRT power-on, logo pop, loading bar ----------
  const scrCanvas = document.createElement('canvas');
  scrCanvas.width = 1024; scrCanvas.height = Math.round(1024 * scrH / scrW);
  const scrTex = new THREE.CanvasTexture(scrCanvas);
  scrTex.colorSpace = THREE.SRGBColorSpace;
  scrTex.anisotropy = 8;
  screenMat.map = scrTex;
  screenMat.emissiveMap = scrTex;
  screenMat.emissive.set(0xffffff);
  screenMat.color.set(0x000000);
  const bootLogo = new Image();
  pending.push(new Promise((res) => { bootLogo.onload = res; bootLogo.onerror = res; bootLogo.src = new URL('../img/wordmark.webp', import.meta.url).href; }).then(() => bootLogo.decode?.().catch(() => {})));
  let lastKey = '';
  // power: 0..1 CRT turn-on, logoP: 0..1 pop, barP: 0..1 fill
  function drawBoot(power, logoP, barP) {
    const key = `${power.toFixed(3)}|${logoP.toFixed(3)}|${barP.toFixed(4)}`;
    if (key === lastKey) return;
    lastKey = key;
    const g = scrCanvas.getContext('2d');
    const w = scrCanvas.width, h = scrCanvas.height;
    g.fillStyle = '#0c0202'; g.fillRect(0, 0, w, h);
    if (power <= 0) { scrTex.needsUpdate = true; return; }
    // CRT: a bright line that opens vertically into the cream page
    const openH = Math.max(3, h * smooth(0.25, 1, power));
    const lineW = w * smooth(0, 0.3, power);
    g.fillStyle = '#fff8ec';
    g.fillRect((w - lineW) / 2, (h - openH) / 2, lineW, openH);
    if (power >= 1) {
      // logo pop with a small overshoot
      if (logoP > 0 && bootLogo.naturalWidth) {
        const e = logoP >= 1 ? 1 : 1 + 2.2 * Math.pow(logoP - 1, 3) + 1.2 * Math.pow(logoP - 1, 2);
        const lw = w * 0.56 * (0.7 + 0.3 * e), lh = lw * bootLogo.naturalHeight / bootLogo.naturalWidth;
        g.globalAlpha = Math.min(1, logoP * 4);
        g.drawImage(bootLogo, (w - lw) / 2, h * 0.42 - lh / 2, lw, lh);
        g.globalAlpha = 1;
      }
      if (logoP >= 1) {
        const bw = w * 0.44, bh = 16, bx = (w - bw) / 2, by = h * 0.7;
        g.fillStyle = '#f1e4cf'; g.beginPath(); g.roundRect(bx, by, bw, bh, 8); g.fill();
        g.fillStyle = '#e60211'; g.beginPath(); g.roundRect(bx, by, Math.max(bh, bw * Math.min(1, barP)), bh, 8); g.fill();
        g.fillStyle = '#8f7c70'; g.textAlign = 'center'; g.font = '700 22px "Plus Jakarta Sans", sans-serif';
        g.fillText(barP < 1 ? 'LOADING' : 'READY', w / 2, by + 54);
      }
    }
    scrTex.needsUpdate = true;
  }
  drawBoot(0, 0, 0);

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


  // ================= FILM CONTROLLER: everything below is a pure function of t =================
  cable2.visible = true;
  screenMat.roughness = 0.42; // matte glass: no specular hotspot on the boot logo
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

  // plug flash sprite at the mouth of port 2
  const flashMat = new THREE.SpriteMaterial({ map: radialTexture('rgba(220,255,200,1)', 'rgba(140,255,90,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const flash = new THREE.Sprite(flashMat);
  flash.position.set(P2X, portY, zf + 0.45);
  console3d.add(flash);

  // ---- timeline (seconds) ----
  const T = {
    ledOn: [0.9, 1.35, 1.8, 2.25, 2.7],
    plugA: 3.9, plugB: 5.05, plugSnap: 5.2,  // glide, then snap home at plugSnap
    lidA: 6.3, lidB: 8.5,
    bootA: 8.25, logoA: 8.5, logoB: 8.95, barA: 9.25, barB: 10.75,
    cut: 10.9,
  };

  // Catmull-Rom (non-uniform, finite-difference tangents) per channel -> continuous speed, no micro-stops
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
  //                 t      pos x, y, z          target x, y, z        fov
  const CAM = spline([
    [0.0,  [2.55, 0.66, 3.30,   1.52, 0.50, 1.40,   26]],
    [2.0,  [2.30, 0.68, 3.08,   1.38, 0.50, 1.40,   26]],
    [3.8,  [1.95, 0.74, 3.00,   1.02, 0.49, 1.45,   26]],
    [5.3,  [1.85, 1.00, 3.55,   0.55, 0.47, 1.50,   27]],
    [6.7,  [1.75, 2.00, 5.30,   0.25, 0.75, 0.60,   28]],
    [8.6,  [0.75, 3.35, 6.25,   0.05, 1.35, -0.60,  28]],
    [10.9, [0.00, 3.45, 5.05,   0.00, 1.92, -1.30,  28]],
  ]);

  const clamp01 = (x) => Math.min(1, Math.max(0, x));
  const lin = (a, b, x) => clamp01((x - a) / (b - a));
  const green = new THREE.Color(C.ledOk), orange = new THREE.Color(C.led);

  function plugOffset(t) {
    // glide in (ease in-out) to 0.07 short of home, pause-free, then a 3-frame snap
    if (t <= T.plugA) return 1;
    const glide = easeInOut(lin(T.plugA, T.plugB, t));
    const snap = easeOutCubic(lin(T.plugB + 0.05, T.plugSnap, t));
    return (1 - glide) * 0.96 + 0.04 * (1 - snap);
  }

  function renderAt(t) {
    // camera
    const c = CAM(t);
    camera.position.set(c[0], c[1], c[2]);
    camera.fov = c[6];
    camera.updateProjectionMatrix();
    camera.lookAt(c[3], c[4], c[5]);

    // exposure/env: dark macro that opens up as the lid rises
    const room = smooth(5.6, 8.6, t);
    renderer.toneMappingExposure = 0.62 + 0.4 * room;
    scene.environmentIntensity = 0.32 + 0.38 * room;
    key.intensity = 0.8 + 0.8 * room;

    // 2P cable
    const off = plugOffset(t);
    cable2.position.set(cable2Home.x, cable2Home.y + off * 0.16, cable2Home.z + off * 1.9);
    const since = t - T.plugSnap;
    const plugged = since >= 0;

    // status LED
    if (plugged) {
      const f = 1 + 1.2 * Math.exp(-since * 5);
      ledMat.emissive.copy(green); ledMat.emissiveIntensity = 2.6 * f;
      haloMat.color.copy(green); haloMat.opacity = Math.min(1, 0.7 * f);
      ledLight.color.copy(green); ledLight.intensity = 0.4 * f;
      halo.scale.setScalar(0.3 + 0.25 * Math.exp(-since * 4));
      const fl = Math.exp(-since * 9);
      flashMat.opacity = 0.8 * fl;
      flash.scale.setScalar(0.15 + 0.55 * (1 - Math.exp(-since * 14)));
    } else {
      const p = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 0.62 - Math.PI / 2);
      ledMat.emissive.copy(orange); ledMat.emissiveIntensity = 0.5 + p * 3.4;
      haloMat.color.copy(orange); haloMat.opacity = 0.3 + p * 0.7;
      ledLight.color.copy(orange); ledLight.intensity = 0.1 + p * 0.8;
      halo.scale.setScalar(0.18 + p * 0.24);
      flashMat.opacity = 0;
    }

    // range strip: rising one by one, chaser on plug, then all lit
    rangeLeds.forEach((s, i) => {
      const d = t - T.ledOn[i];
      let v = d < 0 ? 0 : 1.5 * smooth(0, 0.05, d) + 1.8 * Math.exp(-d * 10) * smooth(0, 0.03, d);
      if (since >= 0 && since < 1.0) v = Math.floor(since * 12) % 5 === i ? 3.2 : 0.45;
      s.material.emissiveIntensity = v;
    });

    // lid + screen
    const lp = lin(T.lidA, T.lidB, t);
    const open = easeInOut(lp);
    lid.rotation.x = -open * 1.83;
    const lit = smooth(0.7, 1, lp);
    screenMat.emissiveIntensity = 0.05 + lit * 0.78;
    screenGlow.intensity = lit * 1.4 * (t >= T.bootA ? 1 : 0.3);
    slotMat.emissiveIntensity = lit * (1.6 + Math.sin(t * 2.4) * 0.4);
    drawBoot(lin(T.bootA, T.bootA + 0.2, t), lin(T.logoA, T.logoB, t), barCurve(t));

    composer.render();
  }

  // loading bar: fast, accelerating, with one tiny hitch at ~62% (tension)
  function barCurve(t) {
    const u = lin(T.barA, T.barB, t);
    const a = 0.62 * easeOutCubic(lin(0, 0.45, u));
    const b = 0.38 * Math.pow(lin(0.55, 1, u), 1.8);
    return a + b;
  }

  return { renderAt, ready: Promise.all(pending), T, renderer };
}
