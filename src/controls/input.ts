import '../ui/styles.css';
import type { InputState } from '../core/types';
import {
  computeJoystick, dragToLook, isTap, keysToMove, keyToMoveDir, keyToSlot, mergeMove, type MoveDir,
} from './gestures';

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
  /** Tap court sur la zone de regard (ne fait rien par défaut). Coordonnées client. */
  onTap?: (x: number, y: number) => void;
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

type Role = 'joystick' | 'look';

interface TrackedPointer {
  role: Role;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startTime: number;
  maxDist: number;
}

/**
 * Fusionne tactile (joystick flottant à gauche, regard à droite) et clavier/souris.
 * Lecture par frame : `state` (move/jump en continu) puis `consumeLook()` pour la rotation accumulée.
 */
export class InputManager {
  readonly state: ExtendedInputState = { move: { x: 0, z: 0 }, look: { yaw: 0, pitch: 0 }, jump: false, descend: false };

  touchLookSensitivity: number;
  mouseLookSensitivity: number;
  onTap?: (x: number, y: number) => void;

  private readonly opts: InputOptions;
  private readonly pointers = new Map<number, TrackedPointer>();
  private joystickMove = { x: 0, z: 0 };
  private readonly keyDirs = new Map<string, MoveDir>();
  private keyJump = false;
  private keyDescend = false;
  private readonly buttons = { jump: false, descend: false };
  private mouseLockFailed = false;
  private readonly joyBase: HTMLDivElement;
  private readonly joyKnob: HTMLDivElement;
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly element: HTMLElement, options: InputOptions = {}) {
    this.opts = options;
    this.touchLookSensitivity = options.touchLookSensitivity ?? 0.0055;
    this.mouseLookSensitivity = options.mouseLookSensitivity ?? 0.0025;
    this.onTap = options.onTap;

    element.style.touchAction = 'none';
    element.style.userSelect = 'none';
    if (getComputedStyle(element).position === 'static') element.style.position = 'relative';

    // Visuel du joystick flottant (masqué tant qu'aucun doigt n'est posé).
    const size = Math.max(140, options.joystickSize ?? 150);
    this.joyBase = document.createElement('div');
    this.joyBase.className = 'cb-joy-base';
    this.joyBase.style.width = this.joyBase.style.height = `${size}px`;
    this.joyKnob = document.createElement('div');
    this.joyKnob.className = 'cb-joy-knob';
    this.joyBase.appendChild(this.joyKnob);
    this.joyBase.setAttribute('aria-hidden', 'true');
    element.appendChild(this.joyBase);

    this.listen(element, 'pointerdown', this.onPointerDown as EventListener);
    this.listen(element, 'pointermove', this.onPointerMove as EventListener);
    this.listen(element, 'pointerup', this.onPointerUp as EventListener);
    this.listen(element, 'pointercancel', this.onPointerCancel as EventListener);
    this.listen(element, 'lostpointercapture', this.onPointerCancel as EventListener);
    this.listen(element, 'contextmenu', (e) => e.preventDefault());
    this.listen(element, 'wheel', this.onWheel as EventListener, { passive: false });
    this.listen(document, 'mousemove', this.onMouseMove as EventListener);
    this.listen(document, 'pointerlockerror', () => { this.mouseLockFailed = true; });
    this.listen(window, 'keydown', this.onKeyDown as EventListener);
    this.listen(window, 'keyup', this.onKeyUp as EventListener);
    this.listen(window, 'blur', () => this.releaseAll());
    this.listen(document, 'visibilitychange', () => { if (document.hidden) this.releaseAll(); });
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

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.element;
  }

  dispose(): void {
    for (const c of this.cleanups.splice(0)) c();
    if (this.pointerLocked) document.exitPointerLock?.();
    this.joyBase.remove();
    this.pointers.clear();
  }

  // ---------- interne ----------

  private listen(target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, opts);
    this.cleanups.push(() => target.removeEventListener(type, fn, opts));
  }

  private refresh(): void {
    const kb = keysToMove(this.keyDirs.values());
    const m = mergeMove(this.joystickMove, kb);
    this.state.move.x = m.x;
    this.state.move.z = m.z;
    this.state.jump = this.keyJump || this.buttons.jump;
    this.state.descend = this.keyDescend || this.buttons.descend;
  }

  private releaseAll(): void {
    this.keyDirs.clear();
    this.keyJump = this.keyDescend = false;
    this.buttons.jump = this.buttons.descend = false;
    for (const id of [...this.pointers.keys()]) this.endPointer(id, false);
    this.refresh();
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
    const leftHalf = e.clientX - rect.left < rect.width / 2;
    const role: Role = leftHalf ? 'joystick' : 'look';
    // Un seul doigt par rôle ; les doigts supplémentaires sont ignorés.
    for (const p of this.pointers.values()) if (p.role === role) return;

    e.preventDefault();
    try { this.element.setPointerCapture(e.pointerId); } catch { /* pointeur déjà relâché */ }
    this.pointers.set(e.pointerId, {
      role, startX: e.clientX, startY: e.clientY, lastX: e.clientX, lastY: e.clientY,
      startTime: performance.now(), maxDist: 0,
    });

    if (role === 'joystick') {
      const r = this.joystickRadius();
      // Le centre reste entièrement à l'écran même si le doigt se pose près d'un bord.
      const cx = Math.min(Math.max(e.clientX - rect.left, r), rect.width - r);
      const cy = Math.min(Math.max(e.clientY - rect.top, r), rect.height - r);
      const p = this.pointers.get(e.pointerId)!;
      p.startX = cx + rect.left;
      p.startY = cy + rect.top;
      this.joyBase.style.left = `${cx}px`;
      this.joyBase.style.top = `${cy}px`;
      this.joyBase.classList.add('is-active');
      this.updateJoystick(p, e.clientX, e.clientY);
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    p.maxDist = Math.max(p.maxDist, Math.hypot(e.clientX - p.startX, e.clientY - p.startY));
    if (p.role === 'joystick') {
      this.updateJoystick(p, e.clientX, e.clientY);
    } else {
      const d = dragToLook(e.clientX - p.lastX, e.clientY - p.lastY, this.touchLookSensitivity);
      this.state.look.yaw += d.yaw;
      this.state.look.pitch += d.pitch;
    }
    p.lastX = e.clientX;
    p.lastY = e.clientY;
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.endPointer(e.pointerId, true, e.clientX, e.clientY);
  };

  private onPointerCancel = (e: PointerEvent): void => {
    this.endPointer(e.pointerId, false);
  };

  private endPointer(id: number, allowTap: boolean, x = 0, y = 0): void {
    const p = this.pointers.get(id);
    if (!p) return;
    this.pointers.delete(id);
    if (p.role === 'joystick') {
      this.joystickMove = { x: 0, z: 0 };
      this.joyBase.classList.remove('is-active');
      this.joyBase.style.left = '';
      this.joyBase.style.top = '';
      this.joyKnob.style.transform = 'translate(-50%, -50%)';
      this.refresh();
    } else if (allowTap && isTap(performance.now() - p.startTime, p.maxDist)) {
      this.onTap?.(x, y);
    }
  }

  private updateJoystick(p: TrackedPointer, x: number, y: number): void {
    const out = computeJoystick(x - p.startX, y - p.startY, this.joystickRadius(), this.opts.deadZone ?? 0.15);
    this.joystickMove = { x: out.x, z: out.z };
    this.joyKnob.style.transform = `translate(calc(-50% + ${out.knobX}px), calc(-50% + ${out.knobY}px))`;
    this.refresh();
  }

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
