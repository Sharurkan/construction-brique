/**
 * Ciel « Blocs » : tous les éléments sont des CUBES texturés avec les tuiles Kenney du jeu
 * (Voxel Pack, CC0 : laine blanche teintée par couleur d'instance, planches). Aucune image ajoutée.
 *
 * Perf : UN SEUL InstancedMesh, UN SEUL matériau (MeshBasicMaterial, sans lumière ni brouillard)
 * sur une petite bande de 2 tuiles (laine + planches) ; l'attribut d'instance `aTile` choisit la
 * tuile. Ombrage des faces cuit dans les couleurs de sommets (comme le mesher du jeu).
 * Les matrices d'instance sont réécrites chaque frame sans allocation.
 */
import * as THREE from 'three';
import { RAINBOW_BAND, RAINBOW_CENTER_Y, RAINBOW_COLORS, RAINBOW_OUTER } from './paths';

/** Couleur du ciel du jeu (sert à fondre le halo du soleil). */
export const SKY_COLOR = 0x7ec8ff;

export const enum SkyTile {
  Wool = 0,
  Planks = 1,
}

// ---------- Géométrie et matériau partagés ----------

/** Cube 1×1×1 centré ; couleurs de sommets = ombrage par face. */
export function shadedBox(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  // Ordre des faces : +x, -x, +y, -y, +z, -z (4 sommets chacune).
  const per = [0.93, 0.93, 1, 0.84, 0.8, 0.8];
  const col = new Float32Array(24 * 3);
  for (let f = 0; f < 6; f++) col.fill(per[f], f * 12, f * 12 + 12);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Ombrage de la face +Z (face tournée vers le joueur pour le soleil) : à compenser. */
const FRONT_SHADE = 0.8;

/** Bande verticale de 2 tuiles : laine (en haut, v ∈ [0.5, 1]) puis planches (v ∈ [0, 0.5]). */
export function createSkyTileTexture(wool: HTMLCanvasElement, planks: HTMLCanvasElement): THREE.Texture {
  const s = wool.width;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s * 2;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(wool, 0, 0, s, s);
  ctx.drawImage(planks, 0, s, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter; // éléments lointains : pas de scintillement
  t.generateMipmaps = true;
  return t;
}

export function createSkyMaterial(texture: THREE.Texture): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, fog: false });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTile;')
      .replace(
        '#include <uv_vertex>',
        // Léger retrait des bords : pas de fuite entre les 2 tuiles aux petits niveaux de mipmap.
        '#include <uv_vertex>\nvMapUv = vec2(uv.x, (mix(0.04, 0.96, uv.y) + (1.0 - aTile)) * 0.5);',
      );
  };
  return mat;
}

// ---------- Lot de cubes instanciés, regroupés en « éléments » animés ----------

interface Part {
  el: number;
  local: THREE.Matrix4;
  /** 0 = pièce fixe ; ±1 = aile (rotation autour de l'axe X local, côté ±Z). */
  wing: number;
  hinge: THREE.Vector3;
  size: THREE.Vector3;
}

export class BlockBatch {
  private readonly parts: Part[] = [];
  private readonly colors: THREE.Color[] = [];
  private readonly tiles: number[] = [];
  /** Matrice monde de chaque élément (remplie par le ciel avant update()). */
  readonly elements: THREE.Matrix4[] = [];
  /** Angle de battement d'ailes par élément (radians). */
  readonly flap: number[] = [];
  mesh: THREE.InstancedMesh | null = null;

  addElement(): number {
    this.elements.push(new THREE.Matrix4());
    this.flap.push(0);
    return this.elements.length - 1;
  }

  /** Cube (sx, sy, sz) centré en (x, y, z) dans le repère de l'élément. */
  add(
    el: number, x: number, y: number, z: number, sx: number, sy: number, sz: number,
    color: number | THREE.Color, tile: SkyTile = SkyTile.Wool,
  ): void {
    const local = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz));
    this.parts.push({ el, local, wing: 0, hinge: new THREE.Vector3(), size: new THREE.Vector3(sx, sy, sz) });
    this.colors.push(typeof color === 'number' ? new THREE.Color(color) : color);
    this.tiles.push(tile);
  }

  /** Aile articulée en `hinge` (bord intérieur), qui s'étend vers ±Z sur sz. */
  addWing(el: number, side: 1 | -1, hinge: THREE.Vector3, sx: number, sy: number, sz: number, color: number): void {
    this.parts.push({ el, local: new THREE.Matrix4(), wing: side, hinge, size: new THREE.Vector3(sx, sy, sz) });
    this.colors.push(new THREE.Color(color));
    this.tiles.push(SkyTile.Wool);
  }

  /** Crée l'InstancedMesh (une fois toutes les pièces ajoutées). */
  build(geometry: THREE.BufferGeometry, material: THREE.Material): THREE.InstancedMesh {
    const n = this.parts.length;
    const geo = geometry.clone(); // attribut aTile propre à ce lot
    geo.setAttribute('aTile', new THREE.InstancedBufferAttribute(new Float32Array(this.tiles), 1));
    const mesh = new THREE.InstancedMesh(geo, material, n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; // instances mobiles : la sphère englobante serait fausse
    mesh.matrixAutoUpdate = false;
    this.colors.forEach((c, i) => mesh.setColorAt(i, c));
    this.mesh = mesh;
    return mesh;
  }

  get count(): number {
    return this.parts.length;
  }

  get triangles(): number {
    return this.parts.length * 12;
  }

  private static readonly m = new THREE.Matrix4();
  private static readonly mw = new THREE.Matrix4();
  private static readonly q = new THREE.Quaternion();
  private static readonly v = new THREE.Vector3();
  private static readonly X = new THREE.Vector3(1, 0, 0);

  /** Réécrit toutes les matrices d'instance (aucune allocation). */
  update(): void {
    const mesh = this.mesh;
    if (!mesh) return;
    const { m, mw, q, v, X } = BlockBatch;
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      if (p.wing === 0) {
        m.multiplyMatrices(this.elements[p.el], p.local);
      } else {
        // T(charnière) · R(battement) · T(demi-envergure vers le côté) · S(taille)
        q.setFromAxisAngle(X, p.wing * this.flap[p.el]);
        v.set(0, 0, (p.wing * p.size.z) / 2).applyQuaternion(q).add(p.hinge);
        mw.compose(v, q, p.size);
        m.multiplyMatrices(this.elements[p.el], mw);
      }
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------- Constructeurs des éléments ----------

/** Petit générateur déterministe (formes des nuages). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Nuage plat « en blocs » : galette bosselée de gros blocs blancs, plus épaisse au centre. */
export function addBlockCloud(batch: BlockBatch, el: number, variant: number, cell: number): void {
  const rnd = rng(1234 + variant * 77);
  const W = 9;
  const D = 5;
  const layer = cell * 0.6;
  for (let i = 0; i < W; i++) {
    for (let k = 0; k < D; k++) {
      const nx = (i - (W - 1) / 2) / (W / 2);
      const nz = (k - (D - 1) / 2) / (D / 2);
      const d = nx * nx + nz * nz;
      if (d > 1.0 || (d > 0.55 && rnd() < 0.45)) continue;
      const thick = d < 0.35 ? 2 : 1;
      batch.add(el, (i - (W - 1) / 2) * cell, ((thick - 1) * layer) / 2, (k - (D - 1) / 2) * cell, cell, layer * thick, cell, 0xffffff);
    }
  }
}

/** Montgolfière : enveloppe en coquille de blocs de laine à rayures, cordes, nacelle en planches. */
export function addBlockBalloon(batch: BlockBatch, el: number, colA: number, colB: number, cell: number): void {
  const profile = [1, 2, 3, 3.6, 4.1, 4.4, 4.5, 4.4, 4.1, 3.6, 2.8, 1.6];
  const y0 = 4; // étages sous l'enveloppe (cordes + nacelle)
  const inside = (i: number, j: number, k: number): boolean =>
    j >= 0 && j < profile.length && Math.hypot(i, k) <= profile[j];
  for (let j = 0; j < profile.length; j++) {
    const R = Math.ceil(profile[j]);
    for (let i = -R; i <= R; i++) {
      for (let k = -R; k <= R; k++) {
        if (!inside(i, j, k)) continue;
        const shell =
          !inside(i + 1, j, k) || !inside(i - 1, j, k) || !inside(i, j + 1, k) ||
          !inside(i, j - 1, k) || !inside(i, j, k + 1) || !inside(i, j, k - 1);
        if (!shell) continue;
        const stripe = Math.floor(((Math.atan2(k, i) + Math.PI) / (2 * Math.PI)) * 8 + 0.5) % 2;
        batch.add(el, i * cell, (j + y0) * cell, k * cell, cell, cell, cell, stripe ? colA : colB);
      }
    }
  }
  const ropeLen = (y0 - 1.5) * cell;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    batch.add(el, sx * cell * 0.9, cell * 1.1 + ropeLen / 2, sz * cell * 0.9, cell * 0.18, ropeLen, cell * 0.18, 0x3a3a3a);
  }
  for (const [sx, sz] of [[0.5, 0.5], [0.5, -0.5], [-0.5, 0.5], [-0.5, -0.5]]) {
    batch.add(el, sx * cell, cell * 0.6, sz * cell, cell, cell * 1.2, cell, 0xffffff, SkyTile.Planks);
  }
}

/** Arc-en-ciel « pixelisé » : anneau rastérisé en blocs de laine des 7 couleurs (plan XY local). */
export function addBlockRainbow(batch: BlockBatch, el: number): void {
  const s = RAINBOW_BAND;
  const n = Math.ceil(RAINBOW_OUTER / s) + 1;
  for (let i = -n; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const y = j * s + RAINBOW_CENTER_Y;
      const band = Math.floor((RAINBOW_OUTER - Math.hypot(i * s, j * s)) / s);
      if (band < 0 || band >= RAINBOW_COLORS.length) continue;
      batch.add(el, i * s, y, 0, s, s, s, RAINBOW_COLORS[band]);
    }
  }
}

/** Oiseau : corps, tête, bec, queue, 2 ailes qui battent. Repère : +X = avant. */
export function addBlockBird(batch: BlockBatch, el: number, color: number, k: number): void {
  batch.add(el, 0, 0, 0, 1.8 * k, 0.9 * k, 0.9 * k, color);
  batch.add(el, 1.15 * k, 0.35 * k, 0, 0.75 * k, 0.75 * k, 0.75 * k, color);
  batch.add(el, 1.7 * k, 0.3 * k, 0, 0.45 * k, 0.25 * k, 0.3 * k, 0xff9800);
  batch.add(el, -1.15 * k, 0.15 * k, 0, 0.6 * k, 0.2 * k, 0.7 * k, color);
  batch.addWing(el, 1, new THREE.Vector3(0, 0.3 * k, 0.45 * k), 1.0 * k, 0.18 * k, 1.9 * k, color);
  batch.addWing(el, -1, new THREE.Vector3(0, 0.3 * k, -0.45 * k), 1.0 * k, 0.18 * k, 1.9 * k, color);
}

/**
 * Dragon gentil : gros corps vert, grands yeux, petites cornes blanches, une dent qui dépasse,
 * queue en 3 segments, 2 grandes ailes qui battent lentement. Aucun feu. Repère : +X = avant.
 */
export function addBlockDragon(batch: BlockBatch, el: number, k: number): void {
  const G = 0x5cc23a;
  const L = 0x9be05a;
  const B = 0xd8f08a;
  const O = 0xff9800;
  const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, c: number): void =>
    batch.add(el, x * k, y * k, z * k, sx * k, sy * k, sz * k, c);
  box(0, 0, 0, 4, 2, 2, G); // corps
  box(0, -1.05, 0, 3.4, 0.3, 1.6, B); // ventre
  box(2.8, 0.9, 0, 2, 1.8, 1.8, G); // tête
  box(4.2, 0.55, 0, 1.2, 1, 1.4, G); // museau
  box(4.6, 0.0, 0.35, 0.25, 0.3, 0.2, 0xffffff); // petite dent
  for (const s of [1, -1]) {
    box(3.35, 1.35, s * 0.92, 0.6, 0.7, 0.2, 0xffffff); // œil
    box(3.5, 1.3, s * 1.02, 0.3, 0.4, 0.1, 0x2a2a2a); // pupille
    box(2.4, 2.15, s * 0.55, 0.35, 0.8, 0.35, 0xffffff); // corne
    box(1.2, -1.35, s * 0.6, 0.5, 0.8, 0.5, G); // pattes
    box(-1.2, -1.35, s * 0.6, 0.5, 0.8, 0.5, G);
  }
  box(-2.6, 0.2, 0, 1.6, 1.4, 1.4, G); // queue
  box(-3.9, 0.5, 0, 1.4, 1, 1, G);
  box(-5.0, 0.9, 0, 1, 0.7, 0.7, G);
  box(-5.8, 1.1, 0, 0.8, 0.6, 0.2, O);
  for (const x of [-1.2, 0, 1.2]) box(x, 1.2, 0, 0.5, 0.5, 0.3, O); // crêtes
  batch.addWing(el, 1, new THREE.Vector3(0.2 * k, 0.9 * k, 1.0 * k), 2.4 * k, 0.2 * k, 3.8 * k, L);
  batch.addWing(el, -1, new THREE.Vector3(0.2 * k, 0.9 * k, -1.0 * k), 2.4 * k, 0.2 * k, 3.8 * k, L);
}

function mixHex(a: number, b: number, t: number): THREE.Color {
  return new THREE.Color(a).lerp(new THREE.Color(b), t);
}

/** Couleur de face avant compensée (la face +Z est ombrée à FRONT_SHADE). */
function front(c: THREE.Color): THREE.Color {
  return c.multiplyScalar(1 / FRONT_SHADE);
}

export const SUN_CELL = 3.2;
export const SUN_RADIUS_CELLS = 6.2;

/**
 * Soleil « pixel » : disque en escalier de blocs plats, jaune chaud (bord orangé), avec un halo
 * doux en 2 anneaux de blocs dont la couleur se fond vers le bleu du ciel (opaque : pas de
 * transparence à trier). Plan XY local, face +Z vers le joueur.
 */
export function addBlockSunDisc(batch: BlockBatch, el: number): void {
  const s = SUN_CELL;
  const R = SUN_RADIUS_CELLS;
  const n = Math.ceil(R + 2.6);
  const core = 0xffd84a;
  const edge = 0xffb52e;
  for (let i = -n; i <= n; i++) {
    for (let j = -n; j <= n; j++) {
      const d = Math.hypot(i, j);
      if (d <= R) {
        const c = d > R - 1 ? edge : i + j < -R * 0.6 && d < R - 1.5 ? 0xffe98a : core; // reflet en haut à gauche
        batch.add(el, i * s, j * s, 0, s, s, s * 0.4, front(new THREE.Color(c)));
      } else if (d <= R + 1.3) {
        batch.add(el, i * s, j * s, -s * 0.5, s, s, s * 0.4, front(mixHex(0xffe27a, SKY_COLOR, 0.42)));
      } else if (d <= R + 2.6) {
        batch.add(el, i * s, j * s, -s * 0.9, s, s, s * 0.4, front(mixHex(0xfff0b0, SKY_COLOR, 0.7)));
      }
    }
  }
}

/** Rayons en blocs (variante 2) : 8 traits autour du disque, dans un élément qui tourne. */
export function addBlockSunRays(batch: BlockBatch, el: number): void {
  const s = SUN_CELL;
  const R = SUN_RADIUS_CELLS;
  for (let r = 0; r < 8; r++) {
    const a = (r / 8) * Math.PI * 2;
    const len = r % 2 === 0 ? 3 : 2;
    for (let k = 0; k < len; k++) {
      const d = (R + 2 + k) * s;
      batch.add(el, Math.cos(a) * d, Math.sin(a) * d, s * 0.2, s * 0.9, s * 0.9, s * 0.4, front(new THREE.Color(0xffc83a)));
    }
  }
}
