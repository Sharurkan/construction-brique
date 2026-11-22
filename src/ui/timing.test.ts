import { describe, expect, it } from 'vitest';
import { HoldRepeater, LongPress } from './timing';

function fakeClock() {
  let t = 1000;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

describe('LongPress', () => {
  it('se déclenche une seule fois après 2 s', () => {
    const c = fakeClock();
    const lp = new LongPress(2000, c.now);
    expect(lp.poll()).toBe(false);
    lp.start();
    c.advance(1000);
    expect(lp.progress()).toBeCloseTo(0.5);
    expect(lp.poll()).toBe(false);
    c.advance(999);
    expect(lp.poll()).toBe(false);
    c.advance(1);
    expect(lp.poll()).toBe(true);
    expect(lp.poll()).toBe(false);
    c.advance(5000);
    expect(lp.poll()).toBe(false);
    expect(lp.progress()).toBe(1);
  });

  it('relâcher avant la fin annule', () => {
    const c = fakeClock();
    const lp = new LongPress(2000, c.now);
    lp.start();
    c.advance(1900);
    lp.cancel();
    expect(lp.progress()).toBe(0);
    c.advance(500);
    expect(lp.poll()).toBe(false);
    expect(lp.active).toBe(false);
  });

  it('un nouvel appui repart de zéro', () => {
    const c = fakeClock();
    const lp = new LongPress(2000, c.now);
    lp.start();
    c.advance(1500);
    lp.cancel();
    lp.start();
    c.advance(1500);
    expect(lp.poll()).toBe(false);
    c.advance(500);
    expect(lp.poll()).toBe(true);
  });
});

describe('HoldRepeater', () => {
  it('action immédiate puis répétition toutes les 300 ms', () => {
    const c = fakeClock();
    const r = new HoldRepeater(300, 350, c.now);
    expect(r.press()).toBe(1);
    c.advance(349);
    expect(r.poll()).toBe(0);
    c.advance(1);
    expect(r.poll()).toBe(1);
    c.advance(299);
    expect(r.poll()).toBe(0);
    c.advance(1);
    expect(r.poll()).toBe(1);
    r.release();
    c.advance(1000);
    expect(r.poll()).toBe(0);
  });

  it('rattrapage borné après une frame très longue', () => {
    const c = fakeClock();
    const r = new HoldRepeater(300, 350, c.now);
    r.press();
    c.advance(10_000);
    expect(r.poll()).toBe(3);
    expect(r.poll()).toBe(0);
    c.advance(300);
    expect(r.poll()).toBe(1);
  });
});
