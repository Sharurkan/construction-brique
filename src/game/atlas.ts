import { createPlaceholderAtlas, type TextureAtlas } from '../engine';

/**
 * Crée l'atlas de textures des blocs.
 *
 * POINT D'EXTENSION (vraies textures Kenney) : quand `src/assets/manifest.ts` existera
 * (Agent F), charger ici ses images puis les assembler, par exemple :
 *
 *   import { TEXTURES } from '../assets/manifest';            // Record<TileKey, url>
 *   const images = await Promise.all(Object.entries(TEXTURES).map(loadImage));
 *   return createAtlasFromImages(Object.fromEntries(images), 16); // ou la taille du pack
 *
 * en gardant `createPlaceholderAtlas()` comme repli si une image manque ou échoue
 * (une tuile absente s'affiche sinon en damier magenta). Le reste du jeu ne dépend que
 * de cette fonction : rien d'autre à modifier. Pour changer d'atlas à chaud :
 * `worldRenderer.setAtlas(atlas)`.
 */
export async function loadAtlas(): Promise<TextureAtlas> {
  return createPlaceholderAtlas();
}
