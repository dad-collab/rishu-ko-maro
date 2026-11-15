// RISHU.COM — Phase 3 — fighterAnimations.js
// Procedural animation state machine for a fighter model built by
// fighterModels.js. No animation files, no external assets — every pose
// is computed from the same arm/leg/torso/head pivots.
//
// States (Phase 2 + Phase 3, all real):
//   idle     — breathing, guard sway, head scan (default)
//   walk     — leg/arm swing + bob (preview toggle / selection transition)
//   run      — faster swing, torso lean forward (Phase 3)
//   jump     — legs tucked, arms up, held while airborne (Phase 3)
//   land     — knees bent, torso crouch, holds 0.14 s (Phase 3)
//   turn     — scissor step + torso twist on large facing changes (Phase 3)
//   back     — reversed walk phase, lean back (Phase 3)
//   side     — lateral steps + lean toward the strafe direction (Phase 3)
//   victory  — arms raised, celebratory bounce (plays on selection confirm)
//   select   — one full spin + scale pulse + accent ring (plays on fighter switch)
//
// Transitions blend: on every state change the live pose is snapshotted
// and eased into the new pose (locomotion 0.12 s, jump 0.06 s, land
// 0.05 s, idle 0.15 s), on top of the existing per-frame lerp — so no
// switch ever pops. The walk phase accumulator is shared across
// walk/run/back/side and is never reset, so walk↔run never snaps a leg.
//
// LATER-PHASE HOOK: setState also accepts the reserved names
// 'punch', 'kick', 'block', 'hit', 'ko'. Those names are recognised
// but deliberately do nothing beyond falling back to idle (a console
// warning, no fake combat) until a later combat phase implements them.
// The animator NEVER writes group.rotation.y except in 'select'
// (preview-only spin) — facing belongs to the movement controller.

const FUTURE_STATES = ['punch', 'kick', 'block', 'hit', 'ko'];

// Blend durations (seconds) per state class.
const BLEND_DUR = { locomotion: 0.12, jump: 0.06, land: 0.05, idle: 0.15 };
function blendClass(state) {
  if (state === 'jump') return 'jump';
  if (state === 'land') return 'land';
  if (state === 'idle') return 'idle';
  return 'locomotion';
}
function easeOut(x) { return 1 - (1 - x) * (1 - x); }

export function createFighterAnimator(model, opts = {}) {
  const { parts } = model;
  const group = parts.group;
  let state = opts.initial || 'idle';
  let walkPhase = 0;
  let spinT = -1; // >= 0 while a selection spin is running
  let spinFrom = 0;
  let victoryT = 0;
  let time = 0;
  let lastStrafe = 1;
  let lastTurn = 1;

  // Base pose (guard) captured once so every state lerps from it.
  const base = {
    armL: parts.armL.rotation.clone(),
    armR: parts.armR.rotation.clone(),
    legL: parts.legL.rotation.clone(),
    legR: parts.legR.rotation.clone(),
    torsoY: parts.torso.position.y,
    torsoRx: parts.torso.rotation.x,
    torsoRy: parts.torso.rotation.y,
    headX: parts.head.rotation.x,
  };

  // --- Blend bookkeeping: snapshot of the LIVE pose at state entry. ---
  let prevPose = null;
  let blendT = 1;
  let blendDur = 0.12;

  function snapshotPose() {
    return {
      armLx: parts.armL.rotation.x, armLz: parts.armL.rotation.z,
      armRx: parts.armR.rotation.x, armRz: parts.armR.rotation.z,
      legLx: parts.legL.rotation.x, legRx: parts.legR.rotation.x,
      legLz: parts.legL.rotation.z, legRz: parts.legR.rotation.z,
      torsoY: parts.torso.position.y,
      torsoRx: parts.torso.rotation.x, torsoRy: parts.torso.rotation.y,
      headY: parts.head.rotation.y, headX: parts.head.rotation.x,
    };
  }

  function setState(next, opts2 = {}) {
    if (FUTURE_STATES.includes(next)) {
      // Reserved for a later combat phase — recognised, never faked.
      console.warn(`[RISHU] Animation "${next}" is a later-phase combat state — not available yet.`);
      next = 'idle';
    }
    if (next === 'select') {
      spinFrom = group.rotation.y;
      spinT = 0;
      state = 'select';
      return;
    }
    if (next === state) {
      // Same state: only re-trigger victory, or update a direction.
      if (next === 'victory') { victoryT = 0; return; }
      if (next === 'side' && opts2.strafe !== undefined) { lastStrafe = opts2.strafe; return; }
      if (next === 'turn' && opts2.turn !== undefined) { lastTurn = opts2.turn; return; }
      return;
    }
    if (next === 'victory') victoryT = 0;
    if (next === 'side') lastStrafe = opts2.strafe || 1;
    if (next === 'turn') lastTurn = opts2.turn || 1;
    // Snapshot the live pose so the switch blends instead of popping.
    prevPose = snapshotPose();
    blendT = 0;
    blendDur = BLEND_DUR[blendClass(next)] || 0.12;
    state = next;
  }

  function lerpAngle(cur, target, k) {
    return cur + (target - cur) * k;
  }

  function lerpPose(a, b, e) {
    const out = {};
    for (const key of Object.keys(b)) out[key] = a[key] + (b[key] - a[key]) * e;
    return out;
  }

  // Target pose for the current locomotion/idle state. Advances the
  // shared walkPhase — never resets it, so walk↔run never snaps a leg.
  function poseFor(dt, t) {
    const p = {
      armLx: base.armL.x, armLz: base.armL.z,
      armRx: base.armR.x, armRz: base.armR.z,
      legLx: 0, legRx: 0, legLz: 0, legRz: 0,
      torsoY: base.torsoY, torsoRx: base.torsoRx, torsoRy: base.torsoRy,
      headY: 0, headX: base.headX,
    };
    if (state === 'idle') {
      p.armLx = base.armL.x + Math.sin(t * 1.8) * 0.07;
      p.armRx = base.armR.x + Math.sin(t * 1.8 + 0.6) * 0.07;
      p.torsoY = base.torsoY + Math.sin(t * 1.8) * 0.02;
      p.headY = Math.sin(t * 0.55) * 0.16;
      return p;
    }
    if (state === 'walk' || state === 'run' || state === 'back' || state === 'side') {
      const rate = state === 'run' ? 11 : 7;
      walkPhase += (state === 'back' ? -1 : 1) * dt * rate;
      const s = Math.sin(walkPhase);
      const amp = state === 'run' ? 0.95 : state === 'back' ? 0.5 : 0.65;
      const armAmp = state === 'run' ? 0.7 : 0.45;
      p.legLx = s * amp;
      p.legRx = -s * amp;
      p.armLx = base.armL.x - s * armAmp;
      p.armRx = base.armR.x + s * armAmp;
      p.torsoY = base.torsoY + Math.abs(Math.cos(walkPhase)) * (state === 'run' ? 0.07 : 0.05);
      p.headY = state === 'run' ? 0 : Math.sin(t * 0.8) * 0.1;
      if (state === 'run') p.torsoRx = base.torsoRx + 0.12;
      if (state === 'back') {
        p.torsoRx = base.torsoRx - 0.08;
        p.armLz = 0.45;
        p.armRz = -0.45;
      }
      if (state === 'side') {
        // Lateral steps: legs lift sideways, alternating with the step.
        p.legLz = -0.25 * s;
        p.legRz = 0.25 * s;
        p.torsoRy = base.torsoRy + 0.15 * lastStrafe;
        p.torsoY = base.torsoY + Math.abs(Math.cos(walkPhase)) * 0.03;
      }
      return p;
    }
    if (state === 'jump') {
      // Legs tucked, arms up — one pose for the whole airtime.
      p.legLx = -0.5;
      p.legRx = -0.3;
      p.armLx = -1.2;
      p.armRx = -1.2;
      return p;
    }
    if (state === 'land') {
      // Knees bent, torso crouched — holds LAND_TIME, then blends out.
      p.legLx = 0.35;
      p.legRx = 0.35;
      p.torsoY = base.torsoY - 0.08;
      p.torsoRx = base.torsoRx + 0.15;
      return p;
    }
    if (state === 'turn') {
      // Scissor step + torso twist toward the turn direction.
      p.legLx = 0.4;
      p.legRx = -0.4;
      p.torsoRy = base.torsoRy + 0.15 * lastTurn;
      return p;
    }
    return p;
  }

  function applyPose(pose, k) {
    parts.armL.rotation.x = lerpAngle(parts.armL.rotation.x, pose.armLx, k);
    parts.armL.rotation.z = lerpAngle(parts.armL.rotation.z, pose.armLz, k);
    parts.armR.rotation.x = lerpAngle(parts.armR.rotation.x, pose.armRx, k);
    parts.armR.rotation.z = lerpAngle(parts.armR.rotation.z, pose.armRz, k);
    parts.legL.rotation.x = lerpAngle(parts.legL.rotation.x, pose.legLx, k);
    parts.legR.rotation.x = lerpAngle(parts.legR.rotation.x, pose.legRx, k);
    parts.legL.rotation.z = lerpAngle(parts.legL.rotation.z, pose.legLz, k);
    parts.legR.rotation.z = lerpAngle(parts.legR.rotation.z, pose.legRz, k);
    parts.torso.position.y = lerpAngle(parts.torso.position.y, pose.torsoY, k);
    parts.torso.rotation.x = lerpAngle(parts.torso.rotation.x, pose.torsoRx, k);
    parts.torso.rotation.y = lerpAngle(parts.torso.rotation.y, pose.torsoRy, k);
    parts.head.rotation.y = lerpAngle(parts.head.rotation.y, pose.headY, k);
    parts.head.rotation.x = lerpAngle(parts.head.rotation.x, pose.headX, k);
  }

  function update(dt, t) {
    time = t;
    const k = Math.min(1, dt * 9); // smoothing factor

    if (state === 'victory') {
      victoryT += dt;
      parts.armL.rotation.x = lerpAngle(parts.armL.rotation.x, -2.4, k);
      parts.armR.rotation.x = lerpAngle(parts.armR.rotation.x, -2.4, k);
      parts.armL.rotation.z = lerpAngle(parts.armL.rotation.z, 0.55, k);
      parts.armR.rotation.z = lerpAngle(parts.armR.rotation.z, -0.55, k);
      parts.legL.rotation.x = lerpAngle(parts.legL.rotation.x, 0, k);
      parts.legR.rotation.x = lerpAngle(parts.legR.rotation.x, 0, k);
      parts.torso.position.y = base.torsoY + Math.abs(Math.sin(t * 5)) * 0.09;
      parts.head.rotation.x = lerpAngle(parts.head.rotation.x, -0.18, k);
      return;
    }

    if (state === 'select' && spinT >= 0) {
      spinT += dt / 0.7; // one spin over ~0.7s
      const p = Math.min(1, spinT);
      group.rotation.y = spinFrom + p * Math.PI * 2;
      const pulse = 1 + Math.sin(p * Math.PI) * 0.1;
      group.scale.setScalar((model.height || 1) * pulse);
      if (p >= 1) {
        spinT = -1;
        group.scale.setScalar(model.height || 1);
        state = 'idle';
        blendT = 1; // spin finished — no stale blend after it
      }
      // Keep limbs in guard while spinning.
      parts.armL.rotation.x = lerpAngle(parts.armL.rotation.x, base.armL.x, k);
      parts.armR.rotation.x = lerpAngle(parts.armR.rotation.x, base.armR.x, k);
      return;
    }

    // Locomotion / idle: compute the target pose, blend in from the
    // snapshot taken at state entry, then lerp the pivots toward it.
    let target = poseFor(dt, t);
    if (blendT < 1 && prevPose) {
      blendT = Math.min(1, blendT + dt / blendDur);
      target = lerpPose(prevPose, target, easeOut(blendT));
    }
    applyPose(target, k);
  }

  return {
    setState,
    update,
    getState: () => state,
  };
}
