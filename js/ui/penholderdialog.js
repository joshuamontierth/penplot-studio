/*
 * PenPlot Studio - "Download pen mount" dialog: the mount's pen cartridge and spring with their pen bore resized for
 * a measured pen (js/core/penholder.js), and the printer's attachment unchanged, saved together.
 * The parts are bundled in assets/penmount/ (see its README).
 */
(function (PP) {
  'use strict';

  const U = PP.U, h = U.h;
  const UI = PP.UI;
  const PH = PP.PenHolder;
  const DIR = 'assets/penmount/';
  // the pen passes through the bore of these two, so they are resized
  const RESIZED = [
    { id: 'cartridge', label: 'Pen cartridge', file: 'pen-cartridge.stl' },
    { id: 'spring', label: 'Spring', file: 'spring.stl' },
  ];
  // the attachment the cartridge clips into, per printer family (profile.holder)
  const ATTACHMENTS = {
    x1p1: { label: 'X1 / P1', file: 'attachment-x1p1.stl', save: 'X1-P1 attachment.stl' },
    a1: { label: 'A1', file: 'attachment-a1.stl', save: 'A1 attachment.stl' },
  };
  const fetchPart = (file) => fetch(DIR + file).then((r) => {
    if (!r.ok) throw new Error('Could not load ' + file + ' (HTTP ' + r.status + ')');
    return r.arrayBuffer();
  });

  UI.openPenHolder = async function () {
    const st = Object.assign({ pen: 8, fit: 0.4, springGap: null }, PP.Storage.getLocal('penholder', {}));
    // STLs the user picked before the parts were bundled: no longer used
    for (const k of ['cartridge', 'spring', 'holder:x1p1', 'holder:a1', 'holder:other']) PP.Storage.del('penholder:' + k).catch(() => {});
    const profHolder = PP.App.profile().holder;
    let kind = ATTACHMENTS[profHolder] ? profHolder : 'x1p1';
    const parts = {}; // id -> analyzed part
    const want = { cartridge: true, spring: true, attachment: true };
    let api = null, outs = {}, closed = false, ready = false;

    const status = h('div', { class: 'warns' });
    const result = h('div', { class: 'ph-result' }, 'Loading the pen mount…');
    const canvas = h('canvas', { class: 'ph-canvas', width: 560, height: 220 });
    const dlBtn = UI.btn('Download', () => download(), { primary: true, icon: 'download' });
    dlBtn.disabled = true;

    // one row per part: include it or not, and what the download will contain
    const details = {};
    const row = (id, label, extra) => {
      const cb = h('input', { type: 'checkbox', checked: want[id] });
      cb.addEventListener('change', () => { want[id] = cb.checked; });
      details[id] = h('span', { class: 'hint' }, '');
      return h('div', { class: 'ph-part' }, h('label', null, cb, h('b', null, label)), extra || null, h('span', { class: 'hspacer' }), details[id]);
    };
    const attSel = h('select', { 'aria-label': 'Attachment for' }, Object.entries(ATTACHMENTS).map(([k, a]) => h('option', { value: k }, a.label)));
    attSel.value = kind;
    attSel.addEventListener('change', () => { kind = attSel.value; });
    const list = h('div', { class: 'ph-parts' },
      RESIZED.map(r => row(r.id, r.label)),
      row('attachment', 'Attachment', attSel));
    details.attachment.textContent = 'unchanged';

    const save = () => PP.Storage.setLocal('penholder', { pen: st.pen, fit: st.fit, springGap: st.springGap });
    const penF = UI.numberField({ label: 'Pen diameter', unit: 'mm', value: st.pen, min: 2, max: 30, step: 0.05, decimals: 2, title: 'Measure the widest part that goes through the holder with calipers.', onChange: (v) => { st.pen = v; save(); regen(); } });
    const fitF = UI.numberField({ label: 'Cartridge fit', unit: 'mm', value: st.fit, min: 0, max: 2, step: 0.05, decimals: 2, title: 'Added to the pen diameter for the cartridge bore.', onChange: (v) => { st.fit = v; save(); regen(); } });
    const gapF = UI.numberField({ label: 'Spring clearance', unit: 'mm', value: st.springGap != null ? st.springGap : '', placeholder: 'as designed', min: 0, max: 4, step: 0.05, decimals: 2, allowEmpty: true, title: 'Added to the pen diameter for the spring rings. Empty = the original design\'s margin.', onChange: (v) => { st.springGap = v; save(); regen(); } });

    function designGap() {
      const c = parts.cartridge, s = parts.spring;
      return c && s ? Math.round((s.d - c.d + st.fit) * 100) / 100 : st.fit + 0.9;
    }
    const springGap = () => (st.springGap != null ? st.springGap : designGap());
    const target = (id) => (id === 'cartridge' ? st.pen + st.fit : st.pen + springGap());

    /** Largest pen both parts allow with the current fit and clearance. */
    function maxPen() {
      let m = Infinity, by = '';
      for (const r of RESIZED) {
        const v = parts[r.id].maxD - (r.id === 'cartridge' ? st.fit : springGap());
        if (v < m) { m = v; by = r.label.toLowerCase(); }
      }
      return { pen: Math.floor(m * 10) / 10, by };
    }

    const regen = U.debounce(() => {
      if (!ready) return;
      U.clear(status); U.clear(result); outs = {};
      const lim = maxPen();
      result.append('Supports pens up to ', h('b', null, lim.pen.toFixed(1) + ' mm'), ' (limited by the ' + lim.by + ').');
      if (st.pen > lim.pen + 1e-9) {
        status.appendChild(h('div', { class: 'warn-item error' }, UI.icon('warn', 14), h('span', null, 'A ' + st.pen.toFixed(2) + ' mm pen is too big for this mount: the walls would get thinner than ' + PH.MIN_WALL + ' mm.')));
        for (const r of RESIZED) details[r.id].textContent = '';
        dlBtn.disabled = true;
        drawPreview(); return;
      }
      for (const r of RESIZED) {
        try {
          outs[r.id] = PH.resize(api, parts[r.id], target(r.id));
          details[r.id].textContent = 'bore ' + target(r.id).toFixed(2) + ' mm';
        } catch (e) {
          details[r.id].textContent = '';
          status.appendChild(h('div', { class: 'warn-item error' }, UI.icon('warn', 14), h('span', null, r.label + ': ' + e.message)));
        }
      }
      dlBtn.disabled = false;
      drawPreview();
    }, 200);

    function drawPreview() {
      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      RESIZED.forEach((r, i) => {
        const p = parts[r.id];
        if (!p) return;
        const x0 = i * W / 2;
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#777';
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillText(r.label, x0 + 10, 16);
        const polys = (outs[r.id] && outs[r.id].preview) || p.preview;
        let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
        for (const q of p.preview.concat(polys)) for (const [x, y] of q) { mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mny = Math.min(mny, y); mxy = Math.max(mxy, y); }
        const k = Math.min((W / 2 - 30) / (mxx - mnx), (H - 36) / (mxy - mny));
        const tx = (x) => x0 + 15 + (x - mnx) * k, ty = (y) => 26 + (mxy - y) * k;
        const path = (lst) => { ctx.beginPath(); for (const q of lst) { q.forEach(([x, y], j) => (j ? ctx.lineTo(tx(x), ty(y)) : ctx.moveTo(tx(x), ty(y)))); ctx.closePath(); } };
        path(polys); ctx.fillStyle = '#c9cdd3'; ctx.fill('evenodd');
        path(p.preview); ctx.strokeStyle = '#8a8f98'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
        path(polys); ctx.strokeStyle = '#2f5bd2'; ctx.lineWidth = 1.5; ctx.stroke();
      });
    }

    async function download() {
      const pen = U.fmt(st.pen, 2);
      const files = RESIZED.filter(r => want[r.id] && outs[r.id]).map(r => ({
        name: r.label + ' - ' + pen + ' mm pen.stl',
        data: PP.STL.write(outs[r.id].tris, 'PenPlot Studio pen mount, ' + pen + ' mm pen'),
        type: 'model/stl',
      }));
      try {
        if (want.attachment) files.push({ name: ATTACHMENTS[kind].save, data: await fetchPart(ATTACHMENTS[kind].file), type: 'model/stl' });
        if (!files.length) { UI.toast('Tick at least one part.', 'warn'); return; }
        const r = await U.saveFiles(files, { title: files.length > 1 ? 'Choose a folder for the pen mount parts' : undefined });
        if (r) UI.toast('Saved ' + r.count + ' STL file' + (r.count === 1 ? '' : 's') + U.savedTo(r) + '.', 'info', 5000);
      } catch (e) { UI.toast('Could not save the STLs: ' + e.message, 'error'); }
    }

    const body = h('div', { class: 'ph' },
      h('div', { class: 'grid3' }, penF, fitF, gapF),
      list, result, status, canvas);
    UI.modal({
      title: 'Download pen mount', body, wide: true,
      onClose: () => { closed = true; for (const r of RESIZED) PH.free(parts[r.id]); },
      footer: [h('span', { class: 'hspacer' }), dlBtn],
    });

    try {
      api = await PH.load();
      const bufs = await Promise.all(RESIZED.map(r => fetchPart(r.file)));
      RESIZED.forEach((r, i) => { parts[r.id] = PH.analyze(api, PP.STL.parse(bufs[i]).tris); });
      if (closed) { for (const r of RESIZED) PH.free(parts[r.id]); return; }
      ready = true;
      regen();
    } catch (e) {
      U.clear(result);
      status.appendChild(h('div', { class: 'warn-item error' }, UI.icon('warn', 14), h('span', null, e.message)));
    }
  };
})(window.PP = window.PP || {});
