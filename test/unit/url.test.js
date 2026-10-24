/**
 * 外链白名单（T1.12 · F46 · INV-14）。
 *
 * F46：外部链接只做了 HTML 转义、没校验协议——情报、挂单、活动的第三方 URL
 * 直接进 href，`javascript:` 会被当成可执行脚本。转义解决的是「引号逃逸」，
 * 不解决「协议本身可执行」。
 *
 * 这里钉住 safeUrl 的判定：只放行 http / https 绝对地址，其余一律当不可用。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// 先用前导空白的 javascript: 复现一次真实攻击面
const ATTACKS = [
  'javascript:alert(1)',
  'JAVASCRIPT:alert(1)',
  'JaVaScRiPt:alert(document.cookie)',
  '  javascript:alert(1)',
  '\tjavascript:alert(1)',
  '\njavascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
  'ftp://files.example.com/x',
  'blob:https://x/1',
];

const OK = [
  'https://example.com/a',
  'http://example.com/a',
  'HTTPS://EXAMPLE.COM/A',
  '  https://example.com/trimmed  ',
  'https://example.com/path?q=1#frag',
];

describe('safeUrl（T1.12 · F46）', () => {
  let safeUrl;
  let isSafeUrl;

  test('加载 lib/url.js', async () => {
    const mod = await import('../../lib/url.js');
    safeUrl = mod.safeUrl;
    isSafeUrl = mod.isSafeUrl;
    assert.equal(typeof safeUrl, 'function');
    assert.equal(typeof isSafeUrl, 'function');
  });

  for (const bad of ATTACKS) {
    test(`拒绝 ${JSON.stringify(bad)}`, () => {
      assert.equal(isSafeUrl(bad), false, `${bad} 不该被判为安全`);
      assert.equal(safeUrl(bad), null, `${bad} 不该返回可用地址`);
    });
  }

  for (const good of OK) {
    test(`放行 ${JSON.stringify(good)}`, () => {
      assert.equal(isSafeUrl(good), true, `${good} 是正常外链`);
      assert.match(safeUrl(good), /^https?:\/\//i);
    });
  }

  test('相对地址与空值一律不放行（外链必须绝对）', () => {
    for (const bad of ['/relative/path', 'relative.html', '', '   ', null, undefined, '#anchor']) {
      assert.equal(isSafeUrl(bad), false, `${JSON.stringify(bad)} 不该放行`);
      assert.equal(safeUrl(bad), null);
    }
  });

  test('返回的是规范化后的地址（去掉前导空白、协议小写）', () => {
    assert.equal(safeUrl('  HTTPS://EXAMPLE.COM/A  '), 'https://example.com/A');
  });

  test('大小写混写与空白混排都拦得住', () => {
    assert.equal(isSafeUrl(' \n\tJaVaScRiPt:alert(1)  '), false);
  });
});
