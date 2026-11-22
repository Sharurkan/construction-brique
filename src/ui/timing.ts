/** Logique temporelle pure de l'interface, avec horloge injectable (testée dans timing.test.ts). */

export type Clock = () => number;

const defaultClock: Clock = () => performance.now();

/**
 * Appui long : `start()` au contact, `cancel()` au relâchement, `poll()` à chaque frame.
 * `poll()` renvoie true UNE seule fois quand la durée est atteinte.
 */
export class LongPress {
  private startedAt: number | null = null;
  private fired = false;

  constructor(readonly durationMs = 2000, private readonly now: Clock = defaultClock) {}

  start(): void {
    this.startedAt = this.now();
    this.fired = false;
  }

  /** Relâché avant la fin = annulé (rien ne se déclenche). */
  cancel(): void {
    this.startedAt = null;
    this.fired = false;
  }

  get active(): boolean {
    return this.startedAt !== null && !this.fired;
  }

  /** Avancement dans [0, 1] (0 si inactif). */
  progress(): number {
    if (this.startedAt === null) return 0;
    if (this.fired) return 1;
    return Math.min(1, Math.max(0, (this.now() - this.startedAt) / this.durationMs));
  }

  poll(): boolean {
    if (this.startedAt === null || this.fired) return false;
    if (this.now() - this.startedAt >= this.durationMs) {
      this.fired = true;
      return true;
    }
    return false;
  }
}

/**
 * Répétition tant qu'un bouton est maintenu : une action immédiate à l'appui,
 * puis une toutes les `intervalMs` après un premier délai `initialDelayMs`.
 */
export class HoldRepeater {
  private next: number | null = null;

  constructor(
    readonly intervalMs = 300,
    readonly initialDelayMs = 350,
    private readonly now: Clock = defaultClock,
  ) {}

  /** Appui : renvoie toujours 1 (l'action immédiate). */
  press(): number {
    this.next = this.now() + this.initialDelayMs;
    return 1;
  }

  release(): void {
    this.next = null;
  }

  get held(): boolean {
    return this.next !== null;
  }

  /** Nombre d'actions dues depuis le dernier appel (0, 1, ou plus si la frame a pris du retard, bridé à 3). */
  poll(): number {
    if (this.next === null) return 0;
    const t = this.now();
    let n = 0;
    while (t >= this.next && n < 3) {
      n++;
      this.next += this.intervalMs;
    }
    if (t >= this.next) this.next = t + this.intervalMs; // rattrapage abandonné après une longue pause
    return n;
  }
}
