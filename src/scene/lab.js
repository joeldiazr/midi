// El sótano: sala abovedada de piedra y ladrillo, círculo de latón, cuatro bobinas, la cabina y utilería.
import * as THREE from 'three';
import { masonry, ringDecal, windings, chalkboard, glowTexture, rng } from './textures.js';
import { createCoil, TOROID_Y } from './coil.js';
import { createCage, CAGE_HW } from './cage.js';

const V3 = THREE.Vector3;
export const HALL = 15;          // media anchura interior
export const CEIL = 8.6;
export const PILLAR = 7;         // posición de los pilares del crucero
export const PILLAR_W = 1.4;
export const COIL_RADIUS = 4.6;

function scaleUV(geo, su, sv = su) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  uv.needsUpdate = true;
  return geo;
}
function boxGeo(w, h, d, ts) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, (uv.getX(k) * dims[f][0]) / ts, (uv.getY(k) * dims[f][1]) / ts);
  }
  return g;
}
function archGeo(span, springH, rise, topH, depth, ts) {
  const s = new THREE.Shape();
  const hw = span / 2;
  s.moveTo(-hw, springH);
  s.lineTo(-hw, topH);
  s.lineTo(hw, topH);
  s.lineTo(hw, springH);
  s.absellipse(0, springH, hw, rise, 0, Math.PI, false);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 40 });
  g.translate(0, 0, -depth / 2);
  return scaleUV(g, 1 / ts);
}

export function buildLab(scene, { lowPower = false } = {}) {
  const root = new THREE.Group();
  scene.add(root);
  const R = rng(11);

  // ---------- materiales ----------
  const brick = masonry({ cols: 8, rows: 18, hue: 16, sat: 22, light: 20, vary: 9, seed: 5, stains: 18 });
  const stone = masonry({ cols: 3, rows: 5, mortar: 5, hue: 32, sat: 7, light: 27, vary: 7, seed: 9, mortarColor: '#16140f', stains: 10 });
  const tiles = masonry({ cols: 4, rows: 4, mortar: 6, stagger: false, hue: 30, sat: 5, light: 19, vary: 6, seed: 17, mortarColor: '#0d0c0a', stains: 22, wet: 9 });
  const concrete = masonry({ cols: 2, rows: 2, mortar: 2, stagger: false, hue: 0, sat: 0, light: 13, vary: 3, seed: 21, mortarColor: '#0b0b0b', stains: 26 });

  const mBrick = new THREE.MeshStandardMaterial({ map: brick.map, bumpMap: brick.bump, bumpScale: 2.2, roughnessMap: brick.rough, roughness: 1, metalness: 0 });
  const mStone = new THREE.MeshStandardMaterial({ map: stone.map, bumpMap: stone.bump, bumpScale: 2.5, roughnessMap: stone.rough, roughness: 1, metalness: 0 });
  const mFloor = new THREE.MeshStandardMaterial({ map: tiles.map, bumpMap: tiles.bump, bumpScale: 1.6, roughnessMap: tiles.rough, roughness: 0.95, metalness: 0.05 });
  const mCeil = new THREE.MeshStandardMaterial({ map: concrete.map, roughnessMap: concrete.rough, roughness: 1, color: 0x8a8a8a });

  const mats = {
    copper: new THREE.MeshStandardMaterial({ color: 0xc0703c, metalness: 1, roughness: 0.3 }),
    aluminium: new THREE.MeshStandardMaterial({ color: 0xc9ccd2, metalness: 1, roughness: 0.26 }),
    darkMetal: new THREE.MeshStandardMaterial({ color: 0x1c1c1f, metalness: 0.7, roughness: 0.5 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x4a4c52, metalness: 0.9, roughness: 0.4 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x101012, metalness: 0, roughness: 0.92 }),
    insulator: new THREE.MeshStandardMaterial({ color: 0x3b2a1b, metalness: 0, roughness: 0.62 }),
    insulatorDark: new THREE.MeshStandardMaterial({ color: 0x141210, metalness: 0.1, roughness: 0.5 }),
    panel: new THREE.MeshStandardMaterial({ color: 0x2b2d31, metalness: 0.6, roughness: 0.45 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x3a2818, metalness: 0, roughness: 0.75 }),
    windings: new THREE.MeshStandardMaterial({ map: (() => { const t = windings(); t.repeat.set(1, 1); return t; })(), metalness: 0.75, roughness: 0.32 }),
  };
  mats.windings.map.repeat.set(1, 5);

  const add = (mesh, { cast = true, recv = true } = {}) => { mesh.castShadow = cast; mesh.receiveShadow = recv; root.add(mesh); return mesh; };

  // ---------- piso ----------
  const floor = add(new THREE.Mesh(scaleUV(new THREE.PlaneGeometry(HALL * 2, HALL * 2), (HALL * 2) / 4), mFloor), { cast: false });
  floor.rotation.x = -Math.PI / 2;
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(12.4, 12.4), new THREE.MeshStandardMaterial({
    map: ringDecal(2048, 6.2, COIL_RADIUS), transparent: true, metalness: 0.75, roughness: 0.38,
    polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false,
  }));
  decal.rotation.x = -Math.PI / 2; decal.position.y = 0.002; decal.receiveShadow = true; root.add(decal);

  // ---------- muros ----------
  const wallTs = 2.6;
  for (const [x, z, ry] of [[0, -HALL - 0.25, 0], [0, HALL + 0.25, 0], [-HALL - 0.25, 0, Math.PI / 2], [HALL + 0.25, 0, Math.PI / 2]]) {
    const w = add(new THREE.Mesh(boxGeo(HALL * 2 + 1, CEIL + 0.4, 0.5, wallTs), mBrick), { cast: false });
    w.position.set(x, (CEIL + 0.4) / 2, z); w.rotation.y = ry;
  }
  // techo plano exterior y vigas
  const ceil = add(new THREE.Mesh(scaleUV(new THREE.PlaneGeometry(HALL * 2, HALL * 2), (HALL * 2) / 5), mCeil), { cast: false });
  ceil.rotation.x = Math.PI / 2; ceil.position.y = CEIL;

  // ---------- pilares y arcos ----------
  const stoneTs = 2.4;
  const pillarGeo = boxGeo(PILLAR_W, CEIL, PILLAR_W, stoneTs);
  const capGeo = boxGeo(PILLAR_W + 0.3, 0.3, PILLAR_W + 0.3, stoneTs);
  const footGeo = boxGeo(PILLAR_W + 0.25, 0.5, PILLAR_W + 0.25, stoneTs);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const p = add(new THREE.Mesh(pillarGeo, mStone)); p.position.set(sx * PILLAR, CEIL / 2, sz * PILLAR);
    const cap = add(new THREE.Mesh(capGeo, mStone)); cap.position.set(sx * PILLAR, 4.6, sz * PILLAR);
    const foot = add(new THREE.Mesh(footGeo, mStone)); foot.position.set(sx * PILLAR, 0.25, sz * PILLAR);
  }
  const inner = PILLAR - PILLAR_W / 2;
  const outerSpan = HALL - (PILLAR + PILLAR_W / 2);
  const centralArch = archGeo(inner * 2, 4.6, 3.2, CEIL, PILLAR_W, stoneTs);
  const outerArch = archGeo(outerSpan, 4.6, 2.4, CEIL, PILLAR_W, stoneTs);
  const outerC = PILLAR + PILLAR_W / 2 + outerSpan / 2;
  for (const s of [-1, 1]) {
    const a1 = add(new THREE.Mesh(centralArch, mStone)); a1.position.set(s * PILLAR, 0, 0); a1.rotation.y = Math.PI / 2;
    const a2 = add(new THREE.Mesh(centralArch, mStone)); a2.position.set(0, 0, s * PILLAR);
    for (const t of [-1, 1]) {
      const o1 = add(new THREE.Mesh(outerArch, mStone)); o1.position.set(s * outerC, 0, t * PILLAR);
      const o2 = add(new THREE.Mesh(outerArch, mStone)); o2.position.set(t * PILLAR, 0, s * outerC); o2.rotation.y = Math.PI / 2;
    }
  }
  // bóveda de arista sobre el crucero (dos medios cilindros que se cruzan)
  const vaultGeo = new THREE.CylinderGeometry(inner, inner, PILLAR * 2, 48, 1, true, 0, Math.PI);
  scaleUV(vaultGeo, (Math.PI * inner) / 3, (PILLAR * 2) / 3);
  vaultGeo.rotateZ(Math.PI / 2);
  vaultGeo.scale(1, 3.2 / inner, 1);
  vaultGeo.translate(0, 4.6, 0);
  const mVault = mBrick.clone(); mVault.side = THREE.DoubleSide;
  add(new THREE.Mesh(vaultGeo, mVault), { cast: false });
  const vB = add(new THREE.Mesh(vaultGeo, mVault), { cast: false }); vB.rotation.y = Math.PI / 2;
  // arcos ciegos sobre los muros
  for (const [ax, az, ry, along] of [[0, -HALL, 0, 'x'], [0, HALL, 0, 'x'], [-HALL, 0, Math.PI / 2, 'z'], [HALL, 0, Math.PI / 2, 'z']]) {
    for (const [c, span] of [[0, inner * 2], [-outerC, outerSpan], [outerC, outerSpan]]) {
      const geo = archGeo(span - 0.5, 3.6, Math.min(span / 2 - 0.25, 3.4), CEIL, 0.3, stoneTs);
      const m = add(new THREE.Mesh(geo, mStone), { cast: false });
      const inward = ax !== 0 ? -Math.sign(ax) : -Math.sign(az);
      if (along === 'x') m.position.set(c, 0, az + inward * 0.15);
      else m.position.set(ax + inward * 0.15, 0, c);
      m.rotation.y = ry;
    }
  }

  // ---------- tuberías y vigas ----------
  const pipeMat = mats.steel;
  for (const [z, y, r] of [[-HALL + 0.5, 7.7, 0.12], [-HALL + 0.85, 7.3, 0.07], [HALL - 0.5, 7.6, 0.1]]) {
    const p = add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, HALL * 2, 14), pipeMat));
    p.rotation.z = Math.PI / 2; p.position.set(0, y, z);
  }
  for (const [x, y, r] of [[-HALL + 0.5, 7.6, 0.1], [HALL - 0.6, 7.4, 0.14]]) {
    const p = add(new THREE.Mesh(new THREE.CylinderGeometry(r, r, HALL * 2, 14), pipeMat));
    p.rotation.x = Math.PI / 2; p.position.set(x, y, 0);
  }

  // ---------- bobinas y cabina ----------
  const coils = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const c = createCoil(i, a, COIL_RADIUS, mats);
    root.add(c.group);
    coils.push(c);
  }
  const cage = createCage(mats);
  root.add(cage.group);

  // ---------- consola del operador ----------
  const scope = makeScope();
  const desk0 = new THREE.Group(); desk0.position.set(0, 0, 9.6); root.add(desk0);
  const desk = new THREE.Mesh(boxGeo(3.2, 0.9, 1.0, 2), mats.panel); desk.position.y = 0.45; desk.castShadow = desk.receiveShadow = true; desk0.add(desk);
  const slope = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.06, 0.7), mats.darkMetal); slope.position.set(0, 0.98, -0.12); slope.rotation.x = 0.35; desk0.add(slope);
  const scr = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.62, 0.55), mats.panel); scr.position.set(-0.7, 1.3, 0.12); scr.castShadow = true; desk0.add(scr);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.46), new THREE.MeshBasicMaterial({ map: scope.tex, toneMapped: false }));
  screen.position.set(-0.7, 1.3, -0.156); screen.rotation.y = Math.PI; desk0.add(screen);
  const knobMat = new THREE.MeshStandardMaterial({ color: 0xd8d3c8, metalness: 0.3, roughness: 0.4 });
  const ledMats = [];
  for (let i = 0; i < 12; i++) {
    const k = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.05, 16), knobMat);
    k.position.set(0.2 + (i % 6) * 0.22, 1.03 + Math.floor(i / 6) * 0.08, -0.2 - Math.floor(i / 6) * 0.18);
    k.rotation.x = 0.35 + Math.PI / 2; desk0.add(k);
  }
  for (let i = 0; i < 4; i++) {
    const lm = new THREE.MeshBasicMaterial({ color: 0x444444 }); ledMats.push(lm);
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.03), lm);
    l.position.set(0.25 + i * 0.3, 1.12, -0.45); desk0.add(l);
  }
  // cables de cada bobina a la consola
  const cableMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0d, roughness: 0.6 });
  for (const c of coils) {
    const a = c.base.clone().addScaledVector(c.dir, 0.75); a.y = 0.03;
    const b = new V3(-1.2 + c.index * 0.8, 0.03, 9.1);
    const m1 = a.clone().lerp(b, 0.33).add(new V3((R() - 0.5) * 2, 0, (R() - 0.5) * 2)); m1.y = 0.03;
    const m2 = a.clone().lerp(b, 0.66).add(new V3((R() - 0.5) * 2, 0, (R() - 0.5) * 2)); m2.y = 0.03;
    const up = b.clone(); up.y = 0.7;
    const curve = new THREE.CatmullRomCurve3([a, m1, m2, b, up]);
    add(new THREE.Mesh(new THREE.TubeGeometry(curve, 80, 0.035, 6), cableMat), { cast: false });
  }

  // ---------- bancos de trabajo, pizarra, estantes ----------
  const bench = (x, z, ry, len) => {
    const gr = new THREE.Group(); gr.position.set(x, 0, z); gr.rotation.y = ry; root.add(gr);
    const top = new THREE.Mesh(boxGeo(len, 0.08, 1.0, 2), mats.wood); top.position.y = 0.95; gr.add(top);
    for (const lx of [-len / 2 + 0.1, len / 2 - 0.1]) for (const lz of [-0.4, 0.4]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.95, 0.07), mats.steel); leg.position.set(lx, 0.475, lz); gr.add(leg);
    }
    const shelf = new THREE.Mesh(boxGeo(len - 0.2, 0.04, 0.9, 2), mats.wood); shelf.position.y = 0.3; gr.add(shelf);
    // objetos
    for (let i = 0; i < Math.floor(len * 2.2); i++) {
      const t = R();
      let m;
      if (t < 0.35) m = new THREE.Mesh(new THREE.BoxGeometry(0.2 + R() * 0.35, 0.12 + R() * 0.3, 0.2 + R() * 0.3), R() < 0.5 ? mats.panel : mats.darkMetal);
      else if (t < 0.6) m = new THREE.Mesh(new THREE.CylinderGeometry(0.05 + R() * 0.07, 0.06 + R() * 0.07, 0.15 + R() * 0.25, 14), mats.copper);
      else if (t < 0.8) m = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.22, 14), new THREE.MeshStandardMaterial({ color: 0x9fb4a8, metalness: 0, roughness: 0.1, transparent: true, opacity: 0.45 }));
      else m = new THREE.Mesh(new THREE.TorusGeometry(0.08 + R() * 0.06, 0.025, 8, 24), mats.copper);
      m.geometry.computeBoundingBox();
      const h = m.geometry.boundingBox.max.y - m.geometry.boundingBox.min.y;
      m.position.set((R() - 0.5) * (len - 0.4), 0.99 + h / 2, (R() - 0.5) * 0.6);
      if (m.geometry.type === 'TorusGeometry') { m.rotation.x = Math.PI / 2; m.position.y = 1.02; }
      m.rotation.y = R() * Math.PI; m.castShadow = true; m.receiveShadow = true;
      gr.add(m);
    }
    gr.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return gr;
  };
  bench(-HALL + 0.6, 0, Math.PI / 2, 6);
  bench(HALL - 0.6, -2, -Math.PI / 2, 5);
  bench(10.5, HALL - 0.6, Math.PI, 4);
  bench(-10.5, -HALL + 0.6, 0, 4);

  const board = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.17), new THREE.MeshStandardMaterial({ map: chalkboard(), roughness: 0.95 }));
  board.position.set(-HALL + 0.17, 2.75, 0); board.rotation.y = Math.PI / 2; board.receiveShadow = true; root.add(board);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.35, 5.4), mats.wood); frame.position.set(-HALL + 0.12, 2.75, 0); root.add(frame);

  // estantería con frascos
  const shelfG = new THREE.Group(); shelfG.position.set(-10.5, 0, HALL - 0.45); root.add(shelfG);
  for (let s = 0; s < 4; s++) {
    const pl = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.04, 0.5), mats.wood); pl.position.y = 0.4 + s * 0.65; shelfG.add(pl);
    for (let i = 0; i < 9; i++) {
      if (R() < 0.3) continue;
      const jar = new THREE.Mesh(new THREE.CylinderGeometry(0.07 + R() * 0.05, 0.07 + R() * 0.05, 0.18 + R() * 0.22, 12), R() < 0.5 ? mats.copper : mats.panel);
      jar.position.set(-1.6 + i * 0.4, 0.42 + s * 0.65 + 0.15, 0); shelfG.add(jar);
    }
  }
  for (const sx of [-1.8, 1.8]) { const up = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.7, 0.5), mats.wood); up.position.set(sx, 1.35, 0); shelfG.add(up); }
  shelfG.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  // cajas y barriles
  for (const [x, z] of [[12.6, 12.4], [13.3, 11.2], [-12.8, -12.2], [12.9, -12.8], [-13.2, 11.8]]) {
    const s = 0.6 + R() * 0.5;
    const crate = add(new THREE.Mesh(boxGeo(s, s, s, 1), mats.wood)); crate.position.set(x, s / 2, z); crate.rotation.y = R();
    if (R() < 0.6) { const c2 = add(new THREE.Mesh(boxGeo(s * 0.8, s * 0.8, s * 0.8, 1), mats.wood)); c2.position.set(x + 0.1, s + s * 0.4, z - 0.05); c2.rotation.y = R(); }
  }
  for (const [x, z] of [[-12.5, 6.5], [-13.1, 7.3], [12.2, 7.8]]) {
    const b = add(new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.95, 20), mats.steel)); b.position.set(x, 0.475, z);
  }

  // escalera metálica hacia la puerta del muro norte
  const stairs = new THREE.Group(); stairs.position.set(3, 0, -HALL + 0.75); root.add(stairs);
  for (let i = 0; i < 18; i++) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.04, 1.2), mats.steel);
    st.position.set(-i * 0.3, 0.25 + i * 0.25, 0); stairs.add(st);
  }
  const land = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 1.4), mats.steel); land.position.set(-6.4, 4.75, 0); stairs.add(land);
  const rail1 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 6.6, 8), mats.steel);
  rail1.position.set(-2.55, 3.3, 0.6); stairs.add(rail1);
  rail1.rotation.z = Math.PI / 2 - Math.atan2(4.5, 5.4);
  const doorM = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, 0.08), mats.panel); doorM.position.set(-6.4, 5.9, -0.66); stairs.add(doorM);
  const doorLight = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.1, 0.1), new THREE.MeshBasicMaterial({ color: 0xff2a1a })); doorLight.position.set(-6.4, 7.15, -0.62); stairs.add(doorLight);
  stairs.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  // ---------- luces ----------
  const hemi = new THREE.HemisphereLight(0x6c7a8c, 0x1c140c, 0.55);
  root.add(hemi);
  const lanternGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.62, 0.3).multiplyScalar(4) });
  const lanternCage = mats.darkMetal;
  const lanterns = [];
  const lanternSpots = [
    [PILLAR - PILLAR_W / 2 - 0.12, 3.4, PILLAR - PILLAR_W / 2 - 0.12, -1, -1],
    [-PILLAR + PILLAR_W / 2 + 0.12, 3.4, PILLAR - PILLAR_W / 2 - 0.12, 1, -1],
    [PILLAR - PILLAR_W / 2 - 0.12, 3.4, -PILLAR + PILLAR_W / 2 + 0.12, -1, 1],
    [-PILLAR + PILLAR_W / 2 + 0.12, 3.4, -PILLAR + PILLAR_W / 2 + 0.12, 1, 1],
    [-HALL + 0.3, 3.9, -4.2, 1, 0],
    [HALL - 0.3, 3.9, 3.0, -1, 0],
  ];
  for (let i = 0; i < (lowPower ? 4 : lanternSpots.length); i++) {
    const [x, y, z] = lanternSpots[i];
    const lg = new THREE.Group(); lg.position.set(x, y, z); root.add(lg);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), lanternGlow); lg.add(bulb);
    const cg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 8, 1, true), new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.8, roughness: 0.4, wireframe: true }));
    lg.add(cg);
    const capTop = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.12, 8), lanternCage); capTop.position.y = 0.2; lg.add(capTop);
    const light = new THREE.PointLight(0xffa060, 9, 16, 1.6);
    lg.add(light);
    lanterns.push(light);
  }
  // pozo de luz desde una rejilla del techo
  const shaftPos = new V3(10.6, CEIL - 0.05, -10.4);
  const spot = new THREE.SpotLight(0xaec4ff, 160, 14, 0.38, 0.7, 1.4);
  spot.position.copy(shaftPos); spot.target.position.set(9.6, 0, -9.2);
  root.add(spot, spot.target);
  const grate = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.65, 0.85).multiplyScalar(1.6) }));
  grate.rotation.x = Math.PI / 2; grate.position.copy(shaftPos); grate.position.y = CEIL - 0.01; root.add(grate);
  const shaft = makeShaft(); shaft.position.set(10.1, CEIL / 2, -9.8); shaft.rotation.z = -0.12; shaft.rotation.x = 0.14; root.add(shaft);

  // luces de cada bobina (color de la portada)
  const coilLights = coils.map((c) => {
    const l = new THREE.PointLight(0x9fb8ff, 0, 22, 1.7);
    l.position.copy(c.toroid).addScaledVector(c.dir, -1.3); l.position.y += 0.5; root.add(l); return l;
  });
  // destello con sombras: la malla de la cabina proyecta su sombra en el piso
  const flash = new THREE.PointLight(0xffffff, 0, 30, 1.6);
  flash.castShadow = true;
  flash.shadow.mapSize.set(lowPower ? 256 : 768, lowPower ? 256 : 768);
  flash.shadow.bias = -0.002; flash.shadow.radius = 2;
  flash.shadow.camera.near = 0.1; flash.shadow.camera.far = 24;
  flash.position.set(0, 3.4, 0);
  root.add(flash);

  // ---------- polvo en el aire ----------
  const dust = makeDust(lowPower ? 900 : 1800);
  root.add(dust.points);

  // colisionadores para el modo cabina (segmentos XZ y círculos)
  const segs = [];
  const box = (cx, cz, w, d) => {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    segs.push([x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]);
  };
  const L = HALL - 0.35;
  segs.push([-L, -L, L, -L], [L, -L, L, L], [L, L, -L, L], [-L, L, -L, -L]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(sx * PILLAR, sz * PILLAR, PILLAR_W + 0.3, PILLAR_W + 0.3);
  box(0, 9.6, 3.2, 1.0);
  box(-HALL + 0.6, 0, 1.0, 6); box(HALL - 0.6, -2, 1.0, 5); box(10.5, HALL - 0.6, 4, 1.0); box(-10.5, -HALL + 0.6, 4, 1.0);
  const hw = CAGE_HW;
  segs.push([-hw, -hw, hw, -hw], [hw, -hw, hw, hw], [-hw, -hw, -hw, hw], [-hw, hw, -0.45, hw], [0.45, hw, hw, hw]);
  const circles = coils.map((c) => [c.base.x, c.base.z, 0.95]);

  const tmpC = new THREE.Color();
  return {
    root, coils, cage, coilLights, flash, lanterns, mats,
    colliders: { segs, circles },
    setPalette(colors) {
      coils.forEach((c, i) => { c.setPalette(colors[i]); coilLights[i].color.copy(colors[i]); });
      scope.setColor(colors[0]);
    },
    update(dt, simDt, t, info) {
      dust.update(simDt, t);
      // parpadeo cálido de las lámparas
      for (let i = 0; i < lanterns.length; i++) {
        lanterns[i].intensity = 15 * (0.92 + 0.08 * Math.sin(t * 7.1 + i * 2.3) * Math.sin(t * 3.3 + i));
      }
      for (let i = 0; i < 4; i++) {
        const v = info.levels ? info.levels[i] : 0;
        tmpC.copy(info.colors[i]).multiplyScalar(0.25 + v * 3.5);
        ledMats[i].color.copy(tmpC);
      }
      scope.draw(info.wave, info.playing);
    },
  };
}

function makeScope() {
  const c = document.createElement('canvas'); c.width = 384; c.height = 256;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  let color = '#9fb8ff';
  let phase = 0;
  return {
    tex,
    setColor(col) { color = '#' + col.getHexString(); },
    draw(wave, playing) {
      g.fillStyle = 'rgba(6,10,10,0.55)'; g.fillRect(0, 0, c.width, c.height);
      g.strokeStyle = 'rgba(160,200,190,0.12)'; g.lineWidth = 1;
      for (let x = 0; x <= c.width; x += 48) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, c.height); g.stroke(); }
      for (let y = 0; y <= c.height; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke(); }
      g.strokeStyle = color; g.lineWidth = 2.5; g.shadowColor = color; g.shadowBlur = 8;
      g.beginPath();
      const n = 192;
      for (let i = 0; i < n; i++) {
        let v;
        if (wave && wave.length) v = wave[Math.floor((i / n) * wave.length)] * 1.6;
        else { phase += 0.0006; v = Math.sin(i * 0.12 + phase * 40) * 0.08 * (1 + Math.sin(phase * 7)); }
        const x = (i / (n - 1)) * c.width, y = c.height / 2 - v * c.height * 0.42;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.stroke(); g.shadowBlur = 0;
      tex.needsUpdate = true;
    },
  };
}

function makeShaft() {
  const geo = new THREE.CylinderGeometry(0.75, 2.2, CEIL, 32, 1, true);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(0.55, 0.68, 1.0) } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 mv = modelViewMatrix*vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 uColor; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ float edge = pow(abs(dot(vN, vV)), 1.6); float a = edge * smoothstep(0.0, 0.5, vUv.y) * 0.07; gl_FragColor = vec4(uColor * a, 1.0); }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = 4;
  return m;
}

function makeDust(n) {
  const pos = new Float32Array(n * 3), seed = new Float32Array(n);
  const R = rng(77);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (R() * 2 - 1) * (HALL - 1);
    pos[i * 3 + 1] = R() * 7.5 + 0.2;
    pos[i * 3 + 2] = (R() * 2 - 1) * (HALL - 1);
    seed[i] = R();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uTex: { value: glowTexture(64) } },
    vertexShader: `uniform float uTime; attribute float aSeed; varying float vA;
      void main(){
        vec3 p = position;
        float t = uTime * (0.05 + aSeed * 0.08);
        p.x += sin(t * 2.0 + aSeed * 40.0) * 0.6;
        p.y += sin(t * 1.3 + aSeed * 17.0) * 0.35;
        p.z += cos(t * 1.7 + aSeed * 23.0) * 0.6;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (2.0 + aSeed * 5.0) * (10.0 / -mv.z);
        vA = 0.18 + aSeed * 0.3;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform sampler2D uTex; varying float vA;
      void main(){ float a = texture2D(uTex, gl_PointCoord).a; gl_FragColor = vec4(vec3(0.85, 0.82, 0.78) * a * vA, 1.0); }`,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  let time = 0;
  return {
    points,
    update(simDt) { time += simDt; mat.uniforms.uTime.value = time; },
  };
}

export { TOROID_Y };
