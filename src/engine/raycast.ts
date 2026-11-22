import { BlockId, type RaycastHit, type Vec3i } from '../core/types';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * Lancer de rayon voxel (DDA, Amanatides & Woo, 1987).
 *
 * - `get(x, y, z)` n'est appelé que pour des coordonnées DANS le volume [0,size) ;
 *   le rayon est d'abord découpé par la boîte du monde, ce qui permet de viser le
 *   monde depuis l'extérieur (caméra orbitale de la démo) sans parcourir le vide.
 * - L'Air est ignoré ; tous les autres blocs (bedrock compris) arrêtent le rayon.
 * - `distance` = distance le long du rayon (direction normalisée) jusqu'à la face touchée.
 * - Si l'origine est déjà dans un bloc plein, il est renvoyé avec distance 0 et une
 *   normale opposée à l'axe dominant de la direction.
 */
export function raycastVoxels(
  get: (x: number, y: number, z: number) => number,
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  origin: Vec3Like,
  dir: Vec3Like,
  maxDist: number,
): RaycastHit | null {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (!(len > 0) || !(maxDist > 0)) return null;
  const dx = dir.x / len;
  const dy = dir.y / len;
  const dz = dir.z / len;
  const ox = origin.x;
  const oy = origin.y;
  const oz = origin.z;

  // --- Découpage par la boîte du monde (méthode des « slabs »). ---
  let tEnter = 0;
  let tExit = maxDist;
  let enterAxis = -1;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const s = [sizeX, sizeY, sizeZ];
  for (let a = 0; a < 3; a++) {
    if (d[a] === 0) {
      if (o[a] < 0 || o[a] > s[a]) return null;
      continue;
    }
    let t1 = (0 - o[a]) / d[a];
    let t2 = (s[a] - o[a]) / d[a];
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tEnter) {
      tEnter = t1;
      enterAxis = a;
    }
    if (t2 < tExit) tExit = t2;
    if (tEnter > tExit) return null;
  }

  // Point d'entrée et voxel de départ (borné dans le volume).
  const px = ox + dx * tEnter;
  const py = oy + dy * tEnter;
  const pz = oz + dz * tEnter;
  let x = clampInt(Math.floor(px), 0, sizeX - 1);
  let y = clampInt(Math.floor(py), 0, sizeY - 1);
  let z = clampInt(Math.floor(pz), 0, sizeZ - 1);

  const normal: Vec3i = [0, 0, 0];
  if (enterAxis >= 0) {
    normal[enterAxis] = d[enterAxis] > 0 ? -1 : 1;
  } else {
    // Origine dans le volume : normale « par défaut » face au rayon.
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const az = Math.abs(dz);
    if (ax >= ay && ax >= az) normal[0] = dx > 0 ? -1 : 1;
    else if (ay >= az) normal[1] = dy > 0 ? -1 : 1;
    else normal[2] = dz > 0 ? -1 : 1;
  }

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  // tMax* : t absolu (depuis l'origine) du prochain franchissement de plan sur chaque axe.
  let tMaxX = stepX > 0 ? (x + 1 - ox) / dx : stepX < 0 ? (x - ox) / dx : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - oy) / dy : stepY < 0 ? (y - oy) / dy : Infinity;
  let tMaxZ = stepZ > 0 ? (z + 1 - oz) / dz : stepZ < 0 ? (z - oz) / dz : Infinity;
  const tDeltaX = stepX !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dz) : Infinity;

  let t = tEnter;
  // Borne de sécurité : nombre maximal de voxels traversables dans la boîte.
  let guard = sizeX + sizeY + sizeZ + 3;
  while (guard-- > 0) {
    if (x < 0 || y < 0 || z < 0 || x >= sizeX || y >= sizeY || z >= sizeZ) return null;
    const id = get(x, y, z);
    if (id !== BlockId.Air) {
      return { block: [x, y, z], normal: [normal[0], normal[1], normal[2]], id: id as BlockId, distance: t };
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      t = tMaxX;
      x += stepX;
      tMaxX += tDeltaX;
      normal[0] = -stepX;
      normal[1] = 0;
      normal[2] = 0;
    } else if (tMaxY < tMaxZ) {
      t = tMaxY;
      y += stepY;
      tMaxY += tDeltaY;
      normal[0] = 0;
      normal[1] = -stepY;
      normal[2] = 0;
    } else {
      t = tMaxZ;
      z += stepZ;
      tMaxZ += tDeltaZ;
      normal[0] = 0;
      normal[1] = 0;
      normal[2] = -stepZ;
    }
    if (t > maxDist) return null;
  }
  return null;
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
