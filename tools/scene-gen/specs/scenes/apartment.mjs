// Apartment interior — one-room living space, 6 camera angles.
// Enclosed set: window wall (north, -z) shows a skyline backdrop outside,
// door wall (south, +z), bookshelf wall (east), sofa wall (west).
// Actors stand ~40-60 tall; ceiling at y=100, floor y=0.
// Tri colors are 0..255 multipliers (255,255,255 = full texture).
import * as T from '../../tex.mjs';
import { fbm } from '../../tex.mjs';

const texFloor = T.wood(96, 96, { base: [168, 126, 82], gap: [96, 66, 40], plank: 10, vertical: false, seed: 2 });
const texWall = T.wallpaper(96, 96, { base: [206, 196, 172], stripe: [188, 172, 144], band: 9 });
const texWains = T.wood(64, 64, { base: [150, 116, 80], plank: 8, vertical: true, seed: 12 });
const texCarpet = T.carpet(96, 96, { base: [158, 96, 70], dark: [122, 68, 48] });
const texSofa = T.carpet(64, 64, { base: [86, 118, 112], dark: [62, 90, 86], seed: 41 });
const texCurtain = T.stripes(64, 96, { a: [172, 96, 74], b: [142, 72, 54], sw: 8 });
const texLeaf = T.scrub(64, 64, { base: [94, 122, 66], dark: [58, 80, 40], seed: 55 });
const texPlaster = T.rough(64, 64, { base: [214, 208, 192], contrast: 0.12, seed: 31 });
const texBook = T.rough(32, 64, { base: [190, 180, 160], contrast: 0.3, seed: 45 });

export default {
  name: 'AI Apartment Interior',
  desc: 'A small apartment interior — couch, bookshelf, lamp, TV and bed; six camera angles.',
  fileName: 'apartment',
  cnoBase: 711000,
  indexBase: 157,
  worldScale: 0.5,  // model is ~2x actor scale; halve so ceiling ≈ 50 vs actors ~40

  palette: [
    { base: [168, 126, 82], shades: [0.6, 0.78, 0.92, 1.05, 1.15] },  // floor oak
    { base: [150, 116, 80], shades: [0.7, 0.9, 1.1] },               // wainscot
    { base: [206, 196, 172], shades: [0.7, 0.88, 1.0, 1.08] },       // wallpaper
    { base: [188, 172, 144], shades: [0.85, 1.05] },                 // wallpaper stripe
    { base: [214, 208, 192], shades: [0.8, 1.0, 1.06] },             // ceiling plaster
    { base: [236, 230, 216], shades: [0.8, 1.0, 1.08] },             // trim white
    { base: [158, 96, 70], shades: [0.65, 0.85, 1.0, 1.12] },        // rug rust
    { base: [86, 118, 112], shades: [0.6, 0.82, 1.0, 1.15] },        // sofa teal
    { base: [172, 96, 74], shades: [0.7, 0.9, 1.1] },                // curtain
    { base: [120, 82, 52], shades: [0.7, 0.9, 1.1, 1.3] },           // dark wood
    { base: [66, 58, 52], shades: [1.0, 1.5, 2.0] },                 // dark inset
    { base: [142, 62, 45], shades: [0.8, 1.0, 1.15] },               // book red
    { base: [62, 92, 142], shades: [0.8, 1.1] },                     // book blue
    { base: [88, 118, 66], shades: [0.8, 1.1] },                     // book green
    { base: [196, 168, 92], shades: [0.85, 1.1] },                   // book gold
    { base: [120, 76, 96], shades: [0.85, 1.1] },                    // book plum
    { base: [196, 150, 92], shades: [0.8, 1.05] },                   // brass
    { base: [96, 96, 100], shades: [0.8, 1.2] },                     // metal
    { base: [226, 238, 250], shades: [0.9, 1.0] },                   // outside sky
    { base: [156, 168, 184], shades: [0.8, 1.0, 1.15] },             // skyline
    { base: [72, 122, 62], shades: [0.7, 1.0, 1.25] },               // plant green
    { base: [244, 240, 220], shades: [1.0] },                        // warm light
    { base: [44, 42, 52], shades: [1.0, 1.6] },                      // picture dark
  ],

  sky: { top: [236, 230, 216], horizon: [206, 196, 172] }, // warm fallback (leaks read as plaster)
  ambSky: [0.52, 0.50, 0.42],   // interior bounce — warm ceiling light
  ambGnd: [0.40, 0.33, 0.26],   // floor bounce
  bumpScale: 1.6,
  specI: 30,
  shadowOpacity: 0.45,
  shadowSize: 1024,
  shadowSoft: 1.4,
  ss: 2,
  dither: 12,

  lights: [
    { dir: [-0.22, 0.58, -0.78], intensity: 1.0, col: [1.0, 0.95, 0.82], type: 1 }, // warm sun through the north windows
    { dir: [0.35, 0.5, 0.75], intensity: 0.4, col: [0.7, 0.78, 0.95], type: 1 },    // cool interior fill
  ],

  cameras: [
    // NOTE: look.y must stay below pos.y — actor dragging raycasts against the
    // ground plane, so up-looking cameras can't resolve ground clicks at all.
    { pos: [-90, 52, 58], look: [20, 25, -30], fov: 58, name: 'SW corner' },
    { pos: [90, 52, -58], look: [-25, 28, 30], fov: 58, name: 'NE corner' },
    { pos: [0, 40, 62], look: [0, 24, -50], fov: 58, name: 'Window wall' },
    { pos: [10, 40, -62], look: [-10, 25, 40], fov: 58, name: 'Door wall' },
    { pos: [88, 78, 55], look: [-40, 15, -30], fov: 55, name: 'High SE' },
    { pos: [-70, 26, 4], look: [55, 16, -8], fov: 55, name: 'Low west' },
  ],

  build(tris, g) {
    const { box, cyl, quad, frustum, sphere, beam, lathe, tube } = g;
    const W = [255, 255, 255];
    const P = {
      trim: [236, 230, 216], inset: [66, 58, 52], brass: [196, 150, 92],
      metal: [96, 96, 100], plant: [72, 122, 62], darkwood: [120, 82, 52],
      skyline: [156, 168, 184], outsidesky: [226, 238, 250], win: [44, 42, 52],
    };
    const FLOOR = { tex: texFloor, uvScale: 22 };
    const WALL = { tex: texWall, uvScale: 30 };
    const PLASTER = { tex: texPlaster, uvScale: 30 };
    const WAINS = { tex: texWains, uvScale: 18 };
    const DARK = { tex: texWains, uvScale: 18 };

    // === shell: floor, ceiling, walls =======================================
    quad(tris, [-110, 0, 75], [110, 0, 75], [110, 0, -75], [-110, 0, -75], W, { tex: texFloor, uvScale: 26 }); // floor
    box(tris, 0, 100.8, 0, 224, 2, 156, W, PLASTER);                            // ceiling
    // walls (thin boxes; room-facing surfaces are exterior faces)
    box(tris, -110, 50, 0, 4, 100, 152, W, WALL);                               // west
    box(tris, 110, 50, 0, 4, 100, 152, W, WALL);                                // east
    // north wall z=-75 with two window openings x[-65,-25] & [25,65], y[28,74]
    box(tris, 0, 14, -75, 224, 28, 4, W, WALL);                                 // below band
    box(tris, 0, 87.5, -75, 224, 25, 4, W, WALL);                               // header band
    box(tris, -88.5, 51, -75, 47, 46, 4, W, WALL);                              // left column
    box(tris, 0, 51, -75, 50, 46, 4, W, WALL);                                  // mid column
    box(tris, 88.5, 51, -75, 47, 46, 4, W, WALL);                               // right column
    // south wall z=+75 with door opening x[60,95], y[0,62]
    box(tris, -25, 50, 75, 174, 100, 4, W, WALL);                               // left of door
    box(tris, 77.5, 81, 75, 69, 38, 4, W, WALL);                                // above door
    box(tris, 103.5, 50, 75, 17, 100, 4, W, WALL);                              // right of door

    // baseboards + crown molding around the room
    for (const [bx, bz, w, d] of [[0, -72.6, 216, 1.6], [0, 72.6, 216, 1.6], [-107.6, 0, 1.6, 148], [107.6, 0, 1.6, 148]]) {
      box(tris, bx, 3, bz, w, 6, d, P.trim);
      box(tris, bx, 95.5, bz, w, 5, d, P.trim);
    }

    // === windows (north) =====================================================
    const window = (cx) => {
      const y0 = 28, y1 = 74, w = 40;
      // frame jambs/head/sill on the room face
      for (const s of [-1, 1]) box(tris, cx + s * (w / 2 - 0.8), 51, -73.6, 1.8, 48, 1.6, P.trim);
      box(tris, cx, y1 - 0.9, -73.6, w, 1.8, 1.6, P.trim);
      box(tris, cx, y0 - 0.6, -72.8, w + 3, 2.0, 3.0, P.trim);                  // sill
      // mullions: 2 vertical + 1 horizontal inside the opening
      for (const s of [-1, 1]) box(tris, cx + s * w / 6, 51, -75, 1.1, 46, 1.4, P.trim);
      box(tris, cx, 51, -75, w - 1, 1.1, 1.4, P.trim);
      // curtains + rod + finials
      const rod = [cx - w / 2 - 8, 78, -70.5], rodEnd = [cx + w / 2 + 8, 78, -70.5];
      tube(tris, [rod, rodEnd], 0.6, 7, P.darkwood);
      sphere(tris, rod[0], 78, -70.5, 1.4, 6, P.brass, { smooth: false });
      sphere(tris, rodEnd[0], 78, -70.5, 1.4, 6, P.brass, { smooth: false });
      for (const s of [-1, 1])
        box(tris, cx + s * (w / 2 + 5), 52, -70.5, 11, 52, 3, W, { tex: texCurtain, uvScale: 20 });
      // valance across the top
      box(tris, cx, 76.5, -70.5, w + 18, 8, 3.2, [230, 230, 230], { tex: texCurtain, uvScale: 20 });
    };
    window(-45); window(45);

    // the world outside: pale sky card + skyline slabs + fire escape
    quad(tris, [-160, -10, -150], [160, -10, -150], [160, 130, -150], [-160, 130, -150], P.outsidesky, { unlit: true });
    for (const [bx, bw, bh, bc] of [[-120, 46, 62, 0], [-55, 38, 84, 1], [10, 52, 54, 0], [80, 40, 74, 1], [135, 34, 58, 0]]) {
      const cc = bc ? [172, 184, 200] : P.skyline;
      box(tris, bx, bh / 2 - 10, -140, bw, bh, 8, cc, { unlit: true });
      for (let wy = 8; wy < bh - 8; wy += 12)                                // lit windows grid
        for (let wx = -bw / 2 + 6; wx < bw / 2 - 5; wx += 10)
          box(tris, bx + wx, wy - 4, -135.7, 4, 6, 0.5, [236, 226, 190], { unlit: true });
    }
    // fire escape: platform + rails + ladder, bolted outside the windows
    box(tris, 0, 30, -84, 150, 1.6, 9, [60, 58, 56]);
    for (let i = 0; i <= 14; i++) box(tris, -70 + i * 10, 34.5, -79.8, 0.8, 9, 0.8, [60, 58, 56]);
    tube(tris, [[-74, 39, -79.8], [74, 39, -79.8]], 0.55, 6, [60, 58, 56]);
    for (let i = 0; i < 7; i++) beam(tris, [-88, 28 + i * 5.5, -84], [-78, 31 + i * 5.5, -84], 0.5, [60, 58, 56]); // stair zig

    // radiator under the left window
    for (let i = 0; i < 9; i++) cyl(tris, -62 + i * 4.2, 10, -69.5, 1.7, 18, 7, [168, 164, 158]);
    box(tris, -45, 19.5, -69.5, 40, 1.6, 4, [150, 146, 140]);
    cyl(tris, -66, 4, -69.5, 1.2, 3, 6, P.brass);

    // === south wall: entry door ==============================================
    const dx = 77.5; // door center
    // frame + raised-panel door leaf
    for (const s of [-1, 1]) box(tris, dx + s * 18.5, 31, 73.4, 2.2, 64, 1.8, P.trim);
    box(tris, dx, 63.4, 73.4, 39, 2.4, 1.8, P.trim);
    box(tris, dx, 30.5, 73.8, 34, 61, 1.4, [217, 204, 184], { tex: texWains, uvScale: 16 }); // leaf
    for (const py of [14, 30]) for (const px of [-8.5, 8.5])                    // 4 raised panels
      box(tris, dx + px, py + 16, 73.0, 13, 20, 0.6, [191, 173, 148], { tex: texWains, uvScale: 14 });
    sphere(tris, dx + 14, 30, 72.6, 1.2, 6, P.brass, { shine: 0.5 });

    // wainscot band on the south + east + west walls
    for (const [bx, bz, w, d, ry] of [[-25, 72.4, 174, 1.4, 0], [103.5, 72.4, 17, 1.4, 0], [107.6, 0, 1.4, 148, 0], [-107.6, 0, 1.4, 148, 0]]) {
      box(tris, bx, 14, bz, w, 26, d, W, WAINS);
      box(tris, bx, 27.4, bz, w, 1.6, d === 1.4 ? 2.0 : d, P.trim);
    }

    // === furniture ============================================================
    // sofa along the west wall, facing +x
    const sofa = { x: -96, z: -8 };
    const texS = { tex: texSofa, uvScale: 16 };
    box(tris, sofa.x, 8, sofa.z, 14, 10, 56, W, texS);                          // base
    box(tris, sofa.x - 4.5, 16, sofa.z, 5, 22, 56, W, texS);                    // back
    for (const s of [-1, 1]) {                                                  // rolled arms
      box(tris, sofa.x, 13, sofa.z + s * 30, 14, 20, 5.5, W, texS);
      cyl(tris, sofa.x, 22.5, sofa.z + s * 30, 3.0, 14, 8, W, { tex: texSofa, uvScale: 14, rz: Math.PI / 2 });
    }
    for (const s of [-1, 1]) {                                                  // seat + back cushions
      box(tris, sofa.x + 1.5, 14.5, sofa.z + s * 14, 11, 4.5, 25, [1.06, 1.06, 1.06], texS);
      box(tris, sofa.x - 1.5, 19.5, sofa.z + s * 14, 4, 11, 24, [240, 240, 240], { tex: texSofa, uvScale: 16, rot: [-0.12, 0, 0] });
    }
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
      cyl(tris, sofa.x + lx * 5.5, 1.5, sofa.z + lz * 26, 1.0, 3, 6, P.darkwood);
    // throw pillows — squashed spheres
    sphere(tris, sofa.x + 1, 17, sofa.z - 22, 4.5, 7, [172, 96, 74], { squash: [0.8, 1, 1.3], jag: 0.06, seed: 5, tex: texCurtain });
    sphere(tris, sofa.x + 1, 17, sofa.z + 20, 4.5, 7, [196, 168, 92], { squash: [0.8, 1, 1.3], jag: 0.06, seed: 7, tex: texBook });

    // side table next to the sofa — lathe pedestal + round top
    lathe(tris, -92, 11, 30, [[0, -8], [5.5, -8], [1.6, -6], [1.2, 4], [3.4, 7], [0, 7]], 10, P.darkwood);
    cyl(tris, -92, 19, 30, 9, 1.6, 12, W, { tex: texFloor, uvScale: 12 });
    // lamp on the side table — lathe base + shade cone
    lathe(tris, -92, 22.5, 30, [[0, -2.5], [3.2, -2.5], [1.4, -1], [0.8, 6], [0, 6]], 9, P.brass);
    frustum(tris, -92, 33, 30, 13, 13, 9, 9, 7, [236, 220, 180]);
    sphere(tris, -92, 30.5, 30, 1.6, 6, [250, 244, 214], { unlit: true });      // lit bulb

    // coffee table in front of the sofa
    const ct = { x: -58, z: -6 };
    box(tris, ct.x, 11.5, ct.z, 30, 1.8, 18, W, { tex: texFloor, uvScale: 14 });
    box(tris, ct.x, 5.5, ct.z, 26, 1.2, 14, W, { tex: texFloor, uvScale: 14 });  // lower shelf
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
      box(tris, ct.x + lx * 13, 5.5, ct.z + lz * 7.5, 1.8, 11, 1.8, P.darkwood);
    // books + mug on the coffee table
    box(tris, ct.x - 6, 13.2, ct.z - 3, 10, 1.4, 7, [140, 92, 71]);
    box(tris, ct.x - 5.4, 14.4, ct.z - 3.2, 9, 1.2, 6.4, [89, 102, 140]);
    cyl(tris, ct.x + 8, 14, ct.z + 4, 2.0, 3.4, 8, [199, 82, 64], { cap: true });
    tube(tris, [[ct.x + 9.8, 14.6, ct.z + 4], [ct.x + 11.4, 14.4, ct.z + 4], [ct.x + 11.6, 13.2, ct.z + 4], [ct.x + 9.9, 13.1, ct.z + 4]], 0.4, 5, [199, 82, 64]);

    // rug under the coffee table — border + field (winding must face +y)
    quad(tris, [-92, 0.3, 30], [-28, 0.3, 30], [-28, 0.3, -40], [-92, 0.3, -40], [191, 191, 191], { tex: texCarpet, uvScale: 24 });
    quad(tris, [-86, 0.45, 24], [-34, 0.45, 24], [-34, 0.45, -34], [-86, 0.45, -34], W, { tex: texCarpet, uvScale: 24 });

    // bookshelf on the east wall — frame, shelves, seeded book spines
    const bs = { x: 104, z: 8 };
    const frame = { tex: texFloor, uvScale: 16 };
    box(tris, bs.x + 2, 36, bs.z - 30, 4, 72, 2.4, W, frame);                   // sides
    box(tris, bs.x + 2, 36, bs.z + 30, 4, 72, 2.4, W, frame);
    box(tris, bs.x + 2.5, 35, bs.z, 2.5, 70, 62, [128, 97, 71]);            // back panel
    box(tris, bs.x + 2, 71, bs.z, 4.5, 2.4, 62, W, frame);                      // top
    const BOOKC = [[142, 62, 45], [62, 92, 142], [88, 118, 66], [196, 168, 92], [120, 76, 96], [170, 130, 80], [96, 96, 100]];
    for (let sh = 0; sh < 5; sh++) {
      const sy = 6 + sh * 13;
      box(tris, bs.x + 1, sy, bs.z, 5.5, 1.4, 61, W, frame);                    // shelf
      let zc = bs.z - 28;
      let bi = 0;
      while (zc < bs.z + 26) {
        const r = fbm(zc * 0.13, sh * 3.1, 2, 50 + sh);
        if (r < 0.14) { zc += 4 + r * 30; continue; }                           // gap
        if (r > 0.86) {                                                        // leaning stack pair
          const bw = 5 + r * 3;
          box(tris, bs.x - 1, sy + 2.4, zc + 2, 4.5, 2.2, bw, BOOKC[bi++ % 7]);
          box(tris, bs.x - 1, sy + 4.6, zc + 3, 4.5, 2.2, bw - 1.5, BOOKC[bi++ % 7], { ry: 0.06 });
          zc += bw + 1.5; continue;
        }
        const bw2 = 1.8 + r * 2.6, bh = 9 + fbm(zc * 0.2, sh, 2, 9) * 3.5;
        box(tris, bs.x - 1, sy + 0.7 + bh / 2, zc + bw2 / 2, 4.6, bh, bw2,
          BOOKC[bi++ % 7], { tex: texBook, uvScale: 8 });
        zc += bw2 + 0.4;
      }
    }
    // vase on top of the shelf
    lathe(tris, bs.x, 77, bs.z - 16, [[0, -4], [3.4, -4], [4.2, -1], [2.6, 2], [3.0, 3.6], [0, 3.8]], 10, [96, 96, 100]);

    // wall art — gilded frames with simple landscape quads; (nx,nz) = wall normal
    const art = (x, y, z, nx, nz, w, h, sky, hill) => {
      box(tris, x, y, z, nx === 0 ? w : 1.0, h, nz === 0 ? w : 1.0, P.brass);
      const pv = (d, dy, off) => [x + nx * off + (nx === 0 ? d : 0), y + dy, z + nz * off + (nz === 0 ? d : 0)];
      const flip = nx > 0 || nz < 0;
      const q = (p0, p1, p2, p3, cc) => quad(tris, ...(flip ? [p3, p2, p1, p0] : [p0, p1, p2, p3]), cc);
      q(pv(-w / 2 + 1.4, -h / 2 + 1.4, 0.6), pv(w / 2 - 1.4, -h / 2 + 1.4, 0.6),
        pv(w / 2 - 1.4, h / 2 - 1.4, 0.6), pv(-w / 2 - 1.4, h / 2 - 1.4, 0.6), hill);
      q(pv(-w / 2 + 1.4, -h / 2 + 1.4, 0.7), pv(w / 2 - 1.4, -h / 2 + 1.4, 0.7),
        pv(w / 2 - 1.4, h * 0.14, 0.7), pv(-w / 2 - 1.4, h * 0.14, 0.7), sky);
    };
    art(0, 62, -72.6, 0, 1, 26, 18, [168, 196, 220], [104, 126, 84]);          // between windows
    art(-58, 64, 72.6, 0, -1, 30, 20, [188, 172, 150], [120, 96, 76]);         // south wall
    art(-107.4, 62, 44, 1, 0, 20, 26, [160, 180, 200], [96, 110, 80]);         // west wall by the sofa
    art(107.4, 84, 8, -1, 0, 26, 14, [176, 196, 214], [150, 128, 96]);         // east, above the shelf

    // potted plant by the door — lathe pot + scrubby foliage
    lathe(tris, 98, 7, 58, [[0, -6], [4.6, -6], [5.4, 0], [6.4, 6], [5.6, 7], [0, 7]], 10, [142, 82, 52]);
    for (let i = 0; i < 6; i++) {
      const a = i * 1.05 + 0.4;
      sphere(tris, 98 + Math.cos(a) * 4.5, 17 + (i % 3) * 3.4, 58 + Math.sin(a) * 4.5, 4.6, 7,
        [255, 255, 255], { jag: 0.3, squash: [1, 1.3, 1], seed: 60 + i, tex: texLeaf });
    }
    sphere(tris, 98, 22, 58, 5.5, 8, [72, 122, 62], { jag: 0.25, seed: 70, tex: texCarpet });

    // ceiling fixture — cord + lathe dome shade + warm bulb
    tube(tris, [[0, 100, 0], [0, 84, 0]], 0.35, 5, P.inset);
    lathe(tris, 0, 82, 0, [[0, -2.5], [7.5, -2.2], [8.5, -0.5], [4.5, 1.6], [1.2, 2.0], [0, 2.0]], 12, [150, 118, 74]);
    sphere(tris, 0, 80.5, 0, 2.4, 7, [250, 244, 210], { unlit: true });

    // coat hooks by the door
    box(tris, 32, 62, 73.5, 20, 4, 1.2, P.darkwood);
    for (let i = 0; i < 3; i++) {
      cyl(tris, 26 + i * 6, 62, 72.6, 0.6, 2.4, 6, P.brass, { rx: Math.PI / 2 });
      sphere(tris, 26 + i * 6, 61.4, 71.9, 0.9, 6, P.brass);
    }
    // hat hanging on the last hook — lathe brim + crown
    lathe(tris, 38, 60.5, 71.5, [[0, -1.2], [5.6, -1.0], [6.4, -0.4], [0, -0.2]], 10, [96, 78, 58], { rot: [0.35, 0, 0] });
    lathe(tris, 38, 61.8, 71.2, [[0, -1.4], [3.0, -1.4], [3.2, 0.8], [2.4, 1.8], [0, 1.8]], 10, [96, 78, 58], { rot: [0.35, 0, 0] });
  },
};
