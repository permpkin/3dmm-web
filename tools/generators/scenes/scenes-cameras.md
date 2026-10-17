# Scenes & Camera Angles — backgrounds, cameras, and scene records

**Instruction set for an AI assistant.** You are being asked to deconstruct,
modify, or create *scenes* for a Microsoft 3D Movie Maker port — e.g. "a new
3D scene in the wild west with 6 camera angles", "swap the backdrop", "cut
to a different camera mid-scene". Two different things are both called
"scene" — keep them straight:

- A **BKGD** (backdrop) = the 3D environment: palette, lights, and a set of
  fixed **CAM** camera angles, each with a pre-rendered backdrop image +
  depth map. Lives in `BKGDS.3CN` or a pack — shared content, like a template.
- A **SCEN** = a *movie scene*: a frame range inside a `.3mm` that references
  one BKGD at a time and cuts between its camera angles via events.

This file covers both. Read `tools/generators/common/chunky-format.md` first.
Reference code: `src/format/content.ts` (`parseBkgd`, `parseCamera`,
`parseMbmp`, `parseZbmp`), `src/format/movie.ts` (scene parse/serialize),
`src/engine/player.ts` (how the events behave at runtime),
`src/app/edit/movieEdits.ts` (`editBackground`/`editCamera`),
`src/app/ui/easels.ts` (`SorterEasel` — scene reorder/transition UI).

---

## 1. The BKGD chunk tree

```
BKGD  (body: palette base index)
 ├─ GLCR  chid 0   palette overlay — GL of 4-byte entries [B,G,R,0]
 ├─ GLLT  chid 0   lights          — GL of 56-byte entries {bmat34, brs intensity, i32 type}
 ├─ CAM   chid=i   camera angle i  (chid IS the camera index used by ChngCamera)
 │    ├─ MBMP chid 0   backdrop color image (RLE, palette-indexed)
 │    └─ ZBMP chid 0   backdrop depth fill (u16 per pixel)
```

### BKGD body (5 bytes)

```
u16 bo | i16 osk | u8 indexBase
```

`indexBase` is where the GLCR palette writes into the shared 256-color
social palette — `palette[k]` lands at index `indexBase + k` (clamped < 256).
Actor materials shade through palette ramps, so a background's palette
overlay is part of its look.

### GLCR — the palette

A GL of 4-byte entries: **byte order B, G, R, 0**. Parsed as
`[e[2], e[1], e[0]]` → RGB. A pack-level GLCR with exactly 256 entries is
treated as a pack's whole social palette (expansionPacks).

### GLLT — lights

GL, 56-byte entries: `bmat34` (the light's orientation matrix) + `brs`
intensity + `i32` type. The renderer uses at most the first 4
(`bkgd.lights.slice(0, 4)`). Type values aren't enumerated in this codebase —
when authoring, **copy a light entry from an existing BKGD that has the mood
you want** and adjust intensity.

### CAM body (≥ 76 bytes)

```
u16 bo | i16 osk | brs hither | brs yon | bra fov | i16 pad
| brs apos.x | brs apos.y | brs apos.z          // primary camera position
| bmat34 matrix                               // camera -> world transform
| brs x,y,z x N                               // extraApos — auxiliary world anchor points to EOF
```

- `matrix` is used **directly as `camera.matrixWorld`** by the renderer —
  it's camera→world, i.e. the inverse of a view matrix. Row 3 (elements
  9–11) should equal `apos`. Forward is the camera's -Z in world space; the
  renderer projects onto `cam.rgb`/`cam.z`.
- `fov` is a `bra` angle (`0x10000` = 2π) — the vertical FOV. `hither`/`yon`
  are the clip planes (world units).
- `extraApos` = additional world points the original editor used as placement
  anchors; optional (loop `while (r.remaining >= 12)`). Safe to emit zero
  entries or copy a few stage-relevant points.

### MBMP — the backdrop image

```
u16 bo | i16 osk | u8 fMask | u8 bFill | i16 pad
| i32 left | i32 top | i32 right | i32 bottom | i32 pad          -> 28-byte header
| i16 rowLen[height]                                            // byte length of each RLE row
| RLE row data
```

Each row is a byte stream: `u8 transparentRun`, then `u8 runLen` + (if
`fMask==0`) `runLen` palette-index bytes — repeat until `rowLen` consumed.
With `fMask==1` the runs carry no pixels and are filled with `bFill` (it's a
mask bitmap). Transparent pixels decode as `-1`. Pixel values index the
256-color palette *after* the BKGD's GLCR overlay is applied. Backdrop images
are sized for the scene viewport — the renderer's native scene size is
**544×306**, and originals are around that.

**Encoder** (row-wise maximal runs — you can also split runs freely):

```js
function encodeMbmp(width, height, px) { // px[i] = palette index or -1
  const w = new Writer();
  w.bo().u16(0x0303).u8(0).u8(0).u16(0)
   .i32(0).i32(0).i32(width).i32(height).i32(0);
  const rows = [];
  for (let y = 0; y < height; y++) {
    const rw = new Writer(); let x = 0;
    while (x < width) {
      let skip = 0;
      while (x + skip < width && px[y * width + x + skip] < 0 && skip < 255) skip++;
      if (skip === 255) { rw.u8(255).u8(0); x += skip; continue; } // len-0 pair just adds the skip
      x += skip; let len = 0;
      while (x + len < width && px[y * width + x + len] >= 0 && len < 255) len++;
      rw.u8(skip).u8(len);
      for (let i = 0; i < len; i++) rw.u8(px[y * width + x + i] & 0xff);
      x += len;
    }
    // trailing transparent run needs no marker — the row ends at rowLen
    rows.push(rw.out());
  }
  for (const r of rows) w.u16(r.length);
  for (const r of rows) w.bytes(r);
  return w.out();
}
```

(Adapt to a non-zero `left/top` origin if you want a sub-rect fill; the app
honors the rect.)

### ZBMP — the depth fill

```
u16 bo | i16 osk | i16 left | i16 top | i16 width | i16 height   -> 12-byte header
| u16 z[width * height]
```

One u16 per pixel — the pre-rendered depth used to composite actors *into*
the backdrop (actors occlude and are occluded correctly). `parseZbmp` reads
them little-endian starting at offset 12. Depth encoding: `tools/calib.mjs`
probes it empirically — `pers ≈ 65535 * (F*(zc-N)) / (zc*(F-N))` — near
values are small, far values approach 65535. If you can't produce real
depth, a flat far value (e.g. 60000) yields a "actors always in front"
backdrop; a floor plane's depth ramp is easy to compute per row.

## 2. How a movie scene uses a BKGD

A `SCEN` chunk (body: `bo|osk|i32 nfrmLast|i32 nfrmFirst|i32 trans`) has two
event lists — kids `GGFR` chid 0 (**frame events**, fire when the frame is
reached) and `GGST` chid 1 (**start events**, applied unconditionally at
scene load). Relevant scene events (`SEVT`):

| sevt | Name | Data (variable part) | Behavior |
|---|---|---|---|
| 4 | SetBkgd | `tag` (16B) | picks the BKGD; **resets camera to icam 0**. Usually the only start event that matters. |
| 3 | ChngCamera | `i32 icam` | switches to `bkgd.cameras[icam]` (falls back to camera 0 if missing) |
| 5 | Pause | `{i32 wit, i32 dts}` | holds the frame: wit 1 = until click, 2 = until sound drains, 3 = for `dts` **60 Hz ticks** |
| 0 | AddActr | `i32 chid` | actor presence gate |
| 2 | AddTbox | `i32 chid` | textbox presence |
| 1 | PlaySnd | sound payload | see movies brief |

- `startEvents` apply at load no matter the frame; `frameEvents` apply
  cumulatively for `nfrm <= current` — **a ChngCamera persists until the next
  one**, so to "return" to an angle you must emit another ChngCamera.
- `trans` on the SCEN body is the transition *into the next* scene:
  `-1` Nil, `0` Cut, `1` FadeToBlack (12f), `2` FadeToWhite (12f),
  `3` Dissolve (24f), `4` Black (2f) — at 6 fps (`TRANS_DUR`).
- `nfrmFirst`/`nfrmLast` are inclusive frame bounds; playback runs at 6 fps.
- A `THUM` chid-0 kid holds an MBMP thumbnail for the scene sorter
  (same MBMP spec — small, e.g. 143×80-ish; preserved verbatim on save).

## 3. Recipe: enumerate backgrounds and their camera angles

```js
import { ChunkyFile } from '../src/format/chunky.ts';
import { parseBkgd, parseCamera } from '../src/format/content.ts';

const cf = new ChunkyFile(await fetchBuf(UPSTREAM + 'BKGDS.3CN'), 'BKGDS');
for (const c of cf.ofType('BKGD')) {
  const b = parseBkgd(cf, c.cno);
  const cams = await Promise.all(b.cameras.map(async (cno, i) => {
    const cam = parseCamera(cf, cno);
    return `#${i} cno=${cno} fov=${(cam.fov * 180 / Math.PI).toFixed(0)} ` +
      `pos=(${cam.apos.map(v => v.toFixed(1))}) img=${cam.rgb?.width}x${cam.rgb?.height}`;
  }));
  console.log(`BKGD ${b.cno} "${b.name}" base=${b.indexBase} pal=${b.palette?.length} lights=${b.lights.length}\n  ${cams.join('\n  ')}`);
}
```

This is how you answer "what backgrounds/angles exist" — the camera picker
thumbs live in `bkgds.3th` (`BKTH` chunks → `backgroundThumbCatalogs`), but
the authoritative angle list is always `bkgd.cameras` (CAM kid chids).

## 4. Recipe: "a new 3D scene in the wild west with 6 camera angles"

Two honest paths — pick based on whether the user needs *new art* or just
*a playable scene*:

### Path A — reuse an existing BKGD, author the scene record (fast, fully supported)

Every stock BKGD already ships multiple camera angles. "6 camera angles" =
one scene that cuts between 6 `icam`s:

```js
scene.startEvents = [
  { sevt: 4 /*SetBkgd*/, nfrm: 1, data: { sid: 2, ctg: 'BKGD', cno: WESTERN_BKGD_CNO } },
  { sevt: 3 /*ChngCamera*/, nfrm: 1, data: 0 },
];
const ANGLES = [0, 1, 2, 3, 4, 5];          // chids from bkgd.cameras
const SEGMENT = 24;                          // frames per angle (4s at 6fps)
scene.frameEvents = ANGLES.slice(1).map((icam, i) =>
  ({ sevt: 3, nfrm: 1 + SEGMENT * (i + 1), data: icam }));
scene.nfrmFirst = 1; scene.nfrmLast = 1 + SEGMENT * ANGLES.length; // 145
```

Verify `ANGLES` exist: `bkgd.cameras.length` — requesting a missing `icam`
silently falls back to camera 0 (your "6 angles" become repeats of angle 0).

### Path B — build a custom BKGD pack (new art)

1. **Produce the backdrop renders.** Six CAM chunks ⇒ six `(image, depth)`
   pairs at ~544×306. Any renderer works — a 3D package (Blender), a
   procedural painter, or an AI image + a hand-built depth map. Convert the
   color image to **palette indices** in the pack's palette (nearest-color
   quantize against your GLCR+social palette).
2. **Write the palette**: GLCR GL of `[B,G,R,0]` entries covering every index
   your images use, starting at `indexBase` (choose a base that doesn't
   collide with ramps actors need — inspect an existing BKGD's `indexBase`).
3. **Write the lights**: 1–4 GLLT entries — copy a stock light matrix/type,
   adjust intensity.
4. **Write 6 CAM chunks**, chid 0..5. For each angle pick `apos`, build the
   camera→world `bmat34` (rows = camera basis in world space, row 3 = apos;
   `M.mul(M.mul(rotY(yaw), rotX(pitch)), M.translate(x,y,z))` composes one),
   set `fov`/`hither`/`yon`, and attach `MBMP` (§1 encoder) + `ZBMP` kids.
   A camera with **no MBMP** renders actors on the background color fill —
   legal but ugly; a camera with no ZBMP loses correct occlusion.
5. **Write the BKGD chunk** (`bo|osk|indexBase`), kids = GLCR, GLLT, CAM×6,
   `name` = "Wild West".
6. **Package**: the BKGD subtree goes in a `.3cn` (chunk cnos outside builtin
   range — builtin wins collisions); optionally a `.3th` with a `BKTH`
   (cno = the BKGD cno; `CATH` kids per camera for the angle-picker thumbs);
   `assets.json` → `?packs=`.
7. **Reference it** exactly like Path A: `SetBkgd {sid:2, ctg:'BKGD',
   cno:<your cno>}` — `Library.resolve` searches pack files automatically.

## 5. Recipe: camera cuts inside an existing scene

Append `ChngCamera` frame events to `scene.frameEvents` and re-sort by
`nfrm` — that mirrors `movieEdits.editCamera` (which edits the *effective*
camera at the current frame: it rewrites the last ChngCamera ≤ frame, or
creates one on the start list). Cutting on an exact frame: push
`{sevt:3, nfrm, data:icam}` then `frameEvents.sort((a,b) => a.nfrm-b.nfrm)`.

**Gotcha:** `SetBkgd` resets `icam` to 0 — a mid-scene background swap needs
its own ChngCamera on the same frame if you want a non-zero angle.

## 6. Recipe: add/duplicate/reorder scenes in a movie

The movie's scene order = the SCEN kids' `chid` order on MVIE. In parsed
form it's just `movie.scenes[]` — splice/reorder the array (see the movies
brief for the record shape). The sorter's move is
`chunkyFile.adopt(srcCf, 'SCEN', cno)` — deep-copy a whole scene subtree
(actors, embedded sounds, templates included) from *another* movie's
chunkyFile into yours with fresh cnos, then `parseScene` it into a record.
That's how "import a scene from another movie" works — tags inside stay
`{sid:2}` content references, so no rewriting is needed unless the source
embedded its own sid-0 chunks (adopted along automatically as subtree kids).

## 7. Validation checklist

1. `parseBkgd` returns palette/lights/cameras; `parseCamera` returns sane
   `hither < yon`, `fov` in radians (~0.2–1.2 rad typical), finite `apos`.
2. MBMP rows: `sum(rowLens)` = bytes after the rowLen table; decode a row
   back and compare pixels.
3. Scene check: `MoviePlayer.loadScene(i)` + `gotoFrame` across the camera
   cuts — `player.icam` should follow your events; `player.camera.cno`
   should equal `bkgd.cameras[icam]`.
4. `npx vite-node tools/play.mjs out.3mm` — steps the whole movie headless.
5. Visual: dev server + `?packs=` — the camera picker should show your 6
   CATH thumbs (or the numeric list falls back to camera names).
6. `npm test` + `npx tsc --noEmit` clean.

## 8. Pitfalls

- **SetBkgd resets the camera** — always re-emit ChngCamera after a mid-scene
  background change if you don't want angle 0.
- **Missing icam falls back to 0 silently** — enumerate `bkgd.cameras` first.
- **The camera matrix is world←camera**, not view matrix. Invert if you're
  deriving it from a look-at: build the world matrix directly
  (`mat34.ts` helpers) rather than inverting a view matrix.
- **Palette indices must exist after GLCR applies** — backdrop pixels and
  actor shading share one 256-entry palette; overlay collisions shift colors.
- **Depth-less backgrounds composite flat** — actors always draw over the
  backdrop fill; fine for sky-only shots.
- **`extraApos` isn't needed** — stop the CAM body after the matrix.
