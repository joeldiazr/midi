// Director de cámara: planos automáticos que cortan sobre el pulso de la canción.
import * as THREE from 'three';
import { rng } from '../scene/textures.js';

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;
const CENTER = new V3(0, 1.45, 0);
const AXES = [0, Math.PI / 2, Math.PI, Math.PI * 1.5]; // ejes libres entre bobinas

function hand(t, s) { return Math.sin(t * 1.3 + s) * 0.55 + Math.sin(t * 2.7 + s * 2.1) * 0.3 + Math.sin(t * 6.1 + s * 3.7) * 0.15; }
const pick = (R, arr) => arr[Math.floor(R() * arr.length)];

// mood: 0 calmo · 1 neutro · 2 intenso
const SHOTS = [
  {
    id: 'orbita', name: 'ÓRBITA', mood: 0,
    init(R) { return { a0: R() * TAU, r: 7.3 + R() * 1.4, h: 1.3 + R() * 1.6, sp: (R() < 0.5 ? -1 : 1) * (0.07 + R() * 0.07), th: 1.5 + R() * 0.6 }; },
    pose(s, t, o) {
      const a = s.a0 + s.sp * t;
      o.pos.set(Math.cos(a) * s.r, s.h + Math.sin(t * 0.3) * 0.15, Math.sin(a) * s.r);
      o.target.set(0, s.th, 0); o.fov = 48; o.roll = 0;
    },
  },
  {
    id: 'contrapicado', name: 'CONTRAPICADO', mood: 2, subject: true,
    init(R, c) {
      const sg = R() < 0.5 ? -1 : 1;
      const side = new V3(-c.dir.z, 0, c.dir.x).multiplyScalar(sg);
      const start = c.base.clone().addScaledVector(c.dir, 1.35).addScaledVector(side, 0.85 + R() * 0.5); start.y = 0.28;
      const target = c.toroid.clone().lerp(new V3(0, 2.6, 0), 0.3);
      const push = target.clone().sub(start).setY(0).normalize().multiplyScalar(0.1 + R() * 0.12);
      return { start, target, push, roll: sg * 0.07 };
    },
    pose(s, t, o) { o.pos.copy(s.start).addScaledVector(s.push, t); o.target.copy(s.target); o.fov = 66; o.roll = s.roll; },
  },
  {
    id: 'cenital', name: 'CENITAL', mood: 0,
    init(R) { return { a0: R() * TAU, sp: (R() < 0.5 ? -1 : 1) * 0.07, h: 6.9 + R() * 0.4 }; },
    pose(s, t, o) {
      const a = s.a0 + s.sp * t;
      o.pos.set(0.001, s.h - t * 0.07, 0.001); o.target.set(0, 0, 0); o.fov = 76;
      o.up.set(Math.cos(a), 0, Math.sin(a)); o.roll = 0;
    },
  },
  {
    id: 'travelling', name: 'TRAVELLING', mood: 1,
    init(R) {
      const a = pick(R, AXES) + (R() - 0.5) * 0.4, dirS = R() < 0.5 ? -1 : 1;
      const p0 = new V3(Math.cos(a) * 6.5, 1.1 + R() * 0.6, Math.sin(a) * 6.5);
      const tan = new V3(-Math.sin(a), 0, Math.cos(a)).multiplyScalar(dirS);
      return { p0: p0.addScaledVector(tan, -2.6), tan, sp: 0.45 + R() * 0.3 };
    },
    pose(s, t, o) {
      o.pos.copy(s.p0).addScaledVector(s.tan, t * s.sp);
      o.target.set(0, 1.7, 0).addScaledVector(s.tan, 0.6 + t * s.sp * 0.3); o.fov = 42; o.roll = 0;
    },
  },
  {
    id: 'interior', name: 'DESDE LA CABINA', mood: 2, subject: true,
    init(R, c) {
      const p = new V3(-c.dir.x * 0.45, 1.05 + R() * 0.4, -c.dir.z * 0.45);
      return { p, target: c.toroid.clone().add(new V3(0, 0.2, 0)), s: R() * 10 };
    },
    pose(s, t, o) {
      o.pos.copy(s.p); o.pos.x += hand(t, s.s) * 0.03; o.pos.y += hand(t * 0.8, s.s + 3) * 0.02;
      o.target.copy(s.target); o.fov = 74; o.roll = hand(t * 0.5, s.s) * 0.02;
    },
  },
  {
    id: 'primerplano', name: 'PRIMER PLANO', mood: 2, subject: true,
    init(R, c) {
      // de costado y hacia afuera: los rayos van hacia la cabina y no pasan por la lente
      const a0 = Math.atan2(c.dir.z, c.dir.x) + (R() < 0.5 ? -1 : 1) * (1.05 + R() * 0.5);
      return { c, a0, sp: (R() < 0.5 ? -1 : 1) * 0.06, r: 3.4 + R() * 0.5, h: 0.6 + R() * 0.6 };
    },
    pose(s, t, o) {
      const a = s.a0 + s.sp * t;
      o.pos.set(s.c.toroid.x + Math.cos(a) * s.r, s.c.toroid.y + s.h, s.c.toroid.z + Math.sin(a) * s.r);
      o.target.copy(s.c.toroid).addScaledVector(s.c.dir, -0.6); o.target.y -= 0.2; o.fov = 32; o.roll = 0;
    },
  },
  {
    id: 'general', name: 'PLANO GENERAL', mood: 0,
    init(R) {
      const spots = [[12.4, 5.0, 3.6], [-12.4, 5.0, -3.6], [3.6, 5.0, 12.4], [-3.6, 5.0, -12.4], [12.2, 3.2, -3.2], [-3.2, 3.6, 12.2]];
      const p = new V3(...pick(R, spots));
      return { p, d: p.clone().negate().setY(0).normalize() };
    },
    pose(s, t, o) { o.pos.copy(s.p).addScaledVector(s.d, t * 0.22); o.target.set(0, 1.8, 0); o.fov = 52; o.roll = 0; },
  },
  {
    id: 'enmano', name: 'CÁMARA EN MANO', mood: 2,
    init(R) { const a = pick(R, AXES) + (R() - 0.5) * 0.3; return { a, r: 2.9 + R() * 0.4, s: R() * 50 }; },
    pose(s, t, o) {
      o.pos.set(Math.cos(s.a) * s.r + hand(t, s.s) * 0.08, 1.5 + hand(t * 1.1, s.s + 1) * 0.06, Math.sin(s.a) * s.r + hand(t * 0.9, s.s + 2) * 0.08);
      o.target.set(hand(t * 0.7, s.s + 4) * 0.15, 1.7 + hand(t * 0.6, s.s + 5) * 0.1, 0); o.fov = 58; o.roll = hand(t * 0.5, s.s + 6) * 0.03;
    },
  },
  {
    id: 'vertigo', name: 'VÉRTIGO', mood: 1,
    init(R) { const a = pick(R, AXES); return { a, d0: 9.6, rate: 0.75 + R() * 0.3 }; },
    pose(s, t, o) {
      const d = Math.max(3.6, s.d0 - t * s.rate);
      o.pos.set(Math.cos(s.a) * d, 1.55, Math.sin(s.a) * d);
      o.target.set(0, 1.55, 0);
      o.fov = THREE.MathUtils.radToDeg(2 * Math.atan(3.4 / (2 * d))); o.roll = 0;
    },
  },
  {
    id: 'rasante', name: 'RASANTE', mood: 1,
    init(R) { const a = pick(R, AXES) + (R() - 0.5) * 0.25; return { a, r0: 8.8 }; },
    pose(s, t, o) {
      const r = Math.max(2.9, s.r0 - t * 0.85);
      o.pos.set(Math.cos(s.a) * r, 0.16, Math.sin(s.a) * r); o.target.set(0, 1.25, 0); o.fov = 60; o.roll = 0;
    },
  },
  {
    id: 'picado', name: 'PICADO', mood: 1, subject: true,
    init(R, c) {
      const side = new V3(-c.dir.z, 0, c.dir.x).multiplyScalar(R() < 0.5 ? -1 : 1);
      const p = c.toroid.clone().addScaledVector(c.dir, 1.6).addScaledVector(side, 1.4); p.y = 6.6;
      return { p, c };
    },
    pose(s, t, o) { o.pos.copy(s.p); o.pos.y -= t * 0.1; o.target.copy(s.c.toroid).lerp(CENTER, 0.45); o.fov = 50; o.roll = 0; },
  },
];

export class Director {
  constructor(camera, lab, onShot) {
    this.cam = camera; this.lab = lab; this.onShot = onShot;
    this.R = rng(99);
    this.shot = null; this.state = null; this.age = 0; this.count = 0;
    this.history = [];
    this.cutAt = Infinity; this.idleLen = 8;
    this.o = { pos: new V3(), target: new V3(), up: new V3(0, 1, 0), fov: 50, roll: 0 };
    this.frozen = null;
    this.kick = 0; this.time = 0;
    this.subject = 0;
  }

  choose(energy) {
    const R = this.R;
    if (this.count === 0) { const id = R() < 0.5 ? 'general' : 'orbita'; return SHOTS.find((s) => s.id === id); }
    const w = energy > 0.66 ? [0.3, 1, 3] : energy < 0.33 ? [3, 2, 0.8] : [1.2, 2, 1.3];
    const cands = SHOTS.filter((s) => !this.history.slice(-2).includes(s.id));
    const total = cands.reduce((a, s) => a + w[s.mood], 0);
    let r = R() * total;
    for (const s of cands) { r -= w[s.mood]; if (r <= 0) return s; }
    return cands[0];
  }

  cut(ctx) {
    const shot = this.choose(ctx.energy ?? 0.4);
    this.subject = ctx.subject ?? Math.floor(this.R() * 4);
    this.shot = shot;
    this.state = shot.init(this.R, this.lab.coils[this.subject]);
    this.age = 0; this.count++;
    this.history.push(shot.id); if (this.history.length > 4) this.history.shift();
    this.idleLen = 7 + this.R() * 4;
    this.planCut(ctx);
    this.o.up.set(0, 1, 0);
    shot.pose(this.state, 0, this.o);
    this.apply(0, 0);
    this.onShot && this.onShot(this.count, shot.name, shot.subject ? this.subject : -1);
  }

  planCut(ctx) {
    this.cutAt = Infinity;
    const an = ctx.an;
    if (!an || !ctx.playing || !an.beats.length) return;
    const t = ctx.songT, e = ctx.energy ?? 0.5, R = this.R;
    const L = e > 0.68 ? pick(R, [2, 4, 4]) : e < 0.3 ? pick(R, [8, 8, 16]) : pick(R, [4, 4, 8]);
    let k0 = an.beats.findIndex((b) => b > t + 0.05);
    if (k0 < 0) return;
    let k = k0 + L - 1;
    if (L >= 4) while ((k - an.down) % 4 !== 0) k++;
    while (an.beats[k] !== undefined && an.beats[k] - t < 0.9) k += L;
    this.cutAt = an.beats[k] ?? Infinity;
  }

  resync(ctx) { this.planCut(ctx); }

  update(dt, ctx) {
    this.time += dt;
    const o = this.o;
    if (ctx.paused) {
      if (!this.frozen) {
        const off = this.cam.position.clone().sub(o.target);
        const r = Math.max(1.2, off.length());
        this.frozen = { pivot: o.target.clone(), r, az: Math.atan2(off.z, off.x), el: Math.asin(THREE.MathUtils.clamp(off.y / r, -0.95, 0.95)), fov: this.cam.fov, roll: o.roll, up: o.up.clone(), t: 0 };
      }
      const f = this.frozen;
      f.t += dt;
      const ease = Math.min(1, f.t / 1.2);
      const az = f.az + (f.t - 0.6 * (1 - ease)) * 0.16 * ease;
      const el = f.el;
      o.pos.set(f.pivot.x + Math.cos(az) * Math.cos(el) * f.r, f.pivot.y + Math.sin(el) * f.r, f.pivot.z + Math.sin(az) * Math.cos(el) * f.r);
      o.target.copy(f.pivot); o.fov = f.fov; o.roll = f.roll; o.up.copy(f.up);
      if (f.up.y < 0.5) o.up.copy(f.up).applyAxisAngle(new V3(0, 1, 0), f.az - az);
      this.apply(0, 0);
      return;
    }
    if (this.frozen) { this.frozen = null; this.cut(ctx); }
    if (!this.shot) this.cut(ctx);
    if (ctx.playing && ctx.an) {
      if (ctx.songT >= this.cutAt) this.cut(ctx);
      else if (ctx.bigHit && this.age > 1.1) this.cut(ctx);
    } else if (this.age > this.idleLen) this.cut(ctx);
    this.age += dt;
    o.up.set(0, 1, 0);
    this.shot.pose(this.state, this.age, o);
    this.kick += (0 - this.kick) * Math.min(1, dt * 6);
    if (ctx.kick) this.kick = Math.max(this.kick, ctx.kick);
    this.apply(ctx.shake || 0, this.kick);
  }

  apply(shake, kick) {
    const o = this.o, cam = this.cam, n = this.time;
    const sh = shake * 0.045;
    cam.position.set(o.pos.x + Math.sin(n * 43) * sh, o.pos.y + Math.sin(n * 37 + 1) * sh, o.pos.z + Math.sin(n * 31 + 2) * sh);
    cam.up.copy(o.up);
    cam.lookAt(o.target);
    if (o.roll || sh) cam.rotateZ(o.roll + Math.sin(n * 27) * sh * 0.25);
    const fov = o.fov - kick * 2.5;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }
}
