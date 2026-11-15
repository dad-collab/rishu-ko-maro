// RISHU.COM — Phase 2 — menu.js (visual redesign 2026-11-15)
// Screen router + menu / modes / character-select / modals logic.
// Phase 2 character select: a large live 3D preview (characterPreview.js)
// in a 55/45 split with an ivory detail panel, plus a horizontal fighter
// carousel below. Tap a card to preview that fighter; "Select Fighter"
// confirms the pick (victory pose + confirmed badge); "Continue" enters
// the arena with the confirmed fighters.
// Homepage: asymmetric hero with a live 3D showcase (same preview module).
// No fake buttons: every action below either navigates, opens a real
// modal, changes a real setting, or is explicitly labelled Coming Soon.

import { CHARACTERS, getCharacter, STAT_DEFS } from './characters.js';
import { createCharacterPreview } from './characterPreview.js';

const SETTINGS_KEY = 'rishu.settings.v1';
const SELECTION_KEY = 'rishu.selection.v1';

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { sound: true, quality: 'high', ...JSON.parse(raw) };
  } catch (e) { /* storage unavailable — fall through to defaults */ }
  return { sound: true, quality: 'high' };
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
  let heroPreview = null; // homepage showcase preview (lazy, menu screen only)

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
      ensureHeroPreview();
      if (heroPreview) heroPreview.resize();
    }
    // WebGL budget: on small screens the hero preview is destroyed — not
    // just hidden — when leaving the menu, to protect low-end memory.
    if (name !== 'menu' && heroPreview && window.matchMedia('(max-width: 640px)').matches) {
      heroPreview.dispose();
      heroPreview = null;
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

  // ---------- Homepage hero showcase (reuses characterPreview.js) ----------
  function ensureHeroPreview() {
    if (heroPreview) return heroPreview;
    const wrap = $('hero-preview');
    if (!wrap) return null;
    try {
      heroPreview = createCharacterPreview(wrap, {
        quality: api.settings.quality,
        isVisible: () => currentScreen === 'menu',
      });
      if (heroPreview) heroPreview.setFighter(getCharacter('rishu'), false);
    } catch (e) {
      console.error('[RISHU] Hero showcase failed to start:', e);
      heroPreview = null;
    }
    if (!heroPreview) {
      // Honest fallback: the menu still works, the stage explains why.
      wrap.innerHTML = '<p class="preview-fallback">3D showcase is unavailable in this browser (WebGL needed). Play Now still works.</p>';
    }
    return heroPreview;
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
        <span class="char-avatar${isLight(c.color) ? ' char-avatar--light' : ''}" style="--c:${c.color};--cd:${c.colorDark}">${c.initials}</span>
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
      if (hint) hint.textContent = p1c ? `${p1c.name} confirmed. CPU opponent: ${cpu ? cpu.name : 'random — picked on Continue'}.` : 'Preview a fighter, then press Select Fighter to confirm your pick.';
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
    if (p2Label) p2Label.textContent = p2 ? `${selectedMode === '2p' ? 'P2' : 'CPU'}: ${getCharacter(p2).name}` : `${selectedMode === '2p' ? 'P2' : 'CPU'}: —`;
    // Swap-pick only makes sense in Two Player Local — hide it in PvC
    // so it is never a dead button.
    const swapBtn = $('btn-swap-pick');
    if (swapBtn) swapBtn.style.display = selectedMode === '2p' ? '' : 'none';
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
      p1 = focused;
      // CPU opponent: pick a different fighter at random
      const others = CHARACTERS.filter((x) => x.id !== focused);
      p2 = others[Math.floor(Math.random() * others.length)].id;
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
    showToast(`${c.name} confirmed${selectedMode === '2p' ? ` for ${pickingFor === 'p2' ? 'Player 1' : 'Player 2'}` : ''}!`);
    renderDetail(c);
    renderGrid();
  }

  function openCharacterSelect(mode) {
    selectedMode = mode;
    p1 = null;
    p2 = null;
    pickingFor = 'p1';
    confirming = false;
    const title = $('char-title');
    const sub = $('char-sub');
    if (title) title.textContent = mode === '2p' ? 'Choose Your Fighters' : 'Choose Your Fighter';
    if (sub) sub.textContent = mode === '2p'
      ? 'Player 1 confirms first, then Player 2. Same fighter cannot be picked twice.'
      : 'Your CPU opponent is picked at random from the remaining fighters.';
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
    // Victory pose in the preview, then step into the arena.
    confirming = true;
    updatePickUI();
    if (preview) preview.setAnimation('victory');
    setTimeout(() => {
      confirming = false;
      try {
        const label = $('arena-fight-label');
        if (label) {
          label.innerHTML = `${a.name} <span class="vs">VS</span> ${b.name} <span class="fight-meta">· ${selectedMode === '2p' ? 'Two Player Local' : 'Player vs Computer'}</span>`;
        }
        if (api.onEnterArena) api.onEnterArena(selectedMode, a, b);
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
  bind('btn-arena-enter', () => show('modes'));

  // Featured fighters strip: open character select focused on that fighter.
  document.querySelectorAll('#featured-strip [data-char]').forEach((card) => {
    card.addEventListener('click', () => {
      openCharacterSelect('pvc');
      focusCharacter(card.dataset.char);
    });
  });
  // Strip scroll buttons (text arrows, not icons).
  bind('featured-prev', () => {
    const strip = $('featured-strip');
    if (strip) strip.scrollBy({ left: -320, behavior: 'smooth' });
  });
  bind('featured-next', () => {
    const strip = $('featured-strip');
    if (strip) strip.scrollBy({ left: 320, behavior: 'smooth' });
  });

  bind('btn-play', () => show('modes'));
  bind('btn-modes', () => show('modes'));
  bind('btn-characters', () => openCharacterSelect('pvc'));
  bind('btn-how', () => openModal('modal-how'));
  bind('btn-settings', () => openModal('modal-settings'));
  bind('btn-fullscreen', () => { if (api.onRequestFullscreen) api.onRequestFullscreen(); });

  bind('btn-back-menu', () => show('menu'));
  bind('btn-back-modes', () => show('modes'));
  bind('btn-back-arena', () => show('characters'));

  bind('mode-pvc', () => openCharacterSelect('pvc'));
  bind('mode-2p', () => openCharacterSelect('2p'));
  bind('mode-pvc-2', () => openCharacterSelect('pvc'));
  bind('mode-2p-2', () => openCharacterSelect('2p'));
  // Online: a disabled Coming Soon card in HTML — deliberately NO handler,
  // so it can never act like a working button.

  bind('btn-confirm-fighters', confirmFighters);
  bind('btn-select-fighter', selectFocusedFighter);

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
      showToast(settings.sound ? 'Sound on.' : 'Sound off. (No audio in Phase 2 preview.)');
    });
  }
  if (qualitySelect) {
    qualitySelect.value = settings.quality;
    qualitySelect.addEventListener('change', () => {
      settings.quality = qualitySelect.value;
      saveSettings(settings);
      if (api.onQualityChange) api.onQualityChange(settings.quality);
      if (preview) preview.setQuality(settings.quality);
      if (heroPreview) heroPreview.setQuality(settings.quality);
      showToast(`Quality set to ${settings.quality}.`);
    });
  }
  bind('btn-reset-settings', () => {
    const fresh = { sound: true, quality: 'high' };
    Object.assign(settings, fresh);
    saveSettings(settings);
    if (soundToggle) soundToggle.checked = true;
    if (qualitySelect) qualitySelect.value = 'high';
    if (api.onQualityChange) api.onQualityChange('high');
    if (preview) preview.setQuality('high');
    if (heroPreview) heroPreview.setQuality('high');
    showToast('Settings reset to defaults.');
  });

  // Footer / secondary links — all real actions, no dead buttons
  bind('btn-about', () => openModal('modal-about'));
  bind('btn-how-footer', () => openModal('modal-how'));
  bind('btn-phase2', () => openModal('modal-phase2'));

  // Initial render (menu screen); the preview is created lazily on
  // first open so the menu stays fast. The hero showcase starts now —
  // it is the first thing on the menu screen.
  focused = CHARACTERS[0].id;
  renderDetail(CHARACTERS[0]);
  renderGrid();
  ensureHeroPreview();
  return { show, showToast, openCharacterSelect };
}
