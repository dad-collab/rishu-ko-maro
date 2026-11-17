// RISHU.COM — Phase 4 — combatAudio.js
// Impact sounds, synthesised with WebAudio — zero audio files in the
// repo (see COMBAT-DESIGN.md §10 for the decision). Every sound is a
// short burst of filtered noise and/or a pitched thump; nothing is
// recorded, nothing is fetched, nothing is licensed.
//
// Safety rules:
// - The AudioContext is created LAZILY on the first play() call (a user
//   gesture — keypress/tap — so the autoplay policy allows it).
// - If AudioContext is absent (jsdom, old browsers), every call is a
//   silent no-op. Audio must NEVER throw — a sound failure must not
//   break a match.
// - Respects the Settings sound toggle: `enabled: false` silences
//   everything (the arena passes settings.sound at createArena time).
// - No sound lasts longer than ~0.35 s; no loops; master gain is low
//   (0.5) so a flurry of hits never clips.

const PROFILES = {
  punchLight: { type: 'thud', freq: 180, dur: 0.09, gain: 0.5, noise: 0.4 },
  punchHeavy: { type: 'thud', freq: 110, dur: 0.16, gain: 0.7, noise: 0.5 },
  kick: { type: 'thud', freq: 150, dur: 0.12, gain: 0.6, noise: 0.55 },
  kickHeavy: { type: 'thud', freq: 85, dur: 0.22, gain: 0.8, noise: 0.6 },
  block: { type: 'click', freq: 900, dur: 0.05, gain: 0.35, noise: 0.3 },
  whiff: { type: 'whoosh', freq: 1200, dur: 0.14, gain: 0.25, noise: 0.9 },
  dodge: { type: 'whoosh', freq: 800, dur: 0.18, gain: 0.2, noise: 0.8 },
  ko: { type: 'thud', freq: 60, dur: 0.35, gain: 0.9, noise: 0.7 },
  // Phase 5 — one sound per special archetype (specials.js `sound`).
  // specialPunch: low thud (power-punch specials, incl. Barrage).
  // specialKick: whoosh + thud (the thud type already layers noise).
  // energyBlast: rising sine sweep 300 → 1200 Hz + noise (new 'sweep'
  // type). ultimate: layered deep thud + shimmer (0.35 s, the longest
  // special sound — the 12 s cooldown earns the biggest noise).
  specialPunch: { type: 'thud', freq: 70, dur: 0.25, gain: 0.7, noise: 0.5 },
  specialKick: { type: 'thud', freq: 120, dur: 0.2, gain: 0.75, noise: 0.7 },
  energyBlast: { type: 'sweep', freq: 300, freq2: 1200, dur: 0.3, gain: 0.55, noise: 0.5 },
  ultimate: { type: 'thud', freq: 100, dur: 0.35, gain: 0.85, noise: 0.6 },
};

export function createCombatAudio({ enabled = true } = {}) {
  let ctx = null;
  let on = !!enabled;

  function ensureCtx() {
    if (ctx) return ctx;
    const AC = typeof window !== 'undefined'
      && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch (e) {
      ctx = null;
    }
    return ctx;
  }

  function playThud(p) {
    // Pitched sine drop (the "thump") + a burst of lowpassed noise (the "crack").
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(p.freq * 1.6, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, p.freq * 0.6), t0 + p.dur);
    oscGain.gain.setValueAtTime(p.gain, t0);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t0 + p.dur);
    osc.connect(oscGain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + p.dur + 0.02);
    playNoise(p, t0);
  }

  function playNoise(p, t0) {
    // White-noise texture for the "crack"/"whoosh" — acoustic noise,
    // NOT gameplay randomness (damage never uses Math.random anywhere).
    const len = Math.max(1, Math.floor(ctx.sampleRate * p.dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = p.type === 'whoosh' ? 'bandpass' : 'lowpass';
    filter.frequency.value = p.freq * 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(p.gain * p.noise * 0.6, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + p.dur);
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start(t0);
  }

  function playSweep(p) {
    // Rising sine sweep (the "energy charge") + a noise burst.
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(p.freq, t0);
    osc.frequency.linearRampToValueAtTime(p.freq2 || p.freq * 2, t0 + p.dur);
    oscGain.gain.setValueAtTime(p.gain, t0);
    oscGain.gain.exponentialRampToValueAtTime(0.001, t0 + p.dur);
    osc.connect(oscGain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + p.dur + 0.02);
    playNoise(p, t0);
  }

  return {
    play(name) {
      if (!on) return;
      const p = PROFILES[name];
      if (!p) return;
      if (!ensureCtx()) return;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      try {
        if (p.type === 'whoosh') playNoise(p, ctx.currentTime);
        else if (p.type === 'sweep') playSweep(p);
        else playThud(p);
      } catch (e) {
        // Audio must never break a match.
      }
    },
    setEnabled(v) { on = !!v; },
    isEnabled: () => on,
    dispose() {
      if (ctx) ctx.close().catch(() => {});
      ctx = null;
    },
  };
}
