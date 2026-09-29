/*
 * PenPlot Studio - polyline geometry.
 * A polyline is a flat array [x0, y0, x1, y1, ...] in millimetres, Y up.
 * Closed shapes repeat their first point at the end.
 */
(function (PP) {
  'use strict';

  const G = {};
  const EPS = 1e-9;

  // ---------- bounding boxes ----------
  G.bbox = function (polys) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < polys.length; i++) {
      const p = polys[i];
      for (let j = 0; j < p.length; j += 2) {
        const x = p[j], y = p[j + 1];
        if (!(x > -1e15 && x < 1e15 && y > -1e15 && y < 1e15)) continue; // skip NaN / Infinity
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (minX === Infinity) return null;
    return { minX, minY, maxX, maxY };
  };

  G.bboxUnion = function (a, b) {
    if (!a) return b ? { ...b } : null;
    if (!b) return { ...a };
    return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
  };

  G.bboxSize = (b) => b ? { w: b.maxX - b.minX, h: b.maxY - b.minY } : { w: 0, h: 0 };
  G.bboxCenter = (b) => b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : { x: 0, y: 0 };

  // ---------- affine matrices [a, b, c, d, e, f]: x' = a x + c y + e ; y' = b x + d y + f ----------
  G.IDENTITY = [1, 0, 0, 1, 0, 0];

  G.matTRS = function (x, y, rotDeg, sx, sy) {
    const r = rotDeg * Math.PI / 180;
    const cs = Math.cos(r), sn = Math.sin(r);
    return [cs * sx, sn * sx, -sn * sy, cs * sy, x, y];
  };

  G.matMul = function (m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
    ];
  };

  G.matInv = function (m) {
    const det = m[0] * m[3] - m[1] * m[2];
    if (Math.abs(det) < 1e-12) return G.IDENTITY.slice();
    return [
      m[3] / det, -m[1] / det, -m[2] / det, m[0] / det,
      (m[2] * m[5] - m[3] * m[4]) / det,
      (m[1] * m[4] - m[0] * m[5]) / det,
    ];
  };

  G.apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

  G.transformPoly = function (p, m) {
    const out = new Array(p.length);
    const a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5];
    for (let j = 0; j < p.length; j += 2) {
      const x = p[j], y = p[j + 1];
      out[j] = a * x + c * y + e;
      out[j + 1] = b * x + d * y + f;
    }
    return out;
  };

  G.transform = (polys, m) => polys.map(p => G.transformPoly(p, m));
  G.translate = (polys, dx, dy) => G.transform(polys, [1, 0, 0, 1, dx, dy]);

  /** Translate so the bbox center is at the origin. Returns {polys, cx, cy}. */
  G.center = function (polys) {
    const b = G.bbox(polys);
    if (!b) return { polys: [], cx: 0, cy: 0 };
    const c = G.bboxCenter(b);
    return { polys: G.translate(polys, -c.x, -c.y), cx: c.x, cy: c.y };
  };

  // ---------- measurements ----------
  G.polyLength = function (p) {
    let L = 0;
    for (let j = 2; j < p.length; j += 2) L += Math.hypot(p[j] - p[j - 2], p[j + 1] - p[j - 1]);
    return L;
  };
  G.totalLength = (polys) => polys.reduce((s, p) => s + G.polyLength(p), 0);
  G.pointCount = (polys) => polys.reduce((s, p) => s + (p.length >> 1), 0);

  G.isClosed = function (p, eps = 1e-4) {
    const n = p.length;
    return n >= 8 && Math.abs(p[0] - p[n - 2]) < eps && Math.abs(p[1] - p[n - 1]) < eps;
  };

  G.reverse = function (p) {
    const out = new Array(p.length);
    const n = p.length;
    for (let j = 0; j < n; j += 2) { out[j] = p[n - 2 - j]; out[j + 1] = p[n - 1 - j]; }
    return out;
  };

  // ---------- simplification ----------
  function segDistSq(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const L = dx * dx + dy * dy;
    let t = L > 0 ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + t * dx - px, qy = ay + t * dy - py;
    return qx * qx + qy * qy;
  }
  G.segDistSq = segDistSq;

  /** Ramer-Douglas-Peucker, iterative. */
  G.simplify = function (p, tol) {
    const n = p.length >> 1;
    if (n <= 2 || !(tol > 0)) return p.slice();
    const keep = new Uint8Array(n);
    keep[0] = 1; keep[n - 1] = 1;
    const tol2 = tol * tol;
    const stack = [0, n - 1];
    while (stack.length) {
      const last = stack.pop(), first = stack.pop();
      let maxD = -1, idx = -1;
      const ax = p[first * 2], ay = p[first * 2 + 1], bx = p[last * 2], by = p[last * 2 + 1];
      for (let i = first + 1; i < last; i++) {
        const d = segDistSq(p[i * 2], p[i * 2 + 1], ax, ay, bx, by);
        if (d > maxD) { maxD = d; idx = i; }
      }
      if (idx >= 0 && maxD > tol2) {
        keep[idx] = 1;
        stack.push(first, idx, idx, last);
      }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(p[i * 2], p[i * 2 + 1]);
    return out;
  };

  /** Remove consecutive duplicate points. */
  G.dedupe = function (p, eps = 1e-6) {
    if (p.length <= 4) return p.slice();
    const out = [p[0], p[1]];
    for (let j = 2; j < p.length; j += 2) {
      const lx = out[out.length - 2], ly = out[out.length - 1];
      if (Math.abs(p[j] - lx) > eps || Math.abs(p[j + 1] - ly) > eps) out.push(p[j], p[j + 1]);
    }
    if (out.length === 2) out.push(out[0], out[1]); // keep dots as 2-point polylines
    return out;
  };

  // ---------- smoothing / curves ----------
  G.chaikin = function (p, iterations = 1, closed = false) {
    let cur = p;
    for (let it = 0; it < iterations; it++) {
      const n = cur.length >> 1;
      if (n < 3) return cur;
      const out = [];
      if (!closed) out.push(cur[0], cur[1]);
      const lim = closed ? n - 1 : n - 1;
      for (let i = 0; i < lim; i++) {
        const x0 = cur[i * 2], y0 = cur[i * 2 + 1], x1 = cur[i * 2 + 2], y1 = cur[i * 2 + 3];
        out.push(0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1, 0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1);
      }
      if (closed) out.push(out[0], out[1]);
      else out.push(cur[cur.length - 2], cur[cur.length - 1]);
      cur = out;
    }
    return cur;
  };

  /** Catmull-Rom spline through points (flat array). step = approx mm between samples. */
  G.catmullRom = function (pts, closed = false, step = 0.5) {
    const n = pts.length >> 1;
    if (n < 2) return pts.slice();
    if (n === 2) return pts.slice();
    const P = (i) => {
      if (closed) { i = ((i % n) + n) % n; }
      else i = Math.max(0, Math.min(n - 1, i));
      return [pts[i * 2], pts[i * 2 + 1]];
    };
    const out = [];
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const k = Math.max(2, Math.min(200, Math.ceil(len / step)));
      for (let s = (i === 0 ? 0 : 1); s <= k; s++) {
        const t = s / k, t2 = t * t, t3 = t2 * t;
        const x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
        const y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
        out.push(x, y);
      }
    }
    return out;
  };

  G.resample = function (p, step) {
    if (p.length < 4 || !(step > 0)) return p.slice();
    const out = [p[0], p[1]];
    let carry = 0;
    for (let j = 2; j < p.length; j += 2) {
      const x0 = p[j - 2], y0 = p[j - 1], x1 = p[j], y1 = p[j + 1];
      const L = Math.hypot(x1 - x0, y1 - y0);
      if (L === 0) continue;
      let t = step - carry;
      while (t <= L) {
        out.push(x0 + (x1 - x0) * t / L, y0 + (y1 - y0) * t / L);
        t += step;
      }
      carry = L - (t - step);
    }
    const lx = p[p.length - 2], ly = p[p.length - 1];
    if (out[out.length - 2] !== lx || out[out.length - 1] !== ly) out.push(lx, ly);
    return out;
  };

  // ---------- primitive shapes (centered at origin) ----------
  G.ellipse = function (rx, ry, segments) {
    const circ = Math.PI * (3 * (rx + ry) - Math.sqrt((3 * rx + ry) * (rx + 3 * ry)));
    const n = segments || Math.max(24, Math.min(720, Math.ceil(circ / 0.5)));
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      out.push(Math.cos(a) * rx, Math.sin(a) * ry);
    }
    out[out.length - 2] = out[0]; out[out.length - 1] = out[1];
    return out;
  };

  G.rect = function (w, h, radius = 0) {
    const hw = w / 2, hh = h / 2;
    const r = Math.max(0, Math.min(radius, hw, hh));
    if (r <= 0) return [-hw, -hh, hw, -hh, hw, hh, -hw, hh, -hw, -hh];
    const out = [];
    const corner = (cx, cy, a0) => {
      const n = Math.max(4, Math.ceil((Math.PI / 2 * r) / 0.5));
      for (let i = 0; i <= n; i++) {
        const a = a0 + (i / n) * Math.PI / 2;
        out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      }
    };
    corner(hw - r, -hh + r, -Math.PI / 2);
    corner(hw - r, hh - r, 0);
    corner(-hw + r, hh - r, Math.PI / 2);
    corner(-hw + r, -hh + r, Math.PI);
    out.push(out[0], out[1]);
    return out;
  };

  G.polygon = function (sides, rx, ry, rotDeg = 90) {
    const out = [];
    const r0 = rotDeg * Math.PI / 180;
    for (let i = 0; i <= sides; i++) {
      const a = r0 + (i % sides) / sides * Math.PI * 2;
      out.push(Math.cos(a) * rx, Math.sin(a) * ry);
    }
    return out;
  };

  G.star = function (points, rx, ry, innerRatio = 0.5, rotDeg = 90) {
    const out = [];
    const r0 = rotDeg * Math.PI / 180;
    const n = points * 2;
    for (let i = 0; i <= n; i++) {
      const k = i % n;
      const a = r0 + k / n * Math.PI * 2;
      const f = (k % 2 === 0) ? 1 : innerRatio;
      out.push(Math.cos(a) * rx * f, Math.sin(a) * ry * f);
    }
    return out;
  };

  G.arc = function (cx, cy, r, a0, a1, step = 0.5) {
    const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) * r / step));
    const out = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n;
      out.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    return out;
  };

  // ---------- hit testing ----------
  G.hitPolys = function (polys, x, y, tol) {
    const tol2 = tol * tol;
    for (let i = 0; i < polys.length; i++) {
      const p = polys[i];
      if (p.length === 4 && p[0] === p[2] && p[1] === p[3]) {
        if ((p[0] - x) ** 2 + (p[1] - y) ** 2 <= tol2) return true;
        continue;
      }
      for (let j = 2; j < p.length; j += 2) {
        const ax = p[j - 2], ay = p[j - 1], bx = p[j], by = p[j + 1];
        if ((ax < x - tol && bx < x - tol) || (ax > x + tol && bx > x + tol) ||
            (ay < y - tol && by < y - tol) || (ay > y + tol && by > y + tol)) continue;
        if (segDistSq(x, y, ax, ay, bx, by) <= tol2) return true;
      }
    }
    return false;
  };

  /** Even-odd point-in-polygon over a set of closed loops. */
  G.pointInLoops = function (loops, x, y) {
    let inside = false;
    for (const p of loops) {
      for (let j = 0, k = p.length - 2; j < p.length; k = j, j += 2) {
        const xi = p[j], yi = p[j + 1], xk = p[k], yk = p[k + 1];
        if (((yi > y) !== (yk > y)) && (x < (xk - xi) * (y - yi) / (yk - yi) + xi)) inside = !inside;
      }
    }
    return inside;
  };

  // ---------- clipping ----------
  function liangBarsky(x0, y0, x1, y1, r) {
    const dx = x1 - x0, dy = y1 - y0;
    let t0 = 0, t1 = 1;
    const p = [-dx, dx, -dy, dy];
    const q = [x0 - r.minX, r.maxX - x0, y0 - r.minY, r.maxY - y0];
    for (let i = 0; i < 4; i++) {
      if (Math.abs(p[i]) < EPS) {
        if (q[i] < 0) return null;
      } else {
        const t = q[i] / p[i];
        if (p[i] < 0) { if (t > t1) return null; if (t > t0) t0 = t; }
        else { if (t < t0) return null; if (t < t1) t1 = t; }
      }
    }
    return [t0, t1];
  }

  /** Clip one polyline to an axis-aligned rect. Returns array of polylines. */
  G.clipPolyToRect = function (p, r) {
    const out = [];
    if (p.length === 4 && p[0] === p[2] && p[1] === p[3]) {
      if (p[0] >= r.minX && p[0] <= r.maxX && p[1] >= r.minY && p[1] <= r.maxY) out.push(p.slice());
      return out;
    }
    let cur = null;
    const flush = () => { if (cur && cur.length >= 4) out.push(cur); cur = null; };
    for (let j = 2; j < p.length; j += 2) {
      const x0 = p[j - 2], y0 = p[j - 1], x1 = p[j], y1 = p[j + 1];
      const t = liangBarsky(x0, y0, x1, y1, r);
      if (!t) { flush(); continue; }
      const ax = x0 + (x1 - x0) * t[0], ay = y0 + (y1 - y0) * t[0];
      const bx = x0 + (x1 - x0) * t[1], by = y0 + (y1 - y0) * t[1];
      if (cur && t[0] > 1e-7) flush();
      if (!cur) cur = [ax, ay];
      cur.push(bx, by);
      if (t[1] < 1 - 1e-7) flush();
    }
    flush();
    return out;
  };

  /** Clip all polylines; returns {polys, clipped} where clipped is true if anything was cut away. */
  G.clipToRect = function (polys, r) {
    const out = [];
    let clipped = false;
    for (const p of polys) {
      const b = G.bbox([p]);
      if (!b) continue;
      if (b.minX >= r.minX && b.maxX <= r.maxX && b.minY >= r.minY && b.maxY <= r.maxY) { out.push(p); continue; }
      clipped = true;
      const parts = G.clipPolyToRect(p, r);
      for (const q of parts) out.push(q);
    }
    return { polys: out, clipped };
  };

  // ---------- eraser ----------
  G.eraseCircle = function (polys, cx, cy, r) {
    const out = [];
    let changed = false;
    const r2 = r * r;
    for (const p of polys) {
      const b = G.bbox([p]);
      if (!b || b.maxX < cx - r || b.minX > cx + r || b.maxY < cy - r || b.minY > cy + r) { out.push(p); continue; }
      if (p.length === 4 && p[0] === p[2] && p[1] === p[3]) {
        if ((p[0] - cx) ** 2 + (p[1] - cy) ** 2 <= r2) { changed = true; continue; }
        out.push(p); continue;
      }
      let cur = null;
      let localChange = false;
      const flush = () => { if (cur && cur.length >= 4) out.push(cur); cur = null; };
      for (let j = 2; j < p.length; j += 2) {
        const x0 = p[j - 2], y0 = p[j - 1], x1 = p[j], y1 = p[j + 1];
        const dx = x1 - x0, dy = y1 - y0;
        const fx = x0 - cx, fy = y0 - cy;
        const a = dx * dx + dy * dy, bq = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r2;
        let ti = 1, to = 0;
        if (a < EPS) {
          if (c <= 0) { ti = 0; to = 1; }
        } else {
          const disc = bq * bq - 4 * a * c;
          if (disc > 0) {
            const sq = Math.sqrt(disc);
            ti = Math.max(0, (-bq - sq) / (2 * a));
            to = Math.min(1, (-bq + sq) / (2 * a));
          }
        }
        if (ti >= to) { // no overlap with circle
          if (!cur) cur = [x0, y0];
          cur.push(x1, y1);
          continue;
        }
        localChange = true;
        if (ti > 1e-9) {
          if (!cur) cur = [x0, y0];
          cur.push(x0 + dx * ti, y0 + dy * ti);
        }
        flush();
        if (to < 1 - 1e-9) cur = [x0 + dx * to, y0 + dy * to, x1, y1];
      }
      flush();
      if (localChange) changed = true;
    }
    return { polys: out, changed };
  };

  // ---------- hatch fill (even-odd) ----------
  /**
   * Fill the closed loops with parallel hatch lines.
   * spacing in mm, angle in degrees. Returns 2-point polylines ordered in a zig-zag.
   */
  G.hatch = function (loops, spacing, angleDeg = 45) {
    if (!loops.length || !(spacing > 0.05)) return [];
    const th = angleDeg * Math.PI / 180;
    const cs = Math.cos(th), sn = Math.sin(th);
    // rotate by -theta
    const edges = [];
    let minY = Infinity, maxY = -Infinity;
    for (const p of loops) {
      for (let j = 2; j < p.length; j += 2) {
        const ax = p[j - 2] * cs + p[j - 1] * sn, ay = -p[j - 2] * sn + p[j - 1] * cs;
        const bx = p[j] * cs + p[j + 1] * sn, by = -p[j] * sn + p[j + 1] * cs;
        if (ay === by) continue;
        edges.push(ax, ay, bx, by);
        if (ay < minY) minY = ay; if (ay > maxY) maxY = ay;
        if (by < minY) minY = by; if (by > maxY) maxY = by;
      }
    }
    if (!edges.length) return [];
    const k0 = Math.ceil(minY / spacing - 0.5), k1 = Math.floor(maxY / spacing - 0.5);
    const nLines = k1 - k0 + 1;
    if (nLines <= 0) return [];
    if (nLines > 20000) return []; // guard
    const buckets = new Array(nLines);
    for (let e = 0; e < edges.length; e += 4) {
      const y0 = Math.min(edges[e + 1], edges[e + 3]), y1 = Math.max(edges[e + 1], edges[e + 3]);
      const a = Math.max(k0, Math.ceil(y0 / spacing - 0.5)), b = Math.min(k1, Math.floor(y1 / spacing - 0.5));
      for (let k = a; k <= b; k++) {
        const idx = k - k0;
        (buckets[idx] || (buckets[idx] = [])).push(e);
      }
    }
    const out = [];
    let flip = false;
    const xs = [];
    for (let i = 0; i < nLines; i++) {
      const list = buckets[i];
      if (!list) continue;
      const y = (i + k0 + 0.5) * spacing;
      xs.length = 0;
      for (const e of list) {
        const ax = edges[e], ay = edges[e + 1], bx = edges[e + 2], by = edges[e + 3];
        if ((ay <= y && by > y) || (by <= y && ay > y)) xs.push(ax + (y - ay) * (bx - ax) / (by - ay));
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      const segs = [];
      for (let k = 0; k + 1 < xs.length; k += 2) {
        if (xs[k + 1] - xs[k] < 1e-6) continue;
        segs.push([xs[k], xs[k + 1]]);
      }
      if (flip) segs.reverse();
      for (const s of segs) {
        const xa = flip ? s[1] : s[0], xb = flip ? s[0] : s[1];
        out.push([xa * cs - y * sn, xa * sn + y * cs, xb * cs - y * sn, xb * sn + y * cs]);
      }
      flip = !flip;
    }
    return out;
  };

  G.closedLoops = (polys) => polys.filter(p => G.isClosed(p, 1e-3));

  PP.Geo = G;
})(window.PP = window.PP || {});
