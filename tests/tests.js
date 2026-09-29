/*
 * PenPlot Studio browser test runner (open tests/index.html via `npm start`, or run headless with
 * `npm run test:e2e`). The checks themselves live in harness.js, which the Node suites share.
 *
 * Programmatic use (Playwright, devtools):
 *   await runPenPlotTests({ n: 200, seed: 1 })  -> { pass, fail, failures, stats, secs }
 *   await replayScenario(<rng seed>)            -> { P, prefs, plan, res, sim, mismatch }
 */
(function () {
  'use strict';
  const T = PPTest, GC = PP.GCode;
  const logEl = document.getElementById('log');
  const sumEl = document.getElementById('summary');
  let R = null;

  function log(msg, cls) {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    d.textContent = msg;
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function mark(step) {
    try { localStorage.setItem('pp.testTrace', JSON.stringify({ step, at: new Date().toISOString() })); } catch (e) { /* ignore */ }
  }
  function updSummary(extra) {
    const { pass, fail, failures } = R;
    try { localStorage.setItem('pp.testSummary', JSON.stringify({ pass, fail, extra: extra || '', failures: failures.slice(0, 40) })); } catch (e) { /* ignore */ }
    sumEl.innerHTML = '<span class="pass">' + pass + ' passed</span> • <span class="' + (fail ? 'fail' : 'pass') + '">' + fail + ' failed</span>' + (extra ? ' • ' + extra : '');
  }

  async function runCases(title, cases, progress) {
    if (title) log(title, 'info');
    for (const c of cases) {
      try { c.run(); } catch (e) { R.ok(false, c.name + ' threw', e.stack); }
      if (progress) window.__progress = progress(c);
      await T.tick();
    }
    updSummary();
  }

  function drawSim(res) {
    const cv = document.getElementById('view');
    const ctx = cv.getContext('2d');
    const P = res.P, sim = res.sim;
    const k = Math.min(cv.width / P.bedWidth, cv.height / P.bedDepth) * 0.95;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(k, 0, 0, -k, (cv.width - P.bedWidth * k) / 2, (cv.height + P.bedDepth * k) / 2);
    ctx.fillStyle = '#eef0f3'; ctx.fillRect(0, 0, P.bedWidth, P.bedDepth);
    const Rr = GC.reachableRect(P);
    ctx.strokeStyle = '#10b981'; ctx.lineWidth = 0.5; ctx.setLineDash([2, 2]); ctx.strokeRect(Rr.minX, Rr.minY, Rr.maxX - Rr.minX, Rr.maxY - Rr.minY); ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(245,158,11,0.5)'; ctx.lineWidth = 0.2;
    ctx.beginPath();
    for (let i = 0; i < sim.travels.length; i += 4) { ctx.moveTo(sim.travels[i], sim.travels[i + 1]); ctx.lineTo(sim.travels[i + 2], sim.travels[i + 3]); }
    ctx.stroke();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 0.3;
    ctx.beginPath();
    for (const s of sim.strokes) { const p = s.pts; ctx.moveTo(p[0], p[1]); if (p.length === 2) ctx.lineTo(p[0] + 0.2, p[1]); for (let j = 2; j < p.length; j += 2) ctx.lineTo(p[j], p[j + 1]); }
    ctx.stroke();
  }

  /** opts: { n (fuzz scenarios), seed, stateOps } - defaults come from the page inputs. */
  async function runAll(opts) {
    opts = opts || {};
    window.__testResult = null;
    logEl.textContent = '';
    R = T.createRunner({ log, mark });
    const n = opts.n != null ? opts.n : parseInt(document.getElementById('n').value, 10) || 100;
    const seed = opts.seed != null ? opts.seed : parseInt(document.getElementById('seed').value, 10) || 1;
    const stateOps = opts.stateOps != null ? opts.stateOps : 400;
    const t0 = performance.now();
    log('Loading fonts...');
    const fonts = await T.loadFonts();
    for (const e of fonts.errors) log('font ' + e, 'fail');
    R.ok(fonts.loaded.length === fonts.ids.length, 'all ' + fonts.ids.length + ' fonts load', fonts.errors.join(' | '));
    const loaded = fonts.loaded;
    try {
      window.__progress = 'self-test';
      await runCases('== Simulator self-test (broken G-code must be caught) ==', R.simulatorCases());
      window.__progress = 'edge cases';
      await runCases('== Edge cases ==', R.edgeCases());
      window.__progress = 'coverage';
      await runCases('== Fonts ==', R.fontCases(loaded));
      await runCases('== Pattern generators (defaults, all-min, all-max) ==', R.patternCases(), c => 'pattern ' + c.generator);
      await runCases('== Image trace modes ==', R.traceCases());
      await PP.Fonts.load(PP.Fonts.DEFAULT);
      await runCases('== Calibration files ==', R.calibrationCases());
      log('== Fuzz: ' + n + ' random designs x profiles x settings (seed ' + seed + ') ==', 'info');
      for (let i = 0; i < n; i++) {
        R.fuzzCase(R.fuzzSeed(seed, i), loaded);
        updSummary('fuzz ' + (i + 1) + '/' + n);
        window.__progress = 'fuzz ' + (i + 1) + '/' + n;
        await T.tick();
      }
      log('== Editor state fuzz: ' + stateOps + ' random operations ==', 'info');
      await R.stateFuzz(stateOps, seed, loaded);
    } catch (e) {
      R.ok(false, 'test runner crashed', e.stack);
    }
    const { pass, fail, failures, stats } = R;
    const secs = (performance.now() - t0) / 1000;
    const extra = stats.files + ' G-code files simulated • ' + stats.moves.toLocaleString() + ' moves • ' + stats.strokes.toLocaleString() + ' strokes • ' + stats.drawM.toFixed(0) + ' m of line • ' + secs.toFixed(1) + ' s';
    updSummary(extra);
    log('');
    log((fail ? 'FAILED: ' + fail + ' check(s)' : 'ALL ' + pass + ' CHECKS PASSED') + ' - ' + extra, fail ? 'fail' : 'pass');
    const show = R.firstBad || R.lastGood;
    if (show) { drawSim(show); log('Canvas: ' + (R.firstBad ? 'first FAILING' : 'last passing') + ' file - ' + show.name + ' (black = pen strokes, orange = travel, green = drawable area)', 'info'); }
    window.__testResult = { pass, fail, failures: failures.slice(0, 80), stats: Object.assign({}, stats), secs };
    return window.__testResult;
  }

  /** Debug helper: rebuild one fuzz scenario by its rng seed (as printed in failures). */
  async function replay(s) {
    const fonts = await T.loadFonts();
    const res = T.createRunner().replay(s, fonts.loaded);
    drawSim({ P: res.P, sim: res.sim });
    return res;
  }

  document.getElementById('run').addEventListener('click', () => runAll());
  window.runPenPlotTests = runAll;
  window.replayScenario = replay;
  window.__testUtils = T;
})();
