/**
 * health.mjs 门禁的特征测试（T0.3）。
 *
 * 构造最小数据对象，逐条覆盖红线、警戒与通过三种结论。
 * 这些用例锁定「哪条规则判红」，改动阈值时必须同步更新。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { checkData, LAYERS } from '../../health.mjs';

/** 造一份每层都刚好过红线的数据。 */
function baseData() {
  const d = {
    meta: { counts: {} },
    models: [],
    offers: [],
    subsRegions: [],
    subsThird: [],
    relays: [],
    events: [],
    news: [],
    resources: [],
    bench: [],
    signals: [],
    orApps: [],
    hnSignals: [],
  };
  for (const [key, spec] of Object.entries(LAYERS)) {
    if (key === 'subsThird') {
      d.subsThird = Array.from({ length: spec.min }, (_, i) => ({ id: i }));
      continue;
    }
    if (key === 'relaysLive') {
      // relaysLive 由 relays 里 status==='ok' 的行数决定
      d.relays = Array.from({ length: spec.min }, (_, i) => ({ id: i, status: 'ok' }));
      continue;
    }
    d[key] = Array.from({ length: spec.min }, (_, i) => ({ id: i }));
  }
  d.meta.counts = {
    models: LAYERS.models.min,
    offers: LAYERS.offers.min,
    subsRegions: LAYERS.subsRegions.min,
    relays: LAYERS.relays.min,
    events: LAYERS.events.min,
    news: LAYERS.news.min,
    resources: LAYERS.resources.min,
    bench: LAYERS.bench.min,
    signals: LAYERS.signals.min,
    orApps: LAYERS.orApps.min,
    hnSignals: LAYERS.hnSignals.min,
  };
  return d;
}

describe('checkData 层级下限', () => {
  test('刚好达到下限时该层不判红', () => {
    const result = checkData(baseData(), null);
    const modelsRow = result.rows.find((r) => r.key === 'models');
    assert.notEqual(modelsRow.status, 'red');
  });

  test('整层为空判红且说明「整层为空」', () => {
    const d = baseData();
    d.models = [];
    d.meta.counts.models = 0;

    const result = checkData(d, null);
    const row = result.rows.find((r) => r.key === 'models');
    assert.equal(row.status, 'red');
    assert.match(row.note, /整层为空/);
    assert.equal(result.ok, false);
  });

  test('低于红线但不是空，说明带具体下限', () => {
    const d = baseData();
    d.meta.counts.models = LAYERS.models.min - 1;
    d.models = Array.from({ length: LAYERS.models.min - 1 }, (_, i) => ({ id: i }));

    const row = checkData(d, null).rows.find((r) => r.key === 'models');
    assert.equal(row.status, 'red');
    assert.match(row.note, /低于红线/);
  });

  test('低于警戒值但高于红线判 warn', () => {
    const d = baseData();
    // warnBelow 与 min 之间取一个值
    const between = LAYERS.models.min + 1;
    assert.ok(between < LAYERS.models.warnBelow, '前提：min 与 warnBelow 之间有空隙');
    d.models = Array.from({ length: between }, (_, i) => ({ id: i }));
    d.meta.counts.models = between;

    const row = checkData(d, null).rows.find((r) => r.key === 'models');
    assert.equal(row.status, 'warn');
  });
});

describe('checkData 缩水检测', () => {
  test('较上次缩水超过阈值判红', () => {
    const d = baseData(); // 恰好 min
    const prevCount = Math.ceil(LAYERS.models.min / LAYERS.models.shrink) + 10;

    const row = checkData(d, (k) => (k === 'models' ? prevCount : null)).rows.find(
      (r) => r.key === 'models',
    );
    assert.equal(row.status, 'red');
    assert.match(row.note, /缩水/);
  });

  test('没有上一版时不触发缩水判断', () => {
    const row = checkData(baseData(), null).rows.find((r) => r.key === 'models');
    assert.notEqual(row.status, 'red');
  });

  test('上一版本身低于红线时不比缩水（避免连锁误判）', () => {
    const d = baseData();
    const row = checkData(d, (k) => (k === 'models' ? LAYERS.models.min - 1 : null)).rows.find(
      (r) => r.key === 'models',
    );
    assert.notEqual(row.status, 'red');
  });
});

describe('checkData 结论结构', () => {
  test('返回 rows / issues / ok / red / warn', () => {
    const result = checkData(baseData(), null);
    assert.ok(Array.isArray(result.rows));
    assert.ok(Array.isArray(result.issues));
    assert.equal(typeof result.ok, 'boolean');
    assert.ok(Array.isArray(result.red));
    assert.ok(Array.isArray(result.warn));
  });

  test('red 与 issues 中 level=red 的条目一致', () => {
    const d = baseData();
    d.models = [];
    d.meta.counts.models = 0;
    d.offers = [];
    d.meta.counts.offers = 0;

    const result = checkData(d, null);
    assert.ok(result.red.length >= 2);
    assert.equal(result.red.length, result.issues.filter((i) => i.level === 'red').length);
  });
});
