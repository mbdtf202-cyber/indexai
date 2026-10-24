/**
 * adoption 层（T3.1c2）。
 *
 * 这一层比 fx 复杂的地方在于：它有一个**容易骗人的计数**。
 * `meta.collect[].n` 由编排器按「对象里数组长度之和」计算，而层曾经返回
 * `{apps: 24, models: 20}` —— 于是 n=44，看起来交付了 44 条数据，其实页面只读 24 条。
 * 而 models 在 T2.2 就已经删掉了（页面从不读它），那 20 条从来没到过任何地方。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const RANKINGS_URL = 'https://openrouter.ai/rankings';

/** 造一个足够长的假页面（层会拒绝短页面）。 */
function longHtml() {
  return `${'x'.repeat(12_000)}`;
}

describe('adoption 层（T3.1c2）', () => {
  let layer;

  test('加载并按契约导出', async () => {
    layer = (await import('../../pipeline/layers/adoption/index.js')).default;
    assert.equal(layer.id, 'adoption');
    assert.deepEqual(layer.sources, ['openrouter.ai/rankings']);
  });

  test('抓取成功时交给解析器', async () => {
    let got = null;
    const raw = await layer.fetch({
      http: {
        text: async () => ({ ok: true, status: 200, text: longHtml() }),
      },
      parse: (html) => {
        got = html.length;
        return { apps: [{ title: 'A', rank: 1 }], models: [] };
      },
    });
    assert.equal(got, 12_000);
    assert.equal(raw.apps.length, 1);
  });

  test('HTTP 不成功时抛错（不是返回空数组）', async () => {
    await assert.rejects(
      () =>
        layer.fetch({
          http: { text: async () => ({ ok: false, status: 403, text: '' }) },
          parse: () => ({ apps: [], models: [] }),
        }),
      /403/,
    );
  });

  test('页面过短视为失败（被拦或改版）', async () => {
    await assert.rejects(
      () =>
        layer.fetch({
          http: { text: async () => ({ ok: true, status: 200, text: 'short' }) },
          parse: () => ({ apps: [], models: [] }),
        }),
      /过短/,
    );
  });

  test('解析出 0 条也算失败，而不是「今天没人用」', async () => {
    await assert.rejects(
      () =>
        layer.fetch({
          http: { text: async () => ({ ok: true, status: 200, text: longHtml() }) },
          parse: () => ({ apps: [], models: [] }),
        }),
      /0 条/,
    );
  });

  test('normalize 只交付 apps，不再带 models', () => {
    const out = layer.normalize({
      apps: [{ title: 'A', rank: 1, tokens: 10 }],
      models: [{ name: 'm1' }, { name: 'm2' }],
    });
    assert.deepEqual(Object.keys(out.records), ['apps'], 'models 没有消费者，不该交付');
    assert.equal(out.records.apps.length, 1);
  });

  test('坏行被隔离而不是混进结果', () => {
    const out = layer.normalize({
      apps: [{ title: 'ok', rank: 1 }, { title: '', rank: 2 }, { title: 'no-rank' }],
      models: [{ name: 'm' }],
    });
    assert.equal(out.records.apps.length, 1);
    assert.equal(out.quarantined.length, 2);
  });

  test('本次为空时沿用上一版并标 stale', () => {
    const out = layer.merge({ apps: [{ title: 'old', rank: 1 }] }, { apps: [] });
    assert.equal(out.apps.length, 1);
    assert.equal(out.stale, true);
  });

  test('两版都空时给出空数组（不抛）', () => {
    assert.deepEqual(layer.merge(null, null), { apps: [] });
  });

  test('计数口径：交付的对象只有一个数组，n 与页面看到的条数一致', () => {
    // 这是本轮修掉的问题：原来 {apps:24, models:20} 会被算成 44
    const out = layer.merge(null, { apps: [{ title: 'a', rank: 1 }] });
    const arraySum = Object.values(out)
      .filter(Array.isArray)
      .reduce((n, a) => n + a.length, 0);
    assert.equal(arraySum, 1, `n 应等于 apps 条数，实际 ${arraySum}`);
  });
});
