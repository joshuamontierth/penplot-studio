/*
 * PenPlot Studio - printer profiles, G-code generation and calibration patterns.
 *
 * Coordinate model
 *   Designs live in PEN coordinates: where the pen tip should touch the bed (mm,
 *   origin = front-left corner of the plate, +X right, +Y towards the back).
 *   The printer moves the NOZZLE, and the pen is mounted at a fixed offset from it:
 *       pen = nozzle + offset   =>   nozzle = pen - offset
 *   For the Falu mount (UMTS / "Head Mount V1 - Series X & P") on an X1C the pen
 *   sits in FRONT of the nozzle and to its LEFT: offset = (-28, -35). This matches
 *   the designer's notes (collision zone on the front/left, paper 29 mm in from the
 *   right edge) - verify it with the Offset finder calibration.
 *
 *   Safe zone: with the module attached the nozzle must stay out of the designer's
 *   excluded L-shaped area (front 55 mm and left 48 mm), otherwise the module can
 *   hit the frame or the door. The nozzle limits below encode that.
 *
 *   Z is the nozzle height above the bed. Z-Draw is the height where the pen tip
 *   touches the paper, Z-Lift is the height used for travel moves.
 */
(function (PP) {
  'use strict';

  const U = PP.U, G = PP.Geo, O = PP.Optimizer;
  const APP = 'PenPlot Studio';
  const VERSION = '1.0.0';

  // Pause warm-up (see pauseTemp in BAMBU_BASE): the X1/P1 presets use PAUSE_TEMP, no profile may exceed MAX
  const PAUSE_TEMP = 90, MAX_PAUSE_TEMP = 90;

  const BAMBU_BASE = {
    firmware: 'bambu',
    bedWidth: 256, bedDepth: 256,
    // Falu's excluded area (0,0 258,0 258,55 48,55 48,258 0,258) -> nozzle safe zone
    nozzleMinX: 48, nozzleMaxX: 256, nozzleMinY: 55, nozzleMaxY: 256,
    penOffsetX: -28, penOffsetY: -35,
    margin: 1,
    zDraw: 14, zLift: 20, zAttach: 60, zEnd: 80, zMax: 250,
    drawSpeed: 30, travelSpeed: 200, zSpeed: 15, accel: 4000,
    // Drag-knife cutting (docs/cutting.md). build() does not use these yet; the Cut job dialog reports with them.
    knifeSameAsPen: true, knifeOffsetX: -28, knifeOffsetY: -35, // holder axis relative to the nozzle
    bladeOffset: 0.25, // how far the blade tip trails the holder axis (about 0.25 mm for 45° Roland-type blades)
    zCut: 14, cutSpeed: 20, overcut: 1, swivelAngle: 30, cutPasses: 1,
    penDownDelay: 50, penUpDelay: 0,
    home: true,
    safeStart: true,
    pauseForAttach: true,
    pauseCommand: 'M400 U1',
    // The firmware moves the toolhead to the purge chute (back-left) during every M400 U1 pause and back on
    // resume, so park close to it: the move it makes with the holder attached stays short.
    parkX: 80, parkY: 245,
    // no end pause (user's choice after the first dry run): the job ends with the bed lowered and the toolhead
    // at the back, and nothing runs after a plain file's last line - remove the holder then
    endPause: false,
    endX: 152, endY: 250,
    layerPause: true,
    progress: true,
    heatersOff: true,
    // X1/P1: M400 U1 pauses park the toolhead at the purge chute (confirmed on an X1C); used for the instructions
    purgeChute: true,
    // Nozzle temperature held through each pause (0 = heater off). The X1/P1 firmware warms the nozzle while paused
    // and on Resume waits for the temperature saved before the pause: a target of 0, which a warm nozzle never
    // reaches, cost 72 s per Resume on an X1C; warming to 90 C before the pause brought it to 4 s (HANDOFF A14).
    pauseTemp: 0,
    // labels: short printer name for the welcome design, and whether the front has a door (canvas orientation label)
    shortName: '',
    door: false,
    // which bundled pen mount attachment fits ('x1p1' or 'a1'; '' = offer X1/P1 first)
    holder: '',
    startGcode: '',
    endGcode: '',
  };

  const FALU_MOUNT = 'Falu UMTS / "Head Mount V1 - Series X & P" (pen about 28 mm left of and 35 mm in front of the nozzle - confirm with the Offset finder)';

  const A1_MOUNT = 'A1 pen holder (3dplotter.xyz: pen about 28 mm in front of the nozzle - confirm with the Offset finder)';

  const BUILTIN_PROFILES = [
    Object.assign({}, BAMBU_BASE, { id: 'bambu-x1c', name: 'Bambu Lab X1 Carbon', shortName: 'X1C', door: true, holder: 'x1p1', pauseTemp: PAUSE_TEMP, builtin: true, mount: FALU_MOUNT }),
    Object.assign({}, BAMBU_BASE, { id: 'bambu-x1e', name: 'Bambu Lab X1 / X1E', shortName: 'X1', door: true, holder: 'x1p1', pauseTemp: PAUSE_TEMP, builtin: true, mount: FALU_MOUNT }),
    Object.assign({}, BAMBU_BASE, { id: 'bambu-p1s', name: 'Bambu Lab P1S / P1P', shortName: 'P1S', door: true, holder: 'x1p1', pauseTemp: PAUSE_TEMP, builtin: true, mount: FALU_MOUNT }),
    // A1: open bed-slinger (the bed moves in Y, the toolhead in X and Z). No door or enclosure walls for the holder
    // to hit, so the whole bed is the nozzle's safe zone; the pen sits in front of the nozzle, which leaves a
    // 256 x 228 mm plot area (3dplotter.xyz). No purge chute, and no X1/P1 G380 start preamble.
    Object.assign({}, BAMBU_BASE, {
      id: 'bambu-a1', name: 'Bambu Lab A1', shortName: 'A1', holder: 'a1', builtin: true, mount: A1_MOUNT,
      nozzleMinX: 0, nozzleMaxX: 256, nozzleMinY: 0, nozzleMaxY: 256,
      penOffsetX: 0, penOffsetY: -28, knifeOffsetX: 0, knifeOffsetY: -28,
      safeStart: false, purgeChute: false,
      parkX: 128, parkY: 128, endX: 128, endY: 220,
    }),
    Object.assign({}, BAMBU_BASE, {
      id: 'custom', name: 'Custom Board (Marlin)', shortName: 'plotter', builtin: true, firmware: 'marlin',
      mount: 'Generic pen holder - measure and enter your own offsets',
      penOffsetX: 0, penOffsetY: 0, knifeOffsetX: 0, knifeOffsetY: 0, zDraw: 2, zCut: 2, zLift: 6, zAttach: 30, zEnd: 40,
      pauseCommand: 'M0 Attach pen and click to resume', parkX: 110, parkY: 20, endX: 110, endY: 200,
      bedWidth: 220, bedDepth: 220, nozzleMinX: 0, nozzleMinY: 0, nozzleMaxX: 220, nozzleMaxY: 220, travelSpeed: 120, accel: 1500,
      safeStart: false, endPause: false, purgeChute: false,
    }),
  ];

  const FIELD_DEFAULTS = Object.assign({}, BAMBU_BASE);

  /** Pause warm-up temperature: the profile's, clamped to [0, MAX_PAUSE_TEMP]. */
  function pauseTemp(p) {
    return U.clamp(Math.round(p.pauseTemp || 0), 0, MAX_PAUSE_TEMP);
  }
  // Around each pause: warm the nozzle first (waits, toolhead parked), and switch the heater off right after
  // Resume, before anything moves. The simulator rejects any other heater use.
  function warmForPause(L, p) {
    const t = pauseTemp(p);
    if (t > 0) L('M109 S' + t + ' ; warm the nozzle to ' + t + ' C first, so Resume does not wait for it to cool');
  }
  function coolAfterPause(L, p) {
    if (pauseTemp(p) > 0) L('M104 S0 ; heater off again before anything moves');
  }

  function normalizeProfile(p) {
    const out = Object.assign({}, FIELD_DEFAULTS, p || {});
    for (const k in FIELD_DEFAULTS) {
      if (typeof FIELD_DEFAULTS[k] === 'number') {
        const v = parseFloat(out[k]);
        out[k] = isFinite(v) ? v : FIELD_DEFAULTS[k];
      }
    }
    out.pauseTemp = pauseTemp(out);
    return out;
  }

  /** Rectangle (pen coordinates) the pen can safely reach. */
  function reachableRect(p) {
    const m = Math.max(0, p.margin || 0);
    return {
      minX: Math.max(0, p.nozzleMinX + p.penOffsetX) + m,
      maxX: Math.min(p.bedWidth, p.nozzleMaxX + p.penOffsetX) - m,
      minY: Math.max(0, p.nozzleMinY + p.penOffsetY) + m,
      maxY: Math.min(p.bedDepth, p.nozzleMaxY + p.penOffsetY) - m,
    };
  }

  function validateProfile(p) {
    const errs = [];
    const r = reachableRect(p);
    if (!(p.nozzleMinX >= 0 && p.nozzleMinY >= 0 && p.nozzleMaxX <= p.bedWidth && p.nozzleMaxY <= p.bedDepth)) errs.push('The nozzle limits must stay on the bed (X 0-' + p.bedWidth + ', Y 0-' + p.bedDepth + ' mm).');
    if (r.maxX - r.minX < 10 || r.maxY - r.minY < 10) errs.push('The reachable drawing area is smaller than 10 mm - check bed size, nozzle limits and pen offsets.');
    if (!(p.zLift - p.zDraw >= 1)) errs.push('Z-Lift must be at least 1 mm above Z-Draw (larger Z = bed further from the nozzle), otherwise the pen drags during travel.');
    if (p.zDraw < 0.2) errs.push('Z-Draw must be at least 0.2 mm.');
    if (p.zAttach < p.zLift) errs.push('Attach height should be at least the Z-Lift height.');
    if (p.zAttach > p.zMax || p.zEnd > p.zMax || p.zLift > p.zMax) errs.push('A Z height is above the maximum Z (' + p.zMax + ' mm).');
    if (!(p.drawSpeed > 0) || !(p.travelSpeed > 0) || !(p.zSpeed > 0)) errs.push('Speeds must be greater than 0.');
    const inNozzle = (x, y) => x >= p.nozzleMinX && x <= p.nozzleMaxX && y >= p.nozzleMinY && y <= p.nozzleMaxY;
    if (!inNozzle(p.parkX, p.parkY)) errs.push('Park position is outside the nozzle travel limits / safe zone.');
    if (!inNozzle(p.endX, p.endY)) errs.push('End position is outside the nozzle travel limits / safe zone.');
    const onPlate = (x, y) => x >= 0 && x <= p.bedWidth && y >= 0 && y <= p.bedDepth;
    if (!onPlate(p.parkX + p.penOffsetX, p.parkY + p.penOffsetY)) errs.push('At the park position the pen would be outside the plate - move the park position.');
    if (!p.endPause && !onPlate(p.endX + p.penOffsetX, p.endY + p.penOffsetY)) errs.push('At the end position the pen would be outside the plate - move the end position or enable the end pause.');
    return errs;
  }

  /** Lowest allowed pen-down height: at most 4 mm past contact, never below half the contact height or 0.5 mm. */
  function minSafeDrawZ(p) {
    return Math.max(p.zDraw - 4, p.zDraw * 0.5, 0.5);
  }

  /** Clamp a pen-down height into the safe window [minSafeDrawZ, zLift - 0.5]. */
  function safeDrawZ(p, z) {
    return U.clamp(z, minSafeDrawZ(p), p.zLift - 0.5);
  }

  /** Text for a G-code comment: one line, so names can never inject commands. */
  const c1 = (v) => String(v).replace(/[\r\n]+/g, ' ');

  function bambuSafeStart(L) {
    // From Bambu's official X1 start G-code: drop the bed a little (probing moves
    // that stop on contact) so the nozzle can never be below the plate during homing.
    L('G91');
    L('M17 Z0.4 ; lower the Z motor current');
    L('G380 S2 Z30 F300 ; lower the bed (stops on contact)');
    L('G380 S2 Z-25 F300');
    L('G1 Z5 F300');
    L('G90');
    L('M17 X1.2 Y1.2 Z0.75 ; restore motor currents');
  }

  // ---------------------------------------------------------------------------
  // G-code writer
  // ---------------------------------------------------------------------------
  /**
   * jobs: [{ name, color, polys (ordered, pen coords, clipped), zDraw?, drawSpeed?, pauseBefore?, pauseMessage? }]
   * opts: { dryRun, title, date }
   * Returns { text, stats, warnings }
   */
  function build(jobs, profileIn, opts = {}) {
    const p = normalizeProfile(profileIn);
    const f = (v) => U.fmt(v, 3);
    const warnings = [];
    const lines = [];
    const L = (s) => lines.push(s);
    const zF = Math.round(p.zSpeed * 60);
    const travelF = Math.round(p.travelSpeed * 60);
    const isBambu = p.firmware === 'bambu';
    const dry = !!opts.dryRun;
    // Bambu firmware: M400 P<ms> is the dwell used in Bambu's own G-code; Marlin: G4 P<ms>
    const dwell = (ms) => (isBambu ? 'M400 P' : 'G4 P') + Math.round(ms);

    // Pen-down height per job, clamped into the safe window
    const jobZ = jobs.map(j => {
      if (dry) return p.zLift;
      const want = U.isNum(j.zDraw) ? j.zDraw : p.zDraw;
      const z = safeDrawZ(p, want);
      if (Math.abs(z - want) > 1e-9) warnings.push('Layer "' + (j.name || '?') + '": Z-Draw ' + U.fmt(want, 2) + ' was clamped to ' + U.fmt(z, 2) + ' (allowed ' + U.fmt(minSafeDrawZ(p), 2) + '..' + U.fmt(p.zLift - 0.5, 2) + ').');
      return z;
    });

    // Time estimate per job
    let startPt = { x: p.parkX + p.penOffsetX, y: p.parkY + p.penOffsetY };
    let totalTime = 0, drawLen = 0, travelLen = 0, lifts = 0;
    const jobEst = jobs.map((j, ji) => {
      const zd = jobZ[ji];
      const est = O.estimate(j.polys, startPt, Object.assign({}, p, { drawSpeed: j.drawSpeed || p.drawSpeed, zDraw: zd }));
      if (j.polys.length) { const last = j.polys[j.polys.length - 1]; startPt = { x: last[last.length - 2], y: last[last.length - 1] }; }
      totalTime += est.time; drawLen += est.drawLen; travelLen += est.travelLen; lifts += est.lifts;
      return est;
    });
    const overhead = (p.home ? 35 : 0) + 10;
    const grand = totalTime + overhead;

    // --- header
    const date = opts.date || new Date();
    L('; HEADER_BLOCK_START');
    L('; ' + APP + ' ' + VERSION);
    L('; model printing time: ' + fmtHMS(totalTime) + '; total estimated time: ' + fmtHMS(grand));
    L('; total layer number: ' + Math.max(1, jobs.length));
    L('; HEADER_BLOCK_END');
    L('; ' + '='.repeat(60));
    L('; ' + APP + ' ' + VERSION + ' - pen plotter G-code');
    L('; Generated: ' + date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC');
    if (opts.title) L('; Design: ' + c1(opts.title));
    L('; Printer profile: ' + c1(p.name));
    if (p.mount) L('; Pen mount: ' + c1(p.mount));
    L('; Pen offset from nozzle: X' + (p.penOffsetX >= 0 ? '+' : '') + f(p.penOffsetX) + ' Y' + (p.penOffsetY >= 0 ? '+' : '') + f(p.penOffsetY) + ' mm');
    L('; Z-Draw: ' + f(p.zDraw) + ' mm   Z-Lift: ' + f(p.zLift) + ' mm   Attach height: ' + f(p.zAttach) + ' mm');
    L('; Draw speed: ' + f(p.drawSpeed) + ' mm/s   Travel: ' + f(p.travelSpeed) + ' mm/s   Z: ' + f(p.zSpeed) + ' mm/s   Accel: ' + f(p.accel) + ' mm/s^2');
    L('; Layers: ' + jobs.length + '   Pen-down paths: ' + lifts + '   Draw length: ' + U.formatLength(drawLen) + '   Travel: ' + U.formatLength(travelLen));
    L('; Estimated plotting time: ' + U.formatDuration(grand) + ' (excluding pauses)');
    if (dry) L('; *** DRY RUN: the pen never goes below Z-Lift - nothing will be drawn ***');
    L('; Coordinates below are NOZZLE coordinates (pen position minus pen offset).');
    L('; ' + '='.repeat(60));
    L('');

    // --- progress tracking
    let elapsed = overhead;
    let lastPct = -1;
    const progress = (force) => {
      if (!p.progress) return;
      const pct = Math.min(100, Math.max(0, Math.floor(elapsed / grand * 100)));
      if (pct !== lastPct || force) {
        lastPct = pct;
        L('M73 P' + pct + ' R' + Math.max(0, Math.round((grand - elapsed) / 60)));
      }
    };

    // --- start
    L('; ===== Start =====');
    if (p.progress) L('M73 P0 R' + Math.round(grand / 60));
    L('G90 ; absolute coordinates');
    L('G21 ; millimetres');
    L('M83 ; relative extrusion (no extrusion is used)');
    if (p.heatersOff) {
      L('M104 S0 ; hotend heater off - pen plotting needs no heat');
      L('M140 S0 ; bed heater off');
    }
    if (isBambu) {
      L('M106 S0 ; part cooling fan off');
      L('M106 P2 S0 ; aux fan off');
      L('M106 P3 S0 ; chamber fan off');
    } else {
      L('M107 ; fan off');
    }
    L('M220 S100 ; speed factor 100%');
    if (p.accel > 0) L('M204 S' + Math.round(p.accel) + ' ; acceleration');
    if (p.startGcode && p.startGcode.trim()) { L('; --- custom start G-code ---'); L(p.startGcode.trim()); L('; --- end custom start G-code ---'); }
    if (isBambu && p.safeStart) bambuSafeStart(L);
    if (p.home) L('G28 ; home all axes' + (p.pauseForAttach ? ' - the pen holder must NOT be attached yet' : ''));
    L('G90');
    L('G1 Z' + f(p.zAttach) + ' F' + zF + ' ; lower the bed for pen clearance');
    L('G1 X' + f(p.parkX) + ' Y' + f(p.parkY) + ' F' + travelF + ' ; park toolhead');
    L('M400 ; wait for moves to finish');
    if (p.pauseForAttach) {
      warmForPause(L, p);
      L('; ' + '*'.repeat(58));
      L('; PAUSE: attach the pen holder now, check the pen height,');
      L(';        then press RESUME on the printer screen.');
      L('; ' + '*'.repeat(58));
      L('; PP_PAUSE attach');
      L(p.pauseCommand || 'M400 U1');
      L('G90 ; re-assert absolute mode after resume');
      coolAfterPause(L, p);
    }
    L('G1 Z' + f(p.zLift) + ' F' + zF + ' ; pen up (travel height)');
    L('');

    // --- body
    const nx = (x) => x - p.penOffsetX;
    const ny = (y) => y - p.penOffsetY;
    let clampCount = 0;
    const clampX = (x) => { if (x < p.nozzleMinX - 1e-6 || x > p.nozzleMaxX + 1e-6) { clampCount++; return U.clamp(x, p.nozzleMinX, p.nozzleMaxX); } return x; };
    const clampY = (y) => { if (y < p.nozzleMinY - 1e-6 || y > p.nozzleMaxY + 1e-6) { clampCount++; return U.clamp(y, p.nozzleMinY, p.nozzleMaxY); } return y; };

    jobs.forEach((j, ji) => {
      const zd = jobZ[ji];
      const drawF = Math.round((j.drawSpeed || p.drawSpeed) * 60);
      const est = jobEst[ji];
      const pauseHere = j.pauseBefore !== undefined ? j.pauseBefore : (ji > 0 && p.layerPause && jobs.length > 1);
      L('; ===== Layer ' + (ji + 1) + '/' + jobs.length + ': ' + c1(j.name || 'Layer') + (j.color ? ' (' + c1(j.color) + ')' : '') + ' =====');
      if (j.comment) L('; ' + c1(j.comment));
      if (pauseHere) {
        L('G1 Z' + f(p.zAttach) + ' F' + zF + ' ; lower the bed for pen change');
        L('G1 X' + f(p.parkX) + ' Y' + f(p.parkY) + ' F' + travelF + ' ; park toolhead');
        L('M400');
        warmForPause(L, p);
        L('; PAUSE: ' + c1(j.pauseMessage || ('change to the pen for layer "' + (j.name || ji + 1) + '"')) + ', then press RESUME');
        L('; PP_PAUSE swap');
        L(p.pauseCommand || 'M400 U1');
        L('G90');
        coolAfterPause(L, p);
        L('G1 Z' + f(p.zLift) + ' F' + zF + ' ; pen up');
      }
      let prevT = 0;
      j.polys.forEach((poly, pi) => {
        if (poly.length < 4) return;
        let lx = f(clampX(nx(poly[0]))), ly = f(clampY(ny(poly[1])));
        L('G1 X' + lx + ' Y' + ly + ' F' + travelF);
        L('G1 Z' + f(zd) + ' F' + zF + ' ; pen down');
        if (p.penDownDelay > 0) L(dwell(p.penDownDelay));
        let first = true;
        for (let k = 2; k < poly.length; k += 2) {
          // skip points that round to the same G-code coordinates as the previous move
          const sx = f(clampX(nx(poly[k]))), sy = f(clampY(ny(poly[k + 1])));
          if (sx === lx && sy === ly) continue;
          L('G1 X' + sx + ' Y' + sy + (first ? ' F' + drawF : ''));
          first = false;
          lx = sx; ly = sy;
        }
        if (p.penUpDelay > 0) L(dwell(p.penUpDelay));
        L('G1 Z' + f(p.zLift) + ' F' + zF + ' ; pen up');
        const t = est.cumulative[pi];
        elapsed += t - prevT;
        prevT = t;
        progress(false);
      });
      L('');
    });

    // --- end
    L('; ===== End =====');
    L('G1 Z' + f(Math.max(p.zLift, p.zEnd, p.endPause ? p.zAttach : 0)) + ' F' + zF + ' ; lower the bed away from the pen');
    if (p.endPause) {
      L('G1 X' + f(p.parkX) + ' Y' + f(p.parkY) + ' F' + travelF + ' ; park toolhead');
      L('M400');
      warmForPause(L, p);
      L('; PAUSE: remove the pen holder now, then press RESUME to finish');
      L('; PP_PAUSE remove');
      L(p.pauseCommand || 'M400 U1');
      L('G90');
      coolAfterPause(L, p);
    }
    L('G1 X' + f(p.endX) + ' Y' + f(p.endY) + ' F' + travelF + ' ; move toolhead out of the way');
    L('M400');
    if (p.endGcode && p.endGcode.trim()) { L('; --- custom end G-code ---'); L(p.endGcode.trim()); L('; --- end custom end G-code ---'); }
    if (p.progress) L('M73 P100 R0');
    L('; Done - remove the pen holder before your next 3D print.');
    L('');

    if (clampCount) warnings.push(clampCount + ' coordinates were outside the nozzle limits and were clamped.');
    return {
      text: lines.join('\n'),
      stats: { time: grand, drawLen, travelLen, lifts, lines: lines.length, layers: jobs.length },
      warnings,
    };
  }

  function fmtHMS(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + 'h ' : '') + (h || m ? m + 'm ' : '') + s + 's';
  }

  // ---------------------------------------------------------------------------
  // Calibration patterns
  // ---------------------------------------------------------------------------
  function textPolys(str, size, x, y, align = 'left') {
    const r = PP.Fonts.layout(str, PP.Fonts.DEFAULT, { size, align: 'left' });
    if (!r.ready) return [];
    const b = G.bbox(r.polys);
    if (!b) return [];
    let dx = x - b.minX;
    if (align === 'center') dx = x - (b.minX + b.maxX) / 2;
    return G.translate(r.polys, dx, y);
  }

  function cellPattern(x, y, s) {
    const polys = [];
    polys.push([x, y, x + s, y, x + s, y + s, x, y + s, x, y]);
    const c = s / 2;
    const circ = G.ellipse(s * 0.28, s * 0.28);
    polys.push(G.translate([circ], x + c, y + c)[0]);
    polys.push([x + s * 0.12, y + s * 0.12, x + s * 0.88, y + s * 0.88]);
    // zig-zag along the bottom
    const zz = [];
    const n = 8;
    for (let i = 0; i <= n; i++) zz.push(x + s * 0.1 + (s * 0.8) * i / n, y + s * (i % 2 ? 0.2 : 0.06));
    polys.push(zz);
    return polys;
  }

  /**
   * Build calibration jobs.
   * opts: { type: 'grid'|'compact'|'frame', zValues: [...], speeds: [...], cell, gap }
   * Returns { jobs, legend: [strings], bbox }
   */
  function calibrationJobs(profileIn, opts = {}) {
    const p = normalizeProfile(profileIn);
    const R = reachableRect(p);
    const jobs = [];
    const legend = [];
    if (opts.type === 'frame') {
      const inset = 2;
      const r = { minX: R.minX + inset, minY: R.minY + inset, maxX: R.maxX - inset, maxY: R.maxY - inset };
      const polys = [[r.minX, r.minY, r.maxX, r.minY, r.maxX, r.maxY, r.minX, r.maxY, r.minX, r.minY]];
      const cx = (r.minX + r.maxX) / 2, cy = (r.minY + r.maxY) / 2;
      polys.push([cx - 10, cy, cx + 10, cy], [cx, cy - 10, cx, cy + 10]);
      polys.push(G.translate([G.ellipse(5, 5)], cx, cy)[0]);
      const t = textPolys('FRONT', 5, cx, r.minY + 4, 'center');
      for (const q of t) polys.push(q);
      const t2 = textPolys(U.fmt(r.maxX - r.minX, 1) + ' x ' + U.fmt(r.maxY - r.minY, 1) + ' mm', 4, cx, cy - 20, 'center');
      for (const q of t2) polys.push(q);
      jobs.push({ name: 'Frame test', polys, pauseBefore: false });
      legend.push('Draws the outline of the full reachable area (inset 2 mm), a center cross and the area size.');
      legend.push('Run it as a dry run first (holder attached, no pen) to check the clearances. Once the offset finder has confirmed your offsets, run it with a pen: the outline should land just inside the striped zone.');
      return { jobs, legend, rect: r };
    }

    const zsRaw = (opts.zValues && opts.zValues.length) ? opts.zValues.slice() : [p.zDraw];
    const zs = Array.from(new Set(zsRaw.filter(U.isNum).map(z => U.round(safeDrawZ(p, z), 3)))).sort((a, b) => a - b);
    if (zs.length < zsRaw.length) legend.push('Some Z values were outside the safe range ' + U.fmt(p.zDraw - 4, 2) + '..' + U.fmt(p.zLift - 0.5, 2) + ' and were clamped.');
    const speeds = opts.type === 'compact' ? [p.drawSpeed] : ((opts.speeds && opts.speeds.length) ? opts.speeds.slice() : [p.drawSpeed]);
    const s = opts.cell || 16;
    const gap = opts.gap || 8;
    const labelH = 7;
    const colW = s + gap;
    const rowH = s + labelH + 4;
    const totalW = zs.length * colW - gap;
    const totalH = speeds.length * rowH + 8;
    const x0 = (R.minX + R.maxX) / 2 - totalW / 2;
    const y0 = (R.minY + R.maxY) / 2 + totalH / 2 - 8;
    if (totalW > R.maxX - R.minX || totalH > R.maxY - R.minY) {
      throw new Error('The calibration grid (' + Math.round(totalW) + ' x ' + Math.round(totalH) + ' mm) does not fit the reachable area. Use fewer Z values or speeds, or a smaller cell.');
    }
    // Draw lightest pressure (highest Z) first
    const order = zs.map((z, i) => ({ z, i })).sort((a, b) => b.z - a.z);
    for (const { z, i } of order) {
      speeds.forEach((sp, r) => {
        const x = x0 + i * colW;
        const y = y0 - (r + 1) * rowH;
        const polys = cellPattern(x, y + labelH, s);
        const lbl = textPolys('Z' + U.fmt(z, 2), 2.6, x + s / 2, y + 3.4, 'center');
        const lbl2 = textPolys(U.fmt(sp, 0) + 'mm/s', 2.0, x + s / 2, y + 0.2, 'center');
        const all = polys.concat(lbl, lbl2);
        jobs.push({ name: 'Z' + U.fmt(z, 2) + ' @ ' + U.fmt(sp, 0) + ' mm/s', polys: O.order(all, null, { joinTol: 0.05 }), zDraw: z, drawSpeed: sp, pauseBefore: false });
      });
    }
    // Title last, at the profile Z-Draw: if that height is wrong, the cells above have already shown it
    const title = textPolys(opts.type === 'compact' ? 'Z-DRAW TEST' : 'Z-DRAW x SPEED TEST', 4, (R.minX + R.maxX) / 2, y0 + 4, 'center');
    jobs.push({ name: 'Title', polys: O.order(title, null, { joinTol: 0.05 }), pauseBefore: false, comment: 'Title drawn at the profile Z-Draw' });
    legend.push('Columns (left to right): Z-Draw = ' + zs.map(z => U.fmt(z, 2)).join(', ') + ' mm');
    if (speeds.length > 1) legend.push('Rows (top to bottom): speed = ' + speeds.map(v => U.fmt(v, 0)).join(', ') + ' mm/s');
    legend.push('Cells are drawn from the highest Z (lightest pressure) to the lowest. Stop the print if the pen starts tearing the paper.');
    legend.push('Pick the highest Z that gives a solid, even line - lower Z = more pen pressure.');
    return { jobs, legend };
  }

  /**
   * Offset finder: the pen draws a cross while the nozzle is at a known spot, then
   * (after you remove the pen holder) the bare nozzle is parked 3 mm above the same
   * spot so you can measure how far the cross is from the nozzle tip.
   * Works whatever the current offset setting is (only nozzle coordinates are used).
   */
  const MEASURE_S = 180; // offset finder: seconds the bare nozzle waits over the cross

  function offsetFinder(profileIn) {
    const p = normalizeProfile(profileIn);
    const f = (v) => U.fmt(v, 3);
    const isBambu = p.firmware === 'bambu';
    const zF = Math.round(p.zSpeed * 60), travelF = Math.round(p.travelSpeed * 60), drawF = Math.round(Math.min(p.drawSpeed, 20) * 60);
    const nx = U.clamp((p.nozzleMinX + p.nozzleMaxX) / 2, p.nozzleMinX + 12, p.nozzleMaxX - 12);
    const ny = U.clamp((p.nozzleMinY + p.nozzleMaxY) / 2, p.nozzleMinY + 12, p.nozzleMaxY - 12);
    const pause = p.pauseCommand || 'M400 U1';
    const out = [];
    const L = (s) => out.push(s);
    L('; ' + APP + ' ' + VERSION + ' - OFFSET FINDER');
    L('; Printer profile: ' + c1(p.name));
    L('; The pen draws a cross + circle while the NOZZLE is at X' + f(nx) + ' Y' + f(ny) + '.');
    L('; Then you remove the pen holder, and the bare nozzle waits ' + MEASURE_S + ' s at Z-Lift over that same point.');
    L('; Measure from the nozzle tip to the center of the cross:');
    L(';   pen offset X = +distance if the cross is to the RIGHT of the nozzle, - if LEFT');
    L(';   pen offset Y = +distance if the cross is BEHIND the nozzle, - if IN FRONT');
    L('G90');
    L('G21');
    L('M83');
    L('M104 S0');
    L('M140 S0');
    if (isBambu) { L('M106 S0'); L('M106 P2 S0'); L('M106 P3 S0'); } else L('M107');
    L('M220 S100');
    if (p.accel > 0) L('M204 S' + Math.round(p.accel));
    if (isBambu && p.safeStart) bambuSafeStart(L);
    L('G28 ; home - pen holder NOT attached');
    L('G90');
    L('G1 Z' + f(p.zAttach) + ' F' + zF);
    L('G1 X' + f(p.parkX) + ' Y' + f(p.parkY) + ' F' + travelF);
    L('M400');
    warmForPause(L, p);
    L('; PAUSE: attach the pen holder with the pen, then press RESUME');
    L('; PP_PAUSE attach');
    L(pause);
    L('G90');
    coolAfterPause(L, p);
    L('G1 Z' + f(p.zLift) + ' F' + zF + ' ; pen up');
    const seg = (x0, y0, x1, y1) => {
      L('G1 X' + f(x0) + ' Y' + f(y0) + ' F' + travelF);
      L('G1 Z' + f(p.zDraw) + ' F' + zF + ' ; pen down');
      if (p.penDownDelay > 0) L((isBambu ? 'M400 P' : 'G4 P') + Math.round(p.penDownDelay));
      L('G1 X' + f(x1) + ' Y' + f(y1) + ' F' + drawF);
      L('G1 Z' + f(p.zLift) + ' F' + zF + ' ; pen up');
    };
    seg(nx - 8, ny, nx + 8, ny);
    seg(nx, ny - 8, nx, ny + 8);
    // circle r = 4 around the cross
    L('G1 X' + f(nx + 4) + ' Y' + f(ny) + ' F' + travelF);
    L('G1 Z' + f(p.zDraw) + ' F' + zF + ' ; pen down');
    for (let i = 1; i <= 36; i++) {
      const a = i / 36 * Math.PI * 2;
      L('G1 X' + f(nx + Math.cos(a) * 4) + ' Y' + f(ny + Math.sin(a) * 4) + (i === 1 ? ' F' + drawF : ''));
    }
    L('G1 Z' + f(p.zLift) + ' F' + zF + ' ; pen up');
    L('G1 Z' + f(p.zAttach) + ' F' + zF);
    L('G1 X' + f(p.parkX) + ' Y' + f(p.parkY) + ' F' + travelF);
    L('M400');
    warmForPause(L, p);
    L('; PAUSE: remove the pen holder now (keep the paper in place), then press RESUME');
    L('; PP_PAUSE remove');
    L(pause);
    L('G90');
    coolAfterPause(L, p);
    // A timed wait, not a pause: the firmware moves the toolhead to the purge chute while paused. Z-Lift is
    // safe even if the holder was left on (the pen tip is then above the paper, as for any travel move).
    L('G1 X' + f(nx) + ' Y' + f(ny) + ' F' + travelF + ' ; bare nozzle over the reference point');
    L('G1 Z' + f(p.zLift) + ' F' + zF + ' ; nozzle at Z-Lift');
    L('M400');
    L('; MEASURE NOW: nozzle tip to the center of the cross (' + MEASURE_S + ' s)');
    L((isBambu ? 'M400 S' : 'G4 S') + MEASURE_S);
    L('G1 Z' + f(Math.max(p.zLift, p.zEnd)) + ' F' + zF);
    L('G1 X' + f(p.endX) + ' Y' + f(p.endY) + ' F' + travelF);
    L('M400');
    L('');
    return {
      text: out.join('\n'),
      nozzle: { x: nx, y: ny },
      legend: [
        'The pen draws a 16 mm cross with a small circle while the nozzle sits at X' + U.fmt(nx, 1) + ' Y' + U.fmt(ny, 1) + '.',
        'At the second pause, remove the pen holder. After Resume the bare nozzle moves over the same point at Z-Lift (' + U.fmt(p.zLift, 1) + ' mm) and waits ' + Math.round(MEASURE_S / 60) + ' minutes.',
        'During that wait, measure from the nozzle tip to the center of the cross (a square or a ruler held upright helps): right of the nozzle = +X, left = -X, behind (toward the back) = +Y, in front = -Y.',
        'Enter those numbers as Pen offset X / Y in Printer settings. Expected for the Falu mount: about X -28, Y -35.',
      ],
    };
  }

  PP.GCode = {
    APP, VERSION,
    MAX_PAUSE_TEMP,
    offsetFinder,
    safeDrawZ,
    minSafeDrawZ,
    BUILTIN_PROFILES,
    FIELD_DEFAULTS,
    normalizeProfile,
    reachableRect,
    validateProfile,
    build,
    calibrationJobs,
  };
})(window.PP = window.PP || {});
