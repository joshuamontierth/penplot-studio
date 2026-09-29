#!/usr/bin/env node
/**
 * Rebuilds vendor/ from pinned npm packages (run: npm run vendor).
 *
 * Only static data files are copied (fonts, the opentype.js browser build and licenses); the packages
 * themselves are never installed, so their Node-side dependencies stay out of node_modules.
 * `npm pack` downloads each tarball and verifies it against the registry's integrity hash.
 * The result is committed, so running this is only needed when changing a version.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const VENDOR = join(ROOT, 'vendor');

const PACKAGES = [
  {
    spec: 'hersheytext@2.0.0',
    dest: 'hersheytext',
    // [from (inside the package), to (inside dest)]; a trailing / copies a folder filtered by `ext`
    files: [
      ['hersheytext.min.json', 'hersheytext.min.json'],
      ['svg_fonts/', 'svg_fonts/', '.svg'],
      ['LICENSE', 'LICENSE'],
    ],
  },
  {
    spec: 'opentype.js@1.3.4',
    dest: 'opentype',
    files: [
      ['dist/opentype.min.js', 'opentype.min.js'],
      ['LICENSE', 'LICENSE'],
    ],
  },
];

function run(cmd, args, cwd) {
  // shell: true lets Windows resolve npm.cmd; the arguments contain no shell metacharacters
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed:\n${r.stderr || r.stdout}`);
  return r.stdout;
}

const tmp = mkdtempSync(join(tmpdir(), 'penplot-vendor-'));
try {
  for (const pkg of PACKAGES) {
    const work = join(tmp, pkg.dest);
    mkdirSync(work, { recursive: true });
    const info = JSON.parse(run('npm', ['pack', pkg.spec, '--json', '--silent'], work))[0];
    run('tar', ['-xzf', info.filename], work);
    const src = join(work, 'package');
    const out = join(VENDOR, pkg.dest);
    rmSync(out, { recursive: true, force: true });
    for (const [from, to, ext] of pkg.files) {
      if (from.endsWith('/')) {
        mkdirSync(join(out, to), { recursive: true });
        const names = readdirSync(join(src, from)).filter((f) => !ext || f.endsWith(ext));
        for (const f of names.sort()) cpSync(join(src, from, f), join(out, to, f));
      } else {
        mkdirSync(dirname(join(out, to)), { recursive: true });
        cpSync(join(src, from), join(out, to));
      }
    }
    writeFileSync(
      join(out, 'SOURCE.json'),
      JSON.stringify({ package: info.name, version: info.version, integrity: info.integrity }, null, 2) + '\n',
    );
    console.log(`vendor/${pkg.dest}: ${info.name}@${info.version} (${info.integrity.slice(0, 20)}...)`);
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
