/* PenPlot Studio - left panel: Text, Draw, Image, Patterns, Import tabs. */
(function (PP) {
  'use strict';

  const U = PP.U, S = PP.Store, G = PP.Geo, OBJ = PP.Objects, h = U.h;
  const UI = PP.UI;

  // Live edit helper: one undo step per slider drag / text edit burst
  let liveId = null;
  function liveEdit(id, patch, final) {
    if (liveId !== id) { S.checkpoint(); liveId = id; }
    S.update(id, patch, { history: false });
    if (final) liveId = null;
  }
  function endLive() { liveId = null; }
  UI.liveEdit = liveEdit;
  UI.endLive = endLive;

  // ---------------------------------------------------------------------------
  // Tabs
  // ---------------------------------------------------------------------------
  const tabs = {};
  let tabBar, tabBody, currentTab = null;

  function addTab(id, label, iconName, build) {
    const btn = h('button', { class: 'tab', dataset: { tab: id }, onclick: () => showTab(id) }, UI.icon(iconName, 16), h('span', null, label));
    const pane = h('div', { class: 'tab-pane', dataset: { tab: id } });
    tabBar.appendChild(btn);
    tabBody.appendChild(pane);
    tabs[id] = { btn, pane, build, built: false };
  }

  function showTab(id) {
    const t = tabs[id];
    if (!t) return;
    if (!t.built) { t.build(t.pane); t.built = true; }
    for (const k in tabs) {
      tabs[k].btn.classList.toggle('on', k === id);
      tabs[k].pane.classList.toggle('on', k === id);
    }
    currentTab = id;
    PP.Storage.setLocal('leftTab', id);
    if (t.onShow) t.onShow();
  }
  UI.showTab = showTab;

  // ---------------------------------------------------------------------------
  // TEXT
  // ---------------------------------------------------------------------------
  let textDefaults = Object.assign({ text: 'Hello!', font: 'h:scripts', size: 12, letterSpacing: 0, lineSpacing: 1, align: 'center', arc: 0 }, PP.Storage.getLocal('textDefaults', {}));
  UI.textDefaults = () => Object.assign({}, textDefaults);
  let textUI = null;

  function selectedText() {
    const sel = S.selected();
    return sel.length === 1 && sel[0].type === 'text' ? sel[0] : null;
  }

  function fontOptions() {
    const groups = new Map();
    for (const f of PP.Fonts.list()) {
      if (!groups.has(f.category)) groups.set(f.category, []);
      groups.get(f.category).push({ value: f.id, label: f.name });
    }
    return Array.from(groups.entries()).map(([g, options]) => ({ group: g, options }));
  }

  function buildText(pane) {
    const ta = h('textarea', { class: 'text-input', rows: 3, spellcheck: 'false', placeholder: 'Type your text...' });
    ta.value = textDefaults.text;
    const fontSel = UI.selectField({ label: 'Font', value: textDefaults.font, options: fontOptions(), onChange: (v) => set('font', v, true) });
    const preview = h('canvas', { class: 'font-preview', width: 560, height: 120 });
    const size = UI.numberField({ label: 'Letter height', unit: 'mm', value: textDefaults.size, min: 1, max: 150, step: 0.5, slider: true, decimals: 1, onInput: (v) => set('size', v), onChange: (v) => set('size', v, true) });
    const ls = UI.numberField({ label: 'Letter spacing', unit: 'mm', value: textDefaults.letterSpacing, min: -5, max: 20, step: 0.1, slider: true, decimals: 1, onInput: (v) => set('letterSpacing', v), onChange: (v) => set('letterSpacing', v, true) });
    const lh = UI.numberField({ label: 'Line spacing', unit: '×', value: textDefaults.lineSpacing, min: 0.5, max: 4, step: 0.05, slider: true, decimals: 2, onInput: (v) => set('lineSpacing', v), onChange: (v) => set('lineSpacing', v, true) });
    const align = UI.segmented({ options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }], value: textDefaults.align, onChange: (v) => set('align', v, true) });
    const arcOn = UI.checkField({ label: 'Curve text along an arc', value: !!textDefaults.arc, onChange: (v) => { set('arc', v ? (Math.abs(arcR.input.value) || 80) * (arcFlip.input.checked ? -1 : 1) : 0, true); refreshArc(); } });
    const arcR = UI.numberField({ label: 'Arc radius', unit: 'mm', value: Math.abs(textDefaults.arc) || 80, min: 10, max: 500, step: 1, slider: true, decimals: 0, onInput: (v) => set('arc', v * (arcFlip.input.checked ? -1 : 1)), onChange: (v) => set('arc', v * (arcFlip.input.checked ? -1 : 1), true) });
    const arcFlip = UI.checkField({ label: 'Bend downwards (smile)', value: textDefaults.arc < 0, onChange: (v) => set('arc', (parseFloat(arcR.input.value) || 80) * (v ? -1 : 1), true) });
    const arcBox = h('div', { class: 'sub' }, arcR, arcFlip);
    const refreshArc = () => { arcBox.style.display = arcOn.input.checked ? '' : 'none'; };

    const fillCb = UI.checkField({ label: 'Fill letters with hatching (outline fonts)', value: false, onChange: (v) => setFill({ enabled: v }) });
    const fillSp = UI.numberField({ label: 'Hatch spacing', unit: 'mm', value: 0.6, min: 0.2, max: 5, step: 0.05, slider: true, decimals: 2, onChange: (v) => setFill({ spacing: v }) });
    const fillBox = h('div', { class: 'sub' }, fillSp);

    const addBtn = UI.btn('Add to bed', () => addText(), { icon: 'plus' });
    const status = h('div', { class: 'hint' });

    const upBtn = UI.btn('Upload font', () => uploadFont(), { icon: 'upload', small: true, title: 'Upload a .ttf or .otf font (drawn as outlines)' });
    const handBtn = UI.btn('My Handwriting', () => UI.openHandwriting(), { icon: 'hand', small: true, title: 'Draw your own letters and use them as a font' });
    const sysBtn = UI.btn('Installed fonts', async () => {
      try {
        const n = await PP.Fonts.listSystemFonts();
        UI.toast(n + (n === 1 ? ' font' : ' fonts') + ' from this computer ' + (n === 1 ? 'is' : 'are') + ' in the font list (drawn as outlines).', 'info');
      } catch (e) { UI.toast(e.message, 'warn'); }
    }, { small: true, title: 'Add the fonts installed on this computer to the font list' });
    const customList = h('div', { class: 'font-list' });

    pane.append(
      UI.section('Text', [ta, status]),
      UI.section('Font', [fontSel, preview, h('div', { class: 'btn-row wrap' }, sysBtn, upBtn, handBtn), customList]),
      UI.section('Layout', [size, ls, lh, h('div', { class: 'field' }, h('label', null, 'Alignment'), align), arcOn, arcBox]),
      UI.section('Fill', [fillCb, fillBox, h('div', { class: 'hint' }, 'Single-stroke (Hershey/EMS) fonts are drawn as one line per stroke - best for pen plotting. Hatch fill is for uploaded outline fonts.')], { collapsible: true, collapsed: true }),
      h('div', { class: 'panel-actions' }, addBtn),
    );

    ta.addEventListener('input', () => set('text', ta.value));
    ta.addEventListener('change', () => { set('text', ta.value, true); });
    ta.addEventListener('blur', endLive);
    ta.addEventListener('keydown', (e) => e.stopPropagation());

    function set(key, v, final) {
      textDefaults[key] = v;
      PP.Storage.setLocal('textDefaults', textDefaults);
      const o = selectedText();
      if (o && S.isEditable(o)) liveEdit(o.id, { [key]: v }, final);
      if (key === 'font') { PP.Fonts.load(v).catch((e) => UI.toast('Font failed to load: ' + e.message, 'error')); }
      drawPreview();
    }
    function setFill(patch) {
      const o = selectedText();
      if (!o) return;
      const f = Object.assign({}, OBJ.DEFAULT_FILL, o.fill || {}, { spacing: parseFloat(fillSp.input.value) || 0.6 }, patch);
      S.update(o.id, { fill: f });
    }
    function addText() {
      const c = PP.App.placementCenter();
      if (!PP.App.requireEditableLayer()) return;
      const o = OBJ.create.text(Object.assign({}, textDefaults, { x: c.x, y: c.y, name: 'Text' }));
      S.add(o);
      PP.Fonts.load(o.font).catch(() => {});
    }

    function drawPreview() {
      const ctx = preview.getContext('2d');
      const W = preview.width, H = preview.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
      const fontId = fontSel.select.value;
      const f = PP.Fonts.get(fontId);
      if (!f || !f.loaded) {
        ctx.fillStyle = '#888'; ctx.font = '22px system-ui'; ctx.textAlign = 'center';
        ctx.fillText(f && f.error ? 'Font failed to load' : 'Loading font...', W / 2, H / 2 + 8);
        return;
      }
      const sample = (ta.value.split('\n')[0] || '').trim() || 'AaBbCc 123';
      const r = PP.Fonts.layout(sample.slice(0, 40), fontId, { size: 10 });
      const b = G.bbox(r.polys);
      if (!b) return;
      const k = Math.min((W - 30) / Math.max(1, b.maxX - b.minX), (H - 30) / Math.max(1, b.maxY - b.minY));
      ctx.setTransform(k, 0, 0, -k, (W - (b.maxX - b.minX) * k) / 2 - b.minX * k, (H + (b.maxY - b.minY) * k) / 2 + b.minY * k);
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1.6 / k; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      for (const p of r.polys) { ctx.moveTo(p[0], p[1]); for (let j = 2; j < p.length; j += 2) ctx.lineTo(p[j], p[j + 1]); }
      ctx.stroke();
    }

    function refreshCustom() {
      U.clear(customList);
      const customs = PP.Fonts.list().filter(f => f.source.type === 'otf');
      for (const f of customs) {
        customList.appendChild(h('div', { class: 'font-item' }, h('span', null, f.name),
          UI.iconBtn('trash', 'Remove font', async () => { await PP.Fonts.removeCustomFont(f.id); }, { size: 14 })));
      }
    }

    function sync() {
      const o = selectedText();
      const src = o || textDefaults;
      if (document.activeElement !== ta) ta.value = src.text;
      fontSel.setValue(src.font);
      size.setValue(src.size); ls.setValue(src.letterSpacing || 0); lh.setValue(src.lineSpacing || 1);
      align.setValue(src.align || 'left');
      arcOn.setValue(!!src.arc); arcR.setValue(Math.abs(src.arc) || 80); arcFlip.setValue(src.arc < 0);
      refreshArc();
      fillCb.setValue(!!(o && o.fill && o.fill.enabled));
      if (o && o.fill) fillSp.setValue(o.fill.spacing);
      fillBox.style.display = fillCb.input.checked ? '' : 'none';
      addBtn.querySelector('span:last-child').textContent = o ? 'Add as new text' : 'Add to bed';
      status.textContent = o ? 'Editing the selected text' : '';
      drawPreview();
    }

    PP.Fonts.events.on('loaded', () => drawPreview());
    PP.Fonts.events.on('error', () => drawPreview());
    PP.Fonts.events.on('catalog', () => {
      const v = fontSel.select.value;
      U.clear(fontSel.select);
      fontOptions().forEach(g => fontSel.select.appendChild(h('optgroup', { label: g.group }, g.options.map(o => h('option', { value: o.value }, o.label)))));
      fontSel.select.value = PP.Fonts.get(v) ? v : PP.Fonts.DEFAULT;
      refreshCustom();
    });
    S.events.on('selection', sync);
    S.events.on('change', (k) => { if (k === 'undo' || k === 'redo') sync(); });
    PP.Fonts.load(textDefaults.font).catch(() => {});
    refreshCustom();
    sync();
    textUI = { ta, sync };
  }

  UI.focusTextEditor = function (selectAll) {
    showTab('text');
    if (textUI) {
      textUI.sync();
      setTimeout(() => { textUI.ta.focus(); if (selectAll) textUI.ta.select(); }, 30);
    }
  };

  async function uploadFont(file) {
    file = file || await U.pickFile('.ttf,.otf,.woff,font/ttf,font/otf');
    if (!file) return;
    try {
      const buf = await U.readFile(file, 'arraybuffer');
      const id = await PP.Fonts.addCustomFont(buf, file.name.replace(/\.[^.]+$/, ''));
      textDefaults.font = id;
      PP.Storage.setLocal('textDefaults', textDefaults);
      const o = selectedText();
      if (o) S.update(o.id, { font: id });
      if (textUI) textUI.sync();
      UI.toast('Font "' + PP.Fonts.get(id).name + '" added. Outline fonts draw letter outlines - enable hatch fill to fill them.', 'info', 6000);
    } catch (e) {
      console.error(e);
      UI.toast('Could not load font: ' + e.message, 'error');
    }
  }
  UI.uploadFont = uploadFont;

  // ---------------------------------------------------------------------------
  // DRAW
  // ---------------------------------------------------------------------------
  function buildDraw(pane) {
    const ds = PP.App.drawSettings;
    const grid = h('div', { class: 'tool-grid' });
    const btns = [];
    for (const t of PP.App.TOOLS) {
      if (t.sep) continue;
      const b = h('button', { class: 'tool-card', dataset: { tool: t.id }, title: t.label + ' (' + t.key + ')', onclick: () => PP.App.setTool(t.id) }, UI.icon(t.icon, 20), h('span', null, t.label.split(' (')[0]), h('kbd', null, t.key));
      btns.push(b);
      grid.appendChild(b);
    }
    PP.App.events.on('tool', (id) => btns.forEach(b => b.classList.toggle('on', b.dataset.tool === id)));
    const setDS = (k) => (v) => { ds[k] = v; PP.App.saveDrawSettings(); PP.App.view.invalidate(); };
    pane.append(
      UI.section('Drawing tools', [grid]),
      UI.section('Tool settings', [
        UI.numberField({ label: 'Freehand smoothing', value: ds.smoothing, min: 0, max: 4, step: 1, slider: true, onChange: setDS('smoothing'), onInput: setDS('smoothing') }),
        UI.numberField({ label: 'Polygon sides', value: ds.sides, min: 3, max: 24, step: 1, slider: true, onChange: setDS('sides'), onInput: setDS('sides') }),
        UI.numberField({ label: 'Star points', value: ds.starPoints, min: 3, max: 24, step: 1, slider: true, onChange: setDS('starPoints'), onInput: setDS('starPoints') }),
        UI.numberField({ label: 'Star inner radius', unit: '×', value: ds.starInner, min: 0.1, max: 0.9, step: 0.01, slider: true, decimals: 2, onChange: setDS('starInner'), onInput: setDS('starInner') }),
        UI.numberField({ label: 'Rectangle corner radius', unit: 'mm', value: ds.cornerRadius, min: 0, max: 50, step: 0.5, slider: true, decimals: 1, onChange: setDS('cornerRadius'), onInput: setDS('cornerRadius') }),
        UI.numberField({ label: 'Eraser size', unit: 'mm', value: ds.eraserSize, min: 0.5, max: 40, step: 0.5, slider: true, decimals: 1, onChange: setDS('eraserSize'), onInput: setDS('eraserSize') }),
      ]),
      UI.section('Tips', [h('ul', { class: 'tips' },
        h('li', null, 'Everything you draw becomes a pen path on the active layer (see Layers on the right).'),
        h('li', null, 'Shapes can be filled with hatch lines in the Selection panel.'),
        h('li', null, 'The red striped zone cannot be reached by the pen because of the mount offset.'),
        h('li', null, 'Hold Space and drag, or use the middle mouse button, to pan. Scroll to zoom.'),
      )]),
    );
  }

  // ---------------------------------------------------------------------------
  // IMAGE
  // ---------------------------------------------------------------------------
  function buildImage(pane) {
    const modes = PP.ImageTrace ? PP.ImageTrace.modes : [];
    let mode = (PP.Storage.getLocal('trace', {}).mode) || (modes[0] && modes[0].id);
    const open = async () => { const f = await U.pickFile('image/*'); if (f) UI.openImageTrace(f, { mode }); };
    const drop = h('button', { class: 'dropzone' }, UI.icon('image', 22), h('span', null, 'Choose an image'));
    drop.addEventListener('click', open);
    const grid = h('div', { class: 'mode-grid', role: 'radiogroup', 'aria-label': 'Trace style' });
    const paint = () => grid.querySelectorAll('.mode-btn').forEach(b => { const on = b.dataset.mode === mode; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    for (const m of modes) {
      grid.appendChild(h('button', { class: 'mode-btn', role: 'radio', title: m.description, dataset: { mode: m.id }, onclick: () => {
        mode = m.id; paint();
        PP.Storage.setLocal('trace', Object.assign(PP.Storage.getLocal('trace', {}), { mode }));
      } }, m.name));
    }
    paint();
    // the trace dialog remembers the style chosen there too: show it when coming back
    grid.addEventListener('pointerenter', () => { mode = PP.Storage.getLocal('trace', {}).mode || mode; paint(); });
    pane.append(UI.section('Image', [drop,
      h('div', { class: 'field' }, h('label', null, 'Trace style'), grid),
      h('p', { class: 'hint' }, 'Outline and Center line suit line art; the rest suit photos.')]));
  }

  // ---------------------------------------------------------------------------
  // PATTERNS
  // ---------------------------------------------------------------------------
  function buildPatterns(pane) {
    if (!PP.Patterns || !PP.Patterns.list || !PP.Patterns.list.length) {
      pane.appendChild(h('p', { class: 'hint' }, 'Pattern generators are not available.'));
      return;
    }
    const list = PP.Patterns.list;
    let cat = 'All';
    let genId = PP.Storage.getLocal('patternId', list[0].id);
    if (!PP.Patterns.get(genId)) genId = list[0].id;
    let params = PP.Patterns.defaults(genId);
    const cats = ['All'].concat(Array.from(new Set(list.map(g => g.category))));
    const chips = h('div', { class: 'chips' });
    const cards = h('div', { class: 'pattern-cards' });
    const formHost = h('div');
    const prev = h('canvas', { class: 'pattern-preview', width: 520, height: 360 });
    const info = h('div', { class: 'hint' });
    const title = h('div', { class: 'pattern-title' });
    const addBtn = UI.btn('Add pattern to bed', () => add(), { primary: true, icon: 'plus' });
    const randBtn = UI.btn('Surprise me', () => surprise(), { icon: 'wand', small: true, title: 'Random parameters' });

    cats.forEach(c => {
      const b = h('button', { class: 'chip' + (c === cat ? ' on' : ''), onclick: () => { cat = c; U.$$('.chip', chips).forEach(x => x.classList.toggle('on', x.textContent === c)); renderCards(); } }, c);
      chips.appendChild(b);
    });

    function selectedPattern() {
      const sel = S.selected();
      return sel.length === 1 && sel[0].type === 'pattern' ? sel[0] : null;
    }

    const thumbCache = new Map();
    function thumb(g) {
      const c = h('canvas', { width: 88, height: 66, class: 'pthumb' });
      const draw = () => {
        let polys = thumbCache.get(g.id);
        if (!polys) {
          try { polys = G.center(PP.Patterns.generate(g.id, {})).polys; } catch (e) { polys = []; }
          thumbCache.set(g.id, polys);
        }
        renderPolys(c, polys, '#e8ecf1', 1.1);
      };
      setTimeout(draw, 10 + Math.random() * 200);
      return c;
    }

    function renderCards() {
      U.clear(cards);
      for (const g of list) {
        if (cat !== 'All' && g.category !== cat) continue;
        const card = h('button', { class: 'pattern-card' + (g.id === genId ? ' on' : ''), title: g.description || g.name, onclick: () => pick(g.id) }, thumb(g), h('span', null, g.name));
        card.dataset.id = g.id;
        cards.appendChild(card);
      }
    }

    function pick(id, keepParams) {
      genId = id;
      PP.Storage.setLocal('patternId', id);
      if (!keepParams) params = PP.Patterns.defaults(id);
      U.$$('.pattern-card', cards).forEach(c => c.classList.toggle('on', c.dataset.id === id));
      const sp = selectedPattern();
      if (sp && sp.generator !== id && !keepParams) S.clearSelection();
      buildForm();
      renderPreview();
    }

    function buildForm() {
      const g = PP.Patterns.get(genId);
      U.clear(formHost);
      title.textContent = g.name;
      info.textContent = g.description || '';
      const form = UI.paramForm(g.params, params, (key, v, final) => {
        params[key] = v;
        const sp = selectedPattern();
        if (sp && sp.generator === genId && S.isEditable(sp)) liveEdit(sp.id, { params: Object.assign({}, params) }, final);
        renderPreviewSoon();
      });
      formHost.appendChild(form);
      const sp = selectedPattern();
      addBtn.querySelector('span:last-child').textContent = sp ? 'Add a copy to bed' : 'Add pattern to bed';
    }

    function renderPolys(canvas, polys, bg, lw) {
      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
      const b = G.bbox(polys);
      if (!b) return;
      const k = Math.min((W - 12) / Math.max(0.01, b.maxX - b.minX), (H - 12) / Math.max(0.01, b.maxY - b.minY));
      ctx.setTransform(k, 0, 0, -k, W / 2 - (b.minX + b.maxX) / 2 * k, H / 2 + (b.minY + b.maxY) / 2 * k);
      ctx.strokeStyle = '#1b1f24'; ctx.lineWidth = lw / k; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      for (const p of polys) { ctx.moveTo(p[0], p[1]); for (let j = 2; j < p.length; j += 2) ctx.lineTo(p[j], p[j + 1]); }
      ctx.stroke();
    }

    let lastStats = '';
    function renderPreview() {
      let polys = [];
      const t0 = performance.now();
      try { polys = PP.Patterns.generate(genId, params); } catch (e) { console.error(e); }
      const ms = performance.now() - t0;
      renderPolys(prev, polys, '#ffffff', 1.3);
      const b = G.bbox(polys);
      lastStats = polys.length + ' paths • ' + U.formatLength(G.totalLength(polys)) + ' of line' + (b ? ' • ' + U.fmt(b.maxX - b.minX, 0) + ' × ' + U.fmt(b.maxY - b.minY, 0) + ' mm' : '') + (ms > 300 ? ' • slow (' + Math.round(ms) + ' ms)' : '');
      stats.textContent = lastStats;
    }
    const renderPreviewSoon = U.debounce(renderPreview, 60);
    const stats = h('div', { class: 'hint' });

    function add() {
      const c = PP.App.placementCenter();
      const o = OBJ.create.pattern(genId, Object.assign({}, params), { x: c.x, y: c.y });
      PP.App.addPlaced([o], { fit: false });
    }

    function surprise() {
      const g = PP.Patterns.get(genId);
      for (const p of g.params) {
        if (p.key === 'size' || p.key === 'width' || p.key === 'height') continue;
        if (p.type === 'select') params[p.key] = p.options[Math.floor(Math.random() * p.options.length)].value;
        else if (p.type === 'checkbox') params[p.key] = Math.random() < 0.5;
        else if (p.type === 'seed') params[p.key] = Math.floor(Math.random() * (p.max || 99999));
        else if (p.type === 'int') params[p.key] = Math.round(p.min + Math.random() * (p.max - p.min) * 0.6);
        else if (p.type === 'range') {
          const step = p.step || 0.01;
          params[p.key] = Math.round((p.min + Math.random() * (p.max - p.min)) / step) * step;
        }
      }
      const sp = selectedPattern();
      if (sp && sp.generator === genId) S.update(sp.id, { params: Object.assign({}, params) });
      buildForm();
      renderPreview();
    }

    pane.append(
      UI.section('Generators', [chips, cards]),
      UI.section('Parameters', [title, info, prev, stats, h('div', { class: 'row gap' }, randBtn), formHost]),
      h('div', { class: 'panel-actions' }, addBtn),
    );

    S.events.on('selection', () => {
      const sp = selectedPattern();
      if (sp) { params = Object.assign(PP.Patterns.defaults(sp.generator), sp.params); pick(sp.generator, true); }
      else buildForm();
    });
    renderCards();
    buildForm();
    renderPreview();
    UI.editPattern = () => showTab('patterns');
  }

  // ---------------------------------------------------------------------------
  // IMPORT / FILES
  // ---------------------------------------------------------------------------
  let importPrefs = Object.assign({ splitColors: true, fillShapes: false }, PP.Storage.getLocal('importPrefs', {}));
  UI.importPrefs = () => importPrefs;

  function buildImport(pane) {
    const drop = h('button', { class: 'dropzone' }, UI.icon('upload', 22), h('span', null, 'Import an SVG file'));
    drop.addEventListener('click', () => PP.App.files.importSVG());
    const setP = (k) => (v) => { importPrefs[k] = v; PP.Storage.setLocal('importPrefs', importPrefs); };
    pane.append(
      UI.section('SVG', [
        drop,
        UI.checkField({ label: 'One layer per stroke color', value: importPrefs.splitColors, onChange: setP('splitColors') }),
        UI.checkField({ label: 'Hatch-fill filled shapes', value: importPrefs.fillShapes, onChange: setP('fillShapes') }),
      ]),
      UI.section('Project', [
        h('div', { class: 'btn-col' },
          UI.btn('Open project...', () => PP.App.files.openProject(), { icon: 'open' }),
          UI.btn('Save project', () => PP.App.files.saveProject(), { icon: 'save' }),
          UI.btn('Export design as SVG', () => PP.App.files.exportSVG(), { icon: 'download' })),

      ]),
      UI.section('Examples', [h('div', { class: 'btn-col' },
        UI.btn('Greeting card', () => loadExample('card'), { icon: 'text' }),
        UI.btn('Spirograph study', () => loadExample('spiro'), { icon: 'target' }),
        UI.btn('Mandala', () => loadExample('mandala'), { icon: 'star' }),
        UI.btn('Two-color layers demo', () => loadExample('layers'), { icon: 'layers' }))]),
    );
  }

  function exampleObjects(kind) {
    const c = PP.App.placementCenter();
    const area = PP.App.workArea();
    const W = area.maxX - area.minX, H = area.maxY - area.minY;
    const objs = [];
    const has = (id) => PP.Patterns && PP.Patterns.get(id);
    if (kind === 'card' || kind === 'welcome') {
      objs.push(OBJ.create.shape('rect', { x: c.x, y: c.y, w: W - 20, h: H - 20, radius: 6, name: 'Border' }));
      objs.push(OBJ.create.text({ text: 'Hello from my X1C!', font: 'h:scripts', size: 12, x: c.x, y: c.y + H * 0.22, align: 'center' }));
      objs.push(OBJ.create.text({ text: 'Made with a pen plotter', font: 'h:futural', size: 4, x: c.x, y: c.y - H * 0.36, align: 'center' }));
      if (has('spirograph')) objs.push(OBJ.create.pattern('spirograph', { size: Math.min(W, H) * 0.42 }, { x: c.x, y: c.y - H * 0.06 }));
    } else if (kind === 'spiro' && has('spirograph')) {
      const s = Math.min(W, H) * 0.3;
      [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([dx, dy], i) => {
        objs.push(OBJ.create.pattern('spirograph', { size: s, R: 96 + i * 8, r: 36 + i * 7, d: 0.6 + i * 0.2 }, { x: c.x + dx * s * 0.6, y: c.y + dy * s * 0.6 }));
      });
    } else if (kind === 'mandala' && has('mandala')) {
      objs.push(OBJ.create.pattern('mandala', { size: Math.min(W, H) * 0.8 }, { x: c.x, y: c.y }));
    } else if (kind === 'layers') {
      const L2 = S.project.layers[1] || null;
      objs.push(OBJ.create.shape('star', { x: c.x - W * 0.2, y: c.y, w: 60, h: 60, points: 5, inner: 0.45, fill: Object.assign({}, OBJ.DEFAULT_FILL, { enabled: true, spacing: 1.2 }) }));
      objs.push(Object.assign(OBJ.create.shape('ellipse', { x: c.x + W * 0.2, y: c.y, w: 60, h: 60 }), { _layer2: true }));
      objs.push(Object.assign(OBJ.create.text({ text: 'Layer 1 black, layer 2 blue', font: 'h:futural', size: 5, x: c.x, y: c.y - 50 }), {}));
      void L2;
    }
    return objs;
  }

  function loadExample(kind) {
    const objs = exampleObjects(kind);
    if (!objs.length) { UI.toast('That example needs the pattern module.', 'warn'); return; }
    S.checkpoint();
    if (kind === 'layers') {
      let L2 = S.project.layers[1];
      if (!L2) { L2 = { id: U.uid('l'), name: 'Layer 2', color: S.PEN_COLORS[1], visible: true, locked: false, penWidth: 0.5, zDraw: null, speed: null }; S.project.layers.push(L2); }
      objs.forEach(o => { if (o._layer2) { o.layerId = L2.id; delete o._layer2; } });
    }
    S.add(objs, { history: false });
    UI.toast('Example added - select objects to edit them.', 'info');
  }

  UI.loadWelcomeDesign = function () {
    const objs = exampleObjects('welcome');
    if (objs.length) { S.add(objs, { history: false, select: false }); S.undoStack.length = 0; S.events.emit('history'); }
  };

  // ---------------------------------------------------------------------------
  UI.buildLeftPanel = function (host) {
    tabBar = h('div', { class: 'tabs' });
    tabBody = h('div', { class: 'tab-body' });
    host.append(tabBar, tabBody);
    addTab('text', 'Text', 'text', buildText);
    addTab('draw', 'Draw', 'pen', buildDraw);
    addTab('image', 'Image', 'image', buildImage);
    addTab('patterns', 'Patterns', 'star', buildPatterns);
    addTab('import', 'Import', 'upload', buildImport);
    // text tab must exist early (focusTextEditor)
    showTab('text');
    const last = PP.Storage.getLocal('leftTab', 'text');
    if (tabs[last]) showTab(last);
    PP.App.events.on('tool', (id) => {
      if (['pen', 'line', 'polyline', 'curve', 'rect', 'ellipse', 'polygon', 'star', 'eraser'].includes(id) && currentTab !== 'draw' && currentTab !== 'text') showTab('draw');
    });
  };
})(window.PP = window.PP || {});
