# RISHU.COM — Phase 2

Premium 3D browser-based fighting game. **Original branding, UI, characters and visuals only** — nothing copied from FightKaro or any other game.

**Visual redesign (2026-11-15):** the whole interface was rebuilt from scratch with its own identity — deep navy `#0E1B2E`, warm ivory surfaces `#F7F2E7`, burnt-orange primary `#BC5222`, muted steel blue `#5B7A99`, silver hairline borders. Asymmetric editorial homepage with a live 3D fighter showcase, Archivo Black display type + Inter body, full-screen character showcase with a horizontal fighter carousel, and a separate mobile layout (stage-first hero, sticky bottom action bar). The old black/blue system is gone — no trace of the old steel-blue accent remains anywhere in the live UI.

**Phase 1** (done): main menu, game modes, character selection, How to Play, Settings, fullscreen, loading screen, and a real 3D arena preview (Three.js + WebGL).

**Phase 2** (this build): six original fighters with distinct procedural 3D models, a live rotatable 3D character preview, idle / walk / victory / selection animations, and a confirmed-pick flow that carries the selected fighter into the arena. **Fighting gameplay is NOT in Phase 2** — it comes in Phase 3. The arena screen says this honestly; nothing is faked.

## What is in Phase 2

- **Homepage** — asymmetric 5/7 hero: editorial headline, large Play Now button, stat strip, and a live 3D fighter showcase (Rishu, drag to rotate, auto-rotate). Below it: staggered game-mode cards, an arena-preview section with an octagon diagram, and a featured-fighters scroll strip that opens character select focused on that fighter.
- **Character selection screen** — full-screen split: large live 3D preview (real Three.js model, never a static image) on a navy stage with the fighter's name overlapping the stage edge, beside an ivory detail panel (tagline, personality, special move, stat bars). Below: a horizontal fighter carousel (scroll-snap, focused card centred). Drag the preview to rotate; Auto-rotate toggle; Walk Preview toggle.
- **Six original fighters** — Rishu (Balanced Striker), Ayaan (Storm Fist), Kabir (Iron Wall), Zara (Shadow Step), **Dev (The Forge, new)**, **Meera (Storm Dancer, new)**. Each has a unique procedural low-poly model: different body proportions, outfit, hairstyle and accessories, plus its own colour combination.
- **Stats** — Strength, Speed, Defense, Special Power (1–10 each) as animated visual bars on cards and in the preview detail panel.
- **Animations** — idle (breathing / guard sway), walking (leg/arm swing + bob), victory pose (arms raised, plays on selection confirm), selection animation (full spin + scale pulse + accent ring on switch). Procedural only, driven by `js/fighterAnimations.js`.
- **Selection experience** — smooth switching with spin transitions, Select Fighter button, confirmed ✓ badge, selected-card highlight animation, Back and Continue buttons. Continue is enabled only after a valid confirmed pick.
- **Game integration** — confirmed pick saved to `localStorage` (`rishu.selection.v1`) and pre-focused on the next visit; passed to the arena preview, which now shows the fighters' real Phase 2 models. CPU opponent is a random different fighter; Player 2 cannot pick the same fighter as Player 1 (Swap Pick works as in Phase 1). Fighter data shape (`stats + model builder + animation hooks`) is ready for combat — see the `PHASE 3 HOOK` comments in `js/fighterModels.js` and `js/fighterAnimations.js`.
- **Preserved Phase 1** — homepage, branding, 3D arena, modes (PvC / 2P Local / Online Coming Soon), How to Play, Settings, fullscreen, loading screen — all still working.
- **Responsive** — desktop / laptop / tablet / mobile, with a separate mobile layout (not a shrunk desktop): stage-first hero with an overlapping content card, mode rows, bottom-sheet modals, character select as stage → overlap detail → carousel → sticky bottom action bar with safe-area padding. No horizontal scrolling, touch-friendly (44px+ targets).
- **Performance** — preview renderer is created lazily and pauses when the character screen is not visible; pixel ratio capped at 2; shadows only on Medium/High.

## What is NOT in Phase 2 (honest list)

- Combat: punches, kicks, blocks, specials — Phase 3
- Health bars, rounds, timer, win/lose — Phase 3
- Keyboard / touch fight controls — Phase 3 (WASD is intentionally not active yet)
- CPU AI — Phase 3
- Online Multiplayer — later phase, marked Coming Soon in the UI
- No visual browser confirmation in this VM (no Chromium/Playwright) — open `http://localhost:8000` in a real browser to confirm the preview renders and the camera orbits.

## Tech

Plain HTML / CSS / JS — no build step, no framework.

- Three.js `0.160.0` via CDN ES modules (import map in `index.html`)
- WebGL rendering, `OrbitControls` for the arena camera
- Modular files: `js/main.js` (boot + loading), `js/arena.js` (Three.js arena scene), `js/menu.js` (screens/modals/settings/character select), `js/characters.js` (fighter data + stats), `js/fighterModels.js` (procedural 3D models), `js/fighterAnimations.js` (animation state machine), `js/characterPreview.js` (live 3D preview renderer)

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
  js/fighterAnimations.js   # Phase 2 — idle / walk / victory / select
  js/characterPreview.js    # Phase 2 — live 3D preview renderer
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
