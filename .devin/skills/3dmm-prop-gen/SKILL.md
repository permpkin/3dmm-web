# 3DMM Prop Generator

Turn prop descriptions into a loadable `.vxp` expansion: procedurally model
each prop as simple 3D geometry grouped into material parts, synthesize the
nine stock prop actions, render palette-indexed picker thumbnails, package
as TMPL/PRTH chunks.

## Pipeline (tools/prop-gen/)

```
spec (specs/props/*.mjs)  →  part meshes (geo.mjs) + indexed textures (tex.mjs)
  →  chunk encoders (lib.mjs)  →  .3cn + .3th (writeChunkyFile)
  →  .vxp zip in public/expansions/
```

Run:

```sh
npx vite-node tools/prop-gen/build.mjs tools/prop-gen/specs/props/<name>.mjs
```

Outputs:

- `public/expansions/<fileName>.vxp` — `<fileName>.3cn` + `.3th` + `.cfg`
- `tools/prop-gen/out/<fileName>/<prop>.png` — 216² preview renders
  (gitignored)
- The build also self-validates: re-parses the `.3cn`, checks every cel's
  `imat34`/`chidModl` bounds, and steps a headless `Actor` through Add+Actn
  events to report real world-space sizes.

Load in-app: `npm run dev` → `http://localhost:5177/?vxp=expansions/<fileName>.vxp`
then open the prop book (each prop appears by name; the action browser shows
the full stock set).

## Authoring a spec

Copy `tools/prop-gen/specs/props/household.mjs` (per-pack specs live in
`specs/props/`). Shape:

```js
export default {
  name: 'Pack Name',             // addon display name (.cfg extInfo)
  desc: 'Optional',              // .cfg Desc — shown in the addons list detail row
  ver: '1.0',                    // .cfg Version — the addons list badge ('0.0?' when absent)
  fileName: 'my_props',          // .vxp/.3cn/.3th basename
  cnoBase: 820000,               // chunk-number block — MUST differ per pack
  author: '...',
  props: [{
    name: 'Armchair',            // TMPL name = picker label + roll-call name
    rest: [0, 0, 0],             // optional rest orientation (radians)
    thumb: { dir, fov },         // optional thumbnail camera override
    build(parts, geo) {
      const wood = parts.add(geo.R.BROWN);   // a part = ONE material
      geo.box(wood, 0, 4, 0, 9, 2, 8);       // push geometry into it
      // textured variant — palette-indexed TMAP + a UV projection mode:
      const grain = parts.add(geo.R.BROWN, { tex: T.wood(64, 64), uv: 'tile', uvScale: 8 });
    },
  }],
};
```

### Prop space

- **y-up, ground at y=0, front toward +z, centered on origin.** Spin/Grow/
  Squash pivot around the origin — keep it inside the prop's footprint.
- **Scale:** actors are ~15–20 tall, stock props run 5–30 (car 30×10,
  safe ~11, tent 24 tall). Furniture lands in the 8–20 range.
- Front = +z means the prop faces the camera at rest and yaws correctly
  when dragged along a route (ROTY path orientation).

### Parts and materials — the key rule

**One part per color.** A part's material is a single MTRL — the renderer
ignores `brc` and shades through a socpal palette ramp chosen by
`indexBase` (the `geo.R` constant). Parts can't be tinted arbitrarily; pick
the nearest ramp:

```
15 GRAY    23 SILVER  31 NAVY   39 PERI   47 BROWN  55 TAN    63 RED
71 STEEL   79 MAROON  87 ORANGE 95 PURPLE 103 GOLD  111 OLIVE 119 COCOA
127 GREEN  135 ROSE   143 TEAL
```

Ramps occupy socpal 15–150 — the only band scene palettes may not overlay.
Each ramp is 8 shades; `ka 0 / kd 1 / range 7` (stock convention) maps the
scene's GLLT lights onto it. A prop typically wants 2–7 parts.

### Textures

`parts.add(ramp, {tex, uv, uvScale, txxf?})` — `tex` is a palette-indexed
TMAP descriptor `{w,h,px}` from `tex.mjs` (index 0 = a transparent cutout
hole, indexes must stay in 1–156). Untextured parts shade through the ramp
as before; textured parts render unlit-flat like stock (scene lights apply
under the modern-lighting option). Helpers in `tools/prop-gen/tex.mjs`:
`make/nearest/solid/stripes/checker/face/plaid` build indexed textures
directly; `wood/brick/stone/rust/scrub/rough/wallpaper/carpet` quantize the
scene-gen RGB patterns through `nearest()`.

`uv` picks the projection build.mjs applies when the part has a texture
(or assign `p.uvs` directly — [u,v] per vert, welded verts share uv):

- `'face'` — split verts per face, decal one tile over the part bbox
- `'tile'` — same but world-tiled every `uvScale` units (grain/weave/plaid)
- `'front'` — planar XY decal (TV screens, drawer faces; v=0 = top row)
- `'wrap'` — cylindrical, u = angle around Y (lampshade pleats)
- `fn(x,y,z) -> [u,v]` — custom (see `geo.uvFront` for a fixed-box variant)

'face'/'tile' split welded verts — don't use them on smooth lathe/cyl
parts where the weld shading matters; 'wrap' preserves welds.

Geometry helpers (`geo.mjs`) take a part first, then center/size, then
`{rx,ry,rz}` rotation (applied X→Y→Z around the part-local center before
placement): `box(p,cx,cy,cz,w,h,d)`, `cyl(p,cx,cy,cz,r,h,n,{r0,r1,cap})` —
taper for lampshades — `cone`, `sphere`, `frustum` (tapered box),
`quad(p,p0..p3)`, `merge(dst,src)`. Boxes/frusta are flat-shaded;
cyl/cone/sphere weld verts for smooth sides with flat caps (vertex welding
is the only shading control — BMDL smoothing groups are parsed but unused).
The material is double-sided — thin quads work.

## What the builder emits (per prop)

- `TMPL` (`grftmpl|0x4` prop bit) named `prop.name`, `rest` applied.
- `GLPI` `[-1,0,0,…]` — part 0 is an **invisible root** (empty BMDL) that
  carries all animation; visible parts 1..N are its children with identity
  matrices (positions baked into the meshes).
- `GLBS` all-zero (one costume zone), `GGCM` `[[0]]`, one `CMTL` with an
  `MTRL` kid per part — chid order = part order, root included. Textured
  parts hang a `TMAP` (+ optional `TXXF`) kid under their MTRL; TMAP chunks
  are deduplicated pack-wide, so share texture objects between props.
- Nine `ACTN`s (the stock set: At Rest, Grow/Grow Fast, Shrink/Shrink
  Fast, Spin/Spin Fast, Squash, Stretch — all `grfactn 10` = STATIC|ROTY,
  `dwr 2.5`) synthesized as root-part matrix animations. The first ACTN
  kid is the editor's default action, so keep anid 0 first.
- `.3th`: one `PRTH` (cno = template cno, like stock) → `GOKD` → 72×72
  `MBMP` rendered with engine-identical ramp shading on a transparent
  background; `.3cn` carries a 256-entry GLCR (plain socpal) as the pack
  thumbnail palette.

## Hard rules (learned the hard way)

- **cnoBase per pack.** Pack cnos must not collide with builtin TMPLS.3CN
  or other generated packs — builtin content wins collisions. Base
  `800000 + hash(fileName)%200 * 1000` is the default; props take ~60
  cnos each and the .3th starts at cnoBase+500 (≈8 props max per pack —
  split bigger sets or bump the .3th block in `build3th`).
- **Only ramps 15–150.** Custom colors need a BKGD overlay or a TMAP —
  don't point indexBase outside the actor-safe band.
- **Part order is load-bearing** — parents must precede children (the
  builder handles this; keep the root at index 0 if you hand-edit).
- **`cps` covers every part** — including the root, in part order.
- **Don't mark chunks packed** — the writer has no encoder.
- **Thumb coverage** — a thin prop (lamp, pole) covers few pixels in a
  72×72 thumb; that's normal. Override `prop.thumb = {dir, fov}` only if
  the auto-fit 3/4 view hides the prop's identity.

## Iterate

1. Build → open `out/<fileName>/<prop>.png`, fix spec (geometry, ramps).
2. Validation runs in the build — watch for FAIL lines and the size table
   (compare against actor ~15–20 height).
3. Dev-server smoke test with `?vxp=` — props should appear in the prop
   book, place on stage, and show the nine actions in the action browser.
4. Roll-call strips reuse the PRTH thumb automatically.

Deeper format detail (custom actions, multi-bset costumes, embedded
props): `tools/generators/actors-props/actors-props.md`.
