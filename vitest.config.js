// Vitest runs the app's classic-script modules in Node under jsdom. test/unit/setup.js imports them
// in the same order as tests/index.html, so every test file starts with a fresh window.PP.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.js'],
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://127.0.0.1:8791/' } },
    setupFiles: ['test/unit/setup.js'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['js/**/*.js'],
      reporter: ['text-summary', 'html', 'lcov'],
    },
  },
});
