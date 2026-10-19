// Build an actor-pack spec into a .vxp expansion in public/expansions/.
//   npx vite-node tools/actor-gen/build.mjs tools/actor-gen/specs/actors/tinman.mjs
// Spec default-exports {name, fileName, cnoBase?, base?, author?, actors:
// [{name, thumb?, build(body, geo), outfits:[...]}]} — see specs/actors/tinman.mjs.
// `base` picks the stock humanoid whose skeleton + full 33-action set the
// generated actors inherit (default 'Zack').
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as geo from './geo.mjs';
import { loadRig } from './rig.mjs';
import { THUMB, build3cn, build3th, renderActorThumb, resolveActor, vxp, png } from './lib.mjs';
import { ChunkyFile } from '../../src/format/chunky.js';
import { parseTemplate, templateAction, templateModel, templateCmtl, parseMtrl } from '../../src/format/content.js';
import { Actor } from '../../src/engine/actor.js';
import { AET } from '../../src/format/movie.js';

const specPath = path.resolve(process.argv[2] || 'tools/actor-gen/specs/actors/tinman.mjs');
const spec = (await import('file://' + specPath)).default;
spec.cnoBase ??= 800000 + (hash(spec.fileName || spec.name) % 200) * 1000;
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const socpal = [...new Uint8Array(fs.readFileSync(path.join(root, 'public/local/socpal.pal')))];
const pal = Array.from({ length: 256 }, (_, i) => socpal.slice(i * 3, i * 3 + 3));

const rig = await loadRig(spec.base ?? 'Zack');
console.log(`${spec.name}: base ${rig.name} (cno ${rig.cno}) — ${rig.parts.length} bones, ${rig.cbset} sets, ${rig.actns.length} stock actions`);

// ---- build every actor -------------------------------------------------------
const resolved = spec.actors.map((actor) => {
  const r = resolveActor(actor, rig, geo);
  const empty = rig.parts.filter((p) => !r.baked.has(p.i) || !r.baked.get(p.i).verts.length).map((p) => p.name);
  if (empty.length) console.log(`  ${actor.name}: empty bones (invisible): ${empty.join(', ')}`);
  for (const [i, p] of r.baked) {
    if (!p.verts.length) continue;
    if (rig.parts[i].ibset === undefined) throw new Error(`${actor.name}: geometry on unknown part ${i}`);
  }
  return r;
});

// ---- package + thumbnails ------------------------------------------------------
const { bytes: cn, tmplCnos } = build3cn(spec, rig, resolved, pal);

// Re-parse now — previews and validation both run on the emitted file.
const cf = new ChunkyFile(cn, spec.fileName);
const xf = (p, m) => [p[0] * m[0] + p[1] * m[3] + p[2] * m[6] + m[9],
  p[0] * m[1] + p[1] * m[4] + p[2] * m[7] + m[10],
  p[0] * m[2] + p[1] * m[5] + p[2] * m[8] + m[11]];

/** Headless actor posed at (anid, frame), wearing outfit column `oi` —
 *  returns {actor, world, posedParts} for previews/validation. */
function poseActor(t, oi, anid, frame) {
  const data = { cno: 0, arid: 0, nfrmFirst: 0, nfrmLast: 999, name: t.name,
    dxyzFullRte: { x: 0, y: 0, z: 0 }, tagTmpl: { sid: 2, ctg: 'TMPL', cno: t.cno },
    route: [{ x: 0, y: 0, z: 0, dwr: 0 }],
    events: [
      { aet: AET.Add, nfrm: 0, rtel: { irpt: 0, dwrOffset: 0, dnfrm: 0 }, data: { x: 0, y: 0, z: 0, xa: 0, ya: 0, za: 0 } },
      { aet: AET.Actn, nfrm: 0, rtel: { irpt: 0, dwrOffset: 0, dnfrm: 0 }, data: { anid, celn: 0 } },
    ] };
  const a = new Actor(data, t, { mtrl: () => null });
  a.gotoFrame(frame); // Add fires _setDefaultCost first — override after
  for (let b = 0; b < t.cbset; b++) { // wear outfit column oi on every set
    const cmid = t.cmids[b]?.[Math.min(oi, t.cmids[b].length - 1)];
    if (cmid !== undefined) a._applyCmtl(templateCmtl(t, cmid));
  }
  const world = a.partWorldMatrices();
  const posed = a.parts.map((p, i) => {
    if (!p.model) return null;
    const verts = [];
    for (let v = 0; v < p.model.positions.length; v += 3)
      verts.push(xf([p.model.positions[v], p.model.positions[v + 1], p.model.positions[v + 2]], world[i]));
    const uvs = [];
    for (let u = 0; u < p.model.uvs.length; u += 2) uvs.push([p.model.uvs[u], p.model.uvs[u + 1]]);
    return { verts, faces: [...Array(p.model.indices.length / 3)].map((_, f) =>
      [p.model.indices[f * 3], p.model.indices[f * 3 + 1], p.model.indices[f * 3 + 2]]),
      ramp: p.mtrl?.indexBase ?? 15, tmap: p.mtrl?.tmap ? { w: p.mtrl.tmap.width, h: p.mtrl.tmap.height, px: p.mtrl.tmap.pixels } : null,
      uvs: p.mtrl?.tmap ? uvs : null };
  }).filter(Boolean);
  return { actor: a, world, posed };
}

const thumbs = spec.actors.map((actor, i) => {
  const t = parseTemplate(cf, tmplCnos[i]);
  const { posed } = poseActor(t, 0, 0, 2);
  return { tmplCno: tmplCnos[i], ...renderActorThumb(posed, pal, actor.thumb || {}), name: actor.name };
});
const th = build3th(spec, thumbs);
const cfg = new TextEncoder().encode(
  `extInfo = "${spec.name}"\nDesc = "${spec.desc ?? ''}"\nVersion = ${spec.ver ?? '1.0'}\nAuthor = ${spec.author ?? '3dmm-web actor-gen'}\nType = Portable\nContent = Actors\nGenerator = tools/actor-gen\n`);
const zip = vxp({ [`${spec.fileName}.3cn`]: cn, [`${spec.fileName}.3th`]: th, [`${spec.fileName}.cfg`]: cfg });

const outVxp = path.join(root, 'public/expansions', `${spec.fileName}.vxp`);
fs.writeFileSync(outVxp, zip);
const outDir = path.join(root, 'tools/actor-gen/out', spec.fileName);
fs.mkdirSync(outDir, { recursive: true });

// previews: every outfit at rest + a mid-walk frame of outfit 0
const walkAnid = rig.actns.find((a) => /walk fast/i.test(a.name))?.anid ?? rig.actns[1]?.anid ?? 0;
spec.actors.forEach((actor, i) => {
  const t = parseTemplate(cf, tmplCnos[i]);
  const safe = (s) => s.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  resolved[i].outfits.forEach((out, oi) => {
    const { posed } = poseActor(t, oi, 0, 2);
    const r = renderActorThumb(posed, pal, { size: 216, ...(actor.thumb || {}) });
    fs.writeFileSync(path.join(outDir, `${safe(actor.name)}_${safe(out.name)}.png`), png(r.size, r.size, r.rgb));
  });
  if (walkAnid) {
    const { posed } = poseActor(t, 0, walkAnid, 4);
    const r = renderActorThumb(posed, pal, { size: 216, ...(actor.thumb || {}) });
    fs.writeFileSync(path.join(outDir, `${safe(actor.name)}_walk.png`), png(r.size, r.size, r.rgb));
  }
});
console.log(`wrote ${outVxp} (${(zip.length / 1024).toFixed(0)} KB) — ${tmplCnos.length} actors`);
console.log(`previews: ${outDir}`);
console.log(`load with: ?vxp=expansions/${spec.fileName}.vxp`);

// ---- validate: re-parse through the real parsers + headless Actor ----------
let ok = true;
const fail = (m) => { ok = false; console.error('  FAIL', m); };
for (const [i, cno] of tmplCnos.entries()) {
  const actor = spec.actors[i];
  const t = parseTemplate(cf, cno);
  if (t.isProp || t.isTdt) fail(`${actor.name}: not a plain actor template`);
  if (t.parents.length !== rig.parts.length) fail(`${actor.name}: part count mismatch`);
  if (t.cmids.some((l) => l.length !== resolved[i].outfits.length)) fail(`${actor.name}: GGCM column count != outfits`);

  const actnKids = cf.kidsOf('TMPL', cno, 'ACTN');
  const bmdlChids = new Set(cf.kidsOf('TMPL', cno, 'BMDL').map((k) => k.chid));
  for (const k of actnKids) {
    const a = templateAction(t, k.chid);
    for (const [ci, cel] of a.cels.entries())
      for (const cp of cel.cps) {
        if (cp.imat34 >= a.matrices.length) fail(`${actor.name} actn ${k.chid} cel ${ci}: imat34 ${cp.imat34} >= ${a.matrices.length}`);
        if (cp.chidModl >= 0 && !bmdlChids.has(cp.chidModl)) fail(`${actor.name} actn ${k.chid} cel ${ci}: model ${cp.chidModl} has no BMDL`);
      }
  }
  for (const k of cf.kidsOf('TMPL', cno, 'BMDL')) {
    const m = templateModel(t, k.chid);
    for (const ix of m.indices) if (ix >= m.positions.length / 3) fail(`${actor.name} bmdl ${k.chid}: index ${ix} out of range`);
  }
  for (const [b, cmids] of t.cmids.entries())
    for (const cmid of cmids) {
      const cmtl = templateCmtl(t, cmid);
      if (!cmtl) { fail(`${actor.name}: cmid ${cmid} missing`); continue; }
      if (cmtl.ibset !== b) fail(`${actor.name}: cmid ${cmid} targets ibset ${cmtl.ibset}, listed under ${b}`);
      const want = rig.ibsets.filter((x) => x === b).length;
      if (cmtl.parts.length !== want) fail(`${actor.name}: cmid ${cmid} covers ${cmtl.parts.length} of ${want} in-set parts`);
      cmtl.parts.forEach((p, k) => { if (!p.mtrl) fail(`${actor.name}: cmid ${cmid} part ${k} has no material`); });
    }

  // headless smoke test: every action, a few frames each — no throw, finite
  // matrices, every part has a model + material after Add.
  const anids = actnKids.map((k) => k.chid);
  for (const anid of anids) {
    const { actor: a, world } = poseActor(t, 0, anid, 4);
    for (const wm of world) for (const v of wm) if (!Number.isFinite(v)) fail(`${actor.name} anid ${anid}: non-finite matrix`);
    const unmodeled = a.parts.filter((p) => !p.model).length;
    const unmtrl = a.parts.filter((p) => !p.mtrl).length;
    if (unmodeled || unmtrl) fail(`${actor.name} anid ${anid}: ${unmodeled} unmodeled / ${unmtrl} unmaterialed parts`);
  }

  // rest-pose world bounds of the generated meshes (size sanity table)
  const { posed } = poseActor(t, 0, 0, 2);
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const p of posed) for (const v of p.verts) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); }
  const size = mx.map((v, k) => (v - mn[k]).toFixed(1));
  console.log(`  ${actor.name}: parts=${t.parents.length} actns=${actnKids.length} outfits=${resolved[i].outfits.length} size=${size.join('x')} y=[${mn[1].toFixed(1)}..${mx[1].toFixed(1)}]`);
}
if (!ok) { console.error('validation failed'); process.exit(1); }
console.log('validation ok');
