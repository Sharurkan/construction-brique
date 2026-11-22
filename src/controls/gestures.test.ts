import { describe, expect, it } from 'vitest';
import {
  clampPitch, computeJoystick, dragToLook, isTap, keysToMove, keyToMoveDir, keyToSlot, MAX_PITCH, mergeMove,
} from './gestures';

describe('computeJoystick', () => {
  it('renvoie 0 au centre et dans la zone morte', () => {
    expect(computeJoystick(0, 0, 70).magnitude).toBe(0);
    const r = computeJoystick(5, 5, 70, 0.15);
    expect(r.x).toBe(0);
    expect(r.z).toBe(0);
  });

  it('doigt vers le haut = avant (z positif), droite = x positif', () => {
    const up = computeJoystick(0, -70, 70);
    expect(up.z).toBeCloseTo(1);
    expect(up.x).toBe(0);
    const right = computeJoystick(70, 0, 70);
    expect(right.x).toBeCloseTo(1);
    expect(right.z).toBe(0);
  });

  it('bride la sortie et le knob au rayon', () => {
    const r = computeJoystick(300, -400, 70);
    expect(r.magnitude).toBe(1);
    expect(Math.hypot(r.x, r.z)).toBeCloseTo(1);
    expect(Math.hypot(r.knobX, r.knobY)).toBeCloseTo(70);
    expect(r.x).toBeCloseTo(0.6);
    expect(r.z).toBeCloseTo(0.8);
  });

  it('remet à l\'échelle après la zone morte (continu, monotone)', () => {
    const justAfter = computeJoystick(0, -70 * 0.16, 70, 0.15);
    expect(justAfter.z).toBeGreaterThan(0);
    expect(justAfter.z).toBeLessThan(0.05);
    const half = computeJoystick(0, -70 * 0.575, 70, 0.15);
    expect(half.z).toBeCloseTo(0.5);
  });

  it('reste dans [-1, 1] pour des entrées arbitraires', () => {
    for (let i = 0; i < 200; i++) {
      const r = computeJoystick((Math.random() - 0.5) * 1000, (Math.random() - 0.5) * 1000, 75);
      expect(Math.abs(r.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.z)).toBeLessThanOrEqual(1);
    }
  });
});

describe('tap', () => {
  it('court et immobile = tap', () => {
    expect(isTap(120, 3)).toBe(true);
    expect(isTap(260, 3)).toBe(false);
    expect(isTap(120, 12)).toBe(false);
  });
});

describe('regard', () => {
  it('glisser à droite tourne à droite (yaw négatif), vers le bas regarde en bas', () => {
    const l = dragToLook(10, 20, 0.01);
    expect(l.yaw).toBeCloseTo(-0.1);
    expect(l.pitch).toBeCloseTo(-0.2);
  });
  it('pitch bridé à ±89°', () => {
    expect(clampPitch(3)).toBeCloseTo(MAX_PITCH);
    expect(clampPitch(-3)).toBeCloseTo(-MAX_PITCH);
    expect(MAX_PITCH).toBeCloseTo((89 * Math.PI) / 180);
  });
});

describe('clavier', () => {
  it('ZQSD (AZERTY), WASD et flèches', () => {
    expect(keyToMoveDir('KeyW', 'z')).toBe('forward'); // Z AZERTY
    expect(keyToMoveDir('KeyA', 'q')).toBe('left'); // Q AZERTY
    expect(keyToMoveDir('KeyW', 'w')).toBe('forward');
    expect(keyToMoveDir('KeyD', 'd')).toBe('right');
    expect(keyToMoveDir('ArrowDown', 'ArrowDown')).toBe('back');
    expect(keyToMoveDir('Unknown', 'Z')).toBe('forward');
    expect(keyToMoveDir('KeyX', 'x')).toBeNull();
  });
  it('touches 1-9', () => {
    expect(keyToSlot('Digit1')).toBe(0);
    expect(keyToSlot('Numpad9')).toBe(8);
    expect(keyToSlot('Digit0')).toBeNull();
  });
  it('diagonale normalisée et fusion bridée', () => {
    const d = keysToMove(['forward', 'right']);
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(1);
    expect(keysToMove(['forward', 'back'])).toEqual({ x: 0, z: 0 });
    const m = mergeMove({ x: 1, z: 0 }, { x: 0, z: 1 });
    expect(Math.hypot(m.x, m.z)).toBeCloseTo(1);
  });
});
