/*
 * PenPlot Studio - design objects.
 * Every object has a transform (x, y, rotation, scaleX, scaleY) and local geometry
 * centered on (0, 0). Types: path, text, shape, pattern.
 * Objects are treated as immutable: edits replace the object (see state.js).
 */
(function (PP) {
  'use strict';

  const U = PP.U, G = PP.Geo;

  const DEFAULT_FILL = { enabled: false, spacing: 0.8, angle: 45, cross: false, outline: true };

  function base(type, props) {
    return Object.assign({
      id: U.uid('o'),
      type,
      name: '',
      layerId: null,
      x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
      locked: false,
      fill: null,
    }, props || {});
  }

  const create = {
    path(paths, props) {
      const c = G.center(paths);
      return base('path', Object.assign({ name: 'Path', paths: c.polys, x: c.cx, y: c.cy }, props || {}));
    },
    text(props) {
      return base('text', Object.assign({
        name: 'Text', text: 'Hello', font: PP.Fonts.DEFAULT, size: 10, letterSpacing: 0, lineSpacing: 1, align: 'center', arc: 0,
      }, props || {}));
    },
    shape(shape, props) {
      return base('shape', Object.assign({ name: shape[0].toUpperCase() + shape.slice(1), shape, w: 40, h: 40, sides: 6, points: 5, inner: 0.45, radius: 0 }, props || {}));
    },
    pattern(generator, params, props) {
      const d = PP.Patterns ? PP.Patterns.get(generator) : null;
      return base('pattern', Object.assign({ name: d ? d.name : 'Pattern', generator, params: Object.assign({}, PP.Patterns ? PP.Patterns.defaults(generator) : {}, params || {}) }, props || {}));
    },
  };

  // ---------------------------------------------------------------------------
  // Geometry cache
  // ---------------------------------------------------------------------------
  const pathCache = new WeakMap();     // paths array -> Map(fillKey -> geom)
  const paramCache = new Map();        // string key -> geom
  const worldCache = new WeakMap();    // object -> world geom
  const MAX_PARAM_CACHE = 150;
  let epoch = 0;                       // bumped when fonts change, invalidates world cache

  function fillKey(o) {
    const f = o.fill;
    if (!f || !f.enabled) return 'nofill';
    const s = Math.sqrt(Math.abs(o.scaleX * o.scaleY)) || 1;
    // quantise scale so live resizing does not recompute every frame for tiny changes
    const qs = Math.round(Math.log(s) * 40);
    return [f.spacing, f.angle, f.cross ? 1 : 0, f.outline === false ? 0 : 1, qs, Math.round(o.rotation)].join(',');
  }

  function rawLocal(o) {
    switch (o.type) {
      case 'path': return { polys: o.paths || [], ready: true };
      case 'text': {
        const r = PP.Fonts.layout(o.text, o.font, { size: o.size, letterSpacing: o.letterSpacing, lineSpacing: o.lineSpacing, align: o.align, arc: o.arc });
        return { polys: G.center(r.polys).polys, ready: r.ready };
      }
      case 'shape': {
        const hw = o.w, hh = o.h;
        let p;
        if (o.shape === 'rect') p = G.rect(hw, hh, o.radius || 0);
        else if (o.shape === 'ellipse') p = G.ellipse(hw / 2, hh / 2);
        else if (o.shape === 'polygon') p = G.polygon(Math.max(3, Math.round(o.sides || 6)), hw / 2, hh / 2);
        else if (o.shape === 'star') p = G.star(Math.max(3, Math.round(o.points || 5)), hw / 2, hh / 2, U.clamp(o.inner || 0.45, 0.05, 0.95));
        else p = G.rect(hw, hh);
        return { polys: [p], ready: true };
      }
      case 'pattern': {
        if (!PP.Patterns) return { polys: [], ready: false };
        let polys = [];
        try { polys = PP.Patterns.generate(o.generator, o.params); } catch (e) { console.error('Pattern failed', e); }
        return { polys: G.center(polys).polys, ready: true };
      }
    }
    return { polys: [], ready: true };
  }

  function withFill(o, polys) {
    const f = o.fill;
    if (!f || !f.enabled) return polys;
    const loops = G.closedLoops(polys);
    if (!loops.length) return polys;
    const s = Math.sqrt(Math.abs(o.scaleX * o.scaleY)) || 1;
    const spacing = Math.max(0.1, f.spacing || 0.8) / s;
    const mirror = (o.scaleX * o.scaleY) < 0 ? -1 : 1;
    const ang = mirror * ((f.angle || 0) - o.rotation);
    let hatch = G.hatch(loops, spacing, ang);
    if (f.cross) hatch = hatch.concat(G.hatch(loops, spacing, ang + 90));
    return (f.outline === false ? [] : polys).concat(hatch);
  }

  function paramKey(o) {
    switch (o.type) {
      case 'text': return 'T|' + JSON.stringify([o.text, o.font, o.size, o.letterSpacing, o.lineSpacing, o.align, o.arc]);
      case 'shape': return 'S|' + JSON.stringify([o.shape, o.w, o.h, o.sides, o.points, o.inner, o.radius]);
      case 'pattern': return 'P|' + o.generator + '|' + JSON.stringify(o.params);
    }
    return null;
  }

  /** Local geometry (centered, before transform, including hatch fill). {polys, bbox, ready} */
  function local(o) {
    const fk = fillKey(o);
    if (o.type === 'path') {
      let m = pathCache.get(o.paths);
      if (!m) { m = new Map(); pathCache.set(o.paths, m); }
      let g = m.get(fk);
      if (!g) {
        const polys = withFill(o, o.paths || []);
        g = { polys, bbox: G.bbox(o.paths || []), ready: true };
        m.set(fk, g);
      }
      return g;
    }
    const key = paramKey(o) + '#' + fk;
    let g = paramCache.get(key);
    if (g) return g;
    const raw = rawLocal(o);
    g = { polys: withFill(o, raw.polys), bbox: G.bbox(raw.polys), ready: raw.ready };
    if (raw.ready) {
      paramCache.set(key, g);
      if (paramCache.size > MAX_PARAM_CACHE) paramCache.delete(paramCache.keys().next().value);
    }
    return g;
  }

  function matrix(o) { return G.matTRS(o.x, o.y, o.rotation, o.scaleX, o.scaleY); }

  /** World geometry: {polys, bbox, path2d (lazy)} */
  function world(o) {
    let w = worldCache.get(o);
    if (w && w.epoch === epoch) return w;
    const l = local(o);
    const m = matrix(o);
    const polys = G.transform(l.polys, m);
    w = { polys, bbox: G.bbox(polys), ready: l.ready, _path: null, epoch: l.ready ? epoch : -1 };
    worldCache.set(o, w);
    return w;
  }

  function path2d(o) {
    const w = world(o);
    if (!w._path) {
      const p2 = new Path2D();
      for (const p of w.polys) {
        if (p.length < 4) continue;
        p2.moveTo(p[0], p[1]);
        if (p.length === 4 && p[0] === p[2] && p[1] === p[3]) { p2.lineTo(p[0] + 0.01, p[1]); continue; }
        for (let j = 2; j < p.length; j += 2) p2.lineTo(p[j], p[j + 1]);
      }
      w._path = p2;
    }
    return w._path;
  }

  /** Corners of the transformed local bbox (for selection outlines). */
  function corners(o) {
    const l = local(o);
    const b = l.bbox || { minX: -5, minY: -5, maxX: 5, maxY: 5 };
    const m = matrix(o);
    return [
      G.apply(m, b.minX, b.minY), G.apply(m, b.maxX, b.minY),
      G.apply(m, b.maxX, b.maxY), G.apply(m, b.minX, b.maxY),
    ];
  }

  /** World-space size of the object along its own axes. */
  function size(o) {
    const b = local(o).bbox;
    if (!b) return { w: 0, h: 0 };
    return { w: (b.maxX - b.minX) * Math.abs(o.scaleX), h: (b.maxY - b.minY) * Math.abs(o.scaleY) };
  }

  function hit(o, x, y, tol) {
    const w = world(o);
    if (!w.bbox) return false;
    const b = w.bbox;
    if (x < b.minX - tol || x > b.maxX + tol || y < b.minY - tol || y > b.maxY + tol) return false;
    if (G.hitPolys(w.polys, x, y, tol)) return true;
    // Filled shapes / text: allow clicking inside closed loops
    if (o.type === 'text' || (o.fill && o.fill.enabled)) {
      const loops = G.closedLoops(w.polys);
      if (loops.length && G.pointInLoops(loops, x, y)) return true;
      if (o.type === 'text') return true; // inside the text bbox counts
    }
    // Small unfilled shapes: clicking inside still selects them (big frames only by their outline)
    if (o.type === 'shape' && (b.maxX - b.minX) < 25 && (b.maxY - b.minY) < 25) {
      const loops = G.closedLoops(w.polys);
      if (loops.length && G.pointInLoops(loops, x, y)) return true;
    }
    return false;
  }

  /** Convert any object into a plain path object (bakes transform and hatch). */
  function toPath(o) {
    const w = world(o);
    const c = G.center(w.polys);
    return Object.assign({}, o, {
      type: 'path', paths: c.polys, x: c.cx, y: c.cy, rotation: 0, scaleX: 1, scaleY: 1, fill: null,
      name: o.type === 'path' ? o.name : (o.name || o.type) + ' (path)',
      // drop type-specific props
      text: undefined, font: undefined, generator: undefined, params: undefined, shape: undefined,
    });
  }

  function clearFontCache(fontId) {
    for (const k of Array.from(paramCache.keys())) {
      if (k.startsWith('T|') && (!fontId || k.indexOf(JSON.stringify(fontId)) >= 0 || fontId === PP.Fonts.DEFAULT)) paramCache.delete(k);
    }
    epoch++;
  }

  function describe(o) {
    switch (o.type) {
      case 'text': return 'Text';
      case 'shape': return o.shape ? o.shape[0].toUpperCase() + o.shape.slice(1) : 'Shape';
      case 'pattern': return 'Pattern';
      default: return 'Path';
    }
  }

  PP.Objects = { create, local, world, matrix, path2d, corners, size, hit, toPath, clearFontCache, describe, DEFAULT_FILL };
})(window.PP = window.PP || {});
