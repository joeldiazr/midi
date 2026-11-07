// Motor de audio: reproduce la vista previa como AudioBuffer (pausa exacta), timbre de bobina y zumbido.
import { buildCoilChain } from './coilvoice.js';

const FADE_IN = 0.9;      // al empezar la canción
const RESUME_FADE = 0.25; // al reanudar o saltar
const FADE_OUT = 1.8;     // al final de la vista previa

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
      this.master = ctx.createGain(); this.master.connect(ctx.destination);
      this.songIn = ctx.createGain();
      this.dry = ctx.createGain(); this.dry.gain.value = 1;
      this.songIn.connect(this.dry).connect(this.master);
      // timbre de bobina: dos variantes (ver coilvoice.js); solo suena la elegida
      this.coils = { bass: buildCoilChain(ctx, this.songIn, this.master, { variant: 'bass' }), sides: buildCoilChain(ctx, this.songIn, this.master, { variant: 'sides' }) };
      this.coil = this.coils.bass;
      if (this.coilMode) this.setCoilMode(this.coilMode);
      // zumbido del transformador
      this.hum = ctx.createGain(); this.hum.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260;
      const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 60;
      const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 120;
      const g2 = ctx.createGain(); g2.gain.value = 0.6;
      o1.connect(lp); o2.connect(g2).connect(lp); lp.connect(this.hum).connect(this.master);
      o1.start(); o2.start();
      // ruido para chasquidos
      const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = nb.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (Math.random() < 0.2 ? 1 : 0.3);
      this.noise = nb;
      this.sfx = ctx.createGain(); this.sfx.gain.value = 0.5; this.sfx.connect(this.master);
      this.setHum(0.25);
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

  // variant: false (limpio) | 'bass' | 'sides'
  setCoilMode(variant) {
    this.coilMode = variant || false;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.dry.gain.setTargetAtTime(variant ? 0 : 1, now, 0.08);
    for (const k in this.coils) this.coils[k].set(k === variant, now, 0.08);
    if (variant) this.coil = this.coils[variant];
  }

  setHum(v) { if (this.ctx) this.hum.gain.setTargetAtTime(v * 0.05, this.ctx.currentTime, 0.1); }

  crackle(s) {
    if (!this.ctx || !this.coilMode || this.muted) return;
    const ctx = this.ctx, now = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800 + Math.random() * 1500;
    const g = ctx.createGain();
    const dur = 0.03 + s * 0.07;
    g.gain.setValueAtTime(0, now); g.gain.linearRampToValueAtTime(0.18 * s, now + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(hp).connect(g).connect(this.sfx);
    src.start(now, Math.random() * 0.8, dur + 0.02);
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }
}
