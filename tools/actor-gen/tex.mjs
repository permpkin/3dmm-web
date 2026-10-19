// Indexed-texture helpers for actor materials. A TMAP is a w*h grid of
// socpal palette indexes — index 0 is the transparent cutout (the renderer
// discards those texels, so hole = missing geometry, NOT "see the ramp").
// Keep indexes in 1..156: scene palettes may overlay 157+.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let SOCPAL = null;
/** The 256-entry [r,g,b] social palette (public/local/socpal.pal). */
export function socpal() {
  if (!SOCPAL) {
    const b = fs.readFileSync(path.join(root, 'public/local/socpal.pal'));
    SOCPAL = Array.from({ length: 256 }, (_, i) => [b[i * 3], b[i * 3 + 1], b[i * 3 + 2]]);
  }
  return SOCPAL;
}

/** Nearest socpal index to [r,g,b] within [lo,hi) — defaults to the
 *  scene-overlay-safe band. */
export function nearest(r, g, b, { lo = 1, hi = 157 } = {}) {
  const pal = socpal();
  let best = lo, bd = Infinity;
  for (let i = lo; i < hi; i++) {
    const d = (pal[i][0] - r) ** 2 + (pal[i][1] - g) ** 2 + (pal[i][2] - b) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** Build a TMAP descriptor {w,h,px:Uint8Array} from a paint function
 *  fn(x,y)->palette index (0 = transparent cutout). */
export function make(w, h, fn) {
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px[y * w + x] = fn(x, y) & 0xff;
  return { w, h, px };
}

/** Solid-fill texture of one palette index. */
export const solid = (idx, w = 8, h = 8) => make(w, h, () => idx);

/** Horizontal stripes: fn colors per band of `row` rows each. */
export const stripes = (w, h, row, idxs) => make(w, h, (x, y) => idxs[Math.floor(y / row) % idxs.length]);

/** Checkerboard of `cell`-pixel squares. */
export const checker = (w, h, cell, a, b) => make(w, h, (x, y) => ((Math.floor(x / cell) + Math.floor(y / cell)) & 1 ? a : b));

/** Simple face plate: background fill + two eye blocks + a mouth line.
 *  Compose over a w*h canvas — feed `face(48,48,{bg,eye,mouth})` a palette
 *  index per field; any field may be 0/undefined to leave that part unpainted. */
export function face(w, h, { bg, eye, mouth } = {}) {
  return make(w, h, (x, y) => {
    const u = x / w, v = y / h;
    if (v > 0.3 && v < 0.5 && ((u > 0.24 && u < 0.4) || (u > 0.6 && u < 0.76))) return eye ?? bg;
    if (v > 0.64 && v < 0.7 && u > 0.3 && u < 0.7) return mouth ?? bg;
    return bg;
  });
}
