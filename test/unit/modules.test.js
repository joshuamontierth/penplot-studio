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
