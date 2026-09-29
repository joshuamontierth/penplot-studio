// Per-test-file setup: offline fetch for the vendored fonts, then load the app modules.
import { readFile } from 'node:fs/promises';
import { loadApp, ROOT } from './load.js';
import { join } from 'node:path';

// Fonts: map both the local vendor/ URL and the CDN URL to the files in vendor/. Anything else is an
// error, so unit tests can never depend on the network.
const VENDOR_URL = /(?:^|\/)vendor\/hersheytext\/(.+)$|^https:\/\/cdn\.jsdelivr\.net\/npm\/hersheytext@2\.0\.0\/(.+)$/;
globalThis.fetch = async (input) => {
  const url = String(input instanceof Request ? input.url : input);
  const m = VENDOR_URL.exec(url);
  if (!m) throw new TypeError('Network access is disabled in unit tests: ' + url);
  try {
    const body = await readFile(join(ROOT, 'vendor', 'hersheytext', ...(m[1] || m[2]).split('/')));
    return new Response(body, { status: 200 });
  } catch {
    return new Response('Not found', { status: 404 });
  }
};

// jsdom has no 2D canvas: return null quietly instead of logging "Not implemented" on every call
// (svg.js then falls back to black for stroke colors).
HTMLCanvasElement.prototype.getContext = () => null;

await loadApp();
