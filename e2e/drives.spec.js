// Save to removable drive (desktop app): with the desktop bridge stubbed, the export dialog offers the detected
// drive, saves the G-code to it, ejects it, and drops the option when the drive goes away.
import { test, expect } from './fixtures.js';
import { dialog, openApp } from './helpers.js';

test('export saves G-code to a removable drive and ejects it', async ({ page, consoleProblems }) => {
  await page.addInitScript(() => {
    const st = (window.__drive = {
      list: [{ id: 'E:', label: 'BAMBU (E:)', root: 'E:\\', free: 3e10 }],
      saved: [],
      ejected: [],
    });
    window.ppDesktop = {
      drives: async () => st.list,
      saveToDrive: async (id, files) => {
        st.saved.push({ id, files: files.map((f) => ({ name: f.name, head: String(f.data).slice(0, 2) })) });
        return { saved: files.map((f) => 'E:\\' + f.name) };
      },
      eject: async (id) => {
        st.ejected.push(id);
        st.list = [];
        return { ejected: id };
      },
    };
  });
  await openApp(page);
  await page.keyboard.press('Control+e');
  const dlg = dialog(page, 'Download G-code');
  const bar = dlg.locator('.drive-bar');
  await expect(bar.locator('select')).toContainText('BAMBU (E:) · 30 GB free');
  const toDrive = dlg.getByRole('button', { name: 'Save to BAMBU (E:)' });
  await expect(toDrive).toHaveClass(/btn-primary/);
  await expect(dlg.getByRole('button', { name: 'Download', exact: true })).not.toHaveClass(/btn-primary/);

  await toDrive.click();
  await expect
    .poll(() => page.evaluate(() => window.__drive.saved))
    .toEqual([{ id: 'E:', files: [{ name: expect.stringMatching(/\.gcode$/), head: '; ' }] }]);
  await expect(page.locator('.toast').last()).toContainText('Eject it before you take it out');

  await bar.getByRole('button', { name: 'Eject' }).click();
  await expect(page.locator('.toast').last()).toContainText('BAMBU (E:) can be removed now.');
  expect(await page.evaluate(() => window.__drive.ejected)).toEqual(['E:']);
  await expect(bar).toContainText('No SD card or USB drive');
  await expect(toDrive).toBeHidden();
  await expect(dlg.getByRole('button', { name: 'Download', exact: true })).toHaveClass(/btn-primary/);
  expect(consoleProblems).toEqual([]);
});
