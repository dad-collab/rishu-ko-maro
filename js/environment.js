// RISHU.COM — Neon Redesign Build A — environment.js
// Shared PMREM environment lighting (G1 visual half). One tiny
// procedural scene — a purple key panel, a red rim panel and a cool
// floor bounce — baked once per renderer into a PMREM env map, then
// shared by the arena, the character preview and the menu scene.
// One-time cost at load; the env map gives every Standard material a
// glossy reflection without a Reflector or a second render pass
// (a Reflector would double the draw calls; fake mirrored models are
// forbidden by the audit). Cached per renderer — never baked twice.
import * as THREE from 'three';

const cache = new WeakMap(); // renderer -> env map texture

export function getEnvironmentMap(renderer) {
  if (cache.has(renderer)) return cache.get(renderer);
  const envScene = new THREE.Scene();
  // Purple key (top-left), red rim (top-right), deep-purple bounce (below).
  const key = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 4),
    new THREE.MeshBasicMaterial({ color: 0xA855F7 })
  );
  key.position.set(-4, 5, 2);
  key.lookAt(0, 0, 0);
  envScene.add(key);
  const rim = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 3),
    new THREE.MeshBasicMaterial({ color: 0xDC2626 })
  );
  rim.position.set(4, 4, -3);
  rim.lookAt(0, 0, 0);
  envScene.add(rim);
  const bounce = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.MeshBasicMaterial({ color: 0x2E1B4D })
  );
  bounce.position.set(0, -3, 0);
  bounce.rotation.x = -Math.PI / 2; // faces up, toward the fighters
  envScene.add(bounce);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(envScene, 0.04).texture;
  pmrem.dispose();
  cache.set(renderer, envMap);
  return envMap;
}

// Contact shadow: a soft radial blob under a fighter, laid on the
// floor. Cheap (one quad per fighter), follows the fighter's XZ and
// fades/shrinks with jump height — the arena drives it every tick.
// The texture is shared module-level (one canvas for the whole game).
let contactShadowTexture = null;
export function getContactShadowTexture() {
  if (contactShadowTexture) return contactShadowTexture;
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.85)');
  g.addColorStop(0.6, 'rgba(0,0,0,0.4)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  contactShadowTexture = new THREE.CanvasTexture(c);
  return contactShadowTexture;
}
