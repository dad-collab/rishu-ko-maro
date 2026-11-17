// RISHU.COM — Phase 5 DRAFT — rounds.js
// Best-of-3 round + match state machine. Pure logic — no DOM, no
// three, no randomness. Draft only: the build copies this into js/
// and wires it into arena.js (onKo -> recordRoundWin) and hud.js
// (round pips, round banner, winner screen).
//
// Design (see ROUNDS-DESIGN.md):
// - Best-of-3, first to 2 round wins. The brief's §6 ("when HP hits
//   zero, declare the opponent the winner") is the ROUND rule; §7's
//   "Round information" + the roadmap's "best-of rounds"
//   (index.html:502) make best-of-3 the format. Single-round was
//   rejected: it would make the §7 round UI meaningless.
// - A round ends on KO only (the timer counts UP per round; there is
//   no timeout). Double KO is impossible: only the defender takes
//   damage in receiveAttack, so exactly one fighter can hit 0 per hit.
// - Phases: 'fight' -> 'roundEnd' (KO, 1.0 s freeze while the fall
//   plays) -> 'intro' (next round banner, 1.2 s, input frozen) ->
//   'fight' ... -> 'matchEnd' (a fighter reaches 2 round wins).
//   The arena owns the phase TIMERS (sim time); this module owns the
//   SCORE and the transitions between them.
// - Rematch resets everything: round wins, round number, cooldowns
//   (via the specials controllers), combo, timer, positions.

export const BEST_OF = 3;
export const WINS_TO_TAKE = Math.ceil(BEST_OF / 2); // 2
export const ROUND_END_PAUSE = 1.0; // s the KO fall plays before the banner
export const ROUND_INTRO_TIME = 1.2; // s the ROUND n / FIGHT banner shows

export function createRoundSystem({ bestOf = BEST_OF } = {}) {
  const winsToTake = Math.ceil(bestOf / 2);
  let round = 1;
  let wins = { A: 0, B: 0 };
  let phase = 'fight'; // 'fight' | 'roundEnd' | 'intro' | 'matchEnd'
  let roundWinner = null;
  let matchWinner = null;

  return {
    get round() { return round; },
    get wins() { return { ...wins }; },
    get phase() { return phase; },
    get roundWinner() { return roundWinner; },
    get matchWinner() { return matchWinner; },
    get winsToTake() { return winsToTake; },

    // Called by the arena when a KO lands (winnerId 'A' | 'B').
    // Returns { roundWinner, matchWinner (null until the match is
    // decided), score: {A, B}, matchOver: boolean }.
    // Calls after matchEnd are ignored (the winner screen owns the
    // match by then — a late KO event must never rewrite the score).
    recordRoundWin(winnerId) {
      if (phase === 'matchEnd') {
        return { roundWinner, matchWinner, score: { ...wins }, matchOver: true };
      }
      if (winnerId !== 'A' && winnerId !== 'B') {
        return { roundWinner, matchWinner, score: { ...wins }, matchOver: false };
      }
      wins[winnerId] += 1;
      roundWinner = winnerId;
      if (wins[winnerId] >= winsToTake) {
        matchWinner = winnerId;
        phase = 'matchEnd';
        return { roundWinner, matchWinner, score: { ...wins }, matchOver: true };
      }
      phase = 'roundEnd';
      return { roundWinner, matchWinner: null, score: { ...wins }, matchOver: false };
    },

    // The arena calls this after ROUND_END_PAUSE: the round is over,
    // the next round's intro starts. (The last round never reaches
    // here — matchEnd has no next round.)
    beginNextRoundIntro() {
      if (phase !== 'roundEnd') return false;
      round += 1;
      roundWinner = null;
      phase = 'intro';
      return true;
    },

    // The arena calls this after ROUND_INTRO_TIME: the fight resumes.
    beginFight() {
      if (phase !== 'intro') return false;
      phase = 'fight';
      return true;
    },

    // Full match reset (Rematch button + new match start): score,
    // round number and phases all go back to round 1.
    resetMatch() {
      round = 1;
      wins = { A: 0, B: 0 };
      phase = 'fight';
      roundWinner = null;
      matchWinner = null;
    },
  };
}
