/*
 * PenPlot Studio - "Pen holder" dialog: resize the pen bore of your holder's cartridge and spring STLs for a
 * measured pen, live, up to what the parts allow (see js/core/penholder.js).
 * The STLs are the user's own files (the mount designer's license); they are remembered in this browser only.
 */
(function (PP) {
  'use strict';

  const U = PP.U, h = U.h;
  const UI = PP.UI;
  const PH = PP.PenHolder;
  const ROLES = [
    { id: 'cartridge', label: 'Pen cartridge', hint: 'the tube that holds the pen' },
    { id: 'spring', label: 'Spring', hint: 'its rings the pen passes through' },
  ];

  UI.openPenHolder = async function () {
    const st = Object.assign({ pen: 8, fit: 0.4, springGap: null }, PP.Storage.getLocal('penholder', {}));
    const parts = {}; // role -> { name, buffer, part, error }
    const status = h('div', { class: 'warns' });
    const result = h('div', { class: 'ph-result' });
    const canvas = h('canvas', { class: 'ph-canvas', width: 560, height: 260 });
    let api = null, outs = {};

    const slotEls = {};
    const slots = ROLES.map(r => {
      const info = h('div', { class: 'hint' }, 'No file yet');
      const btn = UI.btn('Choose STL…', async () => { const f = await U.pickFile('.stl,model/stl'); if (f) setPart(r.id, f.name, await f.arrayBuffer(), true); }, { small: true, icon: 'open' });
      slotEls[r.id] = info;
      return h('div', { class: 'ph-slot' }, h('div', null, h('b', null, r.label), h('div', { class: 'hint' }, r.hint)), info, btn);
    });

    const save = () => PP.Storage.setLocal('penholder', { pen: st.pen, fit: st.fit, springGap: st.springGap });
    const penF = UI.numberField({ label: 'Measured pen diameter', unit: 'mm', value: st.pen, min: 2, max: 30, step: 0.05, decimals: 2, title: 'Use calipers. For hexagonal pens measure across the corners.', onChange: (v) => { st.pen = v; save(); regen(); } });
    const fitF = UI.numberField({ label: 'Cartridge fit (added to the pen)', unit: 'mm', value: st.fit, min: 0, max: 2, step: 0.05, decimals: 2, title: 'Extra room in the cartridge tube. 0.3–0.5 mm slides without wobbling on most printers.', onChange: (v) => { st.fit = v; save(); regen(); } });
    const gapF = UI.numberField({ label: 'Spring clearance (added to the pen)', unit: 'mm', value: st.springGap != null ? st.springGap : '', placeholder: 'as designed', min: 0, max: 4, step: 0.05, decimals: 2, allowEmpty: true, title: 'Extra room in the spring rings. Empty = the same margin as the original design.', onChange: (v) => { st.springGap = v; save(); regen(); } });

    function designGap() {
      const c = parts.cartridge && parts.cartridge.part, s = parts.spring && parts.spring.part;
      return c && s ? Math.round((s.d - c.d + st.fit) * 100) / 100 : st.fit + 0.9;
    }
    const springGap = () => (st.springGap != null ? st.springGap : designGap());
    const target = (role) => (role === 'cartridge' ? st.pen + st.fit : st.pen + springGap());

    async function setPart(role, name, buffer, remember) {
      if (parts[role] && parts[role].part) PH.free(parts[role].part);
      parts[role] = { name, buffer };
      slotEls[role].textContent = 'Reading ' + name + '…';
      try {
        api = api || await PH.load();
        const p = PH.analyze(api, PP.STL.parse(buffer).tris);
        parts[role].part = p;
        slotEls[role].textContent = name + ': bore ' + p.d.toFixed(2) + ' mm along ' + p.axis.toUpperCase() + ', up to ' + p.maxD.toFixed(1) + ' mm';
        if (remember) PP.Storage.set('penholder:' + role, { name, buffer }).catch(() => {});
      } catch (e) {
        parts[role].error = e.message;
        slotEls[role].textContent = name + ': ' + e.message;
      }
      regen();
    }

    /** Largest pen both parts allow with the current fit and clearance. */
    function maxPen() {
      let m = Infinity, by = '';
      for (const r of ROLES) {
        const p = parts[r.id] && parts[r.id].part;
        if (!p) continue;
        const v = p.maxD - (r.id === 'cartridge' ? st.fit : springGap());
        if (v < m) { m = v; by = r.label.toLowerCase(); }
      }
      return { pen: Math.floor(m * 10) / 10, by };
    }

    const regen = U.debounce(() => {
      U.clear(status); U.clear(result); outs = {};
      const loaded = ROLES.filter(r => parts[r.id] && parts[r.id].part);
      if (!loaded.length) { result.textContent = 'Choose your cartridge and spring STLs to start.'; drawPreview(); return; }
      const lim = maxPen();
      result.append(h('div', null, 'Supports pens up to ', h('b', null, lim.pen.toFixed(1) + ' mm'), ' (limited by the ' + lim.by + ').'));
      if (st.pen > lim.pen + 1e-9) {
        status.appendChild(h('div', { class: 'warn-item error' }, UI.icon('warn', 14), h('span', null, 'A ' + st.pen.toFixed(2) + ' mm pen is too big for these parts: the walls would get thinner than ' + PH.MIN_WALL + ' mm.')));
        drawPreview(); return;
      }
      for (const r of loaded) {
        try { outs[r.id] = PH.resize(api, parts[r.id].part, target(r.id)); } catch (e) { status.appendChild(h('div', { class: 'warn-item error' }, UI.icon('warn', 14), h('span', null, r.label + ': ' + e.message))); }
      }
      result.append(h('div', null, loaded.map(r => r.label + ' bore ' + target(r.id).toFixed(2) + ' mm').join(' · ')));
      drawPreview();
    }, 200);

    function drawPreview() {
      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ROLES.forEach((r, i) => {
        const p = parts[r.id] && parts[r.id].part;
        const x0 = i * W / 2;
        ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#777';
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillText(r.label + (p ? ' (section through the bore)' : ''), x0 + 10, 18);
        if (!p) return;
        const polys = (outs[r.id] && outs[r.id].preview) || p.preview;
        let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
        for (const q of p.preview.concat(polys)) for (const [x, y] of q) { mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mny = Math.min(mny, y); mxy = Math.max(mxy, y); }
        const k = Math.min((W / 2 - 30) / (mxx - mnx), (H - 40) / (mxy - mny));
        const tx = (x) => x0 + 15 + (x - mnx) * k, ty = (y) => 28 + (mxy - y) * k;
        const path = (list) => { ctx.beginPath(); for (const q of list) { q.forEach(([x, y], j) => (j ? ctx.lineTo(tx(x), ty(y)) : ctx.moveTo(tx(x), ty(y)))); ctx.closePath(); } };
        path(polys); ctx.fillStyle = '#c9cdd3'; ctx.fill('evenodd');
        path(p.preview); ctx.strokeStyle = '#8a8f98'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
        path(polys); ctx.strokeStyle = '#2f5bd2'; ctx.lineWidth = 1.5; ctx.stroke();
      });
    }

    const download = () => {
      const names = Object.keys(outs);
      if (!names.length) { UI.toast('Nothing to download yet.', 'warn'); return; }
      for (const role of names) {
        const base = parts[role].name.replace(/\.stl$/i, '');
        const file = base + ' - ' + U.fmt(st.pen, 2) + ' mm pen.stl';
        U.downloadBlob(file, new Blob([PP.STL.write(outs[role].tris, 'PenPlot Studio pen holder ' + st.pen + ' mm')], { type: 'model/stl' }));
      }
      UI.toast('Saved ' + names.length + ' STL file(s) for a ' + U.fmt(st.pen, 2) + ' mm pen.', 'info');
    };

    const body = h('div', { class: 'ph' },
      h('p', { class: 'hint' }, 'Changes only the pen tube of your own holder parts - everything else stays as designed. Open the STLs once; they are remembered in this browser.'),
      h('div', { class: 'ph-slots' }, slots),
      h('div', { class: 'grid2' }, penF, fitF, gapF),
      result, status, canvas);
    UI.modal({
      title: 'Pen holder for your pen', body, wide: true,
      onClose: () => { for (const r of ROLES) if (parts[r.id] && parts[r.id].part) PH.free(parts[r.id].part); },
      footer: [h('span', { class: 'hspacer' }), UI.btn('Download STLs', download, { primary: true, icon: 'download' })],
    });
    result.textContent = 'Loading the 3D tools…';
    for (const r of ROLES) {
      try { const saved = await PP.Storage.get('penholder:' + r.id); if (saved && saved.buffer) await setPart(r.id, saved.name, saved.buffer, false); } catch (e) { /* nothing remembered */ }
    }
    regen();
  };
})(window.PP = window.PP || {});
