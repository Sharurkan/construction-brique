/**
 * Suivi des doigts tactiles, sans DOM (testé dans touch.test.ts) :
 * un doigt « joystick » (moitié gauche) et un doigt « regard » (moitié droite) au plus.
 * Le visuel du joystick passe par une `JoystickView` injectée, pour que TOUTE remise à zéro
 * (doigt levé, annulé, page masquée, rotation de l'écran…) remette aussi le visuel au repos.
 */
import { computeJoystick, dragToLook } from './gestures';

export type TouchRole = 'joystick' | 'look';

/** Visuel du joystick (implémenté en DOM par InputManager). */
export interface JoystickView {
  /** Affiche la base centrée sur (x, y), coordonnées client. */
  show(x: number, y: number): void;
  /** Décalage du bouton (knob) par rapport au centre, en px. */
  setKnob(dx: number, dy: number): void;
  /** Retour au repos : base inactive à sa place par défaut, knob centré. */
  hide(): void;
}

interface Tracked {
  role: TouchRole;
  /** Centre du joystick, ou point de départ du regard. */
  originX: number;
  originY: number;
  lastX: number;
  lastY: number;
}

export interface TouchTrackerOptions {
  /** Rayon du joystick en px (lu à chaque appel : la base peut changer de taille). */
  radius: () => number;
  /** Zone morte (fraction du rayon). Défaut 0.15. */
  deadZone?: number;
  /** Sensibilité du regard, radians par px (lue à chaque mouvement). */
  lookSensitivity: () => number;
}

export class TouchTracker {
  /** Déplacement demandé par le joystick, dans [-1, 1]. */
  readonly move = { x: 0, z: 0 };
  private readonly pointers = new Map<number, Tracked>();

  constructor(private readonly view: JoystickView, private readonly opts: TouchTrackerOptions) {}

  /** Nombre de doigts suivis. */
  get count(): number {
    return this.pointers.size;
  }

  has(id: number): boolean {
    return this.pointers.has(id);
  }

  hasRole(role: TouchRole): boolean {
    for (const p of this.pointers.values()) if (p.role === role) return true;
    return false;
  }

  /**
   * Nouveau doigt. Pour le joystick, (originX, originY) est le centre de la base (déjà bridé
   * pour rester à l'écran) et (x, y) la position du doigt. Renvoie false si le rôle est déjà pris.
   */
  begin(id: number, role: TouchRole, x: number, y: number, originX = x, originY = y): boolean {
    if (this.pointers.has(id) || this.hasRole(role)) return false;
    this.pointers.set(id, { role, originX, originY, lastX: x, lastY: y });
    if (role === 'joystick') {
      this.view.show(originX, originY);
      this.updateJoystick(originX, originY, x, y);
    }
    return true;
  }

  /** Doigt déplacé : renvoie la rotation à ajouter (regard), ou null. */
  moveTo(id: number, x: number, y: number): { yaw: number; pitch: number } | null {
    const p = this.pointers.get(id);
    if (!p) return null;
    let look: { yaw: number; pitch: number } | null = null;
    if (p.role === 'joystick') this.updateJoystick(p.originX, p.originY, x, y);
    else look = dragToLook(x - p.lastX, y - p.lastY, this.opts.lookSensitivity());
    p.lastX = x;
    p.lastY = y;
    return look;
  }

  /** Doigt levé ou annulé. Renvoie true si le doigt était suivi. */
  end(id: number): boolean {
    const p = this.pointers.get(id);
    if (!p) return false;
    this.pointers.delete(id);
    if (p.role === 'joystick') this.resetJoystick();
    return true;
  }

  /**
   * Oublie tous les doigts (page masquée, perte de focus, rotation…). Remet TOUJOURS le
   * joystick et son visuel au repos, même si aucun doigt n'était suivi (visuel resté actif).
   */
  releaseAll(): void {
    this.pointers.clear();
    this.resetJoystick();
  }

  private resetJoystick(): void {
    this.move.x = 0;
    this.move.z = 0;
    this.view.hide();
  }

  private updateJoystick(ox: number, oy: number, x: number, y: number): void {
    const out = computeJoystick(x - ox, y - oy, this.opts.radius(), this.opts.deadZone ?? 0.15);
    this.move.x = out.x;
    this.move.z = out.z;
    this.view.setKnob(out.knobX, out.knobY);
  }
}
