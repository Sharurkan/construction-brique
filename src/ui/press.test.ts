import { describe, expect, it } from 'vitest';
import { PressState } from './press';
import { HoldRepeater } from './timing';

describe('PressState', () => {
  it('un seul pointeur ; seul le pointeur appuyé relâche', () => {
    const log: string[] = [];
    const p = new PressState(() => log.push('down'), () => log.push('up'));
    expect(p.down(1)).toBe(true);
    expect(p.down(2)).toBe(false);
    expect(p.up(2)).toBe(false);
    expect(p.pressed).toBe(true);
    expect(p.up(1)).toBe(true);
    expect(p.pressed).toBe(false);
    expect(log).toEqual(['down', 'up']);
  });

  it('désactivé : l’appui est ignoré', () => {
    const p = new PressState(() => {}, () => {}, () => true);
    expect(p.down(1)).toBe(false);
    expect(p.pressed).toBe(false);
  });

  it('forceRelease débloque un bouton dont le relâchement n’arrivera jamais', () => {
    let ups = 0;
    const p = new PressState(() => {}, () => ups++);
    expect(p.forceRelease()).toBe(false); // rien à relâcher : up() non appelé
    expect(ups).toBe(0);
    p.down(7);
    expect(p.forceRelease()).toBe(true);
    expect(ups).toBe(1);
    // L'ancien pointeur ne fait plus rien ; un nouvel appui est accepté.
    expect(p.up(7)).toBe(false);
    expect(p.down(8)).toBe(true);
  });
});

describe('CASSER maintenu puis page masquée (horloge injectée)', () => {
  it('la répétition s’arrête au relâchement forcé et repart au nouvel appui', () => {
    let now = 0;
    const r = new HoldRepeater(300, 350, () => now);
    let broken = 0;
    const p = new PressState(() => { broken += r.press(); }, () => r.release());

    p.down(1);
    expect(broken).toBe(1);
    now = 700;
    broken += r.poll();
    expect(broken).toBe(3); // 350 ms puis 650 ms

    // La page passe en arrière-plan : le pointerup n'arrivera jamais.
    p.forceRelease();
    now = 60_000;
    expect(r.held).toBe(false);
    expect(r.poll()).toBe(0);

    // Retour : le bouton répond à un nouvel appui.
    expect(p.down(2)).toBe(true);
    expect(broken).toBe(4);
    p.up(2);
    expect(r.held).toBe(false);
  });
});
