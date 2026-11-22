/**
 * Compression RLE minimale pour Uint8Array.
 *
 * Format : suite de paires [longueur (1..255), valeur]. Une séquence plus longue que 255
 * est découpée en plusieurs paires. Pire cas (aucune répétition) : taille × 2.
 * Les mondes voxel (couches d'air, de pierre…) compressent typiquement d'un facteur > 50.
 */

export function rleEncode(data: Uint8Array): Uint8Array {
  const n = data.length;
  if (n === 0) return new Uint8Array(0);
  // Première passe : taille exacte de sortie.
  let pairs = 0;
  for (let i = 0; i < n; ) {
    const v = data[i];
    let run = 1;
    while (i + run < n && run < 255 && data[i + run] === v) run++;
    pairs++;
    i += run;
  }
  const out = new Uint8Array(pairs * 2);
  let o = 0;
  for (let i = 0; i < n; ) {
    const v = data[i];
    let run = 1;
    while (i + run < n && run < 255 && data[i + run] === v) run++;
    out[o++] = run;
    out[o++] = v;
    i += run;
  }
  return out;
}

/**
 * Décode un flux RLE. Lève une erreur si le flux est malformé (longueur impaire, longueur nulle)
 * ou si `expectedLength` est fourni et ne correspond pas.
 */
export function rleDecode(encoded: Uint8Array, expectedLength?: number): Uint8Array {
  if (encoded.length % 2 !== 0) throw new Error('RLE : longueur impaire');
  let total = 0;
  for (let i = 0; i < encoded.length; i += 2) {
    const run = encoded[i];
    if (run === 0) throw new Error('RLE : longueur de séquence nulle');
    total += run;
  }
  if (expectedLength !== undefined && total !== expectedLength) {
    throw new Error(`RLE : taille décodée ${total} ≠ ${expectedLength} attendue`);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (let i = 0; i < encoded.length; i += 2) {
    const run = encoded[i];
    out.fill(encoded[i + 1], o, o + run);
    o += run;
  }
  return out;
}
