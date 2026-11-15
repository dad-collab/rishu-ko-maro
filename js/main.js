// RISHU.COM — Phase 2 — main.js
// Boot: loading screen (tracks real init steps) -> arena init -> menu.
// No infinite loading: WebGL failure shows a real error state.

import { createArena } from './arena.js';
import { initMenu, loadSettings, saveSettings } from './menu.js';

const loadingEl = document.getElementById('loading');
const loadingBar = document.getElementById('loading-bar');
const loadingText = document.getElementById('loading-text');
const loadingError = document.getElementById('loading-error');
const appEl = document.getElementById('app');
const arenaWrap = document.getElementById('arena-wrap');

const settings = loadSettings();
let arena = null;
let menu = null;
let booted = false;
let bootStarted = false;

function setProgress(pct, text) {
  if (loadingBar) loadingBar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  if (loadingText) loadingText.textContent = text || '';
}

function showError(msg) {
  setProgress(100, 'Could not start');
  if (loadingError) {
    loadingError.textContent = msg;
    loadingError.hidden = false;
  }
  if (loadingText) loadingText.textContent = 'Startup failed — see above. Reload to retry.';
}

function finishLoading() {
  if (booted) return;
  booted = true;
  setProgress(100, 'Ready');
  setTimeout(() => {
    if (loadingEl) loadingEl.classList.add('done');
    if (appEl) appEl.classList.remove('hidden-until-ready');
    if (arena) arena.resize();
  }, 350);
}

async function boot() {
  if (bootStarted) return; // DOMContentLoaded + readyState can both fire
  bootStarted = true;
  setProgress(5, 'Loading RISHU.COM…');
  // Small real waits so the loading screen is readable, not faked progress:
  // each step below reports only when its work actually happens.
  await new Promise((r) => setTimeout(r, 150));
  setProgress(15, 'Preparing settings…');
  saveSettings(settings);

  // Fullscreen helper — used by the menu button
  async function requestFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (e) {
      if (menu) menu.showToast('Fullscreen is not available in this browser.');
    }
  }

  // Menu first (so buttons exist even if WebGL fails), arena second.
  menu = initMenu({
    settings,
    onQualityChange: (q) => { if (arena) arena.setQuality(q); },
    onRequestFullscreen: requestFullscreen,
    onEnterArena: (mode, charA, charB) => {
      if (arena) arena.startMatch(mode, charA, charB);
    },
    onArenaShown: () => {
      if (arena) {
        arena.resize();
        arena.ensureMatch(); // begin the match once the screen is visible
      }
    },
    onLeaveArena: () => { if (arena) arena.stopMatch(); },
  });
  // Note: the HUD Quit button goes through createArena's onQuitMatch
  // below (stop the match, then show Game Modes) — not through menu.

  setProgress(20, 'Starting 3D arena…');
  if (!arenaWrap) {
    showError('Arena container is missing. The page did not load correctly.');
    return;
  }
  if (!window.WebGLRenderingContext) {
    showError('WebGL is not available in this browser. RISHU.COM needs WebGL to show the 3D arena.');
    // Menu still works without the arena; let the user in.
    finishLoading();
    return;
  }

  try {
    arena = createArena(arenaWrap, {
      quality: settings.quality,
      onProgress: (pct, text) => setProgress(20 + Math.round(pct * 0.75), text),
      onError: (msg) => showError(msg),
      // HUD Quit button: stop the match, then go to Game Modes.
      // (menu is already created above, so menu.show exists by call time.)
      onQuitMatch: () => {
        if (arena) arena.stopMatch();
        if (menu) menu.show('modes');
      },
    });
  } catch (e) {
    console.error('[RISHU] Arena failed to start:', e);
    showError('The 3D arena could not start in this browser. The menu still works — try reloading, or use a browser with WebGL enabled.');
    finishLoading();
    return;
  }

  if (!arena) {
    // createArena already reported the error via onError.
    finishLoading();
    return;
  }

  // Keep the fullscreen button label honest
  document.addEventListener('fullscreenchange', () => {
    const btn = document.getElementById('btn-fullscreen');
    if (btn) btn.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen';
  });

  finishLoading();
}

document.addEventListener('DOMContentLoaded', boot);
// If DOMContentLoaded already fired (script at end of body), boot now.
if (document.readyState !== 'loading') boot();
