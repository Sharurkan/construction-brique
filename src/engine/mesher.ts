/**
 * Greedy meshing par chunk (fonction pure, sans DOM ni WebGL : testable sous Node).
 *
 * Principe : pour chacune des 6 orientations et chaque tranche de 16×16, on construit un
 * masque des faces visibles, chaque face étant décrite par une clé (tuile, passe, AO des
 * 4 coins). On fusionne ensuite en rectangles maximaux les cellules de MÊME clé : deux
 * faces ne fusionnent donc que si elles ont la même tuile, la même orientation, la même
 * passe de rendu et la même occlusion ambiante → l'AO n'empêche la fusion que là où
 * l'ombrage différerait réellement.
 *
 * Les UV émis sont « locaux » et exprimés en blocs (un quad de 5×3 blocs a des UV de 0 à 5
 * et 0 à 3) : le shader (voir materials.ts) répète la tuile avec fract(). L'index de tuile
 * est fourni par sommet.
 */
import { BlockId, CHUNK_SIZE, type TileKey, type VoxelWorld } from '../core/types';
import { BLOCKS, BLOCK_COUNT, isCutout, isGem, isWater } from './blocks';
import { World } from './world';

/** Sous-ensemble de TextureAtlas utile au mesher (permet des tests sans Three/DOM). */
export interface TileLookup {
  tileIndex(key: TileKey): number;
}

export interface MeshData {
  /** Positions xyz, LOCALES au chunk (0..16). */
  positions: Float32Array;
  /** UV locaux en blocs (u, v), répétés dans le shader via fract(). v vers le haut. */
  uvs: Float32Array;
  /** Index de tuile de l'atlas, par sommet. */
  tiles: Uint16Array;
  /** Luminosité (ombrage de face × AO), 0..255 → normalisé dans le shader. */
  shades: Uint8Array;
  /** Orientation de la face par sommet : 0 +X, 1 −X, 2 +Y, 3 −Y, 4 +Z, 5 −Z. */
  faces: Uint8Array;
  indices: Uint16Array | Uint32Array;
  vertexCount: number;
  quadCount: number;
  /**
   * Pour la passe transparente : les `cutoutIndexCount` premiers indices sont les faces
   * « découpées » (feuilles, alphaTest), le reste les faces mélangées (verre). 0 pour l'opaque.
   */
  cutoutIndexCount: number;
}

export interface ChunkMesh {
  opaque: MeshData;
  transparent: MeshData;
  /**
   * Blocs précieux pleins (isGem) : opaques (ils cachent leurs voisins comme la pierre) mais
   * maillés à part pour le matériau « gemme ». Vide (quadCount = 0) dans la plupart des chunks.
   */
  gem: MeshData;
  /**
   * Eau (matériau eau animé, semi-transparent). Faces seulement contre l'air ou un bloc
   * transparent d'un autre id : rien entre deux blocs d'eau, rien contre un bloc opaque.
   * Vide dans les chunks sans eau (aucun mesh, donc aucun appel de dessin).
   */
  water: MeshData;
}

// ---------------------------------------------------------------------------
// Tables par id de bloc
// ---------------------------------------------------------------------------

const S = CHUNK_SIZE;
const P = S + 2; // volume rembourré d'un voxel de chaque côté
const STRIDE = [1, P, P * P]; // pas par axe x, y, z dans le volume rembourré

/** 1 si le bloc cache complètement ses voisins (plein et non transparent). */
const OPAQUE = new Uint8Array(BLOCK_COUNT);
/** 1 si le bloc est rendu dans la passe transparente. */
const TRANS = new Uint8Array(BLOCK_COUNT);
/** Passe : 0 opaque, 1 découpée (cutout), 2 mélangée (blend), 3 gemme (opaque, matériau à part), 4 eau. */
const PASS = new Uint8Array(BLOCK_COUNT);
for (let id = 1; id < BLOCK_COUNT; id++) {
  const def = BLOCKS[id as BlockId];
  OPAQUE[id] = def.transparent ? 0 : 1;
  TRANS[id] = def.transparent ? 1 : 0;
  PASS[id] = isWater(id) ? 4 : def.transparent ? (isCutout(id) ? 1 : 2) : isGem(id) ? 3 : 0;
}

/**
 * Ombrage simple par face (lisibilité), indexé par face +X, −X, +Y, −Y, +Z, −Z :
 * dessus clair, côtés plus sombres (X et Z différents pour distinguer les arêtes), dessous sombre.
 */
const FACE_LIGHT = [0.78, 0.72, 1.0, 0.55, 0.88, 0.84];
/** Facteur d'occlusion ambiante par niveau (0 = coin très occulté, 3 = libre). */
const AO_LEVEL = [0.5, 0.67, 0.84, 1.0];

/** Tables tuile[id * 6 + face] mises en cache par atlas. */
const tileTables = new WeakMap<TileLookup, Uint16Array>();
function tileTable(atlas: TileLookup): Uint16Array {
  let t = tileTables.get(atlas);
  if (!t) {
    t = new Uint16Array(BLOCK_COUNT * 6);
    for (let id = 1; id < BLOCK_COUNT; id++) {
      const tiles = BLOCKS[id as BlockId].tiles;
      for (let f = 0; f < 6; f++) {
        const key = f === 2 ? tiles.top : f === 3 ? tiles.bottom : tiles.side;
        t[id * 6 + f] = atlas.tileIndex(key);
      }
    }
    tileTables.set(atlas, t);
  }
  return t;
}

// ---------------------------------------------------------------------------
// Tampons réutilisés (le maillage est synchrone : un seul jeu suffit)
// ---------------------------------------------------------------------------

const pad = new Uint8Array(P * P * P);
const mask = new Int32Array(S * S);

class Builder {
  positions = new Float32Array(4096 * 3);
  uvs = new Float32Array(4096 * 2);
  tiles = new Uint16Array(4096);
  shades = new Uint8Array(4096);
  faces = new Uint8Array(4096);
  indices = new Uint32Array(4096 * 1.5);
  vertexCount = 0;
  indexCount = 0;

  reset(): void {
    this.vertexCount = 0;
    this.indexCount = 0;
  }

  ensure(extraVerts: number): void {
    const need = this.vertexCount + extraVerts;
    if (need <= this.tiles.length) return;
    let cap = this.tiles.length;
    while (cap < need) cap *= 2;
    this.positions = grow(this.positions, cap * 3);
    this.uvs = grow(this.uvs, cap * 2);
    this.tiles = grow(this.tiles, cap);
    this.shades = grow(this.shades, cap);
    this.faces = grow(this.faces, cap);
    this.indices = grow(this.indices, cap * 1.5);
  }
}

function grow<T extends Float32Array | Uint16Array | Uint8Array | Uint32Array>(a: T, len: number): T {
  const b = new (a.constructor as new (n: number) => T)(len);
  b.set(a);
  return b;
}

const builders = [new Builder(), new Builder(), new Builder(), new Builder(), new Builder()]; // opaque, cutout, blend, gemme, eau

// Scratch pour un quad (évite les allocations par face).
const qx = new Float32Array(4);
const qy = new Float32Array(4);
const qz = new Float32Array(4);
const qao = new Uint8Array(4);

function emitQuad(
  b: Builder,
  f: number,
  d: number,
  u: number,
  plane: number,
  u0: number,
  v0: number,
  w: number,
  h: number,
  tile: number,
  ao: number,
): void {
  b.ensure(4);
  const base = b.vertexCount;
  // Coins dans l'ordre (0,0) (w,0) (w,h) (0,h) du repère (u, v) de la face.
  for (let c = 0; c < 4; c++) {
    const cu = c === 1 || c === 2 ? w : 0;
    const cv = c >= 2 ? h : 0;
    const p0 = d === 0 ? plane : u === 0 ? u0 + cu : v0 + cv;
    const p1 = d === 1 ? plane : u === 1 ? u0 + cu : v0 + cv;
    const p2 = d === 2 ? plane : u === 2 ? u0 + cu : v0 + cv;
    qx[c] = p0;
    qy[c] = p1;
    qz[c] = p2;
    qao[c] = (ao >> (c * 2)) & 3;
  }
  const light = FACE_LIGHT[f];
  for (let c = 0; c < 4; c++) {
    const vi = base + c;
    const x = qx[c];
    const y = qy[c];
    const z = qz[c];
    b.positions[vi * 3] = x;
    b.positions[vi * 3 + 1] = y;
    b.positions[vi * 3 + 2] = z;
    // UV en blocs, orientés pour que « haut » de la texture = +Y sur les côtés
    // et que la texture ne soit pas en miroir vue de l'extérieur.
    let tu: number;
    let tv: number;
    switch (f) {
      case 0: tu = -z; tv = y; break;
      case 1: tu = z; tv = y; break;
      case 2: tu = x; tv = -z; break;
      case 3: tu = x; tv = z; break;
      case 4: tu = x; tv = y; break;
      default: tu = -x; tv = y; break;
    }
    b.uvs[vi * 2] = tu;
    b.uvs[vi * 2 + 1] = tv;
    b.tiles[vi] = tile;
    b.shades[vi] = Math.round(255 * light * AO_LEVEL[qao[c]]);
    b.faces[vi] = f;
  }
  // Diagonale : on coupe le long de la paire de coins dont la somme d'AO est la plus
  // grande, pour confiner un coin sombre à un seul triangle (évite l'anisotropie).
  const flip = qao[0] + qao[2] < qao[1] + qao[3];
  const ix = b.indices;
  let k = b.indexCount;
  if (f % 2 === 0) {
    // normale positive : 0,1,2,3 est anti-horaire vu de l'extérieur
    if (!flip) { ix[k++] = base; ix[k++] = base + 1; ix[k++] = base + 2; ix[k++] = base; ix[k++] = base + 2; ix[k++] = base + 3; }
    else { ix[k++] = base + 1; ix[k++] = base + 2; ix[k++] = base + 3; ix[k++] = base + 1; ix[k++] = base + 3; ix[k++] = base; }
  } else {
    if (!flip) { ix[k++] = base; ix[k++] = base + 2; ix[k++] = base + 1; ix[k++] = base; ix[k++] = base + 3; ix[k++] = base + 2; }
    else { ix[k++] = base + 1; ix[k++] = base + 3; ix[k++] = base + 2; ix[k++] = base + 1; ix[k++] = base; ix[k++] = base + 3; }
  }
  b.indexCount = k;
  b.vertexCount = base + 4;
}

/** Remplit `pad` avec le chunk et une bordure d'un voxel. Renvoie false si le chunk est vide. */
function fillPadded(world: VoxelWorld, ox: number, oy: number, oz: number): boolean {
  let any = 0;
  if (world instanceof World) {
    const { data, sizeX, sizeY, sizeZ } = world;
    for (let z = -1; z <= S; z++) {
      const wz = oz + z;
      for (let y = -1; y <= S; y++) {
        const wy = oy + y;
        let pi = (y + 1) * P + (z + 1) * P * P;
        const rowInside = wy >= 0 && wy < sizeY && wz >= 0 && wz < sizeZ;
        const rowBase = wx0(sizeX, sizeZ, wy, wz);
        const interiorRow = y >= 0 && y < S && z >= 0 && z < S;
        for (let x = -1; x <= S; x++, pi++) {
          const wx = ox + x;
          let id: number;
          if (rowInside && wx >= 0 && wx < sizeX) id = data[rowBase + wx];
          else id = wy < 0 ? BlockId.Bedrock : BlockId.Air;
          pad[pi] = id;
          if (interiorRow && x >= 0 && x < S) any |= id;
        }
      }
    }
  } else {
    for (let z = -1; z <= S; z++) {
      for (let y = -1; y <= S; y++) {
        let pi = (y + 1) * P + (z + 1) * P * P;
        const interiorRow = y >= 0 && y < S && z >= 0 && z < S;
        for (let x = -1; x <= S; x++, pi++) {
          const id = world.getBlock(ox + x, oy + y, oz + z);
          pad[pi] = id;
          if (interiorRow && x >= 0 && x < S) any |= id;
        }
      }
    }
  }
  return any !== 0;
}

function wx0(sizeX: number, sizeZ: number, wy: number, wz: number): number {
  return sizeX * (wz + sizeZ * wy);
}

function finish(b: Builder): MeshData {
  return finishMerged(b, null);
}

/** Copie exacte des tampons ; si `b2` est fourni, ses données sont concaténées après `b`. */
function finishMerged(b: Builder, b2: Builder | null): MeshData {
  const v1 = b.vertexCount;
  const v2 = b2 ? b2.vertexCount : 0;
  const i1 = b.indexCount;
  const i2 = b2 ? b2.indexCount : 0;
  const vc = v1 + v2;
  const positions = new Float32Array(vc * 3);
  const uvs = new Float32Array(vc * 2);
  const tiles = new Uint16Array(vc);
  const shades = new Uint8Array(vc);
  const faces = new Uint8Array(vc);
  const indices = vc <= 65535 ? new Uint16Array(i1 + i2) : new Uint32Array(i1 + i2);
  positions.set(b.positions.subarray(0, v1 * 3));
  uvs.set(b.uvs.subarray(0, v1 * 2));
  tiles.set(b.tiles.subarray(0, v1));
  shades.set(b.shades.subarray(0, v1));
  faces.set(b.faces.subarray(0, v1));
  indices.set(b.indices.subarray(0, i1));
  if (b2) {
    positions.set(b2.positions.subarray(0, v2 * 3), v1 * 3);
    uvs.set(b2.uvs.subarray(0, v2 * 2), v1 * 2);
    tiles.set(b2.tiles.subarray(0, v2), v1);
    shades.set(b2.shades.subarray(0, v2), v1);
    faces.set(b2.faces.subarray(0, v2), v1);
    for (let i = 0; i < i2; i++) indices[i1 + i] = b2.indices[i] + v1;
  }
  return {
    positions,
    uvs,
    tiles,
    shades,
    faces,
    indices,
    vertexCount: vc,
    quadCount: vc / 4,
    cutoutIndexCount: b2 ? i1 : 0,
  };
}

/**
 * Maille le chunk (cx, cy, cz). Fonction pure vis-à-vis du monde (lecture seule).
 * Les faces au bord du monde sont dessinées (sauf le dessous de y = 0, couvert par le bedrock virtuel).
 */
export function meshChunk(world: VoxelWorld, cx: number, cy: number, cz: number, atlas: TileLookup): ChunkMesh {
  for (const b of builders) b.reset();
  const [bo, bc, bb, bg, bw] = builders;
  if (fillPadded(world, cx * S, cy * S, cz * S)) {
    const tt = tileTable(atlas);
    const c = [0, 0, 0];
    for (let f = 0; f < 6; f++) {
      const d = f >> 1;
      const sign = f & 1 ? -1 : 1;
      const u = (d + 1) % 3;
      const v = (d + 2) % 3;
      const sd = STRIDE[d] * sign;
      const su = STRIDE[u];
      const sv = STRIDE[v];
      for (let s = 0; s < S; s++) {
        c[d] = s;
        // 1) Masque des faces visibles de la tranche.
        let any = false;
        for (let iv = 0; iv < S; iv++) {
          c[v] = iv;
          for (let iu = 0; iu < S; iu++) {
            c[u] = iu;
            const pi = c[0] + 1 + (c[1] + 1) * P + (c[2] + 1) * P * P;
            const a = pad[pi];
            let key = 0;
            if (a !== 0) {
              const n = pi + sd;
              const nb = pad[n];
              // Visible si le voisin est de l'air, ou transparent et d'un autre id.
              if (nb === 0 || (TRANS[nb] === 1 && nb !== a)) {
                // AO des 4 coins, mesurée dans la couche d'air devant la face.
                const um = OPAQUE[pad[n - su]];
                const up = OPAQUE[pad[n + su]];
                const vm = OPAQUE[pad[n - sv]];
                const vp = OPAQUE[pad[n + sv]];
                const a00 = um && vm ? 0 : 3 - (um + vm + OPAQUE[pad[n - su - sv]]);
                const a10 = up && vm ? 0 : 3 - (up + vm + OPAQUE[pad[n + su - sv]]);
                const a11 = up && vp ? 0 : 3 - (up + vp + OPAQUE[pad[n + su + sv]]);
                const a01 = um && vp ? 0 : 3 - (um + vp + OPAQUE[pad[n - su + sv]]);
                const ao = a00 | (a10 << 2) | (a11 << 4) | (a01 << 6);
                key = (tt[a * 6 + f] + 1) | (ao << 16) | (PASS[a] << 24);
                any = true;
              }
            }
            mask[iu + iv * S] = key;
          }
        }
        if (!any) continue;
        // 2) Fusion gloutonne en rectangles de même clé.
        const plane = s + (sign > 0 ? 1 : 0);
        for (let iv = 0; iv < S; iv++) {
          for (let iu = 0; iu < S; ) {
            const i = iu + iv * S;
            const key = mask[i];
            if (key === 0) {
              iu++;
              continue;
            }
            let w = 1;
            while (iu + w < S && mask[i + w] === key) w++;
            let h = 1;
            outer: while (iv + h < S) {
              const row = i + h * S;
              for (let t = 0; t < w; t++) if (mask[row + t] !== key) break outer;
              h++;
            }
            const pass = key >>> 24;
            const target = pass === 0 ? bo : pass === 1 ? bc : pass === 2 ? bb : pass === 3 ? bg : bw;
            emitQuad(target, f, d, u, plane, iu, iv, w, h, (key & 0xffff) - 1, (key >>> 16) & 0xff);
            for (let hh = 0; hh < h; hh++) mask.fill(0, i + hh * S, i + hh * S + w);
            iu += w;
          }
        }
      }
    }
  }
  return { opaque: finish(bo), transparent: finishMerged(bc, bb), gem: finish(bg), water: finish(bw) };
}
