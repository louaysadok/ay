<p align="center"><img src="assets/icons/logo.svg" alt="Port Ops Simulator" width="480"></p>

# Port Ops Simulator

A lightweight, original **2D top-down container-port simulation**. Drive a forklift, reach stacker,
RTG crane and mobile harbour crane around a stylised terminal, learn the job from **The Port Mentor**,
and work your way up in Career mode.

Plain HTML5 + CSS3 + vanilla JavaScript + Canvas 2D. No engine, no framework, no runtime dependencies.
Everything runs **offline**; saves stay on your device. All graphics are drawn procedurally in code.

> Cargo weights, capacities and rules are **simulation data for gameplay**, not professional safety guidance.

## Features
- **Four playable machines** - Forklift, Reach Stacker, RTG Crane, Mobile Harbour Crane - each with its own handling and lifting gear.
- **Six connected areas** - ship berth, container yard, warehouse, truck gate, maintenance area, training area.
- **Three modes** - *Academy* (guided lessons), *Career* (XP, credits, levels, unlocks, medals, achievements), *Free Operations*.
- **The Port Mentor** - a hard-hat NPC with a ~12-step tutorial, contextual tips and an "Ask the Mentor" panel.
- **Scoring** - Safety 35 / Accuracy 25 / Equipment 20 / Time 10 / Efficiency 10, with explained failures.
- **English, French, Arabic** (with right-to-left layout).
- Synthesised audio (no audio files), volume and mute, remappable keys, local save with export/import.
- Keyboard + mouse on desktop, landscape touch controls on phones and tablets.

## Run it
Needs Node 18+ only to serve the files (no `npm install` needed for the browser version).

    npm start            # then open http://localhost:4173

The game uses ES modules and `fetch()`, so it must be served over HTTP - opening `index.html` directly (`file://`) will not work.

## Controls (defaults, remappable in Settings)
| Action | Keys |
|---|---|
| Drive / steer | W A S D or arrow keys |
| Brake | Space |
| Pick up / place | E |
| Lift / lower, tilt or reach, rotate | R / F, T / G (varies per machine) |
| Switch machine / camera | C, V |
| Zoom | [ and ] (or - and =) |
| Map | M |
| Ask the Mentor | Q |
| Help | F1 |
| Pause | Esc |

The bottom-left of the screen always lists the controls of the machine you are driving.

## Desktop and Android apps
- **Windows** - Electron wrapper in `desktop/`. `npm install && npm run electron:build` produces `release/*.exe`.
- **Android** - Capacitor project in `android/`. `npm run cap:sync && npm run cap:open:android`, or `npm run android:debug`.
- **Cloud build** - `.github/workflows/build.yml` builds both from GitHub Actions (manual run or a `v*` tag).

Full steps are in [BUILD.md](BUILD.md). Note: the wrappers have not been built on a real machine yet, so expect small first-build fixes.
Artwork sources are SVG files in `assets/icons/`; `npm run icons` regenerates the PNG/ICO/Android icons.

## Project layout
    index.html            entry page
    src/engine/           game loop, input, camera, collision, event bus
    src/sim/              terminal, containers, machines, attachments
    src/gameplay/         game flow, missions, scoring, progression
    src/render/           renderer, terrain, procedural sprite factory
    src/education/        The Port Mentor
    src/ui/               screens, HUD, dialogue, touch controls
    src/systems/          audio, localisation, settings, save, loader
    src/data/             machines, missions, lessons, terminal, dialogue, strings (en/fr/ar)
    styles/               main, game, ui, mobile CSS
    tools/                dev server, smoke test, e2e test, bundler, icon generator
    desktop/ android/     Electron and Capacitor wrappers

## Testing
    npm run smoke                 # headless simulation + data checks
    node tools/check-css.mjs      # CSS sanity check
    npm run e2e                   # real-browser playthrough (needs puppeteer-core + Chromium)

## Adding a machine
Add an entry to `src/data/machines.json`, a class in `src/sim/` extending `Vehicle`, a drawer in
`src/render/SpriteFactory.js`, and register it in `src/gameplay/createMachine.js`.

## Credits
Original code and art. Visual references were used for inspiration only; no third-party assets are included.
