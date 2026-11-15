# RISHU.COM — Phase 1

Premium 3D browser-based fighting game. **Original branding, UI, characters and visuals only** — nothing copied from FightKaro or any other game.

Phase 1 is the **foundation only**: main menu, game modes, character selection, How to Play, Settings, fullscreen, loading screen, and a real 3D arena preview (Three.js + WebGL). **Fighting gameplay is NOT in Phase 1** — it comes in Phase 2. The arena screen says this honestly; nothing is faked.

## What is in Phase 1

- **Main menu** — RISHU.COM logo (hand-made geometric-R SVG), Play Now, Game Modes, Character Selection entry, How to Play, Settings, Fullscreen. Every button works or is clearly marked Coming Soon.
- **Game modes** — Player vs Computer, Two Player Local, Online Multiplayer (clearly marked **COMING SOON**, disabled).
- **Character selection** — 4 original fighters: Rishu (Balanced Striker), Ayaan (Storm Fist), Kabir (Iron Wall), Zara (Shadow Step). Click to select, visible selected state, Confirm goes to the arena preview.
- **3D arena** — octagonal ring, procedural canvas floor texture, corner posts + ropes, arena walls, professional lighting (key + fill + rim + overhead spots), shadows, cinematic auto-orbit camera, drag-to-orbit / scroll-to-zoom, two stylised preview fighters.
- **Settings** — sound on/off + graphics quality (Low / Medium / High — actually changes pixel ratio and shadows), persisted in `localStorage`, with Reset.
- **Fullscreen** — real Fullscreen API toggle.
- **Loading screen** — progress bar tracks real init steps; error state if WebGL is unavailable (no infinite loading).
- **Responsive** — desktop / laptop / tablet / mobile, no horizontal scrolling, touch-friendly (44px+ targets).
- **Performance** — pixel ratio capped at 2, shadows only on Medium/High, rendering paused when the tab is hidden, minimal idle animation only.

## What is NOT in Phase 1 (honest list)

- Combat: punches, kicks, blocks, specials — Phase 2
- Health bars, rounds, timer, win/lose — Phase 2
- Keyboard / touch fight controls — Phase 2 (WASD is intentionally not active yet)
- CPU AI — Phase 2
- Online Multiplayer — later phase, marked Coming Soon in the UI

## Tech

Plain HTML / CSS / JS — no build step, no framework.

- Three.js `0.160.0` via CDN ES modules (import map in `index.html`)
- WebGL rendering, `OrbitControls` for the camera
- Modular files: `js/main.js` (boot + loading), `js/arena.js` (Three.js scene), `js/menu.js` (screens/modals/settings), `js/characters.js` (fighter data)

## Project structure

```
rishu-com/
  index.html
  css/style.css
  js/main.js
  js/arena.js
  js/menu.js
  js/characters.js
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

### GitHub Pages (repo name: `RISHU`)

1. Create a GitHub repo named **RISHU** (do not push until the owner confirms).
2. Push this folder to the repo's `main` branch.
3. GitHub → repo → **Settings → Pages** → Source: **Deploy from a branch** → branch `main`, folder `/ (root)` → Save.
4. Site will be live at `https://<username>.github.io/RISHU/` (replace `<username>` with the GitHub username).

### Vercel (static)

1. Import the `RISHU` repo in Vercel, or drag-and-drop this folder in the Vercel dashboard.
2. No build command, no framework preset — it is a static site; output directory is the project root.
3. Deploy. No environment variables are needed in Phase 1.

## Colours

- Background black `#0A0A0C`, charcoal `#14161A` / `#1C1F26`
- Accent electric blue `#4F7DF3` only, soft white text `#F5F6FA`
- No neon colours, no heavy gradients — by design.
