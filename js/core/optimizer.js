/*
 * PenPlot Studio - path preparation, travel optimisation and time estimation.
 */
(function (PP) {
  'use strict';

  const G = PP.Geo;

  /** Split a polyline at non-finite points (NaN/Infinity from corrupt data). */
  function splitFinite(p) {
    let ok = true;
    for (let j = 0; j < p.length; j++) if (!isFinite(p[j])) { ok = false; break; }
    if (ok) return [p];
    const out = [];
    let cur = [];
    for (let j = 0; j + 1 < p.length; j += 2) {
      const x = p[j], y = p[j + 1];
      if (isFinite(x) && isFinite(y)) cur.push(x, y);
      else { if (cur.length >= 4) out.push(cur); cur = []; }
    }
    if (cur.length >= 4) out.push(cur);
    return out;
  }

  /**
   * Clean, clip to the reachable rectangle, then simplify polylines.
   * (Clipping first keeps the simplified line within `tolerance` of the design
   * even where a curve grazes the edge of the drawable area.)
   * opts: { tolerance (mm), rect {minX,minY,maxX,maxY}, minLength (mm) }
   * Returns { polys, clipped (bool), removed (count of dropped tiny paths) }
   */
  function prepare(polys, opts = {}) {
    const tol = opts.tolerance || 0;
    const minLen = opts.minLength || 0;
    let out = [];
    for (const p0 of polys) {
      if (!p0 || p0.length < 4) continue;
      for (const p of splitFinite(p0)) out.push(G.dedupe(p));
    }
    let clipped = false;
    if (opts.rect) {
      const r = G.clipToRect(out, opts.rect);
      out = r.polys;
      clipped = r.clipped;
    }
    // Judge the minimum length before simplifying: simplify can collapse a small closed loop (a letter's counter at
    // a tiny size) into a stub shorter than minLength, and a feature longer than minLength would vanish
    let removed = 0;
    if (minLen > 0) {
      out = out.filter(p => {
        const L = G.polyLength(p);
        if (L === 0 || L >= minLen) return true; // keep intentional dots
        removed++;
        return false;
      });
    }
    if (tol > 0) out = out.map(q => (q.length > 4 ? G.simplify(q, tol) : q));
    return { polys: out, clipped, removed };
  }

  /**
   * Greedy nearest-neighbour ordering with optional reversal, using a uniform grid.
   * opts: { reorder: true, reverse: true, joinTol: 0.05 }
   */
  function order(polys, start, opts = {}) {
    const n = polys.length;
    const joinTol = opts.joinTol === undefined ? 0.05 : opts.joinTol;
    if (!n) return [];
    let seq;
    if (opts.reorder === false) {
      seq = polys.slice();
    } else {
      const allowRev = opts.reverse !== false;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of polys) {
        const a = p[0], b = p[1], c = p[p.length - 2], d = p[p.length - 1];
        if (a < minX) minX = a; if (c < minX) minX = c;
        if (a > maxX) maxX = a; if (c > maxX) maxX = c;
        if (b < minY) minY = b; if (d < minY) minY = d;
        if (b > maxY) maxY = b; if (d > maxY) maxY = d;
      }
      const w = Math.max(1e-3, maxX - minX), h = Math.max(1e-3, maxY - minY);
      let cell = Math.max(0.5, Math.sqrt((w * h) / n));
      let gw = Math.ceil(w / cell) + 1, gh = Math.ceil(h / cell) + 1;
      while (gw * gh > 4e6) { cell *= 1.5; gw = Math.ceil(w / cell) + 1; gh = Math.ceil(h / cell) + 1; }
      const cells = new Array(gw * gh);
      const pos = new Int32Array(n * 2);
      const cellOf = new Int32Array(n * 2);
      const ex = new Float64Array(n * 2), ey = new Float64Array(n * 2);
      const insert = (e, x, y) => {
        const cx = Math.min(gw - 1, Math.max(0, Math.floor((x - minX) / cell)));
        const cy = Math.min(gh - 1, Math.max(0, Math.floor((y - minY) / cell)));
        const ci = cy * gw + cx;
        let arr = cells[ci];
        if (!arr) arr = cells[ci] = [];
        pos[e] = arr.length;
        cellOf[e] = ci;
        arr.push(e);
        ex[e] = x; ey[e] = y;
      };
      const remove = (e) => {
        const arr = cells[cellOf[e]];
        if (!arr) return;
        const i = pos[e];
        if (arr[i] !== e) return;
        const last = arr.pop();
        if (last !== e) { arr[i] = last; pos[last] = i; }
        pos[e] = -1;
      };
      for (let i = 0; i < n; i++) {
        const p = polys[i];
        insert(i * 2, p[0], p[1]);
        if (allowRev) insert(i * 2 + 1, p[p.length - 2], p[p.length - 1]);
        else pos[i * 2 + 1] = -1;
      }
      seq = [];
      let cx = start ? start.x : minX, cy = start ? start.y : minY;
      const maxR = Math.max(gw, gh);
      for (let k = 0; k < n; k++) {
        const gx = Math.min(gw - 1, Math.max(0, Math.floor((cx - minX) / cell)));
        const gy = Math.min(gh - 1, Math.max(0, Math.floor((cy - minY) / cell)));
        let best = -1, bestD = Infinity;
        for (let r = 0; r <= maxR; r++) {
          const x0 = gx - r, x1 = gx + r, y0 = gy - r, y1 = gy + r;
          for (let yy = y0; yy <= y1; yy++) {
            if (yy < 0 || yy >= gh) continue;
            const edgeRow = (yy === y0 || yy === y1);
            for (let xx = x0; xx <= x1; xx += (edgeRow ? 1 : (x1 - x0) || 1)) {
              if (xx < 0 || xx >= gw) continue;
              const arr = cells[yy * gw + xx];
              if (!arr || !arr.length) continue;
              for (let q = 0; q < arr.length; q++) {
                const e = arr[q];
                const dx = ex[e] - cx, dy = ey[e] - cy;
                const d = dx * dx + dy * dy;
                if (d < bestD) { bestD = d; best = e; }
              }
            }
          }
          if (best >= 0) {
            const reach = r * cell;
            if (reach * reach >= bestD) break;
          }
        }
        if (best < 0) break; // should not happen
        const pi = best >> 1;
        remove(pi * 2);
        if (allowRev) remove(pi * 2 + 1);
        let p = polys[pi];
        if (best & 1) p = G.reverse(p);
        seq.push(p);
        cx = p[p.length - 2]; cy = p[p.length - 1];
      }
    }
    return joinTol > 0 ? join(seq, joinTol) : seq;
  }

  /** Concatenate consecutive polylines whose endpoints touch (no pen lift needed). */
  function join(seq, tol) {
    if (!seq.length) return seq;
    const out = [];
    let cur = seq[0].slice();
    const t2 = tol * tol;
    for (let i = 1; i < seq.length; i++) {
      const p = seq[i];
      const dx = p[0] - cur[cur.length - 2], dy = p[1] - cur[cur.length - 1];
      if (dx * dx + dy * dy <= t2) {
        // keep the first point unless it is an exact duplicate, so the joined path stays on the design
        for (let j = (dx === 0 && dy === 0) ? 2 : 0; j < p.length; j++) cur.push(p[j]);
      } else {
        out.push(cur);
        cur = p.slice();
      }
    }
    out.push(cur);
    return out;
  }

  // ---------------------------------------------------------------------------
  // Motion time estimation (trapezoidal profile + junction deviation)
  // ---------------------------------------------------------------------------
  function trapTime(d, v, a) {
    if (d <= 0) return 0;
    if (!(a > 0)) return d / v;
    const dAcc = v * v / a; // accel + decel distance
    if (d >= dAcc) return d / v + v / a;
    return 2 * Math.sqrt(d / a);
  }

  function polyTime(p, vmax, a, jd = 0.02) {
    const m = (p.length >> 1) - 1;
    if (m <= 0) return 0;
    const L = new Float64Array(m), ux = new Float64Array(m), uy = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      const dx = p[i * 2 + 2] - p[i * 2], dy = p[i * 2 + 3] - p[i * 2 + 1];
      const l = Math.hypot(dx, dy);
      L[i] = l;
      if (l > 0) { ux[i] = dx / l; uy[i] = dy / l; }
    }
    const v = new Float64Array(m + 1);
    v[0] = 0; v[m] = 0;
    for (let i = 1; i < m; i++) {
      const cosT = -(ux[i - 1] * ux[i] + uy[i - 1] * uy[i]);
      let vj;
      if (L[i] === 0 || L[i - 1] === 0) vj = vmax;
      else if (cosT < -0.9999) vj = vmax;
      else if (cosT > 0.9999) vj = 0;
      else {
        const sh = Math.sqrt(0.5 * (1 - cosT));
        vj = Math.sqrt(a * jd * sh / (1 - sh));
      }
      v[i] = Math.min(vmax, vj);
    }
    for (let i = 0; i < m; i++) v[i + 1] = Math.min(v[i + 1], Math.sqrt(v[i] * v[i] + 2 * a * L[i]));
    for (let i = m - 1; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * a * L[i]));
    let t = 0;
    for (let i = 0; i < m; i++) {
      const l = L[i];
      if (l <= 0) continue;
      const v0 = v[i], v1 = v[i + 1];
      const vp = Math.min(vmax, Math.sqrt((2 * a * l + v0 * v0 + v1 * v1) / 2));
      const da = (vp * vp - v0 * v0) / (2 * a), dd = (vp * vp - v1 * v1) / (2 * a);
      const cruise = Math.max(0, l - da - dd);
      t += Math.max(0, vp - v0) / a + Math.max(0, vp - v1) / a + (vp > 0 ? cruise / vp : 0);
    }
    return t;
  }

  /**
   * Estimate plotting time and distances for an ordered list of pen paths.
   * s: { drawSpeed, travelSpeed, zSpeed (mm/s), accel (mm/s^2), zDraw, zLift, penDownDelay, penUpDelay (ms) }
   */
  function estimate(ordered, start, s) {
    const a = s.accel || 3000;
    const zA = 1000;
    const dz = Math.abs((s.zLift || 0) - (s.zDraw || 0));
    const tz = trapTime(dz, s.zSpeed || 10, zA);
    const delay = ((s.penDownDelay || 0) + (s.penUpDelay || 0)) / 1000;
    let t = 0, drawLen = 0, travelLen = 0;
    let cx = start ? start.x : 0, cy = start ? start.y : 0;
    const cumulative = new Float64Array(ordered.length);
    for (let i = 0; i < ordered.length; i++) {
      const p = ordered[i];
      const d = Math.hypot(p[0] - cx, p[1] - cy);
      travelLen += d;
      t += trapTime(d, s.travelSpeed || 100, a);
      t += 2 * tz + delay;
      drawLen += G.polyLength(p);
      t += polyTime(p, s.drawSpeed || 30, a);
      cx = p[p.length - 2]; cy = p[p.length - 1];
      cumulative[i] = t;
    }
    return { time: t, drawLen, travelLen, lifts: ordered.length, cumulative };
  }

  PP.Optimizer = { prepare, order, join, estimate, trapTime, polyTime };
})(window.PP = window.PP || {});
