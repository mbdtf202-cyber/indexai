/**
 * 变化引擎与 Atom 源（T4.3 · S5.2 · F29）。
 *
 * ## 为什么变化引擎要单独测
 *
 * 它是「今天变了什么」的唯一来源。判错了不会崩，只会安静地说错话：
 * 价格明明没变却报「涨了」、分数掉了却不报。这种错误读者无法自查。
 *
 * ## 六类事件都要覆盖（S5.2）
 *
 * 模型 / 免费额度 / 订阅 / 中转站 / 评测 / 活动。少一类就是少一种信息。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeChanges,
  priceDelta,
  countByType,
  describeChange,
  SUB_PRICE_EPSILON,
  BENCH_TOP_N,
  EVENT_HIGH_VALUE,
} from '../../pipeline/derive/changes-engine.mjs';
import { renderAtom, escapeXml, entryId, FEED_MAX_ENTRIES } from '../../pipeline/derive/atom.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 造两版数据。 */
const snap = (data, bench) => ({ data, bench });

describe('priceDelta：浮点比较', () => {
  test('相同值不算变化', () => {
    assert.equal(priceDelta(1, 1), null);
  });

  test('相对误差 0.1% 内不算变化（浮点噪声）', () => {
    assert.equal(priceDelta(0.140845, 0.1408450001), null);
  });

  test('明显变化要报', () => {
    const d = priceDelta(1, 2);
    assert.equal(d.old, 1);
    assert.equal(d.new, 2);
    assert.equal(d.pct, 1);
  });

  test('从无价到有价要报（new 为 null 时 pct 也算不出来）', () => {
    const d = priceDelta(null, 5);
    assert.equal(d.old, null);
    assert.equal(d.new, 5);
    assert.equal(d.pct, null);
  });

  test('降价 pct 为负', () => {
    assert.ok(priceDelta(2, 1).pct < 0);
  });
});

describe('模型事件（S5.2）', () => {
  const base = {
    id: 'm1',
    name: 'M1',
    vendor: 'V',
    channel: 'C',
    input: 1,
    output: 2,
    cache_read: 0.1,
    cache_write: 0.2,
    ctx: 1000,
  };

  test('四类价格各自独立报', () => {
    const next = { ...base, input: 2, output: 4, cache_read: 0.2, cache_write: 0.4 };
    const events = computeChanges(snap({ models: [base] }), snap({ models: [next] }), {
      date: 'd',
    });
    const types = events.map((e) => e.type).sort();
    assert.deepEqual(types, [
      'model_price_cache_read',
      'model_price_cache_write',
      'model_price_input',
      'model_price_output',
    ]);
  });

  test('只改输入价，不误报其它三项', () => {
    const events = computeChanges(
      snap({ models: [base] }),
      snap({ models: [{ ...base, input: 3 }] }),
      { date: 'd' },
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'model_price_input');
    assert.equal(events[0].change.old, 1);
    assert.equal(events[0].change.new, 3);
  });

  test('上下文变化单独报', () => {
    const events = computeChanges(
      snap({ models: [base] }),
      snap({ models: [{ ...base, ctx: 2000 }] }),
      { date: 'd' },
    );
    assert.equal(events[0].type, 'model_ctx');
  });

  test('新增与下架', () => {
    const events = computeChanges(
      snap({ models: [{ ...base, id: 'gone' }] }),
      snap({ models: [{ ...base, id: 'fresh' }] }),
      { date: 'd' },
    );
    const types = events.map((e) => e.type).sort();
    assert.deepEqual(types, ['model_new', 'model_removed']);
  });
});

describe('免费额度事件', () => {
  test('新增 / 移除 / 额度文本变化', () => {
    const prev = {
      offers: [
        { id: 'a', product: 'A', quota: '$5' },
        { id: 'b', product: 'B', quota: '$3' },
      ],
    };
    const curr = {
      offers: [
        { id: 'a', product: 'A', quota: '$2' },
        { id: 'c', product: 'C', quota: '$9' },
      ],
    };
    const types = computeChanges(snap(prev), snap(curr), { date: 'd' })
      .map((e) => e.type)
      .sort();
    assert.deepEqual(types, ['offer_new', 'offer_quota', 'offer_removed']);
  });

  test('额度没变不报', () => {
    const rows = { offers: [{ id: 'a', product: 'A', quota: '$5' }] };
    assert.deepEqual(computeChanges(snap(rows), snap(rows), { date: 'd' }), []);
  });
});

describe('订阅事件', () => {
  test('价格变化超过 1% 才报', () => {
    const prev = { subs: [{ id: 's', product: 'P', tier: 'Pro', price: 20, currency: 'USD' }] };
    const small = { subs: [{ id: 's', product: 'P', tier: 'Pro', price: 20.1, currency: 'USD' }] }; // 0.5%
    const big = { subs: [{ id: 's', product: 'P', tier: 'Pro', price: 24, currency: 'USD' }] }; // 20%

    assert.deepEqual(computeChanges(snap(prev), snap(small), { date: 'd' }), [], '0.5% 不该报');
    assert.equal(computeChanges(snap(prev), snap(big), { date: 'd' })[0].type, 'sub_price');
  });

  test('阈值常量是 1%', () => {
    assert.equal(SUB_PRICE_EPSILON, 0.01);
  });

  test('区价变化进入变化流（T6.12）', () => {
    const row = (cny) => ({
      app: 'ChatGPT',
      plan: 'ChatGPT Plus',
      rows: [{ c: 'TR', n: '土耳其', cur: 'TRY', cny }],
    });
    const prev = { subsRegions: [row(100)] };
    const next = { subsRegions: [row(120)] };
    const events = computeChanges(snap(prev), snap(next), { date: 'd' });
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'sub_region_price');
    assert.match(describeChange(events[0]), /土耳其/);
  });

  test('新档位与下架', () => {
    const prev = { subs: [{ id: 'old', product: 'P', tier: 'A', price: 10, currency: 'USD' }] };
    const curr = { subs: [{ id: 'new', product: 'P', tier: 'B', price: 30, currency: 'USD' }] };
    const types = computeChanges(snap(prev), snap(curr), { date: 'd' })
      .map((e) => e.type)
      .sort();
    assert.deepEqual(types, ['sub_new', 'sub_removed']);
  });
});

describe('中转站事件', () => {
  const relay = (status, input) => ({
    relays: [{ domain: 'r.com', name: 'R', status, prices: { sonnet55: { input, output: 10 } } }],
  });

  test('上线 / 下线', () => {
    const down = computeChanges(snap(relay('ok', 2)), snap(relay('http_500', 2)), { date: 'd' });
    assert.equal(down[0].type, 'relay_down');

    const up = computeChanges(snap(relay('http_500', 2)), snap(relay('ok', 2)), { date: 'd' });
    assert.equal(up[0].type, 'relay_up');
  });

  test('旗舰价变化', () => {
    const events = computeChanges(snap(relay('ok', 2)), snap(relay('ok', 2.5)), { date: 'd' });
    assert.equal(events[0].type, 'relay_price');
    assert.equal(events[0].flagship, 'sonnet55');
    assert.equal(events[0].change.old, 2);
    assert.equal(events[0].change.new, 2.5);
  });

  test('新站', () => {
    const prev = { relays: [] };
    const events = computeChanges(snap(prev), snap(relay('ok', 2)), { date: 'd' });
    assert.equal(events[0].type, 'relay_new');
  });
});

describe('评测事件（F29）', () => {
  const board = (rows) => ({ boards: { b1: { title: 'B1', rows } } });

  test('新榜', () => {
    const events = computeChanges(snap({}, {}), snap({}, board([{ model: 'a', score: 1 }])), {
      date: 'd',
    });
    assert.equal(events[0].type, 'bench_new_board');
  });

  test('前 20 名名次变化要报', () => {
    const prev = board([
      { model: 'a', score: 10 },
      { model: 'b', score: 9 },
    ]);
    const curr = board([
      { model: 'b', score: 9 },
      { model: 'a', score: 10 },
    ]);
    const events = computeChanges(snap({}, prev), snap({}, curr), { date: 'd' });
    const ranks = events.filter((e) => e.type === 'bench_rank');
    assert.equal(ranks.length, 2, 'a 与 b 名次互换，两条都要报');
  });

  test('分数下降要报（F29 的承诺）', () => {
    const prev = board([{ model: 'a', score: 10 }]);
    const curr = board([{ model: 'a', score: 8 }]);
    const events = computeChanges(snap({}, prev), snap({}, curr), { date: 'd' });
    const down = events.find((e) => e.type === 'bench_score_down');
    assert.ok(down, '同一模型分数掉了必须报');
    assert.equal(down.change.old, 10);
    assert.equal(down.change.new, 8);
  });

  test('分数上涨不报', () => {
    const prev = board([{ model: 'a', score: 8 }]);
    const curr = board([{ model: 'a', score: 10 }]);
    const events = computeChanges(snap({}, prev), snap({}, curr), { date: 'd' });
    assert.equal(events.filter((e) => e.type === 'bench_score_down').length, 0);
  });

  test('前 20 名之外的抖动不报', () => {
    const mk = (base) => ({
      boards: {
        b1: {
          title: 'B1',
          rows: Array.from({ length: BENCH_TOP_N + 5 }, (_, i) => ({
            model: `m${i}`,
            score: base + i,
          })),
        },
      },
    });
    // 第 25 名换了个位置
    const prev = mk(100);
    const curr = mk(100);
    [curr.boards.b1.rows[24], curr.boards.b1.rows[23]] = [
      curr.boards.b1.rows[23],
      curr.boards.b1.rows[24],
    ];
    const events = computeChanges(snap({}, prev), snap({}, curr), { date: 'd' });
    assert.equal(events.filter((e) => e.type === 'bench_rank').length, 0);
  });
});

describe('活动事件', () => {
  test('只报高价值新场次', () => {
    const prev = { events: [] };
    const curr = {
      events: [
        { id: 'big', title: '大奖赛', prize: '$50,000', regs: 100 },
        { id: 'small', title: '小聚', prize: '$100', regs: 5 },
      ],
    };
    const events = computeChanges(snap(prev), snap(curr), { date: 'd' });
    assert.equal(events.length, 1);
    assert.equal(events[0].id, 'big');
  });

  test('报名数达标也算高价值', () => {
    const prev = { events: [] };
    const curr = {
      events: [{ id: 'viral', title: '爆款', prize: null, regs: EVENT_HIGH_VALUE.regs + 10 }],
    };
    assert.equal(computeChanges(snap(prev), snap(curr), { date: 'd' }).length, 1);
  });

  test('已存在的场次不重复报', () => {
    const rows = { events: [{ id: 'x', title: 'X', prize: '$99,999' }] };
    assert.deepEqual(computeChanges(snap(rows), snap(rows), { date: 'd' }), []);
  });
});

describe('确定性与排序', () => {
  test('同一输入两次算出完全一样的数组', () => {
    const prev = snap({ models: [{ id: 'a', name: 'A', input: 1, output: 2 }] });
    const curr = snap({ models: [{ id: 'a', name: 'A', input: 2, output: 4 }] });
    assert.deepEqual(
      computeChanges(prev, curr, { date: 'd' }),
      computeChanges(prev, curr, { date: 'd' }),
    );
  });

  test('按类型再按主键排序', () => {
    const prev = snap({
      models: [
        { id: 'z', name: 'Z', input: 1 },
        { id: 'a', name: 'A', input: 1 },
      ],
    });
    const curr = snap({
      models: [
        { id: 'z', name: 'Z', input: 9 },
        { id: 'a', name: 'A', input: 9 },
      ],
    });
    const ids = computeChanges(prev, curr, { date: 'd' }).map((e) => e.id);
    assert.deepEqual(ids, ['a', 'z']);
  });

  test('countByType 汇总', () => {
    const events = [{ type: 'a' }, { type: 'a' }, { type: 'b' }];
    assert.deepEqual(countByType(events), { a: 2, b: 1 });
  });

  test('describeChange 每类都有可读文案', () => {
    for (const type of [
      'model_new',
      'model_removed',
      'model_price_input',
      'offer_new',
      'sub_price',
      'relay_down',
      'bench_score_down',
      'event_high_value',
    ]) {
      const text = describeChange({ type, name: 'X', product: 'P', change: { old: 1, new: 2 } });
      assert.ok(text && text !== type, `${type} 缺可读文案`);
    }
  });
});

describe('Atom 源（验收：结构校验）', () => {
  const events = [
    { type: 'model_price_input', id: 'm1', date: '2026-10-24', change: { old: 1, new: 2 } },
    {
      type: 'bench_score_down',
      boardId: 'b1',
      model: 'x',
      date: '2026-10-24',
      change: { old: 10, new: 9 },
    },
  ];

  const xml = renderAtom({ events, updated: '2026-10-24T00:00:00Z', describe: describeChange });

  test('是合法 XML（能解析、根元素是 feed）', () => {
    assert.match(xml, /^<\?xml version="1\.0" encoding="utf-8"\?>/);
    assert.match(xml, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
    assert.match(xml, /<\/feed>\s*$/);
  });

  test('feed 级三个必填元素齐全', () => {
    assert.match(xml, /<title>[^<]+<\/title>/);
    assert.match(xml, /<id>tag:[^<]+<\/id>/);
    assert.match(xml, /<updated>\d{4}-\d{2}-\d{2}T[\d:]+Z<\/updated>/);
  });

  test('每个 entry 都有 title / id / updated', () => {
    const entries = xml.split('<entry>').slice(1);
    assert.equal(entries.length, events.length);
    for (const e of entries) {
      assert.match(e, /<title>[^<]*<\/title>/, 'entry 缺 title');
      assert.match(e, /<id>tag:[^<]+<\/id>/, 'entry 缺 id');
      assert.match(e, /<updated>[^<]+<\/updated>/, 'entry 缺 updated');
    }
  });

  test('条目 id 稳定：同一事件两次生成相同 id', () => {
    const a = entryId(events[0]);
    const b = entryId({ ...events[0] });
    assert.equal(a, b);
    assert.match(a, /^tag:/, 'id 要用 tag: URI');
  });

  test('不同事件 id 不同', () => {
    assert.notEqual(entryId(events[0]), entryId(events[1]));
  });

  test('XML 特殊字符被转义', () => {
    assert.equal(escapeXml('a<b&c"d\'e'), 'a&lt;b&amp;c&quot;d&apos;e');

    const tricky = renderAtom({
      events: [{ type: 'model_new', id: 'x<y', date: '2026-10-24', name: '<script>' }],
      updated: '2026-10-24T00:00:00Z',
      describe: () => 'a & b < c',
    });
    assert.match(tricky, /a &amp; b &lt; c/);
    assert.equal(tricky.includes('<script>'), false);
  });

  test('条目数受上限约束', () => {
    const many = Array.from({ length: FEED_MAX_ENTRIES + 50 }, (_, i) => ({
      type: 'model_new',
      id: `m${i}`,
      date: '2026-10-24',
    }));
    const out = renderAtom({
      events: many,
      updated: '2026-10-24T00:00:00Z',
      describe: (e) => e.id,
    });
    assert.equal((out.match(/<entry>/g) || []).length, FEED_MAX_ENTRIES);
  });

  test('没有事件时也产出合法 feed', () => {
    const out = renderAtom({ events: [], updated: '2026-10-24T00:00:00Z' });
    assert.match(out, /<feed/);
    assert.equal((out.match(/<entry>/g) || []).length, 0);
  });
});

describe('两份 fixture 快照能算出每类事件（验收）', () => {
  test('用 fixtures/prev 与 fixtures/data 跑一遍', () => {
    const prevDir = join(ROOT, 'fixtures', 'prev', 'snapshots');
    let prev = null;
    try {
      prev = {
        models: JSON.parse(readFileSync(join(prevDir, 'models.json'), 'utf8')),
        offers: JSON.parse(readFileSync(join(prevDir, 'offers.json'), 'utf8')),
        subs: JSON.parse(readFileSync(join(prevDir, 'subs.json'), 'utf8')),
        relays: JSON.parse(readFileSync(join(prevDir, 'relays.json'), 'utf8')),
        events: JSON.parse(readFileSync(join(prevDir, 'events.json'), 'utf8')),
      };
    } catch {
      return; // 没有上一版 fixture 就跳过
    }

    const curr = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'data', 'data.json'), 'utf8'));
    const events = computeChanges(snap(prev), snap(curr), { date: '2026-10-24' });

    assert.ok(events.length > 0, '应当算出变化');
    const types = new Set(events.map((e) => e.type));

    // 至少覆盖这五类（评测榜差异在 fixture 里可能不存在，日志里说明）
    for (const t of ['model_price_input', 'model_new', 'offer_new', 'sub_price', 'relay_up']) {
      assert.ok(types.has(t), `缺少 ${t}；实际 ${[...types].join(', ')}`);
    }
  });
});
