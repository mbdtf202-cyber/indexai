/**
 * 统一 HTTP 客户端（S2.1 · INV-8）。
 *
 * 全项目唯一的网络出口：采集端不得直接 `fetch`，也不得自己 sleep 等重试。
 * 它负责四件事，都在这里收口：
 *
 * 1. **超时**：每个请求必有超时，并与调用方给的截止时间取更紧的那个。
 *    F05 的问题就是大部分请求没有超时，CDN 一卡就等到 job 超时。
 * 2. **重试**：只对幂等 GET 的网络错误与 408 / 429 / 5xx 重试，指数退避加抖动，
 *    遵守 `Retry-After`。4xx 是终态，直接交回调用方判断。
 * 3. **协议**：只放行 http / https，重定向目标同样校验。
 * 4. **记账**：按主机统计请求数、字节、状态码分布、重试次数、被限流次数、等待时长。
 *    这些数字进 run-report，用来回答「这次为什么慢/为什么少了」。
 *
 * 三种模式由回放层负责（见 `test/support/http-replay.js`）：
 * live / record / replay 都只是换掉 `globalThis.fetch`，本模块永远只调 fetch。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sleep } from './clock.js';

/* ────────────────────────── 身份与默认值 ────────────────────────── */

const HERE = dirname(fileURLToPath(import.meta.url));

/** 读 package.json 的版本与 homepage：换域名只改一处（D4、S9.9）。 */
function pkg() {
  try {
    return JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));
  } catch {
    return { version: '0.0.0', homepage: 'https://indexai.pages.dev/' };
  }
}

const { version: VERSION, homepage: HOMEPAGE } = pkg();

/** 统一 UA：站点地址必须在里面，对上游客气（S10.4）。 */
export const USER_AGENT = `IndexAI/${VERSION} (+${HOMEPAGE.replace(/\/$/, '')})`;

/** 默认超时：首字节 20 秒、总计 60 秒（S2.1）。 */
export const DEFAULT_TIMEOUT_MS = 60_000;

/** 默认重试次数（含首次）。 */
export const DEFAULT_TRIES = 3;

/** 是否可重试的状态码。4xx 里只有 408 / 429 值得重来。 */
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

/* ────────────────────────── 记账 ────────────────────────── */

/** 主机 → 计数。跨层共享，最后并进 meta.net。 */
let stats = new Map();

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return '(invalid)';
  }
}

function bucket(host) {
  let s = stats.get(host);
  if (!s) {
    s = { requests: 0, bytes: 0, retries: 0, throttled: 0, waitedMs: 0, status: {} };
    stats.set(host, s);
  }
  return s;
}

/** 清零（测试与单次运行开始时用）。 */
export function resetHttpStats() {
  stats = new Map();
}

/** 当前账目快照：`{ host: {...} }`，可直接序列化进 data.json。 */
export function httpStats() {
  const out = {};
  for (const [host, s] of [...stats.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    out[host] = { ...s, status: { ...s.status } };
  }
  return out;
}

/** 汇总：回答「这次一共发了多少请求、等了多少」而不必逐个主机看。 */
export function httpTotals() {
  let requests = 0;
  let bytes = 0;
  let retries = 0;
  let throttled = 0;
  let waitedMs = 0;
  for (const s of stats.values()) {
    requests += s.requests;
    bytes += s.bytes;
    retries += s.retries;
    throttled += s.throttled;
    waitedMs += s.waitedMs;
  }
  return { hosts: stats.size, requests, bytes, retries, throttled, waitedMs };
}

/* ────────────────────────── 协议校验 ────────────────────────── */

/** 只放行 http / https 绝对地址（INV-14：外部 URL 只允许这两个协议）。 */
export function assertHttpUrl(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    throw new Error(`不是合法 URL：${String(url).slice(0, 120)}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`只允许 http(s) 协议，收到 ${u.protocol}//${u.host}`);
  }
  return u;
}

/* ────────────────────────── 等待 ────────────────────────── */

/** 指数退避加抖动，封顶 8 秒。返回实际等待毫秒数。 */
function backoffMs(attempt, baseMs = 500) {
  const raw = baseMs * 2 ** attempt;
  const jitter = Math.random() * Math.min(250, raw * 0.25);
  return Math.min(8000, Math.round(raw + jitter));
}

/** 解析 Retry-After：秒数或 HTTP 日期，无法解析返回 null。 */
function retryAfterMs(header) {
  if (!header) return null;
  const n = Number(header);
  if (Number.isFinite(n) && n >= 0) return Math.round(n * 1000);
  const t = Date.parse(header);
  if (Number.isFinite(t)) return Math.max(0, t - Date.now());
  return null;
}

/* ────────────────────────── 请求 ────────────────────────── */

/**
 * 包一层 Response：读正文时把字节数记到对应主机。
 * 这样 httpText / httpJson / httpBuffer 之外的直接调用也能被记账，不会漏。
 */
function countingResponse(res, host) {
  const original = res.clone.bind(res);
  const counted = res;
  counted.clone = () => countingResponse(original(), host);
  const wrap = (fn) =>
    async function counted(...args) {
      const out = await fn.apply(counted, args);
      const size =
        typeof out === 'string'
          ? Buffer.byteLength(out, 'utf8')
          : out instanceof ArrayBuffer
            ? out.byteLength
            : out?.length
              ? out.length
              : 0;
      bucket(host).bytes += size;
      return out;
    };
  counted.text = wrap(counted.text.bind(counted));
  counted.json = wrap(counted.json.bind(counted));
  counted.arrayBuffer = wrap(counted.arrayBuffer.bind(counted));
  return counted;
}

/** 最多跟几跳。超过就当失败：中转站里有站会绕三四个域，不该无限跟。 */
const MAX_REDIRECTS = 5;

/**
 * 手动跟重定向。
 *
 * 不用 `redirect: 'follow'`：那样 fetch 会自己走完，我们拿不到中间的 Location，
 * 也就没法校验「跳到 ftp:// 或 file:// 算不算越界」（INV-14）。这里逐跳校验协议。
 */
async function followRedirects(startHref, { method, headers, signal }) {
  let href = startHref;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const res = await fetch(href, { method, headers, signal, redirect: 'manual' });
    const isRedirect = res.status >= 300 && res.status < 400;
    const location = isRedirect ? res.headers.get('location') : null;
    if (!isRedirect || !location) return res;

    const next = new URL(location, href);
    // 重定向目标同样只允许 http(s)
    assertHttpUrl(next.href);
    href = next.href;
    bucket(next.host).requests += 1;
  }
  throw new Error(`重定向次数超过 ${MAX_REDIRECTS} 跳：${startHref}`);
}

/**
 * 发一个 GET（或显式指定 method）。
 *
 * @param {string|URL} url
 * @param {object} [opt]
 * @param {number} [opt.tries] 次数（含首次），默认 3
 * @param {number} [opt.timeoutMs] 单次超时，默认 60 秒
 * @param {number} [opt.deadline] 绝对截止时间戳；与 timeoutMs 取更紧的那个
 * @param {number} [opt.backoffMs] 退避基数，默认 500
 * @param {string} [opt.label] 日志与错误信息里用的标签
 * @param {object} [opt.headers] 额外请求头
 * @param {AbortSignal} [opt.signal] 外部取消信号
 * @param {string} [opt.method] 默认 GET
 * @param {'follow'|'manual'|'error'} [opt.redirect] 保留字段：跟随逻辑由本模块自己实现
 * @returns {Promise<Response>} 成功（2xx / 3xx manual / 4xx）的响应；网络错误与重试用尽后抛错
 */
export async function httpGet(url, opt = {}) {
  const target = assertHttpUrl(url);
  const tries = Math.max(1, opt.tries ?? DEFAULT_TRIES);
  const timeoutMs = opt.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const backoff = opt.backoffMs ?? 500;
  const label = opt.label || target.pathname;
  const host = target.host;
  const s = bucket(host);

  let lastErr = null;

  for (let attempt = 0; attempt < tries; attempt += 1) {
    // 截止时间与单次超时取更紧的那个；已经过期就不要再发了
    const remaining = opt.deadline == null ? Number.POSITIVE_INFINITY : opt.deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`${host} 超时：已过截止时间（${label}）`);
    }
    const budget = Math.min(timeoutMs, remaining);

    const timeoutSignal = AbortSignal.timeout(Math.max(1, Math.floor(budget)));
    const signal = opt.signal ? AbortSignal.any([timeoutSignal, opt.signal]) : timeoutSignal;

    const headers = { 'User-Agent': USER_AGENT, Accept: '*/*', ...(opt.headers || {}) };
    if (opt.headers?.['User-Agent']) headers['User-Agent'] = opt.headers['User-Agent'];

    s.requests += 1;

    let res;
    try {
      res = await followRedirects(target.href, {
        method: opt.method ?? 'GET',
        headers,
        signal,
      });
    } catch (e) {
      lastErr = new Error(`${host}: ${e.name === 'TimeoutError' ? '超时' : e.message}`);
      if (attempt < tries - 1) {
        const wait = backoffMs(attempt, backoff);
        s.retries += 1;
        s.waitedMs += wait;
        console.warn(`[http] ${label} ${lastErr.message}，${wait}ms 后重试（${attempt + 1}/${tries}）`);
        await sleep(wait);
        continue;
      }
      break;
    }

    // 重定向目标也要过协议校验：fetch 跟随完的最终地址可能被换到别处
    if (res.url && res.url !== target.href) {
      assertHttpUrl(res.url);
    }

    s.status[res.status] = (s.status[res.status] || 0) + 1;

    if (res.status === 429) s.throttled += 1;

    if (!RETRYABLE.has(res.status)) {
      // 4xx（非 408/429）与 2xx 一样是终态：交回调用方判断，不在这里替它做决定
      return countingResponse(res, host);
    }

    lastErr = new Error(`${host}: HTTP ${res.status}`);
    if (attempt < tries - 1) {
      const hinted = retryAfterMs(res.headers.get('retry-after'));
      const wait = hinted ?? backoffMs(attempt, backoff);
      s.retries += 1;
      s.waitedMs += wait;
      console.warn(`[http] ${label} HTTP ${res.status}，${wait}ms 后重试（${attempt + 1}/${tries}）`);
      await sleep(wait);
      continue;
    }
    // 重试用尽：把最后一个响应交回去，让调用方按 status 处理（往往比抛错更有用）
    return countingResponse(res, host);
  }

  throw lastErr || new Error(`${host}: 请求失败`);
}

/**
 * 取文本：包一层，顺手记字节数。
 * @param {string} url
 * @param {object} [opt] 同 httpGet
 */
export async function httpText(url, opt = {}) {
  const res = await httpGet(url, { ...opt, headers: { Accept: 'text/html,application/json;q=0.9,*/*;q=0.8', ...(opt.headers || {}) } });
  const text = await res.text();
  return { status: res.status, ok: res.ok, url: res.url || url, text };
}

/**
 * 取 JSON：状态非 2xx 时抛错（JSON 源没有「部分成功」这回事）。
 * @param {string} url
 * @param {object} [opt] 同 httpGet
 */
export async function httpJson(url, opt = {}) {
  const res = await httpGet(url, { ...opt, headers: { Accept: 'application/json', ...(opt.headers || {}) } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${hostOf(url)}: HTTP ${res.status}${opt.label ? `（${opt.label}）` : ''}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${hostOf(url)}: JSON 解析失败（${e.message.slice(0, 80)}）`);
  }
}

/**
 * 取二进制：给 parquet 之类的资源用。
 * @param {string} url
 * @param {object} [opt] 同 httpGet
 */
export async function httpBuffer(url, opt = {}) {
  const res = await httpGet(url, opt);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) {
    throw new Error(`${hostOf(url)}: HTTP ${res.status}${opt.label ? `（${opt.label}）` : ''}`);
  }
  return buf;
}
