import { describe, expect, it } from 'vitest';
import { rleDecode, rleEncode } from './rle';

function roundTrip(data: Uint8Array): Uint8Array {
  return rleDecode(rleEncode(data), data.length);
}

describe('RLE', () => {
  it('tableau vide', () => {
    expect(rleEncode(new Uint8Array(0)).length).toBe(0);
    expect(roundTrip(new Uint8Array(0))).toEqual(new Uint8Array(0));
  });

  it('un seul octet', () => {
    const d = new Uint8Array([42]);
    expect(Array.from(rleEncode(d))).toEqual([1, 42]);
    expect(roundTrip(d)).toEqual(d);
  });

  it('valeurs aléatoires (pire cas)', () => {
    let seed = 12345;
    const d = new Uint8Array(10_000);
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      d[i] = seed >>> 24;
    }
    expect(roundTrip(d)).toEqual(d);
    expect(rleEncode(d).length).toBeLessThanOrEqual(d.length * 2);
  });

  it('longues séquences > 255 découpées', () => {
    const d = new Uint8Array(1000).fill(7);
    const enc = rleEncode(d);
    expect(Array.from(enc)).toEqual([255, 7, 255, 7, 255, 7, 235, 7]);
    expect(roundTrip(d)).toEqual(d);
  });

  it('séquence de exactement 255 et 256', () => {
    for (const n of [255, 256, 510, 511]) {
      const d = new Uint8Array(n).fill(3);
      expect(roundTrip(d)).toEqual(d);
    }
  });

  it('monde voxel typique 96×48×96 : forte compression', () => {
    const sx = 96, sy = 48, sz = 96;
    const d = new Uint8Array(sx * sy * sz);
    for (let y = 0; y < sy; y++) {
      const v = y === 0 ? 22 : y < 10 ? 3 : y < 13 ? 2 : y === 13 ? 1 : 0;
      d.fill(v, y * sx * sz, (y + 1) * sx * sz);
    }
    d[5000] = 9;
    const enc = rleEncode(d);
    expect(enc.length).toBeLessThan(d.length / 50);
    expect(roundTrip(d)).toEqual(d);
  });

  it('flux malformé → erreur', () => {
    expect(() => rleDecode(new Uint8Array([1]))).toThrow();
    expect(() => rleDecode(new Uint8Array([0, 5]))).toThrow();
    expect(() => rleDecode(new Uint8Array([3, 5]), 4)).toThrow();
  });
});
