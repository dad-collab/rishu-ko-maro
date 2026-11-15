// RISHU.COM — Phase 1 — menu.js
// Screen router + menu / modes / character-select / modals logic.
// No fake buttons: every action below either navigates, opens a real
// modal, changes a real setting, or is explicitly labelled Coming Soon.

import { CHARACTERS, getCharacter } from './characters.js';

const SETTINGS_KEY = 'rishu.settings.v1';

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

export function initMenu(api) {
  // api: { settings, onQualityChange, onEnterArena(mode, p1, p2),
  //        onRequestFullscreen, arenaReady }
  const $ = (id) => document.getElementById(id);
  const screens = {
    menu: $('screen-menu'),
    modes: $('screen-modes'),
    characters: $('screen-characters'),
    arena: $('screen-arena'),
  };
  let currentScreen = 'menu';
  let selectedMode = null; // 'pvc' | '2p'
  let p1 = null; // character id
  let p2 = null; // character id
  let pickingFor = 'p1'; // in 2P mode, which slot is being picked

  function show(name) {
    Object.entries(screens).forEach(([key, el]) => {
      if (el) el.classList.toggle('active', key === name);
    });
    currentScreen = name;
    window.scrollTo({ top: 0 });
    // Arena canvas only needs a resize when its screen becomes visible
    if (name === 'arena' && api.onArenaShown) api.onArenaShown();
  }

  function showToast(msg) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------- Character grid ----------
  const grid = $('char-grid');
  function statRow(label, value) {
    const filled = '■'.repeat(value);
    const empty = '□'.repeat(10 - value);
    return `<div class="stat-row"><span>${label}</span><span class="stat-bar" aria-label="${label} ${value} out of 10">${filled}${empty}</span><b>${value}</b></div>`;
  }
  function renderGrid() {
    if (!grid) return;
    grid.innerHTML = CHARACTERS.map((c) => {
      const isP1 = p1 === c.id;
      const isP2 = p2 === c.id;
      const tag = isP1 && isP2 ? 'P1 · P2' : isP1 ? 'P1' : isP2 ? 'P2' : '';
      return `
      <button class="char-card ${isP1 || isP2 ? 'selected' : ''}" data-char="${c.id}" aria-pressed="${isP1 || isP2}">
        <span class="char-avatar" style="--c:${c.color};--cd:${c.colorDark}">${c.initials}</span>
        ${tag ? `<span class="char-tag">${tag}</span>` : ''}
        <span class="char-name">${c.name}</span>
        <span class="char-title">${c.title} · ${c.style}</span>
        <span class="char-desc">${c.description}</span>
        <span class="char-stats">
          ${statRow('Power', c.power)}
          ${statRow('Speed', c.speed)}
          ${statRow('Defense', c.defense)}
          ${statRow('Range', c.range)}
        </span>
        <span class="char-diff">Difficulty: ${c.difficulty}</span>
      </button>`;
    }).join('');
    grid.querySelectorAll('.char-card').forEach((card) => {
      card.addEventListener('click', () => selectCharacter(card.dataset.char));
    });
    updatePickUI();
  }

  function updatePickUI() {
    const hint = $('pick-hint');
    const confirmBtn = $('btn-confirm-fighters');
    if (selectedMode === '2p') {
      const p1c = p1 ? getCharacter(p1) : null;
      const p2c = p2 ? getCharacter(p2) : null;
      if (hint) {
        hint.textContent = pickingFor === 'p1'
          ? `Picking Player 1${p1c ? ` — ${p1c.name} picked` : ''}. Tap a fighter for P1, then P2.`
          : `Player 1: ${p1c ? p1c.name : '—'} · Now picking Player 2${p2c ? ` — ${p2c.name} picked` : ''}.`;
      }
      if (confirmBtn) {
        confirmBtn.disabled = !(p1 && p2);
        confirmBtn.textContent = (p1 && p2) ? 'Enter Arena Preview →' : 'Pick Both Fighters to Continue';
      }
    } else {
      const p1c = p1 ? getCharacter(p1) : null;
      const cpu = p2 ? getCharacter(p2) : null;
      if (hint) hint.textContent = p1c ? `${p1c.name} selected. CPU opponent: ${cpu ? cpu.name : 'random — picked on confirm'}.` : 'Tap a fighter to select your challenger.';
      if (confirmBtn) {
        confirmBtn.disabled = !p1;
        confirmBtn.textContent = p1 ? 'Enter Arena Preview →' : 'Pick a Fighter to Continue';
      }
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

  function selectCharacter(id) {
    if (selectedMode === '2p') {
      if (pickingFor === 'p1') {
        p1 = id;
        if (p2 === id) p2 = null; // same fighter cannot be both
        pickingFor = 'p2';
      } else {
        if (id === p1) { showToast('P2 needs a different fighter than P1.'); return; }
        p2 = id;
        pickingFor = 'p1'; // allow re-picking either after both are set
      }
    } else {
      p1 = id;
      // CPU opponent: pick a different fighter at random
      const others = CHARACTERS.filter((c) => c.id !== id);
      p2 = others[Math.floor(Math.random() * others.length)].id;
    }
    renderGrid();
  }

  function openCharacterSelect(mode) {
    selectedMode = mode;
    p1 = null;
    p2 = null;
    pickingFor = 'p1';
    const title = $('char-title');
    const sub = $('char-sub');
    if (title) title.textContent = mode === '2p' ? 'Choose Your Fighters' : 'Choose Your Fighter';
    if (sub) sub.textContent = mode === '2p'
      ? 'Player 1 picks first, then Player 2. Same fighter cannot be picked twice.'
      : 'Your CPU opponent is picked at random from the remaining fighters.';
    renderGrid();
    show('characters');
  }

  function confirmFighters() {
    if (selectedMode === '2p' && !(p1 && p2)) return;
    if (selectedMode !== '2p' && !p1) return;
    const a = getCharacter(p1);
    const b = getCharacter(p2);
    const label = $('arena-fight-label');
    if (label) {
      label.textContent = selectedMode === '2p'
        ? `${a.name}  vs  ${b.name}  ·  Two Player Local`
        : `${a.name}  vs  ${b.name} (CPU)  ·  Player vs Computer`;
    }
    if (api.onEnterArena) api.onEnterArena(selectedMode, a, b);
    show('arena');
  }

  // ---------- Navigation wiring ----------
  const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };

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
    if (e.key === 'Escape') document.querySelectorAll('.modal.open').forEach((m) => m.classList.remove('open'));
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
      showToast(settings.sound ? 'Sound on.' : 'Sound off. (No audio in Phase 1 preview.)');
    });
  }
  if (qualitySelect) {
    qualitySelect.value = settings.quality;
    qualitySelect.addEventListener('change', () => {
      settings.quality = qualitySelect.value;
      saveSettings(settings);
      if (api.onQualityChange) api.onQualityChange(settings.quality);
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
    showToast('Settings reset to defaults.');
  });

  // Footer / secondary links — all real actions, no dead buttons
  bind('btn-about', () => openModal('modal-about'));
  bind('btn-how-footer', () => openModal('modal-how'));
  bind('btn-phase2', () => openModal('modal-phase2'));

  renderGrid();
  return { show, showToast, openCharacterSelect };
}
