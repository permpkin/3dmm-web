// Actor-pack builder: world-space bone parts + outfits -> .3cn (TMPL/GLPI/
// GLBS/GGCM/BMDL/CMTL/MTRL/TMAP + verbatim ACTN subtrees) + .3th (TMTH/
// GOKD/MBMP picker thumbs) -> .vxp zip. Run via vite-node.
import { Writer } from '../../src/format/binary.js';
import { buildGL, buildGG, writeChunkyFile } from '../../src/format/chunky.js';
import { mbmpBody, glcrBody, png, lookAt, invert34 } from '../scene-gen/lib.mjs';
import { tmplBody, i16gl, ggcmBody, mtrlBody, cmtlBody, vxp } from '../prop-gen/lib.mjs';
import { bake, projectUV } from './geo.mjs';

const KOSK = 0x0303;
export const THUMB = 72; // TMTH thumbnail size (matches stock)
const hdr = () => new Writer().bo().u16(KOSK);
const EMPTY = { verts: [], faces: [], smooth: [], uvs: null };

// ---- chunk-body encoders (actor-specific) ------------------------------------

/** BMDL — indexed mesh with per-vertex UVs (used when the material has a TMAP). */
export function bmdlBody(p) {
  const nv = p.verts.length, nf = p.faces.length;
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const v of p.verts) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], v[a]); mx[a] = Math.max(mx[a], v[a]); }
  if (!nv) { mn.fill(0); mx.fill(0); }
  const radius = nv ? Math.max(...p.verts.map((v) => Math.hypot(v[0], v[1], v[2]))) : 0;
  const w = hdr();
  w.u16(nv).u16(nf).brs(radius);
  for (const v of [...mn, ...mx]) w.brs(v);
  for (const v of [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2]) w.brs(v);
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

/** TMAP — indexed texture: cbRow stride + type 3 / grftmap 2 (stock actor
 *  convention) + w*h pixels of palette indexes (0 = transparent cutout). */
export const tmapBody = (t) =>
  hdr().i16(t.w).u8(3).u8(2).i16(0).i16(0).i16(t.w).i16(t.h).pad(4).bytes(t.px).out();

/** TXXF — optional UV transform (bmat23) for a textured material. */
export const txxfBody = (m) => { const w = hdr(); for (const v of m) w.brs(v); return w.out(); };

/** TMTH — actor-picker entry: bo|osk|'TMPL'|cno, GOKD->MBMP thumb (same body
 *  layout as PRTH; the catalog reads the template cno at offset 8). */
export const tmthBody = (cno) => hdr().ctg('TMPL').i32(cno).out();
const body4 = () => hdr().out();

// ---- outfit / material resolution ---------------------------------------------

const mspecOf = (m) => (m == null ? null : typeof m === 'number' ? { ramp: m } : m);

/** Resolve the material spec for one part of one outfit. Precedence:
 *  outfit.parts[bone] > outfit.sets[set] > outfit.all > outfit[0]'s result. */
export function outfitMtrl(actor, rig, oi, partI) {
  const bone = rig.parts[partI].name;
  const set = rig.ibsets[partI];
  for (const o of [oi, 0]) {
    if (o === undefined) continue;
    const out = actor.outfits[o];
    const pv = mspecOf(out.parts?.[bone]);
    if (pv) return pv;
    const sv = mspecOf(out.sets?.[set]) ?? mspecOf(out.sets?.[setName(rig, set)]);
    if (sv) return sv;
    const av = mspecOf(out.all);
    if (av) return av;
  }
  return { ramp: 15 };
}
const setName = (rig, b) => Object.keys(rig.sets).find((k) => rig.sets[k] === b);

/** Optional replacement mesh for a part in one outfit (`parts[bone].mesh` —
 *  authored in world space like build(), becomes a BMDL kid of the CMTL; that
 *  makes the outfit an "accessory" variant in the costume easel). */
function outfitMeshes(actor, rig, geo) {
  return (actor.outfits || []).map((out) => {
    const meshes = new Map();
    for (const [bone, spec] of Object.entries(out.parts || {})) {
      if (typeof spec !== 'object' || !spec?.mesh) continue;
      const i = rig.boneIx(bone);
      const p = { i, name: bone, verts: [], faces: [], smooth: [], uvs: null, uv: null };
      spec.mesh(p, geo, rig);
      if (!p.uvs) projectUV(p, spec.uv || p.uv || 'face');
      meshes.set(i, bake(p, rig.parts[i].inv));
    }
    return meshes;
  });
}

/**
 * Run a spec actor through the rig: spec.build(body, geo) fills world-space
 * bone parts; UVs are projected for every part that any outfit textures;
 * everything is baked into bone-local space. Returns {baked, outfits:[{name,
 * mtrls:[per-part mspec], meshes:Map}]}.
 */
export function resolveActor(actor, rig, geo) {
  const body = new geo.Body(rig);
  actor.build(body, geo);
  actor.outfits ||= [{ name: 'Default' }];
  const allMeshes = outfitMeshes(actor, rig, geo);
  const outfits = actor.outfits.map((out, oi) => ({
    name: out.name || 'Outfit',
    mtrls: rig.parts.map((_, i) => outfitMtrl(actor, rig, oi, i)),
    meshes: allMeshes[oi],
  }));
  const baked = new Map();
  for (const [i, p] of body.map) {
    const texed = outfits.find((o) => o.mtrls[i]?.tex);
    if (!p.uvs && (texed || p.uv)) projectUV(p, p.uv || texed?.mtrls[i]?.uv || 'face');
    baked.set(i, bake(p, rig.parts[i].inv));
  }
  return { body, baked, outfits };
}

// ---- pack assembly -------------------------------------------------------------

/**
 * Emit every chunk of one actor's TMPL subtree.
 * actor: spec entry; rig: loadRig() result; baked: Map(part -> local mesh);
 * outfits: resolved per-part materials + optional mesh overrides.
 * next(): cno allocator. Returns {chunks, tmplCno}.
 */
export function actorChunks(actor, rig, baked, outfits, next) {
  const chunks = [];
  const add = (ctg, data, name, extra = {}) => {
    const c = { ctg, cno: next(), data, name };
    chunks.push(c);
    return Object.assign(c, extra);
  };
  const tmpl = { ctg: 'TMPL', cno: next(), data: tmplBody(rig.rest, 0), name: actor.name, kids: [] };
  chunks.push(tmpl);
  const glpi = add('GLPI', i16gl(rig.parents), `${actor.name} Parents`);
  const glbs = add('GLBS', i16gl(rig.ibsets), `${actor.name} Body Sets`);

  // One BMDL per base chid — chid i is part i's rest model; extra chids are
  // action-swap meshes and alias their owner part's generated geometry.
  const bmdls = rig.bmdlChids.map((chid) => {
    const i = rig.modelOwner.get(chid) ?? (chid < rig.parts.length ? chid : 0);
    const p = baked.get(i) || EMPTY;
    return { ctg: 'BMDL', cno: next(), chid, data: bmdlBody(p),
      name: `${actor.name} ${rig.parts[i]?.name ?? 'part'}${chid === i ? '' : ' alt'}` };
  });
  chunks.push(...bmdls);

  // MTRL/TMAP chunk dedup across outfits (many parts share materials).
  const tmapIds = new Map(), mtrlIds = new Map();
  const tmapFor = (tex) => {
    if (!tmapIds.has(tex)) {
      const t = { ctg: 'TMAP', cno: next(), data: tmapBody(tex), name: `${actor.name} Texture` };
      chunks.push(t);
      tmapIds.set(tex, t);
    }
    return tmapIds.get(tex);
  };
  const mtrlFor = (ms, label) => {
    if (ms.tex && !tmapIds.has(ms.tex)) tmapFor(ms.tex); // before the key
    const key = JSON.stringify([ms.ramp, ms.indexRange, ms.ka, ms.kd, ms.ks, ms.power, ms.brc,
      ms.tex ? tmapIds.get(ms.tex).cno : 0, ms.txxf]);
    if (mtrlIds.has(key)) return mtrlIds.get(key);
    const m = { ctg: 'MTRL', cno: next(), data: mtrlBody(ms.ramp ?? 15, ms), name: `${actor.name} ${label}`, kids: [] };
    if (ms.tex) m.kids.push({ ctg: 'TMAP', cno: tmapFor(ms.tex).cno, chid: 0 });
    if (ms.txxf) {
      const x = { ctg: 'TXXF', cno: next(), data: txxfBody(ms.txxf), name: `${actor.name} UV Transform` };
      chunks.push(x);
      m.kids.push({ ctg: 'TXXF', cno: x.cno, chid: 0 });
    }
    chunks.push(m);
    mtrlIds.set(key, m);
    return m;
  };

  // Outfits -> one CMTL per (outfit, ibset); cmid chid = outfit*cbset + ibset
  // (stock convention — cmids[ibset][j] is the set's j-th costume column).
  const inSet = (b) => rig.parts.filter((p) => p.ibset === b).map((p) => p.i);
  const cmidLists = Array.from({ length: rig.cbset }, () => []);
  const cmtls = [];
  outfits.forEach((out, o) => {
    for (let b = 0; b < rig.cbset; b++) {
      const chid = o * rig.cbset + b;
      cmidLists[b].push(chid);
      const cmtl = { ctg: 'CMTL', cno: next(), data: cmtlBody(b), chid,
        name: `${actor.name} ${out.name} ${setName(rig, b) ?? 'set' + b}`, kids: [] };
      inSet(b).forEach((pi, k) => {
        cmtl.kids.push({ ctg: 'MTRL', cno: mtrlFor(out.mtrls[pi] || { ramp: 15 }, `${out.name} ${rig.parts[pi].name}`).cno, chid: k });
        const mesh = out.meshes.get(pi);
        if (mesh) {
          const bm = { ctg: 'BMDL', cno: next(), chid: k, data: bmdlBody(mesh),
            name: `${actor.name} ${out.name} ${rig.parts[pi].name} Mesh` };
          chunks.push(bm);
          cmtl.kids.push({ ctg: 'BMDL', cno: bm.cno, chid: k });
        }
      });
      chunks.push(cmtl);
      cmtls.push(cmtl);
    }
  });
  const ggcm = add('GGCM', ggcmBody(cmidLists), `${actor.name} Costume Map`);

  // Actions — verbatim copies of the base's ACTN subtrees (stock names kept so
  // the action browser reads naturally; first ACTN kid = editor default).
  const actns = rig.actns.map((a) => {
    const ggcl = add('GGCL', a.ggcl, `${actor.name} ${a.name} Cels`);
    const glxf = add('GLXF', a.glxf, `${actor.name} ${a.name} Matrices`);
    const c = { ctg: 'ACTN', cno: next(), data: a.data, name: a.name, chid: a.anid,
      kids: [{ ctg: 'GGCL', cno: ggcl.cno, chid: 0 }, { ctg: 'GLXF', cno: glxf.cno, chid: 0 }] };
    chunks.push(c);
    return c;
  });
  tmpl.kids = [
    { ctg: 'ACTN', cno: actns[0].cno, chid: actns[0].anid },
    ...bmdls.map((b) => ({ ctg: 'BMDL', cno: b.cno, chid: b.chid })),
    ...cmtls.map((c) => ({ ctg: 'CMTL', cno: c.cno, chid: c.chid })),
    { ctg: 'GGCM', cno: ggcm.cno, chid: 0 },
    { ctg: 'GLBS', cno: glbs.cno, chid: 0 },
    { ctg: 'GLPI', cno: glpi.cno, chid: 0 },
    ...actns.slice(1).map((a) => ({ ctg: 'ACTN', cno: a.cno, chid: a.chid })),
  ];
  return { chunks, tmplCno: tmpl.cno };
}

/** Build the pack .3cn: 256-entry pack palette (thumbs decode against it) +
 *  every actor. `resolved` is resolveActor() output per actor. */
export function build3cn(spec, rig, resolved, socpal) {
  let cno = spec.cnoBase;
  const next = () => cno++;
  const chunks = [{ ctg: 'GLCR', cno: next(), data: glcrBody(socpal), name: `${spec.name} Pack Palette`, loner: true }];
  const tmplCnos = [];
  spec.actors.forEach((actor, i) => {
    const r = actorChunks(actor, rig, resolved[i].baked, resolved[i].outfits, next);
    chunks.push(...r.chunks);
    tmplCnos.push(r.tmplCno);
    if (cno - spec.cnoBase > 480) throw new Error(`pack exceeds 480-chunk budget (thumbnails start at +500)`);
  });
  return { bytes: writeChunkyFile(chunks), tmplCnos };
}

/** Build the .3th: one TMTH{GOKD->MBMP} per actor (TMTH cno = template cno). */
export function build3th(spec, thumbs) {
  let cno = spec.cnoBase + 500;
  const chunks = [];
  thumbs.forEach(({ tmplCno, idx, name }) => {
    const mbmp = { ctg: 'MBMP', cno: cno++, data: mbmpBody(THUMB, THUMB, idx), name: `${name} Thumbnail` };
    const gokd = { ctg: 'GOKD', cno: cno++, data: body4(), kids: [{ ctg: 'MBMP', cno: mbmp.cno, chid: 0 }], name: `${name} Thumbnail Group` };
    chunks.push({ ctg: 'TMTH', cno: tmplCno, data: tmthBody(tmplCno), kids: [{ ctg: 'GOKD', cno: gokd.cno, chid: 0 }] }, gokd, mbmp);
  });
  return writeChunkyFile(chunks);
}

// ---- posed-parts rasterizer -----------------------------------------------------
// Engine-identical ramp shading for untextured tris, nearest-texel TMAP
// sampling for textured ones (palette indexes; 0 = transparent). `parts` are
// world-space: {verts, faces, ramp, tmap?, uvs?}.
const THUMB_LIGHTS = [
  { dir: nrm([0.5, 0.8, 0.55]), i: 1.0 },
  { dir: nrm([-0.65, 0.25, 0.45]), i: 0.35 },
];
function nrm(v) { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); }
const KA = 0.12, KD = 1.0, RANGE = 7;

export function renderActorThumb(parts, pal, { size = THUMB, ss = 3, fov = 38, dir = [0.45, 0.42, 0.78], lights = THUMB_LIGHTS, ka = KA, kd = KD } = {}) {
  const tris = [];
  for (const p of parts)
    for (const f of p.faces)
      tris.push({ v: [p.verts[f[0]], p.verts[f[1]], p.verts[f[2]]],
        uv: p.uvs ? [p.uvs[f[0]], p.uvs[f[1]], p.uvs[f[2]]] : null, ramp: p.ramp, tmap: p.tmap });
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const t of tris) for (const v of t.v) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], v[a]); mx[a] = Math.max(mx[a], v[a]); }
  const ctr = mn.map((v, i) => (v + mx[i]) / 2);
  const r = Math.max(1e-3, Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) / 2);
  const dist = (r / Math.tan((fov * Math.PI) / 360)) * 1.12;
  const d = nrm(dir);
  const cam = lookAt([ctr[0] + d[0] * dist, ctr[1] + d[1] * dist, ctr[2] + d[2] * dist], ctr);
  const view = invert34(cam);
  const S = size * ss, fp = (S / 2) / Math.tan((fov * Math.PI) / 360);
  const zbuf = new Float32Array(S * S).fill(Infinity);
  const idx = new Int16Array(S * S).fill(-1);
  const eye = [cam[9], cam[10], cam[11]];
  const flat = (t) => {
    const [a, b, c] = t.v;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = nrm([u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]);
    let nn = n;
    if (n[0] * (eye[0] - a[0]) + n[1] * (eye[1] - a[1]) + n[2] * (eye[2] - a[2]) <= 0) nn = [-n[0], -n[1], -n[2]];
    let li = ka;
    for (const l of lights) li += kd * Math.max(0, nn[0] * l.dir[0] + nn[1] * l.dir[1] + nn[2] * l.dir[2]) * l.i;
    return t.ramp + Math.floor(Math.min(1, Math.max(0, li)) * RANGE);
  };
  for (const t of tris) {
    const col = t.tmap ? -2 : flat(t); // -2 = textured, shaded per-pixel
    const cs = t.v.map((p) => xf34(p, view));
    if (cs.every((q) => q[2] > -0.5)) continue;
    const sp = cs.map((q) => [S / 2 + (q[0] / -q[2]) * fp, S / 2 - (q[1] / -q[2]) * fp, -q[2]]);
    fillT(sp, col, t, zbuf, idx, S);
  }
  const out = new Int16Array(size * size).fill(-1);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let best = Infinity, bi = -1;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const o = (y * ss + sy) * S + x * ss + sx;
      if (idx[o] >= 0 && zbuf[o] < best) { best = zbuf[o]; bi = idx[o]; }
    }
    out[y * size + x] = bi;
  }
  const rgb = new Uint8Array(S * S * 3);
  for (let i = 0; i < S * S; i++) {
    const p = idx[i] < 0 ? [206, 200, 188] : pal[idx[i] & 0xff];
    rgb[i * 3] = p[0]; rgb[i * 3 + 1] = p[1]; rgb[i * 3 + 2] = p[2];
  }
  return { idx: out, rgb, size: S };
}
const xf34 = (p, m) => [p[0] * m[0] + p[1] * m[3] + p[2] * m[6] + m[9],
  p[0] * m[1] + p[1] * m[4] + p[2] * m[7] + m[10],
  p[0] * m[2] + p[1] * m[5] + p[2] * m[8] + m[11]];

/** Scanline-fill with barycentric UV interpolation for textured tris. */
function fillT(sp, col, t, zbuf, idx, S) {
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
        // NB: weights were sign-fixed for back-wound tris, so the normalizer
        // is |d| — dividing by signed d would negate uv on CW faces.
        const u = (w0 * t.uv[0][0] + w1 * t.uv[1][0] + w2 * t.uv[2][0]) / Math.abs(d);
        const v = (w0 * t.uv[0][1] + w1 * t.uv[1][1] + w2 * t.uv[2][1]) / Math.abs(d);
        const tx = Math.floor(((u % 1) + 1) % 1 * t.tmap.w), ty = Math.floor(((v % 1) + 1) % 1 * t.tmap.h);
        ci = t.tmap.px[ty * t.tmap.w + tx];
        if (!ci) continue; // index 0 = transparent
      }
      zbuf[o] = zc; idx[o] = ci;
    }
  }
}

export { vxp, png };
