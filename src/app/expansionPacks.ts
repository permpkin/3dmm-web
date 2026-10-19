import { unzipSync } from 'fflate';
import { ChunkyFile, readGL } from '../format/chunky.ts';
import { bootView } from './ui/bootView.ts';
import { packTextures } from './resources.ts';
import { appState } from './appState.ts';
import { thumbnails } from './thumbnails.ts';
import { localizer } from './localization.ts';
import { telemetry } from './telemetry.ts';

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

/** localStorage registry for imported addons — [{type, spec, name, enabled}]. */
const ADDON_KEY = 'mmsaddons';

/** Filenames in public/packages/ — baked in by vite.config.ts's define at
 *  build time. Each becomes a bundled addon spec, listed but disabled until
 *  the user turns it on. */
declare const __BUNDLED_PACKAGES__: string[] | undefined;
const BUNDLED: string[] = (typeof __BUNDLED_PACKAGES__ !== 'undefined' ? __BUNDLED_PACKAGES__ : []) as string[];

// --- asset packs, vxp expansions, and single files -----------------------------
// Files are routed by extension: .3cn/.chk register a content library (actors,
// props, backgrounds, materials, sounds; .chk files are the expansion's merge
// patches — a 256-entry GLCR inside one is the pack's social palette for its
// thumbnails), .3th/.nth append browser thumbnails, .png/.cur override UI
// textures/cursors by basename. Pack chunks are purely additive (builtin
// content wins cno collisions). A .vxp is a renamed zip of the same files
// (plus a v3dmm .cfg), fetched once and cached in IndexedDB.
//
// Every applied spec becomes an `addon` record {type, spec, name, enabled,
// failed, source:'url'|'stored', items, contrib} — the options dialog's
// addons tab manages them: disable reverses the contributions, remove drops
// the record, and stored addons persist to localStorage so they re-apply on
// the next boot.
class ExpansionPacks {
  /** Loaded addon records, in apply order. */
  addons: any[] = [];
  /** User-visible results, toasted after boot — only failures land here. */
  packNotes: string[] = [];

  // --- registry --------------------------------------------------------------
  /** Stored addon entries — read once per boot list build. */
  _stored() { try { return JSON.parse(localStorage.getItem(ADDON_KEY) || '[]'); } catch { return []; } }
  /** Persist the stored addons (URL-sourced ones are session-only; bundled
   *  defaults persist so an enabled one stays on across reloads). */
  _persist() {
    try { localStorage.setItem(ADDON_KEY, JSON.stringify(this.addons.filter((a) => a.source !== 'url').map(({ type, spec, name, enabled }) => ({ type, spec, name, enabled })))); }
    catch { /* quota */ }
  }
  /** Display name for a spec — basename sans extension (an assets.json
   *  manifest names its directory instead). */
  _specName = (spec) =>
    decodeURIComponent((spec.split(/[?#]/)[0].replace(/\/assets\.json$/i, '').replace(/\/+$/, '').split('/').pop() || 'pack').replace(/\.[^.]+$/, ''));

  /** Settle an entry's type from the spec itself: .vxp/.zip are archives,
   *  .json is a pack manifest, anything else with an extension is a single
   *  file — extensionless/directory specs fall back to `hint` (the URL
   *  param that supplied them, or 'pack' from the import form). */
  _inferType(spec, hint = 'pack') {
    if (/\.(vxp|zip)([?#]|$)/i.test(spec)) return 'vxp';
    if (/\.json([?#]|$)/i.test(spec)) return 'pack';
    const last = (spec.split(/[?#]/)[0].replace(/\/+$/, '').split('/').pop() || '');
    return /\.[a-z0-9]+$/i.test(last) ? 'file' : hint;
  }

  /** Normalized spec key for dedupe — same file spelled with/without a
   *  leading slash counts once. */
  _specKey = (spec) => spec.split(/[?#]/)[0].replace(/^\/+/, '').replace(/\/+$/, '');

  /** The boot entry list — the stored registry merged with ?packs=/?vxp=
   *  specs and the bundled public/packages/ defaults; a spec in more than
   *  one source keeps the earlier record (stored > bundled > url — so a
   *  stored enabled flag wins over the bundled disabled default). The param
   *  only breaks the tie for extensionless specs — a .3cn under ?vxp= still
   *  loads as a single file. */
  _entries() {
    const stored = this._stored();
    const specs = [
      ...this._specs('packs').map((spec) => ({ type: this._inferType(spec, 'pack'), spec })),
      ...this._specs('vxp').map((spec) => ({ type: this._inferType(spec, 'vxp'), spec })),
    ];
    const taken = new Set(stored.map((s) => this._specKey(s.spec)));
    const take = (spec) => !taken.has(this._specKey(spec)) && taken.add(this._specKey(spec)); // claim-or-skip
    const bundled = BUNDLED.map((f) => `packages/${f}`) // relative — resolves under the app mount
      .filter(take)
      .map((spec) => ({ type: this._inferType(spec), spec, source: 'bundled', enabled: false }));
    const urlOnly = specs.filter((x) => take(x.spec));
    return [...stored.map((s) => ({ ...s, source: 'stored' })), ...bundled,
      ...urlOnly.map((s) => ({ ...s, source: 'url', enabled: true }))];
  }

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

  // --- fetching --------------------------------------------------------------
  /** Fetch one entry's files as {base, bytes} items — pack manifests first,
   *  then every listed file; vxp bytes come from the IDB cache when present;
   *  'file' entries are the URL itself. `sub(0..1)` reports progress into
   *  the boot bar segment. */
  _fetchItems = async (entry, sub?) => {
    if (entry.type === 'vxp') {
      const url = new URL(entry.spec, location.href).href;
      let bytes: any = await vxpCache.get(url);
      if (!bytes) {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`${r.status}`);
        bytes = await r.arrayBuffer();
        vxpCache.put(url, bytes);
      }
      sub?.(0.9);
      return Object.entries(unzipSync(new Uint8Array(bytes))).map(([path, b]: [string, any]) => ({ base: decodeURIComponent(path.split('/').pop()), bytes: b }));
    }
    if (entry.type === 'file') { // one URL, one file — routed by extension in _apply
      const url = new URL(entry.spec, location.href).href;
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status}`);
      sub?.(0.9);
      const base = decodeURIComponent((entry.spec.split(/[?#]/)[0].replace(/\/+$/, '').split('/').pop()) || 'file');
      return [{ base, bytes: new Uint8Array(await r.arrayBuffer()) }];
    }
    // pack: spec → assets.json url → fetch the manifest then every listed file
    const url = /\.json([?#]|$)/i.test(entry.spec) ? entry.spec : `${entry.spec.replace(/\/*$/, '/')}assets.json`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status}`);
    const m = await r.json();
    const files = Array.isArray(m) ? m : m?.files;
    if (!Array.isArray(files)) throw new Error(localizer.translate('pack.noFiles'));
    const base = new URL(url, location.href).href;
    let got = 0;
    const items = await Promise.all(files.map(async (rel) => {
      try {
        const rr = await fetch(new URL(rel, base).href);
        if (!rr.ok) throw new Error(`${rr.status}`);
        return { base: decodeURIComponent(String(rel).split('/').pop()), bytes: new Uint8Array(await rr.arrayBuffer()) };
      } catch (e) { console.warn(`pack ${rel}:`, e.message); return null; }
      finally { sub?.(++got / files.length); }
    }));
    if (items.includes(null)) this.packNotes.push(localizer.translate('pack.loaded', { name: this._specName(entry.spec), loaded: items.filter(Boolean).length, total: files.length })); // partial — surface it
    return items;
  };

  // --- apply / unapply ---------------------------------------------------------
  /** Route an addon's files by extension and record the contributions —
   *  chunky files into the content library (+ .3th scans), png/cur into
   *  texture overrides. `.cfg` is the v3dmm mod descriptor — parsed only for
   *  a display name. */
  _apply = (addon, sub?) => {
    const rec = { cfs: [], ths: [], scans: [], tex: new Map(), skipped: [] };
    let packPal = null, loaded = 0, n = 0;
    const wApply = 0.7, wScan = 0.3; // item parse ~70%, .3th scans ~30% of the phase
    for (const it of addon.items) {
      sub?.(++n / addon.items.length * wApply);
      if (!it) continue;
      const ext = (it.base.split('.').pop() || '').toLowerCase();
      if (ext === '3cn' || ext === 'chk' || ext === '3th' || ext === 'nth') {
        const chunkyFile = new ChunkyFile(it.bytes, it.base);
        if (ext === '3cn' || ext === 'chk') {
          rec.cfs.push(chunkyFile);
          if (!packPal) { // first 256-entry GLCR = the pack's social palette (CLR is b,g,r,0)
            const gl = [...chunkyFile.ofType('GLCR')].map((c) => { try { return readGL(chunkyFile.data('GLCR', c.cno)); } catch { return null; } })
              .find((g) => g && g.entries.length === 256);
            if (gl) { packPal = new Uint8Array(768); gl.entries.forEach((e, i) => { packPal[i * 3] = e[2]; packPal[i * 3 + 1] = e[1]; packPal[i * 3 + 2] = e[0]; }); }
          }
        } else rec.ths.push(chunkyFile);
      } else if (ext === 'png' || ext === 'cur') {
        rec.tex.set(it.base, it.bytes);
      } else { rec.skipped.push(it.base); continue; }
      loaded++;
    }
    appState.contentLibrary.content.push(...rec.cfs); // before the .3th scan so chunk names resolve
    rec.ths.forEach((th, i) => { rec.scans.push(thumbnails.scanThumbnailFile(th, packPal)); sub?.(wApply + (i + 1) / rec.ths.length * wScan); });
    for (const [name, bytes] of rec.tex) packTextures.set(name, URL.createObjectURL(new Blob([bytes])));
    addon.contrib = rec;
    addon.loaded = loaded;
    addon.skipped = rec.skipped;
    sub?.(1);
  };

  /** Reverse `_apply` — content files out of the library, thumbnail entries
   *  unregistered, texture overrides dropped (blob URLs revoked). Parse caches
   *  keyed by file name become unreachable on their own. */
  _unapply = (addon) => {
    const rec = addon.contrib;
    if (!rec) return;
    const cl = appState.contentLibrary;
    cl.content = cl.content.filter((cf) => !rec.cfs.includes(cf));
    for (const cf of rec.cfs) cl.evict(cf); // stale parses keyed by file name
    for (const s of rec.scans) thumbnails.unscan(s);
    for (const name of rec.tex.keys()) {
      const u = packTextures.get(name);
      packTextures.delete(name);
      if (u?.startsWith('blob:')) URL.revokeObjectURL(u);
    }
    thumbnails.rollCallThumbCache.clear();
    addon.contrib = null;
  };

  /** Fetch every entry's files and merge them — ticking the boot progress
   *  bar per entry (this all runs while the splash is still up). Disabled
   *  stored addons register (so the addons tab can list them) but skip the
   *  network entirely. */
  applyAll = async () => {
    const entries = this._entries();
    const total = entries.length;
    const tick = total ? bootView.segment(0.35) : null;
    let done = 0;
    const cap = () => localizer.translate('boot.pack');
    // all enabled entries fetch in parallel — failures resolve to the error
    // (fetch covers ~80% of an entry's segment; its _apply finishes the rest)
    const pending = entries.map((e) => e.enabled === false ? null
      : this._fetchItems(e, (f) => tick?.((done + f * 0.8) / total, cap())).catch((err) => err));
    for (const [i, e] of entries.entries()) {
      const addon = { ...e, name: e.name || this._specName(e.spec), enabled: e.enabled !== false, failed: false };
      this.addons.push(addon);
      const res = pending[i] && await pending[i];
      if (res instanceof Error) {
        addon.failed = true;
        console.warn(`addon ${e.spec}:`, res);
        this.packNotes.push(localizer.translate('pack.failed', { name: addon.name }));
      } else if (res) {
        addon.items = res;
        try { this._apply(addon); }
        catch (err) { // a bad file (e.g. non-chunky .3cn) fails the addon, not the boot
          addon.failed = true;
          console.warn(`addon ${e.spec}:`, err);
          this.packNotes.push(localizer.translate('pack.failed', { name: addon.name }));
        }
      }
      tick?.(++done / total, cap());
    }
    if (total) {
      telemetry.track('packs_load', { packs: this.addons.filter((a) => a.type === 'pack').length, vxps: this.addons.filter((a) => a.type === 'vxp').length, files: this.addons.filter((a) => a.type === 'file').length, failed: this.packNotes.length });
      for (const note of this.packNotes) telemetry.error(new Error(note), { op: 'packs_load' });
    }
  };

  // --- runtime management ------------------------------------------------------
  /** Enable/disable an addon — disable reverses its contributions; enable
   *  re-applies (fetching lazily when the items were never loaded). */
  setEnabled = async (addon, on) => {
    if (on && !addon.contrib) {
      if (!addon.items) addon.items = await this._fetchItems(addon);
      this._apply(addon);
    } else if (!on) this._unapply(addon);
    addon.enabled = on;
    addon.failed = false;
    this._persist();
  };

  /** Drop the addon entirely — contributions reversed, record removed,
   *  registry persisted (URL-sourced addons just vanish for the session). */
  remove = (addon) => {
    this._unapply(addon);
    const i = this.addons.indexOf(addon);
    if (i >= 0) this.addons.splice(i, 1);
    this._persist();
  };

  /** Import a new addon at runtime — fetches, applies, registers as stored,
   *  persists. The spec's extension settles the type (.vxp/.zip archive,
   *  .json manifest, any other extension a single file, extensionless a
   *  pack directory). `progress(0..1)` covers fetch (0..0.8) then parse/scan
   *  (0.8..1) so 100% only lands when the addon is actually live. Throws on
   *  fetch/parse failure — the caller surfaces it. */
  import = async (spec, progress?) => {
    spec = spec.trim();
    const addon: any = { type: this._inferType(spec), spec, name: this._specName(spec), enabled: true, source: 'stored', failed: false };
    addon.items = await this._fetchItems(addon, (f) => progress?.(f * 0.8));
    this._apply(addon, (f) => progress?.(0.8 + f * 0.2));
    this.addons.push(addon);
    this._persist();
    return addon;
  };

  /** Movie dependencies on this addon's content files — every tag the open
   *  movie uses that ONLY its files can resolve (builtin files and other
   *  addons still covering the tag don't count). Returns [{scene, actor?}]
   *  for the gate dialog; [] when it's safe to disable/remove. Chunk-internal
   *  cross-file references (e.g. a pack template's MTRL in another file)
   *  aren't walked — the check covers the movie's direct tag surface. */
  dependencies = (addon) => {
    const mp = appState.moviePlayer;
    const files = addon.contrib?.cfs || [];
    if (!mp?.movie || !files.length) return [];
    const cl = appState.contentLibrary;
    const covered = (tag) => {
      if (tag.sid === 0 && cl.movieFile?.has(tag.ctg, tag.cno)) return true;
      for (const cf of cl.content) if (!files.includes(cf) && cf.has(tag.ctg, tag.cno)) return true;
      if (cl.movieFile?.has(tag.ctg, tag.cno)) return true;
      return false;
    };
    const deps = new Map();
    const seen = new Set();
    const note = (tag, ctx) => {
      if (tag.sid !== 0 && tag.sid !== 2) return; // only file-resolved sids can hit an addon
      if (files.some((cf) => cf.has(tag.ctg, tag.cno)) && !covered(tag)) {
        const key = `${ctx.scene}:${ctx.actor || ''}`;
        if (!deps.has(key)) deps.set(key, ctx);
      }
    };
    const isTag = (v) => v && typeof v === 'object' && typeof v.ctg === 'string' && v.ctg.length === 4 && typeof v.cno === 'number' && 'sid' in v;
    const walk = (v, ctx) => {
      if (!v || typeof v !== 'object' || v instanceof Uint8Array || v instanceof ChunkyFile || seen.has(v)) return;
      seen.add(v);
      if (isTag(v)) { note(v, ctx); return; }
      if (v instanceof Map) for (const x of v.values()) walk(x, ctx);
      else if (Array.isArray(v)) for (const x of v) walk(x, ctx);
      else for (const k in v) walk(v[k], ctx);
    };
    mp.movie.scenes.forEach((s, i) => {
      walk(s.frameEvents, { scene: i + 1 });
      walk(s.startEvents, { scene: i + 1 });
      walk(s.textboxes, { scene: i + 1 });
      for (const a of s.actors.values()) {
        walk(a.tagTmpl, { scene: i + 1, actor: a.name });
        walk(a.events, { scene: i + 1, actor: a.name });
      }
    });
    if (mp.movie.rollCall) for (const r of mp.movie.rollCall.values()) walk(r.tagTmpl, { scene: 0, actor: r.name });
    return [...deps.values()];
  };
}

export const expansionPacks = new ExpansionPacks();
