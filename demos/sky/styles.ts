/**
 * Les 3 styles de ciel comparés par la démo. Mêmes trajectoires pour les 3 (voir common.ts) :
 * seule l'apparence change.
 */
import * as THREE from 'three';
import {
  BALLOONS,
  BIRD_GROUPS,
  CLOUDS,
  RAINBOW_BAND,
  RAINBOW_CENTER_Y,
  RAINBOW_COLORS,
  RAINBOW_OUTER,
  R_SUN,
  SKY_ASSETS,
  birdState,
  loadImage,
  onCircle,
  sunPosition,
  type LegendRow,
  type SkyStyle,
} from './common';
import {
  BlockBatch,
  addBlockBalloon,
  addBlockBird,
  addBlockCloud,
  addBlockRainbow,
  balloonMatrix,
  birdMatrix,
  cloudMatrix,
  rainbowMatrix,
  shadedBox,
  tileTexture,
} from './blocks';
import { SpriteBatch, buildSpriteAtlas, createSoftRainbow, recolorReds, type AtlasRect } from './sprites';

/** Tuiles finales de l'atlas du jeu (src/game/atlas.ts → loadBlockTextures().tiles). */
export type GameTiles = Map<string, HTMLCanvasElement>;

const BALLOON_COLORS_BLOCKS: [number, number][] = [
  [0xe53935, 0xffffff],
  [0x1e88e5, 0xffe03b],
  [0x8e24aa, 0xf06292],
];

const CLOUD_CELL = 7;
const BALLOON_CELL = 1.6;
const BIRD_SCALE_BLOCKS = 1.5;
const BIRD_SPACING = 5.5;

// ---------- Textes de la légende ----------

const ROW_VOXEL_LICENSE = 'CC0 (tuiles Kenney Voxel Pack) · forme en code';

const ROWS = {
  cloudsBlocks: {
    key: 'clouds', name: 'Nuages', what: '5 galettes de gros blocs blancs qui dérivent',
    source: 'Cubes de laine blanche du jeu (Kenney Voxel Pack)', kind: 'proc', license: ROW_VOXEL_LICENSE,
  },
  sunBlocks: {
    key: 'sun', name: 'Soleil', what: 'Gros cube d’or qui tourne + halo carré',
    source: 'Tuile « bloc d’or » du jeu (glass_frame Kenney recolorée) ; halo = carrés de couleur', kind: 'proc',
    license: ROW_VOXEL_LICENSE,
  },
  balloonsBlocks: {
    key: 'balloons', name: 'Montgolfières', what: '3 boules de laine à rayures, nacelle en planches',
    source: 'Cubes de laine teintée + planches du jeu (Kenney Voxel Pack)', kind: 'proc', license: ROW_VOXEL_LICENSE,
  },
  rainbowBlocks: {
    key: 'rainbow', name: 'Arc-en-ciel', what: 'Arche « pixelisée » de blocs de laine, 7 couleurs',
    source: 'Cubes de laine teintée du jeu, en face du soleil', kind: 'proc', license: ROW_VOXEL_LICENSE,
  },
  birdsBlocks: {
    key: 'birds', name: 'Oiseaux', what: '3 vols en V, petits blocs dont les ailes battent',
    source: 'Cubes de laine teintée du jeu', kind: 'proc', license: ROW_VOXEL_LICENSE,
  },
  cloudsSprites: {
    key: 'clouds', name: 'Nuages', what: '5 nuages dessinés, tout doux, qui dérivent',
    source: 'Kenney · Background Elements Remastered (cloud1–4.png)', kind: 'asset', license: 'CC0',
  },
  sunSprite: {
    key: 'sun', name: 'Soleil', what: 'Disque jaune lumineux avec halo',
    source: 'OpenGameArt · « Shiny Sun » par SalemF (sun_shiny.png)', kind: 'asset', license: 'CC0',
  },
  balloonsSprites: {
    key: 'balloons', name: 'Montgolfières', what: 'Rayée rouge, rayée jaune, damier rose et bleu',
    source:
      'OpenGameArt · « Hot air balloon » par Bert-o-Naught (+ variante jaune recolorée) et « Fall to the earth » par Gamelves.com',
    kind: 'asset', license: 'CC0',
  },
  rainbowSoft: {
    key: 'rainbow', name: 'Arc-en-ciel', what: 'Bande douce et transparente, pieds qui s’effacent',
    source: 'Procédural : demi-anneau + dégradé calculé dans le shader (aucune image)', kind: 'proc',
    license: 'Code du projet',
  },
  birdsSprites: {
    key: 'birds', name: 'Oiseaux', what: '3 vols d’oiseaux roses rigolos (2 images d’animation)',
    source: 'OpenGameArt · « Flying Bird » par bevouliin.com (fly/frame-1, frame-2)', kind: 'asset',
    license: 'CC0',
  },
} satisfies Record<string, LegendRow>;

// ---------- Morceaux réutilisables ----------

/** Laine (nuages, ballons, arc, oiseaux) + planches (nacelles) : 2 InstancedMesh. */
class BlockSky {
  readonly wool: BlockBatch;
  readonly planks: BlockBatch;
  private readonly clouds: number[] = [];
  private readonly balloons: { w: number; p: number }[] = [];
  private readonly birds: { g: number; i: number; el: number; phase: number }[] = [];
  private rainbow = -1;

  constructor(tiles: GameTiles, opts: { clouds: boolean; balloons: boolean; rainbow: boolean; birds: boolean }) {
    const geo = shadedBox();
    this.wool = new BlockBatch(tileTexture(tiles.get('wool_white')!), geo);
    this.planks = new BlockBatch(tileTexture(tiles.get('planks')!), geo);
    if (opts.clouds) {
      CLOUDS.forEach((c) => {
        const el = this.wool.addElement();
        addBlockCloud(this.wool, el, c.v, CLOUD_CELL);
        this.clouds.push(el);
      });
    }
    if (opts.balloons) {
      BALLOONS.forEach((_, i) => {
        const w = this.wool.addElement();
        const p = this.planks.addElement();
        const [a, b] = BALLOON_COLORS_BLOCKS[i];
        addBlockBalloon(this.wool, this.planks, w, p, a, b, BALLOON_CELL);
        this.balloons.push({ w, p });
      });
    }
    if (opts.rainbow) {
      this.rainbow = this.wool.addElement();
      addBlockRainbow(this.wool, this.rainbow);
    }
    if (opts.birds) {
      BIRD_GROUPS.forEach((g, gi) => {
        for (let i = 0; i < g.count; i++) {
          const el = this.wool.addElement();
          addBlockBird(this.wool, el, g.color, BIRD_SCALE_BLOCKS);
          this.birds.push({ g: gi, i, el, phase: gi * 1.7 + i * 0.9 });
        }
      });
    }
    this.wool.build();
    if (this.planks.count > 0) this.planks.build();
    if (this.rainbow >= 0) rainbowMatrix(this.wool.elements[this.rainbow]);
  }

  addTo(group: THREE.Group): void {
    group.add(this.wool.mesh);
    if (this.planks.count > 0) group.add(this.planks.mesh);
  }

  get drawCalls(): number {
    return 1 + (this.planks.count > 0 ? 1 : 0);
  }

  get triangles(): number {
    return this.wool.triangles + this.planks.triangles;
  }

  update(t: number): void {
    for (let k = 0; k < this.clouds.length; k++) cloudMatrix(this.wool.elements[this.clouds[k]], k, t);
    for (let k = 0; k < this.balloons.length; k++) {
      const b = this.balloons[k];
      balloonMatrix(this.wool.elements[b.w], k, t);
      this.planks.elements[b.p].copy(this.wool.elements[b.w]);
    }
    for (let k = 0; k < this.birds.length; k++) {
      const b = this.birds[k];
      birdMatrix(this.wool.elements[b.el], b.g, b.i, t, BIRD_SPACING);
      this.wool.flap[b.el] = 0.15 + 0.65 * Math.sin(t * 9 + b.phase);
    }
    this.wool.update();
    if (this.planks.count > 0) this.planks.update();
  }
}

/** Soleil « carré » : cube d'or (tuile du jeu) + 2 halos carrés additifs. 3 draw calls. */
function createBlockSun(tiles: GameTiles): { group: THREE.Group; update(t: number): void } {
  const group = new THREE.Group();
  sunPosition(group.position, R_SUN);
  group.lookAt(0, 0, 0);
  const core = new THREE.Mesh(
    new THREE.BoxGeometry(34, 34, 34),
    new THREE.MeshBasicMaterial({ map: tileTexture(tiles.get('gold_block')!), color: 0xfff2a8, fog: false }),
  );
  group.add(core);
  const haloMat = (color: number, opacity: number): THREE.MeshBasicMaterial =>
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false });
  const h1 = new THREE.Mesh(new THREE.PlaneGeometry(52, 52), haloMat(0xffd23f, 0.9));
  const h2 = new THREE.Mesh(new THREE.PlaneGeometry(74, 74), haloMat(0xfff4b0, 0.45));
  // Derrière le cube (vu du joueur), le grand halo encore derrière.
  h1.position.z = -22;
  h2.position.z = -25;
  h1.renderOrder = h2.renderOrder = 1;
  group.add(h1, h2);
  return {
    group,
    update(t: number): void {
      core.rotation.set(t * 0.15, t * 0.2, 0);
      h1.rotation.z = t * 0.1;
      h2.rotation.z = -t * 0.07 + 0.4;
    },
  };
}

interface SpriteImages {
  rects: Record<string, AtlasRect>;
  texture: THREE.Texture;
  bytes: number;
}

export async function loadSpriteImages(): Promise<SpriteImages> {
  const names = [
    'cloud1', 'cloud2', 'cloud3', 'cloud4', 'sun_shiny', 'balloon_stripes', 'balloon_checker', 'bird_fly1', 'bird_fly2',
  ];
  const imgs = await Promise.all(names.map((n) => loadImage(`${SKY_ASSETS}${n}.png`)));
  const map: Record<string, HTMLImageElement | HTMLCanvasElement> = {};
  names.forEach((n, i) => (map[n] = imgs[i]));
  map.balloon_yellow = recolorReds(imgs[names.indexOf('balloon_stripes')], 0xffb300);
  const atlas = buildSpriteAtlas(map);
  return { rects: atlas.rects, texture: atlas.texture, bytes: Math.round(atlas.width * atlas.height * 4 * 1.33) };
}

/** Sprites (soleil, nuages, ballons, oiseaux) dans UN SpriteBatch, dans l'ordre loin → près. */
class SpriteSky {
  readonly batch: SpriteBatch;
  private readonly rects: Record<string, AtlasRect>;
  private readonly opts: { sun: boolean; clouds: boolean; balloons: boolean; birds: boolean };
  private sun = -1;
  private readonly clouds: number[] = [];
  private readonly balloons: number[] = [];
  private readonly birds: { g: number; i: number; idx: number; phase: number }[] = [];
  private readonly p = new THREE.Vector3();
  private readonly d = new THREE.Vector3();

  constructor(img: SpriteImages, opts: { sun: boolean; clouds: boolean; balloons: boolean; birds: boolean }) {
    this.rects = img.rects;
    this.opts = opts;
    const birdCount = BIRD_GROUPS.reduce((s, g) => s + g.count, 0);
    this.batch = new SpriteBatch(img.texture, 1 + CLOUDS.length + BALLOONS.length + birdCount);
    if (opts.sun) this.sun = this.batch.alloc();
    if (opts.clouds) CLOUDS.forEach(() => this.clouds.push(this.batch.alloc()));
    if (opts.balloons) BALLOONS.forEach(() => this.balloons.push(this.batch.alloc()));
    if (opts.birds) {
      BIRD_GROUPS.forEach((g, gi) => {
        for (let i = 0; i < g.count; i++) this.birds.push({ g: gi, i, idx: this.batch.alloc(), phase: gi * 0.37 + i * 0.21 });
      });
    }
    this.update(0);
  }

  get triangles(): number {
    return this.batch.count * 2;
  }

  update(t: number): void {
    const { p, d, rects, batch } = this;
    if (this.sun >= 0) {
      sunPosition(p, R_SUN);
      const s = 74 * (1 + 0.03 * Math.sin(t * 1.3));
      batch.set(this.sun, p.x, p.y, p.z, s, s, rects.sun_shiny);
    }
    for (let k = 0; k < this.clouds.length; k++) {
      const c = CLOUDS[k];
      const r = rects[`cloud${c.v + 1}`];
      onCircle(p, c.a0 + c.w * t, c.r, c.y);
      const w = 56 * c.scale;
      batch.set(this.clouds[k], p.x, p.y, p.z, w, w / r.aspect, r);
    }
    const balloonImgs = ['balloon_stripes', 'balloon_yellow', 'balloon_checker'];
    for (let k = 0; k < this.balloons.length; k++) {
      const b = BALLOONS[k];
      const r = rects[balloonImgs[k]];
      onCircle(p, b.a0 + b.w * t, b.r, b.y + 12 + 3 * Math.sin(t * 0.45 + b.phase));
      const h = 26;
      batch.set(this.balloons[k], p.x, p.y, p.z, h * r.aspect, h, r);
    }
    for (let k = 0; k < this.birds.length; k++) {
      const b = this.birds[k];
      birdState(BIRD_GROUPS[b.g], b.i, t, BIRD_SPACING, p, d);
      // 2 images d'animation, ~5 battements par seconde, décalés d'un oiseau à l'autre.
      const frame = Math.floor(t * 5 + b.phase * 10) % 2 === 0 ? rects.bird_fly1 : rects.bird_fly2;
      const w = 6.5;
      batch.set(b.idx, p.x, p.y, p.z, w, w / frame.aspect, frame);
      batch.setVel(b.idx, d.x, d.y, d.z);
    }
    batch.commit();
  }

  hasBirds(): boolean {
    return this.opts.birds;
  }
}

// ---------- Les 3 styles ----------

export function createStyleA(tiles: GameTiles): SkyStyle {
  const group = new THREE.Group();
  const blocks = new BlockSky(tiles, { clouds: true, balloons: true, rainbow: true, birds: true });
  blocks.addTo(group);
  const sun = createBlockSun(tiles);
  group.add(sun.group);
  const dc = blocks.drawCalls + 3;
  const tris = blocks.triangles + 12 + 4;
  return {
    letter: 'A',
    name: 'Blocs',
    group,
    rows: [ROWS.cloudsBlocks, ROWS.sunBlocks, ROWS.balloonsBlocks, ROWS.rainbowBlocks, ROWS.birdsBlocks],
    costText:
      `${dc} draw calls ajoutés · ≈ ${tris.toLocaleString('fr-FR')} triangles (${blocks.wool.count + blocks.planks.count} cubes instanciés) · ` +
      `textures : tuiles du jeu, ≈ 0 Mo en plus · coût tablette : faible`,
    update(t) {
      blocks.update(t);
      sun.update(t);
    },
  };
}

export function createStyleB(img: SpriteImages): SkyStyle {
  const group = new THREE.Group();
  const sprites = new SpriteSky(img, { sun: true, clouds: true, balloons: true, birds: true });
  group.add(sprites.batch.mesh);
  const rainbow = createSoftRainbow(RAINBOW_OUTER, RAINBOW_OUTER - RAINBOW_COLORS.length * RAINBOW_BAND, RAINBOW_CENTER_Y, RAINBOW_COLORS);
  rainbow.matrixAutoUpdate = false;
  rainbowMatrix(rainbow.matrix);
  group.add(rainbow);
  const tris = sprites.triangles + 96 * 2;
  return {
    letter: 'B',
    name: 'Dessins',
    group,
    rows: [ROWS.cloudsSprites, ROWS.sunSprite, ROWS.balloonsSprites, ROWS.rainbowSoft, ROWS.birdsSprites],
    costText:
      `2 draw calls ajoutés (tous les sprites en 1 seul mesh instancié + l'arc) · ≈ ${tris} triangles · ` +
      `atlas d'images ${(img.bytes / 1048576).toFixed(1)} Mo GPU (9 PNG, 110 Ko sur disque) · coût tablette : très faible (un peu de transparence)`,
    update(t) {
      sprites.update(t);
    },
  };
}

export function createStyleC(tiles: GameTiles, img: SpriteImages): SkyStyle {
  const group = new THREE.Group();
  const blocks = new BlockSky(tiles, { clouds: false, balloons: true, rainbow: true, birds: false });
  blocks.addTo(group);
  const sprites = new SpriteSky(img, { sun: true, clouds: true, balloons: false, birds: true });
  group.add(sprites.batch.mesh);
  const dc = blocks.drawCalls + 1;
  const tris = blocks.triangles + sprites.triangles;
  return {
    letter: 'C',
    name: 'Mélange',
    group,
    rows: [
      ROWS.cloudsSprites,
      ROWS.sunSprite,
      { ...ROWS.balloonsBlocks, what: '3 boules de laine à rayures qui tournent (vraie 3D)' },
      ROWS.rainbowBlocks,
      ROWS.birdsSprites,
    ],
    costText:
      `${dc} draw calls ajoutés · ≈ ${tris.toLocaleString('fr-FR')} triangles · tuiles du jeu + atlas d'images ` +
      `${(img.bytes / 1048576).toFixed(1)} Mo GPU · coût tablette : faible`,
    update(t) {
      blocks.update(t);
      sprites.update(t);
    },
  };
}
