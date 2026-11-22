import { FONTS, ICONS } from '../assets/manifest';
import { setIcons } from '../ui/icons';

/**
 * Branche les assets d'interface (Kenney Mobile Controls / Game Icons / Voxel Pack, police
 * Andika). Les URL dépendent du base Vite : elles sont injectées depuis le manifeste plutôt
 * qu'écrites en dur dans le CSS.
 */
export function applyUiAssets(): void {
  setIcons({
    break: ICONS.btn_break,
    place: ICONS.btn_place,
    jump: ICONS.btn_jump,
    descend: ICONS.btn_fly_down,
    fly: ICONS.btn_fly,
    newWorld: ICONS.btn_new_world,
    credits: ICONS.btn_credits,
    fullscreen: ICONS.btn_fullscreen,
    fullscreenExit: ICONS.btn_fullscreen_exit,
    soundOn: ICONS.btn_sound_on,
    soundOff: ICONS.btn_sound_off,
    // 'rotate' (tourner la tablette) : pas d'équivalent dans les packs, icône maison gardée.
  });

  // Joystick (éléments créés par InputManager) : images appliquées par variables CSS.
  const root = document.documentElement.style;
  root.setProperty('--cb-joy-base-img', `url("${ICONS.joystick_base}")`);
  root.setProperty('--cb-joy-knob-img', `url("${ICONS.joystick_knob}")`);

  // Police Andika (panneau crédits, seul texte du jeu).
  if (!document.getElementById('cb-font-andika')) {
    const style = document.createElement('style');
    style.id = 'cb-font-andika';
    const face = (url: string, weight: number): string =>
      `@font-face{font-family:'Andika';src:url("${url}") format('woff2');font-weight:${weight};font-style:normal;font-display:swap;}`;
    style.textContent = face(FONTS.regular, 400) + (FONTS.bold ? face(FONTS.bold, 700) : '');
    document.head.appendChild(style);
  }
}
