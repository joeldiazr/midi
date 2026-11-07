// Cámara en primera persona: arrastrar para mirar, WASD / flechas para caminar.
import * as THREE from 'three';

const EYE = 1.62;

export class CabinCam {
  constructor(camera, dom, colliders) {
    this.cam = camera; this.dom = dom; this.col = colliders;
    this.pos = new THREE.Vector3(0, EYE, 0.15);
    this.vel = new THREE.Vector3();
    this.yaw = -Math.PI * 0.75; this.pitch = 0.32;
    this.tYaw = this.yaw; this.tPitch = this.pitch;
    this.keys = new Set();
    this.drag = null;
    this.bob = 0;
    this.active = false;
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.fov = 72;
    this.onMoveHint = null;

    dom.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      this.drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      dom.setPointerCapture(e.pointerId);
      dom.classList.add('grabbing');
    });
    dom.addEventListener('pointermove', (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX; this.drag.y = e.clientY;
      const k = e.pointerType === 'touch' ? 0.0055 : 0.0038;
      this.tYaw -= dx * k; this.tPitch -= dy * k;
      this.tPitch = Math.max(-1.25, Math.min(1.35, this.tPitch));
    });
    const up = (e) => {
      if (this.drag && e.pointerId === this.drag.id) { this.drag = null; dom.classList.remove('grabbing'); }
    };
    dom.addEventListener('pointerup', up); dom.addEventListener('pointercancel', up);
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  // entrar mirando hacia una bobina (o mantener la mirada de la cámara actual)
  enter(fromCamera, coil) {
    this.active = true;
    this.pos.set(0, EYE, 0.15);
    this.vel.set(0, 0, 0);
    if (coil) {
      const dx = coil.toroid.x - this.pos.x, dz = coil.toroid.z - this.pos.z, dy = coil.toroid.y - this.pos.y;
      this.yaw = this.tYaw = Math.atan2(-dx, -dz);
      this.pitch = this.tPitch = Math.atan2(dy, Math.hypot(dx, dz));
    }
  }
  exit() { this.active = false; this.drag = null; this.dom.classList.remove('grabbing'); }
  reset(coil) { this.enter(null, coil); }

  update(dt, shake = 0, kick = 0) {
    const k = this.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const run = k.has('ShiftLeft') || k.has('ShiftRight');
    const speed = run ? 4.8 : 2.4;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let tx = fx * f + rx * s, tz = fz * f + rz * s;
    const tl = Math.hypot(tx, tz);
    if (tl > 0) { tx = (tx / tl) * speed; tz = (tz / tl) * speed; }
    const a = 1 - Math.exp(-dt * 10);
    this.vel.x += (tx - this.vel.x) * a; this.vel.z += (tz - this.vel.z) * a;
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    this.collide();
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.bob += sp * dt * 2.6;
    const la = 1 - Math.exp(-dt * 16);
    this.yaw += (this.tYaw - this.yaw) * la; this.pitch += (this.tPitch - this.pitch) * la;

    const n = performance.now() * 0.001;
    const sh = shake * 0.035;
    this.cam.position.set(
      this.pos.x + Math.sin(n * 41) * sh,
      EYE + Math.sin(this.bob * 2) * 0.025 * Math.min(1, sp) + Math.sin(n * 37 + 1) * sh,
      this.pos.z + Math.sin(n * 33 + 2) * sh,
    );
    this.euler.set(this.pitch + Math.sin(n * 29) * sh * 0.3, this.yaw, Math.sin(this.bob) * 0.004 * sp + Math.sin(n * 23) * sh * 0.4);
    this.cam.quaternion.setFromEuler(this.euler);
    const fov = this.fov - kick * 3;
    if (Math.abs(this.cam.fov - fov) > 0.01) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }
    if (this.cam.up.y !== 1) this.cam.up.set(0, 1, 0);
  }

  collide() {
    const r = 0.26, p = this.pos;
    for (let it = 0; it < 2; it++) {
      for (const [ax, az, bx, bz] of this.col.segs) {
        const dx = bx - ax, dz = bz - az;
        const l2 = dx * dx + dz * dz || 1;
        let t = ((p.x - ax) * dx + (p.z - az) * dz) / l2;
        t = Math.max(0, Math.min(1, t));
        const cx = ax + dx * t, cz = az + dz * t;
        const ex = p.x - cx, ez = p.z - cz, d = Math.hypot(ex, ez);
        if (d < r && d > 1e-6) { p.x = cx + (ex / d) * r; p.z = cz + (ez / d) * r; }
      }
      for (const [cx, cz, cr] of this.col.circles) {
        const ex = p.x - cx, ez = p.z - cz, d = Math.hypot(ex, ez), m = cr + r;
        if (d < m && d > 1e-6) { p.x = cx + (ex / d) * m; p.z = cz + (ez / d) * m; }
      }
    }
  }
}
