# Actors & Props — creating and modifying 3DMM characters

**Instruction set for an AI assistant.** You are being asked to deconstruct,
modify, or create *actor/prop content* for a Microsoft 3D Movie Maker port
(e.g. "a new humanoid character with a cape and a walk animation", "add a
long-jump animation to the existing bear character"). This file is your
complete reference: the binary formats, the repo's working parser/serializer
API, and step-by-step recipes. Read `tools/generators/common/chunky-format.md`
first — everything here lives inside chunky files.

Reference code: `src/format/content.ts` (parsers), `src/engine/actor.ts`
(runtime semantics), `src/engine/library.ts` (tag resolution),
`src/app/edit/movieEdits.ts` (how the editor inserts actors),
`src/app/expansionPacks.ts` (how new content ships).

---

## 1. Mental model

An actor/prop is **not a file of its own** — it is a `TMPL` chunk (a
*template*) inside a `.3cn` content library, or embedded inside a `.3mm`
movie. A template is a small chunk tree:

```
TMPL  (body: rest pose + flags)
 ├─ GLPI   chid 0   part parent table          (required)
 ├─ GLBS   chid 0   part body-set table        (required)
 ├─ GGCM   chid 0   costume material lists per set (optional)
 ├─ BMDL   chid=i   mesh for part/model i      (many)
 ├─ ACTN   chid=anid  one animation each       (many)
 │    ├─ GGCL  chid 0  cel list (the animation frames)
 │    └─ GLXF  chid 0  matrix pool (the pose data)
 ├─ CMTL   chid=cmid  costume material list    (many)
 │    ├─ MTRL  chid=k  material for k-th part of the set
 │    └─ BMDL  chid=k  optional replacement mesh
 ├─ TDT    chid 0   present instead of GLPI etc. -> 3D text template
 └─ (MTRL chunks live in MTRLS.3CN too — costumes can also tag them)
```

Everything on the skeleton is a **part**: an indexed node in a parent-chain.
Rendering walks parts in order — `worldMatrix[i] = localPose[i] ·
worldMatrix[parent[i]]` (`Actor.partWorldMatrices`), so **a part's parent
index must always be lower than its own index**.

Costumes are **material lists targeted at body-part sets**. Every part has an
`ibset` (body-set index, from GLBS). A `CMTL` carries one `ibset` and a
material (+ optional replacement mesh) *for each part of that set* — the kid
`chid`s inside a CMTL index into the subset of parts whose ibset matches, in
part order. `GGCM` maps `ibset -> [cmid, cmid, …]`; `cmids[ibset][0]` is the
default costume applied on every `Add`.

### What a cel is

An `ACTN` action = a list of **cels** (animation frames) + a **matrix pool**.
Each cel says, per part: which model (or keep current, `-1`) and which pool
matrix is its local pose this cel. Cels also carry `dwr` — the route distance
the cel covers — which is how walk/run animations *locomote* (see §5).

## 2. Byte-level spec

### TMPL body (16 bytes)

```
u16 bo | i16 osk | bra xaRest | bra yaRest | bra zaRest | i16 pad | u32 grftmpl
```

- `rest` = rest-pose orientation applied to every part.
- `grftmpl` flags: `0x2` = 3D-text template (has a `TDT` kid — see §6),
  `0x4` = **prop** (roll-call lists split on this bit).

### GLPI / GLBS bodies — GLs of i16

`GLPI`: one `i16` parent index per part (`-1` = root). `GLBS`: one `i16`
ibset per part. Both are **required** — `parseTemplate` throws without them.
Part count `n = parents.length` must equal `ibsets.length`.

### GGCM body — a GG

Each entry's variable part is a flat list of `i32` cmids. Entry *i* is the
cmid list for ibset *i* (`template.cmids`). Write one entry per ibset even if
a set has a single costume.

### BMDL body — the mesh

```
u16 bo | i16 osk | u16 cver | u16 cfac | brs radius | 24B bounds | 12B pivot   -> 48-byte header
cver x 32B vertices:   brs x,y,z (+0) | brs u,v (+12) | 12B reserved (+20)
cfac x 32B faces:      u16 i0,i1,i2 (+0) | 6B reserved | 4B reserved | u16 smoothing (+16) | 14B pad
```

- `radius`/`bounds`/`pivot` and the reserved vertex/face bytes are engine
  metadata this renderer ignores — **zero-fill them** (or compute honest
  bounds; the original engine used them for culling).
- `smoothing` is a per-face smoothing-group id: faces sharing a group shade
  smoothly across their shared edge. Give every triangle of a hard-edged
  shape (box) distinct groups; share a group for organic limbs.
- `uv` indexes into the material's `TMAP` when the part's material has one;
  zeros are fine for untextured parts.

### MTRL body (20 bytes) + kids

```
u16 bo | i16 osk | u32 brc | bruf ka | bruf kd | bruf ks | u8 indexBase | u8 indexRange | brs power
```

- `brc` packs RGB as `(r<<16)|(g<<8)|b`.
- `ka/kd/ks` = ambient/diffuse/specular intensities 0..1.
- `indexBase`/`indexRange` select the 256-color palette ramp this material
  shades through — copy values from a similar existing MTRL (e.g.
  `indexBase 15, indexRange 15` works for dark neutrals).
- `power` = specular exponent (brs).
- Kids: `TMAP` chid 0 = indexed texture (`u16 bo|i16 osk|i16 cbRow|u8 type|u8 grftmap|i16|i16|i16 dxp|i16 dyp|4B reserved`, pixels at offset 20, `cbRow*dyp` bytes of palette indexes); `TXXF` chid 0 = `bo/osk + bmat23` UV transform. Both optional.

### CMTL body (8 bytes) + kids

```
u16 bo | i16 osk | i32 ibset
```

Kids: for the k-th part *within ibset* (part order, counting only parts whose
`GLBS[i] == ibset`) — `MTRL` chid k = material, `BMDL` chid k = optional
replacement mesh (a costume can swap geometry, e.g. a hat appearing).

### ACTN body (8 bytes) + kids

```
u16 bo | i16 osk | u32 grfactn
```

`grfactn` — which axes path-orientation may rotate (`src/engine/actor.ts`):

| Bit | Name | Effect |
|---|---|---|
| 1 | FACTN_ROTX | pitch toward route direction |
| 2 | FACTN_ROTY | yaw toward route direction |
| 4 | FACTN_ROTZ | roll |
| 8 | FACTN_STATIC | static action — the editor won't auto-write a Step (route advance) when chaining into it |

Kids:

- `GGCL` chid 0 — the cel list, a **GG with 8-byte fixed parts**:
  `{i32 chidSnd, brs dwr}` plus a variable part of `{i16 chidModl, i16 imat34}`
  pairs — **one pair per part**, in part order. `chidModl == -1` keeps the
  part's current model; `imat34` indexes the GLXF matrix pool.
- `GLXF` chid 0 — a **GL of 48-byte bmat34** entries: every pose matrix every
  cel references. Pool entries are shared freely between cels.

## 3. Parsing API cheat sheet

```ts
import { parseTemplate, templateAction, templateModel, templateCmtl,
         parseModel, parseMtrl, parseCmtl, parseTmap } from './src/format/content.ts';

const t = parseTemplate(chunkyFile, cno, contentLibrary?);
// -> {chunkyFile, cno, name, rest:[xa,ya,za], grftmpl, isTdt, isProp,
//     parents[], ibsets[], cbset, cmids[ibset]->[cmid]}
templateAction(t, anid);   // -> {anid, name, grfactn, cels:[{chidSnd,dwr,cps:[{chidModl,imat34}]}], matrices:[bmat34]}
templateModel(t, chid);    // -> {positions:Float32Array, uvs, indices:Uint16Array, smoothing}
templateCmtl(t, cmid);     // -> {cno, ibset, parts:[{mtrl, model}]}
parseMtrl(chunkyFile, cno);// -> {color:[r,g,b], ka,kd,ks, indexBase,indexRange, power, tmap, txxf}
```

The `template*` helpers parse lazily — a template's ACTN/BMDL/CMTL kids cost
nothing until referenced. **Enumerate a template's actions and parts with
`chunkyFile.kidsOf('TMPL', cno, 'ACTN')` and `'BMDL'`** — kid chids *are* the
anids/model ids.

## 4. Recipe: deconstruct an existing character

```js
import { ChunkyFile } from '../src/format/chunky.ts';
import { parseTemplate, templateAction } from '../src/format/content.ts';

const cf = new ChunkyFile(tmplsBytes, 'TMPLS.3CN');
for (const c of cf.ofType('TMPL')) {           // every actor/prop template
  const t = parseTemplate(cf, c.cno);
  const anids = cf.kidsOf('TMPL', c.cno, 'ACTN').map(k => k.chid);
  console.log(c.cno, JSON.stringify(t.name),
    t.isProp ? 'prop' : 'actor', `parts=${t.parents.length}`,
    `ibsets=${t.cbset}`, `anids=${anids.join(',')}`);
}
// one animation in detail:
const t = parseTemplate(cf, SOME_CNO);
const a = templateAction(t, SOME_ANID);
console.log(a.name, 'cels', a.cels.length, 'grfactn', a.grfactn);
a.cels.forEach((c, i) => console.log(i, 'dwr', c.dwr, 'cps', c.cps));
```

Fetch the builtin content files from the upstream repo exactly like
`tools/calib.mjs` does:
`https://raw.githubusercontent.com/microsoft/Microsoft-3D-Movie-Maker/104b2653e68046c2f6373186169f281006db35b1/cd3/3DMOVIE/<NAME>` —
`TMPLS.3CN`, `BKGDS.3CN`, `MTRLS.3CN`, `TDFS.3CN`, `SNDS.3CN`.

## 5. Recipe: add a new animation to an existing character

*"Add a long jump to character X."* An animation is a new `ACTN` kid on the
character's `TMPL`. Two delivery paths:

- **Pack path (recommended).** Build a `.3cn` containing the modified
  template; users load it via `?packs=`/`?vxp=`.
- **Movie-embedded path.** Adopt the template subtree into a movie file and
  point an actor's `tagTmpl` at `{sid:0, ctg:'TMPL', cno}` — the costume
  travels with the movie. (`serializeMovie` copies sid-0 TMPL subtrees under
  the ACTR kid automatically.)

Steps:

1. **Copy the template into a writable chunk list.** `ChunkyFile.adopt(dst,
   'TMPL', cno)` deep-copies a subtree with fresh cnos, or rebuild by hand:
   for every chunk in the template subtree, emit `{ctg, cno, data: cf.data(...),
   kids, name}` into your `writeChunkyFile` list, keeping a `cno` remap table.
2. **Author the ACTN.** The hard part is the pose math — for a long jump on
   a biped (parts: pelvis/root, torso, head, upper/lower arm L/R,
   upper/lower leg L/R):

   ```js
   import * as M from '../src/engine/mat34.ts';   // identity,mul,rotX,rotY,rotZ,translate
   const mats = [];                                // GLXF pool
   const mat = (m) => (mats.push(m), mats.length - 1);
   const cels = [];
   const CCEL = 18;                                // 3 seconds at 6fps
   for (let i = 0; i < CCEL; i++) {
     const t = i / (CCEL - 1);                     // 0..1 across the jump
     const arc = Math.sin(Math.PI * t);            // up-down arc
     const cps = [];
     // per-part local pose matrices — ORDER = part index order:
     cps.push({ chidModl: -1, imat34: mat(M.mul(M.translate(0, arc * 8, 0), M.rotX(-0.5 * arc))) }); // root rises + leans
     cps.push({ chidModl: -1, imat34: mat(M.rotX(0.3 * arc)) });   // torso leans back mid-air
     cps.push({ chidModl: -1, imat34: mat(M.identity()) });        // head
     cps.push({ chidModl: -1, imat34: mat(M.rotX(-1.2 * arc)) });  // arms windmill/tuck...
     cps.push({ chidModl: -1, imat34: mat(M.rotX(-1.2 * arc)) });
     cps.push({ chidModl: -1, imat34: mat(M.rotX(0.9 * arc)) });
     cps.push({ chidModl: -1, imat34: mat(M.rotX(0.9 * arc)) });
     cps.push({ chidModl: -1, imat34: mat(M.rotX(t < .5 ? 1.2 : -0.6)) }); // legs kick
     cps.push({ chidModl: -1, imat34: mat(M.rotX(t < .5 ? 1.2 : -0.6)) });
     cps.push({ chidModl: -1, imat34: mat(M.rotX(-1.0 * arc)) });
     cps.push({ chidModl: -1, imat34: mat(M.rotX(-1.0 * arc)) });
     cels.push({ chidSnd: 0, dwr: JUMP_LEN / CCEL, cps });
   }
   ```

   **`dwr` is the locomotion**: the route cursor advances `dwr` world units
   while this cel plays. A jump of `JUMP_LEN = 20` over 18 cels = `dwr ≈ 1.11`.
   The vertical arc goes in the **root part's matrix translation** (as above)
   — the route itself stays a ground polyline.
3. **Choose the anid.** Must not collide with an existing `ACTN` chid on the
   template: `newAnid = Math.max(...cf.kidsOf('TMPL', cno, 'ACTN').map(k => k.chid)) + 1`.
4. **Assemble the chunks** — GGCL (`buildGG(8, cels.map(c => ({fixed:
   new Writer().i32(0).brs(c.dwr).out(), variable: pairsAsI16(c.cps)})))`),
   GLXF (`buildGL(mats.map(serMat34))` — 48-byte entries), ACTN body
   (`bo/osk/grfactn`), then add `{ctg:'ACTN', cno:actnCno, chid:newAnid}` to
   the copied TMPL's `kids` list.
5. **Write the file** with `writeChunkyFile(chunks)` — or hand the new chunks
   to a movie: `movie.chunkyFile.adopt`-equivalent manual subtree copy with a
   cno remap.
6. **Use it**: an `Actn` actor event `{anid: newAnid, celn: 0}` plays it (see
   the movies brief). For `grfactn` use `FACTN_ROTY` (2) so the actor faces
   its travel direction; add `FACTN_STATIC` (8) only for stationary poses.

**Sanity rules for cels:** `cps.length <= template.parents.length` (parts
past the end keep their previous pose), `imat34` must index the GLXF pool,
and a `dwr` of 0 still animates in place without locomoting.

## 6. Recipe: create a brand-new humanoid or prop

*"A new humanoid character with a cape and the common animations."*
*"A prop: a wooden barrel."*

1. **Design the part list** (order matters — parents first). Biped:
   `0 root/pelvis(-1)`, `1 torso(0)`, `2 head(1)`, `3 upperArmL(1)`,
   `4 lowerArmL(3)`, `5 upperArmR(1)`, `6 lowerArmR(5)`, `7 upperLegL(0)`,
   `8 lowerLegL(7)`, `9 upperLegR(0)`, `10 lowerLegR(9)`. A cape adds
   `11 cape(1)` — then it can swing with its own cel matrices.
2. **Build a BMDL per part.** Minimal viable mesh = a box (24 verts /
   12 tris for correct normals via distinct smoothing groups). Part meshes
   are modeled **in part space** — origin at the joint, geometry extending
   away from it. Write them with the §2 layout; the parser only reads
   position/uv/indices/smoothing.
3. **Write GLPI/GLBS**: parents as i16s; ibset `0` for every part for a
   single costume zone, or group e.g. torso+cape as set 1 so costumes can
   retexture it independently (`cbset` = max+1).
4. **Write GGCM + CMTL + MTRL**: at least one CMTL per ibset. Its MTRL kids
   index the *in-set* part order — set 0 with 11 parts = 11 MTRL kids
   (chid 0..10).
5. **Write the ACTNs** — at minimum an idle (anid 0-ish, low dwr or 0) and a
   walk (per-cel `dwr` ≈ stride/cel, `grfactn = ROTY|ROTX = 3`). Copy the
   §5 loop; limb swing = alternating `rotX` on upper/lower limb parts.
6. **Emit the file**: `writeChunkyFile(chunks, {creator:'SOC '})` → `.3cn`.
   Pick `cno`s that don't collide with builtin TMPLS.3CN chunks — builtin
   content **wins collisions** (`Library.resolve` searches builtin files
   first). Scan `cf.ofType('TMPL')` cno ranges and start your pack above
   them (a high base like `0x20000` is safe).
7. **Ship it as a pack** (§8) or embed it in a movie (`tagTmpl {sid:0}`).

A **prop** is identical except `grftmpl |= 4`, typically 1 part, 1 static
ACTN (`grfactn = 8`, cels with `dwr 0`), and it still supports costumes and
actor events (props can be scaled, rotated, moved, removed — they just don't
walk).

### 3D text (TDT) — the special template

A TMPL whose `TDT` kid exists builds a text template at parse time —
`TDT body = bo|osk|i32 tdts|tag TDF`. `tdts` is the layout shape
(`TDTS`: Normal 0, Arch± 1/4, CircleY/Z 2/6, LargeMiddle 3, ArchZ 5,
Vertical 7, GrowRight/Left 8/9); `tagTdf` points at a `TDF` font
(`bo|osk|i32 cch|brs dyrMax|brs dxr[cch]|brs dyr[cch]`, with `BMDL` kids
chid = character code). Actions `anid 0..15` are *synthesized* from shape +
per-glyph matrices (`tdtBuildAction`) — spin/wave/walk/hop/stretch. To make
new 3D text at runtime prefer `makeTdtTemplate(lib, text, tdts, tagTdf)` +
`library.addTemplate` (returns the `{sid:'rt'}` tag that serializes as an
embedded TMPL+TDT). Creating new *fonts* = authoring a TDF chunk with one
BMDL per glyph — same BMDL spec.

## 7. Recipe: modify an existing character's mesh or costume

- **Retexture/reskin**: add a `CMTL` (new `cmid` chid) to the template, append
  its id to the right `GGCM` entry's variable list, then trigger it with a
  `Cost` actor event (`fCmtl:1, cmid`) — or an `MTRL`-tagged `Cost` for a
  flat repaint (`fCmtl:0, ibset, tag:{sid:2,ctg:'MTRL',cno}`).
- **New body part**: append to GLPI/GLBS (parents must stay
  earlier-than-child), add a BMDL kid, extend every existing cel's `cps`
  list and every CMTL's kid set for the affected ibsets.
- **Swap a mesh**: point cel `chidModl` at a different BMDL chid on the
  template, or add a replacement `BMDL` kid inside the CMTL.

## 8. Shipping: expansion packs vs embedded

`src/app/expansionPacks.ts` routes pack files by extension:

- `.3cn`/`.chk` → appended to the content library (`content.push` — **later
  in resolve order than builtin**, so never reuse builtin cnos).
- `.3th`/`.nth` → scanned into the picker grids: `TMTH`/`PRTH`/`BKTH` kids
  with a `GOKD`→`MBMP` thumbnail; the TMTH/PRTH body carries the template
  cno at byte offset 8; `BKTH`'s own cno IS the BKGD cno and its `CATH`
  kids provide per-camera thumbs. Without a `.3th` your actor still works
  — it just won't appear in the pickers (place it by cno or via movie edits).
- `.png`/`.cur` → UI texture/cursor overrides.

A pack is either a directory manifest — `assets.json` = `{files:[...]}`
served over HTTP and passed as `?packs=<url>` — or a **`.vxp`**: a renamed
zip of the same files, loaded via `?vxp=<url>` (cached in IndexedDB).
A `.chk` containing a 256-entry `GLCR` supplies the pack's thumbnail
palette.

## 9. Validation checklist

1. `new ChunkyFile(out)` parses; `inspect`-style chunk counts look right.
2. `parseTemplate` returns your part tables; `templateAction(t, anid)`
   returns cels whose `imat34`s are all < `mats.length` and whose `cps`
   align to `parents.length`.
3. **Runtime smoke test** — the strongest check is a headless actor:

   ```js
   const actor = new Actor({ cno:0, arid:0, nfrmFirst:0, nfrmLast:999,
     dxyzFullRte:{x:0,y:0,z:0}, tagTmpl:{sid:2,ctg:'TMPL',cno:YOUR_CNO},
     route:[{x:0,y:0,z:0,dwr:30},{x:30,y:0,z:0,dwr:0}],
     events:[{aet:0,nfrm:0,rtel:{irpt:0,dwrOffset:0,dnfrm:0},data:{x:0,y:0,z:0,xa:0,ya:0,za:0}},
             {aet:1,nfrm:0,rtel:{irpt:0,dwrOffset:0,dnfrm:0},data:{anid:YOUR_ANID,celn:0}}] },
     parseTemplate(cf, YOUR_CNO), lib);
   for (let f = 0; f < 40; f++) { actor.gotoFrame(f); actor.partWorldMatrices(); }
   ```

   (Event `aet` ids: Add 0, Actn 1 — see the movies brief for the full table.)
4. `npx vite-node tools/inspect.mjs out.3cn TMPL` shows your chunk with its
   kids; `npm test` and `npx tsc --noEmit` stay clean.
5. Visual check: load `?packs=` in the dev server and place the actor.

## 10. Pitfalls

- **Part order is load-bearing** — a parent index ≥ its own index silently
  reads a stale matrix.
- **cno collisions lose to builtin** — pick a high range for packs.
- **`cps` shorter than the part count** leaves trailing parts frozen in their
  last pose; longer is ignored.
- **`dwr` units are world units per cel** — a walk cycle whose `dwr`s sum
  short looks like foot-sliding; sum long looks like skating.
- **Don't mark a chunk packed** — the writer has no encoder; write raw
  bodies only.
- **`Cost` tags need a file to resolve in**: `{sid:2,ctg:'MTRL',cno}` for
  library materials, `{sid:0}` for movie-embedded ones.
- **`fCmtl` costumes index `cmid` chids on the template itself** — a `cmid`
  with no CMTL kid renders nothing for that part (parts keep last state).
