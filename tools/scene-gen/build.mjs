// Build a scene spec into a .vxp expansion in public/expansions/.
//   npx vite-node tools/scene-gen/build.mjs tools/scene-gen/specs/scenes/<name>.mjs
// The spec default-exports: {name, fileName, cnoBase, indexBase, palette,
// sky, lights, cameras[], worldScale?, build(tris, geo)} — see specs/scenes/western.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as geo from './geo.mjs';
import { W, H, THUMB_W, THUMB_H, rasterize, downsample, makeCam, build3cn, build3th, png, zToRgb, vxp, effectivePalette, expandPalette, shadowMap, medianCut, quantize } from './lib.mjs';

const specPath = path.resolve(process.argv[2] || 'tools/scene-gen/specs/scenes/western.mjs');
const spec = (await import(pathToFileUrl(specPath))).default;
spec.indexBase ??= 157;
spec.cnoBase ??= 700000 + (hash(spec.fileName || spec.name) % 200) * 1000;

function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
function pathToFileUrl(p) { return 'file://' + path.resolve(p); }

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const socpal = new Uint8Array(fs.readFileSync(path.join(root, 'public/local/socpal.pal')));

// geometry — worldScale shrinks/grows the whole set so spec authors can
// model at convenient sizes (actors stand ~40-60 units; a room's ceiling at
// ~50 reads like the stock diorama interiors)
const tris = [];
spec.build(tris, geo);
const ws = spec.worldScale ?? 1;
if (ws !== 1) {
  // replace verts, never mutate in place — primitives share vertex arrays
  // across triangles (fans/strips), so *= would scale shared refs repeatedly
  for (const t of tris) t.v = t.v.map((v) => v.map((x) => x * ws));
  for (const cs of spec.cameras) { cs.pos = cs.pos.map((x) => x * ws); cs.look = cs.look.map((x) => x * ws); }
}
console.log(`${spec.name}: ${tris.length} tris, cnoBase ${spec.cnoBase}`);

function norm(v) { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); }
const lights = spec.lights.map((l) => ({ ...l, dir: norm(l.dir) }));

// render true-color + depth; orthographic shadow map from the sun (lights[0])
const env = {
  sky: spec.sky, skyFn: spec.skyFn, ambSky: spec.ambSky, ambGnd: spec.ambGnd,
  bumpScale: spec.bumpScale, specI: spec.specI, shadowBias: spec.shadowBias,
  shadowOpacity: spec.shadowOpacity, shadowSoft: spec.shadowSoft, ss: spec.ss ?? 2, lights,
  shadow: spec.noShadow ? null : shadowMap(tris, lights[0].dir, { size: spec.shadowSize ?? 1024 }),
};
console.log('rendering...');
const shots = spec.cameras.map((cs) => ({ cam: makeCam(cs), ...rasterize(tris, makeCam(cs), env) }));

// palette: declared colors first, median-cut fills the rest of the overlay
const declared = expandPalette(spec);
const slots = 256 - spec.indexBase;
if (declared.length > slots) throw new Error(`palette ${declared.length} > ${slots} slots at indexBase ${spec.indexBase}`);
const cut = medianCut(shots.map((s) => s.rgb), slots - declared.length);
const overlay = declared.concat(cut);
const pal = effectivePalette(socpal, overlay, spec.indexBase);
console.log(`palette: ${declared.length} declared + ${cut.length} median-cut @${spec.indexBase}`);

// quantize to palette indices (ordered dither), then build previews from the
// final indices so PNGs show exactly what the app will display
const renders = shots.map((s) => {
  const idx = quantize(s.rgb, W, H, pal, { dither: spec.dither ?? 16 });
  const rgb = new Uint8Array(W * H * 3);
  for (let i = 0; i < idx.length; i++) rgb.set(pal[idx[i]], i * 3);
  return { cam: s.cam, z: s.z, idx, rgb, thumb: downsample(idx) };
});

// package
const { bytes: cn, bkgdCno } = build3cn(spec, renders, socpal, overlay);
const th = build3th(spec, renders, bkgdCno);
const cfg = new TextEncoder().encode(
  `extInfo = "${spec.name}"\nDesc = "${spec.desc ?? ''}"\nVersion = ${spec.ver ?? '1.0'}\nAuthor = ${spec.author ?? '3dmm-web scene-gen'}\nType = Portable\nContent = Backgrounds\nGenerator = tools/scene-gen\n`);
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
