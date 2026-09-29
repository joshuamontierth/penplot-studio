/*
 * PenPlot Studio - G-code simulator / safety checker.
 *
 * Replays a G-code file on a virtual printer (nozzle position, bed height, feed
 * rate, pen holder attached or not) and reports anything that could crash the
 * machine or ruin a plot:
 *   - moves outside the nozzle safe zone / travel limits, or outside the Z range
 *   - XY moves with the nozzle on the bed, diagonal pen moves (XY + Z together
 *     while the pen is low), Z changing while the pen is down
 *   - drawing outside the drawable area, pen holder leaving the plate footprint
 *   - Z pushed too far past the pen contact height (Z-Draw)
 *   - homing with the pen attached, pauses without bed clearance, pausing or
 *     ending with the pen down, heaters switched on, extrusion, coordinate resets
 *   - malformed numbers (NaN / undefined), missing feed rates, unknown commands
 * It also rebuilds every pen-down stroke (pen coordinates) and the travel moves,
 * so the preview can animate exactly what the file will do.
 *
 * Holder state: detached at the start (when the profile pauses for attaching).
 * A pause attaches it, unless the comment before the pause says to REMOVE it.
 */
(function (PP) {
  'use strict';

  const EPS = 1e-3;
  const MAX_MSGS = 60;
  const U2 = (v) => (Math.round(v * 100) / 100).toString();

  const KNOWN = new Set(['G0', 'G1', 'G4', 'G20', 'G21', 'G28', 'G90', 'G91', 'G92', 'G380',
    'M0', 'M1', 'M17', 'M18', 'M73', 'M82', 'M83', 'M84', 'M104', 'M106', 'M107', 'M109', 'M117',
    'M140', 'M190', 'M204', 'M220', 'M221', 'M400', 'M600', 'M960', 'M975', 'M1002', 'M1006']);
  const TEXT_CMDS = new Set(['M0', 'M1', 'M117', 'M1002', 'M118']);

  function parseLine(raw) {
    let s = raw;
    let comment = '';
    const ci = s.indexOf(';');
    if (ci >= 0) { comment = s.slice(ci + 1).trim(); s = s.slice(0, ci); }
    s = s.trim();
    if (!s) return { cmd: null, comment };
    const m = /^([GMT])(\d+(?:\.\d+)?)(.*)$/i.exec(s);
    if (!m) return { cmd: '?', raw: s, comment, bad: 'Unparseable line' };
    const cmd = m[1].toUpperCase() + m[2].replace(/^0+(?=\d)/, '');
    const rest = m[3].trim();
    /** @type {Record<string, number>} word letter -> value */
    const params = {};
    let bad = null;
    if (!TEXT_CMDS.has(cmd) && rest) {
      for (const tok of rest.split(/\s+/)) {
        const t = /^([A-Za-z])(.*)$/.exec(tok);
        if (!t) { bad = 'Bad token "' + tok + '"'; continue; }
        const letter = t[1].toUpperCase();
        // a bare letter (G28 X) is a flag: stored as true, which numeric checks read as 1
        if (t[2] === '') { params[letter] = /** @type {any} */ (true); continue; }
        if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(t[2])) { bad = 'Bad number "' + tok + '"'; continue; }
        params[letter] = parseFloat(t[2]);
      }
    }
    return { cmd, params, rest, comment, bad };
  }

  /**
   * Simulate G-code text.
   * opts: {
   *   drawZs: allowed pen-down heights (default [profile.zDraw]); ignored for dry runs
   *   dryRun: the file is a dry run (no drawing expected)
   *   expectedPauses: number of pauses expected (optional)
   *   keepMoves: keep travel segments for display (default true)
   * }
   */
  function simulate(text, profileIn, opts = {}) {
    const p = PP.GCode.normalizeProfile(profileIn);
    const R = PP.GCode.reachableRect(p);
    const W = p.bedWidth, D = p.bedDepth;
    const ox = p.penOffsetX, oy = p.penOffsetY;
    const zLift = p.zLift;
    const dry = !!opts.dryRun;
    const drawZs = (opts.drawZs && opts.drawZs.length ? opts.drawZs : [p.zDraw]).map(Number);
    const zFloorErr = PP.GCode.minSafeDrawZ(p);
    const zFloorWarn = Math.max(zFloorErr, p.zDraw - 2.51);
    const keepMoves = opts.keepMoves !== false;

    const errors = [], warnings = [];
    const counts = new Map();
    const report = (list, line, code, msg) => {
      const n = (counts.get(code) || 0) + 1;
      counts.set(code, n);
      if (n <= 3 && list.length < MAX_MSGS) list.push({ line, code, msg });
    };
    const err = (line, code, msg) => report(errors, line, code, msg);
    const warn = (line, code, msg) => report(warnings, line, code, msg);

    if (!(zLift - p.zDraw >= 1)) err(0, 'lift-clearance', 'Z-Lift (' + zLift + ') is less than 1 mm above Z-Draw (' + p.zDraw + ') - the pen would drag during travel.');
    if (!dry) for (const z of drawZs) {
      if (z > zLift - 0.5 + EPS) err(0, 'draw-above-lift', 'A pen-down height (' + z + ') is not at least 0.5 mm below the travel height Z-Lift (' + zLift + ').');
    }

    const lines = String(text).split(/\r?\n/);
    let x = null, y = null, z = null;
    let abs = true, F = null;
    let homed = false;
    let attached = !p.pauseForAttach;
    const pauses = [];
    let layer = 0;
    let t = 0;
    let penDown = false;
    let stroke = null;
    const strokes = [];
    const travels = [];
    let lastUp = { t: 0, pen: null };
    let lastComment = '';
    let drawLen = 0, travelLen = 0, moves = 0, zMoves = 0, dwellMs = 0;
    let minZ = Infinity, maxZ = -Infinity, minDrawZ = Infinity;
    const nozzleBB = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const penBB = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const grow = (b, a, c) => { if (a < b.minX) b.minX = a; if (a > b.maxX) b.maxX = a; if (c < b.minY) b.minY = c; if (c > b.maxY) b.maxY = c; };
    let steppersOff = false;
    let lastLine = 0;
    const isDrawZ = (zz) => drawZs.some(d => Math.abs(d - zz) < EPS);

    const finishStroke = () => {
      if (stroke) {
        stroke.t2 = t;
        strokes.push(stroke);
        lastUp = { t, pen: [stroke.pts[stroke.pts.length - 2], stroke.pts[stroke.pts.length - 1]] };
      }
      stroke = null;
    };

    const doPause = (ln, kind) => {
      const removing = /remove the pen holder/i.test(lastComment);
      const inspect = !removing && /\bmeasure\b/i.test(lastComment) && !attached;
      const action = removing ? 'remove' : inspect ? 'inspect' : (attached ? 'swap' : 'attach');
      pauses.push({ line: ln, x, y, z, kind, action });
      if (penDown) err(ln, 'pause-pen-down', 'Pause while the pen is down.');
      if (!inspect && (z === null || z < p.zAttach - EPS)) err(ln, 'pause-clearance', 'Pause with the bed at Z ' + (z === null ? '?' : z) + ' - it should be lowered to the attach height (' + p.zAttach + ') so there is room to attach, swap or remove the pen.');
      if (!inspect && x !== null && (x < p.nozzleMinX - EPS || x > p.nozzleMaxX + EPS || y < p.nozzleMinY - EPS || y > p.nozzleMaxY + EPS)) err(ln, 'pause-pos', 'Pause with the toolhead outside the safe zone.');
      if (penDown) { penDown = false; finishStroke(); }
      if (!inspect) attached = !removing;
      lastUp = { t, pen: x !== null ? [x + ox, y + oy] : null };
    };

    for (let i = 0; i < lines.length; i++) {
      const ln = i + 1;
      const raw = lines[i];
      const code = raw.split(';')[0];
      if (/nan|undefined|infinity|null/i.test(code)) err(ln, 'bad-number', 'Invalid value in "' + raw.trim().slice(0, 60) + '"');
      const pl = parseLine(raw);
      if (pl.comment) {
        lastComment = pl.comment;
        const lm = /^===== Layer (\d+)\/(\d+)/.exec(pl.comment);
        if (lm) layer = parseInt(lm[1], 10) - 1;
      }
      if (!pl.cmd) continue;
      lastLine = ln;
      if (pl.bad) { err(ln, 'parse', pl.bad + ' in "' + raw.trim().slice(0, 60) + '"'); if (pl.cmd === '?') continue; }
      const P = pl.params || {};
      const cmd = pl.cmd;
      if (!KNOWN.has(cmd)) warn(ln, 'unknown', 'Unknown command ' + cmd + ' (the printer may ignore it).');
      if (steppersOff && (cmd === 'G0' || cmd === 'G1')) err(ln, 'steppers-off', 'Move after the motors were disabled - position is lost.');

      switch (cmd) {
        case 'G28':
          if (attached && p.pauseForAttach) err(ln, 'home-attached', 'Homing while the pen holder is attached - the nozzle probes the plate and would crash the pen.');
          else if (!p.pauseForAttach) warn(ln, 'home-no-pause', 'Homing without a pause to attach the pen - make sure the pen holder is not attached yet.');
          if (penDown) err(ln, 'home-pen-down', 'Homing with the pen down.');
          homed = true;
          x = W / 2; y = D / 2; z = 0; // Z homing ends with the nozzle on the plate center
          break;
        case 'G90': abs = true; break;
        case 'G91': abs = false; if (homed) warn(ln, 'relative', 'Relative positioning (G91) after homing.'); break;
        case 'G20': err(ln, 'inches', 'Inch units (G20) - all coordinates would be 25.4x too large.'); break;
        case 'G21': break;
        case 'G92':
          if ('X' in P || 'Y' in P || 'Z' in P) err(ln, 'g92', 'G92 resets the machine coordinates - positions after this are unreliable.');
          break;
        case 'G380':
          // Bambu probing move (stops on contact). Only expected before homing.
          if (homed) warn(ln, 'g380', 'Probing move (G380) after homing.');
          if (attached && p.pauseForAttach) err(ln, 'probe-attached', 'Probing move with the pen holder attached.');
          break;
        case 'G4': {
          const ms = ('P' in P ? P.P : 0) + ('S' in P ? P.S * 1000 : 0);
          dwellMs += ms; t += ms / 1000;
          if (p.firmware === 'bambu') warn(ln, 'g4-bambu', 'G4 dwell may be ignored by Bambu firmware (use M400 P<ms>).');
          if (ms > 10000) warn(ln, 'long-dwell', 'Long dwell (' + Math.round(ms / 1000) + ' s).');
          break;
        }
        case 'M400':
          if ('U' in P) { doPause(ln, 'M400 U1'); break; }
          if ('P' in P || 'S' in P) {
            const ms = ('P' in P ? P.P : 0) + ('S' in P ? P.S * 1000 : 0);
            dwellMs += ms; t += ms / 1000;
            if (ms > 10000) warn(ln, 'long-dwell', 'Long dwell (' + Math.round(ms / 1000) + ' s).');
          }
          break;
        case 'M0': case 'M1': case 'M600':
          doPause(ln, cmd);
          break;
        case 'M104': case 'M109':
          if ((P.S || 0) > 0) err(ln, 'heater', 'Hotend heater switched on (' + P.S + ' C) - not needed for pen plotting and risky next to a plastic pen mount.');
          if (cmd === 'M109') warn(ln, 'wait-heat', 'M109 waits for the hotend temperature.');
          break;
        case 'M140': case 'M190':
          if ((P.S || 0) > 0) err(ln, 'bed-heater', 'Bed heater switched on (' + P.S + ' C).');
          break;
        case 'M18': case 'M84':
          steppersOff = true;
          break;
        case 'M17':
          steppersOff = false;
          break;
        case 'M220':
          if ('S' in P && P.S !== 100) warn(ln, 'speed-factor', 'Speed factor set to ' + P.S + '%.');
          break;
        case 'M204':
          if ((P.S || 0) > 20000) warn(ln, 'accel', 'Very high acceleration (' + P.S + ').');
          break;
        case 'M73':
          if ('P' in P && (P.P < 0 || P.P > 100)) warn(ln, 'progress', 'Progress value out of range: ' + P.P);
          break;
        case 'G0':
        case 'G1': {
          if ('E' in P) err(ln, 'extrude', 'Extrusion (E) in a pen-plotter file.');
          if ('F' in P) {
            if (!(P.F > 0)) err(ln, 'feed', 'Feed rate must be greater than 0.');
            else F = P.F;
          }
          const hasXY = ('X' in P) || ('Y' in P);
          const hasZ = 'Z' in P;
          if (!hasXY && !hasZ) break;
          if (!homed) {
            // Relative Z-only moves before homing (Bambu safe start) are fine
            if (!abs && !hasXY) break;
            if (p.home) err(ln, 'not-homed', 'Move before homing (G28).');
            if (x === null) { x = 'X' in P ? P.X : W / 2; y = 'Y' in P ? P.Y : D / 2; z = hasZ ? P.Z : 50; homed = true; }
          }
          const tx = 'X' in P ? (abs ? P.X : x + P.X) : x;
          const ty = 'Y' in P ? (abs ? P.Y : y + P.Y) : y;
          const tz = hasZ ? (abs ? P.Z : z + P.Z) : z;
          if (!(F > 0)) err(ln, 'no-feed', 'Move without a feed rate.');
          const feed = F > 0 ? F / 60 : 10;
          if (tx < p.nozzleMinX - EPS || tx > p.nozzleMaxX + EPS || ty < p.nozzleMinY - EPS || ty > p.nozzleMaxY + EPS) {
            if (attached) err(ln, 'xy-limit', 'Nozzle move to X' + tx.toFixed(2) + ' Y' + ty.toFixed(2) + ' leaves the safe zone (X ' + p.nozzleMinX + '..' + p.nozzleMaxX + ', Y ' + p.nozzleMinY + '..' + p.nozzleMaxY + ') with the pen holder attached.');
            else if (tx < -20 || tx > W + 20 || ty < -20 || ty > D + 20) err(ln, 'xy-range', 'Nozzle move to X' + tx.toFixed(2) + ' Y' + ty.toFixed(2) + ' is outside the printer.');
          }
          if (tz > p.zMax + EPS) err(ln, 'z-max', 'Z' + tz + ' is above the maximum Z (' + p.zMax + ').');
          if (tz < 0.3) err(ln, 'z-crash', 'Z' + tz + ' would drive the nozzle into the plate.');
          const moveXY = Math.abs(tx - x) > 1e-9 || Math.abs(ty - y) > 1e-9;
          const moveZ = Math.abs(tz - z) > 1e-9;
          moves++;
          if (moveZ) {
            zMoves++;
            if (attached) {
              if (tz < zFloorErr - EPS) err(ln, 'z-too-low', 'Z' + tz + ' is below the safe minimum Z' + U2(zFloorErr) + ' (Z-Draw ' + p.zDraw + ') - the pen or nozzle could crash into the plate.');
              else if (tz < zFloorWarn) warn(ln, 'z-low', 'Z' + tz + ' presses the pen more than 2.5 mm past Z-Draw ' + p.zDraw + '.');
            }
            if (feed > 30.01 && !moveXY) warn(ln, 'z-fast', 'Fast Z move (' + Math.round(feed) + ' mm/s).');
            if (tz < minZ) minZ = tz;
            if (tz > maxZ) maxZ = tz;
          }
          if (moveXY && Math.min(z, tz) < 1) err(ln, 'scrape', 'XY move with the nozzle at Z' + Math.min(z, tz) + ' - it would scrape the plate.');
          if (attached && moveXY && moveZ && Math.min(z, tz) < zLift - EPS) err(ln, 'diagonal', 'XY and Z move together while the pen is low - the pen would scrape across the paper.');
          const dist = Math.hypot(tx - x, ty - y);
          t += Math.max(dist, Math.abs(tz - z)) / feed;
          const wasDown = attached && z < zLift - EPS;
          const willDown = attached && tz < zLift - EPS;
          if (!wasDown && willDown) {
            if (dry) err(ln, 'dry-draw', 'Pen lowered in a dry-run file.');
            else if (!isDrawZ(tz)) err(ln, 'odd-draw-z', 'Pen lowered to Z' + tz + ', which is not a configured drawing height (' + drawZs.join(', ') + ').');
            penDown = true;
            if (tz < minDrawZ) minDrawZ = tz;
            const px = tx + ox, py = ty + oy;
            stroke = { layer, pts: [px, py], t0: lastUp.t, t1: t, from: lastUp.pen || [px, py], z: tz, feed: 0 };
          } else if (wasDown && !willDown) {
            penDown = false;
            finishStroke();
          } else if (wasDown && willDown && moveZ) {
            err(ln, 'z-while-down', 'Z changes while the pen is down (Z' + z + ' -> Z' + tz + ').');
          }
          if (moveXY) {
            const px = tx + ox, py = ty + oy;
            grow(nozzleBB, tx, ty);
            if (attached && (px < -EPS || px > W + EPS || py < -EPS || py > D + EPS))
              err(ln, 'holder-out', 'With the pen holder attached the pen would be at X' + px.toFixed(1) + ' Y' + py.toFixed(1) + ', outside the plate - the holder could hit the frame.');
            if (wasDown && willDown) {
              if (px < R.minX - EPS || px > R.maxX + EPS || py < R.minY - EPS || py > R.maxY + EPS)
                err(ln, 'draw-out', 'Pen draws at X' + px.toFixed(2) + ' Y' + py.toFixed(2) + ', outside the drawable area.');
              if (feed > 300) warn(ln, 'draw-fast', 'Very fast drawing move (' + Math.round(feed) + ' mm/s).');
              grow(penBB, px, py);
              drawLen += dist;
              if (stroke) { stroke.pts.push(px, py); stroke.feed = feed; }
            } else {
              if (feed > 500.01) warn(ln, 'travel-fast', 'Travel faster than 500 mm/s (' + Math.round(feed) + ').');
              travelLen += dist;
              if (keepMoves && attached) travels.push(x + ox, y + oy, px, py);
            }
          }
          x = tx; y = ty; z = tz;
          break;
        }
        default:
          break;
      }
    }

    if (penDown) err(lastLine, 'end-pen-down', 'The file ends with the pen down.');
    finishStroke();
    if (attached && z !== null && z < zLift - EPS) err(lastLine, 'end-low', 'The file ends with the pen near the paper (Z' + z + ').');
    else if (z !== null && z < p.zEnd - EPS) warn(lastLine, 'end-not-lowered', 'The bed is not lowered to the end height (' + p.zEnd + ') at the end.');
    if (attached && p.endPause) warn(lastLine, 'end-attached', 'The file ends with the pen holder still attached.');
    if (p.pauseForAttach && !pauses.length) err(0, 'no-attach-pause', 'No pause to attach the pen holder.');
    if (p.home && !homed) err(0, 'no-home', 'The file never homes the printer.');
    if (opts.expectedPauses !== undefined && pauses.length !== opts.expectedPauses) err(0, 'pause-count', 'Expected ' + opts.expectedPauses + ' pauses but found ' + pauses.length + '.');
    if (dry && strokes.length) err(0, 'dry-strokes', 'Dry run contains pen-down strokes.');
    if (!dry && opts.expectedStrokes !== undefined && strokes.length !== opts.expectedStrokes)
      err(0, 'stroke-count', 'The file has ' + strokes.length + ' pen-down strokes but the design has ' + opts.expectedStrokes + ' - a pen lift is missing or extra.');
    if (!dry && opts.expectedDrawLen !== undefined && Math.abs(drawLen - opts.expectedDrawLen) > Math.max(0.5, opts.expectedDrawLen * 0.002))
      err(0, 'draw-length', 'The file draws ' + drawLen.toFixed(1) + ' mm of line but the design has ' + opts.expectedDrawLen.toFixed(1) + ' mm - something extra (or missing) would be drawn.');

    for (const list of [errors, warnings]) for (const m of list) {
      const n = counts.get(m.code) || 0;
      if (n > 3) m.more = n - 3;
    }
    const fin = (b) => (b.minX === Infinity ? null : b);
    return {
      ok: errors.length === 0,
      errors, warnings,
      strokes, travels, pauses,
      stats: {
        lines: lines.length, moves, zMoves, penDowns: strokes.length,
        drawLen, travelLen, time: t, dwellMs,
        minZ: minZ === Infinity ? null : minZ, maxZ: maxZ === -Infinity ? null : maxZ,
        minDrawZ: minDrawZ === Infinity ? null : minDrawZ,
        nozzleBBox: fin(nozzleBB), penBBox: fin(penBB),
      },
    };
  }

  /** Expected pause count for a file produced by PP.GCode.build. */
  function expectedPauses(profileIn, jobs) {
    const p = PP.GCode.normalizeProfile(profileIn);
    let n = (p.pauseForAttach ? 1 : 0) + (p.endPause ? 1 : 0);
    jobs.forEach((j, i) => {
      const pause = j.pauseBefore !== undefined ? j.pauseBefore : (i > 0 && p.layerPause && jobs.length > 1);
      if (pause) n++;
    });
    return n;
  }

  /** Simulate a file produced from these jobs, with matching expectations. */
  function check(text, profileIn, jobs, opts = {}) {
    const p = PP.GCode.normalizeProfile(profileIn);
    const drawZs = Array.from(new Set(jobs.map(j => PP.GCode.safeDrawZ(p, PP.U.isNum(j.zDraw) ? j.zDraw : p.zDraw))));
    let expectedStrokes = 0, expectedDrawLen = 0;
    for (const j of jobs) for (const q of j.polys) {
      if (q.length < 4) continue;
      expectedStrokes++;
      expectedDrawLen += PP.Geo.polyLength(q);
    }
    return simulate(text, p, { drawZs, dryRun: opts.dryRun, expectedPauses: expectedPauses(p, jobs), expectedStrokes, expectedDrawLen, keepMoves: opts.keepMoves });
  }

  function summary(res) {
    const s = res.stats;
    if (!res.ok) return res.errors.length + ' problem' + (res.errors.length > 1 ? 's' : '') + ' found';
    return 'Simulated ' + s.moves.toLocaleString() + ' moves: ' + s.penDowns.toLocaleString() + ' strokes, no collisions, pen stays inside the drawable area' + (res.warnings.length ? ' (' + res.warnings.length + ' note' + (res.warnings.length > 1 ? 's' : '') + ')' : '');
  }

  function fmtMsg(m) {
    return (m.line ? 'Line ' + m.line + ': ' : '') + m.msg + (m.more ? ' (+' + m.more + ' more like this)' : '');
  }

  PP.GSim = { parseLine, simulate, check, expectedPauses, summary, fmtMsg };
})(window.PP = window.PP || {});
