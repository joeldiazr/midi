// Timbre de bobina: la voz queda limpia y el instrumental lo "tocan" las bobinas.
//
// 1) Separación aproximada (sin IA): la voz suele ir al centro de la mezcla y en la banda 170 Hz–7 kHz.
//    voz       = centro (L+R)/2 filtrado a esa banda          → limpio
//    instrumental = lados (L−R)/2 + graves y agudos del centro  → a las bobinas
// 2) Una bobina musical real dispara un pulso de chispa por cada ciclo de la nota (el "interruptor").
//    El AudioWorklet hace eso: divide el instrumental en tres bandas, detecta cada ciclo y emite
//    un pulso corto con ruido de chispa, con la amplitud de la envolvente. Suena a zumbido eléctrico
//    con la misma altura que el instrumento.

const WORKLET = `
class TeslaCoil extends AudioWorkletProcessor {
  constructor() {
    super();
    const sr = sampleRate;
    this.k1 = 1 - Math.exp(-2 * Math.PI * 240 / sr);
    this.k2 = 1 - Math.exp(-2 * Math.PI * 2000 / sr);
    this.lp1 = 0; this.lp2 = 0;
    // ancho de pulso, separación mínima entre pulsos (frecuencia máxima) y ganancia por banda
    this.bands = [
      { w: 0.0011 * sr, gap: sr / 780, g: 1.0 },
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
    for (let i = 0; i < out.length; i++) {
      const x = inp[i];
      this.lp1 += (x - this.lp1) * this.k1;
      this.lp2 += (x - this.lp2) * this.k2;
      const v0 = this.lp1, v1 = this.lp2 - this.lp1, v2 = x - this.lp2;
      let y = 0;
      for (let b = 0; b < 3; b++) {
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
          y += B.amp * B.g * (0.55 + 0.45 * k) * (0.7 + 0.6 * this.rnd());
          B.pulse--;
        }
        // siseo de aire ionizado mientras la banda suena
        y += (this.rnd() - 0.5) * B.env * 0.12 * B.g;
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

export function buildCoilChain(ctx, input, output) {
  const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
  const filt = (type, f, q = 0.707) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
  // limitador: los pulsos tienen picos altos aunque el volumen medio sea el mismo
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -9; lim.knee.value = 6; lim.ratio.value = 14; lim.attack.value = 0.002; lim.release.value = 0.12;
  lim.connect(output);
  output = lim;

  // entrada estéreo forzada (si la canción es mono, L = R)
  const st = g(1); st.channelCount = 2; st.channelCountMode = 'explicit'; st.channelInterpretation = 'speakers';
  input.connect(st);
  const split = ctx.createChannelSplitter(2);
  st.connect(split);
  const gL = g(0.5), gR = g(0.5), gRn = g(-0.5);
  split.connect(gL, 0); split.connect(gR, 1); split.connect(gRn, 1);
  const mid = g(1), side = g(1);
  gL.connect(mid); gR.connect(mid);
  gL.connect(side); gRn.connect(side);

  // voz limpia: centro en banda vocal
  const vHP1 = filt('highpass', 170), vHP2 = filt('highpass', 170), vLP = filt('lowpass', 7000);
  const vocal = g(0);
  mid.connect(vHP1).connect(vHP2).connect(vLP).connect(vocal).connect(output);

  // instrumental: lados + graves y agudos del centro
  const inst = g(1);
  side.connect(inst);
  const mLP1 = filt('lowpass', 170), mLP2 = filt('lowpass', 170), mHP = filt('highpass', 7000);
  mid.connect(mLP1).connect(mLP2).connect(inst);
  mid.connect(mHP).connect(inst);
  const instDry = g(0);
  inst.connect(instDry).connect(output);

  // bobina: pulsos al ritmo de cada ciclo del instrumental
  const tesla = g(0);
  const post = filt('highpass', 55);
  const tame = filt('lowpass', 9500);
  post.connect(tame).connect(tesla).connect(output);
  const drive = g(2.2);
  inst.connect(drive);
  let on = false;
  const levels = { vocal: 1.0, instDry: 0.16, tesla: 0.42 };

  const ready = loadWorklet(ctx).then(() => {
    const node = new AudioWorkletNode(ctx, 'tesla-coil', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    drive.connect(node).connect(post);
    return 'worklet';
  }).catch(() => {
    // respaldo: saturación dura del instrumental
    const sh = ctx.createWaveShaper();
    const n = 2048, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.sign(x) * Math.pow(Math.abs(x), 0.2); }
    sh.curve = curve; sh.oversample = '2x';
    drive.connect(sh).connect(post);
    return 'shaper';
  });

  return {
    ready, levels,
    set(enabled, when = ctx.currentTime, tc = 0.08) {
      on = enabled;
      vocal.gain.setTargetAtTime(on ? levels.vocal : 0, when, tc);
      instDry.gain.setTargetAtTime(on ? levels.instDry : 0, when, tc);
      tesla.gain.setTargetAtTime(on ? levels.tesla : 0, when, tc);
    },
    get on() { return on; },
  };
}
