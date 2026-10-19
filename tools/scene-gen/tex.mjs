// Procedural textures + bump maps for scene specs — no external assets.
// Each returns {w, h, rgb: Uint8Array (w*h*3), bump: Float32Array | null}
// where bump is a 0..1 height field the renderer turns into shading relief.

const hash = (x, y, s) => {
  let h = (x * 374761393 + y * 668265263 + s * 1442695040888963407) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177 >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** Bilinear value noise. */
const vnoise = (x, y, s) => {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const sm = (t) => t * t * (3 - 2 * t);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * sm(xf) + (c - a) * sm(yf) + (a - b - c + d) * sm(xf) * sm(yf);
};
/** Fractal noise 0..1. */
export const fbm = (x, y, oct = 4, s = 0) => {
  let v = 0, amp = 0.5, f = 1, tot = 0;
  for (let i = 0; i < oct; i++) { v += vnoise(x * f, y * f, s + i) * amp; tot += amp; amp *= 0.5; f *= 2; }
  return v / tot;
};

const make = (w, h, fn) => {
  const rgb = new Uint8Array(w * h * 3), bump = new Float32Array(w * h);
  let hasBump = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [r, g, b, ht] = fn(x, y);
    const i = y * w + x;
    rgb[i * 3] = Math.max(0, Math.min(255, r));
    rgb[i * 3 + 1] = Math.max(0, Math.min(255, g));
    rgb[i * 3 + 2] = Math.max(0, Math.min(255, b));
    bump[i] = ht; if (ht !== 0) hasBump = true;
  }
  return { w, h, rgb, bump: hasBump ? bump : null };
};
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Wood planks — grain streaks + plank gaps + knots. `vertical` = plank direction. */
export function wood(w, h, { base = [150, 105, 62], gap = [74, 52, 32], plank = 10, vertical = true, seed = 7 } = {}) {
  return make(w, h, (x, y) => {
    const u = vertical ? x : y, v = vertical ? y : x;
    const pi = Math.floor(u / plank);
    const px = (u % plank) / plank;
    const tint = hash(pi, 0, seed) * 0.3 + 0.85;             // per-plank tint
    const grain = fbm(u * 0.06 + pi * 7.3, v * 0.55, 3, seed) * 0.34 + 0.83; // stretched grain
    const knot = vnoise(u * 0.15 + pi * 31, v * 0.15, seed + 9);
    const k = knot > 0.78 ? 0.75 : 1;                        // occasional knots
    const edge = Math.min(px, 1 - px);
    const groove = edge < 0.09 ? 0.0 : 1.0;                  // gap between planks
    const c = mix3(mix3(gap, base, groove), base, 0).map((q) => q * tint * grain * k);
    return [...c, groove * (0.4 + grain * 0.5) + (k < 1 ? -0.15 : 0)];
  });
}

/** Rough brick with mortar joints. */
export function brick(w, h, { brick = [146, 74, 56], mortar = [176, 160, 140], bw = 22, bh = 9, seed = 3 } = {}) {
  return make(w, h, (x, y) => {
    const row = Math.floor(y / bh), off = (row % 2) * bw * 0.5;
    const bx = (x + off) % bw, by = y % bh;
    const bi = Math.floor((x + off) / bw);
    const tint = 0.82 + hash(bi, row, seed) * 0.36;
    const n = fbm(x * 0.4, y * 0.4, 3, seed + 5);
    const m = Math.min(bx, bw - bx, by * 1.7, (bh - by) * 1.7) < 1.2;
    const c = m ? mortar.map((q) => q * (0.9 + n * 0.2)) : brick.map((q) => q * tint * (0.86 + n * 0.28));
    return [...c, m ? 0.15 : 0.55 + n * 0.3];
  });
}

/** Rough stone blocks — for foundations and banks. */
export function stone(w, h, { base = [142, 136, 124], joint = [96, 90, 80], bw = 18, bh = 12, seed = 11 } = {}) {
  return make(w, h, (x, y) => {
    const row = Math.floor(y / bh), off = (row % 2) * bw * 0.45 + hash(row, 0, seed) * 5;
    const bx = (x + off) % bw;
    const bi = Math.floor((x + off) / bw);
    const tint = 0.86 + hash(bi, row, seed + 1) * 0.28;
    const n = fbm(x * 0.5, y * 0.5, 4, seed + 2);
    const j = Math.min(bx, bw - bx, y % bh, bh - (y % bh)) < 1.0;
    const c = (j ? joint : base).map((q) => q * tint * (0.88 + n * 0.26));
    return [...c, j ? 0.1 : 0.5 + n * 0.4];
  });
}

/** Sand / dirt ground — ripples + mottle. */
export function sand(w, h, { base = [198, 168, 120], dark = [168, 136, 92], seed = 5 } = {}) {
  return make(w, h, (x, y) => {
    const rip = Math.sin(y * 0.32 + fbm(x * 0.05, y * 0.05, 3, seed) * 6) * 0.5 + 0.5;
    const mot = fbm(x * 0.12, y * 0.12, 4, seed + 4);
    const c = mix3(dark, base, mot * 0.7 + rip * 0.3).map((q) => q * (0.9 + mot * 0.18));
    return [...c, mot * 0.5 + rip * 0.25];
  });
}

/** Roof shingles / tar paper — overlapping rows. */
export function shingles(w, h, { base = [96, 72, 54], edge = [60, 44, 34], row = 7, seed = 13 } = {}) {
  return make(w, h, (x, y) => {
    const r = Math.floor(y / row), off = (r % 2) * 11;
    const sx = (x + off) % 22, sy = y % row;
    const tint = 0.85 + hash(Math.floor((x + off) / 22), r, seed) * 0.3;
    const n = fbm(x * 0.3, y * 0.3, 3, seed);
    const e = sy < 1.4 || sx < 1.0;
    const c = (e ? edge : base).map((q) => q * tint * (0.9 + n * 0.2));
    return [...c, e ? 0.15 : 0.5 + n * 0.3];
  });
}

/** Corrugated / rusted metal — streaks + blotches. */
export function rust(w, h, { base = [150, 88, 52], dark = [96, 52, 30], seed = 17 } = {}) {
  return make(w, h, (x, y) => {
    const streak = fbm(x * 0.05, y * 0.4, 4, seed);
    const blotch = fbm(x * 0.12 + 9, y * 0.12, 4, seed + 3);
    const c = mix3(dark, base, Math.min(1, blotch * 1.4)).map((q) => q * (0.82 + streak * 0.36));
    return [...c, streak * 0.6];
  });
}

/** Dry brush / scrub texture — speckled noise for bushes. */
export function scrub(w, h, { base = [94, 108, 60], dark = [60, 72, 38], seed = 23 } = {}) {
  return make(w, h, (x, y) => {
    const n = fbm(x * 0.45, y * 0.45, 4, seed);
    const c = mix3(dark, base, Math.min(1, n * 1.5)).map((q) => q * (0.85 + n * 0.3));
    return [...c, n];
  });
}

/** Flat roughness tint — multiplies any color with mottling (walls/plaster). */
export function rough(w, h, { base = [200, 190, 170], seed = 29, contrast = 0.24 } = {}) {
  return make(w, h, (x, y) => {
    const n = fbm(x * 0.18, y * 0.18, 4, seed);
    const c = base.map((q) => q * (1 - contrast / 2 + n * contrast));
    return [...c, n * 0.5];
  });
}

/** Interior wallpaper — vertical stripe band + faint damask mottle + pin dots. */
export function wallpaper(w, h, { base = [200, 190, 166], stripe = [182, 166, 138], band = 10, seed = 33 } = {}) {
  return make(w, h, (x, y) => {
    const inBand = (x % band) < band * 0.4;
    const damask = fbm(x * 0.3, y * 0.3, 3, seed) > 0.58 ? 0.94 : 1;
    const dot = (x % band) === Math.floor(band * 0.7) && (y % 12) < 2 ? 0.88 : 1;
    const c = (inBand ? stripe : base).map((q) => q * damask * dot * (0.96 + fbm(x * 0.1, y * 0.1, 2, seed + 2) * 0.08));
    return [...c, inBand ? 0.35 : 0.45];
  });
}

/** Carpet / upholstery — fine dense fiber mottle. */
export function carpet(w, h, { base = [148, 88, 66], dark = [116, 64, 46], seed = 35 } = {}) {
  return make(w, h, (x, y) => {
    const n = fbm(x * 0.9, y * 0.9, 3, seed);
    const mot = fbm(x * 0.14, y * 0.14, 3, seed + 1);
    const c = mix3(dark, base, Math.min(1, n * 1.35)).map((q) => q * (0.88 + mot * 0.24));
    return [...c, n * 0.7];
  });
}

/** Curtain / upholstery stripes — soft vertical bands with fold shading. */
export function stripes(w, h, { a = [168, 138, 112], b = [146, 112, 88], sw = 9, seed = 37 } = {}) {
  return make(w, h, (x, y) => {
    const ph = (x / sw) * Math.PI;
    const fold = Math.sin(ph) * 0.5 + 0.5;          // soft sinusoidal folds
    const c = mix3(b, a, fold).map((q) => q * (0.94 + fbm(x * 0.2, y * 0.2, 2, seed) * 0.12));
    return [...c, fold * 0.8];
  });
}
