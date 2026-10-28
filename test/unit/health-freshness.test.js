/**
 * 新鲜度门禁（T1.7 · F09、F23 · S4.1）。
 *
 * F09：`fetchNews` 返回的是「合并后的归档」，三路源全挂也照样返回一大坨，
 * 于是情报层永远被记成 `fresh`；门禁只看跨度与天数，不看最新一条的年龄。
 * 结果是「情报十天没更新」这件事在页面上完全不可见。
 *
 * F23：汇率回退到写死的 7.1 时门禁照样通过——只检查区间，不检查 source 与 stale。
 * 读者看到的每个人民币价格都可能来自一个陈旧的固定汇率，而页面说一切正常。
 *
 * 这里用固定时钟把「今天」钉死，逐条验证判定边界。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/** 固定「今天」：与其它用例同一口径（UTC 01:00 = 北京时间 09:00 同日）。 */
const NOW = new Date('2026-10-24T01:00:00Z');
// 必须在自己 import health.mjs 之前设好：lib/clock.js 在模块加载时读一次环境变量。
// 不设的话，用例只在「今天恰好是 2026-10-24」的那天成立，那不是可用的测试。
process.env.INDEXAI_NOW ??= NOW.toISOString();

/** 造一份只有 meta.news 与 fx 的最小数据，够 checkData 跑完必要分支。 */
function dataWith({ lastNews, span = 60, days = 30, fx = {} } = {}) {
  return {
    meta: {
      generated_at: NOW.toISOString(),
      counts: {
        models: 474,
        offers: 37,
        subsRegions: 18,
        subsThird: 209,
        relays: 54,
        relaysLive: 22,
        events: 620,
        eventsOpen: 300,
        resources: 20,
        news: 2246,
      },
      fx: {
        USDCNY: 7.1,
        as_of: '2026-10-24',
        source: 'open.er-api.com',
        fetched_at: NOW.toISOString(),
        ...fx,
      },
      collect: [],
      dedupe: { aggregator_dropped: 0, unpriced_dropped: 0 },
    },
    models: [],
    offers: [],
    subsRegions: [],
    subsThird: [],
    relays: [],
    events: [],
    resources: [],
    signals: [],
    news: { n: 2246, days, span, first: '2026-08-01', last: lastNews, bytes: 900000 },
  };
}

/** 从 checkData 的结果里挑出跟某个 key 有关的条目。 */
function msgsFor(res, key) {
  return (res.issues || [])
    .filter((i) => i.key === key)
    .map((i) => ({ level: i.level, msg: i.msg }));
}

describe('情报新鲜度（F09）', () => {
  let checkData;

  test('加载 health.mjs', async () => {
    ({ checkData } = await import('../../health.mjs'));
    assert.equal(typeof checkData, 'function');
  });

  test('最新条目是今天 → 不报警', async () => {
    const res = checkData(dataWith({ lastNews: '2026-10-24' }), null);
    assert.deepEqual(
      msgsFor(res, 'news').filter((m) => /新鲜|未更新|天前/.test(m.msg)),
      [],
    );
  });

  test('最新条目停在 2 天前 → warn', async () => {
    const res = checkData(dataWith({ lastNews: '2026-10-22' }), null);
    const hits = msgsFor(res, 'news').filter((m) => /2 天前|未更新/.test(m.msg));
    assert.equal(hits.length, 1, `应当有一条 warn，实际：${JSON.stringify(msgsFor(res, 'news'))}`);
    assert.equal(hits[0].level, 'warn');
  });

  test('最新条目停在 3 天前 → red', async () => {
    const res = checkData(dataWith({ lastNews: '2026-10-21' }), null);
    const hits = msgsFor(res, 'news').filter((m) => /3 天前|未更新/.test(m.msg));
    assert.equal(hits.length, 1, `应当有一条 red，实际：${JSON.stringify(msgsFor(res, 'news'))}`);
    assert.equal(hits[0].level, 'red');
  });

  test('日期按 Asia/Shanghai 归日：UTC 晚上仍算当天', async () => {
    // 北京时间 10-24 08:00 = UTC 10-24 00:00；这份数据在 UTC 14:00（北京 22:00）生成，
    // 最新条目 10-23 仍应算「1 天前」，不该被算成 2 天前。
    const res = checkData(dataWith({ lastNews: '2026-10-23' }), null);
    assert.equal(
      msgsFor(res, 'news').filter((m) => /天前/.test(m.msg)).length,
      0,
      '1 天前不该报警',
    );
  });
});

describe('汇率回退（F23）', () => {
  let checkData;

  test('加载', async () => {
    ({ checkData } = await import('../../health.mjs'));
  });

  test('source=fallback → warn，并说明在用固定值', async () => {
    const res = checkData(
      dataWith({ lastNews: '2026-10-24', fx: { source: 'fallback', as_of: 'fallback' } }),
      null,
    );
    const hits = msgsFor(res, 'meta').filter((m) => /汇率/.test(m.msg) && m.msg.includes('回退'));
    assert.equal(
      hits.length,
      1,
      `应当有一条汇率 warn，实际：${JSON.stringify(msgsFor(res, 'meta'))}`,
    );
    assert.equal(hits[0].level, 'warn');
  });

  test('stale=true → warn', async () => {
    const res = checkData(dataWith({ lastNews: '2026-10-24', fx: { stale: true } }), null);
    const hits = msgsFor(res, 'meta').filter((m) => /汇率/.test(m.msg));
    assert.ok(hits.length >= 1, '沿用上次汇率也要响（INV-4）');
    assert.equal(hits[0].level, 'warn');
  });

  test('正常汇率不报警', async () => {
    const res = checkData(dataWith({ lastNews: '2026-10-24' }), null);
    assert.deepEqual(
      msgsFor(res, 'meta').filter((m) => /汇率/.test(m.msg)),
      [],
    );
  });
});
