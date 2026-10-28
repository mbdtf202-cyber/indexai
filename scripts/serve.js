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

const ARGS = parseArgs(process.argv.slice(2));
/** 站点根目录：默认脚本旁边的 dist/，与从哪启动无关（F50）。 */
export const ROOT = ARGS.root;
const PORT = Number.isFinite(ARGS.port) ? ARGS.port : 4311;

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

/**
 * 把请求路径映射成磁盘路径；不安全时返回 null。
 * @param {string} pathname 来自 URL 的 pathname（未解码）
 * @returns {string|null}
 */
export function resolvePath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  // 任何一段以点开头都拒绝：点文件、点目录，以及 . 与 ..
  for (const seg of decoded.split('/')) {
    if (seg.startsWith('.')) return null;
  }
  let p = decoded;
  if (p === '/' || p.endsWith('/')) p += 'index.html';
  const file = normalize(join(ROOT, p));
  if (!file.startsWith(ROOT + sep)) return null;
  return file;
}

/**
 * Host 白名单：只接受本机回环地址，避免 DNS rebinding 把本地文件读走。
 * @param {string|undefined} host
 * @returns {boolean}
 */
export function hostAllowed(host) {
  if (!host) return false;
  const hostname = String(host).split(':')[0];
  return ALLOWED_HOSTS.has(hostname);
}

/** 只在直接运行时监听；被测试 import 时什么都不做。 */
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const server = createServer(async (req, res) => {
    if (!hostAllowed(req.headers.host)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('forbidden host');
      return;
    }
    try {
      const { pathname } = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
      const file = resolvePath(pathname);
      if (!file) throw new Error('rejected');
      if (!(await stat(file)).isFile()) throw new Error('not a file');
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
}
