/**
 * Démo « ciel » : types et constantes partagés par les 3 styles.
 *
 * PRINCIPE (proposé pour le jeu) : le ciel est une SCÈNE À PART, rendue AVANT le monde avec une
 * caméra « ciel » qui copie l'orientation de la caméra du joueur mais reste à l'origine (le ciel
 * suit le joueur en position, comme un vrai ciel infiniment loin) et a son propre `far` (1000).
 * Ensuite on efface seulement la profondeur et on rend le monde par-dessus avec SON brouillard
 * (32–90) et SON `far` (120). Résultat : les éléments du ciel ne sont jamais coupés par le `far`
 * ni mangés par le brouillard, et le relief les cache normalement à l'horizon.
 */
import * as THREE from 'three';

export type SkyElementKey = 'clouds' | 'sun' | 'balloons' | 'rainbow' | 'birds' | 'dragon';

export interface LegendRow {
  key: SkyElementKey;
  /** Nom affiché (« Nuages »…). */
  name: string;
  /** Ce qu'on voit, en quelques mots. */
  what: string;
  /** Provenance (pack, auteur). */
  source: string;
  /** asset = fichier d'un pack open source ; proc = géométrie construite en code (+ tuiles du jeu). */
  kind: 'asset' | 'proc';
  license: string;
}

export interface SkyStyle {
  letter: 'A' | 'B' | 'C';
  name: string;
  /** Tout ce qui est rendu dans la scène « ciel » pour ce style. */
  group: THREE.Group;
  rows: LegendRow[];
  /** Estimation affichée (draw calls ajoutés, triangles, mémoire texture). */
  costText: string;
  /** Appelée chaque frame (aucune allocation). `t` en secondes. */
  update(t: number, dt: number): void;
}

/** Distances (unités) depuis le joueur, dans la scène « ciel ». Du plus loin au plus proche. */
export const R_SUN = 300;
export const R_RAINBOW = 235;
export const R_CLOUDS = 190;
export const R_BALLOONS = 120;
export const R_BIRDS = 80;
export const R_DRAGON = 100;

/** Azimuts (radians, 0 = +X, sens trigonométrique vu du dessus). Arc-en-ciel à l'opposé du soleil. */
export const SUN_AZIMUTH = THREE.MathUtils.degToRad(35);
export const SUN_ELEVATION = THREE.MathUtils.degToRad(48);
export const RAINBOW_AZIMUTH = SUN_AZIMUTH + Math.PI;
/** Le centre de l'arc est sous l'horizon : l'arche « sort » du sol au loin. */
export const RAINBOW_CENTER_Y = 2;
export const RAINBOW_OUTER = 92;
export const RAINBOW_BAND = 6;

/** Couleurs de l'arc-en-ciel (rouge → violet), proches des laines du jeu. */
export const RAINBOW_COLORS = [0xe53935, 0xff9800, 0xffe03b, 0x43c047, 0x1e88e5, 0x3f51b5, 0x9c3fd0];

/** Point sur un cercle horizontal (azimut a, rayon r, hauteur y) → out. */
export function onCircle(out: THREE.Vector3, a: number, r: number, y: number): THREE.Vector3 {
  return out.set(Math.cos(a) * r, y, -Math.sin(a) * r);
}

/** Direction du soleil (vecteur unitaire). */
export function sunPosition(out: THREE.Vector3, r: number): THREE.Vector3 {
  const h = Math.cos(SUN_ELEVATION) * r;
  return out.set(Math.cos(SUN_AZIMUTH) * h, Math.sin(SUN_ELEVATION) * r, -Math.sin(SUN_AZIMUTH) * h);
}

// ---------- Trajectoires communes (mêmes mouvements dans les 3 styles) ----------

export interface CloudDef {
  a0: number;
  y: number;
  r: number;
  /** Vitesse angulaire (rad/s) : très lente. */
  w: number;
  /** Variante (forme / image). */
  v: number;
  scale: number;
}
export const CLOUDS: CloudDef[] = [
  { a0: 0.3, y: 92, r: R_CLOUDS, w: 0.012, v: 0, scale: 1.0 },
  { a0: 1.55, y: 70, r: R_CLOUDS + 10, w: 0.012, v: 1, scale: 0.9 },
  { a0: 2.6, y: 104, r: R_CLOUDS - 8, w: 0.012, v: 2, scale: 1.1 },
  { a0: 3.85, y: 78, r: R_CLOUDS + 5, w: 0.012, v: 3, scale: 0.95 },
  { a0: 5.0, y: 98, r: R_CLOUDS, w: 0.012, v: 0, scale: 0.85 },
];

export interface BalloonDef {
  a0: number;
  y: number;
  r: number;
  w: number;
  phase: number;
}
export const BALLOONS: BalloonDef[] = [
  { a0: 0.9, y: 40, r: R_BALLOONS, w: 0.018, phase: 0 },
  { a0: 2.9, y: 52, r: R_BALLOONS + 12, w: 0.018, phase: 2.1 },
  { a0: 4.7, y: 34, r: R_BALLOONS - 8, w: 0.018, phase: 4.2 },
];

export interface BirdGroupDef {
  a0: number;
  y: number;
  r: number;
  /** Vitesse angulaire (rad/s) ; négative = sens inverse. */
  w: number;
  count: number;
  color: number;
}
export const BIRD_GROUPS: BirdGroupDef[] = [
  { a0: 0.0, y: 30, r: R_BIRDS, w: 0.09, count: 5, color: 0x2f7de1 },
  { a0: 2.2, y: 40, r: R_BIRDS + 12, w: -0.075, count: 3, color: 0xe53935 },
  { a0: 4.1, y: 24, r: R_BIRDS - 6, w: 0.11, count: 4, color: 0xffb300 },
];
/** Décalages d'un oiseau dans la formation en V (repère local : +X = avant, ±Z = côtés). */
export function formationOffset(out: THREE.Vector3, i: number, spacing: number): THREE.Vector3 {
  if (i === 0) return out.set(0, 0, 0);
  const rank = Math.ceil(i / 2);
  const side = i % 2 === 1 ? 1 : -1;
  return out.set(-rank * spacing, (i % 3) * 0.4, side * rank * spacing);
}

/**
 * Position + direction d'un oiseau à l'instant t. `dir` = direction de vol (unitaire, horizontale).
 * Aucune allocation : tout passe par les vecteurs fournis.
 */
const _off = new THREE.Vector3();
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
  // Tangente au cercle dans le sens du vol.
  dir.set(-Math.sin(a) * s, 0, -Math.cos(a) * s);
  onCircle(pos, a, g.r, g.y + 2.5 * Math.sin(t * 0.6 + g.a0));
  formationOffset(_off, i, spacing);
  // Repère local → monde : X local = dir, Z local = dir × haut (à droite).
  const rx = -dir.z;
  const rz = dir.x;
  pos.x += dir.x * _off.x + rx * _off.z;
  pos.z += dir.z * _off.x + rz * _off.z;
  pos.y += _off.y;
  /** Lacet (rotation autour de Y) qui amène +X sur dir. */
  return Math.atan2(-dir.z, dir.x);
}

/** Le dragon : un seul, gentil, qui fait de grands cercles lents (un tour en ~2 min). */
export const DRAGON = { a0: 1.2, y: 44, r: R_DRAGON, w: 0.055 };

/** Position + direction du dragon (aucune allocation). Renvoie le lacet qui amène +X sur dir. */
export function dragonState(t: number, pos: THREE.Vector3, dir: THREE.Vector3): number {
  const a = DRAGON.a0 + DRAGON.w * t;
  dir.set(-Math.sin(a), 0, -Math.cos(a));
  // Ondulation douce en hauteur, synchronisée à peu près avec les battements d'ailes.
  onCircle(pos, a, DRAGON.r, DRAGON.y + 4 * Math.sin(t * 0.5) + 0.6 * Math.sin(t * 3));
  return Math.atan2(-dir.z, dir.x);
}

/** Charge une image (aucun réseau externe : fichiers de public/assets/sky). */
export async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  return img;
}

export const SKY_ASSETS = import.meta.env.BASE_URL + 'assets/sky/';
