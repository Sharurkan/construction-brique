import { describe, expect, it } from 'vitest';
import { PixelRatioAdjuster } from './pixelRatio';

/** Envoie des images de `ms` pendant `totalMs` ; renvoie les changements. */
function run(a: PixelRatioAdjuster, ms: number, totalMs: number): number[] {
  const changes: number[] = [];
  for (let t = 0; t < totalMs; t += ms) {
    const v = a.sample(ms);
    if (v !== null) changes.push(v);
  }
  return changes;
}

describe('PixelRatioAdjuster', () => {
  it('60 fps : ne change rien au plafond', () => {
    const a = new PixelRatioAdjuster({ initial: 1.25 });
    expect(run(a, 16.7, 20000)).toEqual([]);
    expect(a.value).toBe(1.25);
  });

  it('trop lent (> 33 ms) : baisse d’un palier toutes les ~2 s jusqu’au plancher 0.75', () => {
    const a = new PixelRatioAdjuster({ initial: 1.25 });
    expect(run(a, 40, 1900)).toEqual([]); // fenêtre de 2 s pas encore pleine
    expect(run(a, 40, 200)).toEqual([1]);
    expect(run(a, 40, 2000)).toEqual([0.75]);
    expect(run(a, 40, 10000)).toEqual([]); // plancher
    expect(a.value).toBe(0.75);
  });

  it('entre 20 et 33 ms : stable', () => {
    const a = new PixelRatioAdjuster({ initial: 1 , max: 1.25 });
    expect(run(a, 25, 30000)).toEqual([]);
  });

  it('remonte prudemment (< 20 ms sur 5 s), sans dépasser le plafond', () => {
    const a = new PixelRatioAdjuster({ initial: 0.75, max: 1.25 });
    expect(run(a, 16, 4900)).toEqual([]);
    expect(run(a, 16, 200)).toEqual([1]);
    expect(run(a, 16, 5100)).toEqual([1.25]);
    expect(run(a, 16, 20000)).toEqual([]);
  });

  it('remontée suivie d’une baisse : la remontée suivante attend deux fois plus', () => {
    const a = new PixelRatioAdjuster({ initial: 1, max: 1.25 });
    expect(run(a, 16, 5100)).toEqual([1.25]);
    expect(run(a, 40, 2100)).toEqual([1]); // trop lent à 1.25 → recul
    expect(run(a, 16, 9000)).toEqual([]); // 5 s ne suffisent plus
    expect(run(a, 16, 1200)).toEqual([1.25]); // ~10 s
  });

  it('ignore les images anormales (onglet caché, à-coup) et les valeurs invalides', () => {
    const a = new PixelRatioAdjuster({ initial: 1.25 });
    for (let i = 0; i < 50; i++) expect(a.sample(1000)).toBeNull();
    expect(a.sample(NaN)).toBeNull();
    expect(a.sample(0)).toBeNull();
    expect(a.value).toBe(1.25);
  });

  it('valeur initiale bornée', () => {
    expect(new PixelRatioAdjuster({ initial: 0.3 }).value).toBe(0.75);
    expect(new PixelRatioAdjuster({ initial: 2, max: 1.25 }).value).toBe(1.25);
  });
});
