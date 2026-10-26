/**
 * models 层（T3.1c8）。
 *
 * 两个源性质完全不同：聚合目录每天实时抓（可能整体失败），人工官方价是人核过的。
 * 这个区别贯穿全层——**沿用只针对聚合部分**。整层沿用会让「我核实于某天」
 * 变成「源站今天没响应」，把两件不同的事混成一件。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { band, familyKey } from '../../lib/model-keys.js';
import { dedupeModels } from '../../pipeline/processors.mjs';

const ctx = {
  band,
  familyKey,
  dedupeModels,
  slugify: (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-'),
  today: () => '2026-10-24',
};

const agg = (n) => ({
  rows: Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    name: `Model ${i}`,
    vendor: 'OpenAI',
    vendorId: 'openai',
    channel: 'OpenRouter',
    channelKind: 'aggregator',
    input: 1 + i,
    output: 2 + i,
    family: `openai::model-${i}`,
    created: 1700000000,
    conf: 'med',
  })),
  dropped: 2,
  unpriced: 1,
  stale: false,
});

const official = [
  {
    model: 'sonnet',
    name: 'Claude Sonnet',
    vendor: 'Anthropic',
    in: 2,
    out: 10,
    cr: 0.2,
    src: 'https://x',
    conf: 'high',
  },
];

describe('models 层（T3.1c8）', () => {
  let layer;

  test('加载并按契约导出', async () => {
    layer = (await import('../../pipeline/layers/models/index.js')).default;
    assert.equal(layer.id, 'models');
    assert.equal(layer.sources.length, 2);
  });

  test('人工官方价被归一成直连行', () => {
    const out = layer.normalize({ catalog: agg(1), curated: official }, ctx);
    const direct = out.records.rows.find((r) => r.channelKind === 'direct');
    assert.ok(direct);
    assert.equal(direct.channel, '官方直连');
    assert.equal(direct.srcType, 'official');
    assert.equal(direct.seen, '2026-10-24');
  });

  test('ctx 字段从秒放大到毫秒', () => {
    const out = layer.normalize(
      { catalog: agg(1), curated: [{ ...official[0], ctx: 200000 }] },
      ctx,
    );
    const direct = out.records.rows.find((r) => r.channelKind === 'direct');
    assert.equal(direct.ctx, 200000 * 1000);
  });

  test('聚合目录为空时被隔离，但仍交出人工价', () => {
    const out = layer.normalize({ catalog: { rows: [] }, curated: official }, ctx);
    assert.equal(out.quarantined.length, 1);
    assert.ok(out.records.rows.some((r) => r.channelKind === 'direct'));
  });

  test('聚合有值时直接用本次结果，不标 stale', () => {
    const next = layer.normalize({ catalog: agg(3), curated: official }, ctx).records;
    const out = layer.merge([{ channelKind: 'aggregator', id: 'old' }], next);
    assert.equal(out.stale, undefined);
    assert.ok(out.rows.some((r) => r.id === 'm0'));
  });

  test('聚合为空时沿用旧聚合，但人工价仍用本次的', () => {
    const prev = [
      { id: 'oldAgg', channelKind: 'aggregator', input: 9 },
      { id: 'oldDirect', channelKind: 'direct', input: 99 },
    ];
    const next = layer.normalize({ catalog: { rows: [] }, curated: official }, ctx).records;
    const out = layer.merge(prev, next);

    const aggRow = out.rows.find((r) => r.channelKind === 'aggregator');
    assert.equal(aggRow.id, 'oldAgg', '聚合沿用旧值');
    assert.equal(aggRow.stale, true);

    const directRow = out.rows.find((r) => r.id === 'sonnet');
    assert.ok(directRow, '人工价必须来自本次，不是上一版的 oldDirect');
    assert.equal(directRow.input, 2);
  });

  test('没有上一版聚合时也不编造', () => {
    const next = layer.normalize({ catalog: { rows: [] }, curated: official }, ctx).records;
    const out = layer.merge(null, next);
    assert.equal(out.rows.filter((r) => r.channelKind === 'aggregator').length, 0);
  });

  test('门禁：一个模型都没有判红', () => {
    const rule = layer.health.rules[0];
    assert.equal(rule.check({ rows: [] }).level, 'red');
    assert.equal(rule.check({ rows: [{ id: 'x' }] }).level, 'ok');
  });
});
