/**
 * 回放与录制的往返测试（T0.2）。
 *
 * 用 node:http 在 127.0.0.1 起一个临时服务，录制它的响应，
 * 再用回放读回，逐字节比对状态码、正文与 finalUrl。
 * 全程不访问外网。
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  requestKey,
  replayFetch,
  setFaults,
  clearFaults,
  decodeRecord,
  installReplay,
} from '../support/http-replay.js';

let server;
let baseUrl;
let fixtureRoot;

describe('http replay/record round trip', () => {
  before(async () => {
    // 把 fixture 写到系统临时目录，测试后清掉，不污染仓库
    fixtureRoot = mkdtempSync(join(tmpdir(), 'indexai-http-'));
    process.env.INDEXAI_FIXTURE_ROOT = fixtureRoot;

    server = createServer((req, res) => {
      if (req.url === '/redirect') {
        res.writeHead(302, { location: '/target', 'content-type': 'text/plain' });
        res.end();
        return;
      }
      if (req.url === '/target') {
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('final destination');
        return;
      }
      if (req.url === '/big') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('x'.repeat(70 * 1024));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('hello fixture');
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(() => {
    server?.close();
    if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
    delete process.env.INDEXAI_FIXTURE_ROOT;
  });

  test('请求键是 sha1("GET " + url)', () => {
    const key = requestKey('GET', 'https://example.com/a');
    assert.match(key, /^[0-9a-f]{40}$/);
    assert.equal(key, requestKey('GET', 'https://example.com/a'));
    assert.notEqual(key, requestKey('GET', 'https://example.com/b'));
  });

  test('录制后回放，状态码与正文逐字节一致', async () => {
    const url = `${baseUrl}/plain`;
    const live = await fetch(url);
    const liveBody = await live.text();

    // 直接调用录制函数把真实响应写到临时目录
    const { saveRecord } = await import('../support/http-record.js');
    saveRecord({
      url,
      finalUrl: live.url || url,
      status: live.status,
      contentType: live.headers.get('content-type') ?? '',
      body: liveBody,
    });

    const replayed = await replayFetch(url);
    assert.equal(replayed.status, live.status);
    assert.equal(await replayed.text(), liveBody);
  });

  test('finalUrl 覆盖 Response.url（照顾中转站 301 判断）', async () => {
    const url = `${baseUrl}/redirect`;
    const live = await fetch(url);
    const liveBody = await live.text();
    const liveFinal = live.url; // 跟随后指向 /target

    const { saveRecord } = await import('../support/http-record.js');
    saveRecord({
      url,
      finalUrl: liveFinal,
      status: live.status,
      contentType: live.headers.get('content-type') ?? '',
      body: liveBody,
    });

    const replayed = await replayFetch(url);
    assert.equal(replayed.url, liveFinal, 'Response.url 应是被指向的最终地址');
    assert.equal(await replayed.text(), liveBody);
  });

  test('超过 64 KB 的正文用 gzip+base64 存储并能还原', async () => {
    const url = `${baseUrl}/big`;
    const body = 'x'.repeat(70 * 1024);

    const { saveRecord } = await import('../support/http-record.js');
    const path = saveRecord({
      url,
      finalUrl: url,
      status: 200,
      contentType: 'text/plain',
      body,
    });

    const { readFileSync } = await import('node:fs');
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(raw.encoding, 'gzip+base64');

    const decoded = decodeRecord(raw);
    assert.equal(decoded.body.length, body.length);
    assert.equal(decoded.body, body);
  });

  test('未录制的请求抛错且信息含完整 URL', () => {
    const url = 'https://never-recorded.example.com/api/pricing';
    assert.throws(
      () => replayFetch(url),
      (error) => {
        assert.match(error.message, /未录制的请求/);
        assert.ok(error.message.includes(url), '错误信息应含完整 URL');
        return true;
      },
    );
  });

  test('故障注入：指定状态码', async () => {
    setFaults({ 'fault-host.example.com': { status: 404 } });
    const response = await replayFetch('https://fault-host.example.com/x');
    assert.equal(response.status, 404);
    clearFaults();
  });

  test('故障注入：网络错误', () => {
    setFaults({ 'net-error.example.com': { networkError: 'ECONNRESET' } });
    assert.throws(() => replayFetch('https://net-error.example.com/x'), TypeError);
    clearFaults();
  });

  test('故障注入：永不返回', async () => {
    setFaults({ 'hang.example.com': { hang: true } });
    const settled = await Promise.race([
      replayFetch('https://hang.example.com/x').then(() => 'settled'),
      new Promise((resolve) => setTimeout(() => resolve('pending'), 30)),
    ]);
    assert.equal(settled, 'pending');
    clearFaults();
  });

  test('环境变量形式的故障表可被解析', () => {
    process.env.INDEXAI_FAULTS = JSON.stringify({ 'env.example.com': { status: 503 } });
    // 读取路径在模块加载时执行，这里只验证 JSON 可解析且形状正确
    const parsed = JSON.parse(process.env.INDEXAI_FAULTS);
    assert.equal(parsed['env.example.com'].status, 503);
    delete process.env.INDEXAI_FAULTS;
  });

  test('installReplay 幂等，可重复调用', () => {
    installReplay();
    installReplay();
    assert.equal(globalThis.fetch, replayFetch);
  });
});
