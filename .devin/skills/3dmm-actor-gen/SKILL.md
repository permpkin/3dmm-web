# 3DMM Actor Generator

Turn an actor description into a loadable `.vxp` expansion: procedurally
model a humanoid on a **cloned stock skeleton** — generated actors inherit
the base template's full 33-action animation set (Walk/Run/Jump/Dance/Sit/
etc.) verbatim — give parts palette-ramp materials or indexed TMAP textures,
and ship multiple costumes ("outfits") the costume easel can cycle.

## Pipeline (tools/actor-gen/)

```
spec (specs/actors/*.mjs)  →  base rig (rig.mjs)  →  world-space bone parts (geo.mjs)
  →  bake to bone-local  →  chunk encoders (lib.mjs)
  →  .3cn + .3th (writeChunkyFile)  →  .vxp zip in public/expansions/
```

Run:

```sh
npx vite-node tools/actor-gen/build.mjs tools/actor-gen/specs/actors/tinman.mjs
```

Outputs:

- `public/expansions/<fileName>.vxp` — `<fileName>.3cn` + `.3th` + `.cfg`
- `tools/actor-gen/out/<fileName>/<actor>_<outfit>.png` — 216² rest-pose
  preview per outfit + `<actor>_walk.png` mid-stride (gitignored)
- `tools/actor-gen/out/_cache/TMPLS.3CN` — the fetched stock template
  library (first build downloads ~32 MB once)
- The build self-validates: re-parses the `.3cn`, checks every cel's
  `imat34`/`chidModl`, checks every CMTL covers its whole set, and steps a
  headless `Actor` through **every** action reporting rest-pose bounds.

Load in-app: `npm run dev` → `http://localhost:5177/?vxp=expansions/<fileName>.vxp`
then open the actor book (each actor appears by name; the action browser
shows the full stock set; the costume easel cycles outfits).

Helper: `npx vite-node tools/actor-gen/dump.mjs [name|cno]` prints a base
rig's bone table — joints, stock mesh bounds, set ids, alt-model map — the
numbers you author against.

## Authoring a spec

Copy `tools/actor-gen/specs/actors/tinman.mjs` (per-actor specs live in
`specs/actors/`). Shape:

```js
export default {
  name: 'Pack Name',          // addon display name (lands in the .vxp's .cfg extInfo)
  desc: 'Optional',           // .cfg Desc — shown in the addons list detail row
  ver: '1.0',                 // .cfg Version — the addons list badge ('0.0?' when absent)
  fileName: 'my_actors',      // .vxp/.3cn/.3th basename
  cnoBase: 840000,            // chunk-number block — MUST differ per pack
  base: 'Zack',               // stock humanoid to clone (name or cno)
  author: '...',
  actors: [{
    name: 'Tinbot',           // TMPL name = picker label + roll-call name
    thumb: { dir, fov },      // optional thumbnail camera override
    build(body, geo) {
      const head = body.part('head', { uv: (x,y,z) => [u, v] });
      geo.box(head, 0, 15.3, 0, 4.8, 4.6, 4.4);   // WORLD space
    },
    outfits: [
      { name: 'Factory', all: { ramp: R.STEEL },
        parts: { head: { ramp: R.SILVER, tex: faceTex } } },
      { name: 'Hazard',  sets: { shirt: { ramp: R.ORANGE } } },
    ],
  }],
};
```

### Authoring space

**y-up, ground y=0, actor faces +z at rest** — same convention as props.
Geometry is authored in *world* space against the base rig's rest pose and
baked into bone-local space automatically. `body` helpers:

- `body.part(bone, {uv})` — mesh accumulator for a bone (name or index)
- `body.joint(bone)` — rest joint position `[x,y,z]`
- `body.bbox / .mid / .size(bone)` — the stock mesh's rest bounds — size
  your geometry to these and it inherits animation pivots cleanly
- `body.seg(bone)` — `{a, b}` joint→child-joint span for `geo.limb`

Geometry helpers (`geo.mjs`, prop-gen kit + `limb(p,a,b,r)` +
`uvFront(mn,size)`): `box`, `cyl` (`{r0,r1,cap}`), `cone`, `sphere`,
`frustum`, `quad`, `merge`, `limb`. Any bone left unbuilt is an empty BMDL —
invisible but still animated (fine for `back`/ankle cuffs you don't want).

### The Zack rig (default base, cno 8249)

18 bones, sets **skin=0 shirt=1 pants=2 shoes=3**:

```
head(root)                       skin   joint (0,12.9)   mesh ~y13-18
torso(root) back(torso)          shirt  joint (0,7.9)    y5.7-13.3
upperArm{L,R}(torso)             shirt  joint (±3.5,10.1)
forearm{L,R}(upperArm)           skin   joint (±3.7,8.4)
shoulder{L,R}(torso)             shirt  joint (±2.0,11.8)
pelvis(root)                     pants  joint (0,6.3)
thigh{L,R} shin{L,R}(pelvis)     pants  joints (±1.0,6.8) (±1.4,4.2)
ankle{L,R}(shin)                 shoes  joint (±1.6,1.2)
shoe{L,R}(root)                  shoes  joint (±1.2,0)    feet at y0
```

Multi-root skeleton (head/pelvis/shoes hang off the actor root) — every
part is posed by the copied ACTN matrices, so stay near stock proportions
or limbs drift during animations. `modelOwner` maps the 7 alt model chids
(18–24: sit/kneel swap meshes) onto their bones; your generated mesh covers
them automatically.

### Materials

Per-part material specs resolve per outfit: `parts[bone]` >
`sets[set]` > `all` > outfit[0]'s value > gray 15.

- `{ramp}` — a socpal ramp index (the `geo.R` table: GRAY 15, SILVER 23,
  NAVY 31, PERI 39, BROWN 47, TAN 55, RED 63, STEEL 71, MAROON 79,
  ORANGE 87, PURPLE 95, GOLD 103, OLIVE 111, COCOA 119, GREEN 127,
  ROSE 135, TEAL 143). Only band 15–150 is scene-palette-safe.
- `{ramp, tex}` — adds a TMAP kid: `{w,h,px}` palette-index grid built via
  `tex.make(w,h,(x,y)=>idx)` (+ `tex.nearest(r,g,b)`, `stripes`, `checker`,
  `face`). **Index 0 = transparent cutout** — it discards, not "see ramp".
  Keep indexes 1–156 (scenes may overlay 157+). Textured parts render
  flat-bright in classic mode and lit in modern lighting.
- `{ramp, tex, txxf}` — optional 6-element bmat23 UV transform.
- UVs: parts that get a `tex` anywhere need UVs — set `body.part(bone,
  {uv})` to `'front'` (planar +z decal — faces), `'wrap'` (cylindrical),
  `'face'` (per-face dominant-axis decal, splits verts), or
  `fn(x,y,z)->[u,v]`. **TMAP px row 0 = uv v=0 = the TOP of the projected
  part — author textures top-down like a normal image** (both the preview
  rasterizer and the three.js path sample `px[floor(v*h)]` directly).
  **UVs wrap (`fract`) — verts outside the textured region must park on a
  solid texel** or they smear your features.
- `{parts: {bone: {mesh: (p,geo,rig)=>{…}, …}}}` — replacement mesh for
  that outfit (hats, helmets). Authored in world space, baked like `build`.
  A mesh-changing costume becomes an **accessory** variant: costume-mode
  clicks cycle same-model costumes, accessory-mode clicks cross groups.

### Outfits

`outfits[]` order = the costume easel's cycle order; outfit 0 is the default
applied on every Add. One CMTL per outfit per ibset (cmid chid =
`outfit*cbset + ibset`, matching stock column layout).

## What the builder emits (per actor)

- `TMPL` (grftmpl 0 = actor) named `actor.name`, base `rest` copied.
- `GLPI`/`GLBS` copied from the base (skeleton + set assignment verbatim).
- `BMDL` per base model chid: generated mesh baked bone-local; alt chids
  alias their owner bone's mesh; unbuilt bones emit empty meshes.
- `CMTL` per outfit×ibset with an `MTRL` kid per in-set part (+ `TMAP`/
  `TXXF`/`BMDL` kids as needed); identical materials dedupe to one chunk.
- `GGCM` costume map (cmid columns = outfits).
- All base `ACTN` subtrees **byte-copied** (GGCL+GLXF) — identical cels,
  `dwr` locomotion, `grfactn` flags, and names.
- `.3th`: one `TMTH` (cno = template cno) → `GOKD` → 72×72 `MBMP` posed at
  rest in outfit 0, rasterized with engine-identical ramp shading and
  nearest-texel TMAP sampling on transparent background.

## Hard rules

- **cnoBase per pack.** Same rule as props — must not collide with builtin
  TMPLS.3CN or other packs. Default `800000 + hash(fileName)%200 * 1000`.
- **Chunk budget ~480 per pack** (thumbs live at cnoBase+500). An actor
  costs ~160–250 chunks (33 ACTN subtrees dominate) → at most 2 actors
  per pack; split bigger sets or bump the .3th block in `build3th`.
- **Authored in world space only.** The bake uses each bone's *rest* world
  inverse — if you model the figure anywhere but the rest pose location,
  pieces offset permanently (visible as a gap in `out/*.png` previews).
- **Don't resize the skeleton's proportions blindly.** Limb pivots live in
  the copied matrices — geometry far from the stock joint frame will
  orbit wrong. Compare with `body.bbox(bone)` / `dump.mjs` first.
- **Every in-set part needs an MTRL** — the resolver always supplies one
  (default gray), but a `sets`/`parts` typo fails validation.
- **Texture index 0 cuts holes.** Opaque-fill everything visible; park
  stray verts (antennae, hat brims) on a solid texel via a custom `uv` fn.
- **Don't mark chunks packed** — the writer has no encoder.
- **`.vxp` loads are IDB-cached by URL** — after rebuilding the same
  `fileName`, the app serves the stale zip. Iterate under a fresh
  `fileName` (or clear the `mmsvxp` IndexedDB store / use `?packs=` on an
  unzipped directory instead).

## Iterate

1. `npx vite-node tools/actor-gen/dump.mjs Zack` — bone/joint/bbox table.
2. Build → open `out/<fileName>/<actor>_<outfit>.png` + `_walk.png` — fix
   geometry, proportions, textures, outfit colors.
3. Watch for FAIL lines and the size table (stock actors are ~15–20 tall).
4. Dev-server smoke test with `?vxp=` — actor book shows the name/thumb,
   placed actor walks all 33 actions, costume easel cycles outfits
   (accessories mode for mesh-swapping costumes).

Format details: `tools/generators/actors-props/actors-props.md` (CMTL/ACTN/
BMDL/TMAP byte layouts, costume semantics) · `tools/prop-gen` for the
sibling pipeline.
