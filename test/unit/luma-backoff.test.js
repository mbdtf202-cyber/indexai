/**
 * Luma 的冷却必须在上界内（T1.3 · F04 · INV-8）。
 *
 * 现状：单请求 429 后按 attempt 递增冷却（180s → 360s → 540s → 720s），
 * 最后一次睡完直接 return，且 geo 预算只在两次请求之间检查。
 * 8 分钟预算里只要命中两次 429，一次请求就能睡掉 9 分钟，比整层的预算还长，
 * 结果是 job 超时、当天所有层都不更新。
 *
 * 这里盯三件事：
 * 1. 累计冷却不超过单主机上限（6 分钟）；
 * 2. 整个 Luma 层的睡眠总量不超过 geo 预算（8 分钟）；
 * 3. 受阻后要停下来，并如实记账（meta.net.lumaBlocked + 原因），
 *    已经采到的结果照常返回，不能因为限速把整层判成空。
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { addFault, clearFaults } from '../support/http-replay.js';
import { resetSleepCounter, peekRequestedSleepMs } from '../../lib/clock.js';

/** 单主机冷却总上限（与 collect.mjs 的常量对齐，改动必须两边同时改）。 */
const COOLDOWN_CAP_MS = 6 * 60 * 1000;
/** geo 总预算（同样是常量镜像）。 */
const GEO_BUDGET_MS = 8 * 60 * 1000;

describe('Luma 冷却上界（F04）', () => {
  let luma;

  before(async () => {
    // 回放由运行器的 --import 建立（npm test 已带 INDEXAI_HTTP=replay）。
    // 这里不要自己改 process.env 再 import：动态 import 会把 collect.mjs 拉成
    // 第二份实例，限速状态与 sleep 记账都不在同一个模块上。
    luma = await import('../../collect.mjs');
  });

  after(() => {
    clearFaults();
    resetSleepCounter();
  });

  test('全部 429：累计冷却不超过 6 分钟，总睡眠不超过 geo 预算', async () => {
    clearFaults();
    resetSleepCounter();
    luma.resetLumaState();
    addFault('api.lu.ma', { status: 429 });

    const rows = await luma.fetchLuma();
    const slept = peekRequestedSleepMs();

    assert.ok(Array.isArray(rows), '要返回数组（哪怕是空的）');
    assert.ok(
      slept <= GEO_BUDGET_MS,
      `总睡眠 ${Math.round(slept / 1000)}s 超过 geo 预算 ${GEO_BUDGET_MS / 1000}s`,
    );

    const meta = luma.getLumaBlockState();
    assert.ok(
      meta.cooldownMs <= COOLDOWN_CAP_MS,
      `累计冷却 ${Math.round(meta.cooldownMs / 1000)}s 超过上限 ${COOLDOWN_CAP_MS / 1000}s`,
    );
    assert.equal(meta.blocked, true, '全 429 必须标为受阻');
    assert.ok(meta.reason, '受阻要带原因，不能只说「失败了」');
  });

  test('受阻后不再发起新请求', async () => {
    clearFaults();
    resetSleepCounter();
    luma.resetLumaState();
    addFault('api.lu.ma', { status: 429 });

    await luma.fetchLuma();
    const after1 = luma.getLumaBlockState();
    const requestsAfter1 = after1.requests;

    resetSleepCounter();
    await luma.fetchLuma();
    const after2 = luma.getLumaBlockState();

    // 第二次调用时已经处于受阻态：可以再试一次探封（最多一次请求），
    // 但不能再把整套查询与城市重跑一遍。
    const delta = after2.requests - requestsAfter1;
    assert.ok(delta <= 1, `受阻状态下又发了 ${delta} 个请求；应当在第一次探测失败后就停手`);
  });

  test('没有 429 时不被标成受阻，结果照常返回', async () => {
    clearFaults();
    resetSleepCounter();
    luma.resetLumaState();

    const rows = await luma.fetchLuma();
    const state = luma.getLumaBlockState();

    assert.equal(state.blocked, false, '没有限速就不该说自己受阻');
    assert.equal(state.cooldownMs, 0, '没有 429 就不该有冷却');
    // 条数取决于录制数据与 AI 过滤，由 golden 逐字节锁住；这里只要求采到了东西。
    assert.ok(rows.length > 0, '回放数据下应当能采到活动');
  });
});
