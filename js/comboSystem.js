// RISHU.COM — Phase 4 — comboSystem.js
// Combo system: chains, chain-window buffering, combo counter, damage
// scaling. Pure logic — no DOM, no three, no randomness.
//
// Ownership: combat.js owns the per-fighter attack state; THIS module
// owns the two things that span attacks — (1) which attack may follow
// which (chains + the buffer window) and (2) the running combo count
// and its damage scale. The arena owns ONE tracker and feeds its
// events from combat.js ('hit' / 'blocked' / 'whiff' / 'attack-start').
// The combo count is per ATTACKER (each fighter has their own count;
// getting hit resets YOUR outgoing combo, not your opponent's).

export const COMBO_WINDOW = 1.2; // s between landed hits before the counter restarts
export const CHAIN_BUFFER = 0.35; // s after an attack ends to buffer the next input

// Universal chains (COMBAT-DESIGN.md §5) — same for all fighters.
export const CHAINS = {
  jabJabCross: ['lightPunch', 'lightPunch', 'heavyPunch'],
  jabKickRoundhouse: ['lightPunch', 'kick', 'heavyKick'],
  kickKickRoundhouse: ['kick', 'kick', 'heavyKick'],
};

// Damage scale by combo position (COMBAT-DESIGN.md §5).
export function comboScale(count) {
  if (count <= 2) return 1.0;
  if (count <= 4) return 0.9;
  return 0.8;
}

// Is `next` a legal follow-up to the attack sequence `history`
// (array of attack ids, most recent last)? A follow-up is legal if it
// continues any chain prefix, or if it starts a new chain (any attack
// may start a chain — the chain rule only gates BUFFERED inputs, i.e.
// inputs pressed during recovery; a fresh attack after recovery is
// always legal and starts a new chain).
export function isChainFollowUp(history, next) {
  const seq = [...history, next];
  for (const chain of Object.values(CHAINS)) {
    for (let start = 0; start < seq.length; start++) {
      const slice = seq.slice(start);
      if (slice.length > chain.length) continue;
      let ok = true;
      for (let i = 0; i < slice.length; i++) {
        if (slice[i] !== chain[i]) { ok = false; break; }
      }
      if (ok) return true;
    }
  }
  return false;
}

export function createComboTracker() {
  // Per-fighter combo state, keyed by an arena-supplied id ('A'/'B').
  const fighters = new Map();
  // ONE buffered attack per fighter (a newer input overwrites — never queues two).
  const buffers = new Map();

  function stateFor(id) {
    if (!fighters.has(id)) fighters.set(id, { count: 0, lastHitAt: -Infinity, history: [] });
    return fighters.get(id);
  }

  return {
    // A hit landed. `now` is seconds of SIM time (the arena's
    // accumulated dt) — the combo window is measured in-game, so it
    // cannot expire between landed hits on a slow device. Returns the
    // new count.
    recordHit(id, attackId, now) {
      const s = stateFor(id);
      s.count = (now - s.lastHitAt <= COMBO_WINDOW) ? s.count + 1 : 1;
      s.lastHitAt = now;
      s.history.push(attackId);
      if (s.history.length > 8) s.history.shift();
      return s.count;
    },
    // A whiff breaks the CHAIN (next attack starts a new chain) but
    // does not erase the displayed count until the 1.2 s gap expires.
    recordWhiff(id) {
      const s = stateFor(id);
      s.history = [];
    },
    // Getting hit / blocking / dodging resets YOUR outgoing combo.
    recordInterrupted(id) {
      const s = stateFor(id);
      s.count = 0;
      s.history = [];
    },
    getCount(id) {
      const s = stateFor(id);
      return s.count;
    },
    getScale(id) {
      return comboScale(stateFor(id).count);
    },
    // Damage scale for the NEXT hit this fighter lands. The damage is
    // computed in receiveAttack BEFORE the tracker's recordHit runs, so
    // the scale must be for count+1 (hit #3 is ×0.9, hit #5 is ×0.8).
    getScaleForNext(id) {
      return comboScale(stateFor(id).count + 1);
    },
    // Drop a stale combo: if the last landed hit is older than the
    // window, the displayed count and the scale both reset. The arena
    // calls this every frame for both fighters (cheap).
    expire(id, now) {
      const s = stateFor(id);
      if (s.count > 0 && now - s.lastHitAt > COMBO_WINDOW) {
        s.count = 0;
        s.history = [];
      }
    },
    // Buffered chain input: hold exactly one; newer overwrites older.
    bufferInput(id, attackId, now) {
      buffers.set(id, { attackId, expiresAt: now + CHAIN_BUFFER });
    },
    consumeBuffered(id, now) {
      const b = buffers.get(id);
      if (!b) return null;
      buffers.delete(id);
      return b.expiresAt >= now ? b.attackId : null;
    },
    clearBuffer(id) {
      buffers.delete(id);
    },
    reset() {
      fighters.clear();
      buffers.clear();
    },
  };
}
