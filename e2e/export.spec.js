// Output: G-code export (downloaded and replayed through the simulator), animated preview and the
// calibration dialog.
/* global PP */
import { test, expect } from './fixtures.js';
import { dialog, download, openApp, simulate } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('Ctrl+E export passes the safety check and downloads simulator-clean G-code', async ({
  page,
  consoleProblems,
}) => {
  await page.keyboard.press('Control+e');
  const dlg = dialog(page, 'Download G-code');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.xcard', { hasText: 'Plate size' })).toContainText('drawable 206 × 199');
  await expect(dlg.locator('.file-row')).toHaveCount(1);
  await expect(dlg.locator('.file-row b')).toHaveText('Untitled_plot.gcode');
  await expect(dlg.locator('.warn-item.ok')).toContainText('Safety check passed');
  await expect(dlg.locator('.warn-item.error')).toHaveCount(0);

  const file = await download(page, dlg.getByRole('button', { name: 'Download', exact: true }));
  expect(file.name).toBe('Untitled_plot.gcode');
  expect(file.text).toContain('M400 U1');
  expect(file.text).toContain('G28');
  expect(file.text).toContain('; PAUSE: attach the pen holder');
  expect(file.text).not.toMatch(/^G1 [^;\n]*E-?\d/m); // no extrusion
  await expect(page.locator('.toast', { hasText: 'Saved Untitled_plot.gcode' })).toBeVisible();

  // replay the downloaded file: factory X1C profile, attach + remove pauses, strokes match the design
  const sim = await simulate(page, file.text, { expectedPauses: 1 });
  expect(sim.errors).toEqual([]);
  expect(sim.ok).toBe(true);
  expect(sim.pauses).toBe(1); // attach (no end pause)
  const lifts = await page.evaluate(() => PP.App.buildPlan().stats.lifts);
  expect(sim.strokes).toBe(lifts);
  expect((await simulate(page, file.text, { jobs: true })).errors).toEqual([]);

  // dry run: same moves at Z-Lift, the pen never goes down
  await dlg.getByText('Dry run - pen never touches the paper').click();
  await expect(dlg.locator('.file-row b')).toHaveText('Untitled_plot_DRYRUN.gcode');
  await expect(dlg.locator('.warn-item.ok')).toContainText('Safety check passed');
  const dry = await download(page, dlg.getByRole('button', { name: 'Download', exact: true }));
  expect(dry.name).toBe('Untitled_plot_DRYRUN.gcode');
  const drySim = await simulate(page, dry.text, { dryRun: true, expectedPauses: 1 });
  expect(drySim.errors).toEqual([]);
  expect(drySim.strokes).toBe(0);

  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();
  expect(consoleProblems).toEqual([]);
});

test('two-layer design exports one file with a pen-change pause, or one file per layer', async ({
  page,
  consoleProblems,
}) => {
  await page.locator('#left-panel .tab', { hasText: 'Import' }).click();
  await page.getByRole('button', { name: 'Two-color layers demo' }).click();
  await expect(page.locator('#right-panel .layer-row')).toHaveCount(2);

  await page.getByRole('button', { name: 'Download G-code' }).first().click();
  const dlg = dialog(page, 'Download G-code');
  await expect(dlg.locator('.xcard', { hasText: 'Layers' }).locator('b')).toHaveText('2');
  await expect(dlg.locator('.seg-btn.on')).toHaveText('One file (pause for pen change)');
  await expect(dlg.locator('.file-row')).toHaveCount(1);
  await expect(dlg.locator('.file-row small')).toContainText('All layers (2 pens, pauses between)');
  await expect(dlg.locator('.warn-item.ok')).toHaveCount(1);
  const combined = await download(page, dlg.getByRole('button', { name: 'Download', exact: true }));
  expect(combined.text).toContain('; PAUSE: change to the pen');
  const sim = await simulate(page, combined.text, { jobs: true });
  expect(sim.errors).toEqual([]);
  expect(sim.pauses).toBe(2); // attach, pen change

  await dlg.locator('.seg-btn', { hasText: 'One file per layer' }).click();
  await expect(dlg.locator('.file-row')).toHaveCount(2);
  await expect(dlg.locator('.warn-item.ok')).toHaveCount(2);
  await expect(dlg.locator('.file-row b')).toHaveText([
    'Untitled_plot_1_Layer_1.gcode',
    'Untitled_plot_2_Layer_2.gcode',
  ]);
  const second = await download(page, dlg.locator('.file-row').nth(1).getByRole('button', { name: 'Download' }));
  expect(second.name).toBe('Untitled_plot_2_Layer_2.gcode');
  const one = await simulate(page, second.text, { expectedPauses: 1 });
  expect(one.errors).toEqual([]);
  expect(one.strokes).toBeGreaterThan(0);
  expect(consoleProblems).toEqual([]);
});

test('preview plays the simulated G-code, scrubs, steps and exits', async ({ page, consoleProblems }) => {
  await page.locator('#header').getByRole('button', { name: 'Preview' }).click();
  const bar = page.locator('.preview-bar');
  await expect(bar).toHaveClass(/\bshow\b/);
  await expect(page.locator('body')).toHaveClass(/previewing/);
  const badge = bar.locator('.pv-safety');
  await expect(badge).toHaveText('✓ G-code check passed');
  await expect(badge).toHaveClass(/\bok\b/);

  // it starts playing on its own
  const state = () => page.evaluate(() => ({ t: PP.Preview.t, total: PP.Preview.total, playing: PP.Preview.playing }));
  await expect.poll(async () => (await state()).t).toBeGreaterThan(0);
  expect((await state()).playing).toBe(true);
  await bar.getByRole('button', { name: 'Play / pause (Space)' }).click();
  expect((await state()).playing).toBe(false);

  // scrub: click the middle of the timeline
  const slider = bar.locator('input.pv-slider');
  const sb = await slider.boundingBox();
  await page.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2);
  const mid = await state();
  expect(mid.playing).toBe(false);
  expect(mid.t / mid.total).toBeGreaterThan(0.4);
  expect(mid.t / mid.total).toBeLessThan(0.6);
  // the bar shows the path under the playhead ("Path k / n"); the step buttons move one path
  const info = bar.locator('.pv-info');
  const n = await page.evaluate(() => PP.Preview.items.length);
  const k = await page.evaluate(() => PP.Preview.items.findIndex((it) => it.t2 > PP.Preview.t) + 1);
  expect(k).toBeGreaterThan(1);
  expect(k).toBeLessThan(n);
  await expect(info).toHaveText(new RegExp(`^Path ${k} / ${n}\\b`));
  await bar.getByRole('button', { name: 'Next path' }).click();
  await expect(info).toHaveText(new RegExp(`^Path ${k + 1} / ${n}\\b`));
  await bar.getByRole('button', { name: 'Previous path' }).click();
  await bar.getByRole('button', { name: 'Previous path' }).click();
  await expect(info).toHaveText(new RegExp(`^Path ${k - 1} / ${n}\\b`));

  // the badge explains the check
  await badge.click();
  await expect(page.locator('.toast', { hasText: 'Simulated the real G-code' })).toContainText('1 pause.');

  await bar.getByRole('button', { name: 'Exit preview' }).click();
  await expect(bar).not.toHaveClass(/\bshow\b/);
  await expect(page.locator('body')).not.toHaveClass(/previewing/);
  expect(await page.evaluate(() => PP.Preview.active)).toBe(false);
  expect(consoleProblems).toEqual([]);
});

test('calibration: frame dry run and offset finder download simulator-clean files', async ({
  page,
  consoleProblems,
}) => {
  await page.getByRole('button', { name: 'Calibrate', exact: true }).click();
  const dlg = dialog(page, 'Calibration');
  await expect(dlg).toBeVisible();
  // first time: the frame test, ticked as a dry run
  await expect(dlg.locator('.seg-btn.on')).toHaveText('1 Frame');
  await expect(dlg.getByRole('checkbox', { name: 'Dry run (pen stays up)' })).toBeChecked();

  const trigger = dlg.getByRole('button', { name: 'Download calibration G-code' });
  const frame = await download(page, trigger);
  expect(frame.name).toBe('calibration_frame_DRYRUN.gcode');
  await expect(page.locator('.toast', { hasText: 'Saved calibration_frame_DRYRUN.gcode' })).toContainText(
    'safety check passed',
  );
  const frameSim = await simulate(page, frame.text, { dryRun: true });
  expect(frameSim.errors).toEqual([]);
  expect(frameSim.strokes).toBe(0);

  await dlg.locator('.seg-btn', { hasText: 'Offset finder' }).click();
  await expect(dlg.locator('.seg-btn.on')).toHaveText('2 Offset finder');
  await expect(dlg.locator('.tips li').first()).toBeVisible();
  const file = await download(page, trigger);
  expect(file.name).toBe('calibration_offset.gcode');
  await expect(page.locator('.toast', { hasText: 'Saved calibration_offset.gcode' })).toContainText(
    'safety check passed',
  );
  expect(file.text).toContain('M400 U1');
  expect(file.text).toContain('G28');

  const sim = await simulate(page, file.text, { expectedPauses: 2 });
  expect(sim.errors).toEqual([]);
  expect(sim.ok).toBe(true);
  expect(sim.pauses).toBe(2); // attach, remove the holder (then a timed wait to measure)
  expect(sim.strokes).toBeGreaterThan(0);

  // the guide opens on top at the Calibration tab; the dialog remembers the last test
  await dlg.getByRole('button', { name: 'Calibration guide' }).click();
  const help = page.getByRole('dialog').filter({ hasText: 'Getting started' });
  await expect(help.getByRole('tab', { name: 'Calibration' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Calibrate', exact: true }).click();
  await expect(dialog(page, 'Calibration').locator('.seg-btn.on')).toHaveText('2 Offset finder');
  expect(consoleProblems).toEqual([]);
});

test('the preview pauses with a real-speed click and with Space, even with its buttons focused', async ({
  page,
  consoleProblems,
}) => {
  const state = () => page.evaluate(() => ({ active: PP.Preview.active, playing: PP.Preview.playing }));
  // the header button keeps focus after the click: Space used to "click" it again on key-up and close the preview
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect.poll(state).toEqual({ active: true, playing: true });
  await page.keyboard.press('Space');
  await expect.poll(state).toEqual({ active: true, playing: false });
  await page.keyboard.press('Space');
  await expect.poll(state).toEqual({ active: true, playing: true });
  // a click as slow as a person's (the icon used to be rebuilt every frame, which swallowed the click)
  const box = await page.getByRole('button', { name: 'Play / pause (Space)' }).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(120);
  await page.mouse.up();
  await expect.poll(state).toEqual({ active: true, playing: false });
  await page.keyboard.press('Space');
  await expect.poll(state).toEqual({ active: true, playing: true });
  expect(consoleProblems).toEqual([]);
});
