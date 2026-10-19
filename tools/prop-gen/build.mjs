// Build a prop-pack spec into a .vxp expansion in public/expansions/.
//   npx vite-node tools/prop-gen/build.mjs tools/prop-gen/specs/props/household.mjs
// The spec default-exports {name, fileName, cnoBase?, author?, props:[{name,
// rest?, build(parts, geo)}]} — see specs/props/household.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as geo from './geo.mjs';
import { THUMB, build3cn, build3th, renderThumb, vxp, png } from './lib.mjs';
import { ChunkyFile } from '../../src/format/chunky.js';
import { parseTemplate, templateAction, templateModel, templateCmtl } from '../../src/format/content.js';
import { Actor } from '../../src/engine/actor.js';
import { AET } from '../../src/format/movie.js';

const specPath = path.resolve(process.argv[2] || 'tools/prop-gen/specs/props/household.mjs');
const spec = (await import('file://' + specPath)).default;
spec.cnoBase ??= 800000 + (hash(spec.fileName || spec.name) % 200) * 1000;
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const socpal = [...new Uint8Array(fs.readFileSync(path.join(root, 'public/local/socpal.pal')))];
const pal = Array.from({ length: 256 }, (_, i) => socpal.slice(i * 3, i * 3 + 3));

// ---- build every prop --------------------------------------------------------
const built = spec.props.map((prop) => {
  const parts = [];
  const ps = { add: (ramp, o) => { const p = geo.part(ramp, o); parts.push(p); return p; } };
  prop.build(ps, geo);
  if (!parts.length) throw new Error(`${prop.name}: build() emitted no parts`);
  // textured parts need UVs — project now unless the spec assigned p.uvs
  for (const p of parts)
    if (p.tex && !p.uvs) geo.projectUV(p, p.uv || 'face', p.uvScale || 0);
  return { prop, parts };
});
console.log(`${spec.name}: ${built.length} props, cnoBase ${spec.cnoBase}`);

// ---- package + thumbnails ------------------------------------------------------
const { bytes: cn, tmplCnos } = build3cn(spec, built, pal);
const thumbs = built.map(({ prop, parts }, i) =>
  ({ tmplCno: tmplCnos[i], ...renderThumb(parts, pal, prop.thumb || {}), name: prop.name }));
const th = build3th(spec, thumbs);
const cfg = new TextEncoder().encode(
  `extInfo = "${spec.name}"\nDesc = "${spec.desc ?? ''}"\nVersion = ${spec.ver ?? '1.0'}\nAuthor = ${spec.author ?? '3dmm-web prop-gen'}\nType = Portable\nContent = Props\nGenerator = tools/prop-gen\n`);
const zip = vxp({ [`${spec.fileName}.3cn`]: cn, [`${spec.fileName}.3th`]: th, [`${spec.fileName}.cfg`]: cfg });

const outVxp = path.join(root, 'public/expansions', `${spec.fileName}.vxp`);
fs.writeFileSync(outVxp, zip);
const outDir = path.join(root, 'tools/prop-gen/out', spec.fileName);
fs.mkdirSync(outDir, { recursive: true });
thumbs.forEach((t) => {
  const safe = t.name.replace(/[^a-z0-9]+/gi, '_').toLowerCase();
  fs.writeFileSync(path.join(outDir, `${safe}.png`), png(t.size, t.size, t.rgb));
});
console.log(`wrote ${outVxp} (${(zip.length / 1024).toFixed(0)} KB) — ${tmplCnos.length} TMPLs`);
console.log(`previews: ${outDir}`);
console.log(`load with: ?vxp=expansions/${spec.fileName}.vxp`);

// ---- validate: re-parse the emitted .3cn through the real parsers -------------
const cf = new ChunkyFile(cn, spec.fileName);
let ok = true;
const fail = (m) => { ok = false; console.error('  FAIL', m); };
for (const [i, cno] of tmplCnos.entries()) {
  const prop = spec.props[i];
  const t = parseTemplate(cf, cno);
  if (!t.isProp) fail(`${prop.name}: grftmpl missing prop bit`);
  if (t.parents.length !== built[i].parts.length + 1) fail(`${prop.name}: part count mismatch`);
  for (const k of cf.kidsOf('TMPL', cno, 'ACTN')) {
    const a = templateAction(t, k.chid);
    for (const [ci, cel] of a.cels.entries())
      for (const cp of cel.cps)
        if (cp.imat34 >= a.matrices.length) fail(`${prop.name} actn ${k.chid} cel ${ci}: imat34 ${cp.imat34} >= ${a.matrices.length}`);
  }
  for (const k of cf.kidsOf('TMPL', cno, 'BMDL')) {
    const m = templateModel(t, k.chid);
    for (const ix of m.indices) if (ix >= m.positions.length / 3) fail(`${prop.name} bmdl ${k.chid}: index ${ix} out of range`);
  }
  const cmtl = templateCmtl(t, t.cmids[0]?.[0]);
  if (!cmtl || cmtl.parts.length !== t.parents.length) fail(`${prop.name}: CMTL covers ${cmtl?.parts.length} of ${t.parents.length} parts`);
  built[i].parts.forEach((p, j) => {
    if (p.tex && !cmtl?.parts[j + 1]?.mtrl?.tmap) fail(`${prop.name} part ${j + 1}: TMAP missing from parsed material`);
  });

  // headless placement: Add + Actn, step a few frames, measure world bounds
  const mkEvents = (anid) => [
    { aet: AET.Add, nfrm: 0, rtel: { irpt: 0, dwrOffset: 0, dnfrm: 0 }, data: { x: 0, y: 0, z: 0, xa: 0, ya: 0, za: 0 } },
    { aet: AET.Actn, nfrm: 0, rtel: { irpt: 0, dwrOffset: 0, dnfrm: 0 }, data: { anid, celn: 0 } },
  ];
  const data = { cno: 0, arid: 0, nfrmFirst: 0, nfrmLast: 999, name: prop.name,
    dxyzFullRte: { x: 0, y: 0, z: 0 }, tagTmpl: { sid: 2, ctg: 'TMPL', cno },
    route: [{ x: 0, y: 0, z: 0, dwr: 0 }], events: mkEvents(0) };
  const actor = new Actor(data, t, { mtrl: () => null });
  for (let f = 0; f < 8; f++) actor.gotoFrame(f);
  const world = actor.partWorldMatrices();
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  world.forEach((wm, pi) => {
    const m = built[i].parts[pi - 1]; // world[0] = root (no mesh)
    if (!m) return;
    for (const v of m.verts) {
      const w = [v[0] * wm[0] + v[1] * wm[3] + v[2] * wm[6] + wm[9],
        v[0] * wm[1] + v[1] * wm[4] + v[2] * wm[7] + wm[10],
        v[0] * wm[2] + v[1] * wm[5] + v[2] * wm[8] + wm[11]];
      for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], w[a]); mx[a] = Math.max(mx[a], w[a]); }
    }
  });
  if (!mn.every(Number.isFinite) || !mx.every(Number.isFinite)) fail(`${prop.name}: non-finite world matrices`);
  const size = mx.map((v, i) => (v - mn[i]).toFixed(1));
  console.log(`  ${prop.name}: parts=${t.parents.length} actns=${cf.kidsOf('TMPL', cno, 'ACTN').length} size=${size.join('x')} y=[${mn[1].toFixed(1)}..${mx[1].toFixed(1)}]`);
}
if (!ok) { console.error('validation failed'); process.exit(1); }
console.log('validation ok');
