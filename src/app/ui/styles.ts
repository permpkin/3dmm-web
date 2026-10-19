// App stylesheet — injected at module init so no external .css file is needed.
// Covers the DOM the canvas app still uses: the stage/studio layout shell, the
// #view/#ui canvases, the settings dialog, and the portrait rotate prompt.
// The pre-JS #boot splash is styled inline in index.html — it must render
// before JS runs.
/** Inject the app stylesheet — called once at boot; idempotent. Covers the
 *  DOM the canvas app still uses: layout shell, canvases, the settings
 *  dialog, and the rotate prompt. */
export function injectAppStyles() {
  if (document.getElementById('appStyles')) return;
  const el = document.createElement('style');
  el.id = 'appStyles';
  el.textContent = `
@font-face { font-family: 'Comic Neue'; src: url('fonts/ComicNeue-Regular.woff2') format('woff2'); font-weight: 400; font-style: normal; }
@font-face { font-family: 'Comic Neue'; src: url('fonts/ComicNeue-Bold.woff2') format('woff2'); font-weight: 700; font-style: normal; }
@font-face { font-family: 'Comic Neue'; src: url('fonts/ComicNeue-Italic.woff2') format('woff2'); font-weight: 400; font-style: italic; }
html, body { margin: 0; height: 100%; height: 100dvh; background: #000; color: #ccc; font: 12px monospace; }
body { display: flex; flex-direction: column; }
#stage { flex: 1; display: flex; align-items: center; justify-content: center; min-height: 0; }
#studio { position: relative; touch-action: none; aspect-ratio: 640 / 480; height: min(100%, 75vw); margin: auto; overflow: hidden; container-type: size; }

#view { position: absolute; image-rendering: pixelated; touch-action: none; }
#rotMsg { position: fixed; inset: 0; z-index: 90; background: #000; display: none; align-items: center; justify-content: center;
  color: #888; font: bold 16px 'Comic Sans MS', 'Comic Neue', cursive, sans-serif; text-align: center; padding: 2em; }
#rotMsg.show { display: flex; }
#studio #selBox { display: none; } /* unused — selection is a 3D bounding box in-scene */
#ui { position: absolute; inset: 0; width: 100%; height: 100%; image-rendering: pixelated; z-index: 55; touch-action: none; }
`;
  document.head.appendChild(el);
}
