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
// - No shake, no drag, no pinch, no zoom, no tracking: this module has
//   no update() at all. Phase 4's shake (the old fight camera's trauma
//   wobble + the one arena.js call site) is deleted with those files,
//   not worked around.
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
    },
    // Resize only re-sizes the frustum. Position/rotation are untouched.
    resize(aspect) {
      if (active) applyFrustum(aspect);
    },
    disengage() {
      active = false;
    },
    dispose() {
      active = false;
    },
  };
}
