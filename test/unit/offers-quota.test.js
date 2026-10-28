/**
 * T6.11：免费额度结构化与价值排序。
 */

import { test, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

import { quotaLabel, quotaValue, sortByQuotaValue } from '../../lib/offers.js';

describe('quotaLabel', () => {
  test('tokens / month', () => {
    assert.equal(
      quotaLabel({ amount: 1000000, unit: 'tokens', period: 'month', scope: 'account' }),
      '1000000 token/月',
    );
  });

  test('usd / one-time', () => {
    assert.equal(quotaLabel({ amount: 5, unit: 'usd', period: 'one-time' }), '$5（一次性）');
  });

  test('unknown 与 unlimited', () => {
    assert.equal(quotaLabel({ amount: null, unit: 'unknown', period: 'unknown' }), '未公开');
    assert.equal(quotaLabel({ amount: null, unit: 'unlimited', period: 'unknown' }), '无限');
  });
});

const HERE = dirname(fileURLToPath(import.meta.url));
const OFFERS = JSON.parse(
  readFileSync(join(HERE, '..', '..', 'curated', 'offers.json'), 'utf8'),
).items;

describe('curated/offers.json 结构化字段', () => {
  test('全部在架记录都有结构化 quota 与原文', () => {
    const allowedUnits = new Set([
      'tokens',
      'requests',
      'messages',
      'credits',
      'usd',
      'neurons',
      'hours',
      'seats',
      'unlimited',
      'unknown',
    ]);
    for (const o of OFFERS) {
      assert.ok(o.quota && typeof o.quota === 'object', `${o.product} 缺结构化 quota`);
      for (const key of ['amount', 'unit', 'period', 'scope'])
        assert.ok(key in o.quota, `${o.product} 缺 ${key}`);
      assert.ok(allowedUnits.has(o.quota.unit), `${o.product} unit 非法：${o.quota.unit}`);
      assert.ok(o.quota_raw, `${o.product} 缺 quota_raw`);
    }
  });

  test('低置信记录已清零，且每条复核都有结论', () => {
    assert.equal(OFFERS.filter((o) => o.confidence === 'low').length, 0);
    for (const o of OFFERS) {
      assert.equal(o.review?.status, 'kept', `${o.product} 缺复核结论`);
      assert.ok(o.review.at && o.review.note, `${o.product} 复核不完整`);
    }
  });
});

describe('quotaValue / sortByQuotaValue', () => {
  test('无限额度最前，美元与 credits 按面值', () => {
    assert.ok(
      quotaValue({ amount: null, unit: 'unlimited' }) > quotaValue({ amount: 100, unit: 'usd' }),
    );
    assert.equal(quotaValue({ amount: 20, unit: 'credits' }), 20);
  });

  test('token 按月折算', () => {
    assert.equal(quotaValue({ amount: 1e6, unit: 'tokens', period: 'month' }), 2);
    assert.equal(quotaValue({ amount: 1e6, unit: 'tokens', period: 'year' }), 2 / 12);
  });

  test('排序不修改原数组', () => {
    const rows = [
      { id: 'a', quota: { amount: 1, unit: 'usd' } },
      { id: 'b', quota: { amount: null, unit: 'unlimited' } },
      { id: 'c', quota: { amount: 2, unit: 'usd' } },
    ];
    const out = sortByQuotaValue(rows);
    assert.deepEqual(
      out.map((x) => x.id),
      ['b', 'c', 'a'],
    );
    assert.deepEqual(
      rows.map((x) => x.id),
      ['a', 'b', 'c'],
    );
  });
});
