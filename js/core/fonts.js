/*
 * PenPlot Studio - fonts and text layout.
 *  - Hershey single-stroke fonts (JSON) and EMS/Hershey SVG fonts from the hersheytext
 *    npm package: the local copy in vendor/ first (works offline), then jsDelivr.
 *  - "My Handwriting": a stroke font the user draws themselves (stored locally).
 *  - Custom TTF/OTF uploads (outline fonts) via opentype.js (vendor/ first, then cdnjs).
 * All glyphs are normalised so that cap height = 1, baseline at y = 0, Y up.
 *
 * The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the
 * U. S. National Bureau of Standards. The format of the Font data in this distribution
 * was originally created by James Hurt, Cognition, Inc. SVG versions prepared by
 * Windell H. Oskay, www.evilmadscientist.com (hersheytext by techninja, MIT).
 */
(function (PP) {
  'use strict';

  const U = PP.U, G = PP.Geo;
  // vendor/ is resolved against this script's URL so pages in subfolders (tests/) find it too.
  // file:// pages cannot fetch() local files, so they go straight to the CDN (scripts still load locally).
  const APP_ROOT = (function () {
    try { return new URL('../../', document.currentScript.src).href; } catch (e) { return ''; }
  })();
  const LOCAL_FETCH = typeof location === 'undefined' || location.protocol !== 'file:';
  const HERSHEY_BASES = [LOCAL_FETCH && APP_ROOT + 'vendor/hersheytext/', 'https://cdn.jsdelivr.net/npm/hersheytext@2.0.0/'].filter(Boolean);
  const OPENTYPE_URLS = [APP_ROOT + 'vendor/opentype/opentype.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/opentype.js/1.3.4/opentype.min.js'];
  const HAND_KEY = 'pp.handwriting.v1';
  const LINE_HEIGHT = 1.75; // in cap-height units
  const FALLBACK_FONT = 'h:futural';

  const events = new U.Emitter();

  const catalog = [];
  const byId = new Map();

  function reg(id, name, category, kind, source) {
    const f = { id, name, category, kind, source, loaded: false, loading: null, glyphs: new Map(), data: null, spaceAdv: 0.6 };
    catalog.push(f);
    byId.set(id, f);
    return f;
  }

  // ---- Hershey JSON fonts ----
  [
    ['futural', 'Sans 1-stroke', 'Hershey single-stroke'],
    ['scripts', 'Script 1-stroke', 'Hershey single-stroke'],
    ['cursive', 'Script 1-stroke (alt)', 'Hershey single-stroke'],
    ['greek', 'Greek 1-stroke', 'Hershey single-stroke'],
    ['futuram', 'Sans bold', 'Hershey multi-stroke'],
    ['scriptc', 'Script medium', 'Hershey multi-stroke'],
    ['timesr', 'Serif medium', 'Hershey multi-stroke'],
    ['timesi', 'Serif medium italic', 'Hershey multi-stroke'],
    ['timesrb', 'Serif bold', 'Hershey multi-stroke'],
    ['timesib', 'Serif bold italic', 'Hershey multi-stroke'],
    ['timesg', 'Greek medium', 'Hershey multi-stroke'],
    ['cyrillic', 'Cyrillic', 'Hershey multi-stroke'],
    ['gothiceng', 'Gothic English', 'Hershey multi-stroke'],
    ['gothicger', 'Gothic German', 'Hershey multi-stroke'],
    ['gothicita', 'Gothic Italian', 'Hershey multi-stroke'],
    ['astrology', 'Astrology symbols', 'Symbols'],
    ['markers', 'Markers', 'Symbols'],
    ['mathlow', 'Math (lower)', 'Symbols'],
    ['mathupp', 'Math (upper)', 'Symbols'],
    ['meteorology', 'Meteorology', 'Symbols'],
    ['music', 'Music', 'Symbols'],
    ['symbolic', 'Symbolic', 'Symbols'],
  ].forEach(([key, name, cat]) => reg('h:' + key, name, cat, 'stroke', { type: 'hjson', key }));

  // ---- EMS / Hershey SVG fonts ----
  [
    ['HersheySans1', 'Hershey Sans 1'],
    ['HersheySansMed', 'Hershey Sans Med'],
    ['HersheyScript1', 'Hershey Script 1'],
    ['HersheyScriptMed', 'Hershey Script Med'],
    ['HersheySerifMed', 'Hershey Serif Med'],
    ['HersheySerifMedItalic', 'Hershey Serif Med Italic'],
    ['HersheySerifBold', 'Hershey Serif Bold'],
    ['HersheySerifBoldItalic', 'Hershey Serif Bold Italic'],
    ['HersheyGothEnglish', 'Hershey Goth English'],
    ['EMSAllure', 'EMS Allure'],
    ['EMSElfin', 'EMS Elfin'],
    ['EMSFelix', 'EMS Felix'],
    ['EMSNixish', 'EMS Nixish'],
    ['EMSNixishItalic', 'EMS Nixish Italic'],
    ['EMSOsmotron', 'EMS Osmotron'],
    ['EMSReadability', 'EMS Readability'],
    ['EMSReadabilityItalic', 'EMS Readability Italic'],
    ['EMSTech', 'EMS Tech'],
  ].forEach(([file, name]) => reg('s:' + file, name, 'EMS single-stroke', 'stroke', { type: 'svgfont', file }));

  // ---- Handwriting ----
  const HAND_ID = 'hand:mine';
  reg(HAND_ID, 'My Handwriting', 'My fonts', 'stroke', { type: 'hand' });

  // ---------------------------------------------------------------------------
  // Loaders
  // ---------------------------------------------------------------------------
  /** Fetch `path` from the first base URL that serves it (local vendor/ copy, then CDN). */
  async function fetchFirst(bases, path, as) {
    let err = null;
    for (const base of bases) {
      try {
        const r = await fetch(base + path);
        if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + base + path);
        return await (as === 'json' ? r.json() : r.text());
      } catch (e) { err = e; }
    }
    throw err;
  }

  let hjsonPromise = null;
  function loadHersheyJSON() {
    if (!hjsonPromise) {
      hjsonPromise = fetchFirst(HERSHEY_BASES, 'hersheytext.min.json', 'json').catch(e => { hjsonPromise = null; throw e; });
    }
    return hjsonPromise;
  }

  function parseHersheyD(d) {
    const polys = [];
    const parts = d.split('M');
    for (const part of parts) {
      const nums = part.replace(/L/g, ' ').trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (nums.length >= 4) polys.push(nums);
      else if (nums.length === 2) polys.push([nums[0], nums[1], nums[0], nums[1]]);
    }
    return polys;
  }

  function setupHJSON(f, data) {
    const fd = data[f.source.key];
    if (!fd) throw new Error('Font missing: ' + f.source.key);
    const chars = fd.chars;
    // Metrics from 'H'
    let base = 22, cap = 21;
    const H = chars['H'.charCodeAt(0) - 33];
    if (H && H.d) {
      const b = G.bbox(parseHersheyD(H.d));
      if (b && b.maxY - b.minY > 1) { base = b.maxY; cap = b.maxY - b.minY; }
    }
    f.data = { chars, base, cap };
    f.spaceAdv = 16 / cap;
    f.glyphFn = (ch) => {
      const code = ch.codePointAt(0);
      const g = chars[code - 33];
      if (!g || code < 33 || code > 126) return null;
      const polys = parseHersheyD(g.d || '').map(p => {
        const out = new Array(p.length);
        for (let j = 0; j < p.length; j += 2) { out[j] = p[j] / cap; out[j + 1] = (base - p[j + 1]) / cap; }
        return out;
      });
      return { polys, adv: (2 * (parseFloat(g.o) || 8)) / cap };
    };
  }

  async function loadSVGFont(f) {
    const text = await fetchFirst(HERSHEY_BASES, 'svg_fonts/' + f.source.file + '.svg', 'text');
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const fontEl = doc.querySelector('font');
    const face = doc.querySelector('font-face');
    const upem = parseFloat(face && face.getAttribute('units-per-em')) || 1000;
    const defAdv = parseFloat(fontEl && fontEl.getAttribute('horiz-adv-x')) || upem * 0.5;
    const glyphs = new Map();
    doc.querySelectorAll('glyph').forEach(g => {
      const u = g.getAttribute('unicode');
      if (!u) return;
      const cps = Array.from(u);
      if (cps.length !== 1) return;
      glyphs.set(cps[0], { d: g.getAttribute('d') || '', adv: parseFloat(g.getAttribute('horiz-adv-x')) || defAdv });
    });
    let cap = parseFloat(face && face.getAttribute('cap-height')) || upem * 0.7;
    const H = glyphs.get('H');
    if (H && H.d) {
      const b = G.bbox(PP.SVG.flattenPath(H.d, null, 5));
      if (b && b.maxY > upem * 0.1) cap = b.maxY;
    }
    f.data = { glyphs, cap };
    const sp = glyphs.get(' ');
    f.spaceAdv = (sp ? sp.adv : defAdv) / cap;
    f.glyphFn = (ch) => {
      const g = glyphs.get(ch);
      if (!g) return null;
      const polys = g.d ? PP.SVG.flattenPath(g.d, [1 / cap, 0, 0, 1 / cap, 0, 0], 0.02) : [];
      return { polys, adv: g.adv / cap };
    };
  }

  // ---- handwriting ----
  function readHand() {
    try { return JSON.parse(localStorage.getItem(HAND_KEY) || 'null') || { glyphs: {} }; }
    catch (e) { return { glyphs: {} }; }
  }
  function setupHand(f) {
    const data = readHand();
    f.data = data;
    f.spaceAdv = data.spaceAdv || 0.55;
    f.glyphFn = (ch) => {
      const g = data.glyphs[ch];
      if (!g || !g.strokes || !g.strokes.length) return null;
      return { polys: g.strokes.map(s => s.slice()), adv: g.adv };
    };
  }

  // ---- fonts installed on this computer (Local Font Access API: Chrome/Edge and the desktop app) ----
  const systemFonts = new Map(); // font id -> FontData
  /** Add the installed fonts to the catalog ("On this computer"); resolves with how many there are. */
  async function listSystemFonts() {
    if (typeof window.queryLocalFonts !== 'function') throw new Error('This browser cannot list installed fonts - use Upload font, or the desktop app.');
    const list = await window.queryLocalFonts();
    let added = 0;
    for (const fd of list) {
      const id = 'sys:' + fd.postscriptName;
      if (byId.has(id)) continue;
      systemFonts.set(id, fd);
      reg(id, fd.fullName || fd.postscriptName, 'On this computer', 'outline', { type: 'system' });
      added++;
    }
    // 'loaded' with no id clears every cached text layout: objects that used a not-yet-registered installed font
    // were laid out in the fallback font
    if (added) { events.emit('catalog'); events.emit('loaded', null); }
    return systemFonts.size;
  }
  /** At startup: list installed fonts without asking, if permission was already granted. */
  async function restoreSystemFonts() {
    try {
      if (typeof window.queryLocalFonts !== 'function' || !navigator.permissions) return;
      const st = await navigator.permissions.query({ name: 'local-fonts' });
      if (st.state === 'granted') await listSystemFonts();
    } catch (e) { /* not supported */ }
  }
  async function loadSystemFont(f) {
    const fd = systemFonts.get(f.id);
    if (!fd) throw new Error('Installed font not available - click "Installed fonts" again.');
    const ot = await loadOpenType();
    let font;
    try { font = ot.parse(await (await fd.blob()).arrayBuffer()); } catch (e) { throw new Error('Cannot read "' + f.name + '" (font collections and some formats are not supported).', { cause: e }); }
    f.glyphs.clear();
    setupOTF(f, font);
  }

  // ---- opentype ----
  let otPromise = null;
  function loadOpenType() {
    if (window.opentype) return Promise.resolve(window.opentype);
    if (!otPromise) {
      otPromise = OPENTYPE_URLS.reduce((p, url) => p.catch(() => U.loadScript(url)), Promise.reject(new Error('no source')))
        .then(() => window.opentype).catch(e => { otPromise = null; throw e; });
    }
    return otPromise;
  }

  function setupOTF(f, font) {
    const upem = font.unitsPerEm || 1000;
    let cap = (font.tables && font.tables.os2 && font.tables.os2.sCapHeight) || 0;
    if (!cap) {
      const H = font.charToGlyph('H');
      const bb = H && H.getBoundingBox && H.getBoundingBox();
      cap = bb && bb.y2 > 0 ? bb.y2 : upem * 0.7;
    }
    f.data = { font, cap };
    const space = font.charToGlyph(' ');
    f.spaceAdv = ((space && space.advanceWidth) || upem * 0.25) / cap;
    f.glyphFn = (ch) => {
      const glyph = font.charToGlyph(ch);
      if (!glyph || glyph.index === 0) return null;
      const path = glyph.getPath(0, 0, upem);
      const cmds = [];
      for (const c of path.commands) {
        // opentype.js getPath returns y-down; flip to y-up
        if (c.type === 'M') cmds.push({ c: 'M', x: c.x, y: -c.y });
        else if (c.type === 'L') cmds.push({ c: 'L', x: c.x, y: -c.y });
        else if (c.type === 'C') cmds.push({ c: 'C', x1: c.x1, y1: -c.y1, x2: c.x2, y2: -c.y2, x: c.x, y: -c.y });
        else if (c.type === 'Q') cmds.push({ c: 'Q', x1: c.x1, y1: -c.y1, x: c.x, y: -c.y });
        else if (c.type === 'Z') cmds.push({ c: 'Z' });
      }
      const polys = PP.SVG.flattenPath(cmds, [1 / cap, 0, 0, 1 / cap, 0, 0], 0.02);
      return { polys, adv: (glyph.advanceWidth || 0) / cap, glyph };
    };
    f.kernFn = (a, b) => {
      try {
        const ga = font.charToGlyph(a), gb = font.charToGlyph(b);
        return (font.getKerningValue(ga, gb) || 0) / cap;
      } catch (e) { return 0; }
    };
  }

  async function addCustomFont(buffer, fileName, persist = true) {
    const ot = await loadOpenType();
    const font = ot.parse(buffer);
    let name = (font.names && font.names.fullName && (font.names.fullName.en || Object.values(font.names.fullName)[0])) || fileName || 'Custom font';
    name = String(name);
    const id = 'otf:' + name;
    let f = byId.get(id);
    if (!f) f = reg(id, name, 'Uploaded fonts', 'outline', { type: 'otf' });
    f.glyphs.clear();
    setupOTF(f, font);
    f.loaded = true;
    if (persist && PP.Storage) {
      try {
        await PP.Storage.set('font:' + name, buffer);
        const list = (await PP.Storage.get('fontlist')) || [];
        if (!list.includes(name)) { list.push(name); await PP.Storage.set('fontlist', list); }
      } catch (e) { console.warn('Could not persist font', e); }
    }
    events.emit('loaded', id);
    events.emit('catalog');
    return id;
  }

  async function restoreCustomFonts() {
    if (!PP.Storage) return;
    try {
      const list = (await PP.Storage.get('fontlist')) || [];
      for (const name of list) {
        const buf = await PP.Storage.get('font:' + name);
        if (buf) { try { await addCustomFont(buf, name, false); } catch (e) { console.warn('Font restore failed', name, e); } }
      }
    } catch (e) { console.warn(e); }
  }

  async function removeCustomFont(id) {
    const f = byId.get(id);
    if (!f || f.source.type !== 'otf') return;
    const name = f.name;
    catalog.splice(catalog.indexOf(f), 1);
    byId.delete(id);
    if (PP.Storage) {
      await PP.Storage.del('font:' + name);
      const list = ((await PP.Storage.get('fontlist')) || []).filter(n => n !== name);
      await PP.Storage.set('fontlist', list);
    }
    events.emit('catalog');
  }

  function load(id) {
    const f = byId.get(id);
    if (!f) return Promise.reject(new Error('Unknown font ' + id));
    if (f.loaded) return Promise.resolve(f);
    if (f.loading) return f.loading;
    f.loading = (async () => {
      try {
        if (f.source.type === 'hjson') setupHJSON(f, await loadHersheyJSON());
        else if (f.source.type === 'svgfont') await loadSVGFont(f);
        else if (f.source.type === 'hand') { setupHand(f); await load(FALLBACK_FONT).catch(() => {}); }
        else if (f.source.type === 'system') await loadSystemFont(f);
        else if (f.source.type === 'otf') throw new Error('Custom font not available - please upload it again.');
        f.loaded = true;
        events.emit('loaded', id);
        return f;
      } catch (e) {
        f.error = e.message || String(e);
        events.emit('error', id, f.error);
        throw e;
      } finally {
        f.loading = null;
      }
    })();
    return f.loading;
  }

  function glyph(f, ch) {
    if (f.glyphs.has(ch)) return f.glyphs.get(ch);
    let g;
    try { g = f.glyphFn ? f.glyphFn(ch) : null; } catch (e) { g = null; }
    f.glyphs.set(ch, g);
    return g;
  }

  // ---------------------------------------------------------------------------
  // Text layout
  // ---------------------------------------------------------------------------
  /**
   * Lay out text. Returns {polys, ready} in mm (Y up), first baseline at y=0.
   * opts: size (cap height, mm), letterSpacing (mm), lineSpacing (multiplier),
   *       align ('left'|'center'|'right'), arc (radius mm, 0 = straight)
   */
  function layout(text, fontId, opts = {}) {
    const size = opts.size || 10;
    const ls = (opts.letterSpacing || 0) / size;
    const lineH = LINE_HEIGHT * (opts.lineSpacing || 1);
    const align = opts.align || 'left';
    let f = byId.get(fontId) || byId.get(FALLBACK_FONT);
    if (!f.loaded) { load(f.id).catch(() => {}); return { polys: [], ready: false }; }
    const fb = byId.get(FALLBACK_FONT);
    const useFallback = f.source.type === 'hand' && fb.loaded;

    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    const lineData = [];
    for (let li = 0; li < lines.length; li++) {
      const chars = Array.from(lines[li]);
      const polys = [];
      let x = 0;
      let prev = null;
      for (let ci = 0; ci < chars.length; ci++) {
        const ch = chars[ci];
        if (ch === ' ' || ch === '\t') {
          x += (ch === '\t' ? 4 : 1) * f.spaceAdv + ls;
          prev = null;
          continue;
        }
        let g = glyph(f, ch);
        let gf = f;
        if (!g && useFallback) { g = glyph(fb, ch); gf = fb; }
        if (!g) { x += f.spaceAdv + ls; prev = null; continue; }
        if (prev && f.kernFn && gf === f) x += f.kernFn(prev, ch);
        const y = -li * lineH;
        for (const p of g.polys) {
          const q = new Array(p.length);
          for (let j = 0; j < p.length; j += 2) { q[j] = p[j] + x; q[j + 1] = p[j + 1] + y; }
          polys.push(q);
        }
        x += g.adv + ls;
        prev = ch;
      }
      lineData.push({ polys, width: Math.max(0, x - ls) });
    }
    const maxW = lineData.reduce((m, l) => Math.max(m, l.width), 0);
    let out = [];
    for (const l of lineData) {
      const dx = align === 'center' ? (maxW - l.width) / 2 : align === 'right' ? (maxW - l.width) : 0;
      for (const p of l.polys) {
        const q = new Array(p.length);
        for (let j = 0; j < p.length; j += 2) { q[j] = (p[j] + dx) * size; q[j + 1] = p[j + 1] * size; }
        out.push(q);
      }
    }
    const R = opts.arc || 0;
    if (Math.abs(R) > 1 && out.length) {
      const cx = maxW * size / 2;
      out = out.map(p => {
        const r = G.resample(p, 0.4);
        const q = new Array(r.length);
        for (let j = 0; j < r.length; j += 2) {
          const x = r[j] - cx, y = r[j + 1];
          const th = x / R;
          q[j] = (R + y) * Math.sin(th);
          q[j + 1] = (R + y) * Math.cos(th) - R;
        }
        return q;
      });
    }
    return { polys: out, ready: true };
  }

  // ---------------------------------------------------------------------------
  // Handwriting font editing API
  // ---------------------------------------------------------------------------
  function getHandwriting() { return readHand(); }
  function saveHandwriting(data) {
    localStorage.setItem(HAND_KEY, JSON.stringify(data));
    const f = byId.get(HAND_ID);
    f.glyphs.clear();
    if (f.loaded) setupHand(f);
    events.emit('loaded', HAND_ID);
  }

  PP.Fonts = {
    events,
    LINE_HEIGHT,
    DEFAULT: FALLBACK_FONT,
    HAND_ID,
    list: () => catalog.slice(),
    get: (id) => byId.get(id) || null,
    isReady: (id) => { const f = byId.get(id); return !!(f && f.loaded); },
    load,
    layout,
    addCustomFont,
    removeCustomFont,
    restoreCustomFonts,
    getHandwriting,
    saveHandwriting,
    loadOpenType,
    listSystemFonts,
    restoreSystemFonts,
  };
})(window.PP = window.PP || {});
