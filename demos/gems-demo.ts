/**
 * Démo comparative des blocs précieux (diamant, or, émeraude) : 6 options d'effet côte à côte.
 * Ne modifie pas le jeu : le sol utilise le vrai WorldRenderer + le vrai atlas Kenney, les
 * gemmes sont maillées par le VRAI mesher (greedy, AO) puis affichées avec un matériau par option.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { BlockId } from '../src/core/types';
import {
  World,
  WorldRenderer,
  createAtlasFromImages,
  createChunkMaterials,
  meshChunk,
  type MeshData,
  type TextureAtlas,
  type TileLookup,
} from '../src/engine';
import { loadBlockTextures, recolorGem, ATLAS_TILE_SIZE } from '../src/game/atlas';
import { TEXTURE_TILES, TILE_SIZE } from '../src/assets/manifest';
import { GemMode, createGemMaterial } from './gems/gem-material';

// ---------- Couleurs des matières ----------
const DIAMOND = 0x22d3f0;
const GOLD = 0xffc414;
/** Émeraude : vert franc légèrement bleuté, plus saturé et plus clair que l'herbe et le minerai. */
const EMERALD = 0x14e07c;
const MATERIALS = [
  { key: 'diamond', name: 'Diamant', color: DIAMOND },
  { key: 'gold', name: 'Or', color: GOLD },
  { key: 'emerald', name: 'Émeraude', color: EMERALD },
] as const;

interface OptionDef {
  letter: string;
  name: string;
  color: string;
  /** null = matériau actuel du jeu (ShaderMaterial des chunks, inchangé). */
  mode: GemMode | null;
  /** Tuile Kenney de base recolorée. */
  base: 'glass_frame' | 'glass';
  text: string;
  cost: 'none' | 'low' | 'mid' | 'high';
  costText: string;
}

const OPTIONS: OptionDef[] = [
  {
    letter: 'A', name: 'Actuel', color: '#7a8796', mode: null, base: 'glass_frame',
    text: 'Le bloc d’aujourd’hui : la couleur seule, sans aucun reflet.',
    cost: 'none', costText: 'Coût : aucun (référence)',
  },
  {
    letter: 'B', name: 'Reflet', color: '#2f7de1', mode: GemMode.Spec, base: 'glass_frame',
    text: 'Une tache de lumière et des bords brillants qui glissent quand on tourne autour.',
    cost: 'low', costText: 'Coût tablette : faible',
  },
  {
    letter: 'C', name: 'Éclair', color: '#e3742f', mode: GemMode.Sweep, base: 'glass_frame',
    text: 'Une bande de lumière traverse chaque bloc toutes les 3 secondes.',
    cost: 'low', costText: 'Coût tablette : faible',
  },
  {
    letter: 'D', name: 'Étincelles', color: '#b04fd6', mode: GemMode.Sparkle, base: 'glass_frame',
    text: 'De petites étoiles s’allument et s’éteignent sur les faces.',
    cost: 'low', costText: 'Coût tablette : faible',
  },
  {
    letter: 'E', name: 'Facettes', color: '#1aa38a', mode: GemMode.Facet, base: 'glass',
    text: 'Taillé comme un bijou : chaque facette reflète le ciel ou le sol.',
    cost: 'mid', costText: 'Coût tablette : moyen',
  },
  {
    letter: 'F', name: 'Mélange', color: '#e0405e', mode: GemMode.Combo, base: 'glass_frame',
    text: 'Reflet B adouci + quelques étincelles D : brille sans clignoter partout.',
    cost: 'low', costText: 'Coût tablette : faible à moyen',
  },
];

// ---------- Disposition (en blocs) ----------
const WORLD_X = 48;
const WORLD_Y = 16;
const WORLD_Z = 16;
const COL_STEP = 7;
const COL_X0 = 4; // x du premier mur
/** Rangées : diamant devant, or au milieu, émeraude derrière (gradins d'herbe). */
const ROW_Z = [11, 8, 5];
const terraceHeight = (z: number): number => (z <= ROW_Z[2] + 1 ? 2 : z <= ROW_Z[1] + 1 ? 1 : 0);

function fillTerrain(w: World): void {
  for (let x = 0; x < w.sizeX; x++) {
    for (let z = 0; z < w.sizeZ; z++) {
      const h = terraceHeight(z);
      for (let y = 0; y <= h; y++) w.setBlock(x, y, z, y === h ? BlockId.Grass : BlockId.Dirt);
    }
  }
}

/** Gemmes d'une colonne, en x local (mur à x0..x0+2, bloc isolé à x0+4). */
const GEM_IDS = [BlockId.Diamond, BlockId.Gold, BlockId.WoolGreen /* tient lieu d'émeraude */];
function placeGems(w: World, x0: number): void {
  for (let r = 0; r < 3; r++) {
    const z = ROW_Z[r];
    const y0 = terraceHeight(z) + 1;
    for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 2; dy++) w.setBlock(x0 + dx, y0 + dy, z, GEM_IDS[r]);
    w.setBlock(x0 + 4, y0, z, GEM_IDS[r]);
  }
}

// ---------- Three.js ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.prepend(renderer.domElement);

const SKY = 0x7ec8ff;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 70, 160);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 400);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enablePan = false;
controls.maxPolarAngle = Math.PI * 0.48;
controls.minDistance = 8;
controls.maxDistance = 90;
const TARGET = new THREE.Vector3(WORLD_X / 2 - 1.8, 3.2, 6.5);
controls.target.copy(TARGET);
camera.position.set(WORLD_X / 2 - 1.8, 24.5, 40);
controls.update();

const shared = {
  uTime: { value: 0 },
  // Soleil haut, côté caméra (gauche-avant) : les reflets tombent sur les faces visibles.
  uSunDir: { value: new THREE.Vector3(-0.35, 0.75, 0.55).normalize() },
};

// ---------- Textures ----------
async function loadTile(key: string): Promise<HTMLCanvasElement> {
  const res = await fetch(TEXTURE_TILES[key]);
  const bmp = await createImageBitmap(await res.blob());
  const c = document.createElement('canvas');
  c.width = c.height = ATLAS_TILE_SIZE;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, TILE_SIZE, TILE_SIZE, 0, 0, ATLAS_TILE_SIZE, ATLAS_TILE_SIZE);
  return c;
}

/** Recopie la MeshData en ne gardant que les quads de gemmes (tuile ≠ 0) + attribut `face`. */
function gemGeometry(data: MeshData): THREE.BufferGeometry {
  const keep: number[] = [];
  for (let q = 0; q < data.quadCount; q++) if (data.tiles[q * 4] !== 0) keep.push(q);
  const n = keep.length * 4;
  const pos = new Float32Array(n * 3);
  const uv = new Float32Array(n * 2);
  const tile = new Float32Array(n);
  const shade = new Uint8Array(n);
  const face = new Float32Array(n);
  const idx = new Uint16Array(keep.length * 6);
  keep.forEach((q, k) => {
    for (let c = 0; c < 4; c++) {
      const s = q * 4 + c;
      const d = k * 4 + c;
      pos.set(data.positions.subarray(s * 3, s * 3 + 3), d * 3);
      uv.set(data.uvs.subarray(s * 2, s * 2 + 2), d * 2);
      tile[d] = data.tiles[s];
      shade[d] = data.shades[s];
      face[d] = data.faces[s];
    }
    for (let i = 0; i < 6; i++) idx[k * 6 + i] = data.indices[q * 6 + i] - q * 4 + k * 4;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('tile', new THREE.BufferAttribute(tile, 1));
  g.setAttribute('shade', new THREE.BufferAttribute(shade, 1, true));
  g.setAttribute('face', new THREE.BufferAttribute(face, 1));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

async function main(): Promise<void> {
  // Sol : vrai atlas Kenney + vrai WorldRenderer.
  const { atlas } = await loadBlockTextures();
  const ground = new World(WORLD_X, WORLD_Y, WORLD_Z);
  fillTerrain(ground);
  // Repères à gauche : minerais (à ne pas confondre avec les blocs pleins).
  ground.setBlock(1, terraceHeight(ROW_Z[0]) + 1, ROW_Z[0], BlockId.DiamondOre);
  ground.setBlock(1, terraceHeight(ROW_Z[1]) + 1, ROW_Z[1], BlockId.GoldOre);
  ground.setBlock(1, terraceHeight(ROW_Z[2]) + 1, ROW_Z[2], BlockId.EmeraldOre);
  const worldRenderer = new WorldRenderer(ground, scene, atlas);
  worldRenderer.rebuildAll();

  // Atlas des gemmes : pour chaque base, les 3 matières recolorées CONSÉCUTIVES.
  const bases = { glass_frame: await loadTile('glass_frame'), glass: await loadTile('glass') };
  const gemTiles: Record<string, HTMLCanvasElement> = {};
  for (const b of Object.keys(bases) as (keyof typeof bases)[]) {
    for (const m of MATERIALS) {
      // `glass` est presque uni : amplitude plus faible, les facettes viennent du shader.
      gemTiles[`${b}_${m.key}`] = recolorGem(bases[b], m.color, b === 'glass' ? 14 : 26);
    }
  }
  const gemAtlas: TextureAtlas = createAtlasFromImages(gemTiles, ATLAS_TILE_SIZE, 2);
  const chunkMats = createChunkMaterials(gemAtlas); // option A = matériau actuel du jeu, tel quel

  // Un monde 16³ par colonne (même terrain → AO correcte), maillé par le vrai mesher.
  OPTIONS.forEach((opt, i) => {
    const lookup: TileLookup = {
      tileIndex(key) {
        if (key === 'diamond_block') return gemAtlas.tileIndex(`${opt.base}_diamond`);
        if (key === 'gold_block') return gemAtlas.tileIndex(`${opt.base}_gold`);
        if (key === 'wool_green') return gemAtlas.tileIndex(`${opt.base}_emerald`);
        return 0; // terrain : filtré
      },
    };
    const w = new World(16, 16, 16);
    fillTerrain(w);
    placeGems(w, 4);
    const geo = gemGeometry(meshChunk(w, 0, 0, 0, lookup).opaque);
    const mat =
      opt.mode === null
        ? chunkMats.opaque
        : createGemMaterial(gemAtlas, opt.mode, gemAtlas.tileIndex(`${opt.base}_diamond`), shared);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.x = COL_X0 + i * COL_STEP - 4;
    scene.add(mesh);
  });

  buildOverlay();
  loop();
  Object.assign(window, { scene, camera, controls, worldRenderer });
}

// ---------- Étiquettes + légende ----------
const labelsEl = document.getElementById('labels')!;
const anchors: { el: HTMLElement; p: THREE.Vector3; dx?: number }[] = [];

function buildOverlay(): void {
  OPTIONS.forEach((opt, i) => {
    const el = document.createElement('div');
    el.className = 'label';
    el.textContent = opt.letter;
    el.style.background = opt.color;
    labelsEl.appendChild(el);
    const x = COL_X0 + i * COL_STEP + 2.5;
    anchors.push({ el, p: new THREE.Vector3(x, terraceHeight(ROW_Z[2]) + 5.2, ROW_Z[2] + 0.5) });
  });
  MATERIALS.forEach((m, r) => {
    const el = document.createElement('div');
    el.className = 'rowtag';
    el.innerHTML = `<span>${m.name}</span>`;
    labelsEl.appendChild(el);
    anchors.push({ el, p: new THREE.Vector3(1.5, terraceHeight(ROW_Z[r]) + 2.6, ROW_Z[r] + 0.5) });
  });
  const legend = document.getElementById('legend')!;
  for (const opt of OPTIONS) {
    const d = document.createElement('div');
    d.className = 'item';
    d.innerHTML =
      `<b class="l" style="background:${opt.color}">${opt.letter}</b><span class="name">${opt.name}</span>` +
      `<div>${opt.text}</div><span class="cost ${opt.cost}">${opt.costText}</span>`;
    legend.appendChild(d);
  }
}

const tmp = new THREE.Vector3();
function placeLabels(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (const a of anchors) {
    tmp.copy(a.p).project(camera);
    const visible = tmp.z < 1 && Math.abs(tmp.x) < 1.2 && Math.abs(tmp.y) < 1.2;
    a.el.style.display = visible ? '' : 'none';
    if (visible) a.el.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px)`;
  }
}

// ---------- Rotation automatique (balancier ±22°) + pause ----------
let swing = !new URLSearchParams(location.search).has('pause');
const pauseBtn = document.getElementById('pause') as HTMLButtonElement;
if (!swing) pauseBtn.textContent = '▶ Reprendre rotation';
pauseBtn.addEventListener('click', () => {
  swing = !swing;
  pauseBtn.textContent = swing ? '⏸ Pause rotation' : '▶ Reprendre rotation';
});
const SWING_AMP = THREE.MathUtils.degToRad(22);
const SWING_W = (2 * Math.PI) / 24; // un aller-retour en 24 s
let swingPhase = 0;
const yAxis = new THREE.Vector3(0, 1, 0);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Boucle ----------
const fpsEl = document.getElementById('fps')!;
const clock = new THREE.Clock();
let frames = 0;
let lastFpsT = performance.now();

function loop(): void {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.1);
  shared.uTime.value += dt;
  if (swing) {
    // Dérivée d'une sinusoïde : la caméra oscille autour de sa position, compatible avec OrbitControls.
    const prev = Math.sin(swingPhase);
    swingPhase += SWING_W * dt;
    const dAz = SWING_AMP * (Math.sin(swingPhase) - prev);
    camera.position.sub(controls.target).applyAxisAngle(yAxis, dAz).add(controls.target);
  }
  controls.update();
  renderer.render(scene, camera);
  placeLabels();
  frames++;
  const now = performance.now();
  if (now - lastFpsT >= 500) {
    fpsEl.textContent = `${((frames * 1000) / (now - lastFpsT)).toFixed(0)} fps`;
    frames = 0;
    lastFpsT = now;
  }
}

main().catch((e) => {
  console.error(e);
  fpsEl.textContent = 'Erreur : ' + String(e);
});
