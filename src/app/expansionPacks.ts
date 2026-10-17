import { unzipSync } from 'fflate';
import { ChunkyFile, readGL } from '../format/chunky.ts';
import { bootView } from './ui/bootView.ts';
import { packTextures } from './resources.ts';
import { appState } from './appState.ts';
import { thumbnails } from './thumbnails.ts';
import { localizer } from './localization.ts';

/** IndexedDB cache for downloaded .vxp archives — keyed by resolved URL so
 *  repeat visits skip the network entirely. Resolves null when IDB is
 *  unavailable; a cache miss just fetches. */
class VxpCache {
  _db = null;
  open() {
    if (this._db) return Promise.resolve(this._db);
    return new Promise((res) => {
      const rq = indexedDB.open('mmsvxp', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('vxps');
      rq.onsuccess = () => { this._db = rq.result; res(this._db); };
      rq.onerror = () => res(null);
    });
  }
  /** Cached zip bytes for `url`, or null. */
  async get(url) {
    const db = await this.open(); if (!db) return null;
    return new Promise((res) => {
      const rq = db.transaction('vxps').objectStore('vxps').get(url);
      rq.onsuccess = () => res(rq.result?.bytes ?? null);
      rq.onerror = () => res(null);
    });
  }
  /** Store zip bytes for `url` — fire-and-forget. */
  async put(url, bytes) {
    const db = await this.open(); if (!db) return;
    db.transaction('vxps', 'readwrite').objectStore('vxps').put({ bytes }, url);
  }
}
const vxpCache = new VxpCache();

// --- asset packs (?packs=) and vxp expansions (?vxp=) --------------------------
// Files are routed by extension: .3cn/.chk register a content library (actors,
// props, backgrounds, materials, sounds; .chk files are the expansion's merge
// patches — a 256-entry GLCR inside one is the pack's social palette for its
// thumbnails), .3th/.nth append browser thumbnails, .png/.cur override UI
// textures/cursors by basename. Pack chunks are purely additive (builtin
// content wins cno collisions). A .vxp is a renamed zip of the same files
// (plus a v3dmm .cfg), fetched once and cached in IndexedDB.
class ExpansionPacks {
  // ?packs=url[,url...] — each entry is an assets.json URL (or a directory
  // ending in assets.json). Fetch manifests up front; the files are applied
  // below once the content library + thumbnail structures exist.
  manifestsPromise = Promise.all(this._specs('packs')
    .map(async (spec) => {
      const url = /\.json([?#]|$)/i.test(spec) ? spec : `${spec.replace(/\/*$/, '/')}assets.json`;
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`${r.status}`);
        const m = await r.json();
        const files = Array.isArray(m) ? m : m?.files;
        if (!Array.isArray(files)) throw new Error('no files array');
        return { url: new URL(url, location.href).href, files };
      } catch (e) { console.warn(`pack ${spec}: ${e.message}`); return null; }
    }));

  // ?vxp=url[,url...] — each entry is a .vxp (zip) URL. Bytes come from the
  // IndexedDB cache when present, else fetched + stored; entries unzip here
  // and are applied below alongside the asset packs.
  vxpPromise = Promise.all(this._specs('vxp')
    .map(async (spec) => {
      const url = new URL(spec, location.href).href;
      try {
        let bytes: any = await vxpCache.get(url);
        if (!bytes) {
          const r = await fetch(url);
          if (!r.ok) throw new Error(`${r.status}`);
          bytes = await r.arrayBuffer();
          vxpCache.put(url, bytes);
        }
        const entries = unzipSync(new Uint8Array(bytes));
        return { url, name: decodeURIComponent(spec.split('/').pop().replace(/\.vxp$/i, '')), entries };
      } catch (e) { console.warn(`vxp ${spec}: ${e.message}`); return null; }
    }));

  /** Comma-separated ?param= list — a prototype method so the field
   *  initializers above can call it. Splits on commas outside {} only, so
   *  brace alternates stay intact for _expandSpec. */
  _specs(param) {
    const raw = new URLSearchParams(location.search).get(param) || '';
    const out = [];
    let depth = 0, cur = '';
    for (const ch of raw) {
      if (ch === '{') depth++;
      else if (ch === '}') depth = Math.max(0, depth - 1);
      if (ch === ',' && !depth) { if (cur) out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    if (cur) out.push(cur);
    return out.flatMap((s) => this._expandSpec(s));
  }

  /** Expand one spec's {a,b,c} groups — "host/{p1,p2}.vxp" yields one URL
   *  per alternate (cartesian product across multiple groups). */
  _expandSpec(spec) {
    const parts = spec.split(/(\{[^}]*\})/);
    return parts
      .map((s) => (s.length > 1 && s.startsWith('{') && s.endsWith('}') ? s.slice(1, -1).split(',') : [s]))
      .reduce((acc, opts) => acc.flatMap((p) => opts.map((o) => p + o)), ['']);
  }

  packNotes: string[] = []; // user-visible results, toasted after boot

  /** Fetch every pack's files and merge them into the content library,
   *  thumbnails, and sound lists — ticking the boot progress bar per file
   *  (this all runs while the splash is still up). packNotes only collects
   *  failures — clean loads are silent. */
  applyAll = async () => {
    const packs = await this.manifestsPromise;
    const vxps = await this.vxpPromise;
    const total = packs.length + vxps.length;
    const tick = total ? bootView.segment(0.35) : null; // packs tick the same bar as the rest of boot
    let done = 0;
    const cap = () => localizer.translate('boot.pack');
    for (const pack of packs) {
      const dir = pack ? new URL(pack.url).pathname.replace(/\/[^/]*$/, '').split('/').pop() : null;
      if (!pack) { this.packNotes.push(localizer.translate('pack.failedGeneric')); tick?.(++done / total, cap()); continue; }
      try {
        let got = 0;
        const items = await Promise.all(pack.files.map(async (rel) => {
          try {
            const r = await fetch(new URL(rel, pack.url).href);
            if (!r.ok) throw new Error(`${r.status}`);
            return { base: decodeURIComponent(String(rel).split('/').pop()), bytes: new Uint8Array(await r.arrayBuffer()) };
          } catch (e) { console.warn(`pack ${rel}:`, e.message); return null; }
          finally { tick?.((done + ++got / pack.files.length) / total, cap()); }
        }));
        this._applyItems(items);
        if (items.includes(null)) this.packNotes.push(localizer.translate('pack.loaded', { name: dir || localizer.translate('pack.unnamed'), loaded: items.filter(Boolean).length, total: pack.files.length })); // partial — surface it
      } catch (e) { console.warn(`pack ${pack.url}:`, e.message); this.packNotes.push(localizer.translate('pack.failed', { name: dir || localizer.translate('pack.unnamed') })); }
      tick?.(++done / total, cap());
    }
    for (const vxp of vxps) {
      if (!vxp) { this.packNotes.push(localizer.translate('pack.failedGeneric')); tick?.(++done / total, cap()); continue; }
      try {
        const items = Object.entries(vxp.entries).map(([path, bytes]: [string, any]) => ({ base: decodeURIComponent(path.split('/').pop()), bytes }));
        this._applyItems(items);
      } catch (e) { console.warn(`vxp ${vxp.url}:`, e.message); this.packNotes.push(localizer.translate('pack.failed', { name: vxp.name })); }
      tick?.(++done / total, cap());
    }
  };

  /** Route a pack's files by extension — chunky files into the content
   *  library (+ .3th scans), png/cur into texture overrides. `.cfg` is the
   *  v3dmm mod descriptor — parsed only for a display name. Returns the
   *  applied-file count. */
  _applyItems = (items) => {
    const cfs = [], ths = [];
    let packPal = null, loaded = 0;
    for (const it of items) {
      if (!it) continue;
      const ext = (it.base.split('.').pop() || '').toLowerCase();
      if (ext === '3cn' || ext === 'chk' || ext === '3th' || ext === 'nth') {
        const chunkyFile = new ChunkyFile(it.bytes, it.base);
        if (ext === '3cn' || ext === 'chk') {
          cfs.push(chunkyFile);
          if (!packPal) { // first 256-entry GLCR = the pack's social palette (CLR is b,g,r,0)
            const gl = [...chunkyFile.ofType('GLCR')].map((c) => { try { return readGL(chunkyFile.data('GLCR', c.cno)); } catch { return null; } })
              .find((g) => g && g.entries.length === 256);
            if (gl) { packPal = new Uint8Array(768); gl.entries.forEach((e, i) => { packPal[i * 3] = e[2]; packPal[i * 3 + 1] = e[1]; packPal[i * 3 + 2] = e[0]; }); }
          }
        } else ths.push(chunkyFile);
      } else if (ext === 'png' || ext === 'cur') {
        packTextures.set(it.base, URL.createObjectURL(new Blob([it.bytes])));
      } else { console.warn(`pack: skipped ${it.base}`); continue; }
      loaded++;
    }
    appState.contentLibrary.content.push(...cfs); // before the .3th scan so chunk names resolve
    for (const th of ths) thumbnails.scanThumbnailFile(th, packPal);
    return loaded;
  };
}

export const expansionPacks = new ExpansionPacks();
