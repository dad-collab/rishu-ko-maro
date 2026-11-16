// RISHU.COM — Fixed side-view camera (LIVE in the tree since the
// Tekken fixed-camera build, 2026-11-15). Tekken-3-style gameplay camera.
// Replaces BOTH the old follow + auto-zoom fight camera and
// the 3.2 s intro camera — the user decision 15:53 IST
// removes the intro entirely, so neither module has a remaining
// consumer after this lands.
//
// Design (see TEKKEN-CAMERA-PLAN.md for the full derivation):
// - ONE permanent pose, set once at match start, never touched again
//   during the match: position (0, 4.04, 12), lookAt (0, 2.35, 0),
//   elevation ~8.0 deg. No per-frame camera work at all.
// - RETUNE 2026-11-15 ~21:21 IST (user decision, option b): elevation
//   lowered from ~13.8 deg to ~8 deg and H raised from 2.3 to 2.51,
//   so fighters are FULLY VISIBLE everywhere — standing and jumping
//   at |z| <= 4.6. At 13.8 deg the Z-to-screen-Y coupling (0.24 m per
//   1 m of Z) pushed feet 0.45 m below the frame at the near edge and
//   the jump head-top 0.46 m above it at the far edge (verified by
//   execution in /tmp/tekken-retune.mjs). At 8 deg the coupling is
//   0.139 m per 1 m of Z; the worst cases are feet at the near edge
//   (screen-Y -2.413) and jump head-top at the far edge (+2.478), both
//   inside H = 2.51 with margin. Fighter size is ~47% of canvas
//   height on desktop and on landscape phones (was ~49%/48%) —
//   the size the user accepted for full framing.
// - ORTHOGRAPHIC projection (not perspective). The brief allows either;
//   perspective is PROVEN wrong here by the framing math: fighters roam
//   z in [-4.6, +4.6], so a perspective camera would render the near
//   fighter up to 18.8x larger than the far one (desktop aspect) and
//   the near ropes 0.5 m from the lens — while the brief demands
//   consistent character scale. Ortho gives identical scale at every
//   depth by construction.
// - Frustum is sized ONCE at match start from the live aspect ratio:
//   half-height H = max(2.51, 5.25 / aspect), half-width = H * aspect.
//   That frames the full playable width (x +/-4.6 + body + margin =
//   10.5 m) and the full jump (feet 0.56, head top at apex ~4.21 m)
//   at every Z in [-4.6, +4.6] on every aspect. On RESIZE during a
//   match only the frustum is recomputed — the camera position/rotation
//   NEVER move, so the "fixed position" rule survives a phone rotation.
// - getForward() returns the CONSTANT (0, 0, -1). Movement stays
//   camera-relative through the same getCameraForward hook, but with a
//   fixed camera the forward vector is constant, so movement degrades
//   gracefully to fixed-axis movement: D = screen-right / advance,
//   A = screen-left / retreat, W/S = sidestep in depth. No movement.js
//   change is needed (verified in TEKKEN-CAMERA-AUDIT.md §5).
// - Heavy-hit shake (user decision 2026-11-16 ~12:54 IST): SUBTLE, heavy
//   hits only. addShake(amount) takes the peak horizontal offset in
//   metres (0.05 heavyPunch, 0.08 heavyKick, from the combat table);
//   the visible offset is trauma^2 x [0.08 m horizontal, 0.02 m
//   vertical] at 12 Hz, decaying linearly to exactly 0 in <= 0.35 s.
//   Position is recomputed from FIXED_POSE every frame (never
//   integrated), so the camera returns to the EXACT pose — zero drift.
//   Position only: no lookAt/rotation, so getForward() stays (0, 0, -1).
//   No shake on light attacks, movement, jumps, blocks, dodges, idle,
//   or while paused. No drag, no pinch, no zoom, no tracking.
// - MOBILE (update 16:05 IST — user requirement): fights run in
//   LANDSCAPE on phones (rotate prompt gates arena entry); portrait
//   is not a fight orientation. The 17% portrait figure from the
//   first audit is superseded — see TEKKEN-CAMERA-PLAN.md §6. This
//   module needs no pose change for it: engage() takes the live
//   aspect, which is ~2.2 in landscape.

import * as THREE from 'three';

// Permanent pose: P1 (x=-1.6) on screen LEFT, P2 on screen RIGHT.
// Camera on +Z (the game's "front" — same side as the hero preview
// camera at (0, 1.7, 4.6)); looking toward -Z, screen-right is +X.
// Elevation: atan((4.04 - 2.35) / 12) = ~8.0 deg.
export const FIXED_POSE = {
  position: [0, 4.04, 12.0],
  target: [0, 2.35, 0],
};
// Frame content (world metres): half-width 5.25 covers x +/-4.6 (rope
// line) + fighter half-width 0.35 + 0.3 margin; half-height 2.51 covers
// y [-0.16, 4.86] at z=0 and, with the ~8 deg elevation, the full
// Z-extreme span: feet at the near edge (screen-Y -2.413) and jump
// head-top at the far edge (+2.478) — see the retune note above.
export const FRAME_HALF_WIDTH = 5.25;
export const FRAME_HALF_HEIGHT = 2.51;

export function computeHalfHeight(aspect) {
  const a = aspect && aspect > 0.2 ? aspect : 1;
  return Math.max(FRAME_HALF_HEIGHT, FRAME_HALF_WIDTH / a);
}

export const FIGHTER_HEIGHT = 2.35;

// Fighter height as a fraction of canvas height at an aspect — the
// mobile-size metric (PLAN §6): desktop 2.2 -> 0.47, phone landscape
// 2.16 -> 0.47, portrait 0.75 -> 0.17 (formula check only; portrait
// is gated, never fought). Retune 21:21 IST: 0.49/0.48 -> 0.47/0.47.
export function fighterScreenFraction(aspect) {
  return FIGHTER_HEIGHT / (2 * computeHalfHeight(aspect));
}

export function createFixedCamera() {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  const _target = new THREE.Vector3(
    FIXED_POSE.target[0], FIXED_POSE.target[1], FIXED_POSE.target[2],
  );
  const _forward = new THREE.Vector3(0, 0, -1);
  let active = false;

  // Heavy-hit shake (user decision 12:54 IST) — SUBTLE, heavy hits only.
  // addShake(amount): amount = PEAK HORIZONTAL OFFSET IN METRES, clamped
  // [0, SHAKE_MAX_AMP]. Trauma is the normalized envelope (amount / 0.08);
  // the visible offset is trauma^2 x [0.08 m horizontal, 0.02 m vertical]
  // at 12 Hz, decaying linearly to exactly 0 in <= 0.35 s. Position is
  // RECOMPUTED from FIXED_POSE every frame (never integrated), so the
  // camera returns to the EXACT pose — zero drift by construction.
  // Position only: no lookAt/target/rotation, so getForward() stays
  // (0, 0, -1) and movement is untouched.
  const SHAKE_MAX_AMP = 0.08;    // m, horizontal peak (Phase 4 bound, AUDIT §3.2)
  const SHAKE_VERT_RATIO = 0.25; // vertical peak = 0.25 x horizontal (<= 0.02 m)
  const SHAKE_FREQ = 12;         // Hz
  const SHAKE_DECAY = 0.35;      // s, linear trauma -> 0
  let trauma = 0;                // 0..1, normalized envelope
  let shakeT = 0;                // s since shake (re)start
  let _base = null;              // THREE.Vector3, set in engage()
  let _right = null, _up = null; // cached screen-aligned unit vectors

  function applyFrustum(aspect) {
    const h = computeHalfHeight(aspect);
    camera.left = -h * aspect;
    camera.right = h * aspect;
    camera.top = h;
    camera.bottom = -h;
    camera.updateProjectionMatrix();
  }

  return {
    getCamera: () => camera,
    // Constant forward: the movement controller's getCameraForward hook.
    // With a fixed camera this never changes, so WASD/arrows map to
    // fixed screen axes for the whole match.
    getForward(out) { return out.copy(_forward); },
    isActive: () => active,
    // Set the pose ONCE. Called from arena beginMatch() (replacing the
    // old intro start + fight-camera start).
    engage(aspect) {
      camera.position.set(FIXED_POSE.position[0], FIXED_POSE.position[1], FIXED_POSE.position[2]);
      camera.lookAt(_target);
      applyFrustum(aspect);
      active = true;
      // Heavy-hit shake: fresh state per match; the axes are
      // screen-aligned by construction (taken from the camera matrix
      // after lookAt, not hand-derived).
      trauma = 0; shakeT = 0;
      _base = camera.position.clone();
      camera.updateMatrixWorld(true);
      _right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      _up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    },
    // Resize only re-sizes the frustum. Position/rotation are untouched.
    resize(aspect) {
      if (active) applyFrustum(aspect);
    },
    disengage() {
      // A mid-shake stop leaves the exact pose behind.
      trauma = 0; shakeT = 0;
      if (_base) camera.position.copy(_base);
      active = false;
    },
    dispose() {
      active = false;
    },
    // Heavy-hit shake: amount = peak horizontal offset in METRES
    // (0.05 heavyPunch, 0.08 heavyKick from the combat table). A bigger
    // hit restarts the phase; a smaller hit never shrinks the running
    // shake. No-op when the camera is not engaged.
    addShake(amount) {
      if (!active) return;
      const a = Math.min(Math.max(amount || 0, 0), SHAKE_MAX_AMP);
      const t = a / SHAKE_MAX_AMP;
      if (t > trauma) { trauma = t; shakeT = 0; }
    },
    // Advances the shake by dt (sim seconds). Position is recomputed
    // from the fixed pose every frame; when trauma reaches 0 the offset
    // is exactly 0, so the position is bit-identical to FIXED_POSE.
    // No-op when inactive or when trauma is 0.
    update(dt) {
      if (!active || trauma <= 0) return;
      shakeT += dt;
      trauma = Math.max(0, trauma - dt / SHAKE_DECAY);
      const env = trauma * trauma;
      const w = 2 * Math.PI * SHAKE_FREQ * shakeT;
      const ox = env * SHAKE_MAX_AMP * Math.sin(w);
      const oy = env * SHAKE_MAX_AMP * SHAKE_VERT_RATIO * Math.sin(w + Math.PI / 2);
      camera.position.copy(_base).addScaledVector(_right, ox).addScaledVector(_up, oy);
    },
    getTrauma: () => trauma,
  };
}
