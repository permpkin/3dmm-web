// Geometry authoring for actor specs — reuses the prop-gen primitive kit, but
// parts are bound to skeleton bones and authored in WORLD space (actor at
// rest, facing +z, ground y=0). lib.mjs bakes each part into bone-local space
// before encoding the BMDL, so every piece rides the stock animations.
export * from '../prop-gen/geo.mjs';

const xf = (p, m) => [p[0] * m[0] + p[1] * m[3] + p[2] * m[6] + m[9],
  p[0] * m[1] + p[1] * m[4] + p[2] * m[7] + m[10],
  p[0] * m[2] + p[1] * m[5] + p[2] * m[8] + m[11]];

/** Per-actor authoring surface handed to spec.build(): bone-bound parts plus
 *  rest-pose measurements of the stock rig for proportioning. */
export class Body {
  constructor(rig) {
    this.rig = rig;
    this.map = new Map(); // part index -> {i,name,verts,faces,smooth,uvs,uv}
  }
  /** Mesh accumulator for a bone (name or index). uv: 'face'|'front'|'wrap'|
   *  fn(x,y,z)->[u,v] — projection mode applied when a material asks for a
   *  texture; p.uvs may also be assigned directly ([u,v] per vert). */
  part(bone, opts = {}) {
    const i = this.rig.boneIx(bone);
    if (!this.map.has(i))
      this.map.set(i, { i, name: this.rig.parts[i].name, verts: [], faces: [], smooth: [], uvs: null, uv: null });
    const p = this.map.get(i);
    if (opts.uv !== undefined) p.uv = opts.uv;
    return p;
  }
  /** World-space joint position of a bone at rest. */
  joint(bone) { return this.rig.parts[this.rig.boneIx(bone)].joint; }
  /** World-space bounding box {mn,mx} of the stock mesh on a bone at rest —
   *  use it to size replacement geometry to stock proportions. */
  bbox(bone) { return this.rig.parts[this.rig.boneIx(bone)].bbox; }
  /** Center of the stock bbox. */
  mid(bone) { const { mn, mx } = this.bbox(bone); return mn.map((v, k) => (v + mx[k]) / 2); }
  /** [w,h,d] of the stock bbox. */
  size(bone) { const { mn, mx } = this.bbox(bone); return mx.map((v, k) => v - mn[k]); }
  /** Segment from a bone's joint to its first child's joint (for limb spans).
   *  Leaf bones fall back to the joint->bbox-far-end vector. */
  seg(bone) {
    const i = this.rig.boneIx(bone);
    const kid = this.rig.parts.find((p) => p.parent === i);
    const a = this.rig.parts[i].joint;
    return { a, b: kid ? kid.joint : [a[0] + (this.bbox(bone).mx[0] + this.bbox(bone).mn[0]) / 2 - a[0],
      this.bbox(bone).mn[1], a[2]] };
  }
}

/** Cylinder/cone limb between two points — a->b axis, radii r0 (at a) / r1
 *  (at b, default r0). Welded sides + flat caps. Use `rig.seg(bone)` or
 *  explicit joints for limb spans. */
export function limb(p, a, b, r, n = 10, o = {}) {
  const r0 = o.r0 ?? r, r1 = o.r1 ?? r;
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const len = Math.hypot(...d) || 1e-6;
  const y2 = d.map((v) => v / len);
  let x2 = [0, -y2[2], y2[1]]; // any vector ⊥ y2
  if (!Math.hypot(...x2)) x2 = [1, 0, 0];
  const lx = Math.hypot(...x2); x2 = x2.map((v) => v / lx);
  const z2 = [y2[1] * x2[2] - y2[2] * x2[1], y2[2] * x2[0] - y2[0] * x2[2], y2[0] * x2[1] - y2[1] * x2[0]];
  const ring = (c, rr) => Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2, co = Math.cos(t) * rr, si = Math.sin(t) * rr;
    return [c[0] + x2[0] * co + z2[0] * si, c[1] + x2[1] * co + z2[1] * si, c[2] + x2[2] * co + z2[2] * si];
  });
  const ra = ring(a, r0), rb = ring(b, r1);
  const side = [];
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; side.push([i, j, n + j], [i, n + j, n + i]); }
  emitAll(p, [...ra, ...rb], side, { weld: true, sm: 1 });
  if (o.cap === false) return;
  const cap = (c, rg, flip) => {
    const vs = [c, ...rg], f = [];
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; f.push(flip ? [0, j + 1, i + 1] : [0, i + 1, j + 1]); }
    emitAll(p, vs, f);
  };
  cap(a, ra, true);
  cap(b, rb, false);
}
// emit() is module-private in prop-gen — local equivalent
function emitAll(p, verts, faces, { weld = false, sm = 0 } = {}) {
  const remap = new Array(verts.length);
  const seen = weld ? new Map() : null;
  verts.forEach((v, i) => {
    if (seen) {
      const k = `${v[0].toFixed(4)},${v[1].toFixed(4)},${v[2].toFixed(4)}`;
      if (seen.has(k)) { remap[i] = seen.get(k); return; }
      seen.set(k, p.verts.length);
    }
    remap[i] = p.verts.length;
    p.verts.push(v);
  });
  for (const [a, b, c] of faces) { p.faces.push([remap[a], remap[b], remap[c]]); p.smooth.push(sm); }
}

// uvFront + projectUV live in prop-gen/geo.mjs (re-exported via the star above).

/** Bake a world-space authored part into bone-local space (inverse rest
 *  world matrix). Returns a fresh part — the accumulator stays untouched. */
export function bake(p, inv) {
  return { ...p, verts: p.verts.map((v) => xf(v, inv)) };
}
