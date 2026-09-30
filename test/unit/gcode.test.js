// G-code generator (js/core/gcode.js): pins the documented X1C defaults and the safety rules from
// HANDOFF.md §3–§5, plus a golden file so any change to the emitted G-code shows up in review.
import { describe, expect, it } from 'vitest';

const GC = window.PP.GCode;
const SIM = window.PP.GSim;
const X1C = GC.BUILTIN_PROFILES.find((p) => p.id === 'bambu-x1c');
const CUSTOM = GC.BUILTIN_PROFILES.find((p) => p.id === 'custom');
const DATE = new Date('2026-01-01T00:00:00Z');

const square = (x, y, s) => [x, y, x + s, y, x + s, y + s, x, y + s, x, y];
const job = (polys, extra = {}) => ({ name: 'Layer 1', color: '#000000', polys, ...extra });
const lines = (text) => text.split('\n');
const code = (line) => line.split(';')[0].trim();
/** Index of the first line whose code part (comments stripped) matches re, at or after `from`. */
const find = (ls, re, from = 0) => ls.findIndex((l, i) => i >= from && re.test(code(l)));

describe('X1C profile defaults (HANDOFF §4.3)', () => {
  it('uses the Falu mount geometry', () => {
    expect(X1C).toMatchObject({
      firmware: 'bambu',
      bedWidth: 256,
      bedDepth: 256,
      nozzleMinX: 48,
      nozzleMaxX: 256,
      nozzleMinY: 55,
      nozzleMaxY: 256,
      penOffsetX: -28,
      penOffsetY: -35,
      margin: 1,
    });
  });

  it('uses the documented heights, speeds and positions', () => {
    expect(X1C).toMatchObject({
      zDraw: 14,
      zLift: 20,
      zAttach: 60,
      zEnd: 80,
      zMax: 250,
      drawSpeed: 30,
      travelSpeed: 200,
      zSpeed: 15,
      accel: 4000,
      penDownDelay: 50,
      penUpDelay: 0,
      pauseCommand: 'M400 U1',
      parkX: 80,
      parkY: 245,
      endX: 152,
      endY: 250,
    });
    for (const k of ['home', 'safeStart', 'pauseForAttach', 'layerPause', 'endPause', 'progress', 'heatersOff']) {
      expect(X1C[k], k).toBe(true);
    }
  });

  it('gives a drawable area of X 21–227 × Y 21–220', () => {
    expect(GC.reachableRect(GC.normalizeProfile(X1C))).toEqual({ minX: 21, maxX: 227, minY: 21, maxY: 220 });
  });

  it('every built-in profile is valid', () => {
    for (const p of GC.BUILTIN_PROFILES) expect(GC.validateProfile(GC.normalizeProfile(p)), p.id).toEqual([]);
  });
});

describe('normalizeProfile', () => {
  it('parses numeric strings and replaces non-numbers with defaults', () => {
    const p = GC.normalizeProfile({ zDraw: '12.5', zLift: 'abc', drawSpeed: null });
    expect(p.zDraw).toBe(12.5);
    expect(p.zLift).toBe(GC.FIELD_DEFAULTS.zLift);
    expect(p.drawSpeed).toBe(GC.FIELD_DEFAULTS.drawSpeed);
  });
});

describe('validateProfile', () => {
  const invalid = (patch) => GC.validateProfile(GC.normalizeProfile({ ...X1C, ...patch }));
  it.each([
    ['Z-Lift less than 1 mm above Z-Draw', { zLift: 14.5 }, /Z-Lift/],
    ['Z-Draw below 0.2 mm', { zDraw: 0.1, zLift: 5 }, /Z-Draw/],
    ['attach height below Z-Lift', { zAttach: 15 }, /Attach height/],
    ['a height above Z max', { zEnd: 300 }, /maximum Z/],
    ['zero speed', { drawSpeed: 0 }, /Speeds/],
    ['park outside the safe zone', { parkX: 20 }, /Park position/],
    ['end outside the safe zone', { endY: 40 }, /End position/],
    ['a drawable area under 10 mm', { nozzleMinX: 250 }, /smaller than 10 mm/],
  ])('rejects %s', (_name, patch, re) => {
    expect(invalid(patch).some((e) => re.test(e))).toBe(true);
  });
});

describe('pen-down safe window (HANDOFF §4.4)', () => {
  it('minSafeDrawZ = max(zDraw − 4, zDraw / 2, 0.5)', () => {
    expect(GC.minSafeDrawZ({ zDraw: 14 })).toBe(10);
    expect(GC.minSafeDrawZ({ zDraw: 6 })).toBe(3);
    expect(GC.minSafeDrawZ({ zDraw: 0.6 })).toBe(0.5);
  });

  it('safeDrawZ clamps into [minSafeDrawZ, zLift − 0.5]', () => {
    const p = GC.normalizeProfile(X1C);
    expect(GC.safeDrawZ(p, 14)).toBe(14);
    expect(GC.safeDrawZ(p, 2)).toBe(10);
    expect(GC.safeDrawZ(p, 40)).toBe(19.5);
  });

  it('clamps an out-of-range layer Z-Draw and reports it', () => {
    const res = GC.build([job([square(100, 100, 10)], { zDraw: 3 })], X1C, { date: DATE });
    expect(res.warnings.join(' ')).toMatch(/clamped to 10/);
    expect(res.text).toContain('G1 Z10 F900 ; pen down');
    expect(res.text).not.toContain('G1 Z3 ');
  });
});

describe('build: Bambu file structure (HANDOFF §5)', () => {
  const res = GC.build([job([square(100, 100, 10)])], X1C, { date: DATE, title: 'square' });
  const ls = lines(res.text);

  it('switches heaters and fans off before homing', () => {
    const g28 = find(ls, /^G28/);
    expect(g28).toBeGreaterThan(0);
    for (const c of [/^M104 S0$/, /^M140 S0$/, /^M106 S0$/, /^M106 P2 S0$/, /^M106 P3 S0$/]) {
      const i = find(ls, c);
      expect(i, String(c)).toBeGreaterThan(-1);
      expect(i).toBeLessThan(g28);
    }
  });

  it('runs the G380 safe-start preamble right before G28', () => {
    const g380 = find(ls, /^G380 S2 Z30/);
    expect(g380).toBeGreaterThan(-1);
    expect(g380).toBeLessThan(find(ls, /^G28/));
  });

  it('homes first, then lowers the bed, parks and pauses to attach the holder', () => {
    const g28 = find(ls, /^G28/);
    const lower = find(ls, /^G1 Z60 F900$/, g28);
    const park = find(ls, /^G1 X80 Y245 F12000$/, lower);
    const pause = find(ls, /^M400 U1$/, park);
    expect([g28, lower, park, pause].every((i, k, a) => i > (a[k - 1] ?? -1))).toBe(true);
    expect(ls.slice(park, pause).join('\n')).toMatch(/attach the pen holder/);
    expect(code(ls[find(ls, /^G1 Z/, pause)])).toBe('G1 Z20 F900');
  });

  it('draws in nozzle coordinates (nozzle = pen − offset)', () => {
    // pen (100, 100) with offset (−28, −35) -> nozzle (128, 135)
    expect(res.text).toContain('G1 X128 Y135 F12000');
    expect(res.text).toContain('G1 X138 Y135 F1800');
  });

  it('lowers the pen with a pure Z move, then dwells with M400 P50', () => {
    const down = ls.findIndex((l) => l.endsWith('; pen down'));
    expect(code(ls[down])).toBe('G1 Z14 F900');
    expect(code(ls[down + 1])).toBe('M400 P50');
    expect(res.text).not.toMatch(/^G4 /m);
  });

  it('ends with the bed lowered, an end pause to remove the holder, then the end position', () => {
    const end = ls.indexOf('; ===== End =====');
    const lower = find(ls, /^G1 Z80 F900$/, end);
    const pause = find(ls, /^M400 U1$/, lower);
    const out = find(ls, /^G1 X152 Y250 F12000$/, pause);
    expect(lower).toBeGreaterThan(end);
    expect(ls.slice(lower, pause).join('\n')).toMatch(/remove the pen holder/);
    expect(out).toBeGreaterThan(pause);
    expect(res.text).toMatch(/^M73 P100 R0$/m);
  });

  it('passes the simulator', () => {
    const sim = SIM.check(res.text, GC.normalizeProfile(X1C), [job([square(100, 100, 10)])]);
    expect(sim.errors).toEqual([]);
    expect(sim.pauses.map((p) => p.action)).toEqual(['attach', 'remove']);
  });

  it('matches the golden file', async () => {
    await expect(res.text).toMatchFileSnapshot('__snapshots__/x1c-square.gcode');
  });
});

describe('build: other modes', () => {
  it('pauses for a pen change between layers only when layerPause is on', () => {
    const jobs = [job([square(100, 100, 10)]), job([square(130, 100, 10)], { name: 'Layer 2' })];
    const withPause = GC.build(jobs, X1C, { date: DATE });
    const noPause = GC.build(jobs, { ...X1C, layerPause: false }, { date: DATE });
    expect(withPause.text.match(/^M400 U1$/gm)).toHaveLength(3);
    expect(withPause.text).toMatch(/change to the pen for layer "Layer 2"/);
    expect(noPause.text.match(/^M400 U1$/gm)).toHaveLength(2);
  });

  it('a dry run never lowers the pen below Z-Lift', () => {
    const jobs = [job([square(100, 100, 10)])];
    const res = GC.build(jobs, X1C, { date: DATE, dryRun: true });
    expect(res.text).toMatch(/DRY RUN/);
    const downs = lines(res.text).filter((l) => l.endsWith('; pen down'));
    expect(downs.length).toBe(1);
    for (const l of downs) expect(Number(/Z([\d.]+)/.exec(l)[1])).toBeGreaterThanOrEqual(X1C.zLift);
    const sim = SIM.check(res.text, GC.normalizeProfile(X1C), jobs, { dryRun: true });
    expect(sim.errors).toEqual([]);
    expect(sim.strokes).toHaveLength(0);
  });

  it('clamps nozzle moves into the safe zone and warns', () => {
    // pen X 5 -> nozzle X 33, left of the 48 mm limit
    const res = GC.build([job([[5, 100, 50, 100]])], X1C, { date: DATE });
    expect(res.warnings.join(' ')).toMatch(/clamped/);
    expect(res.text).toContain('G1 X48 Y135 F12000');
  });

  it('Marlin profile: G4 dwell, M107, no G380 preamble, no end pause', () => {
    const res = GC.build([job([square(50, 50, 10)])], CUSTOM, { date: DATE });
    expect(res.text).toMatch(/^G4 P50$/m);
    expect(res.text).toMatch(/^M107/m);
    expect(res.text).not.toMatch(/G380/);
    expect(res.text).not.toMatch(/remove the pen holder now/);
    expect(res.text).toMatch(/^M0 Attach pen/m);
    expect(SIM.check(res.text, GC.normalizeProfile(CUSTOM), [job([square(50, 50, 10)])]).errors).toEqual([]);
  });

  it('never writes NaN, undefined or Infinity', () => {
    const res = GC.build(
      [
        job([
          [100, 100, 120, 130],
          [150, 150, 151, 150],
        ]),
      ],
      { ...X1C, zDraw: 'x' },
      { date: DATE },
    );
    const codeOnly = lines(res.text).map(code).join('\n');
    expect(codeOnly).not.toMatch(/NaN|undefined|Infinity/);
  });
});

describe('offsetFinder', () => {
  it('attaches, draws the cross with the nozzle at the safe-zone center, removes the holder and pauses to measure', () => {
    const P = GC.normalizeProfile(X1C);
    const of = GC.offsetFinder(P);
    const sim = SIM.simulate(of.text, P, { expectedPauses: 2 });
    expect(sim.errors).toEqual([]);
    expect(sim.pauses.map((p) => p.action)).toEqual(['attach', 'remove']);
    // measuring is a timed wait at Z-Lift (a pause would send the toolhead to the purge chute)
    expect(of.text).toMatch(/^M400 S180$/m);
    expect(of.text).not.toMatch(/^G1 Z3 /m);
    const zAfterRemove = [...of.text.split('; PP_PAUSE remove')[1].matchAll(/^G1 Z([\d.]+)/gm)].map((m) =>
      Number(m[1]),
    );
    expect(Math.min(...zAfterRemove)).toBeGreaterThanOrEqual(P.zLift);
    expect(sim.strokes).toHaveLength(3);
    expect(of.legend.join(' ')).toMatch(/X152 Y155\.5/);
  });
});
