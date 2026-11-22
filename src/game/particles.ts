import * as THREE from 'three';

const POOL = 48;
const PER_BURST = 10;
const LIFE = 0.3; // secondes
const SIZE = 0.16;
const GRAVITY = 14;

/**
 * Petits cubes colorés qui jaillissent quand on casse un bloc.
 * Un seul InstancedMesh (1 appel de dessin), tout est préalloué : aucune allocation par frame.
 */
export class BreakParticles {
  readonly mesh: THREE.InstancedMesh;
  private readonly pos = new Float32Array(POOL * 3);
  private readonly vel = new Float32Array(POOL * 3);
  private readonly age = new Float32Array(POOL).fill(LIFE);
  private next = 0;
  private alive = 0;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(scene: THREE.Object3D) {
    const geometry = new THREE.BoxGeometry(SIZE, SIZE, SIZE);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(geometry, material, POOL);
    this.mesh.name = 'particles';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < POOL; i++) {
      this.mesh.setMatrixAt(i, this.zero);
      this.mesh.setColorAt(i, this.c.set(0xffffff));
    }
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** Gerbe de cubes au centre du bloc (x, y, z), couleur `color` (hex). */
  burst(x: number, y: number, z: number, color: number): void {
    for (let k = 0; k < PER_BURST; k++) {
      const i = this.next;
      this.next = (this.next + 1) % POOL;
      const j = i * 3;
      this.pos[j] = x + 0.5 + (Math.random() - 0.5) * 0.6;
      this.pos[j + 1] = y + 0.5 + (Math.random() - 0.5) * 0.6;
      this.pos[j + 2] = z + 0.5 + (Math.random() - 0.5) * 0.6;
      this.vel[j] = (Math.random() - 0.5) * 4;
      this.vel[j + 1] = 2 + Math.random() * 3;
      this.vel[j + 2] = (Math.random() - 0.5) * 4;
      if (this.age[i] >= LIFE) this.alive++;
      this.age[i] = 0;
      // Légère variation de teinte pour un rendu plus vivant.
      this.c.setHex(color).multiplyScalar(0.8 + Math.random() * 0.35);
      this.mesh.setColorAt(i, this.c);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.visible = true;
  }

  update(dt: number): void {
    if (this.alive === 0) return;
    let alive = 0;
    for (let i = 0; i < POOL; i++) {
      if (this.age[i] >= LIFE) continue;
      this.age[i] += dt;
      if (this.age[i] >= LIFE) {
        this.mesh.setMatrixAt(i, this.zero);
        continue;
      }
      alive++;
      const j = i * 3;
      this.vel[j + 1] -= GRAVITY * dt;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      const k = 1 - this.age[i] / LIFE;
      this.s.set(k, k, k);
      this.p.set(this.pos[j], this.pos[j + 1], this.pos[j + 2]);
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
    }
    this.alive = alive;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (alive === 0) this.mesh.visible = false;
  }
}
