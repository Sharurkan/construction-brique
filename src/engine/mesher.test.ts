import { describe, expect, it } from 'vitest';
import { BlockId } from '../core/types';
import { ALL_TILE_KEYS } from './blocks';
import { meshChunk, type MeshData, type TileLookup } from './mesher';
import { World } from './world';
import { generateWorld } from './worldgen';

/** Atlas factice (sans Three ni DOM) : index = position dans ALL_TILE_KEYS + 1. */
const atlas: TileLookup = {
  tileIndex: (key) => ALL_TILE_KEYS.indexOf(key) + 1,
};

function facesOf(m: MeshData): number[] {
  const out: number[] = [];
  for (let q = 0; q < m.quadCount; q++) out.push(m.faces[q * 4]);
  return out.sort();
}

/** Aire totale (en faces de bloc) couverte par les quads. */
function area(m: MeshData): number {
  let a = 0;
  for (let q = 0; q < m.quadCount; q++) {
    const p = m.positions;
    const i = q * 12;
    const e1 = [p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]];
    const e2 = [p[i + 9] - p[i], p[i + 10] - p[i + 1], p[i + 11] - p[i + 2]];
    a += Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
  }
  return a;
}

function fillChunk(w: World, cx: number, cy: number, cz: number, id: BlockId) {
  for (let y = 0; y < 16; y++)
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) w.setBlockRaw(cx * 16 + x, cy * 16 + y, cz * 16 + z, id);
}

describe('meshChunk (greedy)', () => {
  it('chunk vide → aucun quad', () => {
    const w = new World();
    const m = meshChunk(w, 1, 1, 1, atlas);
    expect(m.opaque.quadCount).toBe(0);
    expect(m.transparent.quadCount).toBe(0);
  });

  it('un chunk plein isolé → 6 quads', () => {
    const w = new World();
    fillChunk(w, 2, 1, 3, BlockId.Stone);
    const m = meshChunk(w, 2, 1, 3, atlas);
    expect(m.opaque.quadCount).toBe(6);
    expect(facesOf(m.opaque)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(area(m.opaque)).toBeCloseTo(6 * 256);
    expect(m.transparent.quadCount).toBe(0);
    // UV locaux en blocs : la tuile sera répétée 16 fois, pas étirée.
    const us = Array.from(m.opaque.uvs.filter((_, i) => i % 2 === 0)).map(Math.abs);
    expect(Math.max(...us) - Math.min(...us)).toBe(16);
    expect(m.opaque.indices.length).toBe(36);
  });

  it('un bloc seul → 6 quads, 24 sommets, 36 indices', () => {
    const w = new World();
    w.setBlock(20, 20, 20, BlockId.Brick);
    const m = meshChunk(w, 1, 1, 1, atlas);
    expect(m.opaque.quadCount).toBe(6);
    expect(m.opaque.vertexCount).toBe(24);
    expect(m.opaque.indices).toBeInstanceOf(Uint16Array);
  });

  it('deux blocs adjacents de même type fusionnent, faces internes supprimées', () => {
    const w = new World();
    w.setBlock(20, 20, 20, BlockId.Planks);
    w.setBlock(21, 20, 20, BlockId.Planks);
    const m = meshChunk(w, 1, 1, 1, atlas);
    expect(m.opaque.quadCount).toBe(6);
    expect(area(m.opaque)).toBeCloseTo(10); // 12 faces − 2 internes
  });

  it('deux blocs adjacents de types différents ne fusionnent pas', () => {
    const w = new World();
    w.setBlock(20, 20, 20, BlockId.Planks);
    w.setBlock(21, 20, 20, BlockId.Brick);
    const m = meshChunk(w, 1, 1, 1, atlas);
    // 4 faces latérales communes non fusionnées (2 quads chacune) + 2 bouts = 10 quads.
    expect(m.opaque.quadCount).toBe(10);
    expect(area(m.opaque)).toBeCloseTo(10); // la face interne reste supprimée
  });

  it('tuiles différentes par face (herbe) : pas de fusion entre dessus et côtés', () => {
    const w = new World();
    w.setBlock(20, 20, 20, BlockId.Grass);
    const m = meshChunk(w, 1, 1, 1, atlas);
    const top = m.opaque.faces.indexOf(2);
    const side = m.opaque.faces.indexOf(0);
    expect(m.opaque.tiles[top]).toBe(atlas.tileIndex('grass_top'));
    expect(m.opaque.tiles[side]).toBe(atlas.tileIndex('grass_side'));
  });

  it('transparents : pas de face entre deux verres, faces visibles à travers le verre', () => {
    const w = new World();
    w.setBlock(20, 20, 20, BlockId.Glass);
    w.setBlock(21, 20, 20, BlockId.Glass);
    w.setBlock(22, 20, 20, BlockId.Stone);
    const m = meshChunk(w, 1, 1, 1, atlas);
    // Verre : boîte 2×1×1, la face contre la pierre est cachée → 5 quads, aire 2+2+2+2+1 = 9.
    expect(m.transparent.quadCount).toBe(5);
    expect(area(m.transparent)).toBeCloseTo(9);
    // Pierre : ses 6 faces (la face contre le verre reste visible).
    expect(m.opaque.quadCount).toBe(6);
    expect(m.transparent.cutoutIndexCount).toBe(0);
  });

  it('feuilles contre verre : les deux faces sont dessinées, feuilles en premier (cutout)', () => {
    const w = new World();
    w.setBlock(20, 20, 20, BlockId.Leaves);
    w.setBlock(21, 20, 20, BlockId.Glass);
    const m = meshChunk(w, 1, 1, 1, atlas);
    expect(m.transparent.quadCount).toBe(12);
    expect(m.transparent.cutoutIndexCount).toBe(36);
  });

  it('les faces en bordure de chunk tiennent compte du chunk voisin', () => {
    const w = new World();
    w.setBlock(31, 20, 20, BlockId.Stone); // chunk 1
    w.setBlock(32, 20, 20, BlockId.Stone); // chunk 2
    const m1 = meshChunk(w, 1, 1, 1, atlas);
    const m2 = meshChunk(w, 2, 1, 1, atlas);
    expect(m1.opaque.quadCount).toBe(5);
    expect(m2.opaque.quadCount).toBe(5);
    expect(facesOf(m1.opaque)).not.toContain(0);
    expect(facesOf(m2.opaque)).not.toContain(1);
  });

  it('le dessous du bedrock (y = 0) n’est pas dessiné', () => {
    const w = new World();
    w.setBlockRaw(5, 0, 5, BlockId.Bedrock);
    const m = meshChunk(w, 0, 0, 0, atlas);
    expect(facesOf(m.opaque)).toEqual([0, 1, 2, 4, 5]);
  });

  it('ombrage : dessus plus clair que les côtés, AO dans un coin', () => {
    const w = new World();
    for (let x = 18; x < 23; x++) for (let z = 18; z < 23; z++) w.setBlock(x, 20, z, BlockId.Stone);
    let m = meshChunk(w, 1, 1, 1, atlas);
    const shadeOf = (face: number) => m.opaque.shades[m.opaque.faces.indexOf(face)];
    expect(shadeOf(2)).toBeGreaterThan(shadeOf(0));
    expect(shadeOf(0)).toBeGreaterThan(shadeOf(3));
    expect(m.opaque.quadCount).toBe(6); // dalle 5×5 : AO uniforme → fusion complète

    // Un bloc posé sur la dalle assombrit les sommets voisins → le dessus se découpe.
    w.setBlock(20, 21, 20, BlockId.Stone);
    m = meshChunk(w, 1, 1, 1, atlas);
    const tops: number[] = [];
    for (let q = 0; q < m.opaque.quadCount; q++) if (m.opaque.faces[q * 4] === 2) tops.push(q);
    expect(tops.length).toBeGreaterThan(2);
    const minShade = Math.min(...Array.from(m.opaque.shades));
    expect(minShade).toBeLessThan(255 * 0.55);
  });

  it('blocs précieux pleins : passe gemme à part, minerais dans la passe opaque', () => {
    const w = new World();
    w.setBlock(18, 20, 20, BlockId.Diamond);
    w.setBlock(20, 20, 20, BlockId.Gold);
    w.setBlock(22, 20, 20, BlockId.EmeraldBlock);
    w.setBlock(24, 20, 20, BlockId.DiamondOre);
    w.setBlock(26, 20, 20, BlockId.EmeraldOre);
    const m = meshChunk(w, 1, 1, 1, atlas);
    expect(m.gem.quadCount).toBe(18);
    expect(m.opaque.quadCount).toBe(12); // les deux minerais
    expect(m.transparent.quadCount).toBe(0);
    const gemTiles = new Set(Array.from(m.gem.tiles));
    expect(gemTiles).toEqual(
      new Set(['diamond_block', 'gold_block', 'emerald_block'].map((k) => atlas.tileIndex(k))),
    );
    const opaqueTiles = new Set(Array.from(m.opaque.tiles));
    expect(opaqueTiles).toEqual(new Set(['ore_diamond', 'ore_emerald'].map((k) => atlas.tileIndex(k))));
    // L'orientation de face est fournie (attribut `face` du matériau gemme).
    expect(m.gem.faces.length).toBe(m.gem.vertexCount);
    expect(m.gem.cutoutIndexCount).toBe(0);
  });

  it('gemme contre opaque : faces de contact cachées des deux côtés, AO partagée', () => {
    const w = new World();
    w.setBlock(20, 20, 20, BlockId.Gold);
    w.setBlock(21, 20, 20, BlockId.Stone);
    w.setBlock(20, 19, 20, BlockId.Grass);
    const m = meshChunk(w, 1, 1, 1, atlas);
    // Or : ni face +X (pierre) ni face −Y (herbe).
    expect(facesOf(m.gem)).toEqual([1, 2, 4, 5]);
    // Pierre : pas de face −X (or). Herbe : pas de face +Y (or).
    let stoneFaces = 0;
    let grassTop = 0;
    for (let q = 0; q < m.opaque.quadCount; q++) {
      const t = m.opaque.tiles[q * 4];
      const f = m.opaque.faces[q * 4];
      if (t === atlas.tileIndex('stone')) {
        stoneFaces++;
        expect(f).not.toBe(1);
      }
      if (t === atlas.tileIndex('grass_top')) grassTop++;
    }
    expect(stoneFaces).toBe(5);
    expect(grassTop).toBe(0);
    // Une gemme posée en hauteur à côté assombrit (AO) le dessus de la pierre, comme un bloc opaque.
    const w2 = new World();
    w2.setBlock(20, 20, 20, BlockId.Stone);
    const before = meshChunk(w2, 1, 1, 1, atlas);
    const topShade = (md: MeshData) => {
      const i = md.faces.indexOf(2);
      return Math.min(...Array.from(md.shades.subarray(i, i + 4)));
    };
    expect(topShade(before.opaque)).toBe(255);
    w2.setBlock(21, 21, 20, BlockId.EmeraldBlock);
    const after = meshChunk(w2, 1, 1, 1, atlas);
    expect(topShade(after.opaque)).toBeLessThan(255);
  });

  it('pas de face entre deux gemmes adjacentes (même matière ou non), fusion des mêmes gemmes', () => {
    const w = new World();
    // Mur 3×2 de diamant : fusion greedy → 6 quads, aire 2·6 + 2·2 + 2·3 = 22.
    for (let x = 18; x < 21; x++) for (let y = 20; y < 22; y++) w.setBlock(x, y, 20, BlockId.Diamond);
    let m = meshChunk(w, 1, 1, 1, atlas);
    expect(m.gem.quadCount).toBe(6);
    expect(area(m.gem)).toBeCloseTo(22);
    // Or collé à émeraude : la face commune n'est pas dessinée.
    const w2 = new World();
    w2.setBlock(20, 20, 20, BlockId.Gold);
    w2.setBlock(21, 20, 20, BlockId.EmeraldBlock);
    m = meshChunk(w2, 1, 1, 1, atlas);
    expect(area(m.gem)).toBeCloseTo(10);
    expect(m.opaque.quadCount).toBe(0);
  });

  it('gemme derrière du verre : visible à travers, le verre garde sa face', () => {
    const w = new World();
    w.setBlock(20, 20, 20, BlockId.Diamond);
    w.setBlock(21, 20, 20, BlockId.Glass);
    const m = meshChunk(w, 1, 1, 1, atlas);
    expect(m.gem.quadCount).toBe(6);
    expect(m.transparent.quadCount).toBe(5);
  });

  it('maillage du monde généré : cohérent et rapide', () => {
    const w = new World();
    generateWorld(w, 42);
    const t0 = performance.now();
    let tris = 0;
    let worst = 0;
    for (let cy = 0; cy < w.chunksY; cy++)
      for (let cz = 0; cz < w.chunksZ; cz++)
        for (let cx = 0; cx < w.chunksX; cx++) {
          const t = performance.now();
          const m = meshChunk(w, cx, cy, cz, atlas);
          worst = Math.max(worst, performance.now() - t);
          tris += (m.opaque.indices.length + m.transparent.indices.length) / 3;
          for (const md of [m.opaque, m.transparent, m.gem]) {
            expect(md.positions.length).toBe(md.vertexCount * 3);
            for (let i = 0; i < md.indices.length; i++) expect(md.indices[i]).toBeLessThan(md.vertexCount);
          }
        }
    const total = performance.now() - t0;
    console.log(`[perf] monde complet : ${total.toFixed(1)} ms (avec vérifs), pire chunk ${worst.toFixed(2)} ms, ${tris} triangles`);
    expect(tris).toBeGreaterThan(1000);
    expect(total).toBeLessThan(5000);
  });
});
