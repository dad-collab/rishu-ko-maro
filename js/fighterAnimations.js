// RISHU.COM — Phase 2 — fighterAnimations.js
// Procedural animation state machine for a fighter model built by
// fighterModels.js. No animation files, no external assets — every pose
// is computed from the same arm/leg/torso/head pivots.
//
// States (Phase 2, all real):
//   idle     — breathing, guard sway, head scan (default)
//   walk     — leg/arm swing + bob (preview toggle / selection transition)
//   victory  — arms raised, celebratory bounce (plays on selection confirm)
//   select   — one full spin + scale pulse + accent ring (plays on fighter switch)
//
// PHASE 3 HOOK: setState also accepts the reserved names
// 'punch', 'kick', 'block', 'hit', 'ko'. In Phase 2 those names are
// recognised but deliberately do nothing beyond falling back to idle
// (a console warning, no fake combat). Phase 3 implements them by
// driving the same pivots from here.

const FUTURE_STATES = ['punch', 'kick', 'block', 'hit', 'ko'];

export function createFighterAnimator(model, opts = {}) {
  const { parts } = model;
  const group = parts.group;
  let state = opts.initial || 'idle';
  let walkPhase = 0;
  let spinT = -1; // >= 0 while a selection spin is running
  let spinFrom = 0;
  let victoryT = 0;
  let time = 0;

  // Base pose (guard) captured once so every state lerps from it.
  const base = {
    armL: parts.armL.rotation.clone(),
    armR: parts.armR.rotation.clone(),
    legL: parts.legL.rotation.clone(),
    legR: parts.legR.rotation.clone(),
    torsoY: parts.torso.position.y,
  };

  function setState(next) {
    if (FUTURE_STATES.includes(next)) {
      // Reserved for Phase 3 combat — recognised, never faked in Phase 2.
      console.warn(`[RISHU] Animation "${next}" is a Phase 3 combat state — not available in Phase 2.`);
      next = 'idle';
    }
    if (next === 'select') {
      spinFrom = group.rotation.y;
      spinT = 0;
      state = 'select';
      return;
    }
    if (next === 'victory') victoryT = 0;
    state = next;
  }

  function lerpAngle(cur, target, k) {
    return cur + (target - cur) * k;
  }

  function update(dt, t) {
    time = t;
    const k = Math.min(1, dt * 9); // smoothing factor
    const idleBob = Math.sin(t * 1.8) * 0.02;

    if (state === 'walk') {
      walkPhase += dt * 7;
      const s = Math.sin(walkPhase);
      parts.legL.rotation.x = lerpAngle(parts.legL.rotation.x, s * 0.65, k);
      parts.legR.rotation.x = lerpAngle(parts.legR.rotation.x, -s * 0.65, k);
      parts.armL.rotation.x = lerpAngle(parts.armL.rotation.x, base.armL.x - s * 0.45, k);
      parts.armR.rotation.x = lerpAngle(parts.armR.rotation.x, base.armR.x + s * 0.45, k);
      parts.torso.position.y = base.torsoY + Math.abs(Math.cos(walkPhase)) * 0.05;
      parts.head.rotation.y = Math.sin(t * 0.8) * 0.1;
      return;
    }

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
      }
      // Keep limbs in guard while spinning.
      parts.armL.rotation.x = lerpAngle(parts.armL.rotation.x, base.armL.x, k);
      parts.armR.rotation.x = lerpAngle(parts.armR.rotation.x, base.armR.x, k);
      return;
    }

    // idle (default)
    parts.armL.rotation.x = lerpAngle(parts.armL.rotation.x, base.armL.x + Math.sin(t * 1.8) * 0.07, k);
    parts.armR.rotation.x = lerpAngle(parts.armR.rotation.x, base.armR.x + Math.sin(t * 1.8 + 0.6) * 0.07, k);
    parts.armL.rotation.z = lerpAngle(parts.armL.rotation.z, base.armL.z, k);
    parts.armR.rotation.z = lerpAngle(parts.armR.rotation.z, base.armR.z, k);
    parts.legL.rotation.x = lerpAngle(parts.legL.rotation.x, 0, k);
    parts.legR.rotation.x = lerpAngle(parts.legR.rotation.x, 0, k);
    parts.torso.position.y = base.torsoY + idleBob;
    parts.head.rotation.y = Math.sin(t * 0.55) * 0.16;
    parts.head.rotation.x = lerpAngle(parts.head.rotation.x, 0, k);
  }

  return {
    setState,
    update,
    getState: () => state,
  };
}
