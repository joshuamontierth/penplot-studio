// Shared Playwright fixtures: every page runs offline (only the local server is reachable) and
// console errors / uncaught exceptions are collected so a test can assert the app stayed clean.
import { test as base, expect } from '@playwright/test';

export const test = base.extend({
  /** Messages from console.error / console.warn and uncaught page errors. */
  consoleProblems: async ({ page }, use) => {
    const problems = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
    await use(problems);
  },
  /** URLs of blocked requests to anything other than the local test server. */
  externalRequests: [
    async ({ context, baseURL }, use) => {
      const blocked = [];
      const origin = new URL(baseURL).origin;
      await context.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
        blocked.push(url);
        return route.abort('internetdisconnected');
      });
      await use(blocked);
    },
    { auto: true },
  ],
});

export { expect };
