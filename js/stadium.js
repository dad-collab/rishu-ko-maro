// RISHU.COM — Visual Upgrade — stadium.js
// Detailed 3D fighting stadium: tiered stands, instanced crowd, banners,
// jumbotron, light rig. Mounted by arena.js (buildStadium called once in
// createArena, after the ropes). Pure Three.js, no external assets —
// banners and the jumbotron are CanvasTextures, like the floor texture.
//
// Budgets (see STADIUM-DESIGN.md §5): stadium ≤ 25 draw calls, crowd
// 2 (InstancedMesh), desktop 500 / mobile 250 spectators, no crowd
// shadows, subset bob only. Nothing here is inside r<7 (the playable
// area + camera foreground stay clear).
//
// Framing note (measured against the real fixed ortho camera — pose
// (0, 4.04, 12), lookAt (0, 2.35, 0), H = max(2.51, 5.25/aspect) —
// with updateMatrixWorld, corners, at BOTH live aspects 2.87 and
// 1.78, plus a raycast occlusion check): the 8° downward tilt drops
// the far frame centre to y≈0.4 at z=-14, so the visible band there
// is y ∈ [-2.1, 2.9] (62vh box) / [-2.6, 3.3] (theatre) — the audit's
// "[1.78, 6.85]" ignored the tilt and was wrong. Worse, the tiered
// stands are SOLID lathe rings: anything at z≤-12 sits behind the
// rising staircase and is occluded. So the jumbotron (6×2.6, centre
// y=1.4) and the fight-visible banners (1.6×2.8, x=±4.3, centre y=1.4)
// sit on the apron at z=-7.0, 1 m in front of the first stand ring
// (r=8), with the crowd rising behind and above them. The flank
// banners (x=±13.5) and the truss (y=8.5) show only in the orbit
// preview — that is expected, not a bug. The near half of the stadium
// is behind the fight camera and only shows in the preview.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Restrained crowd palette (brand tokens + muted variation — no neon).
const CROWD_COLORS = [0xF5F0FF, 0xB8A8D9, 0x7C3AED, 0x4C2D7A, 0xA855F7, 0x2E1B4D, 0x8A8F9E, 0xC9CDD3];

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function textTexture({ w = 1024, h = 512, lines, bg = '#0A0612', fg = '#F5F0FF', accent = '#A855F7' }) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = accent;
  g.fillRect(0, h - Math.round(h * 0.04), w, Math.round(h * 0.04));
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const n = lines.length;
  // Font sizes scale with the canvas height (4K bar: the jumbotron is
  // 1024x512 and the banners 512x1024 now) so the layout stays
  // identical to the old 512x256 / 256x512 canvases, just sharper.
  lines.forEach((line, i) => {
    g.font = `${i === 0 ? '900' : '700'} ${Math.round(h * (i === 0 ? 0.25 : 0.133))}px "Archivo Black", Arial, sans-serif`;
    g.fillText(line, w / 2, (h / (n + 1)) * (i + 1));
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// Stand rings: [innerR, outerR, y0, y1] — steps ascend away from the ring.
const STAND_RINGS = [
  { inner: 8, outer: 11, y0: 0.6, y1: 1.8, steps: 2 },
  { inner: 12, outer: 15, y0: 2.0, y1: 3.6, steps: 3 },
  { inner: 16, outer: 19, y0: 3.8, y1: 5.0, steps: 2 },
];

// One lathe profile per ring: a closed staircase cross-section
// (bottom → outer wall → top tread → risers/treads down to the inner
// wall → floor). One mesh per ring — treads, risers and walls in a
// single draw call; the key light shades treads vs risers so the steps
// read without extra trim geometry.
function standProfile(ring) {
  const { inner: r0, outer: r1, y0, y1, steps: n } = ring;
  const stepH = (y1 - y0) / n;
  const stepW = (r1 - r0) / n;
  const pts = [new THREE.Vector2(r0, 0), new THREE.Vector2(r1, 0), new THREE.Vector2(r1, y1)];
  for (let i = n - 1; i >= 0; i--) {
    // Top tread of step i, then its riser down to the next tread.
    pts.push(new THREE.Vector2(r0 + i * stepW, y0 + (i + 1) * stepH));
    if (i > 0) pts.push(new THREE.Vector2(r0 + i * stepW, y0 + i * stepH));
  }
  pts.push(new THREE.Vector2(r0, 0));
  return pts;
}

// Merge static same-material geometry into one draw call. The arena
// measured 120 draw calls on a phone vs the ≤110 budget, and these
// groups are fully static — no per-object updates, no fading — so
// merging is free performance. Parts are fresh single-use geometries:
// the helper applies the placement matrix, merges, then disposes the
// inputs. Placement reuses a dummy Object3D so the merge uses three's
// own rotation/lookAt math instead of hand-derived angles.
const _dummy = new THREE.Object3D();
function placedMatrix(x, y, z, rotX = 0) {
  _dummy.position.set(x, y, z);
  _dummy.rotation.set(rotX, 0, 0);
  _dummy.updateMatrix();
  return _dummy.matrix.clone();
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

export function buildStadium(scene, { quality = 'high', crowdCount } = {}) {
  const count = crowdCount || (quality === 'low' ? 250 : 500);
  const group = new THREE.Group();
  group.name = 'stadium';
  const disposables = [];

  const navyMat = new THREE.MeshStandardMaterial({ color: 0x0A0612, roughness: 0.95, side: THREE.DoubleSide });
  const navy2Mat = new THREE.MeshStandardMaterial({ color: 0x120A1E, roughness: 0.9, side: THREE.DoubleSide });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xA855F7, roughness: 0.5, metalness: 0.3 });

  // ---- Tiered stands (lathe meshes + one nosing torus per ring) ----
  // Rings 0 and 2 share navyMat, so they merge into one draw call;
  // ring 1 (navy2Mat) stays separate. The 3 nosing toruses share
  // trimMat and merge into one. (Draw-call merge, 2026-11-16: the
  // arena measured 120 calls on a phone vs the ≤110 budget.)
  const navyRings = STAND_RINGS.filter((_, ri) => ri % 2 === 0);
  const navy2Rings = STAND_RINGS.filter((_, ri) => ri % 2 === 1);
  for (const rings of [navyRings, navy2Rings]) {
    const step = mergedMesh(
      rings.map((ring) => ({ geo: new THREE.LatheGeometry(standProfile(ring), 48) })),
      rings[0] === STAND_RINGS[0] ? navyMat : navy2Mat,
    );
    step.receiveShadow = true;
    group.add(step);
  }
  group.add(mergedMesh(
    STAND_RINGS.map((ring) => ({
      geo: new THREE.TorusGeometry(ring.outer, 0.035, 6, 64),
      matrix: placedMatrix(0, ring.y1, 0, Math.PI / 2),
    })),
    trimMat,
  ));

  // ---- Crowd (2 InstancedMeshes: bodies + heads) ----
  // Seated on the step treads: pick a ring, then a step inside it, then
  // a radius inside that step's band. Seat y is the tread top; the body
  // capsule centre sits 0.34 above it so the figure sits ON the tread
  // (capsule half-height 0.335), head 0.42 above the body centre.
  const rand = mulberry32(0x51A01A);
  const bodyGeo = new THREE.CapsuleGeometry(0.16, 0.35, 4, 8);
  const headGeo = new THREE.SphereGeometry(0.13, 10, 8);
  const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0x8a6a52, roughness: 0.8 });
  const bodies = new THREE.InstancedMesh(bodyGeo, bodyMat, count);
  const heads = new THREE.InstancedMesh(headGeo, headMat, count);
  bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  heads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3(1, 1, 1);
  const _p = new THREE.Vector3();
  const _c = new THREE.Color();
  const _up = new THREE.Vector3(0, 1, 0);
  const seatBase = []; // {x, z, y} per spectator — bob reads this, never the matrix
  for (let i = 0; i < count; i++) {
    const ring = STAND_RINGS[Math.floor(rand() * STAND_RINGS.length)];
    const stepH = (ring.y1 - ring.y0) / ring.steps;
    const stepW = (ring.outer - ring.inner) / ring.steps;
    const step = Math.floor(rand() * ring.steps);
    const r = ring.inner + step * stepW + 0.35 + rand() * (stepW - 0.7);
    const a = rand() * Math.PI * 2;
    const y = ring.y0 + stepH * (step + 1); // tread top
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    seatBase.push({ x, z, y });
    // Face the ring (yaw toward centre) with a little scatter.
    _q.setFromAxisAngle(_up, Math.atan2(-x, -z) + (rand() - 0.5) * 0.3);
    _p.set(x, y + 0.34, z);
    _m.compose(_p, _q, _s);
    bodies.setMatrixAt(i, _m);
    _p.set(x, y + 0.76, z);
    _m.compose(_p, _q, _s);
    heads.setMatrixAt(i, _m);
    _c.setHex(CROWD_COLORS[Math.floor(rand() * CROWD_COLORS.length)]);
    bodies.setColorAt(i, _c);
  }
  bodies.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  group.add(bodies, heads);

  // ---- Banners (canvas textures) ----
  // The far pair flanks the jumbotron on the apron (z=-7.0, just in
  // front of the first stand ring, r=8); the flank pair shows in the
  // orbit preview. Navy field, ivory text, orange rule.
  // FRAMING + OCCLUSION (measured in E2E + raycast, 2026-11-16): the
  // audit's "[1.78, 6.85]" band at z=-14 was wrong — it ignored the
  // camera's 8° downward tilt, which drops the far frame centre to
  // y≈0.4 at z=-14, so the visible band there is y ∈ [-2.1, 2.9] at
  // the 62vh-box aspect and [-2.6, 3.3] in theatre. Worse, the tiered
  // stands are SOLID lathe rings: anything at z≤-12 sits behind the
  // rising staircase and is occluded (raycast: first hit LatheGeometry,
  // not the screen). So the far elements hang LOW on the apron
  // (centre y=1.4, spans y 0–2.8) like drapes behind the ring, with
  // the crowd rising behind and above them. The flank pair keeps the
  // tall 1.6×3.2 at y=4.5 for the orbit preview, where it is visible.
  const bannerNames = ['RISHU', 'AYAAN', 'KABIR', 'ZARA'];
  const bannerPositions = [
    [-4.3, 1.4, -7.0, 0, 2.8], [4.3, 1.4, -7.0, 0, 2.8],
    [-13.5, 4.5, -6, Math.PI / 2, 3.2], [13.5, 4.5, -6, -Math.PI / 2, 3.2],
  ];
  bannerPositions.forEach(([x, y, z, ry, h], i) => {
    const tex = textTexture({
      w: 512, h: 1024,
      lines: ['RISHU.COM', bannerNames[i % bannerNames.length]],
    });
    disposables.push(tex);
    const b = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, h),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide }),
    );
    b.position.set(x, y, z);
    b.rotation.y = ry;
    group.add(b);
  });

  // ---- Jumbotron (emissive screen, far side, behind the ring) ----
  // On the apron at z=-7.0 (r=7.0 at x=0, 1 m in front of the first
  // stand ring, r=8), centre y=1.4, spans y 0.1–2.7 — inside the
  // fixed fight frame at both live aspects AND in front of the solid
  // stands (see the FRAMING note above: at z=-14 it was both above
  // the frame and occluded by the staircase). It reads as a big end
  // screen behind the ring, crowd visible above and around it.
  let jumboTex = textTexture({ w: 1024, h: 512, lines: ['RISHU.COM', '— vs —'] });
  disposables.push(jumboTex);
  const jumbo = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 2.6),
    new THREE.MeshStandardMaterial({
      map: jumboTex, emissive: 0xffffff, emissiveMap: jumboTex,
      emissiveIntensity: 0.7, roughness: 0.6,
    }),
  );
  jumbo.position.set(0, 1.4, -7.0);
  group.add(jumbo);
  const jumboFrame = new THREE.Mesh(
    new THREE.BoxGeometry(6.4, 3.0, 0.15),
    new THREE.MeshStandardMaterial({ color: 0x120A1E, roughness: 0.4, metalness: 0.5 }),
  );
  jumboFrame.position.set(0, 1.4, -7.15);
  group.add(jumboFrame);

  // ---- Light rig: truss + visible cones (additive, no light) ----
  // The 4 cones share one geometry + material and merge into a single
  // draw call (same draw-call merge as the stands above).
  const trussMat = new THREE.MeshStandardMaterial({ color: 0x2E1B4D, roughness: 0.4, metalness: 0.6 });
  const truss = new THREE.Mesh(new THREE.TorusGeometry(6.5, 0.12, 8, 48), trussMat);
  truss.rotation.x = Math.PI / 2;
  truss.position.y = 8.5;
  group.add(truss);
  const coneMat = new THREE.MeshBasicMaterial({
    color: 0xE9D5FF, transparent: true, opacity: 0.05,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  group.add(mergedMesh(
    [[-4, 3], [4, 3], [-4, -3], [4, -3]].map(([x, z]) => ({
      geo: new THREE.ConeGeometry(2.2, 8, 24, 1, true),
      matrix: placedMatrix(x, 4.5, z),
    })),
    coneMat,
  ));

  // Warm wash over the far crowd (no shadows).
  const wash = new THREE.PointLight(0xC084FC, 12, 30, 1.8);
  wash.position.set(0, 6, -12);
  group.add(wash);

  scene.add(group);

  // ---- Crowd bob: a rotating ~10% slice every ~100 ms ----
  let excitement = 0; // 0–1, set by the arena on heavy hits / KO, decays
  let bobClock = 0;
  let bobSlice = 0;
  const bobStep = Math.max(1, Math.floor(count / 10));

  function update(dt) {
    excitement = Math.max(0, excitement - dt * 0.6);
    bobClock += dt;
    if (bobClock < 0.1) return;
    bobClock = 0;
    const amp = 0.03 + excitement * 0.09;
    for (let k = 0; k < bobStep; k++) {
      const i = (bobSlice + k) % count;
      const seat = seatBase[i];
      const bounce = Math.abs(Math.sin((performance.now() / 380 + i * 0.7))) * amp;
      _q.setFromAxisAngle(_up, Math.atan2(-seat.x, -seat.z));
      _p.set(seat.x, seat.y + 0.34 + bounce, seat.z);
      _m.compose(_p, _q, _s);
      bodies.setMatrixAt(i, _m);
      _p.set(seat.x, seat.y + 0.76 + bounce, seat.z);
      _m.compose(_p, _q, _s);
      heads.setMatrixAt(i, _m);
    }
    bobSlice = (bobSlice + bobStep) % count;
    bodies.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
  }

  function setMatchup(charA, charB) {
    const a = charA ? charA.name || 'P1' : 'P1';
    const b = charB ? charB.name || 'P2' : 'P2';
    const next = textTexture({ w: 1024, h: 512, lines: ['RISHU.COM', `${a}  vs  ${b}`] });
    const old = jumboTex;
    jumbo.material.map = next;
    jumbo.material.emissiveMap = next;
    jumbo.material.needsUpdate = true;
    jumboTex = next;
    if (old) old.dispose(); // one texture per match start — never accumulate
  }

  function setExcitement(level) {
    excitement = Math.max(excitement, Math.min(1, level || 0));
  }

  function dispose() {
    scene.remove(group);
    group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
      }
    });
    disposables.forEach((t) => t.dispose());
  }

  return { update, setMatchup, setExcitement, dispose, crowdCount: count };
}
