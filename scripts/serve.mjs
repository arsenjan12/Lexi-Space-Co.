// Локальный сервер для разработки: отдаёт site/ с теми же заголовками, что Netlify,
// и запускает функции из netlify/functions по адресам /api/*.
// Netlify CLI не нужен. Запуск: npm run serve  →  http://localhost:8888

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Корень проекта — на уровень выше scripts/, откуда бы ни запускали
const PROJECT = resolve(fileURLToPath(import.meta.url), '../..');
process.chdir(PROJECT);
const ROOT = resolve('site');
const PORT = +(process.env.PORT || 8888);

// Переменные из .env (LEXI_PQ_SEED, NASA_API_KEY)
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.sqlite': 'application/octet-stream',
  '.gguf': 'application/octet-stream', '.ttf': 'font/ttf', '.woff': 'font/woff',
};
const SECURITY = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'X-Content-Type-Options': 'nosniff',
};
const FUNCTIONS = { '/api/tle': 'tle.mjs', '/api/neo': 'neo.mjs', '/api/kp': 'kp.mjs' };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (FUNCTIONS[url.pathname]) {
      const mod = await import(pathToFileURL(resolve('netlify/functions', FUNCTIONS[url.pathname])).href);
      const r = await mod.default(new Request(url.href, { method: req.method }));
      res.writeHead(r.status, { ...Object.fromEntries(r.headers), ...SECURITY });
      res.end(Buffer.from(await r.arrayBuffer()));
      return;
    }
    let path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    if ((await stat(path).catch(() => null))?.isDirectory()) path = join(path, 'index.html');
    const data = await readFile(path);
    const type = TYPES[extname(path)] || 'application/octet-stream';
    // Запросы по частям (Range), как у Netlify: на них держится докачка модели
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      const from = +range[1], to = Math.min(range[2] ? +range[2] : data.length - 1, data.length - 1);
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${from}-${to}/${data.length}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', ...SECURITY });
      res.end(data.subarray(from, to + 1));
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache', ...SECURITY });
    res.end(data);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(e.code === 'ENOENT' ? 'Not found' : String(e.stack || e));
  }
}).listen(PORT, () => console.log(`LEXI Space: http://localhost:${PORT}`));
