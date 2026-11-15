// RISHU.COM — Phase 2 — fighterModels.js
// Procedural low-poly 3D fighter models (Three.js, no external assets,
// no static images). Every fighter is built from the same jointed rig
// but with a distinct silhouette: body proportions, outfit, hairstyle
// and accessories all come from the fighter's `model` spec in
// characters.js, so no two fighters look alike.
//
// Rig (all pivots are THREE.Group so the animator can rotate limbs):
//   group (root, faces +Z) -> hips -> torso -> headGroup
//   group -> armL / armR (shoulder pivots), legL / legR (hip pivots)
// Returned parts: { group, torso, head, armL, armR, legL, legR, ring? }
//
// PHASE 3 HOOK (combat): the animator in fighterAnimations.js already
// exposes setState('punch' | 'kick' | 'block' | 'hit' | 'ko') as a
// reserved API surface — Phase 3 implements those poses here by
// rotating the same arm/leg pivots, and reads char.strength /
// char.special / char.specialMove for damage. No combat runs in Phase 2.

import * as THREE from 'three';

const BUILD = {
  slim: { shoulder: 0.52, torsoW: 0.5, torsoH: 0.72, hipW: 0.48, limbR: 0.075 },
  average: { shoulder: 0.62, torsoW: 0.6, torsoH: 0.78, hipW: 0.56, limbR: 0.09 },
  broad: { shoulder: 0.74, torsoW: 0.72, torsoH: 0.8, hipW: 0.66, limbR: 0.105 },
  tall: { shoulder: 0.58, torsoW: 0.54, torsoH: 0.86, hipW: 0.5, limbR: 0.08 },
};

function mat(color, roughness = 0.65, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function mesh(geo, material, x = 0, y = 0, z = 0, castShadow = true) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = castShadow;
  return m;
}

function addHair(headGroup, style, hairMat, skinMat) {
  // Distinct hairstyles — one geometry family per fighter.
  const R = 0.235;
  if (style === 'spiky') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const spike = mesh(
        new THREE.ConeGeometry(0.07, 0.22, 6),
        hairMat,
        Math.cos(a) * 0.1, 0.3, Math.sin(a) * 0.1
      );
      spike.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      headGroup.add(spike);
    }
    headGroup.add(mesh(new THREE.SphereGeometry(R * 0.98, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.45), hairMat, 0, 0.05, 0));
  } else if (style === 'mohawk') {
    const ridge = mesh(new THREE.BoxGeometry(0.09, 0.22, 0.42), hairMat, 0, 0.28, 0);
    ridge.rotation.x = 0.15;
    headGroup.add(ridge);
  } else if (style === 'flat-top') {
    headGroup.add(mesh(new THREE.BoxGeometry(0.4, 0.14, 0.4), hairMat, 0, 0.28, 0));
  } else if (style === 'ponytail') {
    headGroup.add(mesh(new THREE.SphereGeometry(R * 0.98, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), hairMat, 0, 0.04, 0));
    const tail = mesh(new THREE.CylinderGeometry(0.06, 0.045, 0.5, 8), hairMat, 0, 0.05, -0.3);
    tail.rotation.x = 0.9;
    headGroup.add(tail);
    const tie = mesh(new THREE.TorusGeometry(0.07, 0.02, 8, 16), mat(0xBC5222, 0.5), 0, 0.18, -0.2);
    tie.rotation.x = 0.9;
    headGroup.add(tie);
  } else if (style === 'braid') {
    headGroup.add(mesh(new THREE.SphereGeometry(R * 0.98, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), hairMat, 0, 0.04, 0));
    for (let i = 0; i < 3; i++) {
      const seg = mesh(new THREE.SphereGeometry(0.075 - i * 0.012, 10, 8), hairMat, 0, -0.02 - i * 0.14, -0.26 - i * 0.02);
      headGroup.add(seg);
    }
  } else if (style === 'topknot') {
    headGroup.add(mesh(new THREE.SphereGeometry(R * 0.98, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.45), hairMat, 0, 0.05, 0));
    headGroup.add(mesh(new THREE.SphereGeometry(0.09, 12, 10), hairMat, 0, 0.32, 0));
    headGroup.add(mesh(new THREE.TorusGeometry(0.09, 0.018, 8, 16), mat(0xBC5222, 0.5), 0, 0.28, 0));
  } else if (style === 'bald-beard') {
    // No hair — beard instead, so the silhouette stays unique.
    headGroup.add(mesh(new THREE.BoxGeometry(0.3, 0.16, 0.1), hairMat, 0, -0.16, 0.16));
    headGroup.add(mesh(new THREE.BoxGeometry(0.12, 0.1, 0.08), hairMat, 0, -0.06, 0.22));
  }
  // Eyes (shared, subtle) — two small dark spheres so the face reads in 3D.
  headGroup.add(mesh(new THREE.SphereGeometry(0.028, 8, 6), mat(0x14161a, 0.4), -0.085, 0.03, 0.21, false));
  headGroup.add(mesh(new THREE.SphereGeometry(0.028, 8, 6), mat(0x14161a, 0.4), 0.085, 0.03, 0.21, false));
}

function addOutfit(torso, spec, shirt, shorts, accent) {
  // Distinct outfit shapes per fighter (geometry, not just colour).
  if (spec.outfit === 'vest') {
    torso.add(mesh(new THREE.BoxGeometry(0.5, 0.3, 0.06), shorts, 0, 0.18, 0.19, false));
    torso.add(mesh(new THREE.BoxGeometry(0.5, 0.08, 0.06), accent, 0, -0.3, 0.19, false));
  } else if (spec.outfit === 'hoodie') {
    torso.add(mesh(new THREE.TorusGeometry(0.24, 0.07, 8, 18), shirt, 0, 0.36, 0));
    torso.add(mesh(new THREE.BoxGeometry(0.3, 0.2, 0.05), shorts, 0, 0.1, 0.2, false));
  } else if (spec.outfit === 'gi') {
    torso.add(mesh(new THREE.BoxGeometry(0.56, 0.1, 0.4), shorts, 0, -0.32, 0));
    torso.add(mesh(new THREE.BoxGeometry(0.08, 0.7, 0.05), shorts, 0, 0, 0.2, false));
  } else if (spec.outfit === 'tracksuit') {
    torso.add(mesh(new THREE.BoxGeometry(0.05, 0.66, 0.38), accent, -0.26, 0, 0, false));
    torso.add(mesh(new THREE.BoxGeometry(0.05, 0.66, 0.38), accent, 0.26, 0, 0, false));
  } else if (spec.outfit === 'armour') {
    torso.add(mesh(new THREE.BoxGeometry(0.66, 0.34, 0.42), mat(0x3f4654, 0.35, 0.55), 0, 0.12, 0));
    torso.add(mesh(new THREE.BoxGeometry(0.2, 0.2, 0.05), accent, 0, 0.14, 0.22, false));
  } else if (spec.outfit === 'dancer') {
    const sash = mesh(new THREE.BoxGeometry(0.58, 0.12, 0.42), accent, 0, -0.2, 0);
    sash.rotation.z = 0.18;
    torso.add(sash);
    torso.add(mesh(new THREE.BoxGeometry(0.56, 0.06, 0.4), mat(0xe8e8ec, 0.6), 0, 0.34, 0));
  }
}

function addAccessory(group, parts, spec, shirt, accent, skinMat) {
  const { armL, armR } = parts;
  if (spec.accessory === 'headband') {
    parts.head.add(mesh(new THREE.TorusGeometry(0.24, 0.035, 8, 24), shirt, 0, 0.08, 0));
  } else if (spec.accessory === 'wristbands') {
    armL.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.09, 10), shirt, 0, -0.5, 0, false));
    armR.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.09, 10), shirt, 0, -0.5, 0, false));
  } else if (spec.accessory === 'belt') {
    group.add(mesh(new THREE.TorusGeometry(0.34, 0.045, 8, 20), mat(0x14161a, 0.5), 0, 0.92, 0));
  } else if (spec.accessory === 'sash') {
    group.add(mesh(new THREE.BoxGeometry(0.1, 0.5, 0.05), accent, 0.2, 0.72, 0.2));
  } else if (spec.accessory === 'shoulder-pads') {
    armL.add(mesh(new THREE.SphereGeometry(0.16, 12, 10), mat(0x3f4654, 0.35, 0.55), 0, 0.02, 0));
    armR.add(mesh(new THREE.SphereGeometry(0.16, 12, 10), mat(0x3f4654, 0.35, 0.55), 0, 0.02, 0));
  } else if (spec.accessory === 'scarf') {
    parts.head.add(mesh(new THREE.TorusGeometry(0.25, 0.05, 8, 18), accent, 0, -0.08, 0));
    group.add(mesh(new THREE.BoxGeometry(0.12, 0.42, 0.04), accent, 0.08, 1.15, -0.28));
  }
}

export function buildFighterModel(char) {
  const spec = char.model || { build: 'average', height: 1, hair: 'spiky', outfit: 'vest', accessory: null };
  const b = BUILD[spec.build] || BUILD.average;
  const group = new THREE.Group();
  group.name = `fighter-${char.id}`;

  const skinMat = mat(char.skin ?? 0x8a6a52, 0.7);
  const shirtMat = mat(new THREE.Color(char.color), 0.6);
  const shortsMat = mat(new THREE.Color(char.colorDark), 0.6);
  const hairMat = mat(0x14161a, 0.8);
  const gloveMat = mat(0x1E334E, 0.45);
  const shoeMat = mat(0x0A1424, 0.5);
  const accentMat = mat(0xBC5222, 0.5);

  // ---- Legs (hip pivots at y 0.82) ----
  const legGeo = new THREE.CylinderGeometry(b.limbR, b.limbR * 0.85, 0.72, 10);
  const shoeGeo = new THREE.BoxGeometry(0.2, 0.1, 0.34);
  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.17, 0.82, 0);
    pivot.add(mesh(legGeo, skinMat, 0, -0.36, 0));
    pivot.add(mesh(shoeGeo, shoeMat, 0, -0.74, 0.05));
    group.add(pivot);
    return pivot;
  }
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  // ---- Hips ----
  group.add(mesh(new THREE.BoxGeometry(b.hipW, 0.32, 0.36), shortsMat, 0, 0.88, 0));

  // ---- Torso (pivot at waist so idle breathing can move it) ----
  const torsoPivot = new THREE.Group();
  torsoPivot.position.set(0, 1.04, 0);
  const torso = mesh(new THREE.BoxGeometry(b.torsoW, b.torsoH, 0.36), shirtMat, 0, b.torsoH / 2, 0);
  torsoPivot.add(torso);
  addOutfit(torsoPivot, spec, shirtMat, shortsMat, accentMat);
  group.add(torsoPivot);

  // ---- Head (pivot at neck) ----
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 1.04 + b.torsoH + 0.08, 0);
  const head = mesh(new THREE.SphereGeometry(0.235, 24, 18), skinMat, 0, 0.16, 0);
  headGroup.add(head);
  addHair(headGroup, spec.hair, hairMat, skinMat);
  group.add(headGroup);

  // ---- Arms (shoulder pivots, guard position) ----
  const armGeo = new THREE.CylinderGeometry(b.limbR, b.limbR * 0.9, 0.62, 10);
  const gloveGeo = new THREE.SphereGeometry(0.15, 14, 12);
  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * (b.shoulder / 2 + 0.05), 1.04 + b.torsoH - 0.08, 0);
    pivot.add(mesh(armGeo, skinMat, 0, -0.31, 0));
    pivot.add(mesh(gloveGeo, gloveMat, 0, -0.64, 0));
    // Guard pose: forearms raised toward the face.
    pivot.rotation.set(-0.9, 0, side * -0.35);
    group.add(pivot);
    return pivot;
  }
  const armL = makeArm(-1);
  const armR = makeArm(1);

  const parts = { group, torso: torsoPivot, head: headGroup, armL, armR, legL, legR };
  addAccessory(group, parts, spec, shirtMat, accentMat, skinMat);

  group.scale.setScalar(spec.height || 1);
  group.traverse((o) => { o.userData.fighterId = char.id; });
  return { group, parts, height: spec.height || 1 };
}
