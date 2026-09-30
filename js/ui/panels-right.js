/* PenPlot Studio - right panel: selection properties, layers, paper, plotter settings, plot summary. */
(function (PP) {
  'use strict';

  const U = PP.U, S = PP.Store, G = PP.Geo, OBJ = PP.Objects, h = U.h;
  const UI = PP.UI;

  // ---------------------------------------------------------------------------
  // Selection properties
  // ---------------------------------------------------------------------------
  function buildProps(host) {
    const sec = UI.section('Selection', null);
    host.appendChild(sec);
    const body = sec.body;
    let sig = '';
    let fields = null;
    let aspectLock = PP.Storage.getLocal('aspectLock', true);

    function signature() {
      const sel = S.selected();
      return sel.map(o => o.id + ':' + o.type + ':' + o.layerId + ':' + (o.locked ? 1 : 0) + ':' + (o.fill && o.fill.enabled ? 1 : 0)).join('|') + '#' + S.project.layers.length;
    }

    function groupInfo(sel) {
      if (sel.length === 1) {
        const o = sel[0];
        const sz = OBJ.size(o);
        return { x: o.x, y: o.y, w: sz.w, h: sz.h, rot: o.rotation };
      }
      let bb = null;
      for (const o of sel) bb = G.bboxUnion(bb, OBJ.world(o).bbox);
      if (!bb) return { x: 0, y: 0, w: 0, h: 0, rot: 0 };
      return { x: (bb.minX + bb.maxX) / 2, y: (bb.minY + bb.maxY) / 2, w: bb.maxX - bb.minX, h: bb.maxY - bb.minY, rot: 0 };
    }

    function applyGeom(key, v) {
      const sel = S.selected().filter(S.isEditable);
      if (!sel.length) return;
      const gi = groupInfo(sel);
      if (sel.length === 1) {
        const o = sel[0];
        if (key === 'x' || key === 'y') { S.update(o.id, { [key]: v }); return; }
        if (key === 'rot') { S.update(o.id, { rotation: v }); return; }
        const base = OBJ.local(o).bbox;
        if (!base) return;
        const bw = base.maxX - base.minX, bh = base.maxY - base.minY;
        if (key === 'w' && bw > 0) {
          const sx = Math.sign(o.scaleX || 1) * Math.max(0.001, v / bw);
          const k = sx / o.scaleX;
          S.update(o.id, aspectLock ? { scaleX: sx, scaleY: o.scaleY * k } : { scaleX: sx });
        } else if (key === 'h' && bh > 0) {
          const sy = Math.sign(o.scaleY || 1) * Math.max(0.001, v / bh);
          const k = sy / o.scaleY;
          S.update(o.id, aspectLock ? { scaleY: sy, scaleX: o.scaleX * k } : { scaleY: sy });
        }
        return;
      }
      if (key === 'x' || key === 'y') {
        const d = v - gi[key];
        S.updateMany(new Map(sel.map(o => [o.id, { [key]: o[key] + d }])));
      } else if (key === 'w' || key === 'h') {
        const k = v / Math.max(0.001, gi[key]);
        S.updateMany(new Map(sel.map(o => [o.id, { x: gi.x + (o.x - gi.x) * k, y: gi.y + (o.y - gi.y) * k, scaleX: o.scaleX * k, scaleY: o.scaleY * k }])));
      }
    }

    function build() {
      U.clear(body);
      fields = null;
      const sel = S.selected();
      if (!sel.length) {
        body.appendChild(h('div', { class: 'empty-sel' },
          h('p', null, 'Nothing selected.'),
          h('p', { class: 'hint' }, 'Click an object to edit it, or drag to box-select.')));
        sec.classList.add('dim');
        return;
      }
      sec.classList.remove('dim');
      const single = sel.length === 1 ? sel[0] : null;
      const editable = sel.every(S.isEditable);
      const gi = groupInfo(sel);

      // title row
      if (single) {
        const nameIn = h('input', { class: 'name-input', value: single.name || OBJ.describe(single), spellcheck: 'false' });
        nameIn.addEventListener('change', () => S.update(single.id, { name: nameIn.value }));
        nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') nameIn.blur(); e.stopPropagation(); });
        body.appendChild(h('div', { class: 'row gap' }, h('span', { class: 'type-badge' }, OBJ.describe(single)), nameIn));
      } else {
        body.appendChild(h('div', { class: 'row gap' }, h('span', { class: 'type-badge' }, sel.length + ' objects')));
      }

      const fx = UI.numberField({ label: 'X', unit: 'mm', value: U.round(gi.x, 2), step: 0.5, decimals: 2, onChange: (v) => applyGeom('x', v) });
      const fy = UI.numberField({ label: 'Y', unit: 'mm', value: U.round(gi.y, 2), step: 0.5, decimals: 2, onChange: (v) => applyGeom('y', v) });
      const fw = UI.numberField({ label: 'W', unit: 'mm', value: U.round(gi.w, 2), min: 0.01, step: 0.5, decimals: 2, onChange: (v) => applyGeom('w', v) });
      const fh = UI.numberField({ label: 'H', unit: 'mm', value: U.round(gi.h, 2), min: 0.01, step: 0.5, decimals: 2, onChange: (v) => applyGeom('h', v) });
      const lockBtn = UI.iconBtn(aspectLock ? 'lock' : 'unlock', 'Lock aspect ratio', () => {
        aspectLock = !aspectLock; PP.Storage.setLocal('aspectLock', aspectLock);
        lockBtn.innerHTML = ''; lockBtn.appendChild(UI.icon(aspectLock ? 'lock' : 'unlock', 16));
        lockBtn.classList.toggle('on', aspectLock);
      }, { size: 16, cls: aspectLock ? 'on' : '' });
      const fr = UI.numberField({ label: 'Rotation', unit: '°', value: U.round(gi.rot, 2), min: -360, max: 360, step: 1, decimals: 1, onChange: (v) => applyGeom('rot', v) });
      const grid = h('div', { class: 'grid2' }, fx, fy, fw, fh);
      body.appendChild(grid);
      body.appendChild(h('div', { class: 'row gap aspect-row' }, lockBtn, h('span', { class: 'hint' }, 'Center position in pen coordinates (mm from the front-left corner)')));
      if (single) body.appendChild(fr);
      fields = { fx, fy, fw, fh, fr };

      const ops = PP.App.ops;
      body.appendChild(h('div', { class: 'btn-row' },
        UI.iconBtn('fliph', 'Mirror horizontally', () => ops.mirror('x')),
        UI.iconBtn('flipv', 'Mirror vertically', () => ops.mirror('y')),
        UI.iconBtn('rotate', 'Rotate 90°', () => ops.rotateBy(-90)),
        h('button', { class: 'icon-btn txt', title: 'Rotate 180°', onclick: () => ops.rotateBy(180) }, '180°'),
        UI.iconBtn('copy', 'Duplicate (Ctrl+D)', () => ops.duplicate()),
        UI.iconBtn('trash', 'Delete (Del)', () => ops.remove(), { cls: 'danger' })));

      body.appendChild(h('div', { class: 'field' }, h('label', null, 'Position'),
        h('div', { class: 'btn-row wrap' },
          UI.btn('Center on paper', () => ops.align('center', 'paper'), { small: true, icon: 'center' }),
          UI.btn('Center in drawable', () => ops.align('center', 'drawable'), { small: true }),
          UI.btn('Fit to paper', () => ops.fit(10), { small: true, icon: 'fit', title: 'Scale to fit the paper/drawable area with a 10 mm margin' }))));

      // layer
      body.appendChild(UI.selectField({
        label: 'Layer (pen)',
        value: single ? single.layerId : (sel.every(o => o.layerId === sel[0].layerId) ? sel[0].layerId : ''),
        options: [{ value: '', label: '(mixed)' }].filter(() => !single && !sel.every(o => o.layerId === sel[0].layerId)).concat(S.project.layers.map(l => ({ value: l.id, label: l.name }))),
        onChange: (v) => v && ops.moveToLayer(v),
      }));

      // type specific
      if (single && single.type === 'text') {
        body.appendChild(UI.btn('Edit text & font', () => UI.focusTextEditor(), { small: true, icon: 'text' }));
      }
      if (single && single.type === 'pattern') {
        body.appendChild(UI.btn('Edit pattern parameters', () => UI.editPattern ? UI.editPattern() : UI.showTab('patterns'), { small: true, icon: 'star' }));
      }
      if (single && single.type === 'shape') {
        const o = single;
        const sp = [];
        if (o.shape === 'rect') sp.push(UI.numberField({ label: 'Corner radius', unit: 'mm', value: o.radius || 0, min: 0, max: 100, step: 0.5, slider: true, decimals: 1, onInput: (v) => UI.liveEdit(o.id, { radius: v }), onChange: (v) => UI.liveEdit(o.id, { radius: v }, true) }));
        if (o.shape === 'polygon') sp.push(UI.numberField({ label: 'Sides', value: o.sides || 6, min: 3, max: 48, step: 1, slider: true, onInput: (v) => UI.liveEdit(o.id, { sides: v }), onChange: (v) => UI.liveEdit(o.id, { sides: v }, true) }));
        if (o.shape === 'star') {
          sp.push(UI.numberField({ label: 'Points', value: o.points || 5, min: 3, max: 48, step: 1, slider: true, onInput: (v) => UI.liveEdit(o.id, { points: v }), onChange: (v) => UI.liveEdit(o.id, { points: v }, true) }));
          sp.push(UI.numberField({ label: 'Inner radius', unit: '×', value: o.inner || 0.45, min: 0.05, max: 0.95, step: 0.01, slider: true, decimals: 2, onInput: (v) => UI.liveEdit(o.id, { inner: v }), onChange: (v) => UI.liveEdit(o.id, { inner: v }, true) }));
        }
        sp.forEach(f => body.appendChild(f));
      }

      // hatch fill
      const fillable = sel.some(o => o.type !== 'text' || (PP.Fonts.get(o.font) || {}).kind === 'outline' || true);
      if (fillable) {
        const f0 = Object.assign({}, OBJ.DEFAULT_FILL, (single && single.fill) || (sel[0].fill) || {});
        const enabled = sel.every(o => o.fill && o.fill.enabled);
        const setFill = (patch, final = true) => {
          const targets = S.selected().filter(S.isEditable);
          if (!targets.length) return;
          const m = new Map(targets.map(o => [o.id, { fill: Object.assign({}, OBJ.DEFAULT_FILL, o.fill || {}, patch) }]));
          if (final) S.updateMany(m); else { if (!setFill._live) { S.checkpoint(); setFill._live = true; } S.updateMany(m, { history: false }); }
          if (final) setFill._live = false;
        };
        const sub = h('div', { class: 'sub' },
          UI.numberField({ label: 'Line spacing', unit: 'mm', value: f0.spacing, min: 0.2, max: 10, step: 0.05, slider: true, decimals: 2, onInput: (v) => setFill({ spacing: v }, false), onChange: (v) => setFill({ spacing: v }) }),
          UI.numberField({ label: 'Angle', unit: '°', value: f0.angle, min: -90, max: 90, step: 1, slider: true, onInput: (v) => setFill({ angle: v }, false), onChange: (v) => setFill({ angle: v }) }),
          UI.checkField({ label: 'Cross-hatch', value: f0.cross, onChange: (v) => setFill({ cross: v }) }),
          UI.checkField({ label: 'Draw outline too', value: f0.outline !== false, onChange: (v) => setFill({ outline: v }) }));
        sub.style.display = enabled ? '' : 'none';
        const fillSec = UI.section('Hatch fill', [
          UI.checkField({ label: 'Fill closed shapes with hatch lines', value: enabled, onChange: (v) => { setFill({ enabled: v }); } }),
          sub,
          h('div', { class: 'hint' }, 'Only closed outlines are filled (rectangles, circles, SVG shapes, outline-font letters).'),
        ], { collapsible: true, collapsed: !enabled });
        fillSec.classList.add('inner-sec');
        body.appendChild(fillSec);
      }

      body.appendChild(h('div', { class: 'btn-row wrap' },
        UI.btn('Bring to front', () => S.reorder(S.selection, 'top'), { small: true, icon: 'up' }),
        UI.btn('Send to back', () => S.reorder(S.selection, 'bottom'), { small: true, icon: 'down' }),
        UI.btn(sel.every(o => o.locked) ? 'Unlock' : 'Lock', () => ops.toggleLock(), { small: true, icon: sel.every(o => o.locked) ? 'unlock' : 'lock' }),
        UI.btn('Convert to path', () => ops.toPath(), { small: true, icon: 'paths', title: 'Bake text/shape/pattern/fill into editable path lines' }),
        sel.length > 1 ? UI.btn('Combine', () => ops.combine(), { small: true, icon: 'combine', title: 'Merge into one path object' }) : null));
      if (!editable) body.appendChild(h('div', { class: 'hint warn' }, 'Some selected objects are locked or on a locked/hidden layer.'));
    }

    function refreshValues() {
      if (!fields) return;
      const sel = S.selected();
      if (!sel.length) return;
      const gi = groupInfo(sel);
      fields.fx.setValue(U.round(gi.x, 2)); fields.fy.setValue(U.round(gi.y, 2));
      fields.fw.setValue(U.round(gi.w, 2)); fields.fh.setValue(U.round(gi.h, 2));
      fields.fr.setValue(U.round(gi.rot, 2));
    }

    let raf = 0;
    const update = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const s = signature();
        if (s !== sig) { sig = s; build(); } else refreshValues();
      });
    };
    S.events.on('selection', update);
    S.events.on('change', update);
    build();
  }

  // ---------------------------------------------------------------------------
  // Layers
  // ---------------------------------------------------------------------------
  function buildLayers(host) {
    const addB = UI.iconBtn('plus', 'Add layer (another pen color)', () => S.addLayer(), { size: 16 });
    const sec = UI.section('Layers / pens', null, { extra: addB });
    host.appendChild(sec);
    const list = h('div', { class: 'layer-list' });
    sec.body.appendChild(list);
    sec.body.appendChild(h('div', { class: 'hint' }, 'One layer per pen, plotted top to bottom.'));
    const expanded = new Set();

    let lastNameClick = { id: null, t: 0 };
    let renaming = null; // layer id being renamed: delayed re-renders wait so the input is not destroyed
    function startRename(id) {
      const L = S.project.layers.find(l => l.id === id);
      const name = L && list.querySelector('.layer-row[data-layer="' + CSS.escape(id) + '"] .layer-name');
      if (!name) return;
      const inp = h('input', { class: 'layer-rename', value: L.name });
      name.replaceWith(inp);
      renaming = id;
      inp.focus(); inp.select();
      const done = () => { renaming = null; const v = inp.value.trim(); if (v && v !== L.name) S.updateLayer(L.id, { name: v }); else render(); };
      inp.addEventListener('blur', done);
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = L.name; inp.blur(); } });
    }

    function render() {
      U.clear(list);
      const counts = new Map();
      for (const o of S.project.objects) counts.set(o.layerId, (counts.get(o.layerId) || 0) + 1);
      S.project.layers.forEach((L, i) => {
        const active = L.id === S.project.activeLayerId;
        const color = h('input', { type: 'color', class: 'swatch', value: L.color, title: 'Pen color' });
        color.addEventListener('input', () => S.updateLayer(L.id, { color: color.value }, { history: false }));
        color.addEventListener('change', () => { S.checkpoint(); S.updateLayer(L.id, { color: color.value }, { history: false }); });
        const name = h('span', { class: 'layer-name', title: 'Double-click to rename' }, L.name);
        name.addEventListener('dblclick', () => startRename(L.id));
        const eye = UI.iconBtn(L.visible ? 'eye' : 'eyeoff', L.visible ? 'Hide (hidden layers are not plotted)' : 'Show', (e) => { e.stopPropagation(); S.updateLayer(L.id, { visible: !L.visible }); }, { size: 15, cls: L.visible ? '' : 'off' });
        const lock = UI.iconBtn(L.locked ? 'lock' : 'unlock', L.locked ? 'Unlock' : 'Lock (prevent edits)', (e) => { e.stopPropagation(); S.updateLayer(L.id, { locked: !L.locked }); }, { size: 15, cls: L.locked ? 'on' : 'off' });
        const more = UI.iconBtn('settings', 'Layer pen settings', (e) => { e.stopPropagation(); if (expanded.has(L.id)) expanded.delete(L.id); else expanded.add(L.id); render(); }, { size: 15 });
        const row = h('div', { class: 'layer-row' + (active ? ' active' : ''), dataset: { layer: L.id } },
          h('span', { class: 'layer-idx' }, String(i + 1)), color, name, h('span', { class: 'layer-count' }, String(counts.get(L.id) || 0)), eye, lock, more);
        row.addEventListener('click', (e) => {
          if (e.target === color || e.target.closest('button') || e.target.tagName === 'INPUT') return;
          // The first click re-renders the list, so the browser's dblclick never reaches the new name span:
          // detect the second click on the same layer name here instead
          if (e.target.closest('.layer-name')) {
            const now = performance.now();
            if (lastNameClick.id === L.id && now - lastNameClick.t < 450) { lastNameClick.id = null; startRename(L.id); return; }
            lastNameClick = { id: L.id, t: now };
          }
          S.setActiveLayer(L.id); render();
        });
        list.appendChild(row);
        if (expanded.has(L.id)) {
          const p = PP.App.profile();
          const box = h('div', { class: 'layer-settings' },
            UI.numberField({ label: 'Z-Draw override', unit: 'mm', value: U.isNum(L.zDraw) ? L.zDraw : '', min: U.round(PP.GCode.minSafeDrawZ(p), 2), max: U.round(p.zLift - 0.5, 2), step: 0.1, allowEmpty: true, title: 'Leave empty to use the printer Z-Draw (' + p.zDraw + ' mm). Allowed ' + U.round(PP.GCode.minSafeDrawZ(p), 2) + '..' + U.round(p.zLift - 0.5, 2) + ' mm.', onChange: (v) => S.updateLayer(L.id, { zDraw: v === null ? null : PP.GCode.safeDrawZ(p, v) }) }),
            UI.numberField({ label: 'Draw speed override', unit: 'mm/s', value: U.isNum(L.speed) ? L.speed : '', min: 1, max: 500, step: 1, allowEmpty: true, title: 'Leave empty to use the printer draw speed (' + p.drawSpeed + ' mm/s)', onChange: (v) => S.updateLayer(L.id, { speed: v }) }),
            UI.numberField({ label: 'Pen width (display)', unit: 'mm', value: L.penWidth || 0.5, min: 0.05, max: 5, step: 0.05, decimals: 2, onChange: (v) => S.updateLayer(L.id, { penWidth: v }) }),
            h('div', { class: 'btn-row' },
              UI.btn('Clear overrides', () => S.updateLayer(L.id, { zDraw: null, speed: null }), { small: true }),
              UI.iconBtn('up', 'Move layer up (plot earlier)', () => S.moveLayer(L.id, -1), { size: 15 }),
              UI.iconBtn('down', 'Move layer down (plot later)', () => S.moveLayer(L.id, 1), { size: 15 }),
              UI.iconBtn('trash', 'Delete layer and its objects', async () => {
                if (S.project.layers.length <= 1) { UI.toast('A project needs at least one layer.', 'warn'); return; }
                const n = counts.get(L.id) || 0;
                if (n && !(await UI.confirm('Delete layer', 'Delete "' + L.name + '" and its ' + n + ' object(s)?', 'Delete', true))) return;
                S.removeLayer(L.id);
              }, { size: 15, cls: 'danger' })));
          list.appendChild(box);
        }
      });
    }
    S.events.on('change', (k) => { if (k !== 'transform') renderSoon(); });
    const renderSoon = U.debounce(() => { if (!renaming) render(); }, 50);
    PP.App.events.on('profile', renderSoon);
    render();
  }

  // ---------------------------------------------------------------------------
  // Paper
  // ---------------------------------------------------------------------------
  function buildPaper(host) {
    const sec = UI.section('Paper', null, { collapsible: true });
    host.appendChild(sec);
    const pa = () => S.project.paper;
    const preset = UI.selectField({
      label: 'Size', value: pa().preset,
      options: S.PAPER_PRESETS.map(p => ({ value: p.id, label: p.name })),
      onChange: (v) => {
        const pr = S.PAPER_PRESETS.find(p => p.id === v);
        if (!pr) return;
        if (v === 'custom') { S.setPaper({ preset: v }); return; }
        const land = pa().landscape;
        S.setPaper({ preset: v, w: land ? pr.h : pr.w, h: land ? pr.w : pr.h });
      },
    });
    const orient = UI.segmented({
      options: [{ value: 'p', label: 'Portrait' }, { value: 'l', label: 'Landscape' }], value: pa().landscape ? 'l' : 'p',
      onChange: (v) => {
        const land = v === 'l';
        if (land === pa().landscape) return;
        S.setPaper({ landscape: land, w: pa().h, h: pa().w });
      },
    });
    const fw = UI.numberField({ label: 'Width', unit: 'mm', value: pa().w, min: 10, max: 600, step: 1, decimals: 1, onChange: (v) => S.setPaper({ w: v, preset: 'custom' }) });
    const fh = UI.numberField({ label: 'Height', unit: 'mm', value: pa().h, min: 10, max: 600, step: 1, decimals: 1, onChange: (v) => S.setPaper({ h: v, preset: 'custom' }) });
    const fx = UI.numberField({ label: 'Left edge X', unit: 'mm', value: pa().x, min: -300, max: 300, step: 1, decimals: 1, onChange: (v) => S.setPaper({ x: v }) });
    const fy = UI.numberField({ label: 'Front edge Y', unit: 'mm', value: pa().y, min: -300, max: 300, step: 1, decimals: 1, onChange: (v) => S.setPaper({ y: v }) });
    const show = UI.checkField({ label: 'Show paper on the bed', value: pa().visible, onChange: (v) => S.setPaper({ visible: v }) });
    const R = () => PP.GCode.reachableRect(PP.App.profile());
    sec.body.append(preset, h('div', { class: 'field' }, h('label', null, 'Orientation'), orient), h('div', { class: 'grid2' }, fw, fh, fx, fy), show,
      h('div', { class: 'btn-row wrap' },
        UI.btn('Front-left corner', () => S.setPaper({ x: 0, y: 0 }), { small: true, title: 'Paper aligned with the front-left corner of the plate' }),
        UI.btn('Drawable corner', () => S.setPaper({ x: Math.floor(R().minX), y: Math.floor(R().minY) }), { small: true, title: 'Align paper with the front-left corner of the drawable area' }),
        UI.btn('Designer margins', () => { const pr = PP.App.profile(); S.setPaper({ x: U.round(pr.bedWidth - 29 - pa().w, 1), y: U.round(pr.bedDepth - 41 - pa().h, 1) }); }, { small: true, title: 'Mount designer\'s placement for X1/P1: paper 29 mm from the right edge and 41 mm from the back edge' }),
        UI.btn('Center', () => { const r = R(); S.setPaper({ x: U.round((r.minX + r.maxX) / 2 - pa().w / 2, 1), y: U.round((r.minY + r.maxY) / 2 - pa().h / 2, 1) }); }, { small: true })),
      h('div', { class: 'hint' }, 'Tape the paper where it is shown on the bed.'));
    S.events.on('change', (k) => {
      if (k !== 'paper' && k !== 'undo' && k !== 'redo' && k !== 'load') return;
      const p = pa();
      preset.setValue(p.preset); orient.setValue(p.landscape ? 'l' : 'p');
      fw.setValue(p.w); fh.setValue(p.h); fx.setValue(p.x); fy.setValue(p.y); show.setValue(p.visible);
    });
  }

  // ---------------------------------------------------------------------------
  // Plotter quick settings
  // ---------------------------------------------------------------------------
  function buildPlotter(host) {
    const sec = UI.section('Plotter settings', null, { extra: UI.iconBtn('settings', 'All printer settings', () => UI.openPrinterSettings(), { size: 15 }) });
    host.appendChild(sec);
    const p = PP.App.profile();
    const upd = (k) => (v) => PP.App.updateProfile({ [k]: v });
    const zd = UI.numberField({ label: 'Z-Draw', unit: 'mm', value: p.zDraw, min: 0.2, max: 200, step: 0.1, decimals: 2, title: 'Nozzle height at which the pen touches the paper. Lower = more pressure.', onChange: upd('zDraw') });
    const zl = UI.numberField({ label: 'Z-Lift', unit: 'mm', value: p.zLift, min: 0.5, max: 220, step: 0.5, decimals: 2, title: 'Nozzle height for travel moves (pen up).', onChange: upd('zLift') });
    const ds = UI.numberField({ label: 'Draw speed', unit: 'mm/s', value: p.drawSpeed, min: 1, max: 500, step: 1, decimals: 0, onChange: upd('drawSpeed') });
    const ms = UI.numberField({ label: 'Move speed', unit: 'mm/s', value: p.travelSpeed, min: 5, max: 500, step: 5, decimals: 0, onChange: upd('travelSpeed') });
    sec.body.append(h('div', { class: 'grid2' }, zd, zl, ds, ms),
      h('div', { class: 'hint' }, 'Find your Z-Draw with the ',
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); UI.openCalibration('compact'); } }, 'Z test'), ' (',
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); UI.openHelp('calibration'); } }, 'guide'), ').'));
    PP.App.events.on('profile', () => {
      const q = PP.App.profile();
      zd.setValue(q.zDraw); zl.setValue(q.zLift); ds.setValue(q.drawSpeed); ms.setValue(q.travelSpeed);
    });
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  function buildSummary(host) {
    // Preview, Download and Calibrate live in the top bar; this section only reports
    const sec = UI.section('Plot summary', null);
    host.appendChild(sec);
    const statsEl = h('div', { class: 'stats' });
    const warnEl = h('div', { class: 'warns' });
    sec.body.append(statsEl, warnEl);

    const stat = (label, value) => h('div', { class: 'stat' }, h('span', null, label), h('b', null, value));
    const compute = U.debounce(() => {
      let plan;
      try { plan = PP.App.buildPlan(); } catch (e) { console.error(e); return; }
      const s = plan.stats;
      U.clear(statsEl);
      U.clear(warnEl);
      statsEl.append(
        stat('Est. time', U.formatDuration(s.time + (plan.jobs.length ? 45 : 0))),
        stat('Pens (layers)', String(plan.jobs.length)),
        stat('Draw length', U.formatLength(s.drawLen)),
        stat('Pen lifts', String(s.lifts)));
      const warns = [];
      if (!plan.jobs.length) warns.push(['info', PP.App.emptyPlanMessage(plan)]);
      else if (plan.clipped) warns.push(['warn', 'Some lines are outside the drawable area (shown in red) and will be clipped.']);
      const hiddenWithObjs = S.project.layers.filter(l => !l.visible && S.project.objects.some(o => o.layerId === l.id));
      if (hiddenWithObjs.length) warns.push(['info', hiddenWithObjs.length + ' hidden layer(s) will not be plotted.']);
      const errs = PP.GCode.validateProfile(plan.profile);
      errs.forEach(e => warns.push(['error', e]));
      warns.forEach(([t, m]) => warnEl.appendChild(h('div', { class: 'warn-item ' + t }, UI.icon(t === 'info' ? 'help' : 'warn', 14), h('span', null, m))));
    }, 350);
    S.events.on('change', compute);
    PP.App.events.on('profile', compute);
    PP.App.events.on('prefs', compute);
    compute();
  }

  UI.buildRightPanel = function (host) {
    buildProps(host);
    buildLayers(host);
    buildPlotter(host);
    buildSummary(host);
    buildPaper(host);
  };
})(window.PP = window.PP || {});
