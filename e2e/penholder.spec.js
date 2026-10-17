// Download pen mount: the MakerWorld parts are added once (here synthetic stand-ins: an STL and a ZIP with two more),
// kept across reloads, resized live for a measured pen, and downloaded with the printer's attachment.
import { test, expect } from './fixtures.js';
import { dialog, openApp } from './helpers.js';

let files;

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
  /** A ZIP with stored entries, like a download that was zipped without compression. */
  const zip = (entries) => {
    const parts = [],
      central = [];
    let offset = 0;
    for (const [name, data] of entries) {
      const n = Buffer.from(name);
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0);
      lh.writeUInt32LE(data.length, 18);
      lh.writeUInt32LE(data.length, 22);
      lh.writeUInt16LE(n.length, 26);
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0);
      ch.writeUInt32LE(data.length, 20);
      ch.writeUInt32LE(data.length, 24);
      ch.writeUInt16LE(n.length, 28);
      ch.writeUInt32LE(offset, 42);
      parts.push(lh, n, data);
      central.push(ch, n);
      offset += 30 + n.length + data.length;
    }
    const cd = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(cd.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...parts, cd, end]);
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
  files = {
    cartridge: stl(tube),
    zip: zip([
      ['STL/Spring.stl', stl(rings.rotate([-90, 0, 0]))],
      ['STL/X1P1 Attachment.stl', stl(Manifold.cube([20, 20, 5]))],
    ]),
  };
});

const open = async (page) => {
  await page.getByRole('button', { name: 'Printer & plotter settings' }).click();
  await page.getByRole('button', { name: 'Download pen mount' }).click();
  return dialog(page, 'Download pen mount');
};

test('adds the MakerWorld parts once, keeps them, resizes and downloads them', async ({ page, consoleProblems }) => {
  await openApp(page);
  let dlg = await open(page);
  await expect(dlg.locator('.ph-result')).toContainText('Add the pen cartridge and spring');
  await expect(dlg.getByRole('link', { name: 'MakerWorld' })).toHaveAttribute(
    'href',
    /makerworld\.com\/en\/models\/2029113/,
  );
  await expect(dlg.getByRole('button', { name: 'Download', exact: true })).toBeDisabled();

  const chooser = page.waitForEvent('filechooser');
  await dlg.getByRole('button', { name: 'Add files…' }).click();
  await (
    await chooser
  ).setFiles([
    { name: 'Pen Cartriage.stl', mimeType: 'model/stl', buffer: files.cartridge },
    { name: 'Modular System.zip', mimeType: 'application/zip', buffer: files.zip },
  ]);
  await expect(dlg.locator('.ph-result')).toContainText(/Supports pens up to \d+\.\d mm/);
  await expect(page.locator('.toast').filter({ hasText: 'Added 3 parts' })).toBeVisible();

  // kept: a reload finds them again
  await openApp(page);
  dlg = await open(page);
  await expect(dlg.locator('.ph-result')).toContainText(/Supports pens up to \d+\.\d mm/);
  const pen = dlg.locator('.field', { hasText: 'Pen diameter' }).locator('input');
  await pen.fill('8');
  await pen.press('Enter');
  const part = (name) => dlg.locator('.ph-part', { hasText: name });
  await expect(part('Pen cartridge')).toContainText('bore 8.40 mm');
  await expect(part('Spring')).toContainText(/bore 9\.\d\d mm/);
  await expect(part('Attachment')).toContainText('unchanged');

  // too big: refused, nothing to download
  await pen.fill('16');
  await pen.press('Enter');
  await expect(dlg.locator('.warn-item.error')).toContainText('too big');
  await expect(dlg.getByRole('button', { name: 'Download', exact: true })).toBeDisabled();

  await pen.fill('8');
  await pen.press('Enter');
  await expect(part('Pen cartridge')).toContainText('bore 8.40 mm');
  const names = [];
  page.on('download', (d) => names.push(d.suggestedFilename()));
  await dlg.getByRole('button', { name: 'Download', exact: true }).click();
  await expect
    .poll(() => names.sort())
    .toEqual(['Pen cartridge - 8 mm pen.stl', 'Spring - 8 mm pen.stl', 'X1-P1 attachment.stl']);
  expect(consoleProblems).toEqual([]);
});
