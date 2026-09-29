// Suite 3c: every image trace mode, and the calibration files / offset finder on every profile.
import { describe, it } from 'vitest';
import { createRunner, expectCase } from './helpers.js';

await window.PP.Fonts.load(window.PP.Fonts.DEFAULT);
const R = createRunner();

describe('image trace modes', () => {
  it.each(R.traceCases())('$name', (c) => expectCase(R, c));
});

describe('calibration', () => {
  it.each(R.calibrationCases())('$name', (c) => expectCase(R, c));
});
