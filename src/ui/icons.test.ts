import { afterEach, describe, expect, it } from 'vitest';
import {
  getIcon, isInlineSvg, isProvisional, onIconsChanged, PROVISIONAL_ICONS, resetIcons, setIcon, setIcons, type IconName,
} from './icons';

afterEach(() => resetIcons());

describe('icons', () => {
  it('toutes les icônes provisoires sont des SVG inline marqués provisoires', () => {
    for (const [name, src] of Object.entries(PROVISIONAL_ICONS)) {
      expect(isInlineSvg(src), name).toBe(true);
      expect(src).toContain('data-provisional="true"');
      expect(isProvisional(name as IconName)).toBe(true);
    }
  });

  it('remplacement par URL ou SVG, notification, puis retour au provisoire', () => {
    let calls = 0;
    const off = onIconsChanged(() => calls++);
    setIcon('break', '/icons/pickaxe.svg');
    setIcons({ place: '<svg viewBox="0 0 1 1"></svg>', jump: undefined });
    expect(getIcon('break')).toBe('/icons/pickaxe.svg');
    expect(isInlineSvg(getIcon('break'))).toBe(false);
    expect(isProvisional('place')).toBe(false);
    expect(isProvisional('jump')).toBe(true);
    expect(calls).toBe(2);
    off();
    resetIcons();
    expect(calls).toBe(2);
    expect(isProvisional('break')).toBe(true);
  });
});
