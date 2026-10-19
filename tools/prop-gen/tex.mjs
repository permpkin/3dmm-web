// Indexed-texture helpers for prop materials — same palette-indexed TMAP
// descriptors actor-gen uses: {w,h,px:Uint8Array} of socpal indexes where
// index 0 is the transparent cutout. Scene palettes may overlay 157+, so
// keep indexes in 1..156 (nearest() already clamps to that band).
export * from '../actor-gen/tex.mjs';
import { make, nearest } from '../actor-gen/tex.mjs';
import * as S from '../scene-gen/tex.mjs';

/** Quantize a scene-gen RGB texture ({w,h,rgb:Uint8Array}) into a TMAP by
 *  nearest socpal match — wood/carpet/wallpaper/etc. become prop-usable. */
export function fromRgb(t) {
  const px = new Uint8Array(t.w * t.h);
  for (let i = 0; i < px.length; i++)
    px[i] = nearest(t.rgb[i * 3], t.rgb[i * 3 + 1], t.rgb[i * 3 + 2]);
  return { w: t.w, h: t.h, px };
}

// Scene-gen patterns lifted to indexed form — see tools/scene-gen/tex.mjs
// for the full option lists ({base, seed, ...}).
export const wood = (w, h, o) => fromRgb(S.wood(w, h, o));
export const brick = (w, h, o) => fromRgb(S.brick(w, h, o));
export const stone = (w, h, o) => fromRgb(S.stone(w, h, o));
export const rust = (w, h, o) => fromRgb(S.rust(w, h, o));
export const scrub = (w, h, o) => fromRgb(S.scrub(w, h, o));
export const rough = (w, h, o) => fromRgb(S.rough(w, h, o));
export const wallpaper = (w, h, o) => fromRgb(S.wallpaper(w, h, o));
export const carpet = (w, h, o) => fromRgb(S.carpet(w, h, o));

/** Two-tone plaid — warp/weft bands with darker crossings (blankets). */
export function plaid(w, h, { a, b, xw = 8, yw = 8 } = {}) {
  return make(w, h, (x, y) => {
    const ix = Math.floor(x / xw) % 2, iy = Math.floor(y / yw) % 2;
    return ix === iy ? a : b;
  });
}
