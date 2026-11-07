// Mezcla de la canción separada en centro y lados.
//
//   centro (L+R)/2 → donde suele ir la voz, el bajo y el bombo
//   lados  (L−R)/2 → lo abierto: guitaras, sintes, coros, reverb
//
// Con todo en limpio la reconstrucción es exacta (L = centro + lados, R = centro − lados).
//
// · Quitar voz: el centro conserva solo graves (< 170 Hz) y brillos (> 7 kHz), así se va la voz
//   pero quedan bajo, bombo y platillos. Es una separación aproximada, no IA: lo que también
//   está centrado en la banda de la voz (caja, a veces un piano o guitarra) se va con ella.
// · Timbre de bobina: los lados pasan por un amplificador simulado (ecualización, saturación
//   suave con sobremuestreo y un filtro de caja que recorta la aspereza) y suben de nivel.

export const SIDE_BOOST = 1.15;
export const MID_DUCK = 0.9; // el centro baja un poco para que el volumen total no suba

// Recortador suave: idéntico a la entrada por debajo de 0,75 y curva redonda hasta 0,97 (nunca recorta duro).
export function softClipper(ctx) {
  const pre = ctx.createGain(); pre.gain.value = 0.5; // el WaveShaper trabaja en [−1, 1]: damos margen hasta ±2
  const ws = ctx.createWaveShaper();
  const n = 8192, curve = new Float32Array(n), t = 0.75, top = 0.97;
  for (let i = 0; i < n; i++) {
    const u = ((i / (n - 1)) * 2 - 1) * 2, a = Math.abs(u);
    curve[i] = Math.sign(u) * (a < t ? a : t + (top - t) * Math.tanh((a - t) / (top - t)));
  }
  ws.curve = curve; ws.oversample = 'none'; // el sobremuestreo agrega sobrepicos por encima de 1
  pre.connect(ws);
  return { input: pre, output: ws };
}

export function buildMixChain(ctx, input, output) {
  const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
  const filt = (type, f, q = 0.707, gain = 0) => {
    const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; n.gain.value = gain; return n;
  };

  // sin compresor aquí: DynamicsCompressor sube el volumen por su cuenta y eso saturaba.
  // El techo de picos lo pone el recortador suave del motor (softClipper).
  const lim = g(1);
  lim.connect(output);

  // entrada estéreo forzada (si la canción es mono, L = R)
  const st = g(1); st.channelCount = 2; st.channelCountMode = 'explicit'; st.channelInterpretation = 'speakers';
  input.connect(st);
  const split = ctx.createChannelSplitter(2);
  st.connect(split);
  const gL = g(0.5), gR = g(0.5), gRn = g(-0.5);
  split.connect(gL, 0); split.connect(gR, 1); split.connect(gRn, 1);
  const mid = g(1), side = g(1);
  gL.connect(mid); gR.connect(mid); gL.connect(side); gRn.connect(side);

  const midBus = g(1), sideBus = g(1);

  // centro completo, o centro sin la banda de la voz
  const midFull = g(1);
  mid.connect(midFull).connect(midBus);
  const midLow = g(0), midHigh = g(0);
  mid.connect(filt('lowpass', 170)).connect(filt('lowpass', 170)).connect(midLow).connect(midBus);
  mid.connect(filt('highpass', 7000)).connect(filt('highpass', 7000)).connect(midHigh).connect(midBus);

  // lados limpios, o por el amplificador
  const sideClean = g(1);
  side.connect(sideClean).connect(sideBus);
  const amp = buildCoilAmp(ctx, g, filt);
  const sideFx = g(0);
  side.connect(amp.in); amp.out.connect(sideFx).connect(sideBus);

  // reconstrucción estéreo
  const merge = ctx.createChannelMerger(2);
  const toL = g(1), toR = g(1), sideL = g(1), sideR = g(-1);
  midBus.connect(toL).connect(merge, 0, 0);
  midBus.connect(toR).connect(merge, 0, 1);
  sideBus.connect(sideL).connect(merge, 0, 0);
  sideBus.connect(sideR).connect(merge, 0, 1);
  merge.connect(lim);

  const state = { voices: true, coil: false };
  const apply = (when = ctx.currentTime, tc = 0.08) => {
    midFull.gain.setTargetAtTime(state.voices ? 1 : 0, when, tc);
    midLow.gain.setTargetAtTime(state.voices ? 0 : 1, when, tc);
    midHigh.gain.setTargetAtTime(state.voices ? 0 : 1, when, tc);
    sideClean.gain.setTargetAtTime(state.coil ? 0.1 : 1, when, tc);
    sideFx.gain.setTargetAtTime(state.coil ? 1 : 0, when, tc);
    // con el timbre activo los lados suben para que el efecto se note
    sideBus.gain.setTargetAtTime(state.coil ? SIDE_BOOST : 1, when, tc);
    midBus.gain.setTargetAtTime(state.coil ? MID_DUCK : 1, when, tc);
  };
  return {
    state, amp,
    setVoices(on, when, tc) { state.voices = !!on; apply(when, tc); },
    setCoil(on, when, tc) { state.coil = !!on; apply(when, tc); },
  };
}

// Amplificador: pre-ecualizador → saturación suave asimétrica → filtro de caja de altavoz.
function buildCoilAmp(ctx, g, filt) {
  const inp = g(1);
  const pre = [filt('highpass', 110), filt('peaking', 800, 0.7, 5), filt('lowpass', 6500)];
  const drive = g(8);
  const shaper = ctx.createWaveShaper();
  const n = 4096, curve = new Float32Array(n), bias = 0.12, k = 2.6;
  const off = Math.tanh(bias * k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = (Math.tanh((x + bias) * k) - off) / (1 + off);
  }
  shaper.curve = curve; shaper.oversample = '4x';
  // gabinete: sin graves sueltos ni agudos ásperos, con cuerpo en medios
  const cab = [
    filt('highpass', 85), filt('highpass', 85),
    filt('peaking', 120, 1, 2), filt('peaking', 450, 1.2, -2), filt('peaking', 1700, 1, 3),
    filt('lowpass', 3600, 0.75), filt('lowpass', 3600, 0.75), filt('peaking', 2800, 2, -2),
  ];
  const makeup = g(0.2);
  let node = inp;
  for (const f of pre) node = node.connect(f);
  node = node.connect(drive).connect(shaper);
  for (const f of cab) node = node.connect(f);
  node.connect(makeup);
  return { in: inp, out: makeup, drive, makeup };
}
