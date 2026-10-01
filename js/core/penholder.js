/*
 * PenPlot Studio - pen-holder bore resizer.
 *
 * Changes the diameter of the round pen bore of a printed pen-holder part (cartridge, spring) without scaling
 * anything else: the old bore is filled with a plug and a new bore is cut on the same axis. Uses manifold-3d
 * (vendor/manifold, WebAssembly) for the mesh booleans. Works on any STL with one round bore: the axis, center,
 * diameter and the pen's path through the part are detected from cross-sections.
 *
 *   const api = await PP.PenHolder.load();
 *   const part = PP.PenHolder.analyze(api, PP.STL.parse(buffer).tris);   // { d, axis, maxD, runs, ... }
 *   const out = PP.PenHolder.resize(api, part, 8.4);                     // { tris, d, preview }
 */
(function (PP) {
  'use strict';

  // vendor/ next to js/, found from this script's URL (works from tests/ and the desktop app's app:// too)
  const BASE = (function () {
    try { return new URL('../../vendor/manifold/', document.currentScript.src).href; } catch (e) { return 'vendor/manifold/'; }
  })();
  const ROT = { x: [0, 90, 0], y: [90, 0, 0], z: [0, 0, 0] };
  const INV = { x: [0, -90, 0], y: [-90, 0, 0], z: [0, 0, 0] };
  const STEP = 0.1;          // slice spacing along the bore (mm)
  const MIN_WALL = 1.2;      // thinnest wall left around a bigger bore (3 lines at a 0.4 mm nozzle)
  const MIN_D = 2;           // smallest bore

  let loading = null;
  /** Load manifold-3d once. opts: { moduleUrl, wasmBinary } (tests pass the file directly). */
  function load(opts = {}) {
    if (!loading) {
      const url = opts.moduleUrl || BASE + 'manifold.js';
      loading = import(/* @vite-ignore */ url).then(async (mod) => {
        const Module = mod.default || mod;
        const args = { locateFile: (f) => new URL(f, url).href };
        if (opts.wasmBinary) args.wasmBinary = opts.wasmBinary;
        const api = await Module(args);
        api.setup();
        return api;
      }).catch((e) => { loading = null; throw new Error('Could not load the 3D library (' + e.message + '). Run the app from its local server or the desktop app.', { cause: e }); });
    }
    return loading;
  }

  /** Triangle soup -> manifold (vertices merged). */
  function toManifold(api, tris) {
    const map = new Map(), pos = [], idx = new Uint32Array(tris.length / 3);
    for (let i = 0; i < tris.length; i += 3) {
      const key = tris[i].toFixed(4) + ',' + tris[i + 1].toFixed(4) + ',' + tris[i + 2].toFixed(4);
      let id = map.get(key);
      if (id === undefined) { id = pos.length / 3; map.set(key, id); pos.push(tris[i], tris[i + 1], tris[i + 2]); }
      idx[i / 3] = id;
    }
    const mesh = new api.Mesh({ numProp: 3, vertProperties: new Float32Array(pos), triVerts: idx });
    mesh.merge();
    const m = new api.Manifold(mesh);
    if (m.status() !== 'NoError') { m.delete(); throw new Error('The mesh is not a closed solid (' + m.status() + ') - repair it in your slicer first.'); }
    return m;
  }

  function toTris(m) {
    const mesh = m.getMesh();
    const P = mesh.vertProperties, T = mesh.triVerts, np = mesh.numProp;
    const out = new Float32Array(T.length * 3);
    for (let i = 0; i < T.length; i++) { const v = T[i] * np; out[i * 3] = P[v]; out[i * 3 + 1] = P[v + 1]; out[i * 3 + 2] = P[v + 2]; }
    return out;
  }

  const area = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
  const centroid = (p) => { let x = 0, y = 0; for (const q of p) { x += q[0]; y += q[1]; } return [x / p.length, y / p.length]; };
  function roundHole(p) {
    const A = area(p);
    if (A >= 0 || p.length < 12) return null;
    const [cx, cy] = centroid(p);
    const rs = p.map(q => Math.hypot(q[0] - cx, q[1] - cy));
    const d = 2 * Math.sqrt(-A / Math.PI);
    if (Math.max(...rs) - Math.min(...rs) > Math.max(0.15, 0.04 * d)) return null;
    return { cx, cy, d };
  }
  function winding(polys, x, y) {
    let w = 0;
    for (const p of polys) {
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        if (a[1] <= y) { if (b[1] > y && (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]) > 0) w++; }
        else if (b[1] <= y && (b[0] - a[0]) * (y - a[1]) - (x - a[0]) * (b[1] - a[1]) < 0) w--;
      }
    }
    return w;
  }
  function nearest(polys, x, y, skip) {
    let best = Infinity;
    for (const p of polys) {
      if (skip(p)) continue;
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length], dx = b[0] - a[0], dy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
        best = Math.min(best, Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y));
      }
    }
    return best;
  }

  /**
   * How far the bore may grow on one slice, by casting rays out from the axis every 2 degrees. Where a ray starts
   * in the bore's own wall (material from the bore radius, or a coaxial chamfer), keep minWall of it; where it
   * first meets something further out (a link between spring rings, the far side of a slot), stop just short.
   * A split (C-shaped) ring is its own wall, not an obstacle - the nearest-edge measure got that wrong.
   */
  function rayLimit(polys, cx, cy, r0, minWall, isCoaxialHole) {
    const coax = polys.map(isCoaxialHole);
    let lim = Infinity;
    for (let a = 0; a < 360; a += 2) {
      const ux = Math.cos(a * Math.PI / 180), uy = Math.sin(a * Math.PI / 180);
      const hits = [];
      polys.forEach((p, pi) => {
        for (let i = 0; i < p.length; i++) {
          const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
          const ex = x2 - x1, ey = y2 - y1, den = ux * ey - uy * ex;
          if (Math.abs(den) < 1e-12) continue;
          const wx = x1 - cx, wy = y1 - cy;
          const t = (wx * ey - wy * ex) / den, sP = (wx * uy - wy * ux) / den;
          if (t > 0 && sP >= 0 && sP < 1) hits.push([t, pi]);
        }
      });
      if (!hits.length) continue;
      hits.sort((p, q) => p[0] - q[0]);
      // the axis is in air (it is on the pen's path): hits alternate entering and leaving material
      const [entry, ep] = hits[0];
      const exit = hits.length > 1 ? hits[1][0] : Infinity;
      // within 0.5 mm of the bore radius it is the bore's own wall (faceting, a split ring's slot edges)
      const ownWall = entry <= r0 + 0.5 || coax[ep];
      lim = Math.min(lim, ownWall ? exit - minWall : entry - 0.05);
    }
    return lim;
  }

  /** Find the pen bore: the round hole seen in the most cross-sections, on any of the three axes. */
  function findBore(api, m0) {
    let best = null;
    for (const axis of ['x', 'y', 'z']) {
      const m = m0.rotate(ROT[axis]);
      const bb = m.boundingBox();
      const clusters = [];
      for (let k = 1; k <= 24; k++) {
        const z = bb.min[2] + (bb.max[2] - bb.min[2]) * k / 25;
        for (const p of m.slice(z).toPolygons()) {
          const h = roundHole(p);
          if (!h || h.d < 3 || h.d > 30) continue;
          const c = clusters.find(c => Math.hypot(c.cx - h.cx, c.cy - h.cy) < 0.3 && Math.abs(c.d - h.d) < 0.3);
          if (c) { c.n++; c.d += (h.d - c.d) / c.n; } else clusters.push({ cx: h.cx, cy: h.cy, d: h.d, n: 1 });
        }
      }
      for (const c of clusters) if (c.n >= 3 && (!best || c.n > best.n || (c.n === best.n && c.d > best.d))) best = Object.assign({ axis }, c);
      m.delete();
    }
    return best;
  }

  /**
   * Analyze a part: bore axis/center/diameter, the stretches where it runs through material ("bore" runs, which get
   * plugged), the pen's path through the part (bore plus air, up to solid material; this is cut), and the largest
   * bore the walls allow.
   */
  function analyze(api, tris, opts = {}) {
    const minWall = opts.minWall != null ? opts.minWall : MIN_WALL;
    const m0 = toManifold(api, tris);
    const bore = findBore(api, m0);
    if (!bore) { m0.delete(); throw new Error('No round pen bore found in this part.'); }
    const m = m0.rotate(ROT[bore.axis]);
    m0.delete();
    const bb = m.boundingBox();
    const { cx, cy, d } = bore;
    const isCoaxialHole = (p) => { if (area(p) >= 0) return false; const [x, y] = centroid(p); return Math.hypot(x - cx, y - cy) < 0.3; };
    const slices = [];
    for (let z = bb.min[2] + STEP / 2; z < bb.max[2]; z += STEP) {
      const polys = m.slice(z).toPolygons();
      const isBore = polys.some(p => { const h = roundHole(p); return h && Math.hypot(h.cx - cx, h.cy - cy) < 0.3 && Math.abs(h.d - d) < 0.35; });
      const state = isBore ? 'bore' : winding(polys, cx, cy) > 0 ? 'solid' : 'air';
      // room: distance to anything that is not the bore itself (or a coaxial chamfer) - decides whether the
      // original pen could pass here; grow: how far the bore may grow on this slice (ray casting)
      const room = state === 'solid' ? 0 : nearest(polys, cx, cy, isCoaxialHole);
      const grow = state === 'solid' ? 0 : rayLimit(polys, cx, cy, d / 2, minWall, isCoaxialHole);
      slices.push({ z, state, room, grow });
    }
    // The pen's path: runs of slices the ORIGINAL pen could pass (bore, or air with nothing nearer the axis than
    // the old bore) that contain bore. Air next to a nearby block or arm is not on the path (the pen never went
    // there), so it is neither cut nor counted against the size limit. Plug runs: consecutive bore slices.
    // a split ring's own inner wall sits right at the bore radius: still passable for the original pen
    const passable = (s) => s.state === 'bore' || (s.state === 'air' && s.room >= d / 2 - 0.15);
    const paths = [], plugs = [];
    let i = 0;
    while (i < slices.length) {
      if (!passable(slices[i])) { i++; continue; }
      let j = i;
      while (j + 1 < slices.length && passable(slices[j + 1])) j++;
      if (slices.slice(i, j + 1).some(s => s.state === 'bore')) {
        const z0 = i === 0 ? bb.min[2] - 1 : slices[i].z - STEP / 2;
        const z1 = j === slices.length - 1 ? bb.max[2] + 1 : slices[j].z + STEP / 2;
        let rMax = Infinity;
        for (let k = i; k <= j; k++) rMax = Math.min(rMax, slices[k].grow);
        paths.push({ z0, z1, rMax });
        for (let k = i; k <= j; k++) {
          if (slices[k].state !== 'bore') continue;
          let e = k;
          while (e + 1 <= j && slices[e + 1].state === 'bore') e++;
          plugs.push({ z0: slices[k].z - STEP / 2, z1: slices[e].z + STEP / 2 });
          k = e;
        }
      }
      i = j + 1;
    }
    const rMax = Math.min(...paths.map(p => p.rMax));
    const maxD = Math.max(MIN_D, Math.floor(2 * rMax * 10) / 10);
    const boreLen = plugs.reduce((s, p) => s + p.z1 - p.z0, 0);
    const mid = plugs.slice().sort((a, b) => (b.z1 - b.z0) - (a.z1 - a.z0))[0];
    const previewZ = (mid.z0 + mid.z1) / 2;
    return {
      axis: bore.axis, cx, cy, d: Math.round(d * 100) / 100, maxD, minD: MIN_D, minWall, boreLen,
      paths, plugs, previewZ, size: [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]],
      preview: m.slice(previewZ).toPolygons(), center: [cx, cy],
      _m: m,
    };
  }

  /** New part with the bore at diameter newD (mm). Returns { tris, d, preview } in the part's original orientation. */
  function resize(api, part, newD) {
    if (!(newD >= part.minD && newD <= part.maxD + 1e-9)) throw new Error('Bore ' + newD.toFixed(2) + ' mm is outside what this part supports (' + part.minD + '–' + part.maxD + ' mm).');
    const { Manifold } = api;
    const temps = [];
    const keep = (x) => { temps.push(x); return x; };
    try {
      let r = part._m;
      for (const p of part.plugs) {
        // a little larger than the old (faceted) bore so the fill swallows its wall completely
        const plug = keep(Manifold.cylinder(p.z1 - p.z0, part.d / 2 + 0.05, -1, 128).translate([part.cx, part.cy, p.z0]));
        r = keep(r.add(plug));
      }
      for (const p of part.paths) {
        const cut = keep(Manifold.cylinder(p.z1 - p.z0, newD / 2, -1, 128).translate([part.cx, part.cy, p.z0]));
        r = keep(r.subtract(cut));
      }
      const preview = r.slice(part.previewZ).toPolygons();
      const back = keep(r.rotate(INV[part.axis]));
      return { tris: toTris(back), d: newD, preview, volume: back.volume() };
    } finally {
      for (const t of temps) t.delete();
    }
  }

  function free(part) { if (part && part._m) { part._m.delete(); part._m = null; } }

  PP.PenHolder = { load, analyze, resize, free, toManifold, MIN_WALL };
})(window.PP = window.PP || {});
