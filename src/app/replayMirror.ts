// Sentry session-replay mirror — feeds a display-resolution copy of the #ui
// canvas to ReplayCanvas's manual snapshot API. Sentry replays canvases as an
// <img> inside the recorded element styled max-width/height:100%, which only
// ever SHRINKS the snapshot bitmap — a canvas whose backing store (640x480)
// is smaller than its CSS box replays tiny in the corner. The real #ui keeps
// its fixed 640x480 buffer untouched; this sibling sits under it sharing its
// box, gets the same image blitted at display res, and is the only canvas
// snapshotted — the recorded #ui stays empty/transparent over it in replays.
import { elementById } from './resources.ts';
import { replayCanvas } from './sentry.ts';

class ReplayMirror {
  canvas: HTMLCanvasElement | null = null;
  ctx: CanvasRenderingContext2D | null = null;
  /** Insert the mirror canvas under #ui and start the snapshot pump. No-ops
   *  when Sentry is disabled or the stage DOM isn't there. */
  start() {
    if (!import.meta.env.VITE_SENTRY_DSN || this.canvas) return;
    const ui = elementById('ui');
    if (!ui?.parentNode) return;
    const c = this.canvas = document.createElement('canvas');
    c.id = 'uiMirror';
    ui.parentNode.insertBefore(c, ui); // under #ui — same box via #uiMirror CSS
    this.ctx = c.getContext('2d');
    this.ctx.imageSmoothingEnabled = false; // NN copy — same pixels #ui's own CSS upscale shows
    this._fit();
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this._fit()).observe(c);
    setInterval(() => this._tick(), 500); // ~2fps — matches the 'medium' canvas-quality cadence
  }

  /** Size the mirror's bitmap to its CSS box (<=1280 — Sentry's snapshot
   *  clamp) so the replayed img fills the recorded element. */
  _fit() {
    const r = this.canvas.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return; // hidden or pre-layout — keep last size
    const k = Math.min(1, 1280 / Math.max(r.width, r.height));
    const w = Math.ceil(r.width * k), h = Math.ceil(r.height * k);
    if (w === this.canvas.width && h === this.canvas.height) return;
    this.canvas.width = w; this.canvas.height = h;
    this.ctx.imageSmoothingEnabled = false; // buffer resize resets ctx state
  }

  /** Blit the current #ui frame into the mirror and hand it to Sentry. */
  _tick() {
    if (document.hidden) return;
    const ui = elementById('ui');
    if (!(ui instanceof HTMLCanvasElement) || !ui.width) return;
    this.ctx.drawImage(ui, 0, 0, this.canvas.width, this.canvas.height);
    replayCanvas.snapshot(this.canvas, { skipRequestAnimationFrame: true });
  }
}

export const replayMirror = new ReplayMirror();
