import { BlockId, type RaycastHit } from '../core/types';

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
 * - `ignore` (optionnel) : id de bloc traversé comme de l'air TANT QUE le rayon n'a pas encore
 *   rencontré d'air (ex. l'eau dans laquelle se trouve l'œil : on vise le fond ou la berge ;
 *   une autre étendue d'eau plus loin, après de l'air, redevient visable).
 * - `out` (optionnel) : résultat réutilisé (aucune allocation par appel) ; il est renvoyé
 *   rempli en cas d'impact, sinon `null` (son contenu est alors indéterminé).
 */
export function raycastVoxels(
  get: (x: number, y: number, z: number) => number,
  sizeX: number,
  sizeY: number,
  sizeZ: number,
  origin: Vec3Like,
  dir: Vec3Like,
  maxDist: number,
  out?: RaycastHit,
  ignore = -1,
): RaycastHit | null {
  const len = Math.hypot(dir.x, dir.y, dir.z);
  if (!(len > 0) || !(maxDist > 0)) return null;
  const dx = dir.x / len;
  const dy = dir.y / len;
  const dz = dir.z / len;
  const ox = origin.x;
  const oy = origin.y;
  const oz = origin.z;

  // --- Découpage par la boîte du monde (méthode des « slabs »), axe par axe sans tableau. ---
  slab.tEnter = 0;
  slab.tExit = maxDist;
  slab.axis = -1;
  if (!clipAxis(ox, dx, sizeX, 0) || !clipAxis(oy, dy, sizeY, 1) || !clipAxis(oz, dz, sizeZ, 2)) return null;
  const tEnter = slab.tEnter;
  const enterAxis = slab.axis;

  // Point d'entrée et voxel de départ (borné dans le volume).
  let x = clampInt(Math.floor(ox + dx * tEnter), 0, sizeX - 1);
  let y = clampInt(Math.floor(oy + dy * tEnter), 0, sizeY - 1);
  let z = clampInt(Math.floor(oz + dz * tEnter), 0, sizeZ - 1);

  let nx = 0;
  let ny = 0;
  let nz = 0;
  if (enterAxis === 0) nx = dx > 0 ? -1 : 1;
  else if (enterAxis === 1) ny = dy > 0 ? -1 : 1;
  else if (enterAxis === 2) nz = dz > 0 ? -1 : 1;
  else {
    // Origine dans le volume : normale « par défaut » face au rayon.
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const az = Math.abs(dz);
    if (ax >= ay && ax >= az) nx = dx > 0 ? -1 : 1;
    else if (ay >= az) ny = dy > 0 ? -1 : 1;
    else nz = dz > 0 ? -1 : 1;
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
    if (id === BlockId.Air) ignore = -1;
    else if (id !== ignore) {
      if (!out) return { block: [x, y, z], normal: [nx, ny, nz], id: id as BlockId, distance: t };
      out.block[0] = x;
      out.block[1] = y;
      out.block[2] = z;
      out.normal[0] = nx;
      out.normal[1] = ny;
      out.normal[2] = nz;
      out.id = id as BlockId;
      out.distance = t;
      return out;
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      t = tMaxX;
      x += stepX;
      tMaxX += tDeltaX;
      nx = -stepX;
      ny = 0;
      nz = 0;
    } else if (tMaxY < tMaxZ) {
      t = tMaxY;
      y += stepY;
      tMaxY += tDeltaY;
      nx = 0;
      ny = -stepY;
      nz = 0;
    } else {
      t = tMaxZ;
      z += stepZ;
      tMaxZ += tDeltaZ;
      nx = 0;
      ny = 0;
      nz = -stepZ;
    }
    if (t > maxDist) return null;
  }
  return null;
}

/** État du découpage (module, réutilisé : le raycast n'est pas réentrant). */
const slab = { tEnter: 0, tExit: 0, axis: -1 };

/** Restreint [tEnter, tExit] à la tranche [0, size] d'un axe. Renvoie false si le rayon la manque. */
function clipAxis(o: number, d: number, size: number, axis: number): boolean {
  if (d === 0) return !(o < 0 || o > size);
  let t1 = (0 - o) / d;
  let t2 = (size - o) / d;
  if (t1 > t2) {
    const tmp = t1;
    t1 = t2;
    t2 = tmp;
  }
  if (t1 > slab.tEnter) {
    slab.tEnter = t1;
    slab.axis = axis;
  }
  if (t2 < slab.tExit) slab.tExit = t2;
  return slab.tEnter <= slab.tExit;
}

/** Résultat vide à passer en `out` (réutilisable). */
export function createRaycastHit(): RaycastHit {
  return { block: [0, 0, 0], normal: [0, 0, 0], id: BlockId.Air, distance: 0 };
}

function clampInt(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
