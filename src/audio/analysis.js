// Análisis previo de la canción completa: bandas, golpes (onsets), pulso (BPM) y energía.
// Se calcula antes de tocar, así los rayos y los cortes de cámara caen exactos y se pueden anticipar.

function makeFFT(N) {
  const levels = Math.round(Math.log2(N));
  const rev = new Uint32Array(N);
  for (let i = 0; i < N; i++) {
    let r = 0, x = i;
    for (let b = 0; b < levels; b++) { r = (r << 1) | (x & 1); x >>= 1; }
    rev[i] = r;
  }
  const cos = new Float32Array(N / 2), sin = new Float32Array(N / 2);
  for (let i = 0; i < N / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / N); sin[i] = Math.sin((2 * Math.PI * i) / N); }
  return (re, im) => {
    for (let i = 0; i < N; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size;
      for (let i = 0; i < N; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cos[k] + im[l] * sin[k];
          const tim = -re[l] * sin[k] + im[l] * cos[k];
          re[l] = re[j] - tre; im[l] = im[j] - tim;
          re[j] += tre; im[j] += tim;
        }
      }
    }
  };
}

function percentile(arr, p) {
  const a = Float32Array.from(arr).sort();
  return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))];
}

export const BANDS = [
  { name: 'GRAVES', lo: 30, hi: 160 },
  { name: 'MEDIOS', lo: 160, hi: 800 },
  { name: 'VOCES', lo: 800, hi: 3500 },
  { name: 'BRILLO', lo: 3500, hi: 14000 },
];

export async function analyze(buffer, onProgress = () => {}) {
  const sr = buffer.sampleRate, N = 2048, hop = 512, B = 4;
  const len = buffer.length, ch = buffer.numberOfChannels;
  const mono = new Float32Array(len);
  for (let c = 0; c < ch; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += d[i] / ch;
  }
  const frames = Math.max(1, Math.floor((len - N) / hop) + 1);
  const fps = sr / hop;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const fft = makeFFT(N);
  const re = new Float32Array(N), im = new Float32Array(N);
  const mag = new Float32Array(N / 2), prev = new Float32Array(N / 2);
  const bins = BANDS.map((b) => [Math.max(1, Math.round((b.lo * N) / sr)), Math.min(N / 2 - 1, Math.round((b.hi * N) / sr))]);
  const band = new Float32Array(frames * B), flux = new Float32Array(frames * B), rms = new Float32Array(frames);

  for (let f = 0; f < frames; f++) {
    const off = f * hop;
    let s = 0;
    for (let i = 0; i < N; i++) {
      const v = mono[off + i] || 0;
      s += v * v; re[i] = v * win[i]; im[i] = 0;
    }
    rms[f] = Math.sqrt(s / N);
    fft(re, im);
    for (let k = 0; k < N / 2; k++) mag[k] = Math.log1p(60 * Math.hypot(re[k], im[k]));
    for (let b = 0; b < B; b++) {
      const [lo, hi] = bins[b];
      let e = 0, fl = 0;
      for (let k = lo; k <= hi; k++) { e += mag[k]; const d = mag[k] - prev[k]; if (d > 0) fl += d; }
      const cnt = hi - lo + 1;
      band[f * B + b] = e / cnt; flux[f * B + b] = fl / cnt;
    }
    prev.set(mag);
    if (f % 160 === 0) { onProgress(f / frames); await new Promise((r) => setTimeout(r, 0)); }
  }

  // normalización por banda (cada bobina usa todo su rango)
  const bandN = new Float32Array(frames * B), fluxN = new Float32Array(frames * B);
  const col = new Float32Array(frames);
  for (let b = 0; b < B; b++) {
    for (let f = 0; f < frames; f++) col[f] = band[f * B + b];
    const lo = percentile(col, 0.12), hi = percentile(col, 0.97);
    const span = Math.max(1e-6, hi - lo);
    for (let f = 0; f < frames; f++) bandN[f * B + b] = Math.min(1.1, Math.max(0, (band[f * B + b] - lo) / span));
    for (let f = 0; f < frames; f++) col[f] = flux[f * B + b];
    const fh = Math.max(1e-6, percentile(col, 0.985));
    for (let f = 0; f < frames; f++) fluxN[f * B + b] = Math.min(1.6, flux[f * B + b] / fh);
  }

  // golpes por banda: pico sobre umbral adaptativo
  const onset = new Float32Array(frames * B);
  const W = Math.round(fps * 0.22);
  const gaps = [0.17, 0.12, 0.1, 0.09].map((s) => Math.round(fps * s));
  const deltas = [0.24, 0.2, 0.19, 0.22];
  const counts = [0, 0, 0, 0];
  for (let b = 0; b < B; b++) {
    const pre = new Float64Array(frames + 1);
    for (let f = 0; f < frames; f++) pre[f + 1] = pre[f] + fluxN[f * B + b];
    let last = -1e9;
    for (let f = 2; f < frames - 2; f++) {
      const v = fluxN[f * B + b];
      const a = Math.max(0, f - W), z = Math.min(frames, f + W + 1);
      const mean = (pre[z] - pre[a]) / (z - a);
      const thr = mean * 1.3 + deltas[b];
      if (v <= thr) continue;
      let peak = true;
      for (let k = -2; k <= 2; k++) if (k && fluxN[(f + k) * B + b] > v) { peak = false; break; }
      if (!peak || f - last < gaps[b]) continue;
      onset[f * B + b] = Math.min(1, Math.max(0.15, (v - thr) / 0.7 + 0.15));
      last = f; counts[b]++;
    }
  }

  // pulso: autocorrelación de la envolvente de golpes
  const env = new Float32Array(frames);
  for (let f = 0; f < frames; f++) env[f] = fluxN[f * B] + fluxN[f * B + 1] * 0.7 + fluxN[f * B + 2] * 0.35;
  {
    const pre = new Float64Array(frames + 1);
    for (let f = 0; f < frames; f++) pre[f + 1] = pre[f] + env[f];
    const w = Math.round(fps * 0.5);
    const tmp = new Float32Array(frames);
    for (let f = 0; f < frames; f++) {
      const a = Math.max(0, f - w), z = Math.min(frames, f + w + 1);
      tmp[f] = Math.max(0, env[f] - (pre[z] - pre[a]) / (z - a));
    }
    env.set(tmp);
  }
  const minLag = Math.floor((60 / 185) * fps), maxLag = Math.ceil((60 / 68) * fps);
  const acMax = Math.min(frames - 2, maxLag * 4 + 2);
  const ac = new Float32Array(acMax + 2);
  for (let L = 1; L <= acMax; L++) {
    let s = 0;
    for (let f = 0; f + L < frames; f++) s += env[f] * env[f + L];
    ac[L] = s / Math.max(1, frames - L);
  }
  const acAt = (x) => { const i = Math.floor(x), u = x - i; return i + 1 > acMax ? 0 : ac[i] * (1 - u) + ac[i + 1] * u; };
  let bestL = Math.round((60 / 120) * fps), bestV = -1;
  const ref = (60 / 120) * fps;
  for (let L = minLag; L <= maxLag; L++) {
    // peine: el periodo real también resuena en sus múltiplos
    const s = acAt(L) + 0.6 * acAt(L * 2) + 0.35 * acAt(L * 3) + 0.25 * acAt(L * 4);
    const wgt = Math.exp(-0.5 * Math.pow(Math.log2(L / ref) / 1.0, 2));
    if (s * wgt > bestV) { bestV = s * wgt; bestL = L; }
  }
  let lag = bestL;
  if (bestL > minLag && bestL < maxLag) {
    const y0 = ac[bestL - 1], y1 = ac[bestL], y2 = ac[bestL + 1];
    const den = y0 - 2 * y1 + y2;
    if (Math.abs(den) > 1e-9) lag = bestL + (0.5 * (y0 - y2)) / den;
  }
  const bpm = (60 * fps) / lag;
  // fase
  let bestP = 0, bestS = -1;
  for (let p = 0; p < Math.ceil(lag); p++) {
    let s = 0;
    for (let t = p; t < frames; t += lag) s += env[Math.round(t)] || 0;
    if (s > bestS) { bestS = s; bestP = p; }
  }
  const beats = [];
  for (let t = bestP; t < frames; t += lag) beats.push(t / fps);
  // primer tiempo del compás: el que concentra más graves
  let down = 0, downS = -1;
  for (let q = 0; q < 4; q++) {
    let s = 0;
    for (let k = q; k < beats.length; k += 4) {
      const f = Math.round(beats[k] * fps);
      s += (bandN[f * B] || 0) + (onset[f * B] || 0) * 2;
    }
    if (s > downS) { downS = s; down = q; }
  }

  // energía suavizada (para el ritmo de los planos)
  const energy = new Float32Array(frames);
  {
    const pre = new Float64Array(frames + 1);
    for (let f = 0; f < frames; f++) pre[f + 1] = pre[f] + rms[f];
    const w = Math.round(fps * 0.9);
    for (let f = 0; f < frames; f++) {
      const a = Math.max(0, f - w), z = Math.min(frames, f + w + 1);
      energy[f] = (pre[z] - pre[a]) / (z - a);
    }
    const lo = percentile(energy, 0.05), hi = percentile(energy, 0.98);
    for (let f = 0; f < frames; f++) energy[f] = Math.min(1, Math.max(0, (energy[f] - lo) / Math.max(1e-6, hi - lo)));
  }
  onProgress(1);
  return { sr, hop, fps, frames, duration: buffer.duration, band: bandN, onset, energy, bpm, beats, down, counts, mono };
}

export function levelsAt(an, t, out) {
  const f = Math.min(an.frames - 1.001, Math.max(0, t * an.fps - 2));
  const i = Math.floor(f), u = f - i;
  for (let b = 0; b < 4; b++) out[b] = an.band[i * 4 + b] * (1 - u) + an.band[(i + 1) * 4 + b] * u;
  return out;
}

// golpes ocurridos en (t0, t1]
export function onsetsBetween(an, t0, t1, out) {
  out[0] = out[1] = out[2] = out[3] = 0;
  if (t1 <= t0) return out;
  const f0 = Math.max(0, Math.floor(t0 * an.fps) + 1), f1 = Math.min(an.frames - 1, Math.floor(t1 * an.fps));
  if (f1 - f0 > 40) return out; // saltos (seek): no disparar todo junto
  for (let f = f0; f <= f1; f++) for (let b = 0; b < 4; b++) out[b] = Math.max(out[b], an.onset[f * 4 + b]);
  return out;
}

export function energyAt(an, t) {
  const f = Math.min(an.frames - 1, Math.max(0, Math.floor(t * an.fps)));
  return an.energy[f];
}

// la bobina que más va a disparar en los próximos segundos (para elegir el sujeto del plano)
export function busiestCoil(an, t, win = 2) {
  const f0 = Math.max(0, Math.floor(t * an.fps)), f1 = Math.min(an.frames - 1, Math.floor((t + win) * an.fps));
  const s = [0, 0, 0, 0];
  for (let f = f0; f <= f1; f++) for (let b = 0; b < 4; b++) s[b] += an.onset[f * 4 + b] + an.band[f * 4 + b] * 0.02;
  let best = 0;
  for (let b = 1; b < 4; b++) if (s[b] > s[best]) best = b;
  return best;
}

// fragmento de forma de onda para el osciloscopio
export function waveAt(an, t, out) {
  const center = Math.floor(t * an.sr);
  const n = out.length, span = 1024;
  for (let i = 0; i < n; i++) {
    const k = center - span / 2 + Math.floor((i / n) * span);
    out[i] = an.mono[k] || 0;
  }
  return out;
}
