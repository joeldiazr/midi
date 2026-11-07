// Colores de los rayos a partir de la portada del álbum (k-means sobre una miniatura).
import * as THREE from 'three';
import { rng } from '../scene/textures.js';

export const DEFAULT_PALETTE = ['#8fb6ff', '#b29bff', '#7fe3ff', '#dcd2ff'];

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export function paletteFromHex(list) {
  const glow = list.map((h) => new THREE.Color(h));
  return { glow, css: list.slice(), raw: list.slice(), dominant: list[0], fromCover: false };
}

export async function extractPalette(url) {
  const img = await loadImage(url);
  const S = 48;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, S, S);
  const d = g.getImageData(0, 0, S, S).data;
  const px = [];
  for (let i = 0; i < d.length; i += 4) px.push([d[i] / 255, d[i + 1] / 255, d[i + 2] / 255]);
  // k-means++
  const K = 7, R = rng(5);
  const centers = [px[Math.floor(R() * px.length)].slice()];
  while (centers.length < K) {
    const dist = px.map((p) => Math.min(...centers.map((c2) => (p[0] - c2[0]) ** 2 + (p[1] - c2[1]) ** 2 + (p[2] - c2[2]) ** 2)));
    const sum = dist.reduce((a, b) => a + b, 0) || 1;
    let r = R() * sum, k = 0;
    while (r > dist[k] && k < px.length - 1) { r -= dist[k]; k++; }
    centers.push(px[k].slice());
  }
  const assign = new Uint8Array(px.length);
  for (let it = 0; it < 10; it++) {
    for (let i = 0; i < px.length; i++) {
      let best = 0, bd = 1e9;
      for (let k = 0; k < K; k++) {
        const dd = (px[i][0] - centers[k][0]) ** 2 + (px[i][1] - centers[k][1]) ** 2 + (px[i][2] - centers[k][2]) ** 2;
        if (dd < bd) { bd = dd; best = k; }
      }
      assign[i] = best;
    }
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < px.length; i++) { const a = acc[assign[i]]; a[0] += px[i][0]; a[1] += px[i][1]; a[2] += px[i][2]; a[3]++; }
    acc.forEach((a, k) => { if (a[3]) centers[k] = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; });
  }
  const counts = new Array(K).fill(0);
  for (let i = 0; i < px.length; i++) counts[assign[i]]++;
  const hsl = {};
  const clusters = centers.map((cc, k) => {
    const col = new THREE.Color().setRGB(cc[0], cc[1], cc[2], THREE.SRGBColorSpace);
    col.getHSL(hsl, THREE.SRGBColorSpace);
    return { col, h: hsl.h, s: hsl.s, l: hsl.l, n: counts[k] };
  }).filter((c2) => c2.n > 0);
  const lumW = (l) => (l < 0.08 ? 0.15 : l > 0.95 ? 0.3 : 1);
  clusters.forEach((c2) => { c2.score = Math.sqrt(c2.n) * (0.12 + c2.s * 1.4) * lumW(c2.l); });
  clusters.sort((a, b) => b.score - a.score);
  const byCount = clusters.slice().sort((a, b) => b.n - a.n);

  const hueDist = (a, b) => { const d = Math.abs(a - b); return Math.min(d, 1 - d); };
  const chosen = [];
  for (const c2 of clusters) {
    if (c2.s < 0.14 || c2.l < 0.06) continue;
    if (chosen.every((x) => hueDist(x.h, c2.h) > 0.05 || Math.abs(x.l - c2.l) > 0.3)) chosen.push(c2);
    if (chosen.length === 4) break;
  }
  let glow;
  if (!chosen.length) {
    // portada en blanco y negro: rayos casi blancos con un leve tinte frío
    glow = ['#dfe8ff', '#b9c9ff', '#f2f4ff', '#c9d6ff'].map((h) => new THREE.Color(h));
  } else {
    const base = chosen.slice();
    let k = 0;
    while (chosen.length < 4) {
      const src = base[k % base.length];
      const shift = (k % 2 ? -1 : 1) * (0.045 + 0.03 * Math.floor(k / 2));
      chosen.push({ h: (src.h + shift + 1) % 1, s: src.s, l: src.l });
      k++;
    }
    glow = chosen.map((c2) => new THREE.Color().setHSL(c2.h, Math.min(1, Math.max(0.62, c2.s * 1.25)), Math.min(0.7, Math.max(0.56, c2.l)), THREE.SRGBColorSpace));
  }
  const css = glow.map((c2) => '#' + c2.getHexString(THREE.SRGBColorSpace));
  const raw = byCount.slice(0, 5).map((c2) => '#' + c2.col.getHexString(THREE.SRGBColorSpace));
  return { glow, css, raw, dominant: raw[0], fromCover: true };
}
