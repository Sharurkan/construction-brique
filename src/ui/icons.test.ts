import { afterEach, describe, expect, it } from 'vitest';
import { getIcon, isInlineSvg, onIconsChanged, PROVISIONAL_ICONS, setIcon, setIcons, type IconName } from './icons';

// Remet le jeu provisoire entre les tests (état global du module).
afterEach(() => setIcons({ ...PROVISIONAL_ICONS }));

describe('icons', () => {
  it('toutes les icônes provisoires sont des SVG inline marqués provisoires', () => {
    for (const [name, src] of Object.entries(PROVISIONAL_ICONS)) {
      expect(isInlineSvg(src), name).toBe(true);
      expect(src).toContain('data-provisional="true"');
      expect(getIcon(name as IconName)).toBe(src);
    }
  });

  it('remplacement par URL ou SVG, notification, désabonnement', () => {
    let calls = 0;
    const off = onIconsChanged(() => calls++);
    setIcon('break', '/icons/pickaxe.svg');
    setIcons({ place: '<svg viewBox="0 0 1 1"></svg>', jump: undefined });
    expect(getIcon('break')).toBe('/icons/pickaxe.svg');
    expect(isInlineSvg(getIcon('break'))).toBe(false);
    expect(getIcon('place')).toBe('<svg viewBox="0 0 1 1"></svg>');
    expect(getIcon('jump')).toBe(PROVISIONAL_ICONS.jump);
    expect(calls).toBe(2);
    off();
    setIcons({ break: PROVISIONAL_ICONS.break });
    expect(calls).toBe(2);
    expect(getIcon('break')).toBe(PROVISIONAL_ICONS.break);
  });
});
