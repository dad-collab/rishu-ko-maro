// RISHU.COM — Phase 3 — hud.js
// Match HUD for the arena screen. DOM is built by this module (styled
// with the redesigned navy/ivory/orange tokens — no hex colours here).
// Mounts at the top of the match area: inserted before the arena frame
// (opts.before), so the bar sits above the canvas, not below it.
//
// Contents (brief §8):
// - P1 name + character icon (initials tile, fighter colour — real data)
// - P2 name + character icon
// - Match timer (counts UP from 00:00 — there are no rounds yet)
// - Health bars: LIVE since Phase 4 (100 HP, deplete on real damage,
//   KO at 0). The bar label is "HEALTH" + the HP number; a low bar
//   (≤ 25 HP) gets the .hud-health--low state. No fake damage — the
//   width comes only from combat.js via setHealth().
// - Pause button + pause overlay (Resume / Quit to Menu — both real).
//
// Pause semantics: setPaused(true) freezes the simulation (the arena tick
// must skip movement/animator/camera updates while paused — see the
// integration points); the timer freezes too. Rendering continues so a
// resize still works.

// Light fighter colours (e.g. Ayaan) need dark initials to stay
// readable — same luminance rule as the character cards in menu.js.
// The two text colours come from the stylesheet tokens (--ink /
// --ivory-050) at runtime, never as hardcoded hex in this module.
function tokenColor(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return (v && v.trim()) || fallback;
}
const INK = () => tokenColor('--ink', '#1B2A3D');
const IVORY = () => tokenColor('--ivory-050', '#FFFDF6');

function isLight(hex) {
  if (!hex || hex[0] !== '#' || hex.length < 7) return false;
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.45;
}

export function createHud(arenaScreenEl, { p1, p2, mode, onPause, onResume, onQuit, before } = {}) {
  let elapsed = 0; // ms of match time (excludes paused time)
  let timerId = 0;
  let running = false;
  let paused = false;
  let currentP1 = p1 || null;
  let currentP2 = p2 || null;
  let currentMode = mode || 'pvc';

  // The pause and KO overlays share ONE element (the pause box) with
  // two contents — overlayMode tracks which one is showing so the two
  // can never fight over it.
  let overlayMode = null; // null | 'pause' | 'ko'
  let koHandlers = null; // { onRematch, onQuit } for the KO overlay
  let hpP1 = 100;
  let hpP2 = 100;

  const root = document.createElement('div');
  root.className = 'hud';
  root.setAttribute('aria-label', 'Match HUD');
  root.innerHTML = `
    <div class="hud-side hud-side--p1">
      <span class="hud-icon" data-hud="p1-icon">?</span>
      <span class="hud-name" data-hud="p1-name">Player 1</span>
      <div class="hud-health" role="img" aria-label="Player 1 health">
        <i><b></b></i>
        <span class="hud-health-label">HEALTH</span>
        <span class="hud-hp" data-hud="p1-hp">100</span>
      </div>
      <div class="hud-combo" data-hud="p1-combo" hidden>COMBO ×<span data-hud="p1-combo-n">2</span></div>
    </div>
    <div class="hud-center">
      <div class="hud-timer"><span data-hud="timer">00:00</span><small>TIME</small></div>
      <button class="btn btn-small" data-hud="pause" type="button" aria-label="Pause match">⏸ Pause</button>
    </div>
    <div class="hud-side hud-side--p2">
      <span class="hud-icon" data-hud="p2-icon">?</span>
      <span class="hud-name" data-hud="p2-name">Player 2</span>
      <div class="hud-health" role="img" aria-label="Player 2 health">
        <i><b></b></i>
        <span class="hud-health-label">HEALTH</span>
        <span class="hud-hp" data-hud="p2-hp">100</span>
      </div>
      <div class="hud-combo" data-hud="p2-combo" hidden>COMBO ×<span data-hud="p2-combo-n">2</span></div>
    </div>
    <div class="hud-pause-overlay" data-hud="pause-overlay" hidden>
      <div class="hud-pause-box" role="dialog" aria-modal="true" aria-label="Match paused">
        <h2 data-hud="overlay-title">Paused</h2>
        <p data-hud="pause-hint">Movement and the timer are frozen.</p>
        <button class="btn btn-primary" data-hud="resume" type="button">Resume</button>
        <button class="btn btn-primary" data-hud="rematch" type="button" hidden>Rematch</button>
        <button class="btn" data-hud="quit" type="button">Quit to Game Modes</button>
      </div>
    </div>`;
  // Mount above the arena frame (before it in DOM order); fall back to
  // appending when the anchor is missing so the HUD never disappears.
  if (before && before.parentNode === arenaScreenEl) arenaScreenEl.insertBefore(root, before);
  else arenaScreenEl.appendChild(root);

  const $ = (k) => root.querySelector(`[data-hud="${k}"]`);

  function renderTimer() {
    const total = Math.floor(elapsed / 1000);
    const mm = String(Math.floor(total / 60)).padStart(2, '0');
    const ss = String(total % 60).padStart(2, '0');
    const el = $('timer');
    if (el) el.textContent = `${mm}:${ss}`;
  }

  function renderFighters() {
    const icon1 = $('p1-icon');
    const icon2 = $('p2-icon');
    const name1 = $('p1-name');
    const name2 = $('p2-name');
    if (currentP1) {
      if (icon1) {
        icon1.textContent = currentP1.initials || '?';
        icon1.style.background = currentP1.color || '';
        icon1.style.color = isLight(currentP1.color) ? INK() : IVORY();
      }
      if (name1) name1.textContent = `P1 · ${currentP1.name}`;
    }
    if (currentP2) {
      if (icon2) {
        icon2.textContent = currentP2.initials || '?';
        icon2.style.background = currentP2.color || '';
        icon2.style.color = isLight(currentP2.color) ? INK() : IVORY();
      }
      if (name2) name2.textContent = `${currentMode === '2p' ? 'P2' : 'CPU'} · ${currentP2.name}`;
    }
    const hint = $('pause-hint');
    if (hint && overlayMode !== 'ko') {
      hint.textContent = currentMode === '2p'
        ? 'P1: WASD + Space + Shift · J/K punch · U/I kick · L block · O dodge. P2: Arrows + Right Shift + Enter · Numpad 1/2/3/0 attack · Numpad Enter block · Numpad 5 dodge. Touch drives P1 only.'
        : 'WASD move · Space jump · Shift run · J/K punch · U/I kick · L block · O dodge. Touch: left joystick + JUMP + combat buttons.';
    }
  }

  function showOverlay(mode) {
    overlayMode = mode;
    const overlay = $('pause-overlay');
    if (overlay) overlay.hidden = false;
  }

  function hideOverlay() {
    overlayMode = null;
    const overlay = $('pause-overlay');
    if (overlay) overlay.hidden = true;
  }

  function setPaused(v) {
    // A finished match cannot be paused — the KO overlay owns the box.
    if (overlayMode === 'ko') return;
    paused = !!v;
    const btn = $('pause');
    if (btn) btn.textContent = paused ? '▶ Resume' : '⏸ Pause';
    if (paused) {
      // Swap the box back to pause content (it may have shown KO text
      // in a previous match on this HUD instance — it cannot, the HUD
      // is rebuilt per match, but stay honest anyway).
      const title = $('overlay-title');
      if (title) title.textContent = 'Paused';
      const rematchBtn = $('rematch');
      if (rematchBtn) rematchBtn.hidden = true;
      const resumeBtn = $('resume');
      if (resumeBtn) resumeBtn.hidden = false;
      renderFighters();
      showOverlay('pause');
    } else {
      hideOverlay();
    }
    if (paused && onPause) onPause();
    if (!paused && running && onResume) onResume();
  }

  // Live health bar (Phase 4). Change-guarded: the DOM is touched only
  // when the value actually moves.
  function setHealth(which, hp, maxHp) {
    const max = maxHp || 100;
    const value = Math.max(0, Math.min(max, Math.round(hp)));
    if (which === 'p1' && value === hpP1) return;
    if (which === 'p2' && value === hpP2) return;
    if (which === 'p1') hpP1 = value; else hpP2 = value;
    const bar = root.querySelector(`.hud-side--${which} .hud-health`);
    // The fill is the <b> inside the <i> track (CSS: .hud-health i b);
    // the track itself stays full-width so the bar depletes from the right.
    const fill = bar ? bar.querySelector('i b') : null;
    const num = $(`${which}-hp`);
    if (fill) fill.style.width = `${(value / max) * 100}%`;
    if (num) num.textContent = String(value);
    if (bar) {
      bar.classList.toggle('hud-health--low', value <= 25);
      bar.setAttribute('aria-label', `Health ${value} of ${max}`);
    }
  }

  // Combo counter (Phase 4): shown at N ≥ 2 on the attacker's side.
  function setCombo(which, n) {
    const el = $(`${which}-combo`);
    const num = $(`${which}-combo-n`);
    if (!el) return;
    if (n >= 2) {
      el.hidden = false;
      if (num) num.textContent = String(n);
    } else {
      el.hidden = true;
    }
  }

  // KO overlay (Phase 4): same box as pause, different content.
  function showKo(winnerName, onRematch, onQuit) {
    koHandlers = { onRematch, onQuit };
    const title = $('overlay-title');
    if (title) title.textContent = 'K.O.';
    const hint = $('pause-hint');
    if (hint) hint.textContent = `${winnerName} wins the fight!`;
    const resumeBtn = $('resume');
    if (resumeBtn) resumeBtn.hidden = true;
    const rematchBtn = $('rematch');
    if (rematchBtn) rematchBtn.hidden = false;
    showOverlay('ko');
  }

  function hideKo() {
    if (overlayMode !== 'ko') return;
    koHandlers = null;
    hideOverlay();
  }

  const pauseBtn = $('pause');
  if (pauseBtn) pauseBtn.addEventListener('click', () => setPaused(!paused));
  const resumeBtn = $('resume');
  if (resumeBtn) resumeBtn.addEventListener('click', () => setPaused(false));
  const rematchBtn = $('rematch');
  if (rematchBtn) rematchBtn.addEventListener('click', () => { if (koHandlers && koHandlers.onRematch) koHandlers.onRematch(); });
  const quitBtn = $('quit');
  if (quitBtn) quitBtn.addEventListener('click', () => {
    if (overlayMode === 'ko' && koHandlers && koHandlers.onQuit) koHandlers.onQuit();
    else if (onQuit) onQuit();
  });

  renderFighters();
  renderTimer();

  return {
    start() {
      elapsed = 0;
      running = true;
      paused = false;
      overlayMode = null;
      koHandlers = null;
      hpP1 = 100;
      hpP2 = 100;
      const overlay = $('pause-overlay');
      if (overlay) overlay.hidden = true;
      const rematchBtn = $('rematch');
      if (rematchBtn) rematchBtn.hidden = true;
      const resumeBtn = $('resume');
      if (resumeBtn) resumeBtn.hidden = false;
      setHealth('p1', 100, 100);
      setHealth('p2', 100, 100);
      setCombo('p1', 0);
      setCombo('p2', 0);
      renderTimer();
      if (timerId) clearInterval(timerId);
      timerId = setInterval(() => {
        if (running && !paused) {
          elapsed += 250;
          renderTimer();
        }
      }, 250);
    },
    // Stop the match timer (KO path). Rendering continues.
    stop() {
      running = false;
      if (timerId) clearInterval(timerId);
      timerId = 0;
    },
    setHealth,
    setCombo,
    showKo,
    hideKo,
    setFighters(a, b, m) {
      currentP1 = a || currentP1;
      currentP2 = b || currentP2;
      if (m) currentMode = m;
      renderFighters();
    },
    setPaused,
    togglePause() { setPaused(!paused); },
    isPaused: () => paused,
    getElapsed: () => elapsed,
    destroy() {
      running = false;
      if (timerId) clearInterval(timerId);
      if (root.parentNode === arenaScreenEl) arenaScreenEl.removeChild(root);
    },
  };
}
