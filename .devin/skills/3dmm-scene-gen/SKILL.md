---
name: 3dmm-scene-gen
description: Generate a new 3D Movie Maker scene (background + multiple camera angles) as a .vxp expansion pack in public/expansions/. Use when asked to create a scene/backdrop/stage, add camera angles, or build a western/space/underwater/etc. environment for the 3dmm-web app.
---

# 3DMM Scene Generator

Turn a scene description into a loadable `.vxp` expansion: procedurally model
the area as simple 3D geometry, define camera + light positions, render
palette-indexed backdrops with real depth maps, package as BKGD/CAM chunks.

## Pipeline (tools/scene-gen/)

```
spec (specs/*.mjs)  →  geo primitives (geo.mjs)  →  software rasterizer (lib.mjs)
  →  .3cn + .3th (writeChunkyFile)  →  .vxp zip in public/expansions/
```

Run:

```sh
npx vite-node tools/scene-gen/build.mjs tools/scene-gen/specs/<name>.mjs
```

Outputs:

- `public/expansions/<fileName>.vxp` — `<fileName>.3cn` + `.3th` + `.cfg`
- `tools/scene-gen/out/<fileName>/cam{i}.png` — color previews (gitignored),
  `cam{i}.z.png` — depth grayscale, `thumb{i}.png` — picker thumbs

Load in-app: `npm run dev` → `http://localhost:5177/?vxp=expansions/<fileName>.vxp`
then open the scene book (the BKGD appears with its name; the camera-angle
picker shows one CATH thumb per camera).

## Authoring a spec

Copy `tools/scene-gen/specs/western.mjs`. Shape:

```js
export default {
  name: 'Display Name',        // scene-picker name (BKGD chunk name)
  fileName: 'my_scene',        // .vxp/.3cn/.3th basename
  cnoBase: 710000,             // chunk-number block — MUST differ per pack
  indexBase: 157,              // GLCR palette overlay start (see palette rules)
  palette: [...],              // ≤ 256-indexBase entries; [r,g,b] or
                               // {base:[r,g,b], shades:[mults]} -> ramps
  sky: { top:[r,g,b], horizon:[r,g,b] },   // vertical gradient
  ka: 0.5, kd: 0.62,           // ambient / diffuse shading weights
  lights: [ { dir:[x,y,z], intensity:1, type:1 }, ... ],  // ≤4, dir = toward light
  cameras: [ { pos:[x,y,z], look:[x,y,z], fov:55, name:'Angle 1' }, ... ],
  build(tris, geo) { /* push geometry via geo.box/cyl/cone/quad/frustum/ground */ },
};
```

Geometry helpers (`geo.mjs`): `box(tris,cx,cy,cz,w,h,d,color,{ry,two})`,
`cyl` (vertical, capped), `cone`, `quad` (arbitrary 4 pts), `frustum`
(tapered box — mesas/cliffs), `ground` (flat y-up plane). Colors are base
RGB; the rasterizer Lambert-shades per triangle and snaps to the nearest
palette entry (flat-shaded, era-appropriate). `two:true` marks thin
double-sided pieces (signs, awnings) — everything else is back-face culled.

## Hard rules (learned the hard way)

- **indexBase 157.** Material ramps for actors live at palette 15–150.
  Overlaying ≥157 leaves actor shading untouched. ≤99 palette entries.
- **cnoBase per pack.** Collisions resolve first-come; keep each pack's
  BKGD/CAM/BKTH cnos in its own 1000-block (hash of fileName if unsure).
- **Camera matrix is camera→world** (row 3 = position = apos). `makeCam`
  builds it from pos/look — don't hand-invert.
- **ZBMP is perspective ndc·32768** (signed u16; `near=hither`, `far=yon`,
  GL projection), **65535 = sky**. The renderer's `zi/32768` → NDC math and
  actor shadow reconstruction both depend on this being exact — always use
  `rasterize()`'s output, never a "linear" depth.
- **The pack needs a 256-entry GLCR** (handled by `build3cn` automatically —
  socpal + overlay) or picker thumbs decode against raw socpal and shift color.
- **Stock-consistent defaults**: hither 1.2, yon 5000, fov 45–58°, images
  544×306, thumbs 143×80, cameras near ground (y 0–60) ~100–300 units out.
- **Clouds/sky extras**: anything thin viewed edge-on becomes an ugly sliver —
  give floating geometry real thickness or leave it out.
- **The town must fit the frame**: buildings ~30–50 units tall read well at
  100–200 units distance; check previews before shipping.

## Iterate

1. Build → open `out/<name>/cam{i}.png`, fix spec (geometry/camera/palette).
2. Verify chunk tree: `npx vite-node tools/inspect`-style check — BKGD parses,
   `cameras.length` = N, every CAM has MBMP+ZBMP kids (`parseBkgd`/`parseCamera`
   in `src/format/content.ts`).
3. Dev-server smoke test with `?vxp=` — confirm it appears in the scene book
   and each angle has a thumb.
4. Optional: make a movie scene that uses it —
   `SetBkgd {sid:2, ctg:'BKGD', cno:<bkgdCno>}` + `ChngCamera icam` events
   (see `tools/generators/scenes/scenes-cameras.md` §2, §4A).
