/**
 * 命名统一（T2.3 · F32）。
 *
 * 项目从 FreeAI Radar 改名为 IndexAI 之后，旧名字在几处留了下来：
 * 采集脚本的头注释、UA 里的 `FreeAI-Radar/2.0`、localStorage 的 `fr.*` 前缀。
 * 这些不影响功能，但会让每个新读者多问一次「FreeAI 是什么？还在用吗？」。
 *
 * 这里把「旧名字必须清零」变成可执行检查，顺手锁住「UA 只有一份」这条
 * （S2.1 要求 UA 从 lib/http.js 统一发出，别处再写一份就会漂移）。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 扫描范围：源码、配置、工作流；跳过构建产物与依赖。 */
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
const EXTS = new Set(['.mjs', '.js', '.html', '.json', '.yml', '.yaml', '.css']);

/** 两份计划文档是历史记录，允许提到旧名字。 */
const ALLOW = new Set(['IMPLEMENTATION_PLAN.md', 'UPGRADE_PLAN.md', 'naming.test.js']);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (EXTS.has(extname(name)) && !ALLOW.has(name)) yield full;
  }
}

/** 全部命中：[{ file, line, text }]。 */
function find(pattern) {
  const hits = [];
  for (const file of walk(ROOT)) {
    const rel = file.slice(ROOT.length + 1);
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, i) => {
      if (pattern.test(text)) hits.push({ file: rel, line: i + 1, text: text.trim().slice(0, 90) });
    });
  }
  return hits;
}

describe('命名统一（F32）', () => {
  test('不再出现 FreeAI / FreeAI-Radar', () => {
    const hits = find(/FreeAI/i);
    assert.deepEqual(
      hits,
      [],
      `旧品牌残留：\n${hits.map((h) => `  ${h.file}:${h.line} ${h.text}`).join('\n')}`,
    );
  });

  test('localStorage 键统一用 idx. 前缀', () => {
    // 唯一允许出现旧键名的地方是「清理旧键」本身（removeItem）
    const hits = find(/["']fr\.(theme|density|fx)["']/).filter((h) => !/removeItem/.test(h.text));
    assert.deepEqual(
      hits,
      [],
      `旧键名残留：\n${hits.map((h) => `  ${h.file}:${h.line} ${h.text}`).join('\n')}`,
    );
  });

  test('UA 只在 lib/http.js 里定义', () => {
    // 允许 lib/http.js 自己写 UA，其它地方一律引用 USER_AGENT
    const hits = find(/User-Agent["']?\s*:\s*["'][^"']*IndexAI\//).filter(
      (h) => h.file !== join('lib', 'http.js'),
    );
    assert.deepEqual(
      hits,
      [],
      `重复的 UA：\n${hits.map((h) => `  ${h.file}:${h.line} ${h.text}`).join('\n')}`,
    );
  });

  test('不再有写死的 IndexAI/1.0 版本串', () => {
    const hits = find(/IndexAI\/1\.0/);
    assert.deepEqual(
      hits,
      [],
      `写死版本号：\n${hits.map((h) => `  ${h.file}:${h.line} ${h.text}`).join('\n')}`,
    );
  });
});

describe('lib/ 扩展名一致（T3.1a）', () => {
  test('lib/ 下没有 .mjs，全是 .js', () => {
    const dir = join(ROOT, 'lib');
    const mjs = readdirSync(dir).filter((f) => f.endsWith('.mjs'));
    assert.deepEqual(mjs, [], `lib/ 下还有 .mjs：${mjs.join(', ')}（T3.1a 统一为 .js）`);
  });

  test('没有指向旧扩展名的导入', () => {
    const hits = find(/lib\/(news|parquet)\.mjs/);
    assert.deepEqual(
      hits,
      [],
      `还在导入旧扩展名：\n${hits.map((h) => `  ${h.file}:${h.line}`).join('\n')}`,
    );
  });
});
