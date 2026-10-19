// Cowboy western town — a simple main-street set with 6 camera angles.
// Units are world-space (y-up); actors stand ~40-60 tall, ground is y=0.
// Palette entries: [r,g,b] or {base:[r,g,b], shades:[brightness mults]} —
// shades expand into ramp entries so Lambert shading lands on real colors.
export default {
  name: 'AI Cowboy Western',
  fileName: 'cowboy_western',
  cnoBase: 710000,
  indexBase: 157,

  palette: [
    { base: [205, 175, 125], shades: [0.68, 0.85, 1.0, 1.16] }, // sand
    { base: [168, 136, 96], shades: [0.75, 1.0, 1.12] },        // street dirt
    { base: [180, 140, 95], shades: [0.65, 0.85, 1.0, 1.15] },  // tan wood
    { base: [120, 82, 52], shades: [0.65, 0.85, 1.0, 1.15] },   // dark wood
    { base: [142, 62, 45], shades: [0.65, 0.85, 1.0, 1.15] },   // saloon red
    { base: [142, 140, 132], shades: [0.65, 0.85, 1.0, 1.15] }, // bank stone
    { base: [192, 172, 138], shades: [0.7, 0.88, 1.0, 1.12] },  // hotel cream
    { base: [92, 72, 56], shades: [0.75, 1.0, 1.15] },          // roofs
    { base: [152, 92, 58], shades: [0.7, 0.88, 1.0, 1.12] },    // rust
    { base: [62, 122, 56], shades: [0.6, 0.8, 1.0, 1.2] },      // cactus
    { base: [118, 78, 84], shades: [0.75, 0.9, 1.05, 1.2] },    // mesa
    { base: [108, 152, 212], shades: [0.75, 0.9, 1.05, 1.15] }, // sky blues
    { base: [232, 206, 160], shades: [0.9, 1.0, 1.06] },        // horizon haze
    { base: [244, 242, 232], shades: [0.9, 1.0] },              // cloud
    { base: [44, 42, 52], shades: [1.0, 1.4] },                 // window dark
  ],

  sky: { top: [96, 148, 214], horizon: [236, 210, 164] },
  ka: 0.5, kd: 0.62,

  lights: [
    { dir: [0.55, 0.72, 0.42], intensity: 1.0, type: 1 },  // afternoon sun
    { dir: [-0.62, 0.38, -0.3], intensity: 0.42, type: 1 }, // sky fill
  ],

  cameras: [
    { pos: [-75, 4, -140], look: [30, 22, 35], fov: 55, name: 'SW corner' },
    { pos: [75, 4, 140], look: [-30, 22, -35], fov: 55, name: 'NE corner' },
    { pos: [-135, 10, -4], look: [60, 14, 4], fov: 50, name: 'Street west' },
    { pos: [135, 10, 4], look: [-60, 14, -4], fov: 50, name: 'Street east' },
    { pos: [-165, 62, -125], look: [20, 12, 10], fov: 50, name: 'High SW' },
    { pos: [165, 62, 125], look: [-20, 12, -10], fov: 50, name: 'High NE' },
  ],

  build(tris, g) {
    const { box, cyl, cone, quad, frustum, ground } = g;
    const P = { // shortcuts into declared palette bases (used as face colors)
      sand: [205, 175, 125], dirt: [168, 136, 96], tan: [180, 140, 95],
      wood: [120, 82, 52], red: [142, 62, 45], stone: [142, 140, 132],
      cream: [192, 172, 138], roof: [92, 72, 56], rust: [152, 92, 58],
      cactus: [62, 122, 56], mesa: [132, 96, 98], cloud: [244, 242, 232],
      win: [44, 42, 52],
    };

    // --- terrain ---------------------------------------------------------
    ground(tris, 0, 0, 0, 2000, 2000, P.sand);
    quad(tris, [-260, 0.3, 42], [260, 0.3, 42], [260, 0.3, -42], [-260, 0.3, -42], P.dirt); // street
    // scatter a few dirt patches for texture
    quad(tris, [-120, 0.2, 90], [-40, 0.2, 110], [-30, 0.2, 70], [-110, 0.2, 60], P.dirt);
    quad(tris, [80, 0.2, -110], [150, 0.2, -80], [140, 0.2, -60], [70, 0.2, -85], P.dirt);

    // mesas on the horizon
    frustum(tris, -560, 60, 460, 300, 170, 210, 120, 120, P.mesa, { ry: 0.3 });
    frustum(tris, 600, 75, 420, 340, 200, 240, 140, 150, P.mesa, { ry: -0.2 });
    frustum(tris, -520, 55, -500, 260, 160, 190, 120, 110, P.mesa, { ry: 0.5 });
    frustum(tris, 140, 45, 680, 220, 140, 160, 100, 90, P.mesa, { ry: 0.1 });
    frustum(tris, 680, 50, -360, 240, 150, 170, 110, 100, P.mesa, { ry: -0.4 });

    // clouds — thick enough to read as clouds, not edge-on slivers
    box(tris, -300, 210, 420, 110, 26, 60, P.cloud);
    box(tris, 300, 230, -460, 130, 30, 70, P.cloud);
    box(tris, -120, 245, -560, 100, 24, 60, P.cloud);

    // --- buildings ---------------------------------------------------------
    // false-front western building: body + taller front panel + porch roof;
    // doors/windows on both faces so rear views aren't featureless slabs
    const building = (x, z, w, d, h, front, body, face /* +1 faces +z, -1 faces -z */) => {
      box(tris, x, h / 2, z, w, h, d, body);
      box(tris, x, (h + 9) / 2, z + face * (d / 2 + 0.8), w, h + 9, 1.6, front); // parapet
      box(tris, x, h * 0.62, z + face * (d / 2 + 4.2), w + 2, 1.6, 8.5, P.roof); // porch roof
      for (const s of [-1, 1]) // porch posts
        box(tris, x + s * (w / 2 - 2), h * 0.31, z + face * (d / 2 + 7.4), 1.6, h * 0.62, 1.6, P.wood);
      for (const f of [face, -face]) {
        box(tris, x, 4.5, z + f * (d / 2 + 0.9), 7, 9, 1.0, P.win);              // door
        for (const s of [-1, 1])
          box(tris, x + s * w * 0.28, h * 0.55, z + f * (d / 2 + 0.9), 6, 7, 1.0, P.win); // windows
      }
      // sign board on the front parapet
      box(tris, x, h + 5, z + face * (d / 2 + 1.7), w * 0.7, 6, 1.0, P.cream);
    };
    // south row (faces -z... i.e. toward street at z=0 -> face=-1 for z>0 side? buildings at z=+55 face -z)
    building(-32, 60, 42, 30, 32, P.red, P.red, -1);       // saloon
    building(16, 60, 30, 28, 26, P.stone, P.stone, -1);    // bank
    building(58, 60, 34, 30, 28, P.tan, P.wood, -1);       // general store
    // north row (faces +z)
    building(-48, -60, 46, 32, 42, P.cream, P.cream, 1);   // hotel (two-story)
    building(2, -60, 26, 26, 24, P.wood, P.wood, 1);       // gunsmith
    building(44, -60, 28, 26, 26, P.tan, P.wood, 1);       // barber
    // hotel upstairs windows
    for (const s of [-1, 0, 1])
      box(tris, -48 + s * 12, 32, -60 + 16.9, 5.5, 7, 1.0, P.win);
    // end-cap buildings closing the street's vanishing points
    box(tris, 152, 14, 0, 30, 28, 28, P.wood);            // livery stable
    box(tris, 136.2, 19, 0, 1.6, 38, 28, P.red);          // livery front (-x)
    box(tris, 135.2, 4.5, 0, 1.0, 9, 7, P.win);           // door
    box(tris, -152, 16, 0, 30, 32, 30, P.cream);          // chapel
    box(tris, -136.2, 21, 0, 1.6, 42, 30, P.cream);       // chapel front (+x)
    box(tris, -136.2, 47, 0, 1.6, 10, 8, P.cream);        // steeple
    box(tris, -135.2, 4.5, 0, 1.0, 9, 7, P.win);          // chapel door

    // hitch rails along the storefronts
    for (const [hx, hz] of [[-32, 38], [58, 38], [-48, -38]]) {
      for (const s of [-1, 0, 1]) box(tris, hx + s * 7, 3, hz, 1.5, 6, 1.5, P.wood);
      box(tris, hx, 5.6, hz, 16, 1.2, 1.2, P.wood);
    }

    // water tower behind the hotel
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
      box(tris, -100 + lx * 9, 11, -105 + lz * 9, 2.2, 22, 2.2, P.wood);
    box(tris, -100, 21, -105, 24, 2.5, 24, P.wood);           // platform
    cyl(tris, -100, 31, -105, 13, 15, 10, P.rust);            // tank
    cone(tris, -100, 42, -105, 14, 7, 10, P.roof);            // lid

    // wagon by the saloon
    box(tris, -10, 5.5, 30, 14, 5, 8, P.wood, { ry: 0.15 });
    for (const [wx, wz] of [[-5, 4.5], [5, 4.5], [-5, -4.5], [5, -4.5]])
      box(tris, -10 + wx, 3, 30 + wz, 2, 6, 6, P.win, { ry: 0.15 });
    box(tris, -10 + 9, 4, 31.4, 10, 1.4, 1.4, P.wood, { ry: -0.4 });

    // cacti — trunk + two arm stubs
    const cactus = (x, z, s) => {
      cyl(tris, x, 8 * s, z, 2.4 * s, 16 * s, 7, P.cactus);
      cyl(tris, x - 4.2 * s, 11 * s, z, 1.6 * s, 7 * s, 6, P.cactus);
      cyl(tris, x + 4.4 * s, 9 * s, z + 0.5 * s, 1.6 * s, 6 * s, 6, P.cactus);
      box(tris, x - 2.6 * s, 8 * s, z, 4.4 * s, 1.8 * s, 1.8 * s, P.cactus);
      box(tris, x + 2.8 * s, 6.5 * s, z + 0.3 * s, 4.4 * s, 1.8 * s, 1.8 * s, P.cactus);
    };
    cactus(-140, 110, 1.2); cactus(150, -120, 1.0); cactus(120, 140, 0.9); cactus(-170, -80, 1.1);

    // fences at the town edge
    for (let i = 0; i < 8; i++) box(tris, -190 + i * 9, 3.5, 120, 1.4, 7, 1.4, P.wood);
    box(tris, -160, 6.2, 120, 70, 1.1, 1.1, P.wood);
    for (let i = 0; i < 8; i++) box(tris, 130 + i * 9, 3.5, -120, 1.4, 7, 1.4, P.wood);
    box(tris, 160, 6.2, -120, 70, 1.1, 1.1, P.wood);
  },
};
