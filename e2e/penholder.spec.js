// Pen holder dialog: open synthetic cartridge/spring STLs through the real file pickers, resize live for a
// measured pen, refuse a pen that is too big, and download both STLs.
import { test, expect } from './fixtures.js';
import { dialog, openApp } from './helpers.js';

let parts;

test.beforeAll(async () => {
  const { default: Module } = await import(new URL('../vendor/manifold/manifold.js', import.meta.url).href);
  const api = await Module();
  api.setup();
  const { Manifold } = api;
  const stl = (m) => {
    const mesh = m.getMesh();
    const n = mesh.triVerts.length / 3;
    const buf = Buffer.alloc(84 + n * 50);
    buf.writeUInt32LE(n, 80);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        const v = mesh.triVerts[i * 3 + k] * mesh.numProp;
        for (let a = 0; a < 3; a++) buf.writeFloatLE(mesh.vertProperties[v + a], 84 + i * 50 + 12 + k * 12 + a * 4);
      }
    }
    return buf;
  };
  const tube = Manifold.cylinder(40, 9, -1, 96).subtract(Manifold.cylinder(42, 5.3, -1, 72).translate([0, 0, -1]));
  let rings = Manifold.cube([2, 2, 15.5]).translate([8.5, -1, 0]);
  for (let i = 0; i < 5; i++) {
    rings = rings.add(
      Manifold.cylinder(2, 9, -1, 96)
        .subtract(Manifold.cylinder(4, 5.75, -1, 72).translate([0, 0, -1]))
        .translate([0, 0, i * 3.5]),
    );
  }
  parts = { cartridge: stl(tube), spring: stl(rings.rotate([-90, 0, 0])) };
});

test('resizes the pen bore of both parts live and downloads them', async ({ page, consoleProblems }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Printer & plotter settings' }).click();
  await page.getByRole('button', { name: 'Pen holder for your pen…' }).click();
  const dlg = dialog(page, 'Pen holder for your pen');
  await expect(dlg).toBeVisible();

  const choose = async (i, name, buffer) => {
    const chooser = page.waitForEvent('filechooser');
    await dlg.getByRole('button', { name: 'Choose STL…' }).nth(i).click();
    await (await chooser).setFiles({ name, mimeType: 'model/stl', buffer });
  };
  await choose(0, 'Cartridge.stl', parts.cartridge);
  await expect(dlg.locator('.ph-slot').nth(0)).toContainText(/bore 10\.\d\d mm along Z/);
  await choose(1, 'Spring.stl', parts.spring);
  await expect(dlg.locator('.ph-slot').nth(1)).toContainText(/bore 11\.\d\d mm along Y/);

  const pen = dlg.locator('.field', { hasText: 'Measured pen diameter' }).locator('input');
  await pen.fill('8');
  await pen.press('Enter');
  await expect(dlg.locator('.ph-result')).toContainText('Pen cartridge bore 8.40 mm');
  await expect(dlg.locator('.ph-result')).toContainText(/Spring bore 9\.\d\d mm/);
  await expect(dlg.locator('.ph-result')).toContainText(/Supports pens up to \d+\.\d mm/);

  // too big: refused with a clear message
  await pen.fill('16');
  await pen.press('Enter');
  await expect(dlg.locator('.warn-item.error')).toContainText('too big');

  await pen.fill('8');
  await pen.press('Enter');
  await expect(dlg.locator('.ph-result')).toContainText('Pen cartridge bore 8.40 mm');
  const names = [];
  page.on('download', (d) => names.push(d.suggestedFilename()));
  await dlg.getByRole('button', { name: 'Download STLs' }).click();
  await expect.poll(() => names.sort()).toEqual(['Cartridge - 8 mm pen.stl', 'Spring - 8 mm pen.stl']);
  expect(consoleProblems).toEqual([]);
});
