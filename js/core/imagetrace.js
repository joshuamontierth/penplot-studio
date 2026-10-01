/*
 * imagetrace.js - raster image -> pen-plottable vector polylines.
 *
 * Classic browser script (no modules, no dependencies). Exposes PP.ImageTrace.
 *
 * Coordinate convention (every mode): pixel coordinates of the gray image,
 * x to the right, y DOWN. Pixel (i, j) covers [i, i+1] x [j, j+1] and its
 * centre is (i + 0.5, j + 0.5). Output points lie inside [0, width] x [0, height]
 * (stipple circles may overhang the border by up to one dot radius).
 *
 * A polyline is a flat plain Array [x0, y0, x1, y1, ...] with >= 2 points.
 * Closed loops repeat their first point at the end.
 */
(function (PP) {
  'use strict';

  // ---------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------

  const TAU = Math.PI * 2;
  // 8-neighbourhood, index d = 0..7: E, SE, S, SW, W, NW, N, NE (opposite = d ^ 4).
  const DX8 = [1, 1, 0, -1, -1, -1, 0, 1];
  const DY8 = [0, 1, 1, 1, 0, -1, -1, -1];

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function num(v, def) {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
  }

  function polyLength(pts) {
    let len = 0;
    for (let i = 2; i < pts.length - 1; i += 2) {
      const dx = pts[i] - pts[i - 2], dy = pts[i + 1] - pts[i - 1];
      len += Math.sqrt(dx * dx + dy * dy);
    }
    return len;
  }

  // Absolute enclosed area of a closed polyline (last point == first point).
  function polyArea(pts) {
    let s = 0;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      s += pts[i] * pts[i + 3] - pts[i + 2] * pts[i + 1];
    }
    return Math.abs(s) * 0.5;
  }

  function isClosed(pts) {
    const n = pts.length;
    return n >= 6 && pts[0] === pts[n - 2] && pts[1] === pts[n - 1];
  }

  // Deterministic PRNG (mulberry32), returns floats in [0, 1).
  function mulberry32(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Bilinear sampler over a gray image. (x, y) in pixel coordinates (centres at +0.5),
  // clamped to the image. Requires width >= 2 and height >= 2.
  function makeSampler(g) {
    const w = g.width, d = g.data, wm = g.width - 1, hm = g.height - 1;
    return function (x, y) {
      let fx = x - 0.5, fy = y - 0.5;
      if (fx < 0) fx = 0; else if (fx > wm) fx = wm;
      if (fy < 0) fy = 0; else if (fy > hm) fy = hm;
      let ix = fx | 0, iy = fy | 0;
      if (ix >= wm) ix = wm - 1;
      if (iy >= hm) iy = hm - 1;
      const tx = fx - ix, ty = fy - iy, i = iy * w + ix;
      const a = d[i], b = d[i + 1], c = d[i + w], e = d[i + w + 1];
      const top = a + (b - a) * tx, bot = c + (e - c) * tx;
      return top + (bot - top) * ty;
    };
  }

  // Separable gaussian blur with edge clamping. Returns `src` itself when sigma is ~0
  // (callers must treat the result as read-only in that case).
  function gaussianBlur(src, w, h, sigma) {
    if (!(sigma >= 0.05) || w < 1 || h < 1) return src;
    const r = Math.max(1, Math.ceil(sigma * 3));
    const ks = 2 * r + 1;
    const kern = new Float32Array(ks);
    let ksum = 0;
    for (let k = 0; k < ks; k++) {
      const x = k - r;
      kern[k] = Math.exp(-(x * x) / (2 * sigma * sigma));
      ksum += kern[k];
    }
    for (let k = 0; k < ks; k++) kern[k] /= ksum;

    // Horizontal pass through a padded row buffer.
    const tmp = new Float32Array(w * h);
    const row = new Float32Array(w + 2 * r);
    for (let y = 0; y < h; y++) {
      const base = y * w;
      for (let i = 0; i < w + 2 * r; i++) {
        let sx = i - r;
        if (sx < 0) sx = 0; else if (sx >= w) sx = w - 1;
        row[i] = src[base + sx];
      }
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let k = 0; k < ks; k++) s += kern[k] * row[x + k];
        tmp[base + x] = s;
      }
    }
    // Vertical pass, accumulated row by row (cache friendly).
    const dst = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const yo = y * w;
      for (let k = 0; k < ks; k++) {
        let yy = y + k - r;
        if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1;
        const wk = kern[k], so = yy * w;
        for (let x = 0; x < w; x++) dst[yo + x] += wk * tmp[so + x];
      }
    }
    return dst;
  }

  // ---------------------------------------------------------------------------
  // Polyline post-processing
  // ---------------------------------------------------------------------------

  // Ramer-Douglas-Peucker, iterative (explicit stack). Long polylines are split into
  // chunks of RDP_CHUNK points whose boundaries are always kept, bounding worst-case cost.
  const RDP_CHUNK = 4096;

  function simplify(pts, tol) {
    if (!pts) return [];
    const n = pts.length >> 1;
    if (n <= 2 || !(tol > 0)) return Array.prototype.slice.call(pts, 0, n * 2);
    const keep = new Uint8Array(n);
    keep[0] = 1;
    keep[n - 1] = 1;
    const tol2 = tol * tol;
    const stack = [];
    for (let s = 0; s < n - 1; s += RDP_CHUNK) {
      const e = Math.min(n - 1, s + RDP_CHUNK);
      keep[e] = 1;
      stack.push(s, e);
    }
    while (stack.length) {
      const b = stack.pop();
      const a = stack.pop();
      if (b - a < 2) continue;
      const ax = pts[2 * a], ay = pts[2 * a + 1];
      const dx = pts[2 * b] - ax, dy = pts[2 * b + 1] - ay;
      const len2 = dx * dx + dy * dy;
      let maxD = -1, maxI = -1;
      for (let i = a + 1; i < b; i++) {
        const px = pts[2 * i] - ax, py = pts[2 * i + 1] - ay;
        let d2;
        if (len2 > 1e-12) {
          let t = (px * dx + py * dy) / len2;
          if (t < 0) t = 0; else if (t > 1) t = 1;
          const qx = px - t * dx, qy = py - t * dy;
          d2 = qx * qx + qy * qy;
        } else {
          d2 = px * px + py * py;
        }
        if (d2 > maxD) { maxD = d2; maxI = i; }
      }
      if (maxD > tol2) {
        keep[maxI] = 1;
        stack.push(a, maxI, maxI, b);
      }
    }
    const out = [];
    for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[2 * i], pts[2 * i + 1]);
    return out;
  }

  // Moving-average (1/4, 1/2, 1/4) smoothing. Closed loops wrap around; open
  // polylines keep their end points fixed. Point count is preserved.
  function smoothPolyline(pts, iterations) {
    const n = pts.length >> 1;
    if (!(iterations > 0) || n < 3) return pts;
    const closed = isClosed(pts);
    const m = closed ? n - 1 : n;
    if (m < 3) return pts;
    let a = new Float64Array(2 * m), b = new Float64Array(2 * m);
    for (let i = 0; i < 2 * m; i++) a[i] = pts[i];
    for (let it = 0; it < iterations; it++) {
      if (closed) {
        for (let i = 0; i < m; i++) {
          const ip = i === 0 ? m - 1 : i - 1;
          const inx = i === m - 1 ? 0 : i + 1;
          b[2 * i] = 0.25 * a[2 * ip] + 0.5 * a[2 * i] + 0.25 * a[2 * inx];
          b[2 * i + 1] = 0.25 * a[2 * ip + 1] + 0.5 * a[2 * i + 1] + 0.25 * a[2 * inx + 1];
        }
      } else {
        b[0] = a[0]; b[1] = a[1];
        b[2 * m - 2] = a[2 * m - 2]; b[2 * m - 1] = a[2 * m - 1];
        for (let i = 1; i < m - 1; i++) {
          b[2 * i] = 0.25 * a[2 * i - 2] + 0.5 * a[2 * i] + 0.25 * a[2 * i + 2];
          b[2 * i + 1] = 0.25 * a[2 * i - 1] + 0.5 * a[2 * i + 1] + 0.25 * a[2 * i + 3];
        }
      }
      const t = a; a = b; b = t;
    }
    const out = new Array(closed ? 2 * m + 2 : 2 * m);
    for (let i = 0; i < 2 * m; i++) out[i] = a[i];
    if (closed) { out[2 * m] = a[0]; out[2 * m + 1] = a[1]; }
    return out;
  }

  // Length filter -> smoothing -> RDP.
  function finishPolys(polys, smoothing, tol, minLen) {
    const out = [];
    for (let i = 0; i < polys.length; i++) {
      const pl = polys[i];
      if (!pl || pl.length < 4) continue;
      if (polyLength(pl) < minLen) continue;
      let q = smoothPolyline(pl, smoothing);
      q = simplify(q, tol);
      if (q.length >= 4) out.push(q);
    }
    return out;
  }

  // Concatenate chains whose ends are paired. list[c] = flat point array (or null =
  // removed); end id = 2*c + side (side 0 = first point, 1 = last point);
  // partner[endId] = paired end id or -1 (must be symmetric). Paths are emitted from
  // their free ends, remaining cycles are closed explicitly. Each chain is used once.
  function mergeByPartner(list, partner) {
    const m = list.length;
    const used = new Uint8Array(m);
    const out = [];
    function follow(c, side) {
      const res = [];
      while (c >= 0 && !used[c]) {
        used[c] = 1;
        const pts = list[c];
        const n = pts.length >> 1;
        const rev = side === 1;
        for (let k = 0; k < n; k++) {
          const idx = rev ? n - 1 - k : k;
          const x = pts[2 * idx], y = pts[2 * idx + 1];
          if (k === 0 && res.length >= 2 && res[res.length - 2] === x && res[res.length - 1] === y) continue;
          res.push(x, y);
        }
        const p = partner[2 * c + (1 - side)];
        if (p < 0) break;
        c = p >> 1;
        side = p & 1;
      }
      return res;
    }
    for (let c = 0; c < m; c++) {
      if (!list[c] || used[c]) continue;
      if (partner[2 * c] < 0) out.push(follow(c, 0));
      else if (partner[2 * c + 1] < 0) out.push(follow(c, 1));
    }
    for (let c = 0; c < m; c++) {
      if (!list[c] || used[c]) continue;
      const res = follow(c, 0);
      const L = res.length;
      if (L >= 4 && (res[0] !== res[L - 2] || res[1] !== res[L - 1])) res.push(res[0], res[1]);
      out.push(res);
    }
    return out;
  }

  // Join open polylines whose end points lie within `eps` px of each other
  // (greedy, closest pairs first). A polyline may be closed onto itself when it is
  // long enough. Closed polylines are passed through untouched.
  function joinNearEnds(polys, eps) {
    const m = polys.length;
    if (m < 1 || !(eps > 0)) return polys;
    const eps2 = eps * eps;
    const ex = new Float64Array(2 * m), ey = new Float64Array(2 * m);
    const valid = new Uint8Array(2 * m);
    const lens = new Float64Array(m);
    const grid = new Map();
    const cellKey = (gx, gy) => (gy + 1) * 1048576 + (gx + 1);
    for (let i = 0; i < m; i++) {
      const pl = polys[i];
      const n = pl.length;
      if (n < 4 || isClosed(pl)) continue;
      lens[i] = polyLength(pl);
      for (let side = 0; side < 2; side++) {
        const e = 2 * i + side;
        ex[e] = side ? pl[n - 2] : pl[0];
        ey[e] = side ? pl[n - 1] : pl[1];
        valid[e] = 1;
        const k = cellKey(Math.floor(ex[e] / eps), Math.floor(ey[e] / eps));
        let bucket = grid.get(k);
        if (!bucket) { bucket = []; grid.set(k, bucket); }
        bucket.push(e);
      }
    }
    const pd = [], pa = [], pb = [];
    for (let e = 0; e < 2 * m; e++) {
      if (!valid[e]) continue;
      const gx = Math.floor(ex[e] / eps), gy = Math.floor(ey[e] / eps);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const bucket = grid.get(cellKey(gx + ox, gy + oy));
          if (!bucket) continue;
          for (let q = 0; q < bucket.length; q++) {
            const f = bucket[q];
            if (f <= e) continue;
            if ((f >> 1) === (e >> 1) && !(lens[e >> 1] > 4 * eps)) continue;
            const dx = ex[f] - ex[e], dy = ey[f] - ey[e];
            const d2 = dx * dx + dy * dy;
            if (d2 <= eps2) { pd.push(d2); pa.push(e); pb.push(f); }
          }
        }
      }
    }
    if (!pd.length) return polys;
    const order = new Array(pd.length);
    for (let i = 0; i < order.length; i++) order[i] = i;
    order.sort((i, j) => pd[i] - pd[j]);
    const partner = new Int32Array(2 * m).fill(-1);
    for (let q = 0; q < order.length; q++) {
      const a = pa[order[q]], b = pb[order[q]];
      if (partner[a] >= 0 || partner[b] >= 0) continue;
      partner[a] = b;
      partner[b] = a;
    }
    return mergeByPartner(polys, partner);
  }

  // Drop invalid points / polylines; guarantees finite numbers and >= 2 points.
  function sanitize(polys) {
    const out = [];
    if (!polys) return out;
    for (let i = 0; i < polys.length; i++) {
      const pl = polys[i];
      if (!pl || pl.length < 4) continue;
      let ok = (pl.length & 1) === 0;
      for (let k = 0; ok && k < pl.length; k++) if (!Number.isFinite(pl[k])) ok = false;
      let q = pl;
      if (!ok) {
        q = [];
        for (let k = 0; k + 1 < pl.length; k += 2) {
          if (Number.isFinite(pl[k]) && Number.isFinite(pl[k + 1])) q.push(pl[k], pl[k + 1]);
        }
      }
      if (q.length >= 4) out.push(Array.isArray(q) ? q : Array.from(q));
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Grayscale preprocessing
  // ---------------------------------------------------------------------------

  // Luminance 0 (black) .. 1 (white). Order: luma (Rec.601) composited over white ->
  // invert -> brightness -> contrast -> gamma -> gaussian blur.
  // gamma > 1 brightens mid-tones (v' = v^(1/gamma)). blur is a radius in px (sigma = radius / 2).
  function toGray(imageData, opts) {
    const o = opts || {};
    const w = Math.max(0, imageData.width | 0), h = Math.max(0, imageData.height | 0);
    const src = imageData.data;
    const n = w * h;
    const out = new Float32Array(n);
    if (n === 0 || !src) return { width: w, height: h, data: out };

    const bright = clamp(num(o.brightness, 0), -1, 1);
    const con = clamp(num(o.contrast, 0), -1, 0.99);
    const gam = clamp(num(o.gamma, 1), 0.2, 5);
    const inv = !!o.invert;
    const blur = clamp(num(o.blur, 0), 0, 10);
    const cf = (1 + con) / (1 - con); // 0 at -1, 1 at 0, ~200 at 0.99

    const LUT_N = 4096;
    const lut = new Float32Array(LUT_N + 1);
    for (let i = 0; i <= LUT_N; i++) {
      let v = i / LUT_N;
      if (inv) v = 1 - v;
      v += bright;
      v = (v - 0.5) * cf + 0.5;
      v = clamp(v, 0, 1);
      if (gam !== 1) v = Math.pow(v, 1 / gam);
      lut[i] = v;
    }

    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const a = src[j + 3] / 255;
      let L = (0.299 * src[j] + 0.587 * src[j + 1] + 0.114 * src[j + 2]) / 255;
      L = L * a + (1 - a); // transparent -> white
      if (!(L >= 0)) L = 1; else if (L > 1) L = 1;
      out[i] = lut[(L * LUT_N + 0.5) | 0];
    }
    const data = blur > 0 ? gaussianBlur(out, w, h, blur * 0.5) : out;
    return { width: w, height: h, data };
  }

  // ---------------------------------------------------------------------------
  // Marching squares
  // ---------------------------------------------------------------------------

  // Builds a reusable iso-line tracer over `data` (w x h). Returns fn(level) -> polylines.
  // "Inside" = value < level. With pad = true the grid is surrounded by a ring of white
  // (1.0) samples so every contour closes; without padding contours touching the border
  // stay open. Segments are chained through an edge-indexed neighbour table (O(n)).
  function makeIsoTracer(data, w, h, pad) {
    const GW = pad ? w + 2 : w;
    const GH = pad ? h + 2 : h;
    let G;
    if (pad) {
      G = new Float32Array(GW * GH).fill(1);
      for (let y = 0; y < h; y++) G.set(data.subarray(y * w, y * w + w), (y + 1) * GW + 1);
    } else {
      G = data;
    }
    const HW = GW - 1;              // horizontal edges per grid row
    const NH = HW * GH;             // number of horizontal edges
    const NE = NH + GW * (GH - 1);  // total edges
    const nbr = new Int32Array(NE * 2).fill(-1);
    const vis = new Uint8Array(NE);
    const ins = new Uint8Array(GW * GH);
    let crossed = new Int32Array(4096);
    let nc = 0;
    const ox = pad ? -0.5 : 0.5;    // grid index -> pixel coordinate offset
    let lvl = 0;

    function link(e, f) {
      const k = e << 1;
      if (nbr[k] < 0) {
        nbr[k] = f;
        if (nc >= crossed.length) {
          const bigger = new Int32Array(crossed.length * 2);
          bigger.set(crossed);
          crossed = bigger;
        }
        crossed[nc++] = e;
      } else if (nbr[k + 1] < 0) {
        nbr[k + 1] = f;
      }
    }
    function seg(e, f) { link(e, f); link(f, e); }

    function pushPoint(e, out) {
      let x, y, a, b, t;
      if (e < NH) {
        const j = (e / HW) | 0, i = e - j * HW;
        a = G[j * GW + i]; b = G[j * GW + i + 1];
        t = (lvl - a) / (b - a);
        if (!(t >= 0)) t = 0; else if (t > 1) t = 1;
        x = i + t + ox; y = j + ox;
      } else {
        const e2 = e - NH;
        const j = (e2 / GW) | 0, i = e2 - j * GW;
        a = G[j * GW + i]; b = G[(j + 1) * GW + i];
        t = (lvl - a) / (b - a);
        if (!(t >= 0)) t = 0; else if (t > 1) t = 1;
        x = i + ox; y = j + t + ox;
      }
      if (x < 0) x = 0; else if (x > w) x = w;
      if (y < 0) y = 0; else if (y > h) y = h;
      out.push(x, y);
    }

    function walk(start) {
      const pts = [];
      let cur = start;
      for (;;) {
        vis[cur] = 1;
        pushPoint(cur, pts);
        const a = nbr[2 * cur], b = nbr[2 * cur + 1];
        if (a >= 0 && !vis[a]) cur = a;
        else if (b >= 0 && !vis[b]) cur = b;
        else break;
      }
      // Close the loop when the last edge links back to a degree-2 start edge.
      if (cur !== start && nbr[2 * start + 1] >= 0 &&
          (nbr[2 * cur] === start || nbr[2 * cur + 1] === start)) {
        pts.push(pts[0], pts[1]);
      }
      return pts;
    }

    return function (level) {
      lvl = level;
      const total = GW * GH;
      for (let k = 0; k < total; k++) ins[k] = G[k] < level ? 1 : 0;
      nc = 0;
      // Corner bits: TL = 8, TR = 4, BR = 2, BL = 1. Cell edges: T, R, B, L.
      for (let j = 0; j < GH - 1; j++) {
        let k = j * GW;
        const eRow = j * HW;
        for (let i = 0; i < GW - 1; i++, k++) {
          const c = (ins[k] << 3) | (ins[k + 1] << 2) | (ins[k + GW + 1] << 1) | ins[k + GW];
          if (c === 0 || c === 15) continue;
          const eT = eRow + i, eB = eT + HW, eL = NH + k, eR = eL + 1;
          switch (c) {
            case 1: case 14: seg(eL, eB); break;
            case 2: case 13: seg(eB, eR); break;
            case 3: case 12: seg(eL, eR); break;
            case 4: case 11: seg(eT, eR); break;
            case 6: case 9: seg(eT, eB); break;
            case 7: case 8: seg(eL, eT); break;
            case 5: { // TR + BL inside (saddle)
              const centre = (G[k] + G[k + 1] + G[k + GW] + G[k + GW + 1]) * 0.25 < level;
              if (centre) { seg(eL, eT); seg(eB, eR); } else { seg(eL, eB); seg(eT, eR); }
              break;
            }
            case 10: { // TL + BR inside (saddle)
              const centre = (G[k] + G[k + 1] + G[k + GW] + G[k + GW + 1]) * 0.25 < level;
              if (centre) { seg(eT, eR); seg(eL, eB); } else { seg(eL, eT); seg(eB, eR); }
              break;
            }
            default: break;
          }
        }
      }
      const polys = [];
      // Open chains start at degree-1 edges (only possible without padding).
      for (let q = 0; q < nc; q++) {
        const e = crossed[q];
        if (!vis[e] && nbr[2 * e + 1] < 0) polys.push(walk(e));
      }
      for (let q = 0; q < nc; q++) {
        const e = crossed[q];
        if (!vis[e]) polys.push(walk(e));
      }
      for (let q = 0; q < nc; q++) {
        const e = crossed[q];
        nbr[2 * e] = -1;
        nbr[2 * e + 1] = -1;
        vis[e] = 0;
      }
      return polys;
    };
  }

  // ---------------------------------------------------------------------------
  // Binary image tools (padded buffers: 1-pixel ring of zeros around the image)
  // ---------------------------------------------------------------------------

  function setRing(buf, PW, PH, v) {
    buf.fill(v, 0, PW);
    buf.fill(v, (PH - 1) * PW, PH * PW);
    for (let y = 1; y < PH - 1; y++) {
      buf[y * PW] = v;
      buf[y * PW + PW - 1] = v;
    }
  }

  // One 3x3 dilation or erosion (separable). For erosion the outside counts as ink,
  // so shapes touching the image border are not eaten from the border.
  function morph3(img, tmp, PW, PH, dilate) {
    const ringVal = dilate ? 0 : 1;
    setRing(img, PW, PH, ringVal);
    for (let y = 1; y < PH - 1; y++) {
      let p = y * PW + 1;
      for (let x = 1; x < PW - 1; x++, p++) {
        const a = img[p - 1], b = img[p], c = img[p + 1];
        tmp[p] = dilate ? (a | b | c) : (a & b & c);
      }
    }
    setRing(tmp, PW, PH, ringVal);
    for (let y = 1; y < PH - 1; y++) {
      let p = y * PW + 1;
      for (let x = 1; x < PW - 1; x++, p++) {
        const a = tmp[p - PW], b = tmp[p], c = tmp[p + PW];
        img[p] = dilate ? (a | b | c) : (a & b & c);
      }
    }
    setRing(img, PW, PH, 0);
  }

  function closeBinary(img, PW, PH, radius) {
    const tmp = new Uint8Array(PW * PH);
    for (let i = 0; i < radius; i++) morph3(img, tmp, PW, PH, true);
    for (let i = 0; i < radius; i++) morph3(img, tmp, PW, PH, false);
  }

  // Removes 8-connected ink blobs smaller than minSize pixels and fills enclosed
  // 4-connected holes smaller than minSize pixels.
  function despeckle(img, PW, PH, minSize) {
    const N = PW * PH;
    const seen = new Uint8Array(N);
    const stack = new Int32Array(N);
    const comp = new Int32Array(N);
    let sp = 0;
    // Background connected to the border ring.
    seen[0] = 1;
    stack[sp++] = 0;
    while (sp) {
      const i = stack[--sp];
      const x = i % PW;
      let j;
      if (x > 0) { j = i - 1; if (!seen[j] && !img[j]) { seen[j] = 1; stack[sp++] = j; } }
      if (x < PW - 1) { j = i + 1; if (!seen[j] && !img[j]) { seen[j] = 1; stack[sp++] = j; } }
      if (i >= PW) { j = i - PW; if (!seen[j] && !img[j]) { seen[j] = 1; stack[sp++] = j; } }
      if (i < N - PW) { j = i + PW; if (!seen[j] && !img[j]) { seen[j] = 1; stack[sp++] = j; } }
    }
    for (let y = 1; y < PH - 1; y++) {
      for (let x = 1; x < PW - 1; x++) {
        const s = y * PW + x;
        if (seen[s]) continue;
        const v = img[s];
        let cn = 0;
        seen[s] = 1;
        stack[sp++] = s;
        while (sp) {
          const i = stack[--sp];
          comp[cn++] = i;
          if (v) {
            for (let d = 0; d < 8; d++) {
              const j = i + DY8[d] * PW + DX8[d];
              if (!seen[j] && img[j]) { seen[j] = 1; stack[sp++] = j; }
            }
          } else {
            let j = i - 1; if (!seen[j] && !img[j]) { seen[j] = 1; stack[sp++] = j; }
            j = i + 1; if (!seen[j] && !img[j]) { seen[j] = 1; stack[sp++] = j; }
            j = i - PW; if (!seen[j] && !img[j]) { seen[j] = 1; stack[sp++] = j; }
            j = i + PW; if (!seen[j] && !img[j]) { seen[j] = 1; stack[sp++] = j; }
          }
        }
        if (cn < minSize) {
          const nv = v ? 0 : 1;
          for (let k = 0; k < cn; k++) img[comp[k]] = nv;
        }
      }
    }
  }

  // Zhang-Suen thinning, in place. Only border pixels are re-examined each pass
  // (pixels with 7-8 ink neighbours can never be deleted), so cost is proportional to
  // the ink boundary rather than to the whole image per iteration.
  function thinZhangSuen(img, PW, PH) {
    const N = PW * PH;
    const list = new Int32Array(N);
    const inList = new Uint8Array(N);
    let len = 0;
    for (let y = 1; y < PH - 1; y++) {
      let p = y * PW + 1;
      for (let x = 1; x < PW - 1; x++, p++) {
        if (!img[p]) continue;
        if (!img[p - 1] || !img[p + 1] || !img[p - PW] || !img[p + PW] ||
            !img[p - PW - 1] || !img[p - PW + 1] || !img[p + PW - 1] || !img[p + PW + 1]) {
          list[len++] = p;
          inList[p] = 1;
        }
      }
    }
    let delBuf = new Int32Array(Math.max(1, len));
    let changed = true;
    while (changed) {
      changed = false;
      for (let sub = 0; sub < 2; sub++) {
        if (delBuf.length < len) delBuf = new Int32Array(len);
        let nd = 0;
        for (let li = 0; li < len; li++) {
          const p = list[li];
          const p2 = img[p - PW], p3 = img[p - PW + 1], p4 = img[p + 1], p5 = img[p + PW + 1];
          const p6 = img[p + PW], p7 = img[p + PW - 1], p8 = img[p - 1], p9 = img[p - PW - 1];
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const A = ((p2 ^ 1) & p3) + ((p3 ^ 1) & p4) + ((p4 ^ 1) & p5) + ((p5 ^ 1) & p6) +
                    ((p6 ^ 1) & p7) + ((p7 ^ 1) & p8) + ((p8 ^ 1) & p9) + ((p9 ^ 1) & p2);
          if (A !== 1) continue;
          if (sub === 0) {
            if (p2 & p4 & p6) continue;
            if (p4 & p6 & p8) continue;
          } else {
            if (p2 & p4 & p8) continue;
            if (p2 & p6 & p8) continue;
          }
          delBuf[nd++] = p;
        }
        if (nd === 0) continue;
        changed = true;
        for (let k = 0; k < nd; k++) img[delBuf[k]] = 0;
        let nl = 0;
        for (let li = 0; li < len; li++) {
          const p = list[li];
          if (img[p]) list[nl++] = p; else inList[p] = 0;
        }
        for (let k = 0; k < nd; k++) {
          const p = delBuf[k];
          for (let d = 0; d < 8; d++) {
            const q = p + DY8[d] * PW + DX8[d];
            if (img[q] && !inList[q]) { inList[q] = 1; list[nl++] = q; }
          }
        }
        len = nl;
      }
    }
  }

  // Removes redundant "staircase" pixels (a pixel with two perpendicular 4-neighbours)
  // when deleting it keeps 8-connectivity (Yokoi connectivity number == 1). This turns
  // Zhang-Suen output into a clean 8-connected 1-px skeleton with fewer false junctions.
  function cleanStaircase(img, PW, PH) {
    for (let y = 1; y < PH - 1; y++) {
      let p = y * PW + 1;
      for (let x = 1; x < PW - 1; x++, p++) {
        if (!img[p]) continue;
        const e = img[p + 1], n = img[p - PW], w = img[p - 1], s = img[p + PW];
        if (!((n & e) | (e & s) | (s & w) | (w & n))) continue;
        const E = 1 - e, NE = 1 - img[p - PW + 1], Nn = 1 - n, NW = 1 - img[p - PW - 1];
        const W = 1 - w, SW = 1 - img[p + PW - 1], S = 1 - s, SE = 1 - img[p + PW + 1];
        const conn = (E - E * NE * Nn) + (Nn - Nn * NW * W) + (W - W * SW * S) + (S - S * SE * E);
        if (conn === 1) img[p] = 0;
      }
    }
  }

  // Unit direction pointing away from a chain end, measured ~5 px along the chain.
  function endDir(pts, side, out, j) {
    const n = pts.length >> 1;
    const i0 = side ? n - 1 : 0, st = side ? -1 : 1;
    const x0 = pts[2 * i0], y0 = pts[2 * i0 + 1];
    let dx = 0, dy = 0;
    for (let k = 1, i = i0 + st; k < n; k++, i += st) {
      dx = pts[2 * i] - x0;
      dy = pts[2 * i + 1] - y0;
      if (dx * dx + dy * dy >= 25) break;
    }
    const L = Math.sqrt(dx * dx + dy * dy);
    out[2 * j] = L > 1e-9 ? dx / L : 0;
    out[2 * j + 1] = L > 1e-9 ? dy / L : 0;
  }

  // Converts a 1-px skeleton (padded Uint8Array, 1 = ink) into polylines.
  // - Junction pixels (degree >= 3) are grouped into 8-connected clusters (one graph node
  //   each, located at the cluster centroid).
  // - Chains are walked from junction clusters and end points along degree-2 pixels;
  //   remaining pure loops are picked up last. Visited pixel-edges are marked, so every
  //   edge is walked once and the walk always terminates.
  // - Spurs (free end <-> junction) and tiny self-loops shorter than spurLen are pruned
  //   while the junction keeps >= 2 branches.
  // - At each junction chain ends are paired greedily by straightest continuation and
  //   merged, so pen lifts only occur at true free ends.
  function skeletonToPolylines(img, PW, PH, spurLen) {
    const N = PW * PH;
    const off = new Int32Array(8);
    for (let d = 0; d < 8; d++) off[d] = DY8[d] * PW + DX8[d];
    const deg = new Uint8Array(N);
    const pix = [];
    for (let y = 1; y < PH - 1; y++) {
      let p = y * PW + 1;
      for (let x = 1; x < PW - 1; x++, p++) {
        if (!img[p]) continue;
        deg[p] = img[p + 1] + img[p + PW + 1] + img[p + PW] + img[p + PW - 1] +
                 img[p - 1] + img[p - PW - 1] + img[p - PW] + img[p - PW + 1];
        pix.push(p);
      }
    }
    const X = (p) => (p % PW) - 0.5;
    const Y = (p) => ((p / PW) | 0) - 0.5;

    // Junction clusters.
    const cluster = new Int32Array(N).fill(-1);
    const ccx = [], ccy = [];
    const stk = [];
    for (let k = 0; k < pix.length; k++) {
      const p = pix[k];
      if (deg[p] < 3 || cluster[p] >= 0) continue;
      const id = ccx.length;
      let sx = 0, sy = 0, cnt = 0;
      cluster[p] = id;
      stk.push(p);
      while (stk.length) {
        const q = stk.pop();
        sx += X(q); sy += Y(q); cnt++;
        for (let d = 0; d < 8; d++) {
          const r = q + off[d];
          if (deg[r] >= 3 && cluster[r] < 0) { cluster[r] = id; stk.push(r); }
        }
      }
      ccx.push(sx / cnt);
      ccy.push(sy / cnt);
    }

    const ev = new Uint8Array(N); // visited edge bits per pixel (bit d = edge towards d)
    const chains = [];
    function step(cur, d) {
      const nx = cur + off[d];
      ev[cur] |= 1 << d;
      ev[nx] |= 1 << ((d + 4) & 7);
      return nx;
    }
    // Walks from pixel p0 in direction d0, appending pixel centres to pts.
    // Returns the end node: cluster id (>= 0), -1 = free end point, -2 = back at start (loop).
    function walk(p0, d0, pts) {
      let cur = step(p0, d0);
      for (;;) {
        const cxp = X(cur), cyp = Y(cur);
        pts.push(cxp, cyp);
        const c = cluster[cur];
        if (c >= 0) {
          if (ccx[c] !== cxp || ccy[c] !== cyp) pts.push(ccx[c], ccy[c]);
          return c;
        }
        if (deg[cur] !== 2) return -1;
        const m = ev[cur];
        let nd = -1;
        for (let d = 0; d < 8; d++) {
          if (!(m & (1 << d)) && img[cur + off[d]]) { nd = d; break; }
        }
        if (nd < 0) return -2;
        cur = step(cur, nd);
      }
    }

    // 1) Chains leaving junction clusters.
    for (let k = 0; k < pix.length; k++) {
      const p = pix[k];
      const c = cluster[p];
      if (c < 0) continue;
      for (let d = 0; d < 8; d++) {
        if (ev[p] & (1 << d)) continue;
        const q = p + off[d];
        if (!img[q]) continue;
        if (cluster[q] === c) { step(p, d); continue; } // edge inside the cluster
        const pts = [ccx[c], ccy[c]];
        if (ccx[c] !== X(p) || ccy[c] !== Y(p)) pts.push(X(p), Y(p));
        const b = walk(p, d, pts);
        chains.push({ pts, a: c, b, len: 0, dead: false });
      }
    }
    // 2) Chains between free end points.
    for (let k = 0; k < pix.length; k++) {
      const p = pix[k];
      if (deg[p] !== 1) continue;
      let d = 0;
      while (d < 8 && !img[p + off[d]]) d++;
      if (d >= 8 || (ev[p] & (1 << d))) continue;
      const pts = [X(p), Y(p)];
      const b = walk(p, d, pts);
      chains.push({ pts, a: -1, b, len: 0, dead: false });
    }
    // 3) Pure loops (only degree-2 pixels left).
    for (let k = 0; k < pix.length; k++) {
      const p = pix[k];
      if (deg[p] !== 2 || cluster[p] >= 0) continue;
      for (let d = 0; d < 8; d++) {
        if ((ev[p] & (1 << d)) || !img[p + off[d]]) continue;
        const pts = [X(p), Y(p)];
        const b = walk(p, d, pts);
        if (b === -2) chains.push({ pts, a: -2, b: -2, len: 0, dead: false });
        else chains.push({ pts, a: -1, b, len: 0, dead: false });
        break;
      }
    }
    // Isolated pixels become 1-px dashes (removed later unless min length allows).
    const dots = [];
    for (let k = 0; k < pix.length; k++) {
      const p = pix[k];
      if (deg[p] === 0) dots.push([X(p) - 0.5, Y(p), X(p) + 0.5, Y(p)]);
    }

    // Spur pruning.
    const nNodes = ccx.length;
    const ndeg = new Int32Array(nNodes);
    for (let i = 0; i < chains.length; i++) {
      const ch = chains[i];
      ch.len = polyLength(ch.pts);
      if (ch.a >= 0) ndeg[ch.a]++;
      if (ch.b >= 0) ndeg[ch.b]++;
    }
    if (spurLen > 0 && nNodes > 0) {
      const cand = [];
      const isCand = new Uint8Array(chains.length);
      for (let i = 0; i < chains.length; i++) {
        const ch = chains[i];
        if (ch.len >= spurLen) continue;
        const spur = (ch.a === -1 && ch.b >= 0) || (ch.b === -1 && ch.a >= 0);
        const selfLoop = ch.a >= 0 && ch.a === ch.b;
        if (spur || selfLoop) { cand.push(i); isCand[i] = 1; }
      }
      // Branches that are never pruned; while a node has one, all its spurs may go.
      // Otherwise (every branch is short) the node keeps its two longest branches.
      const longDeg = new Int32Array(nNodes);
      for (let i = 0; i < chains.length; i++) {
        if (isCand[i]) continue;
        const ch = chains[i];
        if (ch.a >= 0) longDeg[ch.a]++;
        if (ch.b >= 0) longDeg[ch.b]++;
      }
      cand.sort((i, j) => chains[i].len - chains[j].len);
      for (let k = 0; k < cand.length; k++) {
        const ch = chains[cand[k]];
        if (ch.a >= 0 && ch.a === ch.b) {
          if (ndeg[ch.a] >= 3) { ch.dead = true; ndeg[ch.a] -= 2; }
        } else {
          const node = ch.a >= 0 ? ch.a : ch.b;
          if (ndeg[node] >= 3 || longDeg[node] >= 1) { ch.dead = true; ndeg[node]--; }
        }
      }
    }

    // Pair chain ends at junctions (straightest continuation first).
    const partner = new Int32Array(chains.length * 2).fill(-1);
    if (nNodes > 0) {
      const nodeEnds = new Array(nNodes);
      for (let c = 0; c < nNodes; c++) nodeEnds[c] = [];
      for (let i = 0; i < chains.length; i++) {
        const ch = chains[i];
        if (ch.dead) continue;
        if (ch.a >= 0) nodeEnds[ch.a].push(2 * i);
        if (ch.b >= 0) nodeEnds[ch.b].push(2 * i + 1);
      }
      for (let c = 0; c < nNodes; c++) {
        const ends = nodeEnds[c];
        const k = ends.length;
        if (k < 2) continue;
        if (k === 2) {
          partner[ends[0]] = ends[1];
          partner[ends[1]] = ends[0];
          continue;
        }
        const dirs = new Float64Array(2 * k);
        for (let j = 0; j < k; j++) endDir(chains[ends[j] >> 1].pts, ends[j] & 1, dirs, j);
        const pairs = [];
        for (let i = 0; i < k; i++) {
          for (let j = i + 1; j < k; j++) {
            pairs.push({ s: -(dirs[2 * i] * dirs[2 * j] + dirs[2 * i + 1] * dirs[2 * j + 1]), i, j });
          }
        }
        pairs.sort((u, v) => v.s - u.s);
        const taken = new Uint8Array(k);
        for (let q = 0; q < pairs.length; q++) {
          const pr = pairs[q];
          if (taken[pr.i] || taken[pr.j]) continue;
          taken[pr.i] = 1;
          taken[pr.j] = 1;
          partner[ends[pr.i]] = ends[pr.j];
          partner[ends[pr.j]] = ends[pr.i];
        }
      }
    }
    const list = chains.map((ch) => (ch.dead ? null : ch.pts));
    const merged = mergeByPartner(list, partner);
    for (let i = 0; i < dots.length; i++) merged.push(dots[i]);
    return merged;
  }

  // ---------------------------------------------------------------------------
  // Modes
  // ---------------------------------------------------------------------------

  function traceOutline(g, p) {
    const iso = makeIsoTracer(g.data, g.width, g.height, true);
    const raw = iso(clamp(p.threshold, 0, 1));
    const out = [];
    for (let i = 0; i < raw.length; i++) {
      const pl = raw[i];
      if (pl.length < 8) continue;
      if (polyArea(pl) < p.minArea) continue;
      const q = simplify(smoothPolyline(pl, p.smoothing), p.simplify);
      if (q.length >= 4) out.push(q);
    }
    return out;
  }

  function traceCenterline(g, p) {
    const w = g.width, h = g.height, PW = w + 2, PH = h + 2;
    const img = new Uint8Array(PW * PH);
    const d = g.data, thr = p.threshold;
    for (let y = 0; y < h; y++) {
      const so = y * w, dO = (y + 1) * PW + 1;
      for (let x = 0; x < w; x++) img[dO + x] = d[so + x] < thr ? 1 : 0;
    }
    if (p.cleanup > 0) closeBinary(img, PW, PH, p.cleanup);
    if (p.despeckle > 0) despeckle(img, PW, PH, p.despeckle);
    thinZhangSuen(img, PW, PH);
    cleanStaircase(img, PW, PH);
    const polys = skeletonToPolylines(img, PW, PH, p.spur);
    return finishPolys(polys, p.smoothing, p.simplify, p.minLength);
  }

  function traceEdges(g, p) {
    const w = g.width, h = g.height, n = w * h;
    const src = gaussianBlur(g.data, w, h, p.sigma);
    const mag = new Float32Array(n);
    const dir = new Uint8Array(n);
    let maxM = 0;
    // Sobel gradients (edge-clamped) + quantised gradient direction.
    for (let y = 0; y < h; y++) {
      const ym = (y > 0 ? y - 1 : 0) * w, y0 = y * w, yp = (y < h - 1 ? y + 1 : y) * w;
      for (let x = 0; x < w; x++) {
        const xm = x > 0 ? x - 1 : 0, xp = x < w - 1 ? x + 1 : x;
        const a = src[ym + xm], b = src[ym + x], c = src[ym + xp];
        const d = src[y0 + xm], f = src[y0 + xp];
        const gg = src[yp + xm], hh = src[yp + x], ii = src[yp + xp];
        const gx = (c + 2 * f + ii) - (a + 2 * d + gg);
        const gy = (gg + 2 * hh + ii) - (a + 2 * b + c);
        const m = Math.sqrt(gx * gx + gy * gy);
        const i = y0 + x;
        mag[i] = m;
        if (m > maxM) maxM = m;
        const ax = Math.abs(gx), ay = Math.abs(gy);
        dir[i] = ay <= ax * 0.41421356 ? 0 : (ay >= ax * 2.41421356 ? 2 : (gx * gy > 0 ? 1 : 3));
      }
    }
    if (!(maxM > 1e-6)) return [];
    let lo = p.low, hi = p.high;
    if (lo > hi) { const t = lo; lo = hi; hi = t; }
    const loA = Math.max(lo, 0.001) * maxM;
    const hiA = Math.max(hi, 0.001) * maxM;
    // Non-maximum suppression + double threshold.
    const cls = new Uint8Array(n);
    const stack = new Int32Array(n);
    let sp = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const m = mag[i];
        if (m < loA) continue;
        let m1, m2;
        switch (dir[i]) {
          case 0: m1 = mag[i - 1]; m2 = mag[i + 1]; break;
          case 2: m1 = mag[i - w]; m2 = mag[i + w]; break;
          case 1: m1 = mag[i - w - 1]; m2 = mag[i + w + 1]; break;
          default: m1 = mag[i - w + 1]; m2 = mag[i + w - 1]; break;
        }
        if (m < m1 || m <= m2) continue;
        if (m >= hiA) { cls[i] = 2; stack[sp++] = i; } else cls[i] = 1;
      }
    }
    // Hysteresis: grow strong edges through 8-connected weak pixels.
    const PW = w + 2, PH = h + 2;
    const img = new Uint8Array(PW * PH);
    while (sp) {
      const i = stack[--sp];
      const y = (i / w) | 0, x = i - y * w;
      img[(y + 1) * PW + x + 1] = 1;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = i + dy * w + dx;
          if (cls[j] === 1) { cls[j] = 2; stack[sp++] = j; }
        }
      }
    }
    thinZhangSuen(img, PW, PH);
    cleanStaircase(img, PW, PH);
    let polys = skeletonToPolylines(img, PW, PH, 3);
    polys = joinNearEnds(polys, 2);
    return finishPolys(polys, 1, p.simplify, p.minLength);
  }

  function traceContours(g, p) {
    const iso = makeIsoTracer(g.data, g.width, g.height, false);
    const N = p.levels;
    const out = [];
    for (let k = 1; k <= N; k++) {
      const polys = iso(k / (N + 1));
      for (let i = 0; i < polys.length; i++) {
        const pl = polys[i];
        if (pl.length < 4 || polyLength(pl) < p.minLength) continue;
        const q = simplify(smoothPolyline(pl, p.smoothing), p.simplify);
        if (q.length >= 4) out.push(q);
      }
    }
    return out;
  }

  // Classic crosshatch angle set relative to the base angle (45 -> 45, -45, 0, 90, 22.5, -67.5).
  const HATCH_OFFSETS = [0, -90, -45, 45, -22.5, -112.5];
  // Without crosshatch every level shares the angle; phases interleave progressively.
  const HATCH_PHASES = [0, 0.5, 0.25, 0.75, 0.125, 0.625];

  function traceHatch(g, p, mmPerPx) {
    const w = g.width, h = g.height;
    const sample = makeSampler(g);
    const spacing = Math.max(0.5, p.spacing / mmPerPx);
    const minSeg = Math.max(0.05, p.minSegment / mmPerPx);
    const L = p.levels;
    const out = [];
    for (let lv = 1; lv <= L; lv++) {
      const thr = lv / (L + 1);
      const ang = p.crosshatch ? p.angle + HATCH_OFFSETS[(lv - 1) % 6] : p.angle;
      const phase = p.crosshatch ? 0 : HATCH_PHASES[(lv - 1) % 6];
      hatchLevel(w, h, sample, ang, spacing, phase, thr, minSeg, p.connect, out);
    }
    return out;
  }

  // Parallel scanlines at angle angDeg (direction rotated, image untouched), sampled at
  // 0.5 px steps; runs where darkness > thr are emitted. Scanlines alternate direction,
  // and with `connect` a run is appended to a chain ending on the previous scanline when
  // the connector is short (<= 2 spacings) and lies over dark-ish tone.
  function hatchLevel(w, h, sample, angDeg, spacing, phase, thr, minSeg, connect, out) {
    const th = angDeg * Math.PI / 180;
    const ux = Math.cos(th), uy = Math.sin(th);
    const nx = -uy, ny = ux;
    let smin = Infinity, smax = -Infinity;
    const cxs = [0, w, 0, w], cys = [0, 0, h, h];
    for (let i = 0; i < 4; i++) {
      const s = cxs[i] * nx + cys[i] * ny;
      if (s < smin) smin = s;
      if (s > smax) smax = s;
    }
    const STEP = 0.5;
    const connD2 = 4 * spacing * spacing;
    const start = ((0.5 + phase) % 1) * spacing;
    let prevOpen = [];
    const runs = [];
    let bx = 0, by = 0;
    const emit = (ta, tb) => {
      if (Math.abs(tb - ta) < minSeg) return;
      runs.push(
        clamp(bx + ta * ux, 0, w), clamp(by + ta * uy, 0, h),
        clamp(bx + tb * ux, 0, w), clamp(by + tb * uy, 0, h));
    };
    for (let k = 0; ; k++) {
      const s = smin + start + k * spacing;
      if (s >= smax) break;
      runs.length = 0;
      bx = s * nx;
      by = s * ny;
      // Clip the infinite line p(t) = b + t*u against [0,w] x [0,h].
      let t0 = -Infinity, t1 = Infinity, valid = true;
      if (Math.abs(ux) > 1e-12) {
        let a = -bx / ux, b = (w - bx) / ux;
        if (a > b) { const t = a; a = b; b = t; }
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
      } else if (bx < 0 || bx > w) valid = false;
      if (Math.abs(uy) > 1e-12) {
        let a = -by / uy, b = (h - by) / uy;
        if (a > b) { const t = a; a = b; b = t; }
        if (a > t0) t0 = a;
        if (b < t1) t1 = b;
      } else if (by < 0 || by > h) valid = false;
      if (valid && t1 - t0 > 1e-6) {
        const rev = (k & 1) === 1;
        const len = t1 - t0;
        const ns = Math.max(1, Math.ceil(len / STEP));
        const dt = len / ns;
        let inRun = false, rs = 0, pt = 0, pdk = 0;
        for (let i = 0; i <= ns; i++) {
          const t = rev ? t1 - i * dt : t0 + i * dt;
          const dk = 1 - sample(bx + t * ux, by + t * uy);
          if (dk > thr) {
            if (!inRun) {
              inRun = true;
              rs = i === 0 ? t : crossT(pt, pdk, t, dk, thr);
            }
          } else if (inRun) {
            inRun = false;
            emit(rs, crossT(pt, pdk, t, dk, thr));
          }
          pt = t;
          pdk = dk;
        }
        if (inRun) emit(rs, pt);
      }
      const curOpen = [];
      for (let r = 0; r < runs.length; r += 4) {
        const xs = runs[r], ys = runs[r + 1], xe = runs[r + 2], ye = runs[r + 3];
        let best = null, bestD = connD2;
        if (connect) {
          for (let j = 0; j < prevOpen.length; j++) {
            const ch = prevOpen[j];
            if (ch.used) continue;
            const pts = ch.pts;
            const lx = pts[pts.length - 2], ly = pts[pts.length - 1];
            const dx = xs - lx, dy = ys - ly;
            const d2 = dx * dx + dy * dy;
            if (d2 <= bestD && 1 - sample((xs + lx) * 0.5, (ys + ly) * 0.5) >= thr * 0.5) {
              best = ch;
              bestD = d2;
            }
          }
        }
        if (best) {
          best.used = true;
          best.pts.push(xs, ys, xe, ye);
          curOpen.push(best);
        } else {
          curOpen.push({ pts: [xs, ys, xe, ye], used: false });
        }
      }
      for (let j = 0; j < prevOpen.length; j++) if (!prevOpen[j].used) out.push(prevOpen[j].pts);
      for (let j = 0; j < curOpen.length; j++) curOpen[j].used = false;
      prevOpen = curOpen;
    }
    for (let j = 0; j < prevOpen.length; j++) out.push(prevOpen[j].pts);
  }

  // Linear interpolation of the parameter where darkness crosses thr between two samples.
  function crossT(ta, da, tb, db, thr) {
    let f = (thr - da) / (db - da);
    if (!(f >= 0)) f = 0; else if (f > 1) f = 1;
    return ta + (tb - ta) * f;
  }

  const WHITE_CUT = 0.05; // darkness below this counts as white for "lift in white"

  function traceSquiggle(g, p, mmPerPx) {
    const w = g.width, h = g.height;
    const sample = makeSampler(g);
    const vert = p.direction === 'v';
    const along = vert ? h : w;   // row length
    const across = vert ? w : h;  // extent perpendicular to rows
    const spacing = Math.max(1, p.spacing / mmPerPx);
    const amax = 0.5 * spacing * p.amplitude;
    const fmax = Math.max(1e-4, p.frequency * mmPerPx); // waves per px at full darkness
    const nRows = Math.max(1, Math.floor(across / spacing));
    const c0 = (across - (nRows - 1) * spacing) * 0.5;
    const band = spacing / 3;
    const dark = (a, b) => {
      let s = 0;
      for (let k = -1; k <= 1; k++) {
        const bb = clamp(b + k * band, 0, across);
        s += vert ? sample(bb, a) : sample(a, bb);
      }
      return clamp(1 - s / 3, 0, 1);
    };
    const out = [];
    for (let r = 0; r < nRows; r++) {
      const b0 = c0 + r * spacing;
      const rev = (r & 1) === 1;
      let pos = 0, phase = 0, cur = null;
      for (;;) {
        const a = rev ? along - pos : pos;
        const d = dark(a, b0);
        const f = fmax * (0.2 + 0.8 * d);
        if (p.liftWhite && d < WHITE_CUT) {
          if (cur) { if (cur.length >= 4) out.push(cur); cur = null; }
        } else {
          const bb = clamp(b0 + amax * d * Math.sin(phase), 0, across);
          if (!cur) cur = [];
          if (vert) cur.push(bb, a); else cur.push(a, bb);
        }
        if (pos >= along) break;
        const rem = along - pos;
        const ds = Math.min(clamp(1 / (16 * f), 0.3, 1.5), rem);
        phase += TAU * f * ds;
        pos = ds >= rem ? along : pos + ds; // lands exactly on the row end
      }
      if (cur && cur.length >= 4) out.push(cur);
    }
    const res = [];
    for (let i = 0; i < out.length; i++) {
      const q = simplify(out[i], 0.1);
      if (q.length >= 4) res.push(q);
    }
    return res;
  }

  // Liang-Barsky: parameter range [tIn, tOut] of segment p0->p1 inside [0,w]x[0,h], or null.
  function clipSeg(x0, y0, x1, y1, w, h) {
    let tIn = 0, tOut = 1;
    const dx = x1 - x0, dy = y1 - y0;
    const P = [-dx, dx, -dy, dy];
    const Q = [x0, w - x0, y0, h - y0];
    for (let k = 0; k < 4; k++) {
      if (P[k] === 0) {
        if (Q[k] < 0) return null;
      } else {
        const t = Q[k] / P[k];
        if (P[k] < 0) { if (t > tIn) tIn = t; } else if (t < tOut) tOut = t;
      }
    }
    return tIn > tOut ? null : [tIn, tOut];
  }

  function traceSpiral(g, p, mmPerPx) {
    const w = g.width, h = g.height;
    const sample = makeSampler(g);
    const spacing = Math.max(1, p.spacing / mmPerPx);
    const amax = 0.5 * spacing * p.amplitude;
    const fmax = Math.max(1e-4, p.frequency * mmPerPx);
    const cx = w * 0.5, cy = h * 0.5;
    const rmax = Math.hypot(cx, cy) + amax + 1;
    const bcoef = spacing / TAU; // r = bcoef * theta
    const band = spacing / 3;
    const out = [];
    let theta = 0, phase = 0, cur = null;
    let px = 0, py = 0, pInside = false, pDrawn = false, havePrev = false;
    for (;;) {
      const r = bcoef * theta;
      if (r > rmax) break;
      const ct = Math.cos(theta), st = Math.sin(theta);
      let s = 0;
      for (let k = -1; k <= 1; k++) {
        const rr = Math.max(0, r + k * band);
        s += sample(cx + rr * ct, cy + rr * st);
      }
      const d = clamp(1 - s / 3, 0, 1);
      const f = fmax * (0.2 + 0.8 * d);
      const drawn = !(p.liftWhite && d < WHITE_CUT);
      const amp = amax * d * Math.min(1, r / spacing); // avoid tangles at the centre
      const rr = r + amp * Math.sin(phase);
      const x = cx + rr * ct, y = cy + rr * st;
      const inside = x >= 0 && x <= w && y >= 0 && y <= h;
      if (drawn && inside) {
        if (!cur) {
          cur = [];
          if (havePrev && pDrawn && !pInside) {
            const c = clipSeg(px, py, x, y, w, h);
            if (c) cur.push(px + (x - px) * c[0], py + (y - py) * c[0]);
          }
        }
        cur.push(x, y);
      } else if (cur) {
        if (drawn && havePrev && pInside) {
          const c = clipSeg(px, py, x, y, w, h);
          if (c) cur.push(px + (x - px) * c[1], py + (y - py) * c[1]);
        }
        if (cur.length >= 4) out.push(cur);
        cur = null;
      }
      px = x; py = y; pInside = inside; pDrawn = drawn; havePrev = true;
      const ds = clamp(1 / (16 * f), 0.3, 1.5);
      const speed = Math.sqrt(r * r + bcoef * bcoef); // arc length per radian
      const dth = Math.min(0.25, ds / speed);
      theta += dth;
      phase += TAU * f * dth * speed;
    }
    if (cur && cur.length >= 4) out.push(cur);
    const res = [];
    for (let i = 0; i < out.length; i++) {
      const q = simplify(out[i], 0.1);
      if (q.length >= 4) res.push(q);
    }
    return res;
  }

  // Greedy nearest-neighbour ordering of points using a uniform grid.
  function orderGreedy(xs, ys, n, w, h) {
    const order = new Int32Array(n);
    if (n === 0) return order;
    const cell = Math.max(1, Math.sqrt((w * h) / n));
    const gw = Math.max(1, Math.ceil(w / cell)), gh = Math.max(1, Math.ceil(h / cell));
    const cellOf = (i) => {
      const gx = clamp(Math.floor(xs[i] / cell), 0, gw - 1);
      const gy = clamp(Math.floor(ys[i] / cell), 0, gh - 1);
      return gy * gw + gx;
    };
    const nc = gw * gh;
    const start = new Int32Array(nc + 1);
    const cellIdx = new Int32Array(n);
    for (let i = 0; i < n; i++) { cellIdx[i] = cellOf(i); start[cellIdx[i] + 1]++; }
    for (let c = 0; c < nc; c++) start[c + 1] += start[c];
    const fillPos = start.slice(0, nc);
    const items = new Int32Array(n);
    for (let i = 0; i < n; i++) items[fillPos[cellIdx[i]]++] = i;
    const remain = new Int32Array(nc);
    for (let c = 0; c < nc; c++) remain[c] = start[c + 1] - start[c];
    const visited = new Uint8Array(n);
    let cur = 0, bestS = Infinity;
    for (let i = 0; i < n; i++) {
      const s = xs[i] + ys[i];
      if (s < bestS) { bestS = s; cur = i; }
    }
    const maxRing = Math.max(gw, gh);
    for (let k = 0; k < n; k++) {
      order[k] = cur;
      visited[cur] = 1;
      remain[cellIdx[cur]]--;
      if (k === n - 1) break;
      const qx = xs[cur], qy = ys[cur];
      const ccx = cellIdx[cur] % gw, ccy = (cellIdx[cur] / gw) | 0;
      let best = -1, bestD = Infinity;
      for (let ring = 0; ring <= maxRing; ring++) {
        if (best >= 0) {
          const md = (ring - 1) * cell;
          if (md > 0 && md * md > bestD) break;
        }
        const x0 = ccx - ring, x1 = ccx + ring, y0 = ccy - ring, y1 = ccy + ring;
        const ya = Math.max(0, y0), yb = Math.min(gh - 1, y1);
        for (let gy = ya; gy <= yb; gy++) {
          const edgeRow = gy === y0 || gy === y1;
          const stepX = edgeRow || ring === 0 ? 1 : x1 - x0;
          for (let gx = x0; gx <= x1; gx += stepX) {
            if (gx < 0 || gx >= gw) continue;
            const c = gy * gw + gx;
            if (remain[c] <= 0) continue;
            for (let q = start[c]; q < start[c + 1]; q++) {
              const j = items[q];
              if (visited[j]) continue;
              const dx = xs[j] - qx, dy = ys[j] - qy;
              const d2 = dx * dx + dy * dy;
              if (d2 < bestD) { bestD = d2; best = j; }
            }
          }
        }
      }
      if (best < 0) return order.subarray(0, k + 1);
      cur = best;
    }
    return order;
  }

  function traceStipple(g, p, mmPerPx) {
    const w = g.width, h = g.height, n = w * h, data = g.data;
    const gam = p.gamma;
    const cdf = new Float64Array(n);
    let tot = 0;
    for (let i = 0; i < n; i++) {
      const d = 1 - data[i];
      if (d > 0.004) tot += Math.pow(d > 1 ? 1 : d, gam);
      cdf[i] = tot;
    }
    if (!(tot > 0)) return [];
    const count = p.count;
    const rng = mulberry32(p.seed);
    const minD = p.minDist, minD2 = minD * minD;
    const xs = new Float64Array(count), ys = new Float64Array(count);
    let np = 0;
    // Linked-list grid for min-distance rejection (cell >= minD, so +-1 cells suffice).
    let cell = 1, gw = 1, gh = 1, head = null, next = null;
    if (minD > 0) {
      cell = Math.max(minD, 1);
      gw = Math.ceil(w / cell) + 1;
      gh = Math.ceil(h / cell) + 1;
      head = new Int32Array(gw * gh).fill(-1);
      next = new Int32Array(count);
    }
    const maxAttempts = count * 30;
    for (let att = 0; att < maxAttempts && np < count; att++) {
      const u = rng() * tot;
      let lo = 0, hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cdf[mid] > u) hi = mid; else lo = mid + 1;
      }
      const x = (lo % w) + rng(), y = ((lo / w) | 0) + rng();
      if (minD > 0) {
        const gx = (x / cell) | 0, gy = (y / cell) | 0;
        let ok = true;
        for (let yy = Math.max(0, gy - 1); ok && yy <= Math.min(gh - 1, gy + 1); yy++) {
          for (let xx = Math.max(0, gx - 1); ok && xx <= Math.min(gw - 1, gx + 1); xx++) {
            for (let j = head[yy * gw + xx]; j >= 0; j = next[j]) {
              const dx = xs[j] - x, dy = ys[j] - y;
              if (dx * dx + dy * dy < minD2) { ok = false; break; }
            }
          }
        }
        if (!ok) continue;
        next[np] = head[gy * gw + gx];
        head[gy * gw + gx] = np;
      }
      xs[np] = x;
      ys[np] = y;
      np++;
    }
    const order = orderGreedy(xs, ys, np, w, h);
    const out = [];
    if (p.style === 'circle') {
      const r = Math.max(0.01, p.radius / mmPerPx);
      const SEG = 10;
      const cs = new Float64Array(SEG), sn = new Float64Array(SEG);
      for (let s = 0; s < SEG; s++) { cs[s] = Math.cos(TAU * s / SEG); sn[s] = Math.sin(TAU * s / SEG); }
      for (let k = 0; k < order.length; k++) {
        const i = order[k];
        const pl = new Array(2 * (SEG + 1));
        for (let s = 0; s <= SEG; s++) {
          const a = s % SEG;
          pl[2 * s] = xs[i] + r * cs[a];
          pl[2 * s + 1] = ys[i] + r * sn[a];
        }
        out.push(pl);
      }
    } else {
      const half = Math.max(0.02, 0.1 / mmPerPx) * 0.5; // ~0.1 mm pen-down dash
      for (let k = 0; k < order.length; k++) {
        const i = order[k];
        out.push([xs[i] - half, ys[i], xs[i] + half, ys[i]]);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Mode descriptors (UI order)
  // ---------------------------------------------------------------------------

  const MODES = [
    {
      id: 'outline', name: 'Outline',
      description: 'Traces the borders of dark shapes as closed loops. Best for logos, silhouettes and bold graphics.',
      params: [
        { key: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
        { key: 'minArea', label: 'Min area (px\u00b2)', type: 'int', min: 0, max: 2000, step: 1, default: 8 },
        { key: 'smoothing', label: 'Smoothing', type: 'int', min: 0, max: 5, step: 1, default: 1 },
        { key: 'simplify', label: 'Simplify (px)', type: 'range', min: 0, max: 3, step: 0.05, default: 0.4 },
      ],
    },
    {
      id: 'centerline', name: 'Center line',
      description: 'Thins line drawings and handwriting to a single stroke through the middle of each line.',
      params: [
        { key: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 1, step: 0.01, default: 0.5 },
        { key: 'cleanup', label: 'Close gaps (px)', type: 'int', min: 0, max: 3, step: 1, default: 0 },
        { key: 'despeckle', label: 'Despeckle (px\u00b2)', type: 'int', min: 0, max: 500, step: 1, default: 10 },
        { key: 'spur', label: 'Spur length (px)', type: 'int', min: 0, max: 50, step: 1, default: 6 },
        { key: 'smoothing', label: 'Smoothing', type: 'int', min: 0, max: 5, step: 1, default: 1 },
        { key: 'simplify', label: 'Simplify (px)', type: 'range', min: 0, max: 3, step: 0.05, default: 0.6 },
        { key: 'minLength', label: 'Min length (px)', type: 'int', min: 0, max: 200, step: 1, default: 3 },
      ],
    },
    {
      id: 'edges', name: 'Edges',
      description: 'Canny edge detection: draws the strongest edges of a photo as lines.',
      params: [
        { key: 'sigma', label: 'Blur sigma (px)', type: 'range', min: 0, max: 5, step: 0.1, default: 1.4 },
        { key: 'low', label: 'Low threshold', type: 'range', min: 0, max: 1, step: 0.01, default: 0.08 },
        { key: 'high', label: 'High threshold', type: 'range', min: 0, max: 1, step: 0.01, default: 0.2 },
        { key: 'minLength', label: 'Min length (px)', type: 'int', min: 0, max: 200, step: 1, default: 10 },
        { key: 'simplify', label: 'Simplify (px)', type: 'range', min: 0, max: 3, step: 0.05, default: 0.6 },
      ],
    },
    {
      id: 'contours', name: 'Contours',
      description: 'Topographic iso-lines at evenly spaced gray levels.',
      params: [
        { key: 'levels', label: 'Levels', type: 'int', min: 1, max: 32, step: 1, default: 8 },
        { key: 'smoothing', label: 'Smoothing', type: 'int', min: 0, max: 5, step: 1, default: 2 },
        { key: 'minLength', label: 'Min length (px)', type: 'int', min: 0, max: 200, step: 1, default: 8 },
        { key: 'simplify', label: 'Simplify (px)', type: 'range', min: 0, max: 3, step: 0.05, default: 0.4 },
      ],
    },
    {
      id: 'hatch', name: 'Photo hatch',
      description: 'Tonal hatching: darker areas receive more layers of parallel lines.',
      params: [
        { key: 'levels', label: 'Levels', type: 'int', min: 1, max: 6, step: 1, default: 4 },
        { key: 'spacing', label: 'Line spacing (mm)', type: 'range', min: 0.2, max: 5, step: 0.05, default: 0.8 },
        { key: 'angle', label: 'Base angle (deg)', type: 'range', min: -90, max: 90, step: 1, default: 45 },
        { key: 'crosshatch', label: 'Crosshatch', type: 'checkbox', default: true },
        { key: 'minSegment', label: 'Min segment (mm)', type: 'range', min: 0, max: 5, step: 0.1, default: 0.5 },
        { key: 'connect', label: 'Connect lines', type: 'checkbox', default: true },
      ],
    },
    {
      id: 'squiggle', name: 'Squiggle',
      description: 'Rows of wavy lines whose amplitude and frequency follow the darkness.',
      params: [
        {
          key: 'direction', label: 'Direction', type: 'select', default: 'h',
          options: [{ value: 'h', label: 'Horizontal' }, { value: 'v', label: 'Vertical' }],
        },
        { key: 'spacing', label: 'Line spacing (mm)', type: 'range', min: 0.5, max: 10, step: 0.1, default: 2 },
        { key: 'amplitude', label: 'Amplitude', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
        { key: 'frequency', label: 'Frequency (waves/mm)', type: 'range', min: 0.05, max: 5, step: 0.05, default: 1 },
        { key: 'liftWhite', label: 'Lift in white', type: 'checkbox', default: false },
      ],
    },
    {
      id: 'spiral', name: 'Spiral',
      description: 'One continuous spiral from the centre outwards, wobbling more in dark areas.',
      params: [
        { key: 'spacing', label: 'Turn spacing (mm)', type: 'range', min: 0.5, max: 10, step: 0.1, default: 2 },
        { key: 'amplitude', label: 'Amplitude', type: 'range', min: 0, max: 2, step: 0.05, default: 1 },
        { key: 'frequency', label: 'Frequency (waves/mm)', type: 'range', min: 0.05, max: 5, step: 0.05, default: 1 },
        { key: 'liftWhite', label: 'Lift in white', type: 'checkbox', default: false },
      ],
    },
    {
      id: 'stipple', name: 'Stipple',
      description: 'Weighted random dots, denser in dark areas, ordered for short pen travel.',
      params: [
        { key: 'count', label: 'Dot count', type: 'int', min: 100, max: 20000, step: 100, default: 4000 },
        { key: 'gamma', label: 'Density gamma', type: 'range', min: 0.2, max: 4, step: 0.1, default: 1.5 },
        { key: 'minDist', label: 'Min distance (px)', type: 'range', min: 0, max: 20, step: 0.5, default: 2 },
        {
          key: 'style', label: 'Dot style', type: 'select', default: 'dot',
          options: [{ value: 'dot', label: 'Dot (short dash)' }, { value: 'circle', label: 'Circle' }],
        },
        { key: 'radius', label: 'Circle radius (mm)', type: 'range', min: 0.05, max: 3, step: 0.05, default: 0.3 },
        { key: 'seed', label: 'Seed', type: 'int', min: 1, max: 99999, step: 1, default: 1 },
      ],
    },
  ];

  const MODE_BY_ID = {};
  for (let i = 0; i < MODES.length; i++) MODE_BY_ID[MODES[i].id] = MODES[i];

  function defaults(modeId) {
    const mode = MODE_BY_ID[modeId];
    const out = {};
    if (!mode) return out;
    for (let i = 0; i < mode.params.length; i++) out[mode.params[i].key] = mode.params[i].default;
    return out;
  }

  // Merge with defaults and coerce/clamp every value to its descriptor.
  function normParams(mode, params) {
    const src = params || {};
    const out = {};
    for (let i = 0; i < mode.params.length; i++) {
      const d = mode.params[i];
      let v = src[d.key];
      if (v === undefined || v === null || v === '') v = d.default;
      if (d.type === 'range' || d.type === 'int') {
        let n = Number(v);
        if (!Number.isFinite(n)) n = d.default;
        if (d.min !== undefined) n = Math.max(d.min, n);
        if (d.max !== undefined) n = Math.min(d.max, n);
        if (d.type === 'int') n = Math.round(n);
        out[d.key] = n;
      } else if (d.type === 'checkbox') {
        out[d.key] = v === true || v === 1 || v === 'true' || v === '1' || v === 'on';
      } else if (d.type === 'select') {
        let found = d.default;
        for (let k = 0; k < d.options.length; k++) {
          if (String(d.options[k].value) === String(v)) { found = d.options[k].value; break; }
        }
        out[d.key] = found;
      } else {
        out[d.key] = v;
      }
    }
    return out;
  }

  function trace(gray, modeId, params, ctx) {
    const mode = MODE_BY_ID[modeId];
    if (!mode) throw new Error('ImageTrace: unknown mode "' + modeId + '"');
    if (!gray || !gray.data) return [];
    const w = gray.width | 0, h = gray.height | 0;
    if (w < 2 || h < 2 || gray.data.length < w * h) return [];
    const g = gray.data instanceof Float32Array
      ? { width: w, height: h, data: gray.data }
      : { width: w, height: h, data: Float32Array.from(gray.data) };
    const mmRaw = ctx ? Number(ctx.mmPerPx) : NaN;
    const mm = Number.isFinite(mmRaw) && mmRaw > 0 ? mmRaw : 0.25;
    const p = normParams(mode, params);
    let polys;
    switch (modeId) {
      case 'outline': polys = traceOutline(g, p); break;
      case 'centerline': polys = traceCenterline(g, p); break;
      case 'edges': polys = traceEdges(g, p); break;
      case 'contours': polys = traceContours(g, p); break;
      case 'hatch': polys = traceHatch(g, p, mm); break;
      case 'squiggle': polys = traceSquiggle(g, p, mm); break;
      case 'spiral': polys = traceSpiral(g, p, mm); break;
      case 'stipple': polys = traceStipple(g, p, mm); break;
      default: polys = [];
    }
    return sanitize(polys);
  }

  PP.ImageTrace = {
    modes: MODES,
    toGray,
    defaults,
    trace,
    simplify,
  };
})(window.PP = window.PP || {});
