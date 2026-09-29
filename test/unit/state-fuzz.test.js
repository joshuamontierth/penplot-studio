// Suite 5: random editor operations, undo/redo and save/load keep the project consistent.
import { expect, it } from 'vitest';
import { createRunner, envInt } from './helpers.js';

const fonts = (await window.PPTest.loadFonts()).loaded;

it('editor state fuzz', async () => {
  const R = createRunner();
  await R.stateFuzz(envInt('STATE_OPS', 400), envInt('FUZZ_SEED', 1), fonts);
  expect(R.failures).toEqual([]);
});
