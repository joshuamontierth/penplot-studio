# Cutting with a drag knife

Cutting works on the `cutting` branch. The design is a cut layer: one layer can use the knife instead of a pen, and it
always plots last, after every pen layer. The knife is an AFUNTA set of Roland-type drag-knife blades (30°, 45° and
60°) with a holder; the mount is still open. Several settings can only be settled by real cuts: see *To find out on
the printer*.

## How it works

- **The cut layer.** A layer's ⋯ menu has **Use as the cut layer (knife, plotted last)**.
  - There's only one cut layer, and the store keeps it last (`cutLast` in `js/app/state.js`).
  - The cut layer's row shows a knife icon, and its lines draw as hairlines.
  - Hatch fills on it are left out (`PP.Objects.setCutLayers`), because a knife cuts outlines.
  - Its menu holds the knife height (Z-Cut) and cut speed overrides, **Mirror (iron-on vinyl)** and **Weed box around
    the design** (3 mm margin).
- **Printer settings → Cutting.** Profile fields, defined in `js/core/gcode.js` (`BAMBU_BASE`):
  - knife offset (default: the knife sits where the pen does);
  - blade offset, 0.25 mm;
  - Z-Cut, 14 mm;
  - cut speed, 20 mm/s;
  - overcut, 1 mm;
  - swivel angle, 30°;
  - passes, 1.
- **Knife paths.** `js/core/knife.js` handles the blade, whose tip trails the holder's axis by the blade offset:
  - **On straight edges,** the axis runs ahead of the tip.
  - **At sharp corners,** the axis swings around the corner on an arc while the tip pivots in place. A unit test drags a
    modelled knife along the path and checks that a square comes out with sharp corners.
  - **Closed shapes** start mid-edge and run past the start by the overcut, so they close fully.
  - **Order:** open paths are cut first, then shapes from the inside out (holes before the piece around them). Paths
    are never joined.
- **G-code** (`build()`; `cutPlan()` is shared with the simulator):
  - a pause to swap the pen holder for the knife holder (always, even with layer pauses off);
  - a `; PP_TOOL knife` line, then the knife's offset, Z-Cut and cut speed;
  - no pen dwells.
  - A knife-only file asks you to attach the knife at the first pause.
  - **Export:** "one file per layer" gives the cut layer its own file.
- **Safety simulator.**
  - After `PP_TOOL knife` it checks against the knife's offset, drawable area, heights and Z floor.
  - It checks the strokes match the knife paths exactly.
  - The floor for both tools is now at least 1 mm: every XY move below Z 1 scrapes the plate. The fuzz found it.
- **Export dialog notes** for the cut layer:
  - one-stroke fonts, which cut lines, not letters;
  - open paths;
  - pieces under 3 mm;
  - fills left out;
  - cut on a cutting mat.
- **Calibrate** has three knife tests:
  - **Cut depth:** squares with a triangle inside, at stepped Z-Cut values, highest (lightest) first.
  - **Blade offset:** the same cell at several blade offsets.
  - **Offset finder → With the knife:** cuts the cross, to measure the knife's offset.
- **Preview** plays the knife paths too, since they're in the G-code.
- **Tests:**
  - knife geometry and cut G-code unit tests;
  - a golden file, `test/unit/__snapshots__/x1c-cut.gcode`;
  - an e2e test for the cut layer;
  - the fuzz, where a quarter of the scenes end with a cut layer and the knife settings are randomized.

## To find out on the printer

Starting points, to settle with real cuts. The Calibrate tests are built for these:

1. **Z-Cut.** Use the **Cut depth** test. With a spring-loaded holder, Z sets the force, and the holder's cap sets
   the blade exposure: just over the material's thickness.
2. **Blade offset.** Use the **Blade offset** test. The blades' angle and tip geometry decide it: 0.25 mm is typical
   for 45°, more for 60°.
3. **Swivel angle.** It's 30° now. Lower it if gentle corners come out rounded; raise it if curves get bumpy.
4. **Cut speed and acceleration.** Use 20 mm/s to start. Corners overshoot at high acceleration, so a lower M204
   for the cut layer may help.
5. **Blade alignment at the start.** The first cut of a job assumes the blade already points along its first edge,
   so it may start slightly rounded. If so, a short alignment cut in the waste area before the first path would fix
   it.
6. **Knife offset.** Run the Offset finder **with the knife**.
7. **Cutting mat thickness.** It raises the material, so redo the Z-Cut test with the mat in place.

## Still to do

- **Image tracing:** Outline gives closed shapes; the other styles are meant for a pen. Hide or warn about them for
  the cut layer.
- **Weed box margin:** it's fixed at 3 mm (`layer.weedMargin` is read but has no UI yet).
- **Passes:** they repeat at the same Z. Thick material may need a step down per pass.
- **Print-then-cut** works by design (pen layers, then the cut layer, with a swap pause). Registration accuracy
  depends on the knife offset measurement.
