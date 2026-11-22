/**
 * Ciel : positions et trajectoires des éléments (logique pure, testée par paths.test.ts).
 *
 * Repère de la scène « ciel » : le joueur est TOUJOURS à l'origine (la caméra ciel copie
 * l'orientation de la caméra du jeu mais pas sa position : le ciel suit le joueur). Les distances
 * sont en unités monde, toutes > camera.far du jeu (120) n'a pas d'importance : la passe ciel a son
 * propre far (1000) et aucun brouillard.
 *
 * Aucune fonction d'animation n'alloue : elles écrivent dans les vecteurs fournis.
 */
import * as THREE from 'three';

/** Distances depuis le joueur, du plus loin au plus proche. */
export const R_SUN = 300;
export const R_RAINBOW = 235;
export const R_CLOUDS = 190;
export const R_BALLOONS = 120;
export const R_DRAGON = 100;
export const R_BIRDS = 80;

/** Soleil : azimut (0 = +X, sens trigonométrique vu du dessus) et hauteur angulaire. */
export const SUN_AZIMUTH = THREE.MathUtils.degToRad(35);
export const SUN_ELEVATION = THREE.MathUtils.degToRad(48);
/** Arc-en-ciel à l'opposé du soleil (comme dans la vraie vie). */
export const RAINBOW_AZIMUTH = SUN_AZIMUTH + Math.PI;
/** Centre de l'arche, juste au-dessus de l'horizon du joueur. */
export const RAINBOW_CENTER_Y = 2;
export const RAINBOW_OUTER = 92;
/** Taille d'un bloc (et épaisseur d'une bande) de l'arc-en-ciel. */
export const RAINBOW_BAND = 6;
/** Rouge → violet, proches des laines du jeu. */
export const RAINBOW_COLORS = [0xe53935, 0xff9800, 0xffe03b, 0x43c047, 0x1e88e5, 0x3f51b5, 0x9c3fd0];

const TAU = Math.PI * 2;

/** Point sur un cercle horizontal (azimut a, rayon r, hauteur y). */
export function onCircle(out: THREE.Vector3, a: number, r: number, y: number): THREE.Vector3 {
  return out.set(Math.cos(a) * r, y, -Math.sin(a) * r);
}

/** Position du soleil à la distance r. */
export function sunPosition(out: THREE.Vector3, r = R_SUN): THREE.Vector3 {
  const h = Math.cos(SUN_ELEVATION) * r;
  return out.set(Math.cos(SUN_AZIMUTH) * h, Math.sin(SUN_ELEVATION) * r, -Math.sin(SUN_AZIMUTH) * h);
}

/** Lacet (rotation autour de Y) qui amène +X sur la direction horizontale (dx, dz). */
export function yawOf(dx: number, dz: number): number {
  return Math.atan2(-dz, dx);
}

// ---------- Nuages : dérive très lente autour du joueur ----------

export interface CloudDef {
  a0: number;
  y: number;
  r: number;
  /** Vitesse angulaire (rad/s). */
  w: number;
  /** Variante de forme. */
  v: number;
  scale: number;
}
export const CLOUDS: readonly CloudDef[] = [
  { a0: 0.3, y: 92, r: R_CLOUDS, w: 0.012, v: 0, scale: 1.0 },
  { a0: 1.55, y: 70, r: R_CLOUDS + 10, w: 0.012, v: 1, scale: 0.9 },
  { a0: 2.6, y: 104, r: R_CLOUDS - 8, w: 0.012, v: 2, scale: 1.1 },
  { a0: 3.85, y: 78, r: R_CLOUDS + 5, w: 0.012, v: 3, scale: 0.95 },
  { a0: 5.0, y: 98, r: R_CLOUDS, w: 0.012, v: 4, scale: 0.85 },
];

/** Position du nuage i ; renvoie son lacet (grand axe tangent au cercle). */
export function cloudState(i: number, t: number, pos: THREE.Vector3): number {
  const c = CLOUDS[i];
  const a = c.a0 + c.w * t;
  onCircle(pos, a, c.r, c.y);
  return a + Math.PI / 2;
}

// ---------- Montgolfières : dérive + montée/descente douce + rotation sur elles-mêmes ----------

export interface BalloonDef {
  a0: number;
  y: number;
  r: number;
  w: number;
  phase: number;
  /** Couleurs des rayures (laine). */
  colors: readonly [number, number];
}
export const BALLOONS: readonly BalloonDef[] = [
  { a0: 0.9, y: 40, r: R_BALLOONS, w: 0.018, phase: 0, colors: [0xe53935, 0xffffff] },
  { a0: 2.9, y: 52, r: R_BALLOONS + 12, w: 0.018, phase: 2.1, colors: [0x1e88e5, 0xffe03b] },
  { a0: 4.7, y: 34, r: R_BALLOONS - 8, w: 0.018, phase: 4.2, colors: [0x8e24aa, 0xf06292] },
];
/** Amplitude (unités) de la montée/descente des montgolfières. */
export const BALLOON_BOB = 3;

/** Position (bas de la nacelle) de la montgolfière i ; renvoie son lacet (rotation lente). */
export function balloonState(i: number, t: number, pos: THREE.Vector3): number {
  const b = BALLOONS[i];
  const a = b.a0 + b.w * t;
  onCircle(pos, a, b.r, b.y + BALLOON_BOB * Math.sin(t * 0.45 + b.phase));
  return (t * 0.12 + b.phase) % TAU;
}

// ---------- Oiseaux : vols en V qui font le tour du ciel en boucle ----------

export interface BirdGroupDef {
  a0: number;
  y: number;
  r: number;
  /** Vitesse angulaire (rad/s) ; négative = sens inverse. */
  w: number;
  count: number;
  color: number;
}
export const BIRD_GROUPS: readonly BirdGroupDef[] = [
  { a0: 0.0, y: 30, r: R_BIRDS, w: 0.09, count: 5, color: 0x2f7de1 },
  { a0: 2.2, y: 40, r: R_BIRDS + 12, w: -0.075, count: 3, color: 0xe53935 },
  { a0: 4.1, y: 24, r: R_BIRDS - 6, w: 0.11, count: 4, color: 0xffb300 },
];
export const BIRD_SPACING = 5.5;

/** Décalage d'un oiseau dans la formation en V (repère local : +X = avant, ±Z = côtés). */
export function formationOffset(out: THREE.Vector3, i: number, spacing: number): THREE.Vector3 {
  if (i === 0) return out.set(0, 0, 0);
  const rank = Math.ceil(i / 2);
  const side = i % 2 === 1 ? 1 : -1;
  return out.set(-rank * spacing, (i % 3) * 0.4, side * rank * spacing);
}

const _off = new THREE.Vector3();

/** Position + direction de vol de l'oiseau i du groupe g ; renvoie son lacet. */
export function birdState(
  g: BirdGroupDef,
  i: number,
  t: number,
  spacing: number,
  pos: THREE.Vector3,
  dir: THREE.Vector3,
): number {
  const a = g.a0 + g.w * t;
  const s = Math.sign(g.w);
  dir.set(-Math.sin(a) * s, 0, -Math.cos(a) * s); // tangente au cercle dans le sens du vol
  onCircle(pos, a, g.r, g.y + 2.5 * Math.sin(t * 0.6 + g.a0));
  formationOffset(_off, i, spacing);
  const rx = -dir.z; // droite = dir × haut
  const rz = dir.x;
  pos.x += dir.x * _off.x + rx * _off.z;
  pos.z += dir.z * _off.x + rz * _off.z;
  pos.y += _off.y;
  return yawOf(dir.x, dir.z);
}

/** Battement d'ailes (radians) : rapide pour les oiseaux. */
export function birdFlap(t: number, phase: number): number {
  return 0.15 + 0.65 * Math.sin(t * 9 + phase);
}

// ---------- Dragon : un seul, gentil, grands cercles lents ----------

export const DRAGON = { a0: 1.2, y: 44, r: R_DRAGON, w: 0.055 } as const;

/** Position + direction du dragon ; renvoie son lacet. */
export function dragonState(t: number, pos: THREE.Vector3, dir: THREE.Vector3): number {
  const a = DRAGON.a0 + DRAGON.w * t;
  dir.set(-Math.sin(a), 0, -Math.cos(a));
  onCircle(pos, a, DRAGON.r, DRAGON.y + 4 * Math.sin(t * 0.5) + 0.6 * Math.sin(t * 3));
  return yawOf(dir.x, dir.z);
}

/** Battement d'ailes du dragon : lent et ample. */
export function dragonFlap(t: number): number {
  return 0.2 + 0.6 * Math.sin(t * 3);
}

/** Rotation des rayons du soleil (variante 2), radians. */
export function sunRaysAngle(t: number): number {
  return (t * 0.12) % TAU;
}
