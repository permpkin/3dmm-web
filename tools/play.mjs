import fs from 'node:fs';
import { ChunkyFile } from '../src/format/chunky.js';
import { Library, CONTENT_FILES } from '../src/engine/library.js';
import { MoviePlayer } from '../src/engine/player.js';
const UPSTREAM = 'https://raw.githubusercontent.com/microsoft/Microsoft-3D-Movie-Maker/104b2653e68046c2f6373186169f281006db35b1/cd3/3DMOVIE/';
const fetchBuf = async (n) => new Uint8Array(await (await fetch(UPSTREAM + n)).arrayBuffer());
const lib = new Library(await Promise.all(CONTENT_FILES.map(async (n) => new ChunkyFile(await fetchBuf(n), n))));
const p = new MoviePlayer(new ChunkyFile(fs.readFileSync(process.argv[2]), 'movie'), lib);
p.loadScene(0);
let n = 0;
do {
  if (n++ % 60 === 0) console.log(p.sceneIndex, p.frame, p.bkgd?.name, 'cam', p.icam, p.visibleActors.map((a) => `${a.tmpl.name}@${a.rootMatrix.slice(9).map((v) => v.toFixed(1))} ${a.anid}/${a.celn} parts${a.parts.filter((x) => x.model).length}/${a.parts.length}`).join(' | '));
} while (p.step());
console.log('frames', n, p.warnings);
