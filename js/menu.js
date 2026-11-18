// RISHU.COM — Phase 2 — menu.js (visual redesign 2026-11-15)
// Screen router + menu / modes / character-select / modals logic.
// Phase 2 character select: a large live 3D preview (characterPreview.js)
// in a 55/45 split with an ivory detail panel, plus a horizontal fighter
// carousel below. Tap a card to preview that fighter; "Select Fighter"
// confirms the pick (victory pose + confirmed badge); "Continue" enters
// the arena with the confirmed fighters.
// Main menu (Build A): two-fighter cinematic scene (menuScene.js) +
// logo lockup + PLAY / CHARACTER SELECT / SETTINGS / QUIT.
// No fake buttons: every action below either navigates, opens a real
// modal, changes a real setting, or is explicitly labelled Coming Soon.

import { CHARACTERS, getCharacter, STAT_DEFS } from './characters.js';
import { createCharacterPreview } from './characterPreview.js';
import { createMenuScene } from './menuScene.js';
import { RISHU_FACE_PORTRAIT } from './rishuFace.js';

const SETTINGS_KEY = 'rishu.settings.v1';
const SELECTION_KEY = 'rishu.selection.v1';
// Phase 6 — CPU opponent settings: difficulty + the explicitly picked
// CPU fighter (null = random, the default). Same pattern as the other
// two keys; difficulty defaults to 'medium'.
const AI_KEY = 'rishu.ai.v1';
export const AI_DIFFICULTIES = ['easy', 'medium', 'hard'];

export function loadAiSettings() {
  try {
    const raw = localStorage.getItem(AI_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        difficulty: AI_DIFFICULTIES.includes(parsed.difficulty) ? parsed.difficulty : 'medium',
        cpuPick: typeof parsed.cpuPick === 'string' ? parsed.cpuPick : null,
      };
    }
  } catch (e) { /* storage unavailable — fall through to defaults */ }
  return { difficulty: 'medium', cpuPick: null };
}

export function saveAiSettings(a) {
  try { localStorage.setItem(AI_KEY, JSON.stringify(a)); } catch (e) { /* ignore */ }
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed = { sound: true, quality: 'high', volume: 100, ...JSON.parse(raw) };
      parsed.volume = Math.max(0, Math.min(100, Number(parsed.volume) || 0));
      return parsed;
    }
  } catch (e) { /* storage unavailable — fall through to defaults */ }
  return { sound: true, quality: 'high', volume: 100 };
}

export function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
}

function loadSelection() {
  try {
    const raw = localStorage.getItem(SELECTION_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return null;
}

function saveSelection(sel) {
  try { localStorage.setItem(SELECTION_KEY, JSON.stringify({ ...sel, at: Date.now() })); } catch (e) { /* ignore */ }
}

export function initMenu(api) {
  // api: { settings, onQualityChange, onEnterArena(mode, p1, p2),
  //        onRequestFullscreen, arenaReady, onLeaveArena }
  const $ = (id) => document.getElementById(id);
  const screens = {
    menu: $('screen-menu'),
    modes: $('screen-modes'),
    characters: $('screen-characters'),
    arena: $('screen-arena'),
  };
  let currentScreen = 'menu';
  let selectedMode = null; // 'pvc' | '2p'
  let p1 = null; // confirmed character id
  let p2 = null; // confirmed character id
  let pickingFor = 'p1'; // in 2P mode, which slot is being confirmed
  let focused = null; // character id currently shown in the 3D preview
  let preview = null; // characterPreview instance (lazy)
  let previewWalk = false;
  let confirming = false; // guards the victory->arena transition
  let menuScene = null; // two-fighter menu scene (lazy, menu screen only)
  // Phase 6 — CPU opponent settings (PvC only): difficulty + the
  // explicitly picked CPU fighter (null = random).
  let aiDifficulty = 'medium';
  let cpuPick = null;

  let showTimer = null;
  function show(name) {
    if (name === currentScreen) return;
    const prev = screens[currentScreen];
    const next = screens[name];
    if (!next) return;
    // Leaving the arena stops the match — in ONE place, so every exit
    // path (Back button, Game Modes button, nav, footer) is covered and
    // no input/timer can keep running behind another screen.
    if (currentScreen === 'arena' && name !== 'arena' && api.onLeaveArena) api.onLeaveArena();
    currentScreen = name;
    window.scrollTo({ top: 0 });
    clearTimeout(showTimer);
    if (prev && prev !== next) {
      // Crossfade-rise: outgoing fades first, incoming rises in after 180ms.
      prev.classList.add('leaving');
      showTimer = setTimeout(() => {
        prev.classList.remove('active', 'leaving');
        next.classList.add('active');
        afterShow(name);
      }, 180);
    } else {
      if (prev) prev.classList.remove('active');
      next.classList.add('active');
      afterShow(name);
    }
  }

  // Runs once the incoming screen is visible.
  function afterShow(name) {
    // Arena canvas only needs a resize when its screen becomes visible
    if (name === 'arena' && api.onArenaShown) api.onArenaShown();
    if (name === 'characters' && preview) preview.resize();
    if (name === 'menu') {
      ensureMenuScene();
      if (menuScene) { menuScene.resize(); menuScene.start(); }
    } else if (menuScene) {
      // Pause the menu loop while another screen shows (the scene is
      // kept — one renderer, no re-bake — just the rAF stops).
      menuScene.stop();
    }
  }

  function showToast(msg) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------- 3D preview ----------
  function ensurePreview() {
    if (preview) return preview;
    const wrap = $('preview-wrap');
    if (!wrap) return null;
    try {
      preview = createCharacterPreview(wrap, {
        quality: api.settings.quality,
        isVisible: () => currentScreen === 'characters',
      });
    } catch (e) {
      console.error('[RISHU] Character preview failed to start:', e);
      preview = null;
    }
    if (!preview && !wrap.querySelector('.preview-fallback')) {
      // Honest fallback: cards still work, preview area explains why.
      // Appended (not innerHTML) so the hint + confirmed badge survive.
      wrap.insertAdjacentHTML('beforeend', '<p class="preview-fallback">3D preview is unavailable in this browser (WebGL needed). Character cards below still work — tap one, then Select Fighter.</p>');
    }
    return preview;
  }

  // ---------- Main menu scene (Build A): two fighters facing off ----------
  function ensureMenuScene() {
    if (menuScene) return menuScene;
    const wrap = $('menu-scene');
    if (!wrap) return null;
    try {
      menuScene = createMenuScene(wrap);
      menuScene.start();
    } catch (e) {
      console.error('[RISHU] Menu scene failed to start:', e);
      menuScene = null;
    }
    if (!menuScene && !wrap.querySelector('.preview-fallback')) {
      // Honest fallback: the menu still works, the stage explains why.
      wrap.insertAdjacentHTML('beforeend', '<p class="preview-fallback">3D menu scene is unavailable in this browser (WebGL needed). Play still works.</p>');
    }
    return menuScene;
  }

  function focusCharacter(id, animate = true) {
    const c = getCharacter(id);
    if (!c) return;
    focused = id;
    if (preview) {
      preview.setFighter(c, animate);
      if (previewWalk) preview.setAnimation('walk');
    }
    renderDetail(c);
    renderGrid();
    // Carousel: keep the focused card centred + a short scale pulse.
    // Only on a real tap (animate) — never on first open, so the page
    // does not scroll away from the top when character select opens.
    if (animate) {
      const card = grid && grid.querySelector('.char-card.focused');
      if (card) {
        card.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
        card.classList.add('just-focused');
        setTimeout(() => card.classList.remove('just-focused'), 160);
      }
    }
    updatePickUI();
  }

  function renderDetail(c) {
    const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
    set('preview-name', c.name);
    set('stage-name-text', c.name);
    set('preview-tagline', `${c.title} · ${c.style}`);
    set('preview-personality', c.personality);
    set('preview-special', c.specialMove);
    const statsEl = $('preview-stats');
    if (statsEl) {
      statsEl.innerHTML = STAT_DEFS.map((d) => `
        <div class="stat-row">
          <span>${d.label}</span>
          <span class="stat-bar" role="img" aria-label="${d.label} ${c[d.key]} out of 10"><i style="width:${c[d.key] * 10}%"></i></span>
          <b>${c[d.key]}</b>
        </div>`).join('');
    }
    const badge = $('preview-badge');
    if (badge) {
      const confirmed = (selectedMode === '2p' && pickingFor === 'p1' && p1 === c.id)
        || (selectedMode === '2p' && pickingFor === 'p2' && p2 === c.id)
        || (selectedMode !== '2p' && p1 === c.id);
      badge.hidden = !confirmed;
    }
    // Re-trigger the cinematic entrance stagger on every focus change.
    const detail = document.querySelector('.preview-detail');
    if (detail) {
      detail.classList.remove('entering');
      void detail.offsetWidth;
      detail.classList.add('entering');
    }
  }

  // ---------- Character grid (compact cards — now a horizontal carousel) ----------
  const grid = $('char-grid');
  // Light fighter colours need dark initials to stay readable.
  function isLight(hex) {
    const n = parseInt(hex.slice(1), 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return lum > 0.45;
  }
  function statRow(label, value) {
    return `<div class="stat-row"><span>${label}</span><span class="stat-bar" role="img" aria-label="${label} ${value} out of 10"><i style="width:${value * 10}%"></i></span><b>${value}</b></div>`;
  }
  function renderGrid() {
    if (!grid) return;
    grid.innerHTML = CHARACTERS.map((c) => {
      const isP1 = p1 === c.id;
      const isP2 = p2 === c.id;
      const isFocused = focused === c.id;
      const tag = isP1 && isP2 ? 'P1 · P2' : isP1 ? 'P1' : isP2 ? 'P2' : '';
      const taken = selectedMode === '2p' && pickingFor === 'p2' && p1 === c.id;
      return `
      <button class="char-card ${isFocused ? 'focused' : ''} ${isP1 || isP2 ? 'selected' : ''} ${taken ? 'taken' : ''}" data-char="${c.id}" aria-pressed="${isP1 || isP2}" ${taken ? 'disabled' : ''}>
        <span class="char-avatar${isLight(c.color) ? ' char-avatar--light' : ''}${c.id === 'rishu' ? ' char-avatar--photo' : ''}" style="--c:${c.color};--cd:${c.colorDark}">${c.id === 'rishu' ? `<img src="${RISHU_FACE_PORTRAIT}" alt="Rishu">` : c.initials}</span>
        ${tag ? `<span class="char-tag">${tag}</span>` : ''}
        ${isFocused ? '<span class="char-focus">Previewing</span>' : ''}
        <span class="char-name">${c.name}</span>
        <span class="char-title">${c.title} · ${c.style}</span>
        <span class="char-stats">
          ${STAT_DEFS.map((d) => statRow(d.label, c[d.key])).join('')}
        </span>
        <span class="char-diff">Difficulty: ${c.difficulty} · Special: ${c.specialMove}</span>
      </button>`;
    }).join('');
    grid.querySelectorAll('.char-card').forEach((card) => {
      card.addEventListener('click', () => focusCharacter(card.dataset.char));
    });
    updatePickUI();
  }

  function updatePickUI() {
    const hint = $('pick-hint');
    const confirmBtn = $('btn-confirm-fighters');
    const selectBtn = $('btn-select-fighter');
    if (selectedMode === '2p') {
      const p1c = p1 ? getCharacter(p1) : null;
      const p2c = p2 ? getCharacter(p2) : null;
      if (hint) {
        hint.textContent = pickingFor === 'p1'
          ? `Confirming Player 1${p1c ? ` — ${p1c.name} confirmed` : ''}. Preview a fighter, then press Select Fighter.`
          : `Player 1: ${p1c ? p1c.name : '—'} · Now confirming Player 2${p2c ? ` — ${p2c.name} confirmed` : ''}.`;
      }
      if (confirmBtn) {
        confirmBtn.disabled = !(p1 && p2) || confirming;
        confirmBtn.textContent = (p1 && p2) ? 'Continue to Arena →' : 'Confirm Both Fighters to Continue';
      }
    } else {
      const p1c = p1 ? getCharacter(p1) : null;
      const cpu = p2 ? getCharacter(p2) : null;
      if (hint) {
        hint.textContent = p1c
          ? `${p1c.name} confirmed. CPU opponent: ${cpu ? cpu.name : 'Random — picked on Continue'}. Tap another fighter + Select Fighter to change the CPU.`
          : 'Preview a fighter, then press Select Fighter to confirm your pick.';
      }
      if (confirmBtn) {
        confirmBtn.disabled = !p1 || confirming;
        confirmBtn.textContent = p1 ? 'Continue to Arena →' : 'Select a Fighter to Continue';
      }
    }
    if (selectBtn) {
      const fc = focused ? getCharacter(focused) : null;
      selectBtn.disabled = !fc || confirming;
      selectBtn.textContent = fc ? `Select ${fc.name}` : 'Select Fighter';
    }
    const p1Label = $('slot-p1');
    const p2Label = $('slot-p2');
    if (p1Label) p1Label.textContent = p1 ? `P1: ${getCharacter(p1).name}` : 'P1: —';
    if (p2Label) {
      p2Label.textContent = p2
        ? `${selectedMode === '2p' ? 'P2' : 'CPU'}: ${getCharacter(p2).name}`
        : `${selectedMode === '2p' ? 'P2' : 'CPU'}: ${selectedMode === '2p' ? '—' : 'Random'}`;
    }
    // Swap-pick only makes sense in Two Player Local — hide it in PvC
    // so it is never a dead button.
    const swapBtn = $('btn-swap-pick');
    if (swapBtn) swapBtn.style.display = selectedMode === '2p' ? '' : 'none';
    // Phase 6 — difficulty row + Random CPU button: PvC only.
    const aiRow = $('ai-row');
    if (aiRow) {
      aiRow.hidden = selectedMode === '2p';
      aiRow.querySelectorAll('.ai-diff-btn').forEach((b) => {
        const active = b.dataset.difficulty === aiDifficulty;
        b.classList.toggle('ai-diff-btn--active', active);
        b.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }
  }

  // Phase 6 — difficulty row: three buttons, persisted in rishu.ai.v1,
  // pre-selected from storage on open. PvC only (the row is hidden in
  // 2P by updatePickUI).
  function setDifficulty(d) {
    if (!AI_DIFFICULTIES.includes(d)) return;
    aiDifficulty = d;
    saveAiSettings({ difficulty: aiDifficulty, cpuPick });
    updatePickUI();
    showToast(`CPU difficulty: ${d[0].toUpperCase()}${d.slice(1)}.`);
  }

  // Confirm the currently previewed fighter for the active slot.
  // Plays the victory pose + ring pulse in the preview, then locks the pick.
  function selectFocusedFighter() {
    if (!focused || confirming) return;
    const c = getCharacter(focused);
    if (!c) return;
    if (selectedMode === '2p') {
      if (pickingFor === 'p1') {
        p1 = focused;
        if (p2 === focused) p2 = null; // same fighter cannot be both
        pickingFor = 'p2';
      } else {
        if (focused === p1) { showToast('P2 needs a different fighter than P1.'); return; }
        p2 = focused;
        pickingFor = 'p1'; // allow re-confirming either after both are set
      }
    } else {
      // Phase 6 — PvC: the first pick is the player; a later pick of a
      // DIFFERENT fighter sets the CPU opponent (the saved pick, or a
      // random other fighter when none was picked). Re-picking the same
      // fighter just re-confirms the player.
      const hadP1 = !!p1;
      if (!hadP1) {
        p1 = focused;
        if (cpuPick && cpuPick !== focused && getCharacter(cpuPick)) {
          p2 = cpuPick;
        } else {
          const others = CHARACTERS.filter((x) => x.id !== focused);
          p2 = others[Math.floor(Math.random() * others.length)].id;
        }
      } else if (focused !== p1) {
        p2 = focused;
        cpuPick = focused;
        saveAiSettings({ difficulty: aiDifficulty, cpuPick });
      }
    }
    if (preview) {
      preview.setAnimation('victory');
      preview.pulseRing();
      setTimeout(() => { if (preview) preview.setAnimation(previewWalk ? 'walk' : 'idle'); }, 1400);
    }
    // Orange ring flash on the stage (solid ring, fades in 400ms).
    const stage = document.querySelector('.stage');
    if (stage) {
      stage.classList.remove('flash');
      void stage.offsetWidth;
      stage.classList.add('flash');
      setTimeout(() => stage.classList.remove('flash'), 450);
    }
    // Phase 6 — in PvC a later pick of a different fighter sets the
    // CPU opponent; say so (the old "confirmed" toast would lie).
    const pickedCpu = selectedMode !== '2p' && p1 && focused !== p1 && p2 === focused;
    showToast(pickedCpu
      ? `${c.name} set as the CPU opponent.`
      : `${c.name} confirmed${selectedMode === '2p' ? ` for ${pickingFor === 'p2' ? 'Player 1' : 'Player 2'}` : ''}!`);
    renderDetail(c);
    renderGrid();
  }

  function openCharacterSelect(mode) {
    selectedMode = mode;
    p1 = null;
    p2 = null;
    pickingFor = 'p1';
    confirming = false;
    // Phase 6 — CPU settings from storage (PvC only): the difficulty
    // row pre-selects, and the saved CPU pick is reused when the
    // player confirms their fighter.
    const ai = loadAiSettings();
    aiDifficulty = ai.difficulty;
    cpuPick = (ai.cpuPick && getCharacter(ai.cpuPick)) ? ai.cpuPick : null;
    const title = $('char-title');
    const sub = $('char-sub');
    if (title) title.textContent = mode === '2p' ? 'Choose Your Fighters' : 'Choose Your Fighter';
    if (sub) sub.textContent = mode === '2p'
      ? 'Player 1 confirms first, then Player 2. Same fighter cannot be picked twice.'
      : 'Pick your fighter, then pick your CPU opponent — or leave it random. Set the CPU difficulty below.';
    ensurePreview();
    // Pre-focus the last confirmed fighter (PvC) so returning players
    // land on their fighter instead of starting over.
    const saved = loadSelection();
    const startId = (mode !== '2p' && saved && saved.p1 && getCharacter(saved.p1))
      ? saved.p1
      : CHARACTERS[0].id;
    show('characters');
    focusCharacter(startId, false);
  }

  function confirmFighters() {
    if (confirming) return;
    if (selectedMode === '2p' && !(p1 && p2)) return;
    if (selectedMode !== '2p' && !p1) return;
    // CPU opponent in PvC is re-rolled on Continue if it was never set.
    if (selectedMode !== '2p' && !p2) {
      const others = CHARACTERS.filter((x) => x.id !== p1);
      p2 = others[Math.floor(Math.random() * others.length)].id;
    }
    const a = getCharacter(p1);
    const b = getCharacter(p2);
    saveSelection({ mode: selectedMode, p1, p2 });
    // Phase 6 — persist the CPU settings (difficulty + the explicit CPU
    // pick, if any) and pass the difficulty through to the arena.
    if (selectedMode !== '2p') saveAiSettings({ difficulty: aiDifficulty, cpuPick });
    // Victory pose in the preview, then step into the arena.
    confirming = true;
    updatePickUI();
    if (preview) preview.setAnimation('victory');
    setTimeout(() => {
      confirming = false;
      try {
        const label = $('arena-fight-label');
        if (label) {
          label.innerHTML = `${a.name} <span class="vs">VS</span> ${b.name} <span class="fight-meta">· ${selectedMode === '2p' ? 'Two Player Local' : `Player vs Computer · CPU ${aiDifficulty[0].toUpperCase()}${aiDifficulty.slice(1)}`}</span>`;
        }
        if (api.onEnterArena) api.onEnterArena(selectedMode, a, b, selectedMode === '2p' ? undefined : { difficulty: aiDifficulty });
        show('arena');
      } catch (e) {
        // Never strand the user on a dead disabled button: if the arena
        // fails to start, re-enable Continue and say so honestly.
        console.error('[RISHU] Could not enter the arena:', e);
        showToast('Arena could not start — please try Continue again.');
      }
      updatePickUI();
    }, 650);
  }

  // ---------- Navigation wiring ----------
  const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };

  // ---------- New navigation (redesign) ----------
  function closeNavOverlay() {
    const ov = $('nav-overlay');
    if (ov) { ov.classList.remove('open'); ov.setAttribute('aria-hidden', 'true'); }
    const btn = $('btn-nav-menu');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
  function openNavOverlay() {
    const ov = $('nav-overlay');
    if (ov) { ov.classList.add('open'); ov.setAttribute('aria-hidden', 'false'); }
    const btn = $('btn-nav-menu');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }
  bind('btn-nav-menu', openNavOverlay);
  bind('btn-nav-close', closeNavOverlay);
  const goModes = () => { closeNavOverlay(); show('modes'); };
  const goFighters = () => { closeNavOverlay(); openCharacterSelect('pvc'); };
  const goArena = () => {
    closeNavOverlay();
    // Arena needs confirmed fighters; otherwise start character select.
    if (p1 && p2) show('arena');
    else openCharacterSelect('pvc');
  };
  const goPlay = () => { closeNavOverlay(); show('modes'); };
  bind('nav-home', () => show('menu'));
  bind('nav-modes', goModes);
  bind('nav-fighters', goFighters);
  bind('nav-arena', goArena);
  bind('nav-play', goPlay);
  bind('ov-modes', goModes);
  bind('ov-fighters', goFighters);
  bind('ov-arena', goArena);
  bind('ov-play', goPlay);
  bind('ov-how', () => { closeNavOverlay(); openModal('modal-how'); });
  bind('ov-settings', () => { closeNavOverlay(); openModal('modal-settings'); });
  bind('foot-modes', goModes);
  bind('foot-fighters', goFighters);
  bind('foot-arena', goArena);
  bind('foot-settings', () => openModal('modal-settings'));
  // Build A removed the menu's mode-cards / arena-preview / featured-
  // fighters sections (the menu is now the two-fighter scene + the four
  // menu buttons). Their bindings went with them; Modes / Fighters /
  // Arena are still reachable from the nav, the footer and screen-modes.
  bind('btn-play', () => show('modes'));
  bind('btn-menu-settings', () => openModal('modal-settings'));
  // QUIT (D-3): window.close() cannot close a tab the script did not
  // open, so QUIT tries, then shows the honest fallback overlay.
  bind('btn-menu-quit', () => {
    try { window.close(); } catch (e) { /* browsers may block it */ }
    const q = $('quit-overlay');
    if (q) { q.classList.add('open'); q.setAttribute('aria-hidden', 'false'); }
  });
  bind('btn-quit-stay', () => {
    const q = $('quit-overlay');
    if (q) { q.classList.remove('open'); q.setAttribute('aria-hidden', 'true'); }
  });
  // Settings -> CPU difficulty lives on character select: a real row
  // that takes the user there (difficulty itself is NOT in settings).
  bind('btn-settings-goto-select', () => {
    closeModal('modal-settings');
    openCharacterSelect('pvc');
  });
  bind('btn-modes', () => show('modes'));
  bind('btn-characters', () => openCharacterSelect('pvc'));
  bind('btn-how', () => openModal('modal-how'));
  bind('btn-settings', () => openModal('modal-settings'));
  bind('btn-fullscreen', () => { if (api.onRequestFullscreen) api.onRequestFullscreen(); });

  bind('btn-back-menu', () => show('menu'));
  bind('btn-back-modes', () => show('modes'));
  bind('btn-back-arena', () => show('characters'));

  bind('mode-pvc-2', () => openCharacterSelect('pvc'));
  bind('mode-2p-2', () => openCharacterSelect('2p'));
  // Online: a disabled Coming Soon card in HTML — deliberately NO handler,
  // so it can never act like a working button.

  bind('btn-confirm-fighters', confirmFighters);
  bind('btn-select-fighter', selectFocusedFighter);

  // Phase 6 — CPU difficulty buttons (PvC only; the row is hidden in
  // 2P by updatePickUI) + Random CPU opponent (clears an explicit CPU
  // pick — the CPU is re-rolled on Continue).
  document.querySelectorAll('.ai-diff-btn').forEach((b) => {
    b.addEventListener('click', () => setDifficulty(b.dataset.difficulty));
  });
  bind('btn-random-cpu', () => {
    p2 = null;
    cpuPick = null;
    saveAiSettings({ difficulty: aiDifficulty, cpuPick: null });
    showToast('CPU opponent: random.');
    renderGrid();
  });

  // Preview controls — all real actions on the live 3D preview.
  bind('btn-preview-rotate', () => {
    if (!preview) return;
    const on = !preview.getAutoRotate();
    preview.setAutoRotate(on);
    const btn = $('btn-preview-rotate');
    if (btn) btn.textContent = on ? 'Auto-rotate: On' : 'Auto-rotate: Off';
  });
  bind('btn-preview-walk', () => {
    if (!preview) return;
    previewWalk = !previewWalk;
    preview.setAnimation(previewWalk ? 'walk' : 'idle');
    const btn = $('btn-preview-walk');
    if (btn) btn.textContent = previewWalk ? 'Walking — tap to stop' : 'Walk Preview';
  });

  // Swap P1/P2 pick order in 2P mode (small, real utility)
  bind('btn-swap-pick', () => {
    if (selectedMode !== '2p') return;
    pickingFor = pickingFor === 'p1' ? 'p2' : 'p1';
    updatePickUI();
  });

  // ---------- Modals ----------
  function openModal(id) {
    const m = $(id);
    if (m) { m.classList.add('open'); m.setAttribute('aria-hidden', 'false'); }
  }
  function closeModal(id) {
    const m = $(id);
    if (m) { m.classList.remove('open'); m.setAttribute('aria-hidden', 'true'); }
  }
  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('open'); });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal.open').forEach((m) => m.classList.remove('open'));
      closeNavOverlay();
    }
  });

  // ---------- Settings (real, persisted) ----------
  const settings = api.settings;
  const soundToggle = $('setting-sound');
  const qualitySelect = $('setting-quality');
  if (soundToggle) {
    soundToggle.checked = !!settings.sound;
    soundToggle.addEventListener('change', () => {
      settings.sound = soundToggle.checked;
      saveSettings(settings);
      showToast(settings.sound ? 'Sound on.' : 'Sound off.');
    });
  }
  if (qualitySelect) {
    qualitySelect.value = settings.quality;
    qualitySelect.addEventListener('change', () => {
      settings.quality = qualitySelect.value;
      saveSettings(settings);
      if (api.onQualityChange) api.onQualityChange(settings.quality);
      if (preview) preview.setQuality(settings.quality);
      showToast(`Quality set to ${settings.quality}.`);
    });
  }
  // SFX volume (Build A, D-5): honest slider, persisted, applied live
  // to the arena via api.onVolumeChange (0–1). No music behind it.
  const volumeSlider = $('setting-volume');
  const volumeValue = $('setting-volume-value');
  function applyVolume(v, { save = true, silent = false } = {}) {
    const pct = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    settings.volume = pct;
    if (save) saveSettings(settings);
    if (volumeSlider) volumeSlider.value = String(pct);
    if (volumeValue) volumeValue.textContent = `${pct}%`;
    if (api.onVolumeChange) api.onVolumeChange(pct / 100);
    if (!silent) showToast(`SFX volume ${pct}%.`);
  }
  if (volumeSlider) {
    volumeSlider.value = String(settings.volume ?? 100);
    if (volumeValue) volumeValue.textContent = `${settings.volume ?? 100}%`;
    volumeSlider.addEventListener('input', () => applyVolume(volumeSlider.value, { silent: true }));
    volumeSlider.addEventListener('change', () => applyVolume(volumeSlider.value));
  }
  bind('btn-reset-settings', () => {
    const fresh = { sound: true, quality: 'high', volume: 100 };
    Object.assign(settings, fresh);
    saveSettings(settings);
    if (soundToggle) soundToggle.checked = true;
    if (qualitySelect) qualitySelect.value = 'high';
    if (volumeSlider) volumeSlider.value = '100';
    if (volumeValue) volumeValue.textContent = '100%';
    if (api.onQualityChange) api.onQualityChange('high');
    if (api.onVolumeChange) api.onVolumeChange(1);
    if (preview) preview.setQuality('high');
    showToast('Settings reset to defaults.');
  });

  // Footer / secondary links — all real actions, no dead buttons
  bind('btn-about', () => openModal('modal-about'));
  bind('btn-how-footer', () => openModal('modal-how'));
  bind('btn-phase2', () => openModal('modal-phase2'));

  // Initial render (menu screen); the character preview is created
  // lazily on first open so the menu stays fast. The menu scene starts
  // now — it is the first thing on the menu screen.
  focused = CHARACTERS[0].id;
  renderDetail(CHARACTERS[0]);
  renderGrid();
  ensureMenuScene();
  return { show, showToast, openCharacterSelect };
}
