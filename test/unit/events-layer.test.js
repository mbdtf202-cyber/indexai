/**
 * events 层（T3.1c10）。
 *
 * 这是唯一需要**契约扩展**的层：Luma 源依赖可变的运行期状态
 * （冷却累计、封禁标记、geo 预算起点）。按 S4.4，层不能持有可变模块级状态——
 * 否则同一进程里两次调用会互相污染，而测试根本无法重置它。
 *
 * 扩展方式：状态经 `ctx.state` 显式传入。层的每一次调用只读写传给它的那份，
 * 编排器负责创建与重置。这样依赖是**声明式的**：能测、能重置、不会跨层串味。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const _now = () => '2026-10-24';

/** 一个最小的状态对象，形状与 collect.mjs 的 lumaState 一致。 */
function freshState() {
  return { blocked: false, reason: null, cooldownMs: 0, gaveUp: 0, geoStart: 0, requests: 0 };
}

describe('events 层（T3.1c10）', () => {
  let layer;

  test('加载并按契约导出', async () => {
    layer = (await import('../../pipeline/layers/events/index.js')).default;
    assert.equal(layer.id, 'events');
    assert.equal(layer.sources.length, 4, '四个源：Devpost / Luma / Devfolio / AIOS');
  });

  test('四个源名都在 sources 里', () => {
    assert.ok(layer.sources.includes('devpost.com/api/hackathons'));
    assert.ok(layer.sources.includes('api.lu.ma'));
    assert.ok(layer.sources.includes('api.devfolio.co'));
    assert.ok(layer.sources.includes('AIOS_OPPORTUNITIES'));
  });

  test('并行取四个源，单源失败不影响其它源', async () => {
    const raw = await layer.fetch({
      fetchDevpost: async () => [{ id: 'd1', source: 'Devpost' }],
      fetchLuma: async () => {
        throw new Error('luma down');
      },
      fetchDevfolio: async () => [{ id: 'f1', source: 'Devfolio' }],
      fetchAios: async () => [],
      testProfile: false,
      state: freshState(),
      log: () => {},
    });
    assert.equal(raw.devpost.length, 1);
    assert.equal(raw.luma.length, 0, '失败的源给空数组，不是 undefined');
    assert.equal(raw.devfolio.length, 1);
  });

  test('测试档位跳过 AIOS（内容不在版本控制里）', async () => {
    let aiosCalled = false;
    const raw = await layer.fetch({
      fetchDevpost: async () => [],
      fetchLuma: async () => [],
      fetchDevfolio: async () => [],
      fetchAios: async () => {
        aiosCalled = true;
        return [{ id: 'a' }];
      },
      testProfile: true,
      state: freshState(),
      log: () => {},
    });
    assert.equal(aiosCalled, false, '测试档位不该去读本机文件');
    assert.deepEqual(raw.aios, []);
  });

  test('状态经 ctx.state 传入，层不持有模块级变量', async () => {
    const state = freshState();
    state.blocked = true;
    let sawBlocked = null;
    await layer.fetch({
      fetchDevpost: async () => [],
      // Luma 的实现在 collect.mjs，它读的是传进去的 state
      fetchLuma: async (s) => {
        sawBlocked = s.blocked;
        return [];
      },
      fetchDevfolio: async () => [],
      fetchAios: async () => [],
      testProfile: false,
      state,
      log: () => {},
    });
    assert.equal(sawBlocked, true, '层必须把 ctx.state 原样交给源函数');
  });

  test('normalize 把四个源拼成一条列表', () => {
    const out = layer.normalize({
      devpost: [{ id: 'd' }],
      luma: [{ id: 'l' }],
      aios: [{ id: 'a' }],
      devfolio: [{ id: 'f' }],
    });
    assert.equal(out.records.length, 4);
  });

  test('全空时被隔离而不是静默产出空数组', () => {
    const out = layer.normalize({ devpost: [], luma: [], aios: [], devfolio: [] });
    assert.equal(out.records.length, 0);
    assert.equal(out.quarantined.length, 1);
  });

  /* 场次型合并（T3.6 · S3.3 · F38）：不再是「本次有就用本次」。
   * 旧语义会让「Luma 掉一半」直接变成「活动数腰斩」。 */
  const ctx = { today: () => '2026-10-24' };

  test('merge：本次与上一版取并集，不是覆盖', () => {
    const prev = [{ id: 'old', start: '2026-11-01', end: '2026-11-02' }];
    const next = [{ id: 'new', start: '2026-11-03', end: '2026-11-04' }];
    const out = layer.merge(prev, next, ctx);
    assert.equal(out.length, 2, '两条都该在（并集）');
    assert.ok(out.some((e) => e.id === 'new'));
    assert.ok(out.some((e) => e.id === 'old'));
  });

  test('merge：本次全空时沿用上一版（未结束且在 TTL 内）', () => {
    const prev = [{ id: 'old', start: '2026-11-01', end: '2026-11-02', lastSeen: '2026-10-24' }];
    const out = layer.merge(prev, [], ctx);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, 'old');
    assert.equal(out[0].stale, true, '沿用来的场次要标 stale');
  });

  test('merge：已结束的场次不再保留', () => {
    const prev = [{ id: 'past', start: '2026-10-01', end: '2026-10-05', lastSeen: '2026-10-24' }];
    assert.equal(layer.merge(prev, [], ctx).length, 0);
  });

  test('门禁：一个活动都没有告警（Devfolio 等源本身就小）', () => {
    const rule = layer.health.rules[0];
    assert.equal(rule.check([]).level, 'warn');
    assert.equal(rule.check([{ id: 'x' }]).level, 'ok');
  });
});
