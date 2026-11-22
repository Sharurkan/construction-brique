/**
 * Style « Blocs » : éléments du ciel construits en CUBES avec les tuiles Kenney du jeu
 * (Voxel Pack, CC0 : laine blanche teintée par couleur d'instance, planches, bloc d'or).
 * Aucune texture inventée : uniquement de la géométrie (cubes) + les tuiles de l'atlas réel.
 *
 * Perf : un InstancedMesh par tuile (laine / planches), un seul matériau MeshBasicMaterial
 * (pas de lumière : l'ombrage des faces est cuit dans les couleurs de sommets, comme le mesher
 * du jeu). Les matrices d'instance sont réécrites chaque frame sans allocation.
 */
import * as THREE from 'three';
import {
  BALLOONS,
  BIRD_GROUPS,
  CLOUDS,
  RAINBOW_AZIMUTH,
  RAINBOW_BAND,
  RAINBOW_CENTER_Y,
  RAINBOW_COLORS,
  RAINBOW_OUTER,
  R_RAINBOW,
  R_SUN,
  birdState,
  dragonState,
  onCircle,
  sunPosition,
} from './common';
import { mulberry32 as mulberry } from '../../src/engine';

// ---------- Géométrie : cube unité avec ombrage de faces cuit ----------

/** Cube 1×1×1 centré ; couleurs de sommets = ombrage par face (dessus clair, dessous plus sombre). */
export function shadedBox(shade = { top: 1, bottom: 0.84, x: 0.93, z: 0.8 }): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  // Ordre des faces de BoxGeometry : +x, -x, +y, -y, +z, -z (4 sommets chacune).
  const per = [shade.x, shade.x, shade.top, shade.bottom, shade.z, shade.z];
  const col = new Float32Array(24 * 3);
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) col.fill(per[f], (f * 4 + v) * 3, (f * 4 + v) * 3 + 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export function tileTexture(canvas: HTMLCanvasElement): THREE.Texture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  return t;
}

// ---------- Lot de cubes instanciés, regroupés en « éléments » animés ----------

interface Part {
  el: number;
  local: THREE.Matrix4;
  /** Aile : 0 = non ; ±1 = côté (rotation autour de l'axe X local de l'élément). */
  wing: number;
  hinge: THREE.Vector3;
  size: THREE.Vector3;
}

export class BlockBatch {
  readonly mesh: THREE.InstancedMesh;
  private readonly parts: Part[] = [];
  private readonly colors: number[] = [];
  /** Matrice monde de chaque élément (à remplir par le style avant update()). */
  readonly elements: THREE.Matrix4[] = [];
  /** Angle de battement d'ailes par élément (radians). */
  readonly flap: number[] = [];

  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.Material;

  constructor(texture: THREE.Texture, geo: THREE.BufferGeometry) {
    this.geo = geo;
    this.mat = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, 1); // remplacé par build()
  }

  addElement(): number {
    this.elements.push(new THREE.Matrix4());
    this.flap.push(0);
    return this.elements.length - 1;
  }

  /** Cube de taille (sx, sy, sz) centré en (x, y, z) dans le repère de l'élément. */
  add(el: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: number): void {
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion(),
      new THREE.Vector3(sx, sy, sz),
    );
    this.parts.push({ el, local, wing: 0, hinge: new THREE.Vector3(), size: new THREE.Vector3(sx, sy, sz) });
    this.colors.push(color);
  }

  /** Aile articulée en `hinge` (bord intérieur), s'étendant vers ±Z. */
  addWing(el: number, side: 1 | -1, hinge: THREE.Vector3, sx: number, sy: number, sz: number, color: number): void {
    this.parts.push({ el, local: new THREE.Matrix4(), wing: side, hinge, size: new THREE.Vector3(sx, sy, sz) });
    this.colors.push(color);
  }

  /** Crée l'InstancedMesh définitif (une fois toutes les pièces ajoutées). */
  build(): THREE.InstancedMesh {
    const old = this.mesh;
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, this.parts.length);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false; // les instances bougent : la sphère englobante serait fausse
    const c = new THREE.Color();
    this.colors.forEach((hex, i) => mesh.setColorAt(i, c.setHex(hex)));
    (this as { mesh: THREE.InstancedMesh }).mesh = mesh;
    old.dispose();
    return mesh;
  }

  get count(): number {
    return this.parts.length;
  }

  private static readonly m = new THREE.Matrix4();
  private static readonly mw = new THREE.Matrix4();
  private static readonly q = new THREE.Quaternion();
  private static readonly v = new THREE.Vector3();
  private static readonly X = new THREE.Vector3(1, 0, 0);

  /** Réécrit toutes les matrices d'instance (aucune allocation). */
  update(): void {
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
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  get triangles(): number {
    return this.parts.length * 12;
  }
}

// ---------- Constructeurs des 5 éléments ----------

const WHITE = 0xffffff;

/** Nuage plat « à la Minecraft » : une galette de gros blocs (forme pseudo-aléatoire). */
export function addBlockCloud(batch: BlockBatch, el: number, variant: number, cell: number): void {
  const rnd = mulberry(1234 + variant * 77);
  const W = 9;
  const D = 5;
  for (let i = 0; i < W; i++) {
    for (let k = 0; k < D; k++) {
      // Ellipse bosselée : bords irréguliers, centre plein.
      const nx = (i - (W - 1) / 2) / (W / 2);
      const nz = (k - (D - 1) / 2) / (D / 2);
      const d = nx * nx + nz * nz;
      if (d > 1.0 || (d > 0.55 && rnd() < 0.45)) continue;
      const x = (i - (W - 1) / 2) * cell;
      const z = (k - (D - 1) / 2) * cell;
      // Une deuxième couche au centre pour le volume.
      const thick = d < 0.35 ? 2 : 1;
      const layer = cell * 0.6;
      batch.add(el, x, ((thick - 1) * layer) / 2, z, cell, layer * thick, cell, WHITE);
    }
  }
}

/** Montgolfière en laine : enveloppe en « boule de blocs » (coquille seule) à rayures + cordes. */
export function addBlockBalloon(
  wool: BlockBatch,
  planks: BlockBatch,
  elWool: number,
  elPlanks: number,
  colA: number,
  colB: number,
  cell: number,
): void {
  // Profil du ballon : rayon (en cellules) par étage, du bas vers le haut.
  const profile = [1, 2, 3, 3.6, 4.1, 4.4, 4.5, 4.4, 4.1, 3.6, 2.8, 1.6];
  const y0 = 4; // étages sous l'enveloppe : cordes + nacelle
  const inside = (i: number, j: number, k: number): boolean => {
    if (j < 0 || j >= profile.length) return false;
    return Math.hypot(i, k) <= profile[j];
  };
  for (let j = 0; j < profile.length; j++) {
    const R = Math.ceil(profile[j]);
    for (let i = -R; i <= R; i++) {
      for (let k = -R; k <= R; k++) {
        if (!inside(i, j, k)) continue;
        // Coquille uniquement : au moins un voisin vide.
        const shell =
          !inside(i + 1, j, k) || !inside(i - 1, j, k) || !inside(i, j + 1, k) ||
          !inside(i, j - 1, k) || !inside(i, j, k + 1) || !inside(i, j, k - 1);
        if (!shell) continue;
        const sector = Math.floor(((Math.atan2(k, i) + Math.PI) / (2 * Math.PI)) * 8 + 0.5) % 2;
        wool.add(elWool, i * cell, (j + y0) * cell, k * cell, cell, cell, cell, sector ? colA : colB);
      }
    }
  }
  // Cordes (fines, laine noire) du bas de l'enveloppe à la nacelle.
  const ropeLen = (y0 - 1.5) * cell;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    wool.add(elWool, sx * cell * 0.9, cell * 1.5 + ropeLen / 2 - cell * 0.4, sz * cell * 0.9, cell * 0.18, ropeLen, cell * 0.18, 0x3a3a3a);
  }
  // Nacelle en planches : 2×1×2 blocs.
  for (const [sx, sz] of [[0.5, 0.5], [0.5, -0.5], [-0.5, 0.5], [-0.5, -0.5]]) {
    planks.add(elPlanks, sx * cell, cell * 0.6, sz * cell, cell, cell * 1.2, cell, WHITE);
  }
}

/** Arc-en-ciel « pixelisé » : un anneau rastérisé en blocs de laine des 7 couleurs. */
export function addBlockRainbow(batch: BlockBatch, el: number): void {
  const s = RAINBOW_BAND;
  const n = Math.ceil(RAINBOW_OUTER / s) + 1;
  for (let i = -n; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const x = i * s;
      const y = j * s;
      const d = Math.hypot(x, y - RAINBOW_CENTER_Y);
      const band = Math.floor((RAINBOW_OUTER - d) / s);
      if (band < 0 || band >= RAINBOW_COLORS.length) continue;
      if (y + RAINBOW_CENTER_Y < -s) continue;
      batch.add(el, x, y + RAINBOW_CENTER_Y, 0, s, s, s, RAINBOW_COLORS[band]);
    }
  }
}

/** Oiseau en blocs : corps, tête, bec, queue, 2 ailes qui battent. Repère : +X = avant. */
export function addBlockBird(batch: BlockBatch, el: number, color: number, k: number): void {
  batch.add(el, 0, 0, 0, 1.8 * k, 0.9 * k, 0.9 * k, color); // corps
  batch.add(el, 1.15 * k, 0.35 * k, 0, 0.75 * k, 0.75 * k, 0.75 * k, color); // tête
  batch.add(el, 1.7 * k, 0.3 * k, 0, 0.45 * k, 0.25 * k, 0.3 * k, 0xff9800); // bec
  batch.add(el, -1.15 * k, 0.15 * k, 0, 0.6 * k, 0.2 * k, 0.7 * k, color); // queue
  batch.addWing(el, 1, new THREE.Vector3(0, 0.3 * k, 0.45 * k), 1.0 * k, 0.18 * k, 1.9 * k, color);
  batch.addWing(el, -1, new THREE.Vector3(0, 0.3 * k, -0.45 * k), 1.0 * k, 0.18 * k, 1.9 * k, color);
}

// ---------- Animation commune des éléments en blocs ----------

const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _Y = new THREE.Vector3(0, 1, 0);

export function placeElement(m: THREE.Matrix4, pos: THREE.Vector3, yaw: number, scale = 1): void {
  _q.setFromAxisAngle(_Y, yaw);
  m.compose(pos, _q, _s.set(scale, scale, scale));
}

export function cloudMatrix(m: THREE.Matrix4, i: number, t: number): void {
  const c = CLOUDS[i];
  const a = c.a0 + c.w * t;
  onCircle(_p, a, c.r, c.y);
  placeElement(m, _p, a + Math.PI / 2, c.scale);
}

export function balloonMatrix(m: THREE.Matrix4, i: number, t: number, yOffset = 0): void {
  const b = BALLOONS[i];
  const a = b.a0 + b.w * t;
  onCircle(_p, a, b.r, b.y + yOffset + 3 * Math.sin(t * 0.45 + b.phase));
  // Rotation lente sur elle-même : on voit les rayures tourner.
  placeElement(m, _p, t * 0.12 + b.phase);
}

export function birdMatrix(m: THREE.Matrix4, g: number, i: number, t: number, spacing: number): void {
  const yaw = birdState(BIRD_GROUPS[g], i, t, spacing, _p, _d);
  placeElement(m, _p, yaw);
}

export function rainbowMatrix(m: THREE.Matrix4): void {
  onCircle(_p, RAINBOW_AZIMUTH, R_RAINBOW, 0);
  // Face tournée vers le joueur (le plan XY local regarde l'origine).
  placeElement(m, _p, RAINBOW_AZIMUTH + Math.PI / 2);
}

export function sunMatrixPosition(out: THREE.Vector3): THREE.Vector3 {
  return sunPosition(out, R_SUN);
}

/**
 * Dragon gentil en blocs (laine teintée du jeu) : gros corps vert, tête ronde avec de grands yeux,
 * petites cornes blanches, une dent qui dépasse, queue en 3 segments, 2 grandes ailes qui battent.
 * Repère : +X = avant. Aucun feu.
 */
export function addBlockDragon(batch: BlockBatch, el: number, k: number): void {
  const G = 0x5cc23a; // vert laine du jeu
  const L = 0x9be05a; // vert clair (ailes)
  const B = 0xd8f08a; // ventre
  const O = 0xff9800; // crêtes
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
    box(1.2, -1.35, s * 0.6, 0.5, 0.8, 0.5, G); // patte avant
    box(-1.2, -1.35, s * 0.6, 0.5, 0.8, 0.5, G); // patte arrière
  }
  box(-2.6, 0.2, 0, 1.6, 1.4, 1.4, G); // queue
  box(-3.9, 0.5, 0, 1.4, 1, 1, G);
  box(-5.0, 0.9, 0, 1, 0.7, 0.7, G);
  box(-5.8, 1.1, 0, 0.8, 0.6, 0.2, O); // bout de queue
  for (const x of [-1.2, 0, 1.2]) box(x, 1.2, 0, 0.5, 0.5, 0.3, O); // crêtes du dos
  batch.addWing(el, 1, new THREE.Vector3(0.2 * k, 0.9 * k, 1.0 * k), 2.4 * k, 0.2 * k, 3.8 * k, L);
  batch.addWing(el, -1, new THREE.Vector3(0.2 * k, 0.9 * k, -1.0 * k), 2.4 * k, 0.2 * k, 3.8 * k, L);
}

export function dragonMatrix(m: THREE.Matrix4, t: number): void {
  const yaw = dragonState(t, _p, _d);
  placeElement(m, _p, yaw);
}
