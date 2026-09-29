// Suite 1: the G-code simulator must reject deliberately broken files.
import { describe, it } from 'vitest';
import { createRunner, expectCase } from './helpers.js';

const R = createRunner();

describe('simulator self-test', () => {
  it.each(R.simulatorCases())('$name', (c) => expectCase(R, c));
});
