// RISHU.COM — Phase 1
// Original characters only. No copied characters, names, or likenesses.
// Stats are 1–10. Colours are the fighter's accent used on their
// preview figure and card. All four are original creations for RISHU.COM.

export const CHARACTERS = [
  {
    id: 'rishu',
    name: 'Rishu',
    title: 'The Challenger',
    style: 'Balanced Striker',
    description: 'A disciplined all-rounder. Fast hands, steady footwork, no wasted movement.',
    power: 7,
    speed: 7,
    defense: 7,
    range: 6,
    difficulty: 'Easy',
    color: '#4F7DF3', // electric blue — the RISHU.COM accent
    colorDark: '#2E4FA8',
    initials: 'RI',
  },
  {
    id: 'ayaan',
    name: 'Ayaan',
    title: 'Storm Fist',
    style: 'Aggressive Brawler',
    description: 'Heavy hands and relentless pressure. Hits hard, guards late — a high-risk finisher.',
    power: 9,
    speed: 6,
    defense: 5,
    range: 5,
    difficulty: 'Medium',
    color: '#E8E8EC',
    colorDark: '#8A8F9E',
    initials: 'AY',
  },
  {
    id: 'kabir',
    name: 'Kabir',
    title: 'Iron Wall',
    style: 'Defensive Counter',
    description: 'Patient, immovable, precise. Absorbs pressure and answers with one clean counter.',
    power: 6,
    speed: 5,
    defense: 9,
    range: 7,
    difficulty: 'Medium',
    color: '#7FB3FF',
    colorDark: '#3A5FCE',
    initials: 'KA',
  },
  {
    id: 'zara',
    name: 'Zara',
    title: 'Shadow Step',
    style: 'Speed Specialist',
    description: 'The fastest fighter in the roster. Slips in, lands three hits, and is gone before the reply.',
    power: 6,
    speed: 10,
    defense: 5,
    range: 6,
    difficulty: 'Hard',
    color: '#B9C6E8',
    colorDark: '#5A6B96',
    initials: 'ZA',
  },
];

export function getCharacter(id) {
  return CHARACTERS.find((c) => c.id === id) || null;
}

export function statBar(value) {
  // Returns 10 segments; filled = value. Used by menu.js to render stats.
  return Array.from({ length: 10 }, (_, i) => i < value);
}
