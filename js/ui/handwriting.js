/* PenPlot Studio - "My Handwriting": draw your own single-stroke font. */
(function (PP) {
  'use strict';

  const U = PP.U, G = PP.Geo, h = U.h;
  const UI = PP.UI;

  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?\'"-:;()&@#+=/*%$';
  const PAD = 400, BASE = 262, CAP = 160; // pad px: baseline y, cap height
  const XH = BASE - CAP * 0.62, DESC = BASE + CAP * 0.38;
  const SIDE = 0.08; // side bearing in cap units

  UI.openHandwriting = function () {
    const data = PP.Fonts.getHandwriting();
    data.glyphs = data.glyphs || {};
    if (!data.spaceAdv) data.spaceAdv = 0.55;
    let cur = CHARS[0];
    let strokes = [];
    let drawing = null;
    let dirty = false;

    const grid = h('div', { class: 'hw-grid' });
    const pad = h('canvas', { class: 'hw-pad', width: PAD, height: PAD });
    const label = h('div', { class: 'hw-label' });
    const prevText = h('input', { class: 'hw-preview-input', value: 'The quick brown fox 123', spellcheck: 'false' });
    const prevCanvas = h('canvas', { class: 'hw-preview', width: 760, height: 110 });
    const count = h('span', { class: 'hint' });

    function glyphToPad(g) {
      // normalized -> pad px (left aligned at x=60)
      return g.strokes.map(s => {
        const out = [];
        for (let j = 0; j < s.length; j += 2) out.push(60 + (s[j] - SIDE) * CAP, BASE - s[j + 1] * CAP);
        return out;
      });
    }

    function load(ch) {
      if (dirty) commit();
      cur = ch;
      const g = data.glyphs[ch];
      strokes = g ? glyphToPad(g) : [];
      dirty = false;
      label.innerHTML = '';
      label.append(h('b', null, ch), h('span', null, g ? ' saved - draw again or clear to redo' : ' not drawn yet'));
      renderGrid();
      drawPad();
    }

    function commit() {
      if (!strokes.length) { delete data.glyphs[cur]; save(); dirty = false; return; }
      let minX = Infinity, maxX = -Infinity;
      for (const s of strokes) for (let j = 0; j < s.length; j += 2) { minX = Math.min(minX, s[j]); maxX = Math.max(maxX, s[j]); }
      const norm = strokes.map(s => {
        const simp = s.length > 4 ? G.simplify(s, 0.7) : s;
        const out = [];
        for (let j = 0; j < simp.length; j += 2) out.push(U.round((simp[j] - minX) / CAP + SIDE, 4), U.round((BASE - simp[j + 1]) / CAP, 4));
        if (out.length === 2) out.push(out[0] + 0.01, out[1]);
        return out;
      });
      data.glyphs[cur] = { strokes: norm, adv: U.round((maxX - minX) / CAP + SIDE * 2, 4) };
      save();
      dirty = false;
    }

    function save() {
      PP.Fonts.saveHandwriting(data);
      renderGrid();
      drawPreview();
    }

    function renderGrid() {
      U.clear(grid);
      let n = 0;
      for (const ch of CHARS) {
        const has = !!data.glyphs[ch];
        if (has) n++;
        grid.appendChild(h('button', { class: 'hw-cell' + (has ? ' done' : '') + (ch === cur ? ' on' : ''), onclick: () => load(ch), title: has ? 'Drawn' : 'Not drawn' }, ch));
      }
      count.textContent = n + ' / ' + CHARS.length + ' characters drawn. Missing characters fall back to Hershey Sans.';
    }

    function drawPad() {
      const ctx = pad.getContext('2d');
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, PAD, PAD);
      const line = (y, color, dash, text) => {
        ctx.strokeStyle = color; ctx.setLineDash(dash || []); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(PAD, y); ctx.stroke();
        ctx.setLineDash([]);
        if (text) { ctx.fillStyle = color; ctx.font = '11px system-ui'; ctx.fillText(text, 6, y - 4); }
      };
      line(BASE - CAP, '#93c5fd', [6, 4], 'cap height');
      line(XH, '#c7d2fe', [3, 4], 'x-height');
      line(BASE, '#60a5fa', null, 'baseline');
      line(DESC, '#e5e7eb', [3, 4], 'descender');
      ctx.strokeStyle = '#f3f4f6'; ctx.beginPath(); ctx.moveTo(60, 0); ctx.lineTo(60, PAD); ctx.stroke();
      // ghost of the fallback glyph
      const fb = PP.Fonts.get(PP.Fonts.DEFAULT);
      if (fb && fb.loaded && !strokes.length) {
        const r = PP.Fonts.layout(cur, PP.Fonts.DEFAULT, { size: 1 });
        ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.beginPath();
        for (const p of r.polys) { for (let j = 0; j < p.length; j += 2) { const x = 60 + p[j] * CAP, y = BASE - p[j + 1] * CAP; if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); } }
        ctx.stroke();
      }
      ctx.strokeStyle = '#111'; ctx.lineWidth = 3.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const all = drawing ? strokes.concat([drawing]) : strokes;
      for (const s of all) {
        ctx.beginPath();
        ctx.moveTo(s[0], s[1]);
        if (s.length === 2) ctx.lineTo(s[0] + 0.5, s[1]);
        for (let j = 2; j < s.length; j += 2) ctx.lineTo(s[j], s[j + 1]);
        ctx.stroke();
      }
    }

    function drawPreview() {
      const ctx = prevCanvas.getContext('2d');
      const W = prevCanvas.width, H = prevCanvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      const r = PP.Fonts.layout(prevText.value || 'Aa', PP.Fonts.HAND_ID, { size: 10 });
      const b = G.bbox(r.polys);
      if (!b) return;
      const k = Math.min((W - 20) / Math.max(1, b.maxX - b.minX), (H - 20) / Math.max(1, b.maxY - b.minY));
      ctx.setTransform(k, 0, 0, -k, 10 - b.minX * k, H / 2 + (b.minY + b.maxY) / 2 * k);
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5 / k; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      for (const p of r.polys) { ctx.moveTo(p[0], p[1]); for (let j = 2; j < p.length; j += 2) ctx.lineTo(p[j], p[j + 1]); }
      ctx.stroke();
    }

    const pos = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * PAD / r.width, (e.clientY - r.top) * PAD / r.height]; };
    pad.addEventListener('pointerdown', (e) => { try { pad.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ } drawing = pos(e); drawPad(); });
    pad.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const [x, y] = pos(e);
      const n = drawing.length;
      if (Math.hypot(x - drawing[n - 2], y - drawing[n - 1]) >= 1.5) { drawing.push(x, y); drawPad(); }
    });
    const end = () => { if (drawing) { strokes.push(drawing); drawing = null; dirty = true; drawPad(); } };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    prevText.addEventListener('input', drawPreview);
    prevText.addEventListener('keydown', (e) => e.stopPropagation());

    const next = (dir = 1) => { commit(); const i = CHARS.indexOf(cur); load(CHARS[(i + dir + CHARS.length) % CHARS.length]); };

    const spaceF = UI.numberField({ label: 'Word spacing', unit: '× cap', value: data.spaceAdv, min: 0.2, max: 1.5, step: 0.05, slider: true, decimals: 2, onChange: (v) => { data.spaceAdv = v; save(); } });

    const body = h('div', { class: 'hw' },
      h('div', { class: 'hw-left' }, grid, count),
      h('div', { class: 'hw-right' },
        label, pad,
        h('div', { class: 'row gap wrap' },
          UI.btn('Undo stroke', () => { strokes.pop(); dirty = true; drawPad(); }, { small: true, icon: 'undo' }),
          UI.btn('Clear', () => { strokes = []; dirty = true; drawPad(); }, { small: true, icon: 'trash' }),
          UI.btn('Previous', () => next(-1), { small: true }),
          UI.btn('Save & next (Enter)', () => next(1), { small: true, primary: true })),
        h('p', { class: 'hint' }, 'Write the character between the baseline and cap line. Lowercase letters sit on the baseline and reach the x-height; g, j, p, q, y dip to the descender.')),
      h('div', { class: 'hw-bottom' }, h('label', null, 'Preview'), prevText, prevCanvas, spaceF));

    const exportHW = () => { commit(); U.downloadText('my-handwriting.json', JSON.stringify(data), 'application/json'); };
    const importHW = async () => {
      const f = await U.pickFile('.json,application/json');
      if (!f) return;
      try {
        const d = JSON.parse(await U.readFile(f, 'text'));
        if (!d.glyphs) throw new Error('No glyphs in file');
        data.glyphs = d.glyphs; data.spaceAdv = d.spaceAdv || 0.55;
        save(); load(cur);
        UI.toast('Handwriting imported', 'info');
      } catch (e) { UI.toast('Import failed: ' + e.message, 'error'); }
    };

    const m = UI.modal({
      title: 'My Handwriting font', body, wide: true, className: 'modal-xl',
      footer: [UI.btn('Import...', importHW, { icon: 'upload' }), UI.btn('Export...', exportHW, { icon: 'download' }), h('span', { class: 'hspacer' }),
        UI.btn('Use in Text tab', () => { commit(); m.close(); PP.UI.showTab('text'); const sel = h; void sel; UI.toast('Pick "My Handwriting" in the font list.', 'info'); }),
        UI.btn('Done', () => { commit(); m.close(); }, { primary: true })],
      onClose: () => { if (dirty) commit(); },
    });
    m.el.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'Enter') { e.preventDefault(); next(1); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.stopPropagation(); strokes.pop(); dirty = true; drawPad(); }
    });
    m.el.tabIndex = -1;
    m.el.focus();
    PP.Fonts.load(PP.Fonts.DEFAULT).then(() => drawPad()).catch(() => {});
    PP.Fonts.load(PP.Fonts.HAND_ID).then(() => drawPreview()).catch(() => {});
    load(cur);
    drawPreview();
  };
})(window.PP = window.PP || {});
