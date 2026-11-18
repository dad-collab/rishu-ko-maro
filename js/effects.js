// RISHU.COM — Visual Upgrade DRAFT — effects.js
// Pooled particle system: impact bursts, rings, projectile trails and
// victory confetti. ONE module — Phase 5's planned `js/fx.js` is the same
// module under another name; whichever build lands first picks the name
// and the other uses it unchanged (see INTEGRATION-POINTS.md §3).
//
// Design (see STADIUM-DESIGN.md §5 + PRESENTATION-PLAN.md §5):
// - Fixed-size THREE.Points pool (default 512, mobile 256). No allocation
//   in update() — dead particles recycle into the free list.
// - No camera movement, no shake — particles only.
// - The projectile itself is Phase 5's (one mesh + light, reused); this
//   module only draws its trail points.
// - Colours are the redesigned tokens (ivory / burnt orange / steel blue)
//   passed in by callers — no hex in the game code beyond the token values.
//
// Draft only: the build copies this into js/ and wires it into arena.js
// (handleCombatEvent for hits, onKo for confetti) and Phase 5's specials.

import * as THREE from 'three';

// Token colours (neon palette — same values as the CSS tokens).
// Key names are kept so existing call sites survive the re-theme.
export const FX_COLORS = {
  ivory: 0xF5F0FF, // ink-white
  orange: 0xA855F7, // neon purple
  steel: 0x7C3AED, // violet
  gold: 0xC084FC, // bright purple — impact spark only, not a UI colour
};

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createEffects(scene, { maxParticles = 512 } = {}) {
  const max = Math.max(64, maxParticles);
  const positions = new Float32Array(max * 3);
  const colours = new Float32Array(max * 3);
  const sizes = new Float32Array(max);
  // Per-particle sim state (plain arrays — no per-frame allocation).
  const vel = new Float32Array(max * 3);
  const life = new Float32Array(max); // seconds left
  const maxLife = new Float32Array(max);
  const grav = new Float32Array(max);
  const alive = new Uint8Array(max);
  let freeList = [];
  for (let i = max - 1; i >= 0; i--) freeList.push(i);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
  geo.setDrawRange(0, 0);
  const mat = new THREE.PointsMaterial({
    size: 0.09, vertexColors: true, transparent: true, opacity: 0.95,
    depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false; // pool spans the whole arena
  scene.add(points);

  const _c = new THREE.Color();
  const _dir = new THREE.Vector3();
  const rand = mulberry32(0xC0FFEE);

  function spawn(x, y, z, vx, vy, vz, color, lifeSec, gravity, size) {
    const i = freeList.pop();
    if (i === undefined) return; // pool full — drop, never grow
    alive[i] = 1;
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
    vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
    _c.setHex(color);
    colours[i * 3] = _c.r; colours[i * 3 + 1] = _c.g; colours[i * 3 + 2] = _c.b;
    life[i] = lifeSec; maxLife[i] = lifeSec; grav[i] = gravity; sizes[i] = size;
  }

  function burst(pos, { color = FX_COLORS.gold, count = 14, speed = 3.2, life: lifeSec = 0.45, gravity = 6, size = 1 } = {}) {
    for (let n = 0; n < count; n++) {
      // Random direction on a sphere (seeded — deterministic per call order).
      const a = rand() * Math.PI * 2;
      const b = Math.acos(2 * rand() - 1);
      const s = speed * (0.5 + rand() * 0.8);
      _dir.set(Math.sin(b) * Math.cos(a), Math.cos(b) * 0.7 + 0.3, Math.sin(b) * Math.sin(a));
      spawn(pos.x, pos.y, pos.z, _dir.x * s, _dir.y * s, _dir.z * s,
        color, lifeSec * (0.7 + rand() * 0.6), gravity, size * (0.7 + rand() * 0.6));
    }
  }

  function ring(pos, { color = FX_COLORS.orange, count = 24, radius = 1.2, life: lifeSec = 0.5, size = 1 } = {}) {
    for (let n = 0; n < count; n++) {
      const a = (n / count) * Math.PI * 2;
      spawn(pos.x + Math.cos(a) * 0.2, pos.y, pos.z + Math.sin(a) * 0.2,
        Math.cos(a) * radius * 2.4, 0.4, Math.sin(a) * radius * 2.4,
        color, lifeSec, 0, size);
    }
  }

  function trail(pos, { color = FX_COLORS.steel, size = 0.8 } = {}) {
    spawn(pos.x, pos.y, pos.z, 0, 0, 0, color, 0.3, 0, size);
  }

  function confetti(pos, { colors = [FX_COLORS.ivory, FX_COLORS.orange, FX_COLORS.steel], count = 90 } = {}) {
    for (let n = 0; n < count; n++) {
      const a = rand() * Math.PI * 2;
      const s = 1.5 + rand() * 2.5;
      spawn(pos.x, pos.y, pos.z,
        Math.cos(a) * s, 2.5 + rand() * 3.5, Math.sin(a) * s,
        colors[n % colors.length], 1.2 + rand() * 0.8, 4, 1.2);
    }
  }

  // Impact flash (G1): a pooled additive sprite that pops on a heavy
  // hit and fades in ~0.12 s. Four sprites, recycled — never allocated
  // per hit. The arena calls flash() on heavy hits only.
  const flashTex = (() => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(192,132,252,0.8)');
    g.addColorStop(1, 'rgba(168,85,247,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const flashes = [];
  for (let n = 0; n < 4; n++) {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: flashTex, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    spr.scale.setScalar(0.01);
    spr.visible = false;
    scene.add(spr);
    flashes.push({ spr, life: 0 });
  }
  let flashIdx = 0;
  function flash(pos, { scale = 1.4 } = {}) {
    const f = flashes[flashIdx];
    flashIdx = (flashIdx + 1) % flashes.length;
    f.spr.position.set(pos.x, pos.y, pos.z);
    f.spr.scale.setScalar(scale);
    f.spr.material.opacity = 1;
    f.spr.visible = true;
    f.life = 0.12;
  }

  // Ground dust (G1): slow, low, wide-spreading particles in a dusty
  // purple-grey — kicked up on heavy hits and landings. The arena
  // calls dust() on heavy hits (floor-level position).
  function dust(pos, { count = 10, color = 0x8A7BA8 } = {}) {
    for (let n = 0; n < count; n++) {
      const a = rand() * Math.PI * 2;
      const sp = 0.6 + rand() * 1.2;
      spawn(pos.x, pos.y + 0.05, pos.z,
        Math.cos(a) * sp, 0.25 + rand() * 0.5, Math.sin(a) * sp,
        color, 0.55 + rand() * 0.3, 0.6, 0.9);
    }
  }

  function update(dt) {
    for (const f of flashes) {
      if (!f.spr.visible) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.spr.visible = false;
        f.spr.material.opacity = 0;
      } else {
        f.spr.material.opacity = f.life / 0.12;
        f.spr.scale.multiplyScalar(1 + dt * 6);
      }
    }
    // No compaction: dead particles sit at size 0 / y=-100 and the pool
    // always draws all `max` points (512 points is trivial for the GPU).
    // Compaction would need the free list to track slot identities across
    // swaps — a correctness trap for zero perf gain at this size.
    for (let i = 0; i < max; i++) {
      if (!alive[i]) continue;
      life[i] -= dt;
      if (life[i] <= 0) {
        alive[i] = 0;
        sizes[i] = 0;
        positions[i * 3 + 1] = -100; // park dead particles below the scene
        freeList.push(i);
        continue;
      }
      vel[i * 3 + 1] -= grav[i] * dt;
      positions[i * 3] += vel[i * 3] * dt;
      positions[i * 3 + 1] += vel[i * 3 + 1] * dt;
      positions[i * 3 + 2] += vel[i * 3 + 2] * dt;
      // Fade by shrinking (size attribute) — no per-particle opacity.
      sizes[i] = Math.max(0.01, sizes[i] * (1 - dt * 2));
    }
    geo.setDrawRange(0, max);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.attributes.size.needsUpdate = true;
  }

  function dispose() {
    scene.remove(points);
    for (const f of flashes) {
      scene.remove(f.spr);
      f.spr.material.dispose();
    }
    geo.dispose();
    mat.dispose();
  }

  return {
    burst, ring, trail, confetti, flash, dust, update, dispose,
    get liveCount() {
      let n = 0;
      for (let i = 0; i < max; i++) if (alive[i]) n++;
      return n;
    },
    get capacity() { return max; },
  };
}
