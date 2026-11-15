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
// - Health bars: HONEST PLACEHOLDERS for Phase 5. Full, static, labelled
//   "HEALTH · PHASE 5" + a PLACEHOLDER tag. No width changes, no logic,
//   no fake damage. If anyone wires damage to them before Phase 5, that
//   is a Phase 5 change, not this module.
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

  const root = document.createElement('div');
  root.className = 'hud';
  root.setAttribute('aria-label', 'Match HUD');
  root.innerHTML = `
    <div class="hud-side hud-side--p1">
      <span class="hud-icon" data-hud="p1-icon">?</span>
      <span class="hud-name" data-hud="p1-name">Player 1</span>
      <div class="hud-health hud-health--placeholder" role="img"
           aria-label="Health bar placeholder — arrives in Phase 5">
        <i style="width:100%"></i>
        <span class="hud-health-label">HEALTH · PHASE 5</span>
        <span class="hud-placeholder-tag">PLACEHOLDER</span>
      </div>
    </div>
    <div class="hud-center">
      <div class="hud-timer"><span data-hud="timer">00:00</span><small>TIME</small></div>
      <button class="btn btn-small" data-hud="pause" type="button" aria-label="Pause match">⏸ Pause</button>
    </div>
    <div class="hud-side hud-side--p2">
      <span class="hud-icon" data-hud="p2-icon">?</span>
      <span class="hud-name" data-hud="p2-name">Player 2</span>
      <div class="hud-health hud-health--placeholder" role="img"
           aria-label="Health bar placeholder — arrives in Phase 5">
        <i style="width:100%"></i>
        <span class="hud-health-label">HEALTH · PHASE 5</span>
        <span class="hud-placeholder-tag">PLACEHOLDER</span>
      </div>
    </div>
    <div class="hud-pause-overlay" data-hud="pause-overlay" hidden>
      <div class="hud-pause-box" role="dialog" aria-modal="true" aria-label="Match paused">
        <h2>Paused</h2>
        <p data-hud="pause-hint">Movement and the timer are frozen.</p>
        <button class="btn btn-primary" data-hud="resume" type="button">Resume</button>
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
    if (hint) {
      hint.textContent = currentMode === '2p'
        ? 'P1: WASD + Space + Shift · P2: Arrows + Right Shift + Enter. Touch joystick drives P1 only.'
        : 'WASD move · Space jump · Shift run. Touch: left joystick + JUMP button.';
    }
  }

  function setPaused(v) {
    paused = !!v;
    const overlay = $('pause-overlay');
    if (overlay) overlay.hidden = !paused;
    const btn = $('pause');
    if (btn) btn.textContent = paused ? '▶ Resume' : '⏸ Pause';
    if (paused && onPause) onPause();
    if (!paused && running && onResume) onResume();
  }

  const pauseBtn = $('pause');
  if (pauseBtn) pauseBtn.addEventListener('click', () => setPaused(!paused));
  const resumeBtn = $('resume');
  if (resumeBtn) resumeBtn.addEventListener('click', () => setPaused(false));
  const quitBtn = $('quit');
  if (quitBtn) quitBtn.addEventListener('click', () => { if (onQuit) onQuit(); });

  renderFighters();
  renderTimer();

  return {
    start() {
      elapsed = 0;
      running = true;
      paused = false;
      const overlay = $('pause-overlay');
      if (overlay) overlay.hidden = true;
      renderTimer();
      if (timerId) clearInterval(timerId);
      timerId = setInterval(() => {
        if (running && !paused) {
          elapsed += 250;
          renderTimer();
        }
      }, 250);
    },
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
