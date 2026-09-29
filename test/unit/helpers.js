import { expect } from 'vitest';

/** A harness runner; failed checks are collected per case instead of being logged. */
export const createRunner = () => window.PPTest.createRunner();

/** Run one harness case and fail the Vitest test with the names of any checks that failed. */
export function expectCase(R, c) {
  const before = R.failures.length;
  c.run();
  expect(R.failures.slice(before)).toEqual([]);
}

/** Integer from an environment variable, or the default. */
export function envInt(name, def) {
  const v = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) ? v : def;
}
