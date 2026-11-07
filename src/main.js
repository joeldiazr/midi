import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildLab } from './scene/lab.js';
import { BoltSystem } from './fx/bolts.js';
import { createPost } from './post.js';
import { AudioEngine, HUM_IDLE } from './audio/engine.js';
import { analyze, levelsAt, onsetsBetween, energyAt, busiestCoil, waveAt, BANDS } from './audio/analysis.js';
import { searchSongs } from './audio/itunes.js';
import { extractPalette, paletteFromHex, DEFAULT_PALETTE } from './audio/palette.js';
import { CabinCam } from './camera/cabin.js';
import { Director } from './camera/cinematic.js';
import { rng } from './scene/textures.js';
import { SCREEN_W, SCREEN_H } from './scene/computer.js';

const $ = (s) => document.querySelector(s);
const body = document.body;
const ROMAN = ['I', 'II', 'III', 'IV'];
const isTouch = matchMedia('(pointer: coarse)').matches;
const lowPower = matchMedia('(max-width: 760px)').matches || (navigator.hardwareConcurrency || 8) <= 4;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const pad2 = (n) => String(n).padStart(2, '0');
const fmt = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = Math.floor(t % 60), c = Math.floor((t % 1) * 100); return `${pad2(m)}:${pad2(s)}.${pad2(c)}`; };

// ---------- cargador ----------
const ld = { shown: 0, target: 0 };
const ldCount = $('#ld-count');
function setLoad(p) { ld.target = Math.max(ld.target, p); }
(function tickLoader() {
  ld.shown += (ld.target - ld.shown) * 0.12;
  ldCount.textContent = Math.round(ld.shown * 100);
  if (body.classList.contains('is-loading')) requestAnimationFrame(tickLoader);
})();

// ---------- render ----------
const canvas = $('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
let PR = Math.min(window.devicePixelRatio || 1, lowPower ? 1.25 : 1.5);
renderer.setPixelRatio(PR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050506);
scene.fog = new THREE.FogExp2(0x060608, 0.03);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 90);
camera.position.set(8, 2, 8);

const S = {
  mode: 'cine', status: 'idle', track: null, an: null, palette: paletteFromHex(DEFAULT_PALETTE),
  songT: 0, prevSongT: 0, sound: true, coil: false, token: 0,
};

let lab, bolts, post, cabin, director;
const audio = new AudioEngine();

async function boot() {
  setLoad(0.08);
  await Promise.race([
    Promise.all([document.fonts.load('500 48px Caveat'), document.fonts.load('500 20px "JetBrains Mono"'), document.fonts.load('500 20px "Inter Tight"')]).catch(() => {}),
    wait(2200),
  ]);
  setLoad(0.25);
  await wait(30);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.09;
  lab = buildLab(scene, { lowPower });
  setLoad(0.55);
  await wait(30);
  bolts = new BoltSystem(scene, lab);
  // cada rayo suena donde cae: paneo según la cámara y volumen según la distancia
  const tv = new THREE.Vector3(), tr = new THREE.Vector3();
  bolts.onStrike = (ci, s, pos) => {
    tv.subVectors(pos, camera.position);
    const dist = tv.length() || 1;
    tv.divideScalar(dist);
    tr.set(1, 0, 0).applyQuaternion(camera.quaternion);
    audio.zap(ci, s, tv.dot(tr) * 0.85, Math.min(1.1, Math.max(0.45, 4 / dist)));
  };
  post = createPost(renderer, scene, camera, { lowPower });
  post.setSize(innerWidth, innerHeight, PR);
  cabin = new CabinCam(camera, canvas, lab.colliders);
  director = new Director(camera, lab, onShot);
  applyPalette(S.palette);
  buildMeters();
  setLoad(0.75);
  await wait(30);
  renderer.compile(scene, camera);
  renderer.shadowMap.needsUpdate = true;
  setMode('cine');
  frame();
  if (import.meta.env.DEV) window.__arco = { S, SV, cabin, director, camera, lab, bolts, audio, renderer, post, setMode, loadTrack, togglePause, openSearch, closeSearch };
  setLoad(1);
  await wait(900);
  body.classList.remove('is-loading');
  await wait(300);
  body.classList.add('ready');
}

// ---------- paleta ----------
function applyPalette(pal) {
  S.palette = pal;
  bolts && bolts.setPalette(pal.glow);
  lab && lab.setPalette(pal.glow);
  document.documentElement.style.setProperty('--accent', pal.css[0]);
  $('#swatches').innerHTML = pal.css.map((c) => `<i style="color:${c}"></i>`).join('');
  document.querySelectorAll('.meter').forEach((m, i) => { m.style.color = pal.css[i]; });
}

function buildMeters() {
  $('#meters').innerHTML = BANDS.map((b, i) => `<div class="meter"><em>${b.name}</em><div class="col"><i></i></div><span class="n">${ROMAN[i]}</span></div>`).join('');
  applyPalette(S.palette);
}

// ---------- cámaras ----------
function onShot(n, name, sub) {
  if (S.mode !== 'cine') return;
  $('#shot-name').textContent = `PLANO ${pad2(n)} — ${name}`;
  const parts = [];
  if (sub >= 0) parts.push(`BOBINA ${ROMAN[sub]} · ${BANDS[sub].name}`);
  if (S.an && S.status !== 'idle') parts.push(`${Math.round(S.an.bpm)} BPM`);
  $('#shot-meta').textContent = parts.join(' · ');
}

let hintTimer = 0;
function setMode(m) {
  S.mode = m;
  body.classList.toggle('mode-cabin', m === 'cabin');
  body.classList.toggle('mode-cine', m === 'cine');
  $('#cam-label').textContent = m === 'cabin' ? 'CABINA' : 'CINE';
  body.classList.add('show-shot');
  const hint = $('#hint');
  if (m === 'cabin') {
    cabin.enter(camera, lab.coils[director.subject || 0]);
    $('#shot-name').textContent = 'CABINA — PRIMERA PERSONA';
    $('#shot-meta').textContent = S.an && S.status !== 'idle' ? `${Math.round(S.an.bpm)} BPM` : '';
    hint.textContent = isTouch ? 'ARRASTRA PARA MIRAR' : 'ARRASTRA PARA MIRAR · WASD PARA CAMINAR · SHIFT CORRE · R VUELVE A LA CABINA';
    hint.classList.add('show');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.remove('show'), 7000);
  } else {
    cabin.exit();
    hint.classList.remove('show');
    director.frozen = null;
    director.cut(dirCtx());
  }
}

// ---------- estado de reproducción ----------
function setPlayLabel() {
  const l = S.status === 'playing' ? 'PAUSA' : S.status === 'paused' ? 'CONTINUAR' : S.status === 'ended' ? 'REPETIR' : 'PLAY';
  $('#play-label').textContent = l;
  body.classList.toggle('paused', S.status === 'paused');
}

function start(t = 0) {
  audio.play(t);
  S.status = 'playing';
  S.songT = S.prevSongT = t;
  setPlayLabel();
  if (t === 0) for (let i = 0; i < 4; i++) bolts.strike(i, 0.95);
  if (S.mode === 'cine') director.cut(dirCtx());
}

function togglePause() {
  if (!S.track) { openPanel('search'); return; }
  audio.ensure();
  if (S.status === 'playing') { audio.pause(); S.status = 'paused'; S.songT = audio.time; }
  else if (S.status === 'paused') { audio.play(); S.status = 'playing'; S.prevSongT = S.songT = audio.time; }
  else if (S.status === 'ended') start(0);
  setPlayLabel();
}

audio.onEnded = () => {
  S.status = 'ended';
  S.songT = S.an ? S.an.duration : 0;
  setPlayLabel();
  toast('FIN DE LA VISTA PREVIA · ESPACIO PARA REPETIR');
};

const setBusy = (p, label) => { $('#busy-pct').textContent = Math.round(p * 100); if (label) $('#busy-label').textContent = label; };

async function loadTrack(track) {
  const token = ++S.token;
  audio.ensure();
  closePanels();
  if (S.status === 'playing' || S.status === 'paused') audio.pause();
  S.status = 'loading';
  body.classList.remove('paused');
  body.classList.add('busy-on');
  setBusy(0, 'DESCARGANDO VISTA PREVIA');
  try {
    const palP = track.art ? extractPalette(track.art).catch(() => null) : Promise.resolve(null);
    const buffer = track.buffer || (await audio.fetchBuffer(track.preview, (p) => setBusy(p * 0.5, 'DESCARGANDO VISTA PREVIA')));
    if (token !== S.token) return;
    const an = await analyze(buffer, (p) => setBusy(0.5 + p * 0.44, 'ESCUCHANDO GRAVES, VOCES Y PULSO'));
    if (token !== S.token) return;
    setBusy(0.96, 'EXTRAYENDO COLORES DE LA PORTADA');
    const pal = (await palP) || paletteFromHex(DEFAULT_PALETTE);
    if (token !== S.token) return;
    S.track = track; S.an = an;
    applyPalette(pal);
    audio.setBuffer(buffer);
    fillHud(track, an, pal);
    setBusy(1, `${Math.round(an.bpm)} BPM · LISTO`);
    await wait(380);
    if (token !== S.token) return;
    body.classList.remove('busy-on');
    body.classList.add('has-track');
    start(0);
  } catch (e) {
    console.error(e);
    if (token !== S.token) return;
    body.classList.remove('busy-on');
    S.status = S.track ? 'ended' : 'idle';
    setPlayLabel();
    toast('NO SE PUDO CARGAR ESTA CANCIÓN');
  }
}

async function loadLocal(file) {
  try {
    audio.ensure();
    const buffer = await audio.decode(await file.arrayBuffer());
    loadTrack({ title: file.name.replace(/\.[^.]+$/, ''), artist: 'Archivo local', buffer, art: null, url: null });
  } catch (e) {
    console.error(e);
    toast('ESE ARCHIVO NO SE PUDO LEER');
  }
}

function fillHud(track, an, pal) {
  $('#t-title').textContent = track.title;
  $('#t-artist').textContent = [track.artist, track.album].filter(Boolean).join(' · ');
  const cover = $('#cover');
  cover.style.backgroundImage = track.art ? `url("${track.thumb || track.art}")` : `linear-gradient(135deg, ${pal.css[0]}, ${pal.css[1]} 60%, ${pal.css[2]})`;
  const link = $('#t-link');
  if (track.url) { link.href = track.url; link.style.display = ''; } else link.style.display = 'none';
  const dur = an.duration;
  const beats = an.beats.length > 600 ? [] : an.beats;
  $('#beats').innerHTML = beats.map((b, k) => `<i class="${(k - an.down) % 4 === 0 ? 'down' : ''}" style="left:${(b / dur) * 100}%"></i>`).join('');
}

// ---------- paneles ----------
function openPanel(id) {
  if (id === 'search') { openSearch(); return; }
  closePanels();
  const el = $('#' + id);
  el.classList.add('open'); el.setAttribute('aria-hidden', 'false');
}
function closePanels() {
  closeSearch();
  document.querySelectorAll('.overlay.open').forEach((el) => { el.classList.remove('open'); el.setAttribute('aria-hidden', 'true'); });
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
}

// ---------- terminal: la búsqueda vive en la pantalla de la computadora de la cabina ----------
const UP = new THREE.Vector3(0, 1, 0);
const SV = {
  active: false, arrived: false, t: 0, leaving: 1, onScreen: false,
  fromPos: new THREE.Vector3(), fromQ: new THREE.Quaternion(), fromFov: 50,
  toPos: new THREE.Vector3(), toQ: new THREE.Quaternion(), toFov: 36,
};
const probeCam = new THREE.PerspectiveCamera(36, 1, 0.05, 90);
const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

function screenPose() {
  const c = new THREE.Vector3(), n = new THREE.Vector3();
  lab.computer.screenFrame(c, n);
  const vfov = 36, tn = Math.tan(THREE.MathUtils.degToRad(vfov / 2)), asp = innerWidth / innerHeight;
  const fill = 0.76;
  const d = Math.min(1.34, Math.max((SCREEN_H / 2) / tn / fill, (SCREEN_W / 2) / (tn * asp) / fill));
  SV.toPos.copy(c).addScaledVector(n, d);
  const m = new THREE.Matrix4().lookAt(SV.toPos, c, UP);
  SV.toQ.setFromRotationMatrix(m);
  SV.toFov = vfov;
}

// coloca el panel HTML exactamente sobre la pantalla 3D (o a pantalla completa si queda muy chico)
function layoutScreen() {
  const el = $('#search');
  probeCam.position.copy(SV.toPos); probeCam.quaternion.copy(SV.toQ);
  probeCam.fov = SV.toFov; probeCam.aspect = innerWidth / innerHeight; probeCam.updateProjectionMatrix(); probeCam.updateMatrixWorld();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of lab.computer.corners()) {
    p.project(probeCam);
    const x = (p.x * 0.5 + 0.5) * innerWidth, y = (-p.y * 0.5 + 0.5) * innerHeight;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const w = x1 - x0, h = y1 - y0;
  SV.onScreen = w >= 560 && h >= 340;
  el.classList.toggle('on-screen', SV.onScreen);
  el.style.transform = SV.onScreen ? `translate(${x0}px, ${y0}px) scale(${w / 1000}, ${h / 625})` : '';
}

function openSearch() {
  if (SV.active) { $('#q').focus(); return; }
  closePanels();
  SV.active = true; SV.arrived = false; SV.t = 0;
  SV.fromPos.copy(camera.position); SV.fromQ.copy(camera.quaternion); SV.fromFov = camera.fov;
  screenPose(); layoutScreen();
  cabin.active = false;
  body.classList.add('screen-view');
  const el = $('#search');
  el.classList.add('open'); el.setAttribute('aria-hidden', 'false');
  if (!SV.onScreen) setTimeout(() => $('#q').focus(), 60);
}

function closeSearch() {
  if (!SV.active) return;
  SV.active = false; SV.arrived = false; SV.leaving = 0;
  SV.fromPos.copy(camera.position); SV.fromQ.copy(camera.quaternion); SV.fromFov = camera.fov;
  body.classList.remove('screen-view', 'screen-arrived');
  const el = $('#search');
  el.classList.remove('open'); el.setAttribute('aria-hidden', 'true');
  if (S.mode === 'cabin') cabin.active = true;
  else { director.frozen = null; director.cut(dirCtx()); }
}

function setFov(f) { if (Math.abs(camera.fov - f) > 0.01) { camera.fov = f; camera.updateProjectionMatrix(); } }

function updateScreenCamera(dt) {
  if (SV.active) {
    SV.t += dt;
    const e = easeIO(Math.min(1, SV.t / 1.4));
    camera.position.lerpVectors(SV.fromPos, SV.toPos, e);
    camera.quaternion.slerpQuaternions(SV.fromQ, SV.toQ, e);
    camera.up.set(0, 1, 0);
    setFov(SV.fromFov + (SV.toFov - SV.fromFov) * e);
    if (e >= 1 && !SV.arrived) {
      SV.arrived = true;
      body.classList.add('screen-arrived');
      $('#q').focus({ preventScroll: true });
    }
    return true;
  }
  return false;
}
// mezcla suave desde la pantalla hacia la cámara activa al cerrar
function blendFromScreen(dt) {
  if (SV.leaving >= 1) return;
  SV.leaving = Math.min(1, SV.leaving + dt / 1.2);
  const e = easeIO(SV.leaving);
  camera.position.lerpVectors(SV.fromPos, camera.position, e);
  camera.quaternion.slerpQuaternions(SV.fromQ, camera.quaternion.clone(), e);
  setFov(SV.fromFov + (camera.fov - SV.fromFov) * e);
}
const anyPanel = () => !!document.querySelector('.overlay.open');

let toastT = 0;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 3200);
}

// búsqueda
const SUGGEST = [
  ['La de la película', 'Secrets OneRepublic'],
  ['Daft Punk', 'Daft Punk Get Lucky'],
  ['Queen', 'Bohemian Rhapsody'],
  ['The Weeknd', 'Blinding Lights'],
  ['AC/DC', 'Thunderstruck'],
  ['Soda Stereo', 'De Música Ligera'],
  ['Bad Bunny', 'Bad Bunny'],
];
$('#chips').innerHTML = SUGGEST.map(([l, q]) => `<button data-q="${q}">${l}</button>`).join('');
$('#chips').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  $('#q').value = b.dataset.q; runSearch(b.dataset.q);
});
let lastResults = [];
let searchT = 0;
$('#q').addEventListener('input', (e) => {
  clearTimeout(searchT);
  const v = e.target.value;
  searchT = setTimeout(() => runSearch(v), 320);
});
$('#q').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { clearTimeout(searchT); runSearch(e.target.value, true); }
  if (e.key === 'ArrowDown') { const f = $('#results li[tabindex]'); if (f) { e.preventDefault(); f.focus(); } }
});
async function runSearch(q, playFirst = false) {
  const list = $('#results');
  if (!q.trim()) { list.innerHTML = ''; return; }
  list.innerHTML = '<li class="empty mono">BUSCANDO…</li>';
  try {
    const res = await searchSongs(q);
    lastResults = res;
    if (!res.length) { list.innerHTML = '<li class="empty mono">SIN RESULTADOS CON VISTA PREVIA</li>'; return; }
    list.innerHTML = res.map((r, i) => `
      <li tabindex="0" data-i="${i}" style="animation-delay:${i * 0.035}s">
        <span class="r-idx mono">${pad2(i + 1)}</span>
        <img src="${r.thumb}" alt="" loading="lazy" />
        <div><div class="r-title">${esc(r.title)}</div><div class="r-artist mono">${esc(r.artist)}</div></div>
        <div class="r-album">${esc(r.album || '')}${r.year ? ' — ' + r.year : ''}</div>
        <span class="r-dur mono">0:30 ▶</span>
      </li>`).join('');
    if (playFirst && res[0]) loadTrack(res[0]);
  } catch (e) {
    if (e.name === 'AbortError') return;
    list.innerHTML = '<li class="empty mono">SIN CONEXIÓN CON EL CATÁLOGO</li>';
  }
}
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
$('#results').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-i]'); if (!li) return;
  loadTrack(lastResults[+li.dataset.i]);
});
$('#results').addEventListener('keydown', (e) => {
  const li = e.target.closest('li[data-i]'); if (!li) return;
  if (e.key === 'Enter') loadTrack(lastResults[+li.dataset.i]);
  if (e.key === 'ArrowDown' && li.nextElementSibling) { e.preventDefault(); li.nextElementSibling.focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); (li.previousElementSibling || $('#q')).focus(); }
});
$('#file').addEventListener('change', (e) => { const f = e.target.files[0]; if (f) loadLocal(f); e.target.value = ''; });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer && e.dataTransfer.files[0];
  if (f && f.type.startsWith('audio')) loadLocal(f);
});

// botones
$('#btn-search').addEventListener('click', () => openPanel('search'));
$('#cta').addEventListener('click', () => openPanel('search'));
$('#btn-how').addEventListener('click', () => openPanel('how'));
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closePanels));
$('#logo').addEventListener('click', (e) => { e.preventDefault(); closePanels(); });
$('#btn-cam').addEventListener('click', () => setMode(S.mode === 'cine' ? 'cabin' : 'cine'));
$('#btn-play').addEventListener('click', togglePause);
$('#btn-coil').addEventListener('click', toggleCoil);
$('#btn-sound').addEventListener('click', toggleSound);
function toggleCoil() {
  S.coil = !S.coil;
  audio.ensure(); audio.setCoilMode(S.coil);
  $('#btn-coil').classList.toggle('on', S.coil);
  $('#coil-label').textContent = S.coil ? 'SÍ' : 'NO';
  toast(S.coil ? 'BOBINA: LOS RAYOS SE ESCUCHAN' : 'SONIDO LIMPIO');
}
function toggleSound() {
  S.sound = !S.sound; audio.ensure(); audio.setMuted(!S.sound);
  body.classList.toggle('sound-on', S.sound);
}
const prog = $('#progress');
prog.addEventListener('pointerdown', (e) => {
  if (!S.an) return;
  const seek = (ev) => {
    const r = prog.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * S.an.duration;
    audio.seek(t); S.songT = S.prevSongT = t;
    if (S.status === 'ended') start(t);
    director.resync(dirCtx());
  };
  seek(e);
  prog.setPointerCapture(e.pointerId);
  const mv = (ev) => seek(ev);
  const up = () => { prog.removeEventListener('pointermove', mv); prog.removeEventListener('pointerup', up); };
  prog.addEventListener('pointermove', mv); prog.addEventListener('pointerup', up);
});

// primer gesto: arranca el audio (zumbido del sótano)
const firstGesture = () => {
  audio.ensure(); audio.setMuted(!S.sound); body.classList.toggle('sound-on', S.sound);
  window.removeEventListener('pointerdown', firstGesture); window.removeEventListener('keydown', firstGesture);
};
window.addEventListener('pointerdown', firstGesture);
window.addEventListener('keydown', firstGesture);

window.addEventListener('keydown', (e) => {
  const typing = e.target && (e.target.tagName === 'INPUT');
  if (e.key === 'Escape') { closePanels(); return; }
  if (typing) return;
  if (e.code === 'Space') { e.preventDefault(); if (anyPanel()) return; togglePause(); }
  else if (e.code === 'KeyV') setMode(S.mode === 'cine' ? 'cabin' : 'cine');
  else if (e.code === 'KeyB') toggleCoil();
  else if (e.code === 'KeyM') toggleSound();
  else if (e.code === 'KeyR' && S.mode === 'cabin') cabin.reset(lab.coils[0]);
  else if (e.key === '/') { e.preventDefault(); openPanel('search'); }
});

function resize() {
  renderer.setPixelRatio(PR);
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  post && post.setSize(innerWidth, innerHeight, PR);
  if (SV.active && lab) { screenPose(); layoutScreen(); if (SV.arrived) SV.t = 99; }
}
window.addEventListener('resize', resize);

// resolución adaptativa: baja la densidad de píxeles si la GPU no llega a ~50 fps
const BASE_PR = PR;
const perf = { acc: 0, n: 0, scale: 1, good: 0 };
function adaptResolution(rawDt) {
  if (document.visibilityState !== 'visible' || rawDt > 0.25 || !post) return;
  perf.acc += rawDt; perf.n++;
  if (perf.acc < 1.2) return;
  const avg = perf.acc / perf.n;
  perf.acc = 0; perf.n = 0;
  const minScale = 0.5 / BASE_PR;
  if (avg > 1 / 48 && perf.scale > minScale) {
    perf.scale = Math.max(minScale, perf.scale * (avg > 1 / 30 ? 0.78 : 0.88)); perf.good = 0;
  } else if (avg < 1 / 57 && perf.scale < 1) {
    if (++perf.good >= 3) { perf.scale = Math.min(1, perf.scale * 1.08); perf.good = 0; } else return;
  } else return;
  PR = BASE_PR * perf.scale;
  resize();
}

// ---------- bucle ----------
const levels = [0, 0, 0, 0], onsets = [0, 0, 0, 0];
const idleTimers = [1.2, 2.4, 3.3, 4.1];
const wave = new Float32Array(192);
const R = rng(31);
let lastNow = performance.now();
let simT = 0, freezeAmt = 0, hudT = 0, kick = 0, realT = 0;
let meterEls = null;

function dirCtx() {
  const playing = S.status === 'playing';
  return {
    an: S.an, songT: S.songT, playing, paused: S.status === 'paused',
    energy: S.an && (playing || S.status === 'paused') ? energyAt(S.an, S.songT) : 0.3,
    subject: S.an && playing ? busiestCoil(S.an, S.songT, 2.5) : Math.floor(R() * 4),
    bigHit: playing && (onsets[0] > 0.82 || onsets[0] + onsets[1] + onsets[2] + onsets[3] > 2.3),
    shake: bolts ? bolts.shake : 0, kick,
  };
}

function frame() {
  requestAnimationFrame(frame);
  const now = performance.now();
  const rawDt = (now - lastNow) / 1000;
  const dt = Math.min(rawDt, 0.05);
  lastNow = now;
  adaptResolution(rawDt);
  const playing = S.status === 'playing', paused = S.status === 'paused';
  const simDt = paused ? 0 : dt;

  if (playing && S.an) {
    S.songT = audio.time;
    levelsAt(S.an, S.songT, levels);
    onsetsBetween(S.an, S.prevSongT, S.songT, onsets);
    S.prevSongT = S.songT;
  } else if (!paused) {
    const t = simT, charge = S.status === 'loading' ? 0.18 : 0;
    for (let i = 0; i < 4; i++) {
      levels[i] = 0.07 + charge + 0.16 * (0.5 + 0.5 * Math.sin(t * 0.6 + i * 1.9)) * (0.5 + 0.5 * Math.sin(t * 1.7 + i * 0.7));
      onsets[i] = 0;
      idleTimers[i] -= dt * (charge ? 2.5 : 1);
      if (idleTimers[i] <= 0) { onsets[i] = 0.22 + R() * 0.45; idleTimers[i] = 1.3 + R() * 3.8; }
    }
  } else onsets.fill(0);
  simT += simDt;

  bolts.update(simDt, levels, onsets);
  kick = playing ? Math.max(kick * Math.exp(-dt * 6), onsets[0]) : kick * Math.exp(-dt * 6);

  // luces
  const pal = S.palette.glow;
  for (let i = 0; i < 4; i++) {
    lab.coils[i].setActivity(bolts.coilLevel[i], bolts.coilStrike[i]);
    lab.coilLights[i].intensity = 2 + bolts.coilLevel[i] * 12 + bolts.coilStrike[i] * 30;
  }
  lab.flash.intensity = bolts.flashI * 45;
  lab.flash.position.copy(bolts.flashPos);
  lab.flash.color.copy(bolts.flashColor);
  if (simDt > 0 && bolts.flashI > 0.04) renderer.shadowMap.needsUpdate = true;
  lab.cage.update(simDt, bolts.coilLevel[0]);
  const showWave = S.an && (playing || paused);
  lab.update(dt, simDt, simT, { levels: bolts.coilLevel, colors: pal, wave: showWave ? waveAt(S.an, S.songT, wave) : null, playing });
  if (audio.ctx) audio.setHum(playing ? 0.2 + (bolts.coilLevel[0] + bolts.coilLevel[1]) * 0.3 : HUM_IDLE);

  realT += dt;
  lab.computer.update(realT, {
    title: S.track && S.status !== 'loading' ? S.track.title : '', artist: S.track ? S.track.artist : '',
    bpm: S.an ? S.an.bpm : 0, status: S.status, levels: bolts.coilLevel, colors: pal,
    progress: S.an ? S.songT / S.an.duration : 0,
  });

  // cámara
  if (!updateScreenCamera(dt)) {
    if (S.mode === 'cabin') cabin.update(dt, paused ? 0 : bolts.shake, kick);
    else director.update(dt, dirCtx());
    blendFromScreen(dt);
  }
  bolts.setPixel(camera, innerHeight * PR);

  // posproceso
  freezeAmt += ((paused ? 1 : 0) - freezeAmt) * Math.min(1, dt * 4);
  const u = post.u;
  u.uFreeze.value = freezeAmt;
  if (!paused) u.uTime.value += dt;
  u.uFlash.value = Math.min(0.1, bolts.flashI * 0.025);
  u.uFlashCol.value.copy(bolts.flashColor);
  u.uCA.value = 0.0022 + Math.min(1.5, bolts.shake) * 0.004 + freezeAmt * 0.0025;
  post.composer.render();

  // HUD (~25 fps)
  hudT += dt;
  if (hudT > 0.04) {
    hudT = 0;
    if (!meterEls) meterEls = [...document.querySelectorAll('.meter .col i')];
    meterEls.forEach((el, i) => { el.style.height = `${Math.min(100, bolts.coilLevel[i] * 100)}%`; });
    if (S.an) {
      const d = S.an.duration, p = Math.min(1, S.songT / d);
      $('#fill').style.width = `${p * 100}%`;
      $('#head').style.left = `${p * 100}%`;
      $('#time').textContent = `${fmt(S.songT)} / ${fmt(d)}`;
      $('#f-time').textContent = `${fmt(S.songT)} · ${Math.round(S.an.bpm)} BPM`;
    }
  }
}

boot().catch((e) => {
  console.error(e);
  $('.ld-label').textContent = 'ESTE NAVEGADOR NO PUDO INICIAR WEBGL';
});
