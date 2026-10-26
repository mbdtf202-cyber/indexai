/**
 * 有效成本的单一事实来源（T2.5 · F36 · INV-5）。
 *
 * 现状：同一个公式在四处各写一份，参数还不一样——
 * - 采集端 `WORKLOAD = { h: 0.7, s: 0.3 }`（写死，只此一处能改）
 * - 比价页 `state.hit = 0.7, state.outShare = 0.2`
 * - 中转站页 `s = 0.3`
 * - 方法页两套都写了一遍
 *
 * 任一端改动，其它三处就悄悄错了。这里要求：**画像只有一份**，
 * 每套都有名字与说明，页面与方法页都从它读。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

describe('lib/effective-cost.js（F36）', () => {
  let cost;

  test('加载', async () => {
    cost = await import('../../lib/effective-cost.js');
    assert.equal(typeof cost.effectiveCost, 'function');
    assert.equal(typeof cost.PROFILES, 'object');
    assert.equal(typeof cost.FORMULA, 'string');
  });

  test('两套画像都在，且有名字与说明', () => {
    const keys = Object.keys(cost.PROFILES);
    assert.ok(keys.length >= 2, `至少要收录现有的两套，实际：${keys.join(',')}`);
    for (const k of keys) {
      const p = cost.PROFILES[k];
      assert.ok(p.label, `${k} 缺 label`);
      assert.ok(p.note, `${k} 缺 note（页面要用它解释口径）`);
      assert.ok(p.h >= 0 && p.h <= 1, `${k} 的 h 超范围`);
      assert.ok(p.s > 0 && p.s < 1, `${k} 的 s 超范围`);
    }
  });

  test('两套画像的取值与现状一致（不偷偷改数字）', () => {
    // 比价页从来是 s=0.2，中转页是 s=0.3 —— 先如实收录，改了就是行为变化
    const values = Object.values(cost.PROFILES)
      .map((p) => `${p.h}/${p.s}`)
      .sort();
    assert.deepEqual(values, ['0.7/0.2', '0.7/0.3']);
  });

  test('有效成本按画像计算', () => {
    const price = { kind: 'per_1m', input: 2, output: 10, cacheRead: 0.2 };
    const p = cost.PROFILES[Object.keys(cost.PROFILES)[0]];
    const got = cost.effectiveCost(price, p);
    const expected = (1 - p.s) * ((1 - p.h) * 2 + p.h * 0.2) + p.s * 10;
    assert.equal(got, Number(expected.toFixed(4)));
  });

  test('不传画像时用默认画像，且默认画像在表里', () => {
    const price = { kind: 'per_1m', input: 2, output: 10, cacheRead: 0.2 };
    const withDefault = cost.effectiveCost(price);
    assert.equal(withDefault, cost.effectiveCost(price, cost.PROFILES[cost.DEFAULT_PROFILE]));
  });

  test('缺缓存读时按 0 命中处理（不假装有折扣）', () => {
    const price = { kind: 'per_1m', input: 2, output: 10, cacheRead: null };
    const p = { h: 0.7, s: 0.3 };
    // 没有缓存价时，命中率不应产生任何折扣
    assert.equal(cost.effectiveCost(price, p), cost.effectiveCost({ ...price, cacheRead: 2 }, p));
  });

  test('非 per_1m 计价返回 null', () => {
    assert.equal(cost.effectiveCost({ kind: 'per_call', input: 1 }, { h: 0.7, s: 0.3 }), null);
    assert.equal(cost.effectiveCost(null), null);
  });

  test('公式文本包含三个参数名，供方法页直接渲染', () => {
    assert.match(cost.FORMULA, /input/);
    assert.match(cost.FORMULA, /cache_read|cacheRead/);
    assert.match(cost.FORMULA, /output/);
  });
});
