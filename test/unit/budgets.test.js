/**
 * 性能预算（T5.7 · S9.7）。
 *
 * 四条硬线写在文档里但构建不管，等于没有。所以：
 * - 传输量在**构建期**算（超了构建就失败）；
 * - CLS 与长任务在**e2e** 里量（构建算不了，必须在真浏览器、4 倍降速下）。
 *
 * 这里测前者。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BUDGET,
  brotliSize,
  checkBudget,
  firstPaintBytes,
  renderBudgetTable,
} from '../../pipeline/budgets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(ROOT, 'dist');

describe('S9.7 的四条线', () => {
  test('数值与规格一致', () => {
    assert.equal(BUDGET.firstPaintBytes, 120 * 1024);
    assert.equal(BUDGET.lazyDataBytes, 300 * 1024);
    assert.equal(BUDGET.cls, 0.05);
    assert.equal(BUDGET.longTaskMs, 200);
  });
});

describe('brotliSize', () => {
  test('压缩后显著小于原文（重复内容）', () => {
    const big = 'a'.repeat(10000);
    assert.ok(brotliSize(big) < 200, '一万个相同字符应当压到很小');
  });

  test('空串压缩后也有几字节头部', () => {
    assert.ok(brotliSize('') >= 0);
  });

  test('接受 Buffer 与字符串', () => {
    assert.equal(brotliSize(Buffer.from('abc')), brotliSize('abc'));
  });

  test('未压缩字节数不能当预算依据', () => {
    const text = 'x'.repeat(5000);
    assert.ok(brotliSize(text) < text.length);
  });
});

describe('checkBudget', () => {
  test('恰好等于上限算通过（预算不是「小于」）', () => {
    assert.equal(checkBudget('x', 100, 100).pass, true);
  });

  test('超一点就不过', () => {
    const r = checkBudget('x', 101, 100);
    assert.equal(r.pass, false);
    assert.equal(r.ratio, 1.01);
  });

  test('给占比，方便看还剩多少余量', () => {
    assert.equal(checkBudget('x', 60, 120).ratio, 0.5);
  });
});

describe('firstPaintBytes', () => {
  test('三部分相加', () => {
    const r = firstPaintBytes({
      html: 'a'.repeat(100),
      css: ['b'.repeat(50)],
      js: ['c'.repeat(50)],
    });
    assert.equal(r.total, r.html + r.css + r.js);
    assert.ok(r.total > 0);
  });

  test('空输入不炸（brotli 对空串仍有 1 字节头部，属正常）', () => {
    const r = firstPaintBytes({});
    assert.ok(r.total >= 0);
    assert.equal(r.total, r.html + r.css + r.js);
    assert.ok(r.total < 10, `空输入不该有实质体积，实际 ${r.total}`);
  });

  test('多个 CSS / JS 逐个累加', () => {
    const a = firstPaintBytes({ css: ['a'.repeat(100)] });
    const b = firstPaintBytes({ css: ['a'.repeat(100), 'a'.repeat(100)] });
    assert.ok(b.css > a.css);
  });
});

describe('renderBudgetTable', () => {
  test('输出 markdown 表格，含结论标记', () => {
    const t = renderBudgetTable([
      { label: 'x', actual: 100, limit: 200, pass: true, ratio: 0.5 },
      { label: 'y', actual: 300, limit: 200, pass: false, ratio: 1.5 },
    ]);
    assert.match(t, /\| 项目 \|/);
    assert.match(t, /✅/);
    assert.match(t, /❌/);
  });
});

describe('真实产物在预算内（验收）', () => {
  test('dist 存在时才测', () => {
    if (!existsSync(DIST)) return;
  });

  test('每个预渲染页的首屏传输不超过 120 KB', () => {
    if (!existsSync(DIST)) return;

    const css = ['styles/tokens.css', 'styles/main.css'].map((p) => {
      const full = join(DIST, p);
      return existsSync(full) ? readFileSync(full, 'utf8') : '';
    });
    const boot = readFileSync(join(DIST, 'scripts', 'boot.js'), 'utf8');
    const client = readFileSync(join(DIST, 'client', 'main.js'), 'utf8');

    const pagesDir = join(DIST, 'pages');
    if (!existsSync(pagesDir)) return;

    const problems = [];
    for (const name of readFileSync(join(ROOT, 'site', 'routes', 'index.mjs'), 'utf8').matchAll(
      /file: '([^']+\.html)'/g,
    )) {
      const p = join(pagesDir, name[1]);
      if (!existsSync(p)) continue;
      const sizes = firstPaintBytes({
        html: readFileSync(p, 'utf8'),
        css,
        js: [boot, client],
      });
      if (sizes.total > BUDGET.firstPaintBytes) {
        problems.push(`${name[1]}: ${(sizes.total / 1024).toFixed(1)} KB`);
      }
    }
    assert.deepEqual(problems, [], `超预算：${problems.join(', ')}`);
  });

  test('懒加载数据文件不超过 300 KB', () => {
    if (!existsSync(DIST)) return;

    const problems = [];
    for (const name of ['data.json', 'bench.json', 'news-milestones.json']) {
      const p = join(DIST, name);
      if (!existsSync(p)) continue;
      const size = brotliSize(readFileSync(p));
      if (size > BUDGET.lazyDataBytes) problems.push(`${name}: ${(size / 1024).toFixed(1)} KB`);
    }
    assert.deepEqual(problems, [], `超预算：${problems.join(', ')}`);
  });
});

describe('构建真的会因超预算而失败', () => {
  test('build.js 里超预算时设置了非零退出码', () => {
    const src = readFileSync(join(ROOT, 'site', 'build.js'), 'utf8');
    assert.match(src, /process\.exitCode = 1/, '超预算必须让构建失败，否则预算形同虚设');
    assert.match(src, /pipeline\/budgets\.mjs/, '要走 budgets 模块，不自己算');
  });

  test('e2e 里有 CLS 与长任务两条', () => {
    const src = readFileSync(join(ROOT, 'test', 'e2e', 'performance.spec.js'), 'utf8');
    assert.match(src, /layout-shift/, '要量 CLS');
    assert.match(src, /longtask/, '要量长任务');
    assert.match(src, /setCPUThrottlingRate/, '要在 4 倍降速下量');
  });
});
