/**
 * Logique pure des gestes (sans DOM) : maths du joystick, détection du tap,
 * conversion glissement -> rotation, clavier -> déplacement. Testée dans gestures.test.ts.
 */

export interface JoystickOutput {
  /** Droite positive, dans [-1, 1]. */
  x: number;
  /** Avant positif (doigt vers le HAUT de l'écran), dans [-1, 1]. */
  z: number;
  /** Norme de la sortie, dans [0, 1]. */
  magnitude: number;
  /** Position du bouton (knob) relative au centre, bridée au rayon, en px. */
  knobX: number;
  knobY: number;
}

/**
 * Convertit le décalage du doigt (px, repère écran : y vers le bas) en sortie de joystick.
 * - bridé au rayon (norme <= 1) ;
 * - zone morte radiale `deadZone` (fraction du rayon) puis remise à l'échelle pour
 *   que la sortie reparte de 0 juste après la zone morte.
 */
export function computeJoystick(dx: number, dy: number, radius: number, deadZone = 0.15): JoystickOutput {
  const dist = Math.hypot(dx, dy);
  if (radius <= 0 || dist === 0) return { x: 0, z: 0, magnitude: 0, knobX: 0, knobY: 0 };
  const clamped = Math.min(dist, radius);
  const knobX = (dx / dist) * clamped;
  const knobY = (dy / dist) * clamped;
  const raw = clamped / radius;
  if (raw <= deadZone) return { x: 0, z: 0, magnitude: 0, knobX, knobY };
  const magnitude = Math.min(1, (raw - deadZone) / (1 - deadZone));
  const x = (dx / dist) * magnitude;
  const z = (-dy / dist) * magnitude;
  return { x: clean(x), z: clean(z), magnitude, knobX, knobY };
}

function clean(v: number): number {
  // Évite -0 et les résidus flottants minuscules.
  return Math.abs(v) < 1e-9 ? 0 : v;
}

export interface TapThresholds {
  maxDurationMs: number;
  maxDistancePx: number;
}

export const DEFAULT_TAP: TapThresholds = { maxDurationMs: 250, maxDistancePx: 10 };

/** Un tap = appui court ET quasi immobile. */
export function isTap(durationMs: number, distancePx: number, t: TapThresholds = DEFAULT_TAP): boolean {
  return durationMs < t.maxDurationMs && distancePx < t.maxDistancePx;
}

/**
 * Glissement écran (px) -> rotation (radians), signée pour le repère du jeu :
 * glisser vers la droite tourne à droite (yaw diminue), glisser vers le bas regarde vers le bas (pitch diminue).
 */
export function dragToLook(dx: number, dy: number, radPerPx: number): { yaw: number; pitch: number } {
  return { yaw: -dx * radPerPx || 0, pitch: -dy * radPerPx || 0 };
}

export const MAX_PITCH = (89 * Math.PI) / 180;

export function clampPitch(pitch: number): number {
  return Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
}

export type MoveDir = 'forward' | 'back' | 'left' | 'right';

/**
 * Associe une touche à une direction. On regarde `code` (position physique : WASD sur QWERTY
 * = ZQSD sur AZERTY) ET `key` (caractère : z/q/s/d, w/a/s/d), plus les flèches.
 */
export function keyToMoveDir(code: string, key: string): MoveDir | null {
  switch (code) {
    case 'KeyW': case 'ArrowUp': return 'forward';
    case 'KeyS': case 'ArrowDown': return 'back';
    case 'KeyA': case 'ArrowLeft': return 'left';
    case 'KeyD': case 'ArrowRight': return 'right';
  }
  switch (key.toLowerCase()) {
    case 'z': case 'w': return 'forward';
    case 's': return 'back';
    case 'q': case 'a': return 'left';
    case 'd': return 'right';
  }
  return null;
}

/** Index de bloc (0..8) pour les touches 1–9 (rangée du haut, même en AZERTY, ou pavé numérique). */
export function keyToSlot(code: string): number | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return m ? Number(m[1]) - 1 : null;
}

/** Combine les directions enfoncées en vecteur normalisé (diagonale = norme 1). */
export function keysToMove(dirs: Iterable<MoveDir>): { x: number; z: number } {
  let x = 0;
  let z = 0;
  const seen = new Set(dirs);
  if (seen.has('forward')) z += 1;
  if (seen.has('back')) z -= 1;
  if (seen.has('right')) x += 1;
  if (seen.has('left')) x -= 1;
  const n = Math.hypot(x, z);
  return n > 0 ? { x: x / n, z: z / n } : { x: 0, z: 0 };
}

/** Additionne joystick + clavier, en bridant la norme à 1. */
export function mergeMove(a: { x: number; z: number }, b: { x: number; z: number }): { x: number; z: number } {
  const x = a.x + b.x;
  const z = a.z + b.z;
  const n = Math.hypot(x, z);
  return n > 1 ? { x: x / n, z: z / n } : { x, z };
}
