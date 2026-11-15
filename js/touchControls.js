// RISHU.COM — Phase 3 — touchControls.js
// Mobile touch controls for the arena. DOM overlay built by this module
// (styled with the redesigned navy/ivory/orange tokens — no hex colours
// here). The overlay mounts inside the arena frame (position: relative)
// so the joystick sits on the canvas, bottom-left, and Jump bottom-right.
//
// Layout: virtual joystick bottom-left, Jump button bottom-right.
// Same input shape as the keyboard (movement.js): { mx, mz, run, jump }.
// - Joystick push direction = camera-relative move (up = forward).
// - Joystick pushed past 92% radius = run (no separate run button).
// - Jump button = P1 jump (queued, same edge trigger as Space).
// - 2P Local: the joystick drives P1 only; P2 uses the keyboard. Touch
//   cannot steer two fighters on one screen — stated honestly in the HUD.
//
// Phase 4 — combat cluster (right side, above JUMP): LP / HP / KICK /
// HK tap buttons, BLOCK hold button, DODGE tap button — every combat
// action P1 has on the keyboard, as a real <button> (≥ 44 px targets).
// Combat edges share the keyboard's consume-once semantics
// (consumeCombat()); BLOCK is level (held). Touch combat drives P1
// only, like the joystick.
// - Scrolling is prevented: touch-action none on every control element,
//   preventDefault on touchstart/touchmove inside the overlay, and the
//   arena screen gets overscroll-behavior none (CSS, see plan).

const JOYSTICK_RADIUS = 48; // px of knob travel
const RUN_THRESHOLD = 0.92; // stick magnitude that counts as running

export function createTouchControls(containerEl, { onJump } = {}) {
  const isTouch = typeof window !== 'undefined'
    && (('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0);
  const input = { mx: 0, mz: 0, run: false, jump: false };
  // Phase 4 — combat input (parallel to the keyboard's getCombatP1):
  // attack/dodge are edges (consumed by the arena tick), block is level.
  const combatInput = { attack: null, block: false, dodge: false };
  let enabled = false;
  let stickId = null;
  let lastX = 0;
  let lastY = 0;

  const root = document.createElement('div');
  root.className = 'touch-controls';
  root.setAttribute('aria-label', 'Touch controls');
  root.innerHTML = `
    <div class="touch-joystick" role="application" aria-label="Movement joystick">
      <div class="touch-knob"></div>
    </div>
    <div class="touch-actions">
      <div class="touch-combat-grid">
        <button class="touch-combat" data-attack="lightPunch" type="button" aria-label="Light Punch">LP</button>
        <button class="touch-combat" data-attack="heavyPunch" type="button" aria-label="Heavy Punch">HP</button>
        <button class="touch-combat" data-attack="kick" type="button" aria-label="Kick">KICK</button>
        <button class="touch-combat" data-attack="heavyKick" type="button" aria-label="Heavy Kick">HK</button>
        <button class="touch-combat touch-block" data-block="1" type="button" aria-label="Block (hold)">BLOCK</button>
        <button class="touch-combat" data-dodge="1" type="button" aria-label="Dodge">DODGE</button>
      </div>
      <button class="touch-jump" type="button" aria-label="Jump">JUMP</button>
    </div>`;
  root.style.display = 'none'; // shown only on touch devices, in a match
  containerEl.appendChild(root);

  const stick = root.querySelector('.touch-joystick');
  const knob = root.querySelector('.touch-knob');
  const jumpBtn = root.querySelector('.touch-jump');
  const combatBtns = [...root.querySelectorAll('.touch-combat')];
  const blockBtn = root.querySelector('.touch-block');

  function setKnob(dx, dy) {
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function updateFromOffset(dx, dy) {
    const len = Math.hypot(dx, dy);
    const cl = len > JOYSTICK_RADIUS ? JOYSTICK_RADIUS / len : 1;
    const cx = dx * cl;
    const cy = dy * cl;
    setKnob(cx, cy);
    input.mx = cx / JOYSTICK_RADIUS;
    input.mz = -cy / JOYSTICK_RADIUS; // up on the stick = forward
    input.run = len / JOYSTICK_RADIUS > RUN_THRESHOLD;
  }

  function resetStick() {
    stickId = null;
    input.mx = 0;
    input.mz = 0;
    input.run = false;
    setKnob(0, 0);
  }

  function onStickDown(e) {
    if (!enabled) return;
    e.preventDefault();
    stickId = e.pointerId;
    stick.setPointerCapture(e.pointerId);
    const r = stick.getBoundingClientRect();
    lastX = r.left + r.width / 2;
    lastY = r.top + r.height / 2;
    updateFromOffset(e.clientX - lastX, e.clientY - lastY);
  }
  function onStickMove(e) {
    if (!enabled || e.pointerId !== stickId) return;
    e.preventDefault();
    updateFromOffset(e.clientX - lastX, e.clientY - lastY);
  }
  function onStickEnd(e) {
    if (e.pointerId !== stickId) return;
    resetStick();
  }
  function onJumpDown(e) {
    if (!enabled) return;
    e.preventDefault();
    input.jump = true; // consumed by the arena tick (same edge as Space)
    jumpBtn.classList.add('active');
    if (onJump) onJump();
  }
  function onJumpUp() {
    jumpBtn.classList.remove('active');
  }

  // Phase 4 — combat buttons. Tap buttons queue one attack/dodge edge;
  // BLOCK is hold-to-block (level). Touch has no "back" key, so touch
  // block is always the high guard (low guard needs L + S on keyboard).
  function onCombatDown(e) {
    if (!enabled) return;
    e.preventDefault();
    const btn = e.currentTarget;
    if (btn.dataset.attack) {
      combatInput.attack = btn.dataset.attack;
      btn.classList.add('active');
    } else if (btn.dataset.dodge) {
      combatInput.dodge = true;
      btn.classList.add('active');
    } else if (btn.dataset.block) {
      combatInput.block = true;
      btn.classList.add('active');
    }
  }
  function onCombatUp(e) {
    const btn = e.currentTarget;
    btn.classList.remove('active');
    if (btn.dataset.block) combatInput.block = false;
  }

  stick.addEventListener('pointerdown', onStickDown);
  stick.addEventListener('pointermove', onStickMove);
  stick.addEventListener('pointerup', onStickEnd);
  stick.addEventListener('pointercancel', onStickEnd);
  jumpBtn.addEventListener('pointerdown', onJumpDown);
  jumpBtn.addEventListener('pointerup', onJumpUp);
  jumpBtn.addEventListener('pointercancel', onJumpUp);
  for (const btn of combatBtns) {
    btn.addEventListener('pointerdown', onCombatDown);
    btn.addEventListener('pointerup', onCombatUp);
    btn.addEventListener('pointercancel', onCombatUp);
  }
  // Block scroll/zoom gestures that start on the overlay.
  root.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  root.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  return {
    input,
    combatInput,
    isTouch,
    setEnabled(v) {
      enabled = !!v;
      if (!enabled) {
        resetStick();
        combatInput.attack = null;
        combatInput.block = false;
        combatInput.dodge = false;
      }
      root.style.display = enabled && isTouch ? '' : 'none';
    },
    // The arena tick reads this once per frame and clears the edge flag.
    consumeJump() {
      const j = input.jump;
      input.jump = false;
      return j;
    },
    // Phase 4 — combat edges, consumed once per frame by the arena tick
    // (same semantics as consumeJump). Block is level, not an edge.
    consumeCombat() {
      const out = {
        attack: combatInput.attack,
        block: combatInput.block,
        blockLow: false, // touch has no back key — high guard only
        dodge: combatInput.dodge,
        evade: false,
      };
      combatInput.attack = null;
      combatInput.dodge = false;
      return out;
    },
    dispose() {
      stick.removeEventListener('pointerdown', onStickDown);
      stick.removeEventListener('pointermove', onStickMove);
      stick.removeEventListener('pointerup', onStickEnd);
      stick.removeEventListener('pointercancel', onStickEnd);
      jumpBtn.removeEventListener('pointerdown', onJumpDown);
      jumpBtn.removeEventListener('pointerup', onJumpUp);
      jumpBtn.removeEventListener('pointercancel', onJumpUp);
      for (const btn of combatBtns) {
        btn.removeEventListener('pointerdown', onCombatDown);
        btn.removeEventListener('pointerup', onCombatUp);
        btn.removeEventListener('pointercancel', onCombatUp);
      }
      if (root.parentNode === containerEl) containerEl.removeChild(root);
    },
  };
}
