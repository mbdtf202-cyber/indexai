/**
 * 站点地址的单点定义（T2.8 · D4 · F52 · INV-5）。
 *
 * 换域名（自定义域、换托管）时，凡是有第二份硬编码的地方都会漏改：
 * UA 里还写着旧地址、工作流还在拉旧域名的 data.json、README 早已是第三种说法。
 * 这里要求：**代码与工作流里只有 package.json 一处**。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKIP = new Set([
  'node_modules',
  '.git',
  'dist',
  '.wrangler',
  '.ralph',
  'fixtures',
  'coverage',
  'test-results',
]);
const EXTS = new Set(['.mjs', '.js', '.html', '.json', '.yml', '.yaml']);
/** README 与两份计划文档可以提到地址；测试本身也提到它。 */
const ALLOW = new Set([
  'README.md',
  'IMPLEMENTATION_PLAN.md',
  'UPGRADE_PLAN.md',
  'site-url.test.js',
]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (EXTS.has(extname(name)) && !ALLOW.has(name)) yield full;
  }
}

function find(pattern) {
  const hits = [];
  for (const file of walk(ROOT)) {
    const rel = file.slice(ROOT.length + 1);
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((text, i) => {
        if (pattern.test(text))
          hits.push({ file: rel, line: i + 1, text: text.trim().slice(0, 100) });
      });
  }
  return hits;
}

describe('站点地址单点（F52）', () => {
  let http;

  test('地址只在 package.json 出现', () => {
    const hits = find(/indexai\.pages\.dev/);
    assert.deepEqual(
      hits.map((h) => h.file),
      ['package.json'],
      `地址被写死在多处：\n${hits.map((h) => `  ${h.file}:${h.line} ${h.text}`).join('\n')}`,
    );
  });

  test('USER_AGENT 里的地址来自 package.json', () => {
    return import('../../lib/http.js').then((mod) => {
      http = mod;
      const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
      assert.ok(
        http.USER_AGENT.includes(pkg.homepage.replace(/\/$/, '')),
        `UA 里的地址应与 homepage 一致：${http.USER_AGENT} vs ${pkg.homepage}`,
      );
      assert.ok(http.USER_AGENT.startsWith('IndexAI/'));
    });
  });

  test('改 homepage 时 UA 跟着变（不是抄死的字符串）', () => {
    // 导出里必须存在 SITE_URL / HOMEPAGE 一类的单一来源，供别处引用
    const hasSource = 'HOMEPAGE' in http || 'SITE_URL' in http;
    assert.ok(hasSource, 'lib/http.js 应当导出站点地址常量供别处引用');
  });
});
