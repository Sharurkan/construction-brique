import { ALL_TILE_KEYS, createAtlasFromImages, createPlaceholderAtlas, type TextureAtlas } from '../engine';
import type { TileKey } from '../core/types';
import { GEM_BLOCK_TILES, TEXTURE_TILES, TILE_SIZE, WOOL_TINTS } from '../assets/manifest';

/**
 * Atlas des blocs construit à partir des vraies tuiles Kenney (Voxel Pack, CC0).
 *
 * TAILLE DES TUILES DANS L'ATLAS : 64 px (sources 128 px).
 * - Les tuiles Kenney ne sont pas du pixel-art « grille 16 px » mais des aplats avec des
 *   carrés tournés : réduites de moitié avec un filtrage boîte (lissage canvas, facteur 2
 *   exact), elles restent nettes ; à 32 px les petits motifs (minerais, laine, verre)
 *   deviennent de la bouillie.
 * - L'atlas n'a pas de mipmaps (NearestFilter, pour éviter les coutures du fract()) : des
 *   tuiles de 128 px scintillent nettement au loin ; 64 px divise ce scintillement par deux.
 * - Mémoire GPU : ~6×6 cellules de 68 px ≈ 408² px ≈ 0,7 Mo (contre ≈ 2,6 Mo à 128 px).
 */
export const ATLAS_TILE_SIZE = 64;
const ATLAS_PADDING = 2;

type Canvas = HTMLCanvasElement;

export interface BlockTextures {
  atlas: TextureAtlas;
  /** Tuiles finales (taille ATLAS_TILE_SIZE) par clé, ou null si atlas provisoire. */
  tiles: Map<TileKey, Canvas> | null;
}

/**
 * Couleurs finales des laines (base du teintage). Reprend WOOL_TINTS, sauf :
 * - blanc : blanc cassé (un blanc pur ferait disparaître le motif) ;
 * - noir : gris très sombre, assez clair pour que le motif reste visible.
 */
const WOOL_TARGET: Record<string, number> = {
  ...WOOL_TINTS,
  white: 0xf3f1ec,
  black: 0x2c2c32,
};

function makeCanvas(size: number): Canvas {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

function ctx2d(c: Canvas): CanvasRenderingContext2D {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Contexte 2D indisponible');
  return ctx;
}

async function loadImage(url: string): Promise<CanvasImageSource> {
  if (typeof createImageBitmap === 'function' && typeof fetch === 'function') {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return createImageBitmap(await res.blob());
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image ${url}`));
    img.src = url;
  });
}

/** Réduit une tuile 128 px à `size` px (filtrage boîte via le lissage du canvas). */
function downscale(src: CanvasImageSource, size: number): Canvas {
  const c = makeCanvas(size);
  const ctx = ctx2d(c);
  ctx.imageSmoothingEnabled = size !== TILE_SIZE;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, TILE_SIZE, TILE_SIZE, 0, 0, size, size);
  return c;
}

/**
 * Teinte la tuile de laine claire : la couleur cible est appliquée telle quelle et le motif
 * (écart de luminance de chaque pixel à la luminance moyenne) est ajouté par-dessus. Le
 * motif reste ainsi visible pour toutes les couleurs, du blanc cassé au noir.
 */
export function tintWool(base: Canvas, color: number, contrast = 1.25): Canvas {
  const size = base.width;
  const src = ctx2d(base).getImageData(0, 0, size, size).data;
  let mean = 0;
  let n = 0;
  const lum = new Float32Array(size * size);
  for (let i = 0; i < lum.length; i++) {
    const p = i * 4;
    lum[i] = 0.299 * src[p] + 0.587 * src[p + 1] + 0.114 * src[p + 2];
    if (src[p + 3] > 0) {
      mean += lum[i];
      n++;
    }
  }
  mean /= Math.max(1, n);
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  // Sur une couleur très claire, l'écart vers le haut sature : on le reporte vers le bas.
  const bright = Math.min(r, g, b) > 200;
  const out = makeCanvas(size);
  const octx = ctx2d(out);
  const img = octx.createImageData(size, size);
  for (let i = 0; i < lum.length; i++) {
    const p = i * 4;
    let d = (lum[i] - mean) * contrast;
    if (bright) d = -Math.abs(d);
    img.data[p] = clamp(r + d);
    img.data[p + 1] = clamp(g + d);
    img.data[p + 2] = clamp(b + d);
    img.data[p + 3] = src[p + 3];
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/**
 * Bloc précieux plein (or, diamant) à partir d'une tuile Kenney lisse : transformation de
 * couleur seule. La couleur cible remplace la teinte ; le relief de la tuile (écart de
 * luminance de chaque pixel à la moyenne, normalisé par l'écart-type pour que les motifs
 * discrets de la glace ressortent) est ajouté par-dessus, en `amplitude` niveaux par écart-type.
 * Résultat opaque (les pixels transparents de la base prennent la couleur cible).
 */
export function recolorGem(base: Canvas, color: number, amplitude = 26): Canvas {
  const size = base.width;
  const src = ctx2d(base).getImageData(0, 0, size, size).data;
  const lum = new Float32Array(size * size);
  let sum = 0;
  let sum2 = 0;
  let n = 0;
  for (let i = 0; i < lum.length; i++) {
    const p = i * 4;
    const a = src[p + 3] / 255;
    // Pixel (semi-)transparent : composé sur blanc, comme le verre posé sur un fond clair.
    const l = 0.299 * src[p] + 0.587 * src[p + 1] + 0.114 * src[p + 2];
    lum[i] = l * a + 255 * (1 - a);
    sum += lum[i];
    sum2 += lum[i] * lum[i];
    n++;
  }
  const mean = sum / n;
  const std = Math.max(1, Math.sqrt(Math.max(0, sum2 / n - mean * mean)));
  const r = (color >> 16) & 255;
  const g = (color >> 8) & 255;
  const b = color & 255;
  const out = makeCanvas(size);
  const octx = ctx2d(out);
  const img = octx.createImageData(size, size);
  for (let i = 0; i < lum.length; i++) {
    const p = i * 4;
    // Écart borné à ±2,5 σ : les reflets restent des reflets, sans brûler toute la tuile.
    const z = Math.max(-2.5, Math.min(2.5, (lum[i] - mean) / std));
    const d = z * amplitude;
    img.data[p] = clamp(r + d);
    img.data[p + 1] = clamp(g + d);
    img.data[p + 2] = clamp(b + d);
    img.data[p + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

/** Clé du manifeste à utiliser pour une clé de tuile de BLOCKS (null si laine teintée). */
function manifestKeyFor(key: TileKey): string | null {
  // Laines : toujours teintées, même quand le pack a une version native (wool_red/green/blue,
  // couleurs terreuses : le rouge Kenney se confond avec la brique). Cohérence des 9 couleurs.
  if (key.startsWith('wool_')) return null;
  if (key in TEXTURE_TILES) return key;
  return null;
}

/** Charge les vraies tuiles et construit l'atlas. Repli sur l'atlas provisoire en cas d'échec. */
export async function loadBlockTextures(debug = false): Promise<BlockTextures> {
  try {
    const size = ATLAS_TILE_SIZE;
    const needed = new Set<string>(['wool']);
    for (const key of ALL_TILE_KEYS) {
      const m = manifestKeyFor(key);
      if (m) needed.add(m);
      const gem = GEM_BLOCK_TILES[key];
      if (gem) needed.add(gem.base);
    }
    const loaded = new Map<string, Canvas>();
    await Promise.all(
      [...needed].map(async (k) => {
        loaded.set(k, downscale(await loadImage(TEXTURE_TILES[k]), size));
      }),
    );

    const woolBase = loaded.get('wool')!;
    const tiles = new Map<TileKey, Canvas>();
    for (const key of ALL_TILE_KEYS) {
      const m = manifestKeyFor(key);
      if (m && loaded.has(m)) {
        tiles.set(key, loaded.get(m)!);
        continue;
      }
      const wool = /^wool_(\w+)$/.exec(key);
      if (wool && wool[1] in WOOL_TARGET) {
        tiles.set(key, tintWool(woolBase, WOOL_TARGET[wool[1]]));
        continue;
      }
      const gem = GEM_BLOCK_TILES[key];
      if (gem && loaded.has(gem.base)) {
        tiles.set(key, recolorGem(loaded.get(gem.base)!, gem.color));
        continue;
      }
      // Clé inconnue : tuile la plus proche (même préfixe), sinon damier « manquant ».
      const prefix = key.split('_')[0];
      const near = [...loaded.keys()].find((k) => k.startsWith(prefix));
      if (debug) console.debug(`[atlas] pas de tuile pour « ${key} » → ${near ?? 'MISSING'}`);
      if (near) tiles.set(key, loaded.get(near)!);
    }

    const atlas = createAtlasFromImages(Object.fromEntries(tiles), size, ATLAS_PADDING);
    if (debug) console.debug(`[atlas] ${tiles.size} tuiles de ${size} px, texture ${atlas.width}×${atlas.height}`);
    return { atlas, tiles };
  } catch (err) {
    console.warn('[atlas] textures indisponibles, atlas provisoire utilisé', err);
    return { atlas: createPlaceholderAtlas(), tiles: null };
  }
}

/** Compatibilité : seulement l'atlas. */
export async function loadAtlas(): Promise<TextureAtlas> {
  return (await loadBlockTextures()).atlas;
}
