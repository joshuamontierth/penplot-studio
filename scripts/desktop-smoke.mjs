#!/usr/bin/env node
/**
 * Smoke test for the Electron desktop app (Windows and Linux).
 *
 *   npm run desktop:test                 # dev app: desktop/main.js with the staged files (npm run desktop:prepare)
 *   npm run desktop:test -- --packaged   # the built app in desktop/dist/*-unpacked (npm run desktop:dist)
 *
 * Linux needs a display: run it under `xvfb-run -a` on a headless machine. Exits non-zero on any failed check.
 */
/* global window, PP */ // page.evaluate() callbacks run inside the app's page
import { _electron as electron } from '@playwright/test';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DESKTOP = join(ROOT, 'desktop');
const packaged = process.argv.includes('--packaged');
const win = process.platform === 'win32';
// Ubuntu 24.04's AppArmor blocks Chromium's user-namespace sandbox for unpacked Electron binaries
const linuxArgs = process.platform === 'linux' ? ['--no-sandbox'] : [];

function launchOptions() {
  if (packaged) {
    const exe = win
      ? join(DESKTOP, 'dist', 'win-unpacked', 'PenPlot Studio.exe')
      : join(DESKTOP, 'dist', 'linux-unpacked', 'penplot-studio');
    if (!existsSync(exe)) throw new Error('Built app not found at ' + exe + ' - run `npm run desktop:dist` first.');
    return { executablePath: exe, args: linuxArgs };
  }
  if (!existsSync(join(DESKTOP, 'app', 'index.html')))
    throw new Error('Run `npm run desktop:prepare` first (stages the app files).');
  const electronPath = createRequire(join(DESKTOP, 'package.json'))('electron');
  return { executablePath: electronPath, args: [...linuxArgs, join(DESKTOP, 'main.js')], cwd: DESKTOP };
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' - ' + detail : ''));
};

const app = await electron.launch({ ...launchOptions(), timeout: 60_000 });
try {
  const page = await app.firstWindow();
  const problems = [];
  page.on('console', (m) => {
    // Electron's own dev-mode CSP notice is not an app problem
    if ((m.type() === 'error' || m.type() === 'warning') && !/Content-Security-Policy|Insecure Content/.test(m.text()))
      problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  await page.waitForFunction(() => window.PP && PP.App && PP.App.view && PP.Store.project.objects.length > 0, null, {
    timeout: 30_000,
  });

  check('loads app://penplot/index.html', page.url().startsWith('app://penplot/'), page.url());
  check('window title', (await page.title()) === 'PenPlot Studio', await page.title());

  const fonts = await page.evaluate(async () => {
    const r = await fetch('app://penplot/vendor/hersheytext/hersheytext.min.json');
    return { status: r.status, n: r.ok ? Object.keys(await r.json()).length : 0 };
  });
  check('vendored fonts load offline', fonts.status === 200 && fonts.n > 10, JSON.stringify(fonts));

  const sys = await page.evaluate(async () => {
    if (typeof window.queryLocalFonts !== 'function') return { api: false };
    const st = await navigator.permissions.query({ name: 'local-fonts' });
    const list = await window.queryLocalFonts();
    return { api: true, state: st.state, n: list.length };
  });
  check('installed fonts are available', sys.api && sys.state === 'granted' && sys.n > 0, JSON.stringify(sys));

  const storage = await page.evaluate(async () => {
    localStorage.setItem('pp.smoke', '1');
    await PP.Storage.set('smoke', { ok: true });
    return localStorage.getItem('pp.smoke') === '1' && (await PP.Storage.get('smoke')).ok === true;
  });
  check('localStorage and IndexedDB work', storage);

  const gcode = await page.evaluate(() => {
    const plan = PP.App.buildPlan();
    const P = plan.profile;
    const text = PP.GCode.build(plan.jobs, P, {}).text;
    const sim = PP.GSim.check(text, P, plan.jobs, { keepMoves: false });
    return { ok: sim.ok, errors: sim.errors.length, strokes: sim.stats.penDowns, pauses: sim.pauses.length };
  });
  check('welcome design builds G-code that passes the simulator', gcode.ok && gcode.strokes > 0, JSON.stringify(gcode));

  const isolated = await page.evaluate(() => typeof require === 'undefined' && typeof process === 'undefined');
  check('renderer has no Node access', isolated);

  await page.waitForTimeout(500);
  check('no console errors or page errors', problems.length === 0, problems.slice(0, 3).join(' | '));
} finally {
  await app.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(
  `\n${results.length - failed}/${results.length} checks passed (${packaged ? 'packaged app' : 'dev app'}, ${process.platform})`,
);
process.exit(failed ? 1 : 0);
