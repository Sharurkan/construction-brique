import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
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
