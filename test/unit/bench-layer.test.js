/**
 * bench 层（T3.1c5）。
 *
 * 这一层刻意很薄：重活在 bench.mjs，层只负责把它的输出包成契约形状。
 * 所以测试的重点不是「解析对不对」（那有整组 bench 用例管），而是：
 * 1. 契约接线是否正确（prev 有没有传下去）；
 * 2. 整层为 0 榜时是否正确沿用上一版（逐源沿用已在 bench.mjs 内部做）。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const snapshot = (boards, extra = {}) => ({
  as_of: '2026-10-24',
  stats: { boards, rows: boards * 10, models: boards * 5, sources: 9, stale: false },
  boards: Array.from({ length: boards }, (_, i) => ({ id: `b${i}`, rows: [] })),
  ...extra,
});

describe('bench 层（T3.1c5）', () => {
  let layer;

  test('加载并按契约导出', async () => {
    layer = (await import('../../pipeline/layers/bench/index.js')).default;
    assert.equal(layer.id, 'bench');
    assert.equal(layer.sources.length, 9, '9 个公开评测源');
    assert.ok(layer.budget.ms > 0 && layer.budget.requests > 0);
  });

  test('把上一版完整快照传给 bench.mjs（不是目录）', async () => {
    const prev = snapshot(3);
    let got = null;
    await layer.fetch({
      fetchBenchmarks: async (p) => {
        got = p;
        return snapshot(3);
      },
      prev,
    });
    assert.equal(got, prev, 'prev 必须原样传下去：bench.mjs 靠它做逐源回退');
  });

  test('normalize 接受结构完整的快照', () => {
    const out = layer.normalize(snapshot(5));
    assert.ok(out.records);
    assert.deepEqual(out.quarantined, []);
  });

  test('缺 stats 时隔离而不是崩溃', () => {
    const out = layer.normalize({ boards: [] });
    assert.equal(out.records, null);
    assert.match(out.quarantined[0].reason, /stats/);
  });

  test('本次有榜时直接用新结果', () => {
    const next = snapshot(4);
    const prev = snapshot(9);
    const out = layer.merge(prev, next);
    assert.equal(out.stats.boards, 4);
    assert.equal(out.stale, undefined);
  });

  test('整层 0 榜时沿用上一版并标 stale', () => {
    const prev = snapshot(9);
    const out = layer.merge(prev, snapshot(0));
    assert.equal(out.stats.boards, 9);
    assert.equal(out.stale, true);
  });

  test('两版都空时不假装有数据', () => {
    const out = layer.merge(null, snapshot(0));
    assert.equal(out.stats.boards, 0);
    assert.equal(out.stale, undefined);
  });

  test('门禁：缺 stats 判红，0 榜判红，缺 boards 告警', () => {
    const rule = layer.health.rules[0];
    assert.equal(rule.check(null).level, 'red');
    assert.equal(rule.check({ stats: { boards: 0 } }).level, 'red');
    assert.equal(rule.check({ stats: { boards: 3 } }).level, 'warn');
    assert.equal(rule.check(snapshot(3)).level, 'ok');
  });
});
