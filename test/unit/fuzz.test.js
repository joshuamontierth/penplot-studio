// Suite 4: seeded random designs x printer profiles x optimizer settings.
//   FUZZ_N=<count> FUZZ_SEED=<seed> npm test     (defaults: 30 scenarios, seed 1)
// A failure names its rng seed; reproduce it in the browser with `await replayScenario(<seed>)` on
// the tests page, which draws the simulated file.
import { describe, expect, it } from 'vitest';
import { createRunner, envInt } from './helpers.js';

const N = envInt('FUZZ_N', 30);
const SEED = envInt('FUZZ_SEED', 1);
const fonts = (await window.PPTest.loadFonts()).loaded;
const R = createRunner();
const seeds = Array.from({ length: N }, (_, i) => R.fuzzSeed(SEED, i));

// Some scenarios are km-scale hatched designs that legitimately take ~20 s (much longer under coverage)
const TIMEOUT = 300_000;

describe.skipIf(N === 0)(`fuzz (n=${N}, seed=${SEED})`, () => {
  it.each(seeds)(
    'scenario with rng seed %i',
    (s) => {
      const before = R.failures.length;
      R.fuzzCase(s, fonts);
      expect(R.failures.slice(before)).toEqual([]);
    },
    TIMEOUT,
  );
});
