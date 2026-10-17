# 3DMM Generators — LLM instruction sets

This directory holds **instruction sets** for AI assistants (chat or agent) that
create, deconstruct, and modify Microsoft 3D Movie Maker assets. Each folder is
a self-contained brief: format reference + working API + recipes + validation.

## How to use these files

Each `*.md` is written to be dropped into an AI chat as the system/context
document for an asset-creation task. Two usage modes:

1. **Repo-assisted (preferred).** The AI has this repository open. It writes
   and runs Node scripts against `src/format/` and `src/engine/` — the same
   parser/serializer the app ships. Scripts run via **`npx vite-node`** (plain
   `node` cannot resolve the `.ts` sources the tools import as `.js`):

   ```sh
   npx vite-node tools/inspect.mjs <file.3cn|file.3mm>   # chunk inventory
   npx vite-node tools/dump.mjs <file.3mm>               # parsed movie dump
   npx vite-node tools/play.mjs <file.3mm>               # headless playback sim
   npx vite-node tools/manifest.mjs                      # regen public/manifest.json
   ```

2. **Standalone spec.** The AI has no repo access. The byte-level tables in
   each brief are complete enough to emit a builder in any language — but
   generated files should still be validated against this repo's parser
   (`new ChunkyFile(bytes)` + `parseMovie` + `MoviePlayer` stepping) before
   shipping to users.

## The instruction sets

| Folder | File | Covers |
|---|---|---|
| `common/` | `chunky-format.md` | The CHN2 chunky-file container every `.3mm`/`.3cn`/`.3th`/`.chk` shares: header, chunk index (GG of CRPs), kids/chids/names, GL/GG/AL/GST sub-structures, numeric encodings (brs/bra/bmat34/tag/STN), KCDC/KCD2 packing, byte-order markers. **Read this first** — the other three briefs assume it. |
| `actors-props/` | `actors-props.md` | `.3cn` actor/prop templates: TMPL body + GLPI/GLBS/GGCM part tables, BMDL meshes, ACTN actions (GGCL cels + GLXF matrices), CMTL/MTRL/TMAP/TXXF costumes, TDT/TDF 3D text. Recipes: build a new humanoid/prop from scratch, add a brand-new animation (e.g. "long jump") to an existing character, ship it as an expansion pack. |
| `scenes/` | `scenes-cameras.md` | Backgrounds and camera angles: BKGD + GLCR palette + GLLT lights, CAM chunks (fov/clip/matrix/apos), MBMP RLE backdrop fills, ZBMP depth fills — plus how SCEN chunks in a movie reference them. Recipes: "a wild-west scene with 6 camera angles", camera cuts mid-scene, custom backdrop packs. |
| `movies/` | `movies.md` | The `.3mm` movie file: MVIE/SCEN/GGFR/GGST scene events, ACTR/PATH/GGAE actor records and the route/event model, GST roll call, TBOX/RTXT text boxes, MSND/WAVE/MIDS sound, THUM thumbnails. Recipes: build a movie from scratch, edit events/routes/actors, embed sounds, round-trip safely. |

## Cross-cutting facts every brief relies on

- **One container.** All asset files are Kauai chunky files (`CHN2` little-endian,
  or the byte-swapped `2NHC`). A file = a header + a flat chunk index; each chunk
  has a 4-char type tag (ctg), a chunk number (cno), a body, children
  (`{ctg, cno, chid}`), and an optional name.
- **Tags address content.** A `{sid, ctg, cno}` tag says *which file* a chunk
  lives in: `sid 0` = embedded in the movie itself, `sid 2` = a content-library
  file (`.3cn`), `'rt'` = runtime-built template (3D text), `'usr'` = a
  user-imported sound. `chid` picks among same-type children.
- **Playback clock.** The movie format runs at **6 fps** (`FPS` in
  `src/engine/player.ts`). Scene `trans` ids and `Pause` waits use 60 Hz ticks
  in places — the briefs flag each spot.
- **Math.** 16.16 fixed-point scalars (`brs`), 16-bit angles (`bra`,
  `0x10000 == 2π`), row-vector 4×3 matrices (`bmat34`, row 3 = translation,
  `v' = v·M`). Y is up.
- **Builtin content is remote.** `TMPLS.3CN`, `BKGDS.3CN`, `MTRLS.3CN`,
  `TDFS.3CN`, `SNDS.3CN` stream from the upstream open-sourced repo
  (`assetUrl('data/<name>')` → `raw.githubusercontent.com/microsoft/
  Microsoft-3D-Movie-Maker/<pinned>/cd3/3DMOVIE/`). New content ships as
  expansion packs (`?packs=` manifest / `?vxp=` zip) or embedded chunks.

## Verification checklist (every recipe ends here)

```sh
npm test                 # vitest — format round-trips live in test/*.test.ts
npx tsc --noEmit         # typecheck is clean; keep it that way
npx vite-node tools/inspect.mjs out.3mm   # eyeball the chunk tree you made
```

And the strongest check: open the app (`npm run dev`) and load the file via
`?3mm=<url>` or the Open command — if `MoviePlayer` can step every frame, the
file is structurally sound.
