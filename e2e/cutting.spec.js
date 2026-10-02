// Cutting mode (drag knife): the header switch, outlines only (hatch fills left out), the Cut job summary, and the
// mode kept by undo and by the project file. There is no cutting G-code yet.
import { test, expect } from './fixtures.js';
import { dialog, openApp } from './helpers.js';

test('cut mode cuts outlines only, sums up the job, and is part of the project', async ({ page, consoleProblems }) => {
  await openApp(page);
  // a hatch-filled 40 mm square
  await page.evaluate(() => {
    const o = window.PP.Objects.create.shape('rect', {
      x: 120,
      y: 120,
      w: 40,
      h: 40,
      layerId: window.PP.Store.project.activeLayerId,
    });
    o.fill = Object.assign({}, window.PP.Objects.DEFAULT_FILL, { enabled: true, spacing: 2 });
    window.PP.Store.add([o]);
  });
  const strokes = () => page.evaluate(() => window.PP.App.buildPlan().jobs.reduce((n, j) => n + j.polys.length, 0));
  const drawn = await strokes();

  const mode = page.locator('.mode-seg');
  await mode.getByRole('button', { name: 'Cut' }).click();
  await expect(mode.getByRole('button', { name: 'Cut' })).toHaveClass(/on/);
  expect(await strokes()).toBeLessThan(drawn - 10); // the ~20 hatch lines are gone

  await page.getByRole('button', { name: 'Cut job' }).click();
  const dlg = dialog(page, 'Cut job');
  await expect(dlg).toContainText('Closed shapes');
  await expect(dlg).toContainText('1 hatch fill is left out');
  await expect(dlg).toContainText('Cutting G-code is not generated yet.');
  await page.keyboard.press('Escape');

  // the preview has nothing to play in cut mode
  await page.locator('#header').getByRole('button', { name: 'Preview' }).click();
  await expect(page.locator('.toast').last()).toContainText('cutting has none yet');

  // undo brings the pen back, with its fill
  await page.keyboard.press('Control+z');
  await expect(mode.getByRole('button', { name: 'Pen' })).toHaveClass(/on/);
  expect(await strokes()).toBe(drawn);
  await expect(page.getByRole('button', { name: 'Download G-code' })).toBeVisible();

  // the mode is saved with the project
  await mode.getByRole('button', { name: 'Cut' }).click();
  const saved = await page.evaluate(() => window.PP.Store.serialize());
  expect(saved.mode).toBe('cut');
  await page.evaluate((d) => window.PP.Store.load({ ...d, mode: 'draw' }), saved);
  await expect(mode.getByRole('button', { name: 'Pen' })).toHaveClass(/on/);
  await page.evaluate((d) => window.PP.Store.load(d), saved);
  await expect(mode.getByRole('button', { name: 'Cut' })).toHaveClass(/on/);
  expect(consoleProblems).toEqual([]);
});
