#!/usr/bin/env node
/**
 * PenPlot Studio dev server (Node, no dependencies, works on Windows/macOS/Linux).
 *
 *   node scripts/serve.mjs              # http://127.0.0.1:8791, opens the browser
 *   node scripts/serve.mjs 9000         # custom port (or --port 9000)
 *   node scripts/serve.mjs --live       # reload the page when files change (CSS is swapped in place)
 *   node scripts/serve.mjs --no-open    # do not open a browser window
 *
 * Every response is sent with Cache-Control: no-store so the browser always runs the latest files.
 * serve.py does the same (without live reload) for machines that only have Python.
 */
import { createServer } from 'node:http';
import { createReadStream, readFileSync, statSync, watch } from 'node:fs';
import { extname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.stl': 'model/stl',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.gcode': 'text/plain; charset=utf-8',
};

// Folders that never affect the running app (ignored by live reload)
const IGNORE = /(^|[\\/])(node_modules|\.git|coverage|test-results|playwright-report|blob-report|\.claude)([\\/]|$)/;

const LIVE_CLIENT = `<script>(function () {
  var es = new EventSource('/__live');
  es.onmessage = function (e) {
    if (e.data === 'css') {
      document.querySelectorAll('link[rel="stylesheet"]').forEach(function (l) {
        var u = new URL(l.href); u.searchParams.set('v', Date.now()); l.href = u.href;
      });
    } else location.reload();
  };
})();</script>`;

function parseArgs(argv) {
  const opts = { port: 8791, open: true, live: false, host: '127.0.0.1' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-open') opts.open = false;
    else if (a === '--live') opts.live = true;
    else if (a === '--port') opts.port = Number(argv[++i]);
    else if (a.startsWith('--port=')) opts.port = Number(a.slice(7));
    else if (/^\d+$/.test(a)) opts.port = Number(a);
    else throw new Error('Unknown argument: ' + a);
  }
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) throw new Error('Bad port: ' + opts.port);
  return opts;
}

/** Map a request path to a file inside ROOT (or null if it escapes ROOT). */
function resolvePath(urlPath) {
  let p;
  try {
    p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  const file = normalize(join(ROOT, p));
  const rel = relative(ROOT, file);
  if (isAbsolute(rel) || rel.split(sep).includes('..')) return null;
  return file;
}

function startServer({ port = 8791, host = '127.0.0.1', live = false } = {}) {
  const clients = new Set();

  const server = createServer((req, res) => {
    const url = req.url || '/';
    if (live && url === '/__live') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    let file = resolvePath(url);
    if (!file) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    let st;
    try {
      st = statSync(file);
      if (st.isDirectory()) {
        if (!url.split('?')[0].endsWith('/')) {
          res.writeHead(301, { Location: url.split('?')[0] + '/' }).end();
          return;
        }
        file = join(file, 'index.html');
        st = statSync(file);
      }
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('Not found');
      return;
    }
    const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream';
    const headers = { 'Content-Type': type, 'Cache-Control': 'no-store, must-revalidate' };
    if (live && type.startsWith('text/html')) {
      const html = readFileSync(file, 'utf8');
      const out = html.includes('</body>') ? html.replace('</body>', LIVE_CLIENT + '</body>') : html + LIVE_CLIENT;
      res.writeHead(200, headers).end(req.method === 'HEAD' ? undefined : out);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  });

  let watcher = null;
  if (live) {
    let timer = null;
    let cssOnly = true;
    watcher = watch(ROOT, { recursive: true }, (_event, name) => {
      if (!name || IGNORE.test(name)) return;
      if (extname(name) !== '.css') cssOnly = false;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const msg = cssOnly ? 'css' : 'reload';
        cssOnly = true;
        for (const c of clients) c.write('data: ' + msg + '\n\n');
      }, 120);
    });
    server.on('close', () => watcher.close());
  }

  return new Promise((resolveStart, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolveStart(server));
  });
}

function openBrowser(url) {
  const win = process.platform === 'win32';
  const cmd = win
    ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  try {
    // windowsVerbatimArguments keeps `start "" <url>` intact (the empty title must stay a literal "")
    const child = spawn(cmd[0], cmd[1], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: win,
    });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* no browser available: the URL is printed anyway */
  }
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
  try {
    await startServer(opts);
  } catch (e) {
    if (e.code === 'EADDRINUSE')
      console.error(`Port ${opts.port} is already in use. Try: npm start -- --port ${opts.port + 1}`);
    else console.error(e);
    process.exit(1);
  }
  const url = `http://${opts.host}:${opts.port}/`;
  console.log(`PenPlot Studio running at ${url}${opts.live ? '  (live reload on)' : ''}  (Ctrl+C to stop)`);
  console.log(`Tests: ${url}tests/`);
  if (opts.open) setTimeout(() => openBrowser(url), 300);
}

main();
