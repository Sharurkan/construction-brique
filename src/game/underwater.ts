import * as THREE from 'three';

/** Couleur du voile sous l'eau (brouillard + fond). */
const UNDERWATER_COLOR = 0x2f7fd0;
/** Brouillard sous l'eau : on voit encore autour de soi (pas angoissant), le lointain se fond. */
const UNDERWATER_FOG_NEAR = 2;
const UNDERWATER_FOG_FAR = 26;

/**
 * Léger voile bleu quand la tête est sous l'eau : couleur et distance du brouillard, couleur du
 * fond. Aucun objet, aucune passe en plus (coût nul). Les réglages d'origine sont mémorisés à
 * l'entrée dans l'eau et restaurés à la sortie ; tant que la tête est sous l'eau, le voile est
 * réappliqué à chaque frame (si un autre module modifie le ciel ou le brouillard entre-temps,
 * il reprend la main dès la sortie de l'eau).
 */
export class UnderwaterTint {
  private active = false;
  private saved: { fogColor: THREE.Color; near: number; far: number; background: THREE.Scene['background'] } | null = null;
  private readonly color = new THREE.Color(UNDERWATER_COLOR);

  constructor(private readonly scene: THREE.Scene) {}

  get isActive(): boolean {
    return this.active;
  }

  update(headInWater: boolean): void {
    const fog = this.scene.fog;
    if (!(fog instanceof THREE.Fog)) return;
    if (headInWater) {
      if (!this.active) {
        this.saved = { fogColor: fog.color.clone(), near: fog.near, far: fog.far, background: this.scene.background };
        this.active = true;
      }
      fog.color.copy(this.color);
      fog.near = UNDERWATER_FOG_NEAR;
      fog.far = UNDERWATER_FOG_FAR;
      this.scene.background = this.color;
    } else if (this.active) {
      const s = this.saved!;
      fog.color.copy(s.fogColor);
      fog.near = s.near;
      fog.far = s.far;
      this.scene.background = s.background;
      this.active = false;
      this.saved = null;
    }
  }
}
