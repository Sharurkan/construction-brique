import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { BlockId } from '../core/types';
import type { TextureAtlas } from './atlas';
import { WorldRenderer } from './renderer';
import { World } from './world';
import { generateWorld, findSpawn } from './worldgen';

/** Atlas minimal (pas de canvas en environnement node). */
const fakeAtlas = (): TextureAtlas =>
  ({
    texture: new THREE.Texture(),
    tileIndex: () => 0,
    tilesPerRow: 1,
    tileSize: 16,
    padding: 0,
    width: 16,
    height: 16,
  }) as unknown as TextureAtlas;

describe('WorldRenderer.rebuildAround', () => {
  it('remaille tout de suite les chunks autour du joueur (dont celui sous ses pieds), le reste en file', () => {
    const world = new World();
    generateWorld(world, 1234);
    const scene = new THREE.Scene();
    const r = new WorldRenderer(world, scene, fakeAtlas());
    const spawn = findSpawn(world);
    const n = r.rebuildAround(spawn, 1);
    const total = world.chunksX * world.chunksY * world.chunksZ;
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(27);
    expect(r.stats.pending).toBe(total - n);
    // Le chunk sous les pieds a un mesh opaque.
    const cx = Math.floor(spawn.x / 16), cy = Math.floor((spawn.y - 1) / 16), cz = Math.floor(spawn.z / 16);
    expect(r.group.children.some((m) => m.name === `chunk ${cx},${cy},${cz}`)).toBe(true);

    // update() vide la file du plus proche au plus lointain.
    let guard = 0;
    while (r.stats.pending > 0 && guard++ < 200) r.update(4, spawn);
    expect(r.stats.pending).toBe(0);
    r.dispose();
  });
});

describe('WorldRenderer : meshes gemmes', () => {
  const gemMeshes = (r: WorldRenderer) =>
    r.group.children.filter((m): m is THREE.Mesh => m instanceof THREE.Mesh && m.name.endsWith('(gem)'));
  const countMeshes = (r: WorldRenderer) => r.group.children.filter((m) => m instanceof THREE.Mesh).length;

  it('mesh gemme créé seulement dans les chunks qui en contiennent, avec attribut face', () => {
    const world = new World(32, 16, 16); // 2 chunks
    for (let x = 0; x < 32; x++) for (let z = 0; z < 16; z++) world.setBlockRaw(x, 0, z, BlockId.Stone);
    const r = new WorldRenderer(world, new THREE.Scene(), fakeAtlas());
    r.rebuildAll();
    expect(r.stats.meshes).toBe(2);
    expect(r.stats.gemMeshes).toBe(0);
    expect(gemMeshes(r)).toHaveLength(0);

    world.setBlock(3, 1, 3, BlockId.Diamond);
    world.setBlock(4, 1, 3, BlockId.Gold);
    world.setBlock(5, 1, 3, BlockId.EmeraldBlock);
    world.setBlock(7, 1, 3, BlockId.GoldOre); // minerai : passe opaque
    r.update(8);
    const gems = gemMeshes(r);
    expect(gems).toHaveLength(1);
    expect(gems[0].name).toBe('chunk 0,0,0 (gem)');
    expect(gems[0].material).toBe(r.chunkMaterials.gem);
    expect(gems[0].geometry.getAttribute('face')).toBeDefined();
    // Les autres passes n'envoient pas l'attribut face au GPU.
    const opaque = r.group.children.find((m) => m.name === 'chunk 0,0,0') as THREE.Mesh;
    expect(opaque.geometry.getAttribute('face')).toBeUndefined();
    expect(r.stats.meshes).toBe(3);
    expect(r.stats.gemMeshes).toBe(1);
    expect(countMeshes(r)).toBe(r.stats.meshes);
    // Atlas factice (une seule tuile) : les 3 gemmes alignées fusionnent, dessous caché par
    // la pierre → 5 quads = 10 triangles.
    expect(gems[0].geometry.index!.count / 3).toBe(10);
    r.dispose();
  });

  it('casser les gemmes libère le mesh gemme (géométrie disposée), stats justes', () => {
    const world = new World(16, 16, 16);
    world.setBlockRaw(2, 0, 2, BlockId.Stone);
    world.setBlockRaw(2, 1, 2, BlockId.Diamond);
    const r = new WorldRenderer(world, new THREE.Scene(), fakeAtlas());
    r.rebuildAll();
    const gem = gemMeshes(r)[0];
    expect(gem).toBeDefined();
    const trisBefore = r.stats.triangles;
    let disposed = false;
    gem.geometry.addEventListener('dispose', () => (disposed = true));

    // Remaillage avec une gemme en plus : même mesh, géométrie remplacée (l'ancienne libérée).
    world.setBlock(3, 1, 2, BlockId.Diamond);
    r.update(4);
    expect(gemMeshes(r)[0]).toBe(gem);
    expect(disposed).toBe(true);
    expect(r.stats.triangles).toBeGreaterThan(trisBefore);

    disposed = false;
    gem.geometry.addEventListener('dispose', () => (disposed = true));
    world.setBlock(2, 1, 2, BlockId.Air);
    world.setBlock(3, 1, 2, BlockId.Air);
    r.update(4);
    expect(gemMeshes(r)).toHaveLength(0);
    expect(disposed).toBe(true);
    expect(gem.parent).toBeNull();
    expect(r.stats.gemMeshes).toBe(0);
    expect(r.stats.meshes).toBe(1);
    expect(r.stats.triangles).toBe(5 * 2); // pierre seule (dessous caché par le socle virtuel)
    expect(countMeshes(r)).toBe(r.stats.meshes);
    r.dispose();
  });

  it('nouveau monde et dispose : aucun mesh gemme orphelin', () => {
    const world = new World();
    generateWorld(world, 7);
    for (let x = 10; x < 60; x += 3) world.setBlockRaw(x, 44, 10, BlockId.Gold);
    const r = new WorldRenderer(world, new THREE.Scene(), fakeAtlas());
    r.rebuildAll();
    expect(r.stats.gemMeshes).toBeGreaterThan(1);
    expect(countMeshes(r)).toBe(r.stats.meshes);
    // Nouveau monde (sans gemme) : les meshes gemmes disparaissent une fois tout remaillé.
    generateWorld(world, 8);
    r.rebuildAround(findSpawn(world), 1);
    let guard = 0;
    while (r.stats.pending > 0 && guard++ < 200) r.update(8);
    expect(r.stats.gemMeshes).toBe(0);
    expect(gemMeshes(r)).toHaveLength(0);
    expect(countMeshes(r)).toBe(r.stats.meshes);
    r.dispose();
    expect(r.group.children).toHaveLength(0);
    expect(r.stats.meshes).toBe(0);
    expect(r.stats.gemMeshes).toBe(0);
  });

  it('setTime fait avancer l’horloge du matériau gemme (bornée)', () => {
    const r = new WorldRenderer(new World(16, 16, 16), new THREE.Scene(), fakeAtlas());
    r.setTime(12.5);
    expect(r.chunkMaterials.gem.uniforms.uTime.value).toBe(12.5);
    expect(r.chunkMaterials.water.uniforms.uTime.value).toBe(12.5);
    r.setTime(4096 + 3);
    expect(r.chunkMaterials.gem.uniforms.uTime.value).toBe(3);
    r.dispose();
  });
});

describe('WorldRenderer : meshes eau', () => {
  const waterMeshes = (r: WorldRenderer) =>
    r.group.children.filter((m): m is THREE.Mesh => m instanceof THREE.Mesh && m.name.endsWith('(water)'));

  it('mesh eau seulement dans les chunks qui en contiennent, matériau eau transparent sans écriture de profondeur', () => {
    const world = new World(32, 16, 16); // 2 chunks
    for (let x = 0; x < 32; x++) for (let z = 0; z < 16; z++) world.setBlockRaw(x, 0, z, BlockId.Stone);
    const r = new WorldRenderer(world, new THREE.Scene(), fakeAtlas());
    r.rebuildAll();
    expect(r.stats.waterMeshes).toBe(0);
    world.setBlock(20, 1, 3, BlockId.Water);
    r.update(8);
    const w = waterMeshes(r);
    expect(w).toHaveLength(1);
    expect(w[0].name).toBe('chunk 1,0,0 (water)');
    const mat = w[0].material as THREE.ShaderMaterial;
    expect(mat).toBe(r.chunkMaterials.water);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(r.stats.waterMeshes).toBe(1);
    expect(r.stats.meshes).toBe(3);
    world.setBlock(20, 1, 3, BlockId.Air);
    r.update(8);
    expect(waterMeshes(r)).toHaveLength(0);
    expect(r.stats.waterMeshes).toBe(0);
    expect(r.stats.meshes).toBe(2);
    r.dispose();
  });
});
