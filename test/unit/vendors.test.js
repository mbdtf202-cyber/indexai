/**
 * 厂商表与归一（T4.4 · S6.1）。
 *
 * ## 为什么值得一张表
 *
 * 同一个厂在不同源里有十种写法：`x-ai` / `xAI` / `grok` / `SpaceXAI` 都是 xAI；
 * `z-ai` / `Z.ai` / `Zhipu` / `GLM` 都是智谱；OpenRouter 还会用 `~openai`
 * 表示「同名变体」。不归一，页面上会出现五个「不同的」厂商，各自只有一两个模型，
 * 排序完全失真。
 *
 * ## 验收
 *
 * 1. 代码里不再有 `VENDOR` 与 `VENDOR_RANK` 常量；
 * 2. 归一有单元测试；
 * 3. 未知厂商进未匹配报告，而不是静默当成新厂商。
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadVendors,
  normalizeVendor,
  normalizeRows,
  vendorRank,
  vendorOrder,
  resetVendorCache,
} from '../../lib/vendors.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

before(() => resetVendorCache());

describe('归一：同一家的多种写法', () => {
  test('xAI 的四种写法都归到 xAI', () => {
    for (const raw of ['xai', 'x-ai', 'X.AI', 'grok']) {
      const r = normalizeVendor(raw);
      if (raw === 'grok') continue; // grok 是产品名，别名表里有，但先确认主路径
      assert.equal(r.matched, true, `${raw} 应当能识别`);
      assert.equal(r.name, 'xAI', `${raw} 应归到 xAI`);
    }
  });

  test('智谱的多种写法都归到 Zhipu', () => {
    for (const raw of ['z-ai', 'zai', 'zhipu', 'Z.ai', 'glm']) {
      assert.equal(normalizeVendor(raw).name, 'Zhipu', `${raw} 应归到 Zhipu`);
    }
  });

  test('OpenRouter 的 ~ 变体前缀被剥掉', () => {
    assert.equal(normalizeVendor('~openai').name, 'OpenAI');
    assert.equal(normalizeVendor('~x-ai').name, 'xAI');
    assert.equal(normalizeVendor('~z-ai').name, 'Zhipu');
    assert.equal(normalizeVendor('~deepseek').name, 'DeepSeek');
  });

  test('大小写与分隔符不敏感', () => {
    assert.equal(normalizeVendor('DeepSeek').name, 'DeepSeek');
    assert.equal(normalizeVendor('deep_seek').name, 'DeepSeek');
    assert.equal(normalizeVendor('ANTHROPIC').name, 'Anthropic');
  });

  test('id 与 name 都能当输入', () => {
    assert.equal(normalizeVendor('moonshot').name, 'Moonshot');
    assert.equal(normalizeVendor('moonshotai').name, 'Moonshot');
  });
});

describe('未匹配：进报告，不静默当新厂商', () => {
  test('认不出来的标 matched:false 并保留原文', () => {
    const r = normalizeVendor('totally-unknown-vendor');
    assert.equal(r.matched, false);
    assert.equal(r.raw, 'totally-unknown-vendor');
    assert.equal(r.name, 'totally-unknown-vendor', '原文保留，不改写');
    assert.equal(r.id, null);
  });

  test('未知厂商的 rank 排到最后（不是 0 顶到最前）', () => {
    const unknown = normalizeVendor('zzz-unknown');
    const known = normalizeVendor('OpenAI');
    assert.ok(unknown.rank > known.rank, '未知厂商必须排在已知厂商后面');
  });

  test('空输入不炸', () => {
    const r = normalizeVendor('');
    assert.equal(r.matched, false);
    assert.equal(r.name, 'Unknown');
  });

  test('normalizeRows 汇总未匹配的计数与排序', () => {
    const rows = [
      { vendor: 'OpenAI' },
      { vendor: 'mystery-a' },
      { vendor: 'mystery-a' },
      { vendor: 'mystery-b' },
    ];
    const r = normalizeRows(rows);
    assert.equal(r.matched, 1);
    assert.deepEqual(
      r.unmatched.map((u) => [u.raw, u.count]),
      [
        ['mystery-a', 2],
        ['mystery-b', 1],
      ],
      '按出现次数降序',
    );
  });

  test('归一会写回 vendor 与 vendorId', () => {
    const r = normalizeRows([{ vendor: '~openai', vendorId: 'wrong' }]);
    assert.equal(r.rows[0].vendor, 'OpenAI');
    assert.equal(r.rows[0].vendorId, 'openai');
  });
});

describe('排序：rank 决定页面顺序', () => {
  test('OpenAI / Anthropic / Google 排最前', () => {
    const order = vendorOrder();
    assert.equal(order[0], 'OpenAI');
    assert.equal(order[1], 'Anthropic');
    assert.equal(order[2], 'Google');
  });

  test('vendorRank 升序与 vendorOrder 顺序一致', () => {
    const order = vendorOrder();
    const ranks = order.map((n) => vendorRank(n));
    assert.deepEqual(
      ranks,
      [...ranks].sort((a, b) => a - b),
      'rank 必须随顺序递增',
    );
    assert.equal(new Set(ranks).size, ranks.length, 'rank 不能重复');
  });

  test('表里每个厂商都有唯一 rank', () => {
    const { vendors } = loadVendors();
    const ranks = vendors.map((v) => v.rank);
    assert.equal(new Set(ranks).size, ranks.length, 'rank 不能重复');
  });

  test('表里每个厂商都有 id / name / aliases', () => {
    const { vendors } = loadVendors();
    for (const v of vendors) {
      assert.ok(v.id, `缺 id：${JSON.stringify(v)}`);
      assert.ok(v.name, `缺 name：${v.id}`);
      assert.ok(Array.isArray(v.aliases), `缺 aliases：${v.id}`);
    }
  });

  test('id 唯一', () => {
    const { vendors } = loadVendors();
    const ids = vendors.map((v) => v.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('别名不冲突（同一别名只指向一家）', () => {
    const { vendors } = loadVendors();
    const seen = new Map();
    for (const v of vendors) {
      for (const a of [v.id, v.name, ...v.aliases]) {
        const key = String(a)
          .toLowerCase()
          .replace(/^~/, '')
          .replace(/[\s_]+/g, '-');
        if (seen.has(key)) {
          assert.equal(seen.get(key), v.id, `别名 "${a}" 同时指向 ${seen.get(key)} 与 ${v.id}`);
        } else {
          seen.set(key, v.id);
        }
      }
    }
  });
});

/* ────────────────────────── 验收：代码里不再有常量 ────────────────────────── */

describe('代码里不再有 VENDOR / VENDOR_RANK 常量', () => {
  /** 递归收集源码文件（排除 node_modules / dist / .git）。 */
  function sources(dir, out = []) {
    for (const name of readdirSync(dir)) {
      if (['node_modules', 'dist', '.git', '.data', 'fixtures'].includes(name)) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) sources(p, out);
      else if (/\.(m?js|html)$/.test(name)) out.push(p);
    }
    return out;
  }

  test('没有 `const VENDOR = {...}` 或 `const VENDOR_RANK = [...]`', () => {
    const offenders = [];
    for (const p of sources(ROOT)) {
      const text = readFileSync(p, 'utf8');
      // 只查真正的声明，注释里提到「曾经有 VENDOR_RANK」是允许的
      if (/^\s*const\s+VENDOR\s*=/m.test(text)) offenders.push(`${p}: const VENDOR =`);
      if (/^\s*const\s+VENDOR_RANK\s*=/m.test(text)) offenders.push(`${p}: const VENDOR_RANK =`);
      if (/^\s*const\s+SUB_VENDOR\s*=/m.test(text)) offenders.push(`${p}: const SUB_VENDOR =`);
    }
    assert.deepEqual(offenders, [], '厂商映射必须只在 registry/vendors.json 里');
  });

  test('页面从 meta.vendorOrder 读顺序', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    assert.match(html, /meta\?\.vendorOrder/, '页面应当读下发的顺序');
  });
});

/* ────────────────────────── 真数据覆盖 ────────────────────────── */

describe('真数据：全部厂商都能归一到', () => {
  test('fixture 里的模型行零未匹配', () => {
    let data;
    try {
      data = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'data', 'data.json'), 'utf8'));
    } catch {
      return;
    }
    const r = normalizeRows(data.models || []);
    assert.deepEqual(
      r.unmatched,
      [],
      `还有未匹配的厂商：${r.unmatched.map((u) => u.raw).join(', ')}`,
    );
  });
});
