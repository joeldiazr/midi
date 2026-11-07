// Rayos: generación fractal, cintas orientadas a cámara, chispas y destellos.
// Todo avanza con simDt: si simDt = 0 (pausa) la geometría queda congelada tal cual.
import * as THREE from 'three';
import { rng, glowTexture } from '../scene/textures.js';

const V3 = THREE.Vector3;

const ribbonVS = /* glsl */ `
  attribute vec3 aPrev; attribute vec3 aNext; attribute float aSide; attribute vec3 aColor; attribute vec2 aParams;
  uniform float uPixel;
  varying vec3 vColor; varying float vSide; varying float vI;
  void main(){
    vec4 mvP = modelViewMatrix * vec4(position, 1.0);
    vec3 a = (modelViewMatrix * vec4(aPrev, 1.0)).xyz;
    vec3 b = (modelViewMatrix * vec4(aNext, 1.0)).xyz;
    vec3 tang = b - a; float tl = length(tang);
    tang = tl > 1e-6 ? tang / tl : vec3(0.0, 1.0, 0.0);
    vec3 toCam = normalize(-mvP.xyz);
    vec3 n = cross(tang, toCam); float nl = length(n);
    n = nl > 1e-6 ? n / nl : vec3(1.0, 0.0, 0.0);
    float px = max(-mvP.z, 0.05) * uPixel;
    float w = max(aParams.x, px * 1.6);
    mvP.xyz += n * aSide * w;
    gl_Position = projectionMatrix * mvP;
    vColor = aColor; vSide = aSide;
    vI = aParams.y * clamp(aParams.x / w, 0.25, 1.0);
  }`;
const ribbonFS = /* glsl */ `
  varying vec3 vColor; varying float vSide; varying float vI;
  void main(){
    float d = abs(vSide);
    float core = exp(-d * d * 30.0);
    float glow = exp(-d * 3.0) * (1.0 - d);
    vec3 c = vColor * glow * 1.1 + mix(vColor, vec3(1.0), 0.8) * core * 2.4;
    gl_FragColor = vec4(c * vI, 1.0);
  }`;

export class RibbonBatch {
  constructor(maxV = 48000) {
    this.maxV = maxV;
    this.pos = new Float32Array(maxV * 3);
    this.prev = new Float32Array(maxV * 3);
    this.next = new Float32Array(maxV * 3);
    this.side = new Float32Array(maxV);
    this.col = new Float32Array(maxV * 3);
    this.par = new Float32Array(maxV * 2);
    this.idx = new Uint32Array(maxV * 3);
    const g = new THREE.BufferGeometry();
    const attr = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    this.attrs = {
      position: attr(this.pos, 3), aPrev: attr(this.prev, 3), aNext: attr(this.next, 3),
      aSide: attr(this.side, 1), aColor: attr(this.col, 3), aParams: attr(this.par, 2),
    };
    for (const k in this.attrs) g.setAttribute(k, this.attrs[k]);
    this.index = attr(this.idx, 1);
    g.setIndex(this.index);
    g.boundingSphere = new THREE.Sphere(new V3(), 1e4);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uPixel: { value: 0.001 } },
      vertexShader: ribbonVS, fragmentShader: ribbonFS,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: true,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.geo = g;
    this.v = 0; this.i = 0;
  }
  begin() { this.v = 0; this.i = 0; }
  // pts: Float32Array plano [x,y,z,...], n puntos
  line(pts, n, w0, w1, i0, i1, color) {
    if (n < 2 || this.v + n * 2 > this.maxV) return;
    const { pos, prev, next, side, col, par, idx } = this;
    const base = this.v;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      const p = k * 3, pp = (k > 0 ? k - 1 : k) * 3, nn = (k < n - 1 ? k + 1 : k) * 3;
      const w = w0 + (w1 - w0) * t, I = i0 + (i1 - i0) * t;
      for (let s = 0; s < 2; s++) {
        const v = base + k * 2 + s, v3 = v * 3;
        pos[v3] = pts[p]; pos[v3 + 1] = pts[p + 1]; pos[v3 + 2] = pts[p + 2];
        prev[v3] = pts[pp]; prev[v3 + 1] = pts[pp + 1]; prev[v3 + 2] = pts[pp + 2];
        next[v3] = pts[nn]; next[v3 + 1] = pts[nn + 1]; next[v3 + 2] = pts[nn + 2];
        side[v] = s ? 1 : -1;
        col[v3] = color.r; col[v3 + 1] = color.g; col[v3 + 2] = color.b;
        par[v * 2] = w; par[v * 2 + 1] = I;
      }
    }
    let ii = this.i;
    for (let k = 0; k < n - 1; k++) {
      const a = base + k * 2;
      idx[ii++] = a; idx[ii++] = a + 1; idx[ii++] = a + 2;
      idx[ii++] = a + 1; idx[ii++] = a + 3; idx[ii++] = a + 2;
    }
    this.i = ii;
    this.v += n * 2;
  }
  end() {
    const v = this.v;
    for (const k in this.attrs) {
      const a = this.attrs[k];
      a.clearUpdateRanges(); a.addUpdateRange(0, Math.max(1, v * a.itemSize)); a.needsUpdate = true;
    }
    this.index.clearUpdateRanges(); this.index.addUpdateRange(0, Math.max(1, this.i)); this.index.needsUpdate = true;
    this.geo.setDrawRange(0, this.i);
  }
}

// ----- geometría de un rayo: desplazamiento de punto medio -----
const tA = new V3(), tB = new V3(), tD = new V3(), tU = new V3(), tW = new V3();
function gauss(R) { return (R() + R() + R() - 1.5) * 1.15; }
function genPath(out, levels, a, b, rough, R, curl) {
  const n = (1 << levels) + 1;
  out[0] = a.x; out[1] = a.y; out[2] = a.z;
  out[(n - 1) * 3] = b.x; out[(n - 1) * 3 + 1] = b.y; out[(n - 1) * 3 + 2] = b.z;
  tD.subVectors(b, a); const len = tD.length(); tD.divideScalar(len || 1);
  tU.set(0, 1, 0); if (Math.abs(tD.y) > 0.9) tU.set(1, 0, 0);
  tU.cross(tD).normalize(); tW.crossVectors(tD, tU).normalize();
  let step = n - 1, amp = len * rough;
  while (step > 1) {
    const half = step >> 1;
    for (let i = 0; i < n - 1; i += step) {
      const j = i + step, m = i + half;
      const g1 = gauss(R) * amp, g2 = gauss(R) * amp;
      out[m * 3] = (out[i * 3] + out[j * 3]) * 0.5 + tU.x * g1 + tW.x * g2;
      out[m * 3 + 1] = (out[i * 3 + 1] + out[j * 3 + 1]) * 0.5 + tU.y * g1 + tW.y * g2;
      out[m * 3 + 2] = (out[i * 3 + 2] + out[j * 3 + 2]) * 0.5 + tU.z * g1 + tW.z * g2;
    }
    amp *= 0.56; step = half;
  }
  if (curl) for (let i = 1; i < n - 1; i++) out[i * 3 + 1] += Math.sin((Math.PI * i) / (n - 1)) * len * curl;
  return n;
}

class Bolt {
  constructor() {
    this.main = new Float32Array(((1 << 6) + 1) * 3);
    this.br = [0, 1, 2, 3].map(() => new Float32Array(((1 << 4) + 1) * 3));
    this.brN = [0, 0, 0, 0];
    this.a = new V3(); this.b = new V3(); this.n = 0; this.nb = 0;
    this.color = new THREE.Color();
    this.alive = false;
  }
}

export class BoltSystem {
  constructor(scene, lab) {
    this.lab = lab;
    this.coils = lab.coils;
    this.cage = lab.cage;
    this.batch = new RibbonBatch();
    scene.add(this.batch.mesh);
    this.pool = Array.from({ length: 64 }, () => new Bolt());
    this.R = rng(2024);
    this.colors = [0, 1, 2, 3].map(() => new THREE.Color(0x9fb8ff));
    this.coilStrike = [0, 0, 0, 0];   // destello reciente por bobina
    this.coilLevel = [0, 0, 0, 0];
    this.flashI = 0; this.flashPos = new V3(0, 3, 0); this.flashColor = new THREE.Color(1, 1, 1);
    this.shake = 0;
    this.time = 0;
    this.stream = [0, 0, 0, 0];
    // chispas
    this.maxSparks = 1400;
    this.sp = new Float32Array(this.maxSparks * 3);
    this.sv = new Float32Array(this.maxSparks * 3);
    this.sl = new Float32Array(this.maxSparks);
    this.sm = new Float32Array(this.maxSparks).fill(1);
    this.sc = new Uint8Array(this.maxSparks);
    this.sNext = 0;
    this.sparkPts = new Float32Array(6);
    // destellos (sprites)
    const glow = glowTexture(128);
    this.flares = Array.from({ length: 14 }, () => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
      s.renderOrder = 11; s.visible = false; s.userData.life = 0; s.userData.max = 1; s.userData.size = 1;
      scene.add(s); return s;
    });
    this.fNext = 0;
    this.tmpPos = new V3(); this.tmpN = new V3(); this.tmpC = new THREE.Color();
    this.white = new THREE.Color(1, 1, 1);
  }

  setPalette(colors) { colors.forEach((c, i) => this.colors[i].copy(c)); }

  alloc() {
    for (const b of this.pool) if (!b.alive) return b;
    // reemplaza la más vieja
    let o = this.pool[0];
    for (const b of this.pool) if (b.age / b.life > o.age / o.life) o = b;
    return o;
  }

  regen(b) {
    const R = this.R;
    const rough = b.kind === 'streamer' ? 0.2 : b.kind === 'arc' ? 0.14 : 0.13;
    b.n = genPath(b.main, 6, b.a, b.b, rough, R, b.kind === 'streamer' ? 0.1 : b.kind === 'arc' ? 0.12 : 0.04);
    b.nb = b.kind === 'streamer' ? (R() < 0.5 ? 1 : 0) : 1 + Math.floor(R() * 3);
    for (let k = 0; k < b.nb; k++) {
      const s = 4 + Math.floor(R() * (b.n * 0.7));
      tA.set(b.main[s * 3], b.main[s * 3 + 1], b.main[s * 3 + 2]);
      const s2 = Math.min(b.n - 1, s + 2);
      tB.set(b.main[s2 * 3], b.main[s2 * 3 + 1], b.main[s2 * 3 + 2]).sub(tA).normalize();
      tB.x += gauss(R) * 0.9; tB.y += gauss(R) * 0.9 - 0.15; tB.z += gauss(R) * 0.9;
      tB.normalize().multiplyScalar(b.len * (0.12 + R() * 0.28)).add(tA);
      b.brN[k] = genPath(b.br[k], 4, tA, tB, 0.22, R, 0);
    }
    b.regenAt = this.time + 0.022 + R() * 0.03;
  }

  // rayo desde el toroide de la bobina ci hasta la cabina
  strike(ci, strength) {
    const R = this.R, c = this.coils[ci];
    const b = this.alloc();
    b.alive = true; b.kind = 'strike'; b.coil = ci;
    this.cage.randomTarget(c.toroid, R, b.b, this.tmpN);
    const toward = Math.atan2(-c.dir.z, -c.dir.x) + gauss(R) * 0.35;
    if (R() < 0.45) b.a.copy(c.tip);
    else b.a.set(c.toroid.x + Math.cos(toward) * 0.67, c.toroid.y + gauss(R) * 0.05, c.toroid.z + Math.sin(toward) * 0.67);
    b.len = b.a.distanceTo(b.b);
    b.life = 0.08 + strength * 0.16 + R() * 0.05; b.age = 0;
    b.intensity = 0.9 + strength * 1.6;
    b.width = 0.03 + strength * 0.035;
    b.color.copy(this.colors[ci]);
    this.regen(b);
    // impacto
    const hit = b.b;
    this.cage.addHit(hit, this.colors[ci], 0.8 + strength * 2.0);
    this.emitSparks(hit, this.tmpN, Math.floor(10 + strength * 55), ci, 1.5 + strength * 4);
    this.flare(hit, this.colors[ci], 0.35 + strength * 0.7, 0.1 + strength * 0.12);
    this.flare(b.a, this.colors[ci], 0.3 + strength * 0.5, 0.08 + strength * 0.08);
    this.coilStrike[ci] = Math.max(this.coilStrike[ci], 0.5 + strength);
    if (0.6 + strength > this.flashI) {
      this.flashI = 0.6 + strength;
      this.flashPos.copy(c.toroid).lerp(hit, 0.25);
      this.flashColor.copy(this.colors[ci]).lerp(this.white, 0.45);
    }
    this.shake = Math.min(1.6, this.shake + strength * (ci === 0 ? 0.55 : 0.22));
    if (this.onStrike) this.onStrike(ci, strength, this.tmpPos.copy(c.toroid).lerp(hit, 0.5));
    return b;
  }

  streamer(ci, level) {
    const R = this.R, c = this.coils[ci];
    const b = this.alloc();
    b.alive = true; b.kind = 'streamer'; b.coil = ci;
    const ang = R() * Math.PI * 2;
    b.a.set(c.toroid.x + Math.cos(ang) * 0.67, c.toroid.y + gauss(R) * 0.06, c.toroid.z + Math.sin(ang) * 0.67);
    tD.set(Math.cos(ang), 0.25 + R() * 0.7, Math.sin(ang)).normalize();
    b.len = 0.3 + level * 1.7 + R() * 0.4;
    b.b.copy(b.a).addScaledVector(tD, b.len);
    b.life = 0.05 + R() * 0.16; b.age = 0;
    b.intensity = 0.45 + level * 0.9;
    b.width = 0.016 + level * 0.018;
    b.color.copy(this.colors[ci]);
    this.regen(b);
    if (R() < 0.12) this.emitSparks(b.b, tD, 3, ci, 1.2);
  }

  // arco entre dos bobinas vecinas
  arc(ci, cj, strength) {
    const R = this.R;
    const b = this.alloc();
    const a = this.coils[ci], c = this.coils[cj];
    b.alive = true; b.kind = 'arc'; b.coil = ci;
    tD.subVectors(c.toroid, a.toroid).normalize();
    b.a.copy(a.toroid).addScaledVector(tD, 0.67);
    b.b.copy(c.toroid).addScaledVector(tD, -0.67);
    b.len = b.a.distanceTo(b.b);
    b.life = 0.1 + strength * 0.12; b.age = 0;
    b.intensity = 1 + strength;
    b.width = 0.035 + strength * 0.03;
    b.color.copy(this.colors[ci]).lerp(this.colors[cj], 0.5);
    this.regen(b);
    this.flare(b.a, b.color, 0.8, 0.15); this.flare(b.b, b.color, 0.8, 0.15);
    if (this.onStrike) this.onStrike(ci, strength, this.tmpPos.copy(b.a).lerp(b.b, 0.5));
  }

  emitSparks(p, n, count, ci, speed) {
    const R = this.R;
    for (let k = 0; k < count; k++) {
      const i = this.sNext; this.sNext = (this.sNext + 1) % this.maxSparks;
      this.sp[i * 3] = p.x; this.sp[i * 3 + 1] = p.y; this.sp[i * 3 + 2] = p.z;
      const s = speed * (0.3 + R() * 0.9);
      let vx = n.x + gauss(R) * 0.9, vy = n.y + gauss(R) * 0.9 + 0.3, vz = n.z + gauss(R) * 0.9;
      const l = Math.hypot(vx, vy, vz) || 1;
      this.sv[i * 3] = (vx / l) * s; this.sv[i * 3 + 1] = (vy / l) * s; this.sv[i * 3 + 2] = (vz / l) * s;
      this.sm[i] = this.sl[i] = 0.35 + R() * 0.9;
      this.sc[i] = ci;
    }
  }

  flare(p, color, size, life) {
    const f = this.flares[this.fNext]; this.fNext = (this.fNext + 1) % this.flares.length;
    f.position.copy(p); f.material.color.copy(color).lerp(this.white, 0.5);
    f.userData.life = f.userData.max = life; f.userData.size = size;
    f.visible = true;
  }

  // levels[4] 0..1, onsets[4] fuerza (0 = nada)
  update(simDt, levels, onsets) {
    const R = this.R;
    if (simDt > 0) {
      this.time += simDt;
      for (let i = 0; i < 4; i++) {
        const lv = levels[i];
        this.coilLevel[i] += (lv - this.coilLevel[i]) * Math.min(1, simDt * 18);
        if (onsets[i] > 0.12) {
          this.strike(i, onsets[i]);
          if (onsets[i] > 0.7 && R() < 0.6) this.strike(i, onsets[i] * 0.6);
        }
        // nivel sostenido alto: golpes extra
        if (lv > 0.72 && R() < (lv - 0.72) * 14 * simDt) this.strike(i, 0.25 + R() * 0.3);
        // serpentinas continuas, como una bobina musical sosteniendo una nota
        const want = lv < 0.06 ? 0 : 1 + Math.floor(Math.pow(lv, 1.2) * 4.5);
        this.stream[i] -= simDt;
        let alive = 0;
        for (const b of this.pool) if (b.alive && b.kind === 'streamer' && b.coil === i) alive++;
        if (alive < want && this.stream[i] <= 0) { this.streamer(i, lv); this.stream[i] = 0.012; }
        this.coilStrike[i] *= Math.exp(-simDt * 10);
      }
      if (levels[1] > 0.82 && levels[2] > 0.82 && R() < simDt * 2.5) this.arc(1, 2, 0.7);
      if (levels[0] > 0.85 && levels[3] > 0.75 && R() < simDt * 2.0) this.arc(3, 0, 0.7);
      // envejecer y re-trazar
      for (const b of this.pool) {
        if (!b.alive) continue;
        b.age += simDt;
        if (b.age >= b.life) { b.alive = false; continue; }
        if (this.time >= b.regenAt) {
          if (b.kind === 'streamer') { // la punta tiembla
            b.b.x += gauss(R) * 0.08; b.b.y += gauss(R) * 0.08; b.b.z += gauss(R) * 0.08;
          }
          this.regen(b);
        }
      }
      // chispas
      const g = 9.8;
      for (let i = 0; i < this.maxSparks; i++) {
        if (this.sl[i] <= 0) continue;
        this.sl[i] -= simDt;
        const i3 = i * 3;
        this.sv[i3 + 1] -= g * simDt;
        const drag = Math.exp(-simDt * 1.2);
        this.sv[i3] *= drag; this.sv[i3 + 1] *= drag; this.sv[i3 + 2] *= drag;
        this.sp[i3] += this.sv[i3] * simDt; this.sp[i3 + 1] += this.sv[i3 + 1] * simDt; this.sp[i3 + 2] += this.sv[i3 + 2] * simDt;
        if (this.sp[i3 + 1] < 0.01 && this.sv[i3 + 1] < 0) {
          this.sp[i3 + 1] = 0.01; this.sv[i3 + 1] *= -0.32; this.sv[i3] *= 0.55; this.sv[i3 + 2] *= 0.55;
        }
      }
      // destellos
      for (const f of this.flares) {
        if (!f.visible) continue;
        f.userData.life -= simDt;
        if (f.userData.life <= 0) { f.visible = false; continue; }
      }
      this.flashI *= Math.exp(-simDt * 14);
      this.shake *= Math.exp(-simDt * 5);
    }
    // flares: escala/opacidad (también en pausa, para mantener el estado)
    for (const f of this.flares) {
      if (!f.visible) continue;
      const k = f.userData.life / f.userData.max;
      f.material.opacity = Math.min(0.8, k * 1.1);
      f.scale.setScalar(f.userData.size * (0.6 + 0.4 * k));
    }
    this.rebuild();
  }

  rebuild() {
    const batch = this.batch;
    batch.begin();
    for (const b of this.pool) {
      if (!b.alive) continue;
      const k = 1 - b.age / b.life;
      const flick = 0.75 + 0.25 * Math.sin(b.regenAt * 997.0);
      const I = b.intensity * Math.pow(k, 0.45) * flick;
      if (b.kind === 'streamer') batch.line(b.main, b.n, b.width, b.width * 0.2, I, I * 0.15, b.color);
      else batch.line(b.main, b.n, b.width, b.width * 0.7, I, I * 0.85, b.color);
      for (let j = 0; j < b.nb; j++) batch.line(b.br[j], b.brN[j], b.width * 0.5, b.width * 0.08, I * 0.7, I * 0.05, b.color);
    }
    // chispas como trazos cortos (en pausa quedan como estelas congeladas)
    const pts = this.sparkPts, c = this.tmpC;
    for (let i = 0; i < this.maxSparks; i++) {
      const life = this.sl[i];
      if (life <= 0) continue;
      const i3 = i * 3, heat = life / this.sm[i];
      pts[0] = this.sp[i3]; pts[1] = this.sp[i3 + 1]; pts[2] = this.sp[i3 + 2];
      pts[3] = this.sp[i3] - this.sv[i3] * 0.028; pts[4] = this.sp[i3 + 1] - this.sv[i3 + 1] * 0.028; pts[5] = this.sp[i3 + 2] - this.sv[i3 + 2] * 0.028;
      c.copy(this.colors[this.sc[i]]).lerp(this.white, heat * 0.7);
      batch.line(pts, 2, 0.007, 0.004, 1.6 * heat + 0.1, 0.3 * heat, c);
    }
    batch.end();
  }

  setPixel(camera, heightPx) {
    this.batch.material.uniforms.uPixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / heightPx;
  }
}
