/**
 * Réglage automatique du pixel ratio (perf tablette d'entrée de gamme).
 *
 * - temps moyen d'image > `slowMs` sur `slowWindowMs` → baisse d'un palier (jusqu'à `min`) ;
 * - temps moyen < `fastMs` sur `fastWindowMs` → remonte d'un palier (jusqu'à `max`), prudemment :
 *   si une remontée est suivie d'une baisse, la fenêtre de remontée suivante double (max ×8),
 *   ce qui évite d'osciller entre deux paliers.
 * - les images anormalement longues (onglet en arrière-plan, à-coup) sont ignorées.
 *
 * Logique pure (sans DOM ni Three.js) : on lui donne la durée de chaque image, elle renvoie
 * la nouvelle valeur quand il faut changer.
 */
export interface PixelRatioAdjusterOptions {
  /** Valeur de départ. */
  initial: number;
  /** Plancher. Défaut 0.75. */
  min?: number;
  /** Plafond des remontées. Défaut = `initial`. */
  max?: number;
  /** Palier. Défaut 0.25. */
  step?: number;
  /** Seuil « trop lent » (ms). Défaut 33. */
  slowMs?: number;
  slowWindowMs?: number;
  /** Seuil « confortable » (ms). Défaut 20. */
  fastMs?: number;
  fastWindowMs?: number;
  /** Images plus longues ignorées (ms). Défaut 250. */
  ignoreAboveMs?: number;
}

export const DEFAULT_MIN_PIXEL_RATIO = 0.75;

class Window {
  sum = 0;
  count = 0;
  reset(): void {
    this.sum = 0;
    this.count = 0;
  }
  get avg(): number {
    return this.count > 0 ? this.sum / this.count : 0;
  }
}

export class PixelRatioAdjuster {
  private current: number;
  readonly min: number;
  readonly max: number;
  private readonly step: number;
  private readonly slowMs: number;
  private readonly slowWindowMs: number;
  private readonly fastMs: number;
  private readonly fastWindowMs: number;
  private readonly ignoreAboveMs: number;
  private readonly slow = new Window();
  private readonly fast = new Window();
  /** Multiplicateur de la fenêtre de remontée (recul après une remontée ratée). */
  private backoff = 1;
  private lastChangeWasRaise = false;

  constructor(opts: PixelRatioAdjusterOptions) {
    this.min = opts.min ?? DEFAULT_MIN_PIXEL_RATIO;
    this.max = Math.max(this.min, opts.max ?? opts.initial);
    this.current = clamp(opts.initial, this.min, this.max);
    this.step = opts.step ?? 0.25;
    this.slowMs = opts.slowMs ?? 33;
    this.slowWindowMs = opts.slowWindowMs ?? 2000;
    this.fastMs = opts.fastMs ?? 20;
    this.fastWindowMs = opts.fastWindowMs ?? 5000;
    this.ignoreAboveMs = opts.ignoreAboveMs ?? 250;
  }

  get value(): number {
    return this.current;
  }

  /** Durée d'une image (ms). Renvoie la nouvelle valeur si elle change, sinon `null`. */
  sample(frameMs: number): number | null {
    if (!(frameMs > 0) || frameMs > this.ignoreAboveMs) return null;
    this.slow.sum += frameMs;
    this.slow.count++;
    this.fast.sum += frameMs;
    this.fast.count++;

    if (this.slow.sum >= this.slowWindowMs) {
      const avg = this.slow.avg;
      this.slow.reset();
      if (avg > this.slowMs && this.current > this.min) {
        if (this.lastChangeWasRaise) this.backoff = Math.min(this.backoff * 2, 8);
        return this.change(Math.max(this.min, this.current - this.step), false);
      }
    }
    if (this.fast.sum >= this.fastWindowMs * this.backoff) {
      const avg = this.fast.avg;
      this.fast.reset();
      if (avg < this.fastMs && this.current < this.max) {
        return this.change(Math.min(this.max, this.current + this.step), true);
      }
    }
    return null;
  }

  private change(v: number, raise: boolean): number {
    this.current = Math.round(v * 1000) / 1000;
    this.lastChangeWasRaise = raise;
    this.slow.reset();
    this.fast.reset();
    return this.current;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
