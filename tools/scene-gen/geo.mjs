// Procedural geometry kit for scene specs — everything emits flat-shaded
// triangles {v:[[x,y,z]x3], c:[r,g,b], two?} in world space (y-up).
// lib.mjs rasterizes them into the palette-indexed backdrops 3DMM wants.

/** Rotate [x,y,z] about the Y axis by `a` radians. */
const rotY = (p, a) => {
  const c = Math.cos(a), s = Math.sin(a);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
};

/** Emit one quad (two triangles) — ccw from the visible side by convention. */
export function quad(tris, p0, p1, p2, p3, c, two = false) {
  tris.push({ v: [p0, p1, p2], c, two }, { v: [p0, p2, p3], c, two });
}

/** Axis box centered at (cx, cy, cz) with size (w,h,d); `ry` yaws it first. */
export function box(tris, cx, cy, cz, w, h, d, c, { ry = 0, two = false } = {}) {
  const x = w / 2, y = h / 2, z = d / 2;
  const P = (px, py, pz) => {
    const q = ry ? rotY([px, py, pz], ry) : [px, py, pz];
    return [q[0] + cx, q[1] + cy, q[2] + cz];
  };
  // faces wound so the outward side is front-facing (checked vs camera anyway)
  quad(tris, P(-x, -y, z), P(x, -y, z), P(x, y, z), P(-x, y, z), c, two);  // +z
  quad(tris, P(x, -y, -z), P(-x, -y, -z), P(-x, y, -z), P(x, y, -z), c, two); // -z
  quad(tris, P(x, -y, z), P(x, -y, -z), P(x, y, -z), P(x, y, z), c, two);  // +x
  quad(tris, P(-x, -y, -z), P(-x, -y, z), P(-x, y, z), P(-x, y, -z), c, two); // -x
  quad(tris, P(-x, y, z), P(x, y, z), P(x, y, -z), P(-x, y, -z), c, two);  // top
  quad(tris, P(-x, -y, -z), P(x, -y, -z), P(x, -y, z), P(-x, -y, z), c, two); // bottom
}

/** Vertical cylinder/prism: radius r, height h, n sides, centered at (cx,cy,cz). */
export function cyl(tris, cx, cy, cz, r, h, n, c, { cap = true, two = false } = {}) {
  const y0 = cy - h / 2, y1 = cy + h / 2;
  const ring = (y) => Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
  });
  const b = ring(y0), t = ring(y1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    quad(tris, b[i], b[j], t[j], t[i], c, two);
    if (cap) {
      tris.push({ v: [[cx, y1, cz], t[i], t[j]], c, two });   // top fan
      tris.push({ v: [[cx, y0, cz], b[j], b[i]], c, two });   // bottom fan
    }
  }
}

/** Vertical cone/pyramid: base radius r at cy-h/2 tapering to apex at cy+h/2. */
export function cone(tris, cx, cy, cz, r, h, n, c) {
  const y0 = cy - h / 2, apex = [cx, cy + h / 2, cz];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const p0 = [cx + Math.cos(a0) * r, y0, cz + Math.sin(a0) * r];
    const p1 = [cx + Math.cos(a1) * r, y0, cz + Math.sin(a1) * r];
    tris.push({ v: [p0, p1, apex], c });
    tris.push({ v: [[cx, y0, cz], p1, p0], c }); // base
  }
}

/** Tapered box (frustum): bottom w0×d0 at cy-h/2, top w1×d1 at cy+h/2 — mesas. */
export function frustum(tris, cx, cy, cz, w0, d0, w1, d1, h, c, { ry = 0 } = {}) {
  const P = (px, py, pz) => {
    const q = ry ? rotY([px, py, pz], ry) : [px, py, pz];
    return [q[0] + cx, q[1] + cy, q[2] + cz];
  };
  const y0 = -h / 2, y1 = h / 2;
  const b = [P(-w0 / 2, y0, d0 / 2), P(w0 / 2, y0, d0 / 2), P(w0 / 2, y0, -d0 / 2), P(-w0 / 2, y0, -d0 / 2)];
  const t = [P(-w1 / 2, y1, d1 / 2), P(w1 / 2, y1, d1 / 2), P(w1 / 2, y1, -d1 / 2), P(-w1 / 2, y1, -d1 / 2)];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(tris, b[i], b[j], t[j], t[i], c);
  }
  quad(tris, t[0], t[1], t[2], t[3], c);
  quad(tris, b[3], b[2], b[1], b[0], c);
}

/** Flat ground plane (y-up) centered at (cx,y,cz), size w×d. */
export function ground(tris, cx, y, cz, w, d, c) {
  quad(tris, [cx - w / 2, y, cz + d / 2], [cx + w / 2, y, cz + d / 2],
    [cx + w / 2, y, cz - d / 2], [cx - w / 2, y, cz - d / 2], c);
}
