// Texturas procedurales (canvas). Nada se descarga: ladrillo, piedra, malla, bobinado, pizarra.
import * as THREE from 'three';

export function rng(seed = 1) {
  let s = (Math.imul(seed | 0, 2654435761) >>> 0) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function canvasTex(c, { srgb = true, repeat = [1, 1], aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

// Mampostería genérica: ladrillo, sillares de piedra o baldosas.
export function masonry({
  size = 1024, cols = 8, rows = 16, mortar = 4, hue = 20, sat = 14, light = 22, vary = 10,
  stagger = true, seed = 3, mortarColor = '#121110', stains = 14, wet = 0,
} = {}) {
  const c = makeCanvas(size, size), g = c.getContext('2d');
  const b = makeCanvas(size, size), gb = b.getContext('2d');
  const r = makeCanvas(size, size), gr = r.getContext('2d');
  const R = rng(seed);
  g.fillStyle = mortarColor; g.fillRect(0, 0, size, size);
  gb.fillStyle = '#1c1c1c'; gb.fillRect(0, 0, size, size);
  gr.fillStyle = '#f2f2f2'; gr.fillRect(0, 0, size, size);
  const bw = size / cols, bh = size / rows;
  for (let y = 0; y < rows; y++) {
    const off = stagger && (y % 2) ? bw / 2 : 0;
    for (let x = -1; x <= cols; x++) {
      const px = x * bw + off + mortar / 2, py = y * bh + mortar / 2;
      const w = bw - mortar, h = bh - mortar;
      const l = light + (R() - 0.5) * vary;
      g.fillStyle = `hsl(${hue + (R() - 0.5) * 12}, ${Math.max(0, sat + (R() - 0.5) * 8)}%, ${l}%)`;
      g.fillRect(px, py, w, h);
      const grd = g.createLinearGradient(px, py, px + w * 0.3, py + h);
      grd.addColorStop(0, 'rgba(255,255,255,0.05)');
      grd.addColorStop(1, 'rgba(0,0,0,0.22)');
      g.fillStyle = grd; g.fillRect(px, py, w, h);
      const hb = (150 + R() * 80) | 0;
      gb.fillStyle = `rgb(${hb},${hb},${hb})`; gb.fillRect(px, py, w, h);
      const rr = (175 + R() * 70) | 0;
      gr.fillStyle = `rgb(${rr},${rr},${rr})`; gr.fillRect(px, py, w, h);
      // desportillados en las esquinas
      if (R() < 0.35) {
        const cx = px + (R() < 0.5 ? 0 : w), cy = py + (R() < 0.5 ? 0 : h), cr = 3 + R() * 9;
        g.fillStyle = mortarColor; g.beginPath(); g.arc(cx, cy, cr, 0, Math.PI * 2); g.fill();
        gb.fillStyle = '#202020'; gb.beginPath(); gb.arc(cx, cy, cr, 0, Math.PI * 2); gb.fill();
      }
    }
  }
  const n = (size * size) / 70;
  for (let i = 0; i < n; i++) {
    const x = R() * size, y = R() * size, s = R() * 2.2 + 0.4, v = R();
    g.fillStyle = v > 0.55 ? `rgba(255,240,220,${R() * 0.07})` : `rgba(0,0,0,${R() * 0.22})`;
    g.fillRect(x, y, s, s);
    gb.fillStyle = v > 0.55 ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.3)';
    gb.fillRect(x, y, s, s);
  }
  for (let i = 0; i < stains; i++) {
    const x = R() * size, y = R() * size, rad = 40 + R() * 180;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `rgba(0,0,0,${0.12 + R() * 0.22})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // charcos: zonas pulidas (rugosidad baja) que atrapan los destellos
  for (let i = 0; i < wet; i++) {
    const x = R() * size, y = R() * size, rad = 60 + R() * 200;
    const grd = gr.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(25,25,25,0.85)');
    grd.addColorStop(0.6, 'rgba(25,25,25,0.4)');
    grd.addColorStop(1, 'rgba(25,25,25,0)');
    gr.fillStyle = grd; gr.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return { map: canvasTex(c), bump: canvasTex(b, { srgb: false }), rough: canvasTex(r, { srgb: false }) };
}

// Círculo de instrumento grabado en el piso (latón incrustado): escalas, marcas y bases de bobina.
export function ringDecal(size = 2048, worldRadius = 6.2, coilRadius = 4.6) {
  const c = makeCanvas(size, size), g = c.getContext('2d');
  const R = size / 2 - 10;
  const k = R / worldRadius;
  const draw = (stroke, fill, dx, dy) => {
    g.save();
    g.translate(size / 2 + dx, size / 2 + dy);
    g.strokeStyle = stroke; g.fillStyle = fill;
    const ring = (r, w) => { g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke(); };
    ring(R * 0.995, 7); ring(R * 0.968, 2.5); ring(R * 0.905, 3); ring(R * 0.885, 1.5);
    ring(R * 0.58, 2); ring(R * 0.555, 6); ring(R * 0.27, 2.5); ring(R * 0.255, 1.2);
    for (let i = 0; i < 360; i++) {
      const a = (i * Math.PI) / 180;
      const len = i % 10 === 0 ? 0.055 : i % 5 === 0 ? 0.034 : 0.018;
      g.lineWidth = i % 10 === 0 ? 3 : 1.6;
      const r0 = R * 0.968, r1 = R * (0.968 - len);
      g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); g.stroke();
    }
    g.font = `500 ${Math.round(size * 0.017)}px "JetBrains Mono", monospace`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let i = 0; i < 360; i += 30) {
      g.save(); g.rotate((i * Math.PI) / 180 + Math.PI / 2);
      g.fillText(String(i).padStart(3, '0') + '°', 0, -R * 0.853);
      g.restore();
    }
    // texto circular interior
    const txt = ' RESONANCIA · f₀ = 1 / 2π√LC · 1,2 MV · CUATRO BOBINAS · UNA CABINA · ';
    g.font = `500 ${Math.round(size * 0.0145)}px "JetBrains Mono", monospace`;
    const rr = R * 0.505;
    const full = txt.repeat(2);
    const step = (Math.PI * 2) / full.length;
    for (let i = 0; i < full.length; i++) {
      g.save(); g.rotate(i * step); g.translate(0, -rr); g.fillText(full[i], 0, 0); g.restore();
    }
    // radios hacia las bases
    const roman = ['I', 'II', 'III', 'IV'];
    for (let q = 0; q < 4; q++) {
      const a = Math.PI / 4 + (q * Math.PI) / 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      g.lineWidth = 2.5;
      g.beginPath(); g.moveTo(ca * R * 0.27, sa * R * 0.27); g.lineTo(ca * (coilRadius - 1.05) * k, sa * (coilRadius - 1.05) * k); g.stroke();
      const px = ca * coilRadius * k, py = sa * coilRadius * k;
      g.lineWidth = 3; g.beginPath(); g.arc(px, py, 1.05 * k, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 1.5; g.beginPath(); g.arc(px, py, 1.17 * k, 0, Math.PI * 2); g.stroke();
      for (let t = 0; t < 4; t++) {
        const b = (t * Math.PI) / 2;
        g.beginPath(); g.moveTo(px + Math.cos(b) * 1.17 * k, py + Math.sin(b) * 1.17 * k);
        g.lineTo(px + Math.cos(b) * 1.4 * k, py + Math.sin(b) * 1.4 * k); g.stroke();
      }
      g.save();
      g.translate(ca * (coilRadius - 1.6) * k, sa * (coilRadius - 1.6) * k);
      g.rotate(a + Math.PI / 2);
      g.font = `500 ${Math.round(size * 0.03)}px "Inter Tight", sans-serif`;
      g.fillText(roman[q], 0, 0);
      g.restore();
      // radios secundarios
      const b2 = a + Math.PI / 4;
      g.lineWidth = 1.5;
      g.beginPath(); g.moveTo(Math.cos(b2) * R * 0.58, Math.sin(b2) * R * 0.58); g.lineTo(Math.cos(b2) * R * 0.885, Math.sin(b2) * R * 0.885); g.stroke();
    }
    // cuadrado de la cabina
    const s = 1.25 * k;
    g.lineWidth = 3; g.strokeRect(-s, -s, s * 2, s * 2);
    g.restore();
  };
  draw('rgba(255,236,200,0.22)', 'rgba(255,236,200,0.22)', 2, 2);
  draw('rgba(196,150,88,0.95)', 'rgba(196,150,88,0.95)', 0, 0);
  const t = canvasTex(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

// Malla de alambre en rombos (alpha).
export function chainLink(size = 128) {
  const c = makeCanvas(size, size), g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, size, size);
  g.strokeStyle = '#fff'; g.lineWidth = size * 0.075; g.lineCap = 'round';
  for (const o of [-size, 0, size]) {
    g.beginPath(); g.moveTo(o, 0); g.lineTo(o + size, size); g.stroke();
    g.beginPath(); g.moveTo(o + size, 0); g.lineTo(o, size); g.stroke();
  }
  return canvasTex(c, { srgb: false, aniso: 4 });
}

// Bobinado del secundario: cobre esmaltado muy fino.
export function windings() {
  const c = makeCanvas(64, 512), g = c.getContext('2d');
  for (let y = 0; y < 512; y += 4) {
    g.fillStyle = `hsl(22, 62%, ${38 + Math.random() * 6}%)`; g.fillRect(0, y, 64, 4);
    g.fillStyle = 'rgba(255,220,180,0.35)'; g.fillRect(0, y, 64, 1);
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, y + 3, 64, 1);
  }
  return canvasTex(c, { repeat: [1, 1] });
}

export function glowTexture(size = 128) {
  const c = makeCanvas(size, size), g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.12, 'rgba(255,255,255,0.7)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Pizarra con fórmulas a tiza.
export function chalkboard() {
  const W = 1536, H = 640;
  const c = makeCanvas(W, H), g = c.getContext('2d');
  g.fillStyle = '#141816'; g.fillRect(0, 0, W, H);
  const R = rng(42);
  for (let i = 0; i < 30; i++) {
    const x = R() * W, y = R() * H, rad = 80 + R() * 260;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(200,210,200,0.05)'); grd.addColorStop(1, 'rgba(200,210,200,0)');
    g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  const chalk = (text, x, y, size, rot = 0) => {
    g.save(); g.translate(x, y); g.rotate(rot);
    g.font = `500 ${size}px Caveat, "Segoe Print", cursive`;
    for (let k = 0; k < 4; k++) {
      g.fillStyle = `rgba(235,235,225,${0.22 + R() * 0.2})`;
      g.fillText(text, (R() - 0.5) * 2, (R() - 0.5) * 2);
    }
    g.restore();
  };
  chalk('f₀ = 1 / 2π √(L·C)', 70, 120, 76, -0.02);
  chalk('V₂ ≈ V₁ · √(L₂ / L₁)', 80, 230, 64, 0.01);
  chalk('nota → interruptor → arco', 90, 330, 56, -0.015);
  chalk('f(n) = 440 · 2^((n−69)/12)', 80, 430, 58, 0.01);
  chalk('≈ 1,2 MV', 120, 540, 70, -0.03);
  // diagrama del circuito
  g.strokeStyle = 'rgba(235,235,225,0.55)'; g.lineWidth = 4; g.lineCap = 'round';
  const ox = 1000, oy = 120;
  g.beginPath();
  for (let i = 0; i < 7; i++) { g.arc(ox + 40, oy + 40 + i * 44, 22, -Math.PI / 2, Math.PI / 2, false); }
  g.stroke();
  g.beginPath();
  for (let i = 0; i < 9; i++) { g.arc(ox + 170, oy + 20 + i * 36, 18, Math.PI / 2, Math.PI * 1.5, false); }
  g.stroke();
  g.beginPath(); g.moveTo(ox + 40, oy + 18); g.lineTo(ox - 60, oy + 18); g.lineTo(ox - 60, oy + 150);
  g.moveTo(ox - 90, oy + 150); g.lineTo(ox - 30, oy + 150); g.moveTo(ox - 90, oy + 172); g.lineTo(ox - 30, oy + 172);
  g.moveTo(ox - 60, oy + 172); g.lineTo(ox - 60, oy + 360); g.lineTo(ox + 40, oy + 360);
  g.moveTo(ox + 170, oy + 2); g.lineTo(ox + 170, oy - 40);
  g.stroke();
  g.beginPath(); g.ellipse(ox + 170, oy - 70, 70, 26, 0, 0, Math.PI * 2); g.stroke();
  chalk('C', ox - 130, oy + 172, 50);
  chalk('L₁', ox - 10, oy + 420, 50);
  chalk('L₂', ox + 210, oy + 380, 50);
  // ondas
  g.beginPath();
  for (let x = 0; x < 380; x++) { const y = Math.sin(x * 0.06) * 30 * Math.exp(-x / 260); x === 0 ? g.moveTo(560 + x, 560 + y) : g.lineTo(560 + x, 560 + y); }
  g.stroke();
  return canvasTex(c);
}
