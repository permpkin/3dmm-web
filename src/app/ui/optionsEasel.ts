// Settings easel — the in-canvas replacement for the old DOM options dialog,
// drawn in the device-picker panel style: a beveled plate with a title strip,
// a tab row, and tab-scoped content. 'graphics' holds the render options
// (apply live — OK/Esc just close, no revert), 'addons' manages asset packs
// and .vxp expansions (import/enable/disable/remove, dependency-gated), and
// 'about' shows the app name/version + links.
import { EaselView } from './easel.ts';
import { modalSlot } from './modal.ts';
import { Element } from './element.ts';
import { localizer } from '../localization.ts';
import { renderOptions, RENDER_OPTION_DEFS } from '../renderOptions.ts';
import { appState } from '../appState.ts';
import { playbackLoop } from '../playbackLoop.ts';
import { CURSORS } from './cursorManager.ts';
import { expansionPacks } from '../expansionPacks.ts';
import { toastHost } from '../resources.ts';
import { TextLink, TextElement, TextField } from './widgets.ts';
import { telemetry } from '../telemetry.ts';
import { version } from '../../../package.json';

const PW = 380, ROW_H = 19, CAT_H = 15;
const TABS = ['graphics', 'addons', 'about'];
const REPO = 'https://github.com/permpkin/3dmm-web';

/** opt.* label key — selfShadowOp's string lives under 'shadowOpacity'. */
const labelKey = (key) => 'opt.' + (key === 'selfShadowOp' ? 'shadowOpacity' : key);

/** Push an option change live — persist, renderer, repaint (the DOM
 *  panel's identical fan-out). */
const apply = (key, v) => {
  renderOptions[key] = v;
  localStorage.setItem('opts3dmm', JSON.stringify(renderOptions));
  appState.sceneRenderer.setOpts(renderOptions);
  if (key === 'fps24' && appState.playing) playbackLoop.setPlaying(true); // restart the loop in the new mode
  playbackLoop.drawFrame();
};

/** Panel background — the picker plate: dark fill, outer shadow + inner
 *  highlight, and a title strip. */
class PanelPlate extends Element {
  constructor(x, y, w, h, title) { super(x, y, w, h); this.title = title; this.pickable = false; }
  /** Paint the plate: drop shadow, beveled frame, title. */
  draw(ctx) {
    const { w, h } = this;
    ctx.fillStyle = '#141414'; ctx.fillRect(2, 3, w, h);           // drop shadow
    ctx.fillStyle = '#3a3a3e'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#0d0d0d'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.strokeStyle = '#5c5c62'; ctx.beginPath();
    ctx.moveTo(3, h - 4); ctx.lineTo(3, 3); ctx.lineTo(w - 4, 3); ctx.stroke();
    // title strip
    ctx.fillStyle = '#26262a'; ctx.fillRect(6, 6, w - 12, 26);
    ctx.strokeStyle = '#1a1a1c'; ctx.lineWidth = 1; ctx.strokeRect(6.5, 6.5, w - 13, 25);
    ctx.fillStyle = '#d8d8dc';
    ctx.font = `bold 13px 'Comic Neue', cursive, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(this.title, w / 2, 19);
  }
}

/** Tab chip — a raised/sunken strip in the title's tab row; click switches. */
class TabChip extends Element {
  constructor(tab, x, y, w, h, onClick) {
    super(x, y, w, h);
    this.tab = tab; this.action = onClick; this.active = false; this.hover = false;
    this.cursor = CURSORS.pointer;
  }
  /** Paint the chip — active reads raised+lit, hover brightens, inactive dims. */
  draw(ctx) {
    ctx.fillStyle = this.active ? '#4a4a50' : this.hover ? '#424248' : '#2e2e32';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.strokeStyle = this.active ? '#8f8f96' : '#1c1c1e';
    ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, this.w - 1, this.h - 1);
    ctx.fillStyle = this.active ? '#e8e8ec' : '#9f9fa6';
    ctx.font = `bold 11px 'Comic Neue', cursive, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(localizer.translate('opt.tab' + this.tab[0].toUpperCase() + this.tab.slice(1)), this.w / 2, this.h / 2 + 1);
  }
  onPointerEnter() { this.hover = true; this.dirty(); }
  onPointerLeave() { this.hover = false; this.dirty(); }
  onClick() { this.action(); }
}

/** Text action button — the same beveled chip style as TabChip but for
 *  actions (import, on/off toggle, remove). */
class TextButton extends Element {
  constructor(text, x, y, w, h, onClick, { size = 11 } = {}) {
    super(x, y, w, h);
    this.text = text; this.action = onClick; this.size = size;
    this.cursor = CURSORS.pointer; this.hover = false; this.enabled = true;
  }
  /** Paint the chip + centered label. */
  draw(ctx) {
    ctx.fillStyle = this.enabled ? (this.hover ? '#4a4a50' : '#3c3c40') : '#2a2a2e';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.strokeStyle = '#1c1c1e'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, this.w - 1, this.h - 1);
    ctx.fillStyle = this.enabled ? '#d8d8dc' : '#6a6a72';
    ctx.font = `bold ${this.size}px 'Comic Neue', cursive, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(this.text, this.w / 2, this.h / 2 + 1, this.w - 6);
  }
  onPointerEnter() { this.hover = true; this.dirty(); }
  onPointerLeave() { this.hover = false; this.dirty(); }
  onClick() { if (this.enabled) this.action(); }
}

/** Category header — dimmed small-caps text, not interactive. */
class CatRow extends Element {
  constructor(cat, x, y, w) { super(x, y, w, CAT_H); this.cat = cat; this.pickable = false; }
  /** Paint the label. */
  draw(ctx) {
    ctx.fillStyle = '#8f8f96'; ctx.font = `9px 'Comic Neue', cursive, sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(localizer.translate('opt.' + this.cat).toUpperCase(), 4, this.h / 2 + 1, this.w - 8);
    ctx.strokeStyle = '#2c2c30'; ctx.beginPath();
    ctx.moveTo(2, this.h - 0.5); ctx.lineTo(this.w - 2, this.h - 0.5); ctx.stroke();
  }
}

/** Shared row drawing — hover strip + dimmed-disabled handling. */
class OptRow extends Element {
  constructor(x, y, w, enabled = () => true) {
    super(x, y, w, ROW_H);
    this.cursor = CURSORS.pointer; this.hover = false; this.enabled = enabled;
  }
  /** Paint the hover strip; subclasses draw content via `_content`. */
  draw(ctx) {
    if (this.hover && this.enabled()) { ctx.fillStyle = '#4a4a50'; ctx.fillRect(0, 0, this.w, this.h); }
    ctx.save();
    if (!this.enabled()) ctx.globalAlpha = 0.4;
    this._content(ctx);
    ctx.restore();
  }
  onPointerEnter() { this.hover = true; this.dirty(); }
  onPointerLeave() { this.hover = false; this.dirty(); }
}

/** Checkbox row — sunken box + fill + label; click toggles. */
class OptCheck extends OptRow {
  constructor(key, x, y, w, indent = 0, enabled?) {
    super(x, y, w, enabled);
    this.key = key; this.indent = indent;
  }
  /** Paint the box, the check fill, and the translated label. */
  _content(ctx) {
    const on = !!renderOptions[this.key], bx = 4 + this.indent;
    ctx.fillStyle = '#161617'; ctx.fillRect(bx, 4, 11, 11);
    ctx.strokeStyle = '#6a6a72'; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, 4.5, 10, 10);
    if (on) { ctx.fillStyle = '#7db4ff'; ctx.fillRect(bx + 2, 6, 7, 7); }
    ctx.fillStyle = '#d8d8dc'; ctx.font = `12px 'Comic Neue', cursive, sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(localizer.translate(labelKey(this.key)), bx + 17, this.h / 2 + 1, this.w - bx - 20);
  }
  onClick() { if (!this.enabled()) return; apply(this.key, !renderOptions[this.key]); this.dirty(); }
}

/** Slider row — label + sunken track + raised thumb; drag maps 0..1 →
 *  min..max percent (values store as fractions like the DOM panel). */
class OptSlider extends OptRow {
  constructor(key, min, max, x, y, w, indent = 0, enabled?) {
    super(x, y, w, enabled);
    this.key = key; this.min = min; this.max = max; this.indent = indent;
    this._drag = false;
  }
  /** The track's left edge and width. */
  get tx() { return 118 + this.indent; }
  get tw() { return this.w - this.tx - 8; }
  /** Paint label, current %, track, and thumb at the option's fraction. */
  _content(ctx) {
    const f = Math.max(0, Math.min(1, renderOptions[this.key] * 100 / (this.max - this.min) - this.min / (this.max - this.min)));
    ctx.fillStyle = '#d8d8dc'; ctx.font = `11px 'Comic Neue', cursive, sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(localizer.translate(labelKey(this.key)), 4 + this.indent, this.h / 2 + 1, this.tx - 12 - this.indent);
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(renderOptions[this.key] * 100) + '%', this.tx - 6, this.h / 2 + 1);
    const ty = (this.h - 10) / 2;
    ctx.fillStyle = '#161617'; ctx.fillRect(this.tx, ty, this.tw, 10);
    ctx.strokeStyle = '#6a6a72'; ctx.strokeRect(this.tx + 0.5, ty + 0.5, this.tw - 1, 9);
    const cx = this.tx + f * (this.tw - 10);
    ctx.fillStyle = '#8a8a92'; ctx.fillRect(cx, ty + 1, 9, 8);
    ctx.strokeStyle = '#c8c8ce'; ctx.strokeRect(cx + 0.5, ty + 1.5, 8, 7);
  }
  onPointerDown(p) { if (this.enabled()) { this._drag = true; this._move(p); } return true; }
  onPointerMove(p) { if (this._drag) this._move(p); }
  onPointerUp() { this._drag = false; }
  /** Map a view-space x to the percent range and apply it. */
  _move(p) {
    const f = Math.max(0, Math.min(1, (p.x - (this.abs()[0] + this.tx) - 5) / (this.tw - 10)));
    apply(this.key, (this.min + f * (this.max - this.min)) / 100);
    this.dirty();
  }
}

/** One option inside a DropMenu — hover strip + 'current' highlight. */
class DropItem extends Element {
  constructor(menu, v, label, x, y, w) {
    super(x, y, w, 18);
    this.v = v; this.label = label; this.menu = menu;
    this.cursor = CURSORS.pointer; this.hover = false;
  }
  /** Paint hover strip + label (current pick reads accent). */
  draw(ctx) {
    if (this.hover) { ctx.fillStyle = '#4a4a50'; ctx.fillRect(0, 0, this.w, this.h); }
    ctx.font = `11px 'Comic Neue', cursive, sans-serif`; ctx.textBaseline = 'middle';
    ctx.fillStyle = this.v === this.menu.cur ? '#9fc4ff' : '#d8d8dc';
    ctx.textAlign = 'left';
    ctx.fillText(this.label, 8, this.h / 2 + 1, this.w - 12);
  }
  onPointerEnter() { this.hover = true; this.dirty(); }
  onPointerLeave() { this.hover = false; this.dirty(); }
  onClick() { this.menu.pick(this.v); }
}

/** Popup option list opened by a SelectRow — added directly to the easel so
 *  it overlays all tab content. */
class DropMenu extends Element {
  constructor(easel, opts, cur, onPick, x, y, w) {
    super(x, y, w, opts.length * 18 + 4);
    this.easel = easel; this.cur = cur; this.onPick = onPick;
    opts.forEach(([v, l], i) => this.add(new DropItem(this, v, localizer.translate(l), 2, 2 + i * 18, w - 4)));
  }
  /** Paint the sunken plate. */
  draw(ctx) {
    ctx.fillStyle = '#26262a'; ctx.fillRect(0, 0, this.w, this.h);
    ctx.strokeStyle = '#1c1c1e'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, this.w - 1, this.h - 1);
    ctx.strokeStyle = '#5c5c62'; ctx.beginPath(); ctx.moveTo(1.5, this.h - 2); ctx.lineTo(1.5, 1.5); ctx.lineTo(this.w - 2, 1.5); ctx.stroke();
  }
  /** Pick — fires the callback then the easel closes the popup. */
  pick(v) { this.onPick(v); this.easel._closeDrop(); }
}

/** Invisible full-view catcher behind a DropMenu — a click anywhere outside
 *  the menu closes it without triggering what's underneath. */
class DropBackdrop extends Element {
  constructor(easel) { super(0, 0, 640, 480); this.easel = easel; }
  onPointerDown() { this.easel._closeDrop(); return true; }
}

/** Select row — label + a sunken value field with a ▼; click opens a real
 *  dropdown list of the options (get/set bound, like FieldCycle was). */
class SelectRow extends OptRow {
  constructor(easel, label, get, set, opts, x, y, w, indent = 0, enabled?) {
    super(x, y, w, enabled);
    this.easel = easel; this.label = label; this.get = get; this.set = set;
    this.opts = opts; this.indent = indent;
  }
  /** The value field's left edge / width — the dropdown anchors to it. */
  get fx() { return 118 + this.indent; }
  get fw() { return this.w - this.fx - 8; }
  /** Paint the label, the sunken field, current value, and ▼. */
  _content(ctx) {
    const cur = this.opts.find(([v]) => String(v) === String(this.get())) || this.opts[0];
    ctx.font = `11px 'Comic Neue', cursive, sans-serif`; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#d8d8dc'; ctx.textAlign = 'left';
    ctx.fillText(this.label, 4 + this.indent, this.h / 2 + 1, this.fx - 14 - this.indent);
    const fy = (this.h - 14) / 2;
    ctx.fillStyle = '#161617'; ctx.fillRect(this.fx, fy, this.fw, 14);
    ctx.strokeStyle = '#6a6a72'; ctx.lineWidth = 1; ctx.strokeRect(this.fx + 0.5, fy + 0.5, this.fw - 1, 13);
    ctx.fillStyle = '#9fc4ff';
    ctx.fillText(localizer.translate(cur[1]), this.fx + 5, this.h / 2 + 1, this.fw - 22);
    ctx.textAlign = 'right';
    ctx.fillText('▼', this.fx + this.fw - 5, this.h / 2 + 1);
  }
  /** Open the dropdown anchored to the value field. */
  onClick() {
    if (!this.enabled()) return;
    const [ax, ay] = this.abs();
    this.easel._openDrop(this.opts, this.get(), (v) => { this.set(v); this.dirty(); }, ax + this.fx, ay, this.h, this.fw);
  }
}

/** Addon list row — name + type badge on the left, an on/off toggle and a
 *  remove 'x' on the right. Status reflects enabled/failed/loading. */
class AddonRow extends OptRow {
  constructor(addon, easel, x, y, w) {
    super(x, y, w, () => true);
    this.addon = addon; this.easel = easel;
    const label = addon.loading ? '…' : addon.failed ? '!' : addon.enabled ? 'on' : 'off';
    this.add(new TextButton(label, w - 92, 1, 52, 17, () => easel.tryToggle(addon), { size: 10 }));
    this.add(new TextButton('×', w - 36, 1, 30, 17, () => easel.tryRemove(addon), { size: 12 }));
  }
  /** Paint the name, type badge, and (url) source marker. */
  _content(ctx) {
    const a = this.addon;
    ctx.font = `12px 'Comic Neue', cursive, sans-serif`; ctx.textBaseline = 'middle';
    ctx.fillStyle = a.failed ? '#d88' : a.enabled ? '#d8d8dc' : '#8f8f96';
    ctx.textAlign = 'left';
    ctx.fillText(a.name, 4, this.h / 2 + 1, this.w - 150);
    ctx.fillStyle = '#6f6f78'; ctx.font = `9px 'Comic Neue', cursive, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillText(`${a.type}${a.source === 'url' ? ' · url' : ''}`, this.w - 100, this.h / 2 + 1);
  }
}

/** Dependency gate dialog — the movie uses this addon; block the action and
 *  list what's referencing it. */
class DepsDialog extends EaselView {
  /** Open the dependency list for `action` ('disable'|'remove'). */
  static show = (deps, action) => modalSlot.open(new DepsDialog(deps, action));
  constructor(deps, action) {
    super();
    const lines = deps.map((d) => (d.scene ? localizer.translate('addon.depScene', { scene: d.scene }) : localizer.translate('addon.depRollcall')) + (d.actor ? ` — ${d.actor}` : ''));
    const ph = 96 + lines.length * 16 + 56, px = (640 - 320) / 2, py = (480 - ph) / 2;
    this.add(new PanelPlate(px, py, 320, ph, localizer.translate('addon.inUseTitle')));
    const g = new Element(px + 16, py + 40, 288, ph - 96); g.pickable = false;
    this.add(g);
    g.add(new TextElement(localizer.translate('addon.inUseBody', { action: localizer.translate('addon.' + action) }), 0, 0, 288, 30, { size: 10, color: '#d8d8dc', align: 'left', bold: false }));
    lines.forEach((l, i) => g.add(new TextElement(l, 8, 34 + i * 16, 272, 15, { size: 10, color: '#9fc4ff', align: 'left', bold: false })));
    this.makeButton('okay', 'okayc', px + 320 - 66, py + ph - 54, 50, 48, () => OptionsEasel.show('addons'));
  }
  _onEsc = () => OptionsEasel.show('addons');
}

/** Divider rule between the inline import form and the addon list. */
class Divider extends Element {
  constructor(y, w) { super(0, y, w, 8); this.pickable = false; }
  /** Paint the rule. */
  draw(ctx) {
    ctx.strokeStyle = '#2c2c30'; ctx.beginPath();
    ctx.moveTo(2, 3.5); ctx.lineTo(this.w - 2, 3.5); ctx.stroke();
  }
}

/** The settings easel — tabs swap which content group is visible. */
export class OptionsEasel extends EaselView {
  /** Open the settings — `tab` picks the initial page (re-openers land back
   *  on 'addons' after import/gate flows). */
  static show = (tab = 'graphics') => modalSlot.open(new OptionsEasel(tab));
  /** Build the plate, tab chips, and the three content groups. */
  constructor(tab = 'graphics') {
    super();
    // graphics rows counted first — the panel height follows the largest tab
    const rows = [];
    for (const [cat, defs] of RENDER_OPTION_DEFS) {
      rows.push({ cat });
      for (const [key, , kind, opts] of defs) {
        if (!key) continue;
        if (kind === 'range') rows.push({ key, slider: opts });
        else {
          rows.push({ key });
          for (const [skey, , smin, smax] of (kind || []))
            rows.push({ key: skey, sub: key, sel: smin === 'sel' ? smax : smin === undefined ? null : null, slider: smin !== undefined && smin !== 'sel' ? [smin, smax] : null, check: smin === undefined });
        }
      }
    }
    const ph = 40 + 22 + rows.length * ROW_H + 60;
    const px = Math.round((640 - PW) / 2), py = Math.round((480 - ph) / 2);
    this.add(new PanelPlate(px, py, PW, ph, localizer.translate('ui.settings')));
    // tab strip + one content group per tab
    this._chips = {}; this._groups = {};
    const cw = (PW - 32 - 12) / TABS.length;
    TABS.forEach((t, i) => {
      this.add(this._chips[t] = new TabChip(t, px + 16 + i * (cw + 6), py + 38, cw, 20, () => this._showTab(t)));
      const g = new Element(px + 16, py + 64, PW - 32, ph - 118); g.pickable = false;
      this.add(g); this._groups[t] = g;
    });
    this._buildGraphics(this._groups.graphics, rows);
    this._buildAbout(this._groups.about);
    this._buildAddons(this._groups.addons);
    this._showTab(tab);
    this.makeButton('okay', 'okayc', px + PW - 66, py + ph - 54, 50, 48, modalSlot.close);
  }

  /** Swap the visible content group + chip states. */
  _showTab(t) {
    this._closeDrop();
    this._tab = t;
    for (const k of TABS) {
      this._groups[k].visible = k === t;
      this._chips[k].active = k === t; this._chips[k].dirty();
    }
  }

  /** Open a dropdown over the field rect (fx, fy, fh) — drops below the
   *  field when it fits on-canvas, otherwise flips up so the menu's bottom
   *  edge meets the field's top. */
  _openDrop(opts, cur, onPick, fx, fy, fh, w) {
    this._closeDrop();
    const mh = opts.length * 18 + 4;
    const y = fy + fh + 2 + mh <= 470 ? fy + fh + 2 : Math.max(8, fy - 2 - mh);
    const menu = new DropMenu(this, opts, cur, onPick, fx, y, w);
    this._drop = [this.add(new DropBackdrop(this)), this.add(menu)];
  }

  /** Close the open dropdown, if any. */
  _closeDrop() {
    if (!this._drop) return;
    for (const e of this._drop) this.remove(e);
    this._drop = null;
    this.invalidate();
  }

  // --- graphics ---------------------------------------------------------------
  /** The render-options rows (the easel's original content). */
  _buildGraphics(g, rows) {
    rows.forEach((r, i) => {
      const y = i * ROW_H;
      if (r.cat) g.add(new CatRow(r.cat, 0, y, g.w));
      else {
        const en = r.sub ? () => !!renderOptions[r.sub] : undefined;
        const ind = r.sub ? 14 : 0;
        if (r.slider) g.add(new OptSlider(r.key, r.slider[0], r.slider[1], 0, y, g.w, ind, en));
        else if (r.sel) g.add(new SelectRow(this, localizer.translate(labelKey(r.key)), () => renderOptions[r.key], (v) => apply(r.key, v),
          r.sel.map(([v, l]) => [v, 'opt.' + l]), 0, y, g.w, ind, en));
        else g.add(new OptCheck(r.key, 0, y, g.w, ind, en));
      }
    });
  }

  // --- addons -------------------------------------------------------------------
  /** Addons tab — the import form sits permanently at the top (type select,
   *  URL field, status, import) above the rebuilt list group. */
  _buildAddons(g) {
    this._addonsGroup = g;
    this._addonTop = 0;
    // import form — url + inline button; the type is inferred from the spec.
    // The controls live in their own group so _syncAddons never rebuilds
    // them mid-edit.
    const f = this._importForm = new Element(0, 0, g.w, 56);
    f.pickable = false;
    const bw = 56; // import sits on the url field's row — 2px gap
    const url = this._url = new TextField(0, 2, g.w - bw - 2, 22);
    url.font = `12px 'Comic Neue', cursive, sans-serif`;
    url.placeholder = localizer.translate('addon.urlHint');
    url.onCommit = () => this._doImport();
    f.add(url);
    this._importBtn = new TextButton(localizer.translate('addon.doImport'), g.w - bw, 2, bw, 22, () => this._doImport());
    f.add(this._importBtn);
    this._status = new TextElement('', 0, 30, g.w, 13, { size: 9, color: '#e8a0a0', align: 'left', bold: false });
    f.add(this._status);
    f.add(new Divider(50, g.w));
    g.add(f);
    this._listGroup = new Element(0, 56, g.w, g.h - 56);
    this._listGroup.pickable = false;
    g.add(this._listGroup);
    this._syncAddons();
  }

  /** Validate, fetch+apply via expansionPacks, then reset the form. The url
   *  field, type select, and import button disable while the fetch runs —
   *  the status line reports progress, then the outcome (including skipped
   *  files like .cfg descriptors). */
  _doImport = async () => {
    if (this._importing) return;
    const setStatus = (t, color = '#e8a0a0') => { this._status.text = t; this._status.color = color; this._status.dirty(); };
    const spec = this._url.value.trim();
    if (!spec) { setStatus(localizer.translate('addon.needUrl')); return; }
    this._importing = true;
    this._url.pickable = false; this._url.opacity = 0.5; this._url.blur(false); this._url.dirty();
    this._importBtn.enabled = false; this._importBtn.dirty();
    setStatus(localizer.translate('addon.importing'), '#9fc4ff');
    try {
      const addon = await expansionPacks.import(spec, // type is inferred from the spec's extension

        (f) => setStatus(localizer.translate('addon.importingPct', { pct: Math.round(f * 100) }), '#9fc4ff'));
      telemetry.track('addon_import', { type: addon.type });
      toastHost.show(localizer.translate('addon.imported', { name: addon.name }));
      this._url.value = ''; this._url.caret = this._url.anchor = 0;
      const skip = addon.skipped?.length ? ' — ' + localizer.translate('addon.ignored', { files: addon.skipped.join(', ') }) : '';
      setStatus(localizer.translate('addon.importedFiles', { name: addon.name, files: addon.loaded ?? addon.items.filter(Boolean).length }) + skip, '#8f8f96');
      this._syncAddons();
    } catch (e) {
      setStatus(String(e.message || e));
      telemetry.error(e, { op: 'addon_import' });
    } finally {
      this._importing = false;
      this._url.pickable = true; this._url.opacity = 1; this._url.dirty();
      this._importBtn.enabled = true; this._importBtn.dirty();
    }
  };

  /** Max addon rows visible without scrolling. */
  get _addonPage() { return Math.floor((this._listGroup.h - 44) / 20); }

  /** Rebuild the addon list rows — called after every enable/remove/import. */
  _syncAddons() {
    const g = this._listGroup;
    g.clear();
    const addons = expansionPacks.addons;
    if (!addons.length) {
      g.add(new TextElement(localizer.translate('addon.empty'), 0, 30, g.w, 20, { size: 11, color: '#8f8f96' }));
    } else {
      const page = this._addonPage;
      this._addonTop = Math.max(0, Math.min(this._addonTop, addons.length - page));
      const scrollable = addons.length > page;
      addons.slice(this._addonTop, this._addonTop + page).forEach((a, i) =>
        g.add(new AddonRow(a, this, 0, 6 + i * 20, scrollable ? g.w - 22 : g.w)));
      if (scrollable) { // arrows center in the reserved right margin — clear of the rows
        const mid = 6 + page * 10;
        g.add(new TextButton('▲', g.w - 18, mid - 14, 16, 12, () => { this._addonTop--; this._syncAddons(); }, { size: 8 }));
        g.add(new TextButton('▼', g.w - 18, mid + 2, 16, 12, () => { this._addonTop++; this._syncAddons(); }, { size: 8 }));
      }
    }
    this._addonsGroup.invalidate(); // the form's strip sits above g — dirty the whole tab region
  }

  /** Enable/disable gate — disabling first checks the open movie for
   *  references into this addon's chunks; dependents block the action via
   *  the DepsDialog. */
  tryToggle = async (addon) => {
    if (addon.loading) return;
    if (addon.enabled) {
      const deps = expansionPacks.dependencies(addon);
      if (deps.length) { telemetry.track('addon_dep_blocked', { type: addon.type, action: 'disable', deps: deps.length }); DepsDialog.show(deps, 'disable'); return; }
    }
    addon.loading = true; this._syncAddons();
    try {
      await expansionPacks.setEnabled(addon, !addon.enabled);
      telemetry.track('addon_toggle', { type: addon.type, on: addon.enabled });
    } catch (e) {
      addon.failed = true;
      telemetry.error(e, { op: 'addon_toggle' });
    }
    addon.loading = false;
    this._syncAddons();
    playbackLoop.drawFrame();
  };

  /** Remove gate — same dependency check, then the record is dropped. */
  tryRemove = (addon) => {
    if (addon.loading) return;
    if (addon.enabled) {
      const deps = expansionPacks.dependencies(addon);
      if (deps.length) { telemetry.track('addon_dep_blocked', { type: addon.type, action: 'remove', deps: deps.length }); DepsDialog.show(deps, 'remove'); return; }
    }
    expansionPacks.remove(addon);
    telemetry.track('addon_remove', { type: addon.type });
    this._syncAddons();
    playbackLoop.drawFrame();
  };

  // --- about ---------------------------------------------------------------------
  /** App identity — name, version, changelog + source links. */
  _buildAbout(g) {
    g.add(new TextElement('3DMM Web', 0, 34, g.w, 24, { size: 17 }));
    g.add(new TextElement(localizer.translate('ui.version', { version }), 0, 62, g.w, 16, { size: 11, color: '#9f9fa6' }));
    g.add(new TextElement(localizer.translate('about.tagline'), 0, 88, g.w, 32, { size: 10, color: '#8f8f96', bold: false }));
    g.add(new TextLink(localizer.translate('about.changelog'), 0, 136, g.w, 18, () => window.open(`${REPO}/commits`, '_blank'), { align: 'center', color: '#7db4ff', size: 11 }));
    g.add(new TextLink(localizer.translate('about.source'), 0, 158, g.w, 18, () => window.open(REPO, '_blank'), { align: 'center', color: '#7db4ff', size: 11 }));
  }
}
