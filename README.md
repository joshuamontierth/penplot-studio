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
- **Recommended while developing:** `python serve.py`, which starts a no-cache server on
  http://127.0.0.1:8791 and opens your browser. You can also double-click `Start PenPlot Studio.bat`.
- **Tests:** start the server, then open http://127.0.0.1:8791/tests/ and click **Run all tests**.

You need an internet connection for text: the Hershey fonts come from jsDelivr, and opentype.js (for uploaded
fonts) comes from cdnjs. Work autosaves to IndexedDB in the browser. Use **Save project** to keep a
`.penplot.json` file.

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
| Park (pauses) | nozzle X152 Y70 | Inside the safe zone and reachable through the door |
| Speeds | draw 30, travel 200, Z 15 mm/s, accel 4000 | |
| Pen-down dwell | 50 ms via `M400 P50` | `G4` is reportedly unreliable on the X1 |

## What a file does (Bambu profile)

```
G90 / G21 / M83, heaters off, fans off, M220 S100, M204 S4000
G91 / M17 Z0.4 / G380 S2 Z30 / G380 S2 Z-25 / G1 Z5 / G90 / M17 ...   ; Bambu's own "drop the bed before homing"
G28                         ; home - holder NOT attached
G1 Z60 / G1 X152 Y70        ; bed down, park
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

## Tests (`tests/`)

`tests/index.html` loads the real modules and runs these checks:

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
tests/      index.html, tests.js
serve.py    no-cache dev server
HANDOFF.md  detailed status, open questions, next steps
```

## Credits

- The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. National Bureau of
  Standards. The format of the font data was originally created by James Hurt, Cognition, Inc. The SVG font
  versions are by Windell H. Oskay (Evil Mad Scientist), via [hersheytext](https://github.com/techninja/hersheytext) (MIT).
- [opentype.js](https://opentype.js.org/) (MIT). Pen mount and safe-zone data by Falu Mendy Vergara (MakerWorld).

This project is not affiliated with Bambu Lab, 3dplotter.xyz or the mount designer. Watch the printer while it plots.
