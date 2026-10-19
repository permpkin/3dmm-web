// Cowboy western town — detailed main-street set, 6 camera angles.
// Polygonal models (lathe/extrude/tube/sphere), textured + bump-mapped,
// sun shadow map, hemisphere ambient.
// Units are world-space (y-up); actors stand ~40-60 tall, ground is y=0.
// Tri colors are 0..255 multipliers (255,255,255 = full texture).
import * as T from '../../tex.mjs';
import { fbm } from '../../tex.mjs';

const texWoodV = T.wood(96, 96, { base: [172, 126, 78], plank: 12, vertical: true });
const texWoodH = T.wood(96, 96, { base: [158, 112, 66], plank: 12, vertical: false, seed: 8 });
const texWoodDk = T.wood(96, 96, { base: [112, 76, 48], gap: [54, 36, 22], plank: 12, vertical: true, seed: 9 });
const texShingle = T.shingles(96, 96, { base: [104, 78, 58], seed: 13 });
const texSand = T.sand(128, 128, { base: [206, 172, 118], dark: [172, 138, 92], seed: 5 });
const texDirt = T.sand(128, 128, { base: [180, 144, 96], dark: [142, 110, 70], seed: 6 });
const texStone = T.stone(96, 96, { base: [148, 142, 130], seed: 11 });
const texBrick = T.brick(96, 96, { brick: [152, 76, 52], seed: 4 });
const texRust = T.rust(64, 64, { seed: 17 });
const texScrub = T.scrub(64, 64, { seed: 23 });
const texPlaster = T.rough(64, 64, { base: [204, 188, 156], contrast: 0.2, seed: 31 });

export default {
  name: 'AI Cowboy Western',
  desc: 'A desert western main street — storefronts, telegraph poles, rolling hills; six camera angles.',
  fileName: 'cowboy_western',
  cnoBase: 710000,
  indexBase: 157,

  // declared ramps cover every scene hue; median-cut fills the remaining slots
  palette: [
    { base: [206, 172, 118], shades: [0.62, 0.78, 0.92, 1.0, 1.1] },  // sand
    { base: [172, 138, 92], shades: [0.72, 0.9, 1.05] },             // sand shadow
    { base: [180, 144, 96], shades: [0.7, 0.88, 1.0, 1.1] },         // street dirt
    { base: [172, 126, 78], shades: [0.6, 0.78, 0.92, 1.05, 1.15] }, // wood mid
    { base: [158, 112, 66], shades: [0.75, 0.95, 1.1] },             // wood h
    { base: [112, 76, 48], shades: [0.7, 0.9, 1.1, 1.3] },           // wood dark
    { base: [104, 78, 58], shades: [0.75, 0.95, 1.1] },              // shingles
    { base: [142, 62, 45], shades: [0.6, 0.8, 1.0, 1.15] },          // saloon red
    { base: [183, 97, 70], shades: [0.85, 1.1] },                    // faded red
    { base: [148, 142, 130], shades: [0.65, 0.82, 1.0, 1.12] },      // stone
    { base: [152, 76, 52], shades: [0.8, 1.05] },                    // brick
    { base: [204, 188, 156], shades: [0.7, 0.88, 1.0, 1.1] },        // plaster
    { base: [150, 88, 52], shades: [0.7, 0.9, 1.1] },                // rust
    { base: [62, 122, 56], shades: [0.6, 0.8, 1.0, 1.2] },           // cactus
    { base: [94, 108, 60], shades: [0.7, 1.0, 1.25] },               // scrub
    { base: [118, 78, 84], shades: [0.7, 0.9, 1.1] },                // mesa dark
    { base: [150, 112, 96], shades: [0.85, 1.1] },                   // mesa light
    { base: [92, 144, 214], shades: [0.85, 1.0, 1.08] },             // sky blue
    { base: [238, 208, 158], shades: [0.95, 1.02] },                 // horizon haze
    { base: [244, 242, 232], shades: [0.92, 1.0] },                  // cloud
    { base: [44, 42, 52], shades: [1.0, 1.5, 2.0] },                 // window dark
    { base: [88, 84, 80], shades: [0.8, 1.2] },                      // metal
  ],

  sky: { top: [92, 144, 214], horizon: [238, 208, 158] },
  skyFn: (() => {
    const top = [92, 144, 214], hor = [238, 208, 158];
    return (x, y) => {
      const t = y / 305;
      const c = [0, 1, 2].map((k) => top[k] + (hor[k] - top[k]) * t);
      const dx = (x - 336) / 200, dy = (y - 66) / 140;
      const g = Math.exp(-(dx * dx + dy * dy) * 4.0) * 20;
      const cl = fbm(x * 0.012, y * 0.028, 4, 41);
      const band = Math.max(0, 1 - Math.abs(y - 172) / 90);
      const cw = Math.max(0, cl - 0.62) * 2.4 * band;
      return [
        Math.min(255, c[0] + g + cw * (244 - c[0])),
        Math.min(255, c[1] + g + cw * (240 - c[1])),
        Math.min(255, c[2] + g * 0.6 + cw * (232 - c[2]))];
    };
  })(),
  ambSky: [0.42, 0.48, 0.60],
  ambGnd: [0.38, 0.30, 0.22],
  ss: 2,                 // 2x supersampled AA
  shadowSoft: 1.4,       // PCF kernel radius (light-space texels)
  bumpScale: 2.0,
  specI: 26,
  shadowOpacity: 0.5,
  shadowSize: 768,
  dither: 12,

  lights: [
    { dir: [0.55, 0.72, 0.42], intensity: 1.05, col: [1.0, 0.93, 0.78], type: 1 },   // warm sun
    { dir: [-0.62, 0.38, -0.3], intensity: 0.35, col: [0.55, 0.68, 0.95], type: 1 }, // cool sky fill
  ],

  cameras: [
    // NOTE: look.y must stay below pos.y — actor dragging raycasts against the
    // ground plane, so up-looking cameras can't resolve ground clicks at all.
    { pos: [-78, 26, -138], look: [20, 8, 20], fov: 55, name: 'SW corner' },
    { pos: [78, 26, 138], look: [-20, 8, -20], fov: 55, name: 'NE corner' },
    { pos: [-135, 22, -4], look: [55, 6, 0], fov: 50, name: 'Street west' },
    { pos: [135, 22, 4], look: [-55, 6, 0], fov: 50, name: 'Street east' },
    { pos: [-165, 64, -125], look: [20, 12, 10], fov: 50, name: 'High SW' },
    { pos: [165, 64, 125], look: [-20, 12, -10], fov: 50, name: 'High NE' },
  ],

  build(tris, g) {
    const { box, cyl, cone, quad, frustum, heightfield, prism, sphere, beam, stairs, lathe, extrude, tube, capsule, archOutline } = g;
    const W = [255, 255, 255];
    const P = {
      wood: [120, 82, 52], red: [142, 62, 45], win: [44, 42, 52],
      cactus: [62, 122, 56], mesa: [132, 96, 98], cloud: [244, 242, 232],
      trim: [140, 107, 77], frame: [128, 96, 66], sill: [128, 97, 66],
      metal: [88, 84, 80], rope: [150, 128, 90], iron: [56, 52, 48],
      water: [64, 89, 102], canvas: [217, 204, 173],
    };

    // --- terrain ------------------------------------------------------------
    // guaranteed ground to the horizon: a flat desert slab sits just under the
    // heightfield (field min is -1.5) so no camera ever sees sky-through-terrain
    quad(tris, [-4000, -2, 4000], [4000, -2, 4000], [4000, -2, -4000], [-4000, -2, -4000], [242, 235, 217], { tex: texSand, uvScale: 160 });
    heightfield(tris, 0, 0, 3200, 3200, 30, 30, (x, z) => {
      const d = Math.max(0, Math.abs(z) - 46);
      const roll = fbm(x * 0.004 + 9, z * 0.004, 3, 3) * 26 - 6;
      const edge = Math.max(0, Math.abs(x) - 300) * 0.012;
      return Math.max(-1.5, roll * Math.min(1, d / 120) + Math.min(14, edge));
    }, W, { tex: texSand, uvScale: 90 });
    quad(tris, [-280, 0.25, 44], [280, 0.25, 44], [280, 0.25, -44], [-280, 0.25, -44], W, { tex: texDirt, uvScale: 46 });
    for (const zc of [-14, 16]) {
      quad(tris, [-270, 0.4, zc - 3], [270, 0.4, zc - 3], [270, 0.4, zc - 6], [-270, 0.4, zc - 6], [158, 158, 158], { tex: texDirt, uvScale: 46 });
      quad(tris, [-270, 0.4, zc + 3], [270, 0.4, zc + 3], [270, 0.4, zc + 6], [-270, 0.4, zc + 6], [158, 158, 158], { tex: texDirt, uvScale: 46 });
    }

    // mesas — layered strata
    const mesa = (x, z, w, d, h, ry) => {
      frustum(tris, x, h * 0.24, z, w, d, w * 0.86, d * 0.86, h * 0.48, [112, 74, 76], { ry });
      frustum(tris, x, h * 0.62, z, w * 0.84, d * 0.84, w * 0.7, d * 0.7, h * 0.3, [138, 96, 92], { ry: ry + 0.02 });
      frustum(tris, x, h * 0.88, z, w * 0.68, d * 0.68, w * 0.55, d * 0.55, h * 0.22, [150, 112, 96], { ry });
    };
    mesa(-560, 460, 300, 170, 150, 0.3);
    mesa(600, 420, 340, 200, 170, -0.2);
    mesa(-520, -500, 260, 160, 130, 0.5);
    mesa(140, 680, 220, 140, 110, 0.1);
    mesa(680, -360, 240, 150, 120, -0.4);
    mesa(-90, -700, 200, 130, 95, 0.7);

    // clouds — unlit squashed spheres
    const cloud = (x, y, z, s) => {
      sphere(tris, x, y, z, 34 * s, 9, P.cloud, { squash: [1.6, 0.55, 1], seed: x | 1, unlit: true });
      sphere(tris, x + 26 * s, y + 6 * s, z + 8 * s, 26 * s, 8, P.cloud, { squash: [1.4, 0.6, 1], seed: x | 7, unlit: true });
      sphere(tris, x - 28 * s, y + 4 * s, z - 6 * s, 24 * s, 8, P.cloud, { squash: [1.3, 0.55, 1], seed: x | 13, unlit: true });
    };
    cloud(-300, 210, 420, 1.1); cloud(300, 235, -460, 1.25); cloud(-120, 250, -560, 0.9);
    cloud(420, 190, 300, 0.85); cloud(-420, 220, -260, 0.95);

    // --- detail kit ----------------------------------------------------------
    const barrel = (x, z, r, h) => {
      lathe(tris, x, h / 2 + 0.8, z, [
        [0, -h / 2], [r * 0.82, -h / 2], [r, -h * 0.32], [r * 1.08, 0],
        [r, h * 0.32], [r * 0.82, h / 2], [0, h / 2]], 10, W, { tex: texWoodV, uvScale: 9 });
      for (const fy of [-0.28, 0.02, 0.3])
        cyl(tris, x, h / 2 + 0.8 + fy * h, z, r * 1.1, 0.7, 10, P.iron);
    };
    /** Turned hitching/post — lathe profile with collar rings. */
    const turned = (x, y, z, r, h) =>
      lathe(tris, x, y + h / 2, z, [
        [0, -h / 2], [r * 1.4, -h / 2], [r * 1.4, -h / 2 + 1], [r, -h / 2 + 1.6],
        [r, h / 2 - 2.2], [r * 1.35, h / 2 - 1.4], [r * 1.35, h / 2 - 0.6],
        [r * 0.7, h / 2], [0, h / 2]], 9, [115, 87, 61]);
    /** Framed window — recess, jambs, sill, crossbars, optional arch top. */
    const win = (x, y, z, face, w = 6.5, h = 8, arch = false) => {
      const o = 0.55;
      if (arch) {
        extrude(tris, x, y - h / 2, z + face * o, archOutline(w - 1.2, h - 1.8, 1.6), 0.9, P.win, { ry: face > 0 ? 0 : Math.PI });
      } else {
        box(tris, x, y, z + face * o, w - 1.2, h - 1.2, 0.9, P.win);
      }
      for (const s of [-1, 1]) box(tris, x + s * (w / 2 - 0.5), y, z + face * (o + 0.35), 1.1, h, 0.7, P.frame);
      box(tris, x, y + h / 2 - 0.5, z + face * (o + 0.35), w, 1.1, 0.7, P.frame);
      box(tris, x, y - h / 2, z + face * (o + 0.5), w + 1.4, 1.0, 1.6, P.sill);
      box(tris, x, y, z + face * (o + 0.3), w - 1.2, 0.7, 0.5, P.trim);
      box(tris, x, y, z + face * (o + 0.3), 0.7, h - 1.2, 0.5, P.trim);
    };
    /** Paneled door — recess, leaf with raised panels, frame, knob, step. */
    const door = (x, z, face, w = 7.5, h = 10.5) => {
      box(tris, x, h / 2, z + face * 0.55, w - 1.0, h - 0.8, 0.9, P.win);
      box(tris, x, h / 2 - 0.4, z + face * 0.8, w - 2.2, h - 1.8, 0.5, W, { tex: texWoodDk, uvScale: 12 });
      for (const py of [h * 0.28, h * 0.62]) // raised panels
        box(tris, x, py, z + face * 1.06, w - 3.8, h * 0.26, 0.25, [74, 52, 32]);
      for (const s of [-1, 1]) box(tris, x + s * (w / 2 - 0.55), h / 2, z + face * 0.85, 1.2, h, 0.7, P.frame);
      box(tris, x, h - 0.55, z + face * 0.85, w, 1.2, 0.7, P.frame);
      box(tris, x, 0.4, z + face * 0.9, w + 1.6, 0.9, 1.6, P.sill);
      sphere(tris, x + w * 0.28, h * 0.48, z + face * 1.15, 0.55, 5, [191, 168, 115], { smooth: false });
    };
    /** Boardwalk: plank platform, posts, kick plate, steps. */
    const boardwalk = (x, z, face, w, dep = 10) => {
      const zf = z + face * dep / 2;
      box(tris, x, 1.5, zf, w, 1.4, dep, W, { tex: texWoodH, uvScale: 18 });
      for (let i = 0; i <= Math.round(w / 9); i++) // stilt posts
        box(tris, x - w / 2 + (w / Math.round(w / 9)) * i, 0.7, z + face * (dep - 0.9), 1.3, 1.6, 1.3, [89, 66, 46]);
      box(tris, x, 2.3, z + face * dep, w, 0.7, 0.5, [89, 66, 46]);      // edge strip
      box(tris, x, 0.5, z + face * (dep + 0.8), w * 0.35, 1.0, 1.7, P.sill); // step
    };
    /** Porch rail: top rail + turned balusters between posts. */
    const porchRail = (x, z, face, w, y = 0) => {
      const zf = z + face * 8.4;
      const n = Math.round(w / 3.4);
      for (let i = 0; i <= n; i++) turned(x - w / 2 + (w / n) * i, 1.2, zf, 0.65, 5.6);
      tube(tris, [[x - w / 2, 6.6, zf], [x + w / 2, 6.6, zf]], 0.7, 7, P.trim);
    };
    /** Ornate false front: extruded silhouette (stepped/scrolled parapet). */
    const falseFront = (x, z, face, w, h, style, tint) => {
      const hH = h + 10;
      const shapes = {
        step: [[-w / 2, 0], [w / 2, 0], [w / 2, hH * 0.62], [w * 0.3, hH * 0.62], [w * 0.3, hH * 0.8],
          [w * 0.12, hH * 0.8], [w * 0.12, hH], [-w * 0.12, hH], [-w * 0.12, hH * 0.8],
          [-w * 0.3, hH * 0.8], [-w * 0.3, hH * 0.62], [-w / 2, hH * 0.62]],
        curve: [[-w / 2, 0], [w / 2, 0], [w / 2, hH * 0.58], [w * 0.38, hH * 0.66], [w * 0.26, hH * 0.76],
          [w * 0.18, hH * 0.86], [w * 0.16, hH], [-w * 0.16, hH], [-w * 0.18, hH * 0.86],
          [-w * 0.26, hH * 0.76], [-w * 0.38, hH * 0.66], [-w / 2, hH * 0.58]],
        peak: [[-w / 2, 0], [w / 2, 0], [w / 2, hH * 0.6], [w * 0.06, hH * 0.9], [0, hH],
          [-w * 0.06, hH * 0.9], [-w / 2, hH * 0.6]],
      };
      // extrude along z: rotate for -z faces
      extrude(tris, x, 0, z + face * 1.4, shapes[style], 2.0, tint, { ry: face < 0 ? Math.PI : 0, tex: texWoodDk, uvScale: 26 });
      box(tris, x, hH + 0.5, z + face * 1.4, 3.2, 1.2, 2.8, P.iron); // finial base
      sphere(tris, x, hH + 1.9, z + face * 1.4, 1.1, 6, [191, 168, 115]);
    };

    // --- buildings ------------------------------------------------------------
    const building = (x, z, w, d, h, tint, wallTex, face, style = 'step') => {
      box(tris, x, h / 2, z, w, h, d, tint, { tex: wallTex, uvScale: 26 });
      prism(tris, x, h, z, w * 0.94, h * 0.22, d * 0.9, [82, 64, 51], { tex: texShingle, uvScale: 26 });
      falseFront(x, z + face * (d / 2), face, w + 1.2, h, style, tint);
      // cornice: band + dentil row under the parapet lip
      box(tris, x, h * 0.94, z + face * (d / 2 + 2.5), w + 1.6, 1.0, 1.4, P.frame);
      for (let i = 0; i < Math.round(w / 3); i++)
        box(tris, x - w / 2 + 1.5 + (w / Math.round(w / 3)) * i, h * 0.9, z + face * (d / 2 + 2.6), 1.0, 1.1, 1.0, P.trim);
      // porch: shingle awning + turned posts + rail
      box(tris, x, h * 0.62, z + face * (d / 2 + 5.2), w + 2.4, 1.1, 10.5, W, { tex: texShingle, uvScale: 22 });
      for (const s of [-1, 1])
        turned(x + s * (w / 2 - 2), 1.2, z + face * (d / 2 + 9), 0.85, h * 0.6);
      porchRail(x, z + face * (d / 2 + 1.2), face, w - 6);
      boardwalk(x, z, face, w + 3, 10);
      door(x - w * 0.18, z + face * (d / 2), face);
      win(x + w * 0.26, h * 0.42, z + face * (d / 2), face);
      win(x - w * 0.38, h * 0.42, z + face * (d / 2), face);
      // plainer rear
      win(x + w * 0.2, h * 0.5, z - face * (d / 2), -face, 5.5, 7);
      win(x - w * 0.2, h * 0.5, z - face * (d / 2), -face, 5.5, 7);
      door(x + w * 0.32, z - face * (d / 2), -face, 6.5, 9.5);
      // sign: extruded shaped board on the parapet
      extrude(tris, x, h + 3.4, z + face * (d / 2 + 2.6),
        [[-w * 0.3, 0], [w * 0.3, 0], [w * 0.3, 4.4], [w * 0.24, 6.2], [-w * 0.24, 6.2], [-w * 0.3, 4.4]],
        0.9, [196, 180, 142], { ry: face < 0 ? Math.PI : 0, tex: texPlaster, uvScale: 10 });
      // alley clutter
      box(tris, x + w / 2 + 3.4, 2.6, z + face * (d / 2 - 4), 5.4, 5.2, 5.4, W, { tex: texWoodH, uvScale: 12 });
      box(tris, x + w / 2 + 3.2, 7.3, z + face * (d / 2 - 4.5), 4.4, 4.2, 4.4, W, { tex: texWoodH, uvScale: 10, ry: 0.2 });
      barrel(x - w / 2 - 3.4, z + face * (d / 2 - 5), 2.6, 7);
    };

    building(-32, 62, 44, 30, 34, [183, 87, 71], texWoodV, -1, 'curve');  // saloon
    building(16, 62, 32, 28, 28, [255, 255, 255], texStone, -1, 'step');  // bank
    building(60, 62, 36, 30, 30, [230, 204, 158], texWoodV, -1, 'peak');  // general store
    building(-48, -62, 48, 32, 44, [255, 255, 255], texPlaster, 1, 'step'); // hotel
    building(2, -62, 28, 26, 26, [204, 168, 128], texWoodV, 1, 'peak');    // gunsmith
    building(46, -62, 30, 26, 28, [242, 217, 178], texWoodH, 1, 'curve');  // barber

    // hotel: upstairs windows + full balcony with rail
    for (const s of [-1, 0, 1]) win(-48 + s * 13, 35, -62 + 16.9, 1, 6, 8);
    box(tris, -48, 26, -62 + 19.5, 46, 1.4, 8, W, { tex: texWoodH, uvScale: 18 });
    const railN = 11;
    for (let i = 0; i <= railN; i++) turned(-48 - 22 + (44 / railN) * i, 26.5, -62 + 23.2, 0.55, 4.4);
    tube(tris, [[-70, 30.4, -62 + 23.2], [-26, 30.4, -62 + 23.2]], 0.6, 7, P.trim);
    tube(tris, [[-70, 28.6, -62 + 23.2], [-26, 28.6, -62 + 23.2]], 0.45, 6, P.trim);
    // bank: arched windows + brick chimney with cap
    win(9, 15, 62 - 14, -1, 7, 9, true); win(23, 15, 62 - 14, -1, 7, 9, true);
    box(tris, 26, 32, 66, 5, 12, 5, W, { tex: texBrick, uvScale: 14 });
    lathe(tris, 26, 38.8, 66, [[0, -0.6], [3.4, -0.4], [3.4, 0.4], [2.6, 1.0], [0, 1.0]], 8, [128, 97, 66]);
    stairs(tris, 10, 0, 49.4, 8, 0.55, 2.2, 3, -1, W, { tex: texStone, uvScale: 14 });

    // livery stable (+x end): barn, loft, hoist beam, crossbuck doors
    box(tris, 156, 15, 0, 34, 30, 32, [217, 153, 102], { tex: texWoodV, uvScale: 26 });
    prism(tris, 156, 30, 0, 34, 8, 32, [82, 64, 51], { tex: texShingle, uvScale: 26, ry: Math.PI / 2 });
    box(tris, 137.5, 7, 0, 1.4, 14, 12, P.win);
    for (const s of [-1, 1]) {
      box(tris, 137.2, 7, s * 3.2, 0.8, 13, 0.9, P.frame);
      box(tris, 137.0, 7, s * 1.6, 0.6, 12, 0.7, [183, 138, 92], { rot: [s * 0.35, 0, 0] }); // X brace
      box(tris, 137.0, 7, s * 1.6, 0.6, 12, 0.7, [183, 138, 92], { rot: [-s * 0.35, 0, 0] });
    }
    box(tris, 137.2, 7, 0, 0.8, 0.9, 12.6, P.frame);
    box(tris, 137.5, 22, 0, 1.2, 6, 6, P.win);
    beam(tris, [137, 28, -8], [137, 24, -2], 0.8, P.trim);
    // hay loft door frame + pulley
    box(tris, 137.2, 22, 0, 0.8, 7.4, 7.4, P.frame);
    cyl(tris, 137.4, 25.5, 0, 0.9, 0.7, 7, P.iron, { rz: Math.PI / 2 });

    // chapel (-x end): clapboard, tower, belfry arches, spire, cross
    box(tris, -156, 16, 0, 32, 32, 34, W, { tex: texPlaster, uvScale: 26 });
    prism(tris, -156, 32, 0, 32, 9, 34, [89, 71, 56], { tex: texShingle, uvScale: 26, ry: Math.PI / 2 });
    box(tris, -139, 20, 0, 8, 40, 9, W, { tex: texPlaster, uvScale: 20 });
    // belfry: four arched openings
    for (const [bx, bz, f] of [[-134.8, 0, -1], [-139, 4.9, 1], [-139, -4.9, -1]])
      extrude(tris, bx, 40, bz, archOutline(4, 4.5, 2.2), 1.2, P.win, { ry: f > 0 ? Math.PI / 2 : -Math.PI / 2 });
    cone(tris, -139, 50, 0, 7, 12, 4, [77, 61, 51]);
    box(tris, -139, 58.5, 0, 0.9, 6, 0.9, [230, 217, 178]);
    box(tris, -139, 59, 0, 0.9, 0.9, 3.6, [230, 217, 178]);
    extrude(tris, -134.6, 0, 0, archOutline(7.5, 9, 3.4), 1.2, P.win, { ry: -Math.PI / 2 });
    extrude(tris, -134.4, 0, 0, archOutline(6.2, 8.2, 2.8), 0.8, [128, 102, 77], { ry: -Math.PI / 2 });
    for (const s of [-1, 1]) win(-134.8, 18, s * 9, -1, 5, 9, true);

    // water tower — lathed tapered legs, X-braces, lathed tank, conical lid
    const wt = { x: -104, z: -112 };
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
      lathe(tris, wt.x + lx * 10, 13, wt.z + lz * 10, [[0, -13], [1.5, -13], [1.2, 0], [0.9, 13], [0, 13]], 8, [115, 84, 56]);
    for (const s of [-1, 1]) {
      beam(tris, [wt.x - 10, 4, wt.z + s * 10], [wt.x + 10, 20, wt.z + s * 10], 1.0, [107, 77, 51]);
      beam(tris, [wt.x + 10, 4, wt.z + s * 10], [wt.x - 10, 20, wt.z + s * 10], 1.0, [107, 77, 51]);
      beam(tris, [wt.x + s * 10, 4, wt.z - 10], [wt.x + s * 10, 20, wt.z + 10], 1.0, [107, 77, 51]);
      beam(tris, [wt.x + s * 10, 4, wt.z + 10], [wt.x + s * 10, 20, wt.z - 10], 1.0, [107, 77, 51]);
    }
    box(tris, wt.x, 25, wt.z, 27, 2.6, 27, W, { tex: texWoodH, uvScale: 18 });
    lathe(tris, wt.x, 34.5, wt.z, [
      [0, -8], [12.8, -8], [13.6, -5], [13.8, 0], [13.4, 5], [12.6, 7.5], [0, 7.5]],
      14, W, { tex: texRust, uvScale: 20 });
    for (const fy of [-4.5, 0, 4.5]) cyl(tris, wt.x, 34.5 + fy, wt.z, 14.0, 0.9, 14, P.iron);
    cone(tris, wt.x, 46.5, wt.z, 15, 8, 12, [77, 61, 51]);
    sphere(tris, wt.x, 51, wt.z, 1.2, 6, [191, 168, 115]);              // finial
    beam(tris, [wt.x + 11, 26, wt.z + 6], [wt.x + 14, 18, wt.z + 10], 1.4, P.metal);
    for (let i = 0; i < 9; i++)
      box(tris, wt.x - 11.4, 8 + i * 2.1, wt.z + 11.4, 0.5, 0.5, 2.4, [128, 97, 66]);
    beam(tris, [wt.x - 11.8, 2, wt.z + 11.8], [wt.x - 11.8, 27, wt.z + 11.8], 0.6, [128, 97, 66]);
    beam(tris, [wt.x - 11.0, 2, wt.z + 11.0], [wt.x - 11.0, 27, wt.z + 11.0], 0.6, [128, 97, 66]);

    // windmill — A-frame, multi-blade fan, tail vane
    const wm = { x: -176, z: 84 };
    for (const s of [-1, 1]) {
      beam(tris, [wm.x + s * 7, 0, wm.z + 5], [wm.x + s * 2, 30, wm.z], 1.2, [128, 102, 77]);
      beam(tris, [wm.x + s * 7, 0, wm.z - 5], [wm.x + s * 2, 30, wm.z], 1.2, [128, 102, 77]);
      beam(tris, [wm.x + s * 5, 12, wm.z + 3.4], [wm.x + s * 5, 12, wm.z - 3.4], 0.7, [128, 102, 77]);
      beam(tris, [wm.x + s * 3.4, 21, wm.z + 2.2], [wm.x + s * 3.4, 21, wm.z - 2.2], 0.7, [128, 102, 77]);
    }
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      box(tris, wm.x + Math.cos(a) * 6.8, 32 + Math.sin(a) * 6.8, wm.z - 2, 2.0, 8.0, 0.4,
        [204, 199, 189], { rot: [0, 0, a + Math.PI / 2], tex: texRust, uvScale: 8 });
    }
    lathe(tris, wm.x, 32, wm.z - 2, [[0, -1.2], [1.8, -1.2], [2.2, 0], [1.8, 1.2], [0, 1.2]], 9, P.iron, { });
    beam(tris, [wm.x, 32, wm.z], [wm.x, 31, wm.z + 9], 0.9, [128, 102, 77]);
    quad(tris, [wm.x, 33.5, wm.z + 9], [wm.x, 29.5, wm.z + 9], [wm.x, 29.5, wm.z + 15], [wm.x, 33.5, wm.z + 15], [204, 199, 189], { two: true, tex: texRust, uvScale: 8 });

    // telegraph poles — tapered lathe shafts, crossarm, insulators, sagging wire
    const poles = [];
    for (let i = 0; i < 5; i++) {
      const px = -120 + i * 64, pz = -80;
      lathe(tris, px, 21, pz, [[0, -21], [1.3, -21], [1.1, -8], [0.9, 8], [0.7, 21], [0, 21]], 8, [89, 66, 46]);
      box(tris, px, 38.5, pz, 1.2, 1.2, 11, [89, 66, 46]);
      for (const s of [-1, 1]) {
        cyl(tris, px, 39.0, pz + s * 4.6, 0.35, 0.9, 6, [89, 66, 46]);
        sphere(tris, px, 39.6, pz + s * 4.6, 0.8, 6, [217, 230, 242], { smooth: false });
      }
      poles.push(px);
    }
    for (let i = 0; i + 1 < poles.length; i++) for (const s of [-1, 1]) {
      const z = -80 + s * 4.6, x0 = poles[i], x1 = poles[i + 1];
      const pt = (t) => [x0 + (x1 - x0) * t, 39.4 - Math.sin(t * Math.PI) * 3.2, z];
      tube(tris, [pt(0), pt(0.33), pt(0.66), pt(1)], 0.26, 5, P.win);
    }

    // hitch rails + troughs
    for (const [hx, hz] of [[-32, 38], [58, 38], [-48, -38], [16, 38]]) {
      for (const s of [-1, 0, 1]) turned(hx + s * 8, 0, hz, 0.75, 6.8);
      tube(tris, [[hx - 8, 6.4, hz], [hx + 8, 6.4, hz]], 0.65, 7, [102, 77, 51]);
      // open trough: walls + water surface
      const tx = hx + 12, tz = hz + 1;
      for (const [dx, dz, w, d] of [[0, -1.6, 7.5, 0.7], [0, 1.6, 7.5, 0.7], [-3.4, 0, 0.7, 3.4], [3.4, 0, 0.7, 3.4]])
        box(tris, tx + dx, 1.9, tz + dz, w, 3.8, d, W, { tex: texWoodDk, uvScale: 8 });
      quad(tris, [tx - 3.1, 3.2, tz + 1.3], [tx + 3.1, 3.2, tz + 1.3], [tx + 3.1, 3.2, tz - 1.3], [tx - 3.1, 3.2, tz - 1.3], P.water, { shine: 0.9 });
    }

    // covered wagon — lathed wheels (rim+spokes), canvas hoops, bed, tongue
    const wg = { x: -8, z: 26, ry: 0.18 };
    box(tris, wg.x, 6.5, wg.z, 15, 5, 8.5, W, { tex: texWoodDk, uvScale: 12, rot: [0, wg.ry, 0] });
    // side rails
    box(tris, wg.x, 9.4, wg.z + 4.1, 15, 0.8, 0.6, [115, 87, 61], { rot: [0, wg.ry, 0] });
    box(tris, wg.x, 9.4, wg.z - 4.1, 15, 0.8, 0.6, [115, 87, 61], { rot: [0, wg.ry, 0] });
    for (const [ox, oz] of [[-5.5, 4.6], [5.5, 4.6], [-5.5, -4.6], [5.5, -4.6]]) {
      // rim: closed tube circle in the XY plane, hub + 6 spokes
      const rim = [];
      for (let k = 0; k <= 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        rim.push([wg.x + ox + Math.cos(a) * 3.4, 3.4 + Math.sin(a) * 3.4, wg.z + oz]);
      }
      tube(tris, rim, 0.55, 7, [77, 56, 38], { closed: true });
      cyl(tris, wg.x + ox, 3.4, wg.z + oz, 0.9, 1.6, 7, P.iron, { rx: Math.PI / 2 });
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        beam(tris, [wg.x + ox, 3.4, wg.z + oz],
          [wg.x + ox + Math.cos(a) * 3.1, 3.4 + Math.sin(a) * 3.1, wg.z + oz], 0.4, [77, 56, 38]);
      }
    }
    for (const ox of [-4, 0, 4]) // canvas bows — arched tubes
      tube(tris, [[wg.x + ox, 8, wg.z - 4.2], [wg.x + ox, 12.4, wg.z - 2], [wg.x + ox, 13.4, wg.z],
        [wg.x + ox, 12.4, wg.z + 2], [wg.x + ox, 8, wg.z + 4.2]], 0.45, 6, [128, 102, 77]);
    // canvas roof: peaked strip over the bows
    prism(tris, wg.x, 9.4, wg.z, 12.6, 4.4, 8.6, P.canvas, { ry: 0 });
    beam(tris, [wg.x + 7.5, 4, wg.z + 1.5], [wg.x + 16, 2.4, wg.z + 3.5], 1.0, [102, 77, 51]);

    // barrels & crates by porches
    barrel(44, 44, 2.6, 7); barrel(49, 46, 2.2, 6); barrel(-58, -44, 2.6, 7);
    barrel(-20, 40, 2.4, 6.5);
    box(tris, -18, 3, -44, 5.5, 6, 5.5, W, { tex: texWoodH, uvScale: 11 });
    box(tris, -24, 2.4, -42, 4.5, 4.8, 4.5, W, { tex: texWoodH, uvScale: 10, ry: 0.3 });
    box(tris, -21, 7.2, -43.5, 4.2, 4.0, 4.2, W, { tex: texWoodH, uvScale: 9, ry: -0.15 });

    // lamp posts — turned post + arm + lathed lantern
    for (const [lx, lz] of [[-70, 34], [70, -34]]) {
      turned(lx, 0, lz, 0.9, 18);
      box(tris, lx, 17.5, lz, 1.0, 1.0, 7, [77, 56, 41]);
      beam(tris, [lx, 17, lz + 2.4], [lx, 16, lz + 2.4], 0.4, [77, 56, 41]);
      lathe(tris, lx, 15.4, lz + 2.4, [
        [0, -1.6], [1.3, -1.5], [1.5, -0.6], [1.5, 0.8], [1.1, 1.4], [0, 1.5]],
        8, [242, 217, 140], { shine: 0.7 });
      cone(tris, lx, 17.2, lz + 2.4, 1.9, 1.4, 6, [77, 56, 41]);
    }

    // cacti — capsule trunk + elbowed capsule arms
    const cactus = (x, z, s, seed) => {
      capsule(tris, x, 10 * s, z, 2.6 * s, 17 * s, 9, P.cactus, { tex: texScrub, uvScale: 8 });
      for (const [arm, dir] of [[0, -1], [1, 1]]) {
        if (fbm(x * 0.1, z * 0.1 + arm, 2, seed) < 0.4) continue;
        const ax = x + dir * 4.4 * s, ay = (8.5 + arm * 2) * s;
        capsule(tris, x + dir * 2.4 * s, ay, z, 1.75 * s, 3.4 * s, 7, P.cactus, { }); // elbow
        capsule(tris, ax, ay + 3.6 * s, z, 1.7 * s, 6.4 * s, 7, P.cactus);
      }
    };
    cactus(-140, 112, 1.3, 1); cactus(150, -122, 1.05, 2); cactus(118, 142, 0.9, 3);
    cactus(-176, -84, 1.15, 4); cactus(196, 88, 0.85, 5); cactus(-90, 160, 1.0, 6);

    // rocks + scrub + tumbleweed
    const rock = (x, z, r, seed) =>
      sphere(tris, x, r * 0.4, z, r, 10, [158, 148, 133], { jag: 0.45, squash: [1.2, 0.7, 1], seed, tex: texStone });
    rock(-98, 96, 9, 11); rock(88, 106, 7, 12); rock(168, -70, 11, 13);
    rock(-190, 30, 8, 14); rock(70, -108, 6, 15); rock(230, 40, 13, 16);
    rock(-250, -120, 12, 17); rock(40, 130, 5, 18);
    const bush = (x, z, r, seed) =>
      sphere(tris, x, r * 0.5, z, r, 8, [255, 255, 255], { jag: 0.35, squash: [1.25, 0.6, 1.1], seed, tex: texScrub });
    bush(-60, 96, 6, 21); bush(30, 88, 5, 22); bush(100, -90, 7, 23); bush(-130, -60, 6, 24);
    bush(178, 104, 8, 25); bush(-210, -40, 7, 26); bush(60, 120, 5, 27); bush(-40, -100, 5, 28);
    bush(140, 60, 6, 29); bush(-220, 140, 9, 30);
    sphere(tris, 44, 4.4, 18, 5, 8, [158, 133, 92], { jag: 0.55, seed: 33 });

    // split-rail fences — zigzag rails
    const fence = (x0, z0, x1, z1, n) => {
      const dx = (x1 - x0) / n, dz = (z1 - z0) / n;
      for (let i = 0; i <= n; i++) turned(x0 + dx * i, 0, z0 + dz * i, 0.7, 7.2);
      for (const y of [5.2, 3.0])
        beam(tris, [x0, y, z0], [x1, y + 0.5, z1], 1.0, [115, 87, 61]);
    };
    fence(-196, 116, -126, 124, 8);
    fence(124, -122, 196, -112, 8);
    fence(210, 60, 240, -10, 4);
    fence(-240, -30, -216, -90, 4);
  },
};
