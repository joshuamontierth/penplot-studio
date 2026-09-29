// Runs the full in-browser suite (tests/index.html: simulator self-test, edge cases, every font,
// pattern, trace mode and calibration, seeded fuzz and editor-state fuzz) in real Chromium.
//   FUZZ_N    number of fuzz scenarios (default 60; the handoff's reference run used 200)
//   FUZZ_SEED fuzz seed (default 1)
import { test, expect } from './fixtures.js';

const n = Number(process.env.FUZZ_N ?? 60);
const seed = Number(process.env.FUZZ_SEED ?? 1);

test(`browser suite (fuzz n=${n}, seed=${seed})`, async ({ page, consoleProblems, externalRequests }, testInfo) => {
  // ~0.4 s per fuzz scenario plus ~40 s of fixed suites, with headroom for slow CI machines
  test.setTimeout((120 + n * 2) * 1000);
  await page.goto('/tests/');
  const result = await page.evaluate((opts) => window.runPenPlotTests(opts), { n, seed });
  await testInfo.attach('result.json', { body: JSON.stringify(result, null, 2), contentType: 'application/json' });
  console.log(
    `browser suite: ${result.pass} passed, ${result.fail} failed, ${result.stats.files} files, ` +
      `${result.stats.moves.toLocaleString()} moves, ${result.stats.strokes.toLocaleString()} strokes, ` +
      `${result.stats.drawM.toFixed(0)} m of line, ${result.secs.toFixed(1)} s`,
  );
  expect(result.failures, 'failed checks').toEqual([]);
  expect(result.fail).toBe(0);
  expect(result.pass).toBeGreaterThan(1000);
  expect(externalRequests, 'the suite must not need the network').toEqual([]);
  expect(consoleProblems).toEqual([]);
});
