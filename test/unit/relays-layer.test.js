/**
 * relays 层（T3.1c9）。
 *
 * 唯一有并发的层，也是唯一「逐站沿用」的层：51 个站里今天挂了 3 个，
 * 不该让另外 48 个也用旧值。
 *
 * 沿用规则同时管着两件事：
 * 1. 失败但在 TTL 内 → 用旧价，标 stale，并保留「上次真的成功」的日期；
 * 2. 失败且超过 TTL → 清空。宁可少一条，也不展示两周前的价还装作今天的。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const today = '2026-10-24';

/** enrich 只是原样返回：测的是层的沿用逻辑，不是价格加工。 */
const enrich = (x) => x;

const ctx = { ttlDays: 14, today, enrich };

describe('relays 层（T3.1c9）', () => {
  let layer;

  test('加载并按契约导出', async () => {
    layer = (await import('../../pipeline/layers/relays/index.js')).default;
    assert.equal(layer.id, 'relays');
    assert.ok(layer.budget.requests > 0);
  });

  test('并发探测：全部站都被探到，且并发不超过上限', async () => {
    let running = 0;
    let peak = 0;
    const entries = Array.from({ length: 20 }, (_, i) => ({ domain: `d${i}.test` }));
    const out = await layer.fetch({
      entries,
      concurrency: 3,
      probe: async (e) => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((r) => setTimeout(r, 1));
        running -= 1;
        return { ...e, status: 'ok' };
      },
    });
    assert.equal(out.size, 20);
    assert.ok(peak <= 3, `并发不应超过 3，实测 ${peak}`);
  });

  test('单站失败不影响其它站', async () => {
    const entries = [{ domain: 'a.test' }, { domain: 'b.test' }];
    const out = await layer.fetch({
      entries,
      probe: async (e) =>
        e.domain === 'a.test' ? { ...e, status: 'timeout' } : { ...e, status: 'ok' },
    });
    assert.equal(out.get('a.test').status, 'timeout');
    assert.equal(out.get('b.test').status, 'ok');
  });

  test('normalize 隔离形状不对的行', () => {
    const raw = new Map([
      ['a.test', { domain: 'a.test', status: 'ok' }],
      ['b.test', { domain: 'wrong.test', status: 'ok' }],
      ['c.test', null],
    ]);
    const { records, quarantined } = layer.normalize(raw);
    assert.equal(records.length, 1);
    assert.equal(quarantined.length, 2);
  });

  test('探测成功的站用新值', () => {
    const out = layer.merge(
      [{ domain: 'a.test', prices: { x: 1 }, checked_at: '2026-10-01' }],
      [{ domain: 'a.test', status: 'ok' }],
      ctx,
    );
    assert.equal(out[0].status, 'ok');
    assert.equal(out[0].stale, false);
  });

  test('失败但在 TTL 内：沿用旧价并标 stale，保留上次成功日期', () => {
    const prev = [
      { domain: 'a.test', prices: { k: { kind: 'per_1m', input: 2 } }, checked_at: '2026-10-21' },
    ];
    const out = layer.merge(prev, [{ domain: 'a.test', status: 'timeout' }], ctx);
    assert.equal(out[0].stale, true);
    assert.equal(out[0].staleDays, 3);
    assert.equal(out[0].checked_at, '2026-10-21', '不能说成今天采集的');
    assert.ok(out[0].prices.k);
  });

  test('失败且超过 TTL：清空价目，不展示两周前的价', () => {
    const prev = [{ domain: 'a.test', prices: { k: {} }, checked_at: '2026-09-01' }];
    const out = layer.merge(prev, [{ domain: 'a.test', status: 'timeout' }], ctx);
    assert.equal(out[0].stale, false);
    assert.deepEqual(out[0].prices, {});
    assert.equal(out[0].checked_at, null);
  });

  test('从来没有过价的失败站不编造', () => {
    const out = layer.merge(null, [{ domain: 'a.test', status: 'http_403' }], ctx);
    assert.deepEqual(out[0].prices, {});
    assert.equal(out[0].models, 0);
  });

  test('逐站沿用：一个站失败不影响另一个站的新值', () => {
    const prev = [
      { domain: 'a.test', prices: { k: {} }, checked_at: '2026-10-20' },
      { domain: 'b.test', prices: { old: {} }, checked_at: '2026-10-20' },
    ];
    const next = [
      { domain: 'a.test', status: 'timeout' },
      { domain: 'b.test', status: 'ok', prices: { fresh: {} } },
    ];
    const out = layer.merge(prev, next, ctx);
    assert.equal(out[0].stale, true, 'a 沿用');
    assert.equal(out[1].stale, false, 'b 用新值');
    assert.ok(out[1].prices.fresh);
  });

  test('门禁：全部失败判红，可用率过低告警', () => {
    const rule = layer.health.rules[0];
    assert.equal(rule.check([]).level, 'red');
    assert.equal(rule.check([{ status: 'timeout' }, { status: 'timeout' }]).level, 'red');
    assert.equal(
      rule.check([
        { status: 'ok' },
        { status: 'timeout' },
        { status: 'timeout' },
        { status: 'timeout' },
      ]).level,
      'warn',
    );
    assert.equal(
      rule.check([{ status: 'ok' }, { status: 'ok' }, { status: 'timeout' }]).level,
      'ok',
    );
  });
});
