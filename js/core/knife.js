/*
 * PenPlot Studio - drag-knife paths (docs/cutting.md).
 *
 * A drag knife's blade tip trails the holder's axis by the blade offset r and swivels freely, so it always points
 * along the direction it was last dragged. To make the TIP follow a path, the AXIS has to run r ahead of it:
 *   - on a straight segment with direction d: axis = tip + r * d;
 *   - at a corner sharper than the swivel angle the tip pivots in place while the axis swings around it on an arc
 *     of radius r, until the blade points along the next segment. Gentler turns are left to the blade;
 *   - before the first segment the same swivel turns the blade from the direction it was left in;
 *   - closed paths start in the middle of their longest segment (never on a corner) and run on past the start by
 *     the overcut, so the shape is fully cut through.
 * order() sorts cuts inside-first (holes before the piece around them, so nothing shifts before its holes are cut)
 * and never joins paths - a joined travel would be a cut.
 * Polylines are flat arrays [x0, y0, x1, y1, ...] in bed millimetres.
 */
(function (PP) {
  'use strict';

  const ARC_STEP = Math.PI / 18; // 10° per arc segment
  const CLOSE_TOL = 0.05;        // ends closer than this make a closed path

  const isClosed = (p) => p.length >= 8 && Math.hypot(p[0] - p[p.length - 2], p[1] - p[p.length - 1]) < CLOSE_TOL;

  /** Consecutive duplicate points removed. */
  function dedupe(p) {
    const out = [];
    for (let i = 0; i < p.length; i += 2) {
      const n = out.length;
      if (!n || Math.hypot(p[i] - out[n - 2], p[i + 1] - out[n - 1]) > 1e-6) out.push(p[i], p[i + 1]);
    }
    return out;
  }

  function signedArea(p) {
    let a = 0;
    for (let i = 0; i + 3 < p.length; i += 2) a += p[i] * p[i + 3] - p[i + 2] * p[i + 1];
    return a / 2;
  }

  function inside(x, y, p) {
    let c = false;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
      const yi = p[i + 1], yj = p[j + 1];
      if (yi > y !== yj > y && x < ((p[j] - p[i]) * (y - yi)) / (yj - yi) + p[i]) c = !c;
    }
    return c;
  }

  function bbox(p) {
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (let i = 0; i < p.length; i += 2) { a = Math.min(a, p[i]); c = Math.max(c, p[i]); b = Math.min(b, p[i + 1]); d = Math.max(d, p[i + 1]); }
    return { minX: a, minY: b, maxX: c, maxY: d };
  }

  /** Closed loop -> the same loop starting (and ending) at the middle of its longest segment. */
  function startMidLongest(p) {
    const n = p.length / 2 - 1; // segments (the last point repeats the first)
    let best = 0, bestLen = -1;
    for (let i = 0; i < n; i++) {
      const l = Math.hypot(p[2 * i + 2] - p[2 * i], p[2 * i + 3] - p[2 * i + 1]);
      if (l > bestLen) { bestLen = l; best = i; }
    }
    const mx = (p[2 * best] + p[2 * best + 2]) / 2, my = (p[2 * best + 1] + p[2 * best + 3]) / 2;
    const out = [mx, my];
    for (let k = 1; k <= n; k++) { const v = (best + k) % n; out.push(p[2 * v], p[2 * v + 1]); }
    out.push(mx, my);
    return out;
  }

  /** A closed loop continued past its start for `len` mm along its own segments. */
  function withOvercut(p, len) {
    const out = p.slice();
    let left = len;
    for (let i = 2; i < p.length && left > 1e-9; i += 2) {
      const sx = p[i - 2], sy = p[i - 1], l = Math.hypot(p[i] - sx, p[i + 1] - sy);
      if (l >= left) { out.push(sx + ((p[i] - sx) * left) / l, sy + ((p[i + 1] - sy) * left) / l); break; }
      out.push(p[i], p[i + 1]);
      left -= l;
    }
    return out;
  }

  /**
   * Tip path -> holder-axis path.
   * opts: { offset (mm), swivel (degrees: corners turning more than this get a swivel arc), overcut (mm, closed
   *         paths), dir: [dx, dy] the blade's direction before this cut (null = unknown: no start swivel) }
   * Returns { poly, dir } - dir is the blade direction at the end, for the next cut.
   */
  function compensate(tip, opts = {}) {
    const r = Math.max(0, opts.offset || 0);
    let p = dedupe(tip);
    if (p.length < 4) return { poly: p, dir: opts.dir || null };
    if (isClosed(p) && (opts.overcut || 0) > 0) p = withOvercut(p, opts.overcut);
    const n = p.length / 2 - 1;
    const dirs = [];
    for (let i = 0; i < n; i++) {
      const dx = p[2 * i + 2] - p[2 * i], dy = p[2 * i + 3] - p[2 * i + 1], l = Math.hypot(dx, dy);
      dirs.push([dx / l, dy / l]);
    }
    if (r === 0) return { poly: p, dir: dirs[n - 1] };
    const cosLimit = Math.cos((Math.max(0, opts.swivel || 0) * Math.PI) / 180);
    const out = [];
    const swing = (cx, cy, from, to) => {
      const a0 = Math.atan2(from[1], from[0]);
      let da = Math.atan2(to[1], to[0]) - a0;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da <= -Math.PI) da += 2 * Math.PI;
      const steps = Math.max(1, Math.ceil(Math.abs(da) / ARC_STEP));
      for (let s = 1; s <= steps; s++) {
        const a = a0 + (da * s) / steps;
        out.push(cx + r * Math.cos(a), cy + r * Math.sin(a));
      }
    };
    const turns = (a, b) => a[0] * b[0] + a[1] * b[1] < cosLimit - 1e-9;
    const prev = opts.dir;
    if (prev && turns(prev, dirs[0])) {
      out.push(p[0] + r * prev[0], p[1] + r * prev[1]);
      swing(p[0], p[1], prev, dirs[0]);
    } else out.push(p[0] + r * dirs[0][0], p[1] + r * dirs[0][1]);
    for (let i = 0; i < n; i++) {
      const d = dirs[i], ex = p[2 * i + 2], ey = p[2 * i + 3];
      out.push(ex + r * d[0], ey + r * d[1]);
      if (i + 1 < n && turns(d, dirs[i + 1])) swing(ex, ey, d, dirs[i + 1]);
    }
    return { poly: out, dir: dirs[n - 1] };
  }

  /**
   * Cutting order from `start` ({x, y}): open paths first, then closed shapes from the most deeply nested out
   * (holes before the piece around them); nearest first within each group. Open paths may be reversed; closed
   * shapes start in the middle of their longest segment. Nothing is joined.
   */
  function order(polys, start) {
    const items = [];
    for (const q of polys) {
      const p = dedupe(q);
      if (p.length < 4) continue;
      const closed = isClosed(p);
      const it = { p: closed ? startMidLongest(p) : p, closed, depth: -1 };
      if (closed) { it.area = Math.abs(signedArea(p)); it.bb = bbox(p); }
      items.push(it);
    }
    const shapes = items.filter(it => it.closed);
    for (const a of shapes) {
      a.depth = 0;
      for (const b of shapes) {
        if (a === b || b.area <= a.area) continue;
        if (a.bb.minX < b.bb.minX || a.bb.maxX > b.bb.maxX || a.bb.minY < b.bb.minY || a.bb.maxY > b.bb.maxY) continue;
        if (inside(a.p[0], a.p[1], b.p)) a.depth++;
      }
    }
    const groups = new Map();
    for (const it of items) {
      if (!groups.has(it.depth)) groups.set(it.depth, []);
      groups.get(it.depth).push(it);
    }
    // open paths (-1) first, then the deepest shapes first
    const keys = Array.from(groups.keys()).sort((a, b) => (a === -1 ? -1 : b === -1 ? 1 : b - a));
    const out = [];
    let x = start ? start.x : 0, y = start ? start.y : 0;
    for (const k of keys) {
      const left = groups.get(k);
      while (left.length) {
        let bi = 0, bd = Infinity, rev = false;
        left.forEach((it, i) => {
          const p = it.p, n = p.length;
          const d0 = Math.hypot(p[0] - x, p[1] - y);
          if (d0 < bd) { bd = d0; bi = i; rev = false; }
          if (!it.closed) {
            const d1 = Math.hypot(p[n - 2] - x, p[n - 1] - y);
            if (d1 < bd) { bd = d1; bi = i; rev = true; }
          }
        });
        const it = left.splice(bi, 1)[0];
        let p = it.p;
        if (rev) {
          const r = [];
          for (let i = p.length - 2; i >= 0; i -= 2) r.push(p[i], p[i + 1]);
          p = r;
        }
        out.push(p);
        x = p[p.length - 2]; y = p[p.length - 1];
      }
    }
    return out;
  }

  PP.Knife = { compensate, order, isClosed, startMidLongest };
})(window.PP = window.PP || {});
