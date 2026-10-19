// Build a scene spec into a .vxp expansion in public/expansions/.
//   npx vite-node tools/scene-gen/build.mjs tools/scene-gen/specs/western.mjs
// The spec default-exports: {name, fileName, cnoBase, indexBase, palette,
// sky, lights, cameras[], build(tris, geo)} — see specs/western.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as geo from './geo.mjs';
import { W, H, THUMB_W, THUMB_H, rasterize, downsample, makeCam, build3cn, build3th, png, zToRgb, vxp, effectivePalette, expandPalette } from './lib.mjs';

const specPath = path.resolve(process.argv[2] || 'tools/scene-gen/specs/western.mjs');
const spec = (await import(pathToFileUrl(specPath))).default;
spec.indexBase ??= 157;
spec.cnoBase ??= 700000 + (hash(spec.fileName || spec.name) % 200) * 1000;

function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
function pathToFileUrl(p) { return 'file://' + path.resolve(p); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const socpal = new Uint8Array(fs.readFileSync(path.join(root, 'public/local/socpal.pal')));
const declared = expandPalette(spec);
const pal = effectivePalette(socpal, declared, spec.indexBase);

// geometry
const tris = [];
spec.build(tris, geo);
console.log(`${spec.name}: ${tris.length} tris, palette ${declared.length} @${spec.indexBase}, cnoBase ${spec.cnoBase}`);

// render every camera
const env = { pal, sky: spec.sky, ka: spec.ka ?? 0.45, kd: spec.kd ?? 0.7, lights: spec.lights.map((l) => ({ ...l, dir: norm(l.dir) })) };
function norm(v) { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); }
const renders = spec.cameras.map((cs, i) => {
  const cam = makeCam(cs);
  const r = rasterize(tris, cam, env);
  return { cam, ...r, thumb: downsample(r.idx) };
});

// package
const { bytes: cn, bkgdCno } = build3cn(spec, renders, socpal);
const th = build3th(spec, renders, bkgdCno);
const cfg = new TextEncoder().encode(
  `Name=${spec.name}\nAuthor=${spec.author ?? '3dmm-web scene-gen'}\nType=Portable\nContent=Backgrounds\nGenerator=tools/scene-gen\n`);
const zip = vxp({ [`${spec.fileName}.3cn`]: cn, [`${spec.fileName}.3th`]: th, [`${spec.fileName}.cfg`]: cfg });

const outVxp = path.join(root, 'public/expansions', `${spec.fileName}.vxp`);
fs.writeFileSync(outVxp, zip);
const outDir = path.join(root, 'tools/scene-gen/out', spec.fileName);
fs.mkdirSync(outDir, { recursive: true });
renders.forEach((r, i) => {
  fs.writeFileSync(path.join(outDir, `cam${i}.png`), png(W, H, r.rgb));
  fs.writeFileSync(path.join(outDir, `cam${i}.z.png`), png(W, H, zToRgb(r.z)));
  fs.writeFileSync(path.join(outDir, `thumb${i}.png`), png(THUMB_W, THUMB_H, thumbRgb(r.thumb, pal)));
});
function thumbRgb(idx, pal) {
  const rgb = new Uint8Array(idx.length * 3);
  for (let i = 0; i < idx.length; i++) { const p = pal[idx[i] < 0 ? 0 : idx[i]]; rgb.set(p, i * 3); }
  return rgb;
}
console.log(`wrote ${outVxp} (${(zip.length / 1024).toFixed(0)} KB) — BKGD cno ${bkgdCno}, ${spec.cameras.length} cameras`);
console.log(`previews: ${outDir}`);
console.log(`load with: ?vxp=expansions/${spec.fileName}.vxp`);
