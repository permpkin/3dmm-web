import * as Sentry from '@sentry/browser';
import { useUiState, useEditState, appState } from './appState.ts';
// Telemetry — one `track()` fans an event out to Sentry breadcrumbs and
// Google Analytics. Everything degrades to no-ops without the env vars, so
// call sites never guard. Store subscriptions + a property trap on
// editorTools.tool cover the whole internal event surface; action sites that
// carry data (movie open/save, packs) call track() directly.
class Telemetry {
  gaId = import.meta.env.VITE_GA_MEASUREMENT_ID || '';
  sentryOn = !!import.meta.env.VITE_SENTRY_DSN;
  /** Set by movieDocument — returns the working doc's {bytes, name, scene,
   *  frame} so error events can carry the movie + position, or null. */
  movieContext: (() => any) | null = null;
  _seenErrors = new Set();

  /** Inject gtag.js and wire the store subscriptions — called once from main. */
  init = () => {
    if (this.gaId) { // deferred script + the classic dataLayer shim
      const w = window as any;
      w.dataLayer = w.dataLayer || [];
      w.gtag = w.gtag || function () { w.dataLayer.push(arguments); };
      const s = document.createElement('script');
      s.async = true;
      s.src = `https://www.googletagmanager.com/gtag/js?id=${this.gaId}`;
      document.head.appendChild(s);
      w.gtag('js', new Date());
      w.gtag('config', this.gaId);
    }
    this._wireStores();
    this._trackUrlParams();
  };

  /** Report which URL params drove this session — param names and small safe
   *  values only (never URLs or file names). Also stashed as a Sentry context
   *  so every error event shows the params that were in play. */
  _trackUrlParams = () => {
    if (typeof location === 'undefined') return;
    const KNOWN = ['3mm', 'mode', 'scene', 'frame', 'play', 'opts', 'renderOptions', 'menu', 'packs', 'vxp', 'lang', 'sf', 'castid'];
    const q = new URLSearchParams(location.search);
    const used = KNOWN.filter((k) => q.has(k)), unknown = [...new Set(q.keys())].filter((k) => !KNOWN.includes(k));
    if (!used.length && !unknown.length) return;
    const specs = (v) => { let d = 0, n = 1; for (const c of v) { if (c === '{') d++; else if (c === '}') d = Math.max(0, d - 1); else if (c === ',' && !d) n++; } return n; }; // top-level count, brace alternates excluded
    const data: Record<string, any> = { params: used.join(',') };
    if (unknown.length) data.params_unknown = unknown.length;
    for (const k of ['mode', 'lang', 'scene', 'frame']) if (q.has(k)) data[k] = q.get(k);
    for (const k of ['packs', 'vxp']) if (q.has(k)) data[k] = specs(q.get(k));
    if (this.sentryOn) Sentry.setContext('url_params', data);
    this.track('url_params', data);
  };

  /** Named event → Sentry breadcrumb + GA4 event. Use snake_case — GA4
   *  rejects dots in event names. */
  track = (action, data = {}) => {
    if (this.sentryOn) Sentry.addBreadcrumb({ category: 'app', message: action, data, level: 'info' });
    (window as any).gtag?.('event', action, data);
  };

  /** Non-fatal error → Sentry exception + GA exception event. The working
   *  movie rides along as a .3mm attachment (+ name/scene/frame in `extra`)
   *  when one is open; `attach` overrides with caller-supplied bytes (e.g.
   *  the buffer that failed to open). */
  error = (err, context: Record<string, any> = {}, attach?: Uint8Array) => {
    let m: any = null;
    try { m = this.movieContext?.(); } catch { /* un-serializable doc — report anyway */ }
    const pos = m ? { movie: m.name, scene: m.scene, frame: m.frame } : {};
    if (this.sentryOn) {
      const bytes = attach || m?.bytes;
      const base = (attach ? context.name : m?.name) || 'movie';
      Sentry.captureException(err, {
        captureContext: { extra: { ...context, ...pos } },
        attachments: bytes ? [{ filename: /\.3mm$/i.test(base) ? base : `${base}.3mm`, data: bytes }] : undefined,
      });
    }
    (window as any).gtag?.('event', 'exception', { description: String(err), ...context, ...pos });
  };

  /** error() deduped by message — for per-frame failure loops (renderer)
   *  where the same throw would otherwise flood Sentry/GA. */
  errorOnce = (err, context: Record<string, any> = {}, attach?: Uint8Array) => {
    const k = String(err);
    if (this._seenErrors.has(k)) return;
    this._seenErrors.add(k);
    this.error(err, context, attach);
  };

  /** Sentry-only breadcrumb — for high-frequency chatter that shouldn't
   *  become a GA event (asset loads, etc.). */
  crumb = (message, data = {}, category = 'app', level: Sentry.SeverityLevel = 'info') => {
    if (this.sentryOn) Sentry.addBreadcrumb({ category, message, data, level });
  };

  /** Trace span when Sentry is on — the callback always runs. */
  span = (name, fn) =>
    this.sentryOn ? Sentry.startSpan({ name, op: 'app' }, fn) : fn();

  /** The Sentry feedback dialog is available (DSN set + integration added). */
  get feedbackEnabled() { return this.sentryOn && !!Sentry.getFeedback?.(); }

  /** Open the Sentry bug-report dialog — no-op without a DSN. */
  report = async () => {
    const fb = this.sentryOn && Sentry.getFeedback?.();
    if (!fb) return;
    this.track('report_open');
    try {
      const dialog = await fb.createForm();
      dialog.appendToDom();
      dialog.open();
    } catch (e) { this.error(e, { op: 'report' }); }
  };

  /** Diff the stores into events — catches every transition regardless of
   *  which call site triggered it. */
  _wireStores = () => {
    useUiState.subscribe((s, p) => {
      if (s.playing !== p.playing) {
        const mp = appState.moviePlayer;
        // last frame of the last scene = the movie ran out, not a user pause
        const ended = !s.playing && mp?.movie && mp.sceneIndex === mp.movie.scenes.length - 1 && mp.frame >= mp.scene?.nfrmLast;
        this.track(s.playing ? 'playback_play' : ended ? 'playback_end' : 'playback_pause', { scene: mp?.sceneIndex });
      }
      if (s.topView !== p.topView && s.topView) this.track('ui_view', { view: (s.topView as any).constructor.name });
    });
    useEditState.subscribe((s, p) => {
      if (s.selectedChildId !== p.selectedChildId) this.track(s.selectedChildId >= 0 ? 'actor_select' : 'actor_deselect', { id: s.selectedChildId });
      if (s.selectedTextboxId !== p.selectedTextboxId) this.track(s.selectedTextboxId >= 0 ? 'textbox_select' : 'textbox_deselect', { id: s.selectedTextboxId });
      if (s.focusedTextboxId !== p.focusedTextboxId && s.focusedTextboxId >= 0) this.track('textbox_focus', { id: s.focusedTextboxId });
      if (s.pendingPlacement !== p.pendingPlacement && s.pendingPlacement) this.track('placement_arm');
    });
    // editorTools is a shared mutable object — property writes don't go
    // through the store, so trap `tool` to observe every arm/disarm.
    const tools = appState.editorTools;
    let tool = tools.tool;
    Object.defineProperty(tools, 'tool', {
      configurable: true, enumerable: true,
      get: () => tool,
      set: (v) => { if (v !== tool) { tool = v; this.track('tool_arm', { tool: v }); } },
    });
  };
}

export const telemetry = new Telemetry();
