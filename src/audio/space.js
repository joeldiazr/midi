// Sonido espacial del sótano.
//
// · Eco de sala de piedra: respuesta al impulso generada por código (reflexiones tempranas +
//   cola de ~2,5 s que se oscurece con el tiempo, como en piedra y ladrillo).
// · Oído = cámara: cada fuente es un PannerNode HRTF en su posición 3D; el AudioListener
//   sigue a la cámara cada cuadro, así que al caminar las fuentes cambian de lado y distancia.
// · Ambiente: zumbido de cada bobina, goteras, crujidos de tuberías, un metro que pasa tras el muro
//   y pasos en modo cabina. Los eventos solo se programan si el tiempo corre (en pausa se detienen).

const RT60 = 2.5;

export function makeIR(ctx, seconds = RT60) {
  const sr = ctx.sampleRate, n = Math.floor(sr * (seconds + 0.2));
  const ir = ctx.createBuffer(2, n, sr);
  const pre = Math.floor(0.014 * sr);
  const taps = [0.011, 0.017, 0.023, 0.031, 0.038, 0.047, 0.059, 0.071];
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0, seed = 1234 + ch * 777;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const decay = Math.exp((-6.91 * t) / seconds);
      const a = 0.8 - 0.68 * Math.min(1, t / seconds); // los agudos se apagan antes
      lp += a * (rnd() - lp);
      d[i] = lp * decay * 0.6;
    }
    // reflexiones tempranas (muros cercanos y bóveda), distintas en cada oído
    taps.forEach((tt, k) => {
      const i = Math.floor((tt + ch * 0.0031 * (k % 3)) * sr);
      if (i < n) d[i] += (k % 2 ? -1 : 1) * (0.7 - k * 0.07);
    });
  }
  return ir;
}

function brownNoise(ctx, seconds = 4) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
  return b;
}

const LEAKS = [[-13.2, 0.05, 12.1], [12.6, 0.05, -11.4], [-6.2, 0.05, -13.6], [13.4, 0.05, 4.2], [-12.8, 0.05, -5.5], [2.5, 0.05, 13.4]];
const PIPES = [[-9, 7.6, -14.5], [6, 7.3, -14.1], [-14.4, 7.5, 5], [14.3, 7.3, -6], [3, 7.5, 14.4]];

export class Space {
  constructor(ctx, out) {
    this.ctx = ctx;
    const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    this.g = g;
    this.dry = g(1); this.dry.connect(out);
    this.verbIn = g(1);
    const conv = ctx.createConvolver(); conv.normalize = true; conv.buffer = makeIR(ctx);
    // la cola de la sala no lleva graves sueltos
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 140;
    this.verbOut = g(1.4); // con normalize la cola sale muy baja; así la música queda ~−20 dB de sala
    this.verbIn.connect(hp).connect(conv).connect(this.verbOut).connect(out);
    this.ambient = g(1); this.ambient.connect(this.dry);
    const ambSend = g(0.55); this.ambient.connect(ambSend).connect(this.verbIn);
    this.noise = brownNoise(ctx);
    this.white = (() => {
      const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return b;
    })();
    // tono de sala: aire quieto, muy bajo, sin posición
    const room = ctx.createBufferSource(); room.buffer = this.noise; room.loop = true;
    const rlp = ctx.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 220;
    this.roomGain = g(0.018);
    room.connect(rlp).connect(this.roomGain).connect(this.ambient); room.start();
    // zumbido del transformador (una sola fuente que se reparte a cada bobina)
    this.hum = g(0);
    const hlp = ctx.createBiquadFilter(); hlp.type = 'lowpass'; hlp.frequency.value = 200;
    for (const [f, a] of [[60, 1], [120, 0.45], [180, 0.12]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const ga = g(a); o.connect(ga).connect(hlp); o.start();
    }
    hlp.connect(this.hum);
    this.ready = false;
    this.timers = { drip: 2.5, creak: 8, train: 22 };
    this.onTrain = null;
    this.listenerOk = !!ctx.listener;
  }

  // posiciona las fuentes fijas cuando la escena ya existe
  setScene(lab) {
    if (this.ready || !lab) return;
    for (const c of lab.coils) {
      const p = this.panner([c.toroid.x, 1.6, c.toroid.z], { ref: 1.6, roll: 1.3 });
      this.hum.connect(p); p.connect(this.ambient);
    }
    this.ready = true;
  }

  panner(pos, { ref = 2.2, roll = 1.1, max = 60 } = {}) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
    p.refDistance = ref; p.rolloffFactor = roll; p.maxDistance = max;
    if (p.positionX) { p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; }
    else p.setPosition(pos[0], pos[1], pos[2]);
    return p;
  }

  // voz posicionada: entra por el panner y sale seca + a la sala
  voice(pos, send = 0.35, opts) {
    const p = this.panner(pos, opts);
    p.connect(this.dry);
    const s = this.g(send); p.connect(s).connect(this.verbIn);
    return { input: p, dispose: () => { p.disconnect(); s.disconnect(); } };
  }

  // fuente sin posición (música) con un poco de sala
  sendFrom(node, amount) { const s = this.g(amount); node.connect(s).connect(this.verbIn); return s; }

  setHum(v) {
    const target = v * 0.06;
    if (Math.abs(target - (this.humT ?? -1)) < 0.0005) return;
    this.humT = target;
    this.hum.gain.setTargetAtTime(target, this.ctx.currentTime, 0.25);
  }

  updateListener(cam, fwd, up) {
    const L = this.ctx.listener;
    if (!L) return;
    const p = cam.position;
    if (L.positionX) {
      L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
      L.forwardX.value = fwd.x; L.forwardY.value = fwd.y; L.forwardZ.value = fwd.z;
      L.upX.value = up.x; L.upY.value = up.y; L.upZ.value = up.z;
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  // reloj de eventos de ambiente (solo corre si el tiempo corre)
  tick(dt, running) {
    if (!running || !this.ready) return;
    const T = this.timers;
    if ((T.drip -= dt) <= 0) { this.drip(); T.drip = 1.2 + Math.random() * 4.5; }
    if ((T.creak -= dt) <= 0) { this.creak(); T.creak = 7 + Math.random() * 12; }
    if ((T.train -= dt) <= 0) { this.train(); T.train = 55 + Math.random() * 45; }
  }

  drip() {
    const ctx = this.ctx, now = ctx.currentTime;
    const base = LEAKS[Math.floor(Math.random() * LEAKS.length)];
    const pos = [base[0] + (Math.random() - 0.5) * 1.5, 0.05, base[2] + (Math.random() - 0.5) * 1.5];
    const v = this.voice(pos, 0.9, { ref: 1.5, roll: 1 });
    const o = ctx.createOscillator(); o.type = 'sine';
    const f0 = 1300 + Math.random() * 1100;
    o.frequency.setValueAtTime(f0, now); o.frequency.exponentialRampToValueAtTime(f0 * 0.42, now + 0.06);
    const g = this.g(0);
    g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.09, now + 0.002); g.gain.exponentialRampToValueAtTime(0.0004, now + 0.11);
    o.connect(g).connect(v.input);
    o.start(now); o.stop(now + 0.14);
    o.onended = () => { g.disconnect(); v.dispose(); };
  }

  creak() {
    const ctx = this.ctx, now = ctx.currentTime;
    const pos = PIPES[Math.floor(Math.random() * PIPES.length)];
    const v = this.voice(pos, 0.7, { ref: 2, roll: 0.9 });
    const n = ctx.createBufferSource(); n.buffer = this.white;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800 + Math.random() * 1600; bp.Q.value = 9;
    const g = this.g(0);
    const ticks = 1 + Math.floor(Math.random() * 3);
    for (let k = 0; k < ticks; k++) {
      const t = now + k * (0.06 + Math.random() * 0.08);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.04);
    }
    n.connect(bp).connect(g).connect(v.input);
    n.start(now, Math.random() * 0.5, 0.5);
    n.onended = () => { g.disconnect(); v.dispose(); };
  }

  // el metro de Nueva York pasando al otro lado del muro
  train() {
    const ctx = this.ctx, now = ctx.currentTime, dur = 9;
    const side = Math.random() < 0.5 ? -1 : 1;
    const pos = [side * 24, 2, (Math.random() - 0.5) * 20];
    const v = this.voice(pos, 0.6, { ref: 9, roll: 0.5 });
    const env = this.g(0);
    env.gain.setValueAtTime(0, now);
    env.gain.linearRampToValueAtTime(1, now + 3.2);
    env.gain.setValueAtTime(1, now + 5.2);
    env.gain.linearRampToValueAtTime(0, now + dur);
    env.connect(v.input);
    // retumbo grave
    const r = ctx.createBufferSource(); r.buffer = this.noise; r.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 130; lp.Q.value = 0.8;
    const rg = this.g(0.55);
    r.connect(lp).connect(rg).connect(env);
    // traqueteo de las ruedas en los rieles
    const c = ctx.createBufferSource(); c.buffer = this.white; c.loop = true;
    const cbp = ctx.createBiquadFilter(); cbp.type = 'bandpass'; cbp.frequency.value = 420; cbp.Q.value = 1.4;
    const cg = this.g(0);
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 3.4;
    const lfoAmt = this.g(0.035); lfo.connect(lfoAmt).connect(cg.gain);
    cg.gain.value = 0.035;
    c.connect(cbp).connect(cg).connect(env);
    for (const s of [r, c, lfo]) { s.start(now); s.stop(now + dur + 0.1); }
    r.onended = () => { env.disconnect(); v.dispose(); };
    if (this.onTrain) this.onTrain(dur);
  }

  // paso en modo cabina: piedra o goma de la plataforma
  footstep(onRubber) {
    const ctx = this.ctx, now = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = this.white;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = onRubber ? 520 : 1500 + Math.random() * 500;
    const g = this.g(0);
    const len = onRubber ? 0.07 : 0.05;
    g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(onRubber ? 0.16 : 0.2, now + 0.004); g.gain.exponentialRampToValueAtTime(0.0005, now + len);
    const thump = ctx.createOscillator(); thump.type = 'sine';
    thump.frequency.setValueAtTime(onRubber ? 70 : 110, now); thump.frequency.exponentialRampToValueAtTime(50, now + 0.08);
    const tg = this.g(0);
    tg.gain.setValueAtTime(0, now); tg.gain.linearRampToValueAtTime(onRubber ? 0.22 : 0.14, now + 0.004); tg.gain.exponentialRampToValueAtTime(0.0005, now + 0.1);
    const out = this.g(1);
    out.connect(this.dry);
    const s = this.g(onRubber ? 0.12 : 0.4); out.connect(s).connect(this.verbIn);
    n.connect(lp).connect(g).connect(out);
    thump.connect(tg).connect(out);
    n.start(now, Math.random() * 0.8, len + 0.02);
    thump.start(now); thump.stop(now + 0.12);
    thump.onended = () => { g.disconnect(); tg.disconnect(); out.disconnect(); s.disconnect(); };
  }
}
