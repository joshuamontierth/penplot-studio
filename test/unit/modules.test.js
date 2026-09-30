import { describe, expect, it } from 'vitest';
import { scriptsOf } from './load.js';

describe('module loading', () => {
  it('tests/index.html loads app modules in the same order as index.html', () => {
    const app = scriptsOf('index.html');
    const testPage = scriptsOf('tests/index.html').filter((s) => s.startsWith('js/'));
    expect(testPage.length).toBeGreaterThan(10);
    // every module the test page loads is in the app, in the same relative order
    const positions = testPage.map((s) => app.indexOf(s));
    expect(positions).not.toContain(-1);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('registers every namespace on window.PP', () => {
    for (const ns of [
      'U',
      'Geo',
      'SVG',
      'Storage',
      'Fonts',
      'Optimizer',
      'GCode',
      'GSim',
      'Patterns',
      'ImageTrace',
      'Store',
      'Objects',
      'UI',
      'App',
    ]) {
      expect(window.PP[ns], ns).toBeTruthy();
    }
    expect(window.PPTest).toBeTruthy();
  });
});

describe('project loading', () => {
  it('drops objects whose geometry cannot be built and keeps the rest', () => {
    const S = window.PP.Store;
    const { dropped } = S.load({
      layers: [{ id: 'a', name: 'x' }],
      objects: [
        { type: 'path', layerId: 'a' }, // no paths: used to break every render
        { type: 'path', layerId: 'a', paths: [[0, 0, 10, 0]], x: 'oops', scaleX: null },
        { type: 'shape', shape: 'rect', w: 10, h: 10, layerId: 'missing' },
      ],
    });
    expect(dropped).toBe(1);
    expect(S.project.objects).toHaveLength(2);
    const [path, rect] = S.project.objects;
    expect(path).toMatchObject({ x: 0, scaleX: 1 });
    expect(rect.layerId).toBe('a');
    expect(() => window.PP.App.buildPlan()).not.toThrow();
  });
});

describe('small UX helpers', () => {
  it('keeps accented letters as their base letter in file names', () => {
    expect(window.PP.U.safeFilename('héllo ✓ café')).toBe('hello_cafe');
    expect(window.PP.U.safeFilename('✓✓')).toBe('plot');
  });

  it('explains an empty plan when everything is outside the drawable area', () => {
    const S = window.PP.Store;
    S.reset();
    S.add(window.PP.Objects.create.shape('rect', { x: -500, y: 900, w: 50, h: 50 }), { history: false });
    const plan = window.PP.App.buildPlan();
    expect(plan.jobs).toHaveLength(0);
    expect(window.PP.App.emptyPlanMessage(plan)).toMatch(/outside the drawable area/);
  });
});
