/**
 * État « appuyé » d'un bouton, sans DOM (testé dans press.test.ts).
 * Un seul pointeur à la fois ; `forceRelease()` débloque le bouton quand le relâchement
 * n'arrivera jamais (page passée en arrière-plan, perte de focus…).
 */
export class PressState {
  private pointer: number | null = null;

  constructor(
    private readonly onDown: () => void,
    private readonly onUp: () => void,
    private readonly isDisabled: () => boolean = () => false,
  ) {}

  get pressed(): boolean {
    return this.pointer !== null;
  }

  get pointerId(): number | null {
    return this.pointer;
  }

  /** Appui. Renvoie false si ignoré (déjà appuyé par un autre doigt, ou désactivé). */
  down(pointerId: number): boolean {
    if (this.pointer !== null || this.isDisabled()) return false;
    this.pointer = pointerId;
    this.onDown();
    return true;
  }

  /** Relâchement du pointeur qui a appuyé (les autres sont ignorés). */
  up(pointerId: number): boolean {
    if (this.pointer === null || pointerId !== this.pointer) return false;
    this.pointer = null;
    this.onUp();
    return true;
  }

  /** Relâche quel que soit le pointeur. Renvoie true si le bouton était appuyé. */
  forceRelease(): boolean {
    if (this.pointer === null) return false;
    this.pointer = null;
    this.onUp();
    return true;
  }
}
