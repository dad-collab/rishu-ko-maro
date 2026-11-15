// RISHU.COM — Phase 3 — camera.js
// Third-person fighting camera. Wraps the arena's existing OrbitControls:
//   'orbit' mode = today's behaviour (free orbit, auto-rotate) — used on
//     the menu / character select and after a match ends.
//   'fight' mode = both fighters framed: camera sits on a smoothed orbit
//     around the fighters' midpoint, distance auto-scales with their
//     separation, fighters stay centred, no clipping through the floor or
//     the arena wall. The player may still drag to adjust the angle and
//     pinch to adjust distance; OrbitControls is disabled while fighting
//     so the two systems never fight over camera.position.
//
// No new renderer, no new canvas: this drives the arena's own camera.

import * as THREE from 'three';

const MIN_DIST = 6.5;
const MAX_DIST = 13;
const BASE_DIST = 6.2;
const DIST_PER_SEPARATION = 0.85;
const LOOK_HEIGHT = 1.3;
const DEFAULT_ELEVATION = 0.32; // ~18 degrees above the ring
const SMOOTH = 4.5; // position lerp rate (1/s); 1 = snap (reduced motion)
const WALL_LIMIT = 18.5; // camera never leaves the hall (wall radius 20)

const _mid = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _fwd = new THREE.Vector3();

export function createFightCamera({ camera, controls, domElement, getFighterA, getFighterB }) {
  let mode = 'orbit';
  let azimuth = 0; // radians around the midpoint; captured at fight start
  let elevation = DEFAULT_ELEVATION;
  let distOffset = 0; // pinch adjustment, clamped [-1.5, +1.5]
  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pointers = new Map();
  let pinchStart = 0;
  // Phase 4 — camera shake (trauma): heavy hits only, fight mode only.
  // Deterministic sine wobble (no Math.random) — amplitude ≤ 0.08 m,
  // decays over ~0.25 s. Never touches azimuth/elevation/dist math.
  let trauma = 0;
  let shakeTime = 0;

  function midpoint(out) {
    getFighterA(_a);
    getFighterB(_b);
    out.copy(_a).add(_b).multiplyScalar(0.5);
    return out;
  }

  function onPointerDown(e) {
    if (mode !== 'fight') return;
    domElement.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [p1, p2] = [...pointers.values()];
      pinchStart = Math.hypot(p1.x - p2.x, p1.y - p2.y);
    }
  }
  function onPointerMove(e) {
    if (mode !== 'fight') return;
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    if (pointers.size === 1) {
      // Drag adjusts the viewing angle; the midpoint stays centred.
      azimuth -= (e.clientX - prev.x) * 0.005;
      elevation = Math.max(0.12, Math.min(0.9, elevation + (e.clientY - prev.y) * 0.004));
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    } else if (pointers.size === 2) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const [p1, p2] = [...pointers.values()];
      const pinchNow = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      if (pinchStart > 0) {
        // Pinch out = closer; pinch in = farther. Small, clamped range.
        distOffset = Math.max(-1.5, Math.min(1.5, distOffset - (pinchNow - pinchStart) * 0.01));
      }
      pinchStart = pinchNow;
    }
  }
  function onPointerEnd(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = 0;
  }

  function startFight() {
    midpoint(_mid);
    // Capture the current viewing angle so the switch is a smooth
    // reframe, not a snap to a fixed angle.
    const dx = camera.position.x - _mid.x;
    const dz = camera.position.z - _mid.z;
    const dy = camera.position.y - (_mid.y + LOOK_HEIGHT);
    const dist = Math.max(MIN_DIST, Math.min(MAX_DIST, Math.hypot(dx, dy, dz)));
    azimuth = Math.atan2(dx, dz);
    elevation = Math.max(0.12, Math.min(0.9, Math.asin(Math.max(-1, Math.min(1, dy / dist)))));
    distOffset = 0;
    mode = 'fight';
    if (controls) {
      controls.enabled = false; // OrbitControls must not move the camera now
      controls.autoRotate = false;
    }
  }

  function stopFight() {
    mode = 'orbit';
    if (controls) {
      controls.target.set(0, 1.2, 0); // back to the arena centre
      controls.enabled = true;
      controls.autoRotate = true;
    }
  }

  function update(dt) {
    if (mode !== 'fight') return;
    midpoint(_mid);
    getFighterA(_a);
    getFighterB(_b);
    const separation = Math.hypot(_b.x - _a.x, _b.z - _a.z);
    const dist = Math.max(
      MIN_DIST,
      Math.min(MAX_DIST, BASE_DIST + separation * DIST_PER_SEPARATION + distOffset),
    );
    const cosEl = Math.cos(elevation);
    _desired.set(
      _mid.x + Math.sin(azimuth) * cosEl * dist,
      _mid.y + LOOK_HEIGHT + Math.sin(elevation) * dist,
      _mid.z + Math.cos(azimuth) * cosEl * dist,
    );
    // No clipping: never below the ring, never outside the hall.
    _desired.y = Math.max(1.0, _desired.y);
    const hr = Math.hypot(_desired.x, _desired.z);
    if (hr > WALL_LIMIT) {
      const s = WALL_LIMIT / hr;
      _desired.x *= s;
      _desired.z *= s;
    }
    const k = reducedMotion ? 1 : 1 - Math.exp(-SMOOTH * dt);
    camera.position.lerp(_desired, k);
    camera.lookAt(_mid.x, _mid.y + LOOK_HEIGHT, _mid.z);
    // Shake: a transient offset on top of the framed pose. Applied
    // after lookAt so the view direction jolts, then the next frame's
    // lerp pulls the camera back — the offset never accumulates.
    if (trauma > 0) {
      shakeTime += dt;
      const amp = trauma * trauma * 0.08;
      camera.position.x += Math.sin(shakeTime * 47.3) * amp;
      camera.position.y += Math.cos(shakeTime * 39.1) * amp * 0.7;
      trauma = Math.max(0, trauma - dt / 0.25);
    }
  }

  // Camera forward on the XZ plane, for camera-relative movement input.
  function getForward(out) {
    midpoint(_mid);
    out.copy(_mid).sub(camera.position);
    out.y = 0;
    if (out.lengthSq() < 0.001) out.set(0, 0, -1);
    return out.normalize();
  }

  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerup', onPointerEnd);
  domElement.addEventListener('pointercancel', onPointerEnd);

  return {
    startFight,
    stopFight,
    update,
    getForward,
    getMode: () => mode,
    // Phase 4 — add camera trauma (0..1, clamped). No-op unless the
    // camera is in fight mode, so shake can never fire during the
    // cinematic intro (the arena routes the camera exclusively).
    addShake(amount) {
      if (mode !== 'fight') return;
      trauma = Math.max(0, Math.min(1, trauma + (amount || 0)));
    },
    getTrauma: () => trauma,
    dispose() {
      domElement.removeEventListener('pointerdown', onPointerDown);
      domElement.removeEventListener('pointermove', onPointerMove);
      domElement.removeEventListener('pointerup', onPointerEnd);
      domElement.removeEventListener('pointercancel', onPointerEnd);
      if (mode === 'fight') stopFight();
    },
  };
}
