// Tinbot — a wind-up robot on the stock Zack skeleton: full 33-action humanoid
// animation set, indexed TMAP textures on every part (face plate, chest decal,
// corrugated limbs, belt buckle, soled boots), and three textured costumes —
// Formal paints a tuxedo on the chest decal and swaps in a top-hat head mesh
// (an "accessory" costume in the easel).
//   npx vite-node tools/actor-gen/build.mjs tools/actor-gen/specs/actors/tinman.mjs
//
// Authoring space: world units, actor at rest facing +z, ground y=0.
// Bone rest frames (from the stock rig — see `npx vite-node tools/actor-gen/dump.mjs`):
//   head j(0,12.9) fills ~y12.6-17.9   torso/back j(0,7.9) fill y5.7-13.3
//   upperArm joint ±3.5,10.1 -> forearm ±3.7,8.4   shoulders ±2.0,11.8
//   pelvis j(0,6.3)   thigh j(±1.0,6.8) shin j(±1.4,4.2) ankle j(±1.6,1.2)
//   shoes j(±1.2,0) feet y0-1.4
import { R } from '../../geo.mjs';
import * as tex from '../../tex.mjs';

// Palette indexes are absolute socpal slots; index 0 would punch transparent
// holes, so everything here is opaque.
const N = tex.nearest;
const ST = N(150, 160, 168);   // steel faceplate
const ST_D = N(98, 106, 116);  // dark steel edge
const GM = N(110, 116, 124);   // gunmetal
const DK = N(34, 38, 44);      // seams/rivets/mouth
const GL = N(240, 200, 90);    // glow-eye gold / brass buckle
const RD = N(200, 44, 36);     // red button / visor
const GN = N(56, 150, 72);     // green button
const NV = N(48, 56, 100);     // navy belt
const NV_D = N(34, 40, 74);
const OR = N(238, 142, 36);    // hi-vis orange
const OR_D = N(188, 108, 30);
const YL = N(238, 206, 70);    // hi-vis yellow
const YL_D = N(196, 166, 56);
const BK = N(30, 30, 34);      // suit black
const BK2 = N(52, 50, 56);     // suit black, slight sheen
const WH = N(230, 226, 214);   // shirt white / gauge face
const MR = N(124, 42, 46);     // maroon
const MR_D = N(88, 30, 34);
const GY = N(120, 124, 130);   // glove gray
const SL = N(52, 40, 34);      // boot sole

// ---- painters -------------------------------------------------------------
// 'front'-decal parts put detail mid-texture with a darker edge band (the
// side/top/bottom faces sample the edge columns). 'wrap' parts keep columns
// uniform so the u=0/1 back seam vanishes; u≈0.5 is the front center line
// (atan2 dx,dz = 0 at +z) — a rivet line painted there lands on the front.

// Face plate: eyes band + grill mouth + corner rivets on a plate color.
// NB: px row 0 = v=0 = TOP of the projected part (eyes above the mouth).
const facePx = (x, y, { plate, eye, mouth }) => {
  const u = x / 48, v = y / 48;
  if (v > 0.28 && v < 0.45 && ((u > 0.22 && u < 0.4) || (u > 0.6 && u < 0.78))) return eye;
  if (v > 0.58 && v < 0.72 && u > 0.26 && u < 0.74) return (x % 6 < 3) ? mouth : plate;
  if (x % 16 < 2 && y % 16 < 2) return mouth;                       // rivets
  return plate;
};

// Bolted panel for 'face' mode — each face gets the whole decal, so every
// panel gets a darker border + rivet dots (industrial plating).
const plateT = (base, edge) => tex.make(48, 48, (x, y) => {
  if (x < 2 || x > 45 || y < 2 || y > 45) return edge;
  if (x % 16 > 12 && x % 16 < 15 && y % 16 > 12 && y % 16 < 15) return DK;
  return base;
});

// Corrugated limb for 'wrap' mode — 6px ring bands + a rivet line down the
// front (u≈0.5); columns near the back seam stay uniform.
const ringsT = (main, band, seam = DK) => tex.make(32, 48, (x, y) => {
  if (x === 15 || x === 16) return seam;
  return (Math.floor(y / 6) & 1) ? band : main;
});

// Chest decals ('front' over the torso bbox; waist band = bottom rows).
const chestFactory = tex.make(48, 48, (x, y) => {
  if (x < 3 || x > 44 || y < 3 || y > 44) return ST_D;
  if (y > 38) return NV;                                          // belt
  const dx = x - 24, dy = y - 15, r2 = dx * dx + dy * dy;
  if (r2 < 49) return r2 < 30 ? WH : DK;                          // pressure gauge
  if (y > 25 && y < 29 && x > 10 && x < 17) return RD;            // buttons
  if (y > 25 && y < 29 && x > 31 && x < 38) return GN;
  if ((x % 16 === 8 || x % 16 === 9) && (y % 16 === 8 || y % 16 === 9)) return DK;
  return ST;
});
const chestHazard = tex.make(48, 48, (x, y) => {
  if (x < 3 || x > 44 || y < 3 || y > 44) return OR_D;
  if (y > 33) return ((x + y) % 12 < 6) ? BK : YL;                // waist chevrons
  if (x > 15 && x < 32 && y > 8 && y < 20) {                      // caution sign
    return (x < 17 || x > 30 || y < 10 || y > 18) ? BK : YL;
  }
  if ((x % 16 === 8 || x % 16 === 9) && (y % 16 === 8 || y % 16 === 9)) return DK;
  return OR;
});
const chestTux = tex.make(48, 48, (x, y) => {
  if (x < 3 || x > 44 || y < 3 || y > 44) return BK;              // jacket edges
  if (y > 4 && y < 9 && Math.abs(x - 24) < 7) return MR;          // bowtie
  const hw = 2 + y * 0.34;                                        // shirt V
  if (Math.abs(x - 24) < hw) {
    if (Math.abs(x - 24) > hw - 1.5) return BK;                   // lapel seam
    if (x > 21 && x < 27 && y > 14 && y < 42 && y % 9 > 6) return BK; // studs
    return WH;
  }
  return BK;
});

// Back panels ('face' mode — a full decal per face).
const backHazard = tex.make(48, 48, (x, y) => {                   // big chevrons
  if (x < 2 || x > 45 || y < 2 || y > 45) return OR_D;
  return ((x + y) % 16 < 8) ? OR : YL;
});
const backBlack = plateT(BK2, BK);
const backSteel = plateT(ST, ST_D);

// Belts ('front'-decal on the pelvis; back verts park on the edge texel).
const beltT = (base, edge, buckle, frame = DK) => tex.make(48, 24, (x, y) => {
  const f = Math.abs(x - 24);
  if (f < 6 && y > 6 && y < 17) return (f < 3 && y > 8 && y < 15) ? buckle : frame;
  if (x < 2 || x > 45 || y < 2 || y > 21) return edge;
  if (x % 10 < 2 && y > 9 && y < 15) return frame;                // belt holes
  return base;
});

// Boots ('wrap' — sole band at the bottom rows, stitch line down the toe).
const bootT = (upper, sole) => tex.make(32, 24, (x, y) => {
  if (y > 17) return sole;
  if (x === 15 || x === 16) return DK;                            // toe stitch
  return upper;
});

// ---- per-costume textures ---------------------------------------------------
const faceSteel = tex.make(48, 48, (x, y) => facePx(x, y, { plate: ST, eye: GL, mouth: DK }));
const faceHazard = tex.make(48, 48, (x, y) => facePx(x, y, { plate: GM, eye: RD, mouth: DK }));
// Formal head: face occupies x8-55/y0-47 of a 64-wide canvas; rows 48-63 are
// the hat strip (crown / ribbon / brim). The hat mesh override wraps crown
// sides onto rows 48-55 and parks the brim on the black rows.
const faceFormal = tex.make(64, 64, (x, y) => {
  if (y >= 48) return y < 54 ? BK2 : y < 57 ? MR : BK;
  return (x >= 8 && x < 56) ? facePx(x - 8, y, { plate: ST, eye: GL, mouth: DK }) : ST;
});
const ringsSteel = ringsT(ST, ST_D);
const ringsGray = ringsT(GY, ST_D);
const ringsMaroon = ringsT(MR, MR_D);
const ringsOrange = ringsT(OR, OR_D);
const ringsYellow = ringsT(YL, YL_D);
const ringsNavy = ringsT(NV, NV_D);
const ringsBlack = ringsT(BK2, BK, ST_D);
const beltNavy = beltT(NV, NV_D, GL);
const beltHazard = beltT(NV, NV_D, YL, BK);
const beltCummer = beltT(MR, MR_D, BK, GL);
const bootMaroon = bootT(MR, SL);
const bootBlack = bootT(BK2, SL);

const M = (ramp, t) => ({ ramp, tex: t });
const pair = (l, r, m) => ({ [l]: m, [r]: m }); // symmetric bone pairs

export default {
  name: 'Workshop Robots',
  desc: 'Tinbot — a clockwork robot actor with three costumes: Factory Steel, Hazard Stripe, Formal.',
  fileName: 'workshop_robots',
  cnoBase: 840000,
  base: 'Zack',
  author: '3dmm-web actor-gen',
  actors: [
    {
      name: 'Tinbot',
      build(body, geo) {
        // ---- head: boxy faceplate + antenna (all one rigid bone) ----
        // UV fn: face plate projects onto the texture; the thin antenna verts
        // park on a solid-color corner texel (UVs wrap, never clamp — scope the
        // park to the antenna column so interpolations never cross the face).
        const head = body.part('head', { uv: (x, y, z) => (y > 17.4 && x * x + z * z < 1.44)
          ? [0.04, 0.96] : [(x + 2.4) / 4.8, 1 - (y - 12.8) / 4.8] });
        geo.box(head, 0, 15.3, 0, 4.8, 4.6, 4.4);
        geo.cyl(head, 0, 18.2, 0, 0.16, 1.4, 8);            // antenna
        geo.sphere(head, 0, 18.9, 0, 0.42, { n: 8, m: 4 }); // antenna ball
        for (const s of [-1, 1]) geo.cyl(head, s * 2.35, 15.3, 0, 0.5, 0.7, 8, { rz: s * Math.PI / 2 }); // ear bolts

        // ---- torso: tapered chest (front shell) + bolted back panel ----
        const torso = body.part('torso', { uv: 'front' });  // chest decal
        geo.frustum(torso, 0, 9.8, 0.3, 4.6, 4.0, 5.6, 4.6, 7.0);   // chest, wider at top
        geo.box(torso, 0, 6.6, 0.6, 4.4, 1.4, 3.6);                 // waist band
        const back = body.part('back', { uv: 'face' });     // panel per face
        geo.box(back, 0, 9.8, -1.5, 5.0, 6.6, 1.2);                 // back shell
        geo.box(back, 0, 10.6, -2.5, 2.6, 3.6, 1.0);                // backpack
        for (const s of [-1, 1]) geo.cyl(back, s * 0.9, 10.6, -2.6, 0.3, 3.2, 8); // backpack tanks

        // ---- arms: shoulder ball, upper-arm limb, forearm + claw hand ----
        for (const s of [-1, 1]) {
          const su = s < 0 ? 'L' : 'R';
          const sh = body.part('shoulder' + su, { uv: 'wrap' });
          geo.sphere(sh, s * 2.7, 11.6, -0.1, 1.35, { n: 10, m: 6 });
          const up = body.part('upperArm' + su, { uv: 'wrap' });
          geo.limb(up, [s * 3.4, 10.4, -0.6], [s * 3.6, 8.6, 0.1], 0.85, 10);
          const fo = body.part('forearm' + su, { uv: 'wrap' });
          geo.limb(fo, [s * 3.6, 8.5, 0.2], [s * 3.8, 6.7, 0.7], 0.7, 10);
          geo.sphere(fo, s * 3.8, 6.2, 0.9, 0.95, { n: 8, m: 5 });    // hand
        }

        // ---- pelvis + legs: hip box, thigh/shin limbs, cuff, big shoe ----
        // Pelvis UV: only the front strip (z>1.0) samples the belt decal;
        // back/side verts park on the edge texel so the buckle stays front-only.
        const pelvis = body.part('pelvis', { uv: (x, y, z) => z > 1.0
          ? [(x + 2.2) / 4.4, 1 - (y - 5.3) / 2.2] : [0.96, 0.9] });
        geo.box(pelvis, 0, 6.4, 0, 4.4, 2.2, 3.9);
        for (const s of [-1, 1]) {
          const su = s < 0 ? 'L' : 'R';
          const th = body.part('thigh' + su, { uv: 'wrap' });
          geo.limb(th, [s * 1.1, 6.8, 0], [s * 1.4, 4.4, 0.2], 0.95, 10);
          const sh = body.part('shin' + su, { uv: 'wrap' });
          geo.limb(sh, [s * 1.4, 4.3, 0.2], [s * 1.6, 1.9, 0.1], 0.8, 10);
          const an = body.part('ankle' + su, { uv: 'wrap' });
          geo.cyl(an, s * 1.6, 1.7, 0.1, 1.05, 1.2, 10);              // cuff
          const so = body.part('shoe' + su, { uv: 'wrap' });
          geo.box(so, s * 1.7, 0.7, 0.5, 2.2, 1.4, 4.0);              // foot, toes +z
          geo.cyl(so, s * 1.7, 0.7, 2.4, 1.1, 1.4, 10, { rx: Math.PI / 2 }); // rounded toe
        }
      },
      outfits: [
        {
          name: 'Factory Steel',
          all: { ramp: R.STEEL },
          parts: {
            head: M(R.SILVER, faceSteel),
            torso: M(R.STEEL, chestFactory),
            back: M(R.STEEL, backSteel),
            ...pair('shoulderL', 'shoulderR', M(R.STEEL, ringsSteel)),
            ...pair('upperArmL', 'upperArmR', M(R.STEEL, ringsSteel)),
            ...pair('forearmL', 'forearmR', M(R.GRAY, ringsGray)),
            pelvis: M(R.NAVY, beltNavy),
            ...pair('thighL', 'thighR', M(R.STEEL, ringsSteel)),
            ...pair('shinL', 'shinR', M(R.STEEL, ringsSteel)),
            ...pair('ankleL', 'ankleR', M(R.MAROON, ringsMaroon)),
            ...pair('shoeL', 'shoeR', M(R.MAROON, bootMaroon)),
          },
        },
        {
          name: 'Hazard Stripe',
          all: { ramp: R.ORANGE },
          parts: {
            head: M(R.SILVER, faceHazard),
            torso: M(R.ORANGE, chestHazard),
            back: M(R.ORANGE, backHazard),
            ...pair('shoulderL', 'shoulderR', M(R.ORANGE, ringsOrange)),
            ...pair('upperArmL', 'upperArmR', M(R.GOLD, ringsYellow)),
            ...pair('forearmL', 'forearmR', M(R.ORANGE, ringsOrange)),
            pelvis: M(R.NAVY, beltHazard),
            ...pair('thighL', 'thighR', M(R.NAVY, ringsNavy)),
            ...pair('shinL', 'shinR', M(R.NAVY, ringsNavy)),
            ...pair('ankleL', 'ankleR', M(R.MAROON, ringsMaroon)),
            ...pair('shoeL', 'shoeR', M(R.MAROON, bootMaroon)),
          },
        },
        {
          name: 'Formal',
          all: { ramp: R.GRAY },
          parts: {
            // head swap keeps the face decal (in the texture's sub-rect) and
            // adds a top hat — a model-changing costume, so it shows up under
            // Accessories.
            head: { ramp: R.SILVER, tex: faceFormal, mesh: (p, geo) => {
              geo.box(p, 0, 15.3, 0, 4.8, 4.6, 4.4);
              for (const s of [-1, 1]) geo.cyl(p, s * 2.35, 15.3, 0, 0.5, 0.7, 8, { rz: s * Math.PI / 2 });
              geo.cyl(p, 0, 17.9, 0, 3.0, 0.4, 14);                  // hat brim
              geo.cyl(p, 0, 19.6, 0, 1.9, 3.4, 14);                  // hat crown
              // One material per part: face verts map to the 48x48 sub-rect,
              // crown sides wrap onto the hat strip (bottom rows = ribbon),
              // brim parks on the black rows.
              p.uv = (x, y, z) => {
                if (y > 18.3) return [Math.atan2(z, x) / (2 * Math.PI) + 0.5, 0.75 + (21.3 - y) * 0.032];
                if (y > 17.62) return [0.9, 0.93];                   // brim
                return [(x + 2.4) / 4.8 * 0.75 + 0.125, (1 - (y - 12.8) / 4.8) * 0.75];
              };
            } },
            torso: M(R.GRAY, chestTux),
            back: M(R.GRAY, backBlack),
            ...pair('shoulderL', 'shoulderR', M(R.GRAY, ringsBlack)),
            ...pair('upperArmL', 'upperArmR', M(R.GRAY, ringsBlack)),
            ...pair('forearmL', 'forearmR', M(R.GRAY, ringsBlack)),
            pelvis: M(R.MAROON, beltCummer),
            ...pair('thighL', 'thighR', M(R.GRAY, ringsBlack)),
            ...pair('shinL', 'shinR', M(R.GRAY, ringsBlack)),
            ...pair('ankleL', 'ankleR', M(R.GRAY, ringsBlack)),
            ...pair('shoeL', 'shoeR', M(R.GRAY, bootBlack)),
          },
        },
      ],
    },
  ],
};
