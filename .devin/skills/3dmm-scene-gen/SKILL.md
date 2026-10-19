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
spec (specs/scenes/*.mjs) → geo primitives (geo.mjs) → software rasterizer (lib.mjs)
  →  .3cn + .3th (writeChunkyFile)  →  .vxp zip in public/expansions/
```

Run:

```sh
npx vite-node tools/scene-gen/build.mjs tools/scene-gen/specs/scenes/<name>.mjs
```

Outputs:

- `public/expansions/<fileName>.vxp` — `<fileName>.3cn` + `.3th` + `.cfg`
- `tools/scene-gen/out/<fileName>/cam{i}.png` — color previews (gitignored),
  `cam{i}.z.png` — depth grayscale, `thumb{i}.png` — picker thumbs

Load in-app: `npm run dev` → `http://localhost:5177/?vxp=expansions/<fileName>.vxp`
then open the scene book (the BKGD appears with its name; the camera-angle
picker shows one CATH thumb per camera).

## Authoring a spec

Copy `tools/scene-gen/specs/scenes/western.mjs` (outdoor) or
`tools/scene-gen/specs/scenes/apartment.mjs` (interior — enclosed room shell
with window openings, perimeter furniture, sun-through-window shadows).
Shape:

```js
export default {
  name: 'Display Name',        // scene-picker name (BKGD chunk name) + .cfg extInfo
  desc: 'Optional',            // .cfg Desc — shown in the addons list detail row
  ver: '1.0',                  // .cfg Version — the addons list badge ('0.0?' when absent)
  fileName: 'my_scene',        // .vxp/.3cn/.3th basename
  cnoBase: 710000,             // chunk-number block — MUST differ per pack
  indexBase: 157,              // GLCR palette overlay start (see palette rules)
  palette: [...],              // declared colors (reserved slots); the rest of
                               // the overlay is filled by median-cut from the
                               // renders — keep it small (sky/hero hues only)
  sky: { top:[r,g,b], horizon:[r,g,b] },   // fallback vertical gradient
  skyFn: (x,y)=>[r,g,b],       // optional per-pixel sky (glow, clouds)
  ambSky: [r,g,b], ambGnd: [r,g,b],  // hemisphere ambient, 0..1 coefficients
  bumpScale: 2.0,              // bump-map strength
  specI: 26,                   // specular intensity for shine: tris
  shadowOpacity: 0.5,          // sun shadow darkness (noShadow:true disables)
  shadowSize: 1024,            // shadow-map resolution
  shadowSoft: 1.4,             // PCF kernel radius — softer shadow edges
  ss: 2,                       // supersample AA (default 2; render at 2x, box-down)
  dither: 18,                  // ordered-dither amplitude at quantize
  lights: [ { dir:[x,y,z], intensity:1, col:[r,g,b]?, type:1 }, ... ],
                             // ≤4; lights[0] = sun (casts shadows). `col` tints
                             // the light — warm sun + cool fill reads "realistic"
  worldScale: 0.5,           // optional — scales all geometry + camera pos/look
                             // after build(); actors stand ~40-60, stock interior
                             // ceilings sit ~50, so interior rooms model ~2x
                             // actor size → scale them down
  cameras: [ { pos:[x,y,z], look:[x,y,z], fov:55, name:'Angle 1' }, ... ],
  build(tris, geo) { /* push geometry */ },
};
```

**Rendering**: true-color per-pixel shading (hemisphere ambient + sun +
fill + Blinn-Phong spec) → median-cut palette → Bayer-dithered quantize.
Preview PNGs show exactly what the app displays.

**Textures** (`tex.mjs`): `wood`, `brick`, `stone`, `sand`, `shingles`,
`rust`, `scrub`, `rough`, `wallpaper`, `carpet`, `stripes` — each returns
`{rgb, bump}`. Attach via the
`{tex, uvScale}` option on any primitive; `uvScale` ≈ world units per
texture repeat. **The tri color is a 0..255 multiplier** — use
`[255,255,255]` for full texture, or tint (e.g. `[183,87,71]` red-washes
wood). Bump maps perturb normals per pixel automatically when the texture
has a `bump` field.

Geometry helpers (`geo.mjs`): `box`, `cyl`, `cone`, `quad`, `frustum`
(mesas), `ground`, `heightfield` (rolling dunes via `fn(x,z)→y`), `prism`
(pitched roofs), `sphere` (`{jag, squash, smooth}` — rocks/bushes/clouds),
`beam` (poles/wires/braces between two points), `stairs`, `wheel`, `rail`.
Options: `ry`/`rot:[rx,ry,rz]` rotation, `two` double-sided, `unlit` (sky
extras — flat albedo, no shading), `shine` (specular 0..1 — glass/metal).

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
- **Cameras must look DOWN** (look.y < pos.y). Actor dragging raycasts the
  pointer ray against the ground plane (y = actor's height); a level or
  up-looking camera sends those rays away from the plane, so the ground
  click can't resolve and actors can't be moved in that angle at all.
- **Ground must reach the horizon**: end terrain inside the yon radius or
  add a flat backdrop slab under it — a terrain edge against sky reads as
  "no ground" from high angles.
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
