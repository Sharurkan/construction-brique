/**
 * Soleil variante 3 (démo seulement) : disque plat lisse face au joueur + halo doux transparent.
 * Géométrie procédurale (cercle + anneau avec alpha par sommet), 1 draw call, aucune image.
 */
import * as THREE from 'three';
import { sunPosition } from '../../src/game/sky/paths';

export function createSoftSun(): THREE.Mesh {
  const SEG = 48;
  const R = 20; // disque
  const H = 34; // bord extérieur du halo
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const core = new THREE.Color(0xffd84a);
  const halo = new THREE.Color(0xfff0a0);
  // Centre + cercle du disque (opaque) + anneau du halo (alpha → 0).
  pos.push(0, 0, 0);
  col.push(core.r, core.g, core.b, 1);
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    pos.push(Math.cos(a) * R, Math.sin(a) * R, 0);
    col.push(core.r, core.g, core.b, 1);
  }
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    pos.push(Math.cos(a) * R, Math.sin(a) * R, -0.5);
    col.push(halo.r, halo.g, halo.b, 0.55);
    pos.push(Math.cos(a) * H, Math.sin(a) * H, -0.5);
    col.push(halo.r, halo.g, halo.b, 0);
  }
  for (let i = 0; i < SEG; i++) {
    const j = (i + 1) % SEG;
    idx.push(0, 1 + i, 1 + j);
    const a = 1 + SEG + i * 2;
    const b = 1 + SEG + j * 2;
    idx.push(a, a + 1, b + 1, a, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  const m = new THREE.Mesh(
    g,
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false }),
  );
  sunPosition(m.position);
  m.lookAt(0, 0, 0);
  m.renderOrder = 1;
  return m;
}
