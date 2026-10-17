# The Kauai chunky file (CHN2) — shared binary foundation

**Purpose of this brief.** Every 3D Movie Maker asset file — movies (`.3mm`),
content libraries (`.3cn`), thumbnail books (`.3th`), expansion patches
(`.chk`), and `.vxp` pack members — is the same container: a **chunky file**.
This document is the complete spec of that container plus the primitive
encodings every chunk body uses. The actor/scene/movie briefs assume it.

Canonical implementation: `src/format/chunky.ts`, `src/format/binary.ts`,
`src/format/kcdc.ts` in this repository.

---

## 1. File header (CFP)

Bytes 0–36, little-endian for a normal `CHN2` file. Writers pad the header
region to **128 bytes** before the first chunk body.

| Off | Size | Field | Notes |
|---|---|---|---|
| 0  | 4 | magic | `'CHN2'` native little-endian; `'2NHC'` = byte-swapped container (see §9) |
| 4  | 4 | creator | 4-char tag, `'SOC '` for 3DMM files |
| 8  | 2 | dverCur | current data version (this writer emits 5) |
| 10 | 2 | dverBack | oldest readable version (this writer emits 4) |
| 12 | 2 | bo | byte-order marker — `0x0001` little-endian |
| 14 | 2 | osk | string encoding kind — `0x0303` = single-byte latin1 |
| 16 | 4 | fpMac | offset of end-of-data (file length) |
| 20 | 4 | fpIndex | offset of the chunk index (a GG — §4.2) |
| 24 | 4 | cbIndex | byte size of the index GG |
| 28 | 4 | fpMap | offset of a free-space map GG (`fpMac` when absent) |
| 32 | 4 | cbMap | size of that map (`0` when absent) |
| 36 | — | … | chunk bodies start here; this writer pads to 128 |

A file is a **flat index of chunks**. Bodies may live anywhere after the
header; the index tells you where each body is, what type it is, and how it
relates to other chunks.

## 2. The chunk index — a GG of CRP entries

At `fpIndex` sits a **Generic Group (GG)** whose entries are chunk-reference
records (CRPs). Two sizes exist:

**CRPBG — 32-byte fixed part** (what this writer always emits):

| Off | Size | Field |
|---|---|---|
| 0 | 4 | ctg — 4-char chunk type (big-endian chars, e.g. `'TMPL'`) |
| 4 | 4 | cno — chunk number (unique per file) |
| 8 | 4 | fp — file offset of the body |
| 12 | 4 | cb — stored body size (compressed size when packed) |
| 16 | 4 | ckid — number of child references in the variable part |
| 20 | 4 | ccrpRef — reference count (unused, write 1) |
| 24 | 4 | rti — runtime id (unused, write 0) |
| 28 | 4 | grfcrp — flag bits (below) |

**CRPSM — 20-byte compact form** (found in some original files):

| Off | Size | Field |
|---|---|---|
| 0 | 4 | ctg |
| 4 | 4 | cno |
| 8 | 4 | fp |
| 12 | 4 | lu — `grfcrp = lu & 0xff`, `cb = lu >>> 8` |
| 16 | 2 | ckid |
| 18 | 2 | padding |

**Variable part of every CRP**, immediately after the fixed part:

- `ckid` × child references, each **12 bytes**: `{ctg u32, cno u32, chid u32}`.
  `chid` (child id) distinguishes same-type children — e.g. several `ACTN`
  kids of a `TMPL` are different animations keyed by `chid == anid`.
- Optional **STN** name string (§7.4) filling the rest of the variable part.

**grfcrp flag bits** (the ones that matter):

| Bit | Name | Meaning |
|---|---|---|
| `0x02` | — | "loner" chunk — writer sets it on the MVIE root |
| `0x04` | FCRP_PACKED | body is KCDC/KCD2-compressed (§8) |
| `0x10` | FCRP_FOREST | chunk owns a forest of other chunks |

## 3. The chunk model in code

`ChunkyFile` (`src/format/chunky.ts`) is the whole container API:

```ts
const cf = new ChunkyFile(bytes, name);      // parses header + index eagerly
cf.chunks                                    // Map "ctg:cno" -> chunk record
cf.has(ctg, cno); cf.get(ctg, cno);          // record: {ctg,cno,fp,cb,grfcrp,packed,forest,kids,name}
cf.data(ctg, cno);                           // body bytes, unpacked + cached
cf.kid(ctg, cno, kidCtg, chid = 0);          // one child ref or null
cf.kidsOf(ctg, cno, kidCtg = null);          // child refs, optionally filtered
cf.ofType(ctg);                              // iterate all chunks of a type
cf.adopt(srcCf, ctg, cno);                   // deep-copy a subtree in w/ fresh cnos
```

Writing: `writeChunkyFile(chunks, opts)` where
`chunks = [{ctg, cno, data: Uint8Array, kids: [{ctg,cno,chid}], name, loner}]`
and `opts = {creator='SOC ', dverCur=5, dverBack=4, osk=0x0303}`. It lays out
the header, bodies, then the index GG (always CRPBG form), and patches the
header fields. **Everything this toolchain writes is uncompressed** — never
set the packed flag on chunks you author.

## 4. Inside chunk bodies — the generic structures

Nearly every chunk body begins with a **byte-order marker** (`bo`, u16 =
`0x0001` little-endian) followed by an **osk** (i16, usually `0x0303`), then
fixed fields, then child references live only in the index. Structured bodies
reuse four generic layouts:

### 4.1 GL — Generic List (fixed-size entries)

```
u16 bo | i16 osk | i32 cbEntry | i32 ivMac | entries[ivMac] (cbEntry bytes each)
```
Header = 12 bytes; entry *i* at `12 + i*cbEntry`. Reader: `readGL(bytes)`
→ `{le, cbEntry, entries}` (each entry a `Uint8Array`). Writer:
`buildGL(entries)` — `cbEntry` is inferred from the first entry, so every
entry must be the same length.

### 4.2 GG — Generic Group (fixed part + variable part per entry)

```
u16 bo | i16 osk | i32 ilocMac | i32 bvMac | i32 clocFree | i32 cbFixed
| data region (bvMac bytes): entries concatenated, each = cbFixed fixed bytes + variable bytes
| loc table: ilocMac x {i32 bv, i32 cb}   // bv = offset into data region, cb = total entry size; cb==0 -> free slot
```
Header = 20 bytes; data region starts at offset 20, loc table at `20 + bvMac`.
Reader: `readGG(bytes)` → `{le, cbFixed, entries}` with `null` for free slots
and each live entry `{fixed, variable}`. Writer: `buildGG(cbFixed, entries)`
where each entry is `{fixed: Uint8Array, variable?: Uint8Array}` — the loc
table and `bvMac` are computed for you.

### 4.3 AL — Allocated List (GL with free entries)

Same as GL plus an `i32 cvFree` after `ivMac` → header = 16 bytes, entries at
`16 + i*cbEntry`. Reader: `readAL(bytes)`.

### 4.4 GST — Generic String Table

```
u16 bo | i16 osk | i32 cbEntry | i32 ibstMac | i32 bstMac | i32 cbstFree
| string heap (bstMac bytes): packed strings (cch-prefixed, NUL-terminated)
| entries: ibstMac x cbEntry bytes { i32 bst | extra (cbEntry-4) }
```
`bst` is a byte offset into the heap; `bst < 0` marks a free entry. Strings
are **cch-prefixed pascal strings**: for osk `0x0303`/`0x0101`, one byte count
+ latin1 chars + NUL; unicode osk variants use u16 count + u16 chars + u16
NUL. Reader: `readGST(bytes)` → `{le, cbEntry, entries}` of `{str, extra}` or
`null`. Writer: `buildGST(cbEntry, entries)` where each entry is
`{str, extra?: Uint8Array}` — `extra` is padded/truncated to `cbEntry - 4`.

## 5. Primitive encodings

`Reader`/`Writer` (`src/format/binary.ts`) mirror each other:

| Method | Bytes | Meaning |
|---|---|---|
| `u8/i8` | 1 | ints |
| `u16/i16` | 2 | ints, stream endianness |
| `u32/i32` | 4 | ints, stream endianness |
| `brs` | 4 | **16.16 fixed-point scalar** → float (`i32 / 65536`) |
| `bra` | 2 | **angle** → radians (`u16 / 65536 * 2π`); `0x10000 == 360°` |
| `bruf` | 2 | unsigned fraction → `u16 / 65536` (0..1) |
| `ctg` | 4 | 4-char tag (`'TMPL'` ⇄ `0x544D504C`, big-endian chars) |
| `bmat34` | 48 | 12 `brs` — row-vector 4×3 affine matrix (§6) |
| `bmat23` | 24 | 6 `brs` — 2D affine (texture transforms) |
| `tag()` | 16 | `{sid i32, pcrf i32 (write 0), ctg, cno}` |
| `bo()` | 2 | byte-order marker — reads and *sets* endianness; throws on a bad marker |
| `sub(n)` | n | slice + advance |

Reading a `bo()` flips the reader into whatever byte order the marker
declares — chunk bodies are self-describing even inside a swapped container.

### STN — the standalone name string

`writeStn(str)` / `readStn(bytes, off)`: `u16 osk` then `u8 cch` + latin1
chars + `u8 0` (single-byte forms `0x0303/0x0101/0x0301/0x0103`), or
`u16 cch` + u16 chars + u16 NUL for unicode osk values (`0x0505`/`0x0405` LE).
Chunk names in the index are STNs; RTXT font names inside chunk bodies are
STNs too.

## 6. Matrices, angles, units

- **`bmat34`** = 12 brs laid out `[m00..m02, m10..m12, m20..m22, m30..m32]` —
  rows 0–2 are the 3×3 orientation/scale basis, **row 3 is the translation**.
  Row-vector convention `v' = v·M`, matching `src/engine/mat34.ts`
  (`mul(a,b)` applies `a` first, then `b`; `rotX/rotY/rotZ/scale/translate`
  helpers build them).
- **Y is up.** Ground height is a Y coordinate; actors' route Y rarely moves.
- **Angles** are `bra` u16s — `π/2` = `0x4000`, `π` = `0x8000`.
- **World units** are BRender-scale floats — actors walk routes measured in
  the same units the camera `hither`/`yon` use. Original scenes span roughly
  20–200 units across.
- **Time** runs at **6 fps**. Some wait durations (`Pause.dts`) are in
  **60 Hz ticks** — the movie brief flags them.

## 7. Packed bodies — KCDC / KCD2

A chunk with `FCRP_PACKED` stores a compressed body:

```
u32 'KCDC' or 'KCD2' (big-endian tag) | u32 cbDst (uncompressed size) | payload
```

Both codecs are LZ77-family, **LSB-first bitstreams** (`src/format/kcdc.ts`):

- Byte 0 is a flag byte (must be `0`). The stream ends with a back-reference
  whose raw class-3 distance field is all-ones, followed by **six `0xff`
  tail bytes**.
- KCDC items: `0` bit + 8 bits = literal byte; `1` bit + distance class
  prefix (1–3 one-bits) + variable offset (`DIB_BITS = [6, 9, 12, 20]`,
  `DIB_MIN = [0x01, 0x41, 0x241, 0x1241]`) + gamma-coded length = back-ref.
- KCD2 prefixes every item (literal run *or* back-ref) with a gamma length.

**You never need to write a packer.** `writeChunkyFile` emits unpacked
bodies, and readers unpack transparently. Only implement decompression if
you're rebuilding the toolchain standalone.

## 8. Byte-swapped containers — '2NHC'

A `2NHC` file is a `CHN2` whose *container-level* fields (CFP header after
the magic, the index GG's header, every CRP fixed part and every kid
reference) are stored big-endian. Chunk bodies keep their own `bo` markers
and decode normally — that's why the parser reads the index through the
GG's own byte order and each body through its own `bo`. `test/helpers.ts`
has `swapContainer()`, a full working LE⇄BE container transliterator.

## 9. Tags — addressing across files

A `{sid, ctg, cno}` tag is how one file refers to a chunk in another:

| sid | Resolves to |
|---|---|
| `0` | the **movie file itself** (embedded chunks — copied subtrees, imported sounds) |
| `2` | a **content-library file** (any loaded `.3cn`, searched in load order) |
| `'rt'` | a **runtime template** registered by `Library.addTemplate` (3D text) |
| `'usr'` | a **user-imported sound** in IndexedDB (`cno` = its record key) |
| `-1` | invalid/unresolvable |

On disk `sid` is an `i32` — `'rt'`/`'usr'` are runtime-only markers; at
serialize time they materialize into real sid-0 embedded chunks (a TMPL+TDT
subtree / an MSND subtree) via `serializeMovie`'s `rtmpl`/`userSnd`
resolvers. Never write the string sids into a tag field directly.

`Library.resolve(tag)` (`src/engine/library.ts`) implements it: sid-0 tags
probe the open movie first, then every loaded content file in order (builtin
`CONTENT_FILES` first, then expansion packs — so **pack cnos must not
collide with builtin cnos**, they lose). Other sid values fall through to
the content list too.

## 10. Authoring rules of thumb

1. Start every chunk body with `w.bo().u16(0x0303)` (the two idiom lines in
   `serializeMovie` do exactly this).
2. Give every chunk a unique `cno` — serialize allocators start at
   `max(existing) + 1`.
3. Reference children only through `kids` — chunk bodies never embed
   `{ctg,cno}` child ids; **tags** in bodies point at *content*, not kids.
4. Names go in the CRP variable part after the kid list (an STN) — pass
   `name` to `writeChunkyFile` entries.
5. Round-trip check: `new ChunkyFile(out)` then re-derive every field you
   wrote. If your structure survives `parse*` + `serializeMovie`, it will
   survive the app.
