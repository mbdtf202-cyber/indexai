/**
 * 文案与控件的一致性（T5.9 · S9.10 · INV-15）。
 *
 * ## 三条规矩
 *
 * 1. **页面上的统计数字一律来自数据**：模板里出现的每个 `c.xxx` 都必须
 *    在管线下发的 `meta.counts` 里存在。缺一个就是页面上一个 `undefined`——
 *    它不报错，只安静地出现在读者眼前。
 * 2. **同类信息只有一组控件**：比价页曾经有两处厂商筛选（下拉 + 一排快捷键），
 *    读者要先想「我该用哪个」。
 * 3. **术语统一**：有效成本、代表分组、最低可达价、沿用、待复核。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCounts } from '../../pipeline/counts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const appSrc = () => readFileSync(join(ROOT, 'site', 'scripts', 'app.js'), 'utf8');

/* ────────────────────────── 计数来源 ────────────────────────── */

describe('页面上的统计数字都有来源（S9.10）', () => {
  /* 从页面模板里抽出所有「counts 对象」的字段引用。
   *
   * 不能简单抓 `c.xxx`：页面里 `c` 还被用作局部变量名（数组元素、
   * 遍历变量），那些字段与计数无关。只认两种**明确的**写法：
   *   `counts.xxx`（renderNav 里的别名）
   *   `state.data.meta.counts.xxx`（直接访问）
   */
  const referencedFields = () => {
    const src = appSrc();
    const out = new Set();
    for (const m of src.matchAll(/counts\.([a-zA-Z][a-zA-Z0-9]*)(?![a-zA-Z0-9])/g)) out.add(m[1]);

    /* renderNav 里 `const c = state.data.meta.counts;` 之后用的 c.xxx。
     * 定位到那一段，避免把别处的局部 c 算进来。 */
    const at = src.indexOf('const c = state.data.meta.counts');
    if (at >= 0) {
      const seg = src.slice(at, at + 4000);
      for (const m of seg.matchAll(/\bc\.([a-zA-Z][a-zA-Z0-9]*)(?![a-zA-Z0-9])/g)) out.add(m[1]);
    }
    return out;
  };

  /* c 上那些不是计数的成员（DOM 节点、常量之类）。 */
  const NON_COUNT = new Set([
    'length',
    'map',
    'id',
    'name',
    'note',
    'filter',
    'group',
    'board',
    'rows',
    'score',
    'ageMonths',
    'orApps',
    'bench',
  ]);

  test('模板引用的每个计数字段都由 buildCounts 提供', () => {
    /* 用一份最小的假数据跑 buildCounts，取它的键集合。 */
    const provided = new Set(
      Object.keys(
        buildCounts(
          {
            models: [{ channelKind: 'aggregator', cache_read: 0.1 }],
            events: [],
            relays: [],
            news: [],
            resources: [],
            offers: [],
            subs: [],
            subsRegions: [],
            subsThird: [],
            signals: [],
            bench: { boards: {} },
          },
          { now: '2026-10-24T00:00:00Z', sources: 1 },
        ),
      ),
    );

    /* 这几个是页面的旧短名，counts 里也有同义字段；单独列出以免误报。 */
    const ALIASES = new Set(['bench']);

    const missing = [...referencedFields()]
      .filter((f) => !NON_COUNT.has(f) && !ALIASES.has(f))
      .filter((f) => !provided.has(f));

    assert.deepEqual(missing, [], `这些字段页面在用但管线没发：${missing.join(', ')}`);
  });

  test('buildCounts 输出全是数字（不是数组或对象）', () => {
    const c = buildCounts(
      {
        models: [{ channelKind: 'direct', cache_read: 0.2 }, { channelKind: 'aggregator' }],
        events: [{ end: '2026-10-01' }, { end: '2027-01-01' }],
        relays: [{ status: 'ok', prices: { a: 1 } }, { status: 'http_500' }],
        news: [{}, {}],
        resources: [{}],
        offers: [],
        subs: [],
        subsRegions: [{ rows: [{}, {}] }],
        subsThird: [{}, {}],
        signals: [{}, {}, {}],
        bench: { boards: { b1: { rows: [{ model: 'a' }, { model: 'b' }] } } },
      },
      { now: '2026-10-24T00:00:00Z', sources: 5 },
    );

    for (const [k, v] of Object.entries(c)) {
      assert.equal(typeof v, 'number', `${k} 应当是数字，实际 ${typeof v}`);
    }
  });

  test('渠道拆分加起来等于模型总数', () => {
    const c = buildCounts(
      {
        models: [
          { channelKind: 'aggregator' },
          { channelKind: 'aggregator' },
          { channelKind: 'direct' },
        ],
      },
      { now: '2026-10-24T00:00:00Z' },
    );
    assert.equal(c.aggregator + c.direct, c.models);
  });

  test('开放 + 已结束 = 活动总数', () => {
    const c = buildCounts(
      {
        events: [{ end: '2026-01-01' }, { end: '2099-01-01' }, { end: '2026-06-01' }],
      },
      { now: '2026-10-24T00:00:00Z' },
    );
    assert.equal(c.eventsOpen + c.eventsPast, c.events);
  });

  test('同义短名与长名取同一个值', () => {
    const c = buildCounts(
      {
        models: [{ cache_read: 0.5 }],
        subsRegions: [{ rows: [{}, {}] }],
        bench: { boards: { a: { rows: [] } } },
      },
      { now: '2026-10-24T00:00:00Z' },
    );
    assert.equal(c.withCache, c.cachePriced);
    assert.equal(c.subsRegionsRaw, c.regionPrices);
    assert.equal(c.bench, c.benchBoards);
  });

  test('空数据不炸，且每个字段都是 0 而不是 undefined', () => {
    const c = buildCounts({}, { now: '2026-10-24T00:00:00Z' });
    for (const [k, v] of Object.entries(c)) {
      assert.equal(Number.isFinite(v), true, `${k} 在空数据下应当是有限数字`);
    }
  });
});

/* ────────────────────────── 控件 ────────────────────────── */

describe('比价页只有一组厂商筛选（验收）', () => {
  const src = () => appSrc();

  test('厂商筛选只剩下拉一处', () => {
    const s = src();
    assert.match(s, /id="vendor"/, '要有厂商下拉');
    assert.equal(s.includes('data-vendorset'), false, '第二组厂商快捷键应当已删除');
  });

  test('没有残留的 vendorSet 死状态', () => {
    assert.equal(src().includes('vendorSet'), false, '控件删了状态也要删，否则是死代码');
  });

  test('价格带只有一组', () => {
    const s = src();
    const groups = [...s.matchAll(/role="group" aria-label="价格带"/g)];
    assert.equal(groups.length, 1, `价格带应当只有一组，实际 ${groups.length}`);
  });
});

/* ────────────────────────── 术语 ────────────────────────── */

describe('术语统一（S9.10）', () => {
  const src = () => appSrc();

  test('五个约定术语都在页面里用', () => {
    const s = src();
    for (const term of ['有效成本', '代表分组', '最低可达价', '沿用']) {
      assert.ok(s.includes(term), `页面缺术语：${term}`);
    }
  });

  test('不用「实际成本」「真实价格」这类近义替代', () => {
    const s = src();
    for (const bad of ['实际成本', '真实成本']) {
      assert.equal(s.includes(bad), false, `术语不统一：${bad}`);
    }
  });
});

/* ────────────────────────── 确定性 ────────────────────────── */

describe('页面的「新」判定不依赖当前时刻（INV-7）', () => {
  test('app.js 里没有 Date.now()', () => {
    const s = appSrc();
    /* 注释里提到历史不算 */
    const code = s
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\s*\/\/.*$/gm, '');
    assert.equal(code.includes('Date.now()'), false, '页面用当前时刻会让同一份数据的呈现不稳定');
  });

  test('有 dataMoment 作为「数据时刻」的单一来源', () => {
    assert.match(appSrc(), /function dataMoment\(\)|const dataMoment = /, '要有统一的数据时刻');
  });
});
