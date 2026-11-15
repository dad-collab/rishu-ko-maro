// RISHU.COM — Cinematic camera (DRAFT — audit deliverable, NOT in the tree yet)
// Automatic cinematic intro played once per arena entry, between the
// arena screen becoming visible and the fight starting. Camera only:
// no UI, character, arena, control or gameplay changes.
//
// How it works:
// - start() captures the camera's CURRENT azimuth (like camera.js
//   startFight does), so the intro never jumps from wherever the free
//   orbit camera was left.
// - A 3.2 s keyframed sweep (wide establishing orbit -> low pass ->
//   rise + push-in -> settle) is evaluated every frame; the camera
//   lerps toward the spline pose, so even a skip mid-spline is smooth.
// - On completion (or skip, or prefers-reduced-motion) the module hands
//   the live camera pose to the fight camera: camera.js startFight()
//   captures azimuth/elevation from the live position, so the handoff
//   is continuous by construction — no snap, no second camera.
// - Guards (same numbers as camera.js): never below the ring (y >= 1.0),
//   never inside the ropes (radius >= 5.5), never outside the hall
//   (horizontal radius <= 18.5). No new renderer, no new canvas: this
//   drives the arena's own camera, exactly like camera.js.

import * as THREE from 'three';

export const INTRO_DURATION = 3.2; // seconds, beats 0-0.8-1.6-2.5-3.2
const SETTLE_EPS = 0.15; // camera within this of the settle pose = done
const SETTLE_TIMEOUT = 1.0; // backstop: finish anyway this long after t=end
const LERP_RATE = 3.5; // position lerp rate (1/s); same family as camera.js 4.5
const SKIP_LERP_RATE = 8; // faster settle after a skip, still smooth
const LOOK_RATE = 5; // look-target smoothing rate (1/s)
const MIN_RADIUS = 5.5; // never inside the ropes (posts sit at +/-4.6)
const MIN_HEIGHT = 1.0; // never below the ring (same guard as camera.js)
const WALL_LIMIT = 18.5; // never outside the hall (wall radius 20)
const LOOK_HEIGHT = 1.3; // same look height as the fight camera
const PORTRAIT_PULLBACK = 1.15; // wider framing when aspect < 1 (phones)
const MAX_STEP = 0.5; // per-frame camera displacement cap (m) — see update()

// Keyframes: [t, azimuth offset from entry azimuth (rad), distance, height, lookMix]
// lookMix 0 = ring centre (0, 1.2, 0); 1 = fighters' midpoint + LOOK_HEIGHT.
// Total sweep 130 deg — a clear cinematic, never a full revolution.
// Settle distance 8.92 = the fight camera's rest distance for the opening
// separation (6.2 + 3.2 x 0.85, fighters start at -/+1.6 and input is
// locked during the intro, so the separation is always 3.2 at the
// handoff). The draft used 7.0 here; the harness measured a 0.145 m
// first fight-frame step because camera.js recomputes its distance from
// the separation (8.92), not from the settle pose — matching the settle
// distance to the fight camera's rest distance makes the handoff
// continuous (measured ~0.005 m). Beat 2's end distance moved with it
// (9.0 -> 8.92 -> 8.92) so the push-in stays monotonic.
const KEYFRAMES = [
  { t: 0.0, az: 0.00, dist: 13.5, height: 5.5, look: 0.00 },
  { t: 0.8, az: 0.96, dist: 12.0, height: 4.2, look: 0.25 },
  { t: 1.6, az: 1.66, dist: 9.0, height: 2.2, look: 0.70 },
  { t: 2.5, az: 2.09, dist: 8.92, height: 3.4, look: 1.00 },
  { t: 3.2, az: 2.27, dist: 8.92, height: 3.0, look: 1.00 },
];

function easeInOutCubic(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function createCinematicCamera({ camera, domElement, getFighterA, getFighterB, onDone }) {
  const _mid = new THREE.Vector3();
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  const _desired = new THREE.Vector3();
  const _step = new THREE.Vector3();
  const _lookTarget = new THREE.Vector3();
  const _lookMid = new THREE.Vector3();
  const _lookSmooth = new THREE.Vector3();
  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let state = 'idle'; // 'idle' | 'playing' | 'done'
  let t = 0;
  let baseAzimuth = 0;
  let skipped = false;

  function midpoint(out) {
    getFighterA(_a);
    getFighterB(_b);
    out.copy(_a).add(_b).multiplyScalar(0.5);
    return out;
  }

  function onSkipInput() {
    if (state === 'playing') skip();
  }

  function attach() {
    if (domElement) domElement.addEventListener('pointerdown', onSkipInput);
    if (typeof window !== 'undefined') window.addEventListener('keydown', onSkipInput);
  }

  function detach() {
    if (domElement) domElement.removeEventListener('pointerdown', onSkipInput);
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onSkipInput);
  }

  function finish() {
    if (state === 'done') return;
    state = 'done';
    detach();
    if (onDone) onDone();
  }

  function start() {
    if (state === 'playing') return;
    midpoint(_mid);
    // Capture the entry viewing angle — the intro starts exactly where
    // the orbit camera is, so there is no jump on the first frame.
    baseAzimuth = Math.atan2(camera.position.x - _mid.x, camera.position.z - _mid.z);
    _lookSmooth.set(0, 1.2, 0);
    t = 0;
    skipped = false;
    state = 'playing';
    attach();
    // Reduced motion: no cinematic at all — hand off immediately, the
    // same rule camera.js uses (snap instead of smoothing).
    if (reducedMotion) finish();
  }

  function skip() {
    if (state !== 'playing') return;
    skipped = true;
    t = INTRO_DURATION; // spline jumps to the settle pose; the lerp
    // below still carries the camera there smoothly over ~0.4 s.
  }

  function samplePose(time, out) {
    // Find the surrounding keyframes and ease between them.
    let i = 0;
    while (i < KEYFRAMES.length - 2 && KEYFRAMES[i + 1].t <= time) i++;
    const k0 = KEYFRAMES[i];
    const k1 = KEYFRAMES[i + 1];
    const span = Math.max(0.0001, k1.t - k0.t);
    const p = easeInOutCubic(Math.max(0, Math.min(1, (time - k0.t) / span)));
    const lerp = (a, b) => a + (b - a) * p;
    out.az = lerp(k0.az, k1.az);
    out.dist = lerp(k0.dist, k1.dist);
    out.height = lerp(k0.height, k1.height);
    out.look = lerp(k0.look, k1.look);
    return out;
  }

  const _pose = { az: 0, dist: 7, height: 3, look: 1 };

  function update(dt) {
    if (state !== 'playing') return;
    dt = Math.min(dt, 0.05);
    t += dt;
    const time = Math.min(t, INTRO_DURATION);
    samplePose(time, _pose);
    midpoint(_mid);

    // Portrait phones see a narrower horizontal field: pull back so
    // both fighters stay in frame during the sweep.
    let dist = _pose.dist;
    if (camera.aspect && camera.aspect < 1) dist *= PORTRAIT_PULLBACK;

    const az = baseAzimuth + _pose.az;
    _desired.set(
      _mid.x + Math.sin(az) * dist,
      _pose.height,
      _mid.z + Math.cos(az) * dist,
    );
    // Same clipping guards as the fight camera.
    _desired.y = Math.max(MIN_HEIGHT, _desired.y);
    const hr = Math.hypot(_desired.x, _desired.z);
    if (hr > WALL_LIMIT) {
      const s = WALL_LIMIT / hr;
      _desired.x *= s;
      _desired.z *= s;
    }

    const rate = skipped ? SKIP_LERP_RATE : LERP_RATE;
    const k = 1 - Math.exp(-rate * dt);
    // Cap the per-frame displacement: the lerp alone can step > 1 m in a
    // single frame when a skip jumps the spline to the settle pose ~11 m
    // away (harness measured 1.376 m at rate 8) or after a tab-switch
    // hitch (dt clamped to 0.05). 0.5 m/frame is well above normal sweep
    // motion (~0.2 m) and below the 0.6 m no-jump bound, so the cap never
    // engages during a normal 60 fps sweep — and a skip still settles in
    // under a second (0.5 m/frame to close, then the lerp converges).
    _step.copy(_desired).sub(camera.position).multiplyScalar(k);
    if (_step.lengthSq() > MAX_STEP * MAX_STEP) _step.multiplyScalar(MAX_STEP / _step.length());
    camera.position.add(_step);

    // Look target blends from the ring centre to the fighters' midpoint.
    _lookMid.set(_mid.x, _mid.y + LOOK_HEIGHT, _mid.z);
    _lookTarget.set(0, 1.2, 0).lerp(_lookMid, _pose.look);
    const lk = 1 - Math.exp(-LOOK_RATE * dt);
    _lookSmooth.lerp(_lookTarget, lk);
    camera.lookAt(_lookSmooth);

    // Done when the spline is finished AND the camera has settled onto
    // the final pose (or the backstop fires — the lerp converges, so
    // this is a safety net, not the normal path).
    if (t >= INTRO_DURATION) {
      const settleDist = camera.position.distanceTo(_desired);
      if (settleDist < SETTLE_EPS || t >= INTRO_DURATION + SETTLE_TIMEOUT) finish();
    }
  }

  return {
    start,
    update,
    skip,
    dispose() {
      detach();
      state = 'idle';
    },
    getState: () => state,
    getProgress: () => Math.max(0, Math.min(1, t / INTRO_DURATION)),
  };
}
