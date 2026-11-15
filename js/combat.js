// RISHU.COM — Phase 4 — combat.js
// Per-fighter combat state machine: attacks, block, dodge/evade, hitstun,
// KO. Pure logic — no DOM, no three import (positions are plain {x, z}
// objects; the arena passes the movement controller's live position,
// which is a THREE.Vector3 and satisfies the same shape).
//
// Deterministic: damage comes only from COMBAT-DESIGN.md §2 (stats in,
// same number out — no Math.random anywhere in this file).
//
// Animator ownership rule (see ANIMATION-PLAN.md §4): this module is the
// ONLY writer of combat animator states. The movement controller keeps
// calling its own setAnim every frame, so after the controllers run the
// arena tick MUST call syncAnimator() (below) to re-assert the combat
// pose whenever the combat state is not 'ready'. Without that call an
// attack pose is overwritten by the controller's 'idle' in the same tick.
//
// Hit-test rule: exactly ONE test per attack, at the first frame of the
// active window. The attack carries hitDone so it can never register twice.

export const MAX_HP = 100;

// Attack table — COMBAT-DESIGN.md §3. Times in seconds, ranges in metres
// (centre-to-centre, scaled by the attacker's `range` stat in reachFor).
export const ATTACKS = {
  lightPunch: {
    id: 'lightPunch', anim: 'jab', guard: 'high',
    startup: 0.10, active: 0.08, recovery: 0.14,
    range: 1.9, baseDamage: 4, hitstun: 0.22, blockstun: 0.12,
    chip: 0, shake: 0, knockback: 0,
  },
  heavyPunch: {
    id: 'heavyPunch', anim: 'cross', guard: 'high',
    startup: 0.18, active: 0.10, recovery: 0.28,
    range: 2.0, baseDamage: 8, hitstun: 0.38, blockstun: 0.20,
    chip: 1, shake: 0.05, knockback: 0.15,
  },
  kick: {
    id: 'kick', anim: 'kick', guard: 'mid',
    startup: 0.14, active: 0.10, recovery: 0.22,
    range: 2.3, baseDamage: 6, hitstun: 0.30, blockstun: 0.16,
    chip: 1, shake: 0, knockback: 0.10,
  },
  heavyKick: {
    id: 'heavyKick', anim: 'roundhouse', guard: 'low',
    startup: 0.24, active: 0.12, recovery: 0.38,
    range: 2.5, baseDamage: 11, hitstun: 0.50, blockstun: 0.28,
    chip: 1, shake: 0.08, knockback: 0.35,
  },
};

export const DEFENSE = {
  BLOCK_STARTUP: 0.05,
  DODGE_TIME: 0.28,
  DODGE_IFRAME_START: 0.05,
  DODGE_IFRAME_END: 0.25,
  DODGE_DIST: 1.2,
  DODGE_COOLDOWN: 0.8,
  EVADE_TIME: 0.34,
  EVADE_IFRAME_END: 0.30,
  EVADE_DIST: 1.8,
  EVADE_COOLDOWN: 1.2,
  CHAIN_BUFFER: 0.35, // s after an attack ends during which a chained input is held
  CHAIN_WINDOW: 0.12, // s before recovery ends during which input may be buffered
  HITSTOP_LIGHT: 0,
  HITSTOP_HEAVY: 0.04,
  HITSTOP_HEAVY_KICK: 0.06,
};

// Deterministic damage — COMBAT-DESIGN.md §2. No randomness.
export function damageFor(attack, attackerChar, defenderChar, comboScale = 1) {
  const strF = 0.8 + 0.04 * (attackerChar?.strength ?? 7);
  const defF = 1.15 - 0.03 * (defenderChar?.defense ?? 7);
  return Math.max(0, Math.round(attack.baseDamage * strF * defF * comboScale));
}

// Reach scales with the attacker's `range` stat (characters.js).
export function reachFor(attack, attackerChar) {
  const r = typeof attackerChar?.range === 'number' ? attackerChar.range : 6;
  return attack.range * (0.9 + 0.025 * r);
}

function dist2D(a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return Math.hypot(dx, dz);
}

// Brief hit flash on the defender's model: emissive pulse, restored
// after `ms`. Materials are per-fighter (built fresh in
// buildFighterModel), so flashing one never flashes the other.
// The caller (arena) must clear the returned timer on stopMatch.
export function flashFighter(model, ms = 70) {
  if (!model || !model.group) return 0;
  const mats = [];
  model.group.traverse((o) => {
    if (o.material && o.material.emissive && !mats.includes(o.material)) {
      mats.push(o.material);
      o.material.emissive.setHex(0xBC5222);
      o.material.emissiveIntensity = 0.55;
    }
  });
  return setTimeout(() => {
    for (const m of mats) {
      m.emissive.setHex(0x000000);
      m.emissiveIntensity = 1;
    }
  }, ms);
}

export function createFighterCombat({
  char,
  animator,
  getPosition, // () => live {x, z} (the controller's position)
  getOpponentPosition, // () => live {x, z}
  getFacing, // () => radians (the controller's facing)
  getComboScale, // () => number (from the combo tracker; default 1)
  onEvent, // (ev) => {} — see event list below
} = {}) {
  const scale = typeof getComboScale === 'function' ? getComboScale : () => 1;
  const emit = typeof onEvent === 'function' ? onEvent : () => {};
  let hp = MAX_HP;
  let state = 'ready'; // 'ready' | 'attack' | 'block' | 'dodge' | 'hitstun' | 'ko'
  let attack = null; // { def, t, hitDone, phase }
  let blockLow = false;
  let stunTimer = 0;
  let dodgeTimer = 0;
  let dodgeTotal = 0;
  let dodgeDir = { x: 0, z: 0 };
  let dodgeCooldown = 0;
  let bufferedAttack = null;
  let bufferTimer = 0;
  let lastAnim = null; // dedup for syncAnimator (same pattern as movement.js setAnim)
  // Pose re-asserted by syncAnimator during hitstun: 'hit' / 'hitHeavy'
  // for a clean hit, 'blockHigh' / 'blockLow' for a blocked hit
  // (blockstun reuses the stun timer — the pose must NOT be the hit pose).
  let stunAnim = 'hit';

  function setAnim(name, opts) {
    // Same-state calls with a new phase go through (attack keyframes);
    // plain same-state calls are deduped (movement.js setAnim pattern).
    if (name === lastAnim && opts?.phase === undefined) return;
    lastAnim = name;
    animator.setState(name, opts);
  }

  function startAttack(def) {
    attack = { def, t: 0, hitDone: false, phase: 'startup' };
    state = 'attack';
    bufferedAttack = null;
    bufferTimer = 0;
    emit({ type: 'attack-start', attack: def.id });
  }

  function endAttack() {
    attack = null;
    state = 'ready';
    // A buffered chain input fires immediately (combo window).
    if (bufferedAttack && bufferTimer > 0) {
      const next = bufferedAttack;
      bufferedAttack = null;
      bufferTimer = 0;
      startAttack(ATTACKS[next]);
    } else {
      // No chain queued: return the animator to idle. Without this the
      // animator would sit in the attack's end pose until the movement
      // controller next changed state — and the controller's own setAnim
      // dedup means it cannot rescue it (its lastAnim is already 'idle').
      setAnim('idle');
    }
  }

  function enterHitstun(duration, heavy) {
    // A hit cancels anything — including a buffered chain input.
    bufferedAttack = null;
    bufferTimer = 0;
    attack = null;
    state = 'hitstun';
    stunTimer = duration;
    stunAnim = heavy ? 'hitHeavy' : 'hit';
    setAnim(stunAnim);
  }

  function enterKo() {
    state = 'ko';
    attack = null;
    bufferedAttack = null;
    setAnim('ko');
    emit({ type: 'ko' });
  }

  // Called by the OPPONENT's attack at its active-window start.
  // Returns 'hit' | 'blocked' | 'dodged' | 'miss'.
  // `attackerComboScale` is the ATTACKER's outgoing-combo scale for this
  // hit (its combo count + 1 — the damage is computed before the tracker
  // records the hit). It MUST come from the attacker: this function runs
  // on the defender, so the defender's own scale() would be the wrong
  // fighter's combo (a defender with a big combo would shrink the
  // damage they take, and the attacker's combo would never scale).
  function receiveAttack(attackDef, attackerChar, attackerPos, attackerComboScale = 1) {
    if (state === 'ko') return 'miss';
    // Dodge i-frames: a clean miss — no damage, no reaction, no combo.
    if (state === 'dodge' && dodgeTimer >= DEFENSE.DODGE_IFRAME_START
      && dodgeTimer <= (dodgeTotal === DEFENSE.EVADE_TIME
        ? DEFENSE.EVADE_IFRAME_END : DEFENSE.DODGE_IFRAME_END)) {
      emit({ type: 'dodged', attack: attackDef.id });
      return 'dodged';
    }
    // Hit test: range only here. The ATTACKER's facing is checked by
    // the caller (its own update() owns the attacker) before this call,
    // and grounded is enforced by update() (attacks only start grounded).
    const pos = getPosition();
    const d = dist2D(attackerPos, pos);
    if (d > reachFor(attackDef, attackerChar)) return 'miss';
    const dx = pos.x - attackerPos.x;
    const dz = pos.z - attackerPos.z;
    // Block: guard level must cover the attack's guard level.
    if (state === 'block') {
      const covers = attackDef.guard === 'mid'
        || (attackDef.guard === 'high' && !blockLow)
        || (attackDef.guard === 'low' && blockLow);
      if (covers) {
        const chip = Math.max(0, Math.round(attackDef.baseDamage * 0.10
          * (0.8 + 0.04 * (attackerChar?.strength ?? 7))
          * (1.15 - 0.03 * (char?.defense ?? 7))));
        hp = Math.max(0, hp - chip);
        stunTimer = attackDef.blockstun;
        state = 'hitstun'; // blockstun reuses the stun timer (shorter)
        // Small pushback away from the attacker.
        const pb = attackDef.id === 'heavyKick' ? 0.25 : 0.15;
        const nx = (pos.x - attackerPos.x) / (d || 1);
        const nz = (pos.z - attackerPos.z) / (d || 1);
        pos.x += nx * pb;
        pos.z += nz * pb;
        // Blocked hit: the stun pose is the GUARD pose (high or low),
        // not the hit pose — syncAnimator re-asserts stunAnim.
        stunAnim = blockLow ? 'blockLow' : 'blockHigh';
        setAnim(stunAnim);
        emit({ type: 'blocked', attack: attackDef.id, chip, hp });
        if (hp <= 0) enterKo();
        return 'blocked';
      }
    }
    // Clean hit. The scale is the attacker's (passed in), never this
    // fighter's own — see the receiveAttack header.
    const dmg = damageFor(attackDef, attackerChar, char, attackerComboScale);
    hp = Math.max(0, hp - dmg);
    const heavy = attackDef.baseDamage >= 8;
    if (attackDef.knockback > 0) {
      const nx = (pos.x - attackerPos.x) / (d || 1);
      const nz = (pos.z - attackerPos.z) / (d || 1);
      pos.x += nx * attackDef.knockback;
      pos.z += nz * attackDef.knockback;
    }
    if (hp <= 0) {
      enterKo();
      emit({ type: 'hit', attack: attackDef.id, damage: dmg, hp, ko: true });
      return 'hit';
    }
    enterHitstun(attackDef.hitstun, heavy);
    emit({ type: 'hit', attack: attackDef.id, damage: dmg, hp });
    return 'hit';
  }

  function update(dt, input, opponent) {
    if (state === 'ko') return;
    if (dodgeCooldown > 0) dodgeCooldown -= dt;
    if (bufferTimer > 0) {
      bufferTimer -= dt;
      if (bufferTimer <= 0) bufferedAttack = null;
    }

    if (state === 'hitstun') {
      stunTimer -= dt;
      if (stunTimer <= 0) { state = 'ready'; setAnim('idle'); }
      return;
    }

    if (state === 'dodge') {
      dodgeTimer += dt;
      const pos = getPosition();
      const step = (dodgeTotal === DEFENSE.EVADE_TIME
        ? DEFENSE.EVADE_DIST / DEFENSE.EVADE_TIME
        : DEFENSE.DODGE_DIST / DEFENSE.DODGE_TIME) * dt;
      pos.x += dodgeDir.x * step;
      pos.z += dodgeDir.z * step;
      if (dodgeTimer >= dodgeTotal) {
        state = 'ready';
        dodgeCooldown = dodgeTotal === DEFENSE.EVADE_TIME
          ? DEFENSE.EVADE_COOLDOWN : DEFENSE.DODGE_COOLDOWN;
        setAnim('idle');
      }
      return;
    }

    if (state === 'block') {
      // Hold to keep blocking; release returns to idle. Low guard is
      // block + back held (input.blockLow).
      blockLow = !!input.blockLow;
      setAnim(blockLow ? 'blockLow' : 'blockHigh');
      if (!input.block) { state = 'ready'; setAnim('idle'); }
      return;
    }

    if (state === 'attack') {
      attack.t += dt;
      const { def } = attack;
      const total = def.startup + def.active + def.recovery;
      // Phase for the animator keyframes (0..1 across the whole attack).
      const phase = Math.min(1, attack.t / total);
      setAnim(def.anim, { phase });
      if (!attack.hitDone && attack.t >= def.startup) {
        attack.hitDone = true;
        attack.phase = 'active';
        // ONE hit test, at the active window's first frame.
        // Facing guard: the attacker must face the defender
        // (dot ≥ 0.5). In practice always true — the controller keeps
        // fighters facing each other — but a whiffed facing check must
        // never register a hit from behind.
        let outcome = 'miss';
        if (opponent) {
          const myPos = getPosition();
          const oppPos = getOpponentPosition();
          const fx = Math.sin(getFacing());
          const fz = Math.cos(getFacing());
          const dx = oppPos.x - myPos.x;
          const dz = oppPos.z - myPos.z;
          const len = Math.hypot(dx, dz) || 1;
          const facingDot = (fx * dx + fz * dz) / len;
          if (facingDot >= 0.5) {
            // The attacker's own combo scale (this fighter's scale()).
            outcome = opponent.receiveAttack(def, char, myPos, scale());
          }
        }
        if (outcome === 'miss') emit({ type: 'whiff', attack: def.id });
        // 'hit' / 'blocked' / 'dodged' events are emitted by receiveAttack.
      } else if (attack.t >= def.startup + def.active) {
        attack.phase = 'recovery';
      }
      // Chain buffer: input in the last CHAIN_WINDOW of recovery queues
      // exactly one follow-up attack.
      if (input.attack && attack.t >= total - DEFENSE.CHAIN_WINDOW) {
        bufferedAttack = input.attack;
        bufferTimer = DEFENSE.CHAIN_BUFFER;
      }
      if (attack.t >= total) endAttack();
      return;
    }

    // state === 'ready'
    if (!input.grounded) return; // no attacks/blocks/dodges mid-air
    if (input.block) {
      state = 'block';
      blockLow = !!input.blockLow;
      setAnim(blockLow ? 'blockLow' : 'blockHigh');
      emit({ type: 'block-start' });
      return;
    }
    if ((input.dodge || input.evade) && dodgeCooldown <= 0) {
      const isEvade = !!input.evade;
      dodgeTotal = isEvade ? DEFENSE.EVADE_TIME : DEFENSE.DODGE_TIME;
      dodgeTimer = 0;
      // Direction: supplied by the arena (camera-relative move input),
      // or straight backward (away from the opponent) when none.
      let dx = input.dodgeDir?.x ?? 0;
      let dz = input.dodgeDir?.z ?? 0;
      if (isEvade || (dx === 0 && dz === 0)) {
        const pos = getPosition();
        const opp = getOpponentPosition();
        dx = pos.x - opp.x;
        dz = pos.z - opp.z;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len; dz /= len;
      } else {
        const len = Math.hypot(dx, dz) || 1;
        dx /= len; dz /= len;
      }
      dodgeDir = { x: dx, z: dz };
      state = 'dodge';
      setAnim('dodge');
      emit({ type: isEvade ? 'evade' : 'dodge' });
      return;
    }
    if (input.attack && ATTACKS[input.attack]) {
      startAttack(ATTACKS[input.attack]);
    }
  }

  // Re-assert the combat pose AFTER the movement controllers have run
  // (their setAnim would otherwise overwrite it — see header). Called
  // by the arena tick after ctrlA/ctrlB.update, before animator.update.
  // Calls animator.setState DIRECTLY (not the deduped setAnim above):
  // the animator's own same-state early return makes this cheap, and a
  // controller overwrite in the same tick is corrected before update().
  // The controller can overwrite at most once per transition (its own
  // dedup), so the blend restarts at most once — invisible at 0.05 s.
  function syncAnimator() {
    if (state === 'attack' && attack) {
      const total = attack.def.startup + attack.def.active + attack.def.recovery;
      animator.setState(attack.def.anim, { phase: Math.min(1, attack.t / total) });
    } else if (state === 'block') {
      animator.setState(blockLow ? 'blockLow' : 'blockHigh');
    } else if (state === 'dodge') {
      animator.setState('dodge');
    } else if (state === 'hitstun') {
      animator.setState(stunAnim);
    } else if (state === 'ko') {
      animator.setState('ko');
    }
    // state 'ready': the controller owns the animator — do nothing.
  }

  return {
    update,
    syncAnimator,
    receiveAttack,
    getState: () => state,
    getHp: () => hp,
    getMaxHp: () => MAX_HP,
    isMovementLocked: () => state !== 'ready',
    isInvulnerable: () => state === 'dodge'
      && dodgeTimer >= DEFENSE.DODGE_IFRAME_START
      && dodgeTimer <= (dodgeTotal === DEFENSE.EVADE_TIME
        ? DEFENSE.EVADE_IFRAME_END : DEFENSE.DODGE_IFRAME_END),
    reset() {
      hp = MAX_HP;
      state = 'ready';
      attack = null;
      bufferedAttack = null;
      bufferTimer = 0;
      stunTimer = 0;
      dodgeTimer = 0;
      dodgeCooldown = 0;
      lastAnim = null;
      setAnim('idle');
    },
    // Special Attack is Phase 5 — prepared only: no input is bound to
    // it anywhere, and this stub exists so a caller can ask honestly.
    trySpecial() {
      return { ok: false, reason: 'phase-5' };
    },
  };
}
