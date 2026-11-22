/**
 * Démo comparative du ciel : nuages, soleil, montgolfières, arc-en-ciel, oiseaux.
 * 3 styles (A Blocs / B Dessins / C Mélange), un seul affiché à la fois.
 *
 * Ne modifie pas le jeu : le monde est généré par le VRAI moteur (generateWorld + WorldRenderer +
 * atlas Kenney réel), avec le même brouillard (32–90), le même champ de vision (70°) et le même
 * camera.far (120) que src/game/game.ts. Caméra à hauteur des yeux du joueur, au centre du monde.
 *
 * Rendu en 2 passes (solution proposée pour le jeu, voir sky/common.ts) :
 *   1. scène « ciel » (fond + éléments), caméra ciel à l'origine qui copie l'orientation du joueur ;
 *   2. effacement de la profondeur, puis le monde avec son brouillard et son far.
 */
import * as THREE from 'three';
import { World, WorldRenderer, findSpawn, generateWorld } from '../src/engine';
import { loadBlockTextures } from '../src/game/atlas';
import type { SkyStyle } from './sky/common';
import { createStyleA, createStyleB, createStyleC, loadSpriteImages, type GameTiles } from './sky/styles';

// Valeurs reprises de src/game/game.ts (non exportées).
const SKY = 0x7ec8ff;
const FOG_NEAR = 32;
const FOG_FAR = 90;
const CAMERA_FAR = 120;
const FOV = 70;
const EYE_HEIGHT = 1.6; // src/player/player.ts

const params = new URLSearchParams(location.search);

// ---------- Three.js ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.autoClear = false;
renderer.info.autoReset = false;
document.body.prepend(renderer.domElement);

/** Passe 1 : le ciel. Le fond (couleur) efface couleur + profondeur. */
const skyScene = new THREE.Scene();
skyScene.background = new THREE.Color(SKY);
const skyCamera = new THREE.PerspectiveCamera(FOV, 1, 1, 1000);

/** Passe 2 : le monde, exactement comme dans le jeu (sans fond : il est dessiné par la passe 1). */
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(SKY, FOG_NEAR, FOG_FAR);
const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, CAMERA_FAR);

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = skyCamera.aspect = w / h;
  camera.updateProjectionMatrix();
  skyCamera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---------- Regard : glisser pour tourner + rotation lente automatique ----------
let yaw = Number(params.get('yaw') ?? 0.6);
let pitch = Number(params.get('pitch') ?? 0.32); // un peu vers le haut : on regarde le ciel
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
  pitch += (e.clientY - lastY) * 0.005;
  pitch = Math.max(-0.5, Math.min(1.4, pitch));
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

// ---------- Styles ----------
const STYLE_COLORS: Record<string, string> = { A: '#e0702f', B: '#2f86e1', C: '#2fae5b' };
const STYLE_NAMES: Record<string, string> = { A: 'Blocs', B: 'Dessins', C: 'Mélange' };
let styles: SkyStyle[] = [];
let current: SkyStyle | null = null;
const buttons = new Map<string, HTMLButtonElement>();

function buildButtons(): void {
  const bar = document.getElementById('styles')!;
  for (const letter of ['A', 'B', 'C']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sbtn';
    b.innerHTML = `<b style="background:${STYLE_COLORS[letter]}">${letter}</b>${STYLE_NAMES[letter]}`;
    b.addEventListener('click', () => select(letter));
    bar.appendChild(b);
    buttons.set(letter, b);
  }
  window.addEventListener('keydown', (e) => {
    const k = e.key.toUpperCase();
    if (k === 'A' || k === 'B' || k === 'C') select(k);
    if (k === ' ') pauseBtn.click();
  });
}

function select(letter: string): void {
  const s = styles.find((x) => x.letter === letter);
  if (!s) return;
  for (const x of styles) x.group.visible = x === s;
  current = s;
  for (const [l, b] of buttons) b.classList.toggle('on', l === letter);
  renderLegend(s);
  const u = new URL(location.href);
  u.searchParams.set('style', letter);
  history.replaceState(null, '', u);
}

const cardsEl = document.getElementById('cards')!;
const costEl = document.getElementById('cost')!;
let liveEl: HTMLElement | null = null;

function renderLegend(s: SkyStyle): void {
  cardsEl.innerHTML = s.rows
    .map(
      (r) =>
        `<div class="card"><span class="name">${r.name}</span>` +
        `<span class="badge ${r.kind}">${r.kind === 'asset' ? 'Image ' + r.license : 'Procédural'}</span>` +
        `<div class="what">${r.what}</div><div class="src">${r.source}${r.kind === 'proc' ? ` — ${r.license}` : ''}</div></div>`,
    )
    .join('');
  costEl.innerHTML =
    `<span class="tag" style="background:${STYLE_COLORS[s.letter]};color:#fff">${s.letter} · ${s.name}</span>` +
    `<span>${s.costText}</span><span class="live" id="live"></span>`;
  liveEl = document.getElementById('live');
}

// ---------- Chargement ----------
async function main(): Promise<void> {
  const [{ atlas, tiles }, sprites] = await Promise.all([loadBlockTextures(), loadSpriteImages()]);
  if (!tiles) throw new Error('Tuiles du jeu indisponibles');

  const world = new World();
  generateWorld(world, Number(params.get('seed') ?? 20240611));
  const worldRenderer = new WorldRenderer(world, scene, atlas);
  worldRenderer.rebuildAll();
  const spawn = findSpawn(world);
  camera.position.set(spawn.x, spawn.y + EYE_HEIGHT, spawn.z);

  const gameTiles = tiles as unknown as GameTiles;
  styles = [createStyleA(gameTiles), createStyleB(sprites), createStyleC(gameTiles, sprites)];
  for (const s of styles) {
    s.group.visible = false;
    skyScene.add(s.group);
    s.update(0, 0);
  }
  buildButtons();
  select(params.get('style')?.toUpperCase() ?? 'A');
  document.getElementById('loading')!.remove();
  Object.assign(window, { scene, skyScene, camera, skyCamera, renderer, styles });
  loop();
}

// ---------- Boucle ----------
const fpsEl = document.getElementById('fps')!;
const clock = new THREE.Clock();
let t = 0;
let frames = 0;
let lastFpsT = performance.now();
let skyCalls = 0;
let skyTris = 0;
let worldCalls = 0;

function loop(): void {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.1);
  t += dt;
  if (autoRotate && !dragging) yaw += AUTO_SPEED * dt;
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  camera.updateMatrixWorld();
  // Caméra ciel : même orientation, reste à l'origine (le ciel suit le joueur en position).
  skyCamera.quaternion.copy(camera.quaternion);
  skyCamera.updateMatrixWorld();

  current?.update(t, dt);

  renderer.info.reset();
  renderer.render(skyScene, skyCamera);
  skyCalls = renderer.info.render.calls;
  skyTris = renderer.info.render.triangles;
  renderer.clearDepth();
  renderer.render(scene, camera);
  worldCalls = renderer.info.render.calls - skyCalls;

  frames++;
  const now = performance.now();
  if (now - lastFpsT >= 500) {
    const fps = (frames * 1000) / (now - lastFpsT);
    fpsEl.textContent = `${fps.toFixed(0)} fps`;
    if (liveEl) {
      liveEl.textContent =
        `mesuré : ciel ${skyCalls} draw calls / ${skyTris.toLocaleString('fr-FR')} tri · ` +
        `monde ${worldCalls} draw calls · ${fps.toFixed(0)} fps`;
    }
    frames = 0;
    lastFpsT = now;
  }
}

main().catch((e) => {
  console.error(e);
  fpsEl.textContent = 'Erreur : ' + String(e);
});
