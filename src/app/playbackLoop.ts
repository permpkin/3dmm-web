import { appState } from './appState.ts';
import { elementById } from './resources.ts';
import { FPS } from '../engine/player.ts';
import { movieEdits } from './edit/movieEdits.ts';
import { textboxEdits } from './edit/textboxEdits.ts';
import { renderOptions } from './renderOptions.ts';
import { studioHost } from './ui/studio.ts';

/** Playback driver — the ~6fps movie clock (FPS), rAF or setInterval depending
 *  on the smooth-playback option, plus the editor overlay update each frame. */
class PlaybackLoop {
  timer = null;
  raf = null;
  scrollRaf = null;
  acc = 0;
  last = 0;
  _selKey = null;
  _caretT0 = 0;

  /** Repaint the studio chrome for the current player state. */
  syncUi = () => { if (appState.moviePlayer) studioHost.sync(); };

  /** Render the current frame + editor overlays, then resync studio chrome. */
  drawFrame = () => {
    const { sceneRenderer, moviePlayer, playing, textboxAttachment, textboxSelection } = appState;
    sceneRenderer.selActor = movieEdits.selectedActor();
    // Textbox editor overlay: the border-selected box gets the frame/anchors;
    // the interior-focused box shows its text selection + caret — the two can
    // be different boxes, since interior clicks never move the border selection.
    const chromeTb = !playing && (textboxAttachment?.tb || textboxEdits.selectedTextbox());
    const editTb = !playing && !textboxAttachment && textboxEdits.TEXTBOX_TOOLS[appState.editorTools.tool] && textboxEdits.focusedTextbox(); // caret/selection only draw in text mode (the original's _fTextMode)
    const selKey = textboxSelection ? `${textboxSelection.anchor}:${textboxSelection.other}` : null;
    if (selKey !== this._selKey) { this._selKey = selKey; this._caretT0 = performance.now(); } // blink restarts whenever the caret/selection moves
    sceneRenderer.textboxChrome = (chromeTb || editTb)
      ? { chrome: chromeTb, textbox: editTb,
          a: textboxSelection ? Math.min(textboxSelection.anchor, textboxSelection.other) : 0,
          b: textboxSelection ? Math.max(textboxSelection.anchor, textboxSelection.other) : 0,
          caret: textboxSelection && textboxSelection.anchor === textboxSelection.other && Math.floor((performance.now() - (this._caretT0 || 0)) / 450) % 2 === 0 ? textboxSelection.other : null } // blinking caret on a collapsed sel
      : null;
    try { sceneRenderer.render(moviePlayer); } catch (e) { console.error('render:', e); }
    this.syncUi();
  };

  /** rAF tick for the smooth-playback path — accumulates real time into whole
   *  movie steps, then renders at the fractional remainder. */
  _tick = (now) => {
    const { moviePlayer, sceneRenderer } = appState;
    if (!appState.playing) return;
    const frameDur = 1000 / FPS;
    this.acc += now - this.last; this.last = now;
    while (this.acc >= frameDur) {
      sceneRenderer.beginFrame();
      if (!moviePlayer.step()) { this.setPlaying(false); return; }
      this.acc -= frameDur;
    }
    moviePlayer.updateScroll(); // credits scroll runs on its own clock, not per-step
    try { sceneRenderer.render(moviePlayer, this.acc / frameDur); } catch (e) { console.error('render:', e); }
    this.syncUi();
    this.raf = requestAnimationFrame(this._tick);
  };

  /** Start the frame clock — rAF accumulation when the 24fps option is on,
   *  a plain ~6fps interval otherwise. */
  _startClock = () => {
    if (renderOptions.fps24) { this.acc = 0; this.last = performance.now(); this.raf = requestAnimationFrame(this._tick); }
    else {
      this.timer = setInterval(() => { if (!appState.moviePlayer.step()) this.setPlaying(false); this.drawFrame(); }, 1000 / FPS);
      if (!this.scrollRaf) this.scrollRaf = requestAnimationFrame(this._scrollTick); // credits scroll repaints between ~6fps steps
    }
  };
  /** Credit-scroll repaint pump for the interval clock — advances _scv on its
   *  own rAF cadence (the original scrolls 1px per ~5ms alarm) and repaints
   *  only while a textbox is actually scrolling. */
  _scrollTick = () => {
    if (!appState.playing) { this.scrollRaf = null; return; }
    if (appState.moviePlayer?.updateScroll()) this.drawFrame();
    this.scrollRaf = requestAnimationFrame(this._scrollTick);
  };

  /** Toggle playback — wakes or suspends the audio queue, starts/stops the
   *  frame clock, and notifies studio + theatre chrome. */
  setPlaying = (p) => {
    appState.setPlaying(p); clearInterval(this.timer); if (this.raf) cancelAnimationFrame(this.raf); if (this.scrollRaf) { cancelAnimationFrame(this.scrollRaf); this.scrollRaf = null; }
    if (p) { appState.soundQueue.ensure(); textboxEdits.endTextboxSnapshot(); textboxEdits.setSelectedTextbox(-1); textboxEdits.setFocusedTextbox(-1); this._startClock(); } // playing deselects any textbox
    else {
      appState.soundQueue.suspend();
      for (const tb of appState.moviePlayer?.scene?.textboxes?.values() ?? []) tb._scv = 0; // credits reset to the top when playback stops (CleanDdg)
      if (appState.moviePlayer && appState.sceneRenderer) this.drawFrame();
    }
    this.syncUi(); // stb_play repaints via the useUiState.playing subscription in StudioView
    appState.modeSync?.(); // theatre/embed UI follows play state
  };
}

export const playbackLoop = new PlaybackLoop();

// Caret-blink driver — repaints the overlay while a textbox is being edited so
// the caret's ~450ms phase toggles visibly.
setInterval(() => {
  if (!appState.playing && appState.moviePlayer && appState.sceneRenderer && textboxEdits.TEXTBOX_TOOLS[appState.editorTools.tool] && textboxEdits.focusedTextbox())
    playbackLoop.drawFrame();
}, 450);
