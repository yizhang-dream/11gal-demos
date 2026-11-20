/*
 * CBT Anime2.5DRig WebGL1 Runtime Player
 * Wraps Anime2.5DRig (ag-psd + Rigger + RigRenderer + RigRuntime) into an ES module
 * for both interactive browser live2.5D mode and deterministic PV video rendering.
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (t) => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};

export const CBT_PRESETS = {
  neutral:  { eyeOpenL: 1.0, eyeOpenR: 1.0, brow:  0.00, mouthOpen: 0.00, mouthForm:  0.00, irisScale: 1.00 },
  smile:    { eyeOpenL: 0.0, eyeOpenR: 0.0, brow:  0.45, mouthOpen: 0.00, mouthForm:  0.90, irisScale: 1.00 },
  usume:    { eyeOpenL: 0.5, eyeOpenR: 0.5, brow:  0.35, mouthOpen: 0.65, mouthForm:  0.80, irisScale: 1.00 },
  surprise: { eyeOpenL: 1.0, eyeOpenR: 1.0, brow:  1.00, mouthOpen: 0.72, mouthForm: -0.10, irisScale: 0.78 },
  jito:     { eyeOpenL: 0.4, eyeOpenR: 0.4, brow: -0.60, mouthOpen: 0.00, mouthForm: -0.40, irisScale: 1.00 },
  winkL:    { eyeOpenL: 0.0, eyeOpenR: 1.0, brow:  0.22, mouthOpen: 0.36, mouthForm:  0.70, irisScale: 1.00 },
  winkR:    { eyeOpenL: 1.0, eyeOpenR: 0.0, brow:  0.22, mouthOpen: 0.36, mouthForm:  0.70, irisScale: 1.00 },
};

const BASE_PARAMS = {
  angleX: 0, angleY: 0, angleZ: 0,
  eyeOpenL: 1, eyeOpenR: 1, eyeX: 0, eyeY: 0, brow: 0,
  mouthOpen: 0, mouthForm: 0, mouthCY: 0, body: 0,
  physAmp: 2.0, soft: 2.0, fhAmp: 2.0, fhSoft: 0.45, accAmp: 1.2,
  browAngL: 0, browAngR: 0, browAngSym: 0,
  bangL: 0, bangC: 0, bangR: 0,
  armY: 0, armPos: 0, bust: 1.6, bustY: 1,
  irisScale: 1.0, mouthEase: 0.72, eyeEase: 0.30,
  eyeCY: 0, eyeCAng: 0, mouthCAng: 0,
  eyeScaleL: 1, eyeScaleR: 1, mouthScale: 1,
};

const FRONTISH = { 'front hair': 1, 'side hair': 1, ahoge: 1 };

export class CbtRigPlayer {
  constructor(opts = {}) {
    this.psdUrl = opts.psdUrl;
    this.anchorOffsets = opts.anchorOffsets || {};
    this.paramOverrides = opts.paramOverrides || {};

    this.canvas = document.createElement('canvas');
    this.gl = this.canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
    });
    if (!this.gl) {
      throw new Error('WebGL1 unavailable for CbtRigPlayer');
    }
    this.renderer = window.RigRenderer.create(this.gl);

    this.layers = [];
    this.rig = null;
    this.CW = 1280;
    this.CH = 1280;
    this.A = null;
    this.FS = 1;
    this.NP = null;
    this.BP = null;
    this.FC = null;
    this.CHEST = null;
    this.hasEyeClose2 = false;

    this.preset = 'neutral';
    this.T = Object.assign({}, BASE_PARAMS, this.paramOverrides);
    this.cur = Object.assign({}, this.T);
    this.bounce = { x: 0, v: 0, dy: 0 };

    this.mouse = { x: 0, y: 0, in: false };
    this.parallax = { angleX: 0, angleY: 0, angleZ: 0, eyeX: 0, eyeY: 0, body: 0 };
    this.motion = { name: 'Idle', t: 0, dur: 0 };
    this.pokeTimer = 0;
    this.pokeDir = 1;
    this.pokeKind = 'surprise';

    this.blinkT = -1;
    this.blinkVariant = 1;
    this.blinkBounceStarted = false;
    this.irisBounceT = -1;
    this.nextBlinkAt = 1.6;
    this.liveClock = 0;
    this.ready = false;
  }

  async init() {
    const RT = window.RigRuntime;
    const Rigger = window.Rigger;
    const agPsd = window.agPsd;
    const GP = window.GenericParts;
    if (!RT || !Rigger || !agPsd) {
      throw new Error('Anime2.5DRig libraries not loaded on window');
    }

    const res = await fetch(this.psdUrl);
    if (!res.ok) throw new Error(`Failed to fetch PSD ${this.psdUrl}: HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    RT.validateHeader(buf);

    const psd = agPsd.readPsd(new Uint8Array(buf), {
      useImageData: true,
      skipThumbnail: true,
      skipCompositeImageData: true,
    });
    Rigger.cleanPsdLayers(psd);

    const generic = GP
      ? { eyeL: GP.get('eyeL'), eyeR: GP.get('eyeR'), mouth: GP.get('mouth') }
      : undefined;
    const rig = Rigger.buildRig(psd, generic ? { generic } : {});
    this._applyRig(rig);
    this.ready = true;
    return this;
  }

  _applyRig(rig) {
    const RT = window.RigRuntime;
    const Rigger = window.Rigger;
    const W = rig.canvas.w;
    const H = rig.canvas.h;
    this.CW = W;
    this.CH = H;
    this.canvas.width = W;
    this.canvas.height = H;
    this.rig = rig;

    for (const old of this.layers) this.renderer.dispose(old);
    const prepared = [];

    for (const Lr of rig.layers) {
      const L = Object.assign({ visible: true, opacity: 1 }, Lr, { id: `${Lr.z}:${Lr.name}` });
      delete L.img;
      L.defaultDepth = L.depth;
      L.defaultOpacity = L.opacity;
      prepared.push(L);

      const cell = (L.phys ? 26 : 38) * Math.max(0.6, W / 768);
      const { nx, ny } = RT.meshSize(L.w, L.h, cell);
      const nv = (nx + 1) * (ny + 1);
      const base = new Float32Array(nv * 2);
      const uv = new Float32Array(nv * 2);
      let k = 0;
      for (let j = 0; j <= ny; j++) {
        for (let i = 0; i <= nx; i++) {
          base[k] = L.x + (L.w * i) / nx;
          base[k + 1] = L.y + (L.h * j) / ny;
          uv[k] = i / nx;
          uv[k + 1] = j / ny;
          k += 2;
        }
      }
      const idx = new Uint16Array(nx * ny * 6);
      let q = 0;
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const a = j * (nx + 1) + i;
          const b = a + 1;
          const c = a + nx + 1;
          const d = c + 1;
          idx[q++] = a; idx[q++] = b; idx[q++] = c;
          idx[q++] = b; idx[q++] = d; idx[q++] = c;
        }
      }
      L.base = base;
      L.cur = new Float32Array(base);
      L.bn = Rigger.baseName(L.name.replace(/_(l|r)$/, ''));

      if (L.strands && L.strands.length) {
        const S = L.strands;
        const nS = S.length;
        let spacing = 120;
        if (nS > 1) {
          const ds = [];
          for (let s = 1; s < nS; s++) ds.push(S[s].x - S[s - 1].x);
          ds.sort((a, b) => a - b);
          spacing = ds[ds.length >> 1];
        }
        const sig = Math.max(1, spacing * 0.6);
        L.sw = new Float32Array(nv * nS);
        L.su = new Float32Array(nv);
        L.spr = S.map((_, i) => ({
          stiff: { x: 0, v: 0, dx: 0 },
          soft: { x: 0, v: 0, dx: 0 },
          phase: i * 1.37 + L.z,
        }));
        for (let v = 0; v < nv; v++) {
          const x = base[v * 2];
          const y = base[v * 2 + 1];
          let tot = 0;
          for (let s = 0; s < nS; s++) {
            const w = Math.exp(-Math.pow((x - S[s].x) / sig, 2));
            L.sw[v * nS + s] = w;
            tot += w;
          }
          let rY = 0;
          let tY = 0;
          if (tot > 1e-6) {
            for (let s = 0; s < nS; s++) {
              L.sw[v * nS + s] /= tot;
              rY += L.sw[v * nS + s] * S[s].rootY;
              tY += L.sw[v * nS + s] * S[s].tipY;
            }
          } else {
            L.sw[v * nS] = 1;
            rY = S[0].rootY;
            tY = S[0].tipY;
          }
          L.su[v] = clamp((y - rY) / Math.max(1, tY - rY), 0, 1);
        }
      }

      const image = new ImageData(Lr.img.data, Lr.img.width, Lr.img.height);
      this.renderer.upload(L, { positions: L.cur, uvs: uv, indices: idx, image });
    }

    this.layers = prepared;
    this.hasEyeClose2 = this.layers.some((L) => L.bn === 'eye_close2');
    this._applyAnchors(rig.anchors);
    this.renderPose(this.cur);
  }

  _applyAnchors(baseAnchors) {
    const a = JSON.parse(JSON.stringify(baseAnchors));
    const o = this.anchorOffsets;
    const off = (k) => o[k] || {};
    a.face.cx += off('face').dx || 0;
    a.face.cy += off('face').dy || 0;
    for (const s of ['L', 'R']) {
      const e = a['eye' + s];
      if (!e) continue;
      e.icx += off('eye' + s).dx || 0;
      e.icy += off('eye' + s).dy || 0;
      e.closeY += off('eye' + s + 'Close').dy || 0;
    }
    const m = off('mouth');
    for (const k of ['cx', 'x0', 'x1']) a.mouth[k] += m.dx || 0;
    for (const k of ['cy', 'y0', 'y1']) a.mouth[k] += m.dy || 0;
    a.neckPivot.cx += off('neck').dx || 0;
    a.neckPivot.cy += off('neck').dy || 0;

    this.A = a;
    this.FS = a.faceScale;
    this.NP = a.neckPivot;
    this.BP = a.bodyPivot;
    this.FC = { x: a.face.cx, y: a.face.cy };
    const ch = off('chest');
    const fh = a.face.y1 - a.face.y0;
    this.CHEST = {
      cx: this.NP.cx + (ch.dx || 0),
      cy: a.neckBottom + fh * 0.60 + (ch.dy || 0),
      rx: Math.max(1, (a.face.x1 - a.face.x0) * 0.60),
      ry: Math.max(1, fh * 0.45),
    };

    const fw = a.face.x1 - a.face.x0;
    const fcx = a.face.cx;
    const f = 36;
    const b1 = fcx - fw * 0.22;
    const b2 = fcx + fw * 0.22;
    for (const L of this.layers) {
      if (L.bn !== 'front hair' || !L.su) {
        L.bw = null;
        continue;
      }
      const nv = L.base.length / 2;
      L.bw = new Float32Array(nv * 3);
      for (let v = 0; v < nv; v++) {
        const x = L.base[v * 2];
        const s1 = smooth((x - b1) / f + 0.5);
        const s2 = smooth((x - b2) / f + 0.5);
        L.bw[v * 3] = 1 - s1;
        L.bw[v * 3 + 1] = s1 * (1 - s2);
        L.bw[v * 3 + 2] = s2;
      }
    }
  }

  setPreset(name) {
    if (!CBT_PRESETS[name]) return;
    this.preset = name;
    Object.assign(this.T, CBT_PRESETS[name]);
  }

  setMouse(nx, ny, inside = true) {
    this.mouse.x = clamp(nx, -1, 1);
    this.mouse.y = clamp(ny, -1, 1);
    this.mouse.in = inside;
  }

  setParallax(opts = {}) {
    this.parallax.angleX = clamp(opts.angleX ?? 0, -1, 1);
    this.parallax.angleY = clamp(opts.angleY ?? 0, -1, 1);
    this.parallax.angleZ = clamp(opts.angleZ ?? 0, -1, 1);
    this.parallax.eyeX = clamp(opts.eyeX ?? 0, -1, 1);
    this.parallax.eyeY = clamp(opts.eyeY ?? 0, -1, 1);
    this.parallax.body = clamp(opts.body ?? 0, -1, 1);
  }

  playMotion(name = 'Idle') {
    const durations = { Idle: 0, Nod: 1.15, ShakeHead: 1.25, Tilt: 1.85, Bow: 1.65 };
    const next = Object.prototype.hasOwnProperty.call(durations, name) ? name : 'Idle';
    this.motion = { name: next, t: 0, dur: durations[next] };
    return next;
  }

  _evalMotion() {
    const { name, t, dur } = this.motion;
    if (!name || name === 'Idle' || dur <= 0) {
      return { angleX: 0, angleY: 0, angleZ: 0, body: 0, brow: 0, pitchDip: 0, yDip: 0 };
    }
    const u = clamp(t / dur, 0, 1);
    if (name === 'Nod') {
      const env = Math.sin(Math.PI * u);
      const dip = Math.max(0, Math.sin(u * Math.PI * 3.0)) * env;
      return {
        angleX: 0,
        angleY: -0.64 * dip,
        angleZ: 0.08 * Math.sin(u * Math.PI * 2.0) * env,
        body: 0,
        brow: 0,
        pitchDip: 0.03 * dip,
        yDip: -0.012 * dip,
      };
    }
    if (name === 'ShakeHead') {
      const env = Math.sin(Math.PI * u);
      const osc = Math.sin(u * Math.PI * 3.5);
      return {
        angleX: 0.68 * osc * env,
        angleY: 0,
        angleZ: -0.14 * osc * env,
        body: 0.10 * osc * env,
        brow: 0,
        pitchDip: 0,
        yDip: 0,
      };
    }
    if (name === 'Tilt') {
      const hold = smooth(Math.min(u / 0.24, (1 - u) / 0.28));
      return {
        angleX: -0.16 * hold,
        angleY: 0.12 * hold,
        angleZ: 0.56 * hold,
        body: 0.14 * hold,
        brow: 0.24 * hold,
        pitchDip: 0,
        yDip: 0,
      };
    }
    if (name === 'Bow') {
      const hold = smooth(Math.min(u / 0.30, (1 - u) / 0.34));
      return {
        angleX: 0,
        angleY: -0.82 * hold,
        angleZ: 0,
        body: 0.08 * Math.sin(u * Math.PI),
        brow: 0.15 * hold,
        pitchDip: 0.12 * hold,
        yDip: -0.030 * hold,
      };
    }
    return { angleX: 0, angleY: 0, angleZ: 0, body: 0, brow: 0, pitchDip: 0, yDip: 0 };
  }

  getMotionState() {
    const m = this._evalMotion();
    return {
      name: this.motion.name,
      pitchDip: m.pitchDip,
      yDip: m.yDip,
    };
  }

  poke() {
    this.pokeTimer = 1.15;
    this.pokeDir = -this.pokeDir;
    this.pokeKind = this.pokeKind === 'surprise' ? 'winkR' : 'surprise';
    this.irisBounceT = 0;
  }

  resetSprings() {
    this.cur = Object.assign({}, BASE_PARAMS, this.paramOverrides);
    this.bounce = { x: 0, v: 0, dy: 0 };
    for (const L of this.layers) {
      if (!L.spr) continue;
      for (const sp of L.spr) {
        sp.stiff = { x: 0, v: 0, dx: 0 };
        sp.soft = { x: 0, v: 0, dx: 0 };
      }
    }
  }

  _updateSprings(e, tSec, dt, wind) {
    const RT = window.RigRuntime;
    const { NP, FC, BP, FS } = this;
    const headDX = (e.angleX * 14 + e.angleZ * 0.07 * (NP.cy - FC.y)) * FS;
    const bodyDX = e.body * 0.028 * (BP.cy - NP.cy) * 0.35 + e.angleX * 14 * 0.16 * FS;
    for (const L of this.layers) {
      if (!L.spr) continue;
      const base = L.group === 'head' ? headDX : bodyDX;
      const windScale = L.phys === 'sway' && L.group !== 'head' ? 2.5 : 1.0;
      for (const sp of L.spr) {
        const w = wind
          ? (1.8 * Math.sin(tSec * 0.8 + sp.phase) + 1.0 * Math.sin(tSec * 1.9 + sp.phase * 2.3)) * windScale
          : 0;
        const txv = base + w * FS;
        RT.spring(sp.stiff, txv, 70, 9, dt);
        sp.stiff.dx = -(sp.stiff.x - txv) * 2.2;
        RT.spring(sp.soft, txv, 16, 1.3, dt);
        sp.soft.dx = -(sp.soft.x - txv) * 3.0;
      }
    }
    const bustTgt = (e.breath * 3.0 - e.angleY * 6.0 + e.body * 4.0) * FS;
    RT.spring(this.bounce, bustTgt, 140, 4.2, dt);
    this.bounce.dy = -(this.bounce.x - bustTgt) * 3.0;
  }

  _fadeAlpha(L, e, alt) {
    if (!L.fade) return 1;
    if (L.fade === 'eyeOpen') {
      const v = L.side === 'L' ? e.eyeOpenL : e.eyeOpenR;
      return smooth((v - (0.10 + e.eyeEase * 0.45)) / 0.15);
    }
    if (L.fade === 'eyeClose' || L.fade === 'eyeClose2') {
      const alternate = this.blinkVariant === 2 && alt[L.side];
      if ((L.fade === 'eyeClose2') !== alternate) return 0;
      const v = L.side === 'L' ? e.eyeOpenL : e.eyeOpenR;
      return 1 - smooth((v - (0.10 + e.eyeEase * 0.45)) / 0.15);
    }
    if (L.fade === 'mouthOpen') return smooth((e.mouthOpen - (0.05 + e.mouthEase * 0.35)) / 0.12);
    if (L.fade === 'mouthClose') return 1 - smooth((e.mouthOpen - (0.05 + e.mouthEase * 0.35)) / 0.12);
    return 1;
  }

  _deformLayer(L, e) {
    const { A, FS, NP, BP, FC, CHEST, bounce } = this;
    const b = L.base;
    const o = L.cur;
    const n = b.length;
    const isHead = L.group === 'head';
    const az = e.angleZ * 0.07;
    const cz = Math.cos(az);
    const sz = Math.sin(az);
    const ab = e.body * 0.028;
    const cb = Math.cos(ab);
    const sb = Math.sin(ab);
    const bn = L.bn;
    const eyeSide = L.side;
    const EA = eyeSide === 'L' ? A.eyeL : eyeSide === 'R' ? A.eyeR : null;
    const vOpen = eyeSide === 'L' ? e.eyeOpenL : e.eyeOpenR;
    const mo = e.mouthOpen;
    const mHalfW = (A.mouth.x1 - A.mouth.x0) / 2;
    const nS = L.strands ? L.strands.length : 0;
    const bcx = L.x + L.w / 2;
    const bcy = L.y + L.h / 2;
    const kind = L.phys === 'sway' ? 'acc' : FRONTISH[bn] ? 'fh' : 'bh';
    const physOn = nS && L.su;
    const ampK = kind === 'acc' ? e.accAmp * 1.4 : kind === 'fh' ? e.fhAmp : e.physAmp;
    const softK = kind === 'acc' ? 0.8 : kind === 'fh' ? e.fhSoft : e.soft;
    const powA = kind === 'acc' ? 1.2 : kind === 'fh' ? 1.8 : 2.1;

    for (let k = 0; k < n; k += 2) {
      let x = b[k];
      let y = b[k + 1];
      const vi = k >> 1;

      if (EA && (bn === 'eye_close' || bn === 'eye_close2')) {
        const sE = eyeSide === 'L' ? e.eyeScaleL : e.eyeScaleR;
        if (sE !== 1) {
          const cxE = (EA.x0 + EA.x1) / 2;
          const cyE = (EA.y0 + EA.y1) / 2;
          x = cxE + (x - cxE) * sE;
          y = cyE + (y - cyE) * sE;
        }
      }
      if (bn === 'mouth_open' || bn === 'mouth_close') {
        const sM = e.mouthScale;
        if (sM !== 1) {
          x = A.mouth.cx + (x - A.mouth.cx) * sM;
          y = A.mouth.cy + (y - A.mouth.cy) * sM;
        }
      }

      if (L.fade === 'eyeOpen' && EA) {
        if (bn === 'irides') {
          const isc = e.irisScale;
          const ibx = e.irisBounceX || 1;
          const iby = e.irisBounceY || 1;
          x = EA.icx + (x - EA.icx) * isc * ibx;
          y = EA.icy + (y - EA.icy) * isc * iby;
          x += e.eyeX * 11 * FS;
          y += e.eyeY * 6 * FS;
          const tl = smooth((0.32 - vOpen) / 0.32);
          y = EA.closeY + (y - EA.closeY) * (1 - 0.80 * tl);
        } else {
          y = EA.closeY + (y - EA.closeY) * (1 - 0.85 * (1 - vOpen));
        }
      }
      if ((L.fade === 'eyeClose' || L.fade === 'eyeClose2') && EA) {
        y -= vOpen * 3;
        y += e.eyeCY * 14 * FS;
        const thE = e.eyeCAng * 0.3 * (eyeSide === 'L' ? 1 : -1);
        if (thE) {
          const ct = Math.cos(thE), st = Math.sin(thE);
          const rx = x - bcx, ry = y - bcy;
          x = bcx + rx * ct - ry * st;
          y = bcy + rx * st + ry * ct;
        }
      }
      if (bn === 'eyebrow') {
        y += (-e.brow * 9 + (1 - vOpen) * 3.5) * FS;
        const th = (eyeSide === 'L' ? e.browAngL + e.browAngSym : e.browAngR - e.browAngSym) * 0.30;
        if (th) {
          const ct = Math.cos(th), st = Math.sin(th);
          const rx = x - bcx, ry = y - bcy;
          x = bcx + rx * ct - ry * st;
          y = bcy + rx * st + ry * ct;
        }
      }
      if (L.fade === 'mouthOpen') {
        y = A.mouth.y0 + (y - A.mouth.y0) * (0.5 + 0.5 * mo);
        const q = Math.pow(Math.abs(x - A.mouth.cx) / (mHalfW + 4), 1.5);
        y -= e.mouthForm * 6 * FS * (q - 0.35);
      }
      if (L.fade === 'mouthClose') {
        y += e.mouthCY * 14 * FS;
        const thM = e.mouthCAng * 0.35;
        if (thM) {
          const ct = Math.cos(thM), st = Math.sin(thM);
          const rx = x - A.mouth.cx, ry = y - A.mouth.cy;
          x = A.mouth.cx + rx * ct - ry * st;
          y = A.mouth.cy + rx * st + ry * ct;
        }
      }
      if (bn === 'face' && y > A.mouth.cy) {
        y += mo * 6 * FS * smooth((y - A.mouth.cy) / Math.max(1, A.face.y1 - A.mouth.cy));
      }

      let hw = isHead ? 1 : L.group === 'body' ? 0.16 : 0;
      if (bn === 'neck') hw = 0.55 * smooth((A.neckBottom - y) / Math.max(1, A.neckBottom - A.neckTop));
      if (hw > 0) {
        const rx = x - NP.cx, ry = y - NP.cy;
        const rx2 = rx * cz - ry * sz;
        const ry2 = rx * sz + ry * cz;
        x += (rx2 - rx) * hw;
        y += (ry2 - ry) * hw;
        const dd = L.depth;
        x += hw * FS * (e.angleX * (14 + 40 * (dd - 1)) + e.angleX * (NP.cy - y) * 0.028);
        y += hw * FS * (-e.angleY * (9 + 30 * (dd - 1)) - e.angleY * (dd - 1) * (y - FC.y) * 0.05);
      }

      y -= (L.group === 'body' ? e.breath * 2.0 : e.breathHead * 1.6) * FS;
      if (bn === 'topwear' && y < CHEST.cy) {
        y -= e.breath * 2.2 * FS * smooth((CHEST.cy - y) / (CHEST.ry * 2));
      }
      if (bn === 'topwear') {
        x = NP.cx + (x - NP.cx) * (1 + e.breath * 0.003);
        const gx = (x - CHEST.cx) / CHEST.rx;
        const gy = (y - (CHEST.cy + e.bustY * 70 * FS)) / CHEST.ry;
        y += bounce.dy * e.bust * Math.exp(-gx * gx - gy * gy);
      }
      if (bn === 'handwear') {
        const w = smooth(((y - L.y) / L.h) * 1.15);
        y -= e.armY * 30 * FS * w;
        y += e.armPos * 40 * FS;
        x += e.armY * 6 * FS * w * (x < NP.cx ? 1 : -1);
      }
      if (L.bw) {
        const m = Math.pow(L.su[vi], 1.4) * 22 * FS;
        x += (e.bangL * L.bw[vi * 3] + e.bangC * L.bw[vi * 3 + 1] + e.bangR * L.bw[vi * 3 + 2]) * m;
      }
      if (physOn) {
        const u = kind === 'fh' ? Math.min(1, L.su[vi] * 1.6) : L.su[vi];
        const amp = Math.pow(u, powA) * ampK;
        const softMix = Math.min(1, Math.pow(u, 1.2) * softK);
        let dx = 0;
        for (let s = 0; s < nS; s++) {
          const w = L.sw[vi * nS + s];
          if (w < 0.001) continue;
          const sp = L.spr[s];
          dx += w * (sp.stiff.dx * (1 - softMix) + sp.soft.dx * softMix);
        }
        x += dx * amp;
        y += Math.abs(dx) * amp * 0.12;
      }
      o[k] = x;
      o[k + 1] = y;
    }

    if (Math.abs(ab) > 1e-4) {
      for (let k = 0; k < n; k += 2) {
        const rx = o[k] - BP.cx;
        const ry = o[k + 1] - BP.cy;
        o[k] = BP.cx + rx * cb - ry * sb;
        o[k + 1] = BP.cy + rx * sb + ry * cb;
      }
    }
  }

  renderPose(e) {
    if (!this.layers.length || !this.A) return;
    const alt = { L: false, R: false };
    for (const L of this.layers) {
      if (L.fade === 'eyeClose2' && L.side && L.visible && L.opacity > 0) alt[L.side] = true;
    }
    const items = [];
    const masks = [];
    for (const L of this.layers) {
      const isMask = L.bn === 'eyewhite' && !!L.side;
      const alpha = L.visible ? this._fadeAlpha(L, e, alt) * L.opacity : 0;
      if (alpha < 0.004 && !isMask) continue;
      this._deformLayer(L, e);
      this.renderer.positions(L, L.cur);
      if (isMask) masks.push({ L, side: L.side });
      if (alpha >= 0.004) items.push({ L, alpha, clip: L.bn === 'irides' && L.side ? L.side : null });
    }
    this.renderer.draw({
      width: this.CW,
      height: this.CH,
      background: [0, 0, 0, 0],
      masks,
      items,
    });
  }

  stepLive(dt) {
    if (!this.ready) return;
    const stepDt = Math.max(0.001, Math.min(0.05, dt));
    this.liveClock += stepDt;
    const t = this.liveClock;

    const tgt = Object.assign({}, this.T);
    if (this.mouse.in) {
      tgt.angleX = clamp(tgt.angleX + this.mouse.x * 0.62, -1, 1);
      tgt.angleY = clamp(tgt.angleY - this.mouse.y * 0.48, -1, 1);
      tgt.eyeX = clamp(tgt.eyeX + this.mouse.x * 0.85, -1, 1);
      tgt.eyeY = clamp(tgt.eyeY - this.mouse.y * 0.58, -1, 1);
      tgt.body = clamp(tgt.body + this.mouse.x * 0.20, -1, 1);
    } else {
      tgt.angleX += (0.20 * Math.sin(t * 0.65) + 0.08 * Math.sin(t * 1.35)) * 0.55;
      tgt.angleY += 0.11 * Math.sin(t * 0.48 + 1.2) * 0.55;
      tgt.angleZ += 0.09 * Math.sin(t * 0.36 + 0.4) * 0.55;
      tgt.body += 0.12 * Math.sin(t * 0.30 + 1.9) * 0.55;
      tgt.eyeX += 0.18 * Math.sin(t * 0.52 + 0.7) * 0.55;
    }

    for (const k of ['angleX', 'angleY', 'angleZ', 'eyeX', 'eyeY', 'body']) {
      tgt[k] = clamp((tgt[k] ?? 0) + (this.parallax[k] ?? 0), -1, 1);
    }

    if (this.motion.name !== 'Idle' && this.motion.dur > 0) {
      this.motion.t += stepDt;
      if (this.motion.t >= this.motion.dur) {
        this.motion = { name: 'Idle', t: 0, dur: 0 };
      } else {
        const m = this._evalMotion();
        tgt.angleX = clamp(tgt.angleX + m.angleX, -1, 1);
        tgt.angleY = clamp(tgt.angleY + m.angleY, -1, 1);
        tgt.angleZ = clamp(tgt.angleZ + m.angleZ, -1, 1);
        tgt.body = clamp(tgt.body + m.body, -1, 1);
        tgt.brow = clamp(tgt.brow + m.brow, -1, 1);
      }
    }

    if (this.pokeTimer > 0) {
      this.pokeTimer = Math.max(0, this.pokeTimer - stepDt);
      const u = this.pokeTimer / 1.15;
      const bounceImpulse = Math.sin(u * Math.PI * 3.0) * u;
      tgt.angleZ = clamp(tgt.angleZ + 0.35 * this.pokeDir * u, -1, 1);
      tgt.angleY = clamp(tgt.angleY + 0.24 * u, -1, 1);
      tgt.angleX = clamp(tgt.angleX + 0.22 * bounceImpulse * this.pokeDir, -1, 1);
      if (this.pokeKind === 'winkR') {
        tgt.eyeOpenR = 0.0;
        tgt.mouthOpen = Math.max(tgt.mouthOpen, 0.38 * u);
        tgt.mouthForm = 0.75;
      } else {
        tgt.brow = 0.9;
        tgt.mouthOpen = Math.max(tgt.mouthOpen, 0.45 * u);
      }
    }

    if (this.preset === 'neutral') {
      if (this.blinkT < 0 && t >= this.nextBlinkAt) {
        this.blinkT = 0;
        this.blinkBounceStarted = false;
        this.blinkVariant = 1;
        this.nextBlinkAt = t + 2.4 + ((Math.sin(t * 17.3) * 0.5 + 0.5) * 2.4);
      }
      if (this.blinkT >= 0) {
        this.blinkT += stepDt;
        const d = this.blinkT;
        const hold = 0.10;
        let v = 1;
        if (d < 0.07) v = 1 - d / 0.07;
        else if (d < 0.07 + hold) v = 0;
        else if (d < 0.22 + hold) {
          v = (d - 0.07 - hold) / 0.15;
          if (!this.blinkBounceStarted && v > 0.12) {
            this.blinkBounceStarted = true;
            this.irisBounceT = 0;
          }
        } else {
          this.blinkT = -1;
          v = 1;
        }
        tgt.eyeOpenL = Math.min(tgt.eyeOpenL, v);
        tgt.eyeOpenR = Math.min(tgt.eyeOpenR, v);
      }
    }

    if (this.irisBounceT >= 0) {
      this.irisBounceT += stepDt;
      if (this.irisBounceT > 0.50) this.irisBounceT = -1;
    }

    const kSmooth = 1 - Math.exp(-stepDt * 13);
    for (const key in this.cur) {
      this.cur[key] += ((tgt[key] ?? this.T[key]) - this.cur[key]) * kSmooth;
    }
    const e = Object.assign({}, this.cur);
    e.irisBounceX = 1;
    e.irisBounceY = 1;
    if (this.irisBounceT >= 0) {
      const p = this.irisBounceT / 0.50;
      const damp = Math.exp(-2.4 * p);
      const scale = 1 + 0.16 * Math.sin(p * Math.PI * 4.0) * damp;
      const squash = 0.09 * Math.sin(p * Math.PI * 4.0 + Math.PI / 2) * damp;
      e.irisBounceX = scale * (1 + squash);
      e.irisBounceY = scale * (1 - squash);
    }
    e.breath = 0.5 + 0.5 * Math.sin((t * 2 * Math.PI) / 3.4);
    e.breathHead = 0.5 + 0.5 * Math.sin((t * 2 * Math.PI) / 3.4 - 0.6);
    this._updateSprings(e, t, stepDt, true);
    this.renderPose(e);
  }

  setDeterministicPose(tSec, dt = 1 / 30, pose = {}) {
    if (!this.ready) return;
    if (pose.preset && CBT_PRESETS[pose.preset]) {
      Object.assign(this.T, BASE_PARAMS, this.paramOverrides, CBT_PRESETS[pose.preset]);
    } else if (pose.preset === null) {
      Object.assign(this.T, BASE_PARAMS, this.paramOverrides);
    }
    const e = Object.assign({}, BASE_PARAMS, this.paramOverrides, this.T, pose);
    if (pose.useParallax !== false) {
      for (const k of ['angleX', 'angleY', 'angleZ', 'eyeX', 'eyeY', 'body']) {
        if (pose[k] === undefined) {
          e[k] = clamp((e[k] ?? 0) + (this.parallax[k] ?? 0), -1, 1);
        }
      }
    }
    if (pose.motion) {
      this.playMotion(pose.motion);
      if (pose.motionTime !== undefined) this.motion.t = pose.motionTime;
      const m = this._evalMotion();
      e.angleX = clamp(e.angleX + m.angleX, -1, 1);
      e.angleY = clamp(e.angleY + m.angleY, -1, 1);
      e.angleZ = clamp(e.angleZ + m.angleZ, -1, 1);
      e.body = clamp(e.body + m.body, -1, 1);
      e.brow = clamp(e.brow + m.brow, -1, 1);
    }
    e.irisBounceX = pose.irisBounceX ?? 1;
    e.irisBounceY = pose.irisBounceY ?? 1;
    e.breath = pose.breath ?? 0.5 + 0.5 * Math.sin((tSec * 2 * Math.PI) / 3.4);
    e.breathHead = pose.breathHead ?? 0.5 + 0.5 * Math.sin((tSec * 2 * Math.PI) / 3.4 - 0.6);
    Object.assign(this.cur, e);

    const step = dt > 0 ? dt : 1 / 30;
    const subSteps = pose.settle ? 24 : 1;
    for (let i = 0; i < subSteps; i++) {
      this._updateSprings(e, tSec, step, pose.wind !== false);
    }
    this.renderPose(e);
  }
}
