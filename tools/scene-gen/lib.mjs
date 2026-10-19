// Scene-pack builder: procedural geometry -> palette-indexed backdrop renders
// -> .3cn (BKGD/CAM/MBMP/ZBMP/GLCR/GLLT) + .3th (BKTH/CATH) -> .vxp zip.
// Run via vite-node (`import ... from '../../src/format/*.js'` hits the .ts).
import { zipSync } from 'fflate';
import zlib from 'node:zlib';
import { Writer } from '../../src/format/binary.js';
import { buildGL, writeChunkyFile } from '../../src/format/chunky.js';

export const W = 544, H = 306;            // renderer's native scene size
export const THUMB_W = 143, THUMB_H = 80; // picker thumbnail size (matches stock)
const KOSK = 0x0303;
const SKY_Z = 65535;                      // ZBMP sentinel: no backdrop (far)

// ---- matrices (row-vector 4x3, v' = v*M — same convention as src/engine/mat34)
/** Camera->world matrix for lookAt: rows = right, up, backward(-fwd), eye. */
export function lookAt(eye, target, up = [0, 1, 0]) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const z = norm(sub(eye, target));
  let x = norm(cross(up, z));
  if (!Math.hypot(...x)) x = [1, 0, 0];
  const y = cross(z, x);
  return [...x, ...y, ...z, ...eye];
}
/** Affine inverse of a 4x3 (general 3x3 inverse + translation) — camera view matrix. */
export function invert34(m) {
  const [a, b, c, d, e, f, g, h, i, tx, ty, tz] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const r = [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det,
    (a * i - c * g) / det, -(a * f - c * d) / det, C / det,
    -(a * h - b * g) / det, (a * e - b * d) / det];
  const t = [-(tx * r[0] + ty * r[3] + tz * r[6]), -(tx * r[1] + ty * r[4] + tz * r[7]), -(tx * r[2] + ty * r[5] + tz * r[8])];
  return [...r, ...t];
}
/** world point -> space of 4x3 matrix m. */
const xf = (p, m) => [p[0] * m[0] + p[1] * m[3] + p[2] * m[6] + m[9],
  p[0] * m[1] + p[1] * m[4] + p[2] * m[7] + m[10],
  p[0] * m[2] + p[1] * m[5] + p[2] * m[8] + m[11]];
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// ---- palette --------------------------------------------------------------
/** spec.palette -> [[r,g,b]] — entries are [r,g,b] or {base:[r,g,b], shades:[mults]}. */
export function expandPalette(spec) {
  const out = [];
  for (const e of spec.palette || []) {
    if (Array.isArray(e)) { out.push(e); continue; }
    for (const s of e.shades || [1])
      out.push(e.base.map((v) => Math.max(0, Math.min(255, Math.round(v * s)))));
  }
  return out;
}
/** Effective 256-entry palette: socpal low half + the pack's overlay at indexBase. */
export function effectivePalette(socpal, declared, indexBase) {
  const pal = [];
  for (let i = 0; i < 256; i++)
    pal[i] = i >= indexBase && i - indexBase < declared.length
      ? declared[i - indexBase]
      : [socpal[i * 3], socpal[i * 3 + 1], socpal[i * 3 + 2]];
  return pal;
}

// ---- rasterizer -----------------------------------------------------------
/** Clip a camera-space polygon to zc >= hither, retriangulate as a fan.
 *  Interpolates arbitrary per-vertex attribute arrays alongside position. */
function clipNear(verts, n) {
  const out = [];
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i], b = verts[(i + 1) % verts.length];
    const ain = a[0][2] <= -n, bin = b[0][2] <= -n; // pos is attr 0
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (-n - a[0][2]) / (b[0][2] - a[0][2]);
      out.push(a.map((arr, k) => arr.map((v, j) => v + (b[k][j] - v) * t)));
    }
  }
  const tris = [];
  for (let i = 1; i + 1 < out.length; i++) tris.push([out[0], out[i], out[i + 1]]);
  return tris;
}

/** Face normal of a world-space triangle. */
function faceN(v) {
  const u = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
  const w = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
  return norm3([u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]);
}

/** Tangent frame from uv layout — for bump-map perturbation. */
function tangentFrame(v, uv) {
  if (!uv) return null;
  const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]];
  const e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
  const du1 = uv[1][0] - uv[0][0], dv1 = uv[1][1] - uv[0][1];
  const du2 = uv[2][0] - uv[0][0], dv2 = uv[2][1] - uv[0][1];
  const det = du1 * dv2 - du2 * dv1;
  if (Math.abs(det) < 1e-8) return null;
  const T = norm3([(e1[0] * dv2 - e2[0] * dv1) / det, (e1[1] * dv2 - e2[1] * dv1) / det, (e1[2] * dv2 - e2[2] * dv1) / det]);
  const B = norm3([(e2[0] * du1 - e1[0] * du2) / det, (e2[1] * du1 - e1[1] * du2) / det, (e2[2] * du1 - e1[2] * du2) / det]);
  return [T, B];
}

/**
 * Orthographic sun shadow map: rasterize scene from the light's view into a
 * min-depth buffer. Returns {w,h,z,ox,oy,su,basis} — project worldPos by
 * (u,v,dep) = (dot(p,lx), dot(p,ly), dot(p,viewdir)) -> texel (u-ox)/su etc.
 */
export function shadowMap(tris, sunDir, { size = 512, margin = 40 } = {}) {
  const view = norm3(sunDir.map((v) => -v)); // light looks along -dir (toward scene)
  let lx = norm3([view[2], 0, -view[0]]);
  if (!Math.hypot(...lx)) lx = [1, 0, 0];
  const ly = norm3([view[1] * lx[2] - view[2] * lx[1], view[2] * lx[0] - view[0] * lx[2], view[0] * lx[1] - view[1] * lx[0]]);
  // project all verts into light space for bounds
  let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9, d0 = 1e9;
  for (const t of tris) for (const p of t.v) {
    const u = p[0] * lx[0] + p[1] * lx[1] + p[2] * lx[2];
    const v = p[0] * ly[0] + p[1] * ly[1] + p[2] * ly[2];
    const dd = p[0] * view[0] + p[1] * view[1] + p[2] * view[2];
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); d0 = Math.min(d0, dd);
  }
  const su = (u1 - u0 + margin * 2) / size, sv = (v1 - v0 + margin * 2) / size;
  const s = Math.max(su, sv); // square texels
  const w = Math.ceil((u1 - u0 + margin * 2) / s), h = Math.ceil((v1 - v0 + margin * 2) / s);
  const ox = u0 - margin, oy = v0 - margin;
  const z = new Float32Array(w * h).fill(Infinity);
  for (const t of tris) {
    const p = t.v.map((q) => [
      (q[0] * lx[0] + q[1] * lx[1] + q[2] * lx[2] - ox) / s,
      (q[0] * ly[0] + q[1] * ly[1] + q[2] * ly[2] - oy) / s,
      q[0] * view[0] + q[1] * view[1] + q[2] * view[2] - d0]);
    // barycentric fill, linear depth (orthographic)
    const [a, b, c] = p;
    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const maxX = Math.min(w - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const maxY = Math.min(h - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const d = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (!d) continue;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      let w0 = (b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px);
      let w1 = (c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px);
      let w2 = d - w0 - w1;
      if (d < 0) { w0 = -w0; w1 = -w1; w2 = -w2; }
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const dep = (w0 * a[2] + w1 * b[2] + w2 * c[2]) / Math.abs(d);
      const o = y * w + x;
      if (dep < z[o]) z[o] = dep;
    }
  }
  return { w, h, z, ox, oy, s, d0, lx, ly, view };
}

/**
 * Rasterize `tris` for one camera -> {rgb, z} at WxH, true color.
 * env: {sky|skyFn, ambSky, ambGnd, lights:[{dir,intensity,type,col?}], shadow,
 *       bumpScale, specI, ss} — lights[0] is the shadow-casting sun.
 * `ss` = supersample factor for antialiasing (render at W*ss x H*ss, then
 * box-downsample color; depth takes the closest sub-sample per pixel).
 */
export function rasterize(tris, cam, env) {
  const ss = env.ss ?? 1;
  const rw = W * ss, rh = H * ss;
  const view = invert34(cam.matrix);
  const f = (rh / 2) / Math.tan(cam.fov / 2);
  const zbuf = new Float32Array(rw * rh).fill(Infinity);
  const rgb = new Float32Array(rw * rh * 3);
  const eye = [cam.matrix[9], cam.matrix[10], cam.matrix[11]];
  const sm = env.shadow;
  const bias = env.shadowBias ?? 1.2;
  const sun = env.lights[0], fill = env.lights.slice(1);
  const ambSky = env.ambSky ?? [0.42, 0.46, 0.55], ambGnd = env.ambGnd ?? [0.34, 0.28, 0.22];
  const bs = env.bumpScale ?? 1.5;
  for (const t of tris) {
    // world-space prep
    const n0 = faceN(t.v);
    const toCam = [eye[0] - t.v[0][0], eye[1] - t.v[0][1], eye[2] - t.v[0][2]];
    const facing = n0[0] * toCam[0] + n0[1] * toCam[1] + n0[2] * toCam[2];
    if (facing <= 0 && !t.two) continue; // back-face cull
    const frame = t.tex?.bump ? tangentFrame(t.v, t.uv) : null;
    // per-vertex attribute rows: [pos_cam][uv][world][normal?]
    const verts = t.v.map((p, i) => [
      xf(p, view),                              // 0: camera-space pos
      t.uv ? t.uv[i] : [0, 0],                  // 1: uv
      p,                                        // 2: world pos
      t.vn ? t.vn[i] : n0,                      // 3: normal
    ]);
    for (const poly of clipNear(verts, cam.hither)) {
      const sp = poly.map((q) => [[rw / 2 + (q[0][0] / -q[0][2]) * f, rh / 2 - (q[0][1] / -q[0][2]) * f, -q[0][2]], q[1], q[2], q[3]]);
      rasterTri(sp, t, { zbuf, rgb, rw, rh, eye, n0, facing, frame, sun, fill, ambSky, ambGnd, sm, bias, bs, specI: env.specI ?? 30, smOp: env.shadowOpacity ?? 0.55, soft: env.shadowSoft ?? 1.0 });
    }
  }
  // sky fill (skyFn receives final-resolution pixel coords)
  const skyFn = env.skyFn || ((x, y) => {
    const t = y / (rh - 1);
    return [0, 1, 2].map((k) => env.sky.top[k] + (env.sky.horizon[k] - env.sky.top[k]) * t);
  });
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const o = y * rw + x;
    if (zbuf[o] !== Infinity) continue;
    const c = skyFn(x / ss, y / ss);
    rgb[o * 3] = c[0]; rgb[o * 3 + 1] = c[1]; rgb[o * 3 + 2] = c[2];
  }
  // downsample ss x ss blocks: average color, nearest depth
  const { hither: N, yon: F } = cam;
  const z = new Uint16Array(W * H);
  const out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0, zc = Infinity;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const o = (y * ss + sy) * rw + x * ss + sx;
      r += rgb[o * 3]; g += rgb[o * 3 + 1]; b += rgb[o * 3 + 2];
      if (zbuf[o] < zc) zc = zbuf[o];
    }
    const n2 = ss * ss, o = y * W + x;
    out[o * 3] = Math.min(255, Math.round(r / n2));
    out[o * 3 + 1] = Math.min(255, Math.round(g / n2));
    out[o * 3 + 2] = Math.min(255, Math.round(b / n2));
    if (zc === Infinity) { z[o] = SKY_Z; continue; }
    const ndc = (F + N) / (F - N) - (2 * F * N) / ((F - N) * zc);
    z[o] = Math.max(-32768, Math.min(32767, Math.round(ndc * 32768))) & 0xffff;
  }
  return { rgb: out, z };
}

// Poisson-ish disk for shadow PCF — 12 taps, softer edges than a 2x2 grid
const PCF = [[-0.94, -0.40], [0.40, -0.94], [0.94, 0.40], [-0.40, 0.94], [-0.72, 0.62], [0.72, -0.62], [0.22, 0.92], [-0.22, -0.92], [0.92, -0.22], [-0.92, 0.22], [0.50, 0.50], [-0.50, -0.50]];
const GWhite = [1, 1, 1];

/** Per-pixel shaded fill. attrs per vertex: [screen xyz][uv][world][normal]. */
function rasterTri(sp, t, E) {
  const [a, b, c] = sp;
  const minX = Math.max(0, Math.floor(Math.min(a[0][0], b[0][0], c[0][0])));
  const maxX = Math.min(E.rw - 1, Math.ceil(Math.max(a[0][0], b[0][0], c[0][0])));
  const minY = Math.max(0, Math.floor(Math.min(a[0][1], b[0][1], c[0][1])));
  const maxY = Math.min(E.rh - 1, Math.ceil(Math.max(a[0][1], b[0][1], c[0][1])));
  if (minX > maxX || minY > maxY) return;
  const d = (b[0][0] - a[0][0]) * (c[0][1] - a[0][1]) - (b[0][1] - a[0][1]) * (c[0][0] - a[0][0]);
  if (!d) return;
  const ad = Math.abs(d);
  const tex = t.tex;
  const tw = tex ? tex.w : 0, th = tex ? tex.h : 0;
  const trgb = tex ? tex.rgb : null, tbump = tex ? tex.bump : null;
  const samp = (u, v) => {
    const x = Math.floor(((u % 1) + 1) % 1 * tw) % tw, y = Math.floor(((v % 1) + 1) % 1 * th) % th;
    return y * tw + x;
  };
  const flip = E.facing <= 0 ? -1 : 1; // back faces of two-sided tris shade on -n
  const n0 = [E.n0[0] * flip, E.n0[1] * flip, E.n0[2] * flip];
  const T = E.frame ? E.frame[0] : null, B = E.frame ? E.frame[1] : null;
  // interpolant setup: per-vertex [iz, u*iz, v*iz, wx*iz, wy*iz, wz*iz, nx*iz, ny*iz, nz*iz]
  const iv = [a, b, c].map((s) => {
    const iz = 1 / s[0][2];
    const r = new Float64Array(9);
    r[0] = iz;
    r[1] = s[1][0] * iz; r[2] = s[1][1] * iz;
    r[3] = s[2][0] * iz; r[4] = s[2][1] * iz; r[5] = s[2][2] * iz;
    r[6] = s[3][0] * iz; r[7] = s[3][1] * iz; r[8] = s[3][2] * iz;
    return r;
  });
  const [ia, ib, ic] = iv;
  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5;
      let w0 = (b[0][0] - px) * (c[0][1] - py) - (b[0][1] - py) * (c[0][0] - px);
      let w1 = (c[0][0] - px) * (a[0][1] - py) - (c[0][1] - py) * (a[0][0] - px);
      let w2 = d - w0 - w1;
      if (d < 0) { w0 = -w0; w1 = -w1; w2 = -w2; }
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const den = (w0 * ia[0] + w1 * ib[0] + w2 * ic[0]) / ad;
      if (den <= 0) continue;
      const zc = 1 / den;
      const o = y * E.rw + x;
      if (zc >= E.zbuf[o]) continue;
      // interpolate attributes
      const at = (k) => (w0 * ia[k] + w1 * ib[k] + w2 * ic[k]) / ad * zc;
      let nx = at(6), ny = at(7), nz = at(8);
      if (!t.vn) { nx = n0[0]; ny = n0[1]; nz = n0[2]; }
      else { const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; if (flip < 0) { nx = -nx; ny = -ny; nz = -nz; } }
      let u = 0, v = 0;
      if (tex) { u = at(1); v = at(2); }
      // bump-perturb normal
      if (tbump && T) {
        const b0 = tbump[samp(u, v)];
        const bu = tbump[samp(u + 1 / tw, v)] - b0, bv = tbump[samp(u, v + 1 / th)] - b0;
        nx += E.bs * (bu * T[0] + bv * B[0]); ny += E.bs * (bu * T[1] + bv * B[1]); nz += E.bs * (bu * T[2] + bv * B[2]);
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      }
      const wp = [at(3), at(4), at(5)];
      // shadow test (sun only)
      let lit = 1;
      if (E.sm) {
        const lu = (wp[0] * E.sm.lx[0] + wp[1] * E.sm.lx[1] + wp[2] * E.sm.lx[2] - E.sm.ox) / E.sm.s;
        const lv = (wp[0] * E.sm.ly[0] + wp[1] * E.sm.ly[1] + wp[2] * E.sm.ly[2] - E.sm.oy) / E.sm.s;
        const ld = wp[0] * E.sm.view[0] + wp[1] * E.sm.view[1] + wp[2] * E.sm.view[2] - E.sm.d0;
        const slope = 1 - Math.abs(nx * E.sm.view[0] + ny * E.sm.view[1] + nz * E.sm.view[2]);
        const bb = E.bias + slope * 2;
        let acc = 0;
        for (const [dx, dy] of PCF) {
          const sx2 = Math.floor(lu + dx * E.soft), sy2 = Math.floor(lv + dy * E.soft);
          acc += (sx2 < 0 || sy2 < 0 || sx2 >= E.sm.w || sy2 >= E.sm.h || E.sm.z[sy2 * E.sm.w + sx2] === Infinity || ld - bb < E.sm.z[sy2 * E.sm.w + sx2]) ? 0 : 1;
        }
        lit = 1 - (acc / PCF.length) * E.smOp;
      }
      // lighting — hemisphere ambient + per-light colored diffuse
      const hemi = ny * 0.5 + 0.5;
      let lr = E.ambGnd[0] + (E.ambSky[0] - E.ambGnd[0]) * hemi,
          lg = E.ambGnd[1] + (E.ambSky[1] - E.ambGnd[1]) * hemi,
          lb = E.ambGnd[2] + (E.ambSky[2] - E.ambGnd[2]) * hemi;
      let liR = 0, liG = 0, liB = 0;
      const addLight = (l, lit2) => {
        const d = Math.max(0, nx * l.dir[0] + ny * l.dir[1] + nz * l.dir[2]) * (l.intensity ?? 1) * lit2;
        const lc = l.col || GWhite;
        liR += d * lc[0]; liG += d * lc[1]; liB += d * lc[2];
      };
      addLight(E.sun, lit);
      for (const l of E.fill) addLight(l, 1);
      let spec = 0;
      if (t.shine) { // Blinn-Phong toward the sun + view vector
        const vd = norm3([E.eye[0] - wp[0], E.eye[1] - wp[1], E.eye[2] - wp[2]]);
        const hv = norm3([E.sun.dir[0] + vd[0], E.sun.dir[1] + vd[1], E.sun.dir[2] + vd[2]]);
        spec = E.specI * t.shine * Math.pow(Math.max(0, nx * hv[0] + ny * hv[1] + nz * hv[2]), 24) * lit;
      }
      // base color: texel or flat
      let cr = t.c[0], cg = t.c[1], cb = t.c[2];
      if (tex) {
        const i3 = samp(u, v) * 3;
        cr = cr * trgb[i3] / 255; cg = cg * trgb[i3 + 1] / 255; cb = cb * trgb[i3 + 2] / 255;
      }
      if (t.unlit) {
        E.rgb[o * 3] = cr; E.rgb[o * 3 + 1] = cg; E.rgb[o * 3 + 2] = cb;
      } else {
        E.rgb[o * 3] = cr * (lr + liR) + spec;
        E.rgb[o * 3 + 1] = cg * (lg + liG) + spec;
        E.rgb[o * 3 + 2] = cb * (lb + liB) + spec;
      }
      E.zbuf[o] = zc;
    }
  }
}

// ---- palette quantization ---------------------------------------------------
/** Median-cut palette extraction over one or more RGB buffers -> [[r,g,b]x~k]. */
export function medianCut(rgbs, k) {
  const px = [];
  for (const rgb of rgbs)
    for (let i = 0; i < rgb.length; i += 6) px.push([rgb[i], rgb[i + 1], rgb[i + 2]]);
  const boxes = [px];
  while (boxes.length < k) {
    let bi = -1, brange = -1, bch = 0;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.length < 2) continue;
      const mn = [255, 255, 255], mx = [0, 0, 0];
      for (const p of b) for (let ch = 0; ch < 3; ch++) { mn[ch] = Math.min(mn[ch], p[ch]); mx[ch] = Math.max(mx[ch], p[ch]); }
      const ranges = [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]];
      const ch = ranges.indexOf(Math.max(...ranges));
      if (ranges[ch] > brange) { brange = ranges[ch]; bi = i; bch = ch; }
    }
    if (bi < 0) break;
    const b = boxes.splice(bi, 1)[0].sort((a, c) => a[bch] - c[bch]);
    boxes.push(b.slice(0, b.length >> 1), b.slice(b.length >> 1));
  }
  return boxes.map((b) => {
    const s = b.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
    return s.map((v) => Math.min(255, Math.round(v / Math.max(1, b.length))));
  });
}

const BAYER4 = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
/** Quantize an RGB buffer to nearest effective-palette indices, ordered dither. */
export function quantize(rgb, w, h, eff, { dither = 16 } = {}) {
  const idx = new Int16Array(w * h);
  const cache = new Map();
  const nearest = (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let hit = cache.get(key);
    if (hit === undefined) {
      let bd = Infinity; hit = 0;
      for (let i = 0; i < 256; i++) {
        const p = eff[i];
        const dd = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
        if (dd < bd) { bd = dd; hit = i; }
      }
      cache.set(key, hit);
    }
    return hit;
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    const th = (BAYER4[y & 3][x & 3] / 16 - 0.5) * dither;
    idx[i] = nearest(
      Math.max(0, Math.min(255, Math.round(rgb[i * 3] + th))),
      Math.max(0, Math.min(255, Math.round(rgb[i * 3 + 1] + th))),
      Math.max(0, Math.min(255, Math.round(rgb[i * 3 + 2] + th))));
  }
  return idx;
}

export function downsample(idx, w = W, h = H, tw = THUMB_W, th = THUMB_H) {
  const out = new Int16Array(tw * th);
  for (let y = 0; y < th; y++) {
    const y0 = Math.floor((y * h) / th), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / th));
    for (let x = 0; x < tw; x++) {
      const x0 = Math.floor((x * w) / tw), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / tw));
      const count = new Map();
      for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
        const v = idx[sy * w + sx];
        count.set(v, (count.get(v) || 0) + 1);
      }
      let best = 0, bn = -1;
      for (const [v, n] of count) if (n > bn) { bn = n; best = v; }
      out[y * tw + x] = best;
    }
  }
  return out;
}

// ---- chunk-body encoders ---------------------------------------------------
/** MBMP: RLE rows of palette indices (row-wise maximal runs). */
export function mbmpBody(w, h, px, { left = 0, top = 0 } = {}) {
  const wr = new Writer();
  wr.bo().u16(KOSK).u8(0).u8(0).u16(0)
    .i32(left).i32(top).i32(left + w).i32(top + h).i32(0);
  const rows = [];
  for (let y = 0; y < h; y++) {
    const rw = new Writer();
    let x = 0;
    while (x < w) {
      let skip = 0;
      while (x + skip < w && px[y * w + x + skip] < 0 && skip < 255) skip++;
      if (skip === 255) { rw.u8(255).u8(0); x += skip; continue; }
      x += skip;
      let len = 0;
      while (x + len < w && px[y * w + x + len] >= 0 && len < 255) len++;
      rw.u8(skip).u8(len);
      for (let i = 0; i < len; i++) rw.u8(px[y * w + x + i] & 0xff);
      x += len;
    }
    rows.push(rw.out());
  }
  for (const r of rows) wr.u16(r.length);
  for (const r of rows) wr.bytes(r);
  return wr.out();
}

/** ZBMP: header + one little-endian u16 per pixel. */
export function zbmpBody(w, h, z) {
  const wr = new Writer();
  wr.bo().u16(KOSK).i16(0).i16(0).i16(w).i16(h);
  const b = new Uint8Array(w * h * 2);
  const dv = new DataView(b.buffer);
  for (let i = 0; i < z.length; i++) dv.setUint16(i * 2, z[i], true);
  return wr.bytes(b).out();
}

/** CAM body: clip planes, fov, apos, camera->world matrix. */
export function camBody(cam) {
  const wr = new Writer();
  wr.bo().u16(KOSK).brs(cam.hither).brs(cam.yon).bra(cam.fov).i16(0);
  for (const v of cam.apos) wr.brs(v);
  for (const v of cam.matrix) wr.brs(v);
  return wr.out();
}

/** GLCR: GL of [B,G,R,0] entries. */
export function glcrBody(colors) {
  return buildGL(colors.map(([r, g, b]) => new Uint8Array([b, g, r, 0])));
}

/** GLLT: GL of 56-byte entries {bmat34, brs intensity, i32 type}.
 *  The light matrix's row 2 is the direction TO the light (renderer reads
 *  matrix[6..8]); translation sits far along it like the stock entries. */
export function glltBody(lights) {
  const entries = lights.map((l) => {
    const z = norm3(l.dir);
    let x = norm3([z[2], 0, -z[0]]);
    if (!Math.hypot(...x)) x = [1, 0, 0];
    const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    const w = new Writer();
    for (const v of [...x, ...y, ...z, z[0] * 600, z[1] * 600, z[2] * 600]) w.brs(v);
    w.brs(l.intensity ?? 1).i32(l.type ?? 1);
    return w.out();
  });
  return buildGL(entries);
}

/** Normalize a spec camera {pos, look, fov(deg), hither, yon} -> chunk fields. */
export function makeCam(c) {
  const apos = c.pos;
  return {
    apos, matrix: lookAt(c.pos, c.look), hither: c.hither ?? 1.2,
    yon: c.yon ?? 5000, fov: ((c.fov ?? 53) * Math.PI) / 180, name: c.name,
  };
}

/** Build the pack's .3cn: pack-palette GLCR (256) + BKGD{GLCR,GLLT,CAM*{MBMP,ZBMP}}.
 *  `overlay` = the full overlay palette used at quantize time (declared + median-cut). */
export function build3cn(spec, renders, socpal, overlay) {
  let cno = spec.cnoBase;
  if (overlay.length > 256 - spec.indexBase)
    throw new Error(`palette ${overlay.length} > ${256 - spec.indexBase} slots at indexBase ${spec.indexBase}`);
  const eff = effectivePalette(socpal, overlay, spec.indexBase);
  // 256-entry pack palette -> thumbs decode against it instead of raw socpal
  const packPal = { ctg: 'GLCR', cno: cno++, data: glcrBody(eff), name: `${spec.name} Pack Palette`, loner: true };
  const bkgdCno = cno++;
  const glcr = { ctg: 'GLCR', cno: cno++, data: glcrBody(overlay), name: `${spec.name} Palette` };
  const gllt = { ctg: 'GLLT', cno: cno++, data: glltBody(spec.lights), name: `${spec.name} Lights` };
  const cams = spec.cameras.map((cs, i) => {
    const cam = { ctg: 'CAM ', cno: cno++, data: camBody(renders[i].cam), name: `${spec.name} Camera ${i}` };
    cam.kids = [
      { ctg: 'MBMP', cno: cno++, chid: 0 },
      { ctg: 'ZBMP', cno: cno++, chid: 0 },
    ];
    cam._kids = [
      { ctg: 'MBMP', cno: cam.kids[0].cno, data: mbmpBody(W, H, renders[i].idx), name: `${spec.name} Camera ${i} Backdrop` },
      { ctg: 'ZBMP', cno: cam.kids[1].cno, data: zbmpBody(W, H, renders[i].z), name: `${spec.name} Camera ${i} Depth` },
    ];
    return cam;
  });
  const bkgd = {
    ctg: 'BKGD', cno: bkgdCno, data: bkgdBody(spec.indexBase), name: spec.name,
    kids: [{ ctg: 'GLCR', cno: glcr.cno, chid: 0 }, { ctg: 'GLLT', cno: gllt.cno, chid: 0 },
      ...cams.map((c, i) => ({ ctg: 'CAM ', cno: c.cno, chid: i }))],
  };
  const chunks = [packPal, bkgd, glcr, gllt];
  for (const c of cams) { const { _kids, ...rest } = c; chunks.push(rest, ..._kids); }
  return { bytes: writeChunkyFile(chunks), bkgdCno, camCount: spec.cameras.length };
}

const bkgdBody = (indexBase) => new Writer().bo().u16(KOSK).u8(indexBase).out();
const body4 = () => new Writer().bo().u16(KOSK).out();

/** Build the .3th: BKTH (GOKD->MBMP + CATH->GOKD->MBMP per camera). */
export function build3th(spec, renders, bkgdCno) {
  let cno = spec.cnoBase + 500; // .3th cno block, no overlap with the .3cn
  const chunks = [];
  const kids = [];
  const mbmp = (px, name) => ({ ctg: 'MBMP', cno: cno++, chid: 0, data: mbmpBody(THUMB_W, THUMB_H, px), name });
  const gokd = (mb, name) => ({ ctg: 'GOKD', cno: cno++, chid: 0, kids: [{ ctg: 'MBMP', cno: mb.cno, chid: 0 }], name });
  const emit = (mb, gk) => { chunks.push({ ...gk, data: body4() }, { ...mb, kids: [] }); };
  const mainMb = mbmp(renders[0].thumb, `${spec.name} Thumbnail`);
  emit(mainMb, gokd(mainMb, `${spec.name} Thumbnail Group`));
  kids.push({ ctg: 'GOKD', cno: chunks[chunks.length - 2].cno, chid: 0 });
  spec.cameras.forEach((cs, i) => {
    const mb = mbmp(renders[i].thumb, `${spec.name} Camera ${i} Thumbnail`);
    const gk = gokd(mb, `${spec.name} Camera ${i} Thumbnail Group`);
    const cath = { ctg: 'CATH', cno: cno++, chid: i, kids: [{ ctg: 'GOKD', cno: gk.cno, chid: 0 }], data: body4(), name: `${spec.name} Camera ${i} Entry` };
    chunks.push(cath, { ...gk, data: body4() }, { ...mb, kids: [] });
    kids.push({ ctg: 'CATH', cno: cath.cno, chid: i });
  });
  chunks.unshift({ ctg: 'BKTH', cno: bkgdCno, data: body4(), kids, name: `${spec.name} Thumbnail Catalog` });
  return writeChunkyFile(chunks);
}

// ---- PNG (for eyeballing renders without booting the app) -------------------
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
const crc32 = (b) => { let c = ~0; for (const x of b) c = CRC_T[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
const pngChunk = (type, data) => {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length); // PNG integers are big-endian
  out.set([...type].map((ch) => ch.charCodeAt(0)), 4);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};
/** Minimal RGB PNG encoder (filter 0 rows + zlib). */
export function png(w, h, rgb) {
  const d = new Uint8Array(13);
  const dv = new DataView(d.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); d[8] = 8; d[9] = 2; // 8-bit truecolor
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgb.subarray(y * w * 3, (y + 1) * w * 3), y * (w * 3 + 1) + 1);
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = zlib.deflateSync(raw, { level: 9 });
  const iend = pngChunk('IEND', new Uint8Array(0));
  const out = new Uint8Array(sig.length + 25 + 12 + idat.length + iend.length);
  let p = 0;
  const put = (b) => { out.set(b, p); p += b.length; };
  put(sig); put(pngChunk('IHDR', d)); put(pngChunk('IDAT', idat)); put(iend);
  return out;
}

/** Grayscale PNG of the ZBMP (near=dark, far=light, sky=white) — debug aid. */
export function zToRgb(z) {
  const rgb = new Uint8Array(z.length * 3);
  for (let i = 0; i < z.length; i++) {
    const v = z[i] === SKY_Z ? 255 : Math.max(0, Math.min(255, (z[i] / 32768) * 255));
    rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = v;
  }
  return rgb;
}

/** Zip {name:Uint8Array} into a .vxp. */
export const vxp = (files) => zipSync(files, { level: 9 });
