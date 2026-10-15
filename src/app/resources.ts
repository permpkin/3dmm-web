// Shared resources + micro-utils used across the whole app.
/** Vite base URL — '/' in dev, './' on pages builds. */
export const baseUrl = import.meta.env.BASE_URL;
/** Asset-pack overrides — 'name.png'/'name.cur' -> blob URL (see ?packs=). */
export const packTextures = new Map();
/** Texture URL by name — a pack override wins over the builtin textures/ dir. */
export const textureUrl = (name) => packTextures.get(`${name}.png`) || `${baseUrl}textures/${name}.png`;
/** Cursor URL by name — a pack override wins over the builtin cur/ dir. */
export const cursorUrl = (name) => packTextures.get(`${name}.cur`) || `${baseUrl}cur/${name}.cur`;
// Original-game binaries are NOT vendored — data/ (chunky content) and snd/
// (UI wavs) stream from the open-sourced repo. public/ keeps only the files
// generated for this port (textures/, local/, lang/).
const UPSTREAM = 'https://raw.githubusercontent.com/microsoft/Microsoft-3D-Movie-Maker/104b2653e68046c2f6373186169f281006db35b1/';
/** snd/ files that live outside SRC/STUDIO/SOUND/ upstream, by lowercase name. */
const SND_ALT_DIRS = {
  'alert2.wav': 'SRC/SHARED/SOUND/', 'bingo.wav': 'SRC/BUILDING/SOUND/LOBBY/', 'cancel.wav': 'SRC/SHARED/SOUND/MAP/',
  'mapopen.wav': 'SRC/SHARED/SOUND/', 'ok.wav': 'SRC/SHARED/SOUND/', 'splthndl.wav': 'SRC/BUILDING/SOUND/INSPIRAT/',
  'splot.wav': 'SRC/SHARED/SOUND/UTIL/', 'tbkopen.wav': 'SRC/SHARED/SOUND/', 'tbpageb1.wav': 'SRC/SHARED/SOUND/BIO/',
  'tbpageb2.wav': 'SRC/SHARED/SOUND/BIO/', 'tbpagef1.wav': 'SRC/SHARED/SOUND/BIO/', 'tbpagef2.wav': 'SRC/SHARED/SOUND/BIO/',
};
/** URL for a public/ asset — `data/*` and `snd/*` resolve to the upstream repo
 *  (upstream paths are UPPERCASE); everything else stays local under baseUrl. */
export const assetUrl = (rel) => {
  const slash = rel.indexOf('/');
  const dir = rel.slice(0, slash), file = rel.slice(slash + 1);
  if (dir === 'data') return `${UPSTREAM}cd3/3DMOVIE/${file.toUpperCase()}`;
  if (dir === 'snd') return `${UPSTREAM}${SND_ALT_DIRS[file] ?? 'SRC/STUDIO/SOUND/'}${file.toUpperCase()}`;
  return `${baseUrl}${rel}`;
};
/** document.getElementById shorthand for the few DOM overlays. */
export const elementById = (id) => document.getElementById(id);
/** Promise-wrapped setTimeout. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Toast sink — `toastHost.show(msg)` delegates to the canvas toast once the
// UI root registers a handler; resources.ts is a leaf module so it can't
// import the ui cycle directly.
class ToastHost {
  /** The active toast renderer — console fallback until the UI root registers. */
  handler = (msg) => console.log('[mms]', msg);
  /** Register the real toast renderer — called by the UI root at boot. */
  setHandler = (f) => { this.handler = f; };
  /** Show a toast — always logs; the canvas toast renders it once registered. */
  show = (msg) => { console.log('[mms]', msg); this.handler(msg); };
}
export const toastHost = new ToastHost();
