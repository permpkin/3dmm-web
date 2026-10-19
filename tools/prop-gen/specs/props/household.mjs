// Household furniture prop pack — five textured props for the picker.
//   npx vite-node tools/prop-gen/build.mjs tools/prop-gen/specs/props/household.mjs
// Prop space: y-up, ground at y=0, front toward +z, centered on origin
// (Spin/Scale actions pivot about the origin — keep it inside the prop's
// footprint). Scale: actors are ~15-20 units tall, the stock car is 30x10.
//
// Textures: parts.add(ramp, {tex, uv, uvScale}) — tex is a palette-indexed
// TMAP descriptor from ../../tex.mjs (index 0 = transparent cutout, stay in
// 1..156 so scene palettes can't shift the colors). uv selects the projector
// ('face' decal | 'front' picture | 'wrap' cylindrical | 'tile' world-tiled);
// uvScale = world units per texture repeat for 'tile'.
import { R } from '../../geo.mjs';
import * as T from '../../tex.mjs';

// ---- shared textures -----------------------------------------------------------
const woodDark = T.wood(64, 64, { base: [150, 105, 62], gap: [80, 56, 34], plank: 8, seed: 7 });
const woodLight = T.wood(64, 64, { base: [196, 160, 110], gap: [122, 90, 54], plank: 9, seed: 12 });
const fabricRed = T.carpet(64, 64, { base: [170, 64, 50], dark: [126, 40, 31], seed: 21 });
const fabricRose = T.carpet(64, 64, { base: [208, 134, 128], dark: [168, 92, 88], seed: 27 });
const plastic = T.rough(48, 48, { base: [88, 64, 56], contrast: 0.35, seed: 33 });   // TV cabinet mottle
const pillowTex = T.rough(32, 32, { base: [232, 224, 210], contrast: 0.14, seed: 39 });
const blanketTex = T.plaid(48, 48, { a: T.nearest(64, 76, 128), b: T.nearest(104, 122, 168), xw: 6, yw: 6 });
const tickingTex = T.stripes(32, 32, 3, [T.nearest(226, 220, 200), T.nearest(140, 158, 190)]);

// Pleated lampshade — alternating warm bands; 'wrap' makes them run vertically.
const SH_A = T.nearest(236, 210, 160), SH_B = T.nearest(172, 138, 96);
const shadeTex = T.make(56, 24, (x, y) => (x % 7 === 0 ? SH_B : SH_A));

// Book spines — base/light/dark pulled from the part's own ramp so each spine
// color reads as the same printed book. Band top+bottom, dark title block.
const spineTex = (ramp) => {
  const pal = T.socpal();
  const [base, light, dark] = [4, 6, 1].map((o) => T.nearest(...pal[ramp + o]));
  return T.make(8, 24, (x, y) =>
    y < 4 || y > 19 ? light : (y >= 9 && y <= 14 && x > 0 && x < 7 ? dark : base));
};

// CRT test pattern — color bars over a dark lower third; TMAP row 0 = top.
const BARS = [[228, 228, 228], [222, 200, 60], [70, 190, 190], [70, 170, 80],
  [180, 80, 165], [196, 62, 52], [64, 70, 170]].map((c) => T.nearest(...c));
const screenTex = T.make(42, 30, (x, y) => {
  if (x < 2 || x >= 40 || y < 2 || y >= 28) return T.nearest(30, 32, 38);   // bezel
  if (y < 20) return BARS[Math.floor((x - 2) / 5.43) % 7];
  return y < 24 ? T.nearest(20, 22, 30) : T.nearest(x % 8 < 4 ? 235 : 15, x % 8 < 4 ? 235 : 15, x % 8 < 4 ? 235 : 20);
});

export default {
  name: 'Household Props',
  desc: 'A household set — armchair, bookshelf, floor lamp, television, and bed.',
  fileName: 'household_props',
  cnoBase: 820000,
  props: [
    {
      name: 'Armchair',
      build(parts, geo) {
        const wood = parts.add(R.BROWN);          // legs
        for (const [x, z] of [[-3.6, -3], [3.6, -3], [-3.6, 3], [3.6, 3]])
          geo.box(wood, x, 1.6, z, 1, 3.2, 1);
        const fabric = parts.add(R.RED, { tex: fabricRed, uv: 'tile', uvScale: 6 });
        geo.box(fabric, 0, 4.2, 0, 9, 2.4, 8);                    // base
        geo.box(fabric, -3.9, 5.6, 0, 1.4, 5.2, 8);              // arm L
        geo.box(fabric, 3.9, 5.6, 0, 1.4, 5.2, 8);               // arm R
        geo.box(fabric, 0, 6.6, -3.3, 9, 6.6, 1.6, { rx: -0.09 });// back
        const cushion = parts.add(R.ROSE, { tex: fabricRose, uv: 'tile', uvScale: 5 });
        geo.box(cushion, 0, 6.1, 0.7, 6.4, 1.6, 6);
        geo.box(cushion, 0, 7.6, -2.4, 6.4, 4.4, 1.4, { rx: -0.09 });
      },
    },
    {
      name: 'Bookshelf',
      build(parts, geo) {
        const frame = parts.add(R.TAN, { tex: woodLight, uv: 'tile', uvScale: 9 });
        geo.box(frame, -5.4, 8.5, 0, 0.8, 17, 4);                 // side L
        geo.box(frame, 5.4, 8.5, 0, 0.8, 17, 4);                  // side R
        geo.box(frame, 0, 16.8, 0, 11.6, 0.8, 4);                 // top
        geo.box(frame, 0, 0.5, 0, 11.6, 1, 4.2);                  // plinth
        for (const y of [5.8, 11]) geo.box(frame, 0, y, -0.1, 10.8, 0.6, 3.8); // shelves
        const back = parts.add(R.BROWN, { tex: woodDark, uv: 'tile', uvScale: 9 });
        geo.box(back, 0, 8.7, -1.85, 10.8, 16.2, 0.35);
        // books grouped by spine color — heights jittered for a lived-in look.
        // Spines are textured (band + title block); 'tile' phase-shifts the
        // pattern per book position so rows don't read as clones.
        const rows = [
          { shelf: 6.1, h: 3.6, books: [[-4.6, 'r'], [-3.7, 'b'], [-2.9, 'g'], [-2.2, 'y'], [-1.3, 'r'], [-0.4, 'b'], [0.9, 'g', { rz: -0.25 }], [2.1, 'y'], [2.9, 'r'], [3.7, 'b'], [4.6, 'g']] },
          { shelf: 11.3, h: 3.3, books: [[-4.4, 'g'], [-3.5, 'y'], [-2.7, 'r'], [-1.8, 'b'], [-0.9, 'y'], [0, 'g'], [0.9, 'r'], [2.4, 'b', { rz: 0.22 }], [3.5, 'y'], [4.4, 'r']] },
          { shelf: 1.0, h: 2.9, books: [[-4.5, 'b'], [-3.6, 'r'], [-2.6, 'y'], [-1.7, 'g'], [-0.8, 'b'], [0.2, 'r'], [1.1, 'y'], [2.1, 'g'], [3.2, 'r'], [4.2, 'b']] },
        ];
        const byColor = { r: parts.add(R.RED, { tex: spineTex(R.RED), uv: 'tile', uvScale: 3 }),
          b: parts.add(R.NAVY, { tex: spineTex(R.NAVY), uv: 'tile', uvScale: 3 }),
          g: parts.add(R.GREEN, { tex: spineTex(R.GREEN), uv: 'tile', uvScale: 3 }),
          y: parts.add(R.GOLD, { tex: spineTex(R.GOLD), uv: 'tile', uvScale: 3 }) };
        for (const row of rows)
          for (const [x, c, o] of row.books) {
            const h = row.h * (0.82 + 0.18 * Math.abs(Math.sin(x * 3.7))); // deterministic height jitter
            geo.box(byColor[c], x, row.shelf + h / 2 - 0.1, 0.3, 0.75, h, 3, o || {});
          }
      },
    },
    {
      name: 'Floor Lamp',
      build(parts, geo) {
        const metal = parts.add(R.GOLD);          // base, pole, finial
        geo.cyl(metal, 0, 0.4, 0, 2.6, 0.8, 14);                  // foot
        geo.cyl(metal, 0, 6.4, 0, 0.32, 11.5, 10);                // pole
        geo.cyl(metal, 0, 12.6, 0, 0.5, 1.2, 10);                 // collar
        geo.sphere(metal, 0, 15.9, 0, 0.55);                      // finial
        const shade = parts.add(R.TAN, { tex: shadeTex, uv: 'wrap' });
        geo.cyl(shade, 0, 13.7, 0, 3.1, 4.2, 14, { r1: 2.1, cap: false });
      },
    },
    {
      name: 'Television',
      build(parts, geo) {
        const stand = parts.add(R.BROWN, { tex: woodDark, uv: 'tile', uvScale: 6 });
        geo.box(stand, 0, 3.4, 0, 8.6, 0.9, 7);
        for (const [x, z] of [[-3.8, -2.8], [3.8, -2.8], [-3.8, 2.8], [3.8, 2.8]])
          geo.box(stand, x, 1.6, z, 0.8, 3.2, 0.8);
        const body = parts.add(R.COCOA, { tex: plastic, uv: 'tile', uvScale: 7 });
        geo.box(body, 0, 7.4, 0, 9, 7, 7);
        geo.box(body, 0, 11.3, -0.4, 8, 0.9, 5.6);                // top hump
        const screen = parts.add(R.STEEL, { tex: screenTex, uv: 'front' });
        geo.box(screen, -0.7, 7.6, 3.42, 6.4, 5, 0.5, { ry: 0 });
        const trim = parts.add(R.SILVER);         // knobs, feet, antenna
        geo.box(trim, 3.3, 7.6, 3.55, 1.6, 5, 0.35);              // side panel
        geo.cyl(trim, 3.3, 9.2, 3.85, 0.5, 0.6, 10, { rx: Math.PI / 2 }); // knob top
        geo.cyl(trim, 3.3, 7.9, 3.85, 0.5, 0.6, 10, { rx: Math.PI / 2 }); // knob bottom
        geo.box(trim, 3.3, 5.6, 3.62, 1.6, 1.4, 0.3);             // speaker grille
        geo.cyl(trim, -1.6, 13.3, -1, 0.12, 4.6, 6, { rz: 0.5 }); // antenna L
        geo.cyl(trim, 1.6, 13.3, -1, 0.12, 4.6, 6, { rz: -0.5 }); // antenna R
        geo.sphere(trim, 0, 11.6, -1, 0.4);                       // antenna hub
      },
    },
    {
      name: 'Bed',
      build(parts, geo) {
        const wood = parts.add(R.BROWN, { tex: woodDark, uv: 'tile', uvScale: 7 });
        geo.box(wood, 0, 2.6, 0, 11, 1.6, 20);                    // frame
        geo.box(wood, 0, 6, -9.7, 11, 8.5, 1.2);                  // headboard
        geo.box(wood, 0, 4, 9.7, 11, 4.5, 1.2);                   // footboard
        for (const [x, z] of [[-5, -9.4], [5, -9.4], [-5, 9.4], [5, 9.4]])
          geo.box(wood, x, 1, z, 1, 2, 1);                        // legs
        const mattress = parts.add(R.SILVER, { tex: tickingTex, uv: 'tile', uvScale: 4 });
        geo.box(mattress, 0, 4.1, 0, 10, 1.6, 18.6);
        const pillow = parts.add(R.ROSE, { tex: pillowTex, uv: 'tile', uvScale: 5 });
        geo.box(pillow, -2.6, 5.4, -7.4, 4.4, 1.4, 3.2, { rx: 0.12 });
        geo.box(pillow, 2.6, 5.4, -7.4, 4.4, 1.4, 3.2, { rx: 0.12 });
        const blanket = parts.add(R.NAVY, { tex: blanketTex, uv: 'tile', uvScale: 5 });
        geo.box(blanket, 0, 5.1, 3.4, 10.4, 0.9, 12.4);
        geo.box(blanket, 0, 5.5, -3, 10.4, 0.7, 1.6);             // fold
      },
    },
  ],
};
