import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BlockId } from '../src/core/types';
import { BLOCKS, PALETTE, World, WorldRenderer, createPlaceholderAtlas, findSpawn, generateWorld } from '../src/engine';

const hud = document.getElementById('hud')!;
const select = document.getElementById('block') as HTMLSelectElement;

// ---------- Three.js ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const SKY = 0x7ec8ff;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 90, 220);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 500);

// ---------- Monde ----------
const world = new World();
let seed = 42;
const atlas = createPlaceholderAtlas();
const worldRenderer = new WorldRenderer(world, scene, atlas);

function newWorld(s: number): void {
  const t0 = performance.now();
  generateWorld(world, s);
  const tGen = performance.now() - t0;
  worldRenderer.rebuildAll();
  genMs = tGen;
  const spawn = findSpawn(world);
  controls.target.set(spawn.x, spawn.y, spawn.z);
  camera.position.set(spawn.x + 40, spawn.y + 35, spawn.z + 40);
  controls.update();
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 4;
controls.maxDistance = 200;

let genMs = 0;
newWorld(seed);

// ---------- Palette (sélecteur) ----------
for (const id of PALETTE) {
  const opt = document.createElement('option');
  opt.value = String(id);
  opt.textContent = BlockId[id];
  select.appendChild(opt);
}
select.value = String(BlockId.Brick);

document.getElementById('rebuild')!.addEventListener('click', () => worldRenderer.rebuildAll());
document.getElementById('newworld')!.addEventListener('click', () => newWorld((seed = (Math.random() * 1e9) | 0)));

// ---------- Visée / casser / poser ----------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
  new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.6 }),
);
highlight.visible = false;
scene.add(highlight);

function pick(clientX: number, clientY: number) {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const { origin, direction } = raycaster.ray;
  return world.raycast(origin, direction, 400);
}

let down: { x: number; y: number; button: number } | null = null;
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, button: e.button };
});
renderer.domElement.addEventListener('pointermove', (e) => {
  const hit = pick(e.clientX, e.clientY);
  highlight.visible = !!hit;
  if (hit) highlight.position.set(hit.block[0] + 0.5, hit.block[1] + 0.5, hit.block[2] + 0.5);
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const button = down.button;
  down = null;
  if (moved > 6) return; // c'était une rotation de caméra
  const hit = pick(e.clientX, e.clientY);
  if (!hit) return;
  if (button === 0) {
    world.setBlock(hit.block[0], hit.block[1], hit.block[2], BlockId.Air);
  } else if (button === 2) {
    const id = Number(select.value) as BlockId;
    world.setBlock(hit.block[0] + hit.normal[0], hit.block[1] + hit.normal[1], hit.block[2] + hit.normal[2], id);
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Boucle ----------
let frames = 0;
let fps = 0;
let lastFpsT = performance.now();
let lastEditMs = 0;

function loop(): void {
  requestAnimationFrame(loop);
  controls.update();
  const t0 = performance.now();
  const n = worldRenderer.update(2, controls.target);
  if (n > 0) lastEditMs = performance.now() - t0;
  renderer.render(scene, camera);

  frames++;
  const now = performance.now();
  if (now - lastFpsT >= 500) {
    fps = (frames * 1000) / (now - lastFpsT);
    frames = 0;
    lastFpsT = now;
    const s = worldRenderer.stats;
    const info = renderer.info.render;
    hud.textContent =
      `fps            ${fps.toFixed(0)}\n` +
      `triangles      ${info.triangles} dessinés / ${s.triangles} au total\n` +
      `draw calls     ${info.calls}  (meshes ${s.meshes})\n` +
      `génération     ${genMs.toFixed(1)} ms (seed ${seed})\n` +
      `remaillage     tout : ${s.lastRebuildMs.toFixed(1)} ms · chunk : ${s.lastChunkMs.toFixed(2)} ms (moy. ${s.avgChunkMs.toFixed(2)})\n` +
      `dernière modif ${lastEditMs.toFixed(2)} ms · en attente ${s.pending}\n` +
      `bloc posé      ${BLOCKS[Number(select.value) as BlockId] ? BlockId[Number(select.value)] : '?'}`;
  }
}
loop();

// Accès console pour le débogage.
Object.assign(window, { world, worldRenderer, scene, camera });
