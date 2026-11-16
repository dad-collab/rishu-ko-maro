# RISHU.COM — Phase 4

Premium 3D browser-based fighting game. **Original branding, UI, characters and visuals only** — nothing copied from FightKaro or any other game.

**Visual redesign (2026-11-15):** the whole interface was rebuilt from scratch with its own identity — deep navy `#0E1B2E`, warm ivory surfaces `#F7F2E7`, burnt-orange primary `#BC5222`, muted steel blue `#5B7A99`, silver hairline borders. Asymmetric editorial homepage with a live 3D fighter showcase, Archivo Black display type + Inter body, full-screen character showcase with a horizontal fighter carousel, and a separate mobile layout (stage-first hero, sticky bottom action bar). The old black/blue system is gone — no trace of the old steel-blue accent remains anywhere in the live UI.

**Phase 1** (done): main menu, game modes, character selection, How to Play, Settings, fullscreen, loading screen, and a real 3D arena preview (Three.js + WebGL).

**Phase 2** (done): six original fighters with distinct procedural 3D models, a live rotatable 3D character preview, idle / walk / victory / selection animations, and a confirmed-pick flow that carries the selected fighter into the arena.

**Phase 3** (this build): 3D player movement and controls. Walk / run / jump with keyboard (P1 WASD + Space + Shift; P2 arrows + Right Shift + Enter in Two Player Local) and touch (left virtual joystick + JUMP button, P1 only), a fixed side-view fight camera (orthographic, Tekken-style — see below) that keeps both fighters in frame, camera-relative movement, arena-boundary collision, fighter separation, smooth facing toward the opponent, run / jump / land / turn / back / side animation states with blended transitions, a match HUD (names, character icons, count-up timer, Pause that actually pauses, Quit to Game Modes) and honestly labelled health-bar placeholders for Phase 5. **No combat in Phase 3** — no attacks, damage, health logic, rounds, win/lose, or CPU AI. The arena screen says this honestly; nothing is faked.

## What is in Phase 2

- **Homepage** — asymmetric 5/7 hero: editorial headline, large Play Now button, stat strip, and a live 3D fighter showcase (Rishu, drag to rotate, auto-rotate). Below it: staggered game-mode cards, an arena-preview section with an octagon diagram, and a featured-fighters scroll strip that opens character select focused on that fighter.
- **Character selection screen** — full-screen split: large live 3D preview (real Three.js model, never a static image) on a navy stage with the fighter's name overlapping the stage edge, beside an ivory detail panel (tagline, personality, special move, stat bars). Below: a horizontal fighter carousel (scroll-snap, focused card centred). Drag the preview to rotate; Auto-rotate toggle; Walk Preview toggle.
- **Six original fighters** — Rishu (Balanced Striker), Ayaan (Storm Fist), Kabir (Iron Wall), Zara (Shadow Step), **Dev (The Forge, new)**, **Meera (Storm Dancer, new)**. Each has a unique procedural low-poly model: different body proportions, outfit, hairstyle and accessories, plus its own colour combination.
- **Stats** — Strength, Speed, Defense, Special Power (1–10 each) as animated visual bars on cards and in the preview detail panel.
- **Animations** — idle (breathing / guard sway), walking (leg/arm swing + bob), victory pose (arms raised, plays on selection confirm), selection animation (full spin + scale pulse + accent ring on switch). Procedural only, driven by `js/fighterAnimations.js`.
- **Selection experience** — smooth switching with spin transitions, Select Fighter button, confirmed ✓ badge, selected-card highlight animation, Back and Continue buttons. Continue is enabled only after a valid confirmed pick.
- **Game integration** — confirmed pick saved to `localStorage` (`rishu.selection.v1`) and pre-focused on the next visit; passed to the arena, which now shows the fighters' real models and lets you move them (Phase 3). CPU opponent is a random different fighter; Player 2 cannot pick the same fighter as Player 1 (Swap Pick works as in Phase 1). Fighter data shape (`stats + model builder + animation hooks`) is ready for combat — see the `LATER-PHASE HOOK` comments in `js/fighterModels.js` and `js/fighterAnimations.js`.
- **Preserved Phase 1** — homepage, branding, 3D arena, modes (PvC / 2P Local / Online Coming Soon), How to Play, Settings, fullscreen, loading screen — all still working.
- **Responsive** — desktop / laptop / tablet / mobile, with a separate mobile layout (not a shrunk desktop): stage-first hero with an overlapping content card, mode rows, bottom-sheet modals, character select as stage → overlap detail → carousel → sticky bottom action bar with safe-area padding. No horizontal scrolling, touch-friendly (44px+ targets).
- **Performance** — preview renderer is created lazily and pauses when the character screen is not visible; pixel ratio capped at 2; shadows only on Medium/High.

## What is in Phase 3

- **Movement** — velocity-based with accel/decel; walk speed scales with each fighter's Speed stat (2.91 m/s Dev → 3.38 m/s Zara), run ×1.55, back ×0.8, side ×0.85; jump under gravity (apex ~1.3 m, ~0.72 s airtime); no double jump; air control ×0.6.
- **Camera (fixed side view, Tekken style)** — one permanent orthographic pose per match: position (0, 5.3, 12.0), lookAt (0, 2.35, 0), elevation ~13.8°, frustum sized once at match start from the live aspect (`H = max(2.3, 5.25 / aspect)`); resize re-sizes the frustum only — position/rotation never move. No follow, no zoom, no rotation, no tracking, no shake, no drag/pinch in a match. No intro: arena entry starts the fight immediately (the 3.2 s cinematic sweep was removed 2026-11-15). Near-side ropes fade to opacity 0.15 during a match so they never hide a fighter, restored on every exit. Free orbit resumes outside a match. On phones the fight plays in landscape — a rotate prompt gates portrait entry and pauses mid-match — so fighters stay ~48-50% of canvas height, the same as PC.
- **Touch controls** — left virtual joystick (P1 only; push to the edge to run) and a JUMP button on the right; pointer capture, no page scroll during play, shown only on touch devices.
- **HUD** — P1/P2 names + character icons, count-up match timer, health bars that are static labelled placeholders ("HEALTH · PHASE 5" + "PLACEHOLDER"), Pause button / `P` / `Esc` that actually freeze movement and the timer, Resume and Quit to Game Modes. (Phase 4 makes the health bars live — see below.)
- **Animations** — run, jump, land (0.14 s hold), turn (scissor step + torso twist), back, side (lateral steps + lean), all blended on transition (0.05–0.15 s) with a shared walk phase so walk↔run never snaps a leg.
- **Boundaries** — fighters cannot leave the ring (radius 4.6) or pass through each other (min separation 1.0 m); both always face the opponent with smooth shortest-arc turning.

## What is in Phase 4

- **Attacks** — Light Punch (`J`), Heavy Punch (`K`), Kick (`U`), Heavy Kick (`I`), each with real 3D animation (startup / active / recovery), duration, cooldown, range and hitstun. P2 (Two Player Local): Numpad `1` / `2` / `3` / `0` (fallback `,` / `.` / `/` / `'`), all in one `P2_COMBAT_KEYS` config object in `js/movement.js`. No air attacks, no spam: an attack cannot start during an incompatible animation, and holding an attack key queues one attack only.
- **Damage (deterministic, no random numbers)** — `round(base × (0.8 + 0.04·strength) × (1.15 − 0.03·defense) × comboScale)`, reach scaled by the attacker's Range stat (`reach = base × (0.9 + 0.025·range)`). Worked examples (attacker → defender): Rishu→Kabir 4 / 8 / 6 / 10, Dev→Zara 5 / 10 / 7 / 13, Ayaan→Meera 5 / 9 / 7 / 12, Zara→Dev 4 / 8 / 6 / 10 (Light / Heavy Punch / Kick / Heavy Kick). One hit per attack by construction: a single hit test on the active window's first frame, a facing guard, and a `hitDone` flag.
- **Defense** — Block (`L`, hold): high guard blocks high + mid, low guard (`L`+`S`) blocks mid + low; blocked hits deal small chip damage and push the defender back. Dodge (`O`): a 0.28 s dash with i-frames 0.05–0.25 s; Backward Evade (`S`+`O`): 1.8 m straight back, i-frames 0.05–0.30 s. P2: Numpad Enter block, Numpad 5 dodge (fallback `;` / `M`).
- **Combos** — a 1.2 s window measured in **sim-time** (the arena's accumulated dt), not wall-clock time, so the window cannot expire between landed hits on a slow device — three attacks are 1.02 s of sim, which is over 1.2 s of wall time below ~15 fps. A counter appears at 2+ hits, damage scaling ×1.0 (hits 1–2), ×0.9 (3–4), ×0.8 (5+), chain buffering (0.35 s, one buffered attack, cleared on hit), and interruption (a whiff, a dodge, or the opponent blocking breaks the chain).
- **Hit detection & reactions** — range-only hits (no hits from unrealistic distance), hitstun that locks the defender's movement (0.22–0.50 s by attack), knockback on heavy attacks, hit-reaction animations (`hit` / `hitHeavy`), and a KO fall at 0 HP.
- **Effects** — subtle hit flash on the defender, hitstop freeze (0.04 s heavy punch, 0.06 s heavy kick), and punch/kick/block/dodge/KO sounds synthesised with WebAudio (`js/combatAudio.js`, zero audio files) that respect the Settings sound toggle and never throw. (No camera shake: the fixed camera never moves.)
- **Health & KO** — 100 HP per fighter, live HUD bars (burnt-orange low-health state at ≤ 25 HP), KO at 0 HP with a Rematch / Quit overlay reusing the pause box; Rematch restarts the same mode and fighters immediately — no intro. Single-round KO — no rounds yet.
- **Touch combat** — LP / HP / KICK / HK tap buttons, hold-to-block BLOCK, tap DODGE, in a 3×2 grid beside JUMP (P1 only, ≥ 44 px targets). Touch block is high guard only (no low guard on touch).
- **Integration rule (the setFighters lesson)** — the arena tick calls `combat.syncAnimator()` AFTER the movement controllers and BEFORE `animator.update`, or the controllers would overwrite attack / hit / block poses with idle in the same frame. Combat updates run BEFORE the controllers so hit tests use pre-move positions.

## What is NOT in Phase 4 (honest list)

- Special attacks — hooks/stub only (`trySpecial()` returns `{ ok: false, reason: 'phase-5' }`), no input bound, no UI
- Rounds — single-round KO only; no best-of, no round timer
- CPU AI — later phase (in Player vs Computer the CPU fighter stands in guard and only reacts)
- Online Multiplayer — later phase, marked Coming Soon in the UI
- No visual browser confirmation in this VM (no Chromium/Playwright) — open `http://localhost:8000` in a real browser to confirm combat feel, hit reactions and 60 FPS.

## Tech

Plain HTML / CSS / JS — no build step, no framework.

- Three.js `0.160.0` via CDN ES modules (import map in `index.html`)
- WebGL rendering, `OrbitControls` for the arena preview camera; the fight uses a fixed orthographic side-view camera (`js/fixedCamera.js`)
- Modular files: `js/main.js` (boot + loading), `js/arena.js` (Three.js arena scene + match lifecycle), `js/menu.js` (screens/modals/settings/character select), `js/characters.js` (fighter data + stats), `js/fighterModels.js` (procedural 3D models), `js/fighterAnimations.js` (animation state machine), `js/characterPreview.js` (live 3D preview renderer), `js/movement.js` (keyboard input + fighter controller), `js/fixedCamera.js` (fixed side-view fight camera), `js/touchControls.js` (virtual joystick + jump), `js/hud.js` (match HUD + pause), `js/combat.js` (Phase 4 — combat state machine, damage, hit detection), `js/comboSystem.js` (Phase 4 — combo tracking + scaling), `js/combatAudio.js` (Phase 4 — WebAudio synth sound effects)

## Project structure

```
rishu-com/
  index.html
  css/style.css
  js/main.js
  js/arena.js
  js/menu.js
  js/characters.js
  js/fighterModels.js       # Phase 2 — procedural fighter models
  js/fighterAnimations.js   # Phase 2 — idle / walk / victory / select (+ Phase 4 combat poses)
  js/characterPreview.js    # Phase 2 — live 3D preview renderer
  js/combat.js              # Phase 4 — combat state machine, damage, hit detection
  js/comboSystem.js         # Phase 4 — combo tracking + damage scaling
  js/combatAudio.js         # Phase 4 — WebAudio synth sound effects
  assets/            # reserved for future art; logo is inline SVG (no external images)
  README.md
```

## Run locally

Files use ES modules + a CDN import map, so open via a local static server (not `file://` directly — module + import-map loading can be blocked):

```bash
cd rishu-com
python3 -m http.server 8000
# open http://localhost:8000
```

Or with Node:

```bash
npx serve .
```

Needs an internet connection for the Three.js CDN on first load.

## Deploy

### GitHub Pages (live: `dad-collab/rishu-ko-maro`)

1. Push this folder to the repo's `main` branch.
2. GitHub → repo → **Settings → Pages** → Source: **Deploy from a branch** → branch `main`, folder `/ (root)` → Save.
3. Site is live at `https://dad-collab.github.io/rishu-ko-maro/`.

### Vercel (static)

1. Import the repo in Vercel, or drag-and-drop this folder in the Vercel dashboard.
2. No build command, no framework preset — it is a static site; output directory is the project root.
3. Deploy. No environment variables are needed.

## Colours (redesign 2026-11-15)

- Page deep navy `#0E1B2E`, deep `#0A1424`, dark panels `#16283F`
- Ivory surfaces `#FFFDF6` / `#F7F2E7` / `#EFE7D6`, silver borders `#C9CDD3` / `#A9AEB8`
- Primary burnt orange `#BC5222` (hover `#9A3F16`, small text `#7E3410`, small text on navy `#E07B45`)
- Muted steel blue `#5B7A99` (deep `#3E5A75`, small text on navy `#8FA9C2`)
- Ink text `#1B2A3D` on ivory, warm paper `#F2EDE3` on navy
- All body text ≥ 4.5:1, large/bold ≥ 3:1 — verified with `../rishu-com-redesign-draft/contrast_check.py`
- Flat colour only, no heavy gradients — by design.
