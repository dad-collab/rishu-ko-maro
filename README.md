# RISHU.COM — Neon Redesign (Build A) + Phase 6

Premium 3D browser-based fighting game. **Original branding, UI, characters and visuals only** — nothing copied from FightKaro or any other game.

**Neon redesign, Build A (2026-11-17):** the whole interface was rebuilt from scratch with its own identity — void black `#0A0612`, neon purple primary `#A855F7` (deep `#7C3AED`, bright `#C084FC`), gold crown mark `#F5C518` (crown only), restrained neon glow, Archivo Black display type + Inter body. Game-style main menu: a live two-fighter cinematic scene (Rishu vs Ayaan, idle animations) under the crowned RISHU.COM lockup ("FIGHT LIKE A LEGEND") with PLAY / CHARACTER SELECT / SETTINGS / QUIT — every button works (QUIT tries `window.close()` and shows an honest "close this tab" fallback, because a page cannot close its own tab). Rishu's face is the user's own photo — exact on his character card and HUD portrait, and as a photo-derived face texture on the in-arena 3D fighter (front view matches the photo; side angles are stylised). SFX volume slider in Settings (honest, no music system behind it). G1 graphics: cinematic purple/red light rig, shared PMREM environment lighting, contact shadows, glossy floors, impact flash + ground dust on heavy hits. No bloom (cut by measurement — see below). The old Harbour navy/ivory/burnt-orange system is gone — no trace of it remains anywhere in the live UI.

**Phase 1** (done): main menu, game modes, character selection, How to Play, Settings, fullscreen, loading screen, and a real 3D arena preview (Three.js + WebGL).

**Phase 2** (done): six original fighters with distinct procedural 3D models, a live rotatable 3D character preview, idle / walk / victory / selection animations, and a confirmed-pick flow that carries the selected fighter into the arena.

**Phase 3** (this build): 3D player movement and controls. Walk / run / jump with keyboard (P1 WASD + Space + Shift; P2 arrows + Right Shift + Enter in Two Player Local) and touch (left virtual joystick + JUMP button, P1 only), a fixed side-view fight camera (orthographic, Tekken-style — see below) that keeps both fighters in frame, camera-relative movement, arena-boundary collision, fighter separation, smooth facing toward the opponent, run / jump / land / turn / back / side animation states with blended transitions, a match HUD (names, character icons, count-up timer, Pause that actually pauses, Quit to Game Modes) and honestly labelled health-bar placeholders for Phase 5. **No combat in Phase 3** — no attacks, damage, health logic, rounds, win/lose, or CPU AI. The arena screen says this honestly; nothing is faked.

## What is in Phase 2

- **Main menu** — game-style menu: live two-fighter scene (Rishu vs Ayaan) under the crowned logo lockup, then PLAY / CHARACTER SELECT / SETTINGS / QUIT buttons and a stat strip (06 Fighters · 01 Arena · 03 Modes). Game modes, fighters and the arena are still reachable from the nav, the footer and the modes screen.
- **Character selection screen** — full-screen split: large live 3D preview (real Three.js model, never a static image) on a dark stage with the fighter's name overlapping the stage edge, beside a dark detail panel (tagline, personality, special move, stat bars). Below: a horizontal fighter carousel (scroll-snap, focused card centred, glowing-purple focused/selected states). Rishu's card shows the user's photo. Drag the preview to rotate; Auto-rotate toggle; Walk Preview toggle.
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
- **Camera (fixed side view, Tekken style)** — one permanent orthographic pose per match: position (0, 5.3, 12.0), lookAt (0, 2.35, 0), elevation ~13.8°, frustum sized once at match start from the live aspect (`H = max(2.3, 5.25 / aspect)`); resize re-sizes the frustum only — position/rotation never move. No follow, no zoom, no rotation, no tracking, no drag/pinch in a match — just a subtle shake on heavy hits only (≤ 0.08 m, ≤ 0.35 s, returns to the exact pose). No intro: arena entry starts the fight immediately (the 3.2 s cinematic sweep was removed 2026-11-15). Near-side ropes fade to opacity 0.15 during a match so they never hide a fighter, restored on every exit. Free orbit resumes outside a match. On phones the fight plays in landscape — a rotate prompt gates portrait entry and pauses mid-match — so fighters stay ~48-50% of canvas height, the same as PC.
- **Touch controls** — left virtual joystick (P1 only; push to the edge to run) and a JUMP button on the right; pointer capture, no page scroll during play, shown only on touch devices.
- **HUD** — P1/P2 names + character icons, count-up match timer, health bars that are static labelled placeholders ("HEALTH · PHASE 5" + "PLACEHOLDER"), Pause button / `P` / `Esc` that actually freeze movement and the timer, Resume and Quit to Game Modes. (Phase 4 makes the health bars live — see below.)
- **Animations** — run, jump, land (0.14 s hold), turn (scissor step + torso twist), back, side (lateral steps + lean), all blended on transition (0.05–0.15 s) with a shared walk phase so walk↔run never snaps a leg.
- **Boundaries** — fighters cannot leave the ring (radius 4.6) or pass through each other (min separation 1.0 m); both always face the opponent with smooth shortest-arc turning.

## What is in Phase 4

- **Attacks** — Light Punch (`J`), Heavy Punch (`K`), Kick (`U`), Heavy Kick (`I`), each with real 3D animation (startup / active / recovery), duration, cooldown, range and hitstun. P2 (Two Player Local): Numpad `1` / `2` / `3` / `0` (fallback `,` / `.` / `/` / `'`), all in one `P2_COMBAT_KEYS` config object in `js/movement.js`. No air attacks, no spam: an attack cannot start during an incompatible animation, and holding an attack key queues one attack only.
- **Damage (deterministic, no random numbers)** — `round(base × (0.8 + 0.04·strength) × (1.15 − 0.03·defense) × comboScale)`, reach scaled by the attacker's Range stat (`reach = base × (0.9 + 0.025·range)`). Phase 5 bases: Light 5, Kick 8, Heavy Punch 12, Heavy Kick 14, Special 20. Worked examples (attacker → defender): Rishu→Kabir 5 / 11 / 8 / 13, Dev→Zara 6 / 14 / 10 / 17, Ayaan→Meera 6 / 14 / 9 / 16, Zara→Dev 5 / 11 / 8 / 13 (Light / Heavy Punch / Kick / Heavy Kick). One hit per attack by construction: a single hit test on the active window's first frame, a facing guard, and a `hitDone` flag.
- **Defense** — Block (`L`, hold): high guard blocks high + mid, low guard (`L`+`S`) blocks mid + low; blocked hits deal small chip damage and push the defender back. Dodge (`O`): a 0.28 s dash with i-frames 0.05–0.25 s; Backward Evade (`S`+`O`): 1.8 m straight back, i-frames 0.05–0.30 s. P2: Numpad Enter block, Numpad 5 dodge (fallback `;` / `M`).
- **Combos** — a 1.2 s window measured in **sim-time** (the arena's accumulated dt), not wall-clock time, so the window cannot expire between landed hits on a slow device — three attacks are 1.02 s of sim, which is over 1.2 s of wall time below ~15 fps. A counter appears at 2+ hits, damage scaling ×1.0 (hits 1–2), ×0.9 (3–4), ×0.8 (5+), chain buffering (0.35 s, one buffered attack, cleared on hit), and interruption (a whiff, a dodge, or the opponent blocking breaks the chain).
- **Hit detection & reactions** — range-only hits (no hits from unrealistic distance), hitstun that locks the defender's movement (0.22–0.50 s by attack), knockback on heavy attacks, hit-reaction animations (`hit` / `hitHeavy`), and a KO fall at 0 HP.
- **Effects** — subtle hit flash on the defender, hitstop freeze (0.04 s heavy punch, 0.06 s heavy kick), and punch/kick/block/dodge/KO sounds synthesised with WebAudio (`js/combatAudio.js`, zero audio files) that respect the Settings sound toggle and never throw. (Camera: fixed pose, with a subtle shake on heavy hits only — ≤ 0.08 m, ≤ 0.35 s, returns to the exact pose.)
- **Health & rounds** — 100 HP per fighter, live HUD bars (danger-red low-health state at ≤ 25 HP). A KO at 0 HP wins the ROUND (best-of-3, first to 2 takes the match): the round KO freezes 1.0 s with a round banner, then HP / positions / cooldowns / combo / timer reset and a "ROUND n — FIGHT!" intro runs (1.2 s, input frozen). The match win shows a WINNER screen reusing the pause box; Rematch restarts the same mode and fighters immediately.
- **Touch combat** — LP / HP / KICK / HK tap buttons, hold-to-block BLOCK, tap DODGE, tap SP for the special, in a 3×3 grid beside JUMP (P1 only, ≥ 44 px targets). Touch block is high guard only (no low guard on touch).
- **Integration rule (the setFighters lesson)** — the arena tick calls `combat.syncAnimator()` AFTER the movement controllers and BEFORE `animator.update`, or the controllers would overwrite attack / hit / block poses with idle in the same frame. Combat updates run BEFORE the controllers so hit tests use pre-move positions.

## What is in Phase 5

- **Specials (one signature move per fighter, cooldown-gated, no meter)** — Rishu **Ember Rush** (Ultimate, 12 s), Ayaan **Storm Barrage** (Power Punch, 3 real hits 7+7+6, 6 s — only the final hit knocks back, so all three connect), Kabir **Iron Counter** (Power Punch, knockback 0.55, 6 s), Zara **Shadow Step** (Energy Blast — the ONLY projectile: 8 m/s, 6 m, radius 0.9 m, 8 s), Dev **Forge Slam** (Power Punch, knockback 0.60, 6 s), Meera **Cyclone Kick** (Special Kick, range 2.8 m, 7 s). Inputs: P1 `H`, P2 Numpad `6` (alt `N`), touch **SP**. Phase 6: the PvC CPU uses its special too (rarely, gated on the same cooldown — see Phase 6). Specials count in the combo (and scale with it — a special as hit #3 deals ×0.9); no chaining through a special. A blocked single-hit special deals chip 2 (Barrage: ~1 per blocked sub-hit); a whiffed special still spends its cooldown. Cooldowns run on sim-time and reset per round and per rematch.
- **Damage** — flat bases × the existing stat formula: Light 5, Kick 8, Heavy Punch 12, Heavy Kick 14, Special 20. Equal-stats pair lands exactly 5 / 8 / 12 / 14 / 20; Rishu→Kabir lands 5 / 8 / 11 / 13 / 19; the special roster spread is 18–24. Block reduces damage; one hit per attack (no double-register); damage only when the attack actually connects.
- **Rounds** — best-of-3, first to 2. Round KO → 1.0 s freeze → round banner → reset (HP / positions / cooldowns / combo / timer) → "ROUND n — FIGHT!" intro 1.2 s (input frozen). Timer resets per round (count-up, no timeout). The WINNER screen reuses the pause/KO overlay box (new 'winner' mode); the Phase 4 `showKo` is retired. Double KO is impossible by construction (only the defender takes damage).
- **HUD** — names stacked ABOVE health bars, HP with `%` suffix, special slots (move name + depleting cooldown bar + READY state), round pips + "ROUND n" label, count-up timer.
- **Defense** — recovery is now a distinct pose: the combat module drives seg/segT (startup / active / recovery) into the animator for attacks AND specials, so the recovery keyframes actually render (Phase 4 passed only `phase`, so poses sat at guard — fixed in `js/combat.js` + `js/fighterAnimations.js`, including the seg-2 blend-from fix: seg 2 blends k1 → guard, not k0 → guard). No attacks during incompatible animations; block/dodge stay smooth and responsive. Hitstop is an explicit per-attack field now (decoupled from the live heavy-hit shake guard — the shake call site is untouched).
- **Sounds** — four new WebAudio profiles: `specialPunch` (low thud), `specialKick` (whoosh + thud), `energyBlast` (sine sweep 300 → 1200 Hz + noise), `ultimate` (layered deep thud, 0.35 s).

## What is in the Visual Upgrade

- **Tournament stadium (`js/stadium.js`)** — three tiered stand rings (lathe-built, one mesh per ring), 500 instanced spectators on desktop / 250 on mobile (2 `InstancedMesh` draws, subset bob every ~100 ms, no shadows), 4 canvas banners, an emissive jumbotron (static canvas texture, redrawn per matchup), a light truss with 4 additive light cones and a warm wash over the far crowd. Stadium ≤ 25 draw calls; total ≤ 150 desktop / ≤ 110 mobile. Ring geometry, clamp r=4.6, ropes and spawn points are untouched.
- **Character rig v2 (`js/fighterModels.js`)** — elbow + knee pivots, hands (glove + thumb), neck, faces (brow, nose, mouth, ears), chest/abdomen torso split and richer clothing. Proportions fixed: head Ø 0.47 → 0.32 (~13.5% of height), hip pivot 0.82 → 1.15 (legs ~50% of height). Total height UNCHANGED ~2.35 so the fixed-camera framing holds. All 6 identities kept.
- **Animations (`js/fighterAnimations.js`)** — the slide fix: the walk phase rate now comes from the controller's measured speed (`setSpeed()`, fed by the arena tick), the swing scales with speed and the foot plants at full forward reach. Punches extend the elbow, kicks chamber the knee, blocks cross the forearms, hits step back instead of sliding, dodges push off. Phase 5 drives the special pose slots (`special` state, kinds punch / blast / kick / ultimate) with seg/segT per-segment keyframes.
- **Presentation** — theatre mode (the arena fills the viewport during a match, nav/footer hidden), the HUD overlays the canvas (names above the bars, bars draining toward the centre timer badge, HP as `100%`), a FIGHT banner + 1.2 s fight-start freeze (input + timer held), and a victory moment on KO (winner `victory` pose + confetti + crowd surge). `js/effects.js` is the ONE shared effects module (pooled particles: bursts, rings, trails, confetti) — Phase 5 reuses it unchanged.
- **Camera** — unchanged and still fixed: no auto-distance, no zoom — just a subtle shake on heavy hits only (≤ 0.08 m, ≤ 0.35 s, returns to the exact pose). The fixed frustum (half-width 5.25 m) already frames both fighters at every legal separation.

## What is in Phase 6

- **Computer opponent (`js/ai.js`, pure logic — no DOM, no three, no `Math.random`)** — the PvC CPU now fights: it perceives world state only (positions, combat/animator states, HP, combo counts, sim time — never your keys), decides at 10 Hz with a per-difficulty reaction delay, and feeds combat.js/movement.js exactly the same input shapes a human feeds them. Four behaviours (aggressive / defensive / balanced / counter) as parameter rows over one state machine, auto-switching on HP differential, your combo count, your passivity and the round score (2 s dwell, no flicker). Scored attack choice (heavyKick > heavyPunch > kick > lightPunch, plus punish/combo/range bonuses), chain follow-ups through the existing buffer, blocks (high/low guard by the incoming attack), dodges/evades, whiff punishes, spacing, rope-escape sidesteps and an anti-stuck watchdog. Hard range gate: no attack outside `reachFor() × 0.95`; never the same attack 3 times in a row; no attack while locked or airborne. The AI never touches damage, HP or the camera — AI heavy hits shake through the shared `handleCombatEvent` call site.
- **Three difficulties (behaviour only — damage is identical on every level)** — EASY: reaction 0.12 s, block 0.15, dodge 0.10, counter 0.10, attack frequency 0.30, combos never, walk approach, mistake rate 0.20. MEDIUM: 0.08 s / 0.35 / 0.25 / 0.35 / 0.50 / 0.35, walk/run mix, mistake 0.10. HARD: 0.05 s / 0.55 / 0.40 / 0.65 / 0.70 / 0.65, run when far, mistake 0.03. Reaction calibration (measured): a block only stops a hit if it lands before the attack's startup (lightPunch 0.10 s, kick 0.14 s, heavyPunch 0.18 s, heavyKick 0.24 s) — the first values tried (0.45 / 0.28 / 0.16 s) exceeded every startup and the harness measured a 0% block rate, so they were scaled to fit inside the startups; the difficulty distinction is carried by the rates. All in one `DIFFICULTY` table in `js/ai.js` (tuning is a data edit). Deterministic per match seed: the same scripted opponent sequence + same seed produces the same AI action sequence (seeded PRNG tie-breaks only).
- **CPU pick + difficulty select** — on the character select screen (PvC only): pick your fighter, then tap another fighter + Select Fighter to set the CPU opponent (or Random CPU opponent); three difficulty buttons (Easy / Medium / Hard, Medium default), persisted in `rishu.ai.v1` (`{ difficulty, cpuPick }`). 2P Local is unchanged — no difficulty row, no CPU slot, and the AI is never constructed there (asserted in the harness + E2E).
- **Match system** — the HUD shows `CPU · EASY/MEDIUM/HARD` under the timer (PvC only); the winner screen says **YOU WIN** / **YOU LOSE** in PvC (names in 2P). Rematch keeps the same difficulty; **Change difficulty** goes back to character select (pre-selected from storage). Specials: the AI scores its signature special like any attack, gated on the real Phase 5 cooldown (`specialB.isReady`) — rarely on Easy, when it would KO or end a round on Hard. Rounds-aware: down a round it presses (aggressive), up a round it holds the lead.
- **Camera & animation** — untouched: fixed Tekken side view, both fighters in frame, facing automatic, no sliding (the AI moves only through the controller, so the slide fix applies to it too).

## What is NOT in Phase 6 (honest list)

- Online Multiplayer — later phase, marked Coming Soon in the UI
- "Feels intelligent" is judged on a real device, not in this VM — the harness/E2E prove the AI acts legally, in range, with the right rates; EASY-beatable vs HARD-oppressive is the user's call (one tuning pass expected — parameters live in one table in `js/ai.js`).
- Feel, smoothness and 60 FPS on a real phone are the user's test — headless Chromium (SwiftShader) proves function, not feel.

## Tech

Plain HTML / CSS / JS — no build step, no framework.

- Three.js `0.160.0` via CDN ES modules (import map in `index.html`)
- WebGL rendering, `OrbitControls` for the arena preview camera; the fight uses a fixed orthographic side-view camera (`js/fixedCamera.js`)
- Modular files: `js/main.js` (boot + loading), `js/arena.js` (Three.js arena scene + match lifecycle), `js/menu.js` (screens/modals/settings/character select), `js/characters.js` (fighter data + stats), `js/fighterModels.js` (procedural 3D models), `js/fighterAnimations.js` (animation state machine), `js/characterPreview.js` (live 3D preview renderer), `js/menuScene.js` (Build A — two-fighter menu scene), `js/environment.js` (Build A — shared PMREM env + contact-shadow texture), `js/rishuFace.js` (Build A — Rishu's photo crops as base64 data URIs), `js/movement.js` (keyboard input + fighter controller), `js/fixedCamera.js` (fixed side-view fight camera), `js/touchControls.js` (virtual joystick + jump), `js/hud.js` (match HUD + pause), `js/combat.js` (Phase 4–5 — combat state machine, damage, hit detection, specials), `js/comboSystem.js` (Phase 4 — combo tracking + scaling), `js/combatAudio.js` (Phase 4–5 — WebAudio synth sound effects), `js/specials.js` (Phase 5 — special definitions + cooldowns), `js/rounds.js` (Phase 5 — best-of-3 rounds)

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
  js/combat.js              # Phase 4–5 — combat state machine, damage, hit detection, specials
  js/comboSystem.js         # Phase 4 — combo tracking + damage scaling
  js/combatAudio.js         # Phase 4–5 — WebAudio synth sound effects
  js/specials.js            # Phase 5 — special definitions + cooldown state
  js/rounds.js              # Phase 5 — best-of-3 round system
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

## Colours (neon redesign, Build A 2026-11-17)

- Void `#0A0612` (page), panel `#120A1E`, raised `#1B1030`, surfaces `#17102A` / `#221741`
- Neon purple `#A855F7` (primary buttons, white text), deep `#7C3AED` (hover / small buttons), bright `#C084FC` (small neon text on dark)
- Gold `#F5C518` — the crown mark ONLY, never a UI colour
- Ink text `#F5F0FF` on dark, muted `#B8A8D9`
- Danger red `#DC2626` (low health, danger only)
- Fighter colours: Rishu `#A855F7`, Ayaan `#E8E8EC` (silver-white), Kabir `#6D28D9`, Zara `#C026D3`, Dev `#B8A8D9`, Meera `#818CF8`
- Flat colour + restrained glow shadows only, no cheap gradients — by design.
- Bloom was CUT in Build A (see below): the neon look comes from the light rig + PMREM env + CSS glow, not a post-processing pass.

## What is NOT in Build A (honest list)

- **Bloom** — UnrealBloomPass was evaluated and CUT: it would need a composer swap across the whole render path (arena + preview + menu scene) for a gain the VM cannot measure (fill-rate cost is a real-device property). The neon look is delivered without it; bloom can be revisited if a real device shows headroom.
- **Build B** — victory screen rebuild + per-round times (not started).
- **Build C** — stage select + 4 arenas (Temple / City / Desert / Snow) + per-stage lighting (not started).
- **G2** — FPS meter + auto-quality governor (not started; manual 3-tier quality stays).
- **Music** — no background music system; the Settings slider is SFX volume only.
- **Rishu's face, side angles** — the 3D fighter's face matches the photo from the front; side angles are stylised by the sphere's curvature (a 2D photo on a procedural head cannot be pixel-identical from every angle).
