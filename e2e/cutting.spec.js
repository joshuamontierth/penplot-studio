// Cut layer (drag knife): made from the layer menu, kept last, fills left out, and exported after a pen-to-knife
// swap pause with knife paths that pass the safety check (docs/cutting.md).
import { test, expect } from './fixtures.js';
import { dialog, download, openApp } from './helpers.js';

test('a cut layer is plotted last with the knife, after a swap pause', async ({ page, consoleProblems }) => {
  await openApp(page);
  // the welcome design is on Layer 1; add a hatch-filled square to it and a second (pen) layer
  await page.evaluate(() => {
    const { Objects, Store } = window.PP;
    const o = Objects.create.shape('rect', { x: 120, y: 100, w: 30, h: 30, layerId: Store.project.layers[0].id });
    o.fill = Object.assign({}, Objects.DEFAULT_FILL, { enabled: true, spacing: 2 });
    Store.add([o]);
    const ink = Store.addLayer({ name: 'Ink' });
    Store.add([Objects.create.shape('ellipse', { x: 60, y: 60, w: 20, h: 20, layerId: ink.id })]);
  });
  const rows = page.locator('#right-panel .layer-row');
  await expect(rows).toHaveText([/Layer 1/, /Ink/]);

  const menu = async (name) => rows.filter({ hasText: name }).getByRole('button', { name: 'Layer options' }).click();
  await menu('Layer 1');
  await page.getByRole('button', { name: 'Use as the cut layer (knife, plotted last)' }).click();
  await expect(rows).toHaveText([/Ink/, /Layer 1/]); // moved last
  await expect(rows.last().locator('.layer-tool')).toBeVisible();
  const cutJob = () => page.evaluate(() => window.PP.App.buildPlan().jobs.find((j) => j.tool === 'cut'));
  expect((await cutJob()).polys.length).toBeLessThan(100); // the ~15 hatch lines are left out

  await menu('Layer 1');
  await expect(page.getByRole('button', { name: 'Move up (plot earlier)' })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Mirror (iron-on vinyl)' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+e');
  const dlg = dialog(page, 'Download G-code');
  await expect(dlg).toContainText('one-stroke font');
  await expect(dlg).toContainText('Cut on a cutting mat');
  await expect(dlg).toContainText('Hatch fills on the cut layer are left out');
  await expect(dlg).toContainText('swap the pen holder for the knife holder');
  await expect(dlg.locator('.warn-item.ok')).toContainText('Safety check passed');
  const { text } = await download(page, dlg.getByRole('button', { name: 'Download', exact: true }));
  expect(text).toMatch(/^; PAUSE: swap the pen holder for the knife holder, then press RESUME$/m);
  expect(text.indexOf('; PP_TOOL knife')).toBeGreaterThan(text.indexOf('; PP_PAUSE swap'));
  expect(text).toMatch(/ ; knife down$/m);
  await page.keyboard.press('Escape');

  // back to a pen layer; undo makes it the cut layer again; the tool is saved with the project
  await menu('Layer 1');
  await page.getByRole('button', { name: 'Use as a pen layer' }).click();
  expect(await cutJob()).toBeUndefined();
  await page.keyboard.press('Control+z');
  expect(await cutJob()).toBeDefined();
  const saved = await page.evaluate(() => window.PP.Store.serialize());
  expect(saved.layers.map((l) => l.tool)).toEqual(['pen', 'cut']);
  expect(consoleProblems).toEqual([]);
});
