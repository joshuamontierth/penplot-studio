// Suite 1: the G-code simulator must reject deliberately broken files.
import { describe, expect, it } from 'vitest';
import { createRunner, expectCase } from './helpers.js';

const R = createRunner();

describe('simulator self-test', () => {
  it.each(R.simulatorCases())('$name', (c) => expectCase(R, c));
});

describe('parameter parsing', () => {
  const SIM = window.PP.GSim;
  const P = window.PP.GCode.normalizeProfile(window.PPTest.X1C);
  const codes = (text) => SIM.simulate(text, P, { expectedPauses: 0 }).errors.map((e) => e.code);

  it.each(['M104 S', 'G1 X10 F', 'M400 P', 'M204 S'])('rejects a known command with a bare letter: %s', (line) => {
    expect(codes('G90\nG28\n' + line)).toContain('parse');
  });

  it('accepts axis flags on homing and motor commands', () => {
    expect(codes('G90\nG28 X Y\nM84 X Y\nM17 X Y Z')).not.toContain('parse');
  });
});

describe('holder-attached hardening', () => {
  const SIM = window.PP.GSim;
  const GC = window.PP.GCode;
  const P = GC.normalizeProfile(window.PPTest.X1C);
  const square = [100, 100, 110, 100, 110, 110, 100, 100];
  const build = (jobs) => GC.build(jobs, P, { date: new Date(0) }).text;
  /** Insert `extra` right after the attach pause of a plain one-layer file. */
  const withAttached = (extra) =>
    build([{ name: 'L', polys: [square] }]).replace(
      'G1 Z20 F900 ; pen up (travel height)',
      extra + '\nG1 Z20 F900 ; pen up (travel height)',
    );
  const codes = (text) => SIM.simulate(text, P).errors.map((e) => e.code);

  it.each([
    ['G2 X100 Y150 I-20 J0', 'arc'],
    ['G29', 'probe-attached'],
    ['T255', 'tool-change'],
    ['M620 S255', 'tool-change'],
    ['M221 X0 Y0 Z0', 'soft-endstops'],
    ['M9999', 'unknown-attached'],
  ])('rejects %s while the holder is attached', (line, code) => {
    expect(codes(withAttached(line))).toContain(code);
  });

  it('rejects nozzle moves off the plate even when the configured limits allow them', () => {
    const wide = GC.normalizeProfile({ ...window.PPTest.X1C, nozzleMaxX: 100000 });
    const text = withAttached('G1 X283 Y150 F12000');
    expect(SIM.simulate(text, wide).errors.map((e) => e.code)).toContain('xy-range');
  });

  it('only warns about unknown commands before the holder is attached', () => {
    const r = SIM.simulate('G90\nM9999\nG28', P, { expectedPauses: 0 });
    expect(r.errors.map((e) => e.code)).not.toContain('unknown-attached');
    expect(r.warnings.map((w) => w.code)).toContain('unknown');
  });

  it('reads the pause marker, not the layer name, for the holder state', () => {
    const jobs = [
      { name: 'Black', polys: [square] },
      { name: 'Remove the pen holder later', polys: [[120, 120, 130, 120]] },
    ];
    const r = SIM.check(build(jobs), P, jobs);
    expect(r.errors).toEqual([]);
    expect(r.pauses.map((p) => p.action)).toEqual(['attach', 'swap']);
  });

  it('keeps names with line breaks inside comments', () => {
    const jobs = [{ name: 'Red\nG1 Z1 F900', color: '#f00\nM104 S200', polys: [square] }];
    const text = build(jobs);
    expect(text).not.toMatch(/^G1 Z1 F900/m);
    expect(text).not.toMatch(/^M104 S200/m);
    expect(SIM.check(text, P, jobs).errors).toEqual([]);
  });
});

describe('pause warm-up (HANDOFF A14)', () => {
  const SIM = window.PP.GSim;
  const GC = window.PP.GCode;
  const X1C = GC.normalizeProfile(window.PPTest.X1C);
  const square = [100, 100, 110, 100, 110, 110, 100, 100];
  const twoLayers = (P) =>
    GC.build(
      [
        { name: 'A', polys: [square] },
        { name: 'B', polys: [square] },
      ],
      P,
      { date: new Date(0) },
    ).text;
  const codes = (text, P = X1C, list = 'errors') => SIM.simulate(text, P)[list].map((e) => e.code);

  it('warms the X1C nozzle to 90 C before every pause and switches it off before anything moves', () => {
    const text = twoLayers(X1C);
    const ls = text.split('\n');
    const pauses = ls.flatMap((l, i) => (l === 'M400 U1' ? [i] : []));
    expect(pauses).toHaveLength(2);
    for (const i of pauses) {
      const before = ls.slice(0, i).findLastIndex((l) => /^G1 /.test(l));
      expect(ls.slice(before, i).some((l) => /^M109 S90 /.test(l))).toBe(true);
      const after = ls.slice(i).findIndex((l) => /^G1 /.test(l)) + i;
      expect(ls.slice(i, after).some((l) => /^M104 S0 /.test(l))).toBe(true);
    }
    expect(codes(text)).toEqual([]);
    expect(codes(text, X1C, 'warnings')).not.toContain('wait-heat');
  });

  it('rejects heat above the pause temperature, a move while heated, and ending heated', () => {
    const text = twoLayers(X1C);
    expect(codes(text.replace(/^M109 S90 /m, 'M109 S120 '))).toContain('heater');
    const noOff = text.replace(/^M104 S0 ; heater off again.*\n/gm, '');
    expect(codes(noOff)).toEqual(expect.arrayContaining(['heater-move', 'end-heater']));
  });

  it('keeps the heater off for profiles without a pause temperature', () => {
    for (const id of ['bambu-a1', 'custom']) {
      const P = GC.normalizeProfile(GC.BUILTIN_PROFILES.find((b) => b.id === id));
      expect(P.pauseTemp).toBe(0);
      const text = twoLayers(P);
      expect(text).not.toMatch(/^M10[49] S[1-9]/m);
      expect(codes(text.replace(/^G90 ; re-assert.*$/m, 'M104 S90\n$&'), P)).toContain('heater');
    }
    // a saved profile from before the field existed: no heat
    const old = Object.assign({}, window.PPTest.X1C);
    delete old.pauseTemp;
    expect(GC.normalizeProfile(old).pauseTemp).toBe(0);
    // and no profile can ask for more than the cap
    expect(GC.normalizeProfile(Object.assign({}, X1C, { pauseTemp: 250 })).pauseTemp).toBe(GC.MAX_PAUSE_TEMP);
  });

  it('warms up around both offset-finder pauses', () => {
    const of = GC.offsetFinder(X1C);
    expect(of.text.match(/^M109 S90 /gm)).toHaveLength(2);
    expect(SIM.simulate(of.text, X1C, { expectedPauses: 2 }).errors).toEqual([]);
  });
});
