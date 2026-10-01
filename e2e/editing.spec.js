// Editing with real mouse and keyboard input: drawing tools, selection and transforms, undo/redo,
// text, patterns and SVG drag & drop. Bed coordinates are mm in pen space (Y up, 0,0 = front-left).
/* global PP */
import { test, expect } from './fixtures.js';
import {
  clickOnBed,
  dialog,
  dragOnBed,
  lastObject,
  objectCount,
  objects,
  openApp,
  selection,
  toClient,
} from './helpers.js';

const near = (actual, expected, tol = 0.5) =>
  expect(Math.abs(actual - expected), `${actual} ≈ ${expected}`).toBeLessThanOrEqual(tol);

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('rectangle tool from the tool strip draws a rect by dragging', async ({ page, consoleProblems }) => {
  await page.locator('#toolstrip .tool-btn[data-tool="rect"]').click();
  await expect(page.locator('#toolstrip .tool-btn.on')).toHaveAttribute('data-tool', 'rect');
  await expect(page.locator('#statusbar .st-hint')).toContainText('Shift = square');

  await dragOnBed(page, [
    [40, 180],
    [80, 200],
  ]);
  expect(await objectCount(page)).toBe(5);
  const o = await lastObject(page);
  expect(o).toMatchObject({ type: 'shape', shape: 'rect', name: 'Rect' });
  near(o.w, 40);
  near(o.h, 20);
  near(o.x, 60);
  near(o.y, 190);
  expect(await selection(page)).toEqual([o.id]);
  await expect(page.locator('#statusbar .st-sel')).toHaveText('1 selected');
  await expect(page.locator('#right-panel .type-badge')).toHaveText('Rect');
  expect(consoleProblems).toEqual([]);
});

test('ellipse, polygon and star tools draw shapes via keyboard shortcuts', async ({ page, consoleProblems }) => {
  const cases = [
    ['e', 'ellipse'],
    ['g', 'polygon'],
    ['s', 'star'],
  ];
  for (const [i, [key, shape]] of cases.entries()) {
    await page.keyboard.press(key);
    await expect(page.locator('#toolstrip .tool-btn.on')).toHaveAttribute('data-tool', shape);
    const y = 60 + i * 40;
    await dragOnBed(page, [
      [150, y],
      [180, y + 24],
    ]);
    const o = await lastObject(page);
    expect(o).toMatchObject({ type: 'shape', shape });
    near(o.w, 30);
    near(o.h, 24);
    expect(o.worldPolys).toBe(1);
  }
  expect(await objectCount(page)).toBe(4 + cases.length);
  // a click without a drag does not create a zero-size shape
  await clickOnBed(page, 60, 60);
  expect(await objectCount(page)).toBe(4 + cases.length);
  expect(consoleProblems).toEqual([]);
});

test('freehand pen, line and polyline tools create paths', async ({ page, consoleProblems }) => {
  await page.keyboard.press('p');
  const stroke = [];
  for (let i = 0; i <= 12; i++) stroke.push([40 + i * 4, 190 + 6 * Math.sin(i / 2)]);
  await dragOnBed(page, stroke, { steps: 3 });
  let o = await lastObject(page);
  expect(o).toMatchObject({ type: 'path', name: 'Freehand' });
  expect(o.paths).toHaveLength(1);
  expect(o.paths[0]).toBeGreaterThanOrEqual(8);
  near(o.bbox.minX, 40, 1);
  near(o.bbox.maxX, 88, 1);

  await page.keyboard.press('l');
  await dragOnBed(page, [
    [120, 60],
    [160, 90],
  ]);
  o = await lastObject(page);
  expect(o).toMatchObject({ type: 'path', name: 'Line', paths: [4] });
  near(o.bbox.maxX - o.bbox.minX, 40);
  near(o.bbox.maxY - o.bbox.minY, 30);

  await page.keyboard.press('y');
  await clickOnBed(page, 60, 60);
  await clickOnBed(page, 80, 80);
  const end = await toClient(page, 100, 60);
  await page.mouse.dblclick(end.x, end.y); // double-click finishes the polyline
  o = await lastObject(page);
  expect(o).toMatchObject({ type: 'path', name: 'Polyline', paths: [6] });
  expect(await objectCount(page)).toBe(7);
  expect(consoleProblems).toEqual([]);
});

test('select an object, drag it, nudge it with arrow keys and delete it', async ({ page, consoleProblems }) => {
  const target = (await objects(page)).find((o) => o.text === 'Made with a pen plotter');
  expect(target).toBeTruthy();
  // grab the thin line of text at its center, where its mid-edge scale handles are only a few px away
  const b = target.bbox;
  const grab = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
  await clickOnBed(page, ...grab);
  expect(await selection(page)).toEqual([target.id]);
  await expect(page.locator('#statusbar .st-sel')).toHaveText('1 selected');
  await expect(page.locator('#right-panel .type-badge')).toHaveText('Text');

  await dragOnBed(page, [grab, [grab[0] + 20, grab[1] + 10]]);
  let o = (await objects(page)).find((x) => x.id === target.id);
  near(o.x, target.x + 20);
  near(o.y, target.y + 10);
  expect(o.scaleX).toBe(target.scaleX); // moved, not squashed by an edge handle
  expect(o.scaleY).toBe(target.scaleY);
  // the Selection panel follows the drag
  const props = page.locator('#right-panel .sec', { has: page.locator('.sec-head', { hasText: 'Selection' }) });
  const xField = props.locator('.field', { has: page.locator('label', { hasText: /^X/ }) });
  await expect.poll(async () => parseFloat(await xField.locator('input').inputValue())).toBeCloseTo(o.x, 1);

  const before = o;
  await page.keyboard.press('ArrowRight'); // +1 mm
  await page.keyboard.press('Shift+ArrowUp'); // +10 mm
  await page.keyboard.press('Alt+ArrowLeft'); // -0.1 mm
  o = (await objects(page)).find((x) => x.id === target.id);
  expect(o.x).toBeCloseTo(before.x + 0.9, 6);
  expect(o.y).toBeCloseTo(before.y + 10, 6);

  await page.keyboard.press('Delete');
  expect(await objectCount(page)).toBe(3);
  expect(await selection(page)).toEqual([]);
  await expect(page.locator('#statusbar .st-sel')).toHaveText('');
  await expect(page.locator('#right-panel .empty-sel')).toContainText('Select an object to edit it.');
  expect(consoleProblems).toEqual([]);
});

test('a straight line dragged by its middle moves; its end handles still scale it', async ({
  page,
  consoleProblems,
}) => {
  await page.keyboard.press('l');
  await dragOnBed(page, [
    [60, 150],
    [120, 150],
  ]);
  const line = await lastObject(page);
  expect(line).toMatchObject({ type: 'path', name: 'Line' });
  await page.keyboard.press('v');
  await dragOnBed(page, [
    [90, 150],
    [100, 160],
  ]);
  let o = await lastObject(page);
  near(o.x, line.x + 10);
  near(o.y, line.y + 10);
  expect(o.scaleX).toBe(line.scaleX);
  expect(o.scaleY).toBe(line.scaleY);
  // the right end is a corner handle: dragging it outward lengthens the line
  await dragOnBed(page, [
    [o.bbox.maxX, o.y],
    [o.bbox.maxX + 30, o.y],
  ]);
  o = await lastObject(page);
  expect(Math.abs(o.scaleX)).toBeGreaterThan(1.2);
  expect(consoleProblems).toEqual([]);
});

test('undo and redo restore object counts and positions', async ({ page, consoleProblems }) => {
  const undoBtn = page.getByRole('button', { name: 'Undo (Ctrl+Z)' });
  const redoBtn = page.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' });
  await expect(undoBtn).toBeDisabled();
  await expect(redoBtn).toBeDisabled();

  await page.keyboard.press('r');
  await dragOnBed(page, [
    [40, 184],
    [56, 200],
  ]);
  expect(await objectCount(page)).toBe(5);
  await expect(undoBtn).toBeEnabled();

  await page.keyboard.press('Control+z');
  expect(await objectCount(page)).toBe(4);
  await expect(redoBtn).toBeEnabled();
  await page.keyboard.press('Control+y');
  expect(await objectCount(page)).toBe(5);
  await page.keyboard.press('Control+z');
  expect(await objectCount(page)).toBe(4);
  await page.keyboard.press('Control+Shift+z');
  expect(await objectCount(page)).toBe(5);
  await undoBtn.click();
  expect(await objectCount(page)).toBe(4);
  await redoBtn.click();
  expect(await objectCount(page)).toBe(5);
  await expect(redoBtn).toBeDisabled();

  // a drag is one undo step (small unfilled shapes are picked from inside)
  const rect = await lastObject(page);
  await page.keyboard.press('v');
  await dragOnBed(page, [
    [rect.x, rect.y],
    [rect.x + 30, rect.y - 20],
  ]);
  let moved = await lastObject(page);
  near(moved.x, rect.x + 30);
  near(moved.y, rect.y - 20);
  await page.keyboard.press('Control+z');
  moved = await lastObject(page);
  expect(moved.x).toBe(rect.x);
  expect(moved.y).toBe(rect.y);
  expect(await objectCount(page)).toBe(5);

  // undo back to the welcome design; the stack is then empty
  await page.keyboard.press('Control+z');
  expect(await objectCount(page)).toBe(4);
  await expect(undoBtn).toBeDisabled();
  expect(consoleProblems).toEqual([]);
});

test('text tool places text that the Text panel edits live', async ({ page, consoleProblems }) => {
  await page.keyboard.press('t');
  await clickOnBed(page, 70, 196);
  const o = await lastObject(page);
  expect(o).toMatchObject({ type: 'text', text: 'Hello!', font: 'h:scripts' });
  near(o.x, 70);
  near(o.y, 196);
  // the tool hands over to the Text panel with the text selected for typing
  await expect(page.locator('#toolstrip .tool-btn.on')).toHaveAttribute('data-tool', 'select');
  const pane = page.locator('#left-panel .tab-pane.on');
  await expect(page.locator('#left-panel .tab.on')).toHaveText('Text');
  const ta = pane.locator('textarea.text-input');
  await expect(ta).toBeFocused();
  await expect(pane).toContainText('Editing the selected text');
  await page.keyboard.type('Pen plot');

  const store = (key) => page.evaluate((k) => PP.Store.get(PP.Store.selection[0])[k], key);
  await expect.poll(() => store('text')).toBe('Pen plot');
  await pane.locator('select').selectOption('h:timesr');
  await expect.poll(() => store('font')).toBe('h:timesr');
  const size = pane
    .locator('.field', { has: page.locator('label', { hasText: 'Letter height' }) })
    .locator('input.num');
  await size.fill('20');
  await size.press('Enter');
  await expect.poll(() => store('size')).toBe(20);

  // the new font loads and the text gets geometry; still one object, still selected
  await expect.poll(async () => (await lastObject(page)).worldPolys).toBeGreaterThan(0);
  expect(await page.evaluate(() => PP.Fonts.get('h:timesr').loaded)).toBe(true);
  expect(await objectCount(page)).toBe(5);
  expect(await selection(page)).toEqual([o.id]);
  expect(consoleProblems).toEqual([]);
});

test('Text panel adds new text with the chosen text and font', async ({ page, consoleProblems }) => {
  const pane = page.locator('#left-panel .tab-pane.on');
  const addBtn = pane.getByRole('button', { name: 'Add to bed' });
  await pane.locator('textarea.text-input').fill('Panel text');
  await pane.locator('select').selectOption('h:futural');
  await addBtn.click();

  const o = await lastObject(page);
  expect(o).toMatchObject({ type: 'text', text: 'Panel text', font: 'h:futural', size: 12 });
  const c = await page.evaluate(() => PP.App.placementCenter());
  near(o.x, c.x, 1e-6);
  near(o.y, c.y, 1e-6);
  expect(o.worldPolys).toBeGreaterThan(0);
  expect(await selection(page)).toEqual([o.id]);
  await expect(pane.getByRole('button', { name: 'Add as new text' })).toBeVisible();
  expect(consoleProblems).toEqual([]);
});

test('Patterns tab adds a configured pattern and edits it live', async ({ page, consoleProblems }) => {
  await page.locator('#left-panel .tab', { hasText: 'Patterns' }).click();
  const pane = page.locator('#left-panel .tab-pane.on');
  await pane.locator('.chip', { hasText: 'Curves' }).click();
  await expect(pane.locator('.pattern-card')).toHaveCount(6);
  await pane.locator('.pattern-card', { hasText: 'Rose Curve' }).click();
  await expect(pane.locator('.pattern-title')).toHaveText('Rose Curve');
  const param = (label) =>
    pane.locator('.field', { has: page.locator('label', { hasText: label }) }).locator('input.num');
  await param('Numerator n').fill('7');
  await param('Numerator n').press('Enter');
  await pane.getByRole('button', { name: 'Add pattern to bed' }).click();

  let o = await lastObject(page);
  expect(o).toMatchObject({ type: 'pattern', generator: 'rose', name: 'Rose Curve' });
  expect(o.params.n).toBe(7);
  expect(o.worldPolys).toBeGreaterThan(0);
  expect(await selection(page)).toEqual([o.id]);
  await expect(pane.getByRole('button', { name: 'Add a copy to bed' })).toBeVisible();

  // with the pattern selected, parameter changes apply to it
  await param('Layers').fill('3');
  await param('Layers').press('Enter');
  await expect.poll(async () => (await lastObject(page)).params.layers).toBe(3);
  o = await lastObject(page);
  expect(o.params.n).toBe(7);
  expect(await objectCount(page)).toBe(5);
  expect(consoleProblems).toEqual([]);
});

test('dropping an SVG file onto the canvas imports its paths', async ({ page, consoleProblems }) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="60mm" height="40mm" viewBox="0 0 60 40">
    <path d="M5 5 L55 5 L55 35 Z" fill="none" stroke="#000000"/>
    <circle cx="30" cy="20" r="10" fill="none" stroke="#ff0000"/>
  </svg>`;
  const dt = await page.evaluateHandle((text) => {
    const d = new DataTransfer();
    d.items.add(new File([text], 'drop-test.svg', { type: 'image/svg+xml' }));
    return d;
  }, svg);
  const canvas = page.locator('canvas.bed-canvas');
  await canvas.dispatchEvent('dragenter', { dataTransfer: dt });
  await expect(page.locator('.drop-mask')).toBeVisible();
  await canvas.dispatchEvent('drop', { dataTransfer: dt });
  await expect(page.locator('.drop-mask')).toBeHidden();
  await expect(page.locator('.toast', { hasText: 'Imported drop-test.svg' })).toBeVisible();

  // two stroke colors -> two new layers (multi-pen import is on by default), one path object each
  await expect.poll(() => objectCount(page)).toBe(6);
  const added = (await objects(page)).slice(4);
  expect(added.map((o) => o.name)).toEqual(['drop-test (#000000)', 'drop-test (#ff0000)']);
  for (const o of added) expect(o).toMatchObject({ type: 'path', paths: [expect.any(Number)] });
  const layers = await page.evaluate(() => PP.Store.project.layers.map((l) => [l.id, l.color]));
  expect(layers).toHaveLength(3);
  expect(added.map((o) => layers.find(([id]) => id === o.layerId)[1])).toEqual(['#000000', '#ff0000']);
  // imported at 1:1 scale (60 x 40 mm document fits on the paper)
  near(added[0].bbox.maxX - added[0].bbox.minX, 50, 0.05);
  near(added[1].bbox.maxX - added[1].bbox.minX, 20, 0.1);
  await expect(page.locator('#right-panel .layer-row')).toHaveCount(3);
  expect(await page.evaluate(() => document.querySelectorAll('.modal-back').length)).toBe(0);
  expect(consoleProblems).toEqual([]);
});

test('layer rename by real double-click, locked objects stay selectable, overrides clear', async ({
  page,
  consoleProblems,
}) => {
  // rename: the first click re-renders the list, the second must still open the editor
  await page.locator('#right-panel .layer-row .layer-name').first().dblclick();
  const input = page.locator('#right-panel .layer-rename');
  await expect(input).toBeVisible();
  await input.fill('Black pen');
  await input.press('Enter');
  await expect(page.locator('#right-panel .layer-row .layer-name').first()).toHaveText('Black pen');

  // lock an object, deselect, click it again: it is selected (not moved) and can be unlocked
  const target = (await objects(page)).find((o) => o.text === 'Made with a pen plotter');
  const c = [(target.bbox.minX + target.bbox.maxX) / 2, (target.bbox.minY + target.bbox.maxY) / 2];
  await clickOnBed(page, ...c);
  await page.getByRole('button', { name: 'Lock', exact: true }).click();
  await clickOnBed(page, 240, 240);
  expect(await selection(page)).toEqual([]);
  await clickOnBed(page, ...c);
  expect(await selection(page)).toEqual([target.id]);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  expect((await objects(page)).find((o) => o.id === target.id).x).toBe(target.x);

  // a layer Z override can be cleared by emptying the field
  await page.locator('#right-panel .layer-row').first().getByRole('button', { name: 'Layer options' }).click();
  const z = page.locator('.popover .field', { hasText: 'Pen height' }).locator('input');
  await z.fill('15');
  await z.press('Enter');
  expect(await page.evaluate(() => PP.Store.project.layers[0].zDraw)).toBe(15);
  await z.fill('');
  await z.press('Enter');
  expect(await page.evaluate(() => PP.Store.project.layers[0].zDraw)).toBeNull();
  expect(consoleProblems).toEqual([]);
});

test('UX guards: hidden layer, shortcuts while typing, empty text, stale preview', async ({
  page,
  consoleProblems,
}) => {
  // adding from a panel to a hidden active layer is refused with a warning
  await page.evaluate(() => PP.Store.updateLayer(PP.Store.project.activeLayerId, { visible: false }));
  const before = await objectCount(page);
  await page.getByRole('button', { name: 'Add to bed' }).click();
  await expect(page.locator('.toast', { hasText: 'is hidden' })).toBeVisible();
  expect(await objectCount(page)).toBe(before);
  await page.evaluate(() => PP.Store.updateLayer(PP.Store.project.activeLayerId, { visible: true }));

  // Ctrl+E works while a text field has focus
  await page.getByRole('textbox', { name: 'Project name' }).click();
  await page.keyboard.press('Control+e');
  await expect(dialog(page, 'Download G-code')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog(page, 'Download G-code')).toBeHidden();

  // a text object emptied in the Text panel is removed once deselected
  const target = (await objects(page)).find((o) => o.text === 'Made with a pen plotter');
  await clickOnBed(page, (target.bbox.minX + target.bbox.maxX) / 2, (target.bbox.minY + target.bbox.maxY) / 2);
  expect(await selection(page)).toEqual([target.id]);
  await page.locator('#left-panel textarea').first().fill('   ');
  expect((await objects(page)).find((o) => o.id === target.id).text).toBe('   ');
  await clickOnBed(page, 240, 240);
  await expect.poll(async () => (await objects(page)).some((o) => o.id === target.id)).toBe(false);

  // the preview closes when the design changes under it
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect.poll(() => page.evaluate(() => PP.Preview.active)).toBe(true);
  await page.evaluate(() => PP.Store.update(PP.Store.project.objects[0].id, { x: 100 }));
  await expect.poll(() => page.evaluate(() => PP.Preview.active)).toBe(false);
  expect(consoleProblems).toEqual([]);
});

test('layers reorder by drag, the color picker survives changes, paper and align popovers', async ({
  page,
  consoleProblems,
}) => {
  await page.evaluate(() => PP.Store.addLayer());
  const rows = page.locator('#right-panel .layer-row');
  await expect(rows).toHaveCount(2);
  const names = () => page.evaluate(() => PP.Store.project.layers.map((l) => l.name));
  const [first, second] = await names();

  // drag the second layer's grip above the first: it plots first now
  await rows
    .nth(1)
    .locator('.layer-grip')
    .dragTo(rows.nth(0), { targetPosition: { x: 40, y: 4 } });
  await expect.poll(names).toEqual([second, first]);
  await page.waitForTimeout(150); // let the list's 50 ms debounced re-render after the drop land

  // a color change must not re-render the row under the open picker (the picker used to close)
  const swatch = rows.first().locator('input[type=color]');
  const handle = await swatch.elementHandle();
  await swatch.evaluate((el) => {
    el.value = '#ff0000';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(150); // longer than the list's 50 ms re-render debounce
  expect(await handle.evaluate((el) => el.isConnected)).toBe(true);
  await swatch.evaluate((el) => el.dispatchEvent(new Event('change', { bubbles: true })));
  await expect.poll(() => page.evaluate(() => PP.Store.project.layers[0].color)).toBe('#ff0000');

  // paper popover from the top bar
  await page.getByRole('button', { name: 'Letter · portrait' }).click();
  await page.locator('.popover .seg-btn', { hasText: 'Landscape' }).click();
  await expect(page.getByRole('button', { name: 'Letter · landscape' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.popover')).toHaveCount(0);

  // Align menu centers the selection on the paper
  const target = (await objects(page)).find((o) => o.text === 'Made with a pen plotter');
  await page.evaluate((id) => PP.Store.select(id), target.id);
  await page.getByRole('button', { name: 'Align' }).click();
  await page.locator('.popover .menu-item', { hasText: 'Center on the paper' }).click();
  const pa = await page.evaluate(() => PP.Store.project.paper);
  const moved = (await objects(page)).find((o) => o.id === target.id);
  near((moved.bbox.minX + moved.bbox.maxX) / 2, pa.x + pa.w / 2, 0.6);
  expect(consoleProblems).toEqual([]);
});

test('multi-select stretches on one axis when Keep proportions is off; fit to paper vs drawable area', async ({
  page,
  consoleProblems,
}) => {
  const ids = await page.evaluate(() => {
    const S = PP.Store;
    S.reset();
    const a = PP.Objects.create.shape('rect', { x: 100, y: 100, w: 20, h: 10 });
    const b = PP.Objects.create.shape('rect', { x: 140, y: 100, w: 10, h: 20, rotation: 90 });
    S.add([a, b], { history: false });
    S.select(S.project.objects.map((o) => o.id));
    return S.project.objects.map((o) => o.id);
  });
  const props = page.locator('#right-panel .sec', { has: page.locator('.sec-head', { hasText: 'Selection' }) });
  const field = (label) =>
    props.locator('.field', { has: page.locator('label', { hasText: new RegExp('^' + label) }) }).locator('input');
  const group = () =>
    page.evaluate((list) => {
      let bb = null;
      for (const id of list) bb = PP.Geo.bboxUnion(bb, PP.Objects.world(PP.Store.get(id)).bbox);
      return { w: bb.maxX - bb.minX, h: bb.maxY - bb.minY };
    }, ids);
  const before = await group();
  if ((await page.locator('#right-panel .aspect-row .icon-btn.on').count()) > 0)
    await page.locator('#right-panel .aspect-row .icon-btn').click();
  await field('W').fill(String(before.w * 2));
  await field('W').press('Enter');
  await expect.poll(async () => (await group()).w).toBeCloseTo(before.w * 2, 3);
  expect((await group()).h).toBeCloseTo(before.h, 3); // height unchanged

  // the two fit targets differ: the Letter paper sticks out of the X1C's drawable area at the front-left
  const center = async () => {
    const g = await page.evaluate((list) => {
      let bb = null;
      for (const id of list) bb = PP.Geo.bboxUnion(bb, PP.Objects.world(PP.Store.get(id)).bbox);
      return bb;
    }, ids);
    return [(g.minX + g.maxX) / 2, (g.minY + g.maxY) / 2];
  };
  await page.getByRole('button', { name: 'Align' }).click();
  await page.locator('.popover .menu-item', { hasText: 'Fit to the paper' }).click();
  const pa = await page.evaluate(() => PP.Store.project.paper);
  const [px, py] = await center();
  expect(px).toBeCloseTo(pa.x + pa.w / 2, 3);
  expect(py).toBeCloseTo(pa.y + pa.h / 2, 3);
  await page.getByRole('button', { name: 'Align' }).click();
  await page.locator('.popover .menu-item', { hasText: 'Fit to the drawable area' }).click();
  const area = await page.evaluate(() => PP.App.workArea());
  const [dx, dy] = await center();
  expect(dx).toBeCloseTo((area.minX + area.maxX) / 2, 3);
  expect(dy).toBeCloseTo((area.minY + area.maxY) / 2, 3);
  expect(consoleProblems).toEqual([]);
});
