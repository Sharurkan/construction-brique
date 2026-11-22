/**
 * Icônes de l'interface, centralisées ici.
 *
 * ⚠ PROVISOIRES : formes géométriques très simples dessinées à la main en SVG inline.
 * Elles seront remplacées en Phase 2 par un pack d'icônes open source, via :
 *
 *   import { setIcons } from './ui/icons';
 *   setIcons({ break: pickaxeSvgString, place: '/construction-brique/icons/place.svg' });
 *
 * Une source est soit une chaîne SVG inline (commence par « <svg »), soit une URL d'image.
 * Les éléments déjà affichés sont mis à jour automatiquement (le Hud écoute `onIconsChanged`).
 */

export type IconName =
  | 'break' | 'place' | 'jump' | 'descend' | 'fly'
  | 'newWorld' | 'fullscreen' | 'fullscreenExit'
  | 'credits' | 'soundOn' | 'soundOff' | 'rotate';

/** Chaîne SVG inline (« <svg … ») ou URL d'image. */
export type IconSource = string;

const svg = (body: string): string =>
  `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" ` +
  `stroke-width="4" stroke-linecap="round" stroke-linejoin="round" data-provisional="true">${body}</svg>`;

/** Jeu provisoire (formes basiques). Ne pas modifier pour la Phase 2 : utiliser `setIcons`. */
export const PROVISIONAL_ICONS: Readonly<Record<IconName, IconSource>> = Object.freeze({
  // Casser : bloc fissuré.
  break: svg('<rect x="8" y="8" width="32" height="32" rx="3"/><path d="M24 8 L19 20 L28 25 L21 40"/>'),
  // Poser : bloc avec un plus.
  place: svg('<rect x="8" y="8" width="32" height="32" rx="3"/><path d="M24 16 V32 M16 24 H32"/>'),
  // Sauter : flèche vers le haut.
  jump: svg('<path d="M24 40 V10 M12 22 L24 10 L36 22"/>'),
  // Descendre (vol) : flèche vers le bas.
  descend: svg('<path d="M24 8 V38 M12 26 L24 38 L36 26"/>'),
  // Vol : triangle « avion en papier ».
  fly: svg('<path d="M6 26 L42 10 L30 40 L24 28 Z M24 28 L42 10"/>'),
  // Nouveau monde : flèche circulaire.
  newWorld: svg('<path d="M38 24 A14 14 0 1 1 33.9 14.1"/><path d="M34 6 V15 H25"/>'),
  // Plein écran : quatre coins vers l'extérieur.
  fullscreen: svg('<path d="M8 18 V8 H18 M30 8 H40 V18 M40 30 V40 H30 M18 40 H8 V30"/>'),
  // Quitter le plein écran : coins vers l'intérieur.
  fullscreenExit: svg('<path d="M18 8 V18 H8 M40 18 H30 V8 M30 40 V30 H40 M8 30 H18 V40"/>'),
  // Crédits : étoile.
  credits: svg('<path d="M24 6 L29 18 L42 19 L32 28 L35 41 L24 34 L13 41 L16 28 L6 19 L19 18 Z"/>'),
  // Son : haut-parleur + ondes.
  soundOn: svg('<path d="M8 19 H16 L26 10 V38 L16 29 H8 Z"/><path d="M32 18 Q36 24 32 30 M36 13 Q44 24 36 35"/>'),
  // Son coupé : haut-parleur + croix.
  soundOff: svg('<path d="M8 19 H16 L26 10 V38 L16 29 H8 Z"/><path d="M32 18 L42 30 M42 18 L32 30"/>'),
  // Tourner la tablette : tablette en portrait + flèche courbe.
  rotate: svg('<rect x="14" y="4" width="20" height="32" rx="3"/><path d="M8 34 Q8 44 24 44 Q40 44 42 34"/><path d="M36 32 L42 34 L44 28"/>'),
});

const current: Record<IconName, IconSource> = { ...PROVISIONAL_ICONS };
const listeners = new Set<() => void>();

export function getIcon(name: IconName): IconSource {
  return current[name];
}

/** Vrai tant que l'icône n'a pas été remplacée par le pack définitif. */
export function isProvisional(name: IconName): boolean {
  return current[name] === PROVISIONAL_ICONS[name];
}

export function setIcon(name: IconName, src: IconSource): void {
  setIcons({ [name]: src });
}

/** Remplace plusieurs icônes d'un coup (Phase 2). */
export function setIcons(map: Partial<Record<IconName, IconSource>>): void {
  for (const [k, v] of Object.entries(map) as Array<[IconName, IconSource | undefined]>) {
    if (v && k in current) current[k] = v;
  }
  for (const cb of listeners) cb();
}

/** Revient au jeu provisoire. */
export function resetIcons(): void {
  setIcons({ ...PROVISIONAL_ICONS });
}

/** Abonnement aux remplacements d'icônes. Renvoie une fonction de désabonnement. */
export function onIconsChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function isInlineSvg(src: IconSource): boolean {
  return src.trimStart().startsWith('<svg');
}

/** Remplit `el` avec l'icône (SVG inline ou <img>). Les icônes sont décoratives : aria-hidden. */
export function renderIconInto(el: HTMLElement, name: IconName): void {
  const src = getIcon(name);
  el.dataset.icon = name;
  el.setAttribute('aria-hidden', 'true');
  if (isInlineSvg(src)) {
    el.innerHTML = src; // source contrôlée par le code du jeu, jamais par l'utilisateur
  } else {
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.draggable = false;
    el.replaceChildren(img);
  }
}

/** Crée un <span class="cb-icon"> contenant l'icône. */
export function createIcon(name: IconName): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'cb-icon';
  renderIconInto(span, name);
  return span;
}

/** Re-rend toutes les icônes `[data-icon]` sous `root` (après `setIcons`). */
export function refreshIcons(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.cb-icon[data-icon]').forEach((el) => {
    renderIconInto(el, el.dataset.icon as IconName);
  });
}
