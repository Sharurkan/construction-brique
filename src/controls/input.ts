import '../ui/styles.css';
import type { InputState } from '../core/types';
import { dragToLook, keysToMove, keyToMoveDir, keyToSlot, mergeMove, type MoveDir } from './gestures';
import { TouchTracker, type TouchRole } from './touch';

/**
 * Attribut posé sur tout élément d'interface : un doigt qui commence dessus
 * ne déplace JAMAIS la caméra ni le joystick.
 */
export const NO_LOOK_ATTR = 'data-no-look';

/**
 * État d'entrée produit par `InputManager` : le contrat, avec `descend` toujours renseigné.
 * (Alias conservé pour compatibilité ; `descend` fait désormais partie d'`InputState`.)
 */
export type ExtendedInputState = InputState & { descend: boolean };

export interface InputOptions {
  /** Sensibilité du regard tactile, en radians par pixel. Défaut 0.0055. */
  touchLookSensitivity?: number;
  /** Sensibilité souris (Pointer Lock), en radians par pixel. Défaut 0.0025. */
  mouseLookSensitivity?: number;
  /** Diamètre de la base du joystick en px (>= 140). Défaut 150. */
  joystickSize?: number;
  /** Zone morte du joystick (fraction du rayon). Défaut 0.15. */
  deadZone?: number;
  /** Clic gauche (souris capturée) : casser. */
  onPrimary?: () => void;
  /** Clic droit (souris capturée) : poser. */
  onSecondary?: () => void;
  /** Touches 1–9 : index de bloc dans la palette (0..8). */
  onSlot?: (index: number) => void;
  /** Molette : +1 bloc suivant, -1 bloc précédent. */
  onScroll?: (delta: 1 | -1) => void;
  /** Touche F : bascule le mode vol. */
  onToggleFly?: () => void;
  /** Demande le Pointer Lock au clic souris (PC). Défaut true. */
  pointerLock?: boolean;
}

/**
 * Fusionne tactile (joystick flottant à gauche, regard à droite) et clavier/souris.
 * Lecture par frame : `state` (move/jump en continu) puis `consumeLook()` pour la rotation accumulée.
 */
export class InputManager {
  readonly state: ExtendedInputState = { move: { x: 0, z: 0 }, look: { yaw: 0, pitch: 0 }, jump: false, descend: false };

  touchLookSensitivity: number;
  mouseLookSensitivity: number;

  private readonly opts: InputOptions;
  private readonly touch: TouchTracker;
  private readonly keyDirs = new Map<string, MoveDir>();
  private keyJump = false;
  private keyDescend = false;
  private readonly buttons = { jump: false, descend: false };
  private mouseLockFailed = false;
  private readonly joyBase: HTMLDivElement;
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly element: HTMLElement, options: InputOptions = {}) {
    this.opts = options;
    this.touchLookSensitivity = options.touchLookSensitivity ?? 0.0055;
    this.mouseLookSensitivity = options.mouseLookSensitivity ?? 0.0025;

    element.style.touchAction = 'none';
    element.style.userSelect = 'none';
    if (getComputedStyle(element).position === 'static') element.style.position = 'relative';

    // Visuel du joystick flottant (discret tant qu'aucun doigt n'est posé).
    const size = Math.max(140, options.joystickSize ?? 150);
    const base = document.createElement('div');
    base.className = 'cb-joy-base';
    base.style.width = base.style.height = `${size}px`;
    const knob = document.createElement('div');
    knob.className = 'cb-joy-knob';
    base.appendChild(knob);
    base.setAttribute('aria-hidden', 'true');
    element.appendChild(base);
    this.joyBase = base;

    this.touch = new TouchTracker(
      {
        show: (x, y) => {
          const rect = element.getBoundingClientRect();
          base.style.left = `${x - rect.left}px`;
          base.style.top = `${y - rect.top}px`;
          base.classList.add('is-active');
        },
        setKnob: (dx, dy) => {
          knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        },
        hide: () => {
          base.classList.remove('is-active');
          base.style.left = '';
          base.style.top = '';
          knob.style.transform = 'translate(-50%, -50%)';
        },
      },
      {
        radius: () => this.joystickRadius(),
        deadZone: options.deadZone ?? 0.15,
        lookSensitivity: () => this.touchLookSensitivity,
      },
    );

    this.listen(element, 'pointerdown', this.onPointerDown as EventListener);
    this.listen(element, 'pointermove', this.onPointerMove as EventListener);
    this.listen(element, 'pointerup', this.onPointerEnd as EventListener);
    this.listen(element, 'pointercancel', this.onPointerEnd as EventListener);
    this.listen(element, 'lostpointercapture', this.onPointerEnd as EventListener);
    // Filet si la capture a échoué : le relâchement arrive alors hors de l'élément.
    this.listen(window, 'pointerup', this.onPointerEnd as EventListener, { capture: true });
    this.listen(window, 'pointercancel', this.onPointerEnd as EventListener, { capture: true });
    this.listen(element, 'contextmenu', (e) => e.preventDefault());
    this.listen(element, 'wheel', this.onWheel as EventListener, { passive: false });
    this.listen(document, 'mousemove', this.onMouseMove as EventListener);
    this.listen(document, 'pointerlockerror', () => { this.mouseLockFailed = true; });
    this.listen(window, 'keydown', this.onKeyDown as EventListener);
    this.listen(window, 'keyup', this.onKeyUp as EventListener);
    this.listen(window, 'blur', () => this.releaseAll());
    this.listen(window, 'pagehide', () => this.releaseAll());
    this.listen(document, 'visibilitychange', () => { if (document.hidden) this.releaseAll(); });
    // Rotation de l'écran pendant un geste : le centre du joystick n'a plus de sens.
    this.listen(window, 'orientationchange', () => this.releaseAll());
    this.listen(window, 'resize', () => { if (this.touch.count > 0) this.releaseAll(); });
  }

  /** Renvoie la rotation accumulée depuis le dernier appel et la remet à zéro. */
  consumeLook(): { yaw: number; pitch: number } {
    const out = { yaw: this.state.look.yaw, pitch: this.state.look.pitch };
    this.state.look.yaw = 0;
    this.state.look.pitch = 0;
    return out;
  }

  /** Boutons virtuels de l'interface (SAUTER, DESCENDRE) : à brancher sur le HUD. */
  setButton(name: 'jump' | 'descend', down: boolean): void {
    this.buttons[name] = down;
    this.refresh();
  }

  /**
   * Relâche tout : touches, boutons virtuels, doigts suivis, et remet le visuel du joystick
   * au repos (même sans doigt suivi). Appelé automatiquement sur blur, pagehide, page masquée
   * et rotation de l'écran.
   */
  releaseAll(): void {
    this.keyDirs.clear();
    this.keyJump = this.keyDescend = false;
    this.buttons.jump = this.buttons.descend = false;
    this.touch.releaseAll();
    this.refresh();
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.element;
  }

  dispose(): void {
    for (const c of this.cleanups.splice(0)) c();
    if (this.pointerLocked) document.exitPointerLock?.();
    this.touch.releaseAll();
    this.joyBase.remove();
  }

  // ---------- interne ----------

  private listen(target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, opts);
    this.cleanups.push(() => target.removeEventListener(type, fn, opts));
  }

  private refresh(): void {
    const kb = keysToMove(this.keyDirs.values());
    const m = mergeMove(this.touch.move, kb);
    this.state.move.x = m.x;
    this.state.move.z = m.z;
    this.state.jump = this.keyJump || this.buttons.jump;
    this.state.descend = this.keyDescend || this.buttons.descend;
  }

  private isUiTarget(e: Event): boolean {
    const t = e.target;
    return t instanceof Element && t !== this.element && t.closest(`[${NO_LOOK_ATTR}]`) !== null;
  }

  private joystickRadius(): number {
    return this.joyBase.offsetWidth / 2 || 75;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.isUiTarget(e)) return;

    if (e.pointerType === 'mouse' && this.opts.pointerLock !== false && !this.mouseLockFailed) {
      e.preventDefault();
      if (!this.pointerLocked) {
        const req = this.element.requestPointerLock?.();
        // Certains navigateurs renvoient une promesse rejetée au lieu de l'événement d'erreur.
        if (req && typeof (req as Promise<void>).catch === 'function') {
          (req as Promise<void>).catch(() => { this.mouseLockFailed = true; });
        } else if (!this.element.requestPointerLock) {
          this.mouseLockFailed = true;
        }
        return;
      }
      if (e.button === 0) this.opts.onPrimary?.();
      else if (e.button === 2) this.opts.onSecondary?.();
      return;
    }

    const rect = this.element.getBoundingClientRect();
    const role: TouchRole = e.clientX - rect.left < rect.width / 2 ? 'joystick' : 'look';
    // Un seul doigt par rôle ; les doigts supplémentaires sont ignorés.
    if (this.touch.hasRole(role)) return;

    let ox = e.clientX;
    let oy = e.clientY;
    if (role === 'joystick') {
      // Le centre reste entièrement à l'écran même si le doigt se pose près d'un bord.
      const r = this.joystickRadius();
      ox = rect.left + Math.min(Math.max(e.clientX - rect.left, r), rect.width - r);
      oy = rect.top + Math.min(Math.max(e.clientY - rect.top, r), rect.height - r);
    }
    e.preventDefault();
    try { this.element.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    this.touch.begin(e.pointerId, role, e.clientX, e.clientY, ox, oy);
    this.refresh();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.touch.has(e.pointerId)) return;
    const look = this.touch.moveTo(e.pointerId, e.clientX, e.clientY);
    if (look) {
      this.state.look.yaw += look.yaw;
      this.state.look.pitch += look.pitch;
    } else {
      this.refresh();
    }
  };

  /** pointerup / pointercancel / lostpointercapture (élément ou fenêtre) : idempotent. */
  private onPointerEnd = (e: PointerEvent): void => {
    if (this.touch.end(e.pointerId)) this.refresh();
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.pointerLocked) return;
    const d = dragToLook(e.movementX, e.movementY, this.mouseLookSensitivity);
    this.state.look.yaw += d.yaw;
    this.state.look.pitch += d.pitch;
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (e.deltaY !== 0) this.opts.onScroll?.(e.deltaY > 0 ? 1 : -1);
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const dir = keyToMoveDir(e.code, e.key);
    if (dir) {
      this.keyDirs.set(e.code || e.key, dir);
      e.preventDefault();
    } else if (e.code === 'Space') {
      this.keyJump = true;
      e.preventDefault();
    } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      this.keyDescend = true;
    } else if (e.code === 'KeyF' && !e.repeat) {
      this.opts.onToggleFly?.();
    } else {
      const slot = keyToSlot(e.code);
      if (slot !== null && !e.repeat) this.opts.onSlot?.(slot);
    }
    this.refresh();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keyDirs.delete(e.code || e.key);
    if (e.code === 'Space') this.keyJump = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.keyDescend = false;
    this.refresh();
  };
}
