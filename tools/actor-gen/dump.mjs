// Print a base rig's bone table — joints, stock mesh bounds, sets — for
// authoring specs.   npx vite-node tools/actor-gen/dump.mjs [name|cno]
import { loadRig } from './rig.mjs';

const rig = await loadRig(process.argv[2] || 'Zack');
const f = (v) => v.map((x) => x.toFixed(1)).join(',');
console.log(`${rig.name} (cno ${rig.cno}) — rest yaw ${rig.rest[1].toFixed(2)}, ${rig.actns.length} actions, sets:`,
  Object.entries(rig.sets).map(([k, v]) => `${k}=${v}`).join(' '));
console.log('bone            par  ibset  joint (x,y,z)        stock mesh bbox');
for (const p of rig.parts)
  console.log(`${p.name.padEnd(15)} ${String(p.parent).padStart(4)}  ${p.ibset}    (${f(p.joint)})   x[${f([p.bbox.mn[0], p.bbox.mx[0]])}] y[${f([p.bbox.mn[1], p.bbox.mx[1]])}] z[${f([p.bbox.mn[2], p.bbox.mx[2]])}]`);
console.log('model chids:', rig.bmdlChids.join(','));
console.log('alt models:', [...rig.modelOwner.entries()].filter(([c, i]) => c !== i).map(([c, i]) => `${c}->${rig.parts[i].name}`).join('  ') || 'none');
console.log('actions:', rig.actns.map((a) => `${a.anid}:${a.name}`).join('  '));
