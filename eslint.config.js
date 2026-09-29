// ESLint flat config. The app (js/, tests/) is classic browser scripts that share state through the
// window.PP namespace; tooling and the Node test suites are ES modules.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'vendor/', 'coverage/', 'test-results/', 'playwright-report/', 'blob-report/'] },
  js.configs.recommended,
  {
    files: ['js/**/*.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, PP: 'readonly', PPTest: 'readonly' },
    },
    rules: {
      // `catch (e) { /* ignore */ }` and tool-interface params like (w, view) are the house style
      'no-unused-vars': ['error', { caughtErrors: 'none', args: 'none' }],
    },
  },
  {
    // feature-detected: the harness prefers setImmediate when it runs under Node
    files: ['tests/harness.js'],
    languageOptions: { globals: { setImmediate: 'readonly' } },
  },
  {
    files: ['**/*.mjs', '*.config.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
  },
  {
    // Playwright specs run in Node but page.evaluate() callbacks run in the browser
    files: ['e2e/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Vitest suites run in Node with jsdom's window globals
    files: ['test/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
];
