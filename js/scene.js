// NIMORI — the console. One persistent WebGL scene, mounted once, never re-created by the router.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
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
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 118 + Math.random() * 20;
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
export function createScene(mount, overlayEl = null) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
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
  const logoTex = new THREE.TextureLoader().load(new URL('../img/wordmark.webp', import.meta.url).href);
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

  // screen picture: a canvas texture (title card on phones, glow behind the HTML page on desktop)
  const scrCanvas = document.createElement('canvas');
  scrCanvas.width = 1024; scrCanvas.height = Math.round(1024 * scrH / scrW);
  const scrTex = new THREE.CanvasTexture(scrCanvas);
  scrTex.colorSpace = THREE.SRGBColorSpace;
  scrTex.anisotropy = 8;
  screenMat.map = scrTex;
  screenMat.emissiveMap = scrTex;
  screenMat.emissive.set(0xffffff);
  screenMat.color.set(0x000000);
  function drawScreen({ title = '', big = '', lines = [] } = {}) {
    const g = scrCanvas.getContext('2d');
    const w = scrCanvas.width, h = scrCanvas.height;
    g.fillStyle = '#fff8ec'; g.fillRect(0, 0, w, h);
    g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    g.fillStyle = '#e60211'; g.font = '800 28px "Plus Jakarta Sans", sans-serif';
    g.fillText('NIMORI', 40, 60);
    g.fillStyle = '#8f7c70'; g.textAlign = 'right'; g.font = '700 22px "Plus Jakarta Sans", sans-serif';
    g.fillText(title, w - 40, 58);
    g.fillStyle = '#f1e4cf'; g.fillRect(40, 82, w - 80, 2);
    g.textAlign = 'center';
    let size = 140;
    g.font = `800 ${size}px "Plus Jakarta Sans", sans-serif`;
    while (big && g.measureText(big).width > w - 120 && size > 40) { size -= 6; g.font = `800 ${size}px "Plus Jakarta Sans", sans-serif`; }
    g.fillStyle = '#1e1512';
    if (big) g.fillText(big, w / 2, h * 0.58);
    g.font = '700 28px "Plus Jakarta Sans", sans-serif';
    lines.forEach((l, i) => { g.fillStyle = i ? '#8f7c70' : '#e60211'; g.fillText(l, w / 2, h * 0.74 + i * 40); });
    scrTex.needsUpdate = true;
  }
  drawScreen();

  // Desktop: the page is a normal 2D HTML element laid over the screen. Each frame the 4 screen corners are
  // projected and the element is fitted inside them. No CSS 3D transforms, so it cannot drift or blur.
  const scrCorners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => new THREE.Vector3(sx * scrW / 2, sy * scrH / 2, 0));
  const tmpV = new THREE.Vector3();
  let overlayOn = false;
  function trackOverlay(lidAmount) {
    if (!overlayEl) return;
    const vis = overlayOn ? smooth(0.93, 1, lidAmount) : 0;
    overlayEl.style.opacity = vis.toFixed(3);
    overlayEl.style.visibility = vis > 0.01 ? 'visible' : 'hidden';
    overlayEl.inert = vis < 0.9;
    if (vis <= 0.01) return;
    const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight;
    const xs = [], ys = [];
    scrCorners.forEach((c) => {
      tmpV.copy(c); screenMesh.localToWorld(tmpV); tmpV.project(camera);
      xs.push((tmpV.x + 1) / 2 * w); ys.push((1 - tmpV.y) / 2 * h);
    });
    xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
    const inset = 4;
    const L = xs[1] + inset, R = xs[2] - inset, T = ys[1] + inset, B = ys[2] - inset;
    overlayEl.style.transform = `translate(${L.toFixed(1)}px, ${T.toFixed(1)}px)`;
    overlayEl.style.width = Math.max(0, R - L).toFixed(1) + 'px';
    overlayEl.style.height = Math.max(0, B - T).toFixed(1) + 'px';
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

  console3d.position.set(0, 0, 0);
  console3d.rotation.y = 0;

  // ---------- state ----------
  const state = {
    difficulty: 'normal',
    plugged: false,
    plugT: 1, // animation progress
    plugStart: 0,
    matchFlash: -10,
    view: 'lobby',
    lid: 0, // 0 closed, 1 open
    lidGoal: 0,
  };
  const RANGES = { easy: [1, 1, 1, 1, 1], normal: [0, 1, 1, 1, 0], hard: [0, 0, 1, 0, 0] };

  // camera framings per screen: [position, target]
  const VIEWS = {
    lobby: [new THREE.Vector3(2.4, 2.9, 10.2), new THREE.Vector3(0.1, 0.28, 0.8)],
    session: [new THREE.Vector3(-1.6, 7.6, 7.4), new THREE.Vector3(0.0, 0.5, 0.3)],
    // lid open, straight at the screen (screen centre is about (0, 2.0, -1.32), normal (0, .26, .97))
    screen: [new THREE.Vector3(0.0, 3.62, 4.75), new THREE.Vector3(0.0, 1.9, -1.32)],
    docs: [new THREE.Vector3(-7.2, 4.6, 9.0), new THREE.Vector3(-0.2, 0.4, 0.6)],
  };
  const camPos = VIEWS.lobby[0].clone();
  const camTgt = VIEWS.lobby[1].clone();
  const pointer = new THREE.Vector2();
  window.addEventListener('pointermove', (e) => {
    pointer.set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
  }, { passive: true });

  let layout = { offsetX: 0, distScale: 1 };
  function resize() {
    const w = mount.clientWidth || window.innerWidth;
    const h = mount.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // keep the console framed on narrow/tall viewports
    const panel = document.querySelector('[data-panel]');
    const desktop = window.innerWidth >= 1000;
    layout.distScale = desktop ? Math.max(1, 1.05 / camera.aspect) : Math.max(0.84, 1.05 / camera.aspect);
    const panelShown = panel && document.body.dataset.mode !== 'screen';
    layout.offsetX = desktop && panelShown ? Math.round((panel.getBoundingClientRect().width + 24) / 2) : 0;
    if (layout.offsetX) camera.setViewOffset(w, h, layout.offsetX, 0, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(mount);
  window.addEventListener('resize', resize);
  resize();

  // ---------- loop ----------
  const clock = new THREE.Clock();
  let t = 0;
  const tmpPos = new THREE.Vector3();
  const green = new THREE.Color(C.ledOk), orange = new THREE.Color(C.led);
  function frame() {
    const dt = Math.min(clock.getDelta(), 0.1);
    t += dt;

    // camera: ease toward the screen's framing, add slow idle drift + a hint of pointer parallax
    const [vp, vt] = VIEWS[state.view] || VIEWS.lobby;
    // real elapsed time (not the per-frame capped dt): on a slow device the camera and the lid
    // still settle on time, instead of moving in slow motion
    const nowMs = performance.now();
    const realDt = Math.min((nowMs - (state.lidAt || nowMs)) / 1000, 0.5);
    state.lidAt = nowMs;
    const k = 1 - Math.exp(-realDt * 2.2);
    // narrow cards (phones): step back so the whole open screen fits
    const near = state.view === 'screen' && camera.aspect < 1.3 ? 1.5 : 1;
    tmpPos.copy(vp).sub(vt).multiplyScalar(layout.distScale * near).add(vt);
    camPos.lerp(tmpPos, k);
    camTgt.lerp(vt, k);
    // almost still while a page is on the screen, so its text stays sharp and easy to click
    const drift = state.view === 'screen' ? 0 : 1;
    camera.position.set(
      camPos.x + (Math.sin(t * 0.13) * 0.35 + pointer.x * 0.25) * drift,
      camPos.y + (Math.sin(t * 0.09) * 0.12 - pointer.y * 0.12) * drift,
      camPos.z + Math.cos(t * 0.11) * 0.25 * drift,
    );
    camera.lookAt(camTgt);

    // lid: opens on Arcade (about 105 degrees, laptop-style), closes elsewhere
    const lidGoal = state.lidGoal;
    state.lid += (lidGoal - state.lid) * (1 - Math.exp(-realDt * (lidGoal ? 2.6 : 4)));
    if (Math.abs(lidGoal - state.lid) < 0.0005) state.lid = lidGoal;
    const open = easeInOut(state.lid);
    lid.rotation.x = -open * 1.83;
    const lit = smooth(0.7, 1, state.lid);
    screenMat.emissiveIntensity = 0.1 + lit * 0.9;
    screenGlow.intensity = lit * 1.4;
    slotMat.emissiveIntensity = lit * (1.6 + Math.sin(t * 2.4) * 0.4);

    // 2P plug animation
    if (state.plugged && state.plugT < 1) {
      state.plugT = Math.min(1, (performance.now() - state.plugStart) / 1600);
      const e = easeOutCubic(state.plugT);
      cable2.position.set(cable2Home.x, cable2Home.y + (1 - e) * 0.18, cable2Home.z + (1 - e) * 1.8);
      if (state.plugT >= 1) state.matchFlash = t;
    }

    // status LED: orange pulse while waiting, steady green once matched
    const since = t - state.matchFlash;
    if (state.plugged && state.plugT >= 1) {
      const flash = since < 0.9 ? 1 + Math.sin(since * 40) * 0.6 : 1;
      ledMat.emissive.copy(green);
      ledMat.emissiveIntensity = 2.6 * flash;
      haloMat.color.copy(green);
      ledLight.color.copy(green);
      halo.scale.setScalar(0.32);
      ledLight.intensity = 0.5;
    } else {
      const p = 0.5 + 0.5 * Math.sin(t * 3.1);
      ledMat.emissive.copy(orange);
      ledMat.emissiveIntensity = 0.6 + p * 3.2;
      haloMat.color.copy(orange);
      ledLight.color.copy(orange);
      halo.scale.setScalar(0.18 + p * 0.22);
      haloMat.opacity = 0.35 + p * 0.65;
      ledLight.intensity = 0.1 + p * 0.7;
    }
    if (state.plugged) haloMat.opacity = 0.8;

    // range strip
    const pattern = RANGES[state.difficulty] || RANGES.normal;
    rangeLeds.forEach((s, i) => {
      let on = pattern[i];
      if (since >= 0 && since < 1.2) on = Math.floor(since * 10) % 5 === i ? 1 : on * 0.3; // sweep on match
      let target = on ? 2.2 : 0;
      if (state.difficulty === 'hard' && on && i === 2) target *= 0.85 + 0.15 * Math.sin(t * 9);
      s.material.emissiveIntensity += (target - s.material.emissiveIntensity) * Math.min(1, dt * 10);
    });

    renderer.render(scene, camera);
    trackOverlay(state.lid);
  }
  renderer.setAnimationLoop(frame);

  return {
    setView(v) { state.view = VIEWS[v] ? v : 'lobby'; },
    setLid(open) { state.lidGoal = open ? 1 : 0; },
    setScreen: drawScreen,
    setOverlay(on) { overlayOn = !!on; },
    setDifficulty(d) { state.difficulty = RANGES[d] ? d : 'normal'; },
    plug2P() {
      if (state.plugged) return;
      state.plugged = true;
      state.plugT = 0;
      state.plugStart = performance.now();
      cable2.position.set(cable2Home.x, cable2Home.y + 0.18, cable2Home.z + 1.8);
      cable2.visible = true;
    },
    unplug2P() {
      state.plugged = false;
      state.plugT = 1;
      state.matchFlash = -10;
      cable2.visible = false;
    },
    relayout: resize,
    get plugged() { return state.plugged; },
    get lidOpen() { return state.lid; },
    get plugProgress() { return state.plugT; },
  };
}
