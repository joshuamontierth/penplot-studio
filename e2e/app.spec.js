// App shell: boot, first-launch help, status bar, printer settings, tool shortcuts and zoom controls.
/* global PP */
import { test, expect } from './fixtures.js';
import { openApp, toClient } from './helpers.js';

test('boots with the header, tools, panels, canvas and welcome design', async ({ page, consoleProblems }) => {
  await openApp(page);

  const header = page.locator('#header');
  await expect(header.locator('.brand-name')).toHaveText('PenPlot Studio');
  await expect(header.locator('.printer-select')).toHaveValue('bambu-x1c');
  await expect(header.locator('.pill')).toHaveText('Pen offset X-28 Y-35');
  await expect(header.getByRole('button', { name: 'Download G-code' })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Undo (Ctrl+Z)' })).toBeDisabled();

  const tools = page.locator('#toolstrip .tool-btn');
  await expect(tools).toHaveCount(12);
  await expect(page.locator('#toolstrip .tool-btn.on')).toHaveAttribute('data-tool', 'select');

  await expect(page.locator('#left-panel .tab')).toHaveText(['Text', 'Draw', 'Image', 'Patterns', 'Import']);
  await expect(page.locator('#left-panel .tab.on')).toHaveText('Text');
  const rightSections = page.locator('#right-panel .sec-head');
  for (const name of ['Selection', 'Layers / pens', 'Plotter settings', 'Plot summary', 'Paper']) {
    await expect(rightSections.filter({ hasText: name })).toBeVisible();
  }

  const canvas = page.locator('#canvas-wrap canvas.bed-canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box.width).toBeGreaterThan(400);
  expect(box.height).toBeGreaterThan(400);

  // welcome design: border, two text lines and a spirograph, with nothing to undo
  const types = await page.evaluate(() => PP.Store.project.objects.map((o) => o.type));
  expect(types).toEqual(['shape', 'text', 'text', 'pattern']);
  const summary = page.locator('#right-panel .stat');
  await expect(summary.filter({ hasText: 'Pens (layers)' }).locator('b')).toHaveText('1');
  await expect(summary.filter({ hasText: 'Pen lifts' }).locator('b')).toHaveText(/^\d+$/);
  // Preview / Download / Calibrate live only in the top bar
  await expect(page.locator('#right-panel').getByRole('button', { name: /Download G-code|Preview/ })).toHaveCount(0);
  await expect(page.locator('#right-panel .layer-row .layer-count')).toHaveText('4');

  expect(consoleProblems).toEqual([]);
});

test('first launch opens the help dialog once', async ({ page, consoleProblems }) => {
  await openApp(page, { skipHelp: false });
  const help = page.getByRole('dialog').filter({ hasText: 'Getting started' });
  await expect(help).toBeVisible();
  await expect(help.getByRole('tab', { name: 'Getting started' })).toHaveAttribute('aria-selected', 'true');
  await expect(help.getByText('Install the pen mount')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pp.seenHelp'))).toBe('true');
  // the calibration guide lists the tests in order
  await help.getByRole('tab', { name: 'Calibration' }).click();
  for (const t of [
    '0. Before you start',
    '1. Frame test as a dry run, no pen',
    '2. Offset finder',
    '3. Z test',
    '4. Frame test with a pen',
  ]) {
    await expect(help.getByRole('heading', { name: new RegExp('^' + t.replace(/[.()]/g, '\\$&')) })).toBeVisible();
  }
  await help.getByRole('button', { name: 'Done' }).click();
  await expect(help).toBeHidden();

  // the header help button brings it back; Escape closes it
  await page.getByRole('button', { name: 'How to plot on your X1C / help' }).click();
  await expect(help).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();
  expect(consoleProblems).toEqual([]);
});

test('status bar shows pen and nozzle position; settings show the drawable area', async ({ page, consoleProblems }) => {
  await openApp(page);
  const p = await toClient(page, 100, 120);
  await page.mouse.move(p.x, p.y);
  // nozzle = pen - offset (offset X-28 Y-35)
  await expect(page.locator('#statusbar .st-pos')).toHaveText('Pen X 100.0  Y 120.0 mm');
  await expect(page.locator('#statusbar .st-noz')).toHaveText('Nozzle X 128.0  Y 155.0');
  await expect(page.locator('#statusbar .st-hint')).toContainText('Click to select');

  await page.getByRole('button', { name: 'Printer & plotter settings' }).click();
  const settings = page.getByRole('dialog').filter({ hasText: 'Printer & plotter settings' });
  await expect(settings).toBeVisible();
  await expect(settings.locator('.modal-foot')).toContainText('Drawable area: 206 × 199 mm  (X 21–227, Y 21–220)');
  await expect(settings.locator('.warns .warn-item')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();

  await page.mouse.move(5, 5); // off the canvas
  await expect(page.locator('#statusbar .st-pos')).toHaveText('X —  Y —');
  expect(consoleProblems).toEqual([]);
});

test('keyboard shortcuts pick tools; zoom keys and buttons change the zoom', async ({ page, consoleProblems }) => {
  await openApp(page);
  const keys = { v: 'select', h: 'pan', p: 'pen', l: 'line', y: 'polyline', c: 'curve' };
  Object.assign(keys, { r: 'rect', e: 'ellipse', g: 'polygon', s: 'star', t: 'text', x: 'eraser' });
  const active = page.locator('#toolstrip .tool-btn.on');
  for (const [key, tool] of Object.entries(keys)) {
    await page.keyboard.press(key);
    await expect(active).toHaveAttribute('data-tool', tool);
    expect(await page.evaluate(() => PP.App.view.toolId)).toBe(tool);
  }
  await page.keyboard.press('Escape'); // Escape returns to the select tool
  await expect(active).toHaveAttribute('data-tool', 'select');
  await expect(page.locator('#statusbar .st-hint')).toContainText('Click to select');

  const zoom = page.locator('#canvas-wrap .zoom-lbl');
  await expect(zoom).toHaveText('100%');
  await page.keyboard.press('+');
  await expect(zoom).toHaveText('125%');
  await page.getByRole('button', { name: 'Zoom in (+)' }).click();
  await expect(zoom).toHaveText('156%');
  await page.keyboard.press('-');
  await expect(zoom).toHaveText('125%');
  await page.getByRole('button', { name: 'Fit bed (0)' }).click();
  await expect(zoom).toHaveText('100%');
  expect(consoleProblems).toEqual([]);
});
