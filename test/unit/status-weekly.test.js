/**
 * T7.3：周报聚合。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildWeeklyStatus, weekBuckets } from '../../pipeline/status-report.mjs';

describe('buildWeeklyStatus', () => {
  const weeks = weekBuckets(new Date('2026-10-28T00:00:00Z'), 8);

  test('按周聚合门禁与匹配率', () => {
    const attempts = {
      models: [
        {
          at: '2026-10-20T00:00:00Z',
          status: 'ok',
          gate: 'ok',
          matchRate: 0.98,
          quarantineRate: 0.01,
          count: 470,
        },
        {
          at: '2026-10-22T00:00:00Z',
          status: 'ok',
          gate: 'ok',
          matchRate: 0.96,
          quarantineRate: 0.02,
          count: 472,
        },
        {
          at: '2026-10-27T00:00:00Z',
          status: 'failed',
          gate: 'blocked',
          matchRate: 0.9,
          quarantineRate: 0.04,
          count: 460,
        },
      ],
    };
    const out = buildWeeklyStatus(attempts, {
      weeks,
      labels: [{ id: 'news', name: '情报主题', values: [0.9, 0.94] }],
    });
    const last = out.layers.models.at(-1);
    assert.equal(last.runs, 1);
    assert.equal(last.okRate, 0);
    assert.ok(out.layers.models.some((x) => x.matchRate === 0.97));
    assert.equal(out.labels[0].values.length, 2);
  });

  test('没有历史时返回空层数组而不是抛错', () => {
    const out = buildWeeklyStatus({}, { weeks });
    assert.deepEqual(out.layers, {});
    assert.equal(out.weeks.length, 8);
  });
});
