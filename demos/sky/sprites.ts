/**
 * Style « Sprites » : images 2D open source (Kenney, OpenGameArt CC0) affichées en billboards.
 *
 * Perf : toutes les images sont rangées au chargement dans UN atlas (canvas, mipmaps) et TOUS les
 * sprites du ciel sont dessinés par UN SEUL mesh instancié (shader billboard maison) : 1 draw call
 * pour les nuages + soleil + montgolfières + oiseaux. Les attributs d'instance (position, image)
 * sont réécrits dans des tableaux préalloués à chaque frame.
 */
import * as THREE from 'three';

export interface AtlasRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** Rapport largeur / hauteur de l'image. */
  aspect: number;
}

/** Range des images dans un atlas (étagères), renvoie la texture et les rectangles UV. */
export function buildSpriteAtlas(images: Record<string, CanvasImageSource & { width: number; height: number }>): {
  texture: THREE.CanvasTexture;
  rects: Record<string, AtlasRect>;
  width: number;
  height: number;
} {
  const PAD = 4;
  const W = 1024;
  const entries = Object.entries(images).sort((a, b) => b[1].height - a[1].height);
  const pos: Record<string, { x: number; y: number }> = {};
  let x = PAD;
  let y = PAD;
  let rowH = 0;
  for (const [k, img] of entries) {
    if (x + img.width + PAD > W) {
      x = PAD;
      y += rowH + PAD;
      rowH = 0;
    }
    pos[k] = { x, y };
    x += img.width + PAD;
    rowH = Math.max(rowH, img.height);
  }
  const H = Math.ceil((y + rowH + PAD) / 4) * 4;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const rects: Record<string, AtlasRect> = {};
  for (const [k, img] of entries) {
    const p = pos[k];
    ctx.drawImage(img, p.x, p.y);
    // flipY = true (défaut) : v = 1 en haut du canvas.
    rects[k] = {
      u0: (p.x + 0.5) / W,
      u1: (p.x + img.width - 0.5) / W,
      v0: 1 - (p.y + img.height - 0.5) / H,
      v1: 1 - (p.y + 0.5) / H,
      aspect: img.width / img.height,
    };
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.premultiplyAlpha = true; // pas de liseré sombre sur les bords aux niveaux de mipmap
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return { texture, rects, width: W, height: H };
}

/**
 * Recolore les pixels ROUGES d'une image vers une autre teinte (transformation de couleur seule,
 * comme les laines du jeu) : sert à décliner la montgolfière rayée rouge en jaune.
 */
export function recolorReds(img: HTMLImageElement, target: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const tr = (target >> 16) & 255;
  const tg = (target >> 8) & 255;
  const tb = target & 255;
  for (let i = 0; i < d.data.length; i += 4) {
    const r = d.data[i];
    const g = d.data[i + 1];
    const b = d.data[i + 2];
    if (r > 90 && r > g * 1.8 && r > b * 1.8) {
      const k = r / 225; // 225 = rouge principal de l'image
      d.data[i] = Math.min(255, tr * k);
      d.data[i + 1] = Math.min(255, tg * k);
      d.data[i + 2] = Math.min(255, tb * k);
    }
  }
  ctx.putImageData(d, 0, 0);
  return c;
}

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec2 iSize;
attribute vec4 iUv;
attribute vec3 iVel;
varying vec2 vUv;
void main() {
  // Retournement horizontal : l'image regarde vers la droite ; si l'oiseau vole vers la gauche
  // de l'écran, on la retourne.
  vec3 vv = mat3(viewMatrix) * iVel;
  float flip = vv.x < 0.0 ? 1.0 : 0.0;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  mv.xy += position.xy * iSize;
  vec2 u = vec2(mix(uv.x, 1.0 - uv.x, flip), uv.y);
  vUv = mix(iUv.xy, iUv.zw, u);
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(map, vUv);
  if (c.a < 0.01) discard;
  // Texture prémultipliée : conversion de couleur sur la couleur « dé-prémultipliée ».
  vec3 rgb = linearToOutputTexel(vec4(c.rgb / c.a, 1.0)).rgb;
  gl_FragColor = vec4(rgb * c.a, c.a);
}`;

/** Lot de sprites billboard instanciés (1 draw call). L'ordre des instances = ordre de dessin. */
export class SpriteBatch {
  readonly mesh: THREE.Mesh;
  private readonly pos: Float32Array;
  private readonly size: Float32Array;
  private readonly uv: Float32Array;
  private readonly vel: Float32Array;
  private readonly aPos: THREE.InstancedBufferAttribute;
  private readonly aUv: THREE.InstancedBufferAttribute;
  private readonly aVel: THREE.InstancedBufferAttribute;
  private readonly aSize: THREE.InstancedBufferAttribute;
  readonly capacity: number;
  private n = 0;

  constructor(texture: THREE.Texture, capacity: number) {
    this.capacity = capacity;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('uv', base.getAttribute('uv'));
    this.pos = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity * 2);
    this.uv = new Float32Array(capacity * 4);
    this.vel = new Float32Array(capacity * 3);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(this.size, 2).setUsage(THREE.DynamicDrawUsage);
    this.aUv = new THREE.InstancedBufferAttribute(this.uv, 4).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iSize', this.aSize);
    g.setAttribute('iUv', this.aUv);
    g.setAttribute('iVel', this.aVel);
    g.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      premultipliedAlpha: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** Réserve une instance ; renvoie son indice. */
  alloc(): number {
    if (this.n >= this.capacity) throw new Error('SpriteBatch plein');
    return this.n++;
  }

  set(i: number, x: number, y: number, z: number, w: number, h: number, r: AtlasRect): void {
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.size[i * 2] = w;
    this.size[i * 2 + 1] = h;
    this.uv[i * 4] = r.u0;
    this.uv[i * 4 + 1] = r.v0;
    this.uv[i * 4 + 2] = r.u1;
    this.uv[i * 4 + 3] = r.v1;
  }

  setVel(i: number, x: number, y: number, z: number): void {
    this.vel[i * 3] = x;
    this.vel[i * 3 + 1] = y;
    this.vel[i * 3 + 2] = z;
  }

  /** À appeler une fois par frame après les set(). */
  commit(): void {
    const g = this.mesh.geometry as THREE.InstancedBufferGeometry;
    g.instanceCount = this.n;
    this.aPos.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.aUv.needsUpdate = true;
    this.aVel.needsUpdate = true;
  }

  get count(): number {
    return this.n;
  }
}

// ---------- Arc-en-ciel doux (géométrie procédurale, dégradé calculé dans le shader) ----------

const RB_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const RB_FRAG = /* glsl */ `
uniform float uInner;
uniform float uOuter;
uniform float uCenterY;
uniform vec3 uCols[7];
uniform float uOpacity;
varying vec2 vP;
void main() {
  float r = length(vP - vec2(0.0, uCenterY));
  float t = (uOuter - r) / (uOuter - uInner); // 0 = bord extérieur (rouge), 1 = intérieur (violet)
  if (t < 0.0 || t > 1.0) discard;
  float f = t * 7.0 - 0.5;
  int i0 = int(clamp(floor(f), 0.0, 6.0));
  int i1 = int(clamp(floor(f) + 1.0, 0.0, 6.0));
  vec3 c = mix(uCols[i0], uCols[i1], smoothstep(0.0, 1.0, fract(f)));
  // Bords adoucis + pieds qui s'effacent vers l'horizon.
  float edge = smoothstep(0.0, 0.12, t) * smoothstep(1.0, 0.85, t);
  float foot = smoothstep(uCenterY - 4.0, uCenterY + 30.0, vP.y);
  float a = uOpacity * edge * foot;
  vec3 rgb = linearToOutputTexel(vec4(c, 1.0)).rgb;
  gl_FragColor = vec4(rgb * a, a);
}`;

export function createSoftRainbow(outer: number, inner: number, centerY: number, colors: number[]): THREE.Mesh {
  // Demi-anneau dans le plan XY local, centré en (0, centerY).
  const geo = new THREE.RingGeometry(inner, outer, 96, 1, 0, Math.PI);
  geo.translate(0, centerY, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uInner: { value: inner },
      uOuter: { value: outer },
      uCenterY: { value: centerY },
      uCols: { value: colors.map((c) => new THREE.Color(c)) },
      uOpacity: { value: 0.6 },
    },
    vertexShader: RB_VERT,
    fragmentShader: RB_FRAG,
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  return mesh;
}
