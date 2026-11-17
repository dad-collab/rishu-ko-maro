// RISHU.COM — Phase 5 + Tekken fixed camera + Visual Upgrade — arena.js
// Three.js fighting-arena scene. Phase 5: specials (one signature move
// per fighter, cooldown-gated) + best-of-3 rounds on top of the Phase 4
// combat system — deterministic damage bases 5/8/12/14/20, live health
// bars, WINNER screen. Visual Upgrade: tournament stadium (stands,
// instanced crowd, banners, jumbotron, light rig), pooled particle
// effects, theatre-mode full-screen fights, FIGHT banner + 1.2 s
// fight-start freeze, victory moment (winner pose + confetti + crowd
// surge), and the animator slide fix (measured speed fed to the
// animators).
//
// Tick order (Phase 4 — see PHASE4-PLAN.md §3; the order is the contract):
// combat updates BEFORE the movement controllers (hit tests use the
// pre-move positions), movement is zeroed where combat locks it, then
// controllers → separation → projectile (Phase 5: after separation, so
// its hit test sees post-separation positions) → combat.syncAnimator()
// (re-asserts combat poses AFTER the controllers, or attacks never
// show) → animators → HUD sync. There is NO per-frame camera work: the
// fixed pose is set once in beginMatch() and never touched again. The
// combat module is the ONLY decider of damage; this file routes inputs
// and events, never computes a hit itself.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildFighterModel } from './fighterModels.js';
import { createFighterAnimator } from './fighterAnimations.js';
import { createKeyboardInput, createFighterController, resolveSeparation } from './movement.js';
import { createFixedCamera } from './fixedCamera.js';
import { createTouchControls } from './touchControls.js';
import { createHud } from './hud.js';
import { createFighterCombat, ATTACKS, flashFighter } from './combat.js';
import { createComboTracker, comboScale } from './comboSystem.js';
import { createCombatAudio } from './combatAudio.js';
import { createSpecialController, specialFor } from './specials.js';
import { createRoundSystem, ROUND_END_PAUSE } from './rounds.js';
import { buildStadium } from './stadium.js';
import { createEffects, FX_COLORS } from './effects.js';

const QUALITY = {
  low: { pixelRatio: 1, shadows: false, antialias: false },
  medium: { pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5), shadows: true, antialias: true },
  high: { pixelRatio: Math.min(window.devicePixelRatio || 1, 2), shadows: true, antialias: true },
};

// Merge static same-material geometry into one draw call. The arena
// measured 120 draw calls on a phone vs the ≤110 budget, and these
// groups are fully static — no per-object updates, no fading — so
// merging is free performance. Parts are fresh single-use geometries:
// the helper applies the placement matrix, merges, then disposes the
// inputs. Placement reuses a dummy Object3D so the merge uses three's
// own rotation/lookAt math instead of hand-derived angles. (The ropes
// are NOT merged: the near side fades via per-rope cloned materials.)
const _mergeDummy = new THREE.Object3D();
function placedMatrix(x, y, z, rotX = 0, lookAt = null) {
  _mergeDummy.position.set(x, y, z);
  _mergeDummy.rotation.set(rotX, 0, 0);
  _mergeDummy.updateMatrix();
  if (lookAt) {
    _mergeDummy.lookAt(lookAt[0], lookAt[1], lookAt[2]);
    _mergeDummy.updateMatrix();
  }
  return _mergeDummy.matrix.clone();
}
function mergedMesh(parts, material) {
  const geos = parts.map(({ geo, matrix }) => {
    if (matrix) geo.applyMatrix4(matrix);
    return geo;
  });
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  return new THREE.Mesh(merged, material);
}

// Rope placement matrix: the exact sequence the rope meshes used
// (midpoint position → lookAt the far end → rotateX 90° to lay the
// Y-aligned cylinder along the side), replicated on the dummy so the
// merged far ropes sit exactly where the individual ropes did.
function ropeMatrix(x1, z1, x2, z2, h) {
  _mergeDummy.position.set((x1 + x2) / 2, h, (z1 + z2) / 2);
  _mergeDummy.rotation.set(0, 0, 0);
  _mergeDummy.updateMatrix();
  _mergeDummy.lookAt(x2, h, z2);
  _mergeDummy.rotateX(Math.PI / 2);
  _mergeDummy.updateMatrix();
  return _mergeDummy.matrix.clone();
}

function makeFloorTexture() {
  // Procedural canvas texture — no external images needed.
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 1024;
  const g = c.getContext('2d');

  // Dark mat (navy stage)
  g.fillStyle = '#16283F';
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

  // Outer ring line (burnt orange, restrained)
  g.strokeStyle = '#BC5222';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(512, 512, 430, 0, Math.PI * 2);
  g.stroke();

  // Inner ring line
  g.strokeStyle = 'rgba(188,82,34,0.45)';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(512, 512, 300, 0, Math.PI * 2);
  g.stroke();

  // Visual upgrade — outer decorative ring (thin ivory dashes + a
  // fine orange hairline outside the main ring line, inside r=5.4).
  g.strokeStyle = 'rgba(242,237,227,0.4)';
  g.lineWidth = 4;
  g.setLineDash([26, 18]);
  g.beginPath();
  g.arc(512, 512, 480, 0, Math.PI * 2);
  g.stroke();
  g.setLineDash([]);
  g.strokeStyle = 'rgba(188,82,34,0.5)';
  g.lineWidth = 3;
  g.beginPath();
  g.arc(512, 512, 500, 0, Math.PI * 2);
  g.stroke();

  // Centre mark — thin-stroke open R (same construction as the wordmark)
  g.strokeStyle = 'rgba(242,237,227,0.85)';
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
  // Orange dot at the diagonal joint
  g.fillStyle = 'rgba(188,82,34,0.9)';
  g.beginPath();
  g.arc(512, 482, 12, 0, Math.PI * 2);
  g.fill();

  g.fillStyle = 'rgba(242,237,227,0.55)';
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

// Phase 5 — Energy Blast projectile (Zara's Shadow Step, the ONLY
// projectile in the game). Adapted from the Phase 5 audit's draft
// js/fx.js createProjectile — js/fx.js itself was superseded by the
// visual upgrade's js/effects.js (which has no projectile), so the
// factory lives here, in the arena, where the scene and the hit test
// live. One mesh + one PointLight, created in startMatch and disposed
// in stopMatch. It flies horizontally at chest height (the launch y is
// fixed at launch); the tick tests a flat XZ radius against the
// defender, so a jump does not dodge a blast (the brief's blast has
// no vertical dodge rule — dodging is the i-frame dodge).
function createProjectile({ scene }) {
  const geo = new THREE.SphereGeometry(0.16, 16, 12);
  const mat = new THREE.MeshBasicMaterial({ color: 0x4F7DF3 });
  const mesh = new THREE.Mesh(geo, mat);
  const light = new THREE.PointLight(0x4F7DF3, 2, 3);
  mesh.add(light);
  mesh.visible = false;
  scene.add(mesh);
  let active = false;
  let travelled = 0;
  let speed = 8;
  let maxRange = 6;
  const dir = new THREE.Vector3(0, 0, -1);
  return {
    get active() { return active; },
    get position() { return mesh.position; },
    launch(origin, direction, opts = {}) {
      speed = opts.speed ?? 8;
      maxRange = opts.range ?? 6;
      travelled = 0;
      dir.copy(direction).normalize();
      mesh.position.set(origin.x, origin.y, origin.z);
      mesh.visible = true;
      active = true;
    },
    update(dt) {
      if (!active) return;
      const step = speed * dt;
      mesh.position.x += dir.x * step;
      mesh.position.z += dir.z * step;
      travelled += step;
      if (travelled >= maxRange) this.despawn();
    },
    despawn() {
      active = false;
      mesh.visible = false;
    },
    dispose() {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
      light.dispose();
    },
  };
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
  scene.background = new THREE.Color(0x0E1B2E);
  scene.fog = new THREE.Fog(0x0E1B2E, 18, 42);

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

  const fill = new THREE.DirectionalLight(0x5B7A99, 0.7);
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
      new THREE.MeshStandardMaterial({ color: 0x16283F, roughness: 0.4, metalness: 0.6 })
    );
    fixture.position.set(x, y, z);
    scene.add(fixture);
  }

  onProgress(55, 'Laying the ring floor…');
  // ---- Floor: large dark hall floor + raised ring platform ----
  const hallFloor = new THREE.Mesh(
    new THREE.CircleGeometry(22, 48),
    new THREE.MeshStandardMaterial({ color: 0x0A1424, roughness: 0.95 })
  );
  hallFloor.rotation.x = -Math.PI / 2;
  hallFloor.receiveShadow = true;
  scene.add(hallFloor);

  const ringBase = new THREE.Mesh(
    new THREE.CylinderGeometry(5.6, 5.9, 0.55, 8),
    new THREE.MeshStandardMaterial({ color: 0x16283F, roughness: 0.7, metalness: 0.25 })
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

  // Apron trim (burnt orange, thin)
  const trim = new THREE.Mesh(
    new THREE.TorusGeometry(5.55, 0.045, 8, 64),
    new THREE.MeshStandardMaterial({ color: 0xBC5222, roughness: 0.4, metalness: 0.4 })
  );
  trim.rotation.x = Math.PI / 2;
  trim.position.y = 0.56;
  scene.add(trim);

  onProgress(70, 'Raising posts and ropes…');
  // ---- Corner posts + ropes ----
  const postMat = new THREE.MeshStandardMaterial({ color: 0x3E5A75, roughness: 0.35, metalness: 0.7 });
  const ropeMat = new THREE.MeshStandardMaterial({ color: 0xBC5222, roughness: 0.5 });
  const ropeMat2 = new THREE.MeshStandardMaterial({ color: 0xF2EDE3, roughness: 0.5 });
  const corners = [[-4.6, -4.6], [4.6, -4.6], [4.6, 4.6], [-4.6, 4.6]];
  // Draw-call merge: the 4 posts share one geometry + material, and so
  // do the 4 caps — each group merges into a single mesh (see the
  // helpers above). The posts keep castShadow (no-op while shadows
  // are off); the caps keep ropeMat (they never fade — only the near
  // ropes do, and those stay separate).
  const posts = mergedMesh(corners.map(([x, z]) => ({
    geo: new THREE.CylinderGeometry(0.09, 0.11, 1.5, 12),
    matrix: placedMatrix(x, 1.3, z),
  })), postMat);
  posts.castShadow = true;
  scene.add(posts);
  scene.add(mergedMesh(corners.map(([x, z]) => ({
    geo: new THREE.SphereGeometry(0.12, 12, 10),
    matrix: placedMatrix(x, 2.08, z),
  })), ropeMat));
  // Ropes: horizontal cylinders along each side, 3 heights.
  // Near-side ropes (sides[2], z = +4.6) are kept in `nearRopes` with
  // CLONED materials: ropeMat/ropeMat2 are shared across all 12 ropes,
  // and only the near side fades during a match (fixed side view — the
  // near ropes would otherwise cross the fighters). The far ropes keep
  // the shared materials and never fade.
  const nearRopes = [];
  function setNearRopesFaded(faded) {
    // Idempotent: safe on every exit path, including a double stopMatch.
    for (const r of nearRopes) r.material.opacity = faded ? 0.15 : 1;
  }
  const ropeHeights = [0.95, 1.35, 1.75];
  const sides = [
    { from: [-4.6, -4.6], to: [4.6, -4.6] },
    { from: [4.6, -4.6], to: [4.6, 4.6] },
    { from: [4.6, 4.6], to: [-4.6, 4.6] },
    { from: [-4.6, 4.6], to: [-4.6, -4.6] },
  ];
  // Far ropes share 2 materials — merge into 2 draw calls (was 9).
  // Same draw-call merge as the posts above; the near side stays
  // separate (its 3 ropes fade via cloned materials).
  const farRopeParts = { orange: [], ivory: [] };
  sides.forEach((side, si) => {
    ropeHeights.forEach((h, hi) => {
      const [x1, z1] = side.from;
      const [x2, z2] = side.to;
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (si === 2) {
        // Near side: own material instance (transparent so opacity works).
        const rope = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.035, len, 8),
          (hi === 1 ? ropeMat : ropeMat2).clone(),
        );
        rope.material.transparent = true;
        rope.position.set((x1 + x2) / 2, h, (z1 + z2) / 2);
        // Cylinder is Y-aligned: lookAt points +Z at the far end, then
        // rotateX(90°) lays the cylinder along that direction.
        rope.lookAt(x2, h, z2);
        rope.rotateX(Math.PI / 2);
        nearRopes.push(rope);
        scene.add(rope);
      } else {
        (hi === 1 ? farRopeParts.orange : farRopeParts.ivory).push({
          geo: new THREE.CylinderGeometry(0.035, 0.035, len, 8),
          matrix: ropeMatrix(x1, z1, x2, z2, h),
        });
      }
    });
  });
  scene.add(mergedMesh(farRopeParts.orange, ropeMat));
  scene.add(mergedMesh(farRopeParts.ivory, ropeMat2));

  onProgress(78, 'Building the stadium…');
  // ---- Visual upgrade — stadium + effects (mounted once) ----
  // Stands, instanced crowd, banners, jumbotron, light rig (stadium.js)
  // and the pooled particle system (effects.js). Both update from the
  // tick — in the match branch AND the preview branch, so the crowd is
  // alive on the menu's arena preview too.
  const stadium = buildStadium(scene, { quality: qualityName });
  const effects = createEffects(scene, { maxParticles: qualityName === 'low' ? 256 : 512 });

  onProgress(82, 'Placing fighters…');
  // ---- Backdrop: dark arena walls + crowd light strips ----
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(20, 20, 10, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x0A1424, roughness: 0.95, side: THREE.BackSide })
  );
  wall.position.y = 5;
  scene.add(wall);

  // Light strips around the wall (restrained steel) — merged by
  // material into 2 draw calls (was 12; same draw-call merge as the
  // posts above). The merged meshes span the whole ring, so they
  // always render (2 calls) instead of ~5 individual strips.
  const stripSteelMat = new THREE.MeshBasicMaterial({ color: 0x5B7A99 });
  const stripDarkMat = new THREE.MeshBasicMaterial({ color: 0x2A3B52 });
  const stripParts = { steel: [], dark: [] };
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    (i % 3 === 0 ? stripParts.steel : stripParts.dark).push({
      geo: new THREE.BoxGeometry(1.4, 0.08, 0.08),
      matrix: placedMatrix(Math.cos(a) * 19.5, 6.5, Math.sin(a) * 19.5, 0, [0, 6.5, 0]),
    });
  }
  scene.add(mergedMesh(stripParts.steel, stripSteelMat));
  scene.add(mergedMesh(stripParts.dark, stripDarkMat));

  // ---- Fighters (Phase 2 models, idle animation) ----
  // Default pair matches the original defaults (Rishu vs Ayaan) until
  // setFighters() is called with the player's selection.
  const DEFAULT_A = { id: 'rishu', color: '#BC5222', colorDark: '#7E3410', model: { build: 'average', height: 1, hair: 'spiky', outfit: 'vest', accessory: 'headband' }, skin: 0x8a6a52 };
  const DEFAULT_B = { id: 'ayaan', color: '#E8E8EC', colorDark: '#8A8F9E', model: { build: 'broad', height: 1.02, hair: 'mohawk', outfit: 'hoodie', accessory: 'wristbands' }, skin: 0x6b4a35 };
  function placeFighter(char, x, facing) {
    const m = buildFighterModel(char);
    m.group.position.set(x, 0.56, 0);
    m.group.rotation.y = facing;
    scene.add(m.group);
    // Phase 3: facing is owned by the movement controller, not by a
    // stored baseRot — the old idle facing sway is deleted (see tick).
    return { model: m, animator: createFighterAnimator(m, { initial: 'idle' }) };
  }
  let fighterA = placeFighter(DEFAULT_A, -1.6, Math.PI / 2);
  let fighterB = placeFighter(DEFAULT_B, 1.6, -Math.PI / 2);

  // Closure-level setFighters: startMatch() calls this directly.
  // (It used to exist ONLY as a method on the returned API object, so
  // the bare call inside startMatch threw ReferenceError and the
  // "Continue to Arena" button died disabled — the arena never opened.)
  function setFighters(charA, charB) {
    // Replace preview figures with the selected characters' real
    // Phase 2 models (distinct silhouette, outfit, hairstyle).
    // Preview-only path: startMatch() calls this, then binds the
    // movement controllers to the new models. Do not call it during
    // a match — it would orphan the controllers.
    scene.remove(fighterA.model.group);
    scene.remove(fighterB.model.group);
    fighterA = placeFighter(charA, -1.6, Math.PI / 2);
    fighterB = placeFighter(charB, 1.6, -Math.PI / 2);
    // Visual upgrade — the jumbotron shows the new matchup.
    if (stadium) stadium.setMatchup(charA, charB);
  }

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

  // ---- Match state (Phase 3) ----
  // matchBuilt: fighters/controllers/camera/HUD/touch/keyboard exist.
  // matchRunning: the simulation is live (input + movement + timer).
  // paused: simulation frozen (HUD overlay shown), rendering continues.
  // lastMatch remembers the last confirmed pair so re-entering the arena
  // (e.g. via the nav) starts a fresh match instead of a dead preview.
  let matchBuilt = false;
  let matchRunning = false;
  let paused = false;
  let lastMatch = null; // { mode, charA, charB }
  let ctrlA = null;
  let ctrlB = null;
  // Fixed side-view camera (Tekken style): one ortho pose per match,
  // never updated per frame. renderCamera is what the tick renders —
  // the perspective orbit camera outside a match, the fixed camera
  // during one. rotatePaused tracks a pause made BY the rotate gate
  // (not by the user) so rotating back only resumes a gate pause.
  let fixedCamera = null;
  let renderCamera = camera;
  let rotatePaused = false;
  let rotatePromptEl = null;
  let keyboard = null;
  let touch = null;
  let hud = null;
  // Phase 4 — combat state. matchOver: a KO has frozen the match (the
  // winner overlay owns the screen until Rematch/Quit). hitstop: seconds of
  // tick-level freeze left after a heavy hit. simSec: accumulated
  // SIM time (sum of clamped dt) of the current match — the combo
  // window's clock. It must be sim-time, not the wall clock: every
  // other combat timing (attack durations, hitstun, i-frames, chain
  // buffer) is sim-time, and a wall-clock window expires between
  // landed hits on any device below ~15 fps (three attacks are 1.02 s
  // of sim but take >1.2 s of wall there), making combos impossible.
  // flashTimer: the pending hit-flash restore (cleared on stopMatch so
  // a disposed model is never touched).
  let combatA = null;
  let combatB = null;
  let combo = null;
  let audio = null;
  let matchOver = false;
  let hitstop = 0;
  let simSec = 0;
  let flashTimer = 0;
  // Visual upgrade — FIGHT intro countdown (seconds left; input +
  // timer held until it hits 0) and the KO winner, whose victory pose
  // the matchOver branch re-asserts if anything overwrites it.
  let introT = 0;
  let victoryFighter = null;
  // Phase 5 — specials + rounds. specialA/B are the per-fighter
  // cooldown controllers (created in startMatch, reset per round and
  // per rematch). rounds owns the best-of-3 state. roundEndTimer counts
  // the 1.0 s freeze between a round KO and the next round's intro;
  // roundEndResult holds the recordRoundWin() result for that window.
  // projectile is Zara's Energy Blast (the only projectile) plus the
  // def/attacker it needs for its hit test.
  let specialA = null;
  let specialB = null;
  let rounds = null;
  let roundEndTimer = 0;
  let roundEndResult = null;
  let projectile = null;
  let projectileDef = null;
  let projectileAttacker = null;
  let projectileAttackerChar = null;

  const ZERO_MOVE = { mx: 0, mz: 0, run: false, jump: false };
  const ZERO_COMBAT = { attack: null, block: false, blockLow: false, dodge: false, evade: false, special: false, grounded: true };

  function readP1Input() {
    const input = keyboard ? keyboard.getP1() : { mx: 0, mz: 0, run: false, jump: false };
    // Touch joystick overrides the keyboard when it is deflected; the
    // jump edge is merged (either source can trigger one jump).
    if (touch) {
      const t = touch.input;
      if (t.mx !== 0 || t.mz !== 0) {
        input.mx = t.mx;
        input.mz = t.mz;
        input.run = t.run;
      }
      if (touch.consumeJump()) input.jump = true;
    }
    return input;
  }

  // Phase 4 — combat input for one fighter ('p1' | 'p2'). Keyboard
  // combat edges (getCombatP1/P2 — consumed on read, once per frame)
  // merged with the touch combat edges (consumeCombat — P1 only).
  // `grounded` comes from the fighter's own controller. The dodge
  // direction is the current camera-relative move input (or null — the
  // combat module dashes backward when none is supplied).
  const _fwdV = new THREE.Vector3();
  const _rightV = new THREE.Vector3();
  const _dodgeDir = new THREE.Vector3();
  const UP_V = new THREE.Vector3(0, 1, 0);

  function dodgeDirFor(moveInput) {
    if (!fixedCamera) return null;
    fixedCamera.getForward(_fwdV);
    _fwdV.y = 0;
    if (_fwdV.lengthSq() < 0.001) _fwdV.set(0, 0, -1);
    _fwdV.normalize();
    _rightV.crossVectors(_fwdV, UP_V).normalize();
    _dodgeDir.set(0, 0, 0)
      .addScaledVector(_fwdV, moveInput.mz || 0)
      .addScaledVector(_rightV, moveInput.mx || 0);
    if (_dodgeDir.lengthSq() < 0.01) return null;
    _dodgeDir.normalize();
    return { x: _dodgeDir.x, z: _dodgeDir.z };
  }

  function readCombatInput(which, moveInput) {
    const isP1 = which === 'p1';
    const kb = keyboard
      ? (isP1 ? keyboard.getCombatP1() : keyboard.getCombatP2())
      : { attack: null, block: false, blockLow: false, dodge: false, evade: false, special: false };
    const tc = (isP1 && touch) ? touch.consumeCombat() : null;
    const ctrl = isP1 ? ctrlA : ctrlB;
    return {
      attack: kb.attack || (tc && tc.attack) || null,
      special: !!(kb.special || (tc && tc.special)),
      block: !!(kb.block || (tc && tc.block)),
      blockLow: !!kb.blockLow,
      dodge: !!(kb.dodge || (tc && tc.dodge)),
      evade: !!kb.evade,
      dodgeDir: dodgeDirFor(moveInput),
      grounded: ctrl ? ctrl.isGrounded : true,
    };
  }

  // Phase 4 — one place that turns combat events into sound, flash,
  // shake, hitstop, combo bookkeeping and the KO flow. The handler is
  // registered on a fighter's combat object, so `id` is the fighter
  // that EMITTED the event: for 'hit'/'blocked'/'whiff'/'dodged' that
  // is the DEFENDER (the attacker is the other fighter); for
  // 'block-start'/'dodge'/'evade' it is the ACTOR (whose outgoing
  // combo ends). Sound names map 1:1 to combatAudio profiles.
  const SOUND_FOR_ATTACK = {
    lightPunch: 'punchLight', heavyPunch: 'punchHeavy',
    kick: 'kick', heavyKick: 'kickHeavy',
  };

  function onKo(winnerId) {
    if (matchOver) return;
    matchOver = true;
    if (hud) hud.stop();
    if (audio) audio.play('ko');
    // Visual upgrade — victory moment: the winner raises their arms,
    // confetti bursts above them and the crowd surges. The matchOver
    // branch re-asserts the pose if the killing tick overwrote it.
    const winner = winnerId === 'A' ? fighterA : fighterB;
    winner.animator.setState('victory');
    victoryFighter = winner;
    if (effects) {
      const p = winner.model.group.position;
      effects.confetti({ x: p.x, y: p.y + 2.4, z: p.z });
    }
    if (stadium) stadium.setExcitement(1);
    const winnerChar = winnerId === 'A' ? lastMatch.charA : lastMatch.charB;
    const loserChar = winnerId === 'A' ? lastMatch.charB : lastMatch.charA;
    // Phase 5 — rounds: the KO wins the ROUND, not necessarily the
    // match. recordRoundWin() decides: match over → WINNER screen
    // (replaces the Phase 4 KO overlay); round over → 1.0 s freeze
    // with the round banner, then the next round's intro.
    const result = rounds
      ? rounds.recordRoundWin(winnerId)
      : { roundWinner: winnerId, matchWinner: winnerId, score: { A: winnerId === 'A' ? 1 : 0, B: winnerId === 'B' ? 1 : 0 }, matchOver: true };
    if (result.matchOver) {
      if (hud && lastMatch) {
        hud.showWinner(
          winnerChar ? winnerChar.name : 'Winner',
          loserChar ? loserChar.name : 'Loser',
          `${result.score.A}–${result.score.B}`,
          {
            onRematch: () => { // Rematch: same mode, same pair, fresh match + intro again
              if (lastMatch) {
                startMatch(lastMatch.mode, lastMatch.charA, lastMatch.charB);
                beginMatch();
              }
            },
            onQuit: () => { if (opts.onQuitMatch) opts.onQuitMatch(); },
          },
        );
      }
    } else {
      roundEndResult = result;
      roundEndTimer = ROUND_END_PAUSE;
      if (hud) hud.showFightBanner(`${winnerChar ? winnerChar.name : 'Winner'} TAKES ROUND ${rounds.round}`);
    }
  }

  // Phase 5 — next round (after a round KO): the rounds system has
  // already advanced (round +1, phase 'intro'); this resets the
  // round-scoped state — HP, positions, cooldowns, combo, timer,
  // hitstop, projectile — while the round WINS persist in `rounds`.
  // Then the "ROUND n — FIGHT!" intro runs (1.2 s, input frozen),
  // exactly like beginMatch's FIGHT intro.
  function beginNextRound() {
    if (!rounds || !rounds.beginNextRoundIntro()) return;
    if (combatA) combatA.reset();
    if (combatB) combatB.reset();
    if (combo) combo.reset();
    if (specialA) specialA.reset();
    if (specialB) specialB.reset();
    if (projectile) projectile.despawn();
    projectileDef = null;
    projectileAttacker = null;
    projectileAttackerChar = null;
    hitstop = 0;
    simSec = 0;
    victoryFighter = null;
    if (ctrlA) ctrlA.resetTo(-1.6, 0);
    if (ctrlB) ctrlB.resetTo(1.6, 0);
    fighterA.animator.setState('idle');
    fighterB.animator.setState('idle');
    // The HUD sync in the live branch only runs after the intro, so
    // reset the bars/pips/special slots NOW — otherwise the round-1
    // KO state (0 HP, pips 1–0) would show through the intro.
    if (hud && combatA && combatB) {
      hud.setHealth('p1', combatA.getHp(), combatA.getMaxHp());
      hud.setHealth('p2', combatB.getHp(), combatB.getMaxHp());
      hud.setCombo('p1', 0);
      hud.setCombo('p2', 0);
      hud.setRounds(rounds.round, rounds.wins.A, rounds.wins.B);
      hud.setSpecial('p1', { name: specialA ? specialA.move : null, frac: 0, ready: true, remaining: 0 });
      hud.setSpecial('p2', { name: specialB ? specialB.move : null, frac: 0, ready: true, remaining: 0 });
    }
    introT = 1.2;
    if (hud) hud.showFightBanner(`ROUND ${rounds.round} — FIGHT!`);
    matchOver = false;
  }

  function handleCombatEvent(id, ev) {
    // Most combat events ('hit', 'blocked', 'dodged', 'special-hit',
    // 'special-blocked', 'special-dodged') are emitted by the DEFENDER's
    // combat (receiveAttack), so `id` is the defender and the attacker
    // is the other fighter. But 'special-start', 'special-launch' and
    // 'special-whiff' are emitted by the ATTACKER's own combat (its
    // special state machine), so `id` IS the attacker there. Getting
    // this wrong made the Energy Blast read the DEFENDER's def
    // (Kabir's powerPunch — no `projectile` field) and throw
    // "Cannot read properties of undefined (reading 'speed')", so the
    // blast never launched (browser E2E: projectileFlies false).
    const attackerEmitted = ev.type === 'special-start'
      || ev.type === 'special-launch' || ev.type === 'special-whiff';
    const attackerId = attackerEmitted ? id : (id === 'A' ? 'B' : 'A');
    // Phase 5 — the attacker's character (for the special-def lookup).
    const attackerChar = lastMatch ? (attackerId === 'A' ? lastMatch.charA : lastMatch.charB) : null;
    const defenderModel = (id === 'A' ? fighterA : fighterB).model;
    switch (ev.type) {
      case 'hit': {
        combo.recordHit(attackerId, ev.attack, simSec);
        // Getting hit ends YOUR outgoing combo (comboSystem.js) — the
        // defender's count resets here, not only on the 1.2 s expiry.
        combo.recordInterrupted(id);
        if (audio) audio.play(SOUND_FOR_ATTACK[ev.attack] || 'punchLight');
        if (flashTimer) { clearTimeout(flashTimer); flashTimer = 0; }
        flashTimer = flashFighter(defenderModel);
        // Visual upgrade — impact burst (+ ring on heavy hits) at the
        // defender's torso, and the crowd surges on a heavy hit.
        const heavy = ev.attack === 'heavyPunch' || ev.attack === 'heavyKick';
        if (effects) {
          const p = defenderModel.group.position;
          effects.burst(
            { x: p.x, y: p.y + 1.3, z: p.z },
            { color: heavy ? FX_COLORS.orange : FX_COLORS.gold, count: heavy ? 22 : 14 },
          );
          if (heavy) effects.ring({ x: p.x, y: p.y + 1.0, z: p.z }, { color: FX_COLORS.orange });
        }
        if (heavy && stadium) stadium.setExcitement(0.6);
        const def = ATTACKS[ev.attack];
        // Hitstop is an explicit field on the attack def (Phase 5) —
        // decoupled from the shake guard (Phase 4 conflated them:
        // hitstop lived inside the `def.shake > 0` branch).
        if (def && def.hitstop > 0) hitstop = def.hitstop;
        // Heavy-hit shake (user decision 12:54 IST): subtle, heavy hits
        // only. def.shake is the peak horizontal offset in METRES
        // (0.05 heavyPunch, 0.08 heavyKick); light attacks and kicks
        // carry shake: 0, so this guard selects exactly the two heavies.
        // The guard and the addShake call are the live shake contract —
        // do not change them.
        if (def && def.shake > 0) {
          if (fixedCamera) fixedCamera.addShake(def.shake);
        }
        if (ev.ko) onKo(attackerId);
        break;
      }
      // Phase 5 — special events. `id` is still the DEFENDER (the
      // emitter); the attacker is the other fighter, whose special def
      // comes from specialFor(attackerChar.id).
      case 'special-start': {
        // Charge-up burst at the attacker — the special is visibly
        // starting before its hit lands. The sound plays on the hit
        // (melee) or the launch (projectile), not here.
        const attackerModel = (attackerId === 'A' ? fighterA : fighterB).model;
        if (effects) {
          const p = attackerModel.group.position;
          effects.burst({ x: p.x, y: p.y + 1.3, z: p.z }, { color: FX_COLORS.steel, count: 8 });
        }
        break;
      }
      case 'special-hit': {
        combo.recordHit(attackerId, 'special', simSec);
        combo.recordInterrupted(id);
        const def = attackerChar ? specialFor(attackerChar.id) : null;
        if (audio && def) audio.play(def.sound);
        if (flashTimer) { clearTimeout(flashTimer); flashTimer = 0; }
        flashTimer = flashFighter(defenderModel);
        // One VFX per archetype (via the def's vfx tag): burstBig =
        // Ember Rush (ivory burst + orange ring), ring = Cyclone Kick
        // (steel ring + steel burst), burst = power-punch specials.
        if (effects && def) {
          const p = defenderModel.group.position;
          if (def.vfx === 'burstBig') {
            effects.burst({ x: p.x, y: p.y + 1.3, z: p.z }, { color: FX_COLORS.ivory, count: 30 });
            effects.ring({ x: p.x, y: p.y + 1.0, z: p.z }, { color: FX_COLORS.orange });
          } else if (def.vfx === 'ring') {
            effects.ring({ x: p.x, y: p.y + 1.0, z: p.z }, { color: FX_COLORS.steel });
            effects.burst({ x: p.x, y: p.y + 1.3, z: p.z }, { color: FX_COLORS.steel, count: 16 });
          } else {
            effects.burst({ x: p.x, y: p.y + 1.3, z: p.z }, { color: FX_COLORS.orange, count: 22 });
          }
        }
        if (stadium) stadium.setExcitement(0.6);
        // Same decoupled fields as the normal 'hit' case: hitstop from
        // def.hitstop, shake from def.shake (audited table values only).
        if (def && def.hitstop > 0) hitstop = def.hitstop;
        if (def && def.shake > 0) {
          if (fixedCamera) fixedCamera.addShake(def.shake);
        }
        if (ev.ko) onKo(attackerId);
        break;
      }
      case 'special-blocked': {
        if (audio) audio.play('block');
        if (ev.hp <= 0) onKo(attackerId);
        break;
      }
      case 'special-whiff': {
        combo.recordWhiff(attackerId);
        if (audio) audio.play('whiff');
        break;
      }
      case 'special-dodged':
        break; // clean miss — no sound, no counter, no reaction
      case 'special-launch': {
        // Zara's Shadow Step: the blast leaves the attacker's chest
        // and flies straight ahead (the attacker's facing at launch).
        const def = attackerChar ? specialFor(attackerChar.id) : null;
        if (def && projectile) {
          const attackerModel = (attackerId === 'A' ? fighterA : fighterB).model;
          const attackerCtrl = attackerId === 'A' ? ctrlA : ctrlB;
          const p = attackerModel.group.position;
          const f = attackerCtrl ? attackerCtrl.facing : 0;
          projectile.launch(
            { x: p.x, y: p.y + 1.3, z: p.z },
            { x: Math.sin(f), y: 0, z: Math.cos(f) },
            { speed: def.projectile.speed, range: def.projectile.maxRange },
          );
          projectileDef = def;
          projectileAttacker = attackerId;
          projectileAttackerChar = attackerChar;
          if (audio) audio.play(def.sound);
        }
        break;
      }
      case 'blocked': {
        if (audio) audio.play('block');
        if (ev.hp <= 0) onKo(attackerId);
        break;
      }
      case 'whiff': {
        combo.recordWhiff(attackerId);
        if (audio) audio.play('whiff');
        break;
      }
      case 'dodged':
        break; // clean miss — no sound, no counter, no reaction
      case 'block-start':
      case 'dodge':
      case 'evade': {
        // Your own block/dodge ends YOUR outgoing combo.
        combo.recordInterrupted(id);
        if (ev.type !== 'block-start' && audio) audio.play('dodge');
        break;
      }
      case 'attack-start':
      case 'ko':
        // 'ko' is also emitted by enterKo, but the KO flow is driven by
        // the 'hit' / 'blocked' events (they carry the winner) — ignore.
        break;
      default:
        break;
    }
  }

  // ---- Landscape-first rotate gate (mobile only) ----
  // Fights run in landscape on phones so fighters stay PC-sized
  // (~48-50% of canvas height). Portrait is not a fight orientation:
  // the rotate prompt gates arena entry and pauses mid-match.
  // Desktop narrow windows are NOT gated (coarse-pointer check).
  function isPhone() {
    return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  }
  function isPhonePortrait() {
    return isPhone() && window.innerHeight > window.innerWidth;
  }
  function showRotatePrompt() { if (rotatePromptEl) rotatePromptEl.hidden = false; }
  function hideRotatePrompt() { if (rotatePromptEl) rotatePromptEl.hidden = true; }
  function updateRotateGate() {
    if (!isPhone()) return;
    // No match at all (boot / orbit preview): the prompt never appears
    // outside a match — menu, modes and select stay portrait-friendly.
    if (!matchBuilt && !matchRunning) return;
    if (window.innerHeight > window.innerWidth) {
      // A finished match is owned by the winner overlay (Rematch/Quit
      // must stay tappable in portrait); Rematch re-gates in beginMatch.
      if (matchOver) return;
      // Only claim the pause if the user had not already paused:
      // rotating back must not resume a user pause.
      if (matchRunning && hud && !hud.isPaused()) {
        hud.setPaused(true);
        rotatePaused = true;
      }
      showRotatePrompt();
    } else {
      hideRotatePrompt();
      if (matchBuilt && !matchRunning) {
        // Gated entry: the phone is landscape now — start the fight.
        beginMatch();
      } else if (rotatePaused && hud) {
        rotatePaused = false;
        hud.setPaused(false);
      }
    }
  }

  // Best-effort orientation lock (Android Chrome only): lock() needs
  // fullscreen + a user gesture; iOS Safari has no lock() (through
  // iOS 26.6), so it is skipped there. The rotate prompt is the
  // guarantee — this never blocks, never throws, never shows an error.
  function tryOrientationLock() {
    try {
      if (!isPhone()) return;
      const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
      const isIOS = /iPhone|iPad|iPod/.test(ua)
        || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      if (isIOS) return;
      if (!window.screen || !window.screen.orientation || typeof window.screen.orientation.lock !== 'function') return;
      if (!document.documentElement || typeof document.documentElement.requestFullscreen !== 'function') return;
      const lockIt = () => {
        try {
          const p = window.screen.orientation.lock('landscape');
          if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (e) { /* best-effort only */ }
      };
      if (!document.fullscreenElement) {
        try {
          const p = document.documentElement.requestFullscreen();
          if (p && typeof p.then === 'function') p.then(lockIt).catch(() => {});
          else lockIt();
        } catch (e) { /* best-effort only */ }
      } else {
        lockIt();
      }
    } catch (e) { /* best-effort only — the rotate prompt covers it */ }
  }

  function togglePause() {
    if (!matchRunning || !hud) return;
    // A finished match cannot be paused — the winner overlay owns the box.
    if (matchOver) return;
    hud.setPaused(!hud.isPaused());
  }

  function startMatch(mode, charA, charB) {
    stopMatch(); // idempotent: a re-start disposes the old match first
    setFighters(charA, charB);
    lastMatch = { mode, charA, charB };
    const arenaScreen = document.getElementById('screen-arena');
    const arenaFrame = arenaScreen ? arenaScreen.querySelector('.arena-frame') : null;

    ctrlA = createFighterController({
      model: fighterA.model,
      animator: fighterA.animator,
      char: charA,
      getOpponentPosition: (out) => out.copy(fighterB.model.group.position),
      getCameraForward: (out) => fixedCamera.getForward(out),
    });
    ctrlB = createFighterController({
      model: fighterB.model,
      animator: fighterB.animator,
      char: charB,
      getOpponentPosition: (out) => out.copy(fighterA.model.group.position),
      getCameraForward: (out) => fixedCamera.getForward(out),
    });

    keyboard = createKeyboardInput({ onPauseKey: togglePause });
    keyboard.attach();
    keyboard.setEnabled(false); // enabled by beginMatch, after the screen swap

    if (arenaScreen) {
      hud = createHud(arenaScreen, {
        p1: charA,
        p2: charB,
        mode,
        before: arenaFrame,
        // Visual upgrade — the HUD overlays the canvas (mounted inside
        // the arena frame); the old `before` mount is the fallback.
        mountEl: arenaFrame,
        // The HUD Pause button bypasses togglePause(); its callback
        // owns the arena-side `paused` flag directly.
        onPause: () => {
          paused = true;
        },
        onResume: () => { paused = false; },
        onQuit: () => { if (opts.onQuitMatch) opts.onQuitMatch(); },
      });
    }
    if (arenaFrame) {
      touch = createTouchControls(arenaFrame, {});
      touch.setEnabled(false); // enabled by beginMatch (touch devices only)
    }

    // Phase 4 — combat. The combo tracker is created FIRST (the combat
    // scale callbacks close over it). PvC has no AI: combatB still
    // exists (it reacts — hitstun, block, KO) but the tick feeds it
    // ZERO_COMBAT, so it never initiates.
    // Phase 5 — specials + rounds. The controllers are created before
    // the combat objects (they close over them); the rounds system owns
    // the best-of-3 state for this match. The PvC CPU gets NO specials:
    // the tick feeds it ZERO_COMBAT, so its special edge never fires.
    combo = createComboTracker();
    specialA = createSpecialController({ fighterId: charA.id });
    specialB = createSpecialController({ fighterId: charB.id });
    rounds = createRoundSystem();
    const makeCombat = (which, char, ctrl, oppCtrl) => createFighterCombat({
      char,
      animator: which === 'A' ? fighterA.animator : fighterB.animator,
      getPosition: () => ctrl.position,
      getOpponentPosition: () => oppCtrl.position,
      getFacing: () => ctrl.facing,
      // Damage scale is for the NEXT hit (see comboSystem.js).
      getComboScale: () => combo.getScaleForNext(which),
      onEvent: (ev) => handleCombatEvent(which, ev),
      specialController: which === 'A' ? specialA : specialB,
      getSimTime: () => simSec,
    });
    combatA = makeCombat('A', charA, ctrlA, ctrlB);
    combatB = makeCombat('B', charB, ctrlB, ctrlA);
    audio = createCombatAudio({ enabled: opts.sound !== false });
    // Phase 5 — the Energy Blast projectile (Zara's Shadow Step).
    projectile = createProjectile({ scene });

    // Fixed side-view camera: created here, AFTER the controllers /
    // keyboard / HUD / touch exist (same order as before). The
    // controllers' getCameraForward closures above read this variable
    // when called, so they always see the fixed forward (0, 0, -1).
    fixedCamera = createFixedCamera();

    // Landscape-first (mobile): best-effort orientation lock, attempted
    // in the entry-gesture chain (still inside the transient-activation
    // window). The rotate prompt is the guarantee if it fails.
    tryOrientationLock();

    matchOver = false;
    hitstop = 0;
    simSec = 0;
    roundEndTimer = 0;
    roundEndResult = null;

    matchBuilt = true;
    matchRunning = false;
    paused = false;
  }

  // Fixed-camera fight start (no intro — the user removed it): engage
  // the permanent ortho pose, fade the near ropes, stop the orbit, then
  // show the FIGHT banner for 1.2 s (theatre mode: the arena fills the
  // viewport). Input + the HUD timer start only when the banner ends —
  // the tick counts introT down. Landscape-first (mobile): a phone held
  // in portrait waits for the rotate prompt — no camera engage, no
  // timer, no input until the phone is landscape (onResize fires the
  // gate again on rotation).
  function beginMatch() {
    if (!matchBuilt || matchRunning) return;
    if (isPhonePortrait()) {
      showRotatePrompt();
      return;
    }
    matchRunning = true;
    if (fixedCamera) {
      fixedCamera.engage(container.clientWidth / Math.max(1, container.clientHeight));
      renderCamera = fixedCamera.getCamera();
    }
    setNearRopesFaded(true);
    if (controls) { controls.enabled = false; controls.autoRotate = false; }
    document.body.classList.add('fighting');
    onResize();
    introT = 1.2;
    if (hud) hud.showFightBanner('FIGHT');
    // Blur any focused button so Enter/Space cannot re-trigger it
    // while they are also P2-run / P1-jump keys.
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  // Every arena entry is a live match: if a match was built, begin it;
  // if the user re-entered via the nav with no match built, start a
  // fresh one from the last confirmed pair. Safe to call repeatedly.
  function ensureMatch() {
    if (matchRunning) return;
    if (matchBuilt) { beginMatch(); return; }
    if (lastMatch) startMatch(lastMatch.mode, lastMatch.charA, lastMatch.charB);
    if (matchBuilt) beginMatch();
  }

  function stopMatch() {
    hideRotatePrompt();
    rotatePaused = false;
    introT = 0;
    victoryFighter = null;
    document.body.classList.remove('fighting');
    if (!matchBuilt && !matchRunning) return;
    if (keyboard) { keyboard.setEnabled(false); keyboard.detach(); keyboard = null; }
    if (touch) { touch.setEnabled(false); touch.dispose(); touch = null; }
    if (fixedCamera) { fixedCamera.disengage(); fixedCamera = null; }
    renderCamera = camera;
    setNearRopesFaded(false);
    if (hud) { hud.destroy(); hud = null; }
    // Phase 4 — combat teardown. Clear the pending hit-flash restore
    // first: it touches a model that stopMatch may rebuild next.
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = 0; }
    if (audio) { audio.dispose(); audio = null; }
    // Phase 5 — specials + rounds teardown.
    if (projectile) { projectile.dispose(); projectile = null; }
    projectileDef = null;
    projectileAttacker = null;
    projectileAttackerChar = null;
    specialA = null;
    specialB = null;
    rounds = null;
    roundEndTimer = 0;
    roundEndResult = null;
    combatA = null;
    combatB = null;
    if (combo) { combo.reset(); combo = null; }
    matchOver = false;
    hitstop = 0;
    ctrlA = null;
    ctrlB = null;
    matchBuilt = false;
    matchRunning = false;
    paused = false;
    // The selected pair stays in the ring as a preview; animators back
    // to idle and the free-orbit camera resumes.
    fighterA.animator.setState('idle');
    fighterB.animator.setState('idle');
    controls.target.set(0, 1.2, 0);
    controls.enabled = true;
    controls.autoRotate = true;
    onResize(); // theatre mode is off — the canvas goes back to 62vh
  }

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
    if (matchRunning && !paused && !matchOver) {
      // Live match (Phase 4 order — the contract): combat updates
      // BEFORE the movement controllers (hit tests use the pre-move
      // positions), movement is zeroed where combat locks it, then
      // controllers -> separation -> combat.syncAnimator() (re-asserts
      // combat poses AFTER the controllers, or attacks never show) ->
      // animators -> stadium/effects -> HUD sync.
      // In PvC the CPU fighter gets ZERO input (no AI) — it stands in
      // guard, facing the player. The P2 keys are still read (to consume
      // the jump/combat edges) but discarded outside 2P Local, so arrow
      // keys can never move the CPU fighter.
      if (introT > 0) {
        // FIGHT banner countdown: the crowd is alive and the fighters
        // breathe in guard, but there is no sim, no input and no timer
        // yet — the fight starts when the banner ends.
        introT -= dt;
        fighterA.animator.update(dt, t);
        fighterB.animator.update(dt, t);
        if (stadium) stadium.update(dt, t);
        if (effects) effects.update(dt);
        if (introT <= 0) {
          introT = 0;
          if (hud) hud.hideFightBanner();
          if (hud) hud.start();
          // Phase 5 — the intro is over: the rounds system moves
          // 'intro' -> 'fight'. (Round 1 is already 'fight', so this
          // is a no-op there; beginFight() guards on the phase.)
          if (rounds) rounds.beginFight();
          if (keyboard) keyboard.setEnabled(true);
          if (touch) touch.setEnabled(true);
        }
      } else {
      simSec += dt;
      if (combo) { combo.expire('A', simSec); combo.expire('B', simSec); }
      const p1in = readP1Input();
      const rawP2 = keyboard ? keyboard.getP2() : { ...ZERO_MOVE };
      const p2in = (lastMatch && lastMatch.mode === '2p') ? rawP2 : { ...ZERO_MOVE };
      const c1in = readCombatInput('p1', p1in);
      const c2in = readCombatInput('p2', rawP2); // consumed even in PvC
      const c2use = (lastMatch && lastMatch.mode === '2p') ? c2in : ZERO_COMBAT;
      if (hitstop > 0) {
        // Heavy-hit freeze: skip the sim (combat/controllers/
        // animators); the frame still renders (the fixed camera
        // never moves, so there is nothing to update).
        hitstop -= dt;
      } else {
        if (combatA) combatA.update(dt, c1in, combatB);
        if (combatB) combatB.update(dt, c2use, combatA);
        if (combatA && combatA.isMovementLocked()) { p1in.mx = 0; p1in.mz = 0; p1in.run = false; p1in.jump = false; }
        if (combatB && combatB.isMovementLocked()) { p2in.mx = 0; p2in.mz = 0; p2in.run = false; p2in.jump = false; }
        if (ctrlA) ctrlA.update(dt, p1in);
        if (ctrlB) ctrlB.update(dt, p2in);
        if (ctrlA && ctrlB) resolveSeparation(ctrlA, ctrlB);
        // Phase 5 — Energy Blast projectile: flies after separation
        // (so its hit test sees post-separation positions), before
        // syncAnimator (so a projectile hit poses in the same frame).
        // Frozen during hitstop (it lives in the sim branch) and
        // despawned on round reset / stopMatch.
        if (projectile && projectile.active) {
          const wasActive = projectile.active;
          projectile.update(dt);
          if (wasActive && !projectile.active) {
            // Despawned by max range — a whiff: ends the attacker's
            // outgoing combo (the blast never connected).
            if (projectileAttacker && combo) combo.recordWhiff(projectileAttacker);
          } else if (projectile.active) {
            if (effects) {
              const pp = projectile.position;
              effects.trail({ x: pp.x, y: pp.y, z: pp.z }, { color: FX_COLORS.steel });
            }
            const defId = projectileAttacker === 'A' ? 'B' : 'A';
            const defCombat = defId === 'A' ? combatA : combatB;
            const defPos = (defId === 'A' ? fighterA : fighterB).model.group.position;
            const dx = defPos.x - projectile.position.x;
            const dz = defPos.z - projectile.position.z;
            if (defCombat && projectileDef && Math.hypot(dx, dz) <= projectileDef.projectile.radius) {
              const attPos = { x: projectile.position.x, z: projectile.position.z };
              defCombat.receiveAttack(
                { ...projectileDef, id: 'special' },
                projectileAttackerChar,
                attPos,
                combo ? combo.getScaleForNext(projectileAttacker) : 1,
                'special',
              );
              projectile.despawn();
            }
          }
        }
        // If a KO landed during this tick's combat updates, onKo has
        // already set the winner 'victory' (and receiveAttack set the
        // loser 'ko' synchronously). syncAnimator would overwrite the
        // winner with the killing attack's anim for one frame, so skip
        // it — the matchOver branch owns both poses from here.
        if (!matchOver) {
          if (combatA) combatA.syncAnimator();
          if (combatB) combatB.syncAnimator();
        }
        // Visual upgrade — slide fix: feed each controller's measured
        // ground speed to its animator BEFORE animator.update().
        if (ctrlA) fighterA.animator.setSpeed(ctrlA.speed);
        if (ctrlB) fighterB.animator.setSpeed(ctrlB.speed);
        fighterA.animator.update(dt, t);
        fighterB.animator.update(dt, t);
        if (hud && combatA && combatB && combo) {
          hud.setHealth('p1', combatA.getHp(), combatA.getMaxHp());
          hud.setHealth('p2', combatB.getHp(), combatB.getMaxHp());
          hud.setCombo('p1', combo.getCount('A'));
          hud.setCombo('p2', combo.getCount('B'));
          // Phase 5 — special cooldown slots + round pips (every
          // frame; the HUD methods are change-guarded).
          if (specialA && specialB) {
            hud.setSpecial('p1', { name: specialA.move, frac: specialA.cooldownFrac(simSec), ready: specialA.isReady(simSec), remaining: specialA.remaining(simSec) });
            hud.setSpecial('p2', { name: specialB.move, frac: specialB.cooldownFrac(simSec), ready: specialB.isReady(simSec), remaining: specialB.remaining(simSec) });
          }
          if (rounds) hud.setRounds(rounds.round, rounds.wins.A, rounds.wins.B);
        }
        if (stadium) stadium.update(dt, t);
        if (effects) effects.update(dt);
      }
      }
      // No per-frame camera work in a match: the fixed pose was set in
      // beginMatch() and never changes. No controls.update() in fight
      // mode — OrbitControls is disabled and must not rotate the
      // (unrendered) perspective camera behind the fight.
    } else if (matchOver && !paused) {
      // KO frozen frame: the KO fall still blends (animator updates),
      // but nothing else moves and the camera holds its last pose.
      // The winner holds the victory pose (re-asserted here in case
      // the killing tick overwrote it) while the confetti falls and
      // the crowd surges.
      if (victoryFighter && victoryFighter.animator.getState() !== 'victory') {
        victoryFighter.animator.setState('victory');
      }
      fighterA.animator.update(dt, t);
      fighterB.animator.update(dt, t);
      if (stadium) stadium.update(dt, t);
      if (effects) effects.update(dt);
      // Phase 5 — round end: the 1.0 s freeze between a round KO and
      // the next round's intro. When it expires, beginNextRound()
      // resets the round and re-opens the live branch (matchOver =
      // false, introT = 1.2). A match-over KO never reaches here
      // (rounds.phase is 'matchEnd', not 'roundEnd').
      if (rounds && rounds.phase === 'roundEnd' && roundEndTimer > 0) {
        roundEndTimer -= dt;
        if (roundEndTimer <= 0) {
          roundEndTimer = 0;
          beginNextRound();
        }
      }
    } else if (!paused) {
      // Preview / idle: breathing + guard sway from the animator, free orbit.
      fighterA.animator.update(dt, t);
      fighterB.animator.update(dt, t);
      controls.update();
      if (stadium) stadium.update(dt, t);
      if (effects) effects.update(dt);
    }
    // While paused the frame is frozen (no sim, no camera) but still rendered.
    // Heavy-hit shake: advances only while the sim is NOT paused (user
    // pause and rotate pause freeze the frame, shake included). Runs in
    // the live match, through hitstop, and through the KO freeze so the
    // KO-blow shake settles to the exact pose. No-op when trauma is 0.
    if (fixedCamera && !paused) fixedCamera.update(dt);
    renderer.render(scene, renderCamera);
  }
  tick();
  onProgress(100, 'Arena ready');

  // Landscape-first rotate prompt (mobile): built once, hidden by
  // default. Lives on the arena screen (covers HUD + canvas) and is
  // shown only by the rotate gate (phone + portrait). No markup in
  // index.html by design — same pattern as the HUD, which hud.js builds.
  // #screen-arena is display:none outside the arena screen, so the
  // fixed overlay can never appear on menu / modes / select.
  {
    const arenaScreenEl = (typeof document !== 'undefined')
      ? document.getElementById('screen-arena') : null;
    if (arenaScreenEl) {
      rotatePromptEl = document.createElement('div');
      rotatePromptEl.className = 'rotate-prompt';
      rotatePromptEl.hidden = true;
      rotatePromptEl.setAttribute('role', 'dialog');
      rotatePromptEl.setAttribute('aria-label', 'Rotate your device to play');
      rotatePromptEl.innerHTML = '<div class="rotate-prompt-card">'
        + '<div class="rotate-prompt-glyph" aria-hidden="true">\u21bb</div>'
        + '<h2>Rotate your device to play</h2>'
        + '<p>Turn your phone sideways — the fight plays in landscape so both fighters stay big.</p>'
        + '</div>';
      arenaScreenEl.appendChild(rotatePromptEl);
    }
  }

  function onResize() {
    if (disposed) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    // Frustum only — the fixed pose never moves on resize.
    if (fixedCamera) fixedCamera.resize(w / Math.max(1, h));
    // A phone rotation fires resize: portrait pauses + shows the
    // prompt, landscape hides it and resumes / starts the fight.
    updateRotateGate();
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
    setFighters, // delegates to the closure-level setFighters above
    startMatch,
    beginMatch,
    ensureMatch,
    stopMatch,
    isMatchRunning: () => matchRunning,
    resize: onResize,
    dispose() {
      disposed = true;
      stopMatch(); // detach keyboard, dispose HUD/touch/camera first
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      if (stadium) stadium.dispose();
      if (effects) effects.dispose();
      if (rotatePromptEl && rotatePromptEl.parentNode) rotatePromptEl.parentNode.removeChild(rotatePromptEl);
      rotatePromptEl = null;
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
