#!/usr/bin/env node
/**
 * Génère les icônes PWA PROVISOIRES (placeholders) dans public/icons/ et public/favicon.png.
 *
 * Usage (depuis la racine du dépôt) :
 *   node src/platform/tools/make-icons.mjs
 *
 * Aucune dépendance : PNG écrit à la main (signature + IHDR/IDAT/IEND, CRC32, zlib de Node).
 * Dessin : un cube isométrique (dessus vert « herbe », côtés terre/brique) sur fond bleu ciel #7ec8ff.
 * Anticrénelage par sur-échantillonnage 4×4.
 *
 * Phase 2 : ces fichiers seront remplacés par une icône dérivée du pack de textures choisi
 * (garder les mêmes noms de fichiers pour ne pas toucher au manifest dans vite.config.ts).
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PUBLIC = resolve(ROOT, 'public');

// ---------- PNG ----------
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

// ---------- Dessin ----------
const SKY = [0x7e, 0xc8, 0xff];
const TOP = [0x5c, 0xc8, 0x3c]; // herbe
const LEFT = [0xd9, 0x6a, 0x2b]; // brique/terre claire
const RIGHT = [0xa8, 0x4a, 0x1c]; // côté ombré
const EDGE = [0x2b, 0x1a, 0x10];

function pointInPoly(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * @param size taille en px
 * @param scale taille du cube relative à l'icône (plus petit pour « maskable » : zone sûre 80 %)
 * @param rounded coins arrondis transparents (favicon / icône standard) ou fond plein (maskable)
 */
function drawIcon(size, scale, rounded) {
  const rgba = new Uint8Array(size * size * 4);
  const c = size / 2;
  const r = (size * scale) / 2; // demi-largeur du cube
  const hTop = r * 0.5; // demi-hauteur du losange du dessus
  const cy = c + r * 0.1;
  const top = [c, cy - r * 1.0];
  const midL = [c - r, cy - r * 1.0 + hTop];
  const midR = [c + r, cy - r * 1.0 + hTop];
  const center = [c, cy - r * 1.0 + 2 * hTop];
  const botL = [c - r, midL[1] + r * 1.0];
  const botR = [c + r, midR[1] + r * 1.0];
  const bot = [c, center[1] + r * 1.0];
  const topFace = [top, midR, center, midL];
  const leftFace = [midL, center, bot, botL];
  const rightFace = [center, midR, botR, bot];
  const edges = [
    [top, midR], [midR, center], [center, midL], [midL, top],
    [center, bot], [midL, botL], [botL, bot], [midR, botR], [botR, bot],
  ];
  const edgeW = Math.max(1, size / 96);
  const corner = rounded ? size * 0.18 : 0;
  const SS = 4;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let ar = 0, ag = 0, ab = 0, aa = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          // masque coins arrondis
          if (corner > 0) {
            const qx = Math.max(corner - px, px - (size - corner), 0);
            const qy = Math.max(corner - py, py - (size - corner), 0);
            if (Math.hypot(qx, qy) > corner) continue;
          }
          let col = SKY;
          if (edges.some(([a, b]) => distToSegment(px, py, a, b) < edgeW)) col = EDGE;
          else if (pointInPoly(px, py, topFace)) col = TOP;
          else if (pointInPoly(px, py, leftFace)) col = LEFT;
          else if (pointInPoly(px, py, rightFace)) col = RIGHT;
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

const outputs = [
  ['icons/icon-192.png', drawIcon(192, 0.62, true)],
  ['icons/icon-512.png', drawIcon(512, 0.62, true)],
  ['icons/icon-512-maskable.png', drawIcon(512, 0.46, false)],
  ['icons/apple-touch-icon-180.png', drawIcon(180, 0.6, false)],
  ['favicon.png', drawIcon(64, 0.7, true)],
];

for (const [rel, png] of outputs) {
  const file = resolve(PUBLIC, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, png);
  console.log(`écrit ${rel} (${png.length} o)`);
}
