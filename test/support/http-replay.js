/**
 * HTTP 回放（UPGRADE_PLAN S2.1 · INV-7）。
 *
 * 以 `node --import ./test/support/http-replay.js` 预加载本模块，它替换
 * `globalThis.fetch`，把真实网络请求换成从 `fixtures/http/` 读文件。
 *
 * 设计约束：
 * - 同步读文件，返回已决的 Promise。并发请求的完成顺序因此确定，
 *   中转站探测与 Luma 并发池的输出顺序不随事件循环抖动。
 * - 未录制的请求直接抛错，错误信息带完整 URL，避免静默通过。
 * - 支持故障注入，供后续用例模拟 404 / 网络错误 / 永不返回。
 *
 * 录制侧见 `http-record.js`：两者共用这里的键与文件格式。
 */

import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(HERE, '..', '..', 'fixtures', 'http');

/** 夹具根目录。测试可用 INDEXAI_FIXTURE_ROOT 指到临时目录。 */
export function fixtureRoot() {
  return process.env.INDEXAI_FIXTURE_ROOT || DEFAULT_ROOT;
}

/** 超过这个字节数的正文用 gzip+base64 存储。 */
export const INLINE_LIMIT = 64 * 1024;

/**
 * 请求键：`sha1('GET ' + url)`。
 * 只支持 GET；其他方法在录制与回放里都显式拒绝，避免误以为被覆盖。
 */
export function requestKey(method, url) {
  return createHash('sha1').update(`${method} ${url}`).digest('hex');
}

/** 录制文件路径：`fixtures/http/<host>/<sha1>.json`。 */
export function fixturePath(url) {
  const { host } = new URL(url);
  return join(fixtureRoot(), host, `${requestKey('GET', url)}.json`);
}

/** 读取一条录制记录；不存在返回 null。 */
export function readFixture(url) {
  const path = fixturePath(url);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** 给定记录，还原成 { status, body, finalUrl, contentType }。 */
export function decodeRecord(record) {
  const { body, encoding } = record;
  let text;
  if (encoding === 'gzip+base64') {
    text = gunzipSync(Buffer.from(body, 'base64')).toString('utf8');
  } else {
    text = body;
  }
  return {
    status: record.status,
    body: text,
    finalUrl: record.finalUrl ?? record.url,
    contentType: record.contentType ?? '',
  };
}

/* ────────────────────────── 故障注入 ────────────────────────── */

/**
 * 故障表：键是主机名或 URL 前缀，值是故障描述。
 *   { status: 404 }         —— 直接返回该状态码，空正文
 *   { networkError: '...' } —— 抛 TypeError，模拟连接失败
 *   { hang: true }          —— 返回永不 settle 的 Promise
 *   { body: '...', status?: number } —— 自定义正文
 */
let faults = loadEnvFaults();

function loadEnvFaults() {
  const raw = process.env.INDEXAI_FAULTS;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`INDEXAI_FAULTS 不是合法 JSON：${raw}`);
  }
}

/** 替换整张故障表（测试进程内调用）。 */
export function setFaults(next) {
  faults = next ?? {};
}

/** 追加一条故障。 */
export function addFault(pattern, fault) {
  faults[pattern] = fault;
}

/** 清空故障表。 */
export function clearFaults() {
  faults = {};
}

function matchFault(url) {
  const { host } = new URL(url);
  if (faults[host]) return faults[host];
  for (const [pattern, fault] of Object.entries(faults)) {
    if (pattern.includes('/') && url.startsWith(pattern)) return fault;
  }
  return null;
}

/* ────────────────────────── 回放实现 ────────────────────────── */

/**
 * 按记录构造 Response。`finalUrl` 覆盖 Response.url，
 * 因为中转站探测靠读 `response.url` 判断是否被 301 到别的域。
 */
function buildResponse(record) {
  const { status, body, finalUrl, contentType } = decodeRecord(record);
  const response = new Response(status === 204 || status === 304 ? null : body, {
    status,
    headers: contentType ? { 'content-type': contentType } : {},
  });
  // Response.url 是只读的；用一个普通对象包装，只暴露需要的字段。
  Object.defineProperty(response, 'url', { value: finalUrl, configurable: true });
  return response;
}

/**
 * 回放用的 fetch。同步读盘，立即 resolve，保证顺序确定。
 * @param {string|URL|Request} input
 * @param {RequestInit} [init]
 */
export function replayFetch(input, init = {}) {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = (
    init.method ??
    (typeof input === 'object' && 'method' in input ? input.method : 'GET') ??
    'GET'
  ).toUpperCase();

  if (method !== 'GET') {
    throw new Error(`回放只支持 GET，收到 ${method} ${url}`);
  }

  const fault = matchFault(url);
  if (fault) {
    if (fault.hang) return new Promise(() => {});
    if (fault.networkError) throw new TypeError(fault.networkError);
    return Promise.resolve(
      buildResponse({
        url,
        finalUrl: url,
        status: fault.status ?? 200,
        contentType: 'text/plain',
        encoding: 'identity',
        body: fault.body ?? '',
      }),
    );
  }

  const record = readFixture(url);
  if (!record) {
    throw new Error(
      `未录制的请求：GET ${url}\n` +
        `期望文件：${fixturePath(url)}\n` +
        `用 npm run record 录制，或补一条 fixture。`,
    );
  }

  return Promise.resolve(buildResponse(record));
}

/** 安装回放 fetch。幂等，便于多处调用。 */
export function installReplay() {
  globalThis.fetch = replayFetch;
}

// 只在被显式要求时安装。被其他模块 import 不得改变 globalThis.fetch，
// 否则测试里的真实请求会被悄悄换成回放（T0.2 踩过）。
//   node --import ./test/support/http-replay.js ...   → argv[1] 是本文件
//   INDEXAI_REPLAY=1                                   → 显式打开
if (process.env.INDEXAI_REPLAY === '1' || isPreload()) {
  installReplay();
}

function isPreload() {
  return Boolean(process.argv[1] && process.argv[1].endsWith('http-replay.js'));
}
