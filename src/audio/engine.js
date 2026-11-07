// Motor de audio: reproduce la vista previa como AudioBuffer (pausa exacta), timbre de bobina y zumbido.
import { buildMixChain, softClipper } from './mixer.js';
import { Space } from './space.js';

const MUSIC_ROOM = 0.16; // cuánto de la música rebota en la sala (sutil: la mezcla ya trae su propio espacio)

const FADE_IN = 0.9;      // al empezar la canción
const RESUME_FADE = 0.25; // al reanudar o saltar
const FADE_OUT = 1.8;     // al final de la vista previa
export const HUM_IDLE = 0.12; // zumbido de fondo cuando no hay música (antes 0.25 con diente de sierra)

export class AudioEngine {
  constructor() {
    this.ctx = null; this.buffer = null; this.src = null;
    this.offset = 0; this.startedAt = 0; this.playing = false;
    this.muted = false; this.coilMode = false; this.voices = true; this.onEnded = null;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = (this.ctx = new AC());
      // techo final: recortador suave (un compresor subiría el volumen por su cuenta y saturaría)
      const clip = softClipper(ctx);
      clip.output.connect(ctx.destination);
      this.master = ctx.createGain(); this.master.connect(clip.input);
      // sonido espacial del sótano: sala de piedra, oído en la cámara, ambiente (ver space.js)
      this.space = new Space(ctx, this.master);
      this.songIn = ctx.createGain();
      this.musicBus = ctx.createGain(); this.musicBus.connect(this.master);
      this.space.sendFrom(this.musicBus, MUSIC_ROOM);
      // mezcla centro/lados: quitar voz y timbre de bobina (ver mixer.js)
      this.mix = buildMixChain(ctx, this.songIn, this.musicBus);
      this.mix.setCoil(this.coilMode, ctx.currentTime, 0.001);
      this.mix.setVoices(this.voices, ctx.currentTime, 0.001);
      this.lastZap = [0, 0, 0, 0];
      // ruido para chasquidos
      const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = nb.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (Math.random() < 0.2 ? 1 : 0.3);
      this.noise = nb;
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
    this.mix.setCoil(!!on, now, 0.08);
  }

  setVoices(on) {
    this.voices = !!on;
    if (this.ctx) this.mix.setVoices(this.voices, this.ctx.currentTime, 0.08);
  }

  // 0..1; solo reprograma si cambia de verdad
  setHum(v) { if (this.ctx) this.space.setHum(v); }

  // toque de un rayo: la bobina "canta" la nota que suena en la canción en ese instante
  // (onda cuadrada zumbante con filtro que se cierra, como una bobina musical), más una chispa mínima.
  // s: fuerza 0..1 · pos: [x, y, z] donde cae el rayo (suena ahí, en 3D) · freq: Hz de la nota (o null)
  zap(coil, s, pos, freq = null) {
    if (!this.ctx || !this.coilMode || this.muted || !this.playing) return;
    const ctx = this.ctx, now = ctx.currentTime;
    if (now - this.lastZap[coil] < (coil === 3 ? 0.11 : 0.07)) return;
    if ((this.voicesOn || 0) >= 14) return; // tope de polifonía
    this.lastZap[coil] = now;
    const amp = Math.min(1, 0.35 + s * 0.65);
    const v = this.space.voice(pos, 0.38, { ref: 3, roll: 1 });
    const out = ctx.createGain(); out.gain.value = 0.5;
    out.connect(v.input);
    let ends = 0;
    const done = () => { if (--ends <= 0) { out.disconnect(); v.dispose(); this.voicesOn--; } };
    this.voicesOn = (this.voicesOn || 0) + 1;

    // chispa: apenas un tic de ataque
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
    const gn = ctx.createGain();
    const tick = 0.018 + s * 0.02;
    gn.gain.setValueAtTime(0, now); gn.gain.linearRampToValueAtTime(amp * (freq ? 0.05 : 0.12), now + 0.002); gn.gain.exponentialRampToValueAtTime(0.0005, now + tick);
    n.connect(hp).connect(gn).connect(out);
    n.start(now, Math.random() * 0.8, tick + 0.02);
    ends++; n.onended = done;
    if (!freq) return;

    // la nota
    const LVL = [0.22, 0.16, 0.11, 0.075];
    const dur = 0.16 + s * 0.26 + (coil === 0 ? 0.12 : 0);
    const o1 = ctx.createOscillator(); o1.type = 'square'; o1.frequency.value = freq;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = freq * 1.004;
    const mix2 = ctx.createGain(); mix2.gain.value = 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2.2;
    lp.frequency.setValueAtTime(Math.min(9000, freq * 14), now);
    lp.frequency.exponentialRampToValueAtTime(Math.max(380, freq * 2.6), now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(amp * LVL[coil], now + 0.004);
    g.gain.exponentialRampToValueAtTime(amp * LVL[coil] * 0.45, now + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0005, now + dur);
    o1.connect(lp); o2.connect(mix2).connect(lp); lp.connect(g).connect(out);
    o1.start(now); o2.start(now);
    o1.stop(now + dur + 0.03); o2.stop(now + dur + 0.03);
    ends++; o1.onended = done;
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
  }
}
