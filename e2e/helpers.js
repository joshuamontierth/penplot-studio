// Helpers for the app UI specs: boot the editor, map bed millimetres (pen coordinates, Y up) to page
// pixels so tests can drive the canvas with real mouse input, and read the project back from PP.Store.
/* global PP */
import { readFile } from 'node:fs/promises';

/**
 * Open the editor and wait until the welcome design is on the bed and its fonts are loaded.
 * By default the first-launch help dialog is suppressed (App.init reads `pp.seenHelp` as JSON).
 */
export async function openApp(page, { skipHelp = true } = {}) {
  if (skipHelp) await page.addInitScript(() => localStorage.setItem('pp.seenHelp', 'true'));
  await page.goto('/');
  await page.waitForFunction(() => {
    const P = window.PP;
    if (!P || !P.App || !P.App.view || !P.Store.project.objects.length) return false;
    return ['h:scripts', 'h:futural'].every((id) => P.Fonts.get(id) && P.Fonts.get(id).loaded);
  });
}

/** Page (client) coordinates of a bed point in mm. */
export function toClient(page, x, y) {
  return page.evaluate(
    ([wx, wy]) => {
      const v = PP.App.view;
      const r = v.canvas.getBoundingClientRect();
      const [sx, sy] = v.toScreen(wx, wy);
      return { x: r.left + sx, y: r.top + sy };
    },
    [x, y],
  );
}

/** Press at the first bed point, move through the others and release (a real mouse drag). */
export async function dragOnBed(page, points, { steps = 6 } = {}) {
  const pts = [];
  for (const [x, y] of points) pts.push(await toClient(page, x, y));
  await page.mouse.move(pts[0].x, pts[0].y);
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps });
  await page.mouse.up();
}

export async function clickOnBed(page, x, y, opts) {
  const p = await toClient(page, x, y);
  await page.mouse.click(p.x, p.y, opts);
}

/** Plain summaries of the project objects (geometry arrays reduced to their lengths). */
export function objects(page) {
  return page.evaluate(() =>
    PP.Store.project.objects.map((o) => ({
      id: o.id,
      type: o.type,
      shape: o.shape,
      name: o.name,
      layerId: o.layerId,
      x: o.x,
      y: o.y,
      rotation: o.rotation,
      scaleX: o.scaleX,
      scaleY: o.scaleY,
      w: o.w,
      h: o.h,
      text: o.text,
      font: o.font,
      size: o.size,
      generator: o.generator,
      params: o.params,
      paths: o.paths ? o.paths.map((p) => p.length) : undefined,
      worldPolys: PP.Objects.world(o).polys.length,
      bbox: PP.Objects.world(o).bbox,
    })),
  );
}

export const objectCount = (page) => page.evaluate(() => PP.Store.project.objects.length);
export const selection = (page) => page.evaluate(() => PP.Store.selection.slice());
export const lastObject = async (page) => (await objects(page)).at(-1);

/** The open modal whose title is `title`. */
export function dialog(page, title) {
  return page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
}

/** Click `trigger` and return the download it starts, with its text content. */
export async function download(page, trigger) {
  const [dl] = await Promise.all([page.waitForEvent('download'), trigger.click()]);
  return { name: dl.suggestedFilename(), text: await readFile(await dl.path(), 'utf8') };
}

/**
 * Replay G-code through the app's simulator against the built-in (factory) X1C profile.
 * `jobs: true` also checks stroke count and draw length against the current design's plan.
 */
export function simulate(page, text, { jobs = false, ...opts } = {}) {
  return page.evaluate(
    ({ text: gcode, withJobs, simOpts }) => {
      const P = PP.GCode.normalizeProfile(PP.GCode.BUILTIN_PROFILES.find((p) => p.id === 'bambu-x1c'));
      const sim = withJobs
        ? PP.GSim.check(gcode, P, PP.App.buildPlan().jobs, { keepMoves: false, ...simOpts })
        : PP.GSim.simulate(gcode, P, { keepMoves: false, ...simOpts });
      return {
        ok: sim.ok,
        errors: sim.errors.map(PP.GSim.fmtMsg),
        pauses: sim.pauses.length,
        strokes: sim.stats.penDowns,
      };
    },
    { text, withJobs: jobs, simOpts: opts },
  );
}
