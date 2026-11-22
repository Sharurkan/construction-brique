import { describe, expect, it } from 'vitest';
import { TouchTracker, type JoystickView } from './touch';

function fakeView() {
  const log: string[] = [];
  const view: JoystickView & { active: boolean; knob: [number, number] } = {
    active: false,
    knob: [0, 0],
    show(x, y) { this.active = true; log.push(`show ${x},${y}`); },
    setKnob(dx, dy) { this.knob = [dx, dy]; },
    hide() { this.active = false; this.knob = [0, 0]; log.push('hide'); },
  };
  return { view, log };
}

function make() {
  const { view, log } = fakeView();
  const t = new TouchTracker(view, { radius: () => 75, deadZone: 0.15, lookSensitivity: () => 0.01 });
  return { t, view, log };
}

describe('TouchTracker', () => {
  it('joystick : affiche la base, suit le doigt, se remet au repos au relâchement', () => {
    const { t, view } = make();
    expect(t.begin(1, 'joystick', 100, 300)).toBe(true);
    expect(view.active).toBe(true);
    t.moveTo(1, 100, 225); // doigt vers le haut = avant, au bord du rayon
    expect(t.move.z).toBeCloseTo(1);
    expect(view.knob[1]).toBeCloseTo(-75);
    expect(t.end(1)).toBe(true);
    expect(t.move).toEqual({ x: 0, z: 0 });
    expect(view.active).toBe(false);
    expect(view.knob).toEqual([0, 0]);
  });

  it('un seul doigt par rôle ; un doigt inconnu est ignoré', () => {
    const { t } = make();
    expect(t.begin(1, 'joystick', 10, 10)).toBe(true);
    expect(t.begin(2, 'joystick', 20, 20)).toBe(false);
    expect(t.begin(3, 'look', 600, 200)).toBe(true);
    expect(t.count).toBe(2);
    expect(t.moveTo(99, 0, 0)).toBeNull();
    expect(t.end(99)).toBe(false);
  });

  it('regard : renvoie la rotation du glissement depuis la dernière position', () => {
    const { t, view } = make();
    t.begin(5, 'look', 600, 200);
    expect(view.active).toBe(false);
    const a = t.moveTo(5, 610, 200)!;
    expect(a.yaw).toBeCloseTo(-0.1);
    const b = t.moveTo(5, 610, 220)!;
    expect(b.yaw).toBe(0);
    expect(b.pitch).toBeCloseTo(-0.2);
  });

  it('pointercancel (end) remet aussi le joystick à zéro', () => {
    const { t, view } = make();
    t.begin(1, 'joystick', 100, 300);
    t.moveTo(1, 160, 300);
    expect(t.move.x).toBeGreaterThan(0);
    t.end(1);
    expect(t.move.x).toBe(0);
    expect(view.active).toBe(false);
  });

  it('releaseAll (page masquée, rotation) : oublie les doigts et remet le visuel au repos', () => {
    const { t, view } = make();
    t.begin(1, 'joystick', 100, 300);
    t.begin(2, 'look', 600, 200);
    t.moveTo(1, 100, 250);
    t.releaseAll();
    expect(t.count).toBe(0);
    expect(t.move).toEqual({ x: 0, z: 0 });
    expect(view.active).toBe(false);
    // Les anciens doigts n'ont plus d'effet ; un nouveau doigt est accepté.
    expect(t.moveTo(1, 100, 100)).toBeNull();
    expect(t.move).toEqual({ x: 0, z: 0 });
    expect(t.begin(3, 'joystick', 100, 300)).toBe(true);
  });

  it('releaseAll remet le visuel au repos même sans doigt suivi', () => {
    const { t, view, log } = make();
    view.active = true; // visuel resté actif par erreur
    t.releaseAll();
    expect(view.active).toBe(false);
    expect(log).toContain('hide');
  });
});
