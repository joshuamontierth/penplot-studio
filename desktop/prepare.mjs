// Stage the static web app into desktop/app/ so Electron (dev) and electron-builder (dist) both load the same
// files. Runs before `desktop:start` / `desktop:dist`. Plain Node so it behaves the same on Windows and Linux.
// desktop/app/ is a build artifact: it is git-ignored, wiped and re-copied on every run.
import { cp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const out = path.join(here, 'app');

// Everything the page loads at runtime. README.md carries the credits and licence notes (vendor/ has its own
// licence files). If index.html starts referencing another top-level file or folder, add it here; the check at the
// bottom fails the build if something it references did not make it into the bundle.
const ENTRIES = ['index.html', 'css', 'js', 'vendor', 'README.md'];

const JUNK = new Set(['.DS_Store', 'Thumbs.db', 'Desktop.ini']);

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const name of ENTRIES) {
  const from = path.join(root, name);
  try {
    await stat(from);
  } catch {
    throw new Error(`desktop/prepare: ${name} not found in ${root}`);
  }
  await cp(from, path.join(out, name), { recursive: true, filter: (src) => !JUNK.has(path.basename(src)) });
}

// Every local src/href in index.html must exist in the bundle.
const html = await readFile(path.join(out, 'index.html'), 'utf8');
const missing = [];
for (const m of html.matchAll(/\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
  const ref = (m[1] ?? m[2]).split(/[?#]/)[0];
  if (!ref || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref)) continue; // data:, https:, //cdn...
  try {
    await stat(path.join(out, ref));
  } catch {
    missing.push(ref);
  }
}
if (missing.length) {
  throw new Error(`desktop/prepare: index.html references files that are not bundled: ${missing.join(', ')}`);
}

console.log(`desktop/prepare: staged ${ENTRIES.join(', ')} into ${path.relative(process.cwd(), out) || '.'}`);
