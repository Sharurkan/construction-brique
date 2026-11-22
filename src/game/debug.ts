import type * as THREE from 'three';
import type { WorldRendererStats } from '../engine';

/** Affichage fps / triangles / appels de dessin, activé par `?debug` dans l'URL. */
export class DebugOverlay {
  private readonly el: HTMLPreElement;
  private frames = 0;
  private last = performance.now();

  constructor(
    parent: HTMLElement,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly stats: WorldRendererStats,
    private readonly extra: () => string = () => '',
  ) {
    this.el = document.createElement('pre');
    this.el.className = 'cb-debug';
    parent.appendChild(this.el);
  }

  /** À appeler après renderer.render() (renderer.info est remis à zéro à chaque rendu). */
  frame(): void {
    this.frames++;
    const now = performance.now();
    if (now - this.last < 500) return;
    const fps = (this.frames * 1000) / (now - this.last);
    this.frames = 0;
    this.last = now;
    const r = this.renderer.info.render;
    const s = this.stats;
    this.el.textContent =
      `fps        ${fps.toFixed(0)}\n` +
      `triangles  ${r.triangles} / ${s.triangles}\n` +
      `draw calls ${r.calls} (meshes ${s.meshes} · gemmes ${s.gemMeshes} · eau ${s.waterMeshes})\n` +
      `chunk      ${s.avgChunkMs.toFixed(2)} ms · attente ${s.pending}\n` +
      `pixelRatio ${this.renderer.getPixelRatio().toFixed(2)}` +
      this.extra();
  }
}
