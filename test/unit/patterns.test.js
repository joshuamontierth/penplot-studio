// Suite 3b: every pattern generator at default, all-min and all-max parameters.
import { describe, it } from 'vitest';
import { createRunner, expectCase } from './helpers.js';

await window.PP.Fonts.load(window.PP.Fonts.DEFAULT);
const R = createRunner();

describe('pattern generators', () => {
  it.each(R.patternCases())('$name', (c) => expectCase(R, c));
});
