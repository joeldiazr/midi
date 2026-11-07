// Timbre de bobina: una parte de la mezcla la "tocan" las bobinas y el resto suena limpio.
//
// Una bobina musical real dispara un pulso de chispa por cada ciclo de la nota (el "interruptor").
// El AudioWorklet hace eso: detecta cada ciclo de la señal y emite un pulso corto con la amplitud
// de su envolvente. Suena a zumbido eléctrico con la misma altura que el instrumento.
//
// Variantes:
//   'bass'  → solo los graves (< 180 Hz) se vuelven eléctricos; todo lo demás queda limpio y en estéreo.
//   'sides' → el centro de la mezcla (voz, bombo, bajo) queda limpio; lo abierto a los lados se electrifica.

const WORKLET = `
class TeslaCoil extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    const sr = sampleRate;
    this.lowOnly = !!o.lowOnly;
    this.hiss = o.hiss ?? 0.12;
    this.k1 = 1 - Math.exp(-2 * Math.PI * 240 / sr);
    this.k2 = 1 - Math.exp(-2 * Math.PI * 2000 / sr);
    this.lp1 = 0; this.lp2 = 0;
    // ancho de pulso, separación mínima entre pulsos (frecuencia máxima) y ganancia por banda
    this.bands = [
      { w: (o.lowWidth ?? 0.0011) * sr, gap: sr / 780, g: 1.0 },
      { w: 0.00045 * sr, gap: sr / 2100, g: 0.7 },
      { w: 0.0002 * sr, gap: sr / 4200, g: 0.42 },
    ].map((b) => Object.assign(b, { env: 0, state: 0, pulse: 0, amp: 0, since: 1e9 }));
    this.att = 1 - Math.exp(-1 / (0.0015 * sr));
    this.rel = 1 - Math.exp(-1 / (0.07 * sr));
    this.seed = 12345;
  }
  rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }
  process(inputs, outputs) {
    const out = outputs[0][0];
    const inp = inputs[0] && inputs[0][0];
    if (!out) return true;
    if (!inp) { out.fill(0); return true; }
    const nb = this.lowOnly ? 1 : 3;
    for (let i = 0; i < out.length; i++) {
      const x = inp[i];
      let v0 = x, v1 = 0, v2 = 0;
      if (!this.lowOnly) {
        this.lp1 += (x - this.lp1) * this.k1;
        this.lp2 += (x - this.lp2) * this.k2;
        v0 = this.lp1; v1 = this.lp2 - this.lp1; v2 = x - this.lp2;
      }
      let y = 0;
      for (let b = 0; b < nb; b++) {
        const B = this.bands[b];
        const v = b === 0 ? v0 : b === 1 ? v1 : v2;
        const a = v < 0 ? -v : v;
        B.env += (a - B.env) * (a > B.env ? this.att : this.rel);
        const thr = B.env * 0.3 + 0.0004;
        B.since++;
        if (B.state === 0 && v > thr) {
          B.state = 1;
          if (B.since > B.gap) { B.pulse = B.w; B.amp = Math.min(1, B.env * 3.2); B.since = 0; }
        } else if (B.state === 1 && v < -thr) B.state = 0;
        if (B.pulse > 0) {
          const k = B.pulse / B.w;
          y += B.amp * B.g * (0.55 + 0.45 * k) * (0.85 + 0.3 * this.rnd());
          B.pulse--;
        }
        if (this.hiss) y += (this.rnd() - 0.5) * B.env * this.hiss * B.g;
      }
      out[i] = y;
    }
    return true;
  }
}
registerProcessor('tesla-coil', TeslaCoil);
`;

const loaded = new WeakMap();
function loadWorklet(ctx) {
  if (!ctx.audioWorklet) return Promise.reject(new Error('sin AudioWorklet'));
  if (!loaded.has(ctx)) {
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    loaded.set(ctx, ctx.audioWorklet.addModule(url));
  }
  return loaded.get(ctx);
}

export const COIL_VARIANTS = {
  bass: { clean: 1.0, dryPart: 0.35, tesla: 0.5, lowpass: 2600 },
  sides: { clean: 1.0, dryPart: 0.25, tesla: 0.45, lowpass: 6000 },
};

export function buildCoilChain(ctx, input, output, { variant = 'bass' } = {}) {
  const cfg = COIL_VARIANTS[variant];
  const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
  const filt = (type, f, q = 0.707) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
  // limitador suave: los pulsos tienen picos altos aunque el volumen medio sea el mismo
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -4; lim.knee.value = 3; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.1;
  const trim = g(0.94);
  lim.connect(trim).connect(output);

  // entrada estéreo forzada (si la canción es mono, L = R)
  const st = g(1); st.channelCount = 2; st.channelCountMode = 'explicit'; st.channelInterpretation = 'speakers';
  input.connect(st);

  const clean = g(0), dryPart = g(0), tesla = g(0);
  clean.connect(lim); dryPart.connect(lim);
  const drive = g(2.2);
  const post = filt('highpass', 45);
  const tame = filt('lowpass', cfg.lowpass);
  post.connect(tame);

  if (variant === 'bass') {
    // limpio: todo lo que está por encima de 180 Hz, en estéreo (cruce de 4.º orden)
    st.connect(filt('highpass', 180)).connect(filt('highpass', 180)).connect(clean);
    // graves en mono hacia la bobina
    const mono = g(1); mono.channelCount = 1; mono.channelCountMode = 'explicit'; mono.channelInterpretation = 'speakers';
    st.connect(mono);
    const bass = filt('lowpass', 180);
    mono.connect(bass).connect(filt('lowpass', 180)).connect(drive);
    drive.connect(dryPart);
    dryPart.gain.value = 0;
    tame.connect(tesla).connect(lim);
  } else {
    // centro limpio, lados eléctricos (los pulsos se devuelven a los lados: L = +p, R = −p)
    const split = ctx.createChannelSplitter(2);
    st.connect(split);
    const gL = g(0.5), gR = g(0.5), gRn = g(-0.5);
    split.connect(gL, 0); split.connect(gR, 1); split.connect(gRn, 1);
    const mid = g(1), side = g(1);
    gL.connect(mid); gR.connect(mid); gL.connect(side); gRn.connect(side);
    mid.connect(clean);
    side.connect(drive);
    const merge = ctx.createChannelMerger(2);
    const pos = g(1), neg = g(-1);
    // lados originales (un poco) y pulsos, ambos como señal lateral
    const sideMix = g(1);
    drive.connect(dryPart); dryPart.connect(sideMix); dryPart.disconnect(lim);
    tame.connect(tesla).connect(sideMix);
    sideMix.connect(pos).connect(merge, 0, 0);
    sideMix.connect(neg).connect(merge, 0, 1);
    merge.connect(lim);
  }

  let on = false;
  const levels = { clean: cfg.clean, dryPart: cfg.dryPart / 2.2, tesla: cfg.tesla };

  const ready = loadWorklet(ctx).then(() => {
    const node = new AudioWorkletNode(ctx, 'tesla-coil', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      processorOptions: variant === 'bass' ? { lowOnly: true, hiss: 0, lowWidth: 0.0014 } : { hiss: 0.04 },
    });
    drive.connect(node).connect(post);
    return 'worklet';
  }).catch(() => {
    // respaldo sin AudioWorklet: saturación suave de la misma parte
    const sh = ctx.createWaveShaper();
    const n = 2048, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(x * 4); }
    sh.curve = curve; sh.oversample = '2x';
    drive.connect(sh).connect(post);
    return 'shaper';
  });

  return {
    ready, levels, variant,
    set(enabled, when = ctx.currentTime, tc = 0.08) {
      on = enabled;
      clean.gain.setTargetAtTime(on ? levels.clean : 0, when, tc);
      dryPart.gain.setTargetAtTime(on ? levels.dryPart : 0, when, tc);
      tesla.gain.setTargetAtTime(on ? levels.tesla : 0, when, tc);
    },
    get on() { return on; },
  };
}
