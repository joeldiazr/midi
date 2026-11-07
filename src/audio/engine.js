// Motor de audio: reproduce la vista previa como AudioBuffer (pausa exacta), timbre de bobina y zumbido.
import { buildCoilChain } from './coilvoice.js';

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
      // timbre de bobina: voz limpia, instrumental tocado por pulsos de chispa (ver coilvoice.js)
      this.coil = buildCoilChain(ctx, this.songIn, this.master);
      if (this.coilMode) this.coil.set(true);
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

  play(from = this.offset) {
    if (!this.buffer) return;
    this.ensure();
    this.stopSource();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer; src.connect(this.songIn);
    src.onended = () => {
      if (this.src === src && this.playing) { this.playing = false; this.offset = 0; this.src = null; this.onEnded && this.onEnded(); }
    };
    from = Math.max(0, Math.min(from, this.buffer.duration - 0.01));
    this.startedAt = this.ctx.currentTime - from;
    src.start(0, from);
    this.src = src; this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.time; this.playing = false; this.stopSource();
  }

  stopSource() {
    if (this.src) {
      this.src.onended = null;
      try { this.src.stop(); } catch (e) { /* ya detenida */ }
      this.src.disconnect(); this.src = null;
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
    this.coilMode = on;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.dry.gain.setTargetAtTime(on ? 0 : 1, now, 0.08);
    this.coil.set(on, now, 0.08);
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
