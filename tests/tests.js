/*
 * PenPlot Studio test suite (runs in the browser: open tests/index.html via serve.py).
 *
 *  1. Simulator self-test   - deliberately broken G-code must be caught
 *  2. Directed edge cases    - empty designs, dots, NaN, huge coordinates, overrides...
 *  3. Every font / pattern / trace mode / calibration / offset finder
 *  4. Randomized fuzz        - random designs x random printer profiles x random
 *                              optimizer settings; every file is simulated and the
 *                              drawn strokes are compared with the plan and the design
 *  5. Editor state fuzz      - random edit operations, undo/redo, save/load
 */
(function () {
  'use strict';
  const U = PP.U, G = PP.Geo, S = PP.Store, OBJ = PP.Objects, GC = PP.GCode, SIM = PP.GSim, App = PP.App;
  const logEl = document.getElementById('log');
  const sumEl = document.getElementById('summary');
  let pass = 0, fail = 0;
  const failures = [];
  const stats = { files: 0, moves: 0, strokes: 0, drawM: 0, scenarios: 0, maxMs: 0 };
  let lastGood = null, firstBad = null;

  function log(msg, cls) {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    d.textContent = msg;
    logEl.appendChild(d);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function ok(cond, name, detail) {
    if (cond) { pass++; return true; }
    fail++;
    failures.push(name + (detail ? ': ' + detail : ''));
    log('FAIL ' + name + (detail ? ' - ' + detail : ''), 'fail');
    return false;
  }
  function updSummary(extra) {
    try { localStorage.setItem('pp.testSummary', JSON.stringify({ pass, fail, extra: extra || '', failures: failures.slice(0, 40) })); } catch (e) { /* ignore */ }
    sumEl.innerHTML = '<span class="pass">' + pass + ' passed</span> • <span class="' + (fail ? 'fail' : 'pass') + '">' + fail + ' failed</span>' + (extra ? ' • ' + extra : '');
  }
  // Yield to the event loop without timer throttling (background tabs clamp setTimeout)
  const chan = new MessageChannel();
  const waiters = [];
  chan.port1.onmessage = () => { const w = waiters.shift(); if (w) w(); };
  const tick = () => new Promise(r => { waiters.push(r); chan.port2.postMessage(0); });
  const clone = (o) => JSON.parse(JSON.stringify(o));

  const X1C = GC.BUILTIN_PROFILES.find(p => p.id === 'bambu-x1c');
  const P1S = GC.BUILTIN_PROFILES.find(p => p.id === 'bambu-p1s');
  const CUSTOM = GC.BUILTIN_PROFILES.find(p => p.id === 'custom');
  const PREFS = { simplify: 0.02, joinTol: 0.05, reorder: true, reverse: true, minLength: 0 };

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  function splitFinite(p) {
    const out = []; let cur = [];
    for (let j = 0; j + 1 < p.length; j += 2) {
      if (isFinite(p[j]) && isFinite(p[j + 1])) cur.push(p[j], p[j + 1]);
      else { if (cur.length >= 4) out.push(cur); cur = []; }
    }
    if (cur.length >= 4) out.push(cur);
    return out;
  }
  function thin(p, eps) {
    const out = [p[0], p[1]];
    for (let j = 2; j < p.length; j += 2) {
      if (Math.abs(p[j] - out[out.length - 2]) > eps || Math.abs(p[j + 1] - out[out.length - 1]) > eps) out.push(p[j], p[j + 1]);
    }
    return out;
  }
  /** The G-code must draw exactly the planned strokes (same order, same points). */
  function strokesMatchPlan(sim, jobs) {
    const plan = [];
    for (const j of jobs) for (const q of j.polys) if (q.length >= 4) plan.push(q);
    if (sim.strokes.length !== plan.length) return 'stroke count ' + sim.strokes.length + ' vs plan ' + plan.length;
    // Ordered alignment: every G-code point must match the next planned point (within the
    // 0.001 mm rounding of the file); planned points may only be skipped when they round
    // onto the previous G-code point.
    const TOL = 0.0016;
    const dmax = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
    for (let i = 0; i < plan.length; i++) {
      const a = thin(plan[i], 1e-9), b = sim.strokes[i].pts;
      const nb = b.length >> 1;
      let j = 0;
      for (let k = 0; k < a.length; k += 2) {
        const dNext = j < nb ? dmax(a[k], a[k + 1], b[j * 2], b[j * 2 + 1]) : Infinity;
        const dPrev = j > 0 ? dmax(a[k], a[k + 1], b[j * 2 - 2], b[j * 2 - 1]) : Infinity;
        if (dNext <= TOL && dNext <= dPrev) { j++; continue; }
        if (dPrev <= TOL) continue;
        return 'stroke ' + i + ': planned point ' + (k >> 1) + ' (' + a[k].toFixed(3) + ', ' + a[k + 1].toFixed(3) + ') not drawn';
      }
      if (j !== nb) return 'stroke ' + i + ': G-code has ' + (nb - j) + ' extra point(s)';
    }
    return null;
  }

  /** Spatial index of segments for distance queries (valid for tol <= 0.7 mm). */
  class SegIndex {
    constructor(polys) {
      this.cell = 1;
      this.map = new Map();
      const segs = [];
      for (const p of polys) {
        if (p.length === 2 || (p.length === 4 && p[0] === p[2] && p[1] === p[3])) { segs.push(p[0], p[1], p[0], p[1]); continue; }
        for (let j = 2; j < p.length; j += 2) segs.push(p[j - 2], p[j - 1], p[j], p[j + 1]);
      }
      this.segs = segs;
      for (let s = 0; s < segs.length; s += 4) {
        const x0 = segs[s], y0 = segs[s + 1], x1 = segs[s + 2], y1 = segs[s + 3];
        const L = Math.hypot(x1 - x0, y1 - y0);
        const n = Math.max(1, Math.ceil(L / 0.5));
        const seen = new Set();
        for (let i = 0; i <= n; i++) {
          const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
          const cx = Math.floor(x), cy = Math.floor(y);
          for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            const k = (cx + dx + 4000) * 10000 + (cy + dy + 4000);
            if (seen.has(k)) continue;
            seen.add(k);
            let arr = this.map.get(k);
            if (!arr) this.map.set(k, arr = []);
            arr.push(s);
          }
        }
      }
    }
    dist(x, y) {
      const arr = this.map.get((Math.floor(x) + 4000) * 10000 + (Math.floor(y) + 4000));
      if (!arr) return Infinity;
      let best = Infinity;
      const sg = this.segs;
      for (const s of arr) {
        const d = G.segDistSq(x, y, sg[s], sg[s + 1], sg[s + 2], sg[s + 3]);
        if (d < best) best = d;
      }
      return Math.sqrt(best);
    }
  }

  function samplePolys(polys, step, fn) {
    for (let pi = 0; pi < polys.length; pi++) {
      const p = polys[pi];
      fn(p[0], p[1], pi);
      for (let j = 2; j < p.length; j += 2) {
        const x0 = p[j - 2], y0 = p[j - 1], x1 = p[j], y1 = p[j + 1];
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
        for (let i = 1; i <= n; i++) fn(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, pi);
      }
    }
  }

  /**
   * Compare what the G-code draws with the design:
   *  coverage  - every part of the design inside the drawable area gets drawn
   *  precision - nothing is drawn that is not in the design
   */
  function fidelity(designPolys, R, strokes, prefs) {
    const clipped = G.clipToRect(designPolys.flatMap(splitFinite), R).polys;
    const drawn = strokes.map(s => s.pts);
    const total = G.totalLength(clipped) + G.totalLength(drawn);
    if (total > 120000) return { skipped: true, total, covMiss: 0, covWorst: 0, covPts: 0, precMiss: 0, precWorst: 0, precPts: 0 };
    const step = Math.max(0.5, total / 150000);
    const tolCov = (prefs.simplify || 0) + 0.02;
    const tolPrec = (prefs.simplify || 0) + (prefs.joinTol || 0) / 2 + 0.02;
    const edge = tolCov + 0.06;
    let covMiss = 0, covWorst = 0, covPts = 0, precMiss = 0, precWorst = 0, precPts = 0;
    if (clipped.length) {
      const di = new SegIndex(drawn);
      const minLen = prefs.minLength || 0;
      const skip = new Set();
      if (minLen > 0) clipped.forEach((p, i) => { const L = G.polyLength(p); if (L > 0 && L < minLen + tolCov) skip.add(i); });
      samplePolys(clipped, step, (x, y, pi) => {
        if (skip.has(pi)) return;
        if (x < R.minX + edge || x > R.maxX - edge || y < R.minY + edge || y > R.maxY - edge) return;
        covPts++;
        const d = di.dist(x, y);
        if (d > tolCov) { covMiss++; if (d > covWorst) covWorst = d; }
      });
    }
    if (drawn.length) {
      const ci = new SegIndex(clipped);
      samplePolys(drawn, step, (x, y) => {
        precPts++;
        const d = ci.dist(x, y);
        if (d > tolPrec) { precMiss++; if (d > precWorst) precWorst = d; }
      });
    }
    return { covMiss, covWorst, covPts, precMiss, precWorst, precPts };
  }

  function designPolys(layerFilter) {
    const out = [];
    for (const L of S.project.layers) {
      if (!L.visible || (layerFilter && !layerFilter(L))) continue;
      for (const o of S.project.objects) if (o.layerId === L.id) for (const q of OBJ.world(o).polys) out.push(q);
    }
    return out;
  }

  /** Full pipeline check for the current Store content. Returns the combined simulation. */
  function mark(step) {
    try { localStorage.setItem('pp.testTrace', JSON.stringify({ step, at: new Date().toISOString() })); } catch (e) { /* ignore */ }
  }

  function checkPipeline(name, profile, prefs, opts = {}) {
    const P = GC.normalizeProfile(profile);
    const R = GC.reachableRect(P);
    const t0 = performance.now();
    mark(name + ' :: plan');
    const plan = App.buildPlan({ profile: P, prefs });
    mark(name + ' :: build (' + plan.jobs.reduce((s, j) => s + j.polys.length, 0) + ' paths)');
    let planOk = true;
    for (const j of plan.jobs) for (const q of j.polys) {
      for (let k = 0; k < q.length; k += 2) {
        if (!isFinite(q[k]) || !isFinite(q[k + 1]) || q[k] < R.minX - 1e-6 || q[k] > R.maxX + 1e-6 || q[k + 1] < R.minY - 1e-6 || q[k + 1] > R.maxY + 1e-6) { planOk = false; break; }
      }
    }
    ok(planOk, name + ' plan inside drawable area');
    const res = GC.build(plan.jobs, P, { title: name });
    ok(!/NaN|undefined|Infinity/.test(res.text.split('\n').map(l => l.split(';')[0]).join('\n')), name + ' no invalid numbers in G-code');
    mark(name + ' :: simulate (' + res.stats.lines + ' lines)');
    const sim = SIM.check(res.text, P, plan.jobs);
    mark(name + ' :: compare');
    stats.files++; stats.moves += sim.stats.moves; stats.strokes += sim.stats.penDowns; stats.drawM += sim.stats.drawLen / 1000;
    if (!ok(sim.ok, name + ' simulation', sim.errors.map(SIM.fmtMsg).join(' | '))) { if (!firstBad) firstBad = { sim, P, name }; }
    else lastGood = { sim, P, name };
    const m = strokesMatchPlan(sim, plan.jobs);
    ok(m === null, name + ' G-code draws exactly the plan', m);
    if (opts.fidelity !== false) {
      mark(name + ' :: fidelity');
      const f = fidelity(designPolys(), R, sim.strokes, prefs);
      if (f.skipped) { stats.fidelitySkipped = (stats.fidelitySkipped || 0) + 1; log('   ' + name + ': fidelity skipped (' + (f.total / 1000).toFixed(0) + ' m of line)'); }
      ok(f.covMiss === 0, name + ' coverage (design fully drawn)', f.covMiss + '/' + f.covPts + ' samples missed, worst ' + f.covWorst.toFixed(3) + ' mm');
      ok(f.precMiss === 0, name + ' precision (nothing extra drawn)', f.precMiss + '/' + f.precPts + ' samples off-design, worst ' + f.precWorst.toFixed(3) + ' mm');
    }
    // dry run
    const dry = GC.build(plan.jobs, P, { dryRun: true });
    const dsim = SIM.check(dry.text, P, plan.jobs, { dryRun: true, keepMoves: false });
    ok(dsim.ok && dsim.strokes.length === 0, name + ' dry run', dsim.errors.map(SIM.fmtMsg).join(' | '));
    // one file per layer
    if (plan.jobs.length > 1) {
      plan.jobs.forEach((j, i) => {
        const r1 = GC.build([j], P, {});
        const s1 = SIM.check(r1.text, P, [j], { keepMoves: false });
        ok(s1.ok, name + ' layer file ' + (i + 1), s1.errors.map(SIM.fmtMsg).join(' | '));
      });
    }
    stats.maxMs = Math.max(stats.maxMs, performance.now() - t0);
    return { plan, sim, res };
  }

  // ---------------------------------------------------------------------------
  // Random design generation
  // ---------------------------------------------------------------------------
  const TEXTS = ['Hello', 'Happy Birthday!\nLove, J', 'ÀÉÎõü ñ ß', '', '   ', 'Tab\there', '0123456789 !@#$%^&*()_+-=[]{}', 'Emoji 😀 test',
    'A long line of text that keeps going and going past the edge of the paper', 'a\n\n\nb', 'The quick brown fox jumps over the lazy dog'];
  const SVGS = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="60mm" viewBox="0 0 100 60"><rect x="5" y="5" width="40" height="30" rx="4" fill="none" stroke="#f00"/><circle cx="70" cy="30" r="20" fill="#00f"/><path d="M5 50 C 30 70 60 30 95 50" stroke="#000" fill="none"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><g transform="rotate(15 200 150) scale(1.2)"><polygon points="50,50 150,20 250,90 180,200 60,180"/><polyline points="10,10 20,40 30,10 40,40" stroke="green" fill="none"/><ellipse cx="300" cy="200" rx="60" ry="30" stroke="#123456" fill="none"/></g><path d="M10 250 a30 20 0 1 0 60 0 a30 20 0 1 0 -60 0 Z m 100 0 h50 v-30 h-50 z" stroke="black"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="4in" height="3in" viewBox="0 0 40 30"><defs><path id="s" d="M0 0 L5 0 L2.5 4 Z"/></defs><use xlink:href="#s" x="5" y="5"/><use href="#s" x="20" y="10" transform="scale(1.5)"/><line x1="0" y1="29" x2="40" y2="29" stroke="#000"/><path d="M1e1,1e1 q5 -8 10 0 t10 0" stroke="#000" fill="none"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><path d="M 1 1 L NaN 5 L 8 8"/><path d=""/><circle r="-3"/><text x="1" y="1">skip me</text></svg>',
  ];
  let traceImages = null;
  function getTraceImages() {
    if (traceImages) return traceImages;
    const c = document.createElement('canvas'); c.width = 320; c.height = 220;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(160, 110, 10, 160, 110, 200); g.addColorStop(0, '#fff'); g.addColorStop(1, '#111');
    x.fillStyle = g; x.fillRect(0, 0, 320, 220);
    x.fillStyle = '#000'; x.beginPath(); x.arc(120, 110, 60, 0, 7); x.fill();
    x.fillStyle = '#fff'; x.font = 'bold 60px sans-serif'; x.fillText('Hi', 170, 140);
    x.strokeStyle = '#000'; x.lineWidth = 4; x.beginPath(); x.moveTo(10, 200); x.bezierCurveTo(100, 150, 200, 250, 310, 180); x.stroke();
    traceImages = x.getImageData(0, 0, 320, 220);
    return traceImages;
  }

  function randParams(rng, params, sizeCap) {
    const out = {};
    for (const p of params) {
      if (p.type === 'select') out[p.key] = p.options[Math.floor(rng() * p.options.length)].value;
      else if (p.type === 'checkbox') out[p.key] = rng() < 0.5;
      else if (p.type === 'seed') out[p.key] = Math.floor(rng() * 99999);
      else if (p.type === 'int') out[p.key] = Math.round(p.min + rng() * (p.max - p.min));
      else if (p.type === 'range') out[p.key] = p.min + rng() * (p.max - p.min);
      if (sizeCap && (p.key === 'size' || p.key === 'width' || p.key === 'height')) out[p.key] = Math.min(out[p.key], sizeCap);
    }
    return out;
  }

  function randomObject(rng, fonts) {
    const r = rng();
    const rnd = (a, b) => a + rng() * (b - a);
    const pick = (a) => a[Math.floor(rng() * a.length)];
    let o;
    if (r < 0.22) {
      o = OBJ.create.text({ text: pick(TEXTS), font: pick(fonts), size: rnd(1, 40), letterSpacing: rnd(-2, 5), lineSpacing: rnd(0.5, 2.5), align: pick(['left', 'center', 'right']), arc: rng() < 0.25 ? (rng() < 0.5 ? -1 : 1) * rnd(5, 250) : 0 });
    } else if (r < 0.42) {
      o = OBJ.create.shape(pick(['rect', 'ellipse', 'polygon', 'star']), { w: rnd(0.5, 160), h: rnd(0.5, 160), radius: rnd(0, 30), sides: Math.round(rnd(3, 14)), points: Math.round(rnd(3, 14)), inner: rnd(0.1, 0.9) });
    } else if (r < 0.66) {
      const g = pick(PP.Patterns.list);
      o = OBJ.create.pattern(g.id, randParams(rng, g.params, rng() < 0.7 ? 150 : 0));
    } else if (r < 0.82) {
      const polys = [];
      const n = 1 + Math.floor(rng() * 6);
      for (let i = 0; i < n; i++) {
        const kind = rng();
        if (kind < 0.15) { const x = rnd(-50, 50), y = rnd(-50, 50); polys.push([x, y, x, y]); }
        else if (kind < 0.25) { const x = rnd(-50, 50); polys.push([x, 1, x, 1, x, 1, x + 5, 1, x + 5, 1]); }
        else {
          const pts = []; let x = rnd(-50, 50), y = rnd(-50, 50);
          const m = 2 + Math.floor(rng() * 300);
          for (let k = 0; k < m; k++) { pts.push(x, y); x += rnd(-3, 3); y += rnd(-3, 3); }
          if (rng() < 0.04) pts.splice(2 * Math.floor(m / 2), 0, NaN, NaN);
          polys.push(pts);
        }
      }
      o = OBJ.create.path(polys, { name: 'random path' });
    } else if (r < 0.9) {
      const res = PP.SVG.importSVG(pick(SVGS));
      const polys = res.groups.flatMap(g => g.polys);
      o = polys.length ? OBJ.create.path(polys, { name: 'svg' }) : OBJ.create.shape('rect', { w: 10, h: 10 });
    } else {
      const IT = PP.ImageTrace;
      const m = pick(IT.modes);
      const gray = IT.toGray(getTraceImages(), { brightness: rnd(-0.3, 0.3), contrast: rnd(-0.3, 0.5), gamma: rnd(0.6, 1.8), blur: rnd(0, 2), invert: rng() < 0.2 });
      const params = Object.assign(IT.defaults(m.id), rng() < 0.6 ? {} : randParams(rng, m.params.filter(p => !/count|levels/i.test(p.key))));
      const mmPerPx = rnd(0.15, 0.5);
      const px = IT.trace(gray, m.id, params, { mmPerPx });
      const mm = px.map(p => p.map((v, i) => (i % 2 ? -v : v) * mmPerPx));
      o = mm.length ? OBJ.create.path(mm, { name: 'trace ' + m.id }) : OBJ.create.shape('ellipse', { w: 20, h: 20 });
    }
    if (o.type === 'shape' || o.type === 'text' || rng() < 0.15) {
      if (rng() < 0.35) o.fill = { enabled: true, spacing: rnd(0.25, 3), angle: rnd(-90, 90), cross: rng() < 0.3, outline: rng() < 0.8 };
    }
    const s = Math.exp(rnd(Math.log(0.05), Math.log(2.5)));
    o.x = rnd(-60, 320); o.y = rnd(-60, 320);
    o.rotation = rnd(-180, 180);
    o.scaleX = s * (rng() < 0.2 ? -1 : 1);
    o.scaleY = (rng() < 0.3 ? s * rnd(0.3, 2) : s) * (rng() < 0.1 ? -1 : 1);
    if (rng() < 0.3) { o.x = rnd(40, 200); o.y = rnd(40, 200); o.scaleX = Math.sign(o.scaleX) * Math.min(Math.abs(o.scaleX), 1); o.scaleY = Math.sign(o.scaleY) * Math.min(Math.abs(o.scaleY), 1); }
    return o;
  }

  function buildScene(rng, fonts, P) {
    S.reset();
    const nL = 1 + Math.floor(rng() * 3);
    for (let i = 1; i < nL; i++) S.addLayer();
    S.project.layers.forEach(L => {
      if (rng() < 0.3) L.zDraw = P.zDraw + (rng() * 12 - 5); // may be out of range -> must be clamped
      if (rng() < 0.2) L.speed = 5 + rng() * 150;
      if (rng() < 0.08) L.visible = false;
    });
    const objs = [];
    const n = 1 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) {
      const o = randomObject(rng, fonts);
      o.layerId = S.project.layers[Math.floor(rng() * S.project.layers.length)].id;
      objs.push(o);
    }
    S.add(objs, { history: false });
  }

  function randomProfile(rng) {
    const r = rng();
    if (r < 0.45) return clone(X1C);
    if (r < 0.52) return clone(P1S);
    if (r < 0.6) return clone(CUSTOM);
    const rnd = (a, b) => a + rng() * (b - a);
    for (let tries = 0; tries < 40; tries++) {
      const p = clone(rng() < 0.7 ? X1C : CUSTOM);
      p.name = 'random';
      p.penOffsetX = rnd(-45, 45); p.penOffsetY = rnd(-45, 45); p.margin = rnd(0, 8);
      const W = p.bedWidth, D = p.bedDepth;
      p.nozzleMinX = rnd(0, 60); p.nozzleMaxX = rnd(W - 70, W); p.nozzleMinY = rnd(0, 70); p.nozzleMaxY = rnd(D - 70, D);
      p.zDraw = rnd(2, 25); p.zLift = p.zDraw + rnd(1, 10); p.zAttach = Math.min(240, p.zLift + rnd(0, 60)); p.zEnd = Math.min(240, p.zLift + rnd(0, 80));
      p.drawSpeed = rnd(5, 150); p.travelSpeed = rnd(50, 450); p.zSpeed = rnd(3, 25); p.accel = rng() < 0.2 ? 0 : rnd(500, 10000);
      p.penDownDelay = rng() < 0.3 ? 0 : rnd(0, 300); p.penUpDelay = rng() < 0.7 ? 0 : rnd(0, 100);
      p.pauseForAttach = rng() < 0.9; p.layerPause = rng() < 0.8; p.endPause = rng() < 0.6; p.safeStart = rng() < 0.6; p.progress = rng() < 0.8;
      if (rng() < 0.3) { p.firmware = 'marlin'; p.pauseCommand = 'M0 Attach pen'; } else { p.firmware = 'bambu'; p.pauseCommand = 'M400 U1'; }
      const inZone = () => [rnd(p.nozzleMinX, p.nozzleMaxX), rnd(p.nozzleMinY, p.nozzleMaxY)];
      [p.parkX, p.parkY] = inZone();
      [p.endX, p.endY] = inZone();
      if (GC.validateProfile(GC.normalizeProfile(p)).length === 0) return p;
    }
    return clone(X1C);
  }

  function randomPrefs(rng) {
    if (rng() < 0.4) return clone(PREFS);
    return { simplify: rng() < 0.3 ? 0 : rng() * 0.3, joinTol: rng() < 0.2 ? 0 : rng() * 0.5, reorder: rng() < 0.85, reverse: rng() < 0.8, minLength: rng() < 0.7 ? 0 : rng() * 1 };
  }

  // ---------------------------------------------------------------------------
  // 1. Simulator self-test: broken files must be rejected
  // ---------------------------------------------------------------------------
  function simulatorSelfTest() {
    log('== Simulator self-test (broken G-code must be caught) ==', 'info');
    S.reset();
    S.add([OBJ.create.shape('rect', { x: 120, y: 120, w: 40, h: 30 }), OBJ.create.shape('ellipse', { x: 150, y: 90, w: 20, h: 20 })], { history: false });
    const P = GC.normalizeProfile(X1C);
    const plan = App.buildPlan({ profile: P, prefs: PREFS });
    const good = GC.build(plan.jobs, P, {}).text;
    const base = SIM.check(good, P, plan.jobs);
    ok(base.ok, 'self-test baseline file is valid', base.errors.map(SIM.fmtMsg).join(' | '));
    const lines = good.split('\n');
    const idx = (re, from = 0) => { for (let i = from; i < lines.length; i++) if (re.test(lines[i])) return i; return -1; };
    const firstDown = idx(/; pen down/);
    const firstUpAfter = idx(/; pen up$/, firstDown);
    const pauseAt = idx(/^M400 U1/);
    const mutations = [
      ['missing attach pause', (l) => { l.splice(pauseAt, 1); }, ['home-attached', 'pause-count', 'no-attach-pause']],
      ['missing pen lift before travel', (l) => { l.splice(firstUpAfter, 1); }, ['stroke-count', 'draw-length', 'z-while-down', 'draw-out']],
      ['pen pushed into the bed', (l) => { l[firstDown] = l[firstDown].replace(/Z[\d.]+/, 'Z6'); }, ['z-too-low']],
      ['nozzle into the excluded zone', (l) => { l.splice(firstDown - 1, 0, 'G1 X10 Y10 F12000'); }, ['xy-limit']],
      ['pen/holder off the plate', (l) => { l.splice(firstDown - 1, 0, 'G1 X10 Y200 F12000'); }, ['holder-out', 'xy-limit']],
      ['hotend heating', (l) => { l.splice(5, 0, 'M104 S220'); }, ['heater']],
      ['extrusion', (l) => { l.splice(firstDown + 2, 0, 'G1 X130 Y130 E2'); }, ['extrude']],
      ['NaN coordinate', (l) => { l[firstDown + 2] = 'G1 XNaN Y100'; }, ['bad-number', 'parse']],
      ['undefined coordinate', (l) => { l[firstDown + 2] = 'G1 X100 Yundefined'; }, ['bad-number', 'parse']],
      ['homing with pen attached', (l) => { l.splice(pauseAt + 2, 0, 'G28'); }, ['home-attached']],
      ['diagonal pen-down move', (l) => { l[firstDown] = 'G1 X140 Y140 Z14 F900'; }, ['diagonal']],
      ['file ends with pen down', (l) => { const i = l.lastIndexOf('G1 Z20 F900 ; pen up'); l.splice(i); }, ['end-pen-down']],
      ['pause without bed clearance', (l) => { const i = idx(/lower the bed for pen clearance/); l[i] = 'G1 Z20 F900'; }, ['pause-clearance']],
      ['no feed rate', (l) => { for (let i = 0; i < pauseAt; i++) l[i] = l[i].replace(/ F\d+/, ''); }, ['no-feed']],
      ['end pause without clearance', (l) => { const i = idx(/remove the pen holder now/); l.splice(i, 0, 'G1 Z25 F900'); }, ['pause-clearance']],
      ['inch units', (l) => { l.splice(3, 0, 'G20'); }, ['inches']],
      ['coordinate reset', (l) => { l.splice(firstDown, 0, 'G92 X0 Y0'); }, ['g92']],
      ['Z below plate', (l) => { l.splice(firstDown - 1, 0, 'G1 Z0.1 F600'); }, ['z-crash', 'z-too-low']],
      ['motors disabled mid-plot', (l) => { l.splice(firstDown, 0, 'M84'); }, ['steppers-off']],
      ['XY scrape at Z0 after homing', (l) => { const i = idx(/^G28/); l.splice(i + 1, 0, 'G1 X100 Y100 F6000'); }, ['scrape']],
    ];
    for (const [name, fn, codes] of mutations) {
      const l = lines.slice();
      fn(l);
      const r = SIM.check(l.join('\n'), P, plan.jobs);
      const got = r.errors.map(e => e.code);
      ok(!r.ok && codes.some(c => got.includes(c)), 'simulator catches: ' + name, 'got [' + got.join(', ') + '] expected one of [' + codes.join(', ') + ']');
    }
    // config-level problems
    const bad = Object.assign(clone(X1C), { zLift: 14.5 });
    ok(!SIM.simulate(good, bad).ok, 'simulator catches: Z-Lift too close to Z-Draw');
    ok(!SIM.simulate(good, P, { drawZs: [21] }).ok, 'simulator catches: pen-down height above Z-Lift');
  }

  // ---------------------------------------------------------------------------
  // 2. Directed edge cases
  // ---------------------------------------------------------------------------
  function edgeCases() {
    log('== Edge cases ==', 'info');
    const P = X1C;
    S.reset();
    let r = checkPipeline('empty design', P, PREFS);
    ok(r.plan.jobs.length === 0 && r.sim.strokes.length === 0, 'empty design has no strokes');

    S.reset();
    S.add(OBJ.create.path([[150, 100, 150, 100]], { name: 'dot' }), { history: false });
    r = checkPipeline('single dot', P, PREFS);
    ok(r.sim.strokes.length === 1 && r.sim.strokes[0].pts.length === 2, 'single dot = one pen-down, no XY', JSON.stringify(r.sim.strokes.map(s => s.pts.length)));

    S.reset();
    S.add(OBJ.create.shape('rect', { x: -500, y: 900, w: 50, h: 50 }), { history: false });
    r = checkPipeline('object fully outside', P, PREFS);
    ok(r.sim.strokes.length === 0 && r.plan.clipped, 'object outside the drawable area is not drawn');

    S.reset();
    S.add(OBJ.create.shape('rect', { x: 128, y: 128, w: 1000, h: 1000 }), { history: false });
    r = checkPipeline('object larger than the bed', P, PREFS);
    ok(r.sim.strokes.length === 0, 'a frame bigger than the bed draws nothing');

    S.reset();
    S.add(OBJ.create.path([[100, 100, NaN, 5, 120, 120, 130, 100, Infinity, 3, 140, 140, 150, 100]], { name: 'nan' }), { history: false });
    r = checkPipeline('NaN / Infinity in path data', P, PREFS, { fidelity: true });
    ok(r.sim.strokes.length >= 2, 'NaN points split the path instead of breaking the file');

    S.reset();
    S.add(OBJ.create.path([[1e9, 1e9, -1e9, -1e9], [120, 120, 1e7, 120]], { name: 'huge' }), { history: false });
    r = checkPipeline('huge coordinates', P, PREFS);

    S.reset();
    const zs = Object.assign(OBJ.create.shape('star', { x: 150, y: 120, w: 40, h: 40 }), { scaleX: 0, scaleY: 0 });
    S.add(zs, { history: false });
    checkPipeline('zero-scale object', P, PREFS);

    S.reset();
    const dots = [];
    const rng = U.mulberry32(9);
    for (let i = 0; i < 30000; i++) { const x = 30 + rng() * 190, y = 25 + rng() * 190; dots.push([x, y, x + 0.2, y]); }
    S.add(OBJ.create.path(dots, { name: 'stipple' }), { history: false });
    const t0 = performance.now();
    r = checkPipeline('30,000 short strokes', P, PREFS);
    log('   30k strokes: ' + Math.round(performance.now() - t0) + ' ms end to end, ' + (r.res.text.length / 1e6).toFixed(1) + ' MB of G-code');

    // layer overrides outside the safe window are clamped
    S.reset();
    S.addLayer(); S.addLayer();
    S.project.layers[0].zDraw = 40;   // above Z-Lift
    S.project.layers[1].zDraw = 1;    // far below Z-Draw
    S.project.layers[2].speed = 999;
    S.project.layers.forEach((L, i) => S.add(OBJ.create.shape('ellipse', { x: 80 + i * 40, y: 120, w: 30, h: 30, layerId: L.id }), { history: false, layerId: L.id }));
    r = checkPipeline('out-of-range layer overrides', P, PREFS);
    ok(r.res.warnings.length >= 2, 'override clamping is reported', r.res.warnings.join(' | '));
    ok(r.sim.pauses.length === 1 + 2 + 1, 'pauses: attach + 2 pen changes + removal', String(r.sim.pauses.map(p => p.action)));
    ok(r.sim.stats.minDrawZ >= GC.minSafeDrawZ(GC.normalizeProfile(P)) - 1e-9, 'lowest pen-down Z stays in the safe window', String(r.sim.stats.minDrawZ));

    // no reorder / no reverse / big join tolerance
    S.reset();
    S.add([OBJ.create.pattern('hilbert', { order: 5, size: 120 }, { x: 125, y: 120 }), OBJ.create.text({ text: 'ORDER', x: 125, y: 40, size: 10 })], { history: false });
    checkPipeline('no reordering', P, { simplify: 0, joinTol: 0, reorder: false, reverse: false, minLength: 0 });
    checkPipeline('large join tolerance', P, { simplify: 0.1, joinTol: 0.5, reorder: true, reverse: true, minLength: 0.5 });

    // every built-in profile with the same design
    for (const bp of GC.BUILTIN_PROFILES) checkPipeline('profile ' + bp.name, bp, PREFS);
  }

  // ---------------------------------------------------------------------------
  // 3. Fonts, patterns, trace modes, calibrations
  // ---------------------------------------------------------------------------
  async function coverageTests(fonts) {
    log('== Fonts ==', 'info');
    const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
    for (const id of fonts) {
      let r;
      try { r = PP.Fonts.layout(ascii + '\néñü', id, { size: 5 }); } catch (e) { ok(false, 'font ' + id, e.message); continue; }
      ok(r.ready && r.polys.length > 20 && r.polys.every(p => p.length >= 4 && p.every(isFinite)), 'font ' + id + ' renders all ASCII', r.polys.length + ' strokes');
    }
    S.reset();
    S.add(fonts.slice(0, 12).map((id, i) => OBJ.create.text({ text: 'Font ' + i + ' Ag', font: id, size: 6, x: 70 + (i % 3) * 60, y: 40 + Math.floor(i / 3) * 40, align: 'center' })), { history: false });
    checkPipeline('text in 12 fonts', X1C, PREFS);
    await tick();

    log('== Pattern generators (defaults, all-min, all-max) ==', 'info');
    for (const g of PP.Patterns.list) {
      for (const which of ['default', 'min', 'max']) {
        const params = {};
        if (which !== 'default') for (const p of g.params) {
          if (p.type === 'int' || p.type === 'range') params[p.key] = which === 'min' ? p.min : p.max;
          if (p.type === 'select') params[p.key] = p.options[which === 'min' ? 0 : p.options.length - 1].value;
          if (p.type === 'checkbox') params[p.key] = which === 'max';
        }
        S.reset();
        mark('pattern ' + g.id + ' ' + which);
        S.add(OBJ.create.pattern(g.id, params, { x: 125, y: 120 }), { history: false });
        const o = S.project.objects[0];
        const w = OBJ.world(o);
        ok(w.polys.length > 0 && w.polys.every(p => p.length >= 4 && p.every(isFinite)), 'pattern ' + g.id + ' ' + which + ' geometry', w.polys.length + ' paths');
        if (which !== 'max') checkPipeline('pattern ' + g.id + ' ' + which, X1C, PREFS, { fidelity: which === 'default' });
        await tick();
      }
      window.__progress = 'pattern ' + g.id;
    }

    log('== Image trace modes ==', 'info');
    const IT = PP.ImageTrace;
    const gray = IT.toGray(getTraceImages(), {});
    for (const m of IT.modes) {
      const px = IT.trace(gray, m.id, IT.defaults(m.id), { mmPerPx: 0.4 });
      const mm = px.map(p => p.map((v, i) => (i % 2 ? -v : v) * 0.4));
      S.reset();
      if (mm.length) S.add(OBJ.create.path(mm, { x: 125, y: 120 }), { history: false });
      S.project.objects.forEach(o => { o.x = 125; o.y = 120; });
      ok(mm.length > 0, 'trace ' + m.id + ' produces paths', mm.length + ' paths');
      checkPipeline('trace ' + m.id, X1C, PREFS);
      await tick();
    }

    log('== Calibration files ==', 'info');
    await PP.Fonts.load(PP.Fonts.DEFAULT);
    for (const bp of GC.BUILTIN_PROFILES) {
      const P = GC.normalizeProfile(bp);
      for (const type of ['grid', 'compact', 'frame']) {
        let cal;
        const zValues = [P.zDraw - 2, P.zDraw - 1, P.zDraw, P.zDraw + 1, P.zDraw + 2, P.zDraw + 3, P.zDraw + 9];
        try { cal = GC.calibrationJobs(P, { type, zValues, speeds: [20, 40, 60], cell: 14 }); }
        catch (e) { ok(/does not fit/.test(e.message), 'calibration ' + type + ' on ' + bp.name + ' (too big is reported)', e.message); continue; }
        const res = GC.build(cal.jobs, P, {});
        const sim = SIM.check(res.text, P, cal.jobs);
        ok(sim.ok, 'calibration ' + type + ' on ' + bp.name, sim.errors.map(SIM.fmtMsg).join(' | '));
        ok(strokesMatchPlan(sim, cal.jobs) === null, 'calibration ' + type + ' strokes match', strokesMatchPlan(sim, cal.jobs));
        if (type !== 'frame') ok(sim.stats.maxZ <= P.zMax + 1e-6 && sim.stats.minDrawZ >= GC.minSafeDrawZ(P) - 1e-6 && sim.stats.minDrawZ >= 0.5, 'calibration ' + type + ' Z range safe on ' + bp.name, 'pen-down min ' + sim.stats.minDrawZ + ', max Z ' + sim.stats.maxZ);
      }
      const of = GC.offsetFinder(P);
      const s = SIM.simulate(of.text, P, { expectedPauses: 3 });
      ok(s.ok && s.strokes.length === 3, 'offset finder on ' + bp.name, s.errors.map(SIM.fmtMsg).join(' | ') + ' strokes=' + s.strokes.length);
      ok(s.pauses.map(p => p.action).join(',') === 'attach,remove,inspect', 'offset finder pause sequence on ' + bp.name, s.pauses.map(p => p.action).join(','));
    }
  }

  // ---------------------------------------------------------------------------
  // 4. Randomized fuzz
  // ---------------------------------------------------------------------------
  async function fuzz(n, seed, fonts) {
    log('== Fuzz: ' + n + ' random designs x profiles x settings (seed ' + seed + ') ==', 'info');
    for (let i = 0; i < n; i++) {
      const s = seed * 100000 + i;
      const rng = U.mulberry32(s);
      const prof = randomProfile(rng);
      const prefs = randomPrefs(rng);
      const P = GC.normalizeProfile(prof);
      const before = fail;
      try {
        mark('fuzz #' + i + ' seed ' + s + ' :: buildScene');
        buildScene(rng, fonts, P);
        mark('fuzz #' + i + ' seed ' + s + ' :: scene built: ' + S.project.objects.map(o => o.type + (o.generator ? ':' + o.generator : '') + (o.type === 'text' ? ':' + o.font + ':arc' + Math.round(o.arc || 0) : '') + (o.fill && o.fill.enabled ? ':fill' + o.fill.spacing.toFixed(2) : '') + ':s' + Math.abs(o.scaleX).toFixed(2)).join(','));
        for (const o of S.project.objects) { mark('fuzz #' + i + ' seed ' + s + ' :: world ' + o.type + ' ' + (o.generator || o.font || '') + ' ' + JSON.stringify(o.params || o.fill || {}).slice(0, 300)); OBJ.world(o); }
        checkPipeline('fuzz #' + i + ' (seed ' + s + ', ' + (prof.name || prof.id) + ')', prof, prefs);
      } catch (e) {
        ok(false, 'fuzz #' + i + ' (seed ' + s + ') threw', e.stack);
      }
      stats.scenarios++;
      if (fail > before) log('   scenario ' + i + ': objects=' + S.project.objects.map(o => o.type + (o.generator ? ':' + o.generator : '')).join(',') + ' prefs=' + JSON.stringify(prefs), 'fail');
      updSummary('fuzz ' + (i + 1) + '/' + n);
      window.__progress = 'fuzz ' + (i + 1) + '/' + n;
      await tick();
    }
  }

  // ---------------------------------------------------------------------------
  // 5. Editor state fuzz
  // ---------------------------------------------------------------------------
  async function stateFuzz(n, seed, fonts) {
    log('== Editor state fuzz: ' + n + ' random operations ==', 'info');
    const rng = U.mulberry32(seed + 424242);
    S.reset();
    const pick = (a) => a[Math.floor(rng() * a.length)];
    const ops = [
      () => S.add(randomObject(rng, fonts)),
      () => { const o = pick(S.project.objects); if (o) S.update(o.id, { x: o.x + rng() * 20 - 10, rotation: rng() * 360 - 180 }); },
      () => { const o = pick(S.project.objects); if (o) S.remove(o.id); },
      () => S.undo(), () => S.undo(), () => S.redo(),
      () => { const o = pick(S.project.objects); if (o) { S.select(o.id); App.ops.mirror(rng() < 0.5 ? 'x' : 'y'); } },
      () => { S.select(S.project.objects.map(o => o.id)); App.ops.rotateBy(pick([90, -90, 180, 17])); },
      () => { S.select(S.project.objects.map(o => o.id)); App.ops.align('center', 'drawable'); },
      () => { S.select(S.project.objects.filter(() => rng() < 0.5).map(o => o.id)); App.ops.fit(10); },
      () => { const o = pick(S.project.objects); if (o) { S.select(o.id); App.ops.toPath(); } },
      () => { S.select(S.project.objects.filter(() => rng() < 0.5).map(o => o.id)); App.ops.combine(); },
      () => { if (S.project.objects.length > 12) return; S.select(S.project.objects.map(o => o.id)); App.ops.duplicate(); },
      () => { if (S.project.objects.length > 12) return; S.select(S.project.objects.map(o => o.id)); App.ops.copy(); App.ops.paste(); },
      () => { const o = pick(S.project.objects); if (!o) return; const w = OBJ.world(o); const b = w.bbox; if (!b) return; const res = G.eraseCircle(w.polys, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 5); if (res.changed) { const c = G.center(res.polys); if (res.polys.length) S.replace(o.id, Object.assign(OBJ.toPath(o), { paths: c.polys, x: c.cx, y: c.cy })); else S.remove(o.id); } },
      () => S.addLayer(),
      () => { const L = pick(S.project.layers); if (L) S.removeLayer(L.id); },
      () => { const L = pick(S.project.layers); if (L) S.moveLayer(L.id, rng() < 0.5 ? -1 : 1); },
      () => { const L = pick(S.project.layers); if (L) S.updateLayer(L.id, { visible: rng() < 0.7, locked: rng() < 0.2 }); },
      () => { const o = pick(S.project.objects); if (o) { S.select(o.id); App.ops.moveToLayer(pick(S.project.layers).id); } },
      () => { const data = JSON.parse(JSON.stringify(S.serialize())); S.load(data); },
      () => S.setPaper({ preset: 'a5', w: 148, h: 210, x: rng() * 50, y: rng() * 50 }),
    ];
    let threw = 0;
    for (let i = 0; i < n; i++) {
      try {
        if (S.project.objects.length > 30) S.remove(S.project.objects.slice(30).map(o => o.id));
        const opIndex = Math.floor(rng() * ops.length);
        mark('state op ' + i + ' #' + opIndex + ' (' + S.project.objects.length + ' objects)');
        ops[opIndex]();
        const ids = new Set(S.project.layers.map(l => l.id));
        const bad = S.project.objects.filter(o => !ids.has(o.layerId));
        if (bad.length) { ok(false, 'state op ' + i + ' left objects on a deleted layer'); break; }
        if (!S.selection.every(id => S.get(id))) { ok(false, 'state op ' + i + ' left a dangling selection'); break; }
        if (!S.project.layers.length) { ok(false, 'state op ' + i + ' removed the last layer'); break; }
      } catch (e) { threw++; ok(false, 'state op ' + i + ' threw', e.stack); if (threw > 3) break; }
      if (i % 25 === 24) await tick();
    }
    ok(threw === 0, 'editor state fuzz: ' + n + ' operations without exceptions');
    checkPipeline('design after state fuzz', X1C, PREFS);
  }

  // ---------------------------------------------------------------------------
  function drawSim(res) {
    const cv = document.getElementById('view');
    const ctx = cv.getContext('2d');
    const P = res.P, sim = res.sim;
    const k = Math.min(cv.width / P.bedWidth, cv.height / P.bedDepth) * 0.95;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(k, 0, 0, -k, (cv.width - P.bedWidth * k) / 2, (cv.height + P.bedDepth * k) / 2);
    ctx.fillStyle = '#eef0f3'; ctx.fillRect(0, 0, P.bedWidth, P.bedDepth);
    const R = GC.reachableRect(P);
    ctx.strokeStyle = '#10b981'; ctx.lineWidth = 0.5; ctx.setLineDash([2, 2]); ctx.strokeRect(R.minX, R.minY, R.maxX - R.minX, R.maxY - R.minY); ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(245,158,11,0.5)'; ctx.lineWidth = 0.2;
    ctx.beginPath();
    for (let i = 0; i < sim.travels.length; i += 4) { ctx.moveTo(sim.travels[i], sim.travels[i + 1]); ctx.lineTo(sim.travels[i + 2], sim.travels[i + 3]); }
    ctx.stroke();
    ctx.strokeStyle = '#111'; ctx.lineWidth = 0.3;
    ctx.beginPath();
    for (const s of sim.strokes) { const p = s.pts; ctx.moveTo(p[0], p[1]); if (p.length === 2) ctx.lineTo(p[0] + 0.2, p[1]); for (let j = 2; j < p.length; j += 2) ctx.lineTo(p[j], p[j + 1]); }
    ctx.stroke();
  }

  async function runAll() {
    window.__testResult = null;
    pass = 0; fail = 0; failures.length = 0; logEl.textContent = '';
    Object.assign(stats, { files: 0, moves: 0, strokes: 0, drawM: 0, scenarios: 0, maxMs: 0 });
    const n = parseInt(document.getElementById('n').value, 10) || 100;
    const seed = parseInt(document.getElementById('seed').value, 10) || 1;
    const t0 = performance.now();
    log('Loading fonts...');
    const fontIds = PP.Fonts.list().filter(f => f.source.type === 'hjson' || f.source.type === 'svgfont').map(f => f.id);
    const loaded = [];
    await Promise.all(fontIds.map(id => PP.Fonts.load(id).then(() => loaded.push(id)).catch(e => log('font ' + id + ' failed to load: ' + e.message, 'fail'))));
    loaded.sort();
    ok(loaded.length === fontIds.length, 'all ' + fontIds.length + ' fonts load');
    try {
      window.__progress = 'self-test';
      simulatorSelfTest(); updSummary(); await tick();
      window.__progress = 'edge cases';
      edgeCases(); updSummary(); await tick();
      window.__progress = 'coverage';
      await coverageTests(loaded); updSummary(); await tick();
      await fuzz(n, seed, loaded); updSummary(); await tick();
      await stateFuzz(400, seed, loaded);
    } catch (e) {
      ok(false, 'test runner crashed', e.stack);
    }
    const secs = (performance.now() - t0) / 1000;
    const extra = stats.files + ' G-code files simulated • ' + stats.moves.toLocaleString() + ' moves • ' + stats.strokes.toLocaleString() + ' strokes • ' + stats.drawM.toFixed(0) + ' m of line • ' + secs.toFixed(1) + ' s';
    updSummary(extra);
    log('');
    log((fail ? 'FAILED: ' + fail + ' check(s)' : 'ALL ' + pass + ' CHECKS PASSED') + ' - ' + extra, fail ? 'fail' : 'pass');
    const show = firstBad || lastGood;
    if (show) { drawSim(show); log('Canvas: ' + (firstBad ? 'first FAILING' : 'last passing') + ' file - ' + show.name + ' (black = pen strokes, orange = travel, green = drawable area)', 'info'); }
    window.__testResult = { pass, fail, failures: failures.slice(0, 80), stats: Object.assign({}, stats), secs };
    return window.__testResult;
  }

  /** Debug helper: rebuild one fuzz scenario by seed and return its plan + simulation. */
  async function replay(s) {
    const fontIds = PP.Fonts.list().filter(f => f.source.type === 'hjson' || f.source.type === 'svgfont').map(f => f.id);
    const loaded = [];
    await Promise.all(fontIds.map(id => PP.Fonts.load(id).then(() => loaded.push(id)).catch(() => {})));
    loaded.sort();
    const rng = U.mulberry32(s);
    const prof = randomProfile(rng);
    const prefs = randomPrefs(rng);
    const P = GC.normalizeProfile(prof);
    buildScene(rng, loaded, P);
    const plan = App.buildPlan({ profile: P, prefs });
    const res = GC.build(plan.jobs, P, {});
    const sim = SIM.check(res.text, P, plan.jobs);
    return { P, prefs, plan, res, sim, mismatch: strokesMatchPlan(sim, plan.jobs) };
  }

  document.getElementById('run').addEventListener('click', runAll);
  window.runPenPlotTests = runAll;
  window.replayScenario = replay;
  window.__testUtils = { SegIndex, samplePolys, designPolys, splitFinite, fidelity, strokesMatchPlan };
})();
