import * as THREE from 'three';
import type { RaycastHit } from '../core/types';

/** Contour fin autour du bloc visé (un seul objet, réutilisé à chaque frame). */
export class BlockHighlight {
  readonly object: THREE.LineSegments;

  constructor(scene: THREE.Object3D) {
    const box = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    const geometry = new THREE.EdgesGeometry(box);
    box.dispose();
    const material = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, fog: false });
    this.object = new THREE.LineSegments(geometry, material);
    this.object.name = 'highlight';
    this.object.visible = false;
    this.object.renderOrder = 2;
    scene.add(this.object);
  }

  update(hit: RaycastHit | null): void {
    if (!hit) {
      this.object.visible = false;
      return;
    }
    this.object.visible = true;
    this.object.position.set(hit.block[0] + 0.5, hit.block[1] + 0.5, hit.block[2] + 0.5);
  }
}
