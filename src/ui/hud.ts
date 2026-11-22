import './styles.css';
import { BlockId, type GameActions } from '../core/types';
import { NO_LOOK_ATTR } from '../controls/input';
import { createIcon, onIconsChanged, refreshIcons, renderIconInto, type IconName } from './icons';
import { PressState } from './press';
import { HoldRepeater, LongPress, type Clock } from './timing';

/**
 * État de vol à afficher après un appui sur le bouton vol.
 * - `toggleFly` a renvoyé un booléen : c'est l'état réel ;
 * - sinon, si l'action a déjà mis le HUD à jour (`setFlying` appelé pendant l'action) : on le garde ;
 * - sinon : basculement local.
 */
export function nextFlyingState(result: unknown, before: boolean, after: boolean): boolean {
  if (typeof result === 'boolean') return result;
  if (after !== before) return after;
  return !before;
}

/** Noms français des blocs (aria-label uniquement : aucun texte visible). */
export const BLOCK_LABELS_FR: Readonly<Record<BlockId, string>> = {
  [BlockId.Air]: 'Air',
  [BlockId.Grass]: 'Herbe',
  [BlockId.Dirt]: 'Terre',
  [BlockId.Stone]: 'Pierre',
  [BlockId.Cobblestone]: 'Pavés',
  [BlockId.Log]: 'Tronc',
  [BlockId.Planks]: 'Planches',
  [BlockId.Leaves]: 'Feuilles',
  [BlockId.Brick]: 'Briques',
  [BlockId.Glass]: 'Verre',
  [BlockId.Sand]: 'Sable',
  [BlockId.Diamond]: 'Bloc de diamant',
  [BlockId.Gold]: "Bloc d'or",
  [BlockId.WoolWhite]: 'Laine blanche',
  [BlockId.WoolRed]: 'Laine rouge',
  [BlockId.WoolOrange]: 'Laine orange',
  [BlockId.WoolYellow]: 'Laine jaune',
  [BlockId.WoolGreen]: 'Laine verte',
  [BlockId.WoolBlue]: 'Laine bleue',
  [BlockId.WoolPurple]: 'Laine violette',
  [BlockId.WoolPink]: 'Laine rose',
  [BlockId.WoolBlack]: 'Laine noire',
  [BlockId.Bedrock]: 'Socle',
  [BlockId.DiamondOre]: 'Minerai de diamant',
  [BlockId.GoldOre]: "Minerai d'or",
  [BlockId.EmeraldOre]: "Minerai d'émeraude",
  [BlockId.RubyOre]: 'Minerai de rubis',
  [BlockId.CoalOre]: 'Minerai de charbon',
  [BlockId.IronOre]: 'Minerai de fer',
  [BlockId.SilverOre]: "Minerai d'argent",
  [BlockId.EmeraldBlock]: "Bloc d'émeraude",
  [BlockId.Water]: 'Eau',
};

export interface HudOptions {
  /** Vibration courte à l'appui (si supportée). Défaut true. */
  vibrate?: boolean;
  /** Bouton SAUTER enfoncé / relâché : brancher sur `InputManager.setButton('jump', down)`. */
  onJumpChange?: (down: boolean) => void;
  /** Bouton DESCENDRE (visible en mode vol) : `InputManager.setButton('descend', down)`. */
  onDescendChange?: (down: boolean) => void;
  /** Bouton crédits. Absent = bouton visible mais désactivé (emplacement réservé). */
  onCredits?: () => void;
  /** Bouton son. Absent = bouton visible mais désactivé (emplacement réservé). */
  onSoundToggle?: (enabled: boolean) => void;
  /** État initial du bouton son (préférence mémorisée). Défaut true. Ne déclenche pas `onSoundToggle`. */
  initialSoundOn?: boolean;
  /** Appelé à chaque appui sur un bouton (sons de clic en Phase 2). */
  onButtonPress?: () => void;
  /** Durée de l'appui long « nouveau monde ». Défaut 2000 ms. */
  longPressMs?: number;
  /** Intervalle de répétition de CASSER/POSER maintenus. Défaut 300 ms. */
  repeatMs?: number;
  /** Bloc sélectionné au départ (défaut : premier de la palette). Ne déclenche pas `selectBlock`. */
  initialSelected?: BlockId;
  /** Horloge injectable (tests). */
  clock?: Clock;
}

const RING_R = 44;
const RING_C = 2 * Math.PI * RING_R;

function hex(color: number): string {
  return `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
}

/**
 * Interface superposée en DOM : boutons d'action, palette, réticule, nouveau monde (appui long),
 * plein écran, emplacements crédits/son, overlay « tourne la tablette ». Aucun texte visible.
 */
export class Hud {
  readonly element: HTMLDivElement;
  private selectedId: BlockId;
  private readonly slots = new Map<BlockId, HTMLButtonElement>();
  private readonly placeSwatch: HTMLSpanElement;
  private readonly descendBtn: HTMLButtonElement;
  private readonly flyBtn: HTMLButtonElement | null = null;
  private readonly newBtn: HTMLButtonElement;
  private readonly ringFill: SVGCircleElement;
  private readonly fsBtn: HTMLButtonElement;
  private readonly longPress: LongPress;
  private readonly repeaters: Array<{ r: HoldRepeater; fn: () => void }> = [];
  private readonly presses: Array<{ state: PressState; btn: HTMLElement }> = [];
  /** Overlay « tourne la tablette », attaché à `document.body` (au-dessus de tout). */
  private readonly rotateOverlay: HTMLDivElement;
  private readonly cleanups: Array<() => void> = [];
  private readonly icons = new Map<BlockId, string>();
  private raf = 0;
  private soundOn = true;
  private flying = false;

  constructor(
    root: HTMLElement,
    private readonly actions: GameActions,
    private readonly palette: BlockId[],
    private readonly getBlockColor: (id: BlockId) => number,
    private readonly opts: HudOptions = {},
  ) {
    const clock = opts.clock;
    this.longPress = new LongPress(opts.longPressMs ?? 2000, clock);
    this.selectedId = opts.initialSelected ?? palette[0] ?? BlockId.Grass;

    const el = document.createElement('div');
    el.className = 'cb-hud';
    el.setAttribute(NO_LOOK_ATTR, '');
    this.element = el;

    // Réticule
    const reticle = document.createElement('div');
    reticle.className = 'cb-reticle';
    reticle.setAttribute('aria-hidden', 'true');
    el.appendChild(reticle);

    // ----- Grappe d'actions (pouce droit) -----
    const cluster = document.createElement('div');
    cluster.className = 'cb-actions';
    const breakBtn = this.button('break', 'cb-btn-break', 'Casser');
    const placeBtn = this.button('place', 'cb-btn-place', 'Poser');
    const jumpBtn = this.button('jump', 'cb-btn-jump', 'Sauter');
    this.descendBtn = this.button('descend', 'cb-btn-descend', 'Descendre');
    this.descendBtn.hidden = true;
    this.placeSwatch = document.createElement('span');
    this.placeSwatch.className = 'cb-place-swatch';
    this.placeSwatch.setAttribute('aria-hidden', 'true');
    placeBtn.appendChild(this.placeSwatch);
    cluster.append(this.descendBtn, breakBtn, placeBtn, jumpBtn);
    el.appendChild(cluster);

    this.bindRepeat(breakBtn, () => this.actions.breakBlock());
    this.bindRepeat(placeBtn, () => this.actions.placeBlock());
    this.bindHold(jumpBtn, (down) => this.opts.onJumpChange?.(down));
    this.bindHold(this.descendBtn, (down) => this.opts.onDescendChange?.(down));

    // ----- Palette -----
    const pal = document.createElement('div');
    pal.className = 'cb-palette';
    pal.setAttribute('role', 'radiogroup');
    pal.setAttribute('aria-label', 'Choix du bloc');
    pal.setAttribute(NO_LOOK_ATTR, '');
    for (const id of palette) {
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'cb-slot';
      slot.setAttribute('role', 'radio');
      slot.setAttribute('aria-label', BLOCK_LABELS_FR[id] ?? `Bloc ${id}`);
      slot.setAttribute(NO_LOOK_ATTR, '');
      const sw = document.createElement('span');
      sw.className = 'cb-swatch';
      sw.style.backgroundColor = hex(getBlockColor(id));
      slot.appendChild(sw);
      this.on(slot, 'click', () => { this.pressFeedback(); this.select(id); });
      this.on(slot, 'pointerdown', () => slot.classList.add('is-pressed'));
      for (const t of ['pointerup', 'pointercancel', 'pointerleave']) this.on(slot, t, () => slot.classList.remove('is-pressed'));
      this.slots.set(id, slot);
      pal.appendChild(slot);
    }
    el.appendChild(pal);

    // ----- Haut droit : nouveau monde, plein écran, son, crédits -----
    const topRight = document.createElement('div');
    topRight.className = 'cb-top-right';
    this.newBtn = this.button('newWorld', 'cb-btn-new', 'Nouveau monde (appui long)');
    const ns = 'http://www.w3.org/2000/svg';
    const ring = document.createElementNS(ns, 'svg');
    ring.setAttribute('class', 'cb-ring');
    ring.setAttribute('viewBox', '0 0 100 100');
    ring.setAttribute('aria-hidden', 'true');
    const track = document.createElementNS(ns, 'circle');
    const fill = document.createElementNS(ns, 'circle');
    for (const c of [track, fill]) {
      c.setAttribute('cx', '50');
      c.setAttribute('cy', '50');
      c.setAttribute('r', String(RING_R));
    }
    track.setAttribute('class', 'cb-ring-track');
    fill.setAttribute('class', 'cb-ring-fill');
    fill.setAttribute('stroke-dasharray', String(RING_C));
    fill.setAttribute('stroke-dashoffset', String(RING_C));
    ring.append(track, fill);
    this.ringFill = fill;
    this.newBtn.appendChild(ring);
    this.bindLongPress(this.newBtn);

    this.fsBtn = this.button(this.isFullscreen() ? 'fullscreenExit' : 'fullscreen', 'cb-btn-fullscreen', 'Plein écran');
    this.on(this.fsBtn, 'click', () => this.toggleFullscreen());
    this.bindPressVisual(this.fsBtn);
    this.on(document, 'fullscreenchange', () => {
      const icon = this.fsBtn.querySelector<HTMLElement>('.cb-icon');
      if (icon) renderIconInto(icon, this.isFullscreen() ? 'fullscreenExit' : 'fullscreen');
    });

    this.soundOn = opts.initialSoundOn ?? true;
    const soundBtn = this.button(this.soundOn ? 'soundOn' : 'soundOff', 'cb-btn-sound', 'Son');
    if (opts.onSoundToggle) {
      soundBtn.setAttribute('aria-pressed', String(this.soundOn));
      this.on(soundBtn, 'click', () => {
        this.soundOn = !this.soundOn;
        soundBtn.setAttribute('aria-pressed', String(this.soundOn));
        const icon = soundBtn.querySelector<HTMLElement>('.cb-icon');
        if (icon) renderIconInto(icon, this.soundOn ? 'soundOn' : 'soundOff');
        this.opts.onSoundToggle?.(this.soundOn);
      });
    } else {
      soundBtn.setAttribute('aria-disabled', 'true'); // emplacement réservé (Phase 2)
    }
    this.bindPressVisual(soundBtn);

    const creditsBtn = this.button('credits', 'cb-btn-credits', 'Crédits');
    if (opts.onCredits) this.on(creditsBtn, 'click', () => this.opts.onCredits?.());
    else creditsBtn.setAttribute('aria-disabled', 'true'); // emplacement réservé (Phase 2)
    this.bindPressVisual(creditsBtn);

    topRight.append(this.newBtn, this.fsBtn, soundBtn, creditsBtn);
    el.appendChild(topRight);

    // ----- Haut gauche : vol (si le jeu le propose) -----
    if (actions.toggleFly) {
      const topLeft = document.createElement('div');
      topLeft.className = 'cb-top-left';
      const fly = this.button('fly', 'cb-btn-fly', 'Voler');
      fly.setAttribute('aria-pressed', 'false');
      this.on(fly, 'click', () => {
        const before = this.flying;
        // Renvoie l'état réel ; si l'action ne renvoie rien, `nextFlyingState` bascule localement.
        const result = this.actions.toggleFly?.();
        this.setFlying(nextFlyingState(result, before, this.flying));
      });
      this.bindPressVisual(fly);
      topLeft.appendChild(fly);
      el.appendChild(topLeft);
      this.flyBtn = fly;
    }

    // ----- Overlay portrait -----
    // Hors du HUD, directement dans <body> : il doit passer AU-DESSUS de l'écran jouer,
    // des crédits et du debug (z-index 1000), et bloquer tous les gestes en dessous.
    const rotate = document.createElement('div');
    rotate.className = 'cb-rotate';
    rotate.setAttribute('role', 'alert');
    rotate.setAttribute('aria-label', 'Tourne la tablette');
    rotate.setAttribute(NO_LOOK_ATTR, '');
    rotate.appendChild(createIcon('rotate'));
    const swallow = (e: Event): void => {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
    };
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'click', 'touchstart', 'touchmove', 'wheel', 'contextmenu']) {
      this.on(rotate, t, swallow, { passive: false });
    }
    this.rotateOverlay = rotate;

    // Empêche que les gestes sur l'interface atteignent le jeu ou le navigateur.
    this.on(el, 'pointerdown', (e) => e.stopPropagation());
    this.on(el, 'contextmenu', (e) => e.preventDefault());
    this.installGlobalGuards();
    this.cleanups.push(onIconsChanged(() => {
      refreshIcons(this.element);
      refreshIcons(this.rotateOverlay);
    }));

    // Boutons « coincés » : le relâchement n'arrive pas si la page passe en arrière-plan.
    const releaseAll = (): void => this.releaseAllPresses();
    this.on(window, 'blur', releaseAll);
    this.on(window, 'pagehide', releaseAll);
    this.on(window, 'orientationchange', releaseAll);
    this.on(document, 'visibilitychange', () => { if (document.hidden) releaseAll(); });

    root.appendChild(el);
    document.body.appendChild(rotate);
    this.applySelection(false);
  }

  get selected(): BlockId {
    return this.selectedId;
  }

  /** Sélectionne un bloc de la palette et appelle `actions.selectBlock` (sauf `notify = false`). */
  select(id: BlockId, notify = true): void {
    if (!this.slots.has(id)) return;
    this.selectedId = id;
    this.applySelection(true);
    if (notify) this.actions.selectBlock(id);
  }

  /** Touches 1–9. */
  selectIndex(index: number): void {
    const id = this.palette[index];
    if (id !== undefined) this.select(id);
  }

  /** Molette : bloc suivant / précédent (boucle). */
  selectRelative(delta: number): void {
    const n = this.palette.length;
    if (n === 0) return;
    const i = Math.max(0, this.palette.indexOf(this.selectedId));
    this.select(this.palette[(((i + delta) % n) + n) % n]);
  }

  /**
   * Remplace la pastille de couleur d'un bloc par une icône (Phase 2).
   * Accepte une URL d'image ou un canvas (rendu de bloc, extrait d'atlas…).
   */
  setBlockIcon(id: BlockId, src: string | HTMLCanvasElement): void {
    let url: string | null = null;
    if (typeof src === 'string') url = src;
    else {
      try { url = src.toDataURL(); } catch { url = null; }
    }
    const sw = this.slots.get(id)?.querySelector<HTMLElement>('.cb-swatch');
    if (url) {
      this.icons.set(id, url);
      if (sw) { sw.replaceChildren(); sw.style.backgroundImage = `url("${url}")`; }
    } else if (sw && src instanceof HTMLCanvasElement) {
      sw.replaceChildren(src); // canvas « tainted » : on l'insère tel quel
    }
    if (id === this.selectedId) this.updatePlaceSwatch();
  }

  /**
   * Mode vol : affiche le bouton DESCENDRE et met en évidence le bouton vol.
   * Idempotent : reflète l'état donné, peut être appelé plusieurs fois avec la même valeur.
   */
  setFlying(on: boolean): void {
    const was = this.flying;
    this.flying = on;
    this.descendBtn.hidden = !on;
    // Relâche DESCENDRE seulement à la sortie du vol (pas à chaque appel).
    if (was && !on) this.opts.onDescendChange?.(false);
    this.flyBtn?.setAttribute('aria-pressed', String(on));
  }

  /**
   * Relâche tous les boutons appuyés, quel que soit le pointeur : arrête la répétition de
   * CASSER/POSER, annule l'appui long « nouveau monde », relâche SAUTER/DESCENDRE.
   * Appelé automatiquement sur blur, page masquée, pagehide et rotation de l'écran.
   */
  releaseAllPresses(): void {
    for (const { state, btn } of this.presses) {
      const id = state.pointerId;
      if (!state.forceRelease()) continue; // retire is-pressed et appelle up()
      if (id !== null) {
        try { if (btn.hasPointerCapture(id)) btn.releasePointerCapture(id); } catch { /* ignore */ }
      }
    }
    // Filets (idempotents) au cas où un état aurait survécu sans pointeur suivi.
    for (const { r } of this.repeaters) r.release();
    this.longPress.cancel();
    this.newBtn.classList.remove('is-charging');
    this.setRing(0);
    this.opts.onJumpChange?.(false);
    this.opts.onDescendChange?.(false);
  }

  dispose(): void {
    this.releaseAllPresses();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const c of this.cleanups.splice(0)) c();
    this.element.remove();
    this.rotateOverlay.remove();
  }

  // ---------- interne ----------

  private on(target: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, opts);
    this.cleanups.push(() => target.removeEventListener(type, fn, opts));
  }

  private button(icon: IconName, cls: string, label: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `cb-btn ${cls}`;
    b.setAttribute('aria-label', label);
    b.setAttribute(NO_LOOK_ATTR, '');
    b.appendChild(createIcon(icon));
    return b;
  }

  private pressFeedback(): void {
    if (this.opts.vibrate !== false) {
      try { navigator.vibrate?.(15); } catch { /* non supporté */ }
    }
    this.opts.onButtonPress?.();
  }

  /**
   * Gère appui / relâchement d'un bouton via Pointer Events (capture = relâchement normalement
   * reçu). Si le relâchement se perd (page en arrière-plan…), `releaseAllPresses` débloque.
   */
  private bindPress(btn: HTMLElement, down: () => void, up: () => void): void {
    const state = new PressState(
      () => { btn.classList.add('is-pressed'); down(); },
      () => { btn.classList.remove('is-pressed'); up(); },
      () => btn.getAttribute('aria-disabled') === 'true',
    );
    this.presses.push({ state, btn });
    this.on(btn, 'pointerdown', (ev) => {
      const e = ev as PointerEvent;
      e.preventDefault();
      e.stopPropagation();
      if (!state.down(e.pointerId)) return;
      try { btn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    const release = (ev: Event): void => { state.up((ev as PointerEvent).pointerId); };
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) this.on(btn, t, release);
  }

  /** Retour visuel seul (boutons à clic simple). */
  private bindPressVisual(btn: HTMLElement): void {
    this.bindPress(btn, () => { if (btn.getAttribute('aria-disabled') !== 'true') this.pressFeedback(); }, () => {});
  }

  private bindHold(btn: HTMLElement, change: (down: boolean) => void): void {
    this.bindPress(btn, () => { this.pressFeedback(); change(true); }, () => change(false));
  }

  private bindRepeat(btn: HTMLElement, fn: () => void): void {
    const r = new HoldRepeater(this.opts.repeatMs ?? 300, 350, this.opts.clock);
    this.repeaters.push({ r, fn });
    this.bindPress(
      btn,
      () => { this.pressFeedback(); r.press(); fn(); this.ensureLoop(); },
      () => r.release(),
    );
  }

  private bindLongPress(btn: HTMLElement): void {
    this.bindPress(
      btn,
      () => {
        this.pressFeedback();
        btn.classList.remove('is-done');
        btn.classList.add('is-charging');
        this.longPress.start();
        this.ensureLoop();
      },
      () => {
        this.longPress.cancel();
        btn.classList.remove('is-charging');
        this.setRing(0);
      },
    );
  }

  private setRing(progress: number): void {
    this.ringFill.setAttribute('stroke-dashoffset', String(RING_C * (1 - progress)));
  }

  private ensureLoop(): void {
    if (this.raf) return;
    const tick = (): void => {
      this.raf = 0;
      let busy = false;
      for (const { r, fn } of this.repeaters) {
        if (!r.held) continue;
        busy = true;
        for (let n = r.poll(); n > 0; n--) fn();
      }
      if (this.longPress.active) {
        busy = true;
        this.setRing(this.longPress.progress());
        if (this.longPress.poll()) {
          this.setRing(1);
          this.newBtn.classList.remove('is-charging');
          this.newBtn.classList.add('is-done');
          try { navigator.vibrate?.([30, 60, 90]); } catch { /* ignore */ }
          this.actions.newWorld();
        }
      }
      if (busy) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private applySelection(scroll: boolean): void {
    for (const [id, slot] of this.slots) slot.setAttribute('aria-checked', String(id === this.selectedId));
    this.updatePlaceSwatch();
    if (scroll) this.slots.get(this.selectedId)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  private updatePlaceSwatch(): void {
    const icon = this.icons.get(this.selectedId);
    this.placeSwatch.style.backgroundColor = hex(this.getBlockColor(this.selectedId));
    this.placeSwatch.style.backgroundImage = icon ? `url("${icon}")` : '';
  }

  private isFullscreen(): boolean {
    return typeof document !== 'undefined' && !!document.fullscreenElement;
  }

  private toggleFullscreen(): void {
    if (this.isFullscreen()) {
      document.exitFullscreen?.().catch(() => {});
      return;
    }
    const req = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
    req?.then(() => {
      // Verrouillage paysage : supporté sur Android Chrome en plein écran, ignoré ailleurs.
      const o = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      o?.lock?.('landscape').catch(() => {});
    }).catch(() => {});
  }

  /** Anti-zoom, anti-sélection, anti-menu contextuel, anti-pull-to-refresh au niveau document. */
  private installGlobalGuards(): void {
    const prevent = (e: Event): void => { if (e.cancelable) e.preventDefault(); };
    this.on(document, 'contextmenu', prevent);
    this.on(document, 'selectstart', prevent);
    this.on(document, 'dragstart', prevent);
    this.on(document, 'gesturestart', prevent, { passive: false }); // Safari
    this.on(document, 'dblclick', prevent, { passive: false });
    this.on(document, 'touchmove', (e) => { if ((e as TouchEvent).touches.length > 1) prevent(e); }, { passive: false });
    const html = document.documentElement;
    const prev = { touch: html.style.touchAction, over: html.style.overscrollBehavior };
    html.style.touchAction = 'none';
    html.style.overscrollBehavior = 'none';
    document.body.style.overscrollBehavior = 'none';
    this.cleanups.push(() => {
      html.style.touchAction = prev.touch;
      html.style.overscrollBehavior = prev.over;
    });
  }
}
