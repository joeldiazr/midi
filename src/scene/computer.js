// Computadora dentro de la cabina: mesa, monitor, teclado. Su pantalla es la terminal donde se busca la canción.
import * as THREE from 'three';

export const SCREEN_W = 0.58;
export const SCREEN_H = 0.3625; // 16:10

export function createComputer(mats, base) {
  const g = new THREE.Group();
  g.position.set(0, base, -0.6);
  const cast = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };
  const shell = new THREE.MeshStandardMaterial({ color: 0x1d1e22, metalness: 0.35, roughness: 0.55 });
  const top = 0.76;

  // mesa metálica
  const desk = cast(new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.035, 0.52), mats.panel));
  desk.position.y = top; g.add(desk);
  for (const [x, z] of [[0.4, 0.23], [-0.4, 0.23], [0.4, -0.23], [-0.4, -0.23]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.035, top, 0.035), mats.steel);
    leg.position.set(x, top / 2, z); g.add(leg);
  }
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 0.46), mats.panel);
  shelf.position.y = 0.2; g.add(shelf);
  // torre bajo la mesa
  const tower = cast(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.42, 0.42), shell));
  tower.position.set(-0.26, 0.42, 0); g.add(tower);
  const pwr = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.004), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.4, 0.9) }));
  pwr.position.set(-0.26, 0.58, 0.212); g.add(pwr);

  // monitor
  const mon = new THREE.Group(); mon.position.set(0, top + 0.07 + SCREEN_H / 2 + 0.04, -0.1); g.add(mon);
  const bezel = cast(new THREE.Mesh(new THREE.BoxGeometry(SCREEN_W + 0.05, SCREEN_H + 0.05, 0.035), shell));
  mon.add(bezel);
  const back = cast(new THREE.Mesh(new THREE.BoxGeometry(SCREEN_W * 0.7, SCREEN_H * 0.7, 0.07), shell));
  back.position.z = -0.05; mon.add(back);
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.03), shell);
  neck.position.set(0, -SCREEN_H / 2 - 0.06, -0.05); mon.add(neck);
  const foot = cast(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.012, 0.16), shell));
  foot.position.set(0, top + 0.024, -0.13); g.add(foot);

  // pantalla con textura propia (lo que se ve cuando la búsqueda no está abierta)
  const c = document.createElement('canvas'); c.width = 1024; c.height = 640;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_H), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  screen.position.z = 0.0185; mon.add(screen);

  // teclado y ratón
  const kc = document.createElement('canvas'); kc.width = 512; kc.height = 160;
  const kg = kc.getContext('2d');
  kg.fillStyle = '#141518'; kg.fillRect(0, 0, 512, 160);
  for (let r = 0; r < 5; r++) for (let k = 0; k < 15; k++) {
    kg.fillStyle = '#2b2d33'; kg.fillRect(8 + k * 33.3, 8 + r * 30, 29, 26);
    kg.fillStyle = 'rgba(160,220,200,0.18)'; kg.fillRect(12 + k * 33.3, 26 + r * 30, 21, 2);
  }
  const kt = new THREE.CanvasTexture(kc); kt.colorSpace = THREE.SRGBColorSpace;
  const kb = cast(new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.02, 0.14), [shell, shell, new THREE.MeshStandardMaterial({ map: kt, roughness: 0.6 }), shell, shell, shell]));
  kb.position.set(0, top + 0.028, 0.12); kb.rotation.x = 0.06; g.add(kb);
  const mouse = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.025, 0.09), shell);
  mouse.position.set(0.3, top + 0.03, 0.12); g.add(mouse);

  let lastDraw = -1, blink = 0;
  return {
    group: g, screen,
    // centro y normal de la pantalla en mundo (para encuadrarla)
    screenFrame(outCenter, outNormal) {
      screen.updateWorldMatrix(true, false);
      screen.getWorldPosition(outCenter);
      outNormal.set(0, 0, 1).transformDirection(screen.matrixWorld);
      return outCenter;
    },
    corners() {
      screen.updateWorldMatrix(true, false);
      return [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([x, y]) => new THREE.Vector3(x * SCREEN_W / 2, y * SCREEN_H / 2, 0).applyMatrix4(screen.matrixWorld));
    },
    update(t, info) {
      if (t - lastDraw < 0.1) return;
      lastDraw = t; blink++;
      const W = 1024, H = 640;
      ctx.fillStyle = '#060a09'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(150,255,210,0.05)';
      for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);
      const ink = 'rgba(225,240,232,0.92)', dim = 'rgba(225,240,232,0.45)';
      ctx.font = '500 26px "JetBrains Mono", monospace'; ctx.fillStyle = dim; ctx.textBaseline = 'top';
      ctx.fillText('MIDI — TERMINAL DE BOBINAS', 56, 48);
      ctx.textAlign = 'right'; ctx.fillText(info.bpm ? `${Math.round(info.bpm)} BPM` : 'EN ESPERA', W - 56, 48); ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(225,240,232,0.15)'; ctx.fillRect(56, 96, W - 112, 2);
      if (info.title) {
        ctx.fillStyle = dim; ctx.font = '500 24px "JetBrains Mono", monospace';
        ctx.fillText(info.status === 'paused' ? 'TIEMPO DETENIDO' : 'AHORA SUENA', 56, 140);
        ctx.fillStyle = ink; ctx.font = 'italic 500 76px "Inter Tight", sans-serif';
        let title = info.title.toUpperCase();
        while (ctx.measureText(title).width > W - 112 && title.length > 4) title = title.slice(0, -2);
        if (title !== info.title.toUpperCase()) title += '…';
        ctx.fillText(title, 52, 182);
        ctx.fillStyle = dim; ctx.font = '500 28px "JetBrains Mono", monospace';
        ctx.fillText((info.artist || '').toUpperCase().slice(0, 48), 56, 278);
        // barras de las cuatro bobinas
        for (let i = 0; i < 4; i++) {
          const x = 56 + i * 120, h = 150 * Math.min(1, info.levels[i]);
          ctx.fillStyle = 'rgba(225,240,232,0.1)'; ctx.fillRect(x, 340, 70, 150);
          ctx.fillStyle = '#' + info.colors[i].getHexString(); ctx.fillRect(x, 490 - h, 70, h);
          ctx.fillStyle = dim; ctx.font = '500 22px "JetBrains Mono", monospace'; ctx.fillText(['I', 'II', 'III', 'IV'][i], x, 504);
        }
        ctx.fillStyle = 'rgba(225,240,232,0.15)'; ctx.fillRect(560, 560, W - 616, 3);
        ctx.fillStyle = ink; ctx.fillRect(560, 560, (W - 616) * Math.min(1, info.progress || 0), 3);
      } else {
        ctx.fillStyle = ink; ctx.font = 'italic 500 88px "Inter Tight", sans-serif';
        ctx.fillText('ESCRIBE UNA', 52, 170);
        ctx.fillText('CANCIÓN' + (blink % 10 < 5 ? '_' : ''), 52, 262);
        ctx.fillStyle = dim; ctx.font = '500 26px "JetBrains Mono", monospace';
        ctx.fillText('PULSA «BUSCAR» PARA ABRIR LA TERMINAL', 56, 420);
      }
      tex.needsUpdate = true;
    },
  };
}
