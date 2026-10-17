/*
 * PenPlot Studio - "Download pen mount" dialog: the mount's pen cartridge and spring with their pen bore resized for
 * a measured pen (js/core/penholder.js), and the printer's attachment unchanged, saved together.
 *
 * The parts are the mount designer's files (Falu's "Modular System for A1, P1 & X1 Series" on MakerWorld). Its
 * license does not allow shipping them with the app, so the user downloads them from MakerWorld once and adds them
 * here (STLs, or the ZIP MakerWorld gives). They are kept in the app's storage (IndexedDB) from then on.
 */
(function (PP) {
  'use strict';

  const U = PP.U, h = U.h;
  const UI = PP.UI;
  const PH = PP.PenHolder;
  const SOURCE = 'https://makerworld.com/en/models/2029113-modular-system-for-a1-p1-x1-series';
  // the pen passes through the bore of these two, so they are resized
  const RESIZED = [
    { id: 'cartridge', label: 'Pen cartridge', match: /cartri/i },
    { id: 'spring', label: 'Spring', match: /spring/i },
  ];
  // the attachment the cartridge clips into, per printer family (profile.holder); saved unchanged
  const ATTACHMENTS = {
    x1p1: { label: 'X1 / P1', save: 'X1-P1 attachment.stl', match: /(x1|p1).*attach|attach.*(x1|p1)/i },
    a1: { label: 'A1', save: 'A1 attachment.stl', match: /\ba1\b.*attach|attach.*\ba1\b/i },
  };
  const KEY = (id) => 'mount:' + id;

  /** Which part a file is, from its name (null = not recognized). */
  function roleOf(name) {
    const base = name.split(/[\\/]/).pop();
    for (const k of ['x1p1', 'a1']) if (ATTACHMENTS[k].match.test(base)) return k;
    for (const r of RESIZED) if (r.match.test(base)) return r.id;
    return null;
  }

  UI.openPenHolder = async function () {
    const st = Object.assign({ pen: 8, fit: 0.4, springGap: null }, PP.Storage.getLocal('penholder', {}));
    const profHolder = PP.App.profile().holder;
    let kind = ATTACHMENTS[profHolder] ? profHolder : 'x1p1';
    const files = {}; // id -> { name, buffer } as stored
    const parts = {}; // cartridge / spring -> analyzed part
    const want = { cartridge: true, spring: true, attachment: true };
    let api = null, outs = {}, closed = false;

    const status = h('div', { class: 'warns' });
    const result = h('div', { class: 'ph-result' }, 'Loading…');
    const canvas = h('canvas', { class: 'ph-canvas', width: 560, height: 220 });
    const dlBtn = UI.btn('Download', () => download(), { primary: true, icon: 'download' });
    dlBtn.disabled = true;

    // one row per part: include it or not, what the download will contain, and a button to (re)place its file
    const details = {};
    const row = (id, label, extra) => {
      const cb = h('input', { type: 'checkbox', checked: want[id] });
      cb.addEventListener('change', () => { want[id] = cb.checked; });
      details[id] = h('span', { class: 'hint' }, '');
      const choose = UI.btn('Choose…', async () => {
        const f = await U.pickFile('.stl,model/stl');
        if (f) await addFile(id === 'attachment' ? kind : id, f.name, await f.arrayBuffer(), true);
      }, { small: true, title: 'Use a different STL for this part' });
      return h('div', { class: 'ph-part' }, h('label', null, cb, h('b', null, label)), extra || null, h('span', { class: 'hspacer' }), details[id], choose);
    };
    const attSel = h('select', { 'aria-label': 'Attachment for' }, Object.entries(ATTACHMENTS).map(([k, a]) => h('option', { value: k }, a.label)));
    attSel.value = kind;
    attSel.addEventListener('change', () => { kind = attSel.value; showDetails(); regen(); });
    const list = h('div', { class: 'ph-parts' },
      RESIZED.map(r => row(r.id, r.label)),
      row('attachment', 'Attachment', attSel));

    const source = h('div', { class: 'ph-source' },
      h('span', { class: 'hint grow' }, 'Parts from Falu\'s Modular System for A1, P1 & X1. Download the STLs from MakerWorld, then add them once.'),
      h('a', { class: 'btn btn-sm', href: SOURCE, target: '_blank', rel: 'noopener' }, UI.icon('external', 16), h('span', null, 'MakerWorld')),
      UI.btn('Add files…', () => addPicked(), { small: true, icon: 'upload', title: 'The STL files, or the ZIP from MakerWorld' }));

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

    /**
     * Take one part's file: cartridge and spring must have a pen bore the resizer finds (so a mixed-up file is
     * refused); `remember` keeps it in storage for next time.
     */
    async function addFile(id, name, buffer, remember) {
      try {
        if (id === 'cartridge' || id === 'spring') {
          api = api || await PH.load();
          const p = PH.analyze(api, PP.STL.parse(buffer).tris);
          PH.free(parts[id]);
          parts[id] = p;
        } else if (!PP.STL.parse(buffer).count) throw new Error('no triangles in this file');
        files[id] = { name, buffer };
        if (remember) {
          await PP.Storage.set(KEY(id), { name, buffer });
          if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
        }
        return true;
      } catch (e) {
        UI.toast(name + ': ' + e.message, 'error', 6000);
        return false;
      } finally {
        if (remember) { showDetails(); regen(); }
      }
    }

    /** "Add files…": several STLs and/or a ZIP; each file goes to the part its name says. */
    async function addPicked() {
      const picked = await U.pickFile('.stl,.zip,model/stl,application/zip', { multiple: true });
      if (!picked || !picked.length) return;
      const items = [];
      for (const f of picked) {
        const buf = await f.arrayBuffer();
        if (/\.zip$/i.test(f.name)) {
          try {
            for (const z of await U.unzip(buf)) if (/\.stl$/i.test(z.name)) items.push({ name: z.name.split('/').pop(), buffer: z.data.buffer.slice(z.data.byteOffset, z.data.byteOffset + z.data.byteLength) });
          } catch (e) { UI.toast(f.name + ': ' + e.message, 'error'); }
        } else items.push({ name: f.name, buffer: buf });
      }
      const unknown = [];
      let added = 0;
      for (const it of items) {
        const id = roleOf(it.name);
        if (!id) { unknown.push(it.name); continue; }
        if (await addFile(id, it.name, it.buffer, true)) added++;
      }
      if (added) UI.toast('Added ' + added + ' part' + (added === 1 ? '' : 's') + '. They are kept for next time.', 'info');
      if (unknown.length) UI.toast('Not recognized: ' + unknown.join(', ') + '. Use Choose… on its part.', 'warn', 7000);
      if (!items.length) UI.toast('No STL files found.', 'warn');
    }

    function showDetails() {
      for (const r of RESIZED) if (!files[r.id]) details[r.id].textContent = 'not added';
      details.attachment.textContent = files[kind] ? 'unchanged' : 'not added';
    }

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
      if (closed) return;
      U.clear(status); U.clear(result); outs = {};
      const ready = RESIZED.every(r => parts[r.id]);
      if (!ready) {
        result.textContent = 'Add the pen cartridge and spring to size them for your pen.';
        dlBtn.disabled = !files[kind];
        drawPreview(); return;
      }
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
      const out = RESIZED.filter(r => want[r.id] && outs[r.id]).map(r => ({
        name: r.label + ' - ' + pen + ' mm pen.stl',
        data: PP.STL.write(outs[r.id].tris, 'PenPlot Studio pen mount, ' + pen + ' mm pen'),
        type: 'model/stl',
      }));
      if (want.attachment && files[kind]) out.push({ name: ATTACHMENTS[kind].save, data: files[kind].buffer, type: 'model/stl' });
      if (!out.length) { UI.toast('Tick at least one part that has been added.', 'warn'); return; }
      try {
        const r = await U.saveFiles(out, { title: out.length > 1 ? 'Choose a folder for the pen mount parts' : undefined });
        if (r) UI.toast('Saved ' + r.count + ' STL file' + (r.count === 1 ? '' : 's') + U.savedTo(r) + '.', 'info', 5000);
      } catch (e) { UI.toast('Could not save the STLs: ' + e.message, 'error'); }
    }

    const body = h('div', { class: 'ph' },
      source,
      h('div', { class: 'grid3' }, penF, fitF, gapF),
      list, result, status, canvas);
    UI.modal({
      title: 'Download pen mount', body, wide: true,
      onClose: () => { closed = true; for (const r of RESIZED) PH.free(parts[r.id]); },
      footer: [h('span', { class: 'hspacer' }), dlBtn],
    });

    // the parts added before
    for (const id of ['cartridge', 'spring', 'x1p1', 'a1']) {
      try {
        const saved = await PP.Storage.get(KEY(id));
        if (saved && saved.buffer && !closed) await addFile(id, saved.name, saved.buffer, false);
      } catch (e) { /* nothing kept */ }
    }
    if (closed) { for (const r of RESIZED) PH.free(parts[r.id]); return; }
    showDetails();
    regen();
  };

  UI.penMountSource = SOURCE;
})(window.PP = window.PP || {});
