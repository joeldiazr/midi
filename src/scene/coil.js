// Bobina de Tesla: pedestal, primario en espiral, secundario bobinado y toroide.
import * as THREE from 'three';

const V3 = THREE.Vector3;
export const TOROID_Y = 3.42;
export const TOROID_R = 0.67;

const coronaVS = /* glsl */ `
  varying vec3 vN; varying vec3 vV; varying float vY;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position,1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    vY = uv.y;
    gl_Position = projectionMatrix * mv;
  }`;
const coronaFS = /* glsl */ `
  uniform vec3 uColor; uniform float uI;
  varying vec3 vN; varying vec3 vV; varying float vY;
  void main(){
    float f = 1.0 - abs(dot(vN, vV));
    float a = pow(f, 2.2) * uI * (0.55 + 0.45 * vY);
    gl_FragColor = vec4(uColor * a, 1.0);
  }`;

function corona(geo, color) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uI: { value: 0 } },
    vertexShader: coronaVS, fragmentShader: coronaFS,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, m);
  mesh.renderOrder = 5;
  return mesh;
}

export function createCoil(index, angle, radius, mats) {
  const g = new THREE.Group();
  const x = Math.cos(angle) * radius, z = Math.sin(angle) * radius;
  g.position.set(x, 0, z);
  g.rotation.y = -angle;

  const cast = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

  // pedestal metálico con zócalo
  const ped = cast(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.34, 1.3), mats.darkMetal));
  ped.position.y = 0.17; g.add(ped);
  const plinth = cast(new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.05, 1.42), mats.rubber));
  plinth.position.y = 0.025; g.add(plinth);
  // ruedas / patas
  for (const [px, pz] of [[0.55, 0.55], [-0.55, 0.55], [0.55, -0.55], [-0.55, -0.55]]) {
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 12), mats.darkMetal);
    foot.position.set(px, 0.025, pz); g.add(foot);
  }
  // cubierta aislante
  const deck = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.98, 0.98, 0.06, 64), mats.insulator));
  deck.position.y = 0.37; g.add(deck);
  // postes del primario
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.16, 0.5), mats.insulator);
    post.position.set(Math.cos(a) * 0.58, 0.46, Math.sin(a) * 0.58);
    post.rotation.y = -a + Math.PI / 2;
    g.add(post);
  }
  // primario: espiral plana de tubo de cobre
  const pts = [];
  const turns = 5.5;
  for (let k = 0; k <= 320; k++) {
    const t = k / 320, a = t * turns * Math.PI * 2, r = 0.33 + t * 0.5;
    pts.push(new V3(Math.cos(a) * r, 0.55 + t * 0.03, Math.sin(a) * r));
  }
  const primary = cast(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 480, 0.017, 6), mats.copper));
  g.add(primary);
  // riel de protección
  const rail = new THREE.Mesh(new THREE.TorusGeometry(0.93, 0.014, 6, 72), mats.copper);
  rail.rotation.x = Math.PI / 2; rail.position.y = 0.62; g.add(rail);
  // secundario
  const secH = 2.55, secY = 0.64 + secH / 2;
  const sec = cast(new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, secH, 48, 1, true), mats.windings));
  sec.position.y = secY; g.add(sec);
  const capB = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.215, 0.06, 40), mats.insulatorDark);
  capB.position.y = 0.66; g.add(capB);
  const capT = new THREE.Mesh(new THREE.CylinderGeometry(0.215, 0.215, 0.05, 40), mats.insulatorDark);
  capT.position.y = 0.64 + secH; g.add(capT);
  // soporte y toroide
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.25, 16), mats.aluminium);
  stem.position.y = 0.64 + secH + 0.12; g.add(stem);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.03, 48), mats.aluminium);
  plate.position.y = TOROID_Y; g.add(plate);
  const tor = cast(new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.17, 32, 96), mats.aluminium));
  tor.rotation.x = Math.PI / 2; tor.position.y = TOROID_Y; g.add(tor);
  // punto de ruptura hacia la cabina (el grupo mira hacia -angle, la cabina queda en -x local)
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.28, 8), mats.aluminium);
  rod.rotation.z = Math.PI / 2; rod.position.set(-0.8, TOROID_Y, 0); g.add(rod);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), mats.aluminium);
  tip.position.set(-0.94, TOROID_Y, 0); g.add(tip);

  // electrónica en el pedestal (driver + LEDs)
  const box = cast(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.22, 0.34), mats.panel));
  box.position.set(0.55, 0.11, 0.85); g.add(box);
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.01), ledMat);
  led.position.set(0.42, 0.16, 1.025); g.add(led);
  const led2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.01), new THREE.MeshBasicMaterial({ color: 0xff5a3a }));
  led2.position.set(0.5, 0.16, 1.025); g.add(led2);
  // placa con número romano
  const label = makeLabel(['I', 'II', 'III', 'IV'][index]);
  label.position.set(0.66, 0.2, 0); label.rotation.y = Math.PI / 2; g.add(label);

  // coronas (brillo violáceo del aire ionizado)
  const corSec = corona(new THREE.CylinderGeometry(0.26, 0.26, secH + 0.1, 32, 1, true), 0x9f8bff);
  corSec.position.y = secY; g.add(corSec);
  const corTor = corona(new THREE.TorusGeometry(0.5, 0.26, 16, 64), 0x9f8bff);
  corTor.rotation.x = Math.PI / 2; corTor.position.y = TOROID_Y; g.add(corTor);

  const toroid = new V3(x, TOROID_Y, z);
  const dir = new V3(x, 0, z).normalize();
  return {
    index, angle, group: g, base: new V3(x, 0, z), toroid, dir,
    tip: new V3(x - dir.x * 0.94, TOROID_Y, z - dir.z * 0.94),
    setPalette(color) {
      corSec.material.uniforms.uColor.value.copy(color).lerp(new THREE.Color(0x9f8bff), 0.35);
      corTor.material.uniforms.uColor.value.copy(color).lerp(new THREE.Color(0x9f8bff), 0.35);
      ledMat.color.copy(color);
    },
    setActivity(level, strike) {
      corSec.material.uniforms.uI.value = 0.03 + level * 0.18 + strike * 0.2;
      corTor.material.uniforms.uI.value = 0.01 + level * 0.05 + strike * 0.08;
      led.scale.setScalar(0.6 + level * 1.2);
    },
  };
}

function makeLabel(text) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#c9c3b6'; g.fillRect(0, 0, 128, 64);
  g.strokeStyle = '#2a2622'; g.lineWidth = 4; g.strokeRect(4, 4, 120, 56);
  g.fillStyle = '#1b1814'; g.font = '600 38px "Inter Tight", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 64, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.13), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, metalness: 0.2 }));
}
