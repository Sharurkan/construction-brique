import * as THREE from 'three';
import type { TileKey } from '../core/types';
import { ALL_TILE_KEYS, BLOCKS } from './blocks';

/**
 * Atlas de textures : une seule texture contenant toutes les tuiles, rangées en grille.
 * Chaque cellule = tuile + `padding` pixels d'extrusion de ses bords (anti-bleeding).
 *
 * Convention UV : la texture est créée avec flipY = false, donc v = 0 est le HAUT de l'image.
 * `tileUV` renvoie la zone utile (sans padding) dans cette convention.
 */
export interface TextureAtlas {
  texture: THREE.Texture;
  tileUV(key: TileKey): { u0: number; v0: number; u1: number; v1: number };
  /** Index de la tuile (0 = tuile « manquante » magenta si la clé est inconnue). */
  tileIndex(key: TileKey): number;
  tilesPerRow: number;
  /** Taille d'une tuile en pixels (hors padding). */
  tileSize: number;
  /** Pixels d'extrusion autour de chaque tuile. */
  padding: number;
  /** Dimensions de la texture en pixels. */
  width: number;
  height: number;
}

/** Clé réservée de la tuile « manquante » (index 0). */
export const MISSING_TILE: TileKey = '__missing__';

type TileSource = HTMLImageElement | ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type AnyContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  throw new Error('Aucun canvas disponible pour construire l’atlas');
}

function ctx2d(c: AnyCanvas): AnyContext {
  const ctx = c.getContext('2d') as AnyContext | null;
  if (!ctx) throw new Error('Contexte 2D indisponible');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

function sourceSize(src: TileSource): { w: number; h: number } {
  if (typeof HTMLImageElement !== 'undefined' && src instanceof HTMLImageElement) {
    return { w: src.naturalWidth || src.width, h: src.naturalHeight || src.height };
  }
  return { w: src.width, h: src.height };
}

/**
 * Assemble un atlas à partir d'images individuelles (Phase 2 : PNG d'un pack open source).
 * Chaque image est redimensionnée (sans lissage) à `tileSize`, puis ses bords sont extrudés
 * sur `padding` pixels pour éviter le « bleeding » entre tuiles voisines.
 * Une tuile `MISSING_TILE` (damier magenta) est toujours ajoutée en index 0.
 */
export function createAtlasFromImages(
  tiles: Record<TileKey, TileSource>,
  tileSize: number,
  padding = 2,
): TextureAtlas {
  const keys = [MISSING_TILE, ...Object.keys(tiles).filter((k) => k !== MISSING_TILE)];
  const missing = makeCanvas(tileSize, tileSize);
  {
    const c = ctx2d(missing);
    const h = Math.max(1, tileSize / 2);
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        c.fillStyle = (x + y) % 2 ? '#000000' : '#ff00ff';
        c.fillRect(x * h, y * h, h, h);
      }
    }
  }

  const cell = tileSize + padding * 2;
  const tilesPerRow = Math.max(1, Math.ceil(Math.sqrt(keys.length)));
  const rows = Math.ceil(keys.length / tilesPerRow);
  const width = tilesPerRow * cell;
  const height = rows * cell;
  const canvas = makeCanvas(width, height);
  const ctx = ctx2d(canvas);

  const indexOf = new Map<TileKey, number>();
  keys.forEach((key, i) => {
    indexOf.set(key, i);
    const src: TileSource = key === MISSING_TILE ? missing : tiles[key];
    const { w: sw, h: sh } = sourceSize(src);
    const x = (i % tilesPerRow) * cell;
    const y = Math.floor(i / tilesPerRow) * cell;
    const p = padding;
    const t = tileSize;
    // Tuile
    ctx.drawImage(src, 0, 0, sw, sh, x + p, y + p, t, t);
    if (p > 0) {
      // Bords (bande de 1 px source étirée sur p px)
      ctx.drawImage(src, 0, 0, sw, 1, x + p, y, t, p); // haut
      ctx.drawImage(src, 0, sh - 1, sw, 1, x + p, y + p + t, t, p); // bas
      ctx.drawImage(src, 0, 0, 1, sh, x, y + p, p, t); // gauche
      ctx.drawImage(src, sw - 1, 0, 1, sh, x + p + t, y + p, p, t); // droite
      // Coins
      ctx.drawImage(src, 0, 0, 1, 1, x, y, p, p);
      ctx.drawImage(src, sw - 1, 0, 1, 1, x + p + t, y, p, p);
      ctx.drawImage(src, 0, sh - 1, 1, 1, x, y + p + t, p, p);
      ctx.drawImage(src, sw - 1, sh - 1, 1, 1, x + p + t, y + p + t, p, p);
    }
  });

  const texture = new THREE.CanvasTexture(canvas as HTMLCanvasElement);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false; // pas de mipmaps : évite tout mélange entre tuiles
  texture.flipY = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  return {
    texture,
    tilesPerRow,
    tileSize,
    padding,
    width,
    height,
    tileIndex(key) {
      return indexOf.get(key) ?? 0;
    },
    tileUV(key) {
      const i = indexOf.get(key) ?? 0;
      const x = (i % tilesPerRow) * cell + padding;
      const y = Math.floor(i / tilesPerRow) * cell + padding;
      return { u0: x / width, v0: y / height, u1: (x + tileSize) / width, v1: (y + tileSize) / height };
    },
  };
}

// ---------------------------------------------------------------------------
// Tuiles PROVISOIRES (Phase 1) : couleur unie + léger bruit. Remplacées en Phase 2.
// ---------------------------------------------------------------------------

function hex(c: number): [number, number, number] {
  return [(c >> 16) & 255, (c >> 8) & 255, c & 255];
}

/** Couleur de base de chaque tuile provisoire (dérivée des couleurs de BLOCKS + variantes). */
function placeholderColor(key: TileKey): number {
  switch (key) {
    case 'grass_top':
      return 0x5fbf3a;
    case 'grass_side':
      return 0x8b5a2b;
    case 'log_top':
      return 0xb08850;
    default: {
      for (const def of Object.values(BLOCKS)) {
        if (def.tiles.side === key || def.tiles.top === key || def.tiles.bottom === key) return def.color;
      }
      return 0xff00ff;
    }
  }
}

function drawPlaceholderTile(key: TileKey, size: number, rand: () => number): AnyCanvas {
  const c = makeCanvas(size, size);
  const ctx = ctx2d(c);
  const img = ctx.createImageData(size, size);
  const [r, g, b] = hex(placeholderColor(key));
  const noise = key.startsWith('wool') ? 10 : 22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      let n = (rand() - 0.5) * noise;
      let rr = r;
      let gg = g;
      let bb = b;
      let a = 255;
      if (key === 'grass_side' && y < size * 0.25 + (rand() < 0.4 ? 1 : 0)) {
        [rr, gg, bb] = hex(0x5fbf3a); // liseré d'herbe en haut du côté
      } else if (key === 'brick') {
        const row = Math.floor(y / (size / 4));
        const off = row % 2 ? size / 4 : 0;
        if (y % (size / 4) === 0 || (x + off) % (size / 2) === 0) [rr, gg, bb] = hex(0xd8cfc0); // joints
      } else if (key === 'planks' && y % (size / 4) === 0) {
        n -= 40;
      } else if (key === 'log_side' && x % 4 === 0) {
        n -= 25;
      } else if (key === 'log_top') {
        const d = Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5);
        if (d > size / 2 - 1.5) [rr, gg, bb] = hex(0x6b4a2a);
        else if (Math.floor(d) % 3 === 0) n -= 25;
      } else if (key === 'leaves') {
        if (rand() < 0.18) a = 0; // trous : rendu « cutout » (alphaTest)
      } else if (key === 'glass') {
        const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
        const shine = x - y === 3 || x - y === 4;
        if (edge) [rr, gg, bb, a] = [230, 245, 255, 255];
        else if (shine) [rr, gg, bb, a] = [255, 255, 255, 170];
        else a = 60;
        n = 0;
      } else if (key === 'diamond_block' || key === 'gold_block') {
        if (x === 0 || y === 0) n += 40;
        else if (x === size - 1 || y === size - 1) n -= 40;
      }
      img.data[i] = clamp255(rr + n);
      img.data[i + 1] = clamp255(gg + n);
      img.data[i + 2] = clamp255(bb + n);
      img.data[i + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/**
 * Atlas provisoire dessiné sur canvas (tuiles 16×16, couleur unie + léger bruit).
 * Nécessite un DOM (ou OffscreenCanvas). Aucune prétention artistique.
 */
export function createPlaceholderAtlas(tileSize = 16): TextureAtlas {
  let s = 1234567;
  const rand = () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s / 4294967296;
  };
  const tiles: Record<TileKey, TileSource> = {};
  for (const key of ALL_TILE_KEYS) tiles[key] = drawPlaceholderTile(key, tileSize, rand);
  return createAtlasFromImages(tiles, tileSize, 2);
}
