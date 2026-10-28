/**
 * 本地预览服务器的边界（T2.6 · F50）。
 *
 * 它是给本机用的，但「本机」不等于「安全」：
 * - 根目录取自 cwd，从别的目录启动就会把整个仓库（含 .env）暴露出去；
 * - 没拒绝以点开头的路径段，`/.git/config` 能直接读；
 * - 没校验 Host，恶意页面可以用 DNS rebinding 读本地文件。
 *
 * 这里只测导出的纯函数，不起真服务器。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('本地预览服务器的边界检查（F50）', () => {
  let serve;

  test('加载导出', async () => {
    serve = await import('../../scripts/serve.js');
    assert.equal(typeof serve.resolvePath, 'function');
    assert.equal(typeof serve.hostAllowed, 'function');
    assert.ok(serve.ROOT.endsWith('dist'), `根目录应是 dist，实际 ${serve.ROOT}`);
  });

  test('根目录固定在脚本旁边的 dist/，不依赖 cwd', () => {
    assert.ok(serve.ROOT.endsWith('dist'), serve.ROOT);
    assert.ok(!serve.ROOT.includes('process.cwd'), '不该用 cwd 拼根目录');
  });

  test('拒绝以点开头的路径段', () => {
    for (const bad of ['/.git/config', '/.env', '/a/.hidden/b', '/.ralph/DONE']) {
      assert.equal(serve.resolvePath(bad), null, `${bad} 不该放行`);
    }
  });

  test('拒绝越出根目录的路径', () => {
    for (const bad of ['/../package.json', '/a/../../x', '/%2e%2e/secret']) {
      assert.equal(serve.resolvePath(bad), null, `${bad} 不该放行`);
    }
  });

  test('正常路径映射到 dist 下', () => {
    const got = serve.resolvePath('/index.html');
    assert.ok(got?.startsWith(serve.ROOT), String(got));
    assert.ok(got.endsWith('index.html'));
  });

  test('目录请求补 index.html', () => {
    assert.ok(serve.resolvePath('/').endsWith('index.html'));
    assert.ok(serve.resolvePath('/sub/').endsWith('index.html'));
  });

  test('Host 只接受 127.0.0.1 与 localhost 加端口', () => {
    assert.equal(serve.hostAllowed('127.0.0.1:4311'), true);
    assert.equal(serve.hostAllowed('localhost:4311'), true);
    assert.equal(serve.hostAllowed('evil.example:4311'), false);
    assert.equal(serve.hostAllowed('127.0.0.1.evil.com:4311'), false);
    assert.equal(serve.hostAllowed(''), false);
    assert.equal(serve.hostAllowed(undefined), false);
  });
});
