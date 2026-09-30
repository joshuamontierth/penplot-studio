# PenPlot Studio — Engineering Handoff

_Written 2026-09-29 at the end of the first build session. Updated the same day after session 2, which set up
git and the Node dev toolchain (§1, §7.5, §10, §11). It's meant to let someone (a person or an agent) pick this
project up. Read sections 1–3 before touching printer-related code._

---

## 0. TL;DR

- **What it is:** a static, no-build web app that turns designs (text, drawings, images, patterns, SVG) into
  pen-plotter G-code for a **Bambu Lab X1 Carbon** with the Falu pen mount. It's modelled on 3dplotter.xyz.
- **Software state:** feature-complete for v1. Every file is replayed in a built-in **G-code simulator** before download.
  There's a browser test suite (`tests/`) with a simulator self-test, edge cases, full font, pattern and trace coverage,
  and randomized fuzzing (see §7 for the latest results).
- **Hardware state:** **never run on the real printer.** Several physical facts are *inferred* (§3). The most
  important unknown is the **sign of the pen X offset**. The default is now −28 (pen left of the nozzle), which
  contradicts the Instructables wording. The app has an **Offset finder** calibration to settle it in about 5 minutes.
- **Dev tooling (session 2):** git, Node 24, Vitest (Node + jsdom), Playwright (headless browser suite + UI tests),
  ESLint, Prettier, `tsc --checkJs`, and a GitHub Actions workflow for Ubuntu and Windows. Fonts are vendored, so
  tests and the served app are fully offline.
- **Next steps:** (1) run the first physical checks in §9; (2) push to GitHub so CI runs; (3) the remaining items
  in §10.

---

## 1. How to run

| Purpose | Command / action |
|---|---|
| Set up (once) | Node 24 LTS, then `npm ci` and `npx playwright install chromium`. See README → Development for Linux/Windows install commands |
| Use the app | Double-click `index.html` (Chrome/Edge), or `npm start` / `python serve.py`, which serve http://127.0.0.1:8791 with no caching and open a browser |
| Develop | `npm run dev` (live reload) |
| Run tests | `npm test` (Vitest, ≈ 20 s), `npm run test:e2e` (Playwright: UI + browser suite with 60 fuzz scenarios), `npm run check` (all of CI). Manual: open http://127.0.0.1:8791/tests/ → **Run all tests** |
| Replay one fuzz case | On the tests page: `await replayScenario(<seed>)` returns `{P, prefs, plan, res, sim, mismatch}` and draws it. Seeds are the ones printed by Vitest or the browser runner |
| Windows shortcut | `Start PenPlot Studio.bat` uses Node, then Python, then opens index.html directly |

- **Build step:** none. Everything is classic `<script>` tags in dependency order (see `index.html`), and every module
  attaches to `window.PP`.
- **Runtime network needs:** none when served. The Hershey fonts and opentype.js are in `vendor/` (see
  `scripts/vendor.mjs`). `file://` pages can't `fetch()` local files, so they still load fonts from
  `cdn.jsdelivr.net/npm/hersheytext@2.0.0/`.
- **Note:** port 8765 on the original machine is used by an unrelated local wiki server. The app uses **8791**.

---

## 2. Sources and what they say

| Source | Key facts used |
|---|---|
| **Instructables** "Turn Your Bambu Lab X1 Carbon Into a Pen Plotter in 45 Minutes" (by the 3dplotter.xyz founder). This is what the user followed to build the mount | "Pen offset coordinates (28mm right, 35mm forward)"; bed 256×256; usable ≈ 221 × 228; **Z-Draw 14 / Z-Lift 20** for Stabilo; pause with **`M400 U1`** after startup, attach the holder, press Resume; align paper with the **front-left corner**; copy .gcode to the SD root |
| **MakerWorld 2029113** "Modular System For A1, P1, & X1 Series" (UMTS), by the mount designer **Falu**. The user flagged it as possibly outdated | **Excluded area** for X1/P1 (slicer bed coordinates = nozzle): `(0x0, 258x0, 258x55, 48x55, 48x258, 0x258)`, which excludes the front 55 mm and left 48 mm. Paper: **29 mm from the right wall, 41 mm from the rear wall**. Usable width deliberately = **210 mm (A4)**. Z-offset **+17.0 mm (Stabilo)**, +20.0 (POSCA). Fans off. Travel Z-hop 3 mm. **Never let the job finish with the module installed** (it collides when it tries to cut filament). Watch the **top glass** limiting the spring. Workflow is slicer-based, with fake-filament tricks and pause layers |
| **Bambu forum** (X1 G-code threads, "XY homing when paused") | `M400 U1` = pause and wait for Resume. The pause may move the toolhead (wipe/park at the chute) and may **home XY on resume**. **`G4` reportedly did not work on the X1** (early report), so Bambu uses `M400 P<ms>` / `M400 S<s>` for dwell |
| **Bambu official X1 start G-code** (quoted in Falu's page and a gist) | "Reset machine status" preamble: `G91 / M17 Z0.4 / G380 S2 Z30 F300 / G380 S2 Z-25 F300 / G1 Z5 F300 / G90 / M17 X1.2 Y1.2 Z0.75`. It drops the bed before homing so the nozzle can't be below the plate |

---

## 3. Physical model and assumptions (what is known vs guessed)

### 3.1 Coordinates

- All design geometry is in **pen coordinates**: mm from the **front-left corner of the plate**, with +X to the
  right and +Y toward the back. Bambu's origin is at the front-left, and Y = 0 is the front.
- The printer moves the **nozzle**. The pen tip is at `pen = nozzle + offset`, so the G-code emits
  `nozzle = pen − offset`.
- Z is the nozzle height above the plate (the X1C moves the **bed**; a larger Z means the bed is lower). After `G28`,
  Z = 0 is the nozzle touching the plate center.

### 3.2 Assumption table

| # | Assumption (current default) | Confidence | Evidence | How to verify |
|---|---|---|---|---|
| A1 | **Pen offset X = −28** (pen is **left** of the nozzle) | Medium | Falu's collision zone is on the **left** (module sticks out left). The paper must be **29 mm in from the right** edge, so the pen can't reach the right 29 mm. Instructables: paper at the **front-left** corner means the reachable area starts at the left. **Against:** Instructables says "28mm right" (it may describe the direction of the correction, not where the pen is) | **Calibrate → Offset finder**, or just look at the mount |
| A2 | **Pen offset Y = −35** (pen **in front** of the nozzle) | Medium-high | Instructables "35mm forward"; Falu's excluded front strip. Falu's 41 mm rear paper margin suggests about −41 (possibly with extra margin) | Offset finder |
| A3 | **Nozzle safe zone X 48–256, Y 55–256** while the holder is attached | High (the designer states it) | Falu's excluded area. The polygon uses 258; we use 256 (the X1C plate size) | Frame test as a dry run, then with the pen; watch clearances to the door/front frame and left wall |
| A4 | Z-Draw 14, Z-Lift 20 | Low-medium | Instructables says 14/20; Falu says Z-offset about 17 for a Stabilo. It depends on how far the pen sticks out and on the spring | Compact calibration (default Z 12…17 in 1 mm steps, highest Z drawn first) |
| A5 | `M400 U1` pauses; **while paused the firmware moves the toolhead to the purge chute (back left), lowers the plate slightly, and returns on Resume**. No XY re-home after a screen pause | Medium-high (session 2) | Forum "large layer shift after manual pause" (head goes to the chute, returns on resume); rebelthor pen-plotter guide (users jog the head forward at the start pause to reach it) | Empty run (§9.2). Park is now X80 Y245, near the chute, so the firmware's move with the holder on stays short. The offset finder measures during a timed `M400 S180`, not a pause |
| A6 | `M400 P50` dwell works on the X1C | High | Bambu's own end G-code uses `M400 P100` | Visual |
| A7 | Plain `.gcode` from the SD root prints from the screen ("Print files → SD card") | High | Instructables + forum | First run |
| A8 | The `G380` safe-start preamble (copied from Bambu's start G-code) is harmless on the X1C/P1 | High | It's in the official X1 start G-code | First run (the bed drops about 10 mm before homing) |
| A9 | After a plain-gcode job ends, the firmware makes **no extra moves** (no filament cut) | Unknown | Falu's warning is about slicer end G-code | We add an **end pause** ("remove the pen holder"), so it's safe either way |
| A12 | Firmware features stay off during plotting: AI monitoring (spaghetti, purge chute pile-up, nozzle clumping) and **Auto-recovery from step loss** (it re-homes XY toward the front-right, which would hit the front frame with the holder on) | Required, user action | Session 2 review (Bambu wiki/forum) | Printer settings before the first run; the export dialog and Help say so |
| A10 | `M73 P<pct> R<min>` shows progress on the X1C screen | High | Used in Bambu files | Visual |
| A11 | 200 mm/s travel and 4000 mm/s² acceleration don't shake the clipped-on holder loose | Unknown | — | First plot; lower in settings if needed |

**If A1 is wrong:** the drawing lands 56 mm off in X. The module still can't hit the frame, because the safe zone is
enforced on **nozzle** coordinates regardless of the offset. But the pen does **not** stay over the plate. With a true
offset of +28, actual pen X = design X + 56, so anything drawn right of about X 200 comes down past the plate's right
edge, and the pen can catch the edge. That's why the calibration order (Help → Calibration) is:
1. the frame test as a dry run, with no pen;
2. the Offset finder, which draws at the bed centre and is safe with either sign;
3. the Z test;
4. only then the frame test with a pen.

### 3.3 Drawable area (X1C defaults)

The pen can reach X 20–228 and Y 20–221. Minus the 1 mm margin, that's **X 21–227 × Y 21–220 (≈ 206 × 199 mm)**.
The canvas shows everything else striped red.

---

## 4. Architecture

### 4.1 Load order and modules (all on `window.PP`)

| File | Namespace | Responsibility |
|---|---|---|
| `js/core/util.js` | `PP.U` | DOM builder `h()`, formatting (`fmt` = trimmed fixed decimals for G-code), downloads, file pick/read, `mulberry32`, `Emitter` |
| `js/core/geometry.js` | `PP.Geo` | Polylines as **flat arrays `[x0,y0,x1,y1,…]`, Y-up, mm**. bbox (skips non-finite), affine `[a,b,c,d,e,f]`, RDP simplify, dedupe, Chaikin, Catmull-Rom, resample, shapes, hit tests, even-odd point-in-polygon, Liang–Barsky clipping, circle eraser, even-odd **hatch fill** |
| `js/core/svg.js` | `PP.SVG` | Path-data parser (all commands, arcs → center form), adaptive flattening, SVG document import (units/viewBox, transforms, `<use>`, grouped by color), SVG export |
| `js/core/storage.js` | `PP.Storage` | IndexedDB key/value (`penplot-studio`/`kv`) with a localStorage fallback. `getLocal`/`setLocal` for small prefs (`pp.*`) |
| `js/core/fonts.js` | `PP.Fonts` | Hershey JSON (23 fonts, one fetch), EMS/Hershey SVG fonts (18), "My Handwriting" (localStorage `pp.handwriting.v1`), uploaded TTF/OTF via opentype.js (persisted in IndexedDB). Normalized so cap height = 1 and the baseline is y = 0. `layout(text, fontId, {size, letterSpacing, lineSpacing, align, arc})` |
| `js/core/optimizer.js` | `PP.Optimizer` | `prepare` (split at NaN, dedupe, **clip, then simplify**, min-length), `order` (grid nearest-neighbor with reversal, then `join` within tolerance; it keeps the joined start point), `estimate` (trapezoid + junction-deviation time model) |
| `js/core/gcode.js` | `PP.GCode` | Profiles, `reachableRect`, `validateProfile`, `minSafeDrawZ`/`safeDrawZ`, **`build(jobs, profile, opts)`**, `calibrationJobs`, **`offsetFinder`** |
| `js/core/gcodesim.js` | `PP.GSim` | **G-code simulator/safety checker**: `simulate(text, profile, opts)`, `check(text, profile, jobs, opts)`, `expectedPauses`, `summary`, `fmtMsg` |
| `js/core/patterns.js` | `PP.Patterns` | 23 generators (written by a subagent; tested in Electron-as-Node plus our suite). `list`, `get`, `defaults`, `generate(id, params)` (clamps params, catches errors, caps at 400k points). `PP.Patterns.util` exposes its helpers |
| `js/core/imagetrace.js` | `PP.ImageTrace` | 8 raster modes (written by a subagent). `toGray(imageData, pre)`, `trace(gray, mode, params, {mmPerPx})` → polylines in **pixel coordinates, Y down** |
| `js/app/state.js` | `PP.Store` | Project `{name, layers[], objects[], activeLayerId, paper}`, selection, **snapshot undo/redo** (objects are immutable, so snapshots are reference arrays), autosave (debounced; `S.autosaveEnabled=false` in tests), serialize/load |
| `js/app/objects.js` | `PP.Objects` | Object types `path / text / shape / pattern`, each with a transform `x, y, rotation, scaleX, scaleY` (TRS) and local geometry **centered on (0,0)**. Hatch `fill`. Caches: path WeakMap, param-key LRU, world WeakMap with a font **epoch** |
| `js/ui/ui-core.js` | `PP.UI` | Icons, toasts, modal, confirm, form controls, generic `paramForm` |
| `js/app/canvas.js` | `PP.View` | Canvas renderer (bed, grid, paper, red zone, objects, out-of-reach highlighting in red, selection handles), pan/zoom, **tools** (select/move/scale/rotate, pan, pen, line, polyline, curve, rect, ellipse, polygon, star, text, eraser) |
| `js/app/preview.js` | `PP.Preview` | Animated preview. It now builds the real G-code, **simulates it**, and animates the simulator's strokes and travels, with a safety badge. It falls back to the plan if simulation fails |
| `js/app/app.js` | `PP.App` | Profiles (built-ins + per-builtin overrides + custom, in localStorage `pp.profiles`), prefs, **`buildPlan({profile?, prefs?, layerIds?})`**, placement, object ops, file I/O, header/toolbar/statusbar, keyboard shortcuts, drag & drop, boot |
| `js/ui/panels-left.js` | | Tabs: Text, Draw, Image, Patterns, Import (+ examples, welcome design) |
| `js/ui/panels-right.js` | | Selection properties, Layers/pens (Z/speed overrides clamped), Plotter quick settings, Plot summary, Paper (includes a "Designer margins" preset) |
| `js/ui/modals.js` | | Printer settings (tabs), **Export** (runs the simulator per file and asks for confirmation on failure), **Calibration** (grid/compact/frame/offset finder), Help |
| `js/ui/imagedialog.js`, `js/ui/handwriting.js` | | Image trace dialog; handwriting glyph editor |

### 4.2 Pipeline: design to G-code

```
objects ──OBJ.world()──► world polylines (pen coords, includes hatch fill)
   per visible layer (array order = plot order)
      └─ Optimizer.prepare: split NaN → dedupe → clip to reachableRect → simplify(tol) → drop < minLength
      └─ Optimizer.order: NN + reverse, then join(joinTol)
   ⇒ plan.jobs[] = {name, color, polys, zDraw?, drawSpeed?}
GCode.build(jobs, profile, {dryRun}) ⇒ text
GSim.check(text, profile, jobs) ⇒ {ok, errors, warnings, strokes, travels, pauses, stats}
```

### 4.3 Profile fields (`GCode.FIELD_DEFAULTS`, X1C values)

| Field | Value | Notes |
|---|---|---|
| `firmware` | `bambu` | `bambu` / `marlin` (dwell command, fan commands, safe start) |
| `bedWidth`, `bedDepth` | 256, 256 | |
| `nozzleMinX/MaxX/MinY/MaxY` | 48, 256, 55, 256 | **Safe zone** while the holder is attached |
| `penOffsetX/Y` | −28, −35 | A1/A2 |
| `margin` | 1 | |
| `zDraw`, `zLift`, `zAttach`, `zEnd`, `zMax` | 14, 20, 60, 80, 250 | |
| `drawSpeed`, `travelSpeed`, `zSpeed` | 30, 200, 15 mm/s | |
| `accel` | 4000 | `M204 S`. 0 = don't send |
| `penDownDelay`, `penUpDelay` | 50, 0 ms | `M400 P` (Bambu) or `G4 P` (Marlin) |
| `home`, `safeStart`, `pauseForAttach`, `layerPause`, `endPause`, `progress`, `heatersOff` | all true | |
| `pauseCommand` | `M400 U1` | Marlin: `M0 …` |
| `parkX/Y` | 80, 245 | Nozzle position before each pause (the firmware then moves to the purge chute, A5) |
| `endX/Y` | 152, 250 | |
| `startGcode`, `endGcode` | '' | Inserted before homing / at the end |

Built-ins: `bambu-x1c`, `bambu-x1e`, `bambu-p1s` (same geometry) and `custom` (generic Marlin 220³, offsets 0, no
safe start or end pause). User edits to built-ins are stored as overrides, and **Reset to defaults** removes them.
**Caveat:** a browser that saved overrides *before* this session keeps its old values, including +28 and nozzle
min 0. Any real user browser was fresh, but check the **Printer settings** once.

### 4.4 Safety rules in the generator

- Pen-down Z is clamped to `[minSafeDrawZ, zLift − 0.5]`, where `minSafeDrawZ = max(zDraw − 4, zDraw/2, 0.5)`.
  Out-of-range values come back as a warning.
- `validateProfile` requires Z-Lift ≥ Z-Draw + 1, park and end inside the safe zone, and the park position's pen over
  the plate.
- The end sequence lowers the bed to `max(zLift, zEnd, zAttach if endPause)`. This fixed a bug where the end pause
  could happen at too low a Z.
- The writer skips moves that **round** to the same G-code coordinates, so the simulator and the file agree point for point.

### 4.5 Simulator checks (`gcodesim.js`; errors, plus warnings marked "(w)")

| Group | Codes |
|---|---|
| Config | `lift-clearance`, `draw-above-lift` |
| Parsing | `parse`, `bad-number` (NaN/undefined/infinity/null), `unknown` (w) |
| Homing / probing | `not-homed`, `home-attached`, `home-pen-down`, `probe-attached`, `home-no-pause` (w), `g380` (w) |
| Motion limits | `xy-limit` (safe zone, holder attached), `xy-range` (outside the printer), `z-max`, `z-crash` (Z < 0.3), `z-too-low` (< minSafeDrawZ, holder attached), `z-low` (w), `z-fast` (w), `travel-fast` (w), `draw-fast` (w) |
| Pen behavior | `scrape` (XY with Z < 1), `diagonal` (XY + Z together while low), `z-while-down`, `odd-draw-z`, `draw-out` (outside the drawable area), `holder-out` (pen off the plate while attached), `dry-draw`, `dry-strokes` |
| Pauses | `pause-pen-down`, `pause-clearance` (Z < zAttach), `pause-pos` (outside the safe zone), `no-attach-pause`, `pause-count` |
| End | `end-pen-down`, `end-low`, `end-not-lowered` (w), `end-attached` (w) |
| Machine state | `heater`, `bed-heater`, `wait-heat` (w), `extrude`, `g92`, `inches`, `relative` (w), `steppers-off`, `feed`, `no-feed`, `g4-bambu` (w), `long-dwell` (w), `speed-factor` (w), `accel` (w), `progress` (w) |
| Fidelity | `stroke-count`, `draw-length` (only when `check()` is given the jobs) |

**Holder state machine:** detached at the start (when `pauseForAttach`). A pause **attaches** it, unless the comment
just before says "remove the pen holder" (then it's **removed**) or "measure" while detached (then it's **inspect**).
Pen logic only applies while attached. **Limitation:** this intent comes from the generator's comments, so custom
pause commands in user start/end G-code may be misread.

---

## 5. G-code produced (Bambu profile, annotated)

```
; header comments + ; HEADER_BLOCK_START … model printing time … ; HEADER_BLOCK_END
M73 P0 R<min>
G90 / G21 / M83
M104 S0 / M140 S0                      ; heaters off (no heat needed)
M106 S0 / M106 P2 S0 / M106 P3 S0      ; fans off (Falu: fans move the paper)
M220 S100 / M204 S4000
[custom start G-code]
G91 / M17 Z0.4 / G380 S2 Z30 F300 / G380 S2 Z-25 F300 / G1 Z5 F300 / G90 / M17 X1.2 Y1.2 Z0.75   ; safeStart
G28                                     ; holder NOT attached
G90 / G1 Z60 F900 / G1 X80 Y245 F12000 / M400
; PAUSE: attach the pen holder …
M400 U1
G90 / G1 Z20 F900
; ===== Layer i/n: name (color) =====     ; the simulator reads this for layer colors
  [pen change: G1 Z60 / park / M400 / ; PAUSE: change to the pen … / M400 U1 / G90 / G1 Z20]
  G1 X Y F12000 / G1 Z<zd> F900 ; pen down / M400 P50 / G1 X Y F1800 … / G1 Z20 F900 ; pen up / M73 P R
; ===== End =====
G1 Z80 / G1 X80 Y245 / M400 / ; PAUSE: remove the pen holder now … / ; PP_PAUSE remove / M400 U1 / G90
G1 X152 Y250 / M400 / [custom end] / M73 P100 R0
```

The **Offset finder** (`GCode.offsetFinder`) runs its own sequence: attach, then draw a cross and circle with the
nozzle at the safe-zone center (152, 155.5). Next it **removes** the holder, parks the bare nozzle 3 mm above the same
point, and **pauses so you can measure**. It ends with the bed down and the toolhead at the end position.

---

## 6. UI notes

- **Tools and shortcuts:** V select, H pan, P pen, L line, Y polyline, C curve, R rect, E ellipse, G polygon, S star,
  T text, X eraser. Ctrl+Z/Y undo/redo, Ctrl+D/C/V duplicate/copy/paste, Del delete, arrows nudge,
  Ctrl+S/O save/open, Ctrl+E export, 0/+/− zoom.
- **Scale handles:** corner handles keep proportions and Shift frees them. Shift snaps rotation to 15°.
- **Layer order** is plot order, and each layer is one pen.
- **Hit testing:** unfilled shapes larger than 25 mm are picked by their outline only.
- **Welcome design:** added on first launch when there's no autosave.
- **First-launch help:** opens once (`pp.seenHelp`).

---

## 7. Testing status

### 7.1 Suite contents (`tests/harness.js`, run by `tests/tests.js` in the browser and by Vitest in Node)

1. **Simulator self-test.** It takes a valid file and applies 20 mutations; each must raise the expected code:
   - missing attach pause, missing pen lift, pen pushed into the bed, nozzle into the excluded zone, holder off the plate
   - hotend on, extrusion, NaN, undefined, homing with the pen attached, diagonal pen-down, file ends with the pen down
   - pause without clearance, no feed rate, end pause without clearance, G20, G92, Z below the plate, M84 mid-plot,
     XY scrape after homing

   Two config-level checks run as well.
2. **Edge cases:** empty design, a single dot, an object fully outside the area, a frame bigger than the bed,
   NaN/Infinity in path data, 1e9 coordinates, zero scale, 30,000 strokes (≈1.1 s end to end, 3.2 MB of G-code),
   out-of-range layer overrides (clamped, 4 pauses), no reordering, a large join tolerance, and every built-in profile.
3. **Coverage:** all 41 fonts render all ASCII characters. Every pattern is run at default, min and max params
   (geometry checked, pipeline run at default and min). All 8 trace modes are run. Calibration grid, compact and frame
   run on every profile (Z window checked). The Offset finder runs on every profile, and its pause sequence must be
   `attach, remove, inspect`.
4. **Fuzz** (seeded). Each scenario draws:
   - a random profile: 45% X1C, 7% P1S, 8% Custom, 40% randomized valid profiles with random offsets (±45), safe
     zones, Z values, speeds, dwell and pause flags, and both firmware types;
   - random prefs;
   - 1–3 layers with random overrides (some out of range) and hidden layers;
   - 1–5 random objects (text in random fonts with arcs, shapes, patterns with random params, random paths including
     dots and NaN, SVG samples including broken ones, image traces), with random transforms (positions −60…320,
     scale 0.05–2.5, mirroring, rotation) and random hatch fills.

   Each scenario then checks: plan inside the area; no invalid numbers; **simulation passes**; the **G-code draws
   exactly the plan** (ordered point alignment within the 0.001 mm rounding); **coverage** (every design point inside
   the area gets drawn, within the simplify tolerance); **precision** (nothing drawn off-design); dry run; and one
   file per layer.
5. **Editor state fuzz:** 400 random operations (add, update, remove, undo/redo, mirror, rotate, align, fit,
   convert to path, combine, duplicate, copy/paste, erase, layer add/remove/move/visibility, move to layer,
   serialize→load, paper). Invariants: no orphaned objects, no dangling selection, at least one layer, no exceptions.
   The final design then goes through the pipeline.

### 7.2 Results so far (this session)

- **Run 1 (60 scenarios)** surfaced bugs, all fixed:
  - the end pause could happen below the attach height;
  - calibration could press to Z 0 on low-Z profiles (added `minSafeDrawZ`);
  - `join()` dropped the first point of a joined path (up to `joinTol` off the design);
  - one Infinity in a path corrupted the whole object (`bbox` now skips non-finite values);
  - the writer could emit moves that round to the same coordinates;
  - several test-side mistakes.
- **Run 2 (150 scenarios):** 1741 passed, 3 failed. All 3 were a flaw in the test's stroke comparison at the rounding
  threshold; the comparison is now an ordered alignment.
- **Run 3 (200 scenarios):** **2110 passed, 1 failed**, then the final state-fuzz check was far too slow. The failure
  was 2 samples drawn 0.07–0.10 mm off the design exactly on the drawable-area border. Cause: simplify ran before clip.
  Fixed in `prepare()` (clip first, then simplify), and verified by replaying seed 100164 (see §7.3). The slow check
  was the test's fidelity index on a km-scale design, now skipped above 120 m of line.
- **Run 4 (200 scenarios):** 2122 passed, 1 failed. The failure was in the design left after the state fuzz: a
  0.0004 mm back-and-forth in the plan rounds to a single G-code point, and the test's greedy matcher attached it to
  the wrong neighbor. The G-code was correct. The matcher now prefers the closer neighbor.
- **Run 5 (final, 200 scenarios, seed 1): 2123 passed, 0 failed.** See "Session end status" below.

### 7.3 Final verification in this session

See the bottom of this file ("Session end status"). It records the last replay and full-run results as they were
when the session ended.

### 7.4 Known test-harness quirks

- In a *hidden* browser tab, `setTimeout` is throttled, so the runner yields through `MessageChannel`. Long synchronous
  sections still block the tab, so poll with `localStorage['pp.testTrace']` / `['pp.testSummary']` from another tab
  on the same origin.
- Fidelity is skipped for designs over 120 m of line and logged. The simulator and exact-plan checks still run.

### 7.5 Automated runners (session 2)

| Runner | Command | Contents | Result (2026-09-29) |
|---|---|---|---|
| Vitest (Node 24 + jsdom) | `npm test` | Harness suites 1–5 as named tests (fuzz: `FUZZ_N`, default 30), plus unit tests: `gcode` (X1C defaults, §4.4 rules, golden file), `geometry`, `svg`, `optimizer`, module loading | 12 files, **328 passed**, ≈ 20 s |
| Playwright (Chromium) | `npm run test:e2e` | Browser suite with 60 fuzz scenarios, plus 17 UI tests: boot, every drawing tool with real mouse input, select/drag/nudge/delete, undo/redo, text, patterns, SVG drop, export (the download is re-simulated), preview, calibration | **18 passed**, ≈ 30 s |
| Reference browser run | `npm run test:e2e:full` | Browser suite, 200 fuzz scenarios, seed 1 | **2123 passed / 0 failed**: 271 files, 1,452,736 moves, 75,092 strokes, 787 m, 34.7 s headless |

- **One harness, two runners.** A seed builds the same scenario in Node and in Chromium. The trace-mode test image
  is now generated with plain arithmetic instead of canvas, which is why the move and stroke totals differ slightly
  from session 1's run.
- **Node vs browser.** jsdom has no 2D canvas, so SVG stroke colors all become black in Node. Color grouping is
  only covered in the browser. Everything else behaves the same.
- **Offline.** `test/unit/setup.js` serves `vendor/` through a fetch shim that throws on any other URL. The Playwright
  fixtures (`e2e/fixtures.js`) abort every non-localhost request and fail a test on any console error or warning.
- **Golden file.** `test/unit/__snapshots__/x1c-square.gcode` is the exact output for a 10 mm square on the X1C. A
  deliberate generator change shows up as a diff there; review it, then run `npx vitest -u`.
- **Found by the new tests:** 3 SVG import bugs, fixed in session 2 (§11), and one UX bug, §8 item 14.

---

## 8. Known issues and limitations

1. **Not hardware-validated** (§3). The first physical session is the top priority.
2. **Offset sign contradiction** (A1). The default is −28. The Help, Settings, README and memory notes say to verify it.
3. **XY homing on resume** (A5) happens with the holder attached, if the firmware does it. It's unknown whether the
   holder clears the frame during sensorless XY homing, and the simulator can't model firmware behavior. Watch the
   first resume.
4. **Holder state inference** in the simulator relies on the generator's comment text (§4.5).
5. **The time estimate** ignores firmware look-ahead details and pause time; expect ±20%.
6. **No `.gcode.3mf` export.** Bambu's format needs about 544 project-settings keys and MD5 metadata
   (see github.com/estampo/bambox). Files go by SD card, or by FTPS upload to the printer (port 990, user `bblp`,
   the LAN access code) and are started from the screen.
7. ~~Fonts need internet~~: vendored in session 2. Only `file://` pages still use the CDN.
8. **Image tracing runs on the main thread**, so 1600 px images can stutter the UI. Move it to a Web Worker.
9. **The preview** renders completed strokes by appending to a `Path2D`; scrubbing backwards rebuilds it. That's fine up
   to about 100k strokes.
10. **Undo during live edits:** slider drags are one undo step (via `liveEdit`), but typing in the text box is one
    step per focus session.
11. **Very large designs** (km of line) work, but they're slow and produce huge files. There's no warning yet
    ("this will take 30 hours").
12. **`file://` mode** hasn't been verified in a real browser: the built-in pane only renders snapshots. It should work
    because it uses classic scripts and CORS-enabled CDNs. Fonts come from the CDN in this mode, since `fetch()`
    can't read `file://`. `npm start` / `serve.py` are the fallback. Playwright only tests the served app.
13. **A browser with old saved profile overrides** keeps +28 and nozzle min 0 (§4.3). Consider a one-time migration
    that flags overrides older than profile schema v2.
14. **Thin objects squash instead of moving** when dragged from their centre (found by the UI tests). At the default
    zoom, the top and bottom edge scale handles of a thin object, such as the welcome design's 5.5 mm tagline, are
    within the 7 px handle hit radius of its centre. A press there starts a scale, so scaleY drops to 0.01.
    `e2e/editing.spec.js` works around it by grabbing at 30% of the width. Fix in `js/app/canvas.js` by preferring
    move inside the frame when handles overlap it.
15. **Simulator parameter flags:** a bare letter (`G28 X`, or a malformed `M104 S`) is stored as `true` and reads as 1
    in numeric checks. The generator never emits one.
17. **Open UX items from the session 2 bug hunt** (none affect G-code):
    - Panel "Add" buttons (text, pattern, paste, SVG, trace) add to a hidden or locked active layer without a warning.
      The canvas tools do warn.
    - Ctrl+S, Ctrl+E and Ctrl+O don't work while a text field has focus.
    - Space doesn't resume the preview while the scrubber has focus, and edits during preview leave its plan stale.
    - A design entirely outside the drawable area says "Nothing to plot", not "outside the drawable area".
    - An empty text object can't be clicked (select it with Ctrl+A).
    - A very tall or thin traced image defaults to a huge size.
    - "Save as new profile" appends " (custom)" to the name.
    - A cancelled file pick leaves a hidden input in the page.
    - Non-ASCII project names are stripped in file names.
16. **Tooling scope:** `tsc --checkJs` covers geometry, optimizer, gcode and gcodesim, with `PP` typed `any`.
    Prettier skips `js/`, `css/`, the HTML, `tests/` and Markdown on purpose; a reformat would expand the code
    25–40%. Remove those lines from `.prettierignore` to opt in. There are no screenshot (visual regression)
    tests, because font rendering differs between Windows and Linux and would need per-OS baselines.

---

## 9. First physical session: checklist and what to record

Record every answer. They settle the assumptions in §3.

### 9.1 Prep (gates: don't attach anything until these are done)

1. In **Printer settings**, click **Reset to defaults** on the X1C profile, then confirm offset −28/−35, safe zone
   48–256 / 55–256, park 80/245.
2. **Look at the mount:** the pen must sit left of and in front of the nozzle (both offsets negative). Otherwise fix
   the sign first; a wrong sign can put the pen past the plate edge (§3.2).
3. **Measure the pen stick-out** below the nozzle. Set Z-Draw to about that value and Z-Lift about 6 mm higher.
4. **Turn off** AI monitoring (spaghetti, purge chute pile-up, nozzle clumping) and Auto-recovery from step loss (A12).
5. Remove the top glass if it limits the spring travel (Falu). Keep the door open.
6. Set Move speed to 80 mm/s for the first runs.
7. Plan the emergency stop: **Stop** on the screen (Pause moves the head to the chute), or the rear power switch.
8. Clean filament off the nozzle tip; Z homing touches the plate with it.
9. First, test a tiny file to confirm the screen lists and runs plain `.gcode` from the SD card root.

### 9.2 Empty and dry runs

1. **Empty run:** **Calibrate → Frame** with Dry run, attaching **nothing**; press Resume at each pause.
   - Where does the toolhead go while paused (chute, back left)? Where does it return on Resume? *(A5)*
   - Does the `G380` preamble behave (the bed drops about 10 mm before homing)? *(A8)*
   - Does the screen show progress? *(A10)*
   - Does the job end cleanly with no extra moves after the last Resume? *(A9)*
2. **Frame dry run with the holder, no pen:** the same file with the holder attached at the first pause.
   - Does it clear the door, frame and left wall along the whole outline? *(A3)*
   - Do the moves to and from the chute clear, with the holder on? *(A5)*

### 9.3 Z calibration (with pen)

1. **Calibrate → Z test** (Z-Draw − 2 … + 3, highest Z first, title last). Record the first Z that draws a solid line
   and the lowest Z before dragging or tearing.
2. Set Z-Draw to about the first-solid value minus 0–0.5. Optionally run **Z × speed** for speed.

### 9.4 Offset finder (with pen)

1. **Calibrate → Offset finder** → download → run.
   - First pause: attach the holder.
   - Second pause: remove it.
   - The bare nozzle then waits 3 minutes at Z-Lift over the cross.
2. Measure from the nozzle tip to the center of the cross: record ΔX (right +) and ΔY (back +).
   - **Expected** about ΔX −28, ΔY −35 (or around −41 per Falu's margins).
3. Enter the values in Printer settings. If the X sign is +, update `BAMBU_BASE.penOffsetX` in `gcode.js` and every
   doc that mentions −28 (README, Help, HANDOFF, memory note).
4. Run **Calibrate → Frame** with a pen (no dry run). The outline should land just inside the striped zone.

### 9.5 Real plot

1. Plot the welcome design on Letter paper at the front-left corner.
2. Check line quality at the chosen speed and acceleration, whether the holder wobbles, and whether any ink ghosts
   appear on travels (if so, raise Z-Lift).

---

## 10. Recommended next steps (with a full dev toolchain)

**Status after session 2:** steps 1–7 are done, apart from the gaps noted inline. Steps 8–9 are open.

1. ✅ **Put it under git.** `main` = "v1 as handed off"; the tooling commits are on `dev-tooling`, one per step.
2. ✅ **Run the browser suite once** with 200 scenarios. The numbers are in §7.5.
3. ✅ **Node + Vitest for the core.** Done as a variant of Option A: Vitest imports the classic scripts as side-effect
   modules under jsdom in `tests/index.html` order, with no source changes and with v8 coverage. Option B (ES modules)
   is still open. `js/core/*` modules are pure apart from `window.PP` and a few DOM uses:
   `DOMParser` in svg/fonts, `document.createElement('canvas')` in svg color normalization, and `fetch` in fonts.
   - Option A: run them under Vitest with `environment: 'jsdom'` plus `canvas` or `@napi-rs/canvas` for ImageData,
     loading the scripts with `vm.runInContext` or a small loader that concatenates files in `index.html` order.
   - Option B (preferred, longer term): convert to **ES modules** and keep a tiny bundling-free `index.html` that uses
     `<script type="module">`. That breaks `file://`, so ship `serve.py` or build a single-file bundle with
     esbuild/Vite for distribution.
   - Port `tests/tests.js` suites 1–5 as Vitest suites, and keep the seeded fuzz with a configurable count
     (`FUZZ_N=2000` nightly).
4. ✅ **Playwright E2E** against `scripts/serve.mjs`. Everything below is covered except the image dialog with a
   fixture PNG and the visual-regression screenshots (§8 item 16):
   - app boot, no console errors;
   - drawing tools via real mouse events (drag, scale, rotate handles);
   - text editing, font change, pattern add/edit;
   - image dialog with a fixture PNG;
   - SVG drag and drop;
   - export dialog (the safety check shows passed; intercept the download and run the simulator on it);
   - preview play/scrub;
   - calibration downloads;
   - undo/redo;
   - screenshots for visual regression.
5. ✅ **Static checks:** see §8 item 16 for the scope. ESLint (browser globals, `no-undef`) and `tsc --checkJs --noEmit` with JSDoc types. Start with
   `gcode.js`, `gcodesim.js`, `optimizer.js`, `geometry.js`. Add Prettier.
6. ✅ **CI:** `.github/workflows/ci.yml`, Ubuntu + Windows, nightly deep fuzz. It runs once the repo is pushed to GitHub. a GitHub Actions workflow running lint, typecheck, Vitest (plus a fuzz sample) and Playwright headless.
7. ✅ **Offline fonts:** `vendor/`, rebuilt by `npm run vendor`. vendor `hersheytext@2.0.0` (`hersheytext.min.json` + `svg_fonts/*.svg`, MIT, include the
   Hershey attribution) and opentype.js 1.3.4 into `vendor/`, and fall back to the CDN.
8. **Profile migration:** add `schemaVersion` to stored profiles, and on v1 → v2 reset built-in overrides for offset
   and limits, with a toast.
9. **Features after hardware validation:** `.gcode.3mf` export (port bambox) for Bambu Studio/Handy LAN sending;
   direct LAN upload (FTPS + MQTT) through a small local helper, since browsers can't do FTPS; a G-code
   importer/viewer that runs the simulator on any file; a Web Worker for tracing; an "estimated plot time" warning
   for huge designs; A1/A1 mini, P2S and H2 profiles once their mounts are measured.

---

## 11. Session change log (chronological)

1. Researched the Instructables guide, 3dplotter.xyz, the Bambu G-code references, and the hersheytext package
   structure (JSON glyph format: `o` = half advance, cap 21 units, baseline y = 22).
2. Built the whole app: core, state, canvas and tools, panels, modals, the image dialog and the handwriting editor.
   Two subagents wrote `patterns.js` and `imagetrace.js`.
3. Browser-tested the UI flows and fixed:
   - the bed fit before the layout settled;
   - clicks inside large unfilled shapes selecting them;
   - the eraser skipping strokes on fast drags;
   - synthetic pointer capture;
   - stale cached JS (added `serve.py` with no-cache).
4. Switched the Bambu dwell from `G4` to `M400 P`; removed `M73 L`; park moved to Y40 (then moved again, below).
5. **User request:** "test it simulating the g code paths". Wrote `gcodesim.js`, wired it into Export, Calibration and
   Preview, and added the `tests/` suite.
6. **User shared Falu's MakerWorld notes.** Adopted the safe zone (X ≥ 48, Y ≥ 55), flipped the offset to X −28,
   park (152, 70), end (152, 250), added the end pause, the Bambu safe-start preamble, the Offset finder, the pen-down
   Z safe window, "Designer margins" paper placement, and the doc/help updates.
7. Test runs found and fixed the bugs listed in §7.2.

**Session 2 (2026-09-29, Ubuntu 24.04 machine): dev toolchain**

8. `git init`, `.gitignore`, `.gitattributes`: LF everywhere, CRLF for `.bat` so `cmd.exe` is happy and the golden
   file matches on Windows. Also `.editorconfig`. First commit "v1 as handed off"; later work on `dev-tooling`.
9. Node 24 LTS toolchain: `package.json` with exact pins, `.nvmrc`, and `engine-strict`. Ubuntu's apt Node 18 is too
   old for every current tool. `scripts/serve.mjs` is a no-cache server with optional live reload that replaces
   the need for Python. The `.bat` launcher now tries Node, then Python.
10. Vendored hersheytext 2.0.0 and opentype.js 1.3.4 with `npm pack` (integrity-checked), so the packages'
    vulnerable Node-side dependencies are never installed. `fonts.js` tries local copies first.
11. Split `tests/tests.js` into `harness.js` (named cases, no DOM) plus a thin browser runner. Added Vitest,
    Playwright (via two subagents for the geometry/svg/optimizer unit tests and the UI specs), ESLint, Prettier,
    `tsc --checkJs` and CI. The only app-code changes from lint were dead-code removals.
12. The new tests found and fixed these `svg.js` import bugs:
    - Sign-separated numbers (`translate(10-5)`, `points="0,0 10-5"`) were misread.
    - A NaN matrix came from an empty `scale()`.
    - A self-referencing `<use>` was expanded 32 times, or hung the tab with two self-references.
    - An element budget now stops pathological files.
13. Fixed a Windows risk in the dev server: the "is main module" check could fail when drive-letter casing differs.

---

## 12. Where the user is

- The user has built the mount by following the Instructables guide. They have no printer measurements yet.
- Session 2 ran on an Ubuntu 24.04 machine. The user works on both Windows and Linux, so tooling must stay
  cross-platform. Node 24 is installed system-wide from NodeSource (Linux) or `winget install OpenJS.NodeJS.LTS`
  (Windows). §9 is the next thing to do with the printer.
- Memory note stored for future agent sessions: `x1c-plotter-hardware-assumptions` (Claude memory dir). Update it when
  §9 answers come in.

---

## Session end status

**Session 2 (2026-09-29):** on branch `dev-tooling`, `npm run check` passes: lint, format, typecheck, Vitest 328/328
and Playwright 18/18. The 200-scenario reference browser run gives 2123 passed / 0 failed (§7.5). CI has not run yet,
because there's no GitHub remote. The Windows jobs are the first real Windows check of the tooling.

**Session 1 (below)**

**Final test run (2026-09-29 21:43 local, seed 1, 200 fuzz scenarios, browser suite `tests/index.html`):**

| Metric | Value |
|---|---|
| Checks passed / failed | **2123 / 0** |
| G-code files generated and simulated | 271 (combined, dry-run and per-layer files) |
| Simulated moves | 1,455,780 |
| Pen-down strokes checked point-by-point against the plan | 75,245 |
| Line length checked for coverage and precision against the design | 787 m |
| Fidelity skipped (designs over 120 m of line) | 2 |
| Slowest single scenario | ≈ 22 s (a huge hatched design; mostly test-side fidelity work) |
| Wall time | 73 s |

**App smoke test after all changes** (main page, X1C defaults):
- boots with no console errors;
- the export dialog shows "Safety check passed: Simulated 977 moves: 60 strokes…";
- the preview animates the simulated G-code with a "✓ G-code check passed" badge;
- the Offset finder renders;
- the drawable area is X 21–227 × Y 21–220.

**Uncommitted state:** the project is **not** a git repository yet. A `.gitignore` is included. Do §10 step 1 first.
