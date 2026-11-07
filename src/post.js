// Posproceso: bloom + aberración cromática, grano, viñeta, destello y "tiempo detenido".
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uTime: { value: 0 },
    uCA: { value: 0.003 },
    uGrain: { value: 0.07 },
    uVig: { value: 1 },
    uFlash: { value: 0 },
    uFlashCol: { value: new THREE.Color(1, 1, 1) },
    uFreeze: { value: 0 },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uTime, uCA, uGrain, uVig, uFlash, uFreeze; uniform vec3 uFlashCol;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main(){
      vec2 uv = vUv; vec2 d = uv - 0.5; float r2 = dot(d, d);
      vec2 off = d * uCA * (0.5 + r2 * 4.0);
      vec3 col;
      col.r = texture2D(tDiffuse, uv - off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv + off).b;
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      vec3 frozen = mix(col, vec3(lum) * vec3(0.88, 0.96, 1.1), 0.5) * (1.0 + 0.08 * uFreeze);
      col = mix(col, frozen, uFreeze);
      col += uFlashCol * uFlash * (0.6 + 0.4 * (1.0 - r2 * 2.0));
      float v = smoothstep(0.92, 0.22, sqrt(r2) * 1.2);
      col *= mix(1.0, v, uVig);
      float g = hash(floor(uv * uRes) + fract(uTime * 0.37) * vec2(113.1, 71.7)) - 0.5;
      col += g * uGrain * (1.0 - lum * 0.6);
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createPost(renderer, scene, camera, { lowPower = false } = {}) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const size = renderer.getSize(new THREE.Vector2());
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x * 0.5, size.y * 0.5), 0.9, 0.55, 0.82);
  composer.addPass(bloom);
  // el bloom trabaja a media resolución (EffectComposer lo redimensiona a tamaño completo)
  const setBloomSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => setBloomSize(Math.max(1, Math.round(w * (lowPower ? 0.35 : 0.5))), Math.max(1, Math.round(h * (lowPower ? 0.35 : 0.5))));
  composer.addPass(new OutputPass());
  const final = new ShaderPass(FinalShader);
  composer.addPass(final);
  return {
    composer, bloom, final, u: final.uniforms,
    setSize(w, h, pr) {
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      final.uniforms.uRes.value.set(w * pr, h * pr);
    },
  };
}
