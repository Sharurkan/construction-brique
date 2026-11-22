/**
 * Ciel du jeu (style « Blocs ») : nuages, soleil, montgolfières, arc-en-ciel, oiseaux, dragon.
 * Purement décoratif : rien d'interactif, aucun raycast, aucune collision.
 *
 * RENDU EN 2 PASSES (appelées par game.ts) :
 *   1. `render()` : scène ciel (fond couleur ciel + éléments), caméra ciel À L'ORIGINE qui copie
 *      l'orientation de la caméra du joueur → le ciel suit le joueur en position, n'est jamais
 *      coupé par le camera.far (120) du jeu ni touché par son brouillard (32–90) ;
 *   2. effacement de la profondeur ; le jeu rend ensuite le monde par-dessus (sans fond).
 * Coût : 1 draw call (un InstancedMesh, un matériau, 2 tuiles Kenney du jeu).
 */
import * as THREE from 'three';
import {
  BALLOONS,
  BIRD_GROUPS,
  BIRD_SPACING,
  CLOUDS,
  RAINBOW_AZIMUTH,
  R_RAINBOW,
  balloonState,
  birdFlap,
  birdState,
  cloudState,
  dragonFlap,
  dragonState,
  onCircle,
  sunPosition,
  sunRaysAngle,
} from './paths';
import {
  BlockBatch,
  SKY_COLOR,
  addBlockBalloon,
  addBlockBird,
  addBlockCloud,
  addBlockDragon,
  addBlockRainbow,
  addBlockSunDisc,
  addBlockSunRays,
  createSkyMaterial,
  createSkyTileTexture,
  shadedBox,
} from './blocks';

/**
 * Variante du soleil : 1 = disque « pixel » en blocs + halo doux (choisi par l'utilisateur),
 * 2 = même disque + rayons en blocs qui tournent lentement.
 */
export type SunVariant = 1 | 2;
export const DEFAULT_SUN_VARIANT: SunVariant = 1;

const CLOUD_CELL = 7;
const BALLOON_CELL = 1.6;
const BIRD_SCALE = 1.5;
const DRAGON_SCALE = 2.4;

export interface SkyOptions {
  sun?: SunVariant | 0; // 0 = pas de soleil en blocs (la démo en essaie un autre)
}

export class BlockSky {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly batch = new BlockBatch();
  /** Draw calls de la dernière passe ciel (pour ?debug). */
  lastCalls = 0;

  private readonly mesh: THREE.InstancedMesh;
  private readonly texture: THREE.Texture;
  private readonly material: THREE.Material;
  private readonly clouds: number[] = [];
  private readonly balloons: number[] = [];
  private readonly birds: { g: number; i: number; el: number; phase: number }[] = [];
  private readonly dragon: number;
  private readonly sun: number = -1;
  private readonly rays: number = -1;
  private readonly sunMatrix = new THREE.Matrix4();
  private time = 0;

  private static readonly p = new THREE.Vector3();
  private static readonly d = new THREE.Vector3();
  private static readonly q = new THREE.Quaternion();
  private static readonly one = new THREE.Vector3(1, 1, 1);
  private static readonly Y = new THREE.Vector3(0, 1, 0);
  private static readonly Z = new THREE.Vector3(0, 0, 1);
  private static readonly rot = new THREE.Matrix4();

  /** `wool` et `planks` : tuiles finales de l'atlas du jeu (loadBlockTextures().tiles). */
  constructor(wool: HTMLCanvasElement, planks: HTMLCanvasElement, opts: SkyOptions = {}) {
    this.scene.background = new THREE.Color(SKY_COLOR);
    this.camera = new THREE.PerspectiveCamera(70, 1, 1, 1000);
    const b = this.batch;

    CLOUDS.forEach((c) => {
      const el = b.addElement();
      addBlockCloud(b, el, c.v, CLOUD_CELL * c.scale);
      this.clouds.push(el);
    });
    BALLOONS.forEach((bl) => {
      const el = b.addElement();
      addBlockBalloon(b, el, bl.colors[0], bl.colors[1], BALLOON_CELL);
      this.balloons.push(el);
    });
    const rainbow = b.addElement();
    addBlockRainbow(b, rainbow);
    BIRD_GROUPS.forEach((g, gi) => {
      for (let i = 0; i < g.count; i++) {
        const el = b.addElement();
        addBlockBird(b, el, g.color, BIRD_SCALE);
        this.birds.push({ g: gi, i, el, phase: gi * 1.7 + i * 0.9 });
      }
    });
    this.dragon = b.addElement();
    addBlockDragon(b, this.dragon, DRAGON_SCALE);

    const sunVariant = opts.sun ?? DEFAULT_SUN_VARIANT;
    if (sunVariant) {
      this.sun = b.addElement();
      addBlockSunDisc(b, this.sun);
      if (sunVariant === 2) {
        this.rays = b.addElement();
        addBlockSunRays(b, this.rays);
      }
    }

    this.texture = createSkyTileTexture(wool, planks);
    this.material = createSkyMaterial(this.texture);
    this.mesh = b.build(shadedBox(), this.material);
    this.scene.add(this.mesh);

    // Éléments fixes : arc-en-ciel face au joueur, soleil face au joueur (plan XY local, +Z vers l'origine).
    const { p, q, one, Y } = BlockSky;
    onCircle(p, RAINBOW_AZIMUTH, R_RAINBOW, 0);
    q.setFromAxisAngle(Y, RAINBOW_AZIMUTH - Math.PI / 2);
    b.elements[rainbow].compose(p, q, one);
    sunPosition(p);
    this.sunMatrix.lookAt(new THREE.Vector3(0, 0, 0), p, Y).setPosition(p);
    if (this.sun >= 0) b.elements[this.sun].copy(this.sunMatrix);
    this.update(0);
  }

  /** Avance l'animation de dt secondes (aucune allocation). */
  update(dt: number): void {
    const t = (this.time += dt);
    const b = this.batch;
    const { p, d, q, one, Y, Z, rot } = BlockSky;
    for (let k = 0; k < this.clouds.length; k++) {
      q.setFromAxisAngle(Y, cloudState(k, t, p));
      b.elements[this.clouds[k]].compose(p, q, one);
    }
    for (let k = 0; k < this.balloons.length; k++) {
      q.setFromAxisAngle(Y, balloonState(k, t, p));
      b.elements[this.balloons[k]].compose(p, q, one);
    }
    for (let k = 0; k < this.birds.length; k++) {
      const bd = this.birds[k];
      q.setFromAxisAngle(Y, birdState(BIRD_GROUPS[bd.g], bd.i, t, BIRD_SPACING, p, d));
      b.elements[bd.el].compose(p, q, one);
      b.flap[bd.el] = birdFlap(t, bd.phase);
    }
    q.setFromAxisAngle(Y, dragonState(t, p, d));
    b.elements[this.dragon].compose(p, q, one);
    b.flap[this.dragon] = dragonFlap(t);
    if (this.rays >= 0) b.elements[this.rays].multiplyMatrices(this.sunMatrix, rot.makeRotationAxis(Z, sunRaysAngle(t)));
    b.update();
  }

  /**
   * Passe 1 : dessine le ciel (efface couleur + profondeur grâce au fond), puis efface la
   * profondeur pour que le monde se dessine par-dessus. `renderer.autoClear` doit être false.
   */
  render(renderer: THREE.WebGLRenderer, view: THREE.PerspectiveCamera): void {
    const cam = this.camera;
    if (cam.fov !== view.fov || cam.aspect !== view.aspect) {
      cam.fov = view.fov;
      cam.aspect = view.aspect;
      cam.updateProjectionMatrix();
    }
    view.updateMatrixWorld();
    cam.quaternion.copy(view.getWorldQuaternion(BlockSky.q));
    cam.updateMatrixWorld();
    renderer.render(this.scene, cam);
    this.lastCalls = renderer.info.render.calls;
    renderer.clearDepth();
  }

  get triangles(): number {
    return this.batch.triangles;
  }

  get cubes(): number {
    return this.batch.count;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}

/**
 * Crée le ciel du jeu à partir des tuiles de l'atlas ; null si les tuiles sont indisponibles
 * (atlas provisoire) ou en cas d'erreur : le jeu garde alors son ciel uni, rien ne casse.
 */
export function createGameSky(tiles: ReadonlyMap<string, HTMLCanvasElement> | null): BlockSky | null {
  const wool = tiles?.get('wool_white');
  const planks = tiles?.get('planks');
  if (!wool || !planks) return null;
  try {
    return new BlockSky(wool, planks);
  } catch (err) {
    console.warn('[ciel] désactivé', err);
    return null;
  }
}
