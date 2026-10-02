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
      // layers too: their names fill the Layer menu, and a lock/hide changes what is editable
      return sel.map(o => o.id + ':' + o.type + ':' + o.layerId + ':' + (o.locked ? 1 : 0) + ':' + (o.fill && o.fill.enabled ? 1 : 0)).join('|') +
        '#' + S.project.layers.map(l => l.id + ':' + l.name + ':' + (l.visible ? 1 : 0) + (l.locked ? 1 : 0)).join(',');
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
        if (!aspectLock) {
          // stretch along one world axis: each object stretches along whichever of its own axes lines up with it,
          // which is exact only at multiples of 90 degrees (other angles would need a shear)
          const quarter = (o) => { const r = ((o.rotation % 180) + 180) % 180; return r < 1e-6 || 180 - r < 1e-6 ? 0 : Math.abs(r - 90) < 1e-6 ? 90 : null; };
          if (sel.every(o => quarter(o) !== null)) {
            const pos = key === 'w' ? 'x' : 'y', c = gi[pos];
            S.updateMany(new Map(sel.map(o => {
              const local = (quarter(o) === 0) === (key === 'w') ? 'scaleX' : 'scaleY';
              return [o.id, { [pos]: c + (o[pos] - c) * k, [local]: o[local] * k }];
            })));
            return;
          }
          UI.toast('Objects rotated at an angle can only be scaled proportionally, so the selection was scaled evenly.', 'info');
        }
        S.updateMany(new Map(sel.map(o => [o.id, { x: gi.x + (o.x - gi.x) * k, y: gi.y + (o.y - gi.y) * k, scaleX: o.scaleX * k, scaleY: o.scaleY * k }])));
      }
    }

    function build() {
      U.clear(body);
      fields = null;
      const sel = S.selected();
      if (!sel.length) {
        body.appendChild(h('div', { class: 'empty-sel' }, 'Select an object to edit it.'));
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
      lockBtn.title = 'Keep proportions when changing W or H';
      body.appendChild(h('div', { class: 'row gap aspect-row' }, lockBtn, h('span', { class: 'muted' }, 'Keep proportions')));
      if (single) body.appendChild(fr);
      fields = { fx, fy, fw, fh, fr };

      const ops = PP.App.ops;
      body.appendChild(h('div', { class: 'btn-row wrap' },
        UI.iconBtn('fliph', 'Mirror horizontally', () => ops.mirror('x')),
        UI.iconBtn('flipv', 'Mirror vertically', () => ops.mirror('y')),
        UI.iconBtn('rotate', 'Rotate 90°', () => ops.rotateBy(-90)),
        h('button', { class: 'icon-btn txt', title: 'Rotate 180°', onclick: () => ops.rotateBy(180) }, '180°'),
        UI.iconBtn('copy', 'Duplicate (Ctrl+D)', () => ops.duplicate()),
        UI.iconBtn('trash', 'Delete (Del)', () => ops.remove(), { cls: 'danger' })));

      // placement actions in one menu instead of a row of buttons
      const alignB = UI.btn('Align', () => {
        let pop = null;
        const item = (label, fn) => h('button', { class: 'menu-item', onclick: () => { if (pop) pop.close(); fn(); } }, label);
        pop = UI.popover(alignB, h('div', { class: 'menu' },
          item('Center on the paper', () => ops.align('center', 'paper')),
          item('Center in the drawable area', () => ops.align('center', 'drawable')),
          item('Fit to the paper (10 mm margin)', () => ops.fit(10, 'paper')),
          item('Fit to the drawable area (10 mm margin)', () => ops.fit(10))));
      }, { small: true, cls: 'btn-menu', title: 'Center or fit the selection' });
      alignB.appendChild(UI.icon('chevron', 12));
      body.lastChild.appendChild(alignB);

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
          // one undo step per drag or typed value: the live updates already checkpointed
          if (final) S.updateMany(m, setFill._live ? { history: false } : {}); else { if (!setFill._live) { S.checkpoint(); setFill._live = true; } S.updateMany(m, { history: false }); }
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
    const addB = UI.iconBtn('plus', 'Add a layer (another pen)', () => S.addLayer(), { size: 15 });
    const sec = UI.section('Layers', null, { extra: addB });
    sec.classList.add('layers-sec');
    host.appendChild(sec);
    const list = h('div', { class: 'layer-list' });
    sec.body.appendChild(list);

    let lastNameClick = { id: null, t: 0 };
    // while a layer is being renamed, recolored or dragged, delayed re-renders wait: they would destroy the
    // input (the color picker closed after the first change) or the dragged row
    let busy = null;
    let dragId = null;

    function startRename(id) {
      const L = S.project.layers.find(l => l.id === id);
      const name = L && list.querySelector('.layer-row[data-layer="' + CSS.escape(id) + '"] .layer-name');
      if (!name) return;
      const inp = h('input', { class: 'layer-rename', value: L.name, 'aria-label': 'Layer name' });
      name.replaceWith(inp);
      busy = 'rename:' + id;
      inp.focus(); inp.select();
      const done = () => { busy = null; const v = inp.value.trim(); if (v && v !== L.name) S.updateLayer(L.id, { name: v }); else render(); };
      inp.addEventListener('blur', done);
      inp.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') inp.blur(); if (e.key === 'Escape') { inp.value = L.name; inp.blur(); } });
    }

    async function deleteLayer(L) {
      if (S.project.layers.length <= 1) { UI.toast('A project needs at least one layer.', 'warn'); return; }
      const n = S.project.objects.filter(o => o.layerId === L.id).length;
      if (n && !(await UI.confirm('Delete layer', 'Delete "' + L.name + '" and its ' + n + ' object(s)?', 'Delete', true))) return;
      S.removeLayer(L.id);
    }

    /** The "..." menu: rename, lock, order, and the per-pen overrides (kept out of the way on purpose). */
    function layerMenu(anchor, L) {
      const p = PP.App.profile();
      const i = S.project.layers.indexOf(L), last = S.project.layers.length - 1;
      let pop = null;
      const item = (label, fn, opts = {}) => h('button', { class: 'menu-item' + (opts.danger ? ' danger' : ''), disabled: opts.disabled, onclick: () => { if (pop) pop.close(); fn(); } }, label);
      // the cut layer (knife) is plotted last: it can't move, and nothing moves below it
      const cut = L.tool === 'cut';
      const lastPen = S.project.layers.some(l => l.tool === 'cut') ? last - 1 : last;
      const tp = cut ? PP.GCode.knifeProfile(p) : p; // the knife's height and speed stand in for the pen's
      const minZ = U.round(PP.GCode.minSafeDrawZ(tp), 2), maxZ = U.round(p.zLift - 0.5, 2);
      const content = h('div', { class: 'menu' },
        item('Rename', () => startRename(L.id)),
        item(L.locked ? 'Unlock layer' : 'Lock layer', () => S.updateLayer(L.id, { locked: !L.locked })),
        item('Move up (plot earlier)', () => S.moveLayer(L.id, -1), { disabled: cut || i <= 0 }),
        item('Move down (plot later)', () => S.moveLayer(L.id, 1), { disabled: cut || i >= lastPen }),
        item(cut ? 'Use as a pen layer' : 'Use as the cut layer (knife, plotted last)', () => S.updateLayer(L.id, { tool: cut ? 'pen' : 'cut' })),
        h('div', { class: 'menu-sep' }),
        h('div', { class: 'menu-label' }, cut ? 'This knife only' : 'This pen only'),
        h('div', { class: 'menu-fields' },
          UI.numberField({ label: cut ? 'Knife height (Z-Cut)' : 'Pen height (Z)', unit: 'mm', value: U.isNum(L.zDraw) ? L.zDraw : '', placeholder: String(tp.zDraw), min: minZ, max: maxZ, step: 0.1, allowEmpty: true, title: 'Empty = the printer value (' + tp.zDraw + ' mm). Allowed ' + minZ + '..' + maxZ + ' mm.', onChange: (v) => S.updateLayer(L.id, { zDraw: v === null ? null : PP.GCode.safeDrawZ(tp, v) }) }),
          UI.numberField({ label: cut ? 'Cut speed' : 'Draw speed', unit: 'mm/s', value: U.isNum(L.speed) ? L.speed : '', placeholder: String(tp.drawSpeed), min: 1, max: 500, step: 1, allowEmpty: true, title: 'Empty = the printer value (' + tp.drawSpeed + ' mm/s)', onChange: (v) => S.updateLayer(L.id, { speed: v }) }),
          cut ? UI.checkField({ label: 'Mirror (iron-on vinyl)', value: !!L.mirror, onChange: (v) => S.updateLayer(L.id, { mirror: v }) }) : null,
          cut ? UI.checkField({ label: 'Weed box around the design', value: !!L.weedBox, onChange: (v) => S.updateLayer(L.id, { weedBox: v }) }) : null,
          cut ? null : UI.numberField({ label: 'Line width on screen', unit: 'mm', value: L.penWidth || 0.5, min: 0.05, max: 5, step: 0.05, decimals: 2, onChange: (v) => S.updateLayer(L.id, { penWidth: v }) })),
        h('div', { class: 'menu-sep' }),
        item('Delete layer', () => deleteLayer(L), { danger: true }));
      pop = UI.popover(anchor, content, { align: 'right' });
    }

    function clearMarks() { list.querySelectorAll('.drop-before, .drop-after').forEach(r => r.classList.remove('drop-before', 'drop-after')); }

    function render() {
      U.clear(list);
      const counts = new Map();
      for (const o of S.project.objects) counts.set(o.layerId, (counts.get(o.layerId) || 0) + 1);
      const layers = S.project.layers;
      layers.forEach((L, i) => {
        const active = L.id === S.project.activeLayerId;
        const grip = h('span', { class: 'layer-grip', title: 'Drag to change the plot order' }, UI.icon('grip', 14));
        const color = h('input', { type: 'color', class: 'swatch', value: L.color, title: 'Pen color', 'aria-label': 'Pen color for ' + L.name });
        let recoloring = false;
        color.addEventListener('input', () => {
          busy = 'color:' + L.id;
          if (!recoloring) { recoloring = true; S.checkpoint(); } // one undo step for the whole pick
          S.updateLayer(L.id, { color: color.value }, { history: false });
        });
        color.addEventListener('change', () => { recoloring = false; if (busy === 'color:' + L.id) busy = null; renderSoon(); });
        color.addEventListener('blur', () => { if (busy === 'color:' + L.id) { recoloring = false; busy = null; renderSoon(); } });
        const name = h('span', { class: 'layer-name', title: 'Double-click to rename' }, L.name);
        const knife = L.tool === 'cut' ? h('span', { class: 'layer-tool', title: 'Cut layer: cut with the knife, after every pen' }, UI.icon('knife', 14)) : null;
        name.addEventListener('dblclick', () => startRename(L.id));
        const lockB = L.locked ? UI.iconBtn('lock', 'Locked - click to unlock', (e) => { e.stopPropagation(); S.updateLayer(L.id, { locked: false }); }, { size: 14, cls: 'on' }) : null;
        const eye = UI.iconBtn(L.visible ? 'eye' : 'eyeoff', L.visible ? 'Hide (hidden layers are not plotted)' : 'Show', (e) => { e.stopPropagation(); S.updateLayer(L.id, { visible: !L.visible }); }, { size: 15, cls: L.visible ? '' : 'off' });
        const more = UI.iconBtn('more', 'Layer options', (e) => { e.stopPropagation(); layerMenu(more, L); }, { size: 15 });
        const row = h('div', { class: 'layer-row' + (active ? ' active' : '') + (L.visible ? '' : ' is-hidden'), dataset: { layer: L.id } },
          grip, color, knife, name, lockB, h('span', { class: 'layer-count', title: 'Objects on this layer' }, String(counts.get(L.id) || 0)), eye, more);

        // drag the grip to reorder (layer order = plot order)
        grip.addEventListener('pointerdown', () => { row.draggable = true; });
        row.addEventListener('dragstart', (e) => {
          dragId = L.id; busy = 'drag:' + L.id;
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('application/x-penplot-layer', L.id);
          row.classList.add('dragging');
        });
        // dragend can arrive late: only end this drag's hold, never a color pick or rename that started since
        row.addEventListener('dragend', () => { row.draggable = false; dragId = null; clearMarks(); if (busy === 'drag:' + L.id) { busy = null; render(); } });
        row.addEventListener('dragover', (e) => {
          if (!dragId) return;
          e.preventDefault(); e.stopPropagation();
          const r = row.getBoundingClientRect();
          clearMarks();
          row.classList.add(e.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before');
        });
        row.addEventListener('drop', (e) => {
          if (!dragId) return;
          e.preventDefault(); e.stopPropagation();
          const r = row.getBoundingClientRect();
          const from = layers.findIndex(x => x.id === dragId);
          let to = e.clientY > r.top + r.height / 2 ? i + 1 : i;
          if (from < to) to--;
          const id = dragId;
          dragId = null;
          if (busy === 'drag:' + id) busy = null;
          S.moveLayerTo(id, to);
          render(); // show the new order now, not after the debounced re-render
        });

        row.addEventListener('click', (e) => {
          if (e.target === color || e.target.closest('button') || e.target.tagName === 'INPUT') return;
          // The first click re-renders the list, so the browser's dblclick never reaches the new name span:
          // detect the second click on the same layer name here instead
          if (e.target.closest('.layer-name')) {
            const now = performance.now();
            if (lastNameClick.id === L.id && now - lastNameClick.t < 450) { lastNameClick.id = null; startRename(L.id); return; }
            lastNameClick = { id: L.id, t: now };
          }
          if (!active) { S.setActiveLayer(L.id); render(); }
        });
        list.appendChild(row);
      });
    }
    S.events.on('change', (k) => { if (k !== 'transform') renderSoon(); });
    const renderSoon = U.debounce(() => { if (!busy) render(); }, 50);
    PP.App.events.on('profile', renderSoon);
    render();
  }

  // ---------------------------------------------------------------------------
  // Paper
  // ---------------------------------------------------------------------------
  /** The paper settings, shown as a popover from the top bar's paper button. Returns { el, dispose }. */
  function paperForm() {
    const el = h('div', { class: 'paper-form' });
    const pa = () => S.project.paper;
    const preset = UI.selectField({
      label: 'Size', value: pa().preset,
      options: S.PAPER_PRESETS.map(p => ({ value: p.id, label: p.name })),
      onChange: (v) => {
        const pr = S.PAPER_PRESETS.find(p => p.id === v);
        if (!pr) return;
        if (v === 'custom') { S.setPaper({ preset: v }); return; }
        const land = pa().w > pa().h; // orientation follows the shape, not a flag
        S.setPaper({ preset: v, landscape: land, w: land ? pr.h : pr.w, h: land ? pr.w : pr.h });
      },
    });
    const orient = UI.segmented({
      options: [{ value: 'p', label: 'Portrait' }, { value: 'l', label: 'Landscape' }], value: pa().w > pa().h ? 'l' : 'p',
      onChange: (v) => {
        const land = v === 'l';
        if (land === (pa().w > pa().h)) return;
        S.setPaper({ landscape: land, w: pa().h, h: pa().w });
      },
    });
    const fw = UI.numberField({ label: 'Width', unit: 'mm', value: pa().w, min: 10, max: 600, step: 1, decimals: 1, onChange: (v) => S.setPaper({ w: v, preset: 'custom' }) });
    const fh = UI.numberField({ label: 'Height', unit: 'mm', value: pa().h, min: 10, max: 600, step: 1, decimals: 1, onChange: (v) => S.setPaper({ h: v, preset: 'custom' }) });
    const fx = UI.numberField({ label: 'Left edge X', unit: 'mm', value: pa().x, min: -300, max: 300, step: 1, decimals: 1, onChange: (v) => S.setPaper({ x: v }) });
    const fy = UI.numberField({ label: 'Front edge Y', unit: 'mm', value: pa().y, min: -300, max: 300, step: 1, decimals: 1, onChange: (v) => S.setPaper({ y: v }) });
    const show = UI.checkField({ label: 'Show paper on the bed', value: pa().visible, onChange: (v) => S.setPaper({ visible: v }) });
    const R = () => PP.GCode.reachableRect(PP.App.profile());
    el.append(preset, h('div', { class: 'field' }, h('label', null, 'Orientation'), orient), h('div', { class: 'grid2' }, fw, fh, fx, fy), show,
      h('div', { class: 'btn-row wrap' },
        UI.btn('Front-left corner', () => S.setPaper({ x: 0, y: 0 }), { small: true, title: 'Paper aligned with the front-left corner of the plate' }),
        UI.btn('Drawable corner', () => S.setPaper({ x: Math.floor(R().minX), y: Math.floor(R().minY) }), { small: true, title: 'Align paper with the front-left corner of the drawable area' }),
        UI.btn('Designer margins', () => { const pr = PP.App.profile(); S.setPaper({ x: U.round(pr.bedWidth - 29 - pa().w, 1), y: U.round(pr.bedDepth - 41 - pa().h, 1) }); }, { small: true, title: 'Mount designer\'s placement for X1/P1: paper 29 mm from the right edge and 41 mm from the back edge' }),
        UI.btn('Center', () => { const r = R(); S.setPaper({ x: U.round((r.minX + r.maxX) / 2 - pa().w / 2, 1), y: U.round((r.minY + r.maxY) / 2 - pa().h / 2, 1) }); }, { small: true })),
    );
    const off = S.events.on('change', (k) => {
      if (k !== 'paper' && k !== 'undo' && k !== 'redo' && k !== 'load') return;
      const p = pa();
      preset.setValue(p.preset); orient.setValue(p.w > p.h ? 'l' : 'p');
      fw.setValue(p.w); fh.setValue(p.h); fx.setValue(p.x); fy.setValue(p.y); show.setValue(p.visible);
    });
    return { el, dispose: off };
  }

  UI.openPaper = function (anchor) {
    const f = paperForm();
    if (!UI.popover(anchor, h('div', { class: 'popover-pad' }, f.el), { onClose: f.dispose })) f.dispose();
  };

  /** Short label for the top bar: "Letter · portrait", "A4 · landscape", "200 × 150 mm". */
  UI.paperLabel = function () {
    const pa = S.project.paper;
    const pr = S.PAPER_PRESETS.find(x => x.id === pa.preset);
    if (!pr || pa.preset === 'custom') return U.fmt(pa.w, 0) + ' × ' + U.fmt(pa.h, 0) + ' mm';
    return pr.name.split(' (')[0] + ' · ' + (pa.w > pa.h ? 'landscape' : 'portrait');
  };

  UI.buildRightPanel = function (host) {
    buildLayers(host);
    buildProps(host);
  };
})(window.PP = window.PP || {});
