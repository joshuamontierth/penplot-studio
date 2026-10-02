# Cutting with a drag knife (plan)

The `cutting` branch adds the cutting mode to the UI. Everything below is what it takes to actually cut, in a
proposed order. The knife: AFUNTA Roland-type drag-knife blades (30°, 45° and 60°) with a blade holder. The mount is
still open.

## What the branch has now

- **A Pen | Cut switch in the header.** It's a project setting, so it's saved in `.penplot` and undoable.
- **Outlines only in cut mode.** Hatch fills are left out of the geometry, so the canvas, the plan and the summary
  cover outlines only (`PP.Objects.setOutlineOnly`).
- **Hairline rendering.** The canvas draws cut lines thin, whatever the pen width.
- **A Cutting tab in Printer settings.** Its fields are knife offset (or "same as the pen"), blade offset, Z-Cut, cut
  speed, overcut, swivel angle and passes. They're profile fields in `js/core/gcode.js`, which `build()` doesn't use
  yet.
- **A Cut job dialog in place of Download G-code.** It shows:
  - closed shapes and open paths;
  - cut length and an estimated time;
  - warnings: open paths, fills left out, pieces under 3 mm, and the need for a cutting mat.
- **No preview.** It has no G-code to play yet.

## The knife

- **Blade angles.** 45° is the usual choice for adhesive and heat-transfer vinyl. 60° is for thicker material
  (cardstock, magnet sheet), and 30° for thin film. Confirm each against the material.
- **Blade offset.** The tip trails the holder's axis by the blade offset, about 0.25 mm for 45° blades and more for
  60°. The blade swivels freely, so it always points along the direction it was last dragged. Everything in
  *Knife path* follows from that.
- **Cutting force.** Force comes from spring compression, as with the pen. Blade exposure is set by the holder's cap:
  just over the material's thickness, so it cuts the vinyl and not the backing (a "kiss cut").

## Mount requirements

- **Rigid in X and Y, free in Z.** Any play shows up as cut error at corners. The pen mount's spring can supply the
  force.
- **Fits the pen mount's tube.** Roland-style holders are usually about 11.4 mm across. Measure yours: if it fits, it
  can go in the pen mount's cartridge resized with **Download pen mount** (the spring rings need a clearance of about
  1.2 mm).
- **Knife offset.** The knife's offset from the nozzle has to be measured (see *Calibration*). If the holder sits in
  the pen's cartridge it equals the pen offset, which is why the setting defaults to "same as the pen".

## Knife path (the core algorithm)

Without compensation, corners get rounded and closed shapes don't close. For each path:

1. **Align the blade first.** After a lift the blade keeps its last direction. Track it from the previous cut and
   swivel it toward the first segment: lower at the start point, then make an arc of radius *blade offset* around
   it.
2. **Extend segment ends.** Run each segment past its end by the blade offset, because the tip lags behind the axis.
3. **Swivel at sharp corners.** At a corner sharper than the swivel angle, make an arc of radius *blade offset*
   around the corner, from the old direction to the new one. At gentler turns the blade just follows.
4. **Start and finish closed shapes cleanly.** Start in the middle of the longest straight segment, never at a
   corner. Finish by cutting past the start by the overcut length, so the shape is fully closed.
5. **Arcs as short lines.** The simulator rejects G2/G3, and the X1 handles short G1 segments well.

This belongs in `js/core` as pure functions, `knifePath(poly, opts) → poly`, with unit tests: a square comes back
with four swivel arcs, a circle comes back almost unchanged.

## G-code

- **Knife up and down.** The knife goes down to Z-Cut and up to Z-Lift as pure Z moves, the same rules as the pen.
  Lower it a little slower than the pen.
- **Passes.** Multiple passes repeat the path; thick material may need a slightly lower Z per pass.
- **Speeds.** Use the cut speed (slower than drawing) and lower acceleration, so corners don't overshoot. Slow down
  on swivels.
- **Cut order.** Cut inner shapes before the outer ones (holes before the piece around them), so a piece doesn't
  shift before its holes are cut. Go from small to large, nearest first within that order.
- **Optimizer.** In cut mode it must not join separate paths, since a joined travel would cut a line. It may reverse
  a closed path, but must keep it closed.
- **File and dialog.** `build()` gets a cut mode: same start, pauses and end as a plot, knife paths in the body, and
  `_CUT` in the file name. The Cut job dialog then gets the same download and safety-check flow as the G-code export.

## Safety and the simulator

- **Floor.** A Z-Cut floor, like the pen's minimum safe Z: the blade must not reach the mat or the plate.
- **Drawable area.** Compensated paths are longer than the design (extensions, swivels, overcut). Check the knife
  path against the drawable area, not just the design.
- **A knife mode in the simulator.** Z-Cut counts as the drawing height, so knife-down moves are checked like pen
  strokes. No XY move with the knife down except cutting moves, and travel always at Z-Lift.
- **Build plate.** The knife scores PEI plates: always cut on a cutting mat. The Cut job dialog already warns about
  this. The mat's thickness changes the Z values, so calibrate with it in place.
- **Pauses.** The same as plotting: attach the knife at the first pause. Watch fingers near the blade while
  attaching.

## Calibration

- **Depth ladder.** Cut a row of small squares, each with a peel tab, at stepped Z. Pick the Z that cuts through the
  vinyl but not the backing.
- **Blade offset test.** Cut squares and triangles with blade offsets of 0.15 to 0.5 mm, and pick the one with sharp,
  closed corners.
- **Knife offset.** Run the Offset finder with the knife (it cuts the cross instead of drawing it). Or draw a cross
  with the pen, cut one with the knife and measure between them.

## Design-side changes

- **Fonts.** One-stroke (Hershey) fonts cut lines, not letters. Vinyl lettering needs outline fonts (installed or
  uploaded TTF/OTF). In cut mode, the Text tab should prefer outline fonts or warn about one-stroke ones.
- **Image tracing.**
  - Outline gives closed shapes, which is right for cutting.
  - Center line gives open paths: warn.
  - Edges, Contours, Photo hatch, Squiggle, Spiral and Stipple only make sense for a pen: hide them or warn in cut
    mode.
- **Patterns.** These are mostly open lines: warn.
- **Mirror.** Heat-transfer vinyl is cut from the back, so it needs a mirror option for the cut.
- **Weed box.** An optional rectangle around the design, plus weeding lines, makes peeling easier.
- **Small details.** Warn about tiny pieces. The Cut job dialog already warns under 3 mm.

## Preview

- **Knife path.** Play the compensated path, with its swivels, and optionally the blade-tip path.
- **Reuse.** Once there's cutting G-code, the existing G-code simulator and preview can replay it.

## Later: draw and cut in one job

Print-then-cut stickers need a tool per layer (Pen or Knife) instead of a project-wide mode. Each layer change would
get a pause to swap tools, and the knife offset would be calibrated against the pen.

## Proposed order

1. Knife-path geometry with unit tests, drawn on the canvas in cut mode.
2. Cut G-code in `build()`, the simulator's knife mode, and a golden-file test.
3. Cut order: inside first, no joining.
4. Calibration files: the depth ladder and the blade-offset test.
5. The knife-path preview.
6. Design-side warnings and options: fonts, trace styles, mirror, weed box.
7. A tool per layer, for print-then-cut.
