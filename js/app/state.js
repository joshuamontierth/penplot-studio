/*
 * PenPlot Studio - project state, layers, selection, undo/redo, autosave.
 * Objects are immutable: every edit replaces the object, so undo snapshots are
 * cheap arrays of references.
 */
(function (PP) {
  'use strict';

  const U = PP.U;
  const events = new U.Emitter();
  const MAX_HISTORY = 120;

  const PAPER_PRESETS = [
    { id: 'letter', name: 'Letter (8.5 x 11 in)', w: 215.9, h: 279.4 },
    { id: 'halfletter', name: 'Half Letter (5.5 x 8.5 in)', w: 139.7, h: 215.9 },
    { id: 'a4', name: 'A4 (210 x 297 mm)', w: 210, h: 297 },
    { id: 'a5', name: 'A5 (148 x 210 mm)', w: 148, h: 210 },
    { id: 'a6', name: 'A6 (105 x 148 mm)', w: 105, h: 148 },
    { id: 'card57', name: 'Card 5 x 7 in', w: 127, h: 177.8 },
    { id: 'post46', name: 'Postcard 4 x 6 in', w: 101.6, h: 152.4 },
    { id: 'sq200', name: 'Square 200 mm', w: 200, h: 200 },
    { id: 'custom', name: 'Custom', w: 200, h: 150 },
  ];

  const PEN_COLORS = ['#1a1a1a', '#1f5fd6', '#d63a2f', '#1d9e5a', '#8a3fd1', '#e38b12', '#d6358f', '#0f9fb0'];

  function defaultLayer(i) {
    return { id: U.uid('l'), name: 'Layer ' + (i + 1), color: PEN_COLORS[i % PEN_COLORS.length], visible: true, locked: false, penWidth: 0.5, zDraw: null, speed: null, tool: 'pen' };
  }

  // A layer's tool is 'pen' or 'cut' (drag knife, docs/cutting.md). There is at most one cut layer and it is always
  // plotted last: the knife goes on after every pen.
  function cutLast(layers, keepId) {
    const cuts = layers.filter(l => l.tool === 'cut');
    const keep = cuts.find(l => l.id === keepId) || cuts[cuts.length - 1];
    return layers.filter(l => l !== keep).map(l => (l.tool === 'cut' ? Object.assign({}, l, { tool: 'pen' }) : l)).concat(keep ? [keep] : []);
  }

  function newProject() {
    const l = defaultLayer(0);
    return {
      app: 'PenPlot Studio',
      format: 1,
      name: 'Untitled plot',
      layers: [l],
      objects: [],
      activeLayerId: l.id,
      paper: { preset: 'letter', landscape: false, w: 215.9, h: 279.4, x: 0, y: 0, visible: true },
    };
  }

  const S = {
    events,
    PAPER_PRESETS,
    PEN_COLORS,
    project: newProject(),
    selection: [],
    undoStack: [],
    redoStack: [],
    dirty: false,
  };

  function snapshot() {
    const p = S.project;
    return {
      name: p.name,
      layers: p.layers.map(l => Object.assign({}, l)),
      objects: p.objects.slice(),
      activeLayerId: p.activeLayerId,
      paper: Object.assign({}, p.paper),
      selection: S.selection.slice(),
    };
  }

  function restore(snap) {
    const p = S.project;
    p.name = snap.name;
    p.layers = snap.layers.map(l => Object.assign({}, l));
    p.objects = snap.objects.slice();
    p.activeLayerId = snap.activeLayerId;
    p.paper = Object.assign({}, snap.paper);
    const ids = new Set(p.objects.map(o => o.id));
    S.selection = snap.selection.filter(id => ids.has(id));
  }

  /** Record the current state so the next change can be undone. */
  S.checkpoint = function () {
    S.undoStack.push(snapshot());
    if (S.undoStack.length > MAX_HISTORY) S.undoStack.shift();
    S.redoStack.length = 0;
    events.emit('history');
  };

  S.undo = function () {
    if (!S.undoStack.length) return;
    S.redoStack.push(snapshot());
    restore(S.undoStack.pop());
    changed('undo');
    events.emit('selection');
    events.emit('history');
  };

  S.redo = function () {
    if (!S.redoStack.length) return;
    S.undoStack.push(snapshot());
    restore(S.redoStack.pop());
    changed('redo');
    events.emit('selection');
    events.emit('history');
  };

  function changed(kind) {
    S.dirty = true;
    events.emit('change', kind);
    autosave();
  }
  S.changed = changed;

  // ---------------------------------------------------------------------------
  // Layers
  // ---------------------------------------------------------------------------
  S.layer = (id) => S.project.layers.find(l => l.id === id) || null;
  S.activeLayer = () => S.layer(S.project.activeLayerId) || S.project.layers[0];

  S.addLayer = function (props) {
    S.checkpoint();
    const l = Object.assign(defaultLayer(S.project.layers.length), props || {});
    S.project.layers.push(l);
    S.project.layers = cutLast(S.project.layers, l.tool === 'cut' ? l.id : null);
    S.project.activeLayerId = l.id;
    changed('layers');
    return l;
  };

  S.updateLayer = function (id, patch, opts = {}) {
    const i = S.project.layers.findIndex(l => l.id === id);
    if (i < 0) return;
    if (opts.history !== false) S.checkpoint();
    S.project.layers[i] = Object.assign({}, S.project.layers[i], patch);
    S.project.layers = cutLast(S.project.layers, patch.tool === 'cut' ? id : null);
    changed('layers');
  };

  S.removeLayer = function (id) {
    const p = S.project;
    if (p.layers.length <= 1) return false;
    S.checkpoint();
    const i = p.layers.findIndex(l => l.id === id);
    if (i < 0) return false;
    p.layers.splice(i, 1);
    p.objects = p.objects.filter(o => o.layerId !== id);
    if (p.activeLayerId === id) p.activeLayerId = p.layers[Math.max(0, i - 1)].id;
    S.selection = S.selection.filter(sid => p.objects.some(o => o.id === sid));
    changed('layers');
    events.emit('selection');
    return true;
  };

  /** Move a layer to position `index` (0 = plotted first). */
  S.moveLayerTo = function (id, index) {
    const L = S.project.layers;
    const i = L.findIndex(l => l.id === id);
    const j = Math.max(0, Math.min(L.length - 1, Math.round(index)));
    if (i < 0 || i === j) return;
    S.checkpoint();
    const [layer] = L.splice(i, 1);
    L.splice(j, 0, layer);
    S.project.layers = cutLast(L);
    changed('layers');
  };

  S.moveLayer = function (id, dir) {
    const L = S.project.layers;
    const i = L.findIndex(l => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= L.length) return;
    S.checkpoint();
    const t = L[i]; L[i] = L[j]; L[j] = t;
    S.project.layers = cutLast(L);
    changed('layers');
  };

  S.setActiveLayer = function (id) {
    if (!S.layer(id)) return;
    S.project.activeLayerId = id;
    events.emit('change', 'active-layer');
  };

  // ---------------------------------------------------------------------------
  // Objects
  // ---------------------------------------------------------------------------
  S.get = (id) => S.project.objects.find(o => o.id === id) || null;

  S.add = function (objs, opts = {}) {
    if (!Array.isArray(objs)) objs = [objs];
    if (!objs.length) return [];
    if (opts.history !== false) S.checkpoint();
    const layerId = opts.layerId || S.activeLayer().id;
    const added = objs.map(o => Object.assign({}, o, { layerId: o.layerId && S.layer(o.layerId) ? o.layerId : layerId }));
    S.project.objects.push(...added);
    if (opts.select !== false) S.selection = added.map(o => o.id);
    changed('objects');
    events.emit('selection');
    return added;
  };

  /** Replace fields of an object. opts.history=false for live drags (call checkpoint first). */
  S.update = function (id, patch, opts = {}) {
    const arr = S.project.objects;
    const i = arr.findIndex(o => o.id === id);
    if (i < 0) return null;
    if (opts.history !== false) S.checkpoint();
    const next = Object.assign({}, arr[i], typeof patch === 'function' ? patch(arr[i]) : patch);
    arr[i] = next;
    changed(opts.kind || 'objects');
    return next;
  };

  /** Update many objects at once: patches = Map/obj id -> patch (or function). */
  S.updateMany = function (patches, opts = {}) {
    const arr = S.project.objects;
    if (opts.history !== false) S.checkpoint();
    const entries = patches instanceof Map ? Array.from(patches.entries()) : Object.entries(patches);
    const idx = new Map(arr.map((o, i) => [o.id, i]));
    for (const [id, patch] of entries) {
      const i = idx.get(id);
      if (i === undefined) continue;
      arr[i] = Object.assign({}, arr[i], typeof patch === 'function' ? patch(arr[i]) : patch);
    }
    changed(opts.kind || 'objects');
  };

  /** Replace an object entirely (e.g. convert to path). */
  S.replace = function (id, obj, opts = {}) {
    const arr = S.project.objects;
    const i = arr.findIndex(o => o.id === id);
    if (i < 0) return;
    if (opts.history !== false) S.checkpoint();
    arr[i] = Object.assign({}, obj, { id });
    changed('objects');
  };

  S.remove = function (ids, opts = {}) {
    if (!Array.isArray(ids)) ids = [ids];
    const set = new Set(ids);
    if (!S.project.objects.some(o => set.has(o.id))) return;
    if (opts.history !== false) S.checkpoint();
    S.project.objects = S.project.objects.filter(o => !set.has(o.id));
    S.selection = S.selection.filter(id => !set.has(id));
    changed('objects');
    events.emit('selection');
  };

  /** Move objects up/down in draw order within the full list. dir: +1 forward, -1 backward, 'top', 'bottom'. */
  S.reorder = function (ids, dir) {
    const arr = S.project.objects;
    const set = new Set(ids);
    S.checkpoint();
    if (dir === 'top' || dir === 'bottom') {
      const sel = arr.filter(o => set.has(o.id)), rest = arr.filter(o => !set.has(o.id));
      S.project.objects = dir === 'top' ? rest.concat(sel) : sel.concat(rest);
    } else if (dir > 0) {
      for (let i = arr.length - 2; i >= 0; i--) if (set.has(arr[i].id) && !set.has(arr[i + 1].id)) { const t = arr[i]; arr[i] = arr[i + 1]; arr[i + 1] = t; }
    } else {
      for (let i = 1; i < arr.length; i++) if (set.has(arr[i].id) && !set.has(arr[i - 1].id)) { const t = arr[i]; arr[i] = arr[i - 1]; arr[i - 1] = t; }
    }
    changed('objects');
  };

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------
  S.select = function (ids, additive = false) {
    if (!Array.isArray(ids)) ids = [ids];
    if (additive) {
      const set = new Set(S.selection);
      for (const id of ids) { if (set.has(id)) set.delete(id); else set.add(id); }
      S.selection = Array.from(set);
    } else S.selection = ids.slice();
    events.emit('selection');
  };
  S.clearSelection = function () { if (!S.selection.length) return; S.selection = []; events.emit('selection'); };
  S.selected = () => S.selection.map(S.get).filter(Boolean);
  S.isSelected = (id) => S.selection.includes(id);

  /** Objects that can be edited (layer visible and unlocked, object unlocked). */
  S.isEditable = function (o) {
    const l = S.layer(o.layerId);
    return !!l && l.visible && !l.locked && !o.locked;
  };

  // ---------------------------------------------------------------------------
  // Paper
  // ---------------------------------------------------------------------------
  S.setPaper = function (patch, opts = {}) {
    if (opts.history !== false) S.checkpoint();
    S.project.paper = Object.assign({}, S.project.paper, patch);
    changed('paper');
  };

  // ---------------------------------------------------------------------------
  // Serialisation
  // ---------------------------------------------------------------------------
  S.serialize = function () {
    const p = S.project;
    return {
      app: 'PenPlot Studio', format: 1, savedAt: new Date().toISOString(),
      name: p.name, layers: p.layers, activeLayerId: p.activeLayerId, paper: p.paper,
      objects: p.objects.map(o => {
        const c = {};
        for (const k in o) if (o[k] !== undefined) c[k] = o[k];
        if (c.paths) c.paths = c.paths.map(pl => pl.map(v => Math.round(v * 1000) / 1000));
        return c;
      }),
    };
  };

  S.load = function (data, opts = {}) {
    if (!data || !Array.isArray(data.layers) || !Array.isArray(data.objects)) throw new Error('This is not a PenPlot Studio project file.');
    if (opts.history !== false) S.checkpoint();
    const base = newProject();
    const layers = cutLast(data.layers.length ? data.layers.map((l, i) => Object.assign(defaultLayer(i), l, { tool: l.tool === 'cut' ? 'cut' : 'pen' })) : base.layers);
    const layerIds = new Set(layers.map(l => l.id));
    S.project = {
      app: 'PenPlot Studio', format: 1,
      name: data.name || 'Untitled plot',
      layers,
      objects: data.objects.filter(o => o && typeof o === 'object' && o.type).map(o => {
        const out = Object.assign({}, o, { layerId: layerIds.has(o.layerId) ? o.layerId : layers[0].id });
        for (const [k, def] of [['x', 0], ['y', 0], ['rotation', 0], ['scaleX', 1], ['scaleY', 1]]) out[k] = Number.isFinite(out[k]) ? out[k] : def;
        if (!out.id) out.id = U.uid('o');
        return out;
      }),
      activeLayerId: layerIds.has(data.activeLayerId) ? data.activeLayerId : layers[0].id,
      paper: Object.assign(base.paper, data.paper || {}),
    };
    // drop objects whose geometry cannot be built (a hand-edited or corrupt file), so one bad object cannot break
    // rendering, planning and - through autosave - every later session
    const before = S.project.objects.length;
    S.project.objects = S.project.objects.filter(o => { try { PP.Objects.world(o); return true; } catch (e) { return false; } });
    S.selection = [];
    changed('load');
    events.emit('selection');
    return { dropped: before - S.project.objects.length };
  };

  S.reset = function () {
    S.checkpoint();
    S.project = newProject();
    S.selection = [];
    changed('load');
    events.emit('selection');
  };

  // ---------------------------------------------------------------------------
  // Autosave
  // ---------------------------------------------------------------------------
  S.autosaveEnabled = true;
  let savePending = false;
  const saveNow = () => {
    savePending = false;
    if (!PP.Storage || !S.autosaveEnabled) return;
    try {
      PP.Storage.set('autosave', S.serialize());
    } catch (e) { console.warn('Autosave failed', e); }
  };
  const debouncedSave = U.debounce(() => { if (savePending) saveNow(); }, 800);
  const autosave = () => { savePending = true; debouncedSave(); };
  /** Write a pending autosave right away (called when the page is hidden or closed). */
  S.flushAutosave = () => { if (savePending) saveNow(); };

  S.restoreAutosave = async function () {
    if (!PP.Storage) return false;
    try {
      const data = await PP.Storage.get('autosave');
      if (data && data.objects) {
        S.load(data, { history: false });
        S.undoStack.length = 0; S.redoStack.length = 0;
        S.dirty = false;
        events.emit('history');
        return true;
      }
    } catch (e) { console.warn('Could not restore autosave', e); }
    return false;
  };

  PP.Store = S;
})(window.PP = window.PP || {});
