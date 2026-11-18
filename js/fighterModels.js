// RISHU.COM — Visual Upgrade — fighterModels.js
// Procedural low-poly 3D fighter models (Three.js, no external assets,
// no static images). Every fighter is built from the same jointed rig
// but with a distinct silhouette: body proportions, outfit, hairstyle
// and accessories all come from the fighter's `model` spec in
// characters.js, so no two fighters look alike.
//
// Rig v2 (visual upgrade — replaces the Phase 2 single-piece limbs):
//   group (root, faces +Z) -> hips -> torsoPivot (waist) -> chest +
//   abdomen, neck pivot -> headGroup (head + face)
//   group -> armL / armR (shoulder pivots) -> armLFore / armRFore
//     (elbow pivots) -> handL / handR (glove + thumb)
//   group -> legL / legR (hip pivots) -> legLShin / legRShin
//     (knee pivots) -> shoe
// Returned parts: { group, torso, head, neck, armL, armR, armLFore,
//   armRFore, handL, handR, legL, legR, legLShin, legRShin }.
// Every Phase 2 pivot name keeps its meaning as the UPPER pivot, so
// the animator, the character preview and combat flash keep working.
//
// Proportions (rig v2): head Ø ~0.32 (was 0.47 — 20% of height),
// hip pivot at 1.15 (legs ~50% of height), torso split into chest +
// abdomen, total height UNCHANGED ~2.35 so the fixed-camera framing
// holds. All proportion changes are internal redistribution, not a
// scale change (spec.height still scales the whole group).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RISHU_FACE_TEXTURE } from './rishuFace.js';

// Rishu's face — the user's photo (Neon Redesign Build A). A partial-
// sphere cap over the front of the head, textured with an exact crop
// of the photo (see rishuFace.js). The photo loads from a data URI, so
// it decodes in milliseconds; the cap starts transparent and appears
// once the image is drawn. One texture, cached module-level, shared
// by every Rishu model built (menu scene, preview, arena).
let rishuFaceTexture = null;
function getRishuFaceTexture() {
  if (rishuFaceTexture) return rishuFaceTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const img = new Image();
  img.onload = () => {
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 512, 512);
    // Radial fade: the photo's edges melt into the skin underneath,
    // so the cap has no hard rim. Opaque to ~174px (the face), gone
    // by the edge (256px) — the background and hair melt away.
    ctx.globalCompositeOperation = 'destination-in';
    const g = ctx.createRadialGradient(256, 256, 80, 256, 256, 256);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.68, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    tex.needsUpdate = true;
  };
  img.src = RISHU_FACE_TEXTURE;
  rishuFaceTexture = tex;
  return tex;
}

const BUILD = {
  slim: { shoulder: 0.52, torsoW: 0.5, torsoH: 0.62, hipW: 0.48, limbR: 0.075 },
  average: { shoulder: 0.62, torsoW: 0.6, torsoH: 0.66, hipW: 0.56, limbR: 0.09 },
  broad: { shoulder: 0.74, torsoW: 0.72, torsoH: 0.68, hipW: 0.66, limbR: 0.105 },
  tall: { shoulder: 0.58, torsoW: 0.54, torsoH: 0.7, hipW: 0.5, limbR: 0.08 },
};

// Rig v2 skeleton (unscaled local metres; group origin = feet on the mat).
const HIP_Y = 1.15;      // hip pivot height — legs are ~50% of height
const THIGH_LEN = 0.55;
const SHIN_LEN = 0.55;   // ankle at 0.05, shoe on the mat
const TORSO_Y = 1.28;    // torso (waist) pivot
const HEAD_R = 0.16;     // head Ø 0.32 — ~13.5% of height

function mat(color, roughness = 0.65, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function mesh(geo, material, x = 0, y = 0, z = 0, castShadow = true) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = castShadow;
  return m;
}

// Build A Fix — jacket trim merged into ONE draw call: accent chest
// panel + centre zipper + flat collar ring (the hoodie outfit keeps its
// own hood instead of the collar). The panel sits proud of the chest
// face so it layers over outfit panels instead of z-fighting them.
// All parts share one material, so the merge is a single mesh.
function buildJacketTrim(b, spec, accentMat) {
  const th = b.torsoH;
  const tw = b.torsoW;
  const dummy = new THREE.Object3D();
  const parts = [];
  function part(geo, x, y, z, rx = 0, ry = 0, rz = 0) {
    dummy.position.set(x, y, z);
    dummy.rotation.set(rx, ry, rz);
    dummy.updateMatrix();
    geo.applyMatrix4(dummy.matrix);
    parts.push(geo);
  }
  // Accent chest panel (front face of the chest is z 0.18; panel front 0.22).
  part(new THREE.BoxGeometry(tw * 0.62, th * 0.42, 0.04), 0, th * 0.68, 0.2);
  // Centre zipper (front 0.23, proud of the panel).
  part(new THREE.BoxGeometry(0.025, th * 0.85, 0.02), 0, th * 0.5, 0.22);
  // Flat collar ring around the neck (hoodie has its own hood).
  if (spec.outfit !== 'hoodie') {
    part(new THREE.TorusGeometry(0.19, 0.035, 8, 20), 0, th - 0.02, 0, Math.PI / 2);
  }
  const merged = mergeGeometries(parts, false);
  parts.forEach((g) => g.dispose());
  return mesh(merged, accentMat, 0, 0, 0, false);
}

function addHair(headGroup, style, hairMat, skinMat, photoFace = false) {
  // Distinct hairstyles — one geometry family per fighter, sized for
  // the rig v2 head (R 0.16). Spiky / ponytail refined: fewer, larger
  // pieces so they read at fight distance.
  const R = HEAD_R;
  if (style === 'spiky') {
    // Build A Fix: bigger, more numerous spikes + forward fringe so the
    // hair reads at fight distance (reference: spiky anime hair).
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4;
      const spike = mesh(
        new THREE.ConeGeometry(0.065, 0.22, 6),
        hairMat,
        Math.cos(a) * 0.07, 0.2, Math.sin(a) * 0.07
      );
      spike.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      headGroup.add(spike);
    }
    // Two front spikes swept forward over the forehead.
    for (const s of [-1, 1]) {
      const f = mesh(new THREE.ConeGeometry(0.05, 0.18, 6), hairMat, s * 0.06, 0.2, 0.12);
      f.rotation.x = 0.7;
      headGroup.add(f);
    }
    // Forehead fringe (flattened, swept to the side).
    const fringe = mesh(new THREE.BoxGeometry(0.2, 0.06, 0.05), hairMat, 0, 0.22, 0.13, false);
    fringe.rotation.z = 0.25;
    headGroup.add(fringe);
    headGroup.add(mesh(new THREE.SphereGeometry(R * 0.98, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.45), hairMat, 0, 0.03, 0));
  } else if (style === 'mohawk') {
    const ridge = mesh(new THREE.BoxGeometry(0.07, 0.16, 0.3), hairMat, 0, 0.2, 0);
    ridge.rotation.x = 0.15;
    headGroup.add(ridge);
  } else if (style === 'flat-top') {
    headGroup.add(mesh(new THREE.BoxGeometry(0.28, 0.1, 0.28), hairMat, 0, 0.2, 0));
  } else if (style === 'ponytail') {
    headGroup.add(mesh(new THREE.SphereGeometry(R * 0.98, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), hairMat, 0, 0.03, 0));
    const tail = mesh(new THREE.CylinderGeometry(0.05, 0.035, 0.36, 8), hairMat, 0, 0.02, -0.22);
    tail.rotation.x = 0.9;
    headGroup.add(tail);
    const tie = mesh(new THREE.TorusGeometry(0.055, 0.016, 8, 16), mat(0xA855F7, 0.5), 0, 0.13, -0.15);
    tie.rotation.x = 0.9;
    headGroup.add(tie);
  } else if (style === 'braid') {
    headGroup.add(mesh(new THREE.SphereGeometry(R * 0.98, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), hairMat, 0, 0.03, 0));
    for (let i = 0; i < 3; i++) {
      const seg = mesh(new THREE.SphereGeometry(0.055 - i * 0.01, 10, 8), hairMat, 0, -0.02 - i * 0.1, -0.19 - i * 0.02);
      headGroup.add(seg);
    }
  } else if (style === 'topknot') {
    headGroup.add(mesh(new THREE.SphereGeometry(R * 0.98, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.45), hairMat, 0, 0.03, 0));
    headGroup.add(mesh(new THREE.SphereGeometry(0.07, 12, 10), hairMat, 0, 0.22, 0));
    headGroup.add(mesh(new THREE.TorusGeometry(0.07, 0.014, 8, 16), mat(0xA855F7, 0.5), 0, 0.19, 0));
  } else if (style === 'bald-beard') {
    // No hair — beard instead, so the silhouette stays unique.
    headGroup.add(mesh(new THREE.BoxGeometry(0.2, 0.11, 0.07), hairMat, 0, -0.11, 0.11));
    headGroup.add(mesh(new THREE.BoxGeometry(0.09, 0.07, 0.05), hairMat, 0, -0.04, 0.15));
  }
  // Face (rig v2): brow, nose, mouth, ears + the two eye dots, so the
  // face reads at fight distance. All positions are relative to the
  // head group; the head sphere centre is at +0.13.
  // photoFace (Rishu, Build A): the photo provides the eyes, brows,
  // nose and mouth — procedural ones would poke through the photo cap.
  // The ears stay: they sit outside the cap's span and are skin-matched.
  const darkMat = mat(0x14161a, 0.4);
  if (!photoFace) {
    headGroup.add(mesh(new THREE.SphereGeometry(0.02, 8, 6), darkMat, -0.055, 0.15, 0.14, false));
    headGroup.add(mesh(new THREE.SphereGeometry(0.02, 8, 6), darkMat, 0.055, 0.15, 0.14, false));
    headGroup.add(mesh(new THREE.BoxGeometry(0.085, 0.014, 0.012), hairMat, -0.055, 0.185, 0.145, false));
    headGroup.add(mesh(new THREE.BoxGeometry(0.085, 0.014, 0.012), hairMat, 0.055, 0.185, 0.145, false));
    const nose = mesh(new THREE.ConeGeometry(0.018, 0.05, 6), skinMat, 0, 0.1, 0.155, false);
    nose.rotation.x = Math.PI / 2 + 0.35;
    headGroup.add(nose);
    headGroup.add(mesh(new THREE.BoxGeometry(0.07, 0.012, 0.012), darkMat, 0, 0.045, 0.15, false));
  } else {
    // Rishu profile (side-view arena, 2026-11-18): the photo face cap
    // is edge-on to the fixed camera, so the head reads as a plain
    // circle in the fight. A skin nose + dark mustache, proud of the
    // photo cap, give the profile a recognisable Rishu silhouette
    // (nose bump + mustache dash below it). Both sit on the painted
    // nose/mustache in front views, so they read as relief there, not
    // a new feature. Fighters still face their opponent; the camera
    // does not move. No shadow casting (tiny face features).
    const nose = mesh(new THREE.ConeGeometry(0.018, 0.05, 6), skinMat, 0, 0.1, 0.155, false);
    nose.rotation.x = Math.PI / 2 + 0.35;
    headGroup.add(nose);
    headGroup.add(mesh(new THREE.BoxGeometry(0.1, 0.016, 0.022), darkMat, 0, 0.068, 0.152, false));
  }
  headGroup.add(mesh(new THREE.SphereGeometry(0.025, 8, 6), skinMat, -0.155, 0.13, 0, false));
  headGroup.add(mesh(new THREE.SphereGeometry(0.025, 8, 6), skinMat, 0.155, 0.13, 0, false));
}

function addOutfit(torso, parts, spec, b, shirt, shorts, accent) {
  // Distinct outfit shapes per fighter (geometry, not just colour),
  // sized for the rig v2 torso (chest + abdomen). No new outfit ids —
  // the 6 identities stay. `parts` gives the forearm pivots for wraps.
  const th = b.torsoH;
  const tw = b.torsoW;
  if (spec.outfit === 'vest') {
    torso.add(mesh(new THREE.BoxGeometry(tw * 0.85, 0.22, 0.05), shorts, 0, th * 0.78, 0.19, false));
    torso.add(mesh(new THREE.BoxGeometry(tw * 0.9, 0.05, 0.05), accent, 0, th * 0.55, 0.19, false));
    // Hand wraps on the forearms.
    for (const fore of [parts.armLFore, parts.armRFore]) {
      fore.add(mesh(new THREE.CylinderGeometry(b.limbR + 0.012, b.limbR + 0.012, 0.12, 10), shirt, 0, -0.16, 0, false));
    }
  } else if (spec.outfit === 'hoodie') {
    torso.add(mesh(new THREE.TorusGeometry(0.2, 0.055, 8, 18), shirt, 0, th - 0.02, 0));
    torso.add(mesh(new THREE.BoxGeometry(0.3, 0.18, 0.05), shorts, 0, th * 0.25, 0.19, false));
    torso.add(mesh(new THREE.BoxGeometry(0.02, 0.12, 0.02), accent, -0.06, th * 0.82, 0.19, false));
    torso.add(mesh(new THREE.BoxGeometry(0.02, 0.12, 0.02), accent, 0.06, th * 0.82, 0.19, false));
  } else if (spec.outfit === 'gi') {
    torso.add(mesh(new THREE.BoxGeometry(tw * 0.95, 0.08, 0.38), shorts, 0, 0.06, 0));
    torso.add(mesh(new THREE.BoxGeometry(0.09, 0.09, 0.06), shorts, 0.1, 0.06, 0.2, false));
    torso.add(mesh(new THREE.BoxGeometry(0.07, th * 0.55, 0.04), shorts, 0, th * 0.6, 0.19, false));
  } else if (spec.outfit === 'tracksuit') {
    torso.add(mesh(new THREE.BoxGeometry(0.04, th * 0.9, 0.36), accent, -tw / 2, th * 0.5, 0, false));
    torso.add(mesh(new THREE.BoxGeometry(0.04, th * 0.9, 0.36), accent, tw / 2, th * 0.5, 0, false));
    torso.add(mesh(new THREE.TorusGeometry(0.19, 0.04, 8, 18), accent, 0, th - 0.03, 0));
  } else if (spec.outfit === 'armour') {
    torso.add(mesh(new THREE.BoxGeometry(tw * 1.05, 0.3, 0.4), mat(0x2E1B4D, 0.35, 0.55), 0, th * 0.72, 0));
    torso.add(mesh(new THREE.BoxGeometry(0.2, 0.2, 0.05), accent, 0, th * 0.72, 0.22, false));
  } else if (spec.outfit === 'dancer') {
    const sash = mesh(new THREE.BoxGeometry(tw * 0.98, 0.1, 0.4), accent, 0, th * 0.3, 0);
    sash.rotation.z = 0.18;
    torso.add(sash);
    torso.add(mesh(new THREE.BoxGeometry(tw * 0.95, 0.05, 0.38), mat(0xe8e8ec, 0.6), 0, th - 0.05, 0));
  }
}

function addAccessory(group, parts, spec, shirt, accent, skinMat) {
  const { armL, armR, armLFore, armRFore } = parts;
  if (spec.accessory === 'headband') {
    // Build A Fix (2026-11-18): the torus used to lie in the XY plane
    // (vertical, facing the face) — from the fixed side-view camera
    // it collapsed to a bright purple stripe through the middle of
    // the head. Rotated flat (XZ plane) it is a proper headband. It
    // sits at forehead height (y 0.23, above the brows at 0.185) with
    // a radius matched to the head's cross-section there (0.13), so it
    // hugs the forehead instead of floating or covering the eyes.
    // Rishu only.
    const band = mesh(new THREE.TorusGeometry(0.13, 0.028, 8, 24), shirt, 0, 0.23, 0);
    band.rotation.x = Math.PI / 2;
    parts.head.add(band);
  } else if (spec.accessory === 'wristbands') {
    armLFore.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 10), shirt, 0, -0.24, 0, false));
    armRFore.add(mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 10), shirt, 0, -0.24, 0, false));
  } else if (spec.accessory === 'belt') {
    group.add(mesh(new THREE.TorusGeometry(0.34, 0.045, 8, 20), mat(0x14161a, 0.5), 0, TORSO_Y + 0.02, 0));
  } else if (spec.accessory === 'sash') {
    group.add(mesh(new THREE.BoxGeometry(0.1, 0.5, 0.05), accent, 0.2, 1.05, 0.2));
  } else if (spec.accessory === 'shoulder-pads') {
    armL.add(mesh(new THREE.SphereGeometry(0.16, 12, 10), mat(0x2E1B4D, 0.35, 0.55), 0, 0.02, 0));
    armR.add(mesh(new THREE.SphereGeometry(0.16, 12, 10), mat(0x2E1B4D, 0.35, 0.55), 0, 0.02, 0));
  } else if (spec.accessory === 'scarf') {
    parts.head.add(mesh(new THREE.TorusGeometry(HEAD_R + 0.01, 0.04, 8, 18), accent, 0, 0.02, 0));
    group.add(mesh(new THREE.BoxGeometry(0.12, 0.42, 0.04), accent, 0.08, 1.72, -0.28));
  }
}

export function buildFighterModel(char) {
  const spec = char.model || { build: 'average', height: 1, hair: 'spiky', outfit: 'vest', accessory: null };
  const b = BUILD[spec.build] || BUILD.average;
  const group = new THREE.Group();
  group.name = `fighter-${char.id}`;

  const skinMat = mat(char.skin ?? 0x8a6a52, 0.55); // G1: slight sheen
  const shortsMat = mat(new THREE.Color(char.colorDark), 0.6);
  const hairMat = mat(spec.hairColor ?? 0x14161a, 0.8); // Build A Fix: per-fighter hair colour (Ayaan white, Dev steel grey)
  const gloveMat = mat(0x120E1A, 0.4); // Build A Fix: black gloves (was dark purple)
  const shoeMat = mat(0x0A0612, 0.35); // G1: glossy shoes
  const accentMat = mat(new THREE.Color(char.color), 0.4); // Build A Fix: per-fighter accent (was fixed purple for all)
  // Build A Fix — reference look: black jacket + black pants; the accent
  // colour reads on the chest panel, collar, cuffs and leg stripes.
  const jacketMat = mat(0x16121F, 0.55);
  const pantsMat = mat(0x100D18, 0.75);

  // ---- Legs (hip pivots at HIP_Y 1.15; thigh 0.55 + shin 0.55) ----
  const thighGeo = new THREE.CylinderGeometry(b.limbR, b.limbR * 0.85, THIGH_LEN, 10);
  const shinGeo = new THREE.CylinderGeometry(b.limbR * 0.85, b.limbR * 0.7, SHIN_LEN, 10);
  const shoeGeo = new THREE.BoxGeometry(0.2, 0.1, 0.34);
  function makeLeg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.17, HIP_Y, 0);
    pivot.add(mesh(thighGeo, pantsMat, 0, -THIGH_LEN / 2, 0));
    // Build A Fix: accent side stripe on the outer thigh (reference track-pant look).
    pivot.add(mesh(new THREE.BoxGeometry(0.02, THIGH_LEN * 0.8, 0.1), accentMat, side * (b.limbR + 0.008), -THIGH_LEN / 2, 0, false));
    const shin = new THREE.Group();
    shin.position.set(0, -THIGH_LEN, 0);
    shin.add(mesh(shinGeo, pantsMat, 0, -SHIN_LEN / 2, 0));
    shin.add(mesh(shoeGeo, shoeMat, 0, -SHIN_LEN + 0.02, 0.05));
    pivot.add(shin);
    group.add(pivot);
    return { pivot, shin };
  }
  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  // ---- Hips ----
  group.add(mesh(new THREE.BoxGeometry(b.hipW, 0.26, 0.36), pantsMat, 0, HIP_Y + 0.01, 0));

  // ---- Torso (pivot at the waist; chest + abdomen, tapered) ----
  const torsoPivot = new THREE.Group();
  torsoPivot.position.set(0, TORSO_Y, 0);
  const abdomen = mesh(new THREE.BoxGeometry(b.torsoW * 0.92, b.torsoH * 0.42, 0.32), jacketMat, 0, b.torsoH * 0.21, 0);
  const chest = mesh(new THREE.BoxGeometry(b.torsoW, b.torsoH * 0.58, 0.36), jacketMat, 0, b.torsoH * 0.71, 0);
  torsoPivot.add(abdomen, chest);
  // Waistband strip (all outfits — clothing sits on it).
  torsoPivot.add(mesh(new THREE.BoxGeometry(b.torsoW * 0.95, 0.06, 0.34), accentMat, 0, 0.03, 0, false));
  // Build A Fix: jacket trim (chest panel + zipper + collar, one draw call).
  torsoPivot.add(buildJacketTrim(b, spec, accentMat));
  group.add(torsoPivot);

  // ---- Neck + head (neck pivot between torso and head) ----
  const neck = new THREE.Group();
  neck.position.set(0, TORSO_Y + b.torsoH + 0.02, 0);
  neck.add(mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 10), skinMat, 0, 0.02, 0));
  group.add(neck);
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.1, 0);
  neck.add(headGroup);
  const head = mesh(new THREE.SphereGeometry(HEAD_R, 24, 18), skinMat, 0, 0.13, 0);
  headGroup.add(head);
  addHair(headGroup, spec.hair, hairMat, skinMat, char.id === 'rishu');
  if (char.id === 'rishu') {
    // Photo face cap (Build A): the user's photo on the front of the
    // head. Partial sphere, front (+Z) only — phi ±0.62 rad covers the
    // eyes/brows/nose/mouth, theta 0.85–2.20 covers forehead-to-chin.
    // Honest limit (told to the user): the front view matches the
    // photo; side angles are stylised by the sphere's curvature.
    const capMat = new THREE.MeshStandardMaterial({
      map: getRishuFaceTexture(),
      transparent: true,
      roughness: 0.6,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const cap = new THREE.Mesh(
      new THREE.SphereGeometry(HEAD_R * 1.005, 24, 18, Math.PI / 2 - 0.62, 1.24, 0.85, 1.35),
      capMat
    );
    cap.position.set(0, 0.13, 0);
    cap.castShadow = false;
    cap.renderOrder = 1;
    headGroup.add(cap);
  }

  // ---- Arms (shoulder pivots; upper arm 0.32 + forearm 0.30) ----
  const upperGeo = new THREE.CylinderGeometry(b.limbR, b.limbR * 0.9, 0.32, 10);
  const foreGeo = new THREE.CylinderGeometry(b.limbR * 0.9, b.limbR * 0.75, 0.30, 10);
  const gloveGeo = new THREE.SphereGeometry(0.11, 14, 12);
  function makeArm(side) {
    const pivot = new THREE.Group();
    pivot.position.set(side * (b.shoulder / 2 + 0.04), TORSO_Y + b.torsoH - 0.04, 0);
    pivot.add(mesh(upperGeo, jacketMat, 0, -0.16, 0));
    const fore = new THREE.Group();
    fore.position.set(0, -0.32, 0);
    fore.add(mesh(foreGeo, jacketMat, 0, -0.15, 0));
    // Build A Fix: accent cuff at the wrist (sleeves, not bare arms).
    fore.add(mesh(new THREE.CylinderGeometry(b.limbR * 0.9 + 0.012, b.limbR * 0.9 + 0.012, 0.06, 10), accentMat, 0, -0.28, 0, false));
    const hand = new THREE.Group();
    hand.position.set(0, -0.32, 0);
    hand.add(mesh(gloveGeo, gloveMat, 0, 0, 0));
    hand.add(mesh(new THREE.BoxGeometry(0.04, 0.07, 0.04), gloveMat, -side * 0.09, -0.02, 0.06, false));
    fore.add(hand);
    pivot.add(fore);
    // Guard pose: upper arms forward, forearms bent up toward the face.
    pivot.rotation.set(-0.9, 0, side * -0.35);
    fore.rotation.x = -1.05;
    group.add(pivot);
    return { pivot, fore, hand };
  }
  const armL = makeArm(-1);
  const armR = makeArm(1);

  const parts = {
    group,
    torso: torsoPivot,
    head: headGroup,
    neck,
    armL: armL.pivot, armR: armR.pivot,
    armLFore: armL.fore, armRFore: armR.fore,
    handL: armL.hand, handR: armR.hand,
    legL: legL.pivot, legR: legR.pivot,
    legLShin: legL.shin, legRShin: legR.shin,
  };
  addOutfit(torsoPivot, parts, spec, b, accentMat, shortsMat, accentMat);
  addAccessory(group, parts, spec, accentMat, accentMat, skinMat);

  group.scale.setScalar(spec.height || 1);
  group.traverse((o) => { o.userData.fighterId = char.id; });
  return { group, parts, height: spec.height || 1 };
}
