import type { PerspectiveCamera } from 'three';
import type { CollisionWorld, InputState, PlayerState } from '../core/types';
import { clampPitch } from '../controls/gestures';

/** Dimensions et réglages physiques (unités = blocs = mètres). */
export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.7;
export const EYE_HEIGHT = 1.6;
export const WALK_SPEED = 4.3;
export const FLY_SPEED = 6;
/** Gravité « douce » (Terre ≈ 9.8 mais les jeux de blocs utilisent ~32 ; on reste entre les deux). */
export const GRAVITY = 18;
export const JUMP_HEIGHT = 1.25;
export const JUMP_VELOCITY = Math.sqrt(2 * GRAVITY * JUMP_HEIGHT);
export const MAX_FALL_SPEED = 30;
export const MAX_DT = 0.05;
/** Durée max d'un sous-pas : à 30 blocs/s, 1/120 s = 0.25 bloc < demi-largeur du joueur. */
export const SUBSTEP = 1 / 120;
export const RESPAWN_Y = -5;

const HALF_W = PLAYER_WIDTH / 2;
const EPS = 1e-4;
/** Hauteur max de recherche d'un espace libre pour l'anti-blocage. */
const UNSTUCK_MAX = 512;

export interface Vec3 { x: number; y: number; z: number }
export interface LookRay { origin: Vec3; dir: Vec3 }

/** Entrées du joueur : le contrat + options internes à l'Agent D (descendre en vol). */
export type PlayerInput = InputState & { descend?: boolean };

export interface HorizontalBounds { minX: number; maxX: number; minZ: number; maxZ: number }
export interface VerticalBounds { maxY: number }

/** Vrai si le bloc [x,x+1)×[y,y+1)×[z,z+1) chevauche l'AABB d'un joueur dont les pieds sont en `feet`. */
export function blockIntersectsPlayer(feet: Vec3, x: number, y: number, z: number): boolean {
  return (
    x < feet.x + HALF_W && x + 1 > feet.x - HALF_W &&
    y < feet.y + PLAYER_HEIGHT && y + 1 > feet.y &&
    z < feet.z + HALF_W && z + 1 > feet.z - HALF_W
  );
}

export class Player {
  readonly state: PlayerState;
  readonly velocity: Vec3 = { x: 0, y: 0, z: 0 };
  onGround = false;
  flying = false;
  /** Active l'auto-saut des marches d'un bloc. */
  autoJump = true;
  private spawn: Vec3;
  private bounds: HorizontalBounds | null = null;
  private maxY = Infinity;

  constructor(spawn: Vec3 = { x: 0, y: 0, z: 0 }, yaw = 0, pitch = 0) {
    this.spawn = { ...spawn };
    this.state = { position: { ...spawn }, yaw, pitch };
  }

  /** Point de réapparition (chute sous y = -5). */
  setSpawn(p: Vec3): void {
    this.spawn = { ...p };
  }

  /** Limites horizontales optionnelles (murs invisibles) : hors de ces limites, tout est solide. */
  setBounds(b: HorizontalBounds | null): void {
    this.bounds = b ? { ...b } : null;
  }

  /**
   * Plafond optionnel : hauteur max des PIEDS (ex. `world.sizeY + 8`), en vol comme au saut.
   * Évite de monter si haut qu'on ne voit plus que le ciel.
   */
  setVerticalBounds(b: VerticalBounds | null): void {
    this.maxY = b ? b.maxY : Infinity;
  }

  /** Téléporte (pieds) et remet la vitesse à zéro. */
  teleport(p: Vec3): void {
    this.state.position.x = p.x;
    this.state.position.y = p.y;
    this.state.position.z = p.z;
    this.velocity.x = this.velocity.y = this.velocity.z = 0;
  }

  toggleFly(): boolean {
    this.flying = !this.flying;
    this.velocity.y = 0;
    this.onGround = false;
    return this.flying;
  }

  /**
   * Avance la simulation. Lit `input.look` (à remettre à zéro ensuite via `InputManager.consumeLook()`),
   * `input.move`, `input.jump` et `input.descend` (optionnel, mode vol).
   */
  update(dt: number, input: PlayerInput, world: CollisionWorld): void {
    if (!(dt > 0)) dt = 0;
    dt = Math.min(dt, MAX_DT);

    this.state.yaw = wrapAngle(this.state.yaw + (input.look.yaw || 0));
    this.state.pitch = clampPitch(this.state.pitch + (input.look.pitch || 0));

    this.unstuck(world);

    const steps = Math.max(1, Math.ceil(dt / SUBSTEP - 1e-9));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) this.step(h, input, world);

    if (this.state.position.y < RESPAWN_Y) {
      this.teleport(this.spawn);
      this.unstuck(world);
    }
  }

  /** Vrai si un bloc posé en (x,y,z) chevaucherait le joueur (à refuser). */
  wouldIntersectPlayer(x: number, y: number, z: number): boolean {
    return blockIntersectsPlayer(this.state.position, x, y, z);
  }

  /** Vrai si l'AABB du joueur chevauche un bloc solide. */
  isStuck(world: CollisionWorld): boolean {
    const p = this.state.position;
    return this.collides(world, p.x, p.y, p.z);
  }

  getEyePosition(): Vec3 {
    return this.getEyePositionInto({ x: 0, y: 0, z: 0 });
  }

  /** Comme getEyePosition(), sans allocation. */
  getEyePositionInto(out: Vec3): Vec3 {
    const p = this.state.position;
    out.x = p.x;
    out.y = p.y + EYE_HEIGHT;
    out.z = p.z;
    return out;
  }

  /** Rayon de visée : origine aux yeux, direction unitaire (yaw 0 = vers -Z, pitch > 0 = vers le haut). */
  getLookRay(): LookRay {
    return this.getLookRayInto({ origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: 0 } });
  }

  /** Comme getLookRay(), sans allocation : remplit et renvoie `out` (à appeler à chaque frame). */
  getLookRayInto(out: LookRay): LookRay {
    const { yaw, pitch } = this.state;
    const cp = Math.cos(pitch);
    this.getEyePositionInto(out.origin);
    out.dir.x = -Math.sin(yaw) * cp;
    out.dir.y = Math.sin(pitch);
    out.dir.z = -Math.cos(yaw) * cp;
    return out;
  }

  applyToCamera(camera: PerspectiveCamera): void {
    const p = this.state.position;
    camera.position.set(p.x, p.y + EYE_HEIGHT, p.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(this.state.pitch, this.state.yaw, 0);
  }

  // ---------- physique ----------

  private step(h: number, input: PlayerInput, world: CollisionWorld): void {
    const { yaw } = this.state;
    let mx = input.move.x || 0;
    let mz = input.move.z || 0;
    const n = Math.hypot(mx, mz);
    if (n > 1) { mx /= n; mz /= n; }
    // avant = (-sin yaw, -cos yaw), droite = (cos yaw, -sin yaw)
    const speed = this.flying ? FLY_SPEED : WALK_SPEED;
    this.velocity.x = (Math.cos(yaw) * mx - Math.sin(yaw) * mz) * speed;
    this.velocity.z = (-Math.sin(yaw) * mx - Math.cos(yaw) * mz) * speed;

    if (this.flying) {
      this.velocity.y = ((input.jump ? 1 : 0) - (input.descend ? 1 : 0)) * FLY_SPEED;
    } else {
      if (input.jump && this.onGround) {
        this.velocity.y = JUMP_VELOCITY;
        this.onGround = false;
      }
      this.velocity.y = Math.max(-MAX_FALL_SPEED, this.velocity.y - GRAVITY * h);
    }

    const dx = this.velocity.x * h;
    const dz = this.velocity.z * h;
    const blockedX = this.moveAxis(world, 0, dx);
    const blockedZ = this.moveAxis(world, 2, dz);

    // Auto-saut : on avance contre un obstacle d'UN bloc et l'espace au-dessus est libre.
    if (this.autoJump && !this.flying && this.onGround && n > 0.3 && (blockedX || blockedZ)) {
      if (this.canStepUp(world, dx, dz)) {
        this.velocity.y = JUMP_VELOCITY;
        this.onGround = false;
      }
    }

    const vy = this.velocity.y * h;
    const blockedY = this.moveAxis(world, 1, vy);
    if (blockedY) {
      if (vy < 0) this.onGround = true;
      this.velocity.y = 0;
    } else if (vy !== 0) {
      this.onGround = false;
    }
    if (this.state.position.y > this.maxY) {
      // Plafond : on reste dessous (vitesse montante annulée).
      this.state.position.y = this.maxY;
      if (this.velocity.y > 0) this.velocity.y = 0;
    }
    if (!blockedY && vy === 0 && !this.flying) {
      // Vitesse nulle exactement (rare) : vérifier s'il y a un sol sous les pieds.
      const p = this.state.position;
      this.onGround = this.collides(world, p.x, p.y - 0.01, p.z);
    }
  }

  /** Déplace sur un axe (0=x, 1=y, 2=z). Renvoie true si une collision a bloqué le mouvement. */
  private moveAxis(world: CollisionWorld, axis: 0 | 1 | 2, delta: number): boolean {
    if (delta === 0) return false;
    const p = this.state.position;
    const nx = axis === 0 ? p.x + delta : p.x;
    const ny = axis === 1 ? p.y + delta : p.y;
    const nz = axis === 2 ? p.z + delta : p.z;
    const minX = nx - HALF_W, maxX = nx + HALF_W;
    const minY = ny, maxY = ny + PLAYER_HEIGHT;
    const minZ = nz - HALF_W, maxZ = nz + HALF_W;

    let hit = false;
    let limit = delta > 0 ? Infinity : -Infinity;
    for (let x = Math.floor(minX); x < maxX; x++) {
      for (let y = Math.floor(minY); y < maxY; y++) {
        for (let z = Math.floor(minZ); z < maxZ; z++) {
          if (!this.solidAt(world, x, y, z)) continue;
          // Ignore les blocs déjà chevauchés avant le déplacement sur cet axe (évite d'être « aspiré »).
          const c = axis === 0 ? x : axis === 1 ? y : z;
          const cur = axis === 0 ? p.x : axis === 1 ? p.y : p.z;
          const lo = axis === 1 ? 0 : -HALF_W;
          const hi = axis === 1 ? PLAYER_HEIGHT : HALF_W;
          if (delta > 0) {
            if (c < cur + hi - EPS) continue; // déjà en chevauchement (ou derrière)
            hit = true;
            limit = Math.min(limit, c - hi - EPS);
          } else {
            if (c + 1 > cur + lo + EPS) continue;
            hit = true;
            limit = Math.max(limit, c + 1 - lo + EPS);
          }
        }
      }
    }

    if (!hit) {
      if (axis === 0) p.x = nx; else if (axis === 1) p.y = ny; else p.z = nz;
      return false;
    }
    const cur = axis === 0 ? p.x : axis === 1 ? p.y : p.z;
    // On ne recule jamais à cause de la résolution (cas limite flottant).
    const target = delta > 0 ? Math.max(cur, limit) : Math.min(cur, limit);
    if (axis === 0) p.x = target; else if (axis === 1) p.y = target; else p.z = target;
    return true;
  }

  /** L'obstacle devant fait exactement un bloc et l'espace au-dessus (tête comprise) est libre. */
  private canStepUp(world: CollisionWorld, dx: number, dz: number): boolean {
    const p = this.state.position;
    const len = Math.hypot(dx, dz);
    if (len === 0) return false;
    const probe = 0.3; // sonde un peu devant le joueur
    const px = p.x + (dx / len) * probe;
    const pz = p.z + (dz / len) * probe;
    const up = Math.floor(p.y + EPS) + 1 + EPS;
    if (up - p.y > 1.2) return false;
    // Obstacle bien présent au niveau des pieds devant…
    if (!this.collides(world, px, p.y + EPS, pz)) return false;
    // …et libre une marche plus haut, devant comme sur place (place pour la tête).
    return !this.collides(world, p.x, up, p.z) && !this.collides(world, px, up, pz);
  }

  private collides(world: CollisionWorld, fx: number, fy: number, fz: number): boolean {
    const maxX = fx + HALF_W, maxY = fy + PLAYER_HEIGHT, maxZ = fz + HALF_W;
    for (let x = Math.floor(fx - HALF_W); x < maxX; x++) {
      for (let y = Math.floor(fy); y < maxY; y++) {
        for (let z = Math.floor(fz - HALF_W); z < maxZ; z++) {
          if (this.solidAt(world, x, y, z)) return true;
        }
      }
    }
    return false;
  }

  private solidAt(world: CollisionWorld, x: number, y: number, z: number): boolean {
    const b = this.bounds;
    if (b && (x < b.minX || x >= b.maxX || z < b.minZ || z >= b.maxZ)) return true;
    return world.isSolid(x, y, z);
  }

  /** Anti-blocage : si le joueur est DANS un bloc, le remonter au premier espace libre. */
  private unstuck(world: CollisionWorld): void {
    const p = this.state.position;
    if (!this.collides(world, p.x, p.y, p.z)) return;
    const base = Math.floor(p.y);
    for (let k = 1; k <= UNSTUCK_MAX; k++) {
      const y = base + k;
      if (!this.collides(world, p.x, y, p.z)) {
        p.y = y;
        this.velocity.y = 0;
        this.onGround = true;
        return;
      }
    }
    // Rien trouvé (monde plein ?) : retour au point d'apparition.
    this.teleport(this.spawn);
  }
}

function wrapAngle(a: number): number {
  const TWO_PI = Math.PI * 2;
  a %= TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  else if (a < -Math.PI) a += TWO_PI;
  return a;
}
