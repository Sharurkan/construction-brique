import type { BlockId, TileKey } from '../core/types';
import { BLOCKS } from '../engine';

/** Taille des vignettes (px) : 2× la case de palette (64 px CSS) pour rester net en HiDPI. */
export const BLOCK_ICON_SIZE = 128;

/** Assombrissement des côtés du mini-cube (gauche, droite), comme l'ombrage du monde. */
const SIDE_DARKEN = [0.18, 0.34];

function shadedTile(tile: HTMLCanvasElement, darken: number): HTMLCanvasElement {
  if (darken <= 0) return tile;
  const c = document.createElement('canvas');
  c.width = tile.width;
  c.height = tile.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(tile, 0, 0);
  ctx.globalCompositeOperation = 'source-atop'; // ne pas assombrir les trous (verre, feuilles)
  ctx.fillStyle = `rgba(0,0,0,${darken})`;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

/**
 * Mini-cube isométrique d'un bloc avec ses vraies tuiles : dessus + 2 côtés assombris.
 * Renvoie null si une tuile manque.
 */
export function renderBlockIcon(
  id: BlockId,
  tiles: Map<TileKey, HTMLCanvasElement>,
  size = BLOCK_ICON_SIZE,
): HTMLCanvasElement | null {
  const def = BLOCKS[id];
  const top = tiles.get(def.tiles.top);
  const side = tiles.get(def.tiles.side);
  if (!top || !side) return null;

  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const T = top.width;
  const w = size * 0.42; // demi-largeur du cube
  const h = w * 0.5; // demi-hauteur du losange du dessus
  const H = w * 1.05; // hauteur des côtés
  const cx = size / 2;
  const y0 = (size - (2 * h + H)) / 2;
  // Léger recouvrement (en texels) pour masquer les coutures d'anticrénelage entre faces.
  const e = 0.6;

  const face = (img: HTMLCanvasElement, a: number, b: number, cc: number, d: number, ox: number, oy: number): void => {
    ctx.setTransform(a / T, b / T, cc / T, d / T, ox, oy);
    ctx.drawImage(img, -e, -e, T + 2 * e, T + 2 * e);
  };
  // Côté gauche : de (cx - w, y0 + h) vers le centre-bas.
  face(shadedTile(side, SIDE_DARKEN[0]), w, h, 0, H, cx - w, y0 + h);
  // Côté droit : du centre (cx, y0 + 2h) vers la droite-haut.
  face(shadedTile(side, SIDE_DARKEN[1]), w, -h, 0, H, cx, y0 + 2 * h);
  // Dessus : losange à partir du sommet (cx, y0).
  face(top, w, h, -w, h, cx, y0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return c;
}
