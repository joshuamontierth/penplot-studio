/*
 * PP.Patterns - procedural pattern generators for the pen-plotter app.
 *
 * Geometry conventions
 *   polyline  : flat array [x0, y0, x1, y1, ...] in millimetres, Y axis UP.
 *               Closed shapes repeat their first point at the end.
 *   polylines : array of polylines (what every generator returns).
 *
 * Every generator returns polylines roughly centred on (0,0). Generators with
 * a `size` param fit their larger bounding dimension to ~size mm; rectangular
 * fills (grid, truchet, maze, waves, flowfield, topo) fill width x height mm.
 *
 * Public API (PP.Patterns):
 *   list                 - generator descriptors in UI order
 *   get(id)              - descriptor or undefined
 *   defaults(id)         - { key: defaultValue, ... }
 *   generate(id, params) - merge defaults + params, clamp, run, sanitise
 */
(function (PP) {
  'use strict';

  /* ======================================================================
   * Constants
   * ==================================================================== */
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;
  const SQRT3 = Math.sqrt(3);
  const SPACING = 0.5;        // target mm between consecutive curve samples
  const BUDGET = 300000;      // soft point budget used when sizing sample counts
  const MAX_POINTS = 400000;  // hard cap enforced by generate()

  /* ======================================================================
   * Small math helpers
   * ==================================================================== */
  // NaN-safe clamp (NaN -> lo).
  function clamp(v, lo, hi) { return v > hi ? hi : v >= lo ? v : lo; }
  function clampInt(v, lo, hi) { return Math.round(clamp(v, lo, hi)); }

  function gcd(a, b) {
    a = Math.abs(Math.round(a));
    b = Math.abs(Math.round(b));
    while (b) { const t = a % b; a = b; b = t; }
    return a || 1;
  }
  function lcm(a, b) {
    a = Math.abs(Math.round(a));
    b = Math.abs(Math.round(b));
    return a && b ? (a / gcd(a, b)) * b : 0;
  }

  // Deterministic PRNG -> float in [0, 1).
  function mulberry32(seed) {
    let a = (Number(seed) >>> 0);
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Seeded 2D Perlin noise, output roughly in [-1, 1].
  function makeNoise2D(seed) {
    const rnd = mulberry32((Number(seed) ^ 0x5bd1e995) >>> 0);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    const gx = new Float64Array(8);
    const gy = new Float64Array(8);
    for (let i = 0; i < 8; i++) {
      gx[i] = Math.cos(i * TAU / 8 + TAU / 16);
      gy[i] = Math.sin(i * TAU / 8 + TAU / 16);
    }
    return function noise(x, y) {
      const fx = Math.floor(x);
      const fy = Math.floor(y);
      const X = fx & 255;
      const Y = fy & 255;
      const xf = x - fx;
      const yf = y - fy;
      const h00 = perm[perm[X] + Y] & 7;
      const h10 = perm[perm[X + 1] + Y] & 7;
      const h01 = perm[perm[X] + Y + 1] & 7;
      const h11 = perm[perm[X + 1] + Y + 1] & 7;
      const n00 = gx[h00] * xf + gy[h00] * yf;
      const n10 = gx[h10] * (xf - 1) + gy[h10] * yf;
      const n01 = gx[h01] * xf + gy[h01] * (yf - 1);
      const n11 = gx[h11] * (xf - 1) + gy[h11] * (yf - 1);
      const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
      const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
      const a = n00 + u * (n10 - n00);
      const b = n01 + u * (n11 - n01);
      return (a + v * (b - a)) * 1.4142;
    };
  }

  // Fractal Brownian motion on top of a noise function, output ~[-1, 1].
  function fbm(noise, x, y, octaves) {
    let sum = 0, amp = 1, freq = 1, norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * noise(x * freq + o * 17.13, y * freq - o * 9.71);
      norm += amp;
      amp *= 0.5;
      freq *= 2;
    }
    return sum / norm;
  }

  /* ======================================================================
   * Geometry helpers
   * ==================================================================== */
  function segsFor(length, spacing, min, max) {
    return clampInt(Math.ceil(Math.abs(length) / (spacing || SPACING)), min, max);
  }
  function circleSegs(r, spacing, min, max) {
    return segsFor(TAU * r, spacing || SPACING, min || 12, max || 4000);
  }

  // Closed circle polyline (segments + 1 points, last == first exactly).
  function circle(cx, cy, r, segments, startAngle) {
    const n = Math.max(3, Math.round(segments) || 3);
    const a0 = startAngle || 0;
    const out = new Array((n + 1) * 2);
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i % n) * TAU / n;
      out[2 * i] = cx + r * Math.cos(a);
      out[2 * i + 1] = cy + r * Math.sin(a);
    }
    return out;
  }

  function polarPush(pl, r, a) { pl.push(r * Math.cos(a), r * Math.sin(a)); }

  // Force exact closure: overwrite the last point with the first.
  function closeExact(pl) {
    const n = pl.length;
    if (n >= 4) { pl[n - 2] = pl[0]; pl[n - 1] = pl[1]; }
    return pl;
  }

  function rectPoly(hw, hh) {
    return [-hw, -hh, hw, -hh, hw, hh, -hw, hh, -hw, -hh];
  }

  function bbox(polys) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let k = 0; k < polys.length; k++) {
      const pl = polys[k];
      for (let i = 0; i + 1 < pl.length; i += 2) {
        const x = pl[i], y = pl[i + 1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }

  // Translate bbox centre to origin and scale uniformly so max(w, h) == size.
  // Operates in place; returns polys.
  function fitToSize(polys, size) {
    const b = bbox(polys);
    if (!(b.w >= 0) || !(b.h >= 0) || !isFinite(b.w) || !isFinite(b.h)) return polys;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const m = Math.max(b.w, b.h);
    const s = m > 1e-12 ? size / m : 1;
    for (let k = 0; k < polys.length; k++) {
      const pl = polys[k];
      for (let i = 0; i + 1 < pl.length; i += 2) {
        pl[i] = (pl[i] - cx) * s;
        pl[i + 1] = (pl[i + 1] - cy) * s;
      }
    }
    return polys;
  }

  function reversePts(pl) {
    const n = pl.length;
    const out = new Array(n);
    for (let i = 0; i < n; i += 2) {
      out[i] = pl[n - 2 - i];
      out[i + 1] = pl[n - 1 - i];
    }
    return out;
  }

  // Remove interior points that lie on a straight continuation.
  function simplifyCollinear(pl, eps) {
    const e = eps || 1e-9;
    const n = pl.length >> 1;
    if (n < 3) return pl;
    const out = [pl[0], pl[1]];
    for (let i = 1; i < n - 1; i++) {
      const ax = out[out.length - 2], ay = out[out.length - 1];
      const bx = pl[2 * i], by = pl[2 * i + 1];
      const cx = pl[2 * i + 2], cy = pl[2 * i + 3];
      const ux = bx - ax, uy = by - ay, vx = cx - bx, vy = cy - by;
      const cr = ux * vy - uy * vx;
      const dt = ux * vx + uy * vy;
      const scale = (Math.abs(ux) + Math.abs(uy)) * (Math.abs(vx) + Math.abs(vy));
      if (dt > 0 && Math.abs(cr) <= e * scale) continue;
      out.push(bx, by);
    }
    out.push(pl[2 * n - 2], pl[2 * n - 1]);
    return out;
  }

  // Liang-Barsky: clip segment to rect, returns [t0, t1] or null.
  function clipSeg(x0, y0, x1, y1, xmin, ymin, xmax, ymax) {
    let t0 = 0, t1 = 1;
    const dx = x1 - x0, dy = y1 - y0;
    const P = [-dx, dx, -dy, dy];
    const Q = [x0 - xmin, xmax - x0, y0 - ymin, ymax - y0];
    for (let k = 0; k < 4; k++) {
      const pk = P[k], qk = Q[k];
      if (pk === 0) {
        if (qk < 0) return null;
      } else {
        const r = qk / pk;
        if (pk < 0) {
          if (r > t1) return null;
          if (r > t0) t0 = r;
        } else {
          if (r < t0) return null;
          if (r < t1) t1 = r;
        }
      }
    }
    return [t0, t1];
  }

  // Clip a polyline to a rect; returns array of pieces (each >= 2 points).
  function clipPolyline(pl, xmin, ymin, xmax, ymax) {
    const out = [];
    let cur = null;
    for (let i = 0; i + 3 < pl.length; i += 2) {
      const x0 = pl[i], y0 = pl[i + 1], x1 = pl[i + 2], y1 = pl[i + 3];
      const r = clipSeg(x0, y0, x1, y1, xmin, ymin, xmax, ymax);
      if (!r || r[1] - r[0] < 1e-12) {
        if (cur) { out.push(cur); cur = null; }
        continue;
      }
      const ax = x0 + (x1 - x0) * r[0], ay = y0 + (y1 - y0) * r[0];
      const bx = x0 + (x1 - x0) * r[1], by = y0 + (y1 - y0) * r[1];
      if (!cur || r[0] > 0) {
        if (cur) out.push(cur);
        cur = [ax, ay];
      }
      cur.push(bx, by);
      if (r[1] < 1) { out.push(cur); cur = null; }
    }
    if (cur) out.push(cur);
    return out.filter((c) => c.length >= 4);
  }

  /*
   * Chain pieces (polylines) that share endpoint keys into long polylines.
   * sk[i] / ek[i] are numeric (or string) keys of piece i's start / end point;
   * pieces meeting at a key must have identical coordinates there.
   * Walks start from odd-degree nodes first so chains are as long as possible.
   */
  function chainPieces(pieces, sk, ek) {
    const n = pieces.length;
    const adj = new Map();
    const add = (k, i) => {
      const a = adj.get(k);
      if (a) a.push(i); else adj.set(k, [i]);
    };
    for (let i = 0; i < n; i++) { add(sk[i], i); add(ek[i], i); }
    const used = new Uint8Array(n);
    const nextAt = (k) => {
      const a = adj.get(k);
      if (!a) return -1;
      for (let j = 0; j < a.length; j++) if (!used[a[j]]) return a[j];
      return -1;
    };
    const odd = (k) => (adj.get(k).length & 1) === 1;
    const walk = (pts, key) => {
      let k = key;
      for (;;) {
        const i = nextAt(k);
        if (i < 0) return;
        used[i] = 1;
        const pc = pieces[i], L = pc.length;
        if (sk[i] === k) {
          for (let j = 2; j < L; j++) pts.push(pc[j]);
          k = ek[i];
        } else {
          for (let j = L - 4; j >= 0; j -= 2) pts.push(pc[j], pc[j + 1]);
          k = sk[i];
        }
      }
    };
    const out = [];
    const run = (i) => {
      used[i] = 1;
      let pts, s, e;
      if (odd(ek[i]) && !odd(sk[i])) {
        pts = reversePts(pieces[i]); s = ek[i]; e = sk[i];
      } else {
        pts = Array.from(pieces[i]); s = sk[i]; e = ek[i];
      }
      walk(pts, e);
      if (nextAt(s) >= 0) {
        pts = reversePts(pts);
        walk(pts, s);
      }
      out.push(pts);
    };
    for (let i = 0; i < n; i++) if (!used[i] && (odd(sk[i]) || odd(ek[i]))) run(i);
    for (let i = 0; i < n; i++) if (!used[i]) run(i);
    return out;
  }

  /* ----------------------------------------------------------------------
   * Parametric curve sampling
   * f(t) -> [x, y] in arbitrary "natural" units.
   * -------------------------------------------------------------------- */
  function measureCurve(f, t0, t1, probe) {
    let q = f(t0);
    let px = q[0], py = q[1];
    let minX = px, maxX = px, minY = py, maxY = py, len = 0;
    for (let i = 1; i <= probe; i++) {
      q = f(t0 + (t1 - t0) * i / probe);
      const x = q[0], y = q[1];
      const d = Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
      if (d === d) len += d;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      px = x; py = y;
    }
    return { len, ext: Math.max(maxX - minX, maxY - minY) };
  }

  function sampleCurve(f, t0, t1, n) {
    const out = new Array((n + 1) * 2);
    for (let i = 0; i <= n; i++) {
      const q = f(t0 + (t1 - t0) * i / n);
      out[2 * i] = q[0];
      out[2 * i + 1] = q[1];
    }
    return out;
  }

  // Sample so that once the curve is scaled to `size` (using `ext`, or the
  // curve's own measured extent) samples are ~SPACING mm apart. A uniform
  // probe pass builds a cumulative-length table; the final samples are then
  // placed at (approximately) equal arc-length intervals.
  function autoCurve(f, t0, t1, size, probe, maxPts, ext) {
    const M = clampInt(probe, 64, 400000);
    const cum = new Float64Array(M + 1);
    let q = f(t0);
    let px = q[0], py = q[1];
    let minX = px, maxX = px, minY = py, maxY = py;
    for (let i = 1; i <= M; i++) {
      q = f(t0 + (t1 - t0) * i / M);
      const x = q[0], y = q[1];
      const d = Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
      cum[i] = cum[i - 1] + (d === d ? d : 0);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      px = x; py = y;
    }
    const total = cum[M];
    const me = Math.max(maxX - minX, maxY - minY);
    const e = ext > 0 ? ext : (me > 0 ? me : 1);
    const lenMM = total * size / e;
    const n = clampInt(Math.ceil(lenMM / SPACING), 32, Math.max(32, maxPts || BUDGET));
    if (!(total > 0) || !isFinite(total)) return sampleCurve(f, t0, t1, n);
    const out = new Array((n + 1) * 2);
    let seg = 0;
    for (let j = 0; j <= n; j++) {
      const s = total * j / n;
      while (seg < M - 1 && cum[seg + 1] < s) seg++;
      const a = cum[seg], b = cum[seg + 1];
      const u = b > a ? clamp((s - a) / (b - a), 0, 1) : 0;
      const r = j === n ? f(t1) : f(t0 + (t1 - t0) * (seg + u) / M);
      out[2 * j] = r[0];
      out[2 * j + 1] = r[1];
    }
    return out;
  }

  /* ======================================================================
   * Param descriptor helpers
   * ==================================================================== */
  function pRange(key, label, min, max, step, def) {
    return { key, label, type: 'range', min, max, step, default: def };
  }
  function pInt(key, label, min, max, def) {
    return { key, label, type: 'int', min, max, step: 1, default: def };
  }
  function pSelect(key, label, options, def) {
    return {
      key, label, type: 'select',
      options: options.map((o) => ({ value: o[0], label: o[1] })),
      default: def,
    };
  }
  function pCheck(key, label, def) { return { key, label, type: 'checkbox', default: def }; }
  function pSize(def) { return pRange('size', 'Size (mm)', 10, 250, 1, def); }
  function pWidth(def) { return pRange('width', 'Width (mm)', 10, 250, 1, def); }
  function pHeight(def) { return pRange('height', 'Height (mm)', 10, 250, 1, def); }
  function pSeed(def) {
    return { key: 'seed', label: 'Seed', type: 'seed', min: 0, max: 99999, step: 1, default: def };
  }

  /* ======================================================================
   * CURVES
   * ==================================================================== */

  function genSpirograph(p) {
    const R = p.R;
    const epi = p.mode === 'epi';
    let r = p.r;
    if (!epi && r === R) r = R - 1;               // R == r degenerates to a point
    const g = gcd(R, r);
    const d = p.d * r;                             // pen distance from gear centre
    const k = epi ? R + r : R - r;                 // may be negative (r > R)
    const turns = lcm(R, r) / R;                   // gear-centre revolutions to close (= r/g)
    const T = TAU * turns;
    const w = k / r;
    const f = epi
      ? (t) => [k * Math.cos(t) - d * Math.cos(w * t), k * Math.sin(t) - d * Math.sin(w * t)]
      : (t) => [k * Math.cos(t) + d * Math.cos(w * t), k * Math.sin(t) - d * Math.sin(w * t)];
    const probe = 64 * (turns + Math.abs(k) / g) + 512;
    const ext = 2 * (Math.abs(k) + d);
    const pl = autoCurve(f, 0, T, p.size, probe, BUDGET, ext);
    closeExact(pl);
    return fitToSize([pl], p.size);
  }

  function genLissajous(p) {
    const a = p.a, b = p.b;
    const g = gcd(a, b);
    const period = TAU / g;
    const damp = p.damping;
    const turns = damp > 0 ? p.turns : 1;          // undamped: extra turns would retrace
    const ph = p.phase * DEG;
    const f = (t) => {
      const e = damp > 0 ? Math.exp(-damp * t / period) : 1;
      return [e * Math.sin(a * t + ph), e * Math.sin(b * t)];
    };
    const probe = 64 * ((a + b) / g) * turns + 256;
    const pl = autoCurve(f, 0, period * turns, p.size, probe, BUDGET);
    if (damp === 0) closeExact(pl);
    return fitToSize([pl], p.size);
  }

  function genHarmonograph(p) {
    // Two damped pendulums per axis:
    //   x = eA sin((A + detune) t)        + mix * eB sin(B t)
    //   y = eA sin(A t + phaseA)           + mix * eB sin(B t + phaseB)
    // phaseA = 90, phaseB = 270 gives the classic rotary rosette;
    // phaseA = 180, phaseB = 0 gives a lateral A:B figure (rotated 45 deg).
    const A = p.f1, B = p.f2, dt = p.detune, m = p.mix;
    const pa = p.phaseA * DEG, pb = p.phaseB * DEG;
    const dA = p.damping, dB = p.damping * 1.6;
    const T = p.duration;
    const f = (t) => {
      const eA = Math.exp(-dA * t), eB = m * Math.exp(-dB * t);
      return [
        eA * Math.sin((A + dt) * t) + eB * Math.sin(B * t),
        eA * Math.sin(A * t + pa) + eB * Math.sin(B * t + pb),
      ];
    };
    const probe = T * Math.max(A, B) * 12 + 512;
    const pl = autoCurve(f, 0, T, p.size, probe, BUDGET);
    return fitToSize([pl], p.size);
  }

  function genRose(p) {
    let n = p.n, d = p.d;
    const g = gcd(n, d);
    n /= g; d /= g;
    const k = n / d;
    const T = ((n * d) % 2 === 1) ? Math.PI * d : TAU * d;
    const layers = p.layers;
    const out = [];
    const perMax = Math.floor(BUDGET / layers);
    const probe = 128 * (n + d) + 512;
    for (let i = 0; i < layers; i++) {
      const s = (layers - i) / layers;
      const rot = i * p.rotate * DEG;
      const f = (t) => {
        const r = s * Math.cos(k * t);
        return [r * Math.cos(t + rot), r * Math.sin(t + rot)];
      };
      const pl = autoCurve(f, 0, T, p.size, probe, perMax, 2);
      closeExact(pl);
      out.push(pl);
    }
    return fitToSize(out, p.size);
  }

  function genSuperformula(p) {
    const m = p.m, n1 = p.n1, n2 = p.n2, n3 = p.n3;
    const radius = (phi) => {
      const t = m * phi / 4;
      const base = Math.pow(Math.abs(Math.cos(t)), n2) + Math.pow(Math.abs(Math.sin(t)), n3);
      if (!(base > 1e-300)) return 1e4;
      const r = Math.pow(base, -1 / n1);
      return r === r ? Math.min(r, 1e4) : 0;
    };
    const base = (phi) => { const r = radius(phi); return [r * Math.cos(phi), r * Math.sin(phi)]; };
    const probe = 512 * (m + 2);
    const copies = p.copies;
    // Sample the full-size shape once; smaller copies reuse every k-th point
    // (copies are scaled + rotated versions, so spacing stays ~SPACING).
    const strides = [];
    let frac = 0;
    for (let i = 0; i < copies; i++) {
      const k = Math.max(1, Math.round(copies / (copies - i)));   // ~1/scale
      strides.push(k);
      frac += 1 / k;
    }
    const basePl = closeExact(autoCurve(base, 0, TAU, p.size, probe, Math.floor(BUDGET / frac)));
    const nPts = basePl.length >> 1;
    const out = [];
    for (let i = 0; i < copies; i++) {
      const s = (copies - i) / copies;
      const rot = i * p.twist * DEG;
      const c = Math.cos(rot), sn = Math.sin(rot);
      const k = Math.max(1, Math.min(strides[i], Math.floor(nPts / 32)));
      const pl = [];
      for (let j = 0; j < nPts; j += k) {
        const x = basePl[2 * j] * s, y = basePl[2 * j + 1] * s;
        pl.push(x * c - y * sn, x * sn + y * c);
      }
      if ((nPts - 1) % k !== 0) {
        const x = basePl[2 * nPts - 2] * s, y = basePl[2 * nPts - 1] * s;
        pl.push(x * c - y * sn, x * sn + y * c);
      }
      out.push(closeExact(pl));
    }
    return fitToSize(out, p.size);
  }

  function genSpiral(p) {
    const R = p.size / 2;
    const theta = p.turns * TAU;
    const maxN = BUDGET;
    const pts = [];
    if (p.type === 'fermat') {
      // r = c*sqrt(theta); parametrise by u = sqrt(theta) so the centre is smooth.
      const U = Math.sqrt(theta);
      const c = R / U;
      const arm = [0, 0];
      let u = 0;
      while (u < U && arm.length < maxN) {
        const speed = c * Math.sqrt(1 + 4 * u * u * u * u);
        let du = SPACING / speed;
        if (u > 0) du = Math.min(du, 0.05 / u);   // keep d(theta) <= 0.1 rad
        du = Math.min(du, U / 16);
        u = Math.min(u + du, U);
        const th = u * u;
        arm.push(c * u * Math.cos(th), c * u * Math.sin(th));
      }
      // negative arm (outer -> centre), then positive arm (centre -> outer)
      for (let i = arm.length - 2; i >= 0; i -= 2) pts.push(-arm[i], -arm[i + 1]);
      for (let i = 2; i < arm.length; i += 2) pts.push(arm[i], arm[i + 1]);
      return [pts];
    }
    if (p.type === 'log') {
      const q = Math.max(p.inner, 0.005);
      const bq = Math.log(1 / q) / theta;           // r = R * q^(1 - th/theta)
      let th = 0;
      for (;;) {
        const r = R * Math.pow(q, 1 - th / theta);
        pts.push(r * Math.cos(th), r * Math.sin(th));
        if (th >= theta || pts.length >= maxN) break;
        const speed = r * Math.sqrt(1 + bq * bq);
        th = Math.min(th + Math.min(SPACING / speed, 0.1), theta);
      }
      return [pts];
    }
    // archimedean
    const r0 = p.inner * R;
    const b = (R - r0) / theta;
    let th = 0;
    for (;;) {
      const r = r0 + b * th;
      pts.push(r * Math.cos(th), r * Math.sin(th));
      if (th >= theta || pts.length >= maxN) break;
      const speed = Math.sqrt(r * r + b * b);
      th = Math.min(th + Math.min(SPACING / speed, 0.1), theta);
    }
    return [pts];
  }

  /* ======================================================================
   * GEOMETRIC
   * ==================================================================== */

  // ---- Mandala motifs. Each fills the band [ri, ro] with `count` repeats
  // (count is a multiple of the symmetry order). `off` is 0 or 0.5 elements.
  function motifPetals(out, ri, ro, count, off, rnd) {
    const w = ro - ri;
    const hs = Math.PI / count;
    const pointed = rnd() < 0.6;
    const prof = pointed
      ? (u) => Math.sqrt(Math.max(0, 1 - Math.abs(u)))
      : (u) => Math.sqrt(Math.max(0, 1 - u * u));
    const h = w * 0.94;
    const per = clampInt(Math.ceil((2 * h + 2 * hs * ro) / SPACING), 12, 400);
    const pl = [];
    for (let j = 0; j < count; j++) {
      const a0 = (j + off) * 2 * hs;
      for (let k = (j === 0 ? 0 : 1); k <= per; k++) {
        const u = -1 + 2 * k / per;
        polarPush(pl, ri + h * prof(u), a0 + u * hs);
      }
    }
    out.push(closeExact(pl));
    if (rnd() < 0.55) {
      // nested inner petals joined by arcs along the band's inner edge
      const ri2 = ri + w * 0.12;
      const h2 = w * 0.5;
      const span = 0.62;
      const per2 = clampInt(Math.ceil((2 * hs * ri2 + 2 * h2) / SPACING), 16, 400);
      const pl2 = [];
      for (let j = 0; j < count; j++) {
        const a0 = (j + off) * 2 * hs;
        for (let k = (j === 0 ? 0 : 1); k <= per2; k++) {
          const u = -1 + 2 * k / per2;
          const v = u / span;
          const r = Math.abs(v) < 1 ? ri2 + h2 * prof(v) : ri2;
          polarPush(pl2, r, a0 + u * hs);
        }
      }
      out.push(closeExact(pl2));
    }
  }

  function motifCircles(out, ri, ro, count, off, rnd) {
    const w = ro - ri, rm = (ri + ro) / 2;
    const cr = Math.min(w * 0.44, Math.PI * rm / count * 0.92);
    const dbl = rnd() < 0.45 && cr > 1.5;
    for (let j = 0; j < count; j++) {
      const a = (j + off) * TAU / count;
      const cx = rm * Math.cos(a), cy = rm * Math.sin(a);
      out.push(circle(cx, cy, cr, circleSegs(cr), a + Math.PI));
      if (dbl) out.push(circle(cx, cy, cr * 0.5, circleSegs(cr * 0.5), a + Math.PI));
    }
  }

  function motifZigzag(out, ri, ro, count, off, rnd) {
    const w = ro - ri, mg = w * 0.1;
    const lines = rnd() < 0.5 ? 2 : 1;
    for (let L = 0; L < lines; L++) {
      const shift = L * 0.5;
      const pl = [];
      for (let k = 0; k <= 2 * count; k++) {
        const a = (k / 2 + off + shift) * TAU / count;
        polarPush(pl, (k % 2 === 0) ? ri + mg : ro - mg, a);
      }
      out.push(closeExact(pl));
    }
  }

  function motifDots(out, ri, ro, count, off) {
    const w = ro - ri, rm = (ri + ro) / 2;
    const dr = clamp(w * 0.12, 0.35, 1.4);
    const rows = w > 10 * dr ? 2 : 1;
    for (let row = 0; row < rows; row++) {
      const rr = rows === 1 ? rm : ri + w * (row === 0 ? 0.3 : 0.7);
      const k = Math.max(1, Math.floor(TAU * rr / (count * dr * 4)));
      const n = count * k;
      const ro2 = row * 0.5;
      for (let j = 0; j < n; j++) {
        const a = (j + off * k + ro2) * TAU / n;
        out.push(circle(rr * Math.cos(a), rr * Math.sin(a), dr, clampInt(TAU * dr / 0.4, 12, 24), a));
      }
    }
  }

  function motifScallop(out, ri, ro, count, off, rnd) {
    const w = ro - ri, mg = w * 0.06, rm = (ri + ro) / 2;
    const inv = rnd() < 0.4;
    const layers = rnd() < 0.5 ? 2 : 1;
    for (let L = 0; L < layers; L++) {
      const h = (w - 2 * mg) * (L === 0 ? 1 : 0.55);
      const base = inv ? ro - mg : ri + mg;
      const sgn = inv ? -1 : 1;
      const len = count * (2 * h) + TAU * rm;
      let n = clampInt(Math.ceil(len / SPACING), count * 12, 40000);
      n = 2 * count * Math.ceil(n / (2 * count));   // cusps land exactly on samples
      const pl = new Array((n + 1) * 2);
      for (let k = 0; k <= n; k++) {
        const phi = k / n * TAU;
        const r = base + sgn * h * Math.abs(Math.sin(count * phi / 2 - off * Math.PI));
        pl[2 * k] = r * Math.cos(phi);
        pl[2 * k + 1] = r * Math.sin(phi);
      }
      out.push(closeExact(pl));
    }
  }

  function motifRope(out, ri, ro, count, off) {
    const w = ro - ri, rm = (ri + ro) / 2, A = w * 0.42;
    const seg = Math.sqrt(Math.pow(Math.PI * rm / count, 2) + Math.pow(2 * A, 2));
    let n = clampInt(Math.ceil(2 * count * seg / SPACING), count * 16, 40000);
    n = count * Math.ceil(n / count);
    for (let s = -1; s <= 1; s += 2) {
      const pl = new Array((n + 1) * 2);
      for (let k = 0; k <= n; k++) {
        const phi = k / n * TAU;
        const r = rm + s * A * Math.sin(count * phi - off * TAU);
        pl[2 * k] = r * Math.cos(phi);
        pl[2 * k + 1] = r * Math.sin(phi);
      }
      out.push(closeExact(pl));
    }
  }

  function mandalaCenter(out, rc, N, rnd) {
    const style = Math.floor(rnd() * 3);
    if (style === 0 || style === 2) {
      // rose with N petals: r = |cos(N phi / 2)|
      const rr = rc * (style === 0 ? 0.9 : 0.62);
      const n = clampInt(Math.ceil(N * 2.6 * rr / SPACING), N * 24, 20000);
      const pl = new Array((n + 1) * 2);
      for (let k = 0; k <= n; k++) {
        const phi = k / n * TAU;
        const r = rr * Math.abs(Math.cos(N * phi / 2));
        pl[2 * k] = r * Math.cos(phi);
        pl[2 * k + 1] = r * Math.sin(phi);
      }
      out.push(closeExact(pl));
      if (style === 2) out.push(circle(0, 0, rc * 0.75, circleSegs(rc * 0.75)));
    } else {
      // star polygon with N points, plus an inner ring
      const pl = [];
      for (let k = 0; k <= 2 * N; k++) {
        const kk = k % (2 * N);
        polarPush(pl, kk % 2 === 0 ? rc * 0.9 : rc * 0.45, Math.PI / 2 + kk * Math.PI / N);
      }
      out.push(pl);
      out.push(circle(0, 0, rc * 0.4, circleSegs(rc * 0.4)));
    }
    const dot = rc * 0.14;
    out.push(circle(0, 0, dot, circleSegs(dot)));
  }

  const MANDALA_MOTIFS = [
    { fn: motifPetals, w: 3 },
    { fn: motifScallop, w: 2 },
    { fn: motifCircles, w: 1.5 },
    { fn: motifZigzag, w: 1.5 },
    { fn: motifRope, w: 1.5 },
    { fn: motifDots, w: 1 },
  ];

  function genMandala(p) {
    const rnd = mulberry32(p.seed);
    const N = p.symmetry, rings = p.rings, R = p.size / 2;
    const out = [];
    const rc = R * (0.1 + 0.12 / rings);
    const ws = [];
    let tot = 0;
    for (let i = 0; i < rings; i++) { const w = 0.7 + 0.6 * rnd(); ws.push(w); tot += w; }
    const bounds = [rc];
    for (let i = 0; i < rings; i++) bounds.push(bounds[i] + ws[i] / tot * (R - rc));
    bounds[rings] = R;

    mandalaCenter(out, rc, N, rnd);
    for (let i = 0; i <= rings; i++) out.push(circle(0, 0, bounds[i], circleSegs(bounds[i]), Math.PI / 2));

    const wsum = MANDALA_MOTIFS.reduce((s, m) => s + m.w, 0);
    let prev = -1;
    for (let i = 0; i < rings; i++) {
      const ri = bounds[i], ro = bounds[i + 1];
      const w = ro - ri, rm = (ri + ro) / 2;
      let pick = -1;
      for (let tries = 0; tries < 8; tries++) {
        let x = rnd() * wsum;
        pick = 0;
        while (pick < MANDALA_MOTIFS.length - 1 && x >= MANDALA_MOTIFS[pick].w) {
          x -= MANDALA_MOTIFS[pick].w;
          pick++;
        }
        if (pick !== prev) break;
      }
      prev = pick;
      // element count: multiple of N whose arc width ~ target * band width
      const target = 0.55 + rnd() * 0.8;
      let mult = 1, best = Infinity;
      for (let m = 1; m <= 8; m++) {
        const dd = Math.abs(TAU * rm / (N * m) / w - target);
        if (dd < best) { best = dd; mult = m; }
      }
      const off = rnd() < 0.5 ? 0 : 0.5;
      MANDALA_MOTIFS[pick].fn(out, ri, ro, N * mult, off, rnd);
    }
    return out;
  }

  function genGuilloche(p) {
    const L = p.lines, k = p.lobes, env = p.rosette, depth = p.depth;
    const rIn = p.inner, rOut = 1;
    const rMid = (rIn + rOut) / 2;
    const a = p.amplitude * (rOut - rIn) / 2;
    const tw = p.twist;
    const make = (phase) => (t) => {
      const e = 1 + depth * Math.cos(env * t);
      const c = Math.cos(k * t + phase), s = Math.sin(k * t + phase);
      const rad = (rMid + a * c) * e;
      const tan = tw * a * s * e;
      const ct = Math.cos(t), st = Math.sin(t);
      return [rad * ct - tan * st, rad * st + tan * ct];
    };
    const probe = 40 * (k + env + 1) + 256;
    const ext = measureCurve(make(0), 0, TAU, probe).ext || 2;
    const perMax = Math.floor(BUDGET / L);
    const out = [];
    for (let j = 0; j < L; j++) {
      const pl = autoCurve(make(TAU * j / L), 0, TAU, p.size, probe, perMax, ext);
      out.push(closeExact(pl));
    }
    return fitToSize(out, p.size);
  }

  function genPolygons(p) {
    const n = p.sides;
    const out = [];
    const minScale = 0.2 / p.size;                // skip polygons < ~0.1 mm radius
    for (let i = 0; i < p.count; i++) {
      const s = Math.pow(p.scale, i);
      if (s < minScale) break;
      const rot = Math.PI / 2 + i * p.twist * DEG;
      const pl = [];
      if (p.star) {
        const m = 2 * n;
        for (let k = 0; k <= m; k++) {
          const kk = k % m;
          polarPush(pl, kk % 2 === 0 ? s : s * p.starInner, rot + kk * Math.PI / n);
        }
      } else {
        for (let k = 0; k <= n; k++) polarPush(pl, s, rot + (k % n) * TAU / n);
      }
      out.push(pl);
    }
    return fitToSize(out, p.size);
  }

  function genStarburst(p) {
    const R = p.size / 2, r0 = p.inner * R, n = p.rays;
    const outerR = (i) => r0 + (R - r0) * ((i % 2 === 1) ? p.alt : 1);
    const out = [];
    const d = TAU / n;
    if (p.connected) {
      const pl = [];
      for (let i = 0; i < n; i++) {
        const a = Math.PI / 2 + i * d;
        polarPush(pl, r0, a - d / 2);
        polarPush(pl, outerR(i), a);
      }
      pl.push(pl[0], pl[1]);
      out.push(pl);
    } else {
      for (let i = 0; i < n; i++) {
        const a = Math.PI / 2 + i * d;
        const c = Math.cos(a), s = Math.sin(a), ro = outerR(i);
        out.push(i % 2 === 0
          ? [r0 * c, r0 * s, ro * c, ro * s]
          : [ro * c, ro * s, r0 * c, r0 * s]);
      }
    }
    return out;
  }

  function genMoire(p) {
    const off = p.offset;
    const R = Math.max((p.size - off) / 2, p.size / 4);
    const sets = [[-off / 2, p.spacing], [off / 2, p.spacing * p.ratio]];
    let total = 0;
    const counts = sets.map((s) => {
      let n = Math.floor(R / s[1] + 1e-9);
      if (n < 1) { n = 1; s[1] = R; }            // spacing larger than radius: one circle
      n = Math.min(n, 2000);
      total += TAU * s[1] * n * (n + 1) / 2;
      return n;
    });
    const ptSp = Math.max(SPACING, total / BUDGET);
    const out = [];
    sets.forEach((s, si) => {
      for (let i = 1; i <= counts[si]; i++) {
        const r = i * s[1];
        out.push(circle(s[0], 0, r, circleSegs(r, ptSp, 16, 5000)));
      }
    });
    return out;
  }

  function genPhyllotaxis(p) {
    const R = p.size / 2, n = p.count, rdMax = p.dot / 2;
    const c = Math.max(R - rdMax, R * 0.2) / Math.sqrt(n);
    const ga = p.angle * DEG;
    const dots = [];
    for (let i = 0; i < n; i++) {
      const r = c * Math.sqrt(i + 0.5);
      const a = i * ga;
      const x = r * Math.cos(a), y = r * Math.sin(a);
      const rad = p.grow ? rdMax * (0.3 + 0.7 * Math.sqrt((i + 0.5) / n)) : rdMax;
      dots.push({ x, y, rad, band: Math.floor(r / (2 * c)), ang: Math.atan2(y, x) });
    }
    // polar boustrophedon ordering to keep pen travel short
    dots.sort((A, B) => (A.band - B.band) || ((A.band & 1) ? B.ang - A.ang : A.ang - B.ang));
    return dots.map((d) => circle(d.x, d.y, d.rad, clampInt(Math.ceil(TAU * d.rad / 0.4), 12, 36), d.ang));
  }

  /* ======================================================================
   * FRACTALS
   * ==================================================================== */

  function genHilbert(p) {
    const order = p.order;
    const n = 1 << order;
    const N = n * n;
    const pts = new Array(N * 2);
    for (let d = 0; d < N; d++) {
      let x = 0, y = 0, t = d;
      for (let s = 1; s < n; s *= 2) {
        const rx = (t >> 1) & 1;
        const ry = (t ^ rx) & 1;
        if (ry === 0) {
          if (rx === 1) { x = s - 1 - x; y = s - 1 - y; }
          const tmp = x; x = y; y = tmp;
        }
        x += s * rx;
        y += s * ry;
        t >>= 2;
      }
      pts[2 * d] = x;
      pts[2 * d + 1] = y;
    }
    const pl = simplifyCollinear(pts);
    const sc = p.size / (n - 1);
    for (let i = 0; i < pl.length; i++) pl[i] = pl[i] * sc - p.size / 2;
    return [pl];
  }

  function genKoch(p) {
    let P = [];
    for (let i = 0; i <= 3; i++) polarPush(P, 1, Math.PI / 2 + (i % 3) * TAU / 3); // CCW triangle
    const c = 0.5, s = (p.inward ? 1 : -1) * SQRT3 / 2;                            // rotate -60deg = outward
    for (let it = 0; it < p.iterations; it++) {
      const Q = [];
      for (let i = 0; i + 3 < P.length; i += 2) {
        const ax = P[i], ay = P[i + 1], bx = P[i + 2], by = P[i + 3];
        const dx = (bx - ax) / 3, dy = (by - ay) / 3;
        const p1x = ax + dx, p1y = ay + dy;
        Q.push(ax, ay, p1x, p1y, p1x + dx * c - dy * s, p1y + dx * s + dy * c, ax + 2 * dx, ay + 2 * dy);
      }
      Q.push(P[P.length - 2], P[P.length - 1]);
      P = Q;
    }
    closeExact(P);
    return fitToSize([P], p.size);
  }

  function genDragon(p) {
    const segs = 1 << p.iterations;
    const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];
    const raw = new Array((segs + 1) * 2);
    let x = 0, y = 0, dir = 0;
    raw[0] = 0; raw[1] = 0;
    for (let i = 1; i <= segs; i++) {
      x += DX[dir]; y += DY[dir];
      raw[2 * i] = x; raw[2 * i + 1] = y;
      if (i < segs) {
        const right = (((i & -i) << 1) & i) !== 0;
        dir = (dir + (right ? 3 : 1)) & 3;
      }
    }
    let pl = raw;
    const nPts = segs + 1;
    if (p.corners !== 'sharp' && nPts > 2) {
      const b = bbox([raw]);
      const unitMM = p.size / Math.max(b.w, b.h, 1);
      pl = [raw[0], raw[1]];
      if (p.corners === 'chamfer') {
        for (let i = 1; i < nPts - 1; i++) {
          const px = raw[2 * i], py = raw[2 * i + 1];
          pl.push(px + (raw[2 * i - 2] - px) * 0.25, py + (raw[2 * i - 1] - py) * 0.25);
          pl.push(px + (raw[2 * i + 2] - px) * 0.25, py + (raw[2 * i + 3] - py) * 0.25);
        }
      } else {
        // round: quadratic Bezier between segment midpoints with the vertex as control
        const k = clampInt(Math.ceil(0.4 * unitMM / SPACING), 2, 8);
        for (let i = 1; i < nPts - 1; i++) {
          const px = raw[2 * i], py = raw[2 * i + 1];
          const ax = (raw[2 * i - 2] + px) / 2, ay = (raw[2 * i - 1] + py) / 2;
          const bx = (raw[2 * i + 2] + px) / 2, by = (raw[2 * i + 3] + py) / 2;
          if (i === 1) pl.push(ax, ay);
          for (let j = 1; j <= k; j++) {
            const t = j / k, u = 1 - t;
            pl.push(u * u * ax + 2 * u * t * px + t * t * bx, u * u * ay + 2 * u * t * py + t * t * by);
          }
        }
      }
      pl.push(raw[2 * segs], raw[2 * segs + 1]);
    }
    return fitToSize([pl], p.size);
  }

  function genSierpinski(p) {
    const order = p.order;
    const CX = [], CY = [];
    for (let i = 0; i < 6; i++) { CX.push(Math.cos(i * Math.PI / 3)); CY.push(Math.sin(i * Math.PI / 3)); }
    const pts = [0, 0];
    let x = 0, y = 0, h = 0;                       // heading in units of 60deg
    const curve = (o, ang) => {
      if (o === 0) {
        x += CX[h]; y += CY[h];
        pts.push(x, y);
        return;
      }
      curve(o - 1, -ang);
      h = (h + ang + 6) % 6;
      curve(o - 1, ang);
      h = (h + ang + 6) % 6;
      curve(o - 1, -ang);
    };
    if ((order & 1) === 0) {
      curve(order, 1);
    } else {
      h = 1;
      curve(order, -1);
    }
    // orient as an upward-pointing triangle (bulk of the curve above the base)
    let sy = 0;
    for (let i = 1; i < pts.length; i += 2) sy += pts[i];
    if (sy < 0) for (let i = 1; i < pts.length; i += 2) pts[i] = -pts[i];
    return fitToSize([simplifyCollinear(pts)], p.size);
  }

  function genTree(p) {
    const rnd = mulberry32(p.seed);
    const depth = p.depth, spread = p.angle * DEG, ratio = p.ratio, jit = p.jitter;
    const out = [];
    const grow = (chain, x, y, ang, len, lvl) => {
      const a = lvl > 1 ? ang + (rnd() * 2 - 1) * jit * 0.4 : ang;
      const L = len * (1 + (rnd() * 2 - 1) * jit * 0.35);
      const nx = x + L * Math.cos(a), ny = y + L * Math.sin(a);
      chain.push(nx, ny);
      if (lvl >= depth) return;
      const sL = spread * (1 + (rnd() * 2 - 1) * jit * 0.3);
      const sR = spread * (1 + (rnd() * 2 - 1) * jit * 0.3);
      grow(chain, nx, ny, a + sL, len * ratio, lvl + 1);      // first child continues the chain
      const c2 = [nx, ny];                                     // second child starts a new chain
      out.push(c2);
      grow(c2, nx, ny, a - sR, len * ratio, lvl + 1);
    };
    const trunk = [0, 0];
    out.push(trunk);
    grow(trunk, 0, 0, Math.PI / 2, 1, 1);
    return fitToSize(out, p.size);
  }

  /* ======================================================================
   * TILING
   * ==================================================================== */

  function genGrid(p) {
    const W = p.width, H = p.height, hw = W / 2, hh = H / 2;
    const out = [];
    if (p.style === 'square' || p.style === 'dots') {
      const s = Math.min(p.spacing, W, H);
      const nx = Math.max(1, Math.floor(W / s + 1e-9));
      const ny = Math.max(1, Math.floor(H / s + 1e-9));
      const gx0 = -nx * s / 2, gy0 = -ny * s / 2, gx1 = -gx0, gy1 = -gy0;
      if (p.style === 'square') {
        for (let j = 0; j <= ny; j++) {
          const y = gy0 + j * s;
          out.push(j % 2 === 0 ? [gx0, y, gx1, y] : [gx1, y, gx0, y]);
        }
        const endRight = ny % 2 === 0;               // where the last horizontal ended
        for (let k = 0; k <= nx; k++) {
          const x = gx0 + (endRight ? nx - k : k) * s;
          out.push(k % 2 === 0 ? [x, gy1, x, gy0] : [x, gy0, x, gy1]);
        }
      } else {
        const arm = Math.min(p.mark, s * 0.9) / 2;
        for (let j = 0; j <= ny; j++) {
          const y = gy0 + j * s;
          const rev = j % 2 === 1;
          for (let k = 0; k <= nx; k++) {
            const x = gx0 + (rev ? nx - k : k) * s;
            out.push(rev ? [x + arm, y, x - arm, y] : [x - arm, y, x + arm, y]);
            out.push([x, y + arm, x, y - arm]);
          }
        }
      }
    } else if (p.style === 'iso') {
      const s = p.spacing, h0 = s * SQRT3 / 2, L = Math.hypot(W, H);
      [0, 60, 120].forEach((deg) => {
        const a = deg * DEG, dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
        const K = Math.floor((hw * Math.abs(nx) + hh * Math.abs(ny)) / h0 + 1e-9);
        let flip = false;
        for (let k = -K; k <= K; k++) {
          const px = k * h0 * nx, py = k * h0 * ny;
          const ax = px - dx * L, ay = py - dy * L, bx = px + dx * L, by = py + dy * L;
          const r = clipSeg(ax, ay, bx, by, -hw, -hh, hw, hh);
          if (!r || (r[1] - r[0]) * 2 * L < 1e-6) continue;
          const x0 = ax + (bx - ax) * r[0], y0 = ay + (by - ay) * r[0];
          const x1 = ax + (bx - ax) * r[1], y1 = ay + (by - ay) * r[1];
          out.push(flip ? [x1, y1, x0, y0] : [x0, y0, x1, y1]);
          flip = !flip;
        }
      });
    } else {
      // hexagons (pointy-top): shared zigzag rows + vertical edges
      const Wd = p.spacing, a = Wd / SQRT3, vs = 1.5 * a;
      const rmin = Math.floor(-hh / vs) - 1, rmax = Math.ceil(hh / vs) + 1;
      const kmin = Math.floor(-hw / Wd) - 2, kmax = Math.ceil(hw / Wd) + 2;
      let flip = false;
      for (let r = rmin - 1; r <= rmax; r++) {
        const cy = r * vs, off = (r & 1) ? Wd / 2 : 0;
        const zz = [];
        for (let k = kmin; k <= kmax; k++) {
          zz.push(off + k * Wd, cy + a);
          zz.push(off + (k + 0.5) * Wd, cy + a / 2);
        }
        let pieces = clipPolyline(zz, -hw, -hh, hw, hh);
        if (flip) pieces = pieces.reverse().map(reversePts);
        pieces.forEach((pc) => out.push(pc));
        if (pieces.length) flip = !flip;
      }
      flip = false;
      for (let r = rmin; r <= rmax; r++) {
        const cy = r * vs, off = (r & 1) ? Wd / 2 : 0;
        const row = [];
        for (let k = kmin; k <= kmax; k++) {
          const x = off + (k + 0.5) * Wd;
          const pcs = clipPolyline([x, cy - a / 2, x, cy + a / 2], -hw, -hh, hw, hh);
          pcs.forEach((pc) => row.push(pc));
        }
        if (flip) row.reverse();
        row.forEach((pc) => out.push(pc));
        if (row.length) flip = !flip;
      }
    }
    if (p.border) out.push(rectPoly(hw, hh));
    return out;
  }

  function genTruchet(p) {
    const W = p.width, H = p.height, c = Math.min(p.cell, W, H);
    const nx = Math.max(1, Math.floor(W / c + 1e-9));
    const ny = Math.max(1, Math.floor(H / c + 1e-9));
    const x0 = -nx * c / 2, y0 = -ny * c / 2;
    const rnd = mulberry32(p.seed);
    const pieces = [], sk = [], ek = [];
    let out;
    if (p.style === 'diagonals') {
      const K = (i, j) => i * (ny + 1) + j;
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          if (rnd() < 0.5) {
            pieces.push([i, j, i + 1, j + 1]); sk.push(K(i, j)); ek.push(K(i + 1, j + 1));
          } else {
            pieces.push([i, j + 1, i + 1, j]); sk.push(K(i, j + 1)); ek.push(K(i + 1, j));
          }
        }
      }
      out = chainPieces(pieces, sk, ek).map((pl) => {
        const q = simplifyCollinear(pl);
        for (let k = 0; k < q.length; k += 2) { q[k] = x0 + q[k] * c; q[k + 1] = y0 + q[k + 1] * c; }
        return q;
      });
    } else {
      // arcs: quarter circles joining edge midpoints; keys on a half-cell lattice
      const M = 2 * ny + 1;
      const HK = (hx, hy) => hx * M + hy;
      const HX = (hx) => x0 + hx * c / 2, HY = (hy) => y0 + hy * c / 2;
      const r = c / 2;
      const na = clampInt(Math.ceil((Math.PI / 2) * r / SPACING), 4, 64);
      const arc = (ccx, ccy, a0, sx, sy, ex, ey) => {
        const pl = new Array((na + 1) * 2);
        for (let k = 0; k <= na; k++) {
          const a = a0 + (Math.PI / 2) * k / na;
          pl[2 * k] = ccx + r * Math.cos(a);
          pl[2 * k + 1] = ccy + r * Math.sin(a);
        }
        pl[0] = HX(sx); pl[1] = HY(sy);
        pl[2 * na] = HX(ex); pl[2 * na + 1] = HY(ey);
        pieces.push(pl); sk.push(HK(sx, sy)); ek.push(HK(ex, ey));
      };
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const xl = x0 + i * c, xr = xl + c, yb = y0 + j * c, yt = yb + c;
          const bi = 2 * i, bj = 2 * j;
          if (rnd() < 0.5) {
            arc(xl, yb, 0, bi + 1, bj, bi, bj + 1);                       // BL corner: bottom -> left
            arc(xr, yt, Math.PI, bi + 1, bj + 2, bi + 2, bj + 1);         // TR corner: top -> right
          } else {
            arc(xl, yt, -Math.PI / 2, bi, bj + 1, bi + 1, bj + 2);        // TL corner: left -> top
            arc(xr, yb, Math.PI / 2, bi + 2, bj + 1, bi + 1, bj);         // BR corner: right -> bottom
          }
        }
      }
      out = chainPieces(pieces, sk, ek);
    }
    if (p.border) out.push(rectPoly(nx * c / 2, ny * c / 2));
    return out;
  }

  function genMaze(p) {
    const W = p.width, H = p.height, c = Math.min(p.cell, W / 2, H / 2);
    const nx = Math.max(2, Math.floor(W / c + 1e-9));
    const ny = Math.max(2, Math.floor(H / c + 1e-9));
    const x0 = -nx * c / 2, y0 = -ny * c / 2;
    const rnd = mulberry32(p.seed);
    const N = nx * ny;
    const visited = new Uint8Array(N);
    const east = new Uint8Array(N).fill(1);   // wall between (x,y) and (x+1,y)
    const north = new Uint8Array(N).fill(1);  // wall between (x,y) and (x,y+1)
    const stack = new Int32Array(N);
    const nb = new Int32Array(4);
    let sp = 0;
    const start = Math.floor(rnd() * N);
    visited[start] = 1;
    stack[sp++] = start;
    while (sp > 0) {
      const cell = stack[sp - 1];
      const cx = cell % nx, cy = (cell - cx) / nx;
      let cnt = 0;
      if (cx > 0 && !visited[cell - 1]) nb[cnt++] = 0;
      if (cx < nx - 1 && !visited[cell + 1]) nb[cnt++] = 1;
      if (cy > 0 && !visited[cell - nx]) nb[cnt++] = 2;
      if (cy < ny - 1 && !visited[cell + nx]) nb[cnt++] = 3;
      if (cnt === 0) { sp--; continue; }
      const dir = nb[Math.floor(rnd() * cnt)];
      let nxt;
      if (dir === 0) { nxt = cell - 1; east[nxt] = 0; }
      else if (dir === 1) { nxt = cell + 1; east[cell] = 0; }
      else if (dir === 2) { nxt = cell - nx; north[nxt] = 0; }
      else { nxt = cell + nx; north[cell] = 0; }
      visited[nxt] = 1;
      stack[sp++] = nxt;
    }
    // wall segments on the integer corner lattice
    const pieces = [], sk = [], ek = [];
    const K = (i, j) => i * (ny + 1) + j;
    const seg = (i0, j0, i1, j1) => { pieces.push([i0, j0, i1, j1]); sk.push(K(i0, j0)); ek.push(K(i1, j1)); };
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const id = x + y * nx;
        if (x < nx - 1 && east[id]) seg(x + 1, y, x + 1, y + 1);
        if (y < ny - 1 && north[id]) seg(x, y + 1, x + 1, y + 1);
      }
    }
    for (let x = 0; x < nx; x++) { seg(x, 0, x + 1, 0); seg(x, ny, x + 1, ny); }
    for (let y = 0; y < ny; y++) {
      if (y !== ny - 1) seg(0, y, 0, y + 1);     // entrance: top-left
      if (y !== 0) seg(nx, y, nx, y + 1);         // exit: bottom-right
    }
    return chainPieces(pieces, sk, ek).map((pl) => {
      const q = simplifyCollinear(pl);
      for (let k = 0; k < q.length; k += 2) { q[k] = x0 + q[k] * c; q[k + 1] = y0 + q[k + 1] * c; }
      return q;
    });
  }

  /* ======================================================================
   * ORGANIC
   * ==================================================================== */

  function genWaves(p) {
    const W = p.width, H = p.height, n = p.lines;
    const A = p.amplitude, NA = p.noise, fr = p.frequency;
    const noise = makeNoise2D(p.seed);
    const margin = Math.min(A + NA, H * 0.45);
    const y0 = -H / 2 + margin, y1 = H / 2 - margin;
    const flat = (A === 0 || fr === 0) && NA === 0;
    const wl = fr > 0 ? W / fr : Infinity;
    const step = Math.max(Math.min(SPACING, wl / 24), n * W / BUDGET, 0.05);
    const m = flat ? 1 : Math.max(2, Math.ceil(W / step));
    const out = [];
    for (let i = 0; i < n; i++) {
      const yb = n === 1 ? 0 : y0 + (y1 - y0) * i / (n - 1);
      const ph = i * p.phase * DEG;
      const pl = new Array((m + 1) * 2);
      for (let k = 0; k <= m; k++) {
        const kk = (i % 2 === 0) ? k : m - k;
        const x = -W / 2 + W * kk / m;
        let y = yb + A * Math.sin(TAU * fr * kk / m + ph);
        if (NA > 0) y += NA * noise(x * 0.025, yb * 0.025);
        pl[2 * k] = x;
        pl[2 * k + 1] = y;
      }
      out.push(pl);
    }
    return out;
  }

  function genFlowfield(p) {
    const W = p.width, H = p.height, hw = W / 2, hh = H / 2;
    const noise = makeNoise2D(p.seed);
    const rnd = mulberry32((p.seed * 7919 + 17) >>> 0);
    const ns = p.noiseScale, turb = p.turbulence * TAU;
    const step = p.step;
    const half = Math.max(1, Math.ceil(p.length / step / 2));
    const sep = p.separation, sep2 = sep * sep;
    const ang = (x, y) => fbm(noise, x * ns, y * ns, 2) * turb;

    // coarse spatial hash of already drawn points (only when separation > 0)
    let cell = Math.max(sep, 0.25);
    let gx = Math.ceil(W / cell) + 1, gy = Math.ceil(H / cell) + 1;
    if (gx * gy > 2e6) {
      cell = Math.sqrt(W * H / 2e6) * 1.05;
      gx = Math.ceil(W / cell) + 1; gy = Math.ceil(H / cell) + 1;
    }
    const head = sep > 0 ? new Int32Array(gx * gy).fill(-1) : null;
    const px = [], py = [], nxt = [];
    const cellIdx = (x, y) => {
      const i = clampInt(Math.floor((x + hw) / cell), 0, gx - 1);
      const j = clampInt(Math.floor((y + hh) / cell), 0, gy - 1);
      return i + j * gx;
    };
    const insert = (x, y) => {
      const c = cellIdx(x, y);
      px.push(x); py.push(y); nxt.push(head[c]);
      head[c] = px.length - 1;
    };
    const tooClose = (x, y) => {
      const ci = Math.floor((x + hw) / cell), cj = Math.floor((y + hh) / cell);
      for (let j = cj - 1; j <= cj + 1; j++) {
        if (j < 0 || j >= gy) continue;
        for (let i = ci - 1; i <= ci + 1; i++) {
          if (i < 0 || i >= gx) continue;
          let k = head[i + j * gx];
          while (k >= 0) {
            const dx = px[k] - x, dy = py[k] - y;
            if (dx * dx + dy * dy < sep2) return true;
            k = nxt[k];
          }
        }
      }
      return false;
    };
    const inside = (x, y) => x >= -hw && x <= hw && y >= -hh && y <= hh;

    let work = 0;                                     // total integration steps (time cap)
    const MAX_WORK = 1500000;
    const trace = (sx, sy, dir) => {
      const pts = [];
      let x = sx, y = sy;
      for (let s = 0; s < half; s++) {
        work++;
        const a1 = ang(x, y);
        const mx = x + dir * Math.cos(a1) * step * 0.5, my = y + dir * Math.sin(a1) * step * 0.5;
        const a2 = ang(mx, my);
        const nx = x + dir * Math.cos(a2) * step, ny = y + dir * Math.sin(a2) * step;
        if (!inside(nx, ny)) {
          const r = clipSeg(x, y, nx, ny, -hw, -hh, hw, hh);
          if (r && r[1] > 1e-9) pts.push(x + (nx - x) * r[1], y + (ny - y) * r[1]);
          break;
        }
        if (sep > 0 && tooClose(nx, ny)) break;
        pts.push(nx, ny);
        x = nx; y = ny;
      }
      return pts;
    };

    const out = [];
    const minLen = Math.min(p.length * 0.2, Math.min(W, H) * 0.25, sep > 0 ? sep * 3 : Infinity);
    const minPts = Math.max(2, Math.floor(minLen / step) + 1);
    const every = sep > 0 ? Math.max(1, Math.floor(sep / (2 * step))) : 1;
    const maxAttempts = p.lines * (sep > 0 ? 6 : 1);
    let attempts = 0, total = 0;
    while (out.length < p.lines && attempts < maxAttempts && total < BUDGET && work < MAX_WORK) {
      attempts++;
      const sx = (rnd() - 0.5) * W, sy = (rnd() - 0.5) * H;
      if (sep > 0 && tooClose(sx, sy)) continue;
      const fwd = trace(sx, sy, 1);
      const bwd = trace(sx, sy, -1);
      const pl = [];
      for (let i = bwd.length - 2; i >= 0; i -= 2) pl.push(bwd[i], bwd[i + 1]);
      pl.push(sx, sy);
      for (let i = 0; i < fwd.length; i++) pl.push(fwd[i]);
      const np = pl.length >> 1;
      if (np < minPts) continue;
      out.push(pl);
      total += np;
      if (sep > 0) {
        for (let i = 0; i < np; i += every) insert(pl[2 * i], pl[2 * i + 1]);
        if ((np - 1) % every !== 0) insert(pl[2 * np - 2], pl[2 * np - 1]);
      }
    }
    return out;
  }

  function genTopo(p) {
    const W = p.width, H = p.height;
    let res = p.detail;
    const maxCells = 250000;
    if ((W / res + 1) * (H / res + 1) > maxCells) res = Math.sqrt(W * H / maxCells) * 1.02;
    const gx = Math.max(2, Math.ceil(W / res) + 1);
    const gy = Math.max(2, Math.ceil(H / res) + 1);
    const dx = W / (gx - 1), dy = H / (gy - 1);
    const x0 = -W / 2, y0 = -H / 2;
    const noise = makeNoise2D(p.seed);
    const v = new Float64Array(gx * gy);
    let vmin = Infinity, vmax = -Infinity;
    for (let j = 0; j < gy; j++) {
      for (let i = 0; i < gx; i++) {
        const val = fbm(noise, (x0 + i * dx) * p.scale, (y0 + j * dy) * p.scale, p.octaves);
        v[i + j * gx] = val;
        if (val < vmin) vmin = val;
        if (val > vmax) vmax = val;
      }
    }
    if (!(vmax > vmin)) return [];
    const HK = (i, j) => (i + j * (gx - 1)) * 2;       // edge (i,j)-(i+1,j)
    const VK = (i, j) => (i + j * gx) * 2 + 1;         // edge (i,j)-(i,j+1)
    const edgePos = (key, iso) => {
      const e = (key - (key & 1)) / 2;
      if ((key & 1) === 0) {
        const i = e % (gx - 1), j = (e - i) / (gx - 1);
        const a = v[i + j * gx], b = v[i + 1 + j * gx];
        const t = clamp((iso - a) / (b - a), 0, 1);
        return [x0 + (i + t) * dx, y0 + j * dy];
      }
      const i = e % gx, j = (e - i) / gx;
      const a = v[i + j * gx], b = v[i + (j + 1) * gx];
      const t = clamp((iso - a) / (b - a), 0, 1);
      return [x0 + i * dx, y0 + (j + t) * dy];
    };
    const out = [];
    let total = 0;
    for (let L = 1; L <= p.levels && total < BUDGET; L++) {
      const iso = vmin + (vmax - vmin) * L / (p.levels + 1);
      const pieces = [], sk = [], ek = [];
      const seg = (k1, k2) => {
        const a = edgePos(k1, iso), b = edgePos(k2, iso);
        pieces.push([a[0], a[1], b[0], b[1]]); sk.push(k1); ek.push(k2);
      };
      for (let j = 0; j < gy - 1; j++) {
        for (let i = 0; i < gx - 1; i++) {
          const id = i + j * gx;
          const v00 = v[id], v10 = v[id + 1], v01 = v[id + gx], v11 = v[id + gx + 1];
          let c = 0;
          if (v00 >= iso) c |= 1;
          if (v10 >= iso) c |= 2;
          if (v11 >= iso) c |= 4;
          if (v01 >= iso) c |= 8;
          if (c === 0 || c === 15) continue;
          const B = HK(i, j), T = HK(i, j + 1), Lf = VK(i, j), R = VK(i + 1, j);
          switch (c) {
            case 1: case 14: seg(Lf, B); break;
            case 2: case 13: seg(B, R); break;
            case 3: case 12: seg(Lf, R); break;
            case 4: case 11: seg(R, T); break;
            case 6: case 9: seg(B, T); break;
            case 7: case 8: seg(Lf, T); break;
            case 5:
              if ((v00 + v10 + v01 + v11) / 4 >= iso) { seg(B, R); seg(Lf, T); }
              else { seg(Lf, B); seg(R, T); }
              break;
            case 10:
              if ((v00 + v10 + v01 + v11) / 4 >= iso) { seg(Lf, B); seg(R, T); }
              else { seg(B, R); seg(Lf, T); }
              break;
            default: break;
          }
        }
      }
      const chains = chainPieces(pieces, sk, ek);
      for (let k = 0; k < chains.length; k++) {
        out.push(chains[k]);
        total += chains[k].length >> 1;
      }
    }
    if (p.border) out.push(rectPoly(W / 2, H / 2));
    return out;
  }

  /* ======================================================================
   * Descriptors (UI order)
   * ==================================================================== */
  const list = [
    // ---------------------------------------------------------------- Curves
    {
      id: 'spirograph', name: 'Spirograph', category: 'Curves',
      description: 'Gear-in-ring curves (hypotrochoid / epitrochoid) drawn until they close.',
      params: [
        pSize(100),
        pSelect('mode', 'Type', [['hypo', 'Hypotrochoid (inside)'], ['epi', 'Epitrochoid (outside)']], 'hypo'),
        pInt('R', 'Ring radius R', 10, 200, 96),
        pInt('r', 'Gear radius r', 1, 200, 40),
        pRange('d', 'Pen distance (x r)', 0.1, 2, 0.01, 0.85),
      ],
      generate: genSpirograph,
    },
    {
      id: 'lissajous', name: 'Lissajous', category: 'Curves',
      description: 'Two perpendicular sine oscillations; optional damping spirals inward.',
      params: [
        pSize(100),
        pInt('a', 'Frequency A (x)', 1, 20, 3),
        pInt('b', 'Frequency B (y)', 1, 20, 2),
        pRange('phase', 'Phase (deg)', 0, 180, 1, 90),
        pRange('damping', 'Damping per turn', 0, 0.5, 0.005, 0),
        pInt('turns', 'Turns (with damping)', 1, 60, 12),
      ],
      generate: genLissajous,
    },
    {
      id: 'harmonograph', name: 'Harmonograph', category: 'Curves',
      description: 'Two slowly decaying pendulums per axis with a slight detune.',
      params: [
        pSize(110),
        pRange('f1', 'Frequency A', 1, 8, 0.01, 3),
        pRange('f2', 'Frequency B', 1, 8, 0.01, 2),
        pRange('detune', 'Detune', -0.05, 0.05, 0.0005, 0.002),
        pRange('phaseA', 'Phase A (deg)', 0, 360, 1, 90),
        pRange('phaseB', 'Phase B (deg)', 0, 360, 1, 270),
        pRange('mix', 'Pendulum B strength', 0, 1, 0.01, 1),
        pRange('damping', 'Damping', 0.0005, 0.05, 0.0005, 0.004),
        pRange('duration', 'Duration', 20, 800, 1, 400),
      ],
      generate: genHarmonograph,
    },
    {
      id: 'rose', name: 'Rose Curve', category: 'Curves',
      description: 'Rhodonea r = cos(k*theta) with k = n/d, optionally layered.',
      params: [
        pSize(100),
        pInt('n', 'Numerator n', 1, 20, 5),
        pInt('d', 'Denominator d', 1, 20, 4),
        pInt('layers', 'Layers', 1, 20, 1),
        pRange('rotate', 'Layer rotation (deg)', -45, 45, 0.5, 0),
      ],
      generate: genRose,
    },
    {
      id: 'superformula', name: 'Superformula', category: 'Curves',
      description: 'Gielis superformula shapes with nested, rotated copies.',
      params: [
        pSize(100),
        pInt('m', 'Symmetry m', 0, 30, 5),
        pRange('n1', 'n1', 0.1, 40, 0.1, 2),
        pRange('n2', 'n2', 0, 40, 0.1, 7),
        pRange('n3', 'n3', 0, 40, 0.1, 7),
        pInt('copies', 'Copies', 1, 40, 8),
        pRange('twist', 'Twist per copy (deg)', -45, 45, 0.5, 3),
      ],
      generate: genSuperformula,
    },
    {
      id: 'spiral', name: 'Spiral', category: 'Curves',
      description: 'Archimedean, Fermat (double arm) or logarithmic spiral as one line.',
      params: [
        pSize(100),
        pSelect('type', 'Type', [['archimedean', 'Archimedean'], ['fermat', 'Fermat (double arm)'], ['log', 'Logarithmic']], 'archimedean'),
        pInt('turns', 'Turns', 1, 100, 12),
        pRange('inner', 'Inner radius (ratio, not Fermat)', 0, 0.9, 0.01, 0),
      ],
      generate: genSpiral,
    },
    // ------------------------------------------------------------- Geometric
    {
      id: 'mandala', name: 'Mandala', category: 'Geometric',
      description: 'Radially symmetric rings of petals, scallops, zig-zags, beads and dots.',
      params: [
        pSize(120),
        pInt('symmetry', 'Symmetry', 6, 24, 12),
        pInt('rings', 'Rings', 2, 10, 5),
        pSeed(1234),
      ],
      generate: genMandala,
    },
    {
      id: 'guilloche', name: 'Guilloche', category: 'Geometric',
      description: 'Banknote-style rosette of many phase-shifted wave rings.',
      params: [
        pSize(120),
        pInt('lines', 'Lines', 2, 120, 14),
        pInt('lobes', 'Lobes', 1, 60, 11),
        pRange('inner', 'Inner radius (ratio)', 0, 0.95, 0.01, 0.48),
        pRange('amplitude', 'Amplitude', 0.05, 1, 0.01, 0.75),
        pRange('twist', 'Twist', 0, 2, 0.01, 0.9),
        pInt('rosette', 'Rosette lobes', 0, 24, 6),
        pRange('depth', 'Rosette depth', 0, 0.4, 0.01, 0.12),
      ],
      generate: genGuilloche,
    },
    {
      id: 'polygons', name: 'Concentric Polygons', category: 'Geometric',
      description: 'Nested polygons or stars that shrink and twist step by step.',
      params: [
        pSize(100),
        pInt('sides', 'Sides', 3, 12, 6),
        pInt('count', 'Count', 1, 100, 24),
        pRange('twist', 'Twist per step (deg)', -30, 30, 0.5, 4),
        pRange('scale', 'Scale per step', 0.5, 1, 0.005, 0.93),
        pCheck('star', 'Star', false),
        pRange('starInner', 'Star inner ratio', 0.1, 0.95, 0.01, 0.5),
      ],
      generate: genPolygons,
    },
    {
      id: 'starburst', name: 'Starburst', category: 'Geometric',
      description: 'Radiating rays with alternating lengths, optionally one zig-zag line.',
      params: [
        pSize(100),
        pInt('rays', 'Rays', 4, 360, 60),
        pRange('inner', 'Inner radius (ratio)', 0, 0.9, 0.01, 0.12),
        pRange('alt', 'Alternate ray length', 0.1, 1, 0.01, 0.65),
        pCheck('connected', 'Connect as zig-zag', false),
      ],
      generate: genStarburst,
    },
    {
      id: 'moire', name: 'Moire Circles', category: 'Geometric',
      description: 'Two offset sets of concentric circles that interfere.',
      params: [
        pSize(120),
        pRange('spacing', 'Spacing (mm)', 0.5, 10, 0.1, 2.5),
        pRange('offset', 'Offset (mm)', 0, 60, 0.5, 8),
        pRange('ratio', 'Second set spacing ratio', 0.8, 1.25, 0.005, 1),
      ],
      generate: genMoire,
    },
    {
      id: 'phyllotaxis', name: 'Phyllotaxis', category: 'Geometric',
      description: 'Sunflower seed arrangement of dots placed at the golden angle.',
      params: [
        pSize(100),
        pInt('count', 'Dots', 10, 5000, 800),
        pRange('dot', 'Dot size (mm)', 0.2, 10, 0.1, 1.6),
        pCheck('grow', 'Grow dots with radius', true),
        pRange('angle', 'Angle (deg)', 130, 145, 0.01, 137.51),
      ],
      generate: genPhyllotaxis,
    },
    // -------------------------------------------------------------- Fractals
    {
      id: 'hilbert', name: 'Hilbert Curve', category: 'Fractals',
      description: 'Space-filling Hilbert curve as a single continuous line.',
      params: [pSize(100), pInt('order', 'Order', 1, 7, 5)],
      generate: genHilbert,
    },
    {
      id: 'koch', name: 'Koch Snowflake', category: 'Fractals',
      description: 'Koch snowflake (or anti-snowflake) as one closed line.',
      params: [pSize(100), pInt('iterations', 'Iterations', 0, 6, 4), pCheck('inward', 'Inward (anti-snowflake)', false)],
      generate: genKoch,
    },
    {
      id: 'dragon', name: 'Dragon Curve', category: 'Fractals',
      description: 'Heighway dragon as one continuous line.',
      params: [
        pSize(100),
        pInt('iterations', 'Iterations', 1, 16, 12),
        pSelect('corners', 'Corners', [['round', 'Rounded'], ['chamfer', 'Chamfered'], ['sharp', 'Sharp']], 'round'),
      ],
      generate: genDragon,
    },
    {
      id: 'sierpinski', name: 'Sierpinski Arrowhead', category: 'Fractals',
      description: 'Sierpinski triangle traced by the arrowhead curve in one line.',
      params: [pSize(100), pInt('order', 'Order', 1, 8, 6)],
      generate: genSierpinski,
    },
    {
      id: 'tree', name: 'Fractal Tree', category: 'Fractals',
      description: 'Recursive branching tree; one stroke per branch-to-leaf chain.',
      params: [
        pSize(110),
        pInt('depth', 'Depth', 1, 13, 10),
        pRange('angle', 'Branch angle (deg)', 5, 90, 0.5, 24),
        pRange('ratio', 'Length ratio', 0.5, 0.85, 0.01, 0.74),
        pRange('jitter', 'Jitter', 0, 1, 0.01, 0.25),
        pSeed(1234),
      ],
      generate: genTree,
    },
    // ---------------------------------------------------------------- Tiling
    {
      id: 'grid', name: 'Grid', category: 'Tiling',
      description: 'Square, dot, isometric or hexagonal grid.',
      params: [
        pWidth(150),
        pHeight(100),
        pRange('spacing', 'Spacing (mm)', 1, 50, 0.5, 10),
        pSelect('style', 'Style', [['square', 'Square lines'], ['dots', 'Dots (crosses)'], ['iso', 'Isometric'], ['hex', 'Hexagons']], 'square'),
        pRange('mark', 'Cross size (mm)', 0.5, 10, 0.1, 2),
        pCheck('border', 'Border', false),
      ],
      generate: genGrid,
    },
    {
      id: 'truchet', name: 'Truchet Tiles', category: 'Tiling',
      description: 'Randomly oriented arc or diagonal tiles chained into long paths.',
      params: [
        pWidth(150),
        pHeight(100),
        pRange('cell', 'Cell size (mm)', 2, 50, 0.5, 8),
        pSelect('style', 'Style', [['arcs', 'Arcs'], ['diagonals', 'Diagonals']], 'arcs'),
        pCheck('border', 'Border', false),
        pSeed(1234),
      ],
      generate: genTruchet,
    },
    {
      id: 'maze', name: 'Maze', category: 'Tiling',
      description: 'Perfect maze (recursive backtracker) with an entrance and exit.',
      params: [
        pWidth(150),
        pHeight(100),
        pRange('cell', 'Cell size (mm)', 2, 50, 0.5, 6),
        pSeed(1234),
      ],
      generate: genMaze,
    },
    // --------------------------------------------------------------- Organic
    {
      id: 'waves', name: 'Waves', category: 'Organic',
      description: 'Stacked sine waves with phase drift and noise, drawn back and forth.',
      params: [
        pWidth(150),
        pHeight(100),
        pInt('lines', 'Lines', 2, 200, 40),
        pRange('amplitude', 'Amplitude (mm)', 0, 30, 0.5, 5),
        pRange('frequency', 'Waves across', 0, 20, 0.1, 3),
        pRange('phase', 'Phase shift per line (deg)', -90, 90, 0.5, 8),
        pRange('noise', 'Noise (mm)', 0, 20, 0.1, 2),
        pSeed(1234),
      ],
      generate: genWaves,
    },
    {
      id: 'flowfield', name: 'Flow Field', category: 'Organic',
      description: 'Streamlines following a smooth noise angle field.',
      params: [
        pWidth(150),
        pHeight(100),
        pInt('lines', 'Lines', 10, 3000, 600),
        pRange('length', 'Line length (mm)', 5, 500, 1, 60),
        pRange('noiseScale', 'Noise scale', 0.002, 0.08, 0.001, 0.012),
        pRange('turbulence', 'Turbulence', 0.25, 4, 0.05, 1),
        pRange('step', 'Step (mm)', 0.2, 5, 0.1, 0.8),
        pRange('separation', 'Min separation (mm, 0 = off)', 0, 10, 0.1, 1.5),
        pSeed(1234),
      ],
      generate: genFlowfield,
    },
    {
      id: 'topo', name: 'Topographic', category: 'Organic',
      description: 'Contour lines of a noise height field (marching squares).',
      params: [
        pWidth(150),
        pHeight(100),
        pInt('levels', 'Levels', 2, 60, 16),
        pRange('scale', 'Noise scale', 0.002, 0.08, 0.001, 0.012),
        pInt('octaves', 'Octaves', 1, 6, 3),
        pRange('detail', 'Grid resolution (mm)', 0.5, 5, 0.1, 1),
        pCheck('border', 'Border', false),
        pSeed(1234),
      ],
      generate: genTopo,
    },
  ];

  const byId = new Map(list.map((d) => [d.id, d]));

  function get(id) { return byId.get(id); }

  function defaults(id) {
    const d = byId.get(id);
    const out = {};
    if (!d) return out;
    for (const prm of d.params) out[prm.key] = prm.default;
    return out;
  }

  function normalizeParams(d, params) {
    const p = defaults(d.id);
    const src = params || {};
    for (const prm of d.params) {
      const k = prm.key;
      let v = Object.prototype.hasOwnProperty.call(src, k) ? src[k] : p[k];
      switch (prm.type) {
        case 'range':
        case 'int':
        case 'seed': {
          v = Number(v);
          if (!Number.isFinite(v)) v = Number(prm.default);
          const lo = prm.min != null ? prm.min : -Infinity;
          const hi = prm.max != null ? prm.max : Infinity;
          v = clamp(v, lo, hi);
          if (prm.type !== 'range') v = Math.round(v);
          break;
        }
        case 'select':
          if (!prm.options.some((o) => o.value === v)) v = prm.default;
          break;
        case 'checkbox':
          v = v === true || v === 'true' || v === 1 || v === '1' || v === 'on';
          break;
        default:
          break;
      }
      p[k] = v;
    }
    return p;
  }

  // Keep only finite points; split at invalid points; drop zero-length steps
  // and polylines with fewer than 2 points; enforce the global point cap.
  function sanitize(polys) {
    const out = [];
    if (!Array.isArray(polys)) return out;
    let total = 0;
    for (let k = 0; k < polys.length && total < MAX_POINTS; k++) {
      const pl = polys[k];
      if (!pl || typeof pl.length !== 'number' || pl.length < 4) continue;
      let cur = [];
      for (let i = 0; i + 1 < pl.length; i += 2) {
        const x = +pl[i], y = +pl[i + 1];
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          if (cur.length >= 4) { out.push(cur); total += cur.length >> 1; }
          cur = [];
          continue;
        }
        const n = cur.length;
        if (n >= 2 && cur[n - 2] === x && cur[n - 1] === y) continue;
        cur.push(x, y);
      }
      if (cur.length >= 4) { out.push(cur); total += cur.length >> 1; }
    }
    return out;
  }

  function generate(id, params) {
    const d = byId.get(id);
    if (!d) return [];
    const p = normalizeParams(d, params);
    let res;
    try {
      res = d.generate(p);
    } catch (err) {
      if (typeof console !== 'undefined') console.error('[PP.Patterns] ' + id + ' failed:', err);
      return [];
    }
    return sanitize(res);
  }

  PP.Patterns = {
    list,
    get,
    defaults,
    generate,
    // exposed for reuse by other modules (not required by the UI)
    util: { mulberry32, makeNoise2D, fbm, bbox, fitToSize, circle, chainPieces, simplifyCollinear, clipPolyline, gcd, lcm },
  };
})(window.PP = window.PP || {});
