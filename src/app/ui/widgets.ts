// Shared canvas UI widgets — texture-backed button, slider, image, text link,
// text field, and the GL movie screen blit.
import { Element } from './element.ts';
import { CURSORS } from './cursorManager.ts';
import { textureCache } from './textureCache.ts';
import { elementById } from '../resources.ts';
import { localizer } from '../localization.ts';
import { uiRoot, UI_WIDTH, UI_HEIGHT } from './root.ts';

/** Draws a texture by name, fit/contain/cover into its rect. */
export class ImageElement extends Element {
  constructor(name, x, y, w, h, fit = 'fill') { super(x, y, w, h); this.name = name; this.fit = fit; this.pickable = false; }
  /** Paint the texture fitted into the rect (cover centers + crops). */
  draw(ctx) {
    const image = textureCache.image(this.name, () => this.dirty());
    if (!textureCache.isReady(image)) return;
    ctx.imageSmoothingEnabled = false;
    if (this.fit === 'cover') {
      const s = Math.max(this.w / image.naturalWidth, this.h / image.naturalHeight);
      const w = image.naturalWidth * s, h = image.naturalHeight * s;
      ctx.drawImage(image, (this.w - w) / 2, (this.h - h) / 2, w, h);
    } else ctx.drawImage(image, 0, 0, this.w, this.h);
  }
}

/** Up/down-faced bitmap button. up may be a function (play/stop face). */
export class ImageButton extends Element {
  /** `upFace` may be a texture name or a zero-arg function returning one
   *  (play/stop toggles); `downFace` is the pressed texture. */
  constructor(upFace, downFace, x, y, w, h, onClick) {
    super(x, y, w, h);
    this.upFace = upFace; this.downFace = downFace; this.action = onClick;
    this.pressed = false; this.cursor = CURSORS.pointer;
  }
  /** The texture name to draw — the function face, or pressed->downFace. */
  face() { return typeof this.upFace === 'function' ? this.upFace() : (this.pressed && this.downFace ? this.downFace : this.upFace); }
  /** Re-read face() — call when the backing state changes. */
  sync() { this.dirty(); }
  /** Paint the current face texture. */
  draw(ctx) {
    const image = textureCache.image(this.face(), () => this.dirty());
    if (textureCache.isReady(image)) { ctx.imageSmoothingEnabled = false; ctx.drawImage(image, 0, 0, this.w, this.h); }
  }
  /** Show the pressed face. */
  onPointerDown() { this.pressed = true; this.dirty(); }
  /** Release the pressed face. */
  onPointerUp() { if (this.pressed) { this.pressed = false; this.dirty(); } }
  /** Cancel the press when the pointer slides off. */
  onPointerLeave() { if (this.pressed) { this.pressed = false; this.dirty(); } }
  /** Fire the click action. */
  onClick() { this.action?.(); }
}

/** Text link (theatre 'settings') — bold Comic Sans, underline on hover. */
export class TextLink extends Element {
  constructor(text, x, y, w, h, onClick, { size = 10, color = '#3465a4', align = 'left' } = {}) {
    super(x, y, w, h);
    this.text = text; this.action = onClick;
    this.size = size; this.color = color; this.align = align;
    this.hover = false; this.cursor = CURSORS.pointer;
  }
  /** Paint the link text + hover underline. */
  draw(ctx) {
    ctx.fillStyle = this.color;
    ctx.font = `bold ${this.size}px 'Comic Sans MS', cursive, sans-serif`;
    ctx.textAlign = this.align; ctx.textBaseline = 'middle';
    const tx = this.align === 'center' ? this.w / 2 : this.align === 'right' ? this.w : 0;
    ctx.fillText(this.text, tx, this.h / 2);
    if (this.hover) {
      const m = ctx.measureText(this.text);
      const x0 = this.align === 'center' ? tx - m.width / 2 : this.align === 'right' ? tx - m.width : tx;
      ctx.fillRect(x0, this.h / 2 + this.size * 0.45, m.width, 1);
    }
  }
  /** Underline on hover. */
  onPointerEnter() { this.hover = true; this.dirty(); }
  /** Remove the underline. */
  onPointerLeave() { this.hover = false; this.dirty(); }
  /** Fire the click action. */
  onClick() { this.action?.(); }
}

/** Studio-style bitmap button — mirrors the old DOM stBtn idiom: `on`/`down`
    class flags, `syncFace()` face callback, `onclick` action, `enabled` gate, tip id. */
export class StudioButton extends Element {
  constructor(upFace, downFace, x, y, w, h, onclick, tipId = null) {
    super(x, y, w, h);
    this.upFace = upFace; this.downFace = downFace;
    this.onclick = onclick;
    this.tip = tipId; // localization key — the tooltip walk reads el.tip up the parent chain
    this.cursor = CURSORS.pointer;
    this.enabled = true;            // disabled buttons draw the 'd' face when set
    this.dim = false;           // 'brightness(.6)' down-face filter
    this.alpha = 1;
    this.faceOverride = null;   // explicit texture name (undo/anim faces)
    /** @type {string|undefined} */ this.toolId = undefined; // armed-tool id the face follows
    /** @type {string[]|undefined} */ this.animFaces = undefined; /** @type {number} */ this.animIndex = 0; // cycling faces
    const cl = new Set();
    this.classList = { // minimal DOM classList shim so ported logic is verbatim
      add: (c) => cl.add(c), remove: (c) => cl.delete(c),
      contains: (c) => cl.has(c), toggle: (c, f) => { f === undefined ? (cl.has(c) ? cl.delete(c) : cl.add(c)) : (f ? cl.add(c) : cl.delete(c)); },
    };
    this.classSet = cl;
    this.syncFace = () => { this.dirty(); };
  }
  /** True while pressed. */
  get isDown() { return this.classSet.has('down'); }
  /** True while armed/on. */
  get isOn() { return this.classSet.has('on'); }
  /** The texture name to draw — explicit override, else down-face while
   *  pressed/armed, else the up face. */
  face() {
    if (this.faceOverride) return this.faceOverride;
    return this.isOn || this.isDown ? this.downFace : this.upFace;
  }
  /** Paint the face texture — dimmed/alpha'd per the flags. */
  draw(ctx) {
    const image = textureCache.image(this.face(), () => this.dirty());
    if (!textureCache.isReady(image)) return;
    ctx.save();
    ctx.globalAlpha *= this.alpha;
    if (this.dim && ctx.filter !== undefined) ctx.filter = 'brightness(.6)';
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0, this.w, this.h);
    ctx.restore();
  }
  /** Press — disabled buttons swallow the click (return true). */
  onPointerDown() {
    if (!this.enabled) return true;
    this.classSet.add('down'); this.syncFace(); this.dirty();
  }
  /** Release the press. */
  onPointerUp() { this.classSet.delete('down'); this.syncFace(); this.dirty(); }
  /** Cancel the press when the pointer slides off. */
  onPointerLeave() { if (this.isDown) { this.classSet.delete('down'); this.syncFace(); this.dirty(); } }
  /** Fire the click action when enabled. */
  onClick() { if (this.enabled) this.onclick?.(); }
}

/** Vertical drag slider (theatre volume). thumb = texture name. */
export class VerticalSlider extends Element {
  /** `thumb` is a texture name; `onChange(value 0..1)` fires while dragging
   *  and on `set(v, true)`. */
  constructor(x, y, w, h, thumb, onChange) {
    super(x, y, w, h);
    this.thumb = thumb; this.onChange = onChange;
    this.value = 1; this.dragging = false;
  }
  /** Set the value — `fire` reports it through onChange. */
  set(v, fire = false) { this.value = Math.max(0, Math.min(1, v)); if (fire) this.onChange?.(this.value); this.dirty(); }
  /** Thumb's [y, height] for the current value — height scales with the
   *  texture's aspect, defaults 12 before it decodes. */
  thumbPos() { const th = textureCache.image(this.thumb); const thH = textureCache.isReady(th) ? this.w * th.naturalHeight / th.naturalWidth : 12; return [this.value * (this.h - thH), thH]; }
  /** Paint the thumb at the value position. */
  draw(ctx) {
    const image = textureCache.image(this.thumb, () => this.dirty());
    if (!textureCache.isReady(image)) return;
    const [ty, thH] = this.thumbPos();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, ty, this.w, thH);
  }
  /** Map a view-space point to the slider value and fire onChange. */
  _setFrom(p) { const [, thH] = this.thumbPos(); this.set((p.y - this.y - thH / 2) / (this.h - thH), true); }
  /** Start the drag and jump the thumb to the pointer. */
  onPointerDown(p) { this.dragging = true; this._setFrom(p); return true; }
  /** Track the drag. */
  onPointerMove(p) { if (this.dragging) this._setFrom(p); }
  /** End the drag. */
  onPointerUp() { this.dragging = false; }
}

/** Plain text element — font/color/align options; html-less lines via '\n'. */
export class TextElement extends Element {
  constructor(text, x, y, w, h, { size = 12, color = '#222', align = 'center', bold = true, font = null } = {}) {
    super(x, y, w, h);
    this.text = text; this.size = size; this.color = color; this.align = align;
    this.bold = bold; this.font = font; this.pickable = false;
  }
  /** Set the text (DOM-style alias for .text) — repaints on change. */
  set textContent(v) { if (v !== this.text) { this.text = v; this.dirty(); } }
  /** The element's text. */
  get textContent() { return this.text; }
  /** Paint the wrapped/centered text lines. */
  draw(ctx) {
    if (!this.text) return;
    ctx.fillStyle = this.color;
    ctx.font = `${this.bold ? 'bold ' : ''}${this.size}px ${this.font || `'Comic Sans MS', cursive, sans-serif`}`;
    ctx.textAlign = this.align; ctx.textBaseline = 'middle';
    const tx = this.align === 'center' ? this.w / 2 : this.align === 'right' ? this.w : 0;
    const lines = String(this.text).split('\n');
    const lh = this.size * 1.2, y0 = this.h / 2 - (lines.length - 1) * lh / 2;
    lines.forEach((l, i) => ctx.fillText(l, tx, y0 + i * lh, this.w - 4));
  }
}

/** One-shot first-boot stage reveal — consumed by the first MovieScreen to
 *  ask, so the stage fades in once instead of popping in mid-reveal. */
let stageRevealed = false;

/** The 3D movie screen — blits the GL canvas into its rect each repaint. */
export class MovieScreen extends Element {
  constructor(x, y, w, h) { super(x, y, w, h); this.pickable = false; this.playback = null; }
  /** Fade the blit in over a half second — first boot only; later calls
   *  (modal uncover, theatre hand-off) are no-ops. */
  bootFade() {
    if (stageRevealed) return;
    stageRevealed = true;
    this.opacity = 0;
    this.animate({ opacity: 1 }, { dur: 500 });
  }
  /** Blit the GL canvas into the rect. */
  draw(ctx) {
    const v = elementById('view');
    if (!v) return;
    ctx.imageSmoothingEnabled = true; // 3D content upscales smoother than pixel art
    ctx.drawImage(v, 0, 0, this.w, this.h);
    ctx.imageSmoothingEnabled = false;
  }
  /** Per-frame — repaint so the blit always shows the freshest GL frame. */
  frame() { this.dirty(); }
}

// --- TextField: canvas single-line text input --------------------------------
// Replaces the old DOM <input> overlays (movie name, 3D-text words, recorder
// and costume name fields). Click focuses and places the caret, drag selects.
// A shared offscreen <input> fronts the fields (the CanvasInput approach):
// focusing it summons the mobile virtual keyboard and gives real text input —
// every alphanumeric key, paste, autocorrect, IME — for free; the field just
// renders the input's value + selection. A synthetic keydown fallback covers
// the case where the hidden input can't take DOM focus.
let activeTextField: TextField | null = null;

/** The canvas text field currently owning keyboard input, or null. */
export const focusedTextField = () => activeTextField;

// The hidden input — invisible over the active field (positioned so iOS
// scrolls/zooms near it). font-size >= 16px prevents iOS auto-zoom.
const hiddenInput = document.createElement('input');
hiddenInput.type = 'text';
hiddenInput.autocomplete = 'off';
hiddenInput.setAttribute('autocapitalize', 'none');
hiddenInput.spellcheck = false;
hiddenInput.setAttribute('aria-hidden', 'true');
hiddenInput.style.cssText = 'position:fixed;width:2px;height:2px;padding:0;border:0;opacity:0;pointer-events:none;font-size:16px;z-index:-1;';
document.body.appendChild(hiddenInput);

/** Push the field's value + selection into the hidden input. */
const mirrorToInput = (f) => {
  if (f.maxLength > 0) hiddenInput.maxLength = f.maxLength; else hiddenInput.removeAttribute('maxlength');
  hiddenInput.value = f.value;
  const a = Math.min(f.anchor, f.caret), b = Math.max(f.anchor, f.caret);
  hiddenInput.setSelectionRange(a, b, f.anchor <= f.caret ? 'forward' : 'backward');
};
/** Pull the hidden input's selection into the field's anchor/caret. */
const mirrorSelFromInput = (f) => {
  f.anchor = hiddenInput.selectionStart ?? 0;
  f.caret = hiddenInput.selectionEnd ?? 0;
  if (hiddenInput.selectionDirection === 'backward') [f.anchor, f.caret] = [f.caret, f.anchor];
};
/** True while the field's view is the top of the stack. */
const fieldOnTop = (f) => uiRoot.topView === f._top();
/** Give up the hidden input + focus state when the field's view is gone. */
const dropIfGone = (f) => { if (f && !fieldOnTop(f)) { activeTextField = null; hiddenInput.blur(); return true; } return false; };

hiddenInput.addEventListener('input', () => {
  const f = activeTextField;
  if (!f || dropIfGone(f)) return;
  f.value = f.maxLength > 0 ? hiddenInput.value.slice(0, f.maxLength) : hiddenInput.value;
  mirrorSelFromInput(f);
  f._scrollToCaret(); f._t0 = performance.now(); // blink restarts on edits
  f.onInput?.(f.value);
  f.dirty();
});
document.addEventListener('selectionchange', () => {
  const f = activeTextField;
  if (f && document.activeElement === hiddenInput && !dropIfGone(f)) { mirrorSelFromInput(f); f._scrollToCaret(); f.dirty(); }
});
hiddenInput.addEventListener('keydown', (e) => {
  const f = activeTextField;
  if (!f || dropIfGone(f)) { e.preventDefault(); return; }
  if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); f.onCommit?.(f.value); }
  else if (e.key === 'Escape' && f.onCancel) { e.preventDefault(); e.stopPropagation(); f.onCancel(); }
  else if (e.key === 'Escape') f.blur(false); // no cancel hook — falls through to the modal Esc route like the DOM inputs
});
hiddenInput.addEventListener('blur', () => activeTextField?.blur()); // e.g. mobile keyboard dismissed

export class TextField extends Element {
  value = '';
  anchor = 0;      // selection anchor (char index)
  caret = 0;       // caret index — the selection's 'other' end
  placeholder = '';
  maxLength = 0;   // 0 = unlimited
  onInput = null;      // (value) — fires on every mutation (live previews)
  onCommit = null;     // (value) — Enter commits
  onCancel = null;     // () — when set, Escape is consumed and fires this; unset
                       // Escape just blurs and falls through to the modal Esc route
  commitOnBlur = false;// outside-click commits (movie-name style) vs just blurs
  font = "bold 19px 'Comic Sans MS', cursive, sans-serif";
  fg = '#222';
  bg = '#fff8dc';
  bevel = true;    // inset border, like the old 2px-inset DOM fields
  padX = 5;
  _scroll = 0;     // horizontal scroll offset when the text overflows
  _t0 = 0;         // caret-blink phase origin

  constructor(x, y, w, h) { super(x, y, w, h); this.cursor = CURSORS.ibeam; }

  /** True while this field owns keyboard input. */
  get focused() { return activeTextField === this; }

  /** Take keyboard focus — selectAll highlights the whole value (rename-field
   *  style). Idempotent: re-focusing keeps the current selection. */
  focus(selectAll = false) {
    const was = activeTextField === this;
    if (!was) { activeTextField?.blur(); activeTextField = this; }
    this._t0 = performance.now();
    if (selectAll) { this.anchor = 0; this.caret = this.value.length; }
    else if (!was) this.anchor = this.caret = this.value.length; // fresh focus lands the caret at the end; re-clicks place it via indexAt
    // mirror into the hidden input and focus it — summons the virtual keyboard
    mirrorToInput(this);
    const r = uiRoot.canvas.getBoundingClientRect(), [ax, ay] = this.abs();
    hiddenInput.style.left = `${r.left + ax * r.width / UI_WIDTH}px`;
    hiddenInput.style.top = `${r.top + ay * r.height / UI_HEIGHT}px`;
    hiddenInput.focus({ preventScroll: true });
    this._scrollToCaret();
    this.dirty();
  }

  /** Drop keyboard focus — commits unless told otherwise (or commitOnBlur is
   *  off). */
  blur(commit = this.commitOnBlur) {
    if (!this.focused) return;
    activeTextField = null;
    if (document.activeElement === hiddenInput) hiddenInput.blur();
    if (commit) this.onCommit?.(this.value);
    this.dirty();
  }

  /** The view this field sits in — the first ancestor whose parent is the root. */
  _top() { let e = this; while (e.parent && e.parent !== uiRoot) e = e.parent; return e; }

  /** Width of `this.value.slice(0, i)` in the field font. */
  _xAt(i) { const ctx = uiRoot.ctx; ctx.font = this.font; return ctx.measureText(this.value.slice(0, i)).width; }

  /** Field-local x -> nearest char index. */
  _indexAt(lx) {
    const ctx = uiRoot.ctx;
    ctx.font = this.font;
    const x = lx - this.padX + this._scroll;
    let w = 0;
    for (let i = 0; i < this.value.length; i++) {
      const cw = ctx.measureText(this.value[i]).width;
      if (x < w + cw / 2) return i;
      w += cw;
    }
    return this.value.length;
  }

  /** Keep the caret inside the padded text area. */
  _scrollToCaret() {
    const inner = this.w - 2 * this.padX, x = this._xAt(this.caret);
    if (x - this._scroll > inner) this._scroll = x - inner;
    else if (x < this._scroll) this._scroll = x;
  }

  /** Mirror anchor/caret into the hidden input's selection — keeps real-input
   *  typing in sync after canvas-side caret moves (clicks, drags). */
  _mirrorSel() {
    if (document.activeElement !== hiddenInput) return;
    const a = Math.min(this.anchor, this.caret), b = Math.max(this.anchor, this.caret);
    hiddenInput.setSelectionRange(a, b, this.anchor <= this.caret ? 'forward' : 'backward');
  }

  /** Replace the selected range with `str` ('' deletes), honoring maxLength. */
  _replace(str) {
    const a = Math.min(this.anchor, this.caret), b = Math.max(this.anchor, this.caret);
    if (this.maxLength > 0) str = str.slice(0, Math.max(0, this.maxLength - this.value.length + b - a));
    this.value = this.value.slice(0, a) + str + this.value.slice(b);
    this.anchor = this.caret = a + str.length;
    this._scrollToCaret(); this._t0 = performance.now(); // blink restarts on edits
    this.onInput?.(this.value);
    this.dirty();
  }

  /** Focus + caret placement; the drag selection is tracked in onPointerMove. */
  onPointerDown(p) { this.focus(); this._dragging = true; this.anchor = this.caret = this._indexAt(p.x - this.abs()[0]); this._mirrorSel(); this.dirty(); return true; }
  /** Extend the selection while dragging — plain hover must not move the caret
   *  (uiRoot sends hovered elements every uncaptured pointermove). */
  onPointerMove(p) { if (this._dragging) { this.caret = this._indexAt(p.x - this.abs()[0]); this._scrollToCaret(); this._mirrorSel(); this.dirty(); } }
  /** End the selection drag — fires on the captured element wherever the
   *  pointer is released, so _dragging can't get stuck. */
  onPointerUp() { this._dragging = false; }

  /** Caret-blink repaint tick (~450ms phase, matching the textbox caret). */
  frame(now) {
    if (!this.focused) return;
    const ph = Math.floor((now - this._t0) / 450);
    if (ph !== this._phase) { this._phase = ph; this.dirty(); }
  }

  /** Paint the field: bg + optional inset bevel, text (placeholder when
   *  empty), inverted selection, blinking caret. */
  draw(ctx) {
    const { w, h } = this;
    ctx.fillStyle = this.bg; ctx.fillRect(0, 0, w, h);
    if (this.bevel) { // sunken bevel — same edge pair as the boot progress bar
      ctx.strokeStyle = '#555'; ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
      ctx.strokeStyle = '#d8d8d8'; ctx.beginPath(); ctx.moveTo(w - 0.5, 0.5); ctx.lineTo(w - 0.5, h - 0.5); ctx.lineTo(0.5, h - 0.5); ctx.stroke();
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(this.padX, 0, w - 2 * this.padX, h); ctx.clip();
    ctx.font = this.font; ctx.textBaseline = 'middle';
    const cy = h / 2;
    if (!this.value.length) {
      if (this.placeholder) { ctx.fillStyle = '#999'; ctx.fillText(this.placeholder, this.padX, cy); }
    } else {
      const a = Math.min(this.anchor, this.caret), b = Math.max(this.anchor, this.caret);
      const tx = this.padX - this._scroll;
      ctx.fillStyle = this.fg;
      ctx.fillText(this.value, tx, cy);
      if (b > a) { // inverted hilite — dark field + light glyphs, like the textbox editor
        const x0 = tx + this._xAt(a), x1 = tx + this._xAt(b);
        ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, x1 - x0, h); ctx.clip();
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#fff'; ctx.fillText(this.value, tx, cy);
        ctx.restore();
      }
    }
    if (this.focused && this.anchor === this.caret && Math.floor((performance.now() - this._t0) / 450) % 2 === 0) {
      ctx.fillStyle = this.fg;
      ctx.fillRect(Math.round(this.padX + this._xAt(this.caret) - this._scroll), 2, 1, h - 4);
    }
    ctx.restore();
  }
}

// Synthetic fallback — edits the field directly when the hidden input doesn't
// hold DOM focus (e.g. a programmatic focus() outside a user gesture). When it
// does, the real input owns the keys and 'input'/'selectionchange' sync back.
document.addEventListener('keydown', (e) => {
  const f = activeTextField;
  if (!f) return;
  if (document.activeElement === hiddenInput) return; // the real input owns the keys
  if (!fieldOnTop(f)) { f.blur(false); return; } // popped or covered — keys belong to whatever's on top
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const a = Math.min(f.anchor, f.caret), b = Math.max(f.anchor, f.caret), len = f.value.length;
  const eat = () => { e.preventDefault(); e.stopPropagation(); };
  const move = (cp) => { eat(); if (e.shiftKey) f.caret = cp; else f.anchor = f.caret = cp; f._scrollToCaret(); f._t0 = performance.now(); f.dirty(); };
  const del = (x, y) => { eat(); f.anchor = x; f.caret = y; f._replace(''); };
  if (e.key === 'Backspace') { if (b > a) del(a, b); else if (a > 0) del(a - 1, a); else eat(); }
  else if (e.key === 'Delete') { if (b > a) del(a, b); else if (a < len) del(a, a + 1); else eat(); }
  else if (e.key === 'ArrowLeft') move(b > a ? a : Math.max(0, a - 1));
  else if (e.key === 'ArrowRight') move(b > a ? b : Math.min(len, a + 1));
  else if (e.key === 'Home') move(0);
  else if (e.key === 'End') move(len);
  else if (e.key === 'Enter') { eat(); f.onCommit?.(f.value); }
  else if (e.key === 'Escape') {
    if (f.onCancel) { eat(); f.onCancel(); }
    else f.blur(false); // no cancel hook — Escape falls through to the modal route like the DOM inputs
  } else if (e.key.length === 1) { eat(); f._replace(e.key); }
}, true);

// A pointerdown outside the focused field blurs it (committing when the field
// opts into commitOnBlur) — the DOM input's onblur equivalent.
document.addEventListener('pointerdown', (e) => {
  const f = activeTextField;
  if (!f) return;
  const r = uiRoot.canvas.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width * UI_WIDTH, y = (e.clientY - r.top) / r.height * UI_HEIGHT;
  const [ax, ay] = f.abs();
  if (x < ax || x >= ax + f.w || y < ay || y >= ay + f.h) f.blur();
}, true);

// mousedown's default action would steal DOM focus from the hidden input
// (the canvas isn't focusable, so focus falls back to body) — suppress it
// while a field is editing; real outside-click blurs happen in the pointerdown
// listener above.
document.addEventListener('mousedown', (e) => {
  if (activeTextField && e.target === uiRoot.canvas) e.preventDefault();
}, true);
