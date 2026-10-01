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
