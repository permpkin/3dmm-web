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
  };

  /** Named event → Sentry breadcrumb + GA4 event. Use snake_case — GA4
   *  rejects dots in event names. */
  track = (action, data = {}) => {
    if (this.sentryOn) Sentry.addBreadcrumb({ category: 'app', message: action, data, level: 'info' });
    (window as any).gtag?.('event', action, data);
  };

  /** Non-fatal error → Sentry exception + GA exception event. */
  error = (err, context = {}) => {
    if (this.sentryOn) Sentry.captureException(err, { extra: context });
    (window as any).gtag?.('event', 'exception', { description: String(err), ...context });
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
      if (s.playing !== p.playing) this.track(s.playing ? 'playback_play' : 'playback_stop');
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
