/**
 * offers 层（T3.1c7）。
 *
 * 最简单的一层：没有网络请求，数据全部来自人工核校的 curated/offers.json。
 * 但它承担着一条硬约束——**每条都必须能回溯**（INV-2：每个数字都带来源）。
 * 没有 source 的条目不是「少一个字段」，而是「一句无法核实的断言」，应当被隔离。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/** 复刻 collect.mjs 的去重语义：按产品 slug 合并 entries 与 sources，high 置信度优先。 */
function dedupeOffers(list) {
  const map = new Map();
  let merged = 0;
  for (const o of list) {
    const key = String(o.product || '')
      .toLowerCase()
      .replace(/\s+/g, '-');
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...o, entries: [...(o.entries || [])] });
      continue;
    }
    merged += 1;
    const entries = [...new Set([...(prev.entries || []), ...(o.entries || [])])];
    const sources = [...new Set([...(prev.sources || []), ...(o.sources || [])].filter(Boolean))];
    const better = o.conf === 'high' && prev.conf !== 'high';
    map.set(key, { ...(better ? o : prev), entries, sources });
  }
  return { rows: [...map.values()], merged };
}

describe('offers 层（T3.1c7）', () => {
  let layer;

  test('加载并按契约导出', async () => {
    layer = (await import('../../pipeline/layers/offers/index.js')).default;
    assert.equal(layer.id, 'offers');
    assert.deepEqual(layer.sources, ['curated/offers.json']);
    assert.equal(layer.budget.requests, 1, '这一层不该发任何网络请求');
  });

  test('三个默认值被拉平（conf / srcType / sources）', () => {
    const out = layer.normalize(
      [{ product: 'X', source: 'https://x', confidence: 'high', source_type: 'blog' }],
      { dedupeOffers },
    );
    const row = out.records.rows[0];
    assert.equal(row.conf, 'high');
    assert.equal(row.srcType, 'blog');
    assert.deepEqual(row.sources, ['https://x']);
  });

  test('缺 source 的条目被隔离（INV-2：无法回溯的断言不入库）', () => {
    const out = layer.normalize([{ product: 'OK', source: 'https://x' }, { product: 'NoSource' }], {
      dedupeOffers,
    });
    assert.equal(out.records.rows.length, 1);
    assert.equal(out.quarantined.length, 1);
    assert.match(out.quarantined[0].reason, /source/);
  });

  test('同产品多条记录被合并，entries 与 sources 取并集', () => {
    const out = layer.normalize(
      [
        { product: 'Same', source: 'https://a', entries: ['CLI'], conf: 'med' },
        { product: 'Same', source: 'https://b', entries: ['IDE'], conf: 'high' },
      ],
      { dedupeOffers },
    );
    assert.equal(out.records.rows.length, 1);
    assert.equal(out.records.merged, 1);
    const row = out.records.rows[0];
    assert.deepEqual(row.entries.sort(), ['CLI', 'IDE']);
    assert.deepEqual(row.sources.sort(), ['https://a', 'https://b']);
    assert.equal(row.conf, 'high', '置信度高的那条优先');
  });

  test('到期记录自动归档为 archived（T6.11）', () => {
    const out = layer.normalize(
      [
        { product: 'Old', source: 'https://x', expires_at: '2026-10-01' },
        { product: 'New', source: 'https://y', expires_at: '2027-01-01' },
      ],
      { dedupeOffers, today: () => '2026-10-28' },
    );
    assert.equal(out.records.rows.find((x) => x.product === 'Old').status, 'archived');
    assert.equal(out.records.rows.find((x) => x.product === 'New').status, 'active');
  });

  test('空名单被隔离而不是静默产出空数组', () => {
    const out = layer.normalize([], { dedupeOffers });
    assert.equal(out.records, null);
    assert.match(out.quarantined[0].reason, /为空/);
  });

  test('merge：本次有值就用新值', () => {
    const next = { rows: [{ product: 'a' }], merged: 0 };
    assert.equal(layer.merge(null, next), next);
  });

  test('merge：本次为空时沿用上一版并标 stale', () => {
    const out = layer.merge({ rows: [{ product: 'old' }] }, { rows: [], merged: 0 });
    assert.equal(out.rows[0].product, 'old');
    assert.equal(out.stale, true);
  });

  test('门禁：免费额度为空判红', () => {
    const rule = layer.health.rules[0];
    assert.equal(rule.check({ rows: [] }).level, 'red');
    assert.equal(rule.check({ rows: [{ product: 'x' }] }).level, 'ok');
  });
});
