/**
 * 层契约的可执行定义（T3.1c · S4.4 · INV-11）。
 *
 * 「每层导出同一形状」如果只是文档里的一句话，第一个写歪的层会让编排器
 * 在运行中途炸。这里把契约变成断言，并且对**真实的层目录**跑一遍。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LAYERS = join(ROOT, 'pipeline', 'layers');

/** 一个形状完全合规的假层，用来测校验器本身。 */
function goodLayer(overrides = {}) {
  return {
    id: 'demo',
    sources: ['example.com'],
    budget: { ms: 1000, requests: 3 },
    fetch: async () => ({}),
    normalize: () => ({ records: [], quarantined: [] }),
    merge: (prev, next) => next ?? prev,
    health: { floor: null, shrink: null, freshness: null, rules: [] },
    ...overrides,
  };
}

describe('层契约校验（S4.4）', () => {
  let contract;

  test('加载', async () => {
    contract = await import('../../pipeline/contract.js');
    assert.equal(typeof contract.validateLayer, 'function');
    assert.equal(typeof contract.loadLayers, 'function');
  });

  test('合规的层没有问题', () => {
    assert.deepEqual(contract.validateLayer(goodLayer(), { expectedId: 'demo' }), []);
  });

  test('缺任何一个必需键都会报出来', () => {
    for (const key of ['id', 'sources', 'budget', 'fetch', 'normalize', 'merge', 'health']) {
      const bad = goodLayer();
      delete bad[key];
      const problems = contract.validateLayer(bad);
      assert.ok(
        problems.some((p) => p.includes(key)),
        `删掉 ${key} 应当被报出来，实际：${JSON.stringify(problems)}`,
      );
    }
  });

  test('id 必须与目录名一致', () => {
    const problems = contract.validateLayer(goodLayer({ id: 'other' }), { expectedId: 'demo' });
    assert.ok(problems.some((p) => p.includes('id')));
  });

  test('budget 必须是正数（0 或负数无法作为预算）', () => {
    for (const bad of [
      { ms: 0, requests: 1 },
      { ms: 1000, requests: -1 },
      { ms: 'x', requests: 1 },
    ]) {
      const problems = contract.validateLayer(goodLayer({ budget: bad }));
      assert.ok(
        problems.some((p) => p.includes('budget')),
        JSON.stringify(bad),
      );
    }
  });

  test('health 必须带四个子键', () => {
    const problems = contract.validateLayer(goodLayer({ health: { floor: null } }));
    assert.ok(problems.filter((p) => p.includes('health')).length >= 3, JSON.stringify(problems));
  });

  test('fetch / normalize / merge 必须是函数', () => {
    const problems = contract.validateLayer(goodLayer({ fetch: 'nope' }));
    assert.ok(problems.some((p) => p.includes('fetch')));
  });

  test('真实的层目录全部合规', async () => {
    const layers = await contract.loadLayers(LAYERS);
    assert.ok(layers.size >= 1, `至少要有一层，实际 ${layers.size}`);
    for (const [id, layer] of layers) {
      assert.equal(layer.id, id);
    }
  });

  test('fx 层已按契约落地', async () => {
    const layers = await contract.loadLayers(LAYERS);
    const fx = layers.get('fx');
    assert.ok(fx, 'fx 是最小的一层，应当先落地');
    assert.deepEqual(fx.sources, ['open.er-api.com']);
    assert.ok(fx.budget.ms > 0 && fx.budget.requests > 0);
  });
});

describe('fx 层的行为（T3.1c 试金石）', () => {
  let fx;
  const now = () => new Date('2026-10-24T01:00:00.000Z');

  test('抓取成功后给出四位小数与来源', async () => {
    const mod = (await import('../../pipeline/layers/fx/index.js')).default;
    fx = mod;
    const raw = await mod.fetch({
      http: {
        json: async () => ({
          rates: { CNY: 7.123456 },
          time_last_update_utc: 'Fri, 24 Oct 2026 00:00:00 +0000',
        }),
      },
    });
    assert.equal(raw.rate, 7.1235);
    assert.equal(raw.source, 'open.er-api.com');
  });

  test('缺 CNY 的响应视为失败', async () => {
    await assert.rejects(() => fx.fetch({ http: { json: async () => ({ rates: {} }) } }), /CNY/);
  });

  test('正常值经 normalize 带上 fetched_at', () => {
    const out = fx.normalize({ rate: 7.12, asOf: null, source: 'x' }, { now });
    assert.equal(out.records.fetched_at, '2026-10-24T01:00:00.000Z');
    assert.deepEqual(out.quarantined, []);
  });

  test('非正数被隔离而不是当成功', () => {
    const out = fx.normalize({ rate: 0, asOf: null, source: 'x' }, { now });
    assert.equal(out.records, null);
    assert.equal(out.quarantined.length, 1);
  });

  test('失败时沿用上一版并标 stale', () => {
    const prev = { USDCNY: 7.05, as_of: 'x', source: 'open.er-api.com' };
    const out = fx.merge(prev, null, { now });
    assert.equal(out.USDCNY, 7.05);
    assert.equal(out.stale, true);
  });

  test('从来没有成功过才用固定值，且 source 标 fallback', () => {
    const out = fx.merge(null, null, { now });
    assert.equal(out.USDCNY, 7.1);
    assert.equal(out.source, 'fallback');
  });

  test('门禁：回退值告警，越界判红', () => {
    const rule = fx.health.rules[0];
    assert.equal(rule.check({ source: 'fallback' }).level, 'warn');
    assert.equal(rule.check({ source: 'ok', USDCNY: 7.1 }).level, 'ok');
    assert.equal(rule.check({ source: 'ok', USDCNY: 100 }).level, 'red');
  });
});
