/**
 * 许可文件与声明（T2.9 · D7 · F51）。
 *
 * 没有 LICENSE 的仓库默认「保留所有权利」——即使 package.json 写着 MIT。
 * 这不是细节：别人想用这份代码或数据时，找不到授权就等于没有授权。
 *
 * D7 的决定是分裂的，且必须**在文件里说清楚**：
 * - 代码 MIT；
 * - `curated/` 等自有整理数据 CC BY 4.0（署名即可用，包括商用）；
 * - 上游数据按各自许可，署名清单在数据页（T5.10）。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('许可（T2.9 · D7）', () => {
  test('根目录有 LICENSE', () => {
    assert.ok(existsSync(join(ROOT, 'LICENSE')), 'LICENSE 缺失');
  });

  test('LICENSE 是 MIT 全文，且版权行正确', () => {
    const text = readFileSync(join(ROOT, 'LICENSE'), 'utf8');
    assert.match(text, /MIT License/);
    assert.match(text, /Permission is hereby granted, free of charge/i);
    assert.match(text, /WITHOUT WARRANTY OF ANY KIND/i);
    assert.match(text, /Copyright \(c\) 2026 mbdtf202-cyber/, '版权行应与 D7 一致');
  });

  test('LICENSE 里说明了数据部分是 CC BY 4.0（不是整仓 MIT）', () => {
    const text = readFileSync(join(ROOT, 'LICENSE'), 'utf8');
    assert.match(
      text,
      /CC BY 4\.0|Creative Commons Attribution 4\.0/i,
      '要写明数据的许可是 CC BY 4.0',
    );
    assert.match(text, /curated/i, '要点名适用范围');
    assert.match(text, /上游|upstream/i, '要说明上游数据不归本项目授权');
  });

  test('package.json 的 license 字段与 LICENSE 一致', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.license, 'MIT');
  });

  test('README 有「许可」一节，且提到 CC BY 4.0 与上游署名', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    const idx = readme.search(/^## .*许可/m);
    assert.ok(idx >= 0, 'README 缺少许可一节');
    const section = readme.slice(idx, idx + 1200);
    assert.match(section, /MIT/);
    assert.match(section, /CC BY 4\.0/);
    assert.match(section, /上游/);
  });

  test('R8 根目录白名单包含 LICENSE', () => {
    const inv = readFileSync(join(ROOT, 'scripts', 'check-invariants.js'), 'utf8');
    assert.match(inv, /'LICENSE'/, '白名单要加 LICENSE，否则 R8 会判违例');
  });
});
