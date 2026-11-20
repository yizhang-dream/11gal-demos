import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CbtCel25DActor, DEFAULT_POKE_LINES } from './cbt_cel25d.js?v=20261121';
import { setupPerformance } from './performance.js?v=20261121';

const canvas = document.querySelector('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.04;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb9dbf2);
scene.fog = new THREE.FogExp2(0xcce4f6, 0.0020);

const camera = new THREE.PerspectiveCamera(52, 1, 0.055, 480);
camera.rotation.order = 'YXZ';

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.18, 0.42, 0.88);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

const actorPos = new THREE.Vector3(0, 0, 29.35);
const BASE_YAW = -1.22;
const MAX_SECTOR_YAW = THREE.MathUtils.degToRad(34);
const MIN_ACTOR_DIST = 1.15;
const actorForward = new THREE.Vector2(Math.sin(BASE_YAW), Math.cos(BASE_YAW));
const actorRight = new THREE.Vector2(Math.cos(BASE_YAW), -Math.sin(BASE_YAW));

const keys = new Set();
const walkingKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
let active = false;
let manualStepMode = false;
let yaw = 0;
let pitch = 0;
let last = performance.now();
let geometry = null;
let eye = 1.56;
let characterEyes = 1.344;
const playerRadius = 0.23;
const maxAngle = 0.255;
const radial = new THREE.Vector2();
let colCenters = [];

const MOODS = {
  day: {
    background: new THREE.Color(0xb9dbf2),
    fogColor: new THREE.Color(0xcce4f6),
    fogDensity: 0.0018,
    hemiSky: new THREE.Color(0xdcf0ff),
    hemiGround: new THREE.Color(0xe4d2ba),
    hemiIntensity: 1.52,
    sunPos: new THREE.Vector3(16, 28, 60),
    sunColor: new THREE.Color(0xfff4e2),
    sunIntensity: 2.55,
    fillColor: new THREE.Color(0xb8d9ff),
    fillIntensity: 0.48,
    exposure: 1.04,
    bloomStrength: 0.14,
    bloomThreshold: 0.94,
    moteColor: new THREE.Color(0xfff7dc),
    moteOpacity: 0.55,
    cbtLight: {
      sunColor: new THREE.Color('#FFFDF6'),
      shadowColor: new THREE.Color('#8BA6D4'),
      envTint: new THREE.Color('#FFFFFF'),
      rimColor: new THREE.Color('#FFF0C6'),
      rimStrength: 0.32,
      shadeStrength: 0.22,
      groundBounce: 0.36,
      fogColor: new THREE.Color('#CCE4F6'),
      fogDensity: 0.0018,
      brightness: 1.02,
    },
  },
  golden: {
    background: new THREE.Color(0xe7c6a2),
    fogColor: new THREE.Color(0xedd1b1),
    fogDensity: 0.0026,
    hemiSky: new THREE.Color(0xacc8ec),
    hemiGround: new THREE.Color(0xd8b288),
    hemiIntensity: 1.28,
    sunPos: new THREE.Vector3(24, 15, 62),
    sunColor: new THREE.Color(0xffcd92),
    sunIntensity: 2.85,
    fillColor: new THREE.Color(0x94b8ea),
    fillIntensity: 0.52,
    exposure: 1.05,
    bloomStrength: 0.20,
    bloomThreshold: 0.90,
    moteColor: new THREE.Color(0xffe099),
    moteOpacity: 0.78,
    cbtLight: {
      sunColor: new THREE.Color('#FFE5BE'),
      shadowColor: new THREE.Color('#7B91C8'),
      envTint: new THREE.Color('#FFF5EA'),
      rimColor: new THREE.Color('#FFCC82'),
      rimStrength: 0.48,
      shadeStrength: 0.25,
      groundBounce: 0.42,
      fogColor: new THREE.Color('#EDD1B1'),
      fogDensity: 0.0024,
      brightness: 1.00,
    },
  },
};

const hemiLight = new THREE.HemisphereLight(0xdcf0ff, 0xe4d2ba, 1.52);
scene.add(hemiLight);

const fillLight = new THREE.DirectionalLight(0xb8d9ff, 0.48);
fillLight.position.set(-18, 12, 22);
scene.add(fillLight);

const sun = new THREE.DirectionalLight(0xfff4e2, 2.55);
sun.position.set(16, 28, 60);
sun.target.position.set(0, 0, 29);
sun.castShadow = true;
sun.shadow.mapSize.set(3072, 3072);
Object.assign(sun.shadow.camera, { left: -23, right: 23, top: 22, bottom: -20, near: 0.5, far: 95 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.00015;
sun.shadow.normalBias = 0.007;
scene.add(sun, sun.target);

const sunDirWorld = new THREE.Vector3();
function updateSunDir() {
  sunDirWorld.copy(sun.position).sub(sun.target.position).normalize();
}
updateSunDir();

function createMoteTexture() {
  const cv = document.createElement('canvas');
  cv.width = 64;
  cv.height = 64;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 1, 32, 32, 30);
  g.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
  g.addColorStop(0.35, 'rgba(255, 252, 240, 0.72)');
  g.addColorStop(1.0, 'rgba(255, 252, 240, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function buildMotes(count = 56) {
  const pos = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = -0.20 + Math.random() * 0.40;
    const r = 25.0 + Math.random() * 10.2;
    pos[i * 3] = r * Math.sin(a);
    pos[i * 3 + 1] = 0.35 + Math.random() * 4.4;
    pos[i * 3 + 2] = r * Math.cos(a);
    phase[i] = Math.random() * Math.PI * 2;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xfff7dc,
    map: createMoteTexture(),
    size: 0.095,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.renderOrder = 6;
  scene.add(pts);
  return { pts, basePos: pos.slice(), phase, mat };
}
const motes = buildMotes();

function resize() {
  const w = Math.max(1, window.innerWidth);
  const h = Math.max(1, window.innerHeight);
  const dpr = Math.min(devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(dpr);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function aim(pos, x, y, z) {
  camera.position.set(pos[0], eye, pos[1]);
  const dx = x - pos[0];
  const dz = z - pos[1];
  yaw = Math.atan2(-dx, -dz);
  pitch = THREE.MathUtils.clamp(Math.atan2(y - eye, Math.hypot(dx, dz)), -0.36, 0.42);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  keys.clear();
}

const views = {
  start: () => {
    const portrait = canvas.clientWidth < canvas.clientHeight;
    aim(
      [-3.65, 30.88],
      portrait ? actorPos.x : 0.25,
      characterEyes - 0.19,
      portrait ? actorPos.z : 29.40
    );
  },
  near: () => aim([-1.42, 29.98], actorPos.x, characterEyes - 0.10, actorPos.z),
  left: () => aim([-2.35, 29.02], actorPos.x, characterEyes - 0.14, actorPos.z),
  right: () => aim([-1.72, 31.12], actorPos.x, characterEyes - 0.14, actorPos.z),
};

const navButtons = Array.from(document.querySelectorAll('[data-view]'));
function markViewButton(viewId) {
  for (const b of navButtons) {
    b.setAttribute('aria-current', String(b.dataset.view === viewId));
  }
}

document.querySelector('#eye-height').onchange = (e) => {
  const distance = Math.hypot(camera.position.x - actorPos.x, camera.position.z - actorPos.z);
  const targetY = eye + distance * Math.tan(pitch);
  eye = Number(e.target.value);
  camera.position.y = eye;
  pitch = THREE.MathUtils.clamp(Math.atan2(targetY - eye, distance), -0.36, 0.42);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
};

for (const b of navButtons) {
  const selectView = () => {
    if (!active) return;
    const vid = b.dataset.view;
    views[vid]?.();
    markViewButton(vid);
    canvas.focus({ preventScroll: true });
  };
  b.onclick = (e) => { if (e.pointerType !== 'touch') selectView(); };
  b.onpointerup = (e) => {
    if (e.pointerType === 'touch' && document.elementFromPoint(e.clientX, e.clientY) === b) selectView();
  };
}

function clear(p, q, cx, cz, r) {
  return (p - cx) ** 2 + (q - cz) ** 2 >= r * r;
}

function inSafeSector(x, z) {
  const dx = x - actorPos.x;
  const dz = z - actorPos.z;
  const distSq = dx * dx + dz * dz;
  if (distSq < MIN_ACTOR_DIST * MIN_ACTOR_DIST) return false;
  const fwdDot = dx * actorForward.x + dz * actorForward.y;
  if (fwdDot <= 0) return false;
  const rightDot = dx * actorRight.x + dz * actorRight.y;
  return Math.abs(Math.atan2(rightDot, fwdDot)) <= MAX_SECTOR_YAW;
}

function walkable(x, z) {
  if (!geometry) return false;
  const r = Math.hypot(x, z);
  return (
    r >= geometry.wallRadius + 0.55 &&
    r <= 35.40 &&
    Math.abs(Math.atan2(x, z)) <= maxAngle &&
    inSafeSector(x, z) &&
    colCenters.every(([cx, cz]) => clear(x, z, cx, cz, geometry.columnSize + playerRadius))
  );
}

function move(dt) {
  const down = (a, b) => Number(keys.has(a) || keys.has(b));
  const forward = down('KeyW', 'ArrowUp') - down('KeyS', 'ArrowDown');
  const right = down('KeyD', 'ArrowRight') - down('KeyA', 'ArrowLeft');
  if (!(forward || right)) return;
  radial.set(right, forward).normalize().multiplyScalar(dt * 1.9);
  const dx = radial.x * Math.cos(yaw) - radial.y * Math.sin(yaw);
  const dz = -radial.x * Math.sin(yaw) - radial.y * Math.cos(yaw);
  const p = camera.position;
  if (walkable(p.x + dx, p.z + dz)) {
    p.x += dx;
    p.z += dz;
  } else {
    if (walkable(p.x + dx, p.z)) p.x += dx;
    if (walkable(p.x, p.z + dz)) p.z += dz;
  }
}

let pointer = null;
let pointerMoved = 0;
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
let cbtActor = null;
let pokeIdx = 0;
let pokeTimer = null;

function triggerPoke() {
  if (!cbtActor) return;
  cbtActor.poke();
  const bubble = document.querySelector('#poke-bubble');
  if (!bubble) return;
  bubble.textContent = DEFAULT_POKE_LINES[pokeIdx % DEFAULT_POKE_LINES.length];
  pokeIdx += 1;
  bubble.classList.add('show');
  clearTimeout(pokeTimer);
  pokeTimer = setTimeout(() => bubble.classList.remove('show'), 2600);
}

canvas.onpointerdown = (e) => {
  if (pointer) return;
  canvas.setPointerCapture(e.pointerId);
  canvas.focus({ preventScroll: true });
  pointer = { id: e.pointerId, x: e.clientX, y: e.clientY };
  pointerMoved = 0;
};
canvas.onpointermove = (e) => {
  if (pointer?.id !== e.pointerId) return;
  const ddx = e.clientX - pointer.x;
  const ddy = e.clientY - pointer.y;
  pointerMoved += Math.hypot(ddx, ddy);
  const s = 1.65 / Math.max(340, canvas.clientHeight);
  yaw -= ddx * s;
  pitch = THREE.MathUtils.clamp(pitch - ddy * s, -0.36, 0.42);
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
};
canvas.onpointerup = (e) => {
  if (pointer?.id !== e.pointerId) return;
  if (pointerMoved <= 6 && cbtActor?.plane) {
    pointerNdc.x = (e.clientX / Math.max(1, window.innerWidth)) * 2 - 1;
    pointerNdc.y = -(e.clientY / Math.max(1, window.innerHeight)) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    if (raycaster.intersectObject(cbtActor.plane, false).length > 0) {
      triggerPoke();
    }
  }
  pointer = null;
};
canvas.onlostpointercapture = () => { pointer = null; };

window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('#performance-panel')) return;
  if (walkingKeys.has(e.code)) {
    e.preventDefault();
    keys.add(e.code);
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => { if (document.hidden) keys.clear(); });

for (const b of document.querySelectorAll('[data-key]')) {
  b.onpointerdown = (e) => {
    e.preventDefault();
    b.setPointerCapture(e.pointerId);
    keys.add(b.dataset.key);
  };
  b.onlostpointercapture = () => keys.delete(b.dataset.key);
}
if (matchMedia('(pointer:coarse)').matches) {
  document.querySelector('#guide').textContent = '方向键行走 · 拖动 360° 环视（已限制安全扇区） · 点击 CBT 互动';
}

function setMood(name) {
  const cfg = MOODS[name];
  if (!cfg) return;
  scene.background.copy(cfg.background);
  if (scene.fog) {
    scene.fog.color.copy(cfg.fogColor);
    scene.fog.density = cfg.fogDensity;
  }
  hemiLight.color.copy(cfg.hemiSky);
  hemiLight.groundColor.copy(cfg.hemiGround);
  hemiLight.intensity = cfg.hemiIntensity;
  sun.position.copy(cfg.sunPos);
  sun.color.copy(cfg.sunColor);
  sun.intensity = cfg.sunIntensity;
  updateSunDir();

  fillLight.color.copy(cfg.fillColor);
  fillLight.intensity = cfg.fillIntensity;
  renderer.toneMappingExposure = cfg.exposure;
  bloomPass.strength = cfg.bloomStrength;
  bloomPass.threshold = cfg.bloomThreshold;

  motes.mat.color.copy(cfg.moteColor);
  motes.mat.opacity = cfg.moteOpacity;

  cbtActor?.setLighting(cfg.cbtLight);
  const moodSel = document.querySelector('#mood');
  if (moodSel) moodSel.value = name;
}

function prepare(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    const backdrop = m.name.startsWith('远景');
    o.castShadow = !backdrop;
    o.receiveShadow = !backdrop;
    if (m.map) m.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    if (backdrop) {
      m.toneMapped = false;
      m.fog = false;
      return;
    }
    if (m.name.startsWith('幕墙') || m.name.startsWith('木檐')) {
      m.emissiveMap = m.map;
      m.emissive.setScalar(0.28);
    }
  });
  return root;
}

function updateMotes(tSec) {
  const attr = motes.pts.geometry.attributes.position;
  const arr = attr.array;
  for (let i = 0; i < motes.phase.length; i++) {
    const ph = motes.phase[i];
    arr[i * 3] = motes.basePos[i * 3] + Math.sin(tSec * 0.42 + ph) * 0.14;
    arr[i * 3 + 1] = motes.basePos[i * 3 + 1] + Math.sin(tSec * 0.65 + ph * 1.3) * 0.10;
    arr[i * 3 + 2] = motes.basePos[i * 3 + 2] + Math.cos(tSec * 0.38 + ph) * 0.14;
  }
  attr.needsUpdate = true;
}

let resolveReady = null;
const readyPromise = new Promise((res) => { resolveReady = res; });

async function boot() {
  resize();
  window.addEventListener('resize', resize);
  const loader = new GLTFLoader();
  cbtActor = new CbtCel25DActor({
    psdUrl: './assets/psd/cbt_full_rig.psd?v=20261121',
    metaUrl: './assets/psd/cbt_full_rig.meta.json?v=20261121',
    normalMatUrl: './assets/psd/cbt_full_normal_mat.png?v=20261121',
    baseYaw: BASE_YAW,
    mode: 'anchored',
    maxAngleRad: MAX_SECTOR_YAW,
    followTurnRatio: 0.30,
    crownHeight: 1.58,
  });

  const [set] = await Promise.all([
    loader.loadAsync('./assets/models/yungu_colonnade.glb?v=20261121'),
    cbtActor.init(renderer),
  ]);

  geometry = set.scene.userData;
  if (!Number.isFinite(geometry.columnSize)) throw Error('模型缺少回廊尺寸');
  colCenters = Array.from({ length: geometry.columns }, (_, i) => {
    const a = geometry.columnAngle + (i * 2 * Math.PI) / geometry.columns;
    return [geometry.columnRadius * Math.sin(a), geometry.columnRadius * Math.cos(a)];
  });

  scene.add(prepare(set.scene));
  cbtActor.group.position.copy(actorPos);
  scene.add(cbtActor.group);
  characterEyes = cbtActor.eyeHeight;

  setMood('day');
  const performance = setupPerformance(cbtActor, {
    onMood: setMood,
    onPoke: triggerPoke,
  });
  document.querySelector('#performance-controls').disabled = false;

  views.start();
  markViewButton('start');
  active = true;
  document.querySelector('#status').hidden = true;

  // Initialize first crisp frame before loop starts
  cbtActor.update(1 / 30, camera, sunDirWorld);
  composer.render();

  window.__colonnade = {
    ready: readyPromise,
    camera,
    scene,
    actor: cbtActor.group,
    cbtActor,
    walkable,
    views,
    setMood,
    setExpression: performance.setExpression,
    playMotion: performance.playMotion,
    triggerPoke,
    get eye() { return eye; },
    stepDeterministic(cfg = {}) {
      manualStepMode = true;
      document.body.classList.toggle('hide-ui', cfg.hideUi !== false);
      if (cfg.mood) setMood(cfg.mood);
      if (cfg.view && views[cfg.view]) {
        views[cfg.view]();
        markViewButton(cfg.view);
      }
      if (cfg.pos) {
        const target = cfg.lookAt || [actorPos.x, characterEyes - 0.14, actorPos.z];
        camera.position.set(cfg.pos[0], cfg.pos[1] ?? eye, cfg.pos[2]);
        const dx = target[0] - camera.position.x;
        const dy = target[1] - camera.position.y;
        const dz = target[2] - camera.position.z;
        yaw = Math.atan2(-dx, -dz);
        pitch = THREE.MathUtils.clamp(Math.atan2(dy, Math.hypot(dx, dz)), -0.36, 0.42);
        camera.rotation.set(pitch, yaw, 0, 'YXZ');
      }
      if (cfg.fov && cfg.fov !== camera.fov) {
        camera.fov = cfg.fov;
        camera.updateProjectionMatrix();
      }
      if (cfg.resetSprings) cbtActor.rig.resetSprings();
      const t = cfg.t ?? 1.25;
      const dt = cfg.dt ?? 1 / 30;
      cbtActor.setDeterministic(t, dt, cfg.cbtPose || {}, camera, sunDirWorld);
      updateMotes(t);
      composer.render();
    },
  };
  resolveReady({ views: Object.keys(views), eyeHeight: characterEyes });

  renderer.setAnimationLoop((now) => {
    if (manualStepMode) return;
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.05));
    last = now;
    if (!document.hidden) {
      move(dt);
      cbtActor.update(dt, camera, sunDirWorld);
      performance.sync();
      updateMotes(now / 1000);
      composer.render();
    }
  });
}

try {
  await boot();
} catch (e) {
  document.querySelector('#status').textContent = '场景载入失败：' + e.message;
  console.error(e);
}
