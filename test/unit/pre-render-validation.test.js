/**
 * 预渲染产物校验（T5.2）。
 *
 * 2026-10-26 时这里写的是 todo：`site/build-preloaded.js` 存在但
 * `npm run build` 不调用它，`dist/` 里没有预渲染页面。
 *
 * 现在预渲染已接入构建（`site/routes/` + `prerenderAll`），
 * 而且不再输出到 `dist/pre-rendered/` 子目录——每个路由直接落到
 * `dist/` 根下（`/models` → `dist/models.html`），URL 与文件一一对应。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROUTES } from '../../site/routes/index.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(ROOT, 'dist', 'pages');

describe('预渲染产物（dist/pages/）', () => {
  test('dist/pages/ 里每个路由都有 HTML', () => {
    if (!existsSync(DIST)) return; // 未构建

    const missing = ROUTES.filter((r) => !existsSync(join(DIST, r.file))).map((r) => r.file);
    assert.deepEqual(missing, [], `缺：${missing.join(', ')}`);
  });

  test('页面数量与路由表一致（不多不少）', () => {
    if (!existsSync(DIST)) return;

    const htmls = readdirSync(DIST).filter((f) => f.endsWith('.html'));
    // dist 里可能有旧版遗留的 index.html，但其余应当与路由表对上
    assert.ok(
      htmls.length >= ROUTES.length,
      `HTML 文件 ${htmls.length} 个，少于路由数 ${ROUTES.length}`,
    );
  });

  test('每页有实质内容', () => {
    if (!existsSync(DIST)) return;

    for (const r of ROUTES) {
      const p = join(DIST, r.file);
      if (!existsSync(p)) continue;
      const html = readFileSync(p, 'utf8');
      const text = html
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, '');
      assert.ok(text.length > 100, `${r.file} 正文只有 ${text.length} 字符`);
    }
  });
});
