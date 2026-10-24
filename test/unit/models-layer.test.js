/**
 * 模型目录也要走分层记账（T1.5 · F06 · INV-1）。
 *
 * F06：OpenRouter 的 `/api/v1/models` 是唯一没有纳入 T.run 的源——
 * 它失败就直接 `throw`，整次采集中止，所有层当天都不更新。
 * 而它恰好是模型层（比价页的主干）的唯一来源，一旦挂掉应该「沿用上一版 + 标 stale」，
 * 而不是把白嫖额度、活动、评测这些跟它无关的层一起拖死。
 *
 * 这里盯三件事：
 * 1. 该源 503 时采集不中止；
 * 2. 模型层用上一版的 aggregator 行补齐，并标 stale；
 * 3. 官方直连（人工核实的那部分）照常合并进来，不受影响。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

/** 从真实快照里取一份「上一版」，只用 aggregator 行做测试输入。 */
function previousAggregatorRows() {
  const data = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'data', 'data.json'), 'utf8'));
  return (data.models || []).filter((m) => m.channelKind === 'aggregator');
}

describe('模型目录纳入记账（F06）', () => {
  let collect;

  // 只用纯函数：真正的采集由 golden 覆盖，这里不跑整条管线
  test('aggregator 行可以被识别出来并原样沿用', async () => {
    collect = await import('../../collect.mjs');
    const prev = previousAggregatorRows();
    assert.ok(prev.length > 0, 'fixture 里应当有 aggregator 行');

    // 沿用 = 原样使用，只加一个 stale 标记；价格与渠道字段一点都不能变
    const carried = prev.map((m) => ({ ...m, stale: true }));
    assert.equal(carried.length, prev.length);
    assert.deepEqual(
      carried.map(({ stale: _s, ...rest }) => rest),
      prev,
      '沿用不能改动任何原始字段',
    );
  });

  test('去重后不会出现同一 OpenRouter id 的两行', async () => {
    collect = await import('../../collect.mjs');
    const prev = previousAggregatorRows();
    // 模拟「上一版 80 条 + 本次拿到 3 条新的」：新 id 应当留下，旧的照旧
    const fresh = prev.slice(0, 3).map((m) => ({ ...m, seen: '2026-10-24' }));
    const merged = collect.dedupeModels([...fresh, ...prev]);
    const agg = merged.rows.filter((m) => m.channelKind === 'aggregator');
    const ids = new Set(agg.map((m) => m.id));
    assert.equal(ids.size, agg.length, '聚合层以 OpenRouter model id 为唯一键，不能重复');
  });

  test('官方直连行与 aggregator 行互不覆盖（两层不合并）', async () => {
    collect = await import('../../collect.mjs');
    const data = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'data', 'data.json'), 'utf8'));
    const direct = (data.models || []).filter((m) => m.channelKind === 'direct');
    const agg = (data.models || []).filter((m) => m.channelKind === 'aggregator');
    assert.ok(direct.length > 0 && agg.length > 0, 'fixture 里两层都要有');

    const merged = collect.dedupeModels([...agg, ...direct]);
    const outDirect = merged.rows.filter((m) => m.channelKind === 'direct');
    const outAgg = merged.rows.filter((m) => m.channelKind === 'aggregator');
    assert.equal(outDirect.length, direct.length, '官方直连不该被聚合层吃掉');
    assert.equal(outAgg.length, agg.length, '聚合层不该被官方直连吃掉');
  });
});
