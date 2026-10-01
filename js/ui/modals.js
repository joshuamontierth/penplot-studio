/* PenPlot Studio - dialogs: printer settings, G-code export, calibration, help. */
(function (PP) {
  'use strict';

  const U = PP.U, S = PP.Store, h = U.h;
  const UI = PP.UI;

  // ---------------------------------------------------------------------------
  // Printer settings
  // ---------------------------------------------------------------------------
  UI.openPrinterSettings = function () {
    const App = PP.App;
    let draft = Object.assign({}, App.profile());
    const body = h('div', { class: 'settings' });
    const errBox = h('div', { class: 'warns' });

    const profSel = UI.selectField({
      label: 'Profile', value: draft.id,
      options: App.profiles().map(p => ({ value: p.id, label: p.name + (p.builtin ? '' : ' (custom)') })),
      onChange: (v) => { App.setProfile(v); m.close(); UI.openPrinterSettings(); },
    });

    const F = (key, label, unit, opts = {}) => UI.numberField(Object.assign({
      label, unit, value: draft[key], step: opts.step || 1, min: opts.min, max: opts.max, decimals: opts.decimals, title: opts.title,
      onChange: (v) => { draft[key] = v; validate(); },
    }, opts.extra || {}));
    const CB = (key, label, title) => UI.checkField({ label, value: draft[key], title, onChange: (v) => { draft[key] = v; validate(); } });
    const TXT = (key, label, placeholder, rows = 4) => {
      const ta = h('textarea', { class: 'code', rows, placeholder, spellcheck: 'false' });
      ta.value = draft[key] || '';
      ta.addEventListener('input', () => { draft[key] = ta.value; });
      ta.addEventListener('keydown', (e) => e.stopPropagation());
      return h('div', { class: 'field' }, h('label', null, label), ta);
    };

    const nameIn = h('input', { value: draft.name, spellcheck: 'false' });
    nameIn.addEventListener('input', () => { draft.name = nameIn.value; });
    nameIn.addEventListener('keydown', (e) => e.stopPropagation());

    const offsetDiagram = h('div', { class: 'offset-diagram', html: offsetSVG(draft) });

    const tabsDef = [
      ['Pen mount', () => [
        h('p', { class: 'hint' }, draft.mount || ''),
        h('div', { class: 'row gap-lg' },
          h('div', { class: 'grow' },
            F('penOffsetX', 'Pen offset X (right +, left -)', 'mm', { step: 0.1, decimals: 2, title: 'How far the pen tip is to the RIGHT of the nozzle (negative = left). Falu mount: about -28' }),
            F('penOffsetY', 'Pen offset Y (back +, front -)', 'mm', { step: 0.1, decimals: 2, title: 'How far the pen tip is BEHIND the nozzle (negative = in front). Falu mount: about -35' }),
            h('p', { class: 'hint' }, 'Nozzle position = pen position - offset. Not sure? Run Calibrate → Offset finder: it draws a cross, then parks the bare nozzle over the same spot so you can measure the offset with a ruler.'),
            h('p', { class: 'hint' }, 'The nozzle limits (Bed & limits tab) are the safe zone for the attached module. The X1C defaults follow the mount designer\'s excluded area: keep the nozzle out of the front 55 mm and the left 48 mm.')),
          offsetDiagram)]],
      ['Z heights', () => [
        h('div', { class: 'grid2' },
          F('zDraw', 'Z-Draw (pen down)', 'mm', { step: 0.1, decimals: 2, min: 0.2, title: 'Nozzle height where the pen tip presses on the paper. Lower value = more pressure.' }),
          F('zLift', 'Z-Lift (pen up / travel)', 'mm', { step: 0.1, decimals: 2, min: 0.5 }),
          F('zAttach', 'Attach / pen-change height', 'mm', { step: 1, min: 1, title: 'The bed drops to this height while you attach or swap the pen holder.' }),
          F('zEnd', 'End height', 'mm', { step: 1, min: 1, title: 'Bed height after the plot finishes.' }),
          F('zMax', 'Maximum Z', 'mm', { step: 1, min: 10 })),
        h('p', { class: 'hint' }, 'On the X1C, Z is the distance between nozzle and plate - a larger Z moves the bed further down, away from the pen. Where the pen touches depends on how far it sticks out of the holder: the Instructables guide uses Z 14, the mount designer uses about Z 17 for a Stabilo. Run the calibration test to find yours. Pen-down heights are always kept between Z-Draw - 4 and Z-Lift - 0.5.')]],
      ['Speeds', () => [
        h('div', { class: 'grid2' },
          F('drawSpeed', 'Draw speed', 'mm/s', { min: 1, max: 500 }),
          F('travelSpeed', 'Move (travel) speed', 'mm/s', { min: 5, max: 600 }),
          F('zSpeed', 'Z speed', 'mm/s', { min: 1, max: 30, step: 0.5, decimals: 1 }),
          F('accel', 'Acceleration', 'mm/s²', { min: 0, max: 20000, step: 100, title: 'Sent as M204. Lower values give cleaner lines. 0 = do not change.' }),
          F('penDownDelay', 'Pen-down dwell', 'ms', { min: 0, max: 2000, step: 10, title: 'Pause after lowering the pen so ink starts flowing (M400 P on Bambu, G4 P on Marlin).' }),
          F('penUpDelay', 'Pen-up dwell', 'ms', { min: 0, max: 2000, step: 10 }))]],
      ['Bed & limits', () => [
        h('div', { class: 'grid2' },
          F('bedWidth', 'Bed width (X)', 'mm', { min: 50, max: 1000 }),
          F('bedDepth', 'Bed depth (Y)', 'mm', { min: 50, max: 1000 }),
          F('nozzleMinX', 'Nozzle X min', 'mm', { step: 0.5 }),
          F('nozzleMaxX', 'Nozzle X max', 'mm', { step: 0.5 }),
          F('nozzleMinY', 'Nozzle Y min', 'mm', { step: 0.5 }),
          F('nozzleMaxY', 'Nozzle Y max', 'mm', { step: 0.5 }),
          F('margin', 'Safety margin', 'mm', { min: 0, max: 30, step: 0.5, decimals: 1 })),
        h('p', { class: 'hint' }, 'Nozzle limits = where the nozzle may go while the pen holder is attached (the module\'s safe zone). The drawable area is this zone shifted by the pen offset and cut to the plate - everything else is red on the canvas.')]],
      ['Start / pause / end', () => [
        CB('home', 'Home all axes (G28) at the start'),
        CB('safeStart', 'Drop the bed a little before homing (Bambu safe start, from Bambu\'s own start G-code)'),
        CB('pauseForAttach', 'Pause after homing so I can attach the pen holder', 'Recommended for the X1C: the pen holder must not be attached while the printer homes.'),
        CB('layerPause', 'Pause between layers for pen changes'),
        CB('endPause', 'Pause at the end so I can remove the pen holder', 'Recommended by the mount designer: never let the job finish with the module attached.'),
        CB('heatersOff', 'Make sure heaters are off (M104 S0 / M140 S0)'),
        CB('progress', 'Report progress on the printer screen (M73)'),
        h('div', { class: 'field' }, h('label', null, 'Pause command'), (() => {
          const i = h('input', { value: draft.pauseCommand, spellcheck: 'false' });
          i.addEventListener('input', () => { draft.pauseCommand = i.value; });
          i.addEventListener('keydown', (e) => e.stopPropagation());
          return i;
        })()),
        h('div', { class: 'grid2' },
          F('parkX', 'Park X (nozzle)', 'mm', { step: 1, title: 'Where the toolhead waits while you attach/swap the pen.' }),
          F('parkY', 'Park Y (nozzle)', 'mm', { step: 1 }),
          F('endX', 'End X (nozzle)', 'mm', { step: 1 }),
          F('endY', 'End Y (nozzle)', 'mm', { step: 1 })),
        h('p', { class: 'hint' }, 'Bambu printers pause with M400 U1 and show a Resume button on the screen. Marlin printers usually use M0 or M600.')]],
      ['Custom G-code', () => [
        TXT('startGcode', 'Extra start G-code (inserted before homing)', '; e.g. M1002 gcode_claim_action : 0'),
        TXT('endGcode', 'Extra end G-code (inserted at the end)', '; e.g. M18'),
      ]],
      ['Path optimization', () => {
        const pf = App.prefs;
        return [
          UI.checkField({ label: 'Optimize drawing order (minimize pen travel)', value: pf.reorder, onChange: (v) => App.setPrefs({ reorder: v }) }),
          UI.checkField({ label: 'Allow drawing paths in reverse', value: pf.reverse, onChange: (v) => App.setPrefs({ reverse: v }) }),
          h('div', { class: 'grid2' },
            UI.numberField({ label: 'Join tolerance', unit: 'mm', value: pf.joinTol, min: 0, max: 2, step: 0.01, decimals: 2, title: 'Paths whose ends are closer than this are drawn without lifting the pen.', onChange: (v) => App.setPrefs({ joinTol: v }) }),
            UI.numberField({ label: 'Simplify tolerance', unit: 'mm', value: pf.simplify, min: 0, max: 1, step: 0.01, decimals: 3, title: 'Removes points that deviate less than this from a straight line - smaller files, same look.', onChange: (v) => App.setPrefs({ simplify: v }) }),
            UI.numberField({ label: 'Drop paths shorter than', unit: 'mm', value: pf.minLength, min: 0, max: 5, step: 0.05, decimals: 2, onChange: (v) => App.setPrefs({ minLength: v }) })),
          h('p', { class: 'hint' }, 'These settings apply to every profile and take effect immediately.'),
        ];
      }],
    ];

    const tabBar = h('div', { class: 'mtabs' });
    const tabBody = h('div', { class: 'mtab-body' });
    const panes = tabsDef.map(([name, build], i) => {
      const pane = h('div', { class: 'mtab-pane' + (i === 0 ? ' on' : '') });
      build().forEach(el => el && pane.appendChild(el));
      tabBody.appendChild(pane);
      const b = h('button', { class: 'mtab' + (i === 0 ? ' on' : ''), onclick: () => {
        U.$$('.mtab', tabBar).forEach(x => x.classList.remove('on'));
        U.$$('.mtab-pane', tabBody).forEach(x => x.classList.remove('on'));
        b.classList.add('on'); pane.classList.add('on');
      } }, name);
      tabBar.appendChild(b);
      return pane;
    });
    void panes;

    body.append(
      h('div', { class: 'row gap-lg' }, profSel, h('div', { class: 'field grow' }, h('label', null, 'Profile name'), nameIn)),
      tabBar, tabBody, errBox);

    function validate() {
      U.clear(errBox);
      const errs = PP.GCode.validateProfile(PP.GCode.normalizeProfile(draft));
      errs.forEach(e => errBox.appendChild(h('div', { class: 'warn-item error' }, UI.icon('warn', 14), h('span', null, e))));
      offsetDiagram.innerHTML = offsetSVG(draft);
      const R = PP.GCode.reachableRect(PP.GCode.normalizeProfile(draft));
      areaLbl.textContent = 'Drawable area: ' + U.fmt(R.maxX - R.minX, 1) + ' × ' + U.fmt(R.maxY - R.minY, 1) + ' mm  (X ' + U.fmt(R.minX, 1) + '–' + U.fmt(R.maxX, 1) + ', Y ' + U.fmt(R.minY, 1) + '–' + U.fmt(R.maxY, 1) + ')';
      return errs;
    }
    const areaLbl = h('span', { class: 'hint' });

    const save = () => {
      const errs = validate();
      if (errs.length) { UI.toast('Please fix the highlighted problems first.', 'error'); return; }
      const patch = {};
      for (const k in PP.GCode.FIELD_DEFAULTS) patch[k] = draft[k];
      patch.name = draft.name || 'Printer';
      App.updateProfile(patch, draft.id);
      UI.toast('Printer settings saved', 'info');
      m.close();
    };
    const footer = [
      areaLbl,
      h('span', { class: 'hspacer' }),
      draft.builtin ? UI.btn('Reset to defaults', async () => {
        if (await UI.confirm('Reset profile', 'Restore the factory values for "' + draft.name + '"?', 'Reset')) { App.resetProfile(draft.id); m.close(); UI.openPrinterSettings(); }
      }) : UI.btn('Delete profile', async () => {
        if (await UI.confirm('Delete profile', 'Delete "' + draft.name + '"?', 'Delete', true)) { App.deleteProfile(draft.id); m.close(); }
      }, { danger: true }),
      UI.btn('Save as new profile', () => {
        const errs = validate(); if (errs.length) return;
        const id = App.duplicateProfile(draft.id, draft.name || 'Printer'); // the list marks it "(custom)" itself
        const patch = {}; for (const k in PP.GCode.FIELD_DEFAULTS) patch[k] = draft[k];
        App.updateProfile(patch, id);
        m.close(); UI.openPrinterSettings();
      }),
      UI.btn('Save', save, { primary: true }),
    ];
    const m = UI.modal({ title: 'Printer & plotter settings', body, footer, wide: true });
    validate();
  };

  function offsetSVG(p) {
    const ox = p.penOffsetX, oy = p.penOffsetY;
    const s = 2.2, cx = 90, cy = 90;
    const px = cx + ox * s, py = cy - oy * s;
    return '<svg viewBox="0 0 180 180" width="180" height="180">' +
      '<rect x="1" y="1" width="178" height="178" rx="10" fill="#1b2027" stroke="#2c333d"/>' +
      '<text x="90" y="172" fill="#7c8794" font-size="10" text-anchor="middle">FRONT</text>' +
      '<rect x="' + (cx - 24) + '" y="' + (cy - 24) + '" width="48" height="48" rx="6" fill="#2a313b" stroke="#465160"/>' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="4" fill="#94a3b8"/>' +
      '<text x="' + cx + '" y="' + (cy - 29) + '" fill="#94a3b8" font-size="9" text-anchor="middle">nozzle</text>' +
      '<line x1="' + cx + '" y1="' + cy + '" x2="' + px + '" y2="' + py + '" stroke="#4a72e0" stroke-dasharray="3 3"/>' +
      '<circle cx="' + px + '" cy="' + py + '" r="5" fill="#4a72e0"/>' +
      '<text x="' + (px + 8) + '" y="' + (py + 4) + '" fill="#4a72e0" font-size="9">pen</text>' +
      '<text x="8" y="16" fill="#7c8794" font-size="9">X ' + (ox >= 0 ? '+' : '') + U.fmt(ox, 1) + '  Y ' + (oy >= 0 ? '+' : '') + U.fmt(oy, 1) + '</text>' +
      '</svg>';
  }

  // ---------------------------------------------------------------------------
  // G-code export
  // ---------------------------------------------------------------------------
  UI.openExport = function () {
    if (PP.Preview.active) PP.Preview.stop();
    const App = PP.App;
    const plan = App.buildPlan();
    const p = plan.profile;
    const errs = PP.GCode.validateProfile(p);
    if (!plan.jobs.length) { UI.toast(App.emptyPlanMessage(plan), 'warn'); return; }
    let mode = plan.jobs.length > 1 ? PP.Storage.getLocal('exportMode', 'combined') : 'combined';
    let dry = false;
    const R = PP.GCode.reachableRect(p);
    const baseName = U.safeFilename(S.project.name, 'plot');

    const summary = h('div', { class: 'export-summary' });
    const s = plan.stats;
    const card = (label, value, sub) => h('div', { class: 'xcard' }, h('span', null, label), h('b', null, value), sub ? h('small', null, sub) : null);
    summary.append(
      card('Paths', String(s.lifts), 'pen-down strokes'),
      card('Layers', String(plan.jobs.length), plan.jobs.map(j => j.name).join(', ')),
      card('Plate size', U.fmt(p.bedWidth, 0) + ' × ' + U.fmt(p.bedDepth, 0) + ' mm', 'drawable ' + U.fmt(R.maxX - R.minX, 0) + ' × ' + U.fmt(R.maxY - R.minY, 0)),
      card('Est. time', U.formatDuration(s.time + 45), U.formatLength(s.drawLen) + ' of ink'),
    );
    const settingsTbl = h('div', { class: 'kv' },
      kv('Printer', p.name), kv('Pen offset', 'X' + (p.penOffsetX >= 0 ? '+' : '') + p.penOffsetX + '  Y' + (p.penOffsetY >= 0 ? '+' : '') + p.penOffsetY + ' mm'),
      kv('Z-Draw / Z-Lift', p.zDraw + ' / ' + p.zLift + ' mm'), kv('Draw / move speed', p.drawSpeed + ' / ' + p.travelSpeed + ' mm/s'),
      kv('Attach height', p.zAttach + ' mm'), kv('Start pause', p.pauseForAttach ? p.pauseCommand : 'off'));

    const warnBox = h('div', { class: 'warns' });
    if (plan.clipped) warnBox.appendChild(h('div', { class: 'warn-item warn' }, UI.icon('warn', 14), h('span', null, 'Parts of the design are outside the drawable area and were clipped.')));
    errs.forEach(e => warnBox.appendChild(h('div', { class: 'warn-item error' }, UI.icon('warn', 14), h('span', null, e))));

    const modeSeg = UI.segmented({
      options: [{ value: 'combined', label: 'One file (pause for pen change)' }, { value: 'split', label: 'One file per layer' }],
      value: mode, onChange: (v) => { mode = v; PP.Storage.setLocal('exportMode', v); renderFiles(); },
    });
    const dryCb = UI.checkField({ label: 'Dry run - pen never touches the paper (moves at Z-Lift)', value: false, onChange: (v) => { dry = v; renderFiles(); } });
    const files = h('div', { class: 'file-list' });
    const codeView = h('textarea', { class: 'code code-view', rows: 12, readonly: true, spellcheck: 'false' });
    let lastText = '';

    function makeJob(j) { return { name: j.name, color: j.color, polys: j.polys, zDraw: j.zDraw, drawSpeed: j.drawSpeed }; }
    function gen(jobs) {
      return PP.GCode.build(jobs, p, { dryRun: dry, title: S.project.name });
    }
    function renderFiles() {
      U.clear(files);
      const outputs = [];
      if (mode === 'combined' || plan.jobs.length === 1) {
        outputs.push({ name: baseName + (dry ? '_DRYRUN' : '') + '.gcode', jobs: plan.jobs.map(makeJob), label: plan.jobs.length > 1 ? 'All layers (' + plan.jobs.length + ' pens, pauses between)' : plan.jobs[0].name });
      } else {
        plan.jobs.forEach((j, i) => outputs.push({ name: baseName + '_' + (i + 1) + '_' + U.safeFilename(j.name, 'layer') + (dry ? '_DRYRUN' : '') + '.gcode', jobs: [makeJob(j)], label: j.name, color: j.color }));
      }
      outputs.forEach((o, i) => {
        const res = gen(o.jobs);
        o.res = res;
        const sim = PP.GSim.check(res.text, p, o.jobs, { dryRun: dry, keepMoves: false });
        if (i === 0) { lastText = res.text; codeView.value = res.text.split('\n').slice(0, 250).join('\n') + (res.stats.lines > 250 ? '\n; ... (' + (res.stats.lines - 250) + ' more lines)' : ''); }
        const row = h('div', { class: 'file-row' + (sim.ok ? '' : ' bad') },
          h('span', { class: 'dot', style: { background: o.color || (o.jobs[0] && o.jobs[0].color) || '#999' } }),
          h('div', { class: 'grow' }, h('b', null, o.name), h('small', null, o.label + ' • ' + res.stats.lines.toLocaleString() + ' lines • ' + U.formatDuration(res.stats.time) + ' • ' + Math.round(res.text.length / 1024) + ' KB')),
          UI.btn('Download', async () => {
            if (!sim.ok && !(await UI.confirm('Safety check failed', 'The simulator found ' + sim.errors.length + ' problem(s) in this file that could crash the printer or ruin the plot. Download anyway?', 'Download anyway', true))) return;
            if (sim.ok && errs.length && !(await UI.confirm('Printer settings have problems', errs.join(' ') + ' Download anyway?', 'Download anyway', true))) return;
            U.downloadText(o.name, res.text, 'text/x-gcode');
            UI.toast('Saved ' + o.name + ' - copy it to the root of the printer SD card.', 'info', 5000);
          }, { primary: sim.ok, small: true, icon: 'download' }),
          h('button', { class: 'btn btn-sm', onclick: () => { codeView.value = res.text.split('\n').slice(0, 400).join('\n'); lastText = res.text; } }, 'View'));
        files.appendChild(row);
        files.appendChild(h('div', { class: 'warn-item ' + (sim.ok ? 'ok' : 'error') }, UI.icon(sim.ok ? 'check' : 'warn', 14),
          h('span', null, sim.ok ? 'Safety check passed: ' + PP.GSim.summary(sim) + '.' : 'Safety check FAILED: ' + sim.errors.map(PP.GSim.fmtMsg).join(' • '))));
        sim.warnings.slice(0, 4).forEach(w => files.appendChild(h('div', { class: 'warn-item warn' }, UI.icon('warn', 14), h('span', null, PP.GSim.fmtMsg(w)))));
        res.warnings.forEach(w => files.appendChild(h('div', { class: 'warn-item warn' }, UI.icon('warn', 14), h('span', null, w))));
      });
    }

    const x1c = p.firmware === 'bambu';
    const instructions = h('div', { class: 'attach-steps' },
      h('h3', null, x1c ? 'What happens when you print' : 'Running the file'),
      h('ol', null,
        h('li', null, 'Copy the .gcode file to the ', h('b', null, 'root of the SD card'), ' (no folders, simple file name) and put the card back in the printer.'),
        h('li', null, 'Tape the paper down where the canvas shows it. Do ', h('b', null, 'not'), ' attach the pen holder yet.'),
        h('li', null, 'On the printer screen: ', h('b', null, 'Print files → SD card'), ' → pick the file → Print.'),
        h('li', null, 'The printer homes (the nozzle touches the plate center), lowers the bed to Z ' + p.zAttach + ' and parks the toolhead' + (p.pauseForAttach ? ', then ' : '.'), p.pauseForAttach ? h('b', null, 'pauses with a Resume button.') : null, x1c && p.pauseForAttach ? (p.purgeChute ? ' While paused the firmware moves the toolhead to the purge chute (back left) and warms the nozzle (about 90 °C) - do not touch it. On Resume it waits 30-60 s, then returns.' : ' The nozzle can warm up while paused - do not touch it.') : null),
        p.pauseForAttach ? h('li', null, 'Clip the pen holder onto the toolhead, check the pen is tight and the tip height is right, then press ', h('b', null, 'Resume'), '.') : null,
        plan.jobs.length > 1 && mode === 'combined' && p.layerPause ? h('li', null, 'Between layers the printer pauses again: swap to the next pen color and press Resume.') : null,
        p.endPause
          ? h('li', null, 'At the end the bed lowers and the printer pauses one last time: ', h('b', null, 'remove the pen holder'), ', then press Resume to finish. Never let a normal 3D print start with the module attached.')
          : h('li', null, 'When it finishes the bed lowers and the toolhead moves to the back. Remove the pen holder before your next 3D print.')),
      h('p', { class: 'hint' }, 'Tip: run a Dry run first without the pen to confirm the toolhead stays over your paper. Pause or Stop on the printer screen work at any time.'));

    const body = h('div', { class: 'export' },
      summary,
      h('div', { class: 'export-cols' },
        h('div', null,
          h('h3', null, 'Plotter settings'), settingsTbl,
          h('div', { class: 'field' }, h('label', null, 'Output'), plan.jobs.length > 1 ? modeSeg : h('div', { class: 'hint' }, 'Single layer - one file.')),
          dryCb, warnBox,
          h('h3', null, 'Files'), files),
        instructions),
      h('details', { class: 'code-details' }, h('summary', null, 'View G-code'), codeView,
        h('div', { class: 'row gap' }, UI.btn('Copy to clipboard', async () => {
          try { await navigator.clipboard.writeText(lastText); UI.toast('G-code copied', 'info'); } catch (e) { UI.toast('Clipboard not available', 'warn'); }
        }, { small: true, icon: 'copy' }))));

    UI.modal({ title: 'Download G-code', body, wide: true, footer: [h('span', { class: 'hint' }, 'Generated for ' + p.name), h('span', { class: 'hspacer' }), UI.btn('Printer settings', () => UI.openPrinterSettings(), { icon: 'settings' })] });
    renderFiles();
  };

  function kv(k, v) { return h('div', { class: 'kv-row' }, h('span', null, k), h('b', null, v)); }

  // ---------------------------------------------------------------------------
  // Calibration
  // ---------------------------------------------------------------------------
  /** type: 'frame' | 'offset' | 'compact' | 'grid'; defaults to the last one used (first time: frame test). */
  UI.openCalibration = async function (type) {
    const p = PP.App.profile();
    try { await PP.Fonts.load(PP.Fonts.DEFAULT); } catch (e) { UI.toast('Could not load the font for the calibration labels.', 'warn'); }
    // Default range covers both the Instructables (Z 14) and the mount designer (Z 17) contact heights
    const defStart = () => U.round(p.zDraw - 2, 2), defEnd = () => U.round(Math.min(p.zDraw + 3, p.zLift - 1), 2);
    const st = Object.assign({ zStart: defStart(), zEnd: defEnd(), zStep: 1, speeds: '20, 30, 45, 60', cell: 16 }, PP.Storage.getLocal('calib', {}));
    if (st.forZ !== p.zDraw + '/' + p.zLift) { st.zStart = defStart(); st.zEnd = defEnd(); st.zStep = 1; st.forZ = p.zDraw + '/' + p.zLift; }
    let cur = type || st.type || 'frame';
    let result = null;
    const canvas = h('canvas', { class: 'calib-canvas', width: 640, height: 400 });
    const legend = h('ul', { class: 'tips' });
    const err = h('div', { class: 'warns' });

    // same order as Help → Calibration
    const typeSeg = UI.segmented({
      options: [{ value: 'frame', label: '1 Frame' }, { value: 'offset', label: '2 Offset finder' }, { value: 'compact', label: 'Z test' }, { value: 'grid', label: 'Z × speed' }],
      value: cur, onChange: (v) => { cur = v; st.type = v; save(); dryCb.setValue(v === 'frame'); refresh(); },
    });
    const save = () => PP.Storage.setLocal('calib', st);
    const zs = UI.numberField({ label: 'Z from', unit: 'mm', value: st.zStart, step: 0.1, decimals: 2, onChange: (v) => { st.zStart = v; save(); refresh(); } });
    const ze = UI.numberField({ label: 'Z to', unit: 'mm', value: st.zEnd, step: 0.1, decimals: 2, onChange: (v) => { st.zEnd = v; save(); refresh(); } });
    const zst = UI.numberField({ label: 'Z step', unit: 'mm', value: st.zStep, min: 0.05, max: 5, step: 0.05, decimals: 2, onChange: (v) => { st.zStep = v; save(); refresh(); } });
    const cell = UI.numberField({ label: 'Cell size', unit: 'mm', value: st.cell, min: 8, max: 40, step: 1, onChange: (v) => { st.cell = v; save(); refresh(); } });
    const spIn = h('input', { value: st.speeds, spellcheck: 'false' });
    spIn.addEventListener('change', () => { st.speeds = spIn.value; save(); refresh(); });
    spIn.addEventListener('keydown', (e) => e.stopPropagation());
    const speedField = h('div', { class: 'field' }, h('label', null, 'Speeds (mm/s, comma separated)'), spIn);
    // the frame test is meant to be run as a dry run first (no pen), so it starts ticked
    const dryCb = UI.checkField({ label: 'Dry run (pen stays up)', value: cur === 'frame' });
    const opts = h('div', { class: 'grid2' }, zs, ze, zst, cell);

    function zValues() {
      const out = [];
      const a = Math.min(st.zStart, st.zEnd), b = Math.max(st.zStart, st.zEnd), s = Math.max(0.05, st.zStep);
      for (let z = a; z <= b + 1e-9 && out.length < 30; z += s) out.push(U.round(z, 3));
      return out;
    }

    function refresh() {
      U.clear(err); U.clear(legend);
      opts.style.display = cur === 'frame' || cur === 'offset' ? 'none' : '';
      speedField.style.display = cur === 'grid' ? '' : 'none';
      dryCb.style.display = cur === 'offset' ? 'none' : '';
      const speeds = String(st.speeds).split(/[,\s]+/).map(parseFloat).filter(v => v > 0).slice(0, 8);
      try {
        if (cur === 'offset') {
          const of = PP.GCode.offsetFinder(p);
          const cross = [[of.nozzle.x - 8 + p.penOffsetX, of.nozzle.y + p.penOffsetY, of.nozzle.x + 8 + p.penOffsetX, of.nozzle.y + p.penOffsetY],
            [of.nozzle.x + p.penOffsetX, of.nozzle.y - 8 + p.penOffsetY, of.nozzle.x + p.penOffsetX, of.nozzle.y + 8 + p.penOffsetY],
            PP.Geo.translate([PP.Geo.ellipse(4, 4)], of.nozzle.x + p.penOffsetX, of.nozzle.y + p.penOffsetY)[0]];
          result = { jobs: [{ name: 'Cross', polys: cross }], legend: of.legend, offset: of, nozzle: of.nozzle };
        } else {
          result = PP.GCode.calibrationJobs(p, { type: cur, zValues: zValues(), speeds, cell: st.cell });
        }
        result.legend.forEach(l => legend.appendChild(h('li', null, l)));
      } catch (e) {
        result = null;
        err.appendChild(h('div', { class: 'warn-item error' }, UI.icon('warn', 14), h('span', null, e.message)));
      }
      draw();
    }

    function draw() {
      const ctx = canvas.getContext('2d');
      const W = canvas.width, H = canvas.height;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--canvas').trim() || '#e7e8eb'; ctx.fillRect(0, 0, W, H);
      const k = Math.min((W - 20) / p.bedWidth, (H - 20) / p.bedDepth);
      const ox = (W - p.bedWidth * k) / 2, oy = (H + p.bedDepth * k) / 2;
      ctx.setTransform(k, 0, 0, -k, ox, oy);
      ctx.fillStyle = '#eef0f3'; ctx.fillRect(0, 0, p.bedWidth, p.bedDepth);
      const R = PP.GCode.reachableRect(p);
      ctx.fillStyle = 'rgba(225,45,45,0.13)';
      ctx.beginPath(); ctx.rect(0, 0, p.bedWidth, p.bedDepth); ctx.rect(R.minX, R.minY, R.maxX - R.minX, R.maxY - R.minY); ctx.fill('evenodd');
      if (!result) return;
      ctx.lineWidth = 0.35; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      const cols = ['#1a1a1a', '#1f5fd6'];
      result.jobs.forEach((j, i) => {
        ctx.strokeStyle = cols[i % 2];
        ctx.beginPath();
        for (const q of j.polys) { ctx.moveTo(q[0], q[1]); for (let t = 2; t < q.length; t += 2) ctx.lineTo(q[t], q[t + 1]); }
        ctx.stroke();
      });
      if (result.nozzle) {
        ctx.fillStyle = '#64748b';
        ctx.beginPath(); ctx.arc(result.nozzle.x, result.nozzle.y, 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    const download = async () => {
      if (!result) return;
      let text, sim, secs;
      if (cur === 'offset') {
        text = result.offset.text;
        sim = PP.GSim.simulate(text, p, { expectedPauses: 2 });
        secs = sim.stats.time;
      } else {
        const res = PP.GCode.build(result.jobs, p, { dryRun: dryCb.input.checked, title: 'Calibration (' + cur + ')' });
        text = res.text; secs = res.stats.time;
        sim = PP.GSim.check(text, p, result.jobs, { dryRun: dryCb.input.checked, keepMoves: false });
      }
      if (!sim.ok && !(await UI.confirm('Safety check failed', 'The simulator found problems: ' + sim.errors.map(PP.GSim.fmtMsg).join(' | ') + '. Download anyway?', 'Download anyway', true))) return;
      const name = 'calibration_' + cur + (dryCb.input.checked && cur !== 'offset' ? '_DRYRUN' : '') + '.gcode';
      U.downloadText(name, text, 'text/x-gcode');
      UI.toast('Saved ' + name + ' (' + U.formatDuration(secs) + ') - safety check ' + (sim.ok ? 'passed' : 'FAILED'), sim.ok ? 'info' : 'warn');
    };

    const body = h('div', { class: 'calib' },
      h('div', { class: 'calib-left' }, typeSeg, opts, speedField, dryCb, err, h('h3', null, 'How to read it'), legend),
      h('div', { class: 'calib-right' }, canvas, h('p', { class: 'hint' }, 'Preview on the bed; the gray dot is the nozzle for the offset finder. Run the file like any plot: attach the holder at the first pause.')));
    UI.modal({ title: 'Calibration', body, wide: true, footer: [UI.btn('Calibration guide', () => UI.openHelp('calibration'), { icon: 'help' }), h('span', { class: 'hspacer' }), UI.btn('Download calibration G-code', download, { primary: true, icon: 'download' })] });
    refresh();
  };

  // ---------------------------------------------------------------------------
  // Help (tabs: getting started, calibration, safety, shortcuts)
  // ---------------------------------------------------------------------------
  /** Tab bar + panes. defs: [[id, label, build() -> element[]]]. Returns { el, show(id) }. */
  function tabs(defs, initial) {
    const bar = h('div', { class: 'mtabs', role: 'tablist' });
    const bodyEl = h('div', { class: 'mtab-body' });
    const items = defs.map(([id, label, build]) => {
      const pane = h('div', { class: 'mtab-pane', role: 'tabpanel' });
      build().forEach(el => el && pane.appendChild(el));
      const btn = h('button', { class: 'mtab', role: 'tab', dataset: { tab: id }, onclick: () => show(id) }, label);
      bar.appendChild(btn); bodyEl.appendChild(pane);
      return { id, btn, pane };
    });
    function show(id) {
      const it = items.find(x => x.id === id) || items[0];
      for (const x of items) {
        const on = x === it;
        x.btn.classList.toggle('on', on); x.btn.setAttribute('aria-selected', String(on));
        x.pane.classList.toggle('on', on);
      }
      bodyEl.scrollTop = 0;
    }
    show(initial);
    return { el: h('div', { class: 'tabs-wrap' }, bar, bodyEl), show };
  }

  const step = (n, title, ...content) => h('div', { class: 'help-step' }, h('span', { class: 'num' }, String(n)), h('div', null, h('b', null, title), h('p', null, ...content)));
  const note = (kind, ...content) => h('div', { class: 'help-note ' + kind }, UI.icon(kind === 'warn' ? 'warn' : 'help', 15), h('div', null, ...content));
  const calLink = (label, type) => h('a', { href: '#', onclick: (e) => { e.preventDefault(); while (UI.closeTopModal()); UI.openCalibration(type); } }, label);

  function helpStart() {
    const p = PP.App.profile();
    return [
      h('p', { class: 'lead' }, 'PenPlot Studio turns your Bambu Lab X1 Carbon into a pen plotter. Design here, download G-code and plot from the SD card - no firmware changes.'),
      step(1, 'Install the pen mount', 'Print the Falu "Head Mount V1 - Series X & P" and fit a pen (Stabilo Point 88, Pilot G2, Micron...). Do not clip the module onto the printer yet - that happens at the first pause.'),
      step(2, 'Calibrate once', 'Before your first real plot, work through the ', h('b', null, 'Calibration'), ' tab: an empty run, a dry-run frame test and the offset finder. It takes about 15 minutes and confirms the pen offset for your mount.'),
      step(3, 'Design', 'Use the Text, Draw, Image, Patterns and Import tabs. Each layer is one pen: layers plot top to bottom with a pause to swap pens.'),
      step(4, 'Preview', 'Preview replays the actual G-code: pen strokes, travel moves and the safety check.'),
      step(5, 'Download and copy', 'Download the .gcode file and copy it to the root of the SD card (no folders, simple file name).'),
      step(6, 'Tape the paper', 'Tape it where the canvas shows the paper. Keep tape away from the plate center, where the printer homes.'),
      step(7, 'Print, attach, plot', 'Start it from Print files → SD card. The printer homes, lowers the bed and pauses' + (p.purgeChute ? ' (the toolhead waits at the purge chute, back left)' : '') + '. Clip the pen holder on, check the pen, press Resume. At the end the bed lowers and the toolhead moves out of the way: remove the holder then.'),
      step(8, 'Tune', 'Faint lines: lower Z-Draw by 0.5 mm. Tearing or blobs: raise it. Ghost lines on travel moves: raise Z-Lift.'),
      h('h3', null, 'Coordinates'),
      h('p', { class: 'hint' }, 'Everything on the canvas is in pen coordinates: millimetres from the front-left corner of the plate. The G-code converts them to nozzle positions (nozzle = pen - offset). The striped zone is where the pen cannot reach or the module could collide.'),
    ];
  }

  function helpCalibration() {
    const p = PP.App.profile();
    const f = (v) => U.fmt(v, 2);
    const R = PP.GCode.reachableRect(p);
    return [
      h('p', { class: 'lead' }, 'Calibration answers three questions: will the module clear the printer, where exactly is the pen relative to the nozzle, and at what height does the pen touch the paper? Do the tests in this order - each one uses the result of the one before.'),
      note('info', 'Every calibration file runs like a normal plot: copy it to the SD card, start it, clip the holder on at the first pause, press Resume. Open ', calLink('Calibrate', 'frame'), ' in the top bar to make the files. Keep the door open and a hand near the screen for the first runs.'),

      h('h3', null, '0. Before you start'),
      h('ul', { class: 'tips' },
        h('li', null, 'Printer settings → ', h('b', null, 'Reset to defaults'), ' on your printer profile, then check the values (current: pen offset X', f(p.penOffsetX), ' Y', f(p.penOffsetY), ', nozzle safe zone X ', f(p.nozzleMinX), '-', f(p.nozzleMaxX), ' / Y ', f(p.nozzleMinY), '-', f(p.nozzleMaxY), ', Z-Draw ', f(p.zDraw), ', Z-Lift ', f(p.zLift), ').'),
        h('li', null, h('b', null, 'Look at the mount:'), ' the pen should sit left of and in front of the nozzle (offset X and Y both negative). If it sits to the right or behind, flip the sign before anything else - a wrong sign can put the pen past the edge of the plate.'),
        h('li', null, 'The default pen height (Z-Draw ', f(p.zDraw), ', Z-Lift ', f(p.zLift), ') suits the Falu mount with a Stabilo. Only if your pen sticks out much more or less than about ', f(p.zDraw), ' mm below the nozzle, change it in Printer settings → Z heights.'),
        h('li', null, 'For the first runs lower Move speed to 80 mm/s' + (p.purgeChute ? ', remove the top glass if it limits the spring travel, keep the door open,' : ',') + ' and keep a hand near Pause or Stop on the printer screen.'),
        h('li', null, 'Clean any filament off the nozzle tip (the printer homes by touching the plate with it) and tape a sheet of paper over the drawable area (X ', f(R.minX), '-', f(R.maxX), ', Y ', f(R.minY), '-', f(R.maxY), ' mm).')),

      h('h3', null, '1. Empty run: nothing attached (about 3 min)'),
      h('p', null, 'Download ', calLink('Calibrate → Frame', 'frame'), ' with ', h('b', null, 'Dry run'), ' ticked and run it without attaching anything - just press Resume at each pause. Watch where the toolhead goes when it pauses' + (p.purgeChute ? ' (the purge chute at the back left)' : '') + ', how it returns on Resume, and that the end only lowers the bed and moves the toolhead out of the way.'),

      h('h3', null, '2. Frame test with the holder, no pen (about 3 min)'),
      h('p', null, 'Run the same dry-run file again and attach the holder ', h('b', null, 'without a pen'), ' at the first pause. The toolhead traces the outline of the whole drawable area at Z-Lift, then a center cross.'),
      h('ul', { class: 'tips' },
        h('li', null, 'Watch the clearance to the door, the front frame and the left wall along the whole outline. If anything comes close, stop and shrink the nozzle limits in Printer settings → Bed & limits.'),
        h('li', null, 'Watch the toolhead\'s moves at each pause, with the holder on.'),
        h('li', null, 'When it finishes, remove the holder.')),

      h('h3', null, '3. Offset finder (about 5 min)'),
      h('p', null, 'In ', calLink('Calibrate → Offset finder', 'offset'), ', download and run it with a pen:'),
      h('ol', { class: 'tips' },
        h('li', null, h('b', null, 'First pause: attach'), ' the holder with the pen. The pen draws a 16 mm cross with a small circle while the nozzle sits at a known point near the middle of the bed.'),
        h('li', null, h('b', null, 'Second pause: remove'), ' the holder, then press Resume.'),
        h('li', null, h('b', null, 'Measure:'), ' the bare nozzle moves over the same point at Z-Lift and waits 3 minutes. Measure from the nozzle tip to the center of the cross (a square or a ruler held upright helps): to the right of the nozzle is +X, left is -X, towards the back is +Y, towards the front is -Y.')),
      h('p', null, 'Enter the two numbers as Pen offset X / Y in Printer settings → Pen mount and save. For the Falu mount expect about X -28, Y -35.'),
      note('warn', 'Settle the offset before any full-size plot. The safe zone limits the nozzle, so a wrong offset cannot drive the module into the frame - but the drawing lands off by twice the error (about 56 mm for a wrong X sign) and can run past the edge of the plate.'),

      h('h3', null, '4. Frame test with a pen'),
      h('p', null, 'Run ', calLink('Calibrate → Frame', 'frame'), ' again without Dry run. The outline should land on the paper just inside the striped zone on the canvas, and the center cross in the middle of it. This confirms the offsets, the paper position and Z-Draw together. Then raise Move speed back up.'),

      h('h3', null, 'Fine-tuning (only if lines are faint, tear or skip)'),
      h('p', null, 'The defaults usually need no tuning. These tests help after a pen change or if the lines are not right.'),
      h('h3', null, 'Z test: find the pen-down height'),
      h('p', null, 'In ', calLink('Calibrate → Z test', 'compact'), ', download with the default range (Z-Draw - 2 to Z-Draw + 3 in 1 mm steps) and run it with a pen. One cell is drawn per Z value, from the highest Z (lightest pressure) to the lowest, each labeled with its Z; the title is drawn last.'),
      h('ul', { class: 'tips' },
        h('li', null, 'Remember: larger Z = bed further from the nozzle = less pressure.'),
        h('li', null, 'Pick the highest Z that gives a solid, even line and set it as Z-Draw (or 0.5 mm below it for a little more pressure).'),
        h('li', null, 'Stop the print if the pen starts tearing or the module flexes.'),
        h('li', null, 'Nothing drew at all? The pen touches higher than the test range: raise Z-Draw and Z-Lift and run it again - the range always follows the current Z-Draw.'),
        h('li', null, 'For safety the pen never goes more than 4 mm below Z-Draw (and never below half of it), so a test cannot push the pen through the bed.')),

      h('h3', null, 'Z × speed grid'),
      h('p', null, calLink('Calibrate → Z × speed', 'grid'), ' draws the same Z columns at several speeds (rows). Use it to pick the fastest speed that still gives a clean line, then set Draw speed in Plotter settings.'),

      h('h3', null, 'Write down'),
      h('ul', { class: 'tips' },
        h('li', null, 'Pen offset X / Y, and the pen and how far it sticks out.'),
        h('li', null, 'The Z-Draw that works for each pen - set it per layer with the layer\'s settings button when you plot with several pens.'),
        h('li', null, 'Anything unexpected from the empty run and the frame test: where the toolhead goes when paused, re-homing on Resume, close clearances.')),
      note('warn', 'Re-run the Z test whenever you change pens or re-seat a pen in the holder, and the frame test after any change to offsets, nozzle limits or paper position.'),
    ];
  }

  function helpSafety() {
    return [
      h('ul', { class: 'tips' },
        h('li', null, h('b', null, 'Never attach the pen holder before the first pause.'), ' The printer probes the plate with the nozzle while homing.'),
        h('li', null, h('b', null, 'Never start a normal 3D print with the module attached'), ' - it can collide when the printer cuts filament.'),
        h('li', null, 'If the printer has Auto-recovery from step loss, consider turning it off: a re-home in the middle of a plot moves the toolhead to its corner with the holder on.'),
        h('li', null, 'Emergency: press Pause or Stop on the printer screen, or switch the printer off. Don\'t move the toolhead by hand with the holder attached.'),
        h('li', null, 'The nozzle can warm up during pauses (about 90 °C on the X1C). Keep fingers off it while attaching or removing the holder, and make sure the holder does not rest against the hotend - PLA softens around 60 °C.'),
        h('li', null, 'Heaters stay off and the G-code contains no extrusion.'),
        h('li', null, 'Every file is replayed in a G-code simulator before download. It checks the module safe zone, pen heights, travel lifts, pauses and the end of the file, and asks before you download a file that fails.'),
        h('li', null, 'The nozzle safe zone (Printer settings → Bed & limits) keeps the module away from the frame and door. The striped area on the canvas is where the pen cannot go.'),
        h('li', null, 'Do a dry run whenever you change offsets, nozzle limits, paper position or Z heights.'),
        h('li', null, 'Watch the first plots with the door open and a hand near the screen, ready to pause.'),
        h('li', null, 'Keep the module away from the top glass: if the glass limits the spring travel, remove it or use a riser.')),
      h('h3', null, 'Credits'),
      h('p', { class: 'hint' }, 'The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. National Bureau of Standards. The format of the font data was originally created by James Hurt, Cognition, Inc. SVG font versions by Windell H. Oskay (Evil Mad Scientist); font packaging from the hersheytext project. Uploaded fonts are parsed with opentype.js.'),
    ];
  }

  function helpShortcuts() {
    return [h('div', { class: 'kv' },
      kv('Select / Pan', 'V / H (or hold Space)'), kv('Pen / Line / Polyline / Curve', 'P / L / Y / C'), kv('Rect / Ellipse / Polygon / Star', 'R / E / G / S'),
      kv('Text / Eraser', 'T / X'), kv('Undo / Redo', 'Ctrl+Z / Ctrl+Shift+Z'), kv('Duplicate / Copy / Paste', 'Ctrl+D / C / V'),
      kv('Delete', 'Del'), kv('Nudge', 'Arrows (Shift 10 mm, Alt 0.1 mm)'), kv('Zoom / Fit', 'Scroll, + / -, 0'),
      kv('Save / Open', 'Ctrl+S / Ctrl+O'), kv('Download G-code', 'Ctrl+E'), kv('Preview play/pause', 'Space'),
      kv('Scale freely / snap rotation', 'Shift while dragging a handle'))];
  }

  /** tab: 'start' | 'calibration' | 'safety' | 'shortcuts' */
  UI.openHelp = function (tab = 'start') {
    const t = tabs([
      ['start', 'Getting started', helpStart],
      ['calibration', 'Calibration', helpCalibration],
      ['safety', 'Safety', helpSafety],
      ['shortcuts', 'Shortcuts', helpShortcuts],
    ], tab);
    const body = h('div', { class: 'help' }, t.el);
    UI.modal({ title: 'Help', body, width: 'min(880px, calc(100vw - 32px))', footer: [h('span', { class: 'hspacer' }), UI.btn('Open Calibrate', () => { while (UI.closeTopModal()); UI.openCalibration(); }, { icon: 'target' }), UI.btn('Done', () => UI.closeTopModal(), { primary: true })] });
  };
})(window.PP = window.PP || {});
