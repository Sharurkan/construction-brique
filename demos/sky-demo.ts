/**
 * Démo du ciel « Blocs » (style A, choisi par l'utilisateur) : nuages, soleil, montgolfières,
 * arc-en-ciel, oiseaux et dragon, construits en cubes avec les tuiles Kenney du jeu.
 * Utilise le VRAI module du jeu (src/game/sky/sky.ts) ; les boutons « Soleil 1 / 2 / 3 »
 * comparent les variantes du soleil (1 = celle intégrée au jeu).
 *
 * Le monde est généré par le vrai moteur (generateWorld + WorldRenderer + atlas Kenney réel),
 * avec le même brouillard (32–90), le même champ de vision (70°) et le même camera.far (120) que
 * src/game/game.ts. Caméra à hauteur des yeux du joueur, au centre du monde.
 */
import * as THREE from 'three';
import { World, WorldRenderer, findSpawn, generateWorld } from '../src/engine';
import { loadBlockTextures } from '../src/game/atlas';
import { BlockSky, DEFAULT_SUN_VARIANT } from '../src/game/sky/sky';
import { createSoftSun } from './sky/soft-sun';

// Valeurs reprises de src/game/game.ts (non exportées).
const FOG_NEAR = 32;
const FOG_FAR = 90;
const CAMERA_FAR = 120;
const FOV = 70;
const EYE_HEIGHT = 1.6; // src/player/player.ts
const SKY = 0x7ec8ff;

const params = new URLSearchParams(location.search);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
renderer.autoClear = false; // comme dans le jeu quand le ciel est actif
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(SKY, FOG_NEAR, FOG_FAR);
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, CAMERA_FAR);

function resize(): void {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- Regard : glisser pour tourner + rotation lente automatique ----------
let yaw = Number(params.get('yaw') ?? 0.6);
let pitch = Number(params.get('pitch') ?? 0.32);
let autoRotate = !params.has('pause');
const AUTO_SPEED = 0.07; // rad/s : un tour en ~90 s
let dragging = false;
let lastX = 0;
let lastY = 0;
const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
  dragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  yaw += (e.clientX - lastX) * 0.005;
  pitch = Math.max(-0.5, Math.min(1.4, pitch + (e.clientY - lastY) * 0.005));
  lastX = e.clientX;
  lastY = e.clientY;
});
const endDrag = (): void => {
  dragging = false;
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

const pauseBtn = document.getElementById('pause') as HTMLButtonElement;
const syncPause = (): void => {
  pauseBtn.textContent = autoRotate ? '⏸ Pause rotation' : '▶ Reprendre rotation';
};
pauseBtn.addEventListener('click', () => {
  autoRotate = !autoRotate;
  syncPause();
});
syncPause();

// ---------- Ciel + variantes du soleil ----------
let wool: HTMLCanvasElement;
let planks: HTMLCanvasElement;
let sky: BlockSky | null = null;
let sunVariant = 1;
let skyTime = 0;

const SUNS = [
  { n: 1, name: 'Soleil 1', text: 'Disque « pixel » en escalier (blocs plats), jaune chaud, halo doux en 2 anneaux fondus dans le bleu. Toujours de face. Intégré au jeu.' },
  { n: 2, name: 'Soleil 2', text: 'Le même disque + 8 rayons en blocs qui tournent lentement.' },
  { n: 3, name: 'Soleil 3', text: 'Disque plat lisse (pas en blocs), toujours rond, halo transparent dégradé. +1 draw call.' },
];

function buildSky(variant: number): void {
  sky?.dispose();
  sky = new BlockSky(wool, planks, { sun: variant === 3 ? 0 : (variant as 1 | 2) });
  if (variant === 3) sky.scene.add(createSoftSun());
  sky.update(skyTime); // reprend l'animation au même instant
  sunVariant = variant;
  for (const b of document.querySelectorAll<HTMLButtonElement>('.sun')) b.classList.toggle('on', Number(b.dataset.n) === variant);
  renderLegend();
  const u = new URL(location.href);
  u.searchParams.set('sun', String(variant));
  history.replaceState(null, '', u);
}

function buildButtons(): void {
  const bar = document.getElementById('suns')!;
  for (const s of SUNS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sun';
    b.dataset.n = String(s.n);
    b.textContent = s.name + (s.n === DEFAULT_SUN_VARIANT ? ' ★' : '');
    b.addEventListener('click', () => buildSky(s.n));
    bar.appendChild(b);
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === '1' || e.key === '2' || e.key === '3') buildSky(Number(e.key));
    if (e.key === ' ') pauseBtn.click();
  });
}

const LIC = 'Tuiles Kenney Voxel Pack (CC0) · forme construite en code';
const ROWS = [
  { name: 'Nuages', what: '5 galettes de gros blocs blancs qui dérivent lentement', src: 'Laine blanche du jeu' },
  { name: 'Soleil', what: '', src: 'Laine teintée jaune / orangé ; halo = blocs couleur ciel mélangée' },
  { name: 'Montgolfières', what: '3 boules de laine à rayures qui montent, descendent et tournent', src: 'Laine teintée + nacelle en planches du jeu' },
  { name: 'Arc-en-ciel', what: 'Arche « pixelisée » de blocs de laine, 7 couleurs, en face du soleil', src: 'Laine teintée du jeu' },
  { name: 'Oiseaux', what: '3 vols en V (5, 3 et 4 oiseaux) qui font le tour du ciel, ailes qui battent', src: 'Laine teintée du jeu' },
  { name: 'Dragon', what: 'Un dragon vert rigolo (grands yeux, petite dent) qui fait de grands cercles lents', src: 'Laine teintée du jeu, aucun feu' },
];

const cardsEl = document.getElementById('cards')!;
const costEl = document.getElementById('cost')!;
let liveEl: HTMLElement | null = null;

function renderLegend(): void {
  const sunText = SUNS[sunVariant - 1].text;
  cardsEl.innerHTML = ROWS.map(
    (r) =>
      `<div class="card"><span class="name">${r.name}</span><span class="badge proc">Blocs</span>` +
      `<div class="what">${r.what || sunText}</div><div class="src">${r.src}</div></div>`,
  ).join('');
  const s = sky!;
  costEl.innerHTML =
    `<span class="tag">A · Blocs</span><span>${LIC} — aucune image ajoutée · ` +
    `${sunVariant === 3 ? 2 : 1} draw call${sunVariant === 3 ? 's' : ''} · ${s.cubes} cubes instanciés · ≈ ${s.triangles.toLocaleString('fr-FR')} triangles · ` +
    `1 matériau, texture 64×128 px · coût tablette : faible</span><span class="live" id="live"></span>`;
  liveEl = document.getElementById('live');
}

// ---------- Chargement ----------
async function main(): Promise<void> {
  const { atlas, tiles } = await loadBlockTextures();
  if (!tiles) throw new Error('Tuiles du jeu indisponibles');
  wool = tiles.get('wool_white')!;
  planks = tiles.get('planks')!;

  const world = new World();
  generateWorld(world, Number(params.get('seed') ?? 20240611));
  const worldRenderer = new WorldRenderer(world, scene, atlas);
  worldRenderer.rebuildAll();
  const spawn = findSpawn(world);
  camera.position.set(spawn.x, spawn.y + EYE_HEIGHT, spawn.z);

  buildButtons();
  buildSky(Math.min(3, Math.max(1, Number(params.get('sun') ?? DEFAULT_SUN_VARIANT))));
  document.getElementById('loading')!.remove();
  Object.assign(window, { scene, camera, renderer, getSky: () => sky });
  loop();
}

// ---------- Boucle ----------
const fpsEl = document.getElementById('fps')!;
let lastT = performance.now();
let frames = 0;
let lastFpsT = performance.now();

function loop(): void {
  requestAnimationFrame(loop);
  const nowT = performance.now();
  const dt = Math.min((nowT - lastT) / 1000, 0.1);
  lastT = nowT;
  skyTime += dt;
  if (autoRotate && !dragging) yaw += AUTO_SPEED * dt;
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  sky!.update(dt);
  sky!.render(renderer, camera);
  const skyTris = renderer.info.render.triangles;
  renderer.render(scene, camera);
  frames++;
  const now = performance.now();
  if (now - lastFpsT >= 500) {
    const fps = (frames * 1000) / (now - lastFpsT);
    fpsEl.textContent = `${fps.toFixed(0)} fps`;
    if (liveEl) {
      liveEl.textContent =
        `mesuré : ciel ${sky!.lastCalls} draw call(s) / ${skyTris.toLocaleString('fr-FR')} tri · ` +
        `monde ${renderer.info.render.calls} draw calls · ${fps.toFixed(0)} fps`;
    }
    frames = 0;
    lastFpsT = now;
  }
}

main().catch((e) => {
  console.error(e);
  fpsEl.textContent = 'Erreur : ' + String(e);
});
