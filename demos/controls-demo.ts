/**
 * Démo des contrôles (Agent D) : monde de TEST autonome (indépendant du moteur voxel),
 * vrais InputManager / Player / Hud. CASSER / POSER via un raycast DDA local.
 * Ouvrir : npm run dev puis /construction-brique/demos/controls.html
 */
import * as THREE from 'three';
import { BlockId, type CollisionWorld, type GameActions } from '../src/core/types';
import { InputManager } from '../src/controls/input';
import { Player } from '../src/player/player';
import { Hud } from '../src/ui/hud';

const SIZE = 64;
const MAX_Y = 32;
const REACH = 6;

// Couleurs provisoires (le moteur fournira BlockDef.color).
const COLORS: Partial<Record<BlockId, number>> = {
  [BlockId.Grass]: 0x5fbf3f, [BlockId.Dirt]: 0x8b5a2b, [BlockId.Stone]: 0x8a8f98,
  [BlockId.Cobblestone]: 0x6d7178, [BlockId.Log]: 0x7a5230, [BlockId.Planks]: 0xc89b5a,
  [BlockId.Leaves]: 0x3e9e3a, [BlockId.Brick]: 0xb4473a, [BlockId.Glass]: 0xbfe8ff,
  [BlockId.Sand]: 0xe8d58c, [BlockId.Diamond]: 0x55e6e0, [BlockId.Gold]: 0xffd23f,
  [BlockId.WoolWhite]: 0xf4f4f4, [BlockId.WoolRed]: 0xe53935, [BlockId.WoolOrange]: 0xff8f1f,
  [BlockId.WoolYellow]: 0xffe23b, [BlockId.WoolGreen]: 0x6ccf3a, [BlockId.WoolBlue]: 0x3b6fe5,
  [BlockId.WoolPurple]: 0x9a4fe0, [BlockId.WoolPink]: 0xff8fc8, [BlockId.WoolBlack]: 0x2a2a2e,
  [BlockId.Bedrock]: 0x333333,
};
const colorOf = (id: BlockId): number => COLORS[id] ?? 0xff00ff;
const PALETTE: BlockId[] = (Object.values(BlockId).filter((v) => typeof v === 'number') as BlockId[])
  .filter((id) => id !== BlockId.Air && id !== BlockId.Bedrock);

// ---------- Monde de test ----------
class TestWorld implements CollisionWorld {
  readonly blocks = new Map<string, BlockId>();
  private static key(x: number, y: number, z: number): string { return `${x},${y},${z}`; }
  get(x: number, y: number, z: number): BlockId { return this.blocks.get(TestWorld.key(x, y, z)) ?? BlockId.Air; }
  set(x: number, y: number, z: number, id: BlockId): void {
    if (id === BlockId.Air) this.blocks.delete(TestWorld.key(x, y, z));
    else this.blocks.set(TestWorld.key(x, y, z), id);
  }
  isSolid(x: number, y: number, z: number): boolean { return this.blocks.has(TestWorld.key(x, y, z)); }

  reset(): void {
    this.blocks.clear();
    for (let x = 0; x < SIZE; x++) for (let z = 0; z < SIZE; z++) this.set(x, 0, z, BlockId.Grass);
    // Escalier de marches d'un bloc (auto-saut).
    for (let i = 0; i < 6; i++) for (let h = 1; h <= i + 1; h++) for (let w = 0; w < 3; w++) this.set(24 + w, h, 30 - i, BlockId.Planks);
    // Mur de 2 blocs (on ne passe pas sans sauter... ni avec l'auto-saut).
    for (let x = 36; x < 44; x++) { this.set(x, 1, 30, BlockId.Brick); this.set(x, 2, 30, BlockId.Brick); }
    // Quelques cubes isolés.
    const cubes: Array<[number, number, BlockId]> = [[30, 36, BlockId.Stone], [34, 38, BlockId.Gold], [28, 40, BlockId.Diamond], [38, 36, BlockId.WoolRed]];
    for (const [x, z, id] of cubes) this.set(x, 1, z, id);
    // Petit arbre.
    for (let y = 1; y <= 4; y++) this.set(20, y, 40, BlockId.Log);
    for (let x = 18; x <= 22; x++) for (let z = 38; z <= 42; z++) for (let y = 4; y <= 5; y++) if (this.get(x, y, z) === BlockId.Air) this.set(x, y, z, BlockId.Leaves);
    // Tunnel bas (1 bloc de haut) : on ne doit pas pouvoir y entrer debout.
    for (let z = 42; z < 48; z++) { this.set(44, 1, z, BlockId.Stone); this.set(46, 1, z, BlockId.Stone); this.set(45, 2, z, BlockId.Stone); this.set(44, 2, z, BlockId.Stone); this.set(46, 2, z, BlockId.Stone); }
  }

  /** DDA (Amanatides & Woo) : premier bloc solide sur le rayon. */
  raycast(o: THREE.Vector3, d: THREE.Vector3, maxDist: number): { block: [number, number, number]; normal: [number, number, number] } | null {
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const sx = Math.sign(d.x), sy = Math.sign(d.y), sz = Math.sign(d.z);
    const tdx = sx !== 0 ? Math.abs(1 / d.x) : Infinity;
    const tdy = sy !== 0 ? Math.abs(1 / d.y) : Infinity;
    const tdz = sz !== 0 ? Math.abs(1 / d.z) : Infinity;
    let tmx = sx > 0 ? (x + 1 - o.x) * tdx : sx < 0 ? (o.x - x) * tdx : Infinity;
    let tmy = sy > 0 ? (y + 1 - o.y) * tdy : sy < 0 ? (o.y - y) * tdy : Infinity;
    let tmz = sz > 0 ? (z + 1 - o.z) * tdz : sz < 0 ? (o.z - z) * tdz : Infinity;
    let normal: [number, number, number] = [0, 0, 0];
    let t = 0;
    while (t <= maxDist) {
      if (this.isSolid(x, y, z)) return { block: [x, y, z], normal };
      if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; normal = [-sx, 0, 0]; }
      else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; normal = [0, -sy, 0]; }
      else { z += sz; t = tmz; tmz += tdz; normal = [0, 0, -sz]; }
    }
    return null;
  }
}

// ---------- Rendu ----------
const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x7ec8ff);
scene.fog = new THREE.Fog(0x7ec8ff, 30, 70);
scene.add(new THREE.HemisphereLight(0xffffff, 0x667744, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(0.4, 1, 0.25);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 200);

const MAX_INSTANCES = SIZE * SIZE + 4000;
const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), MAX_INSTANCES);
mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
mesh.frustumCulled = false;
scene.add(mesh);

const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
  new THREE.LineBasicMaterial({ color: 0x000000 }),
);
highlight.visible = false;
scene.add(highlight);

const world = new TestWorld();
world.reset();

const tmpM = new THREE.Matrix4();
const tmpC = new THREE.Color();
function rebuild(): void {
  let i = 0;
  for (const [k, id] of world.blocks) {
    if (i >= MAX_INSTANCES) break;
    const [x, y, z] = k.split(',').map(Number);
    tmpM.makeTranslation(x + 0.5, y + 0.5, z + 0.5);
    mesh.setMatrixAt(i, tmpM);
    tmpC.setHex(colorOf(id));
    if ((x + z + y) % 2 === 0) tmpC.multiplyScalar(0.92); // damier léger : aide à percevoir la profondeur
    mesh.setColorAt(i, tmpC);
    i++;
  }
  mesh.count = i;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}
rebuild();

// ---------- Joueur + entrées + HUD ----------
const SPAWN = { x: 32.5, y: 1, z: 44.5 };
const player = new Player(SPAWN);
player.setSpawn(SPAWN);
player.setBounds({ minX: 0, maxX: SIZE, minZ: 0, maxZ: SIZE });

let selected: BlockId = PALETTE[0];

function target() {
  const r = player.getLookRay();
  return world.raycast(new THREE.Vector3(r.origin.x, r.origin.y, r.origin.z), new THREE.Vector3(r.dir.x, r.dir.y, r.dir.z), REACH);
}

const actions: GameActions = {
  breakBlock() {
    const hit = target();
    if (!hit || hit.block[1] === 0) return; // le sol de test est indestructible
    world.set(hit.block[0], hit.block[1], hit.block[2], BlockId.Air);
    rebuild();
  },
  placeBlock() {
    const hit = target();
    if (!hit) return;
    const [x, y, z] = [hit.block[0] + hit.normal[0], hit.block[1] + hit.normal[1], hit.block[2] + hit.normal[2]];
    if (x < 0 || x >= SIZE || z < 0 || z >= SIZE || y < 1 || y >= MAX_Y) return;
    if (player.wouldIntersectPlayer(x, y, z)) return;
    world.set(x, y, z, selected);
    rebuild();
  },
  selectBlock(id) { selected = id; },
  newWorld() {
    world.reset();
    rebuild();
    player.teleport(SPAWN);
    player.state.yaw = 0;
    player.state.pitch = 0;
  },
  toggleFly() { player.toggleFly(); },
};

const input = new InputManager(app, {
  onPrimary: () => actions.breakBlock(),
  onSecondary: () => actions.placeBlock(),
  onSlot: (i) => hud.selectIndex(i),
  onScroll: (d) => hud.selectRelative(d),
  onToggleFly: () => { actions.toggleFly?.(); hud.setFlying(player.flying); },
});

const hud = new Hud(document.body, actions, PALETTE, colorOf, {
  onJumpChange: (down) => input.setButton('jump', down),
  onDescendChange: (down) => input.setButton('descend', down),
});

function resize(): void {
  const w = app.clientWidth, h = app.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  player.update(dt, input.state, world);
  input.consumeLook();
  player.applyToCamera(camera);
  const hit = target();
  highlight.visible = !!hit;
  if (hit) highlight.position.set(hit.block[0] + 0.5, hit.block[1] + 0.5, hit.block[2] + 0.5);
  renderer.render(scene, camera);
});

// Accès console pour le débogage.
Object.assign(window, { __demo: { player, world, input, hud, actions } });
