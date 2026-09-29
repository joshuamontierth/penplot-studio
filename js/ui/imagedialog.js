/* PenPlot Studio - image tracing dialog (raster image -> pen paths). */
(function (PP) {
  'use strict';

  const U = PP.U, S = PP.Store, G = PP.Geo, OBJ = PP.Objects, h = U.h;
  const UI = PP.UI;

  UI.openImageTrace = async function (file) {
    const IT = PP.ImageTrace;
    if (!IT) { UI.toast('Image tracing module is not loaded.', 'error'); return; }
    let img;
    try { img = await U.loadImage(await U.readFile(file, 'dataurl')); }
    catch (e) { UI.toast('Could not read that image.', 'error'); return; }

    const saved = PP.Storage.getLocal('trace', {});
    const area = PP.App.workArea();
    const aw = area.maxX - area.minX - 16, ah = area.maxY - area.minY - 16;
    const aspect = img.naturalHeight / img.naturalWidth;
    const fitW = Math.max(20, Math.min(aw, ah / aspect));
    const st = {
      mode: saved.mode && IT.modes.some(m => m.id === saved.mode) ? saved.mode : IT.modes[0].id,
      params: saved.params || {},
      pre: Object.assign({ brightness: 0, contrast: 0, gamma: 1, blur: 0, invert: false }, saved.pre || {}),
      res: saved.res || 800,
      widthMm: U.round(Math.min(fitW, 150), 1),
      showImage: true,
    };
    const modeParams = () => Object.assign(IT.defaults(st.mode), st.params[st.mode] || {});

    const canvas = h('canvas', { class: 'trace-canvas', width: 720, height: 540 });
    const stats = h('div', { class: 'trace-stats' });
    const busy = h('div', { class: 'trace-busy' }, 'Tracing...');
    const modeHost = h('div');
    const descr = h('div', { class: 'hint' });

    let gray = null, grayKey = '', polys = [], mmPerPx = 0.25;
    const src = h('canvas');

    function makeGray() {
      const key = JSON.stringify([st.res, st.pre]);
      if (gray && key === grayKey) return gray;
      const k = Math.min(1, st.res / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(8, Math.round(img.naturalWidth * k)), hh = Math.max(8, Math.round(img.naturalHeight * k));
      src.width = w; src.height = hh;
      const c = src.getContext('2d', { willReadFrequently: true });
      c.fillStyle = '#fff'; c.fillRect(0, 0, w, hh);
      c.drawImage(img, 0, 0, w, hh);
      const data = c.getImageData(0, 0, w, hh);
      gray = IT.toGray(data, st.pre);
      grayKey = key;
      return gray;
    }

    function run() {
      busy.classList.add('show');
      setTimeout(() => {
        const t0 = performance.now();
        try {
          const g = makeGray();
          mmPerPx = st.widthMm / g.width;
          polys = IT.trace(g, st.mode, modeParams(), { mmPerPx });
        } catch (e) {
          console.error(e);
          polys = [];
          stats.textContent = 'Tracing failed: ' + e.message;
          busy.classList.remove('show');
          draw();
          return;
        }
        const ms = performance.now() - t0;
        busy.classList.remove('show');
        const len = G.totalLength(polys) * mmPerPx;
        const est = len / PP.App.profile().drawSpeed + polys.length * 0.6;
        stats.textContent = polys.length.toLocaleString() + ' paths • ' + U.formatLength(len) + ' of line • ~' + U.formatDuration(est) + ' to plot • output ' + U.fmt(st.widthMm, 1) + ' × ' + U.fmt(st.widthMm * aspect, 1) + ' mm • ' + Math.round(ms) + ' ms';
        draw();
      }, 16);
    }
    const runSoon = U.debounce(run, 120);

    function draw() {
      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      if (!gray) return;
      const k = Math.min((W - 20) / gray.width, (H - 20) / gray.height);
      const ox = (W - gray.width * k) / 2, oy = (H - gray.height * k) / 2;
      if (st.showImage) {
        ctx.globalAlpha = 0.25;
        ctx.drawImage(src, ox, oy, gray.width * k, gray.height * k);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = '#e5e7eb'; ctx.strokeRect(ox, oy, gray.width * k, gray.height * k);
      ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(0.6, Math.min(1.4, 0.45 / mmPerPx * k)); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      for (const p of polys) {
        ctx.moveTo(ox + p[0] * k, oy + p[1] * k);
        if (p.length === 4 && p[0] === p[2] && p[1] === p[3]) ctx.lineTo(ox + p[0] * k + 0.5, oy + p[1] * k);
        for (let j = 2; j < p.length; j += 2) ctx.lineTo(ox + p[j] * k, oy + p[j + 1] * k);
      }
      ctx.stroke();
    }

    function buildModeForm() {
      U.clear(modeHost);
      const m = IT.modes.find(x => x.id === st.mode);
      descr.textContent = m ? m.description : '';
      const form = UI.paramForm(m.params, modeParams(), (key, v, final) => {
        st.params[st.mode] = Object.assign(modeParams(), { [key]: v });
        persist();
        if (final) run(); else runSoon();
      });
      modeHost.appendChild(form);
    }
    const persist = U.debounce(() => PP.Storage.setLocal('trace', { mode: st.mode, params: st.params, pre: st.pre, res: st.res }), 300);

    const modeSel = UI.selectField({ label: 'Mode', value: st.mode, options: IT.modes.map(m => ({ value: m.id, label: m.name })), onChange: (v) => { st.mode = v; persist(); buildModeForm(); run(); } });
    const pre = (key, label, min, max, step, dec) => UI.numberField({ label, value: st.pre[key], min, max, step, slider: true, decimals: dec, onInput: (v) => { st.pre[key] = v; persist(); runSoon(); }, onChange: (v) => { st.pre[key] = v; persist(); run(); } });
    const widthF = UI.numberField({ label: 'Output width', unit: 'mm', value: st.widthMm, min: 5, max: 256, step: 1, decimals: 1, onChange: (v) => { st.widthMm = v; run(); } });
    const resF = UI.numberField({ label: 'Working resolution', unit: 'px', value: st.res, min: 200, max: 1600, step: 50, slider: true, onChange: (v) => { st.res = v; persist(); run(); } });
    const showCb = UI.checkField({ label: 'Show original image', value: true, onChange: (v) => { st.showImage = v; draw(); } });

    const body = h('div', { class: 'trace' },
      h('div', { class: 'trace-view' }, canvas, busy, stats),
      h('div', { class: 'trace-controls' },
        modeSel, descr, modeHost,
        UI.section('Image adjustments', [
          pre('brightness', 'Brightness', -1, 1, 0.01, 2),
          pre('contrast', 'Contrast', -1, 1, 0.01, 2),
          pre('gamma', 'Gamma', 0.2, 5, 0.05, 2),
          pre('blur', 'Blur', 0, 10, 0.5, 1),
          UI.checkField({ label: 'Invert (light lines on dark)', value: st.pre.invert, onChange: (v) => { st.pre.invert = v; persist(); run(); } }),
        ], { collapsible: true, collapsed: false }),
        UI.section('Output', [widthF, resF, showCb], { collapsible: true })));

    const add = () => {
      if (!polys.length) { UI.toast('Nothing traced - adjust the settings.', 'warn'); return; }
      const mm = polys.map(p => {
        const q = new Array(p.length);
        for (let j = 0; j < p.length; j += 2) { q[j] = p[j] * mmPerPx; q[j + 1] = -p[j + 1] * mmPerPx; }
        return q;
      });
      const m = IT.modes.find(x => x.id === st.mode);
      const o = OBJ.create.path(mm, { name: file.name.replace(/\.[^.]+$/, '') + ' (' + (m ? m.name : st.mode) + ')' });
      PP.App.addPlaced([o], { fit: false });
      dlg.close();
      UI.toast('Image added as ' + mm.length.toLocaleString() + ' pen paths.', 'info');
    };
    const dlg = UI.modal({
      title: 'Trace image: ' + file.name, body, wide: true, className: 'modal-xl',
      footer: [h('span', { class: 'hint' }, 'Tip: line art → Outline/Centerline, photos → Hatch/Squiggle/Spiral.'), h('span', { class: 'hspacer' }), UI.btn('Cancel', () => dlg.close()), UI.btn('Add to bed', add, { primary: true, icon: 'plus' })],
    });
    buildModeForm();
    run();
  };
})(window.PP = window.PP || {});
