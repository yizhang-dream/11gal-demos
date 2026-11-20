import * as THREE from 'three';
import { CbtRigPlayer } from './cbt_rig_player.js?v=20261121';

const _vCam = new THREE.Vector3();
const _vFwd = new THREE.Vector3();
const _vRight = new THREE.Vector3();
const _vSunLocal = new THREE.Vector3();
const _vCamLocal = new THREE.Vector3();
const _vChestWorld = new THREE.Vector3();
const _qWorld = new THREE.Quaternion();
const _qInv = new THREE.Quaternion();

const CEL25D_VS = /* glsl */ `
  varying vec2 vUv;
  varying float vFogDepth;
  void main() {
    vUv = uv;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vFogDepth = -mvPos.z;
    gl_Position = projectionMatrix * mvPos;
  }
`;

const CEL25D_FS = /* glsl */ `
  uniform sampler2D uMap;
  uniform sampler2D uNormalMatMap;
  uniform vec2 uRimStep;
  uniform vec3 uSunDirLocal;
  uniform vec3 uCamDirLocal;
  uniform vec3 uSunColor;
  uniform vec3 uShadowColor;
  uniform vec3 uEnvTint;
  uniform vec3 uRimColor;
  uniform vec4 uFaceUv;
  uniform float uHairCrownV;
  uniform float uRimStrength;
  uniform float uShadeStrength;
  uniform float uNormalStrength;
  uniform float uAoStrength;
  uniform float uSpecStrength;
  uniform float uGroundBounce;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uBrightness;

  varying vec2 vUv;
  varying float vFogDepth;

  float sampleAlpha(vec2 uv) {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
    return texture2D(uMap, uv).a;
  }

  void main() {
    vec4 tex = texture2D(uMap, vUv);
    if (tex.a < 0.015) discard;

    // Unpremultiply WebGL1 rig canvas and decode sRGB -> linear
    vec3 straightSrgb = tex.rgb / max(tex.a, 0.001);
    vec3 base = pow(clamp(straightSrgb, 0.0, 1.0), vec3(2.2));

    // Soft protection ellipse centered on CBT's face (from cbt_full_rig.meta.json)
    vec2 faceDelta = (vUv - uFaceUv.xy) / uFaceUv.zw;
    float faceMask = 1.0 - smoothstep(0.56, 1.25, length(faceDelta));

    // Macro cylindrical normal + baked Marigold 3D fold normal
    float nx = clamp((vUv.x - 0.5) * 2.25, -0.80, 0.80);
    float ny = clamp((vUv.y - 0.54) * 0.42, -0.22, 0.22);
    float nz = sqrt(max(0.18, 1.0 - nx * nx - ny * ny));
    vec3 cylNorm = normalize(vec3(nx, ny, nz));

    vec4 nmSample = texture2D(uNormalMatMap, vUv);
    vec3 marNorm = normalize(vec3(nmSample.rg * 2.0 - 1.0, 0.92));
    vec3 surfNorm = normalize(mix(cylNorm, marNorm, uNormalStrength * (1.0 - 0.55 * faceMask)));

    vec3 sDir = normalize(uSunDirLocal);
    float ndotl = dot(surfNorm, sDir);
    float lit = smoothstep(-0.35, 0.52, ndotl);

    // Keep anime face luminous & clean while shading hair/cloak folds with cool shadow / warm sun
    float shadeAmt = uShadeStrength * (1.0 - 0.78 * faceMask);
    vec3 shadowTint = mix(vec3(1.0), uShadowColor, shadeAmt);
    vec3 sunTint = mix(vec3(1.0), uSunColor, 0.26 + 0.22 * (1.0 - faceMask));
    vec3 lightGrade = mix(shadowTint, sunTint, lit);

    // Subtle garment fold crevice AO (B channel)
    float ao = mix(1.0, nmSample.b, uAoStrength * (1.0 - 0.65 * faceMask));
    vec3 col = base * lightGrade * ao * uEnvTint * uBrightness;

    // Material-aware specular differentiation (A channel: hair angel-ring, brass trim, leather boots)
    float specMask = nmSample.a;
    if (specMask > 0.01) {
      vec3 H = normalize(sDir + normalize(uCamDirLocal));
      float ndoth = max(dot(surfNorm, H), 0.0);
      float isCrown = step(uHairCrownV - 0.06, vUv.y);
      float hairGlow = pow(ndoth, 16.0) * 0.28 + smoothstep(0.84, 0.97, ndoth) * 0.14;
      float trimGlow = pow(ndoth, 24.0) * 0.24 + smoothstep(0.76, 0.95, ndoth) * 0.24;
      float specVal = mix(trimGlow, hairGlow, isCrown) * specMask * uSpecStrength * (0.35 + 0.65 * lit);
      col += mix(vec3(1.0), uSunColor, 0.65) * specVal;
    }

    // Directional silhouette rim light along local sun direction (resolution-independent world step)
    vec2 sun2dRaw = vec2(sDir.x, max(sDir.y, 0.20));
    float sun2dLen = length(sun2dRaw);
    vec2 sun2d = sun2dLen > 1e-4 ? sun2dRaw / sun2dLen : vec2(0.45, 0.89);

    float a1 = sampleAlpha(vUv + sun2d * uRimStep * 1.7);
    float a2 = sampleAlpha(vUv + sun2d * uRimStep * 3.8);
    float a3 = sampleAlpha(vUv + sun2d * uRimStep * 6.8);
    float outsideAvg = 0.46 * a1 + 0.34 * a2 + 0.20 * a3;
    float edge = smoothstep(0.08, 0.62, clamp(tex.a - outsideAvg, 0.0, 1.0));

    float rimBacklit = mix(0.70, 1.25, clamp(-sDir.z * 0.5 + 0.5, 0.0, 1.0));
    float rimDampFace = 1.0 - 0.72 * faceMask;
    float rimHeightBoost = mix(0.65, 1.12, smoothstep(0.15, 0.92, vUv.y));
    float rimWeight = clamp(edge * uRimStrength * rimBacklit * rimDampFace * rimHeightBoost, 0.0, 0.50);
    col += uRimColor * rimWeight;

    // Subtle ground bounce & shoe-sole contact grounding
    float lowerGlow = (1.0 - smoothstep(0.02, 0.18, vUv.y)) * uGroundBounce;
    col += base * vec3(1.0, 0.95, 0.88) * lowerGlow * 0.14;
    float soleAO = smoothstep(0.015, 0.045, vUv.y);
    col *= mix(0.86, 1.0, soleAO);

    // Optional light atmospheric perspective
    if (uFogDensity > 0.0) {
      float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
      col = mix(col, uFogColor, clamp(fogFactor * 0.72, 0.0, 0.85));
    }

    gl_FragColor = vec4(col * tex.a, tex.a);
  }
`;

export const DEFAULT_POKE_LINES = [
  '「……不是这个。」',
  '「光影角度算得这么准，学弟是在偷看吗？」',
  '「再戳呆毛就要翘成天线啦……」',
  '「学术环的柱影斜下来的时候，这里特别像舞台呢。」',
];

function createContactShadowTexture() {
  const cv = document.createElement('canvas');
  cv.width = 160;
  cv.height = 160;
  const ctx = cv.getContext('2d');
  const grad = ctx.createRadialGradient(80, 80, 5, 80, 80, 74);
  grad.addColorStop(0.0, 'rgba(26, 36, 62, 0.44)');
  grad.addColorStop(0.50, 'rgba(32, 44, 72, 0.20)');
  grad.addColorStop(1.0, 'rgba(32, 44, 72, 0.0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 160, 160);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createNeutralNormalMatTexture() {
  const data = new Uint8Array([128, 128, 255, 0]);
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export class CbtCel25DActor {
  constructor(opts = {}) {
    this.psdUrl = opts.psdUrl || './assets/psd/cbt_full_rig.psd?v=20261121';
    this.metaUrl = opts.metaUrl || './assets/psd/cbt_full_rig.meta.json?v=20261121';
    this.normalMatUrl = opts.normalMatUrl || './assets/psd/cbt_full_normal_mat.png?v=20261121';
    this.rig = opts.rig || new CbtRigPlayer({ psdUrl: this.psdUrl });
    this.baseYaw = opts.baseYaw ?? 0;
    this.mode = opts.mode || 'anchored'; // 'anchored' | 'billboard'
    this.eyeTrack = opts.eyeTrack !== false;
    this.maxAngleRad = opts.maxAngleRad ?? THREE.MathUtils.degToRad(34);
    this.followTurnRatio = opts.followTurnRatio ?? 0.30;
    this.crownHeight = opts.crownHeight ?? 1.58;

    this.planeWidth = 1.01;
    this.planeHeight = 1.75;
    this.planeCenterY = 0.81;
    this.eyeHeight = 1.36;
    this.meta = null;

    this.group = new THREE.Group();
    this.group.name = 'CBT_Cel25D_Root';
    this.visualYawNode = new THREE.Group();
    this.motionPivot = new THREE.Group();
    this.visualYawNode.add(this.motionPivot);
    this.group.add(this.visualYawNode);

    this.tex = null;
    this.normalMatTex = null;
    this.material = null;
    this.plane = null;
    this.shadowProxy = null;
    this.contactShadow = null;
    this.ready = false;
  }

  async init(renderer = null) {
    const loadMeta = fetch(this.metaUrl)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);

    const texLoader = new THREE.TextureLoader();
    const loadNormalMat = new Promise((resolve) => {
      texLoader.load(
        this.normalMatUrl,
        (t) => {
          t.colorSpace = THREE.NoColorSpace;
          t.premultiplyAlpha = false;
          t.generateMipmaps = false;
          t.minFilter = THREE.LinearFilter;
          t.magFilter = THREE.LinearFilter;
          t.wrapS = THREE.ClampToEdgeWrapping;
          t.wrapT = THREE.ClampToEdgeWrapping;
          resolve(t);
        },
        undefined,
        () => resolve(null)
      );
    });

    const [meta, nmTex] = await Promise.all([
      loadMeta,
      loadNormalMat,
      this.rig.ready ? Promise.resolve() : this.rig.init(),
    ]);

    this.meta = meta;
    this.normalMatTex = nmTex || createNeutralNormalMatTexture();

    const fullW = this.rig.CW || meta?.width || 1664;
    const fullH = this.rig.CH || meta?.height || 2880;
    const soleY = meta?.soleY ?? Math.round(fullH * 0.966);
    const crownY = meta?.crownY ?? Math.round(fullH * 0.063);
    const eyeY = meta?.eyeY ?? Math.round(fullH * 0.187);
    const pxHeight = Math.max(100, soleY - crownY);

    this.planeHeight = (fullH * this.crownHeight) / pxHeight;
    this.planeWidth = this.planeHeight * (fullW / fullH);
    const soleBottomRatio = (fullH - soleY) / fullH;
    this.planeCenterY = this.planeHeight * (0.5 - soleBottomRatio) - 0.004;
    this.eyeHeight = ((soleY - eyeY) * this.crownHeight) / pxHeight;

    this._buildMeshes(renderer);
    this.ready = true;
    return this;
  }

  _buildMeshes(renderer) {
    const tex = new THREE.CanvasTexture(this.rig.canvas);
    tex.colorSpace = THREE.NoColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    if (renderer?.capabilities) {
      tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    }
    this.tex = tex;

    const faceUv = this.meta?.faceUv || { cx: 0.499, cy: 0.8375, rx: 0.1196, ry: 0.0856 };
    const hairCrownV = this.meta?.hairCrownV ?? 0.8903;
    const aspect = this.planeWidth / Math.max(1e-4, this.planeHeight);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: tex },
        uNormalMatMap: { value: this.normalMatTex },
        uRimStep: { value: new THREE.Vector2(1 / (1280 * aspect), 1 / 1280) },
        uSunDirLocal: { value: new THREE.Vector3(0.45, 0.65, 0.60).normalize() },
        uCamDirLocal: { value: new THREE.Vector3(0.0, 0.0, 1.0) },
        uSunColor: { value: new THREE.Color('#FFF8ED') },
        uShadowColor: { value: new THREE.Color('#8BA4CF') },
        uEnvTint: { value: new THREE.Color('#FFFFFF') },
        uRimColor: { value: new THREE.Color('#FFE4B3') },
        uFaceUv: { value: new THREE.Vector4(faceUv.cx, faceUv.cy, faceUv.rx, faceUv.ry) },
        uHairCrownV: { value: hairCrownV },
        uRimStrength: { value: 0.34 },
        uShadeStrength: { value: 0.22 },
        uNormalStrength: { value: 0.56 },
        uAoStrength: { value: 0.82 },
        uSpecStrength: { value: 0.85 },
        uGroundBounce: { value: 0.35 },
        uFogColor: { value: new THREE.Color('#CFE4F7') },
        uFogDensity: { value: 0.0 },
        uBrightness: { value: 1.0 },
      },
      vertexShader: CEL25D_VS,
      fragmentShader: CEL25D_FS,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });

    const geo = new THREE.PlaneGeometry(this.planeWidth, this.planeHeight);
    this.plane = new THREE.Mesh(geo, this.material);
    this.plane.name = 'CBT_Cel25D_Plane';
    this.plane.position.y = this.planeCenterY;
    this.plane.renderOrder = 5;
    this.plane.castShadow = false;
    this.plane.receiveShadow = false;
    this.motionPivot.add(this.plane);

    // Contact shadow hugging the shoe soles
    const shTex = createContactShadowTexture();
    this.contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.66, 0.38),
      new THREE.MeshBasicMaterial({
        map: shTex,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      })
    );
    this.contactShadow.rotation.x = -Math.PI * 0.5;
    this.contactShadow.position.y = 0.004;
    this.contactShadow.renderOrder = 2;
    this.group.add(this.contactShadow);

    // Invisible shadow-caster proxy oriented perpendicular to sun XZ so real ground shadows match pillars
    const hiddenMat = new THREE.ShaderMaterial({
      vertexShader: 'void main() { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); }',
      fragmentShader: 'void main() { discard; }',
      colorWrite: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    hiddenMat.map = tex;
    hiddenMat.alphaTest = 0.36;
    hiddenMat.shadowSide = THREE.DoubleSide;
    const depthMat = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: tex,
      alphaTest: 0.36,
      side: THREE.DoubleSide,
    });
    this.shadowProxy = new THREE.Mesh(geo, hiddenMat);
    this.shadowProxy.name = 'CBT_ShadowProxy';
    this.shadowProxy.position.y = this.planeCenterY;
    this.shadowProxy.castShadow = true;
    this.shadowProxy.receiveShadow = false;
    this.shadowProxy.frustumCulled = false;
    this.shadowProxy.customDepthMaterial = depthMat;
    this.group.add(this.shadowProxy);

    this.visualYawNode.rotation.y = this.baseYaw;
  }

  setLighting(cfg = {}) {
    if (!this.material) return;
    const u = this.material.uniforms;
    if (cfg.sunColor) u.uSunColor.value.copy(cfg.sunColor);
    if (cfg.shadowColor) u.uShadowColor.value.copy(cfg.shadowColor);
    if (cfg.envTint) u.uEnvTint.value.copy(cfg.envTint);
    if (cfg.rimColor) u.uRimColor.value.copy(cfg.rimColor);
    if (cfg.rimStrength !== undefined) u.uRimStrength.value = cfg.rimStrength;
    if (cfg.shadeStrength !== undefined) u.uShadeStrength.value = cfg.shadeStrength;
    if (cfg.normalStrength !== undefined) u.uNormalStrength.value = cfg.normalStrength;
    if (cfg.aoStrength !== undefined) u.uAoStrength.value = cfg.aoStrength;
    if (cfg.specStrength !== undefined) u.uSpecStrength.value = cfg.specStrength;
    if (cfg.groundBounce !== undefined) u.uGroundBounce.value = cfg.groundBounce;
    if (cfg.fogColor) u.uFogColor.value.copy(cfg.fogColor);
    if (cfg.fogDensity !== undefined) u.uFogDensity.value = cfg.fogDensity;
    if (cfg.brightness !== undefined) u.uBrightness.value = cfg.brightness;
  }

  setMode(mode) {
    this.mode = mode === 'billboard' ? 'billboard' : 'anchored';
  }

  setEyeTrack(flag) {
    this.eyeTrack = Boolean(flag);
  }

  setExpression(name) {
    this.rig?.setPreset(name);
  }

  playMotion(name) {
    return this.rig?.playMotion(name);
  }

  poke() {
    this.rig?.poke();
  }

  getRelativeAngles(camera) {
    this.group.getWorldPosition(_vCam);
    const dx = camera.position.x - _vCam.x;
    const dz = camera.position.z - _vCam.z;
    const horizDist = Math.max(0.15, Math.hypot(dx, dz));

    _vFwd.set(Math.sin(this.baseYaw), 0, Math.cos(this.baseYaw));
    _vRight.set(Math.cos(this.baseYaw), 0, -Math.sin(this.baseYaw));

    const fwdDot = dx * _vFwd.x + dz * _vFwd.z;
    const rightDot = dx * _vRight.x + dz * _vRight.z;
    const relYaw = Math.atan2(rightDot, fwdDot);
    const dy = camera.position.y - (_vCam.y + this.eyeHeight);
    const relPitch = Math.atan2(dy, horizDist);
    return { relYaw, relPitch, horizDist, dx, dz };
  }

  syncOrientationAndParallax(camera, sunDirWorld, applyParallax = true) {
    if (!this.plane) return;

    if (this.mode === 'billboard') {
      const dx = camera.position.x - this.group.position.x;
      const dz = camera.position.z - this.group.position.z;
      const yawToCam = Math.atan2(dx, dz);
      this.visualYawNode.rotation.y = yawToCam - this.group.rotation.y;
      if (applyParallax && this.rig) {
        const { relPitch } = this.getRelativeAngles(camera);
        this.rig.setParallax({
          angleX: 0,
          angleY: THREE.MathUtils.clamp(-relPitch / 0.48, -0.55, 0.55) * 0.45,
          angleZ: 0,
          eyeX: 0,
          eyeY: this.eyeTrack ? THREE.MathUtils.clamp(relPitch / 0.48, -0.45, 0.45) : 0,
          body: 0,
        });
      }
    } else {
      const { relYaw, relPitch } = this.getRelativeAngles(camera);
      const clampedYaw = THREE.MathUtils.clamp(relYaw, -this.maxAngleRad, this.maxAngleRad);
      const followYaw = this.baseYaw + clampedYaw * this.followTurnRatio;
      this.visualYawNode.rotation.y = followYaw - this.group.rotation.y;

      if (applyParallax && this.rig) {
        const normYaw = THREE.MathUtils.clamp(clampedYaw / Math.max(0.35, this.maxAngleRad), -1, 1);
        const normPitch = THREE.MathUtils.clamp(relPitch / 0.42, -0.75, 0.75);
        this.rig.setParallax({
          angleX: -normYaw * 0.76,
          angleY: -normPitch * 0.55,
          angleZ: -normYaw * 0.08,
          eyeX: this.eyeTrack ? normYaw * 0.72 : 0,
          eyeY: this.eyeTrack ? normPitch * 0.46 : 0,
          body: -normYaw * 0.24,
        });
      }
    }

    const ms = this.rig.getMotionState();
    this.motionPivot.rotation.x = ms.pitchDip;
    this.plane.position.y = this.planeCenterY + ms.yDip;

    this.group.updateMatrixWorld(true);
    this.plane.getWorldQuaternion(_qWorld);
    _qInv.copy(_qWorld).invert();
    _vSunLocal.copy(sunDirWorld).normalize().applyQuaternion(_qInv).normalize();
    this.material.uniforms.uSunDirLocal.value.copy(_vSunLocal);

    this.plane.getWorldPosition(_vChestWorld);
    _vCamLocal.copy(camera.position).sub(_vChestWorld).normalize().applyQuaternion(_qInv).normalize();
    this.material.uniforms.uCamDirLocal.value.copy(_vCamLocal);

    if (this.shadowProxy) {
      const sunYawWorld = Math.atan2(sunDirWorld.x, sunDirWorld.z);
      this.shadowProxy.rotation.y = sunYawWorld - this.group.rotation.y;
    }
  }

  update(dt, camera, sunDirWorld) {
    if (!this.ready || !this.rig?.ready) return;
    this.syncOrientationAndParallax(camera, sunDirWorld, true);
    this.rig.stepLive(dt);
    if (this.tex) this.tex.needsUpdate = true;
  }

  setDeterministic(tSec, dt, pose, camera, sunDirWorld) {
    if (!this.ready || !this.rig?.ready) return;
    const applyParallax = pose?.useParallax !== false;
    this.syncOrientationAndParallax(camera, sunDirWorld, applyParallax);
    this.rig.setDeterministicPose(tSec, dt, pose || {});
    const ms = this.rig.getMotionState();
    this.motionPivot.rotation.x = ms.pitchDip;
    this.plane.position.y = this.planeCenterY + ms.yDip;
    if (this.tex) this.tex.needsUpdate = true;
  }
}
