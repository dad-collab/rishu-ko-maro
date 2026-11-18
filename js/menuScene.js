// RISHU.COM — Neon Redesign Build A — menuScene.js
// The main menu's two-fighter cinematic scene (does not exist before
// Build A): Rishu (left, facing right) vs Ayaan (right, facing left),
// idle animations, standing on the arena floor under the purple/red
// light rig, with the logo lockup overlaid by the page (index.html).
// ONE shared scene + ONE renderer, low pixel ratio, paused whenever
// the menu screen is hidden (menu.js drives start/stop). No
// drag-to-rotate: the scene is a backdrop, not a preview — the
// character select screen keeps the interactive preview.
// Built on buildFighterModel + createFighterAnimator + the shared
// PMREM env (environment.js). No gameplay, no camera movement.
import * as THREE from 'three';
import { buildFighterModel } from './fighterModels.js';
import { createFighterAnimator } from './fighterAnimations.js';
import { getCharacter } from './characters.js';
import { getEnvironmentMap, getContactShadowTexture } from './environment.js';

export function createMenuScene(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0A0612);
  scene.fog = new THREE.Fog(0x0A0612, 10, 26);
  scene.environment = getEnvironmentMap(renderer);

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 60);
  camera.position.set(0, 2.1, 7.2);
  camera.lookAt(0, 1.3, 0);

  // Light rig (G1): purple key, red rim, cool fill — the same light
  // count the arena uses, recolored for the neon palette.
  scene.add(new THREE.AmbientLight(0x8a93a8, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 2.0);
  key.position.set(4, 6, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x7C3AED, 0.8);
  fill.position.set(-6, 4, -2);
  scene.add(fill);
  const rim = new THREE.SpotLight(0xDC2626, 90, 30, 0.7, 0.5);
  rim.position.set(0, 7, -5);
  scene.add(rim);

  // Floor: glossy dark disc + a neon ring (the arena's centre mark,
  // restyled). envMap on the floor material gives the gloss.
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x120A1E, roughness: 0.3, metalness: 0.1 });
  floorMat.envMapIntensity = 1.4;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 48), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(3.2, 0.03, 8, 64),
    new THREE.MeshBasicMaterial({ color: 0xA855F7 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  scene.add(ring);

  // Fighters: Rishu left facing right, Ayaan right facing left.
  // Rishu's model carries the photo face cap (fighterModels.js).
  const fighters = [];
  for (const [id, x, rotY] of [['rishu', -1.7, Math.PI / 2], ['ayaan', 1.7, -Math.PI / 2]]) {
    const char = getCharacter(id);
    const m = buildFighterModel(char);
    m.group.position.set(x, 0, 0);
    m.group.rotation.y = rotY;
    scene.add(m.group);
    // The animator takes the MODEL object ({ group, parts }), not the
    // group — passing the group throws (parts is undefined).
    const animator = createFighterAnimator(m, { initial: 'idle' });
    fighters.push({ group: m.group, animator });
  }

  // Contact shadows: soft radial blobs under each fighter (G1).
  const shadowTex = getContactShadowTexture();
  for (const { group } of fighters) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 1.1),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.55 })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(group.position.x, 0.02, group.position.z);
    scene.add(m);
  }

  let running = false;
  let raf = 0;
  let last = performance.now();
  let t = 0;
  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  function loop(now) {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    t += dt;
    for (const f of fighters) f.animator.update(dt, t);
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  }
  function start() {
    if (running) return;
    running = true;
    resize();
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }
  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }
  function dispose() {
    stop();
    renderer.dispose();
    if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
  }
  resize();
  return { start, stop, resize, dispose, renderer, scene };
}
