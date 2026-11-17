// RISHU.COM — Visual Upgrade + Phase 5 — hud.js
// Match HUD for the arena screen. DOM is built by this module (styled
// with the redesigned navy/ivory/orange tokens — no hex colours here).
// Visual Upgrade: the HUD is an OVERLAY on the canvas (mounted inside
// the arena frame, opts.mountEl), not a bar above it — long health
// bars draining toward a centre timer badge, names stacked ABOVE the
// bars, HP shown as a percentage. The pause/winner overlay and the new
// FIGHT banner live in the same overlay root.
//
// Contents (brief §8 + Phase 5):
// - P1 name + character icon (initials tile, fighter colour — real data)
// - P2 name + character icon
// - Match timer (counts UP from 00:00, resets per round — best-of-3,
//   first to 2 wins the match)
// - Health bars: LIVE since Phase 4 (100 HP, deplete on real damage,
//   KO at 0). The bar label is "HEALTH" + the HP number as "100%"; a
//   low bar (≤ 25 HP) gets the .hud-health--low state. No fake damage —
//   the width comes only from combat.js via setHealth().
// - Special slots (Phase 5): the fighter's signature move + a
//   depleting cooldown bar + READY state, driven by the arena every
//   frame via setSpecial().
// - Round pips (Phase 5): "ROUND n" + two pips per side, driven by
//   setRounds().
// - Pause button + pause overlay (Resume / Quit to Menu — both real).
// - WINNER overlay (Phase 5): same box as pause, shown when a fighter
//   takes 2 rounds (Rematch / Quit). Replaces the Phase 4 KO overlay.
// - FIGHT banner (visual upgrade): showFightBanner(text) /
//   hideFightBanner() — the arena drives the 1.2 s fight-start freeze
//   with it; Phase 5 drives round text through the same component
//   ("ROUND 2 — FIGHT!").
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

export function createHud(arenaScreenEl, { p1, p2, mode, onPause, onResume, onQuit, before, mountEl } = {}) {
  let elapsed = 0; // ms of match time (excludes paused time)
  let timerId = 0;
  let running = false;
  let paused = false;
  let currentP1 = p1 || null;
  let currentP2 = p2 || null;
  let currentMode = mode || 'pvc';

  // The pause and winner overlays share ONE element (the pause box)
  // with two contents — overlayMode tracks which one is showing so the
  // two can never fight over it.
  let overlayMode = null; // null | 'pause' | 'winner'
  let overlayHandlers = null; // { onRematch, onQuit } for the winner overlay
  let hpP1 = 100;
  let hpP2 = 100;

  const root = document.createElement('div');
  root.className = 'hud';
  root.setAttribute('aria-label', 'Match HUD');
  root.innerHTML = `
    <div class="hud-top">
      <div class="hud-side hud-side--p1">
        <div class="hud-side-head">
          <span class="hud-icon" data-hud="p1-icon">?</span>
          <span class="hud-name" data-hud="p1-name">Player 1</span>
        </div>
        <div class="hud-health" role="img" aria-label="Player 1 health">
          <i><b></b></i>
          <span class="hud-health-label">HEALTH</span>
          <span class="hud-hp" data-hud="p1-hp">100%</span>
        </div>
        <div class="hud-special" data-hud="p1-special">
          <span class="hud-special-name" data-hud="p1-special-name">—</span>
          <i class="hud-special-bar"><b data-hud="p1-special-fill"></b></i>
          <span class="hud-special-state" data-hud="p1-special-state">READY</span>
        </div>
        <div class="hud-combo" data-hud="p1-combo" hidden>COMBO ×<span data-hud="p1-combo-n">2</span></div>
      </div>
      <div class="hud-center">
        <div class="hud-timer"><span data-hud="timer">00:00</span><small>TIME</small></div>
        <div class="hud-rounds" data-hud="rounds">
          <span class="hud-round-label" data-hud="round-label">ROUND 1</span>
          <span class="hud-pips" data-hud="pips"><i data-hud="pip-a1"></i><i data-hud="pip-a2"></i><b aria-hidden="true">·</b><i data-hud="pip-b1"></i><i data-hud="pip-b2"></i></span>
        </div>
        <button class="btn btn-small" data-hud="pause" type="button" aria-label="Pause match">⏸ Pause</button>
      </div>
      <div class="hud-side hud-side--p2">
        <div class="hud-side-head">
          <span class="hud-icon" data-hud="p2-icon">?</span>
          <span class="hud-name" data-hud="p2-name">Player 2</span>
        </div>
        <div class="hud-health" role="img" aria-label="Player 2 health">
          <i><b></b></i>
          <span class="hud-health-label">HEALTH</span>
          <span class="hud-hp" data-hud="p2-hp">100%</span>
        </div>
        <div class="hud-special" data-hud="p2-special">
          <span class="hud-special-name" data-hud="p2-special-name">—</span>
          <i class="hud-special-bar"><b data-hud="p2-special-fill"></b></i>
          <span class="hud-special-state" data-hud="p2-special-state">READY</span>
        </div>
        <div class="hud-combo" data-hud="p2-combo" hidden>COMBO ×<span data-hud="p2-combo-n">2</span></div>
      </div>
    </div>
    <div class="fight-banner" data-hud="fight-banner" hidden>FIGHT</div>
    <div class="hud-pause-overlay" data-hud="pause-overlay" hidden>
      <div class="hud-pause-box" role="dialog" aria-modal="true" aria-label="Match paused">
        <h2 data-hud="overlay-title">Paused</h2>
        <p data-hud="pause-hint">Movement and the timer are frozen.</p>
        <button class="btn btn-primary" data-hud="resume" type="button">Resume</button>
        <button class="btn btn-primary" data-hud="rematch" type="button" hidden>Rematch</button>
        <button class="btn" data-hud="quit" type="button">Quit to Game Modes</button>
      </div>
    </div>`;
  // Visual upgrade — mount INSIDE the arena frame so the HUD overlays
  // the canvas (opts.mountEl, passed by arena.js). Fall back to the old
  // above-the-frame mount when the anchor is missing so the HUD never
  // disappears.
  if (mountEl) mountEl.appendChild(root);
  else if (before && before.parentNode === arenaScreenEl) arenaScreenEl.insertBefore(root, before);
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
    if (hint && overlayMode !== 'winner') {
      hint.textContent = currentMode === '2p'
        ? 'P1: WASD + Space + Shift · J/K punch · U/I kick · L block · O dodge · H special. P2: Arrows + Right Shift + Enter · Numpad 1/2/3/0 attack · Numpad Enter block · Numpad 5 dodge · Numpad 6 special. Touch drives P1 only.'
        : 'WASD move · Space jump · Shift run · J/K punch · U/I kick · L block · O dodge · H special. Touch: left joystick + JUMP + combat buttons.';
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
    // A finished match cannot be paused — the winner overlay owns the box.
    if (overlayMode === 'winner') return;
    paused = !!v;
    const btn = $('pause');
    if (btn) btn.textContent = paused ? '▶ Resume' : '⏸ Pause';
    if (paused) {
      // Swap the box back to pause content (it may have shown winner
      // text in a previous match on this HUD instance — it cannot, the
      // HUD is rebuilt per match, but stay honest anyway).
      const title = $('overlay-title');
      if (title) title.textContent = 'Paused';
      const box = root.querySelector('.hud-pause-box');
      if (box) box.classList.remove('hud-pause-box--winner');
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
    if (num) num.textContent = `${value}%`;
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

  // Phase 5 — special cooldown slot: move name + a depleting cooldown
  // bar + READY state. `frac` is the fraction of the cooldown REMAINING
  // (1 = just used, 0 = ready) — the bar depletes as it recharges.
  // Change-guarded on the rounded percent and the state label, so the
  // arena's per-frame sync does not churn the DOM.
  const specialState = {
    p1: { name: null, pct: -1, label: null },
    p2: { name: null, pct: -1, label: null },
  };
  function setSpecial(which, { name, frac, ready, remaining } = {}) {
    const st = specialState[which];
    if (!st) return;
    const pct = Math.round(Math.max(0, Math.min(1, frac || 0)) * 100);
    const label = ready ? 'READY' : `${Math.ceil(remaining || 0)}s`;
    if (name !== st.name) {
      st.name = name || null;
      const el = $(`${which}-special-name`);
      if (el) el.textContent = name || '—';
    }
    if (pct !== st.pct) {
      st.pct = pct;
      const fill = $(`${which}-special-fill`);
      if (fill) fill.style.width = `${pct}%`;
    }
    if (label !== st.label) {
      st.label = label;
      const el = $(`${which}-special-state`);
      if (el) el.textContent = label;
      const slot = $(`${which}-special`);
      if (slot) slot.classList.toggle('hud-special--ready', !!ready);
    }
  }

  // Phase 5 — round pips + "ROUND n" label. winsA/winsB are the round
  // wins so far (first to 2 takes the match).
  const roundState = { round: 0, winsA: -1, winsB: -1 };
  function setRounds(round, winsA, winsB) {
    if (round !== roundState.round) {
      roundState.round = round;
      const el = $('round-label');
      if (el) el.textContent = `ROUND ${round}`;
    }
    if (winsA !== roundState.winsA || winsB !== roundState.winsB) {
      roundState.winsA = winsA;
      roundState.winsB = winsB;
      const a1 = $('pip-a1'); if (a1) a1.classList.toggle('hud-pip--won', winsA >= 1);
      const a2 = $('pip-a2'); if (a2) a2.classList.toggle('hud-pip--won', winsA >= 2);
      const b1 = $('pip-b1'); if (b1) b1.classList.toggle('hud-pip--won', winsB >= 1);
      const b2 = $('pip-b2'); if (b2) b2.classList.toggle('hud-pip--won', winsB >= 2);
    }
  }

  // Phase 5 — WINNER overlay: same box as pause, different content.
  // Replaces the Phase 4 KO overlay (showKo is retired — a KO wins a
  // ROUND now, and only the match win shows this screen).
  function showWinner(winnerName, loserName, score, handlers = {}) {
    overlayHandlers = { onRematch: handlers.onRematch, onQuit: handlers.onQuit };
    const title = $('overlay-title');
    if (title) title.textContent = `${winnerName} — WINNER`;
    const hint = $('pause-hint');
    if (hint) hint.textContent = `${loserName} — DEFEATED · Score ${score}`;
    const box = root.querySelector('.hud-pause-box');
    if (box) box.classList.add('hud-pause-box--winner');
    const resumeBtn = $('resume');
    if (resumeBtn) resumeBtn.hidden = true;
    const rematchBtn = $('rematch');
    if (rematchBtn) rematchBtn.hidden = false;
    showOverlay('winner');
  }

  function hideWinner() {
    if (overlayMode !== 'winner') return;
    overlayHandlers = null;
    hideOverlay();
  }

  // Visual upgrade — FIGHT banner. Takes a text parameter from day one
  // ("FIGHT" today; Phase 5 will drive "ROUND 2" → "FIGHT"). The
  // animation restarts on every show (reflow trick) so a Rematch
  // replays the pop.
  function showFightBanner(text) {
    const el = $('fight-banner');
    if (!el) return;
    el.textContent = text || 'FIGHT';
    el.hidden = false;
    el.classList.remove('fight-banner--show');
    void el.offsetWidth;
    el.classList.add('fight-banner--show');
  }

  function hideFightBanner() {
    const el = $('fight-banner');
    if (!el) return;
    el.hidden = true;
    el.classList.remove('fight-banner--show');
  }

  const pauseBtn = $('pause');
  if (pauseBtn) pauseBtn.addEventListener('click', () => setPaused(!paused));
  const resumeBtn = $('resume');
  if (resumeBtn) resumeBtn.addEventListener('click', () => setPaused(false));
  const rematchBtn = $('rematch');
  if (rematchBtn) rematchBtn.addEventListener('click', () => { if (overlayHandlers && overlayHandlers.onRematch) overlayHandlers.onRematch(); });
  const quitBtn = $('quit');
  if (quitBtn) quitBtn.addEventListener('click', () => {
    if (overlayMode === 'winner' && overlayHandlers && overlayHandlers.onQuit) overlayHandlers.onQuit();
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
      overlayHandlers = null;
      hpP1 = 100;
      hpP2 = 100;
      const overlay = $('pause-overlay');
      if (overlay) overlay.hidden = true;
      const box = root.querySelector('.hud-pause-box');
      if (box) box.classList.remove('hud-pause-box--winner');
      const rematchBtn = $('rematch');
      if (rematchBtn) rematchBtn.hidden = true;
      const resumeBtn = $('resume');
      if (resumeBtn) resumeBtn.hidden = false;
      setHealth('p1', 100, 100);
      setHealth('p2', 100, 100);
      setCombo('p1', 0);
      setCombo('p2', 0);
      setRounds(1, 0, 0);
      setSpecial('p1', { name: null, frac: 0, ready: true, remaining: 0 });
      setSpecial('p2', { name: null, frac: 0, ready: true, remaining: 0 });
      renderTimer();
      if (timerId) clearInterval(timerId);
      timerId = setInterval(() => {
        if (running && !paused) {
          elapsed += 250;
          renderTimer();
        }
      }, 250);
    },
    // Stop the match timer (KO / match-end path). Rendering continues.
    stop() {
      running = false;
      if (timerId) clearInterval(timerId);
      timerId = 0;
    },
    setHealth,
    setCombo,
    setSpecial,
    setRounds,
    showWinner,
    hideWinner,
    showFightBanner,
    hideFightBanner,
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
      // The root may live inside the arena frame (overlay mount) or
      // directly under the arena screen (fallback mount) — remove from
      // whichever parent holds it.
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
