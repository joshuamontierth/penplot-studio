// Suite 2: directed edge cases through the full pipeline (plan -> G-code -> simulation -> fidelity).
import { describe, it } from 'vitest';
import { createRunner, expectCase } from './helpers.js';

const R = createRunner();

describe('pipeline edge cases', () => {
  it.each(R.edgeCases())('$name', (c) => expectCase(R, c));
});
