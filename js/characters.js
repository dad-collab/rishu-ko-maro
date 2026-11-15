// RISHU.COM — Phase 2 — characters.js
// Six original fictional fighters. No copied characters, names, or likenesses.
// Stats are 1–10: Strength, Speed, Defense, Special Power.
// `model` drives the procedural 3D model in fighterModels.js:
//   build: 'slim' | 'average' | 'broad' | 'tall'  (body proportions)
//   height: overall scale factor
//   hair: hairstyle geometry id
//   outfit: outfit geometry id
//   accessory: extra geometry id (or null)
// `specialMove` is display-only — the move itself is a later-phase
// combat hook (see the LATER-PHASE HOOK comment in fighterModels.js).

export const CHARACTERS = [
  {
    id: 'rishu',
    name: 'Rishu',
    title: 'The Challenger',
    style: 'Balanced Striker',
    tagline: 'No wasted movement. Every strike earns its place.',
    personality: 'Disciplined all-rounder. Fast hands, steady footwork, calm under pressure — the fighter the arena was built around.',
    description: 'A disciplined all-rounder. Fast hands, steady footwork, no wasted movement.',
    strength: 7,
    speed: 7,
    defense: 7,
    special: 7,
    range: 6,
    difficulty: 'Easy',
    specialMove: 'Ember Rush',
    color: '#BC5222', // burnt orange — the new RISHU.COM signature
    colorDark: '#7E3410',
    initials: 'RI',
    skin: 0x8a6a52,
    model: { build: 'average', height: 1.0, hair: 'spiky', outfit: 'vest', accessory: 'headband' },
  },
  {
    id: 'ayaan',
    name: 'Ayaan',
    title: 'Storm Fist',
    style: 'Aggressive Brawler',
    tagline: 'Pressure never stops. Neither does he.',
    personality: 'Heavy hands and relentless pressure. Hits hard, guards late — a high-risk finisher who wins fast or not at all.',
    description: 'Heavy hands and relentless pressure. Hits hard, guards late — a high-risk finisher.',
    strength: 9,
    speed: 6,
    defense: 5,
    special: 8,
    range: 5,
    difficulty: 'Medium',
    specialMove: 'Storm Barrage',
    color: '#E8E8EC',
    colorDark: '#8A8F9E',
    initials: 'AY',
    skin: 0x6b4a35,
    model: { build: 'broad', height: 1.02, hair: 'mohawk', outfit: 'hoodie', accessory: 'wristbands' },
  },
  {
    id: 'kabir',
    name: 'Kabir',
    title: 'Iron Wall',
    style: 'Defensive Counter',
    tagline: 'Hit me. I will still be standing.',
    personality: 'Patient, immovable, precise. Absorbs pressure and answers with one clean counter.',
    description: 'Patient, immovable, precise. Absorbs pressure and answers with one clean counter.',
    strength: 6,
    speed: 5,
    defense: 9,
    special: 7,
    range: 7,
    difficulty: 'Medium',
    specialMove: 'Iron Counter',
    color: '#6E8CA8',
    colorDark: '#3E5A75',
    initials: 'KA',
    skin: 0xa08060,
    model: { build: 'broad', height: 1.06, hair: 'bald-beard', outfit: 'gi', accessory: 'belt' },
  },
  {
    id: 'zara',
    name: 'Zara',
    title: 'Shadow Step',
    style: 'Speed Specialist',
    tagline: 'Three hits. Gone before the reply.',
    personality: 'The fastest fighter in the roster. Slips in, lands three hits, and is gone before the reply.',
    description: 'The fastest fighter in the roster. Slips in, lands three hits, and is gone before the reply.',
    strength: 6,
    speed: 10,
    defense: 5,
    special: 9,
    range: 6,
    difficulty: 'Hard',
    specialMove: 'Shadow Step',
    color: '#A8B8CC',
    colorDark: '#5A6B7E',
    initials: 'ZA',
    skin: 0x7a5a44,
    model: { build: 'slim', height: 0.97, hair: 'ponytail', outfit: 'tracksuit', accessory: 'sash' },
  },
  {
    id: 'dev',
    name: 'Dev',
    title: 'The Forge',
    style: 'Heavyweight Grappler',
    tagline: 'Forged, not born. Once he grabs you, the round is over.',
    personality: 'A slow, towering powerhouse. Walks through strikes, locks on, and ends fights with a single crushing throw.',
    description: 'A slow, towering powerhouse. Walks through strikes and ends fights with one crushing throw.',
    strength: 10,
    speed: 4,
    defense: 8,
    special: 6,
    range: 6,
    difficulty: 'Medium',
    specialMove: 'Forge Slam',
    color: '#C7CCD6',
    colorDark: '#3F4654',
    initials: 'DE',
    skin: 0x9a7a5e,
    model: { build: 'broad', height: 1.1, hair: 'flat-top', outfit: 'armour', accessory: 'shoulder-pads' },
  },
  {
    id: 'meera',
    name: 'Meera',
    title: 'Storm Dancer',
    style: 'Acrobatic Kicker',
    tagline: 'She does not walk into range. She dances through it.',
    personality: 'An acrobatic kicker who turns every dodge into a spin kick. Light on her feet, impossible to corner, deadly at range.',
    description: 'An acrobatic kicker who turns every dodge into a spinning kick. Light, fast, impossible to corner.',
    strength: 7,
    speed: 9,
    defense: 6,
    special: 9,
    range: 8,
    difficulty: 'Hard',
    specialMove: 'Cyclone Kick',
    color: '#7C93B0',
    colorDark: '#3E5A75',
    initials: 'ME',
    skin: 0x5e4232,
    model: { build: 'tall', height: 1.05, hair: 'braid', outfit: 'dancer', accessory: 'scarf' },
  },
];

export function getCharacter(id) {
  return CHARACTERS.find((c) => c.id === id) || null;
}

export function statBar(value) {
  // Returns 10 segments; filled = value. Used by menu.js to render stats.
  return Array.from({ length: 10 }, (_, i) => i < value);
}

// The four stats shown on cards and in the preview detail panel.
export const STAT_DEFS = [
  { key: 'strength', label: 'Strength' },
  { key: 'speed', label: 'Speed' },
  { key: 'defense', label: 'Defense' },
  { key: 'special', label: 'Special Power' },
];
