#!/usr/bin/env node
/**
 * 本地预览服务器（UPGRADE_PLAN S10.5 · T2.6 的一部分，这里先落到 scripts/）。
 *
 * 与旧 `serve.mjs` 的差别：
 * - 只服务 `dist/`，不再以整个仓库为根（旧版能读到 .git 与 .wrangler）
 * - 校验 Host，只接受 127.0.0.1 与 localhost（挡 DNS rebinding）
 * - 拒绝任何点开头的路径段（.git、.env、.wrangler…）
 * - 零依赖，只用 node:http / node:fs
 *
 * 用法：node scripts/serve.js [--port 4311] [--root dist]
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 解析 `--port N` 与 `--root <目录>`。 */
function parseArgs(argv) {
  const out = { port: 4311, root: join(REPO, 'dist') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--port') out.port = Number(argv[i + 1]);
    else if (argv[i] === '--root') out.root = normalize(join(REPO, argv[i + 1]));
  }
  return out;
}

const { port, root: ROOT } = parseArgs(process.argv.slice(2));
const PORT = Number.isFinite(port) ? port : 4311;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/** 只允许回环地址访问：Host 头决定服务给谁。 */
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** 路径里任何一段以点开头就拒绝，避免 `..` 与 `.git` 之类。 */
function hasDotSegment(p) {
  return p.split('/').some((seg) => seg.startsWith('.') && seg !== '');
}

const server = createServer(async (req, res) => {
  // Host 校验：DNS rebinding 的第一道闸
  const host = String(req.headers.host || '').split(':')[0];
  if (!ALLOWED_HOSTS.has(host)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('forbidden host');
    return;
  }

  try {
    const { pathname } = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    let p = decodeURIComponent(pathname);

    if (hasDotSegment(p)) throw new Error('dot segment');
    if (p === '/' || p.endsWith('/')) p += 'index.html';

    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT + sep)) throw new Error('outside root');

    const st = await stat(file);
    if (!st.isFile()) throw new Error('not a file');

    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`IndexAI serving ${ROOT} at http://127.0.0.1:${PORT}/`);
});
