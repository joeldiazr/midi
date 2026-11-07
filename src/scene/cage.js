// Cabina de malla metálica en el centro del círculo. Los rayos golpean aquí.
import * as THREE from 'three';
import { chainLink } from './textures.js';

const V3 = THREE.Vector3;
export const CAGE_HW = 0.9;
export const CAGE_H = 2.5;
export const CAGE_BASE = 0.12;
const MAX_HITS = 6;

function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

export function createCage(mats) {
  const g = new THREE.Group();
  const hw = CAGE_HW, H = CAGE_H, base = CAGE_BASE;
  const link = chainLink();
  const DIAMOND = 0.075;

  const hits = Array.from({ length: MAX_HITS }, () => new THREE.Vector4(0, -10, 0, 0));
  const hitCols = Array.from({ length: MAX_HITS }, () => new THREE.Color(1, 1, 1));
  let hitIdx = 0;

  const meshMat = new THREE.MeshStandardMaterial({
    color: 0x8d9096, metalness: 0.85, roughness: 0.36,
    alphaMap: link, alphaTest: 0.42, side: THREE.DoubleSide,
  });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x55585e, metalness: 0.9, roughness: 0.33 });
  const glow = (mat) => {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uHits = { value: hits };
      sh.uniforms.uHitCols = { value: hitCols };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\nuniform vec4 uHits[${MAX_HITS}];\nuniform vec3 uHitCols[${MAX_HITS}];`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          for (int i = 0; i < ${MAX_HITS}; i++) {
            float d = distance(vWPos, uHits[i].xyz);
            totalEmissiveRadiance += uHitCols[i] * uHits[i].w * (exp(-d * 6.0) * 1.3 + exp(-d * 1.8) * 0.15);
          }`);
    };
  };
  glow(meshMat); glow(frameMat);

  const distMat = new THREE.MeshDistanceMaterial({ alphaMap: link, alphaTest: 0.42 });
  const depthMat = new THREE.MeshDepthMaterial({ alphaMap: link, alphaTest: 0.42 });

  const panel = (w, h) => {
    const geo = scaleUV(new THREE.PlaneGeometry(w, h), w / DIAMOND, h / DIAMOND);
    const m = new THREE.Mesh(geo, meshMat);
    m.castShadow = true; m.receiveShadow = false;
    m.customDistanceMaterial = distMat; m.customDepthMaterial = depthMat;
    return m;
  };

  // plataforma de goma
  const plat = new THREE.Mesh(new THREE.BoxGeometry(2.3, base, 2.3), mats.rubber);
  plat.position.y = base / 2; plat.receiveShadow = true; plat.castShadow = true; g.add(plat);

  const yMid = base + H / 2;
  // laterales: -z, +x, -x completos
  const back = panel(hw * 2, H); back.position.set(0, yMid, -hw); g.add(back);
  const right = panel(hw * 2, H); right.position.set(hw, yMid, 0); right.rotation.y = Math.PI / 2; g.add(right);
  const left = panel(hw * 2, H); left.position.set(-hw, yMid, 0); left.rotation.y = Math.PI / 2; g.add(left);
  // frente con puerta abierta (+z)
  const side = hw - 0.45;
  const f1 = panel(side, H); f1.position.set(-hw + side / 2, yMid, hw); g.add(f1);
  const f2 = panel(side, H); f2.position.set(hw - side / 2, yMid, hw); g.add(f2);
  const doorPivot = new THREE.Group(); doorPivot.position.set(-0.45, 0, hw); g.add(doorPivot);
  const door = panel(0.9, H - 0.04); door.position.set(0.45, yMid, 0); doorPivot.add(door);
  doorPivot.rotation.y = -1.75;
  // techo
  const roof = panel(hw * 2, hw * 2); roof.rotation.x = -Math.PI / 2; roof.position.set(0, base + H, 0); g.add(roof);

  // estructura
  const bar = (w, h, d, x, y, z, parent = g) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), frameMat);
    m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m;
  };
  const t = 0.05;
  for (const [x, z] of [[hw, hw], [-hw, hw], [hw, -hw], [-hw, -hw], [-0.45, hw], [0.45, hw]]) bar(t, H, t, x, yMid, z);
  for (const y of [base + 0.03, base + 1.15, base + H]) {
    bar(hw * 2 + t, t, t, 0, y, -hw);
    bar(t, t, hw * 2 + t, hw, y, 0);
    bar(t, t, hw * 2 + t, -hw, y, 0);
    bar(side, t, t, -hw + side / 2, y, hw);
    bar(side, t, t, hw - side / 2, y, hw);
  }
  bar(0.9, t, t, 0, base + H, hw);
  // marco de la puerta
  bar(t, H - 0.04, t, 0.0, yMid, 0, doorPivot);
  bar(t, H - 0.04, t, 0.9, yMid, 0, doorPivot);
  bar(0.9, t, t, 0.45, base + 0.05, 0, doorPivot);
  bar(0.9, t, t, 0.45, base + H - 0.06, 0, doorPivot);
  bar(0.9, t, t, 0.45, base + 1.15, 0, doorPivot);
  // cruz del techo
  bar(hw * 2, t, t, 0, base + H, 0);
  bar(t, t, hw * 2, 0, base + H, 0);

  // consola interior: el interruptor que lo enciende todo
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 12), frameMat);
  post.position.set(0.55, base + 0.5, -0.55); g.add(post);
  const ctrl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.24), mats.panel);
  ctrl.position.set(0.55, base + 1.08, -0.55); ctrl.rotation.y = Math.PI / 4; ctrl.rotation.x = -0.35; ctrl.castShadow = true; g.add(ctrl);
  const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 8), mats.aluminium);
  lever.position.set(0.55, base + 1.22, -0.55); lever.rotation.z = 0.5; g.add(lever);
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xff3b2e });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.016, 10, 8), ledMat);
  led.position.set(0.47, base + 1.19, -0.47); g.add(led);

  const tmp = new V3();
  return {
    group: g, material: meshMat, hits, hitCols,
    // punto de impacto en la cabina, sesgado a lo que está más cerca de la bobina
    randomTarget(from, R, outPos, outNormal) {
      const sx = Math.sign(from.x) || 1, sz = Math.sign(from.z) || 1;
      const top = base + H;
      const r = R();
      if (r < 0.42) {
        const e = R();
        if (e < 0.34) { outPos.set(sx * hw, top - R() * 0.9, sz * hw); outNormal.set(sx, 0, sz).normalize(); }
        else if (e < 0.67) { outPos.set(sx * hw - sx * R() * 0.9, top, sz * hw); outNormal.set(0, 0.6, sz).normalize(); }
        else { outPos.set(sx * hw, top, sz * hw - sz * R() * 0.9); outNormal.set(sx, 0.6, 0).normalize(); }
      } else if (r < 0.72) {
        outPos.set((R() * 1.6 - 0.6) * sx * hw, top, (R() * 1.6 - 0.6) * sz * hw); outNormal.set(0, 1, 0);
      } else if (r < 0.86) {
        outPos.set(sx * hw, base + 1.0 + R() * (H - 1.0), (R() * 2 - 1) * hw); outNormal.set(sx, 0, 0);
      } else {
        outPos.set((R() * 2 - 1) * hw, base + 1.0 + R() * (H - 1.0), sz * hw); outNormal.set(0, 0, sz);
      }
      return outPos;
    },
    addHit(pos, color, intensity) {
      const h = hits[hitIdx];
      h.set(pos.x, pos.y, pos.z, Math.min(3, intensity));
      hitCols[hitIdx].copy(color);
      hitIdx = (hitIdx + 1) % MAX_HITS;
    },
    update(simDt, idleGlow) {
      if (simDt > 0) {
        const k = Math.exp(-simDt * 9);
        for (const h of hits) h.w *= k;
      }
      ledMat.color.setRGB(1, 0.23 + idleGlow * 0.4, 0.18);
      tmp.set(0, 0, 0);
    },
  };
}
