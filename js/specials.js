// RISHU.COM — Phase 5 — specials.js
// Special-attack definitions + per-fighter cooldown state. Pure logic —
// no DOM, no three, no randomness.
//
// Design (see SPECIAL-DESIGN.md in the Phase 5 audit folder):
// - ONE signature special per fighter (their existing specialMove name),
//   typed by one of the 4 brief archetypes: powerPunch | energyBlast |
//   specialKick | ultimate. All-4-per-fighter was rejected (input
//   starvation on keyboard + mobile, 4 cooldowns + 4 VFX sets).
// - Damage: special base 20 x the SAME deterministic stat formula as
//   normals (damageFor from combat.js). Equal-stats reference pair
//   (7/7, e.g. Rishu vs Rishu) lands exactly 20; Rishu -> Kabir is 19.
//   The brief's "Special 20" is therefore the BASE value, not a flat
//   override — same reconciliation as the normal attacks.
// - Cooldown-only gating (no meter in Phase 5, per the brief — it asks
//   for a cooldown system only). Cooldown is SIM time, starts on USE
//   (even on whiff), and resets on round start and on rematch.
// - A special is an attack-like state in combat.js (same one-hit rule:
//   exactly one hit test per sub-hit, facing guard dot >= 0.5).
//   Storm Barrage is the ONE multi-hit variant: 3 real hit tests
//   (7/7/6 = 20 total), each through the same receiveAttack path, so
//   block/dodge work per hit. Blocked chip follows the shared formula
//   (10% of the sub-hit base x stat factors): 2 for a single-hit
//   special, ~1 per blocked Barrage sub-hit (3 total if all blocked).
//
// Shake + hitstop (Phase 5 build, post-shake-landing):
// - `shake` is the peak horizontal camera offset in METRES, taken ONLY
//   from the audited heavy-hit table (heavyPunch 0.05, heavyKick 0.08)
//   — never invented: punch-type specials shake like a heavy punch,
//   kick/ultimate specials like a heavy kick. The arena calls
//   fixedCamera.addShake(def.shake) on a clean special hit, inside the
//   same `def.shake > 0` guard the live heavy-hit call site uses.
// - `hitstop` is the freeze in seconds after a clean special hit
//   (0.04 punch/blast, 0.06 kick/ultimate — the same two values the
//   normal heavy attacks use). The arena reads it from this field;
//   hitstop is decoupled from `shake` (Phase 4 conflated them).

import { damageFor } from './combat.js';

// Archetype table. Times in seconds, ranges in metres (centre-to-centre,
// same reachFor() scaling as normals). Cooldowns are sim-time seconds.
export const SPECIAL_ARCHETYPES = {
  powerPunch: {
    kind: 'powerPunch', animKind: 'punch',
    startup: 0.22, active: 0.10, recovery: 0.45,
    range: 2.1, baseDamage: 20, hitstun: 0.60, blockstun: 0.35,
    chip: 2, knockback: 0.40, cooldown: 6, guard: 'high',
    hitstop: 0.04, shake: 0.05,
    hits: 1, hitDamages: [20],
    vfx: 'burst', sound: 'specialPunch',
  },
  energyBlast: {
    kind: 'energyBlast', animKind: 'blast',
    startup: 0.30, active: 0.10, recovery: 0.50,
    range: 2.0, baseDamage: 20, hitstun: 0.60, blockstun: 0.35,
    chip: 2, knockback: 0.30, cooldown: 8, guard: 'mid',
    hitstop: 0.04, shake: 0.05,
    hits: 1, hitDamages: [20],
    vfx: 'projectile', sound: 'energyBlast',
    projectile: { speed: 8, maxRange: 6, radius: 0.9 },
  },
  specialKick: {
    kind: 'specialKick', animKind: 'kick',
    startup: 0.26, active: 0.12, recovery: 0.50,
    range: 2.8, baseDamage: 20, hitstun: 0.60, blockstun: 0.35,
    chip: 2, knockback: 0.45, cooldown: 7, guard: 'mid',
    hitstop: 0.06, shake: 0.08,
    hits: 1, hitDamages: [20],
    vfx: 'ring', sound: 'specialKick',
  },
  ultimate: {
    kind: 'ultimate', animKind: 'ultimate',
    startup: 0.40, active: 0.12, recovery: 0.60,
    range: 2.2, baseDamage: 20, hitstun: 0.70, blockstun: 0.40,
    chip: 2, knockback: 0.55, cooldown: 12, guard: 'high',
    hitstop: 0.06, shake: 0.08,
    hits: 1, hitDamages: [20],
    vfx: 'burstBig', sound: 'ultimate',
  },
};

// One signature special per fighter. `move` is the display name already
// in characters.js (specialMove); `archetype` is the mechanic it uses.
// Barrage overrides hits: 3 real hits of 7/7/6 (total 20).
export const FIGHTER_SPECIALS = {
  rishu: { move: 'Ember Rush', archetype: 'ultimate' },
  ayaan: {
    move: 'Storm Barrage', archetype: 'powerPunch',
    hits: 3, hitDamages: [7, 7, 6],
  },
  kabir: { move: 'Iron Counter', archetype: 'powerPunch', knockback: 0.55 },
  zara: { move: 'Shadow Step', archetype: 'energyBlast' },
  dev: { move: 'Forge Slam', archetype: 'powerPunch', knockback: 0.60 },
  meera: { move: 'Cyclone Kick', archetype: 'specialKick' },
};

// Full special def for a fighter id: archetype defaults + per-fighter
// overrides. Returns null for an unknown fighter (caller must handle).
// `attackId` is the id combat events carry ('special'); `id` stays the
// fighter id so callers can trace the def back to its owner.
export function specialFor(fighterId) {
  const entry = FIGHTER_SPECIALS[fighterId];
  if (!entry) return null;
  const base = SPECIAL_ARCHETYPES[entry.archetype];
  if (!base) return null;
  const { move, archetype, ...overrides } = entry;
  return { id: fighterId, attackId: 'special', move, archetype, ...base, ...overrides };
}

// Special damage — same formula as normals (see combat.js damageFor):
// round(base x (0.8+0.04*str) x (1.15-0.03*def) x comboScale).
// `hitIndex` selects the Barrage sub-hit (7/7/6); default is the single
// 20 (or the Barrage total when hitIndex is null — never used for damage).
export function specialDamageFor(def, hitIndex, attackerChar, defenderChar, comboScale = 1) {
  const base = def.hitDamages[hitIndex] ?? def.baseDamage;
  return damageFor({ baseDamage: base }, attackerChar, defenderChar, comboScale);
}

// Block chip for a special: 10% of the special's base, same stat
// factors as the normal chip path (combat.js receiveAttack).
export function specialChipFor(def, attackerChar, defenderChar) {
  return Math.max(0, Math.round(def.baseDamage * 0.10
    * (0.8 + 0.04 * (attackerChar?.strength ?? 7))
    * (1.15 - 0.03 * (defenderChar?.defense ?? 7))));
}

// Per-fighter cooldown state. `now` is SIM seconds (the arena's
// accumulated dt) — same clock as the combo window, so cooldowns run
// at game speed on slow devices and freeze while paused.
export function createSpecialController({ fighterId } = {}) {
  const def = specialFor(fighterId);
  let lastUsedAt = -Infinity;
  return {
    def,
    get move() { return def ? def.move : null; },
    get cooldown() { return def ? def.cooldown : 0; },
    isReady(now) {
      if (!def) return false;
      return (now - lastUsedAt) >= def.cooldown;
    },
    remaining(now) {
      if (!def) return 0;
      return Math.max(0, def.cooldown - (now - lastUsedAt));
    },
    // Fraction of the cooldown REMAINING (1 = just used, 0 = ready).
    // The HUD draws this as a depleting bar; 0 also means READY.
    cooldownFrac(now) {
      if (!def) return 0;
      return Math.min(1, Math.max(0, (def.cooldown - (now - lastUsedAt)) / def.cooldown));
    },
    // Attempt to use the special. On success the cooldown starts NOW —
    // even if the special then whiffs or is interrupted (used = used).
    tryUse(now) {
      if (!def) return { ok: false, reason: 'no-special' };
      if (!this.isReady(now)) {
        return { ok: false, reason: 'cooldown', remaining: this.remaining(now) };
      }
      lastUsedAt = now;
      return { ok: true, def };
    },
    reset() { lastUsedAt = -Infinity; },
  };
}
