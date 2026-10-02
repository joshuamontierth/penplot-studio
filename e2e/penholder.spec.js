// Download pen mount: the bundled cartridge and spring are resized live for a measured pen, a pen that is too
// big is refused, and the two resized parts download with the printer's attachment.
import { test, expect } from './fixtures.js';
import { dialog, openApp } from './helpers.js';

test('resizes the bundled pen mount for a pen and downloads the three parts', async ({ page, consoleProblems }) => {
  await openApp(page);
  await page.getByRole('button', { name: 'Printer & plotter settings' }).click();
  await page.getByRole('button', { name: 'Download pen mount' }).click();
  const dlg = dialog(page, 'Download pen mount');
  await expect(dlg.locator('.ph-result')).toContainText(/Supports pens up to \d+\.\d mm/, { timeout: 30_000 });

  const pen = dlg.locator('.field', { hasText: 'Pen diameter' }).locator('input');
  await pen.fill('8');
  await pen.press('Enter');
  const part = (name) => dlg.locator('.ph-part', { hasText: name });
  await expect(part('Pen cartridge')).toContainText('bore 8.40 mm');
  await expect(part('Spring')).toContainText(/bore 9\.\d\d mm/);
  await expect(part('Attachment')).toContainText('unchanged');
  await expect(part('Attachment').locator('select')).toHaveValue('x1p1'); // the X1C's attachment

  // too big: refused with a clear message, nothing to download
  await pen.fill('16');
  await pen.press('Enter');
  await expect(dlg.locator('.warn-item.error')).toContainText('too big');
  await expect(dlg.getByRole('button', { name: 'Download' })).toBeDisabled();

  await pen.fill('8');
  await pen.press('Enter');
  await expect(part('Pen cartridge')).toContainText('bore 8.40 mm');
  const names = [];
  page.on('download', (d) => names.push(d.suggestedFilename()));
  await dlg.getByRole('button', { name: 'Download' }).click();
  await expect
    .poll(() => names.sort())
    .toEqual(['Pen cartridge - 8 mm pen.stl', 'Spring - 8 mm pen.stl', 'X1-P1 attachment.stl']);
  expect(consoleProblems).toEqual([]);
});
