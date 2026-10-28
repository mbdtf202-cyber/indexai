/**
 * 价格序列（T4.8 · S5.3）。
 *
 * ## 只存变化点
 *
 * 一个模型 30 天里可能只变过 2 次价。每天存一行是 30 行，其中 28 行完全一样——
 * 仓库臃肿、diff 全是噪声、画线时还要自己压缩。
 *
 * 只存变化点后：体积小一到两个数量级，`densify` 能还原成每天一个点，
 * 视觉上与全量存完全等价。
 *
 * ## 三类序列
 *
 * 模型 / 中转站 / 订阅各一个目录，字段不同但机制相同。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  appendPoint,
  buildSeries,
  densify,
  samePrice,
  indexBy,
  seriesFileName,
  seriesDoc,
  MODEL_SERIES_FIELDS,
  RELAY_SERIES_FIELDS,
  SUB_SERIES_FIELDS,
} from '../../pipeline/series.mjs';

describe('samePrice：浮点比较', () => {
  test('相同值算同价', () => {
    assert.equal(samePrice({ a: 1 }, { a: 1 }, ['a']), true);
  });

  test('相对误差 0.1% 内算同价（浮点噪声）', () => {
    assert.equal(samePrice({ a: 0.140845 }, { a: 0.1408450001 }, ['a']), true);
  });

  test('明显不同算不同价', () => {
    assert.equal(samePrice({ a: 1 }, { a: 2 }, ['a']), false);
  });

  test('null 与数值算不同价', () => {
    assert.equal(samePrice({ a: null }, { a: 1 }, ['a']), false);
  });

  test('多字段全同才算同价', () => {
    assert.equal(samePrice({ a: 1, b: 2 }, { a: 1, b: 3 }, ['a', 'b']), false);
  });
});

describe('appendPoint：只在变化时追加', () => {
  const F = ['input', 'output'];

  test('第一条永远记（序列的起点）', () => {
    const s = appendPoint([], { date: '2026-10-01', input: 1, output: 2 }, F);
    assert.equal(s.length, 1);
    assert.deepEqual(s[0], { date: '2026-10-01', input: 1, output: 2 });
  });

  test('价格没变 → 不追加', () => {
    let s = appendPoint([], { date: '2026-10-01', input: 1, output: 2 }, F);
    s = appendPoint(s, { date: '2026-10-02', input: 1, output: 2 }, F);
    s = appendPoint(s, { date: '2026-10-03', input: 1, output: 2 }, F);
    assert.equal(s.length, 1, '三天同价只留一个点');
  });

  test('价格变了 → 追加', () => {
    let s = appendPoint([], { date: '2026-10-01', input: 1, output: 2 }, F);
    s = appendPoint(s, { date: '2026-10-02', input: 1.5, output: 2 }, F);
    assert.equal(s.length, 2);
    assert.equal(s[1].input, 1.5);
  });

  test('同一天重跑 → 替换而不是追加', () => {
    let s = appendPoint([], { date: '2026-10-01', input: 1, output: 2 }, F);
    s = appendPoint(s, { date: '2026-10-01', input: 3, output: 2 }, F);
    assert.equal(s.length, 1, '一天只该有一个点');
    assert.equal(s[0].input, 3, '用最新值');
  });

  test('同一天值也没变 → 完全不动', () => {
    const s = appendPoint([], { date: '2026-10-01', input: 1, output: 2 }, F);
    const s2 = appendPoint(s, { date: '2026-10-01', input: 1, output: 2 }, F);
    assert.equal(s2.length, 1);
    assert.deepEqual(s2, s);
  });

  test('不修改入参', () => {
    const orig = [{ date: '2026-10-01', input: 1, output: 2 }];
    const copy = JSON.parse(JSON.stringify(orig));
    appendPoint(orig, { date: '2026-10-02', input: 5, output: 2 }, F);
    assert.deepEqual(orig, copy);
  });

  test('缺失字段写 null（不留 undefined）', () => {
    const s = appendPoint([], { date: '2026-10-01', input: 1 }, F);
    assert.equal(s[0].output, null);
    assert.ok(JSON.stringify(s).includes('null'));
  });
});

describe('buildSeries：从多日快照派生', () => {
  test('只留变化点的序列', () => {
    const days = [
      { date: '2026-10-01', row: { input: 1, output: 2 } },
      { date: '2026-10-02', row: { input: 1, output: 2 } }, // 没变
      { date: '2026-10-03', row: { input: 1, output: 2 } }, // 没变
      { date: '2026-10-04', row: { input: 2, output: 2 } }, // 变了
      { date: '2026-10-05', row: { input: 2, output: 2 } }, // 没变
    ];
    const s = buildSeries(days, ['input', 'output']);
    assert.equal(s.length, 2, '5 天只留 2 个变化点');
    assert.deepEqual(
      s.map((p) => p.date),
      ['2026-10-01', '2026-10-04'],
    );
  });

  test('实体某天缺席 → 跳过，不记 null 点', () => {
    const days = [
      { date: '2026-10-01', row: { input: 1 } },
      { date: '2026-10-02', row: null },
      { date: '2026-10-03', row: { input: 1 } },
    ];
    const s = buildSeries(days, ['input']);
    assert.equal(s.length, 1);
  });

  test('三类字段各自独立', () => {
    assert.deepEqual(MODEL_SERIES_FIELDS, ['input', 'output', 'cache_read', 'cache_write']);
    assert.deepEqual(RELAY_SERIES_FIELDS, ['input']);
    assert.deepEqual(SUB_SERIES_FIELDS, ['price']);
  });
});

describe('densify：还原成每天一个点', () => {
  test('用上一个已知值延续', () => {
    const series = [
      { date: '2026-10-01', input: 1 },
      { date: '2026-10-04', input: 2 },
    ];
    const dates = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'];
    const dense = densify(series, dates, ['input']);

    assert.equal(dense.length, 5);
    assert.deepEqual(
      dense.map((d) => d.input),
      [1, 1, 1, 2, 2],
    );
  });

  test('序列开始之前的日期是 null', () => {
    const dense = densify(
      [{ date: '2026-10-03', input: 5 }],
      ['2026-10-01', '2026-10-03'],
      ['input'],
    );
    assert.equal(dense[0].input, null);
    assert.equal(dense[1].input, 5);
  });

  test('空序列全 null', () => {
    const dense = densify([], ['2026-10-01'], ['input']);
    assert.equal(dense[0].input, null);
  });
});

describe('文件命名', () => {
  test('模型 id 里的斜杠被替换（不能当路径）', () => {
    const name = seriesFileName('anthropic/claude-opus-5-5');
    assert.equal(name.includes('/'), false, '文件名不能含路径分隔符');
    assert.match(name, /^anthropic__claude-opus-5-5$/);
  });

  test('可逆：不同 id 得到不同文件名', () => {
    const a = seriesFileName('openai/gpt-6');
    const b = seriesFileName('openai/gpt-6.1');
    assert.notEqual(a, b);
  });

  test('空 id 有兜底', () => {
    assert.ok(seriesFileName('').length > 0);
  });
});

describe('seriesDoc：文件内容', () => {
  test('带 schema、key、kind、fields、points、changes', () => {
    const doc = seriesDoc({
      key: 'anthropic/claude-opus-5-5',
      kind: 'models',
      fields: MODEL_SERIES_FIELDS,
      points: [
        { date: '2026-10-01', input: 2, output: 10 },
        { date: '2026-10-04', input: 3, output: 10 },
      ],
    });
    assert.equal(doc.schema, 'series/v1');
    assert.equal(doc.kind, 'models');
    assert.equal(doc.changes, 1, '两个点 = 一次变化');
  });

  test('只有一个点（起点）时 changes 为 0', () => {
    const doc = seriesDoc({ key: 'x', kind: 'models', fields: ['input'], points: [{ date: 'd' }] });
    assert.equal(doc.changes, 0);
  });

  test('空序列 changes 为 0（不是 -1）', () => {
    assert.equal(seriesDoc({ key: 'x', kind: 'models', fields: ['input'], points: [] }).changes, 0);
  });
});

describe('indexBy：按 key 建索引', () => {
  test('按 id 索引', () => {
    const m = indexBy(
      [
        { id: 'a', v: 1 },
        { id: 'b', v: 2 },
      ],
      (r) => r.id,
    );
    assert.equal(m.get('a').v, 1);
    assert.equal(m.get('c'), undefined);
  });

  test('key 为空的条目被跳过', () => {
    const m = indexBy([{ v: 1 }, { id: 'b' }], (r) => r.id);
    assert.equal(m.size, 1);
  });
});

/* ────────────────────────── 端到端 ────────────────────────── */

describe('多日 fixture 派生三类序列（验收）', () => {
  test('三天快照 → 每个实体只留变化点', () => {
    // 模拟两次价格变化的三天
    const models = [
      { date: '2026-10-01', row: { input: 1, output: 2, cache_read: 0.1, cache_write: 0.2 } },
      { date: '2026-10-02', row: { input: 1, output: 2, cache_read: 0.1, cache_write: 0.2 } },
      { date: '2026-10-03', row: { input: 2, output: 2, cache_read: 0.1, cache_write: 0.2 } },
    ];
    const s = buildSeries(models, MODEL_SERIES_FIELDS);
    assert.equal(s.length, 2, '3 天 2 个变化点');

    // 还原回 3 天
    const dense = densify(s, ['2026-10-01', '2026-10-02', '2026-10-03'], MODEL_SERIES_FIELDS);
    assert.deepEqual(
      dense.map((d) => d.input),
      [1, 1, 2],
      '还原后与每日全量等价',
    );
  });

  test('三类序列各自成立', () => {
    const relayDays = [
      { date: '2026-10-01', row: { sonnet55: 2, opus55: 4 } },
      { date: '2026-10-02', row: { sonnet55: 2.5, opus55: 4 } },
    ];
    const rs = buildSeries(relayDays, ['sonnet55', 'opus55']);
    assert.equal(rs.length, 2);

    const subDays = [
      { date: '2026-10-01', row: { price: 20 } },
      { date: '2026-10-02', row: { price: 20 } },
      { date: '2026-10-03', row: { price: 25 } },
    ];
    const ss = buildSeries(subDays, SUB_SERIES_FIELDS);
    assert.equal(ss.length, 2);
  });
});
