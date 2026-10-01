/*
 * PenPlot Studio - animated draw preview (simulates the plot in path order,
 * showing travel moves, the pen tip and the nozzle/toolhead position).
 */
(function (PP) {
  'use strict';

  const U = PP.U, h = U.h;

  const P = {
    active: false,
    view: null,
    plan: null,
    items: [],     // [{job, poly, t0 (travel start), t1 (draw start), t2 (end), cum: Float64Array, len, from:[x,y]}]
    total: 0,
    t: 0,
    playing: false,
    speed: 10,
    doneIdx: 0,
    donePaths: null,
    travelPath: null,
    bar: null,
    _last: 0,
  };

  function buildTimeline(plan) {
    const p = plan.profile;
    const items = [];
    let t = 0;
    let cur = [plan.start.x, plan.start.y];
    const tz = 2 * Math.abs(p.zLift - p.zDraw) / Math.max(1, p.zSpeed);
    plan.jobs.forEach((job, ji) => {
      const v = job.drawSpeed || p.drawSpeed;
      for (const poly of job.polys) {
        const d = Math.hypot(poly[0] - cur[0], poly[1] - cur[1]);
        const t0 = t;
        t += d / p.travelSpeed + tz;
        const t1 = t;
        const n = poly.length >> 1;
        const cum = new Float64Array(n);
        for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(poly[i * 2] - poly[i * 2 - 2], poly[i * 2 + 1] - poly[i * 2 - 1]);
        const len = cum[n - 1];
        t += len / v;
        items.push({ ji, poly, t0, t1, t2: t, cum, len, from: cur, v });
        cur = [poly[poly.length - 2], poly[poly.length - 1]];
      }
    });
    return { items, total: t };
  }

  function findIndex(t) {
    const it = P.items;
    let lo = 0, hi = it.length - 1, ans = it.length;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (it[mid].t2 > t) { ans = mid; hi = mid - 1; } else lo = mid + 1;
    }
    return ans; // first item not finished
  }

  function resetDone() {
    P.donePaths = P.plan.jobs.map(() => new Path2D());
    P.doneIdx = 0;
  }

  function addDone(upTo) {
    for (let i = P.doneIdx; i < upTo; i++) {
      const it = P.items[i];
      const p2 = P.donePaths[it.ji];
      const poly = it.poly;
      p2.moveTo(poly[0], poly[1]);
      if (poly.length === 4 && poly[0] === poly[2] && poly[1] === poly[3]) p2.lineTo(poly[0] + 0.01, poly[1]);
      for (let j = 2; j < poly.length; j += 2) p2.lineTo(poly[j], poly[j + 1]);
    }
    P.doneIdx = Math.max(P.doneIdx, upTo);
  }

  /** Current pen position + partial polyline of the active item. */
  function state() {
    const idx = findIndex(P.t);
    if (idx >= P.items.length) {
      const last = P.items[P.items.length - 1];
      return { idx, pen: last ? [last.poly[last.poly.length - 2], last.poly[last.poly.length - 1]] : [0, 0], down: false, partial: null };
    }
    const it = P.items[idx];
    if (P.t < it.t1) {
      const f = U.clamp((P.t - it.t0) / Math.max(1e-6, it.t1 - it.t0), 0, 1);
      return { idx, pen: [it.from[0] + (it.poly[0] - it.from[0]) * f, it.from[1] + (it.poly[1] - it.from[1]) * f], down: false, partial: null };
    }
    const dist = (P.t - it.t1) * it.v;
    const poly = it.poly, cum = it.cum;
    const partial = [poly[0], poly[1]];
    let k = 1;
    while (k < cum.length && cum[k] <= dist) { partial.push(poly[k * 2], poly[k * 2 + 1]); k++; }
    let pen = [partial[partial.length - 2], partial[partial.length - 1]];
    if (k < cum.length) {
      const seg = cum[k] - cum[k - 1];
      const f = seg > 0 ? (dist - cum[k - 1]) / seg : 0;
      pen = [poly[k * 2 - 2] + (poly[k * 2] - poly[k * 2 - 2]) * f, poly[k * 2 - 1] + (poly[k * 2 + 1] - poly[k * 2 - 1]) * f];
      partial.push(pen[0], pen[1]);
    }
    return { idx, pen, down: true, partial };
  }

  P.draw = function (ctx, view) {
    if (!P.plan) return;
    const z = view.zoom, px = 1 / z;
    // travel moves
    ctx.save();
    ctx.strokeStyle = PP.CanvasColors.travel;
    ctx.lineWidth = px;
    ctx.setLineDash([3 * px, 3 * px]);
    ctx.stroke(P.travelPath);
    ctx.restore();

    const st = state();
    if (st.idx < P.doneIdx) resetDone();
    addDone(Math.min(st.idx, P.items.length));
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    P.plan.jobs.forEach((job, i) => {
      const L = PP.Store.layer(job.layerId);
      ctx.strokeStyle = job.color;
      ctx.lineWidth = Math.max((L && L.penWidth) || 0.5, 1.2 * px);
      ctx.stroke(P.donePaths[i]);
    });
    if (st.partial && st.partial.length >= 4) {
      const it = P.items[st.idx];
      ctx.strokeStyle = P.plan.jobs[it.ji].color;
      ctx.beginPath();
      ctx.moveTo(st.partial[0], st.partial[1]);
      for (let j = 2; j < st.partial.length; j += 2) ctx.lineTo(st.partial[j], st.partial[j + 1]);
      ctx.stroke();
    }
    P._state = st;
  };

  P.drawScreen = function (ctx, view) {
    const st = P._state;
    if (!st) return;
    const p = P.plan.profile;
    const pen = view.toScreen(st.pen[0], st.pen[1]);
    const noz = view.toScreen(st.pen[0] - p.penOffsetX, st.pen[1] - p.penOffsetY);
    // toolhead footprint (approx. 44 x 44 mm around the nozzle)
    const hw = 22 * view.zoom;
    ctx.save();
    ctx.fillStyle = 'rgba(30,41,59,0.10)';
    ctx.strokeStyle = 'rgba(30,41,59,0.45)';
    ctx.lineWidth = 1;
    ctx.fillRect(noz[0] - hw, noz[1] - hw, hw * 2, hw * 2);
    ctx.strokeRect(noz[0] - hw, noz[1] - hw, hw * 2, hw * 2);
    ctx.beginPath(); ctx.moveTo(noz[0], noz[1]); ctx.lineTo(pen[0], pen[1]); ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(noz[0], noz[1], 4, 0, Math.PI * 2); ctx.fillStyle = '#64748b'; ctx.fill();
    ctx.font = '10px system-ui'; ctx.fillStyle = '#475569'; ctx.fillText('nozzle', noz[0] + 6, noz[1] - 6);
    ctx.beginPath(); ctx.arc(pen[0], pen[1], st.down ? 5 : 6, 0, Math.PI * 2);
    ctx.fillStyle = st.down ? '#10b981' : '#f59e0b';
    ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
    updateBar();
  };

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------
  let els = {};
  function buildBar(host) {
    const UI = PP.UI;
    els.play = UI.iconBtn('play', 'Play / pause (Space)', () => P.togglePlay());
    els.back = UI.iconBtn('stepb', 'Previous path', () => P.step(-1));
    els.fwd = UI.iconBtn('stepf', 'Next path', () => P.step(1));
    els.slider = h('input', { type: 'range', min: 0, max: 1000, step: 1, value: 0, class: 'pv-slider' });
    els.slider.addEventListener('input', () => { P.t = P.total * els.slider.value / 1000; P.playing = false; P.view.invalidate(); });
    els.speed = h('select', { class: 'pv-speed', title: 'Playback speed' }, [1, 2, 5, 10, 25, 50, 100, 250].map(v => h('option', { value: v }, v + '×')));
    els.speed.value = String(P.speed);
    els.speed.addEventListener('change', () => { P.speed = parseFloat(els.speed.value); });
    els.time = h('span', { class: 'pv-time' }, '');
    els.info = h('span', { class: 'pv-info' }, '');
    els.close = UI.btn('Exit preview', () => P.stop(), { small: true });
    els.safety = h('button', { class: 'pv-safety', title: 'G-code safety check (click for details)', onclick: () => showSafety() }, '');
    P.bar = h('div', { class: 'preview-bar' }, els.back, els.play, els.fwd, els.slider, els.speed, els.time, els.info, els.safety, els.close);
    host.appendChild(P.bar);
  }

  function updateSafety() {
    const sim = P.sim;
    els.safety.className = 'pv-safety ' + (!sim ? 'na' : sim.ok ? 'ok' : 'bad');
    els.safety.textContent = !sim ? 'Not simulated' : sim.ok ? '✓ G-code check passed' : '⚠ ' + sim.errors.length + ' problem' + (sim.errors.length > 1 ? 's' : '');
  }

  function showSafety() {
    const sim = P.sim;
    if (!sim) return;
    if (sim.ok) {
      const s = sim.stats;
      PP.UI.toast('Simulated the real G-code: ' + s.moves.toLocaleString() + ' moves, ' + s.penDowns + ' strokes, ' + sim.pauses.length + (sim.pauses.length === 1 ? ' pause.' : ' pauses.') + ' No collisions, pen always lifted for travel, drawing stays inside the drawable area.' + (sim.warnings.length ? ' Notes: ' + sim.warnings.map(PP.GSim.fmtMsg).join(' | ') : ''), 'info', 9000);
    } else {
      PP.UI.toast('G-code problems: ' + sim.errors.map(PP.GSim.fmtMsg).join(' | '), 'error', 12000);
    }
  }

  function updateBar() {
    if (!P.bar) return;
    els.slider.value = String(Math.round(P.total ? P.t / P.total * 1000 : 0));
    els.time.textContent = U.formatDuration(P.t) + ' / ' + U.formatDuration(P.total);
    const st = P._state;
    const n = P.items.length;
    els.info.textContent = 'Path ' + Math.min(n, (st ? st.idx : 0) + (st && st.idx < n ? 1 : 0)) + ' / ' + n + (st && st.idx < n ? ' • ' + P.plan.jobs[P.items[st.idx].ji].name : '');
    els.play.innerHTML = '';
    els.play.appendChild(PP.UI.icon(P.playing ? 'pause' : 'play'));
  }

  function tick(ts) {
    if (!P.active) return;
    const dt = P._last ? Math.min(0.1, (ts - P._last) / 1000) : 0;
    P._last = ts;
    if (P.playing) {
      P.t = Math.min(P.total, P.t + dt * P.speed);
      if (P.t >= P.total) P.playing = false;
      P.view.invalidate();
    }
    requestAnimationFrame(tick);
  }

  P.init = function (view) {
    P.view = view;
    buildBar(view.host);
    view.preview = P;
    document.addEventListener('keydown', (e) => {
      if (!P.active || PP.UI.hasModal()) return;
      const tag = e.target && e.target.tagName;
      // typing in a field keeps its keys, except the preview's own scrubber and speed select
      if ((tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') && !P.bar.contains(e.target)) return;
      if (e.key === ' ') { e.preventDefault(); e.stopImmediatePropagation(); P.togglePlay(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); P.step(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); P.step(-1); }
    }, true);
    // the preview shows a plan built when it opened: close it when the design or printer settings change
    const stale = (k) => {
      if (!P.active || k === 'selection' || k === 'transform') return;
      P.stop();
      PP.UI.toast('Preview closed because the design changed. Press Preview to see the new plan.', 'info');
    };
    PP.Store.events.on('change', stale);
    PP.App.events.on('profile', () => stale('profile'));
  };

  /** Timeline from the G-code simulator: animates exactly what the file does. */
  function buildTimelineFromSim(sim) {
    const items = sim.strokes.map(s => {
      const poly = s.pts.length >= 4 ? s.pts : [s.pts[0], s.pts[1], s.pts[0], s.pts[1]];
      const n = poly.length >> 1;
      const cum = new Float64Array(n);
      for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(poly[i * 2] - poly[i * 2 - 2], poly[i * 2 + 1] - poly[i * 2 - 1]);
      return { ji: s.layer, poly, t0: s.t0, t1: s.t1, t2: s.t2, cum, len: cum[n - 1], from: s.from || [poly[0], poly[1]], v: s.feed || 1 };
    });
    return { items, total: Math.max(sim.stats.time, items.length ? items[items.length - 1].t2 : 0) };
  }

  P.start = function () {
    const plan = PP.App.buildPlan();
    if (!plan.jobs.length) { PP.UI.toast(PP.App.emptyPlanMessage(plan), 'warn'); return; }
    P.plan = plan;
    let sim = null;
    try {
      const gc = PP.GCode.build(plan.jobs, plan.profile, {});
      sim = PP.GSim.check(gc.text, plan.profile, plan.jobs);
    } catch (e) { console.error(e); }
    P.sim = sim;
    const tl = sim && sim.strokes.length ? buildTimelineFromSim(sim) : buildTimeline(plan);
    P.items = tl.items; P.total = tl.total;
    P.travelPath = new Path2D();
    if (sim && sim.strokes.length) {
      const tr = sim.travels;
      for (let i = 0; i < tr.length; i += 4) { P.travelPath.moveTo(tr[i], tr[i + 1]); P.travelPath.lineTo(tr[i + 2], tr[i + 3]); }
    } else {
      for (const it of P.items) { P.travelPath.moveTo(it.from[0], it.from[1]); P.travelPath.lineTo(it.poly[0], it.poly[1]); }
    }
    updateSafety();
    resetDone();
    P.t = 0; P.playing = true; P.active = true; P._last = 0;
    P.speed = parseFloat(els.speed.value) || 10;
    // pick a speed so the preview takes ~20-40 s by default
    const auto = [1, 2, 5, 10, 25, 50, 100, 250].find(v => P.total / v <= 30) || 250;
    P.speed = auto; els.speed.value = String(auto);
    P.bar.classList.add('show');
    document.body.classList.add('previewing');
    PP.App.events.emit('preview', true);
    requestAnimationFrame(tick);
    P.view.invalidate();
  };

  P.stop = function () {
    P.active = false; P.playing = false; P.plan = null; P._state = null;
    P.bar.classList.remove('show');
    document.body.classList.remove('previewing');
    PP.App.events.emit('preview', false);
    P.view.invalidate();
  };

  P.toggle = function () { if (P.active) P.stop(); else P.start(); };
  P.togglePlay = function () {
    if (!P.active) return;
    if (P.t >= P.total) P.t = 0;
    P.playing = !P.playing;
    P._last = 0;
    P.view.invalidate();
  };
  P.step = function (dir) {
    if (!P.active) return;
    P.playing = false;
    const idx = findIndex(P.t);
    if (dir > 0) {
      const it = P.items[Math.min(P.items.length - 1, idx)];
      if (it) P.t = Math.min(P.total, it.t2 + 1e-6);
    } else {
      const startOf = (i) => (i <= 0 ? 0 : P.items[i - 1].t2 + 1e-6);
      let target = startOf(idx);
      if (P.t - target < 0.05) target = startOf(idx - 1);
      P.t = Math.max(0, target);
    }
    P.view.invalidate();
  };

  Object.defineProperty(P, 'isActive', { get: () => P.active });
  PP.Preview = P;
})(window.PP = window.PP || {});
