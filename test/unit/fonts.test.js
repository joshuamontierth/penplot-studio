// Suite 3a: every built-in font loads from vendor/ and renders all of ASCII.
import { describe, expect, it } from 'vitest';
import { createRunner, expectCase } from './helpers.js';

const fonts = await window.PPTest.loadFonts();
const R = createRunner();

describe('fonts', () => {
  it('all built-in stroke fonts load offline', () => {
    expect(fonts.errors).toEqual([]);
    expect(fonts.loaded.length).toBe(fonts.ids.length);
    expect(fonts.ids.length).toBeGreaterThanOrEqual(40);
  });
  it.each(R.fontCases(fonts.loaded))('$name', (c) => expectCase(R, c));
});
