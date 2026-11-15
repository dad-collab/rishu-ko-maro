// RISHU.COM — Phase 4 — arena.js
// Three.js fighting-arena scene. Phase 4: full combat on top of the
// Phase 3 movement system — attacks, block, dodge, combos, deterministic
// damage, live health bars, KO. No rounds / Special / CPU AI yet
// (Phase 5). Responsibilities: scene, lighting, shadows, floor texture,
// camera, match lifecycle (startMatch / beginMatch / stopMatch), idle
// orbit, resize, visibility pause, quality switching.
//
// Tick order (Phase 4 — see PHASE4-PLAN.md §3; the order is the contract):
// combat updates BEFORE the movement controllers (hit tests use the
// pre-move positions), movement is zeroed where combat locks it, then
// controllers → separation → combat.syncAnimator() (re-asserts combat
// poses AFTER the controllers, or attacks never show) → animators →
// camera → HUD sync. The combat module is the ONLY decider of damage;
// this file routes inputs and events, never computes a hit itself.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildFighterModel } from './fighterModels.js';
import { createFighterAnimator } from './fighterAnimations.js';
import { createKeyboardInput, createFighterController, resolveSeparation } from './movement.js';
import { createFightCamera } from './camera.js';
import { createCinematicCamera } from './cinematicCamera.js';
import { createTouchControls } from './touchControls.js';
import { createHud } from './hud.js';
import { createFighterCombat, ATTACKS, DEFENSE, flashFighter } from './combat.js';
import { createComboTracker, comboScale } from './comboSystem.js';
import { createCombatAudio } from './combatAudio.js';

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

  const fill = new THREE.DirectionalLight(0x5B7A99, 0.55);
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
  // ---- Backdrop: dark arena walls + crowd light strips ----
  const wall = new THREE.Mesh(
    new THREE.CylinderGeometry(20, 20, 10, 48, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x0A1424, roughness: 0.95, side: THREE.BackSide })
  );
  wall.position.y = 5;
  scene.add(wall);

  // Light strips around the wall (restrained steel)
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.08, 0.08),
      new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? 0x5B7A99 : 0x2A3B52 })
    );
    strip.position.set(Math.cos(a) * 19.5, 6.5, Math.sin(a) * 19.5);
    strip.lookAt(0, 6.5, 0);
    scene.add(strip);
  }

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
  let fightCamera = null;
  let cinematic = null;
  let keyboard = null;
  let touch = null;
  let hud = null;
  // Phase 4 — combat state. matchOver: a KO has frozen the match (the
  // KO overlay owns the screen until Rematch/Quit). hitstop: seconds of
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

  const ZERO_MOVE = { mx: 0, mz: 0, run: false, jump: false };
  const ZERO_COMBAT = { attack: null, block: false, blockLow: false, dodge: false, evade: false, grounded: true };

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
    if (!fightCamera) return null;
    fightCamera.getForward(_fwdV);
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
      : { attack: null, block: false, blockLow: false, dodge: false, evade: false };
    const tc = (isP1 && touch) ? touch.consumeCombat() : null;
    const ctrl = isP1 ? ctrlA : ctrlB;
    return {
      attack: kb.attack || (tc && tc.attack) || null,
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
    if (hud && lastMatch) {
      const winnerChar = winnerId === 'A' ? lastMatch.charA : lastMatch.charB;
      hud.showKo(winnerChar ? winnerChar.name : 'Winner',
        () => { // Rematch: same mode, same pair, fresh match + intro again
          if (lastMatch) {
            startMatch(lastMatch.mode, lastMatch.charA, lastMatch.charB);
            beginMatch();
          }
        },
        () => { if (opts.onQuitMatch) opts.onQuitMatch(); });
    }
  }

  function handleCombatEvent(id, ev) {
    const attackerId = id === 'A' ? 'B' : 'A';
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
        const def = ATTACKS[ev.attack];
        if (def && def.shake > 0 && fightCamera) fightCamera.addShake(def.shake);
        if (def && def.shake > 0) {
          hitstop = ev.attack === 'heavyKick' ? DEFENSE.HITSTOP_HEAVY_KICK : DEFENSE.HITSTOP_HEAVY;
        }
        if (ev.ko) onKo(attackerId);
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

  function togglePause() {
    if (!matchRunning || !hud) return;
    // A finished match cannot be paused — the KO overlay owns the box.
    if (matchOver) return;
    // Pause is a no-op while the cinematic intro is playing (there is
    // nothing to pause yet, and pausing would freeze the intro mid-sweep).
    if (cinematic && cinematic.getState() === 'playing') return;
    hud.setPaused(!hud.isPaused());
  }

  function startMatch(mode, charA, charB) {
    stopMatch(); // idempotent: a re-start disposes the old match first
    setFighters(charA, charB);
    lastMatch = { mode, charA, charB };
    const arenaScreen = document.getElementById('screen-arena');
    const arenaFrame = arenaScreen ? arenaScreen.querySelector('.arena-frame') : null;

    fightCamera = createFightCamera({
      camera,
      controls,
      domElement: renderer.domElement,
      // camera.js calls these with an output vector — copy into it
      // (returning the position would be discarded and the midpoint
      // would stay stale at the origin).
      getFighterA: (out) => out.copy(fighterA.model.group.position),
      getFighterB: (out) => out.copy(fighterB.model.group.position),
    });

    ctrlA = createFighterController({
      model: fighterA.model,
      animator: fighterA.animator,
      char: charA,
      getOpponentPosition: (out) => out.copy(fighterB.model.group.position),
      getCameraForward: (out) => fightCamera.getForward(out),
    });
    ctrlB = createFighterController({
      model: fighterB.model,
      animator: fighterB.animator,
      char: charB,
      getOpponentPosition: (out) => out.copy(fighterA.model.group.position),
      getCameraForward: (out) => fightCamera.getForward(out),
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
        // The HUD Pause button bypasses togglePause(), so the intro
        // guard lives here too: a pause pressed mid-intro is undone
        // synchronously (overlay never paints) and the sweep continues.
        onPause: () => {
          if (cinematic && cinematic.getState() === 'playing') {
            if (hud) hud.setPaused(false);
            return;
          }
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
    combo = createComboTracker();
    const makeCombat = (which, char, ctrl, oppCtrl) => createFighterCombat({
      char,
      animator: which === 'A' ? fighterA.animator : fighterB.animator,
      getPosition: () => ctrl.position,
      getOpponentPosition: () => oppCtrl.position,
      getFacing: () => ctrl.facing,
      // Damage scale is for the NEXT hit (see comboSystem.js).
      getComboScale: () => combo.getScaleForNext(which),
      onEvent: (ev) => handleCombatEvent(which, ev),
    });
    combatA = makeCombat('A', charA, ctrlA, ctrlB);
    combatB = makeCombat('B', charB, ctrlB, ctrlA);
    audio = createCombatAudio({ enabled: opts.sound !== false });

    matchOver = false;
    hitstop = 0;
    simSec = 0;

    // Cinematic intro: created here, AFTER fightCamera/HUD/input exist
    // (start() can call onDone synchronously on reduced motion), but
    // only STARTED by beginMatch() once the arena screen is visible.
    cinematic = createCinematicCamera({
      camera,
      domElement: renderer.domElement,
      getFighterA: (out) => out.copy(fighterA.model.group.position),
      getFighterB: (out) => out.copy(fighterB.model.group.position),
      onDone: finishIntro,
    });

    matchBuilt = true;
    matchRunning = false;
    paused = false;
  }

  function beginMatch() {
    if (!matchBuilt || matchRunning) return;
    matchRunning = true;
    // Cinematic intro first; finishIntro() below starts the fight when
    // the sweep is done (or skipped, or reduced-motion). Input stays
    // locked and the HUD timer unstarted until then.
    if (cinematic) cinematic.start();
    // Blur any focused button so Enter/Space cannot re-trigger it
    // while they are also P2-run / P1-jump keys.
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  // Runs exactly once per intro (the cinematic guards its own finish):
  // hands the live camera pose to the fight camera, then starts the
  // HUD timer and enables input — so the timer counts FIGHT time.
  function finishIntro() {
    if (!matchBuilt) return; // user left during the intro
    if (fightCamera) fightCamera.startFight();
    if (hud) hud.start();
    if (keyboard) keyboard.setEnabled(true);
    if (touch) touch.setEnabled(true);
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
    if (!matchBuilt && !matchRunning) return;
    if (keyboard) { keyboard.setEnabled(false); keyboard.detach(); keyboard = null; }
    if (touch) { touch.setEnabled(false); touch.dispose(); touch = null; }
    if (cinematic) { cinematic.dispose(); cinematic = null; }
    if (fightCamera) { fightCamera.dispose(); fightCamera = null; }
    if (hud) { hud.destroy(); hud = null; }
    // Phase 4 — combat teardown. Clear the pending hit-flash restore
    // first: it touches a model that stopMatch may rebuild next.
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = 0; }
    if (audio) { audio.dispose(); audio = null; }
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
      // animators -> camera -> HUD sync.
      // In PvC the CPU fighter gets ZERO input (no AI) — it stands in
      // guard, facing the player. The P2 keys are still read (to consume
      // the jump/combat edges) but discarded outside 2P Local, so arrow
      // keys can never move the CPU fighter.
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
        // animators); the camera still updates and the frame renders.
        hitstop -= dt;
      } else {
        if (combatA) combatA.update(dt, c1in, combatB);
        if (combatB) combatB.update(dt, c2use, combatA);
        if (combatA && combatA.isMovementLocked()) { p1in.mx = 0; p1in.mz = 0; p1in.run = false; p1in.jump = false; }
        if (combatB && combatB.isMovementLocked()) { p2in.mx = 0; p2in.mz = 0; p2in.run = false; p2in.jump = false; }
        if (ctrlA) ctrlA.update(dt, p1in);
        if (ctrlB) ctrlB.update(dt, p2in);
        if (ctrlA && ctrlB) resolveSeparation(ctrlA, ctrlB);
        if (combatA) combatA.syncAnimator();
        if (combatB) combatB.syncAnimator();
        fighterA.animator.update(dt, t);
        fighterB.animator.update(dt, t);
        if (hud && combatA && combatB && combo) {
          hud.setHealth('p1', combatA.getHp(), combatA.getMaxHp());
          hud.setHealth('p2', combatB.getHp(), combatB.getMaxHp());
          hud.setCombo('p1', combo.getCount('A'));
          hud.setCombo('p2', combo.getCount('B'));
        }
      }
      // Cinematic intro owns the camera until it hands off; the fight
      // camera takes over after that (never both in one frame).
      if (cinematic && cinematic.getState() === 'playing') cinematic.update(dt);
      else if (fightCamera) fightCamera.update(dt);
      // No controls.update() in fight mode — OrbitControls is disabled
      // and must not fight the camera lerp.
    } else if (matchOver && !paused) {
      // KO frozen frame: the KO fall still blends (animator updates),
      // but nothing else moves and the camera holds its last pose.
      fighterA.animator.update(dt, t);
      fighterB.animator.update(dt, t);
    } else if (!paused) {
      // Preview / idle: breathing + guard sway from the animator, free orbit.
      fighterA.animator.update(dt, t);
      fighterB.animator.update(dt, t);
      controls.update();
    }
    // While paused the frame is frozen (no sim, no camera) but still rendered.
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
