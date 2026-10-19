// Procedural geometry kit for prop specs — primitives emit indexed meshes
// into "parts" (one material each): {ramp, verts:[[x,y,z]], faces:[[a,b,c]],
// smooth:[u16]}. Prop space is y-up, ground at y=0, front toward +z.
// lib.mjs turns parts into BMDL chunks; vertex welding (smooth:true) is the
// only shading control — the renderer ignores BMDL smoothing groups and
// averages normals across shared indices instead.
import * as M from '../../src/engine/mat34.js';

// Material palette ramps — socpal index bases (8 shades each, indexRange 7).
// These are the ONLY actor-safe palette bands (15-150); a material's color is
// wholly decided by which ramp it shades through.
export const R = {
  GRAY: 15,    // charcoal -> mid gray
  SILVER: 23,  // light grays -> near white
  NAVY: 31,    // dark navy -> violet blue
  PERI: 39,    // periwinkle / lavender blue
  BROWN: 47,   // dark wood -> warm brown
  TAN: 55,     // tan -> light wood
  RED: 63,     // dark red -> bright red
  STEEL: 71,   // dark slate -> steel blue
  MAROON: 79,  // maroon -> pink
  ORANGE: 87,  // dark orange -> orange
  PURPLE: 95,  // dark purple -> purple
  GOLD: 103,   // bronze -> gold yellow
  OLIVE: 111,  // dark olive -> yellow olive
  COCOA: 119,  // dark cocoa -> dusty rose
  GREEN: 127,  // forest -> green
  ROSE: 135,   // dark rose -> rosy pink
  TEAL: 143,   // dark teal -> sea green
};

/** Start a part — one material (palette ramp, optional TMAP texture).
 *  Returns the mesh to fill. Options: `tex` = {w,h,px} indexed texture
 *  (tex.mjs), `uv` = projection mode for projectUV ('face'|'front'|'wrap'|
 *  fn), `uvScale` = world units per texture tile (0 = stretch one tile over
 *  the part). `uvs` (explicit [u,v] per vert) rides alongside verts through
 *  welding. */
export const part = (ramp, o = {}) =>
  ({ ramp, tex: o.tex ?? null, uv: o.uv ?? null, uvScale: o.uvScale ?? 0, txxf: o.txxf ?? null,
    verts: [], faces: [], smooth: [], uvs: null });

// Euler X->Y->Z rotation matrix for the {rx,ry,rz} options below.
const rot = (o) => M.mul(M.mul(M.rotX(o.rx || 0), M.rotY(o.ry || 0)), M.rotZ(o.rz || 0));
const xf = (p, m, t) => [
  p[0] * m[0] + p[1] * m[3] + p[2] * m[6] + t[0],
  p[0] * m[1] + p[1] * m[4] + p[2] * m[7] + t[1],
  p[0] * m[2] + p[1] * m[5] + p[2] * m[8] + t[2]];

/** Append verts/faces to a part; `weld` merges coincident verts (smooth
 *  shading inside this primitive only), `sm` is the BMDL smoothing group.
 *  `uvs` is an optional [u,v]-per-source-vert map — merged verts keep the
 *  first vert's uv. Returns the source->part index remap. */
function emit(p, verts, faces, { weld = false, sm = 0, uvs = null } = {}) {
  const remap = new Array(verts.length);
  const seen = weld ? new Map() : null;
  if (uvs && !p.uvs) p.uvs = new Array(p.verts.length).fill(null);
  verts.forEach((v, i) => {
    if (seen) {
      const k = `${v[0].toFixed(4)},${v[1].toFixed(4)},${v[2].toFixed(4)}`;
      if (seen.has(k)) { remap[i] = seen.get(k); return; }
      seen.set(k, p.verts.length);
    }
    remap[i] = p.verts.length;
    p.verts.push(v);
    if (p.uvs) p.uvs.push(uvs ? uvs[i] : null);
  });
  for (const [a, b, c] of faces) { p.faces.push([remap[a], remap[b], remap[c]]); p.smooth.push(sm); }
  return remap;
}

const quadTris = (n) => { // n quads -> 2n tris over local vert ids
  const f = [];
  for (let i = 0; i < n; i++) { const b = i * 4; f.push([b, b + 1, b + 2], [b, b + 2, b + 3]); }
  return f;
};

/** Axis box centered at (cx,cy,cz), size w*h*d. {rx,ry,rz} rotates first. */
export function box(p, cx, cy, cz, w, h, d, o = {}) {
  const m = rot(o), x = w / 2, y = h / 2, z = d / 2, T = [cx, cy, cz];
  const vs = [[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z],
    [x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z],
    [x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z],
    [-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z],
    [-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z],
    [-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]];
  emit(p, vs.map((v) => xf(v, m, T)), quadTris(6));
}

/** Vertical cylinder/cone frustum centered at (cx,cy,cz): bottom radius r0
 *  (default r), top radius r1 (default r), height h, n sides. {cap:false}
 *  leaves it open; sides are welded smooth, caps flat. */
export function cyl(p, cx, cy, cz, r, h, n = 12, o = {}) {
  const m = rot(o), T = [cx, cy, cz];
  const r0 = o.r0 ?? r, r1 = o.r1 ?? r, y0 = -h / 2, y1 = h / 2;
  const ring = (y, rr) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return xf([Math.cos(a) * rr, y, Math.sin(a) * rr], m, T);
  });
  const b = ring(y0, r0), t = ring(y1, r1);
  const side = [];
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; side.push([i, j, n + j], [i, n + j, n + i]); }
  emit(p, [...b, ...t], side, { weld: true, sm: 1 });
  if (o.cap === false) return;
  const cap = (c, ring2, flip) => {
    const vs = [xf([0, c, 0], m, T), ...ring2], f = [];
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; f.push(flip ? [0, j + 1, i + 1] : [0, i + 1, j + 1]); }
    emit(p, vs, f);
  };
  cap(y0, b, true);   // bottom (faces down)
  cap(y1, t, false);  // top
}

/** Cone/pyramid: base radius r at cy-h/2, apex at cy+h/2. Smooth sides. */
export function cone(p, cx, cy, cz, r, h, n = 12, o = {}) {
  const m = rot(o), T = [cx, cy, cz];
  const apex = xf([0, h / 2, 0], m, T), c0 = xf([0, -h / 2, 0], m, T);
  const b = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return xf([Math.cos(a) * r, -h / 2, Math.sin(a) * r], m, T);
  });
  const side = [];
  for (let i = 0; i < n; i++) side.push([i + 1, ((i + 1) % n) + 1, 0]);
  emit(p, [apex, ...b], side, { weld: true, sm: 1 });
  const base = [];
  for (let i = 0; i < n; i++) base.push([0, ((i + 1) % n) + 1, i + 1]);
  emit(p, [c0, ...b], base);
}

/** UV sphere centered at (cx,cy,cz), radius r, n longitudes, m latitudes. */
export function sphere(p, cx, cy, cz, r, o = {}) {
  const n = o.n || 12, m = o.m || 6, mm = rot(o), T = [cx, cy, cz];
  const vs = [];
  for (let j = 0; j <= m; j++) {
    const ph = (j / m) * Math.PI;
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2;
      vs.push(xf([Math.sin(ph) * Math.cos(th) * r, Math.cos(ph) * r, Math.sin(ph) * Math.sin(th) * r], mm, T));
    }
  }
  const f = [];
  for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
    const a = j * n + i, b = j * n + ((i + 1) % n), c = a + n, d = b + n;
    if (j) f.push([a, c, b]);
    if (j < m - 1) f.push([b, c, d]);
  }
  emit(p, vs, f, { weld: true, sm: 1 });
}

/** Tapered box: bottom w0*d0 at cy-h/2, top w1*d1 at cy+h/2. Flat faces. */
export function frustum(p, cx, cy, cz, w0, d0, w1, d1, h, o = {}) {
  const m = rot(o), T = [cx, cy, cz], y0 = -h / 2, y1 = h / 2;
  const P = (px, py, pz) => xf([px, py, pz], m, T);
  const b = [P(-w0 / 2, y0, d0 / 2), P(w0 / 2, y0, d0 / 2), P(w0 / 2, y0, -d0 / 2), P(-w0 / 2, y0, -d0 / 2)];
  const t = [P(-w1 / 2, y1, d1 / 2), P(w1 / 2, y1, d1 / 2), P(w1 / 2, y1, -d1 / 2), P(-w1 / 2, y1, -d1 / 2)];
  const vs = [], f = [];
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; vs.push(b[i], b[j], t[j], t[i]); }
  vs.push(t[0], t[1], t[2], t[3]);
  vs.push(b[3], b[2], b[1], b[0]);
  emit(p, vs, quadTris(6));
}

/** Arbitrary quad (four points, two triangles). Flat, unwelded. */
export function quad(p, p0, p1, p2, p3) {
  emit(p, [p0, p1, p2, p3], [[0, 1, 2], [0, 2, 3]]);
}

/** Merge part `src`'s geometry into `dst` (keeps dst's material). */
export function merge(dst, src) {
  const base = dst.verts.length;
  for (const v of src.verts) dst.verts.push(v);
  src.faces.forEach((f, i) => { dst.faces.push([f[0] + base, f[1] + base, f[2] + base]); dst.smooth.push(src.smooth[i]); });
  if (src.uvs) {
    if (!dst.uvs) dst.uvs = new Array(dst.verts.length - src.verts.length).fill(null);
    for (const u of src.uvs) dst.uvs.push(u);
  }
}

// ---- polygon / vertex-map primitives -------------------------------------
// For advanced models: feed raw vertex + polygon lists, or build them with
// the generators below. Faces may be tris, quads, or ngons — quads split on
// the shorter diagonal, ngons fan. All accept {rx,ry,rz,pos,scale,flip,weld,sm,uvs}.

const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** Append an arbitrary polygon mesh to a part. `verts`: [[x,y,z]..],
 *  `faces`: index lists — tris/quads/ngons (CCW seen from outside).
 *  Options: {rx,ry,rz} euler rotate, pos translate, scale uniform,
 *  flip winding, weld + sm shading, uvs ([u,v] per vert). */
export function mesh(p, verts, faces, o = {}) {
  const m = rot(o), T = o.pos || [0, 0, 0], s = o.scale ?? 1;
  const vs = verts.map((v) => xf([v[0] * s, v[1] * s, v[2] * s], m, T));
  const tris = [];
  for (const f of faces) {
    const idx = o.flip ? [...f].reverse() : f;
    if (idx.length === 3) { tris.push([idx[0], idx[1], idx[2]]); continue; }
    if (idx.length === 4) { // split the shorter diagonal
      const [a, b, c, d] = idx;
      if (d2(vs[a], vs[c]) <= d2(vs[b], vs[d])) tris.push([a, b, c], [a, c, d]);
      else tris.push([a, b, d], [b, c, d]);
      continue;
    }
    for (let i = 1; i + 1 < idx.length; i++) tris.push([idx[0], idx[i], idx[i + 1]]);
  }
  emit(p, vs, tris, { weld: o.weld, sm: o.sm ?? 0, uvs: o.uvs || null });
}

/**
 * Vertex-map builder — accumulates named verts + polygon faces, then feeds
 * `mesh()`. For hand-authored or generated model data:
 *   const m = vmap(); const a = m.v(0,0,0); ...; m.f(a,b,c,d); m.into(part, o)
 */
export function vmap() {
  return {
    verts: [], faces: [], uvs: [],
    v(x, y, z, uv = null) { this.verts.push([x, y, z]); this.uvs.push(uv); return this.verts.length - 1; },
    f(...idx) { this.faces.push(idx); return this; },
    quad(a, b, c, d) { this.faces.push([a, b, c, d]); return this; },
    into(p, o = {}) {
      const uvs = this.uvs.some((u) => u) ? this.uvs : null;
      mesh(p, this.verts, this.faces, { ...o, uvs: o.uvs || uvs });
    },
  };
}

/** Lathe a [[r,y],...] profile about the local Y axis into a part —
 *  barrels, columns, lamps, vases. r≈0 rows become poles via weld. */
export function lathe(p, cx, cy, cz, profile, n = 12, o = {}) {
  const m = rot(o), T = [cx, cy, cz];
  const vs = [], uv = [];
  for (const [r, y] of profile)
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      vs.push(xf([Math.cos(a) * r, y, Math.sin(a) * r], m, T));
      uv.push([i / n, y]);
    }
  const f = [];
  for (let j = 0; j + 1 < profile.length; j++)
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n, a = j * n + i, b = j * n + i2;
      f.push([a, b, b + n], [a, b + n, a + n]);
    }
  emit(p, vs, f, { weld: true, sm: o.sm ?? 1, uvs: o.uv ? uv : null });
}

/** Extrude a CCW 2D outline (local XY) along local Z by `depth` —
 *  flat-packed parts, ornate silhouettes, arches, brackets. */
export function extrude(p, cx, cy, cz, outline, depth, o = {}) {
  const m = rot(o), T = [cx, cy, cz], z0 = -depth / 2, z1 = depth / 2;
  const n = outline.length;
  const cen = outline.reduce((a, q) => [a[0] + q[0] / n, a[1] + q[1] / n], [0, 0]);
  const vs = [];
  for (const z of [z0, z1]) {
    vs.push(xf([cen[0], cen[1], z], m, T));
    for (const q of outline) vs.push(xf([q[0], q[1], z], m, T));
  }
  const f = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    f.push([0, j + 1, i + 1]);                       // back face (-z)
    f.push([n + 1, n + 2 + i, n + 2 + j]);           // front face (+z)
    f.push([i + 1, j + 1, n + 2 + j], [i + 1, n + 2 + j, n + 2 + i]); // side wall
  }
  emit(p, vs, f, { sm: o.sm ?? 0, uvs: o.uvs || null });
}

/** Swept circular tube along a polyline — rails, ropes, handles, rims.
 *  `{closed:true}` joins last point back to first (torus-like loops). */
export function tube(p, pts, r, n = 8, o = {}) {
  const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return v.map((x) => x / l); };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const crossv = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const rings = pts.length;
  const vs = [];
  for (let i = 0; i < rings; i++) {
    const pPrev = pts[Math.max(0, i - 1)], pNext = pts[Math.min(rings - 1, i + 1)];
    const t = norm3(sub(pNext, pPrev));
    let u = Math.abs(t[1]) > 0.94 ? [1, 0, 0] : [0, 1, 0];
    const b = norm3(crossv(t, u)); u = crossv(b, t);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      vs.push([pts[i][0] + (u[0] * Math.cos(a) + b[0] * Math.sin(a)) * r,
        pts[i][1] + (u[1] * Math.cos(a) + b[1] * Math.sin(a)) * r,
        pts[i][2] + (u[2] * Math.cos(a) + b[2] * Math.sin(a)) * r]);
    }
  }
  const f = [];
  const segs = o.closed ? rings : rings - 1;
  for (let s = 0; s < segs; s++) {
    const r0 = s % rings, r1 = (s + 1) % rings;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      f.push([r0 * n + i, r0 * n + j, r1 * n + j], [r0 * n + i, r1 * n + j, r1 * n + i]);
    }
  }
  emit(p, vs, f, { weld: o.closed, sm: o.sm ?? 1 });
}

/** Loft between equal-length point rings — hulls, fuselages, ducts.
 *  `rings`: [[[x,y,z]..k], ...]; {closed:true} wraps the section ring. */
export function loft(p, rings, o = {}) {
  const k = rings[0].length;
  const vs = rings.flat();
  const f = [];
  for (let s = 0; s + 1 < rings.length; s++)
    for (let i = 0; i < k; i++) {
      const j = (i + 1) % k;
      f.push([s * k + i, s * k + j, (s + 1) * k + j], [s * k + i, (s + 1) * k + j, (s + 1) * k + i]);
    }
  emit(p, vs, f, { weld: true, sm: o.sm ?? 1 });
  if (o.caps === false) return;
  // cap ends with fans
  for (const [ri, flip] of [[0, true], [rings.length - 1, false]]) {
    const c = rings[ri].reduce((a, q) => [a[0] + q[0] / k, a[1] + q[1] / k, a[2] + q[2] / k], [0, 0, 0]);
    const cf = [];
    for (let i = 0; i < k; i++) {
      const j = (i + 1) % k;
      cf.push(flip ? [0, j + 1, i + 1] : [0, i + 1, j + 1]);
    }
    emit(p, [c, ...rings[ri]], cf, { sm: o.sm ?? 1 });
  }
}

/** Displaced grid — cloth, flags, terrain sheets, curved panels.
 *  fn(i,j) -> [x,y,z]; nx×ny cells, quads split flat or {weld} smooth. */
export function grid(p, nx, ny, fn, o = {}) {
  const vs = [], f = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) vs.push(fn(i, j));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    f.push([a, b, d], [a, d, c]);
  }
  emit(p, vs, f, { weld: o.weld ?? false, sm: o.sm ?? 0 });
}

/** Arch outline (width w, shoulder h, rise a) for extrude() — CCW loop. */
export const archOutline = (w, h, a, n = 8) => {
  const pts = [[-w / 2, 0], [w / 2, 0], [w / 2, h]];
  for (let i = 1; i <= n; i++) {
    const t = (i / n) * Math.PI;
    pts.push([Math.cos(t) * w / 2, h + Math.sin(t) * a]);
  }
  return pts;
};

// ---- UV projection ------------------------------------------------------------
// Textured parts need uvs; assign p.uvs directly or pick a projector. TMAP v=0
// is the texture's top row, so projectors emit v top-down (v=0 at max extent).

/** Planar UV projector over a fixed box (u = x→[0,w], v = y→[0,h] top-down).
 *  Assign as `part.uv = uvFront([minx,miny,minz],[w,h,d])` — handy when a part
 *  carries protrusions that would skew the part-bbox projections. */
export const uvFront = (mn, size) => (x, y) => [(x - mn[0]) / size[0], 1 - (y - mn[1]) / size[1]];

/** Fill each part's `uvs` for textured materials. Modes:
 *  'front' — planar projection on +z (u = x, v down y), good for face decals;
 *  'wrap'  — cylindrical around the part's vertical axis;
 *  'face'  — per-face dominant-axis decal over the part's bbox (verts split);
 *  'tile'  — like 'face' but world-unit tiled (needs `scale`);
 *  fn(x,y,z) — custom projector.
 *  `scale` > 0 divides coordinates by it (texture tile every `scale` world
 *  units) instead of normalizing to the part's bbox. */
export function projectUV(p, mode, scale = 0) {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (const v of p.verts) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], v[k]); mx[k] = Math.max(mx[k], v[k]); }
  const span = mx.map((v, k) => Math.max(1e-6, v - mn[k]));
  const uOf = (v, k) => scale ? (v[k] - mn[k]) / scale : (v[k] - mn[k]) / span[k];
  const vOf = (v, k) => scale ? -(v[k] - mn[k]) / scale : 1 - (v[k] - mn[k]) / span[k];
  if (typeof mode === 'function') { p.uvs = p.verts.map((v) => mode(...v)); return; }
  if (mode === 'wrap') {
    const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2;
    p.uvs = p.verts.map((v) => [Math.atan2(v[0] - cx, v[2] - cz) / (2 * Math.PI) + 0.5, vOf(v, 1)]);
    return;
  }
  if (mode === 'front') { // u left->right, v top->bottom (v=0 is texture row 0)
    p.uvs = p.verts.map((v) => [uOf(v, 0), vOf(v, 1)]);
    return;
  }
  // 'face'/'tile' — split verts per face, project onto its dominant plane.
  const verts = [], faces = [], smooth = [], uvs = [];
  p.faces.forEach((f, fi) => {
    const [a, b, c] = f.map((i) => p.verts[i]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]].map(Math.abs);
    const ax = n[0] >= n[1] && n[0] >= n[2] ? 0 : n[1] >= n[2] ? 1 : 2;
    const [s, t] = ax === 0 ? [1, 2] : ax === 1 ? [0, 2] : [0, 1];
    const base = verts.length;
    for (const i of f) {
      const v = p.verts[i];
      verts.push(v);
      uvs.push([uOf(v, s), vOf(v, t)]);
    }
    faces.push([base, base + 1, base + 2]);
    smooth.push(p.smooth[fi]);
  });
  p.verts = verts; p.faces = faces; p.smooth = smooth; p.uvs = uvs;
}
