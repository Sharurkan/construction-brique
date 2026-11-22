import { describe, expect, it } from 'vitest';
import type { CollisionWorld } from '../core/types';
import { MAX_PITCH } from '../controls/gestures';
import { BlockId } from '../core/types';
import { World } from '../engine/world';
import {
  blockIntersectsPlayer,
  EYE_HEIGHT,
  JUMP_HEIGHT,
  MAX_SINK_SPEED,
  Player,
  SWIM_SPEED_FACTOR,
  WALK_SPEED,
  type PlayerInput,
} from './player';

class SetWorld implements CollisionWorld {
  readonly blocks = new Set<string>();
  add(x: number, y: number, z: number): this { this.blocks.add(`${x},${y},${z}`); return this; }
  remove(x: number, y: number, z: number): void { this.blocks.delete(`${x},${y},${z}`); }
  isSolid(x: number, y: number, z: number): boolean { return this.blocks.has(`${x},${y},${z}`); }
}

/** Sol plat en y = 0 (le joueur marche à y = 1) sur [-n, n)². */
function flat(n = 16): SetWorld {
  const w = new SetWorld();
  for (let x = -n; x < n; x++) for (let z = -n; z < n; z++) w.add(x, 0, z);
  return w;
}

function input(over: Partial<PlayerInput> = {}): PlayerInput {
  return { move: { x: 0, z: 0 }, look: { yaw: 0, pitch: 0 }, jump: false, ...over };
}

function run(p: Player, w: CollisionWorld, seconds: number, inp: PlayerInput, dt = 1 / 60): void {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) p.update(dt, inp, w);
}

describe('Player – gravité et sol', () => {
  it('tombe et se pose sur le sol sans le traverser', () => {
    const w = flat();
    const p = new Player({ x: 0.5, y: 5, z: 0.5 });
    run(p, w, 2, input());
    expect(p.state.position.y).toBeCloseTo(1, 2);
    expect(p.state.position.y).toBeGreaterThanOrEqual(1);
    expect(p.onGround).toBe(true);
  });

  it('ne traverse pas le sol même avec un énorme dt (bridé + sous-pas)', () => {
    const w = flat();
    const p = new Player({ x: 0.5, y: 3, z: 0.5 });
    p.velocity.y = -29;
    for (let i = 0; i < 20; i++) p.update(1, input(), w);
    expect(p.state.position.y).toBeCloseTo(1, 2);
  });

  it('saute à environ 1.25 bloc', () => {
    const w = flat();
    const p = new Player({ x: 0.5, y: 1, z: 0.5 });
    run(p, w, 0.2, input());
    let maxY = 0;
    const jump = input({ jump: true });
    for (let i = 0; i < 60; i++) {
      p.update(1 / 60, i < 2 ? jump : input(), w);
      maxY = Math.max(maxY, p.state.position.y);
    }
    expect(maxY - 1).toBeGreaterThan(JUMP_HEIGHT - 0.1);
    expect(maxY - 1).toBeLessThan(JUMP_HEIGHT + 0.1);
  });
});

describe('Player – déplacement', () => {
  it('avance vers -Z à ~4.3 blocs/s avec yaw = 0', () => {
    const w = flat(32);
    const p = new Player({ x: 0.5, y: 1, z: 0.5 });
    run(p, w, 1, input({ move: { x: 0, z: 1 } }));
    expect(p.state.position.z).toBeCloseTo(0.5 - WALK_SPEED, 1);
    expect(p.state.position.x).toBeCloseTo(0.5, 5);
  });

  it('droite = +X avec yaw = 0 ; yaw = +90° fait avancer vers -X', () => {
    const w = flat(32);
    const p = new Player({ x: 0.5, y: 1, z: 0.5 });
    run(p, w, 0.5, input({ move: { x: 1, z: 0 } }));
    expect(p.state.position.x).toBeGreaterThan(2);
    const q = new Player({ x: 0.5, y: 1, z: 0.5 }, Math.PI / 2);
    run(q, w, 0.5, input({ move: { x: 0, z: 1 } }));
    expect(q.state.position.x).toBeLessThan(-1);
    expect(q.state.position.z).toBeCloseTo(0.5, 3);
  });

  it('est arrêté par un mur de 2 blocs (collision par axe, glisse le long)', () => {
    const w = flat();
    for (let x = -16; x < 16; x++) { w.add(x, 1, -3); w.add(x, 2, -3); }
    const p = new Player({ x: 0.5, y: 1, z: 0.5 });
    // diagonale avant-droite : bloqué en Z, continue en X
    run(p, w, 2, input({ move: { x: 0.7, z: 0.7 } }));
    expect(p.state.position.z).toBeGreaterThanOrEqual(-2 + 0.3 - 1e-6);
    expect(p.state.position.z).toBeCloseTo(-2 + 0.3, 2);
    expect(p.state.position.x).toBeGreaterThan(3);
    expect(p.state.position.y).toBeCloseTo(1, 2);
  });

  it('ne passe pas sous un plafond à 1.5 bloc (hauteur 1.7)', () => {
    const w = flat();
    for (let x = -16; x < 16; x++) w.add(x, 2, -3); // tunnel de 1 bloc de haut
    const p = new Player({ x: 0.5, y: 1, z: 0.5 });
    p.autoJump = false;
    run(p, w, 2, input({ move: { x: 0, z: 1 } }));
    expect(p.state.position.z).toBeCloseTo(-2 + 0.3, 2);
  });

  it('se cogne la tête au plafond pendant un saut', () => {
    const w = flat();
    w.add(0, 3, 0);
    const p = new Player({ x: 0.5, y: 1, z: 0.5 });
    run(p, w, 0.1, input());
    let maxY = 0;
    for (let i = 0; i < 60; i++) { p.update(1 / 60, input({ jump: i < 2 }), w); maxY = Math.max(maxY, p.state.position.y); }
    expect(maxY + 1.7).toBeLessThanOrEqual(3 + 1e-6);
    expect(p.state.position.y).toBeCloseTo(1, 2);
  });

  it('les limites horizontales agissent comme des murs', () => {
    const w = flat(32);
    const p = new Player({ x: 0.5, y: 1, z: 0.5 });
    p.setBounds({ minX: 0, maxX: 4, minZ: 0, maxZ: 4 });
    run(p, w, 2, input({ move: { x: 1, z: 0 } }));
    expect(p.state.position.x).toBeCloseTo(4 - 0.3, 2);
  });
});

describe('Player – auto-saut', () => {
  it('monte une marche d\'un bloc en avançant', () => {
    const w = flat();
    for (let x = -16; x < 16; x++) for (let z = -16; z <= -3; z++) w.add(x, 1, z);
    const p = new Player({ x: 0.5, y: 1, z: 0.5 });
    run(p, w, 2, input({ move: { x: 0, z: 1 } }));
    expect(p.state.position.y).toBeCloseTo(2, 2);
    expect(p.state.position.z).toBeLessThan(-3);
  });

  it('ne monte pas un mur de 2 blocs', () => {
    const w = flat();
    for (let x = -16; x < 16; x++) { w.add(x, 1, -3); w.add(x, 2, -3); }
    const p = new Player({ x: 0.5, y: 1, z: 0.5 });
    run(p, w, 2, input({ move: { x: 0, z: 1 } }));
    expect(p.state.position.z).toBeGreaterThan(-2);
    expect(p.state.position.y).toBeCloseTo(1, 2);
  });

  it('ne saute pas si pas de place pour la tête au-dessus de la marche', () => {
    const w = flat();
    w.add(0, 1, -3); // marche
    w.add(0, 3, -3); // plafond au-dessus de la marche : seulement 1 bloc libre
    const p = new Player({ x: 0.5, y: 1, z: 0.5 });
    run(p, w, 1.5, input({ move: { x: 0, z: 1 } }));
    expect(p.state.position.y).toBeCloseTo(1, 2);
  });

  it('désactivable', () => {
    const w = flat();
    for (let x = -16; x < 16; x++) w.add(x, 1, -3);
    const p = new Player({ x: 0.5, y: 1, z: 0.5 });
    p.autoJump = false;
    run(p, w, 2, input({ move: { x: 0, z: 1 } }));
    expect(p.state.position.y).toBeCloseTo(1, 2);
  });
});

describe('Player – anti-blocage et réapparition', () => {
  it('un bloc posé sur le joueur le pousse vers le haut jusqu\'à un espace libre', () => {
    const w = flat();
    const p = new Player({ x: 0.5, y: 1, z: 0.5 });
    w.add(0, 1, 0);
    w.add(0, 2, 0);
    run(p, w, 0.05, input());
    expect(p.isStuck(w)).toBe(false);
    expect(p.state.position.y).toBeCloseTo(3, 2);
    run(p, w, 1, input());
    expect(p.state.position.y).toBeCloseTo(3, 2); // debout sur la colonne
  });

  it('chevauchement partiel (bloc voisin) : toujours libéré', () => {
    const w = flat();
    const p = new Player({ x: 0.9, y: 1, z: 0.5 });
    w.add(1, 1, 0); // le joueur (x 0.6..1.2) chevauche ce bloc
    run(p, w, 0.05, input());
    expect(p.isStuck(w)).toBe(false);
  });

  it('chute sous y < -5 : retour au point d\'apparition', () => {
    const w = new SetWorld();
    w.add(10, 4, 10);
    const p = new Player({ x: 0.5, y: 1, z: 0.5 });
    p.setSpawn({ x: 10.5, y: 5, z: 10.5 });
    run(p, w, 3, input());
    expect(p.state.position.x).toBeCloseTo(10.5);
    expect(p.state.position.z).toBeCloseTo(10.5);
    expect(p.state.position.y).toBeCloseTo(5, 2);
  });
});

describe('Player – vol', () => {
  it('monte avec saut, descend avec descend, pas de gravité', () => {
    const w = flat();
    const p = new Player({ x: 0.5, y: 1, z: 0.5 });
    expect(p.toggleFly()).toBe(true);
    run(p, w, 1, input({ jump: true }));
    const y1 = p.state.position.y;
    expect(y1).toBeGreaterThan(5);
    run(p, w, 1, input());
    expect(p.state.position.y).toBeCloseTo(y1, 5);
    run(p, w, 3, input({ descend: true }));
    expect(p.state.position.y).toBeCloseTo(1, 2);
    p.toggleFly();
    expect(p.flying).toBe(false);
  });
});

describe('Player – regard et utilitaires', () => {
  it('pitch bridé à ±89°', () => {
    const p = new Player();
    p.update(0.016, input({ look: { yaw: 0, pitch: 10 } }), new SetWorld());
    expect(p.state.pitch).toBeCloseTo(MAX_PITCH);
  });

  it('getLookRay : yaw 0 regarde vers -Z, depuis les yeux', () => {
    const p = new Player({ x: 1, y: 2, z: 3 });
    const r = p.getLookRay();
    expect(r.origin).toEqual({ x: 1, y: 3.6, z: 3 });
    expect(r.dir.z).toBeCloseTo(-1);
    p.state.pitch = Math.PI / 4;
    const r2 = p.getLookRay();
    expect(Math.hypot(r2.dir.x, r2.dir.y, r2.dir.z)).toBeCloseTo(1);
    expect(r2.dir.y).toBeGreaterThan(0);
  });

  it('getLookRayInto : mêmes valeurs que getLookRay, dans l’objet fourni', () => {
    const p = new Player({ x: 1, y: 2, z: 3 }, 0.7, -0.2);
    const out = { origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: 0 } };
    const origin = out.origin;
    expect(p.getLookRayInto(out)).toBe(out);
    expect(out.origin).toBe(origin);
    expect(out).toEqual(p.getLookRay());
  });

  it('wouldIntersectPlayer', () => {
    const p = new Player({ x: 0.5, y: 1, z: 0.5 });
    expect(p.wouldIntersectPlayer(0, 1, 0)).toBe(true);
    expect(p.wouldIntersectPlayer(0, 2, 0)).toBe(true); // tête (1.0..2.7)
    expect(p.wouldIntersectPlayer(0, 3, 0)).toBe(false);
    expect(p.wouldIntersectPlayer(0, 0, 0)).toBe(false); // sol sous les pieds
    expect(p.wouldIntersectPlayer(1, 1, 0)).toBe(false);
    expect(blockIntersectsPlayer({ x: 0.9, y: 1, z: 0.5 }, 1, 1, 0)).toBe(true);
  });
});

describe('Player – plafond de vol', () => {
  it('ne monte pas au-dessus de maxY (monde 48 → 56), puis redescend normalement', () => {
    const w = flat();
    const p = new Player({ x: 0.5, y: 1, z: 0.5 });
    p.setVerticalBounds({ maxY: 48 + 8 });
    p.toggleFly();
    run(p, w, 20, input({ jump: true })); // 6 blocs/s × 20 s = 120 blocs demandés
    expect(p.state.position.y).toBe(56);
    expect(p.velocity.y).toBeLessThanOrEqual(0);
    run(p, w, 1, input({ descend: true }));
    expect(p.state.position.y).toBeLessThan(56);
  });

  it('une position restaurée au-dessus du plafond est ramenée dessous', () => {
    const w = flat();
    const p = new Player({ x: 0.5, y: 65, z: 0.5 });
    p.setVerticalBounds({ maxY: 56 });
    p.toggleFly();
    run(p, w, 0.1, input());
    expect(p.state.position.y).toBe(56);
  });

  it('sans bornes verticales : pas de limite', () => {
    const w = flat();
    const p = new Player({ x: 0.5, y: 1, z: 0.5 });
    p.toggleFly();
    run(p, w, 20, input({ jump: true }));
    expect(p.state.position.y).toBeGreaterThan(100);
    p.setVerticalBounds({ maxY: 10 });
    p.setVerticalBounds(null);
    run(p, w, 1, input({ jump: true }));
    expect(p.state.position.y).toBeGreaterThan(100);
  });
});

describe('Player – nage', () => {
  /**
   * Sol de pierre jusqu'à y = 5 (on marche à y = 6) et une piscine de 3 de profondeur
   * (x, z dans [8, 20), fond à y = 3). `brim` : eau jusqu'au ras du sol (surface y = 6) ;
   * sinon la surface est à y = 5 et la berge dépasse d'un bloc.
   */
  function pool(brim: boolean): World {
    const w = new World(32, 16, 32);
    for (let x = 0; x < 32; x++) {
      for (let z = 0; z < 32; z++) {
        const inPool = x >= 8 && x < 20 && z >= 8 && z < 20;
        for (let y = 0; y <= 5; y++) {
          if (!inPool || y < 3) w.setBlockRaw(x, y, z, BlockId.Stone);
          else if (brim || y < 5) w.setBlockRaw(x, y, z, BlockId.Water);
        }
      }
    }
    return w;
  }

  it("dans l'eau : on coule doucement jusqu'au fond, sans traverser", () => {
    const w = pool(true);
    const p = new Player({ x: 14, y: 5.5, z: 14 });
    run(p, w, 0.5, input());
    expect(p.inWater).toBe(true);
    expect(p.velocity.y).toBeGreaterThanOrEqual(-MAX_SINK_SPEED - 0.01);
    expect(p.state.position.y).toBeGreaterThan(4.5); // lent : bien moins qu'une chute normale
    run(p, w, 4, input());
    expect(p.state.position.y).toBeCloseTo(3, 2);
    expect(p.onGround).toBe(true);
  });

  it("une chute dans l'eau est vite amortie", () => {
    const w = pool(true);
    const p = new Player({ x: 14, y: 14, z: 14 });
    let t = 0;
    while (!p.inWater && t < 3) {
      p.update(1 / 60, input(), w); // ≈ 8 blocs de chute libre
      t += 1 / 60;
    }
    expect(p.inWater).toBe(true);
    expect(p.velocity.y).toBeLessThan(-10); // arrive vite…
    run(p, w, 0.3, input());
    expect(p.velocity.y).toBeGreaterThan(-MAX_SINK_SPEED - 1); // …et freine en 0,3 s
    expect(p.state.position.y).toBeGreaterThanOrEqual(3); // sans traverser le fond
  });

  it('SAUTER maintenu = nager vers le haut : on ne coule jamais indéfiniment', () => {
    const w = pool(true);
    const p = new Player({ x: 14, y: 3, z: 14 });
    run(p, w, 3, input({ jump: true }));
    expect(p.state.position.y + EYE_HEIGHT).toBeGreaterThan(6); // tête hors de l'eau
    expect(p.headInWater).toBe(false);
    let minY = Infinity;
    for (let i = 0; i < 600; i++) {
      p.update(1 / 60, input({ jump: true }), w);
      minY = Math.min(minY, p.state.position.y);
    }
    expect(minY).toBeGreaterThan(4.5); // reste à la surface tant qu'on nage
    expect(p.state.position.y).toBeLessThan(8); // pas de « fusée » non plus
  });

  it('tête sous l\'eau au fond (voile bleu)', () => {
    const w = pool(true);
    const p = new Player({ x: 14, y: 3, z: 14 });
    run(p, w, 0.1, input());
    expect(p.headInWater).toBe(true);
  });

  it("déplacement ralenti (~60 %) dans l'eau", () => {
    const w = pool(true);
    const p = new Player({ x: 14, y: 3, z: 19 });
    run(p, w, 0.2, input());
    const z0 = p.state.position.z;
    run(p, w, 1, input({ move: { x: 0, z: 1 } }));
    const d = z0 - p.state.position.z;
    expect(d).toBeCloseTo(WALK_SPEED * SWIM_SPEED_FACTOR, 0);
    expect(d).toBeLessThan(WALK_SPEED * 0.7);
  });

  for (const brim of [true, false]) {
    it(`sort d'une piscine de 3 de profondeur en avançant contre le bord (${brim ? 'eau au ras du sol' : "berge d'un bloc"})`, () => {
      const w = pool(brim);
      const p = new Player({ x: 14, y: 3, z: 14 }); // au fond, au milieu
      // Avance vers -Z (yaw 0), sans toucher SAUTER.
      run(p, w, 6, input({ move: { x: 0, z: 1 } }));
      expect(p.state.position.z).toBeLessThan(8); // hors de la piscine
      expect(p.state.position.y).toBeCloseTo(6, 2); // debout sur le sol
      expect(p.inWater).toBe(false);
      expect(p.onGround).toBe(true);
    });
  }

  it("en vol, l'eau est ignorée (pas de chute, pas de nage)", () => {
    const w = pool(true);
    const p = new Player({ x: 14, y: 4, z: 14 });
    p.toggleFly();
    run(p, w, 0.5, input());
    expect(p.state.position.y).toBeCloseTo(4, 5);
  });

  it("monde sans eau (isWater absent) : jamais dans l'eau", () => {
    const p = new Player({ x: 0.5, y: 1, z: 0.5 });
    run(p, flat(), 0.5, input());
    expect(p.inWater).toBe(false);
    expect(p.headInWater).toBe(false);
  });
});
