// Base-rig extraction — fetches builtin TMPLS.3CN once (cached under
// out/_cache/), then pulls a stock humanoid's skeleton, rest pose, and raw
// ACTN subtrees so generated actors inherit the full stock animation set.
//
// A "rig" is the immutable part of a base template:
//   { cf, cno, name, rest, parents[], ibsets[], cbset,
//     parts[i]: {i, name, parent, ibset, joint, bbox:{mn,mx}, world, inv},
//     boneIx(name|i), sets{name->ibset},
//     bmdlChids[], modelOwner: Map(chidModl -> part i),
//     actns[{anid, name, data, ggcl, glxf}]  (raw chunk bodies, copy verbatim) }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChunkyFile } from '../../src/format/chunky.js';
import { parseTemplate, templateAction, templateModel } from '../../src/format/content.js';
import { Actor } from '../../src/engine/actor.js';
import { AET } from '../../src/format/movie.js';
import { invert34 } from '../scene-gen/lib.mjs';

const UPSTREAM = 'https://raw.githubusercontent.com/microsoft/Microsoft-3D-Movie-Maker/104b2653e68046c2f6373186169f281006db35b1/cd3/3DMOVIE/';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = path.join(root, 'tools/actor-gen/out/_cache');

/** Semantic bone/set names per supported base template (keyed by cno).
 *  Zack's skeleton: head is its own root, torso is split front/back shells,
 *  legs are pelvis-parallel pieces, shoes are roots. ibsets: skin=0 (head +
 *  forearms/hands), shirt=1 (torso shells + arms + shoulder caps),
 *  pants=2 (pelvis + thigh/shin pieces), shoes=3 (ankle cuffs + shoes). */
const RIGS = {
  8249: { // Zack — 18 parts, 4 ibsets, 33 actions, 25 model chids
    bones: ['head', 'torso', 'back', 'upperArmL', 'forearmL', 'shoulderL',
      'upperArmR', 'forearmR', 'shoulderR', 'pelvis',
      'shinR', 'ankleR', 'thighR', 'shinL', 'ankleL', 'thighL', 'shoeR', 'shoeL'],
    sets: { skin: 0, shirt: 1, pants: 2, shoes: 3 },
  },
};

/** Fetch + cache TMPLS.3CN, return a ChunkyFile. */
export async function tmplsFile() {
  fs.mkdirSync(CACHE, { recursive: true });
  const f = path.join(CACHE, 'TMPLS.3CN');
  if (!fs.existsSync(f)) {
    console.log('fetching TMPLS.3CN (~32 MB, cached to ' + path.relative(root, f) + ')');
    fs.writeFileSync(f, Buffer.from(await (await fetch(UPSTREAM + 'TMPLS.3CN')).arrayBuffer()));
  }
  return new ChunkyFile(new Uint8Array(fs.readFileSync(f)), 'TMPLS.3CN');
}

const xf = (p, m) => [p[0] * m[0] + p[1] * m[3] + p[2] * m[6] + m[9],
  p[0] * m[1] + p[1] * m[4] + p[2] * m[7] + m[10],
  p[0] * m[2] + p[1] * m[5] + p[2] * m[8] + m[11]];

/**
 * Load a base humanoid template into a rig descriptor.
 * `base` is a template name ('Zack') or a TMPL cno (8249). The base must be a
 * plain actor (not a prop, not 3D text); unknown bones get 'partN' names and
 * ibsets 'setN' unless the cno has a RIGS entry.
 */
export async function loadRig(base = 'Zack') {
  const cf = await tmplsFile();
  let cno = typeof base === 'number' ? base : undefined;
  if (cno === undefined) {
    const hit = cf.ofType('TMPL').find((c) => cf.get('TMPL', c.cno).name === base);
    if (!hit) throw new Error(`no template named ${JSON.stringify(base)} in TMPLS.3CN`);
    cno = hit.cno;
  }
  const t = parseTemplate(cf, cno);
  if (t.isProp || t.isTdt) throw new Error(`${t.name} is not a plain actor template`);
  const n = t.parents.length;

  // Rest pose — run a headless actor through Add + Actn anid 0 and read the
  // part world matrices. These frames are the bake basis: geometry authored
  // in world space lands in part-local space via each part's inverse.
  const data = { cno: 0, arid: 0, nfrmFirst: 0, nfrmLast: 999, name: t.name,
    dxyzFullRte: { x: 0, y: 0, z: 0 }, tagTmpl: { sid: 2, ctg: 'TMPL', cno },
    route: [{ x: 0, y: 0, z: 0, dwr: 0 }],
    events: [
      { aet: AET.Add, nfrm: 0, rtel: { irpt: 0, dwrOffset: 0, dnfrm: 0 }, data: { x: 0, y: 0, z: 0, xa: 0, ya: 0, za: 0 } },
      { aet: AET.Actn, nfrm: 0, rtel: { irpt: 0, dwrOffset: 0, dnfrm: 0 }, data: { anid: 0, celn: 0 } },
    ] };
  const actor = new Actor(data, t, { mtrl: () => null });
  actor.gotoFrame(2);
  const world = actor.partWorldMatrices();

  // Per-part stats at rest: joint position + base mesh bounds (world space).
  const cel0 = templateAction(t, 0).cels[0];
  const rigDef = RIGS[cno] || {};
  const parts = [];
  for (let i = 0; i < n; i++) {
    const chid = cel0.cps[i]?.chidModl ?? i;
    const mod = chid >= 0 ? templateModel(t, chid) : null;
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    if (mod) for (let v = 0; v < mod.positions.length; v += 3) {
      const p = xf([mod.positions[v], mod.positions[v + 1], mod.positions[v + 2]], world[i]);
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
    } else { mn.fill(0); mx.fill(0); }
    parts.push({ i, name: rigDef.bones?.[i] ?? `part${i}`, parent: t.parents[i], ibset: t.ibsets[i],
      joint: world[i].slice(9, 12), bbox: { mn, mx }, world: world[i], inv: invert34(world[i]) });
  }

  // Which part each BMDL chid belongs to — extra model chids are pose-swap
  // meshes referenced by cels (part i uses chidModl m); chid i = part i.
  const bmdlChids = cf.kidsOf('TMPL', cno, 'BMDL').map((k) => k.chid);
  const modelOwner = new Map();
  for (const i of parts.map((p) => p.i)) modelOwner.set(i, i);
  for (const k of cf.kidsOf('TMPL', cno, 'ACTN'))
    for (const cel of templateAction(t, k.chid).cels)
      cel.cps.forEach((cp, i) => { if (cp.chidModl >= 0 && !modelOwner.has(cp.chidModl)) modelOwner.set(cp.chidModl, i); });

  // Raw ACTN subtrees — copied verbatim into the pack (self-contained bytes).
  const actns = cf.kidsOf('TMPL', cno, 'ACTN').map((k) => {
    const ggcl = cf.kid('ACTN', k.cno, 'GGCL', 0), glxf = cf.kid('ACTN', k.cno, 'GLXF', 0);
    return { anid: k.chid, name: cf.get('ACTN', k.cno).name,
      data: cf.data('ACTN', k.cno), ggcl: cf.data('GGCL', ggcl.cno), glxf: cf.data('GLXF', glxf.cno) };
  });

  const sets = rigDef.sets || Object.fromEntries([...new Set(t.ibsets)].map((b) => [`set${b}`, b]));
  const rig = {
    cf, cno, name: t.name, rest: t.rest, parents: t.parents, ibsets: t.ibsets,
    cbset: t.cbset, parts, sets, bmdlChids, modelOwner, actns,
    boneIx(b) { const i = typeof b === 'number' ? b : parts.findIndex((p) => p.name === b);
      if (i < 0 || i >= n) throw new Error(`unknown bone ${JSON.stringify(b)} on base ${t.name}`); return i; },
    setIx(s) { const b = typeof s === 'number' ? s : sets[s];
      if (b === undefined || b < 0 || b >= t.cbset) throw new Error(`unknown set ${JSON.stringify(s)} on base ${t.name}`); return b; },
  };
  return rig;
}
