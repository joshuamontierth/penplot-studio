// Loads the app's classic scripts into the current (jsdom) global, in page order. The browser test
// page's script list is the single source of truth, so Node and the browser run the same modules.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Local `<script src>` paths of an HTML page, in order, relative to ROOT (posix separators). */
export function scriptsOf(page) {
  const html = readFileSync(join(ROOT, page), 'utf8');
  const base = dirname(page);
  return [...html.matchAll(/<script\s+src="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((src) => !/^[a-z]+:\/\//i.test(src))
    .map((src) => join(base, src).split('\\').join('/'));
}

/** Everything tests/index.html loads except the browser runner (tests.js), which needs its page. */
export async function loadApp() {
  for (const src of scriptsOf('tests/index.html')) {
    if (src === 'tests/tests.js') continue;
    await import(pathToFileURL(join(ROOT, src)).href);
    if (src === 'js/app/app.js') window.PP.Store.autosaveEnabled = false;
  }
  return window.PP;
}
