// RISHU.COM — Phase 2 — arena.js
// Three.js fighting-arena scene. Preview only: two stylised fighter
// figures stand in the ring; no combat runs in Phase 2.
// Responsibilities: scene, lighting, shadows, floor texture, camera,
// idle orbit, resize, visibility pause, quality switching.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildFighterModel } from './fighterModels.js';
import { createFighterAnimator } from './fighterAnimations.js';

const QUALITY = {
  low: { pixelRatio: 1, shadows: false, antialias: false },
  medium: { pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5), shadows: true, antialias: true },
  high: { pixelRatio: Math.min(window.devicePixelRatio || 1, 2), shadows: true, antialias: true },
};

function makeFloorTexture() {
  // Procedural canvas texture — no external images needed.
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext('2d');

  // Dark mat
  g.fillStyle = '#171a21';
  g.fillRect(0, 0, 1024, 1024);

  // Subtle checker / mat panels
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if ((x + y) % 2 === 0) {
        g.fillStyle = 'rgba(255,255,255,0.025)';
        g.fillRect(x * 128, y * 128, 128, 128);
      }
    }
  }

  // Outer ring line (electric blue, restrained)
  g.strokeStyle = '#4F7DF3';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(512, 512, 430, 0, Math.PI * 2);
  g.stroke();

  // Inner ring line
  g.strokeStyle = 'rgba(79,125,243,0.45)';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(512, 512, 300, 0, Math.PI * 2);
  g.stroke();

  // Centre mark — geometric R
  g.strokeStyle = 'rgba(245,246,250,0.85)';
  g.lineWidth = 14;
  g.lineJoin = 'miter';
  g.beginPath();
  g.moveTo(452, 602);
  g.lineTo(452, 422);
  g.lineTo(542, 422);
  g.lineTo(572, 452);
  g.lineTo(542, 482);
  g.lineTo(452, 482);
  g.moveTo(512, 482);
  g.lineTo(582, 602);
  g.stroke();

  g.fillStyle = 'rgba(245,246,250,0.55)';
  g.font = '600 34px Arial, sans-serif';
  g.textAlign = 'center';
  g.fillText('R I S H U . C O M', 512, 700);

  // Fine scuff marks for realism (very subtle)
  g.strokeStyle = 'rgba(255,255,255,0.05)';
  g.lineWidth = 2;
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * 1024;
    const y = Math.random() * 1024;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (Math.random() * 60 - 30), y + (Math.random() * 60 - 30));
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// Fighter models live in fighterModels.js (Phase 2) — one procedural
// low-poly model per fighter, with the animator in fighterAnimations.js.

export function createArena(container, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const onError = opts.onError || (() => {});
  const qualityName = opts.quality || 'high';
  const q = QUALITY[qualityName] || QUALITY.high;

  onProgress(10, 'Checking WebGL…');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: q.antialias, powerPreference: 'high-performance' });
  } catch (e) {
    onError('WebGL is not available in this browser. RISHU.COM needs WebGL to show the 3D arena.');
    return null;
  }
  if (!renderer.getContext()) {
    onError('WebGL is not available in this browser. RISHU.COM needs WebGL to show the 3D arena.');
    return null;
  }

  renderer.setPixelRatio(q.pixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = q.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  onProgress(30, 'Building arena…');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a0c);
  scene.fog = new THREE.Fog(0x0a0a0c, 18, 42);

  const camera = new THREE.PerspectiveCamera(
    50,
    container.clientWidth / Math.max(1, container.clientHeight),
    0.1,
    100
  );
  camera.position.set(7.5, 4.2, 8.5);

  // ---- Lighting: key + fill + rim + overhead spots ----
  scene.add(new THREE.AmbientLight(0x8a93a8, 0.55));

  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(6, 10, 5);
  key.castShadow = q.shadows;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -8;
  key.shadow.camera.right = 8;
  key.shadow.camera.top = 8;
  key.shadow.camera.bottom = -8;
  key.shadow.camera.far = 30;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x4f7df3, 0.55);
  fill.position.set(-6, 4, -4);
  scene.add(fill);

  const rim = new THREE.SpotLight(0xffffff, 120, 30, Math.PI / 5, 0.45, 1.6);
  rim.position.set(0, 9, -7);
  rim.target.position.set(0, 1, 0);
  scene.add(rim, rim.target);

  // Overhead ring lights (visual fixtures + light)
  const spotPositions = [[-4, 8, 3], [4, 8, 3], [-4, 8, -3], [4, 8, -3]];
  for (const [x, y, z] of spotPositions) {
    const s = new THREE.SpotLight(0xdfe8ff, 60, 22, Math.PI / 6, 0.5, 1.7);
    s.position.set(x, y, z);
    s.target.position.set(0, 0.8, 0);
    scene.add(s, s.target);
    const fixture = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.3, 0.18, 16),
      new THREE.MeshStandardMaterial({ color: 0x1c1f26, roughness: 0.4, metalness: 0.6 })
    );
    fixture.position.set(x, y, z);
    scene.add(fixture);
  }

  onProgress(55, 'Laying the ring floor…');
  // ---- Floor: large dark hall floor + raised ring platform ----
  const hallFloor = new THREE.Mesh(
    new THREE.CircleGeometry(22, 48),
    new THREE.MeshStandardMaterial({ color: 0x101116, roughness: 0.95 })
  );
  hallFloor.rotation.x = -Math.PI / 2;
  hallFloor.receiveShadow = true;
  scene.add(hallFloor);

  const ringBase = new THREE.Mesh(
    new THREE.CylinderGeometry(5.6, 5.9, 0.55, 8),
    new THREE.MeshStandardMaterial({ color: 0x1c1f26, roughness: 0.7, metalness: 0.25 })
  );
  ringBase.position.y = 0.275;
  ringBase.receiveShadow = true;
  ringBase.castShadow = true;
  ringBase.rotation.y = Math.PI / 8; // octagonal ring
  scene.add(ringBase);

  const ringMat = new THREE.Mesh(
    new THREE.CircleGeometry(5.4, 48),
    new THREE.MeshStandardMaterial({ map: makeFloorTexture(), roughness: 0.85 })
  );
  ringMat.rotation.x = -Math.PI / 2;
  ringMat.position.y = 0.56;
  ringMat.receiveShadow = true;
  scene.add(ringMat);

  // Apron trim (electric blue, thin)
  const trim = new THREE.Mesh(
    new THREE.TorusGeometry(5.55, 0.045, 8, 64),
    new THREE.MeshStandardMaterial({ color: 0x4f7df3, roughness: 0.4, metalness: 0.4 })
  );
  trim.rotation.x = Math.PI / 2;
  trim.position.y = 0.56;
  scene.add(trim);

  onProgress(70, 'Raising posts and ropes…');
  // ---- Corner posts + ropes ----
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2a2e38, roughness: 0.35, metalness: 0.7 });
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0x4f7df3, roughness: 0.5 });
  const ropeMat2 = new THREE.MeshStandardMaterial({ color: 0xe8e8ec, roughness: 0.5 });
  const corners = [[-4.6, -4.6], [4.6, -4.6], [4.6, 4.6], [-4.6, 4.6]];
  for (const [x, z] of corners) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.5, 12), postMat);
    post.position.set(x, 1.3, z);
    post.castShadow = true;
    scene.add(post);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), ropeMat);
    cap.position.set(x, 2.08, z);
    scene.add(cap);
  }
  // Ropes: horizontal cylinders along each side, 3 heights
  const ropeHeights = [0.95, 1.35, 1.75];
  const sides = [
    { from: [-4.6, -4.6], to: [4.6, -4.6] },
    { from: [4.6, -4.6], to: [4.6, 4.6] },
    { from: [4.6, 4.6], to: [-4.6, 4.6] },
    { from: [-4.6, 4.6], to: [-4.6, -4.6] },
  ];
  sides.forEach((side) => {
    ropeHeights.forEach((h, hi) => {
      const [x1, z1] = side.from;
      const [x2, z2] = side.to;
      const len = Math.hypot(x2 - x1, z2 - z1);
      const rope = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, len, 8),
        hi === 1 ? ropeMat : ropeMat2
      );
      rope.position.set((x1 + x2) / 2, h, (z1 + z2) / 2);
      // Cylinder is Y-aligned: lookAt points +Z at the far end, then
      // rotateX(90°) lays the cylinder along that direction.
      rope.lookAt(x2, h, z2);
      rope.rotateX(Math.PI / 2);
      scene.add(rope);
    });
  });

  onProgress(82, 'Placing fighters…');
  // ---- Backdrop: dark arena walls + crowd glow strips ----
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(20, 20, 10, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x12141a, roughness: 0.95, side: THREE.BackSide })
  );
  wall.position.y = 5;
  scene.add(wall);

  // Light strips around the wall (restrained blue)
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.08, 0.08),
      new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? 0x4f7df3 : 0x2a2e38 })
    );
    strip.position.set(Math.cos(a) * 19.5, 6.5, Math.sin(a) * 19.5);
    strip.lookAt(0, 6.5, 0);
    scene.add(strip);
  }

  // ---- Fighters (Phase 2 models, idle animation) ----
  // Default pair matches the original defaults (Rishu vs Ayaan) until
  // setFighters() is called with the player's selection.
  const DEFAULT_A = { id: 'rishu', color: '#4F7DF3', colorDark: '#2E4FA8', model: { build: 'average', height: 1, hair: 'spiky', outfit: 'vest', accessory: 'headband' }, skin: 0x8a6a52 };
  const DEFAULT_B = { id: 'ayaan', color: '#E8E8EC', colorDark: '#8A8F9E', model: { build: 'broad', height: 1.02, hair: 'mohawk', outfit: 'hoodie', accessory: 'wristbands' }, skin: 0x6b4a35 };
  function placeFighter(char, x, facing) {
    const m = buildFighterModel(char);
    m.group.position.set(x, 0.56, 0);
    m.group.rotation.y = facing;
    scene.add(m.group);
    return { model: m, animator: createFighterAnimator(m, { initial: 'idle' }), baseRot: facing };
  }
  let fighterA = placeFighter(DEFAULT_A, -1.6, Math.PI / 2);
  let fighterB = placeFighter(DEFAULT_B, 1.6, -Math.PI / 2);

  onProgress(92, 'Setting the camera…');
  // ---- Controls: drag to orbit, scroll to zoom ----
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.2, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 4;
  controls.maxDistance = 18;
  controls.maxPolarAngle = Math.PI / 2 - 0.08;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.7;
  // Pause auto-orbit while the user is dragging; resume 4s after release.
  controls.addEventListener('start', () => { controls.autoRotate = false; });
  controls.addEventListener('end', () => {
    setTimeout(() => { controls.autoRotate = true; }, 4000);
  });

  // ---- Render loop: paused when tab hidden, capped work ----
  let raf = 0;
  let running = true;
  let disposed = false;
  const clock = new THREE.Clock();

  function tick() {
    if (disposed) return;
    raf = requestAnimationFrame(tick);
    if (!running || document.hidden) return;
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.getElapsedTime();
    // Idle animation (breathing / guard sway) from the animator.
    // A slow facing sway keeps the pair reading as alive, not statues.
    fighterA.animator.update(dt, t);
    fighterB.animator.update(dt, t);
    fighterA.model.group.rotation.y = fighterA.baseRot + Math.sin(t * 0.5) * 0.06;
    fighterB.model.group.rotation.y = fighterB.baseRot + Math.sin(t * 0.5 + 0.8) * 0.06;
    controls.update();
    renderer.render(scene, camera);
  }
  tick();
  onProgress(100, 'Arena ready');

  function onResize() {
    if (disposed) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  window.addEventListener('resize', onResize);

  function onVisibility() {
    running = !document.hidden;
    if (!document.hidden) clock.getDelta(); // avoid a jump after tab switch
  }
  document.addEventListener('visibilitychange', onVisibility);

  return {
    setQuality(name) {
      const nq = QUALITY[name] || QUALITY.high;
      renderer.setPixelRatio(nq.pixelRatio);
      renderer.shadowMap.enabled = nq.shadows;
      key.castShadow = nq.shadows;
      // Materials need a refresh when shadow flags change
      scene.traverse((obj) => {
        if (obj.material) obj.material.needsUpdate = true;
      });
      onResize();
    },
    setFighters(charA, charB) {
      // Replace preview figures with the selected characters' real
      // Phase 2 models (distinct silhouette, outfit, hairstyle).
      scene.remove(fighterA.model.group);
      scene.remove(fighterB.model.group);
      fighterA = placeFighter(charA, -1.6, Math.PI / 2);
      fighterB = placeFighter(charB, 1.6, -Math.PI / 2);
    },
    resize: onResize,
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => {
            if (m.map) m.map.dispose();
            m.dispose();
          });
        }
      });
    },
  };
}
