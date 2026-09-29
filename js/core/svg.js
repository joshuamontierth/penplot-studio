/*
 * PenPlot Studio - SVG path parsing, flattening, SVG import and export.
 * Imported geometry is returned in millimetres with Y pointing UP.
 */
(function (PP) {
  'use strict';

  const G = PP.Geo;
  const PX_TO_MM = 25.4 / 96;

  // ---------------------------------------------------------------------------
  // Path data parser -> absolute commands M L C Q A Z
  // ---------------------------------------------------------------------------
  function parsePathData(d) {
    const cmds = [];
    if (!d) return cmds;
    const s = String(d);
    let i = 0;
    const n = s.length;
    const isWs = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ',' || c === '\f';
    const skip = () => { while (i < n && isWs(s[i])) i++; };
    const numRe = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/;
    const readNum = () => {
      skip();
      const m = numRe.exec(s.slice(i, i + 40));
      if (!m) return null;
      i += m[0].length;
      return parseFloat(m[0]);
    };
    const readFlag = () => {
      skip();
      const c = s[i];
      if (c === '0' || c === '1') { i++; return c === '1' ? 1 : 0; }
      return null;
    };
    const hasNum = () => { skip(); return i < n && /[-+.\d]/.test(s[i]); };

    let cx = 0, cy = 0, sx = 0, sy = 0;
    let lastC = null, lastQ = null; // reflected control points
    let cmd = null;
    while (i < n) {
      skip();
      if (i >= n) break;
      const start = i;
      step();
      if (i === start) i++; // guarantee progress on malformed data
    }
    return cmds;

    function step() {
      const ch = s[i];
      if (/[MmZzLlHhVvCcSsQqTtAa]/.test(ch)) { cmd = ch; i++; }
      else if (!cmd) return;
      else if (!hasNum()) return;
      const rel = cmd === cmd.toLowerCase();
      const C = cmd.toUpperCase();
      if (C === 'Z') {
        cmds.push({ c: 'Z' });
        cx = sx; cy = sy; lastC = lastQ = null;
        return;
      }
      // Repeat command while numbers follow
      let first = true;
      do {
        if (C === 'M') {
          const x = readNum(), y = readNum(); if (x === null || y === null) break;
          cx = rel ? cx + x : x; cy = rel ? cy + y : y;
          if (first) { cmds.push({ c: 'M', x: cx, y: cy }); sx = cx; sy = cy; }
          else cmds.push({ c: 'L', x: cx, y: cy });
          lastC = lastQ = null;
        } else if (C === 'L') {
          const x = readNum(), y = readNum(); if (x === null || y === null) break;
          cx = rel ? cx + x : x; cy = rel ? cy + y : y;
          cmds.push({ c: 'L', x: cx, y: cy }); lastC = lastQ = null;
        } else if (C === 'H') {
          const x = readNum(); if (x === null) break;
          cx = rel ? cx + x : x; cmds.push({ c: 'L', x: cx, y: cy }); lastC = lastQ = null;
        } else if (C === 'V') {
          const y = readNum(); if (y === null) break;
          cy = rel ? cy + y : y; cmds.push({ c: 'L', x: cx, y: cy }); lastC = lastQ = null;
        } else if (C === 'C' || C === 'S') {
          let x1, y1;
          if (C === 'C') {
            x1 = readNum(); y1 = readNum();
            if (x1 === null || y1 === null) break;
            if (rel) { x1 += cx; y1 += cy; }
          } else {
            x1 = lastC ? 2 * cx - lastC[0] : cx; y1 = lastC ? 2 * cy - lastC[1] : cy;
          }
          let x2 = readNum(), y2 = readNum(), x = readNum(), y = readNum();
          if (x2 === null || y2 === null || x === null || y === null) break;
          if (rel) { x2 += cx; y2 += cy; x += cx; y += cy; }
          cmds.push({ c: 'C', x1, y1, x2, y2, x, y });
          lastC = [x2, y2]; lastQ = null; cx = x; cy = y;
        } else if (C === 'Q' || C === 'T') {
          let x1, y1;
          if (C === 'Q') {
            x1 = readNum(); y1 = readNum();
            if (x1 === null || y1 === null) break;
            if (rel) { x1 += cx; y1 += cy; }
          } else {
            x1 = lastQ ? 2 * cx - lastQ[0] : cx; y1 = lastQ ? 2 * cy - lastQ[1] : cy;
          }
          let x = readNum(), y = readNum();
          if (x === null || y === null) break;
          if (rel) { x += cx; y += cy; }
          cmds.push({ c: 'Q', x1, y1, x, y });
          lastQ = [x1, y1]; lastC = null; cx = x; cy = y;
        } else if (C === 'A') {
          const rx = readNum(), ry = readNum(), rot = readNum(), large = readFlag(), sweep = readFlag();
          let x = readNum(), y = readNum();
          if (rx === null || ry === null || rot === null || large === null || sweep === null || x === null || y === null) break;
          if (rel) { x += cx; y += cy; }
          cmds.push({ c: 'A', rx, ry, rot, large, sweep, x0: cx, y0: cy, x, y });
          cx = x; cy = y; lastC = lastQ = null;
        } else break;
        first = false;
      } while (hasNum());
    }
  }

  function arcToCenter(x1, y1, rx, ry, phiDeg, fA, fS, x2, y2) {
    rx = Math.abs(rx); ry = Math.abs(ry);
    if (rx < 1e-9 || ry < 1e-9) return null;
    const phi = phiDeg * Math.PI / 180;
    const cs = Math.cos(phi), sn = Math.sin(phi);
    const dx2 = (x1 - x2) / 2, dy2 = (y1 - y2) / 2;
    const x1p = cs * dx2 + sn * dy2, y1p = -sn * dx2 + cs * dy2;
    const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) { const k = Math.sqrt(lambda); rx *= k; ry *= k; }
    const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    const coef = (fA !== fS ? 1 : -1) * Math.sqrt(Math.max(0, den > 0 ? num / den : 0));
    const cxp = coef * rx * y1p / ry, cyp = -coef * ry * x1p / rx;
    const cx = cs * cxp - sn * cyp + (x1 + x2) / 2;
    const cy = sn * cxp + cs * cyp + (y1 + y2) / 2;
    const ang = (ux, uy, vx, vy) => {
      const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      return a;
    };
    const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry;
    const vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;
    const t1 = Math.atan2(uy, ux);
    let dt = ang(ux, uy, vx, vy);
    if (!fS && dt > 0) dt -= Math.PI * 2;
    else if (fS && dt < 0) dt += Math.PI * 2;
    return { cx, cy, rx, ry, cs, sn, t1, dt };
  }

  /**
   * Flatten path data into polylines, applying matrix m. `tol` is the target
   * segment length in output units (mm).
   */
  function flattenPath(d, m, seg = 0.35) {
    const cmds = typeof d === 'string' ? parsePathData(d) : d;
    m = m || G.IDENTITY;
    const polys = [];
    let cur = null;
    let cx = 0, cy = 0, sx = 0, sy = 0;
    const T = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
    const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    const push = (x, y) => { const p = T(x, y); cur.push(p[0], p[1]); };
    const flush = () => { if (cur && cur.length >= 4) polys.push(cur); cur = null; };
    const ensure = () => { if (!cur) { cur = []; push(cx, cy); } };
    for (const c of cmds) {
      switch (c.c) {
        case 'M':
          flush();
          cx = sx = c.x; cy = sy = c.y;
          cur = []; push(cx, cy);
          break;
        case 'L':
          ensure(); push(c.x, c.y); cx = c.x; cy = c.y;
          break;
        case 'C': {
          ensure();
          const p0 = T(cx, cy), p1 = T(c.x1, c.y1), p2 = T(c.x2, c.y2), p3 = T(c.x, c.y);
          const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
          const k = Math.max(2, Math.min(400, Math.ceil(len / seg)));
          for (let i = 1; i <= k; i++) {
            const t = i / k, mt = 1 - t;
            const a = mt * mt * mt, b = 3 * mt * mt * t, cc = 3 * mt * t * t, dd = t * t * t;
            cur.push(a * p0[0] + b * p1[0] + cc * p2[0] + dd * p3[0], a * p0[1] + b * p1[1] + cc * p2[1] + dd * p3[1]);
          }
          cx = c.x; cy = c.y;
          break;
        }
        case 'Q': {
          ensure();
          const p0 = T(cx, cy), p1 = T(c.x1, c.y1), p2 = T(c.x, c.y);
          const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
          const k = Math.max(2, Math.min(400, Math.ceil(len / seg)));
          for (let i = 1; i <= k; i++) {
            const t = i / k, mt = 1 - t;
            cur.push(mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0], mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1]);
          }
          cx = c.x; cy = c.y;
          break;
        }
        case 'A': {
          ensure();
          const a = arcToCenter(cx, cy, c.rx, c.ry, c.rot, c.large, c.sweep, c.x, c.y);
          if (!a) { push(c.x, c.y); }
          else {
            const arcLen = Math.abs(a.dt) * Math.max(a.rx, a.ry) * scale;
            const k = Math.max(4, Math.min(720, Math.ceil(arcLen / seg)));
            for (let i = 1; i <= k; i++) {
              const t = a.t1 + a.dt * i / k;
              const ct = Math.cos(t), st = Math.sin(t);
              push(a.cx + a.rx * a.cs * ct - a.ry * a.sn * st, a.cy + a.rx * a.sn * ct + a.ry * a.cs * st);
            }
          }
          cx = c.x; cy = c.y;
          break;
        }
        case 'Z':
          if (cur) { push(sx, sy); }
          flush();
          cx = sx; cy = sy;
          break;
      }
    }
    flush();
    return polys;
  }

  // ---------------------------------------------------------------------------
  // SVG document import
  // ---------------------------------------------------------------------------
  function parseLength(v) {
    if (v === null || v === undefined || v === '') return null;
    const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*([a-z%]*)\s*$/i.exec(String(v));
    if (!m) return null;
    const num = parseFloat(m[1]);
    switch ((m[2] || 'px').toLowerCase()) {
      case 'mm': return num;
      case 'cm': return num * 10;
      case 'in': return num * 25.4;
      case 'pt': return num * 25.4 / 72;
      case 'pc': return num * 25.4 / 6;
      case 'px': return num * PX_TO_MM;
      case 'q': return num * 0.25;
      default: return null; // %, em, etc.
    }
  }

  /** Numbers in an SVG number list: separators may be whitespace, commas or just a sign ("10-5" = 10, -5). */
  const NUM_RE = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
  function numberList(str) {
    return (String(str || '').match(NUM_RE) || []).map(parseFloat).filter(isFinite);
  }

  function parseTransform(str) {
    let m = G.IDENTITY.slice();
    if (!str) return m;
    const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
    let r;
    while ((r = re.exec(str))) {
      const a = numberList(r[2]);
      let t = G.IDENTITY;
      switch (r[1]) {
        case 'matrix': if (a.length >= 6) t = a.slice(0, 6); break;
        case 'translate': t = [1, 0, 0, 1, a[0] || 0, a[1] || 0]; break;
        case 'scale': if (a.length) t = [a[0], 0, 0, a.length > 1 ? a[1] : a[0], 0, 0]; break;
        case 'rotate': {
          const ang = (a[0] || 0) * Math.PI / 180, cs = Math.cos(ang), sn = Math.sin(ang);
          const rot = [cs, sn, -sn, cs, 0, 0];
          if (a.length >= 3) t = G.matMul(G.matMul([1, 0, 0, 1, a[1], a[2]], rot), [1, 0, 0, 1, -a[1], -a[2]]);
          else t = rot;
          break;
        }
        case 'skewX': t = [1, 0, Math.tan((a[0] || 0) * Math.PI / 180), 1, 0, 0]; break;
        case 'skewY': t = [1, Math.tan((a[0] || 0) * Math.PI / 180), 0, 1, 0, 0]; break;
      }
      m = G.matMul(m, t);
    }
    return m;
  }

  function parseStyle(el) {
    const st = {};
    const attrs = ['stroke', 'fill', 'display', 'visibility', 'stroke-width', 'opacity'];
    for (const a of attrs) { const v = el.getAttribute(a); if (v !== null) st[a] = v.trim(); }
    const s = el.getAttribute('style');
    if (s) {
      s.split(';').forEach(kv => {
        const i = kv.indexOf(':');
        if (i < 0) return;
        const k = kv.slice(0, i).trim().toLowerCase(), v = kv.slice(i + 1).trim();
        if (attrs.includes(k)) st[k] = v;
      });
    }
    return st;
  }

  let colorCtx = null;
  function normColor(c) {
    if (!c || c === 'none' || c === 'transparent') return null;
    if (/^url\(/i.test(c)) return '#000000';
    if (c === 'currentColor') return '#000000';
    try {
      if (!colorCtx) colorCtx = document.createElement('canvas').getContext('2d');
      colorCtx.fillStyle = '#000000';
      colorCtx.fillStyle = c;
      return colorCtx.fillStyle.toLowerCase();
    } catch (e) { return '#000000'; }
  }

  const SKIP = new Set(['defs', 'clippath', 'mask', 'symbol', 'marker', 'pattern', 'metadata', 'title', 'desc', 'style', 'script',
    'lineargradient', 'radialgradient', 'filter', 'foreignobject', 'namedview', 'sodipodi:namedview']);

  /**
   * Import an SVG document string.
   * Returns { groups: [{color, polys, filled}], warnings: [] } with polys in mm, Y up.
   */
  function importSVG(text) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const err = doc.querySelector('parsererror');
    if (err) throw new Error('Could not parse SVG file.');
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg') throw new Error('Not an SVG file.');

    const warnings = new Set();
    // Root scaling: user units -> mm
    let rootM;
    const vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).filter(Boolean).map(parseFloat);
    const wMm = parseLength(root.getAttribute('width'));
    const hMm = parseLength(root.getAttribute('height'));
    if (vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      let sx = PX_TO_MM, sy = PX_TO_MM;
      if (wMm && hMm) { sx = wMm / vb[2]; sy = hMm / vb[3]; }
      else if (wMm) { sx = sy = wMm / vb[2]; }
      else if (hMm) { sx = sy = hMm / vb[3]; }
      const s = Math.min(sx, sy);
      rootM = G.matMul([s, 0, 0, s, 0, 0], [1, 0, 0, 1, -vb[0], -vb[1]]);
    } else {
      rootM = [PX_TO_MM, 0, 0, PX_TO_MM, 0, 0];
    }
    // flip Y so the result is Y-up
    rootM = G.matMul([1, 0, 0, -1, 0, 0], rootM);

    const groups = new Map();
    const addPolys = (color, polys, filled) => {
      if (!polys.length) return;
      const key = color || '#000000';
      if (!groups.has(key)) groups.set(key, { color: key, polys: [], filled: false });
      const g = groups.get(key);
      for (const p of polys) g.polys.push(p);
      if (filled) g.filled = true;
    };

    const num = (el, a, def = 0) => { const v = parseFloat(el.getAttribute(a)); return isFinite(v) ? v : def; };

    // <use> targets being expanded right now (cycle guard) and a total element budget, so neither a
    // circular reference nor a deeply nested fan-out of <use> elements can hang the page
    const expanding = new Set();
    const MAX_ELEMENTS = 200000;
    let visited = 0;

    function walk(el, m, inh, depth) {
      if (depth > 64) return;
      if (++visited > MAX_ELEMENTS) { warnings.add('The SVG is too complex: import stopped after ' + MAX_ELEMENTS.toLocaleString() + ' elements.'); return; }
      const tag = el.nodeName.toLowerCase().replace(/^svg:/, '');
      if (SKIP.has(tag)) return;
      const st = Object.assign({}, inh, parseStyle(el));
      if (st.display === 'none') return;
      const own = parseTransform(el.getAttribute('transform'));
      const M = G.matMul(m, own);

      const shapeColor = () => {
        const stroke = normColor(st.stroke);
        const fill = st.fill === undefined ? '#000000' : normColor(st.fill);
        return { color: stroke || fill || '#000000', filled: !!fill && !stroke, visible: !!(stroke || fill) };
      };
      const emit = (polys) => {
        if (st.visibility === 'hidden') return;
        const c = shapeColor();
        if (!c.visible) return;
        addPolys(c.color, polys, c.filled);
      };

      switch (tag) {
        case 'svg':
        case 'g':
        case 'a':
        case 'switch':
          for (const ch of el.children) walk(ch, M, st, depth + 1);
          if (tag === 'svg' && depth > 0) { /* nested svg: approximate, ignore its viewport */ }
          return;
        case 'use': {
          const href = el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
          if (!href || href[0] !== '#') return;
          const target = doc.querySelector('[id="' + href.slice(1).replace(/"/g, '') + '"]');
          // a reference to an ancestor or to an element already being expanded is circular: browsers
          // don't render it, so skip it
          if (!target || target.contains(el) || expanding.has(target)) return;
          const UM = G.matMul(M, [1, 0, 0, 1, num(el, 'x'), num(el, 'y')]);
          const ttag = target.nodeName.toLowerCase();
          expanding.add(target);
          if (ttag === 'symbol') { for (const ch of target.children) walk(ch, UM, st, depth + 1); }
          else walk(target, UM, st, depth + 1);
          expanding.delete(target);
          return;
        }
        case 'path':
          emit(flattenPath(el.getAttribute('d') || '', M));
          return;
        case 'line':
          emit([G.transformPoly([num(el, 'x1'), num(el, 'y1'), num(el, 'x2'), num(el, 'y2')], M)]);
          return;
        case 'polyline':
        case 'polygon': {
          const pts = numberList(el.getAttribute('points'));
          if (pts.length < 4) return;
          if (pts.length % 2) pts.pop();
          if (tag === 'polygon') pts.push(pts[0], pts[1]);
          emit([G.transformPoly(pts, M)]);
          return;
        }
        case 'rect': {
          const x = num(el, 'x'), y = num(el, 'y'), w = num(el, 'width'), h = num(el, 'height');
          if (w <= 0 || h <= 0) return;
          let rx = parseFloat(el.getAttribute('rx')), ry = parseFloat(el.getAttribute('ry'));
          if (!isFinite(rx) && isFinite(ry)) rx = ry;
          if (!isFinite(ry) && isFinite(rx)) ry = rx;
          rx = Math.min(isFinite(rx) ? rx : 0, w / 2); ry = Math.min(isFinite(ry) ? ry : 0, h / 2);
          let d;
          if (rx > 0 && ry > 0) {
            d = `M${x + rx},${y} H${x + w - rx} A${rx},${ry} 0 0 1 ${x + w},${y + ry} V${y + h - ry} A${rx},${ry} 0 0 1 ${x + w - rx},${y + h} H${x + rx} A${rx},${ry} 0 0 1 ${x},${y + h - ry} V${y + ry} A${rx},${ry} 0 0 1 ${x + rx},${y} Z`;
          } else d = `M${x},${y} H${x + w} V${y + h} H${x} Z`;
          emit(flattenPath(d, M));
          return;
        }
        case 'circle':
        case 'ellipse': {
          const cx = num(el, 'cx'), cy = num(el, 'cy');
          const rx = tag === 'circle' ? num(el, 'r') : num(el, 'rx');
          const ry = tag === 'circle' ? rx : num(el, 'ry');
          if (rx <= 0 || ry <= 0) return;
          const d = `M${cx + rx},${cy} A${rx},${ry} 0 1 1 ${cx - rx},${cy} A${rx},${ry} 0 1 1 ${cx + rx},${cy} Z`;
          emit(flattenPath(d, M));
          return;
        }
        case 'text':
          warnings.add('SVG <text> elements are skipped. Convert text to paths in your editor (Inkscape: Path > Object to Path) or use the Text tab.');
          return;
        case 'image':
          warnings.add('Embedded raster images inside the SVG are skipped. Use the Image tab to trace them.');
          return;
        default:
          // Unknown container-ish elements: try children
          if (el.children && el.children.length) for (const ch of el.children) walk(ch, M, st, depth + 1);
      }
    }

    walk(root, rootM, {}, 0);
    return { groups: Array.from(groups.values()), warnings: Array.from(warnings) };
  }

  // ---------------------------------------------------------------------------
  // SVG export (bed coordinates, mm)
  // ---------------------------------------------------------------------------
  function exportSVG(layers, bedW, bedH) {
    const f = (v) => PP.U.fmt(v, 3);
    const out = [];
    out.push('<?xml version="1.0" encoding="UTF-8"?>');
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${f(bedW)}mm" height="${f(bedH)}mm" viewBox="0 0 ${f(bedW)} ${f(bedH)}">`);
    for (const L of layers) {
      out.push(`  <g id="${PP.U.escapeHtml(L.name)}" fill="none" stroke="${L.color}" stroke-width="${f(L.width || 0.4)}" stroke-linecap="round" stroke-linejoin="round">`);
      for (const p of L.polys) {
        let d = '';
        for (let j = 0; j < p.length; j += 2) d += (j === 0 ? 'M' : 'L') + f(p[j]) + ' ' + f(bedH - p[j + 1]);
        out.push(`    <path d="${d}"/>`);
      }
      out.push('  </g>');
    }
    out.push('</svg>');
    return out.join('\n');
  }

  PP.SVG = { parsePathData, flattenPath, importSVG, exportSVG, parseTransform, parseLength };
})(window.PP = window.PP || {});
