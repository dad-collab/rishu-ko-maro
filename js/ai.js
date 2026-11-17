// RISHU.COM — Phase 6 — ai.js
// Computer opponent: perception + decision + behaviour FSM + difficulty
// parameters. Pure logic — no DOM, no three import, no Math.random.
//
// Contract (see PHASE6-PLAN.md §1–§4):
// - The AI receives ONLY world state (the arena builds the perception
//   object each frame). It NEVER reads keyboard/touch input, never
//   writes positions, HP or camera state. All movement goes through the
//   controller's velocity input ({mx, mz, run, jump}); all damage goes
//   through combat.js. The AI feeds combat.js exactly the same input
//   shape a human feeds it.
// - Decisions run at 10 Hz (sim time) with a per-difficulty reaction
//   delay: the AI queues a response to a trigger (player enters attack
//   startup, player whiffs) and fires it after the delay, only if it
//   is still legal then. Between ticks the AI holds its current action.
// - Difficulty is BEHAVIOUR ONLY (reaction delay, block/dodge/counter
//   probabilities, attack frequency, combo use, approach speed, mistake
//   rate). Damage is identical across difficulties — this module holds
//   no damage parameter and never calls damageFor.
// - Randomness: scored decisions only. Ties and probability gates use
//   a SEEDED PRNG (mulberry32, one per match) — never Math.random.
//   The same scripted opponent sequence + same seed produces the same
//   AI action sequence (the harness asserts this).
// - Range gate (hard): an attack edge is emitted only when
//   distance <= reachFor(attack, aiChar) * 0.95. Never the same attack
//   3 times in a row. No attack while locked (state !== 'ready'),
//   airborne, or within 0.25 s of the last action edge.
// - Specials: scored like any attack, gated on perception.specialReady
//   (the arena reads the Phase 5 cooldown controller). The AI emits
//   input.special; combat.js executes the special. No special code of
//   its own — and no shake code: AI heavy hits shake through the
//   shared handleCombatEvent call site for free.

import { ATTACKS, reachFor } from './combat.js';
import { isChainFollowUp, CHAINS } from './comboSystem.js';
import { specialFor } from './specials.js';

export const AI_DIFFICULTIES = ['easy', 'medium', 'hard'];

// One table, one place: tuning the AI is a data edit, not a logic edit.
// Reaction = trigger -> act (seconds of sim time). All probabilities
// are per decision-tick gates, not per frame.
//
// Reaction calibration (measured, not guessed): a queued block only
// stops a hit if it lands before the attack's startup — lightPunch
// 0.10 s, kick 0.14 s, heavyPunch 0.18 s, heavyKick 0.24 s (combat.js).
// The audit's first values (0.45 / 0.28 / 0.16 s) exceeded EVERY
// startup, so the harness measured a 0% block rate on all three
// difficulties — the AI could never defend, and the block-rate
// parameters (0.15 / 0.35 / 0.55) were unreachable. The delays are
// therefore scaled to fit inside the startups (EASY still slowest,
// HARD fastest); the difficulty distinction is carried by the RATES
// (block / dodge / counter / combo / attackFreq), as this table
// intends. The mistake rate (+0.25 s on some reactions) is what keeps
// the AI human: a late reaction still takes the hit.
export const DIFFICULTY = {
  easy: {
    reaction: 0.12, block: 0.15, dodge: 0.10, counter: 0.10,
    attackFreq: 0.30, comboUse: 0, approachRun: 'walk',
    preferred: 'balanced', mistake: 0.20, specialUse: 0.05,
  },
  medium: {
    reaction: 0.08, block: 0.35, dodge: 0.25, counter: 0.35,
    attackFreq: 0.50, comboUse: 0.35, approachRun: 'mix',
    preferred: 'balanced', mistake: 0.10, specialUse: 0.25,
  },
  hard: {
    reaction: 0.05, block: 0.55, dodge: 0.40, counter: 0.65,
    attackFreq: 0.70, comboUse: 0.65, approachRun: 'run',
    preferred: 'aggressive', mistake: 0.03, specialUse: 0.60,
  },
};

// The four brief behaviours are parameter rows over ONE state machine,
// not four AIs. attackBias multiplies the attack-frequency gate;
// punishBias multiplies the whiff-punish score bonus.
export const BEHAVIOUR = {
  aggressive: { rangeMin: 1.2, rangeMax: 2.2, attackBias: 1.4, blockBias: 0.5, dodgeBias: 0.6, punishBias: 1.5, retreatBias: 0.3 },
  defensive: { rangeMin: 2.2, rangeMax: 3.0, attackBias: 0.5, blockBias: 1.5, dodgeBias: 1.3, punishBias: 1.8, retreatBias: 1.6 },
  balanced: { rangeMin: 1.8, rangeMax: 2.6, attackBias: 1.0, blockBias: 1.0, dodgeBias: 1.0, punishBias: 1.0, retreatBias: 1.0 },
  counter: { rangeMin: 2.0, rangeMax: 2.8, attackBias: 0.4, blockBias: 1.4, dodgeBias: 1.2, punishBias: 2.2, retreatBias: 0.8 },
};

const DECISION_INTERVAL = 0.10; // s of sim time between decisions (10 Hz)
const DECISION_COOLDOWN = 0.25; // s between AI action edges (no machine-gun)
const MODE_DWELL = 2.0; // s minimum per behaviour mode (no flicker)
const WATCHDOG_IDLE = 3.0; // s with no move/attack before forcing action
const PUNISH_WINDOW = 0.6; // s after an opponent whiff/block during which attacks score big
const CHAIN_WINDOW = 0.12; // s before recovery ends during which a chain input buffers
const MAX_BLOCK_HOLD = 1.0; // s — a held block never sticks forever
const COMFORT_ROPE = 4.0; // m radial — past this, sidestep instead of backing up

// Attack base scores (heavyKick > heavyPunch > kick > lightPunch).
const ATTACK_BASE = { lightPunch: 1.0, kick: 1.2, heavyPunch: 1.6, heavyKick: 2.0 };
// Attack ids in table order (deterministic iteration).
const ATTACK_IDS = ['lightPunch', 'kick', 'heavyPunch', 'heavyKick'];
// Animator name -> attack id (fallback when only the anim is known).
export const ANIM_TO_ATTACK = { jab: 'lightPunch', cross: 'heavyPunch', kick: 'kick', roundhouse: 'heavyKick' };

// Deterministic PRNG (mulberry32). One instance per AI — the match seed
// makes the whole match reproducible for the harness.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Next attack in a legal chain after `history` (most recent last), or
// null. The LONGEST matching prefix wins: k runs from long to short,
// so [kick, kick] completes kickKickRoundhouse with heavyKick —
// checking k = 1 first would return kick again and the chain would
// repeat the same attack forever.
function chainNext(history) {
  for (const chain of Object.values(CHAINS)) {
    for (let k = chain.length - 1; k >= 1; k--) {
      const prefix = chain.slice(0, k);
      if (history.length >= k && history.slice(-k).join('|') === prefix.join('|')) {
        return chain[k];
      }
    }
  }
  return null;
}

export function createCpuOpponent({ difficulty = 'medium', char = null, seed = 1 } = {}) {
  const diffName = DIFFICULTY[difficulty] ? difficulty : 'medium';
  const diff = DIFFICULTY[diffName];
  const rng = mulberry32(seed);
  const aiChar = char || null;
  // Accept a character object OR a bare fighter id string — a string
  // must not silently lose the special (specialFor(undefined) is
  // null, so the AI would never special and nothing would error).
  const aiCharId = typeof aiChar === 'string' ? aiChar : aiChar?.id;
  const mySpecialDef = aiCharId ? specialFor(aiCharId) : null;

  // --- Mutable state (all sim-time) ---
  let now = 0;
  let mode = diff.preferred;
  let modeSince = -MODE_DWELL; // the first switch may happen immediately (the dwell prevents flicker between switches, not the first one)
  let nextDecisionAt = 0;
  let lastActionAt = -Infinity;
  let attackHistory = []; // attack ids, most recent last (max 3 kept)
  let lastMyAttackId = null; // id of the attack currently observed in flight
  let lastMyAttackT = 0; // t of the attack currently observed in flight
  let pending = null; // { kind: 'block'|'dodge'|'evade', fireAt, guard }
  let blocking = false;
  let blockGuardLow = false;
  let blockUntil = 0;
  let punishUntil = 0;
  let playerAttacks = []; // sim times of player attack starts (5 s window)
  let playerAttackHistory = []; // player attack ids (repeat detection)
  let playerPassiveSince = 0; // last time the player attacked or closed in
  let oppAttackId = null; // opponent attack id currently tracked (null = none)
  let oppAttackStartHp = 100;
  let lastMoveAt = 0; // last time the AI moved or attacked (watchdog)
  let forceAct = false; // watchdog: next decision ignores the attack-freq gate
  let hitstunTimes = []; // sim times of recent hitstun entries (corner-punish rule)
  let wasHitstun = false;
  let moveHold = { mx: 0, mz: 0, run: false, jump: false };
  let combatHold = { attack: null, special: false, block: false, blockLow: false, dodge: false, evade: false, dodgeDir: null, grounded: true };
  let edgePending = false; // a one-shot edge awaits its one read
  let decisionCount = 0;
  const stats = { decisions: 0, attacks: 0, blocks: 0, dodges: 0, specials: 0, jumps: 0 };

  // Module-scope temps (no per-frame allocation in the hot path).
  const _dir = { x: 0, z: 0 };

  function clearEdges() {
    combatHold.attack = null;
    combatHold.special = false;
    combatHold.dodge = false;
    combatHold.evade = false;
    combatHold.dodgeDir = null;
    moveHold.jump = false;
  }

  // World direction (dx, dz, normalised) -> camera-relative (mx, mz).
  // The controller maps _desired = fwd * mz + right * mx, where
  // right = fwd x UP = (-fwd.z, fwd.x).
  function dirToInput(dx, dz, fwd, out) {
    const len = Math.hypot(dx, dz) || 1;
    const nx = dx / len;
    const nz = dz / len;
    const rx = -fwd.z;
    const rz = fwd.x;
    out.mx = nx * rx + nz * rz;
    out.mz = nx * fwd.x + nz * fwd.z;
    return out;
  }

  function emitAttack(id) {
    combatHold.attack = id;
    edgePending = true;
    lastActionAt = now;
    lastMoveAt = now;
    // NOTE: attackHistory is NOT pushed here — it is synced from the
    // observed attack in update() (see below), so a dropped edge
    // never enters the history.
    stats.attacks += 1;
  }

  function emitSpecial() {
    combatHold.special = true;
    edgePending = true;
    lastActionAt = now;
    lastMoveAt = now;
    stats.specials += 1;
  }

  function emitDodge(evade, p) {
    if (evade) combatHold.evade = true;
    else combatHold.dodge = true;
    // Dodge away from the opponent (world XZ, normalised).
    const dx = p.myPos.x - p.oppPos.x;
    const dz = p.myPos.z - p.oppPos.z;
    const len = Math.hypot(dx, dz) || 1;
    combatHold.dodgeDir = { x: dx / len, z: dz / len };
    edgePending = true;
    lastActionAt = now;
    lastMoveAt = now;
    stats.dodges += 1;
  }

  function queueResponse(kind, guard) {
    // Reaction delay with +/-10% seeded jitter (human variance). The
  // band is chosen so a response never fires earlier than
  // delay - 0.05 s (the harness band): 0.12 * 0.90 = 0.108.
    const jitter = 1 + (rng() * 0.20 - 0.10);
    let delay = diff.reaction * jitter;
    // Mistake rate: a deliberate late reaction — the block/dodge fires
    // after the incoming attack's active window, so the AI takes the hit.
    if (rng() < diff.mistake) delay += 0.25;
    pending = { kind, guard: guard || 'high', fireAt: now + delay };
  }

  // `res` is the queued response (the caller already cleared
  // `pending` — reading pending.kind here would crash on null).
  function firePending(p, res) {
    const kind = res.kind;
    if (p.myState !== 'ready' || !p.myGrounded) return; // still illegal — drop it
    if (kind === 'block') {
      blocking = true;
      blockGuardLow = res.guard === 'low';
      // Hold until the incoming attack ends (or the max hold).
      const remain = p.oppAttack ? Math.max(0, p.oppAttack.total - p.oppAttack.t) : 0.15;
      blockUntil = now + Math.min(MAX_BLOCK_HOLD, remain + 0.10);
      combatHold.block = true;
      combatHold.blockLow = blockGuardLow;
      stats.blocks += 1;
    } else if (kind === 'dodge') {
      emitDodge(false, p);
    } else if (kind === 'evade') {
      emitDodge(true, p);
    }
  }

  function onOppAttackStart(p) {
    const atk = p.oppAttack;
    oppAttackId = atk.id;
    oppAttackStartHp = p.myHp;
    playerAttacks.push(now);
    playerAttackHistory.push(atk.id);
    if (playerAttackHistory.length > 6) playerAttackHistory.shift();
    playerPassiveSince = now;
    if (pending) return; // one response at a time
    const b = BEHAVIOUR[mode];
    // HARD counters a player who repeats the same attack: three in a
    // row forces a block-then-punish response.
    const last3 = playerAttackHistory.slice(-3);
    const repeated = last3.length === 3 && last3[0] === last3[1] && last3[1] === last3[2];
    const blockP = diff.block * b.blockBias;
    const dodgeP = diff.dodge * b.dodgeBias;
    const roll = rng();
    if (repeated && diffName === 'hard') {
      queueResponse('block', atk.guard);
    } else if (roll < blockP) {
      queueResponse('block', atk.guard);
    } else if (roll < blockP + dodgeP) {
      // Dodge the heavies; evade (backward) when cornered.
      const radial = Math.hypot(p.myPos.x, p.myPos.z);
      queueResponse(radial > COMFORT_ROPE ? 'evade' : 'dodge', atk.guard);
    } else if (mode === 'counter' && rng() < diff.counter) {
      queueResponse('block', atk.guard);
    }
    // Otherwise: no response — the AI takes the hit (never blocks everything).
  }

  function onOppAttackEnd(p) {
    // The opponent's attack ended without landing on us (whiff, block
    // or dodge) -> a punish window opens.
    if (p.myHp >= oppAttackStartHp) punishUntil = now + PUNISH_WINDOW;
    oppAttackId = null;
  }

  function switchBehaviour(p) {
    if (now - modeSince < MODE_DWELL) return;
    const hpDiff = p.myHp - p.oppHp;
    let next = null;
    if (hpDiff < -30) next = 'defensive'; // losing badly: survive, punish
    else if (hpDiff > 30) next = 'balanced'; // ahead: don't throw it away
    else if (p.oppCombo >= 2) next = 'counter'; // being comboed: block, punish the end
    else if (now - playerPassiveSince > 5) next = 'aggressive'; // player idle: force the fight
    else {
      // Preferred behaviour, with rounds awareness (Phase 5): down a
      // round -> press; up a round -> hold the lead.
      next = diff.preferred;
      if (p.roundWins) {
        if (p.roundWins.opp > p.roundWins.my) next = 'aggressive';
        else if (p.roundWins.my > p.roundWins.opp) next = 'balanced';
      }
    }
    if (next && next !== mode) {
      mode = next;
      modeSince = now;
    }
  }

  // Score every attack; the highest wins. -Infinity = illegal (hard gates).
  function scoreAttacks(p, b) {
    let best = null;
    let bestScore = -Infinity;
    for (const id of ATTACK_IDS) {
      const atk = ATTACKS[id];
      const reach = reachFor(atk, aiChar);
      if (p.dist > reach * 0.95) continue; // range gate (hard)
      // Never the same attack 3 times in a row (hard).
      if (attackHistory.length >= 2 && attackHistory[attackHistory.length - 1] === id
        && attackHistory[attackHistory.length - 2] === id) continue;
      let s = ATTACK_BASE[id];
      s += 0.5 * (p.dist / reach); // closer to max reach -> prefer the longer attack
      if (now < punishUntil) s += 2.0 * b.punishBias; // punish a whiff
      if (p.myCombo >= 1 && isChainFollowUp(attackHistory, id)) s += 1.5; // continue a chain
      if (p.dist > reach * 0.85) s -= 0.5; // near the edge of reach: whiff risk
      if (p.myHp < 25 && (id === 'heavyPunch' || id === 'heavyKick')) s -= 1.5; // low HP: fast lights
      if (s > bestScore) { bestScore = s; best = id; }
    }
    return best;
  }

  function scoreSpecial(p) {
    if (!mySpecialDef || !p.specialReady) return -Infinity;
    const reach = reachFor({ range: mySpecialDef.range }, aiChar);
    if (p.dist > reach * 0.95) return -Infinity; // same range gate as normals
    let s = 3.0; // high base (20 damage) — used rarely by design
    if (p.oppHp <= 20) s += 3.0; // it would KO (or nearly)
    if (p.roundWins && p.roundWins.opp > p.roundWins.my && p.oppHp <= 35) s += 1.5; // round-ender
    if (p.myHp < 25) s -= 1.0;
    return s;
  }

  // closeIn: no attack or special is usable from here (out of range,
  // or the only in-range attack is triple-banned) — close the
  // distance instead of holding the comfort band. Without this the AI
  // deadlocks: it holds at ~2.4 m (balanced rangeMax 2.6), where only
  // heavyKick reaches, and after two heavyKicks the triple rule bans
  // it — so it stands still, in range of nothing, forever.
  function setMovement(p, b, closeIn) {
    const dx = p.oppPos.x - p.myPos.x;
    const dz = p.oppPos.z - p.myPos.z;
    const dist = p.dist;
    const radial = Math.hypot(p.myPos.x, p.myPos.z);
    // Rope escape: past the comfort radius with the opponent closing,
    // sidestep (a z-component) instead of backing straight into the rope.
    if (radial > COMFORT_ROPE && p.closing) {
      // Perpendicular to the opponent direction; pick the sign that
      // keeps the radial distance from growing.
      const px = -dz;
      const pz = dx;
      const len = Math.hypot(px, pz) || 1;
      const candA = { x: px / len, z: pz / len };
      const candB = { x: -px / len, z: -pz / len };
      const rA = Math.hypot(p.myPos.x + candA.x, p.myPos.z + candA.z);
      const rB = Math.hypot(p.myPos.x + candB.x, p.myPos.z + candB.z);
      const pick = rA <= rB ? candA : candB;
      dirToInput(pick.x, pick.z, p.fwd, moveHold);
      moveHold.run = false;
      lastMoveAt = now;
      return;
    }
    if (dist > b.rangeMax || (closeIn && dist > b.rangeMin)) {
      // Approach: toward the opponent. Run when far (difficulty-gated).
      dirToInput(dx, dz, p.fwd, moveHold);
      const wantRun = diff.approachRun === 'run'
        || (diff.approachRun === 'mix' && dist > 3.2);
      moveHold.run = wantRun;
      lastMoveAt = now;
    } else if (dist < b.rangeMin) {
      // Too close: back off (defensive/counter retreat faster).
      dirToInput(-dx, -dz, p.fwd, moveHold);
      moveHold.run = false;
      lastMoveAt = now;
    } else {
      // Comfort band: hold position. Counter mode strafes to bait.
      if (mode === 'counter' && rng() < 0.3) {
        dirToInput(-dz, dx, p.fwd, moveHold);
        moveHold.run = false;
        lastMoveAt = now;
      } else {
        moveHold.mx = 0;
        moveHold.mz = 0;
        moveHold.run = false;
      }
    }
  }

  function decide(p) {
    decisionCount += 1;
    stats.decisions = decisionCount;
    switchBehaviour(p);
    if (p.myState !== 'ready' || !p.myGrounded) return;
    if (pending) return; // a queued reaction owns this decision
    const b = BEHAVIOUR[mode];
    // Watchdog: 3 s with no move/attack -> force action this decision.
    const forced = forceAct;
    forceAct = false;
    if (now - lastActionAt >= DECISION_COOLDOWN) {
      // Special first (rare, high value) — then the best normal attack.
      const sp = scoreSpecial(p);
      if (sp > -Infinity && (forced || rng() < diff.specialUse)) {
        emitSpecial();
        return;
      }
      const best = scoreAttacks(p, b);
      if (best && (forced || rng() < diff.attackFreq * b.attackBias)) {
        emitAttack(best);
        return;
      }
      // Nothing usable from here (no attack in range, no special):
      // close the distance instead of holding the comfort band
      // (the deadlock — see setMovement's closeIn note).
      if (best === null && sp <= -Infinity) {
        setMovement(p, b, true);
        return;
      }
    }
    setMovement(p, b, false);
  }

  function update(dt, p) {
    now = p.now;
    combatHold.grounded = !!p.myGrounded;
    // A one-shot edge set last frame was already read by the arena this
    // frame (getCombat returns a fresh copy) — clear it now so it
    // cannot fire twice. Block is held, never an edge.
    if (edgePending) {
      clearEdges();
      edgePending = false;
    }
    // Track the opponent's attack: entry (reaction trigger) and end
    // (punish window when it did not land).
    if (p.oppAttack && p.oppAttack.id !== oppAttackId) onOppAttackStart(p);
    else if (!p.oppAttack && oppAttackId) onOppAttackEnd(p);
    // Sync the attack history from the attack actually in flight, not
    // from the edge emitted: an emitted edge can be dropped when the
    // opponent lands a hit in the same frame (combatA.update runs
    // before combatB.update, so the AI's perception is one frame
    // stale and its attack is eaten by hitstun). Recording the
    // emission would let chainNext / the triple rule operate on a
    // phantom sequence — e.g. emitting heavyKick as the follow-up to
    // [lightPunch, kick] when only [kick] really started. A new
    // attack is detected by id change OR by t resetting (a buffered
    // chain follow-up starts in the same update the previous attack
    // ends, so two consecutive kicks never show a null gap — only
    // t dropping to ~0 tells them apart). Specials are not attacks
    // and never enter the history.
    if (p.myAttack && p.myAttack.id !== 'special') {
      const isNew = p.myAttack.id !== lastMyAttackId || p.myAttack.t < lastMyAttackT;
      if (isNew) {
        lastMyAttackId = p.myAttack.id;
        attackHistory.push(p.myAttack.id);
        if (attackHistory.length > 3) attackHistory.shift();
      }
      lastMyAttackT = p.myAttack.t;
    }
    if (!p.myAttack) { lastMyAttackId = null; lastMyAttackT = 0; }
    // Hitstun tracking (corner-punish rule): two hitstuns in 2 s ->
    // the next decision prefers a dodge over a block. Count ENTRIES
    // into hitstun, not frames spent in it.
    if (p.myState === 'hitstun' && !wasHitstun) {
      hitstunTimes.push(now);
      hitstunTimes = hitstunTimes.filter((t) => now - t <= 2.0);
    }
    wasHitstun = p.myState === 'hitstun';
    // Chain follow-up: while my own attack is in its last CHAIN_WINDOW
    // of recovery, a legal chain hit buffers through combat.js. The
    // follow-up obeys the SAME hard rules as a fresh decision: the
    // range gate (the opponent may have been knocked back out of
    // reach) and the no-triple rule.
    if (p.myAttack && p.myState === 'attack' && diff.comboUse > 0) {
      const { t, total } = p.myAttack;
      if (t >= total - CHAIN_WINDOW && !edgePending) {
        const next = chainNext(attackHistory);
        if (next && rng() < diff.comboUse) {
          const reach = reachFor(ATTACKS[next], aiChar) * 0.95;
          const triple = attackHistory.length >= 2
            && attackHistory[attackHistory.length - 1] === next
            && attackHistory[attackHistory.length - 2] === next;
          if (p.dist <= reach && !triple) emitAttack(next);
        }
      }
    }
    // Fire a queued reaction response when its delay expires.
    if (pending && now >= pending.fireAt) {
      const was = pending;
      pending = null;
      // Corner-punish: hitstun-locked twice in 2 s -> dodge instead of block.
      if (was.kind === 'block' && hitstunTimes.length >= 2) {
        emitDodge(false, p);
      } else {
        firePending(p, was);
      }
    }
    // Block hold maintenance: keep holding while the incoming attack
    // runs; release when it ends or the max hold expires.
    if (blocking) {
      if (!p.oppAttack || now > blockUntil || p.myState !== 'ready') {
        blocking = false;
        combatHold.block = false;
        combatHold.blockLow = false;
      } else {
        combatHold.block = true;
        combatHold.blockLow = blockGuardLow;
      }
    }
    // Prune the player-aggression window (5 s).
    while (playerAttacks.length > 0 && now - playerAttacks[0] > 5) playerAttacks.shift();
    // Jump escape: a low-guard heavy kick in range is jumped over
    // (rare), or jump to close distance when the player is airborne.
    if (!edgePending && p.myState === 'ready' && p.myGrounded) {
      if (p.oppAttack && p.oppAttack.guard === 'low' && p.dist < 2.0 && rng() < 0.3) {
        moveHold.jump = true;
        edgePending = true;
        lastMoveAt = now;
        stats.jumps += 1;
      } else if (!p.oppGrounded && p.dist > 3.0 && rng() < 0.05) {
        moveHold.jump = true;
        edgePending = true;
        lastMoveAt = now;
        stats.jumps += 1;
      }
    }
    // Decision tick (10 Hz).
    if (now >= nextDecisionAt) {
      nextDecisionAt = now + DECISION_INTERVAL;
      decide(p);
    }
    // Anti-stuck watchdog: no move/attack for 3 s of sim time -> force
    // action on the next decision (approach if far, attack if in range).
    if (now - lastMoveAt > WATCHDOG_IDLE && p.myState === 'ready') {
      forceAct = true;
      lastMoveAt = now;
    }
  }

  function reset() {
    now = 0;
    mode = diff.preferred;
    modeSince = -MODE_DWELL;
    nextDecisionAt = 0;
    lastActionAt = -Infinity;
    attackHistory = [];
    lastMyAttackId = null;
    lastMyAttackT = 0;
    pending = null;
    blocking = false;
    blockGuardLow = false;
    blockUntil = 0;
    punishUntil = 0;
    playerAttacks = [];
    playerAttackHistory = [];
    playerPassiveSince = 0;
    oppAttackId = null;
    oppAttackStartHp = 100;
    lastMoveAt = 0;
    forceAct = false;
    hitstunTimes = [];
    wasHitstun = false;
    moveHold = { mx: 0, mz: 0, run: false, jump: false };
    combatHold = { attack: null, special: false, block: false, blockLow: false, dodge: false, evade: false, dodgeDir: null, grounded: true };
    edgePending = false;
    decisionCount = 0;
    stats.decisions = 0;
    stats.attacks = 0;
    stats.blocks = 0;
    stats.dodges = 0;
    stats.specials = 0;
    stats.jumps = 0;
  }

  return {
    update,
    reset,
    // Held outputs — fresh objects every call, so the arena's read is
    // never mutated by a later update (one-shot edges survive exactly
    // one read).
    getMovement() {
      return { mx: moveHold.mx, mz: moveHold.mz, run: moveHold.run, jump: moveHold.jump };
    },
    getCombat() {
      return {
        attack: combatHold.attack,
        special: combatHold.special,
        block: combatHold.block,
        blockLow: combatHold.blockLow,
        dodge: combatHold.dodge,
        evade: combatHold.evade,
        dodgeDir: combatHold.dodgeDir ? { x: combatHold.dodgeDir.x, z: combatHold.dodgeDir.z } : null,
        grounded: combatHold.grounded,
      };
    },
    getMode: () => mode,
    getStats: () => ({ ...stats, mode, difficulty: diffName }),
    // Read-only debug accessor (harness/E2E): the observed attack
    // history the chain + triple rules run on. Not gameplay state.
    getAttackHistory: () => [...attackHistory],
    get difficulty() { return diffName; },
    get charId() { return aiCharId || null; },
  };
}
