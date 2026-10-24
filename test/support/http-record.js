/**
 * HTTP 录制（UPGRADE_PLAN S2.1 · T0.2）。
 *
 * 以 `node --import ./test/support/http-record.js` 预加载，用真实 fetch
 * 请求并把结果写到 `fixtures/http/`。与回放共用键与文件格式。
 *
 * 边界（INV-3 / S10.4）：
 * - 不保存任何请求头，响应只留状态码、最终 URL、content-type 与正文。
 * - 只允许 GET。
 * - 每个上游每天最多录一次由调用方保证；本模块只做落盘。
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(HERE, '..', '..', 'fixtures', 'http');
const INLINE_LIMIT = 64 * 1024;

/** 夹具根目录。测试可用 INDEXAI_FIXTURE_ROOT 指到临时目录。 */
export function fixtureRoot() {
  return process.env.INDEXAI_FIXTURE_ROOT || DEFAULT_ROOT;
}

const realFetch = globalThis.fetch;

/** 已录制过的 URL，避免同一次运行重复落盘。 */
const recorded = new Set();

function key(method, url) {
  return createHash('sha1').update(`${method} ${url}`).digest('hex');
}

function pathFor(url) {
  const { host } = new URL(url);
  return join(fixtureRoot(), host, `${key('GET', url)}.json`);
}

/**
 * 把一次响应落盘。
 * 正文超过 64 KB 时存 gzip+base64，保持仓库体积可控。
 */
export function saveRecord({ url, finalUrl, status, contentType, body }) {
  const path = pathFor(url);
  mkdirSync(dirname(path), { recursive: true });

  const bytes = Buffer.byteLength(body, 'utf8');
  const record =
    bytes > INLINE_LIMIT
      ? {
          url,
          finalUrl,
          status,
          contentType,
          encoding: 'gzip+base64',
          body: gzipSync(Buffer.from(body, 'utf8')).toString('base64'),
        }
      : { url, finalUrl, status, contentType, encoding: 'identity', body };

  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
  return path;
}

/** 录制用的 fetch。 */
export async function recordFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = (init.method ?? 'GET').toUpperCase();

  if (method !== 'GET') {
    throw new Error(`录制只支持 GET，收到 ${method} ${url}`);
  }

  if (recorded.has(url) && existsSync(pathFor(url))) {
    // 同一 URL 本次已录过，直接复用，避免重复请求上游（S10.4）
    const { readFileSync } = await import('node:fs');
    const existing = JSON.parse(readFileSync(pathFor(url), 'utf8'));
    const { decodeRecord } = await import('./http-replay.js');
    const decoded = decodeRecord(existing);
    return new Response(decoded.body, {
      status: decoded.status,
      headers: decoded.contentType ? { 'content-type': decoded.contentType } : {},
    });
  }

  const response = await realFetch(input, init);
  const body = await response.text();

  saveRecord({
    url,
    finalUrl: response.url || url,
    status: response.status,
    contentType: response.headers.get('content-type') ?? '',
    body,
  });
  recorded.add(url);

  return new Response(body, {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') ?? '' },
  });
}

export function installRecorder() {
  globalThis.fetch = recordFetch;
}

/**
 * 作为 `node --import ./test/support/http-record.js <脚本>` 预加载时安装录制，
 * 随后由 `<脚本>` 发起请求。单独运行（argv[1] 是本文件）时给出用法提示。
 */
if (process.argv[1]?.endsWith('http-record.js')) {
  console.error(
    [
      '录制需要指定跑哪个脚本，例如：',
      '  npm run record -- ./scripts/record-sample.js',
      '本模块只负责把 fetch 换成录制版；具体请求由被指定的脚本发起。',
    ].join('\n'),
  );
  process.exit(2);
}

installRecorder();
