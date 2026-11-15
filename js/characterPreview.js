// RISHU.COM — Phase 2 — characterPreview.js
// Large 3D character preview: its own small Three.js scene with a
// single fighter model, drag-to-rotate, auto-rotate toggle, and the
// procedural animation state machine. The preview renderer is created
// lazily (first time the character screen opens) and its render loop
// pauses whenever the preview is not on screen, so it costs nothing
// while the user is on the menu or in the arena.
//
// The preview is a REAL 3D model (fighterModels.js) — never a static
// image. Dragging rotates the fighter; the camera stays fixed.

import * as THREE from 'three';
import { buildFighterModel } from './fighterModels.js';
import { createFighterAnimator } from './fighterAnimations.js';

const QUALITY = {
  low: { pixelRatio: 1, shadows: false },
  medium: { pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5), shadows: false },
  high: { pixelRatio: Math.min(window.devicePixelRatio || 1, 2), shadows: true },
};

export function createCharacterPreview(container, opts = {}) {
  const qualityName = opts.quality || 'high';
  const q = QUALITY[qualityName] || QUALITY.high;
  const isVisible = opts.isVisible || (() => true);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    return null; // caller shows an honest fallback (card-only select)
  }
  renderer.setPixelRatio(q.pixelRatio);
  renderer.setSize(container.clientWidth || 320, container.clientHeight || 380);
  renderer.shadowMap.enabled = q.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.touchAction = 'none';
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101116);
  scene.fog = new THREE.Fog(0x101116, 9, 16);

  const camera = new THREE.PerspectiveCamera(
    42,
    (container.clientWidth || 320) / Math.max(1, container.clientHeight || 380),
    0.1, 50
  );
  camera.position.set(0, 1.7, 4.6);
  camera.lookAt(0, 1.15, 0);

  // Lighting: soft key + blue rim, matching the arena's look.
  scene.add(new THREE.AmbientLight(0x8a93a8, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(4, 6, 4);
  key.castShadow = q.shadows;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x4f7df3, 0.9);
  rim.position.set(-4, 3, -3);
  scene.add(rim);

  // Ground disc + accent ring the fighter stands on.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(1.5, 48),
    new THREE.MeshStandardMaterial({ color: 0x1c1f26, roughness: 0.9 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.05, 0.03, 8, 64),
    new THREE.MeshStandardMaterial({ color: 0x4f7df3, roughness: 0.4, metalness: 0.3 })
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.02;
  scene.add(ring);
  // Selection glow ring — pulses when a fighter is selected/confirmed.
  const glow = new THREE.Mesh(
    new THREE.TorusGeometry(1.22, 0.035, 8, 64),
    new THREE.MeshBasicMaterial({ color: 0x4f7df3, transparent: true, opacity: 0.25 })
  );
  glow.rotation.x = Math.PI / 2;
  glow.position.y = 0.02;
  scene.add(glow);

  let model = null;
  let animator = null;
  let currentChar = null;
  let autoRotate = true;
  let targetRotY = 0;
  let dragging = false;
  let lastX = 0;
  let disposed = false;
  let raf = 0;
  const clock = new THREE.Clock();

  // ---- Drag to rotate ----
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    targetRotY += (e.clientX - lastX) * 0.012;
    lastX = e.clientX;
  });
  const endDrag = () => { dragging = false; };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);

  function setFighter(char, animate = true) {
    if (!char) return;
    if (model) {
      scene.remove(model.group);
      model.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => m.dispose());
        }
      });
    }
    model = buildFighterModel(char);
    model.group.position.y = 0;
    scene.add(model.group);
    animator = createFighterAnimator(model, { initial: 'idle' });
    currentChar = char;
    if (animate && animator) animator.setState('select');
    // Ring + glow follow the fighter's accent colour.
    ring.material.color.set(char.color);
    glow.material.color.set(char.color);
  }

  function setAnimation(state) {
    if (animator) animator.setState(state);
  }

  function pulseGlow() {
    glow.material.opacity = 0.9;
  }

  function resize() {
    if (disposed) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', resize);

  function tick() {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    if (!isVisible() || document.hidden) return;
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.getElapsedTime();
    if (model) {
      if (autoRotate && !dragging) targetRotY += dt * 0.45;
      model.group.rotation.y += (targetRotY - model.group.rotation.y) * Math.min(1, dt * 10);
      // The selection spin in the animator also writes rotation.y; the
      // drag target wins only after the spin finishes (animator resets
      // state to idle, and the lerp above keeps the last spun angle).
      if (animator) animator.update(dt, t);
      // Animator spin overrides the drag lerp while it runs.
      if (animator && animator.getState() === 'select') {
        targetRotY = model.group.rotation.y;
      }
    }
    glow.material.opacity += (0.25 - glow.material.opacity) * Math.min(1, dt * 3);
    glow.scale.setScalar(1 + Math.sin(t * 2) * 0.03);
    renderer.render(scene, camera);
  }
  tick();

  return {
    setFighter,
    setAnimation,
    pulseGlow,
    setAutoRotate(v) { autoRotate = !!v; },
    getAutoRotate: () => autoRotate,
    setQuality(name) {
      const nq = QUALITY[name] || QUALITY.high;
      renderer.setPixelRatio(nq.pixelRatio);
      renderer.shadowMap.enabled = nq.shadows;
      key.castShadow = nq.shadows;
      scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
      resize();
    },
    getCurrent: () => currentChar,
    resize,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
      renderer.dispose();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          mats.forEach((m) => m.dispose());
        }
      });
    },
  };
}
