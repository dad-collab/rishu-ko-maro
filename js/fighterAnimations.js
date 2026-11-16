// RISHU.COM — Visual Upgrade — fighterAnimations.js
// Procedural animation state machine for a fighter model built by
// fighterModels.js (rig v2). No animation files, no external assets —
// every pose is computed from the same arm/leg/torso/head pivots,
// now with elbow + knee pivots, hands and a neck.
//
// States (Phase 2 + Phase 3, all real):
//   idle     — breathing, guard bounce, head scan (default)
//   walk     — leg/arm swing + bob (preview toggle / selection transition)
//   run      — faster swing, torso lean forward (Phase 3)
//   jump     — legs tucked, arms up, held while airborne (Phase 3)
//   land     — knees bent, torso crouch, holds 0.14 s (Phase 3)
//   turn     — scissor step + torso twist on large facing changes (Phase 3)
//   back     — reversed walk phase, lean back (Phase 3)
//   side     — lateral steps + lean toward the strafe direction (Phase 3)
//   victory  — arms raised, celebratory bounce (plays on selection confirm)
//   select   — one full spin + scale pulse + accent ring (plays on fighter switch)
// States (Phase 4 — combat, all real, see ANIMATION-PLAN.md in the
// Phase 4 audit folder for the pose tables):
//   jab / cross / kick / roundhouse — attacks; one state per attack,
//     driven through startup → active → recovery keyframes by the
//     combat module via setState(name, { phase, seg, segT })
//   blockHigh / blockLow — held guards (exit to idle on release)
//   hit / hitHeavy — clean-hit reactions (hitstun, now with a step-back)
//   dodge    — dodge / backward-evade dash step
//   ko       — terminal fall (match frozen; group lowers to the mat)
// States (Visual Upgrade — pose slots for Phase 5):
//   special  — one state, four kinds (punch / blast / kick / ultimate),
//     driven the same 3-segment way as attacks via
//     setState('special', { kind, phase, seg, segT }). Phase 5 wires
//     the logic + timing; the poses live here, on the rig v2 pivots.
//
// Transitions blend: on every state change the live pose is snapshotted
// and eased into the new pose (locomotion 0.12 s, jump 0.06 s, land
// 0.05 s, idle 0.15 s, combat 0.05 s, hit 0.04 s, ko 0.20 s), on top of
// the existing per-frame lerp — so no switch ever pops. The walk phase
// accumulator is shared across walk/run/back/side and is never reset,
// so walk↔run never snaps a leg.
//
// SLIDE FIX (visual upgrade): the walk phase rate used to be FIXED
// (7/s walk, 11/s run) while the controller moves velocity-based
// (2.9–3.4 m/s), so the feet never matched the ground speed and visibly
// slid. The animator now reads the controller's measured speed via
// setSpeed(v) (the arena calls it every tick).
//
// Why a triangle wave, not a sine: a sine's fastest motion is at
// mid-stance — exactly where the planted foot must be still — so a
// sine ALWAYS slides (measured in the node harness: contact foot
// speed 3.05 m/s at body speed 2.76 m/s with a sine). The leg swing is
// therefore a triangle wave: a slow linear stance (~54% of the cycle,
// foot planted) + a fast swing-through. The stance fraction
// f = amp / (2·sin(amp)) makes the stance angular rate equal
// bodySpeed / LEG_LEN, i.e. the foot is stationary in world space
// while it is on the ground. The stride length is the VISUAL stride
// (2·LEG_LEN·sin(amp) ≈ 1.33 m walk, not a human 0.7 m — with 1.1 m
// legs and a 0.65 rad swing the foot travels 1.33 m per step), and the
// phase rate follows from it: rate = speed·π / strideLen.
// movement.js is untouched.

const LEG_LEN = 1.1; // hip pivot to shoe (thigh 0.55 + shin 0.55)

function legSwing(phase, amp) {
  if (amp < 0.01) return 0;
  const f = amp / (2 * Math.sin(amp)); // stance fraction (~0.54 walk)
  let u = (phase / (Math.PI * 2)) % 1;
  if (u < 0) u += 1;
  if (u < f) return -amp + 2 * amp * (u / f);
  return amp - 2 * amp * ((u - f) / (1 - f));
}

function swingKnee(phase, amp) {
  if (amp < 0.01) return 0.05;
  const f = amp / (2 * Math.sin(amp));
  let u = (phase / (Math.PI * 2)) % 1;
  if (u < 0) u += 1;
  if (u < f) return 0.05; // stance: leg nearly straight, foot planted
  return 0.6 * Math.sin(Math.PI * (u - f) / (1 - f)); // swing: knee lifts
}
//
// The animator NEVER writes group.rotation.y except in 'select'
// (preview-only spin) — facing belongs to the movement controller.
// The one exception is 'ko', which lowers group.position.y (the match
// is frozen by then, so nothing fights it).

// Combat states (Phase 4) + the one Phase 5-driven state.
const COMBAT_STATES = new Set([
  'jab', 'cross', 'kick', 'roundhouse',
  'blockHigh', 'blockLow', 'hit', 'hitHeavy', 'dodge', 'ko',
]);

// Blend durations (seconds) per state class.
const BLEND_DUR = { locomotion: 0.12, jump: 0.06, land: 0.05, idle: 0.15, combat: 0.05, hit: 0.04, ko: 0.20 };
function blendClass(state) {
  if (state === 'jump') return 'jump';
  if (state === 'land') return 'land';
  if (state === 'idle') return 'idle';
  if (state === 'hit' || state === 'hitHeavy') return 'hit';
  if (state === 'ko') return 'ko';
  if (state === 'special' || COMBAT_STATES.has(state)) return 'combat';
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
  // Phase 4 — attack-phase drive: the combat module calls
  // setState(attack, { phase, seg, segT }) every frame during an attack;
  // poseFor reads this to place the limbs on the startup → active →
  // recovery keyframes. `evade` marks the bigger backward-evade lean.
  let combatPhase = { phase: 0, seg: 0, segT: 0, evade: false };
  // Visual upgrade — measured ground speed (m/s) from the movement
  // controller, via setSpeed(). Defaults to a walk so the character
  // preview (which has no controller) still walks naturally.
  let speedNow = 3.0;
  // Visual upgrade — the active special kind ('punch' | 'blast' |
  // 'kick' | 'ultimate'); Phase 5 sets it via setState('special', { kind }).
  let specialKind = 'punch';

  // Base pose (guard) captured once so every state lerps from it.
  const base = {
    armL: parts.armL.rotation.clone(),
    armR: parts.armR.rotation.clone(),
    armLFore: parts.armLFore.rotation.clone(),
    armRFore: parts.armRFore.rotation.clone(),
    legL: parts.legL.rotation.clone(),
    legR: parts.legR.rotation.clone(),
    legLShin: parts.legLShin.rotation.clone(),
    legRShin: parts.legRShin.rotation.clone(),
    torsoY: parts.torso.position.y,
    torsoRx: parts.torso.rotation.x,
    torsoRy: parts.torso.rotation.y,
    headX: parts.head.rotation.x,
  };

  // Visual upgrade — special pose slots (Phase 5 drives them). Same
  // 3-segment keyframe shape as the attacks: k0 = startup/chamber,
  // k1 = active. Recovery blends back to the guard pose (seg 2).
  const SPECIAL_POSES = {
    punch: {
      k0: { armLx: -0.6, armRx: -0.6, armLForeX: -1.5, armRForeX: -1.5, torsoRy: base.torsoRy + 0.2 },
      k1: { armLx: -1.9, armRx: -1.9, armLForeX: -0.1, armRForeX: -0.1, torsoRy: base.torsoRy - 0.3, legLx: 0.2, headX: base.headX - 0.08 },
    },
    blast: {
      k0: { armLx: -0.5, armRx: -0.5, armLForeX: -1.4, armRForeX: -1.4, torsoRx: base.torsoRx + 0.1 },
      k1: { armLx: -1.6, armRx: -1.6, armLForeX: -0.3, armRForeX: -0.3, torsoRx: base.torsoRx - 0.15, legLx: 0.15, legRx: -0.15 },
    },
    kick: {
      k0: { legRx: -0.6, legRShinX: 0.9, torsoRy: base.torsoRy + 0.35, torsoRx: base.torsoRx + 0.1, armLz: base.armL.z + 0.25, headY: 0.15 },
      k1: { legRx: -1.7, legRShinX: -0.05, legLShinX: 0.35, torsoRy: base.torsoRy - 0.4, headX: base.headX - 0.12 },
    },
    ultimate: {
      k0: { torsoY: base.torsoY - 0.12, torsoRx: base.torsoRx + 0.2, legLx: 0.35, legRx: 0.35, legLShinX: 0.5, legRShinX: 0.5, armLForeX: -1.2, armRForeX: -1.2 },
      k1: { torsoY: base.torsoY + 0.05, armLx: -2.2, armRx: -2.2, armLz: 0.9, armRz: -0.9, armLForeX: -0.1, armRForeX: -0.1, headX: base.headX - 0.15 },
    },
  };

  // --- Blend bookkeeping: snapshot of the LIVE pose at state entry. ---
  let prevPose = null;
  let blendT = 1;
  let blendDur = 0.12;

  function snapshotPose() {
    return {
      armLx: parts.armL.rotation.x, armLz: parts.armL.rotation.z,
      armRx: parts.armR.rotation.x, armRz: parts.armR.rotation.z,
      armLForeX: parts.armLFore.rotation.x, armRForeX: parts.armRFore.rotation.x,
      legLx: parts.legL.rotation.x, legRx: parts.legR.rotation.x,
      legLz: parts.legL.rotation.z, legRz: parts.legR.rotation.z,
      legLShinX: parts.legLShin.rotation.x, legRShinX: parts.legRShin.rotation.x,
      torsoY: parts.torso.position.y,
      torsoRx: parts.torso.rotation.x, torsoRy: parts.torso.rotation.y,
      headY: parts.head.rotation.y, headX: parts.head.rotation.x,
    };
  }

  function setState(next, opts2 = {}) {
    if (next === 'special') {
      const kind = opts2.kind || specialKind;
      if (!SPECIAL_POSES[kind]) {
        console.warn(`[RISHU] Unknown special kind "${kind}" — falling back to idle.`);
        next = 'idle';
      } else {
        specialKind = kind;
      }
    }
    if (next === 'select') {
      spinFrom = group.rotation.y;
      spinT = 0;
      state = 'select';
      return;
    }
    if (next === state) {
      // Same state: only re-trigger victory, update a direction, or
      // advance an attack's keyframes (no re-snapshot — the blend
      // must NOT restart mid-attack).
      if (next === 'victory') { victoryT = 0; return; }
      if (next === 'side' && opts2.strafe !== undefined) { lastStrafe = opts2.strafe; return; }
      if (next === 'turn' && opts2.turn !== undefined) { lastTurn = opts2.turn; return; }
      if ((next === 'special' || COMBAT_STATES.has(next))
        && (opts2.phase !== undefined || opts2.seg !== undefined || opts2.evade !== undefined)) {
        combatPhase = {
          phase: opts2.phase ?? combatPhase.phase,
          seg: opts2.seg ?? combatPhase.seg,
          segT: opts2.segT ?? combatPhase.segT,
          evade: opts2.evade ?? combatPhase.evade,
        };
        return;
      }
      return;
    }
    if (next === 'victory') victoryT = 0;
    if (next === 'side') lastStrafe = opts2.strafe || 1;
    if (next === 'turn') lastTurn = opts2.turn || 1;
    if (next === 'special' || COMBAT_STATES.has(next)) {
      combatPhase = {
        phase: opts2.phase ?? 0,
        seg: opts2.seg ?? 0,
        segT: opts2.segT ?? 0,
        evade: opts2.evade ?? false,
      };
    }
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

  // Phase 4 — attack keyframes. An attack is one state driven through
  // three segments (0 startup, 1 active, 2 recovery); k0/k1 are the
  // startup and active poses (partial dicts — a missing key stays at
  // the guard pose `p`). seg 0 blends guard → k0, seg 1 blends
  // k0 → k1, seg 2 blends k1 → guard. No per-frame allocation beyond
  // the pose object poseFor already builds.
  function attackPose(p, k0, k1) {
    const { seg, segT } = combatPhase;
    const t = Math.max(0, Math.min(1, segT));
    const from = seg === 0 ? p : k0;
    const to = seg === 0 ? k0 : seg === 1 ? k1 : p;
    for (const key of Object.keys(p)) {
      const a = from[key] !== undefined ? from[key] : p[key];
      const b = to[key] !== undefined ? to[key] : p[key];
      p[key] = a + (b - a) * t;
    }
    return p;
  }

  // Target pose for the current locomotion/idle state. Advances the
  // shared walkPhase — never resets it, so walk↔run never snaps a leg.
  function poseFor(dt, t) {
    const p = {
      armLx: base.armL.x, armLz: base.armL.z,
      armRx: base.armR.x, armRz: base.armR.z,
      armLForeX: base.armLFore.x, armRForeX: base.armRFore.x,
      legLx: 0, legRx: 0, legLz: 0, legRz: 0,
      legLShinX: base.legLShin.x, legRShinX: base.legRShin.x,
      torsoY: base.torsoY, torsoRx: base.torsoRx, torsoRy: base.torsoRy,
      headY: 0, headX: base.headX,
    };
    if (state === 'idle') {
      p.armLx = base.armL.x + Math.sin(t * 1.8) * 0.07;
      p.armRx = base.armR.x + Math.sin(t * 1.8 + 0.6) * 0.07;
      // Guard bounce: a subtle ready bob on top of the breath.
      p.torsoY = base.torsoY + Math.sin(t * 1.8) * 0.02 + Math.abs(Math.sin(t * 6.0)) * 0.015;
      p.headY = Math.sin(t * 0.55) * 0.16;
      return p;
    }
    if (state === 'walk' || state === 'run' || state === 'back' || state === 'side') {
      // SLIDE FIX: the phase rate comes from the measured ground speed
      // and the VISUAL stride (see legSwing above). The swing shrinks
      // with speed so a decelerating fighter's steps shrink instead of
      // marching in place; at speed 0 the phase freezes and the legs
      // settle to guard.
      const ampBase = state === 'run' ? 0.95 : state === 'back' ? 0.5 : 0.65;
      const topSpeed = state === 'run' ? 4.8 : 3.2;
      const ampScale = Math.min(1, speedNow / topSpeed);
      const amp = ampBase * ampScale;
      const strideLen = 2 * LEG_LEN * Math.sin(amp);
      const rate = speedNow > 0.01 && strideLen > 0.01 ? (speedNow * Math.PI) / strideLen : 0;
      walkPhase += (state === 'back' ? -1 : 1) * dt * rate;
      const armAmp = state === 'run' ? 0.7 : 0.45;
      const sL = legSwing(walkPhase, amp);
      const sR = legSwing(walkPhase + Math.PI, amp);
      p.legLx = sL;
      p.legRx = sR;
      // Knee: flexes while the leg swings forward (foot lifts), nearly
      // straight at push-off behind the body.
      p.legLShinX = swingKnee(walkPhase, amp);
      p.legRShinX = swingKnee(walkPhase + Math.PI, amp);
      // Arms swing opposite their own leg (contralateral gait).
      const nL = amp > 0.01 ? sL / amp : 0;
      const nR = amp > 0.01 ? sR / amp : 0;
      p.armLx = base.armL.x - nL * armAmp;
      p.armRx = base.armR.x - nR * armAmp;
      p.armLForeX = base.armLFore.x - nL * 0.25;
      p.armRForeX = base.armRFore.x - nR * 0.25;
      p.torsoY = base.torsoY + Math.abs(Math.cos(walkPhase)) * (state === 'run' ? 0.07 : 0.05) * ampScale;
      p.headY = state === 'run' ? 0 : Math.sin(t * 0.8) * 0.1;
      if (state === 'run') p.torsoRx = base.torsoRx + 0.12;
      if (state === 'back') {
        p.torsoRx = base.torsoRx - 0.08;
        p.armLz = 0.45;
        p.armRz = -0.45;
      }
      if (state === 'side') {
        // Lateral steps: legs lift sideways, alternating with the step.
        p.legLz = -0.25 * nL * ampScale;
        p.legRz = 0.25 * nL * ampScale;
        p.torsoRy = base.torsoRy + 0.15 * lastStrafe;
        p.torsoY = base.torsoY + Math.abs(Math.cos(walkPhase)) * 0.03 * ampScale;
      }
      return p;
    }
    if (state === 'jump') {
      // Legs tucked (knees bent), arms up — one pose for the airtime.
      p.legLx = -0.5;
      p.legRx = -0.3;
      p.legLShinX = 0.9;
      p.legRShinX = 0.7;
      p.armLx = -1.2;
      p.armRx = -1.2;
      p.armLForeX = -0.6;
      p.armRForeX = -0.6;
      return p;
    }
    if (state === 'land') {
      // Knees bent, torso crouched — holds LAND_TIME, then blends out.
      p.legLx = 0.35;
      p.legRx = 0.35;
      p.legLShinX = 0.5;
      p.legRShinX = 0.5;
      p.torsoY = base.torsoY - 0.08;
      p.torsoRx = base.torsoRx + 0.15;
      return p;
    }
    if (state === 'turn') {
      // Scissor step + torso twist toward the turn direction.
      p.legLx = 0.4;
      p.legRx = -0.4;
      p.legLShinX = 0.3;
      p.torsoRy = base.torsoRy + 0.15 * lastTurn;
      return p;
    }
    // ---- Phase 4 — combat states (pose tables in ANIMATION-PLAN.md) ----
    // Arm guard values (from fighterModels.js): armLz +0.35, armRz
    // -0.35; elbow guard bend -1.05 (forearms up toward the face).
    // Keyframe numbers below are targets; missing keys stay at the
    // guard pose. Punches extend the elbow at active; kicks chamber
    // the knee at startup and extend it at active; recovery (seg 2)
    // blends back to the bent guard — that IS the recovery pose.
    if (state === 'jab') {
      return attackPose(p,
        { armLx: -0.6, armLForeX: -1.3, torsoRy: base.torsoRy + 0.08 },
        { armLx: -1.9, armLForeX: -0.12, armLz: base.armL.z - 0.25, torsoRy: base.torsoRy - 0.18, legLx: 0.15, headX: base.headX - 0.05 });
    }
    if (state === 'cross') {
      return attackPose(p,
        { armRx: -0.4, armRForeX: -1.3, armRz: base.armR.z - 0.25, torsoRy: base.torsoRy + 0.25, legRx: -0.2, headY: 0.1 },
        { armRx: -2.0, armRForeX: -0.1, torsoRy: base.torsoRy - 0.30, legLx: 0.25, torsoY: base.torsoY - 0.03, headX: base.headX - 0.08 });
    }
    if (state === 'kick') {
      return attackPose(p,
        { legRx: -0.3, legRShinX: 0.9, torsoRx: base.torsoRx + 0.08 },
        { legRx: -1.5, legRShinX: -0.05, legLShinX: 0.3, torsoRx: base.torsoRx - 0.12, torsoRy: base.torsoRy - 0.15, headX: base.headX - 0.1 });
    }
    if (state === 'roundhouse') {
      return attackPose(p,
        { legLx: 0.2, legRx: -0.6, legRShinX: 0.8, torsoRy: base.torsoRy + 0.35, torsoRx: base.torsoRx + 0.1, armLz: base.armL.z + 0.25, headY: 0.15 },
        { legRx: -1.7, legRShinX: -0.05, legLShinX: 0.35, legRz: 0.2, torsoRy: base.torsoRy - 0.4, headX: base.headX - 0.12 });
    }
    if (state === 'blockHigh') {
      // Held guard: forearms crossed up across the face, slight crouch.
      Object.assign(p, {
        armLx: -1.5, armRx: -1.5, armLz: 0.5, armRz: -0.5,
        armLForeX: -1.5, armRForeX: -1.5,
        torsoRx: base.torsoRx + 0.08, legLx: 0.15, legRx: 0.15,
        legLShinX: 0.25, legRShinX: 0.25,
        torsoY: base.torsoY - 0.04, headX: base.headX - 0.05,
      });
      return p;
    }
    if (state === 'blockLow') {
      // Held low guard: forearms down across the belly, deep crouch.
      Object.assign(p, {
        armLx: -0.4, armRx: -0.4, armLz: 0.7, armRz: -0.7,
        armLForeX: -0.5, armRForeX: -0.5,
        torsoRx: base.torsoRx + 0.18, torsoY: base.torsoY - 0.08,
        legLx: 0.3, legRx: 0.3, legLShinX: 0.4, legRShinX: 0.4,
        headX: base.headX + 0.05,
      });
      return p;
    }
    if (state === 'hit') {
      // Step-back: the knockback translation reads as a step, not a slide.
      Object.assign(p, {
        headX: base.headX - 0.25, headY: 0.1,
        torsoRx: base.torsoRx - 0.15, torsoRy: base.torsoRy - 0.1,
        armLz: 0.5, armRz: -0.5,
        legLx: 0.25, legRx: -0.35, legLShinX: 0.2, legRShinX: 0.3,
      });
      return p;
    }
    if (state === 'hitHeavy') {
      // Bigger step-back + deeper torso pitch.
      Object.assign(p, {
        headX: base.headX - 0.4,
        torsoRx: base.torsoRx - 0.28, torsoY: base.torsoY - 0.05,
        armLz: 0.7, armRz: -0.7,
        legLx: 0.35, legRx: -0.5, legLShinX: 0.3, legRShinX: 0.45,
      });
      return p;
    }
    if (state === 'dodge') {
      // Dash step: legs scissor, torso lowers, push-off knee bend.
      // Backward evade leans further back (combatPhase.evade).
      Object.assign(p, {
        legLx: 0.4, legRx: -0.4,
        legLShinX: 0.5, legRShinX: 0.2,
        torsoY: base.torsoY - 0.06,
        torsoRx: base.torsoRx + (combatPhase.evade ? 0.18 : 0.1),
      });
      return p;
    }
    if (state === 'ko') {
      // Terminal fall: torso pitches back, arms fall to the sides.
      // The group lowering happens in update() (see below).
      Object.assign(p, {
        torsoRx: base.torsoRx - 0.9, headX: base.headX - 0.3,
        armLz: 0.9, armRz: -0.9, legLx: 0, legRx: 0,
      });
      return p;
    }
    if (state === 'special') {
      // Visual upgrade — pose slots for Phase 5's four special kinds.
      const spec = SPECIAL_POSES[specialKind] || SPECIAL_POSES.punch;
      return attackPose(p, spec.k0, spec.k1);
    }
    return p;
  }

  function applyPose(pose, k) {
    parts.armL.rotation.x = lerpAngle(parts.armL.rotation.x, pose.armLx, k);
    parts.armL.rotation.z = lerpAngle(parts.armL.rotation.z, pose.armLz, k);
    parts.armR.rotation.x = lerpAngle(parts.armR.rotation.x, pose.armRx, k);
    parts.armR.rotation.z = lerpAngle(parts.armR.rotation.z, pose.armRz, k);
    parts.armLFore.rotation.x = lerpAngle(parts.armLFore.rotation.x, pose.armLForeX, k);
    parts.armRFore.rotation.x = lerpAngle(parts.armRFore.rotation.x, pose.armRForeX, k);
    parts.legL.rotation.x = lerpAngle(parts.legL.rotation.x, pose.legLx, k);
    parts.legR.rotation.x = lerpAngle(parts.legR.rotation.x, pose.legRx, k);
    parts.legL.rotation.z = lerpAngle(parts.legL.rotation.z, pose.legLz, k);
    parts.legR.rotation.z = lerpAngle(parts.legR.rotation.z, pose.legRz, k);
    parts.legLShin.rotation.x = lerpAngle(parts.legLShin.rotation.x, pose.legLShinX, k);
    parts.legRShin.rotation.x = lerpAngle(parts.legRShin.rotation.x, pose.legRShinX, k);
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
      parts.armLFore.rotation.x = lerpAngle(parts.armLFore.rotation.x, -0.1, k);
      parts.armRFore.rotation.x = lerpAngle(parts.armRFore.rotation.x, -0.1, k);
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

    if (state === 'ko') {
      // The one exception to "animator never writes group.position":
      // the match is frozen by then, so lowering the group to the mat
      // (GROUND_Y 0.56 − 0.35 = 0.21) cannot fight the movement
      // controller. Rematch rebuilds the model, so no restore is needed.
      group.position.y = lerpAngle(group.position.y, 0.21, k);
    }

    // Locomotion / idle: compute the target pose, blend in from the
    // snapshot taken at state entry, then lerp the pivots toward it.
    // Locomotion + idle track the target EXACTLY (k=1): the target is
    // a continuous function of the walk phase, and the per-frame lerp
    // (k=dt*9, ~0.11 s lag) would put the rendered leg ~46° behind
    // the intended plant timing — the foot would slide again. State
    // changes stay smooth because the blend above interpolates the
    // target itself. Combat / hit / ko keep the lerp (proven in
    // Phase 4 — their poses are keyframed, not ground-contact).
    let target = poseFor(dt, t);
    if (blendT < 1 && prevPose) {
      blendT = Math.min(1, blendT + dt / blendDur);
      target = lerpPose(prevPose, target, easeOut(blendT));
    }
    const ak = (state === 'walk' || state === 'run' || state === 'back' || state === 'side' || state === 'idle') ? 1 : k;
    applyPose(target, ak);
  }

  return {
    setState,
    update,
    getState: () => state,
    // Visual upgrade — the arena feeds the controller's measured speed
    // here every tick so the walk phase matches the ground speed.
    setSpeed(v) { if (Number.isFinite(v)) speedNow = Math.max(0, v); },
    getSpeed: () => speedNow,
    // Phase 5 reads these pose tables when it wires the special state.
    specialPoses: SPECIAL_POSES,
  };
}
