// RISHU.COM — Phase 3 — movement.js
// Movement + keyboard input for the arena. Pure logic, no DOM except the
// keyboard listeners. Depends on: three (import map), the animator API
// (states run/jump/land/turn/back/side + setState(name, opts)), and a
// camera forward vector supplied by camera.js.
//
// Design:
// - Camera-relative movement; fighters ALWAYS face their opponent (fighting
//   stance). W = away from camera, S = toward camera, A/D = strafe.
// - Velocity-based with accel/decel; speed scales with char.speed.
// - Jump is a vertical velocity under gravity; landing is a short 'land'
//   state. No double jump. Phase 4: the keyboard also reads combat
//   edges (getCombatP1/P2) — the combat module (combat.js) owns the
//   attacks themselves; this file never deals damage.

import * as THREE from 'three';

export const ARENA = {
  GROUND_Y: 0.56, // top of the ring mat (arena.js ringMat y)
  BOUND_RADIUS: 4.6, // inside the ropes (posts sit at +/-4.6, ropes join them)
  MIN_SEPARATION: 1.0, // fighters may never overlap (width ~0.7 + margin)
  GRAVITY: 20,
  JUMP_VELOCITY: 7.2, // apex ~1.3 m, air time ~0.72 s
  WALK_BASE: 2.6, // m/s before the speed-stat factor
  RUN_MULTIPLIER: 1.55,
  BACK_MULTIPLIER: 0.8,
  SIDE_MULTIPLIER: 0.85,
  ACCELERATION: 22,
  DECELERATION: 26,
  AIR_CONTROL: 0.6, // horizontal accel multiplier while airborne
  TURN_RATE: 7, // rad/s, smooth facing turns (no snap, no slide)
  LAND_TIME: 0.14, // seconds the 'land' pose holds after touchdown
  TURN_ANGLE: 2.2, // rad of facing change that triggers the 'turn' pose
};

// Module-scope temps — the per-frame update allocates nothing.
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _toOpp = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/** Walk speed in m/s for a fighter: 2.91 (speed 4, Dev) .. 3.38 (speed 10, Zara). */
export function speedFor(char) {
  const s = typeof char?.speed === 'number' ? char.speed : 7;
  return ARENA.WALK_BASE * (0.85 + s * 0.03);
}

function shortestAngle(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// ---------------------------------------------------------------- keyboard
// P1: W/A/S/D + Space (jump) + ShiftLeft (run).
// P2: Arrows + ShiftRight (jump) + Enter held (run).
// Edge-triggered jumps: keydown (non-repeat) queues one jump, consumed on read.
// Guarded: ignored while a modal is open, while typing in a form control,
// or while input is disabled (menu / character select / paused).
// preventDefault on Space / arrows / Enter ONLY while enabled, so page
// scroll and focused-button activation cannot leak into a match.

const P1_KEYS = { fwd: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', run: 'ShiftLeft' };
const P2_KEYS = { fwd: 'ArrowUp', back: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', jump: 'ShiftRight', run: 'Enter' };

// Phase 4 — combat keys (one config object per fighter; P2 is
// "separate configurable controls" by construction — rebind by editing
// these objects). P1 (from the brief): J light punch, K heavy punch,
// U kick, I heavy kick, L hold = block, O tap = dodge.
// P2 (brief gave none): Numpad primary + right-hand cluster fallback
// (laptops without a numpad) — same actions, no clash with P2 movement
// (arrows/ShiftRight/Enter), P1 combat, or pause (P/Esc).
export const P1_COMBAT_KEYS = {
  lightPunch: 'KeyJ', heavyPunch: 'KeyK', kick: 'KeyU', heavyKick: 'KeyI',
  block: 'KeyL', dodge: 'KeyO',
};
export const P2_COMBAT_KEYS = {
  lightPunch: 'Numpad1', heavyPunch: 'Numpad2', kick: 'Numpad3', heavyKick: 'Numpad0',
  block: 'NumpadEnter', dodge: 'Numpad5',
  lightPunchAlt: 'Comma', heavyPunchAlt: 'Period', kickAlt: 'Slash', heavyKickAlt: 'Quote',
  blockAlt: 'Semicolon', dodgeAlt: 'KeyM',
};

export function createKeyboardInput({ onPauseKey } = {}) {
  const held = new Set();
  let jumpP1 = false;
  let jumpP2 = false;
  // Phase 4 — combat edges (queued on non-repeat keydown, consumed on
  // read, exactly like the jump edges). Block is level (read from held).
  let attackP1 = null;
  let dodgeP1 = false;
  let attackP2 = null;
  let dodgeP2 = false;
  let enabled = false;

  function isFormTarget(e) {
    const t = e.target;
    return !!t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  }
  function modalOpen() {
    return !!document.querySelector('.modal.open');
  }

  function onKeyDown(e) {
    if (!enabled || isFormTarget(e)) return;
    if (e.code === 'KeyP') { if (onPauseKey) onPauseKey(); return; }
    if (e.code === 'Escape' && !modalOpen()) { if (onPauseKey) onPauseKey(); return; }
    if (modalOpen()) return;
    if (e.code === 'Space' || e.code.startsWith('Arrow') || e.code === 'Enter') e.preventDefault();
    if (e.repeat) { held.add(e.code); return; }
    held.add(e.code);
    if (e.code === P1_KEYS.jump) jumpP1 = true;
    if (e.code === P2_KEYS.jump) jumpP2 = true;
    // Phase 4 — combat edges. Holding an attack key queues ONE attack
    // (repeats never reach here); the player must re-press to attack
    // again — that is the anti-spam rule, not a bug.
    if (e.code === P1_COMBAT_KEYS.lightPunch) attackP1 = 'lightPunch';
    else if (e.code === P1_COMBAT_KEYS.heavyPunch) attackP1 = 'heavyPunch';
    else if (e.code === P1_COMBAT_KEYS.kick) attackP1 = 'kick';
    else if (e.code === P1_COMBAT_KEYS.heavyKick) attackP1 = 'heavyKick';
    if (e.code === P1_COMBAT_KEYS.dodge) dodgeP1 = true;
    const p2Attack =
      (e.code === P2_COMBAT_KEYS.lightPunch || e.code === P2_COMBAT_KEYS.lightPunchAlt) ? 'lightPunch'
      : (e.code === P2_COMBAT_KEYS.heavyPunch || e.code === P2_COMBAT_KEYS.heavyPunchAlt) ? 'heavyPunch'
      : (e.code === P2_COMBAT_KEYS.kick || e.code === P2_COMBAT_KEYS.kickAlt) ? 'kick'
      : (e.code === P2_COMBAT_KEYS.heavyKick || e.code === P2_COMBAT_KEYS.heavyKickAlt) ? 'heavyKick'
      : null;
    if (p2Attack) attackP2 = p2Attack;
    if (e.code === P2_COMBAT_KEYS.dodge || e.code === P2_COMBAT_KEYS.dodgeAlt) dodgeP2 = true;
  }
  function onKeyUp(e) {
    held.delete(e.code);
  }
  function onBlur() {
    held.clear(); // stuck keys must never survive a tab switch
  }

  function read(keys) {
    const mx = (held.has(keys.right) ? 1 : 0) - (held.has(keys.left) ? 1 : 0);
    const mz = (held.has(keys.fwd) ? 1 : 0) - (held.has(keys.back) ? 1 : 0);
    return { mx, mz, run: held.has(keys.run) };
  }

  return {
    attach() {
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onBlur);
    },
    detach() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      held.clear();
    },
    setEnabled(v) {
      enabled = !!v;
      if (!enabled) {
        held.clear();
        jumpP1 = false; jumpP2 = false;
        attackP1 = null; dodgeP1 = false;
        attackP2 = null; dodgeP2 = false;
      }
    },
    getP1() {
      const out = read(P1_KEYS);
      out.jump = jumpP1; jumpP1 = false;
      return out;
    },
    getP2() {
      const out = read(P2_KEYS);
      out.jump = jumpP2; jumpP2 = false;
      return out;
    },
    // Phase 4 — combat input. Edges are consumed on read (one read per
    // frame per fighter, by the arena tick). Block is level. blockLow =
    // block + back held; evade = dodge edge + back held. `grounded` is
    // NOT known here — the arena adds it from the controller.
    getCombatP1() {
      const block = held.has(P1_COMBAT_KEYS.block);
      const out = {
        attack: attackP1, dodge: dodgeP1,
        block,
        blockLow: block && held.has(P1_KEYS.back),
        evade: dodgeP1 && held.has(P1_KEYS.back),
      };
      attackP1 = null; dodgeP1 = false;
      return out;
    },
    getCombatP2() {
      const block = held.has(P2_COMBAT_KEYS.block) || held.has(P2_COMBAT_KEYS.blockAlt);
      const out = {
        attack: attackP2, dodge: dodgeP2,
        block,
        blockLow: block && held.has(P2_KEYS.back),
        evade: dodgeP2 && held.has(P2_KEYS.back),
      };
      attackP2 = null; dodgeP2 = false;
      return out;
    },
  };
}

// ------------------------------------------------------- fighter controller
// One per fighter. Owns group.position (x/z/y) and group.rotation.y.
// The animator owns the limb pivots; this controller NEVER touches
// group.scale (the 'select' spin owns it in the preview) and never writes
// limb rotations directly. The arena tick's Phase 2 facing sway
// (rotation.y = baseRot + sin) MUST be removed — it would fight this.

export function createFighterController({ model, animator, char, getOpponentPosition, getCameraForward }) {
  const group = model.group;
  const pos = group.position; // x/z start at placeFighter(); y starts at GROUND_Y
  const vel = new THREE.Vector3();
  let vy = 0;
  let grounded = true;
  let facing = group.rotation.y;
  let landTimer = 0;
  let lastAnim = 'idle';
  let lastStrafe = 0;
  let lastTurn = 0;
  let lastDelta = 0; // signed facing change of the last update (turn pose direction)

  function setAnim(name, opts) {
    if (name === lastAnim
      && !(name === 'side' && opts?.strafe !== lastStrafe)
      && !(name === 'turn' && opts?.turn !== lastTurn)) return;
    lastAnim = name;
    lastStrafe = opts?.strafe || 0;
    lastTurn = opts?.turn || 0;
    animator.setState(name, opts);
  }

  function update(dt, input) {
    // --- desired velocity, camera-relative ---
    getCameraForward(_fwd); // XZ, normalised; falls back to (0,0,-1)
    if (_fwd.lengthSq() < 0.001) _fwd.set(0, 0, -1);
    _fwd.y = 0;
    _fwd.normalize();
    _right.crossVectors(_fwd, UP).normalize(); // screen-right of the camera
    _desired.set(0, 0, 0)
      .addScaledVector(_fwd, input.mz || 0)
      .addScaledVector(_right, input.mx || 0);
    if (_desired.lengthSq() > 1) _desired.normalize();

    // --- speed + direction multiplier (relative to facing) ---
    const fx = Math.sin(facing);
    const fz = Math.cos(facing);
    const fwdComp = _desired.x * fx + _desired.z * fz; // >0 = toward opponent
    const latComp = _desired.x * fz - _desired.z * fx; // >0 = strafe right (see plan §2.3)
    let speed = speedFor(char);
    let movingKind = 'walk';
    if (input.run && _desired.lengthSq() > 0) { speed *= ARENA.RUN_MULTIPLIER; movingKind = 'run'; }
    else if (fwdComp < -0.3) { speed *= ARENA.BACK_MULTIPLIER; movingKind = 'back'; }
    else if (Math.abs(latComp) > 0.5 && fwdComp <= 0.3) { speed *= ARENA.SIDE_MULTIPLIER; movingKind = 'side'; }

    // --- accelerate / decelerate (no per-frame allocation) ---
    const rate = grounded ? ARENA.ACCELERATION : ARENA.ACCELERATION * ARENA.AIR_CONTROL;
    const k = Math.min(1, rate * dt);
    const tx = _desired.x * speed;
    const tz = _desired.z * speed;
    vel.x += (tx - vel.x) * k;
    vel.z += (tz - vel.z) * k;
    if (_desired.lengthSq() === 0 && grounded) {
      const dk = Math.min(1, ARENA.DECELERATION * dt);
      vel.x += (0 - vel.x) * dk;
      vel.z += (0 - vel.z) * dk;
      if (Math.abs(vel.x) < 0.02) vel.x = 0;
      if (Math.abs(vel.z) < 0.02) vel.z = 0;
    }
    pos.x += vel.x * dt;
    pos.z += vel.z * dt;

    // --- arena boundary: radial clamp inside the ropes ---
    const r = Math.hypot(pos.x, pos.z);
    if (r > ARENA.BOUND_RADIUS) {
      const s = ARENA.BOUND_RADIUS / r;
      pos.x *= s;
      pos.z *= s;
      // Kill the outward velocity so the fighter stops at the rope, not slides.
      const nx = pos.x / ARENA.BOUND_RADIUS;
      const nz = pos.z / ARENA.BOUND_RADIUS;
      const outward = vel.x * nx + vel.z * nz;
      if (outward > 0) { vel.x -= outward * nx; vel.z -= outward * nz; }
    }

    // --- jump / gravity / landing ---
    if (input.jump && grounded) {
      vy = ARENA.JUMP_VELOCITY;
      grounded = false;
    }
    if (!grounded) {
      vy -= ARENA.GRAVITY * dt;
      pos.y += vy * dt;
      if (pos.y <= ARENA.GROUND_Y) {
        pos.y = ARENA.GROUND_Y;
        vy = 0;
        grounded = true;
        landTimer = ARENA.LAND_TIME;
      }
    }

    // --- face the opponent (smooth turn, shortest arc) ---
    getOpponentPosition(_toOpp);
    _toOpp.x -= pos.x;
    _toOpp.z -= pos.z;
    _toOpp.y = 0;
    let turning = false;
    if (_toOpp.lengthSq() > 0.001) {
      const target = Math.atan2(_toOpp.x, _toOpp.z);
      const delta = shortestAngle(facing, target);
      lastDelta = delta;
      turning = Math.abs(delta) > ARENA.TURN_ANGLE;
      const step = Math.max(-ARENA.TURN_RATE * dt, Math.min(ARENA.TURN_RATE * dt, delta));
      facing += step;
      group.rotation.y = facing;
    }

    // --- animation state (priority: air > land > turn > locomotion) ---
    if (!grounded) {
      setAnim('jump');
    } else if (landTimer > 0) {
      landTimer -= dt;
      setAnim('land');
    } else if (turning) {
      // Pass the turn direction so the scissor-step pose twists the
      // right way (delta sign = shortest-arc direction).
      setAnim('turn', { turn: lastDelta >= 0 ? 1 : -1 });
    } else {
      const spd = Math.hypot(vel.x, vel.z);
      if (spd < 0.15) setAnim('idle');
      else if (movingKind === 'run') setAnim('run');
      else if (movingKind === 'back') setAnim('back');
      else if (movingKind === 'side') setAnim('side', { strafe: latComp > 0 ? 1 : -1 });
      else setAnim('walk');
    }
  }

  return {
    update,
    get position() { return pos; },
    get facing() { return facing; },
    get isGrounded() { return grounded; },
    get speed() { return Math.hypot(vel.x, vel.z); },
    get state() { return lastAnim; },
  };
}

// Keep two fighters from ever overlapping: push each half the overlap
// along the axis between them, then re-clamp both inside the ropes.
export function resolveSeparation(a, b) {
  const dx = b.position.x - a.position.x;
  const dz = b.position.z - a.position.z;
  const d = Math.hypot(dx, dz);
  if (d >= ARENA.MIN_SEPARATION) return;
  let nx = 1;
  let nz = 0;
  if (d > 0.0001) { nx = dx / d; nz = dz / d; }
  const push = (ARENA.MIN_SEPARATION - d) / 2;
  a.position.x -= nx * push;
  a.position.z -= nz * push;
  b.position.x += nx * push;
  b.position.z += nz * push;
  for (const c of [a, b]) {
    const r = Math.hypot(c.position.x, c.position.z);
    if (r > ARENA.BOUND_RADIUS) {
      const s = ARENA.BOUND_RADIUS / r;
      c.position.x *= s;
      c.position.z *= s;
    }
  }
}
