// Prop-pack builder: part meshes -> .3cn (TMPL/GLPI/GLBS/GGCM/BMDL/CMTL/MTRL/
// ACTN/GGCL/GLXF) + .3th (PRTH/GOKD/MBMP picker thumbs) -> .vxp zip.
// Run via vite-node (`import ... from '../../src/format/*.js'` hits the .ts).
import { zipSync } from 'fflate';
import { Writer } from '../../src/format/binary.js';
import { buildGL, buildGG, writeChunkyFile } from '../../src/format/chunky.js';
import { mbmpBody, glcrBody, png, lookAt, invert34 } from '../scene-gen/lib.mjs';
import * as M from '../../src/engine/mat34.js';

const KOSK = 0x0303;
export const THUMB = 72;         // PRTH thumbnail size (matches stock)
const GRF_PROP = 0x4;            // TMPL flag: prop (not actor)
const GRFACTN = 0x8 | 0x2;       // every prop action: STATIC | ROTY (stock convention)
const PROP_DWR = 2.5;            // route units per cel (stock convention)

// ---- chunk-body encoders ----------------------------------------------------
const hdr = () => new Writer().bo().u16(KOSK);

/** TMPL: rest orientation + flags (0x4 = prop). */
export const tmplBody = (rest = [0, 0, 0], grftmpl = GRF_PROP) =>
  hdr().bra(rest[0]).bra(rest[1]).bra(rest[2]).i16(0).u32(grftmpl).out();

/** GLPI/GLBS — GLs of i16 entries. */
export const i16gl = (vals) => buildGL(vals.map((v) => new Writer().i16(v).out()));

/** GGCM — GG entry per ibset: i32 fixed + variable i32 cmid list. */
export const ggcmBody = (cmidLists) =>
  buildGG(4, cmidLists.map((cmids, i) => {
    const variable = new Writer();
    for (const c of cmids) variable.i32(c);
    return { fixed: new Writer().i32(i).out(), variable: variable.out() };
  }));

/** MTRL — color ramp selection (ka/kd/ks/power/brc match stock props). */
export const mtrlBody = (indexBase, { ka = 0, kd = 1, ks = 0, power = 50, brc = 0, indexRange = 7 } = {}) =>
  hdr().u32(brc).u16(Math.round(ka * 65535)).u16(Math.round(kd * 65535)).u16(Math.round(ks * 65535))
    .u8(indexBase).u8(indexRange).brs(power).out();

/** CMTL body — ibset this costume targets. */
export const cmtlBody = (ibset) => hdr().i32(ibset).out();

/** ACTN body — rotation/static flags. */
export const actnBody = (grfactn = GRFACTN) => hdr().u32(grfactn).out();

/** GGCL — cel list: {chidSnd,dwr} fixed + per-part {chidModl,imat34} i16 pairs. */
export const ggclBody = (cels) => buildGG(8, cels.map((c) => {
  const v = new Writer();
  for (const cp of c.cps) v.i16(cp.chidModl).i16(cp.imat34);
  return { fixed: new Writer().i32(c.chidSnd || 0).brs(c.dwr).out(), variable: v.out() };
}));

/** GLXF — matrix pool: GL of 48-byte bmat34 entries. */
export const glxfBody = (mats) => buildGL(mats.map((m) => {
  const w = new Writer();
  for (const v of m) w.brs(v);
  return w.out();
}));

/** BMDL — indexed mesh with per-vertex UVs (used when the material has a
 *  TMAP): 48B header + 32B/vertex + 32B/face records. */
export function bmdlBody(p) {
  const nv = p.verts.length, nf = p.faces.length;
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const v of p.verts) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], v[a]); mx[a] = Math.max(mx[a], v[a]); }
  if (!nv) { mn.fill(0); mx.fill(0); }
  const radius = nv ? Math.max(...p.verts.map((v) => Math.hypot(v[0], v[1], v[2]))) : 0;
  const w = hdr();
  w.u16(nv).u16(nf).brs(radius);
  for (const v of [...mn, ...mx]) w.brs(v);          // 24B bounds
  for (const v of [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2]) w.brs(v); // 12B pivot
  for (let i = 0; i < nv; i++) {
    const v = p.verts[i], uv = p.uvs?.[i] || [0, 0];
    w.brs(v[0]).brs(v[1]).brs(v[2]).brs(uv[0]).brs(uv[1]).pad(12);
  }
  for (let i = 0; i < nf; i++) {
    const [a, b, c] = p.faces[i];
    w.u16(a).u16(b).u16(c).pad(10).u16(p.smooth[i] || 0).pad(14);
  }
  return w.out();
}

/** TMAP — indexed texture: cbRow stride + type 3 / grftmap 2 (stock
 *  convention) + w*h pixels of palette indexes (0 = transparent cutout). */
export const tmapBody = (t) =>
  hdr().i16(t.w).u8(3).u8(2).i16(0).i16(0).i16(t.w).i16(t.h).pad(4).bytes(t.px).out();

/** TXXF — optional UV transform (bmat23) for a textured material. */
export const txxfBody = (m) => { const w = hdr(); for (const v of m) w.brs(v); return w.out(); };

/** PRTH — prop-picker entry: bo|osk|'TMPL'|cno, GOKD->MBMP thumb. */
export const prthBody = (cno) => hdr().ctg('TMPL').i32(cno).out();
const body4 = () => hdr().out();
const EMPTY = { verts: [], faces: [], smooth: [] };

// ---- the stock prop action set ----------------------------------------------
// Every prop ships the standard nine actions (At Rest + Grow/Grow Fast/
// Shrink/Shrink Fast/Spin/Spin Fast/Squash/Stretch) so it feels native in the
// action browser. They're synthesized as transforms of the invisible root
// part — all children keep their model + identity matrix every cel.
// `nParts` = total part count INCLUDING the root.
const ACTION_DEFS = [
  { anid: 0, name: 'At Rest', ccel: 1, m: () => M.identity() },
  { anid: 1, name: 'Grow', ccel: 24, m: (t) => M.scale(...Array(3).fill(1 + t)) },
  { anid: 2, name: 'Grow Fast', ccel: 14, m: (t) => M.scale(...Array(3).fill(1 + t)) },
  { anid: 3, name: 'Shrink', ccel: 24, m: (t) => M.scale(...Array(3).fill(1 - 0.65 * t)) },
  { anid: 4, name: 'Shrink Fast', ccel: 14, m: (t) => M.scale(...Array(3).fill(1 - 0.65 * t)) },
  { anid: 5, name: 'Spin', ccel: 12, m: (t) => M.rotY(t * Math.PI * 2) },
  { anid: 6, name: 'Spin Fast', ccel: 6, m: (t) => M.rotY(t * Math.PI * 2) },
  { anid: 7, name: 'Squash', ccel: 24, m: (t) => M.scale(1 + 0.4 * t, 1 - 0.45 * t, 1 + 0.4 * t) },
  { anid: 8, name: 'Stretch', ccel: 24, m: (t) => M.scale(1 - 0.3 * t, 1 + 0.6 * t, 1 - 0.3 * t) },
];

/** Synthesize the action set for an nParts-part prop -> [{anid,name,grfactn,cels,mats}]. */
export function stdActions(nParts) {
  return ACTION_DEFS.map((d) => {
    const mats = [M.identity()];               // pool entry 0 = child identity
    const cels = [];
    for (let i = 0; i < d.ccel; i++) {
      const t = d.ccel === 1 ? 0 : i / (d.ccel - 1); // Grow/Shrink end at the pose (STATIC holds the last cel)
      mats.push(d.m(t));
      const cps = [{ chidModl: 0, imat34: i + 1 }];
      for (let p = 1; p < nParts; p++) cps.push({ chidModl: p, imat34: 0 });
      cels.push({ chidSnd: 0, dwr: PROP_DWR, cps });
    }
    return { anid: d.anid, name: d.name, grfactn: GRFACTN, cels, mats };
  });
}

// ---- pack assembly -----------------------------------------------------------
/**
 * Emit every chunk of one prop's TMPL subtree.
 * spec/prop: {name, rest?}; parts: [{ramp,tex?,txxf?,verts,faces,smooth,uvs?}]
 * (visible parts). next(): cno allocator. texs: pack-level TMAP dedup map.
 * Returns {chunks, tmplCno}.
 */
export function propChunks(prop, parts, next, texs = new Map()) {
  const chunks = [];
  const add = (ctg, data, name, extra = {}) => {
    const c = { ctg, cno: next(), data, name };
    chunks.push(c);
    return Object.assign(c, extra);
  };
  const tmpl = { ctg: 'TMPL', cno: next(), data: tmplBody(prop.rest), name: prop.name, kids: [] };
  chunks.push(tmpl);
  const nParts = parts.length + 1;              // + invisible root

  // part tables + costume chain
  const glpi = add('GLPI', i16gl([-1, ...parts.map(() => 0)]), `${prop.name} Parents`);
  const glbs = add('GLBS', i16gl(new Array(nParts).fill(0)), `${prop.name} Body Sets`);
  const ggcm = add('GGCM', ggcmBody([[0]]), `${prop.name} Costume Map`);
  // models: chid 0 = empty root mesh, chid i = part i's mesh
  const bmdls = [{ ctg: 'BMDL', cno: next(), chid: 0, data: bmdlBody(EMPTY), name: `${prop.name} Root` },
    ...parts.map((p, i) => ({ ctg: 'BMDL', cno: next(), chid: i + 1, data: bmdlBody(p), name: `${prop.name} Part ${i + 1}` }))];
  chunks.push(...bmdls);
  // one CMTL (ibset 0) with an MTRL kid per part (chid = part index);
  // textured parts carry a TMAP (+ optional TXXF) kid under their MTRL
  const cmtl = { ctg: 'CMTL', cno: next(), data: cmtlBody(0), name: `${prop.name} Costume`, kids: [] };
  const tmapFor = (tex) => {
    if (!texs.has(tex)) {
      texs.set(tex, { ctg: 'TMAP', cno: next(), data: tmapBody(tex), name: `${prop.name} Texture` });
      chunks.push(texs.get(tex));
    }
    return texs.get(tex);
  };
  const mtrls = [{ ramp: parts[0]?.ramp ?? 15 }, ...parts].map((p, i) => {
    const m = { ctg: 'MTRL', cno: next(), data: mtrlBody(p?.ramp ?? 15), name: `${prop.name} Material ${i}`, kids: [] };
    if (p?.tex) m.kids.push({ ctg: 'TMAP', cno: tmapFor(p.tex).cno, chid: 0 });
    if (p?.txxf) {
      const x = { ctg: 'TXXF', cno: next(), data: txxfBody(p.txxf), name: `${prop.name} UV Transform` };
      chunks.push(x);
      m.kids.push({ ctg: 'TXXF', cno: x.cno, chid: 0 });
    }
    chunks.push(m);
    cmtl.kids.push({ ctg: 'MTRL', cno: m.cno, chid: i });
    return m;
  });
  chunks.push(cmtl);
  // actions — stock set, kids emitted so anid 0 lands first in the TMPL kid list
  const actns = stdActions(nParts).map((a) => {
    const ggcl = add('GGCL', ggclBody(a.cels), `${prop.name} ${a.name} Cels`);
    const glxf = add('GLXF', glxfBody(a.mats), `${prop.name} ${a.name} Matrices`);
    const actn = { ctg: 'ACTN', cno: next(), data: actnBody(a.grfactn), name: a.name, chid: a.anid,
      kids: [{ ctg: 'GGCL', cno: ggcl.cno, chid: 0 }, { ctg: 'GLXF', cno: glxf.cno, chid: 0 }] };
    chunks.push(actn);
    return actn;
  });
  tmpl.kids = [
    { ctg: 'ACTN', cno: actns[0].cno, chid: 0 },   // first ACTN kid = editor default action
    ...bmdls.map((b) => ({ ctg: 'BMDL', cno: b.cno, chid: b.chid })),
    { ctg: 'CMTL', cno: cmtl.cno, chid: 0 },
    { ctg: 'GGCM', cno: ggcm.cno, chid: 0 },
    { ctg: 'GLBS', cno: glbs.cno, chid: 0 },
    { ctg: 'GLPI', cno: glpi.cno, chid: 0 },
    ...actns.slice(1).map((a) => ({ ctg: 'ACTN', cno: a.cno, chid: a.chid })),
  ];
  return { chunks, tmplCno: tmpl.cno, mtrls };
}

/** Build the pack .3cn: 256-entry pack palette (thumbs decode against it) + every prop. */
export function build3cn(spec, props, socpal) {
  let cno = spec.cnoBase;
  const next = () => cno++;
  const texs = new Map(); // TMAP dedup across props (shared textures)
  const chunks = [{ ctg: 'GLCR', cno: next(), data: glcrBody(socpal), name: `${spec.name} Pack Palette`, loner: true }];
  const tmplCnos = [];
  for (const { prop, parts } of props) {
    const r = propChunks(prop, parts, next, texs);
    chunks.push(...r.chunks);
    tmplCnos.push(r.tmplCno);
    if (cno - spec.cnoBase > 480) throw new Error(`pack exceeds 480-chunk budget (thumbnails start at +500)`);
  }
  return { bytes: writeChunkyFile(chunks), tmplCnos };
}

/** Build the .3th: one PRTH{GOKD->MBMP} per prop (PRTH cno = template cno, like stock). */
export function build3th(spec, thumbs) {
  let cno = spec.cnoBase + 500;                  // .3th block, clear of the .3cn range
  const chunks = [];
  thumbs.forEach(({ tmplCno, idx, name }) => {
    const mbmp = { ctg: 'MBMP', cno: cno++, data: mbmpBody(THUMB, THUMB, idx), name: `${name} Thumbnail` };
    const gokd = { ctg: 'GOKD', cno: cno++, data: body4(), kids: [{ ctg: 'MBMP', cno: mbmp.cno, chid: 0 }], name: `${name} Thumbnail Group` };
    chunks.push({ ctg: 'PRTH', cno: tmplCno, data: prthBody(tmplCno), kids: [{ ctg: 'GOKD', cno: gokd.cno, chid: 0 }] }, gokd, mbmp);
  });
  return writeChunkyFile(chunks);
}

// ---- thumbnail rasterizer -----------------------------------------------------
// Reproduces the engine's untextured shading: idx = ramp + floor(clamp(ka +
// kd*sum(max(0,n.l)*I))*range). Transparent background (-1), auto-fit camera.
const THUMB_LIGHTS = [
  { dir: norm([0.5, 0.8, 0.55]), i: 1.0 },   // key, upper front-right
  { dir: norm([-0.65, 0.25, 0.45]), i: 0.35 }, // fill, front-left
];
function norm(v) { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); }
const KA = 0.12, KD = 1.0, RANGE = 7;

/**
 * Rasterize a prop's parts -> {idx: Int16Array THUMB², rgb: preview at PREV²}.
 * `dir`/`fov`/`dist` can override the auto camera (3/4 view, fit to bounds).
 */
export function renderThumb(parts, pal, { size = THUMB, ss = 3, fov = 38, dir = [0.45, 0.42, 0.78], lights = THUMB_LIGHTS, ka = KA, kd = KD } = {}) {
  const tris = [];
  for (const p of parts)
    for (const f of p.faces)
      tris.push({ v: [p.verts[f[0]], p.verts[f[1]], p.verts[f[2]]],
        uv: p.uvs ? [p.uvs[f[0]], p.uvs[f[1]], p.uvs[f[2]]] : null, ramp: p.ramp, tmap: p.tex });
  // auto-fit: bounding sphere -> camera distance for the fov
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const t of tris) for (const v of t.v) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], v[a]); mx[a] = Math.max(mx[a], v[a]); }
  const ctr = mn.map((v, i) => (v + mx[i]) / 2);
  const r = Math.max(1e-3, Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2);
  const dist = (r / Math.tan((fov * Math.PI) / 360)) * 1.12;
  const d = norm(dir);
  const cam = lookAt([ctr[0] + d[0] * dist, ctr[1] + d[1] * dist, ctr[2] + d[2] * dist], ctr);
  const view = invert34(cam);
  const S = size * ss, fp = (S / 2) / Math.tan((fov * Math.PI) / 360);
  const zbuf = new Float32Array(S * S).fill(Infinity);
  const idx = new Int16Array(S * S).fill(-1);
  const shade = (t) => {
    const [a, b, c] = t.v;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = norm([u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]);
    const eye = [cam[9], cam[10], cam[11]];
    let nn = n;
    if (n[0] * (eye[0] - a[0]) + n[1] * (eye[1] - a[1]) + n[2] * (eye[2] - a[2]) <= 0) nn = [-n[0], -n[1], -n[2]];
    let li = ka;
    for (const l of lights) li += kd * Math.max(0, nn[0] * l.dir[0] + nn[1] * l.dir[1] + nn[2] * l.dir[2]) * l.i;
    return t.ramp + Math.floor(Math.min(1, Math.max(0, li)) * RANGE);
  };
  for (const t of tris) {
    const col = t.tmap && t.uv ? -2 : shade(t); // -2 = textured, shaded per-pixel
    const cs = t.v.map((p) => xf34(p, view));
    if (cs.every((q) => q[2] > -0.5)) continue;            // fully behind camera
    const sp = cs.map((q) => [S / 2 + (q[0] / -q[2]) * fp, S / 2 - (q[1] / -q[2]) * fp, -q[2]]);
    fill(sp, col, t, zbuf, idx, S);
  }
  // downsample S -> size: any coverage keeps the nearest covered index
  const out = new Int16Array(size * size).fill(-1);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let best = Infinity, bi = -1;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const o = (y * ss + sy) * S + x * ss + sx;
      if (idx[o] >= 0 && zbuf[o] < best) { best = zbuf[o]; bi = idx[o]; }
    }
    out[y * size + x] = bi;
  }
  // preview at the render resolution (light paper background for readability)
  const rgb = new Uint8Array(S * S * 3);
  for (let i = 0; i < S * S; i++) {
    const p = idx[i] < 0 ? [206, 200, 188] : pal[idx[i]];
    rgb[i * 3] = p[0]; rgb[i * 3 + 1] = p[1]; rgb[i * 3 + 2] = p[2];
  }
  return { idx: out, rgb, size: S };
}
const xf34 = (p, m) => [p[0] * m[0] + p[1] * m[3] + p[2] * m[6] + m[9],
  p[0] * m[1] + p[1] * m[4] + p[2] * m[7] + m[10],
  p[0] * m[2] + p[1] * m[5] + p[2] * m[8] + m[11]];

/** Scanline-fill a projected triangle into idx/zbuf (S x S); textured tris
 *  (col === -2) sample the TMAP per-pixel by barycentric uv. */
function fill(sp, col, t, zbuf, idx, S) {
  const [a, b, c] = sp;
  const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
  const maxX = Math.min(S - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
  const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
  const maxY = Math.min(S - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
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
      const zc = Math.abs(d) / (w0 * iza + w1 * izb + w2 * izc);
      const o = y * S + x;
      if (zc >= zbuf[o]) continue;
      let ci = col;
      if (ci === -2) { // textured: sample nearest texel at barycentric uv
        const u = (w0 * t.uv[0][0] + w1 * t.uv[1][0] + w2 * t.uv[2][0]) / d;
        const v = (w0 * t.uv[0][1] + w1 * t.uv[1][1] + w2 * t.uv[2][1]) / d;
        const tx = Math.floor(((u % 1) + 1) % 1 * t.tmap.w), ty = Math.floor(((v % 1) + 1) % 1 * t.tmap.h);
        ci = t.tmap.px[ty * t.tmap.w + tx];
        if (!ci) continue; // index 0 = transparent
      }
      zbuf[o] = zc; idx[o] = ci;
    }
  }
}

/** Zip {name:Uint8Array} into a .vxp. */
export const vxp = (files) => zipSync(files, { level: 9 });
export { png };
