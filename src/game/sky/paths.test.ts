import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  BALLOONS,
  BALLOON_BOB,
  BIRD_GROUPS,
  BIRD_SPACING,
  CLOUDS,
  DRAGON,
  RAINBOW_AZIMUTH,
  R_SUN,
  SUN_AZIMUTH,
  balloonState,
  birdFlap,
  birdState,
  cloudState,
  dragonFlap,
  dragonState,
  formationOffset,
  sunPosition,
} from './paths';
import { BlockBatch, addBlockBird, addBlockDragon, addBlockRainbow, addBlockSunDisc, shadedBox } from './blocks';

const p = new THREE.Vector3();
const q = new THREE.Vector3();
const d = new THREE.Vector3();
const d2 = new THREE.Vector3();

describe('trajectoires du ciel', () => {
  it('les nuages restent sur leur cercle, à leur hauteur', () => {
    CLOUDS.forEach((c, i) => {
      for (const t of [0, 10, 1000, 1e5]) {
        cloudState(i, t, p);
        expect(Math.hypot(p.x, p.z)).toBeCloseTo(c.r, 6);
        expect(p.y).toBe(c.y);
      }
    });
  });

  it('les montgolfières montent et descendent dans ±BALLOON_BOB', () => {
    BALLOONS.forEach((b, i) => {
      for (let t = 0; t < 60; t += 0.7) {
        balloonState(i, t, p);
        expect(Math.abs(p.y - b.y)).toBeLessThanOrEqual(BALLOON_BOB + 1e-9);
        expect(Math.hypot(p.x, p.z)).toBeCloseTo(b.r, 6);
      }
    });
  });

  it('chaque vol d’oiseaux boucle : même position après un tour complet', () => {
    BIRD_GROUPS.forEach((g) => {
      const period = (2 * Math.PI) / Math.abs(g.w);
      // Hauteur : ondulation sin(0.6 t) — on compare donc le plan horizontal et la direction.
      for (let i = 0; i < g.count; i++) {
        birdState(g, i, 3, BIRD_SPACING, p, d);
        birdState(g, i, 3 + period, BIRD_SPACING, q, d2);
        expect(q.x).toBeCloseTo(p.x, 4);
        expect(q.z).toBeCloseTo(p.z, 4);
        expect(d2.x).toBeCloseTo(d.x, 6);
        expect(d2.z).toBeCloseTo(d.z, 6);
      }
    });
  });

  it('les oiseaux volent dans le sens tangent au cercle et le lacet suit la direction', () => {
    for (const g of BIRD_GROUPS) {
      const yaw = birdState(g, 0, 5, BIRD_SPACING, p, d);
      birdState(g, 0, 5.01, BIRD_SPACING, q, d2);
      const vx = q.x - p.x;
      const vz = q.z - p.z;
      expect(vx * d.x + vz * d.z).toBeGreaterThan(0); // avance bien vers dir
      expect(Math.cos(yaw)).toBeCloseTo(d.x, 6);
      expect(-Math.sin(yaw)).toBeCloseTo(d.z, 6);
    }
  });

  it('la formation en V place chaque oiseau à un endroit différent, derrière le chef', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      formationOffset(p, i, BIRD_SPACING);
      if (i > 0) expect(p.x).toBeLessThan(0);
      seen.add(`${p.x},${p.z}`);
    }
    expect(seen.size).toBe(6);
  });

  it('le dragon fait des cercles lents et revient au même endroit après un tour', () => {
    const period = (2 * Math.PI) / DRAGON.w;
    expect(period).toBeGreaterThan(90); // lent : plus d'une minute et demie par tour
    dragonState(0, p, d);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(DRAGON.r, 6);
    // Plan horizontal : identique après un tour (la hauteur ondule indépendamment).
    dragonState(period, q, d2);
    expect(q.x).toBeCloseTo(p.x, 4);
    expect(q.z).toBeCloseTo(p.z, 4);
    expect(Math.abs(p.y - DRAGON.y)).toBeLessThan(5);
  });

  it('battements d’ailes bornés', () => {
    for (let t = 0; t < 20; t += 0.13) {
      expect(Math.abs(birdFlap(t, 1))).toBeLessThanOrEqual(0.81);
      expect(Math.abs(dragonFlap(t))).toBeLessThanOrEqual(0.81);
    }
  });

  it('soleil haut dans le ciel, arc-en-ciel à l’opposé', () => {
    sunPosition(p);
    expect(p.length()).toBeCloseTo(R_SUN, 6);
    expect(p.y).toBeGreaterThan(150);
    expect(Math.abs(RAINBOW_AZIMUTH - SUN_AZIMUTH)).toBeCloseTo(Math.PI, 9);
  });

  it('les fonctions d’animation n’allouent pas : elles écrivent dans le vecteur fourni', () => {
    const out = new THREE.Vector3();
    expect(cloudState(0, 1, out)).toBeTypeOf('number');
    expect(sunPosition(out)).toBe(out);
  });
});

describe('BlockBatch (cubes instanciés du ciel)', () => {
  function makeBatch(): BlockBatch {
    const b = new BlockBatch();
    addBlockBird(b, b.addElement(), 0x2f7de1, 1.5);
    addBlockDragon(b, b.addElement(), 2);
    addBlockRainbow(b, b.addElement());
    addBlockSunDisc(b, b.addElement());
    b.build(shadedBox(), new THREE.MeshBasicMaterial());
    return b;
  }

  it('un seul InstancedMesh, attribut de tuile par instance', () => {
    const b = makeBatch();
    expect(b.mesh).toBeInstanceOf(THREE.InstancedMesh);
    expect(b.mesh!.count).toBe(b.count);
    expect(b.mesh!.geometry.getAttribute('aTile').count).toBe(b.count);
    expect(b.triangles).toBe(b.count * 12);
  });

  it('update() réutilise les mêmes tampons et donne des matrices finies', () => {
    const b = makeBatch();
    const arr = b.mesh!.instanceMatrix.array;
    b.elements[0].makeTranslation(10, 20, 30);
    b.flap[0] = 0.5;
    b.flap[1] = -0.3;
    b.update();
    expect(b.mesh!.instanceMatrix.array).toBe(arr); // pas de nouveau tableau
    for (const v of arr) expect(Number.isFinite(v)).toBe(true);
    // Le corps de l'oiseau (1re pièce) suit l'élément.
    const m = new THREE.Matrix4();
    b.mesh!.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixPosition(m).toArray()).toEqual([10, 20, 30]);
  });

  it('les ailes battent : la matrice d’une aile change avec flap', () => {
    const b = makeBatch();
    const wingIndex = 4; // corps, tête, bec, queue, puis 1re aile
    const m1 = new THREE.Matrix4();
    const m2 = new THREE.Matrix4();
    b.flap[0] = 0;
    b.update();
    b.mesh!.getMatrixAt(wingIndex, m1);
    b.flap[0] = 0.6;
    b.update();
    b.mesh!.getMatrixAt(wingIndex, m2);
    expect(m1.equals(m2)).toBe(false);
  });
});
