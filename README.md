# PenPlot Studio

A pen-plotter G-code generator for the **Bambu Lab X1 Carbon**, modelled on 3dplotter.xyz and set up for the
Falu pen mount (UMTS / *Head Mount V1 – Series X & P*). Mount notes:
[MakerWorld 2029113](https://makerworld.com/en/models/2029113-modular-system-for-a1-p1-x1-series). Workflow:
[Instructables guide](https://www.instructables.com/Turn-Your-Bambu-Lab-X1-Carbon-Into-a-Pen-Plotter-i/).

Design on a to-scale model of the plate, then preview the **simulated G-code**. Download the file (it passes a
safety check first) and print it from the SD card. There are no firmware changes and nothing to install.

> **Status (2026-09-29):** the software is complete and heavily tested. It has **not been run on a real printer
> yet.** Read [HANDOFF.md](HANDOFF.md) before the first physical plot.

## Running it

- **Easiest:** double-click `index.html` to open it in Chrome or Edge.
- **Local server (works offline):** `npm start` (Node) or `python serve.py`. Either one serves
  http://127.0.0.1:8791 with caching off and opens your browser. On Windows you can also double-click
  `Start PenPlot Studio.bat`, which uses Node, then Python, and falls back to opening `index.html`.

Fonts and opentype.js (for uploaded fonts) are bundled in `vendor/`. With a local server the app needs no
internet at all. A page opened by double-clicking (`file://`) can't read local font files, so it loads them
from jsDelivr/cdnjs instead. Work autosaves to IndexedDB in the browser. Use **Save project** to keep a
`.penplot.json` file.

## Development

The app itself has no build step: `js/` is plain browser scripts loaded in order by `index.html`. The dev
tooling runs on **Node 24 LTS** on Windows and Linux.

| Setup | Linux (Ubuntu) | Windows |
|---|---|---|
| Node 24 | NodeSource: `curl -fsSL https://deb.nodesource.com/setup_24.x \| sudo -E bash -` then `sudo apt install nodejs` | `winget install OpenJS.NodeJS.LTS` |
| Dependencies | `npm ci` | `npm ci` |
| Test browser (once) | `npx playwright install chromium` | `npx playwright install chromium` |

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with live reload (the page reloads on save; CSS swaps in place) |
| `npm start` | Dev server without live reload (`-- --port 9000`, `-- --no-open`) |
| `npm test` | Vitest: unit tests + the shared suites + a 30-scenario seeded fuzz, in Node (≈ 20 s) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:coverage` | Coverage report in `coverage/` |
| `npm run test:fuzz` | 2000 fuzz scenarios (`FUZZ_N` / `FUZZ_SEED` override counts in any test command) |
| `npm run test:e2e` | Playwright: UI tests + the full browser suite in Chromium, offline |
| `npm run test:e2e:full` | Browser suite with 200 fuzz scenarios (the reference run) |
| `npm run lint` / `format` / `typecheck` | ESLint, Prettier, `tsc --checkJs` on the core modules |
| `npm run check` | Everything CI runs |
| `npm run vendor` | Re-download the pinned fonts / opentype.js into `vendor/` |

`tests/harness.js` holds the suites and is shared by the browser page (`tests/index.html`) and Vitest
(`test/unit/`), so a failing fuzz seed from either one replays in the other: open `/tests/` and run
`await replayScenario(<seed>)` to see the simulated file drawn. `test/unit/__snapshots__/x1c-square.gcode` is a
golden file. If a deliberate generator change alters the G-code, review the diff and run `npx vitest -u`.
CI (`.github/workflows/ci.yml`) runs all of this on Ubuntu and Windows, plus a nightly deep fuzz.

## Features

| Area | What you get |
|---|---|
| **Text** | 40 single-stroke Hershey and EMS fonts, uploaded TTF/OTF (outline + optional hatch fill), **My Handwriting** (draw your own glyphs), multi-line, alignment, spacing, text on an arc |
| **Draw** | Freehand (smoothing), line, polyline, smooth curve, rectangle (rounded), ellipse, polygon, star, eraser |
| **Image** | Outline, Centerline, Edge detection, Contour levels, Photo hatch, Squiggle, Spiral, Stipple, with a live preview |
| **Patterns** | 23 generators (spirograph, harmonograph, mandala, guilloche, Hilbert, maze, flow field, topo...) |
| **Import** | SVG (curves, arcs, transforms, `<use>`), with each stroke color on its own layer; projects; SVG export |
| **Editing** | Handles for move/scale/rotate, mirror, rotate, align, fit to paper, hatch fill, convert to path, combine, lock, undo/redo |
| **Layers = pens** | Export one file with a pause for each pen change, or one file per layer. Per-layer Z-Draw and speed overrides (clamped to a safe window) |
| **Preview** | Animates the **simulated G-code**: pen strokes, travel moves, nozzle/toolhead position, and a safety badge |
| **Safety check** | Every exported file is replayed in `js/core/gcodesim.js` (see below) |
| **Calibration** | Z × speed grid, compact Z strip, frame test, **Offset finder** |

## X1C defaults

| Setting | Value | Source / meaning |
|---|---|---|
| Pen offset | **X −28, Y −35 mm** | The pen is 28 mm **left** of and 35 mm **in front** of the nozzle. Inferred from the designer's notes. **Unverified**: run the Offset finder |
| Nozzle safe zone | **X 48–256, Y 55–256** | Designer's excluded area `(0,0 258,0 258,55 48,55 48,258 0,258)`: the module can hit walls or the door outside it |
| Drawable area | ≈ 206 × 199 mm | Pen X 21–227, Y 21–220: the safe zone shifted by the offset, with a 1 mm margin |
| Z-Draw / Z-Lift | 14 / 20 mm | From Instructables. The designer uses Z ≈ 17 for a Stabilo; it depends on how far the pen sticks out |
| Attach / end height | 60 / 80 mm | The bed drops this far for attaching and removing the holder |
| Park (pauses) | nozzle X80 Y245 | Next to the purge chute, where the firmware moves the toolhead during every pause (it returns on Resume) |
| Speeds | draw 30, travel 200, Z 15 mm/s, accel 4000 | |
| Pen-down dwell | 50 ms via `M400 P50` | `G4` is reportedly unreliable on the X1 |

## What a file does (Bambu profile)

```
G90 / G21 / M83, heaters off, fans off, M220 S100, M204 S4000
G91 / M17 Z0.4 / G380 S2 Z30 / G380 S2 Z-25 / G1 Z5 / G90 / M17 ...   ; Bambu's own "drop the bed before homing"
G28                         ; home - holder NOT attached
G1 Z60 / G1 X80 Y245        ; bed down, park near the purge chute
M400 U1                     ; PAUSE 1: attach the pen holder, press Resume
G1 Z20                      ; pen up (travel height)
  G1 X.. Y.. F12000         ; travel (nozzle coords = pen - offset)
  G1 Z14 F900               ; pen down (pure Z move)
  M400 P50                  ; dwell
  G1 X.. Y.. F1800 ...      ; draw
  G1 Z20 F900               ; pen up
  (pen change between layers: bed to Z60, park, M400 U1)
G1 Z80 / park / M400 U1     ; LAST PAUSE: remove the pen holder, press Resume
G1 X152 Y250                ; toolhead to the back
```

## G-code simulator (`js/core/gcodesim.js`)

It replays the text of the file on a virtual printer and flags these problems:

- The nozzle leaves the safe zone while the holder is attached.
- The pen or holder would leave the plate.
- An XY move happens with the nozzle on the plate.
- A move changes XY and Z together while the pen is low.
- Z changes while the pen is down.
- The pen-down height is not a configured one, or is below the safe minimum.
- The printer homes or probes with the holder attached.
- A pause has no bed clearance, or happens with the pen down.
- The file ends with the pen down.
- Heaters are switched on, the file extrudes, or it uses G92 / G20.
- The motors are disabled mid-plot.
- A value is NaN or undefined, or a move has no feed rate.
- The number of strokes or the total drawn length doesn't match the design, which catches a missing pen lift.

It also rebuilds each stroke and travel move for the preview.

## Tests

`tests/harness.js` defines these suites. The browser page `tests/index.html` runs them (Run all tests, or
headless with `npm run test:e2e`), and so does Vitest (`npm test`):

1. **Simulator self-test:** 20 deliberately broken files, each of which must be caught.
2. **Edge cases:** empty designs, dots, NaN/Infinity, huge coordinates, zero scale, 30k strokes, out-of-range overrides.
3. **Coverage:** every font, every pattern (defaults/min/max), every trace mode, every calibration file on every profile, and the Offset finder.
4. **Fuzz:** random designs × random printer profiles × random optimizer settings. Each file is simulated, and the drawn
   strokes are compared with the plan (exact) and with the design (coverage + precision).
5. **Editor state fuzz:** random edit operations, undo/redo and save/load.

## Files

```
index.html  css/styles.css
js/core/    util, geometry, svg, storage, fonts, optimizer, gcode, gcodesim, patterns, imagetrace
js/app/     state (undo/redo, autosave), objects, canvas (+tools), preview, app (controller)
js/ui/      ui-core, panels-left, panels-right, modals, imagedialog, handwriting
vendor/     Hershey fonts (hersheytext 2.0.0) and opentype.js 1.3.4, with licenses
tests/      browser test page: index.html, harness.js (shared suites), tests.js (runner)
test/unit/  Vitest suites (Node + jsdom) and the golden G-code file
e2e/        Playwright specs (UI + headless browser suite)
scripts/    serve.mjs (dev server, live reload), vendor.mjs
serve.py    no-cache server for machines with only Python
HANDOFF.md  detailed status, open questions, next steps
```

## Credits

- The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. National Bureau of
  Standards. The format of the font data was originally created by James Hurt, Cognition, Inc. The SVG font
  versions are by Windell H. Oskay (Evil Mad Scientist), via [hersheytext](https://github.com/techninja/hersheytext) (MIT).
- [opentype.js](https://opentype.js.org/) (MIT). Pen mount and safe-zone data by Falu Mendy Vergara (MakerWorld).

This project is not affiliated with Bambu Lab, 3dplotter.xyz or the mount designer. Watch the printer while it plots.
