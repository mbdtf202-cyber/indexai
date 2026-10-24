/**
 * 统一 HTTP 客户端（T1.4 · F05 · INV-8 · S2.1）。
 *
 * F05 的问题：只有中转站探测和情报两处设了超时，Devpost / Luma / Devfolio /
 * aibijia / 汇率 / GitHub / OpenRouter / AA / HN 全靠 undici 默认值（分钟级）。
 * 一个 CDN 卡住，整次采集就挂在那里等 job 超时。
 *
 * 这里把「边界」逐条钉住：
 * - 每个请求必有超时，且不能超过调用方给的截止时间；
 * - 只重试幂等 GET 的网络错误与 408/429/5xx，遵守 Retry-After；
 * - 只放行 http(s)，重定向目标同样校验；
 * - 统一 UA 带版本与站点地址；
 * - 按主机记账（请求数、字节、状态码分布、重试、被限流次数、等待时长）。
 *
 * 这些用例不碰网络：`fetch` 由本文件注入。
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

/** 每个用例自己安排响应，可以是 Response，也可以是抛错/挂住。 */
let handler = async () => new Response('ok', { status: 200 });
const calls = [];

function install() {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push({ url, init });
    return handler(url, init);
  };
}

describe('lib/http.js', () => {
  let http;

  before(async () => {
    install();
    http = await import('../../lib/http.js');
    http.resetHttpStats();
  });

  test('每个请求都带超时信号', async () => {
    calls.length = 0;
    handler = async () => new Response('ok', { status: 200 });

    await http.httpGet('https://example.test/a', { timeoutMs: 1234 });

    assert.equal(calls.length, 1);
    const signal = calls[0].init.signal;
    assert.ok(signal, '必须带上 AbortSignal，否则源端不响应就一直等');
    assert.equal(signal.aborted, false);
  });

  test('调用方的截止时间比默认值更紧时，取更紧的那个', async () => {
    calls.length = 0;
    handler = async () => new Response('ok', { status: 200 });

    // 给一个已经过期的截止时间：请求应当立刻超时，而不是等默认的 20 秒
    const deadline = Date.now() - 1;
    await assert.rejects(
      () => http.httpGet('https://example.test/b', { deadline }),
      /超时|abort/i,
      '过了截止时间就不该再发请求',
    );
  });

  test('网络错误会重试，次数用尽后抛出带主机的错误', async () => {
    calls.length = 0;
    handler = async () => {
      throw new TypeError('fetch failed');
    };

    await assert.rejects(
      () => http.httpGet('https://flaky.test/c', { tries: 3, backoffMs: 1 }),
      /flaky\.test/,
    );
    assert.equal(calls.length, 3, '默认重试 3 次');
  });

  test('429 会遵守 Retry-After 并计入被限流次数', async () => {
    calls.length = 0;
    let n = 0;
    handler = async () => {
      n += 1;
      if (n === 1) {
        return new Response('', { status: 429, headers: { 'retry-after': '1' } });
      }
      return new Response('ok', { status: 200 });
    };

    const res = await http.httpGet('https://limited.test/d', { tries: 2, backoffMs: 1 });
    assert.equal(res.status, 200);

    const stats = http.httpStats()['limited.test'];
    assert.equal(stats.throttled, 1, '被限流次数要记账');
    assert.ok(stats.waitedMs >= 1, 'Retry-After 的等待要计入');
  });

  test('4xx（非 429）不重试', async () => {
    calls.length = 0;
    handler = async () => new Response('nope', { status: 404 });

    const res = await http.httpGet('https://example.test/e', { tries: 3, backoffMs: 1 });
    assert.equal(res.status, 404, '4xx 是终态，交回调用方判断');
    assert.equal(calls.length, 1, '404 不该被重试');
  });

  test('重定向目标是别的域时也要过协议校验', async () => {
    calls.length = 0;
    handler = async () =>
      new Response('', {
        status: 302,
        headers: { location: 'ftp://files.test/x' },
      });

    await assert.rejects(
      () => http.httpGet('https://example.test/f', { backoffMs: 1 }),
      /协议/,
      '重定向到非 http(s) 必须拒绝',
    );
  });

  test('只放行 http / https', async () => {
    for (const bad of [
      'file:///etc/passwd',
      'ftp://a.test/x',
      'javascript:alert(1)',
      'data:text/plain,x',
    ]) {
      await assert.rejects(() => http.httpGet(bad), /协议/, `应当拒绝 ${bad}`);
    }
  });

  test('统一 UA 带版本与站点地址', async () => {
    calls.length = 0;
    handler = async () => new Response('ok', { status: 200 });
    await http.httpGet('https://example.test/g');

    const ua = calls[0].init.headers['User-Agent'] ?? calls[0].init.headers['user-agent'];
    assert.ok(ua, '必须带 UA');
    assert.match(ua, /^IndexAI\/\d+\.\d+\.\d+ \(\+https:\/\//, `UA 形态不对：${ua}`);
  });

  test('按主机记账：请求数、字节、状态码分布', async () => {
    http.resetHttpStats();
    handler = async () => new Response('0123456789', { status: 200 });

    // 字节数在「读正文」时累加：只发请求不读内容，就不该记流量
    const r1 = await http.httpGet('https://counted.test/h');
    await r1.text();
    const r2 = await http.httpGet('https://counted.test/i');
    await r2.text();

    const stats = http.httpStats()['counted.test'];
    assert.equal(stats.requests, 2);
    assert.ok(stats.bytes >= 20, `字节数应累加，实际 ${stats.bytes}`);
    assert.equal(stats.status['200'], 2);
  });
});

describe('层不会被一个挂住的请求拖死（F05 的现场）', () => {
  let http;

  before(async () => {
    install();
    http = await import('../../lib/http.js');
  });

  test('永不返回的源在超时后抛错，而不是一直挂住', async () => {
    // 真实 fetch 在 signal 中止时会 reject；测试替身必须模拟这一点，
    // 否则用例会挂住（这不是客户端的缺陷）。
    handler = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'TimeoutError';
          reject(err);
        });
      });

    const started = Date.now();
    await assert.rejects(
      () => http.httpGet('https://hang.test/x', { tries: 1, timeoutMs: 50 }),
      /hang\.test: 超时/,
    );
    const elapsed = Date.now() - started;

    assert.ok(elapsed < 2000, `应当在一个超时周期内返回，实际 ${elapsed}ms`);
  });

  test('调用方把这类失败写成 stale，而不是让整层消失', async () => {
    // collect.mjs 的 T.run 就是这个模式：失败 + 有上一版 → stale 并沿用。
    // 这里只验证「错误可被判为失败」，沿用的语义由 bench/luma 的用例覆盖。
    handler = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'TimeoutError';
          reject(err);
        });
      });
    let failed = false;
    try {
      await http.httpGet('https://hang.test/y', { tries: 1, timeoutMs: 50 });
    } catch {
      failed = true;
    }
    assert.equal(failed, true, '超时必须表现为可被 catch 的失败');
  });
});
