// Procedural geometry kit for scene specs — everything emits triangles
// {v:[[x,y,z]x3], uv:[[u,v]x3]|null, vn:[[x,y,z]x3]|null, c:[r,g,b], tex, two}
// in world space (y-up). `uv` is normalized texture coords; `vn` marks
// smooth-shaded tris (interpolated normals) vs flat faces.
// lib.mjs rasterizes them into the palette-indexed backdrops 3DMM wants.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.hypot(a[0], a[1], a[2]) || 1;
const norm = (a) => scl(a, 1 / len(a));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const V = { sub, add, scl, len, norm, cross, dot };

/** Rotate [x,y,z] about the Y axis by `a` radians. */
export const rotY = (p, a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
};
/** Rotate about the X axis. */
export const rotX = (p, a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
};
/** Rotate about the Z axis. */
export const rotZ = (p, a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
};
/** Euler-rotate [x,y,z] by [rx,ry,rz] (applied Z then X then Y). */
export const rot = (p, [rx, ry, rz]) => rotY(rotX(rotZ(p, rz || 0), rx || 0), ry || 0);

const tri = (v, uv, c, o) => ({ v, uv: uv || null, c, two: !!o.two, tex: o.tex || null, shine: o.shine || 0, unlit: !!o.unlit, vn: null });

/** Emit one quad (two triangles); uv auto-mapped from edge lengths / uvScale. */
export function quad(tris, p0, p1, p2, p3, c, o = {}) {
  const { tex = null, two = false, uvScale = 24, uv = null, shine = 0 } = o;
  let q = uv;
  if (tex && !q) {
    const su = len(sub(p1, p0)) / uvScale, sv = len(sub(p3, p0)) / uvScale;
    q = [[0, 0], [su, 0], [su, sv], [0, sv]];
  }
  tris.push(tri([p0, p1, p2], q && [q[0], q[1], q[2]], c, o),
    tri([p0, p2, p3], q && [q[0], q[2], q[3]], c, o));
}

/** Axis box centered at (cx, cy, cz) with size (w,h,d); `rot` euler first. */
export function box(tris, cx, cy, cz, w, h, d, c, o = {}) {
  const { rot: r = null, ry = 0, tex = null, uvScale = 24 } = o;
  const R = (p) => (r ? rot(p, r) : rotY(p, ry));
  const x = w / 2, y = h / 2, z = d / 2;
  const P = (px, py, pz) => add(R([px, py, pz]), [cx, cy, cz]);
  const face = (pa, pb, pc, pd, su, sv) =>
    quad(tris, pa, pb, pc, pd, c, { ...o, tex, uv: tex ? [[0, 0], [su, 0], [su, sv], [0, sv]] : null });
  face(P(-x, -y, z), P(x, -y, z), P(x, y, z), P(-x, y, z), w / uvScale, h / uvScale);   // +z
  face(P(x, -y, -z), P(-x, -y, -z), P(-x, y, -z), P(x, y, -z), w / uvScale, h / uvScale); // -z
  face(P(x, -y, z), P(x, -y, -z), P(x, y, -z), P(x, y, z), d / uvScale, h / uvScale);  // +x
  face(P(-x, -y, -z), P(-x, -y, z), P(-x, y, z), P(-x, y, -z), d / uvScale, h / uvScale); // -x
  face(P(-x, y, z), P(x, y, z), P(x, y, -z), P(-x, y, -z), w / uvScale, d / uvScale);  // top
  face(P(-x, -y, -z), P(x, -y, -z), P(x, -y, z), P(-x, -y, z), w / uvScale, d / uvScale); // bottom
}

/** Vertical cylinder/prism: radius r, height h, n sides, centered (cx,cy,cz). */
export function cyl(tris, cx, cy, cz, r, h, n, c, o = {}) {
  const { cap = true, tex = null, uvScale = 24, rx = 0, rz = 0 } = o;
  const R = (p) => add(rot(p, [rx, 0, rz]), [cx, cy, cz]);
  const y0 = -h / 2, y1 = h / 2;
  const ring = (y) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return R([Math.cos(a) * r, y, Math.sin(a) * r]);
  });
  const b = ring(y0), t = ring(y1);
  const su = (2 * Math.PI * r) / n / uvScale, sv = h / uvScale;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const uv = tex ? [[i * su, 0], [(i + 1) * su, 0], [(i + 1) * su, sv], [i * su, sv]] : null;
    tris.push(tri([b[i], b[j], t[j]], uv && [uv[0], uv[1], uv[2]], c, o),
      tri([b[i], t[j], t[i]], uv && [uv[0], uv[2], uv[3]], c, o));
    if (cap) {
      tris.push(tri([R([0, y1, 0]), t[i], t[j]], null, c, o));
      tris.push(tri([R([0, y0, 0]), b[j], b[i]], null, c, o));
    }
  }
}

/** Vertical cone/pyramid: base radius r at cy-h/2 to apex at cy+h/2. */
export function cone(tris, cx, cy, cz, r, h, n, c, o = {}) {
  const y0 = cy - h / 2, apex = [cx, cy + h / 2, cz];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const p0 = [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r];
    const p1 = [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r];
    tris.push(tri([p0, p1, apex], null, c, o));
    tris.push(tri([[cx, y0, cz], p1, p0], null, c, o));
  }
}

/** Tapered box (frustum): bottom w0×d0 at cy-h/2, top w1×d1 at cy+h/2 — mesas. */
export function frustum(tris, cx, cy, cz, w0, d0, w1, d1, h, c, o = {}) {
  const { ry = 0, tex = null, uvScale = 24 } = o;
  const P = (px, py, pz) => add(rotY([px, py, pz], ry), [cx, cy, cz]);
  const y0 = -h / 2, y1 = h / 2;
  const b = [P(-w0 / 2, y0, d0 / 2), P(w0 / 2, y0, d0 / 2), P(w0 / 2, y0, -d0 / 2), P(-w0 / 2, y0, -d0 / 2)];
  const t = [P(-w1 / 2, y1, d1 / 2), P(w1 / 2, y1, d1 / 2), P(w1 / 2, y1, -d1 / 2), P(-w1 / 2, y1, -d1 / 2)];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(tris, b[i], b[j], t[j], t[i], c, o);
  }
  quad(tris, t[0], t[1], t[2], t[3], c, o);
  quad(tris, b[3], b[2], b[1], b[0], c, o);
}

/** Flat ground plane (y-up) centered at (cx,y,cz), size w×d. */
export function ground(tris, cx, y, cz, w, d, c, o = {}) {
  const { tex = null, uvScale = 24 } = o;
  const uv = tex ? [[0, 0], [w / uvScale, 0], [w / uvScale, d / uvScale], [0, d / uvScale]] : null;
  quad(tris, [cx - w / 2, y, cz + d / 2], [cx + w / 2, y, cz + d / 2],
    [cx + w / 2, y, cz - d / 2], [cx - w / 2, y, cz - d / 2], c, { ...o, uv });
}

/** Displaced ground grid — rolling terrain. fn(x,z) -> world y. */
export function heightfield(tris, cx, cz, w, d, nx, nz, fn, c, o = {}) {
  const { tex = null, uvScale = 24 } = o;
  const P = (i, j) => {
    const x = cx - w / 2 + (i / nx) * w, z = cz - d / 2 + (j / nz) * d;
    return [x, fn(x, z), z];
  };
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const uv = tex ? [[i * w / nx / uvScale, j * d / nz / uvScale],
      [(i + 1) * w / nx / uvScale, j * d / nz / uvScale],
      [(i + 1) * w / nx / uvScale, (j + 1) * d / nz / uvScale],
      [i * w / nx / uvScale, (j + 1) * d / nz / uvScale]] : null;
    const q = [P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)];
    tris.push(tri([q[0], q[1], q[2]], uv && [uv[0], uv[1], uv[2]], c, o),
      tri([q[0], q[2], q[3]], uv && [uv[0], uv[2], uv[3]], c, o));
  }
}

/** Triangular roof prism, ridge along local X, centered (cx,cy,cz). */
export function prism(tris, cx, cy, cz, w, h, d, c, o = {}) {
  const { ry = 0, tex = null, uvScale = 24 } = o;
  const P = (px, py, pz) => add(rotY([px, py, pz], ry), [cx, cy, cz]);
  const x = w / 2, z = d / 2;
  const a = P(-x, 0, z), b = P(x, 0, z), e = P(x, 0, -z), f = P(-x, 0, -z);
  const r0 = P(-x, h, 0), r1 = P(x, h, 0); // ridge
  quad(tris, a, b, r1, r0, c, o);            // front slope
  quad(tris, e, f, r0, r1, c, o);            // back slope
  tris.push(tri([b, e, r1], null, c, o));    // right gable
  tris.push(tri([f, a, r0], null, c, o));    // left gable
}

/** UV-sphere centered (cx,cy,cz); `jag` jitters vertices for rocks. Smooth-shaded. */
export function sphere(tris, cx, cy, cz, r, n, c, o = {}) {
  const { jag = 0, squash = [1, 1, 1], seed = 1, smooth = true, tex = null } = o;
  const rnd = (() => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
  const rings = Math.max(3, n >> 1), segs = Math.max(6, n);
  const pt = [];
  for (let j = 0; j <= rings; j++) {
    const ph = (j / rings) * Math.PI;
    const row = [];
    for (let i = 0; i < segs; i++) {
      const th = (i / segs) * Math.PI * 2;
      let p = [Math.cos(th) * Math.sin(ph) * r * squash[0],
        Math.cos(ph) * r * squash[1], Math.sin(th) * Math.sin(ph) * r * squash[2]];
      if (jag) p = add(p, scl(norm(p), (rnd() - 0.5) * 2 * jag * r));
      row.push(add(p, [cx, cy, cz]));
    }
    pt.push(row);
  }
  const vn = (p) => norm(sub(p, [cx, cy, cz]));
  const uvv = (i, j) => [i / segs, j / rings];
  for (let j = 0; j < rings; j++) for (let i = 0; i < segs; i++) {
    const i2 = (i + 1) % segs;
    const q = [pt[j][i], pt[j][i2], pt[j + 1][i2], pt[j + 1][i]];
    const u = tex ? [uvv(i, j), uvv(i2, j), uvv(i2, j + 1), uvv(i, j + 1)] : null;
    const mk = (v, u3) => {
      const t = tri(v, u3, c, o);
      if (smooth) t.vn = v.map(vn);
      return t;
    };
    tris.push(mk([q[0], q[1], q[2]], u && [u[0], u[1], u[2]]), mk([q[0], q[2], q[3]], u && [u[0], u[2], u[3]]));
  }
}

/** Beam between two world points — poles, braces, wires. */
export function beam(tris, p0, p1, th, c, o = {}) {
  const d = sub(p1, p0), L = len(d);
  const f = scl(d, 1 / L);
  const up = Math.abs(f[1]) > 0.94 ? [1, 0, 0] : [0, 1, 0];
  const s = norm(cross(up, f)), u = cross(f, s);
  const hs = scl(s, th / 2), hu = scl(u, th / 2);
  const cs = (p, a, b) => add(add(p, a), b);
  quad(tris, cs(p0, hs, hu), cs(p1, hs, hu), cs(p1, scl(hs, -1), hu), cs(p0, scl(hs, -1), hu), c, o);
  quad(tris, cs(p1, hs, scl(hu, -1)), cs(p0, hs, scl(hu, -1)), cs(p0, scl(hs, -1), scl(hu, -1)), cs(p1, scl(hs, -1), scl(hu, -1)), c, o);
  quad(tris, cs(p0, hs, scl(hu, -1)), cs(p0, hs, hu), cs(p1, hs, hu), cs(p1, hs, scl(hu, -1)), c, o);
  quad(tris, cs(p0, scl(hs, -1), scl(hu, -1)), cs(p1, scl(hs, -1), scl(hu, -1)), cs(p1, scl(hs, -1), hu), cs(p0, scl(hs, -1), hu), c, o);
}

/** Stair run: n steps of rise×run, width w, starting at (x,y,z), +x or -x dir. */
export function stairs(tris, x, y, z, w, rise, run, n, dir, c, o = {}) {
  for (let i = 0; i < n; i++)
    box(tris, x + dir * (i + 0.5) * run, y + (i + 0.5) * rise, z, run, (i + 1) * rise, w, c, o);
}

/** Wheel = cylinder on a horizontal axis; `axis` 'x' or 'z'. */
export function wheel(tris, cx, cy, cz, r, wd, n, c, o = {}) {
  cyl(tris, cx, cy, cz, r, wd, n, c, { ...o, rz: o.axis === 'x' ? Math.PI / 2 : 0, rx: o.axis === 'z' ? Math.PI / 2 : 0 });
}

/** Horizontal beam along +x between x0..x1 at (y,z) — thin rails. */
export function rail(tris, x0, x1, y, z, th, c, o = {}) {
  beam(tris, [x0, y, z], [x1, y, z], th, c, o);
}

/**
 * Surface of revolution about local Y: profile = [[r, y], ...] bottom→top.
 * r=0 rows close the shape (poles). Smooth vertex normals. Use for barrels,
 * turned posts, tanks, lamp glass, finials.
 */
export function lathe(tris, cx, cy, cz, profile, n, c, o = {}) {
  const { tex = null, uvScale = 24, cap = true } = o;
  const R = (p) => add(o.rot ? rot(p, o.rot) : rotY(p, o.ry || 0), [cx, cy, cz]);
  const rows = profile.map(([r, y]) =>
    Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2;
      return R([Math.cos(a) * r, y, Math.sin(a) * r]);
    }));
  const ringN = rows.map((row, j) => {
    if (profile[j][0] < 1e-6) return row.map(() => [0, profile[j][1] > 0 ? 1 : -1, 0]);
    const t = [0, profile[Math.min(j + 1, profile.length - 1)][1] - profile[Math.max(j - 1, 0)][1], 0];
    const tan = t[1] === 0 ? [0, 1, 0] : norm(t);
    const dr = (profile[Math.min(j + 1, profile.length - 1)][0] - profile[Math.max(j - 1, 0)][0]);
    // normal in the r-y plane perpendicular to the profile tangent (dr, dy)
    const ny = -dr, nr = t[1] || 1e-6;
    const l = Math.hypot(nr, ny) || 1;
    return row.map((_, i) => {
      const a = (i / n) * Math.PI * 2;
      const nl = [Math.cos(a) * nr / l, ny / l, Math.sin(a) * nr / l];
      return norm(o.rot ? rot(nl, o.rot) : rotY(nl, o.ry || 0));
    });
  });
  for (let j = 0; j + 1 < rows.length; j++) {
    const sv = Math.hypot(profile[j + 1][0] - profile[j][0], profile[j + 1][1] - profile[j][1]) / uvScale;
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      const q = [rows[j][i], rows[j][i2], rows[j + 1][i2], rows[j + 1][i]];
      const qn = [ringN[j][i], ringN[j][i2], ringN[j + 1][i2], ringN[j + 1][i]];
      const su = (2 * Math.PI * profile[j][0]) / n / uvScale;
      const uv = tex ? [[i * su, 0], [(i + 1) * su, 0], [(i + 1) * su, sv], [i * su, sv]] : null;
      const mk = (v, vn, u3) => { const t = tri(v, u3, c, o); t.vn = vn; return t; };
      tris.push(mk([q[0], q[1], q[2]], [qn[0], qn[1], qn[2]], uv && [uv[0], uv[1], uv[2]]),
        mk([q[0], q[2], q[3]], [qn[0], qn[2], qn[3]], uv && [uv[0], uv[2], uv[3]]));
    }
  }
}

/**
 * Extrude a 2D outline (local XY, CCW) along local Z by `depth`, centered
 * on (cx,cy,cz). Front/back ngon fans + side quads. Use for ornate false
 * fronts, arched windows/doors, sign boards, gable ornaments.
 */
export function extrude(tris, cx, cy, cz, outline, depth, c, o = {}) {
  const { rot: r = null, ry = 0, tex = null, uvScale = 24 } = o;
  const R = (p) => add((r ? rot(p, r) : rotY(p, ry)), [cx, cy, cz]);
  const z0 = -depth / 2, z1 = depth / 2;
  const cen = outline.reduce((a, p) => [a[0] + p[0] / outline.length, a[1] + p[1] / outline.length], [0, 0]);
  const n = outline.length;
  // side walls
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const [x0, y0] = outline[i], [x1, y1] = outline[j];
    const L = Math.hypot(x1 - x0, y1 - y0) / uvScale;
    quad(tris, R([x0, y0, z0]), R([x1, y1, z0]), R([x1, y1, z1]), R([x0, y0, z1]), c,
      { ...o, uv: tex ? [[0, 0], [L, 0], [L, depth / uvScale], [0, depth / uvScale]] : null });
  }
  // front + back fans around centroid
  const cf = R([cen[0], cen[1], z1]), cb = R([cen[0], cen[1], z0]);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tris.push(tri([cf, R([outline[i][0], outline[i][1], z1]), R([outline[j][0], outline[j][1], z1])], null, c, o));
    tris.push(tri([cb, R([outline[j][0], outline[j][1], z0]), R([outline[i][0], outline[i][1], z0])], null, c, o));
  }
}

/**
 * Swept circular tube along a world-space polyline — ropes, rails, rims
 * (pass a closed path for torus-like rings), wagon bows.
 */
export function tube(tris, pts, r, n, c, o = {}) {
  const { tex = null, uvScale = 24, closed = false } = o;
  const segs = closed ? pts.length : pts.length - 1;
  const ring = (i) => {
    const p = pts[Math.min(i, pts.length - 1)];
    const pPrev = pts[Math.max(0, i - 1)], pNext = pts[Math.min(pts.length - 1, i + 1)];
    const t = norm(sub(pNext, pPrev));
    let u = Math.abs(t[1]) > 0.94 ? [1, 0, 0] : [0, 1, 0];
    const b = norm(cross(t, u)); u = cross(b, t);
    return Array.from({ length: n }, (_, k) => {
      const a = (k / n) * Math.PI * 2;
      return add(p, add(scl(u, Math.cos(a) * r), scl(b, Math.sin(a) * r)));
    });
  };
  for (let s = 0; s < segs; s++) {
    const r0 = ring(s), r1 = ring(s + 1);
    const sv = len(sub(pts[(s + 1) % pts.length], pts[s])) / uvScale;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const su = (2 * Math.PI * r) / n / uvScale;
      const uv = tex ? [[i * su, 0], [(i + 1) * su, 0], [(i + 1) * su, sv], [i * su, sv]] : null;
      tris.push(tri([r0[i], r0[j], r1[j]], uv && [uv[0], uv[1], uv[2]], c, o),
        tri([r0[i], r1[j], r1[i]], uv && [uv[0], uv[2], uv[3]], c, o));
    }
  }
}

/** Capsule — cylinder with hemisphere caps. Cacti arms, posts, bullets. */
export function capsule(tris, cx, cy, cz, r, h, n, c, o = {}) {
  const prof = [[0, -h / 2 - r]];
  for (let i = 1; i <= 4; i++) { // bottom dome: -90°..0°
    const a = -Math.PI / 2 + (i / 4) * (Math.PI / 2);
    prof.push([r * Math.cos(a), -h / 2 + r * Math.sin(a)]);
  }
  prof.push([r, h / 2]);
  for (let i = 1; i <= 4; i++) { // top dome: 0°..90°
    const a = (i / 4) * (Math.PI / 2);
    prof.push([r * Math.cos(a), h / 2 + r * Math.sin(a)]);
  }
  lathe(tris, cx, cy, cz, prof, n, c, o);
}

/** Append an arbitrary polygon mesh — `verts` [[x,y,z]..], `faces` index
 *  lists (tris/quads/ngons, CCW from outside). Options: `uvs` ([u,v] per
 *  vert), `vn` (per-vert normals for smooth shading), `two`, `tex`,
 *  `unlit`, `shine`, plus tri color c as usual. For imported/generated
 *  vertex maps — model data files, hand-authored silhouettes, etc. */
export function mesh(tris, verts, faces, c, o = {}) {
  for (const f of faces) {
    const idx = o.flip ? [...f].reverse() : f;
    for (let i = 1; i + 1 < idx.length; i++) {
      const ids = [idx[0], idx[i], idx[i + 1]];
      const t = tri(ids.map((k) => verts[k]), o.uvs ? ids.map((k) => o.uvs[k]) : null, c, o);
      if (o.vn) t.vn = ids.map((k) => o.vn[k]);
      tris.push(t);
    }
  }
}

/** Arch profile (width w, shoulder h, arch rise a) for extrude() — CCW loop. */
export const archOutline = (w, h, a, n = 8) => {
  const pts = [[-w / 2, 0], [w / 2, 0], [w / 2, h]];
  for (let i = 1; i <= n; i++) {
    const t = (i / n) * Math.PI; // t: small..π sweeps from +x shoulder to -x
    pts.push([Math.cos(t) * w / 2, h + Math.sin(t) * a]);
  }
  return pts;
};
