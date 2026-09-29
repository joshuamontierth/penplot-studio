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
