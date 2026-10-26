/**
 * 层超预算 → partial，其它层不受影响（T3.3 验收条）。
 *
 * 要害是把 **partial 与 failed 分开**：
 * - failed：这层挂了，没有可交付的东西；
 * - partial：没跑完（超时/超预算），报告中写明原因，其它层照常。
 *
 * 混成一个是踩过的坑（T1.3）：把超时当失败会丢掉已采到的数据，
 * 而把失败当超时会让人以为「等一下就好」。
 *
 * 这里不依赖真实网络：直接用 `runLayer` 构造一个永远不返回的层，
 * 把预算设成 30ms，断言它标 partial 且带 reason。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { runLayerForTest } from '../../pipeline/budget.mjs';

/** 只做三件事的测试层：fetch 慢、normalize 恒等、merge 取新值。 */
function slowLayer(id, ms) {
  return {
    id,
    budget: { ms, requests: 1 },
    async fetch() {
      await new Promise((r) => setTimeout(r, 5_000));
      return [];
    },
    normalize: (raw) => ({ records: raw }),
    merge: (_prev, next) => next,
  };
}

function fastLayer(id) {
  return {
    id,
    budget: { ms: 5_000, requests: 1 },
    async fetch() {
      return [{ id: 'x' }];
    },
    normalize: (raw) => ({ records: raw }),
    merge: (_prev, next) => next,
  };
}

const ctx = {
  log: () => {},
  deadline: undefined,
  today: () => '2026-10-24',
  now: () => new Date(),
};

describe('层预算（T3.3）', () => {
  test('超过本层预算的层标 partial 并写 reason', async () => {
    const { rec, value } = await runLayerForTest(slowLayer('slow', 30), ctx, null, null);
    assert.equal(rec.status, 'partial', `应标 partial，实际 ${rec.status}`);
    assert.ok(rec.reason, 'partial 必须写 reason');
    assert.match(rec.reason, /预算/);
    assert.deepEqual(value, [], '超预算时交付上一版（这里是空）');
  });

  test('没超预算的层照常 ok', async () => {
    const { rec, value } = await runLayerForTest(fastLayer('fast'), ctx, null, null);
    assert.equal(rec.status, 'ok');
    assert.equal(value.length, 1);
  });

  test('整次运行已过期时，层直接标 partial 且不执行', async () => {
    let called = false;
    const layer = {
      id: 'skipped',
      budget: { ms: 1_000, requests: 1 },
      async fetch() {
        called = true;
        return [];
      },
      normalize: (raw) => ({ records: raw }),
      merge: (_p, n) => n,
    };
    const { rec } = await runLayerForTest(layer, ctx, null, Date.now() - 1);
    assert.equal(rec.status, 'partial');
    assert.match(rec.reason, /截止时间/);
    assert.equal(called, false, '过期后不该再发起请求');
  });

  test('超预算是 partial，不是 failed', async () => {
    const { rec } = await runLayerForTest(slowLayer('slow', 20), ctx, null, null);
    assert.notEqual(rec.status, 'failed', '超预算不能记成失败');
    assert.equal(rec.error, undefined, 'partial 不该带 error 字段');
  });
});
