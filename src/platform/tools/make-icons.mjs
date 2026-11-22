#!/usr/bin/env node
/**
 * Génère les icônes PWA dans public/icons/ et public/favicon.png.
 *
 * Usage (depuis la racine du dépôt) :
 *   node src/platform/tools/make-icons.mjs
 *
 * Aucune dépendance : PNG lu et écrit à la main (zlib de Node, CRC32).
 * Dessin : un cube isométrique texturé avec les VRAIES tuiles Kenney du Voxel Pack (CC0) —
 * public/assets/textures/grass_top.png sur le dessus, grass_side.png sur les côtés (assombris
 * comme dans le jeu) — sur fond bleu ciel #7ec8ff. Anticrénelage par sur-échantillonnage 4×4.
 * Version « maskable » : fond plein, cube contenu dans le cercle central de 80 % (zone sûre).
 */
import { deflateSync, inflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PUBLIC = resolve(ROOT, 'public');

// ---------- PNG : écriture ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** rgba : Uint8Array w*h*4 → Buffer PNG (RGBA 8 bits). */
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filtre None
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- PNG : lecture (RGBA/RGB 8 bits, non entrelacé : cas des tuiles Kenney) ----------
function decodePng(file) {
  const buf = readFileSync(file);
  let pos = 8;
  let w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      ctype = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (depth !== 8 || (ctype !== 6 && ctype !== 2) || interlace !== 0) {
    throw new Error(`${file} : format PNG non géré (profondeur ${depth}, type ${ctype}, entrelacé ${interlace})`);
  }
  const bpp = ctype === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[y * stride + x] = v & 255;
    }
  }
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = px[i * bpp];
    rgba[i * 4 + 1] = px[i * bpp + 1];
    rgba[i * 4 + 2] = px[i * bpp + 2];
    rgba[i * 4 + 3] = bpp === 4 ? px[i * bpp + 3] : 255;
  }
  return { w, h, rgba };
}

const TEX = resolve(PUBLIC, 'assets/textures');
const TOP_TILE = decodePng(resolve(TEX, 'grass_top.png'));
const SIDE_TILE = decodePng(resolve(TEX, 'grass_side.png'));

/** Échantillon (plus proche voisin) d'une tuile en coordonnées normalisées [0,1[. */
function sample(tile, u, v, shade) {
  const x = Math.min(tile.w - 1, Math.max(0, Math.floor(u * tile.w)));
  const y = Math.min(tile.h - 1, Math.max(0, Math.floor(v * tile.h)));
  const i = (y * tile.w + x) * 4;
  return [tile.rgba[i] * shade, tile.rgba[i + 1] * shade, tile.rgba[i + 2] * shade];
}

// ---------- Dessin ----------
const SKY = [0x7e, 0xc8, 0xff];
const EDGE = [0x1f, 0x3a, 0x22];
/** Ombrage des côtés (gauche, droite), proche de celui du monde. */
const SHADE_L = 0.84;
const SHADE_R = 0.66;

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Coordonnées (s, t) du point p dans le repère d'origine o et d'axes a, b (inverse affine).
 * Le point est dans la face si 0 <= s, t < 1.
 */
function local(px, py, o, a, b) {
  const det = a[0] * b[1] - a[1] * b[0];
  const dx = px - o[0];
  const dy = py - o[1];
  return [(dx * b[1] - dy * b[0]) / det, (a[0] * dy - a[1] * dx) / det];
}

/**
 * @param size taille en px
 * @param scale largeur du cube relative à l'icône
 * @param rounded coins arrondis transparents (icône standard / favicon) ou fond plein
 */
function drawIcon(size, scale, rounded) {
  const rgba = new Uint8Array(size * size * 4);
  const c = size / 2;
  const r = (size * scale) / 2; // demi-largeur du cube
  const hTop = r * 0.5; // demi-hauteur du losange du dessus
  const H = r; // hauteur des côtés
  const cy = c - (2 * hTop + H) / 2 + 0.02 * size; // cube centré verticalement
  const top = [c, cy];
  const midL = [c - r, cy + hTop];
  const midR = [c + r, cy + hTop];
  const center = [c, cy + 2 * hTop];
  const botL = [c - r, midL[1] + H];
  const botR = [c + r, midR[1] + H];
  const bot = [c, center[1] + H];
  // Faces : origine + axes (u vers la droite de la tuile, v vers le bas).
  const faces = [
    { o: top, a: [r, hTop], b: [-r, hTop], tile: TOP_TILE, shade: 1 },
    { o: midL, a: [r, hTop], b: [0, H], tile: SIDE_TILE, shade: SHADE_L },
    { o: center, a: [r, -hTop], b: [0, H], tile: SIDE_TILE, shade: SHADE_R },
  ];
  const edges = [
    [top, midR], [midR, botR], [botR, bot], [bot, botL], [botL, midL], [midL, top],
  ];
  const edgeW = Math.max(1, size / 110);
  const corner = rounded ? size * 0.18 : 0;
  const SS = 4;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let ar = 0, ag = 0, ab = 0, aa = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          if (corner > 0) {
            const qx = Math.max(corner - px, px - (size - corner), 0);
            const qy = Math.max(corner - py, py - (size - corner), 0);
            if (Math.hypot(qx, qy) > corner) continue;
          }
          let col = SKY;
          for (const f of faces) {
            const [s, t] = local(px, py, f.o, f.a, f.b);
            if (s >= 0 && s < 1 && t >= 0 && t < 1) {
              col = sample(f.tile, s, t, f.shade);
              break;
            }
          }
          if (edges.some(([a, b]) => distToSegment(px, py, a, b) < edgeW)) col = EDGE;
          ar += col[0]; ag += col[1]; ab += col[2]; aa += 255;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      const cover = aa / 255;
      rgba[i] = cover ? Math.round(ar / cover) : 0;
      rgba[i + 1] = cover ? Math.round(ag / cover) : 0;
      rgba[i + 2] = cover ? Math.round(ab / cover) : 0;
      rgba[i + 3] = Math.round(aa / n);
    }
  }
  return encodePng(size, size, rgba);
}

// Maskable : demi-diagonale du cube ≈ 0,58 × largeur → 0,58 × 0,6 = 0,35 < 0,40 (zone sûre 80 %).
const outputs = [
  ['icons/icon-192.png', drawIcon(192, 0.66, true)],
  ['icons/icon-512.png', drawIcon(512, 0.66, true)],
  ['icons/icon-512-maskable.png', drawIcon(512, 0.6, false)],
  ['icons/apple-touch-icon-180.png', drawIcon(180, 0.64, false)],
  ['favicon.png', drawIcon(64, 0.8, true)],
];

for (const [rel, png] of outputs) {
  const file = resolve(PUBLIC, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png);
  console.log(`écrit ${rel} (${png.length} o)`);
}
