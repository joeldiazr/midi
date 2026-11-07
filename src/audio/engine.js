// Motor de audio: reproduce la vista previa como AudioBuffer (pausa exacta), timbre de bobina y zumbido.
import { buildCoilChain } from './coilvoice.js';

const FADE_IN = 0.9;      // al empezar la canción
const RESUME_FADE = 0.25; // al reanudar o saltar
const FADE_OUT = 1.8;     // al final de la vista previa
export const HUM_IDLE = 0.12; // zumbido de fondo cuando no hay música (antes 0.25 con diente de sierra)

export class AudioEngine {
  constructor() {
    this.ctx = null; this.buffer = null; this.src = null;
    this.offset = 0; this.startedAt = 0; this.playing = false;
    this.muted = false; this.coilMode = false; this.onEnded = null;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = (this.ctx = new AC());
      // limitador final: la música más los chispazos nunca recortan
      const out = ctx.createDynamicsCompressor();
      out.threshold.value = -2; out.knee.value = 2; out.ratio.value = 20; out.attack.value = 0.001; out.release.value = 0.1;
      out.connect(ctx.destination);
      this.master = ctx.createGain(); this.master.connect(out);
      this.songIn = ctx.createGain();
      this.dry = ctx.createGain(); this.dry.gain.value = 1;
      this.songIn.connect(this.dry).connect(this.master);
      // timbre de bobina: centro limpio, lados eléctricos (ver coilvoice.js)
      this.coil = buildCoilChain(ctx, this.songIn, this.master, { variant: 'sides' });
      if (this.coilMode) this.setCoilMode(true);
      // zumbido del transformador: senos suaves (antes era un diente de sierra que sonaba a estática)
      this.hum = ctx.createGain(); this.hum.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 200;
      for (const [f, a] of [[60, 1], [120, 0.45], [180, 0.12]]) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const ga = ctx.createGain(); ga.gain.value = a;
        o.connect(ga).connect(lp); o.start();
      }
      lp.connect(this.hum).connect(this.master);
      this.lastZap = [0, 0, 0, 0];
      // ruido para chasquidos
      const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = nb.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (Math.random() < 0.2 ? 1 : 0.3);
      this.noise = nb;
      this.sfx = ctx.createGain(); this.sfx.gain.value = 0.5; this.sfx.connect(this.master);
      this.setHum(HUM_IDLE);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  async fetchBuffer(url, onProgress = () => {}) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const total = +res.headers.get('content-length') || 0;
    let ab;
    if (res.body && total) {
      const reader = res.body.getReader();
      const chunks = []; let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); got += value.length; onProgress(got / total);
      }
      const all = new Uint8Array(got); let o = 0;
      for (const c of chunks) { all.set(c, o); o += c.length; }
      ab = all.buffer;
    } else ab = await res.arrayBuffer();
    onProgress(1);
    return this.decode(ab);
  }

  decode(ab) {
    this.ensure();
    return new Promise((resolve, reject) => this.ctx.decodeAudioData(ab, resolve, reject));
  }

  setBuffer(b) { this.stopSource(); this.buffer = b; this.offset = 0; this.playing = false; }

  // fadeIn: segundos de entrada (más largo al empezar la canción que al reanudar)
  play(from = this.offset, fadeIn = from < 0.05 ? FADE_IN : RESUME_FADE) {
    if (!this.buffer) return;
    this.ensure();
    this.stopSource();
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    const fade = ctx.createGain();
    src.buffer = this.buffer; src.connect(fade).connect(this.songIn);
    src.onended = () => {
      if (this.src === src && this.playing) { this.playing = false; this.offset = 0; this.src = null; this.fade = null; fade.disconnect(); this.onEnded && this.onEnded(); }
    };
    from = Math.max(0, Math.min(from, this.buffer.duration - 0.01));
    const now = ctx.currentTime, remain = this.buffer.duration - from;
    // envolvente: entrada suave y salida suave al final de la vista previa
    const g = fade.gain;
    const fi = Math.min(fadeIn, remain / 2);
    const fo = Math.min(FADE_OUT, remain);
    const outStart = now + remain - fo;
    g.setValueAtTime(0, now);
    if (outStart >= now + fi) {
      g.linearRampToValueAtTime(1, now + fi);
      g.setValueAtTime(1, outStart);
    } else {
      g.linearRampToValueAtTime(Math.max(0, (remain - fi) / FADE_OUT), now + fi);
    }
    g.linearRampToValueAtTime(0, now + remain);
    this.startedAt = now - from;
    src.start(now, from);
    this.src = src; this.fade = fade; this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.time; this.playing = false; this.stopSource();
  }

  // corte con un micro-fundido para que no chasquee
  stopSource() {
    if (this.src) {
      const src = this.src, fade = this.fade;
      src.onended = null;
      const now = this.ctx.currentTime;
      if (fade) {
        fade.gain.cancelScheduledValues(now);
        fade.gain.setValueAtTime(fade.gain.value, now);
        fade.gain.linearRampToValueAtTime(0, now + 0.06);
      }
      try { src.stop(now + 0.07); } catch (e) { /* ya detenida */ }
      setTimeout(() => { src.disconnect(); fade && fade.disconnect(); }, 200);
      this.src = null; this.fade = null;
    }
  }

  get time() {
    if (!this.buffer) return 0;
    if (this.playing) return Math.min(this.ctx.currentTime - this.startedAt, this.buffer.duration);
    return this.offset;
  }
  get duration() { return this.buffer ? this.buffer.duration : 0; }

  seek(t) {
    if (!this.buffer) return;
    t = Math.max(0, Math.min(t, this.buffer.duration - 0.05));
    if (this.playing) this.play(t); else this.offset = t;
  }

  setCoilMode(on) {
    this.coilMode = !!on;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.dry.gain.setTargetAtTime(on ? 0 : 1, now, 0.08);
    this.coil.set(!!on, now, 0.08);
  }

  // 0..1; solo reprograma si cambia de verdad
  setHum(v) {
    if (!this.ctx) return;
    const target = v * 0.03;
    if (Math.abs(target - (this.humTarget ?? -1)) < 0.0004) return;
    this.humTarget = target;
    this.hum.gain.setTargetAtTime(target, this.ctx.currentTime, 0.25);
  }

  // chispazo de un rayo: chasquido brillante + zumbido corto de la descarga, ubicado en estéreo
  // s: fuerza 0..1 · pan: −1 izq … 1 der · near: atenuación por distancia
  zap(coil, s, pan = 0, near = 1) {
    if (!this.ctx || !this.coilMode || this.muted || !this.playing) return;
    const ctx = this.ctx, now = ctx.currentTime;
    if (now - this.lastZap[coil] < 0.04) return;
    this.lastZap[coil] = now;
    const amp = Math.min(1, 0.3 + s * 0.7) * near;
    const out = ctx.createStereoPanner(); out.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(this.sfx);
    // chasquido
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400 + Math.random() * 800;
    const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 3800 + Math.random() * 1200; pk.gain.value = 5; pk.Q.value = 1.1;
    const gn = ctx.createGain();
    const dur = 0.035 + s * 0.09;
    gn.gain.setValueAtTime(0, now); gn.gain.linearRampToValueAtTime(amp * 0.42, now + 0.002); gn.gain.exponentialRampToValueAtTime(0.0005, now + dur);
    n.connect(hp).connect(pk).connect(gn).connect(out);
    n.start(now, Math.random() * 0.8, dur + 0.02);
    // zumbido de la descarga ("bzzt")
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 85 + coil * 22 + Math.random() * 20;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.8;
    const go = ctx.createGain();
    const bz = 0.05 + s * 0.12;
    go.gain.setValueAtTime(0, now); go.gain.linearRampToValueAtTime(amp * 0.16, now + 0.004); go.gain.exponentialRampToValueAtTime(0.0005, now + bz);
    o.connect(bp).connect(go).connect(out);
    o.start(now); o.stop(now + bz + 0.03);
    o.onended = () => out.disconnect();
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }
}
