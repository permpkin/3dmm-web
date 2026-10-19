// Scene-pack builder: procedural geometry -> palette-indexed backdrop renders
// -> .3cn (BKGD/CAM/MBMP/ZBMP/GLCR/GLLT) + .3th (BKTH/CATH) -> .vxp zip.
// Run via vite-node (`import ... from '../../src/format/*.js'` hits the .ts).
import { zipSync } from 'fflate';
import zlib from 'node:zlib';
import { Writer } from '../../src/format/binary.js';
import { buildGL, writeChunkyFile } from '../../src/format/chunky.js';

export const W = 544, H = 306;            // renderer's native scene size
export const THUMB_W = 143, THUMB_H = 80; // picker thumbnail size (matches stock)
const KOSK = 0x0303;
const SKY_Z = 65535;                      // ZBMP sentinel: no backdrop (far)

// ---- matrices (row-vector 4x3, v' = v*M — same convention as src/engine/mat34)
/** Camera->world matrix for lookAt: rows = right, up, backward(-fwd), eye. */
export function lookAt(eye, target, up = [0, 1, 0]) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const z = norm(sub(eye, target));
  let x = norm(cross(up, z));
  if (!Math.hypot(...x)) x = [1, 0, 0];
  const y = cross(z, x);
  return [...x, ...y, ...z, ...eye];
}
/** Affine inverse of a 4x3 (general 3x3 inverse + translation) — camera view matrix. */
export function invert34(m) {
  const [a, b, c, d, e, f, g, h, i, tx, ty, tz] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const r = [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det,
    (a * i - c * g) / det, -(a * f - c * d) / det, C / det,
    -(a * h - b * g) / det, (a * e - b * d) / det];
  const t = [-(tx * r[0] + ty * r[3] + tz * r[6]), -(tx * r[1] + ty * r[4] + tz * r[7]), -(tx * r[2] + ty * r[5] + tz * r[8])];
  return [...r, ...t];
}
/** world point -> space of 4x3 matrix m. */
const xf = (p, m) => [p[0] * m[0] + p[1] * m[3] + p[2] * m[6] + m[9],
  p[0] * m[1] + p[1] * m[4] + p[2] * m[7] + m[10],
  p[0] * m[2] + p[1] * m[5] + p[2] * m[8] + m[11]];
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// ---- palette --------------------------------------------------------------
/** spec.palette -> [[r,g,b]] — entries are [r,g,b] or {base:[r,g,b], shades:[mults]}. */
export function expandPalette(spec) {
  const out = [];
  for (const e of spec.palette || []) {
    if (Array.isArray(e)) { out.push(e); continue; }
    for (const s of e.shades || [1])
      out.push(e.base.map((v) => Math.max(0, Math.min(255, Math.round(v * s)))));
  }
  return out;
}
/** Effective 256-entry palette: socpal low half + the pack's overlay at indexBase. */
export function effectivePalette(socpal, declared, indexBase) {
  const pal = [];
  for (let i = 0; i < 256; i++)
    pal[i] = i >= indexBase && i - indexBase < declared.length
      ? declared[i - indexBase]
      : [socpal[i * 3], socpal[i * 3 + 1], socpal[i * 3 + 2]];
  return pal;
}

// ---- rasterizer -----------------------------------------------------------
/** Lambert shade one world-space triangle -> effective-palette index. */
function shadeTri(t, camPos, env, keyOf) {
  const [a, b, c] = t.v;
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n = norm3([u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]);
  // face the camera: if the outward normal points away, shade the back face's -n
  const toCam = [camPos[0] - a[0], camPos[1] - a[1], camPos[2] - a[2]];
  const facing = n[0] * toCam[0] + n[1] * toCam[1] + n[2] * toCam[2];
  if (facing <= 0 && !t.two) return -1;                      // back-face cull
  if (facing <= 0) n = [-n[0], -n[1], -n[2]];
  let li = env.ka;
  for (const l of env.lights) li += env.kd * Math.max(0, n[0] * l.dir[0] + n[1] * l.dir[1] + n[2] * l.dir[2]) * l.intensity;
  li = Math.min(li, 1.6);
  const cr = Math.min(255, t.c[0] * li) | 0, cg = Math.min(255, t.c[1] * li) | 0, cb = Math.min(255, t.c[2] * li) | 0;
  return env.nearest(keyOf(cr, cg, cb), cr, cg, cb);
}

/** Clip a camera-space polygon to zc >= hither, retriangulate as a fan. */
function clipNear(pts, n) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const ain = a[2] <= -n, bin = b[2] <= -n; // forward is -z
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (-n - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, -n]);
    }
  }
  const tris = [];
  for (let i = 1; i + 1 < out.length; i++) tris.push([out[0], out[i], out[i + 1]]);
  return tris;
}

/**
 * Rasterize `tris` for one camera -> {idx, z, rgb} at WxH.
 * idx: palette indices (Int16, -1 unused — sky fills everything). z: ZBMP u16
 * (perspective ndc*32768 signed; 65535 = sky). rgb: preview bytes.
 */
export function rasterize(tris, cam, env) {
  const view = invert34(cam.matrix);
  const f = (H / 2) / Math.tan(cam.fov / 2);
  const zbuf = new Float32Array(W * H).fill(Infinity);
  const idx = new Int16Array(W * H).fill(-1);
  const keyOf = (r, g, b) => (r << 16) | (g << 8) | b;
  const shadeCache = new Map();
  const nearest = (key, r, g, b) => {
    if (!shadeCache.has(key)) {
      let bi = 0, bd = Infinity;
      for (let i = 0; i < 256; i++) {
        const p = env.pal[i];
        const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
        if (d < bd) { bd = d; bi = i; }
      }
      shadeCache.set(key, bi);
    }
    return shadeCache.get(key);
  };
  const envN = { ...env, nearest, keyOf };
  const eye = [cam.matrix[9], cam.matrix[10], cam.matrix[11]];
  for (const t of tris) {
    const col = shadeTri(t, eye, envN, keyOf);
    if (col < 0) continue;
    const cs = t.v.map((p) => xf(p, view));
    for (const poly of clipNear(cs, cam.hither)) {
      const sp = poly.map((q) => [W / 2 + (q[0] / -q[2]) * f, H / 2 - (q[1] / -q[2]) * f, -q[2]]);
      rasterTri(sp, col, zbuf, idx);
    }
  }
  // sky: vertical gradient in unwritten pixels
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    const sk = [0, 1, 2].map((k) => env.sky.top[k] + (env.sky.horizon[k] - env.sky.top[k]) * t);
    const si = nearest(keyOf(sk[0] | 0, sk[1] | 0, sk[2] | 0), sk[0] | 0, sk[1] | 0, sk[2] | 0);
    for (let x = 0; x < W; x++) if (idx[y * W + x] < 0) idx[y * W + x] = si;
  }
  // encode depth: ndc*32768 signed, sky -> 65535 (matches BG_FS's zi/32768 read)
  const z = new Uint16Array(W * H);
  const { hither: N, yon: F } = cam;
  for (let i = 0; i < z.length; i++) {
    if (zbuf[i] === Infinity) { z[i] = SKY_Z; continue; }
    const zc = zbuf[i];
    const ndc = (F + N) / (F - N) - (2 * F * N) / ((F - N) * zc);
    const zi = Math.max(-32768, Math.min(32767, Math.round(ndc * 32768)));
    z[i] = zi & 0xffff;
  }
  const rgb = new Uint8Array(W * H * 3);
  for (let i = 0; i < idx.length; i++) {
    const p = env.pal[idx[i] < 0 ? 0 : idx[i]];
    rgb[i * 3] = p[0]; rgb[i * 3 + 1] = p[1]; rgb[i * 3 + 2] = p[2];
  }
  return { idx, z, rgb };
}

/** Scanline-fill a projected triangle ([sx,sy,zc]x3) into idx/zbuf. */
function rasterTri(sp, col, zbuf, idx) {
  const [a, b, c] = sp;
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
  const d = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (!d) return;
  const iza = 1 / a[2], izb = 1 / b[2], izc = 1 / c[2];
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      let w0 = (b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px);
      let w1 = (c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px);
      let w2 = d - w0 - w1;
      if (d < 0) { w0 = -w0; w1 = -w1; w2 = -w2; }
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const zc = Math.abs(d) / (w0 * iza + w1 * izb + w2 * izc); // perspective-correct depth
      const o = y * W + x;
      if (zc < zbuf[o]) { zbuf[o] = zc; idx[o] = col; }
    }
  }
}

/** Box-downsample an index image to THUMB_W x THUMB_H (majority vote). */
export function downsample(idx, w = W, h = H, tw = THUMB_W, th = THUMB_H) {
  const out = new Int16Array(tw * th);
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor((y * h) / th), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / th));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor((x * w) / tw), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / tw));
      const count = new Map();
      for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
        const v = idx[sy * w + sx];
        count.set(v, (count.get(v) || 0) + 1);
      }
      let best = 0, bn = -1;
      for (const [v, n] of count) if (n > bn) { bn = n; best = v; }
      out[y * tw + x] = best;
    }
  }
  return out;
}

// ---- chunk-body encoders ---------------------------------------------------
/** MBMP: RLE rows of palette indices (row-wise maximal runs). */
export function mbmpBody(w, h, px, { left = 0, top = 0 } = {}) {
  const wr = new Writer();
  wr.bo().u16(KOSK).u8(0).u8(0).u16(0)
    .i32(left).i32(top).i32(left + w).i32(top + h).i32(0);
  const rows = [];
  for (let y = 0; y < h; y++) {
    const rw = new Writer();
    let x = 0;
    while (x < w) {
      let skip = 0;
      while (x + skip < w && px[y * w + x + skip] < 0 && skip < 255) skip++;
      if (skip === 255) { rw.u8(255).u8(0); x += skip; continue; }
      x += skip;
      let len = 0;
      while (x + len < w && px[y * w + x + len] >= 0 && len < 255) len++;
      rw.u8(skip).u8(len);
      for (let i = 0; i < len; i++) rw.u8(px[y * w + x + i] & 0xff);
      x += len;
    }
    rows.push(rw.out());
  }
  for (const r of rows) wr.u16(r.length);
  for (const r of rows) wr.bytes(r);
  return wr.out();
}

/** ZBMP: header + one little-endian u16 per pixel. */
export function zbmpBody(w, h, z) {
  const wr = new Writer();
  wr.bo().u16(KOSK).i16(0).i16(0).i16(w).i16(h);
  const b = new Uint8Array(w * h * 2);
  const dv = new DataView(b.buffer);
  for (let i = 0; i < z.length; i++) dv.setUint16(i * 2, z[i], true);
  return wr.bytes(b).out();
}

/** CAM body: clip planes, fov, apos, camera->world matrix. */
export function camBody(cam) {
  const wr = new Writer();
  wr.bo().u16(KOSK).brs(cam.hither).brs(cam.yon).bra(cam.fov).i16(0);
  for (const v of cam.apos) wr.brs(v);
  for (const v of cam.matrix) wr.brs(v);
  return wr.out();
}

/** GLCR: GL of [B,G,R,0] entries. */
export function glcrBody(colors) {
  return buildGL(colors.map(([r, g, b]) => new Uint8Array([b, g, r, 0])));
}

/** GLLT: GL of 56-byte entries {bmat34, brs intensity, i32 type}.
 *  The light matrix's row 2 is the direction TO the light (renderer reads
 *  matrix[6..8]); translation sits far along it like the stock entries. */
export function glltBody(lights) {
  const entries = lights.map((l) => {
    const z = norm3(l.dir);
    let x = norm3([z[2], 0, -z[0]]);
    if (!Math.hypot(...x)) x = [1, 0, 0];
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    const w = new Writer();
    for (const v of [...x, ...y, ...z, z[0] * 600, z[1] * 600, z[2] * 600]) w.brs(v);
    w.brs(l.intensity ?? 1).i32(l.type ?? 1);
    return w.out();
  });
  return buildGL(entries);
}

/** Normalize a spec camera {pos, look, fov(deg), hither, yon} -> chunk fields. */
export function makeCam(c) {
  const apos = c.pos;
  return {
    apos, matrix: lookAt(c.pos, c.look), hither: c.hither ?? 1.2,
    yon: c.yon ?? 5000, fov: ((c.fov ?? 53) * Math.PI) / 180, name: c.name,
  };
}

/** Build the pack's .3cn: pack-palette GLCR (256) + BKGD{GLCR,GLLT,CAM*{MBMP,ZBMP}}. */
export function build3cn(spec, renders, socpal) {
  let cno = spec.cnoBase;
  const declared = expandPalette(spec);
  if (declared.length > 256 - spec.indexBase)
    throw new Error(`palette ${declared.length} > ${256 - spec.indexBase} slots at indexBase ${spec.indexBase}`);
  const eff = effectivePalette(socpal, declared, spec.indexBase);
  // 256-entry pack palette -> thumbs decode against it instead of raw socpal
  const packPal = { ctg: 'GLCR', cno: cno++, data: glcrBody(eff), name: `${spec.name} Pack Palette`, loner: true };
  const bkgdCno = cno++;
  const glcr = { ctg: 'GLCR', cno: cno++, data: glcrBody(declared), name: `${spec.name} Palette` };
  const gllt = { ctg: 'GLLT', cno: cno++, data: glltBody(spec.lights), name: `${spec.name} Lights` };
  const cams = spec.cameras.map((cs, i) => {
    const cam = { ctg: 'CAM ', cno: cno++, data: camBody(renders[i].cam), name: `${spec.name} Camera ${i}` };
    cam.kids = [
      { ctg: 'MBMP', cno: cno++, chid: 0 },
      { ctg: 'ZBMP', cno: cno++, chid: 0 },
    ];
    cam._kids = [
      { ctg: 'MBMP', cno: cam.kids[0].cno, data: mbmpBody(W, H, renders[i].idx), name: `${spec.name} Camera ${i} Backdrop` },
      { ctg: 'ZBMP', cno: cam.kids[1].cno, data: zbmpBody(W, H, renders[i].z), name: `${spec.name} Camera ${i} Depth` },
    ];
    return cam;
  });
  const bkgd = {
    ctg: 'BKGD', cno: bkgdCno, data: bkgdBody(spec.indexBase), name: spec.name,
    kids: [{ ctg: 'GLCR', cno: glcr.cno, chid: 0 }, { ctg: 'GLLT', cno: gllt.cno, chid: 0 },
      ...cams.map((c, i) => ({ ctg: 'CAM ', cno: c.cno, chid: i }))],
  };
  const chunks = [packPal, bkgd, glcr, gllt];
  for (const c of cams) { const { _kids, ...rest } = c; chunks.push(rest, ..._kids); }
  return { bytes: writeChunkyFile(chunks), bkgdCno, camCount: spec.cameras.length };
}

const bkgdBody = (indexBase) => new Writer().bo().u16(KOSK).u8(indexBase).out();
const body4 = () => new Writer().bo().u16(KOSK).out();

/** Build the .3th: BKTH (GOKD->MBMP + CATH->GOKD->MBMP per camera). */
export function build3th(spec, renders, bkgdCno) {
  let cno = spec.cnoBase + 500; // .3th cno block, no overlap with the .3cn
  const chunks = [];
  const kids = [];
  const mbmp = (px, name) => ({ ctg: 'MBMP', cno: cno++, chid: 0, data: mbmpBody(THUMB_W, THUMB_H, px), name });
  const gokd = (mb, name) => ({ ctg: 'GOKD', cno: cno++, chid: 0, kids: [{ ctg: 'MBMP', cno: mb.cno, chid: 0 }], name });
  const emit = (mb, gk) => { chunks.push({ ...gk, data: body4() }, { ...mb, kids: [] }); };
  const mainMb = mbmp(renders[0].thumb, `${spec.name} Thumbnail`);
  emit(mainMb, gokd(mainMb, `${spec.name} Thumbnail Group`));
  kids.push({ ctg: 'GOKD', cno: chunks[chunks.length - 2].cno, chid: 0 });
  spec.cameras.forEach((cs, i) => {
    const mb = mbmp(renders[i].thumb, `${spec.name} Camera ${i} Thumbnail`);
    const gk = gokd(mb, `${spec.name} Camera ${i} Thumbnail Group`);
    const cath = { ctg: 'CATH', cno: cno++, chid: i, kids: [{ ctg: 'GOKD', cno: gk.cno, chid: 0 }], data: body4(), name: `${spec.name} Camera ${i} Entry` };
    chunks.push(cath, { ...gk, data: body4() }, { ...mb, kids: [] });
    kids.push({ ctg: 'CATH', cno: cath.cno, chid: i });
  });
  chunks.unshift({ ctg: 'BKTH', cno: bkgdCno, data: body4(), kids, name: `${spec.name} Thumbnail Catalog` });
  return writeChunkyFile(chunks);
}

// ---- PNG (for eyeballing renders without booting the app) -------------------
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (b) => { let c = ~0; for (const x of b) c = CRC_T[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
const pngChunk = (type, data) => {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length); // PNG integers are big-endian
  out.set([...type].map((ch) => ch.charCodeAt(0)), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};
/** Minimal RGB PNG encoder (filter 0 rows + zlib). */
export function png(w, h, rgb) {
  const d = new Uint8Array(13);
  const dv = new DataView(d.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); d[8] = 8; d[9] = 2; // 8-bit truecolor
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = zlib.deflateSync(raw, { level: 9 });
  const iend = pngChunk('IEND', new Uint8Array(0));
  const out = new Uint8Array(sig.length + 25 + 12 + idat.length + iend.length);
  let p = 0;
  const put = (b) => { out.set(b, p); p += b.length; };
  put(sig); put(pngChunk('IHDR', d)); put(pngChunk('IDAT', idat)); put(iend);
  return out;
}

/** Grayscale PNG of the ZBMP (near=dark, far=light, sky=white) — debug aid. */
export function zToRgb(z) {
  const rgb = new Uint8Array(z.length * 3);
  for (let i = 0; i < z.length; i++) {
    const v = z[i] === SKY_Z ? 255 : Math.max(0, Math.min(255, (z[i] / 32768) * 255));
    rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = v;
  }
  return rgb;
}

/** Zip {name:Uint8Array} into a .vxp. */
export const vxp = (files) => zipSync(files, { level: 9 });
