# Movies (.3mm) — the full anatomy plus build & edit recipes

**Instruction set for an AI assistant.** You are being asked to deconstruct,
modify, or create `.3mm` movie files — e.g. "build a 30-second movie with two
actors and a cut to a close-up", "add a sound effect at frame 40", "make this
actor walk across the scene", "import this scene into that movie". This file
is the complete spec. Read `tools/generators/common/chunky-format.md` first;
the actor-format internals live in `actors-props/actors-props.md` and
background/camera internals in `scenes/scenes-cameras.md`.

Reference code: `src/format/movie.ts` (`parseMovie`, `parseScene`,
`parseActor`, `serializeMovie`, `SEVT`, `AET`),
`src/format/content.ts` (`parseTbox`, `parseMsnd`, `STY`),
`src/format/wav.ts` + `mids.ts` (audio payloads),
`src/engine/player.ts` + `actor.ts` (what the data *means* at runtime),
`src/app/movieDocument.ts` (open/save path), `src/app/edit/*` (how the editor
mutates the same records).

---

## 1. The chunk tree

```
MVIE  cno 0, name = movie title (body: 8 fixed bytes)
 ├─ GST  chid 0   roll call — arid -> actor name + template tag + flags
 ├─ GST  chid 1   source string table (carried verbatim)
 ├─ MSND chid=k   movie-level music (embedded sound subtrees)
 └─ SCEN chid=i   scene i — ORDER = chid order (sorted by chid on parse)
      ├─ GGFR chid 0   frame events — applied when the playhead reaches nfrm
      ├─ GGST chid 1   start events — applied unconditionally at scene load
      ├─ ACTR chid=j   actor record j
      │    ├─ PATH chid 0  route polyline (GL of {x,y,z,dwr})
      │    ├─ GGAE chid 0  actor event list (GG)
      │    └─ TMPL chid 0  embedded template (sid-0 / 3D-text actors only)
      ├─ TBOX chid=j   text box j
      │    └─ RTXT -> TEXT / GLMP / AGPA
      ├─ MSND chid=k   scene-embedded sounds
      └─ THUM chid 0   sorter thumbnail (an MBMP bitmap, kept verbatim)
```

Playback runs at **6 fps** (`FPS`). Frame numbers are signed i32s; the
unbounded marker is `0x7fffffff` (`KLW_MAX`).

## 2. Chunk bodies

### MVIE — 8 bytes

`serializeMovie` writes the fixed body `01 00 03 03 02 00 02 00`
(bo + osk + two i16s), `cno = 0`, `loner` flag set, `name` = movie title.

### SCEN — 16 bytes

```
u16 bo | i16 osk | i32 nfrmLast | i32 nfrmFirst | i32 trans
```

`nfrmFirst..nfrmLast` inclusive; `trans` = transition into the *next* scene:
`-1` Nil · `0` Cut · `1` FadeToBlack (12f) · `2` FadeToWhite (12f) ·
`3` Dissolve (24f) · `4` Black (2f) — durations at 6 fps (`TRANS_DUR`).

### GGFR / GGST — scene event lists

GG with **8-byte fixed parts**: `{i32 nfrm, i32 sevt}` + a variable part
whose layout depends on `sevt` (`SEVT`):

| sevt | Name | Variable payload | Notes |
|---|---|---|---|
| 0 | AddActr | `i32 chid` | actor `chid` becomes *present* (gate for visibility) |
| 1 | PlaySnd | `brs vlm, i32 sty, i32 fLoop, i32 ctagc, [i32 chidden, tag]*` | queued sound list — tags play in order on the style's channel |
| 2 | AddTbox | `i32 chid` | textbox appears (subject to its own nfrm span) |
| 3 | ChngCamera | `i32 icam` | persists until the next one; `SetBkgd` resets icam to 0 |
| 4 | SetBkgd | `tag` (16B) | `{sid:2, ctg:'BKGD', cno}` for library backgrounds |
| 5 | Pause | `i32 wit, i32 dts` | `wit`: 1 until click · 2 until sound drains · 3 for `dts` **60 Hz ticks** |

Start events (GGST) apply at scene load regardless of frame; frame events
(GGFR) apply cumulatively while `e.nfrm <= nfrm` — so they're sorted by
`nfrm` and later events override state (last ChngCamera wins).

### ACTR — the actor record (40 or 44 bytes)

```
u16 bo | i16 osk | brs dxyzFullRte.x/y/z | i32 arid | i32 nfrmFirst
| i32 nfrmLast   (only if body >= 44 bytes — else unbounded)
| tag tagTmpl    (16B: sid/pcrf/ctg/cno)
```

- `dxyzFullRte` = global route offset; the actor's world position is
  `routePoint(rtel) + dxyzFullRte + dxyzSubRte` (subroute offset from
  Add/Move events).
- `arid` = roll-call id (index into the chid-0 GST); `tagTmpl` = the
  actor/prop template tag (`{sid:2,'TMPL'}` library, `{sid:0}` embedded,
  `{sid:'rt'}` runtime 3D text).
- `name` lives on the chunk's CRP name field; the roll call carries it too.

### PATH — the route

GL of **16-byte entries** `{brs x, brs y, brs z, brs dwr}` — a polyline.
`dwr` on point *i* is the length of segment *i → i+1* (the last point's is
typically 0). An actor's **rtel** cursor = `{irpt, dwrOffset, dnfrm}`:
segment index, distance into the segment, frame counter. Per frame the
cursor advances `step` units; position interpolates along segments.

### GGAE — the actor event list

GG with **20-byte fixed parts** `{i32 aet, i32 nfrm, i32 irpt, brs dwrOffset,
i32 dnfrm}` (the last three = the event's rtel) + `aet`-dependent variable
data (`AET`):

| aet | Name | Variable payload | Meaning |
|---|---|---|---|
| 0 | Add | `brs x,y,z, bra xa,ya,za` | subroute start: enters stage at rtel with offset+orientation. **Fires on `nfrm`** — all other types fire on rtel |
| 1 | Actn | `i32 anid, i32 celn` | switch action + cel |
| 2 | Cost | `i32 ibset, i32 cmid, i32 fCmtl, tag` | costume: `fCmtl=1` uses template CMTL `cmid`; else `tag` = MTRL |
| 3 | RotF | `bmat34` | forward (persistent) rotation |
| 4 | Pull | `brs x,y,z` | squash/stretch factors (accumulated, clamp [0.25,4]) |
| 5 | Size | `brs` | uniform scale (clamp [0.25,10]) |
| 6 | Snd | `i32 fLoop, i32 fQueue, brs vlm, i32 celn, i32 sty, i32 fNoSound, i32 chid, tag` | `celn=-1` plays at frame; else latches to a cel (motion-match) |
| 7 | Move | `brs x,y,z` | add to subroute offset (drags merge/accumulate) |
| 8 | Freeze | `i32 bool` | freeze cel advancement |
| 9 | Tweak | `brs x,y,z` | teleport position at this rtel |
| 10 | Step | `brs` | route step length override; `0` = hold position, `-1` = resume cel `dwr` |
| 11 | Rem | — | leave the stage |
| 12 | RotH | `bmat34` | heading (one-frame-ish) rotation — superseded by same-frame RotF |

**Ordering invariants** — the runtime processes the array in order:
- `Add` events are subroute boundaries, ordered by `nfrm`.
- Between Adds, events are **rtel-ordered** (compare `irpt`, then
  `dwrOffset`, then `dnfrm` — `cmpRtel`).
- The record's `nfrmFirst` = `events[0].nfrm` (the parser also stores it;
  runtime `nfrmFirst` derives from the first event).
- An actor with no events is dead — editors remove the record outright.

### TBOX — text box (36 bytes) + RTXT

```
u16 bo | i16 osk | i32 nfrmFirst | i32 nfrmMax | i32 l | i32 r | i32 t | i32 b | i32 chid | i32 fStory
```
Screen rect in 640×480 view pixels; `fStory` = story box vs credits box
(credits scroll on their first frame). The `chid` field selects which RTXT
kid to use (usually 0).

**RTXT body**: `bo|osk|i32 dxpDef|i32 dypFont|u32 acrBack|STN font`, kids:
`TEXT` (`u16 osk` + raw text bytes, latin1 for osk 0x0303), `GLMP` (GL of
8-byte `{u32 spcp, i32 lw}` — `spcp = sprm<<24 | cp` sorted entries =
format marks; `SPRM`: Style 1, Font 2, Fore 3, Back 4, Horz 128, Vert 129,
After 130, Object 192), `AGPA` (GG font table: fixed `i32` ordinal, variable
`i32 + u16 + STN font name`).

### MSND — sound (16 bytes) + WAVE/MIDS

`bo|osk|i32 sty|brs vlm|i32 invalid`. `sty` (`STY`): 0 nil, 1 unused, **2
sfx, 3 speech, 4 midi** — the mixing channel the sound queues on. Kids:
`WAVE` (a raw RIFF — original content is mono 22050 Hz **MS-ADPCM**, fmt tag
2; `decodeWavAdpcm` handles it) or `MIDS` (raw MIDI event stream — varint
delta times **already in milliseconds**, status+params, running status,
`0xff 0x2f` ends it; *not* standard SMF). An MSND adopted under SCEN is
referenced by tags `{sid:0, ctg:'MSND', cno}`; under MVIE it's movie-level
music.

### GST roll call (chid 0)

GST with `cbEntry = 32`: `str` = display name; `extra` (28 bytes) =
`{i32 arid, i32 cactRef, u32 grfbrws, tag tagTmpl}` — `arid` links ACTR
records to names; `cactRef` counts ACTR records sharing the arid across
scenes; `grfbrws` = browse/roll-call flags. `serializeMovie` rebuilds this
automatically from your actor records — you only supply names + arids.

## 3. The parsed document shape

`parseMovie(chunkyFile)` returns — **this is the object `serializeMovie`
consumes**, so authoring = constructing this shape:

```ts
movie = {
  chunkyFile,        // source file when editing; omit for scratch builds
  name,              // movie title
  scenes: [ {
    cno, name, nfrmFirst, nfrmLast, trans,
    startEvents: [ {sevt, nfrm, data} ],
    frameEvents: [ {sevt, nfrm, data} ],   // sorted by nfrm
    actors:    Map<chid, actorRec>,
    textboxes: Map<chid, tboxRec>,
    thumb,                                // Uint8Array MBMP | null
  } ],
  rollCall: Map<arid, {name, cactRef, grfbrws, tagTmpl}>,  // rebuilt on save
  gstSource,                              // bytes | null, carried verbatim
}

actorRec = {
  cno, arid, nfrmFirst, nfrmLast,        // nfrmLast = 0x7fffffff when open-ended
  dxyzFullRte: {x,y,z},                  // global offset
  tagTmpl: {sid, ctg:'TMPL', cno},
  route: [ {x,y,z,dwr} ],
  events: [ {aet, nfrm, rtel:{irpt,dwrOffset,dnfrm}, data} ],
  name,
}

tboxRec = { cno, chid, nfrmFirst, nfrmMax, l,t,r,b, fStory,
            rtxt: {font, dxpDef, dypFont, acrBack, text, mpes:[], fonts:[]} }
```

`serializeMovie(movie, {rtmpl, userSnd})` writes the file:
`rtmpl(cno)` resolves `sid:'rt'` template tags (embedded TMPL+TDT chunks are
generated); `userSnd(key)` resolves `sid:'usr'` tags to
`{name, bytes, midi, kind, vlm}` (an MSND+WAVE/MIDS subtree is built and
adopted under the scene, deduped per key). `sid:0` chunk tags (embedded
MSND/TMPL) are deep-copied from `movie.chunkyFile` — **keep `chunkyFile` on
the movie record when editing existing files or embedded content is lost**.

## 4. Recipe: build a movie from scratch

```js
import { serializeMovie, SEVT, AET } from '../src/format/movie.ts';

const BKGD = { sid: 2, ctg: 'BKGD', cno: 0 };      // pick a real one (scenes brief §3)
const TMPL = { sid: 2, ctg: 'TMPL', cno: 8236 };   // e.g. Patrick from the fixture

const actors = new Map();
actors.set(0, {
  cno: 0, arid: 0, nfrmFirst: 1, nfrmLast: 0x7fffffff,
  dxyzFullRte: { x: 0, y: 0, z: 0 }, tagTmpl: TMPL,
  route: [ { x: 0, y: 0, z: 0, dwr: 40 }, { x: 40, y: 0, z: 0, dwr: 0 } ],
  events: [
    { aet: AET.Add,  nfrm: 1, rtel: { irpt: 0, dwrOffset: 0, dnfrm: 0 },
      data: { x: 0, y: 0, z: 0, xa: 0, ya: 0, za: 0 } },
    { aet: AET.Actn, nfrm: 1, rtel: { irpt: 0, dwrOffset: 0, dnfrm: 0 },
      data: { anid: WALK_ANID, celn: 0 } },
  ],
  name: 'Hero',
});

const movie = {
  name: 'My Movie',
  scenes: [ {
    name: 'Opening', nfrmFirst: 1, nfrmLast: 120, trans: 3 /*Dissolve*/,
    startEvents: [
      { sevt: SEVT.SetBkgd, nfrm: 1, data: BKGD },
      { sevt: SEVT.ChngCamera, nfrm: 1, data: 0 },
      { sevt: SEVT.AddActr, nfrm: 1, data: 0 },
    ],
    frameEvents: [
      { sevt: SEVT.ChngCamera, nfrm: 60, data: 1 },             // cut to angle 1
      { sevt: SEVT.PlaySnd, nfrm: 10,
        data: { vlm: 1, sty: 2 /*Sfx*/, fLoop: false,
                tags: [ { sid: 2, ctg: 'MSND', cno: SND_CNO } ] } },
    ],
    actors, textboxes: new Map(), thumb: null,
  } ],
};

const bytes = serializeMovie(movie);   // -> .3mm
```

Discover valid `cno`s/`anid`s by enumerating `ofType('BKGD'|'TMPL'|'MSND')`
on the content files and `kidsOf('TMPL', cno, 'ACTN')` for action ids
(the actors brief §3–4).

## 5. Recipe: add an actor to an existing scene

Mirrors `movieEdits.insertActor`:

```js
const s = movie.scenes[i], nfrm = INSERT_FRAME;
const chid = s.actors.size ? Math.max(...s.actors.keys()) + 1 : 0;
const arid = s.actors.size ? Math.max(...[...s.actors.values()].map(a => a.arid)) + 1 : 0;
const rtel0 = { irpt: 0, dwrOffset: 0, dnfrm: 0 };
s.actors.set(chid, {
  cno: chid, arid, nfrmFirst: nfrm, nfrmLast: s.nfrmLast,
  dxyzFullRte: { x: 0, y: 0, z: 0 }, tagTmpl: { sid: 2, ctg: 'TMPL', cno },
  route: [{ x: 0, y: 0, z: 0, dwr: 0 }],          // origin anchor — the placement lives in the Add offset
  events: [
    { aet: AET.Add, nfrm, rtel: { ...rtel0 }, data: { x: p.x, y: p.y, z: p.z, xa: 0, ya: 0, za: 0 } },
    { aet: AET.Actn, nfrm, rtel: { ...rtel0 }, data: { anid, celn: 0 } },
  ], name });
(nfrm === s.nfrmFirst ? s.startEvents : s.frameEvents)
  .push({ sevt: SEVT.AddActr, nfrm, data: chid });
s.frameEvents.sort((a, b) => a.nfrm - b.nfrm);
```

The AddActr scene event is the *presence gate* — skip it and the actor
evaluates but never renders.

## 6. Recipe: edit actor behavior

The event list is the single source of truth — edits are event splices:

- **Move/teleport**: `Move` adds a persistent offset delta (drags merge);
  `Tweak` teleports at an rtel (used mid-route).
- **Walk a path**: extend `route` with points (set each point's `dwr` = its
  segment length — `Math.hypot(dx, dy, dz)`), ensure the action's `grfactn`
  isn't STATIC, and the actor walks `celDwr` units per frame along it. A
  `Step` event overrides the step length (`-1` resumes natural).
- **Rotate**: `RotH` (this frame only — good for a one-off turn) vs `RotF`
  (persists). Data is a full bmat34: compose with `M.mul(M.rotY(a), cur)`.
- **Scale**: `Size` (uniform, absolute value) / `Pull` (per-axis factors).
- **Costume**: `Cost` `{ibset, cmid, fCmtl:1}` (template costume) or
  `{ibset, cmid:0, fCmtl:0, tag:{sid:2,ctg:'MTRL',cno}}` (material).
- **Action change**: insert `{aet:AET.Actn, nfrm, rtel:current, data:{anid,
  celn:0}}` — editors then add `Freeze`+`Step` per `setActionCore` (freeze
  when the subroute is done, Step -1 for locomoting actions).
- **Leave/return**: `Rem` removes from stage; a later `Add` (on its `nfrm`)
  starts a NEW subroute — append a route point for it and use a fresh rtel.
- **Sounds on actors**: `Snd` event; `celn = -1` fires at the frame,
  `celn = k` latches to animation cel k (footsteps — "motion match").
  `sty` 2/3 only — **midi (4) can't attach to actors**.

For surgical edits prefer the runtime helpers where available —
`Actor.addDoAev`/`setActionCore`/`fRotate`/`fPull`/`fScale`/`fSetSnd` encode
all the merge/supersede rules; only hand-splice `rec.events` when working
offline, and keep the §2 invariants.

## 7. Recipe: scenes, textboxes, sounds

- **New scene**: `scenes.splice(i+1, 0, {name, nfrmFirst:1, nfrmLast:N,
  trans, startEvents:[SetBkgd...], frameEvents:[], actors:new Map(),
  textboxes:new Map()})` — scene order = array order (serialize re-chids).
- **Import a scene from another movie**:
  `movie.chunkyFile.adopt(srcCf, 'SCEN', cno)` then `parseScene` the adopted
  chunk — the whole subtree (actors, embedded MSNDs, TMPLs) crosses with
  fresh cnos.
- **New textbox**: add a TBOX record `{chid, nfrmFirst:nfrm, nfrmMax:
  0x7fffffff, l,t,r,b (640×480 px), fStory, rtxt:{font:'Comic Sans MS',
  dxpDef:0, dypFont:14, acrBack:0xffffffff, text, mpes:[], fonts:[]}}` +
  an `AddTbox` start event (`textboxEdits.insertTextbox` always uses the
  start list). Format marks go in `mpes` sorted by `(sprm<<24|cp)`.
- **Scene sounds**: `PlaySnd` frame events; same-style events on one frame
  queue (push onto `data.tags`) or replace. `vlm` 0..1, `fLoop` for loops.
- **Pause**: `{sevt:5, data:{wit:2, dts:0}}` holds until sound drains;
  `{wit:1}` waits for a click; `{wit:3, dts}` waits `dts` 60 Hz ticks.
- **Embedded sound**: tag `{sid:'usr', cno:key}` + `opts.userSnd(key) ->
  {name, bytes, midi, kind}` builds an MSND subtree under the scene
  (kind → sty: music 4, speech 3, else 2). `bytes` = raw wav (any rate —
  decode happens at play) or raw MIDS bytes when `midi:true`.
  Existing sid-0 MSNDs are preserved automatically when `movie.chunkyFile`
  stays attached.

## 8. Validation checklist

1. `new ChunkyFile(bytes)` → `parseMovie` returns your scenes/events
   intact (this is exactly what `test/movie.test.ts` round-trips).
2. `tools/dump.mjs out.3mm` — eyeball the event stream.
3. **Playback sim** — the definitive check:

   ```js
   const p = new MoviePlayer(new ChunkyFile(bytes, 'm'), lib);
   p.loadScene(0);
   while (p.step()) { /* assert p.frame, p.icam, p.visibleActors */ }
   console.log(p.warnings);   // missing templates surface here
   ```

   (`tools/play.mjs` does this; `lib` needs the five content files — fetch
   once and cache like `test/helpers.ts` does.)
4. `npm test`, `npx tsc --noEmit`.
5. In-app: `npm run dev` → open the file or `?3mm=`.

## 9. Pitfalls

- **Forget the AddActr** and the actor simulates invisibly. Forget `Rem`
  handling and a "deleted" actor reappears — deleting events ≠ removing
  presence; use `Rem` or drop the record.
- **`Add` fires on `nfrm`; everything else fires on `rtel`** — mixing up the
  two orderings produces actors that ignore events or teleport.
- **Route `dwr` is the segment length FROM that point** — a zeroed `dwr`
  mid-route parks the actor there forever.
- **`frameEvents` must stay `nfrm`-sorted** — `readSevs` order is file
  order; the player applies them cumulatively.
- **ChngCamera persists** — cut back explicitly; SetBkgd resets to angle 0.
- **Lose `movie.chunkyFile`** and embedded chunks (sid-0 MSNDs/TMPLs) can't
  be copied on save — keep it on the record when editing.
- **`'rt'`/`'usr'` tags need their `opts` resolvers** at serialize time, or
  they write dangling references.
- **Names**: actor display name = chunk name AND roll-call `str` — the
  serializer rebuilds roll call from `actorRec.name`/`arid`, so set both.
- **Textboxes need both** the TBOX record and its `AddTbox` event; a story
  box (`fStory:1`) renders statically, credits scroll on `nfrmFirst`.
- **THUM**: keep `scene.thumb` to preserve the sorter thumbnail; set `null`
  to let the sorter re-render the first frame (do this after back-chops).
- **`trans` is written on the OUTGOING scene** — the last scene's trans is
  meaningless.
