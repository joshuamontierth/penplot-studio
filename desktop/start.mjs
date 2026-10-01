// Dev launcher: stage the web app (prepare.mjs), then run Electron on this folder. Extra arguments are passed
// through to Electron (for example `npm --prefix desktop start -- --remote-debugging-port=9222`).
//
// Linux caveat: an Electron binary under node_modules can only use Chromium's sandbox if the kernel allows
// unprivileged user namespaces or chrome-sandbox is setuid root. Ubuntu 24.04+ blocks the former by default
// (AppArmor), so Electron aborts at startup. In that case the dev run falls back to --no-sandbox and says so.
// Packaged AppImages do the same probe in their own AppRun script.
import { spawn, spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

await import('./prepare.mjs');

const electronPath = createRequire(import.meta.url)('electron'); // path to the binary (downloads it if missing)

function sandboxUnavailable() {
  if (process.platform !== 'linux') return false;
  try {
    const st = statSync(path.join(path.dirname(electronPath), 'chrome-sandbox'));
    if (st.uid === 0 && st.mode & 0o4000) return false; // setuid helper is configured
  } catch {
    // no helper: fall through to the namespace probe
  }
  const probe = spawnSync('unshare', ['-Ur', 'true'], { stdio: 'ignore' });
  return probe.status !== 0; // also true when `unshare` is missing, so the dev run still starts
}

const args = [here, ...process.argv.slice(2)];
if (sandboxUnavailable() && !args.includes('--no-sandbox')) {
  console.warn(
    'desktop/start: the Chromium sandbox is unavailable here, running Electron with --no-sandbox (dev only).',
  );
  args.push('--no-sandbox');
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // set by some terminals (VS Code); Electron would then behave like plain Node

const child = spawn(electronPath, args, { stdio: 'inherit', env });
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
