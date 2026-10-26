/**
 * 分层门禁与分层发布（T3.7 · S3.5 · S4.1 · F03）。
 *
 * ## F03 的病根
 *
 * 整站一个门禁：评测层挂了，活动、模型、情报全都跟着不发布。
 * 一次源站故障冻结整个站点——最贵的一种脆弱。
 *
 * ## 正解
 *
 * 门禁按层出结论；每层一个文件；manifest 记录每层的文件名、哈希、status、
 * as_of、last_ok、计数与门禁结论。某层 red 时**只**沿用该层上一版，
 * 其余层照常更新。整站只在 manifest 本身或 schema 版本出错时失败。
 *
 * ## 验收
 *
 * 「评测层 red」→ 其它层照常更新，manifest 里评测层为 `stale` 并指向上一版文件，
 * 只有评测页显示沿用标记。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  runLayerGate,
  newestAgeHours,
  manifestEntry,
  buildManifest,
  validateManifest,
  servedFileFor,
  sha256,
  VERDICT,
  MANIFEST_SCHEMA,
} from '../../pipeline/manifest.mjs';

const NOW = '2026-10-24T01:00:00.000Z';
const TODAY = '2026-10-24';

/* ────────────────────────── 门禁分级 ────────────────────────── */

describe('门禁：下限 / 缩水 / 新鲜度 / 语义规则（S4.1）', () => {
  test('条数低于下限 → red', () => {
    const layer = { health: { floor: 10, rules: [] } };
    const r = runLayerGate(layer, new Array(5).fill({}), {});
    assert.equal(r.verdict, VERDICT.RED);
    assert.match(r.reasons[0], /低于下限/);
  });

  test('达到下限 → ok', () => {
    const layer = { health: { floor: 3, rules: [] } };
    assert.equal(runLayerGate(layer, [{}, {}, {}], {}).verdict, VERDICT.OK);
  });

  test('缩水到一半以下 → red', () => {
    const layer = { health: { shrink: 0.5, rules: [] } };
    // 上一版 100，本次 20 = 20%
    const r = runLayerGate(layer, new Array(20).fill({}), { prevCount: 100 });
    assert.equal(r.verdict, VERDICT.RED);
    assert.match(r.reasons[0], /缩水/);
  });

  test('缩水在阈值内 → ok', () => {
    const layer = { health: { shrink: 0.5, rules: [] } };
    assert.equal(
      runLayerGate(layer, new Array(80).fill({}), { prevCount: 100 }).verdict,
      VERDICT.OK,
    );
  });

  test('没有上一版时不做缩水判断', () => {
    const layer = { health: { shrink: 0.5, rules: [] } };
    assert.equal(
      runLayerGate(layer, new Array(5).fill({}), { prevCount: null }).verdict,
      VERDICT.OK,
    );
  });

  test('新鲜度超时 → warn（不是 red）', () => {
    const layer = { health: { freshness: 36, rules: [] } };
    const rows = [{ startAt: '2026-10-20T00:00:00.000Z' }]; // 4 天前
    const r = runLayerGate(layer, rows, { now: NOW });
    assert.equal(r.verdict, VERDICT.WARN);
    assert.match(r.reasons[0], /小时/);
  });

  test('新鲜度正常 → ok', () => {
    const layer = { health: { freshness: 36, rules: [] } };
    const rows = [{ startAt: '2026-10-23T23:00:00.000Z' }];
    assert.equal(runLayerGate(layer, rows, { now: NOW }).verdict, VERDICT.OK);
  });

  test('语义规则返回 red → red', () => {
    const layer = {
      health: { rules: [{ id: 'x', check: () => ({ level: 'red', message: '空' }) }] },
    };
    assert.equal(runLayerGate(layer, [{}], {}).verdict, VERDICT.RED);
  });

  test('语义规则返回 warn → warn', () => {
    const layer = {
      health: { rules: [{ id: 'x', check: () => ({ level: 'warn', message: '少' }) }] },
    };
    assert.equal(runLayerGate(layer, [{}], {}).verdict, VERDICT.WARN);
  });

  test('规则抛错不炸门禁，降级为 warn', () => {
    const layer = {
      health: {
        rules: [
          {
            id: 'boom',
            check: () => {
              throw new Error('坏了');
            },
          },
        ],
      },
    };
    const r = runLayerGate(layer, [{}], {});
    assert.equal(r.verdict, VERDICT.WARN);
    assert.match(r.reasons[0], /抛错/);
  });

  test('red 覆盖 warn（不会因为后面的 warn 降级）', () => {
    const layer = {
      health: {
        floor: 10,
        rules: [{ id: 'w', check: () => ({ level: 'warn', message: '轻微' }) }],
      },
    };
    assert.equal(runLayerGate(layer, [{}], {}).verdict, VERDICT.RED);
  });
});

describe('新鲜度计算', () => {
  test('认 startAt / checked_at / publishedAt / d / seen', () => {
    for (const field of ['startAt', 'checked_at', 'publishedAt', 'd', 'seen']) {
      const row = { [field]: '2026-10-23T01:00:00.000Z' };
      assert.ok(newestAgeHours([row], NOW) < 25, `${field} 应当被识别`);
    }
  });

  test('纯日期按 UTC 零点算', () => {
    const h = newestAgeHours([{ d: TODAY }], NOW);
    assert.ok(h > 0 && h < 25);
  });

  test('全无时间字段 → null（算不出来不等于很旧）', () => {
    assert.equal(newestAgeHours([{ id: 'x' }], NOW), null);
  });

  test('取最新的一条', () => {
    const rows = [{ startAt: '2026-10-01T00:00:00.000Z' }, { startAt: '2026-10-23T00:00:00.000Z' }];
    assert.ok(newestAgeHours(rows, NOW) < 30);
  });
});

/* ────────────────────────── manifest ────────────────────────── */

describe('manifest 结构（S3.5）', () => {
  const entry = ({ layer: id = 'bench', file: f, ...rest } = {}) =>
    manifestEntry({
      layer: id,
      file: f || `layer-${id}.json`,
      content: '[{"id":"a"}]',
      verdict: VERDICT.OK,
      asOf: TODAY,
      lastOk: TODAY,
      count: 1,
      ...rest,
    });

  test('条目含文件名、哈希、status、as_of、last_ok、计数、门禁结论', () => {
    const e = entry({});
    for (const k of [
      'layer',
      'file',
      'served_file',
      'hash',
      'status',
      'as_of',
      'last_ok',
      'count',
      'gate',
    ]) {
      assert.ok(Object.hasOwn(e, k), `缺字段 ${k}`);
    }
    assert.equal(e.hash, sha256('[{"id":"a"}]'));
  });

  test('red 时 served_file 指向上一版，并算出 stale_days', () => {
    const e = entry({
      verdict: VERDICT.RED,
      servedFile: 'layer-bench.prev.json',
      lastOk: '2026-10-21',
    });
    assert.equal(e.status, VERDICT.RED);
    assert.equal(e.served_file, 'layer-bench.prev.json');
    assert.equal(e.stale_days, 3);
  });

  test('ok 时 served_file 就是本次的文件，stale_days 为 0', () => {
    const e = entry({});
    assert.equal(e.served_file, 'layer-bench.json');
    assert.equal(e.stale_days, 0);
  });

  test('buildManifest 汇总计数', () => {
    const m = buildManifest({
      layers: [
        entry({}),
        entry({ layer: 'events', verdict: VERDICT.WARN }),
        entry({ layer: 'relays', verdict: VERDICT.RED, servedFile: 'x.prev.json' }),
      ],
      generatedAt: TODAY,
    });
    assert.equal(m.schema_version, MANIFEST_SCHEMA);
    assert.equal(m.summary.total, 3);
    assert.equal(m.summary.ok, 1);
    assert.equal(m.summary.warn, 1);
    assert.equal(m.summary.stale, 1);
  });

  test('validateManifest：版本不符要拒（整站唯一会整体失败的情形之一）', () => {
    assert.equal(validateManifest({ schema_version: 'manifest/v0', layers: [] }).ok, false);
    assert.equal(validateManifest(null).ok, false);
    assert.equal(validateManifest({ schema_version: MANIFEST_SCHEMA, layers: [] }).ok, true);
  });

  test('servedFileFor 取该层实际发布的文件', () => {
    const m = buildManifest({
      layers: [
        entry({ layer: 'bench', verdict: VERDICT.RED, servedFile: 'bench.prev.json' }),
        entry({ layer: 'events' }),
      ],
      generatedAt: TODAY,
    });
    assert.equal(servedFileFor(m, 'bench'), 'bench.prev.json');
    assert.equal(servedFileFor(m, 'events'), 'layer-events.json');
    assert.equal(servedFileFor(m, 'nope'), null);
  });
});

/* ────────────────────────── 验收：评测层 red ────────────────────────── */

describe('验收：评测层 red，其它层照常（T3.7）', () => {
  /**
   * 模拟一次运行：bench 层门禁 red（缩水到 10%），其它层正常。
   * 断言：
   * 1. manifest 里 bench 是 red 且 served_file 指向上一版；
   * 2. 其它层仍是 ok，且 hash 是本次内容；
   * 3. 只有 bench 的 stale_days 非零。
   */
  test('red 层指向上一版，其它层用本次', () => {
    const layerSpec = (id, verdict, reasons = [], prevFile = null) => {
      const content = JSON.stringify([{ layer: id, version: 'this-run' }]);
      return manifestEntry({
        layer: id,
        file: `layer-${id}.json`,
        content,
        verdict,
        reasons,
        asOf: TODAY,
        lastOk: verdict === VERDICT.RED ? '2026-10-19' : TODAY,
        count: 1,
        servedFile: prevFile,
      });
    };

    const manifest = buildManifest({
      layers: [
        layerSpec('bench', VERDICT.RED, ['bench-shrink: 缩水到 10%'], 'layer-bench.prev.json'),
        layerSpec('events', VERDICT.OK),
        layerSpec('models', VERDICT.OK),
      ],
      generatedAt: TODAY,
    });

    const bench = manifest.layers.find((l) => l.layer === 'bench');
    assert.equal(bench.status, VERDICT.RED);
    assert.equal(bench.served_file, 'layer-bench.prev.json', 'red 层必须指向上一版文件');
    assert.equal(bench.stale_days, 5, '沿用 5 天');

    const events = manifest.layers.find((l) => l.layer === 'events');
    assert.equal(events.status, VERDICT.OK, '其它层照常更新');
    assert.equal(events.served_file, 'layer-events.json', '其它层用本次文件');
    assert.equal(events.stale_days, 0);

    assert.equal(manifest.summary.ok, 2, '两层 ok');
    assert.equal(manifest.summary.stale, 1, '一层 stale');
  });

  test('整站不因单层 red 而失败：manifest 仍可校验', () => {
    const manifest = buildManifest({
      layers: [
        manifestEntry({
          layer: 'bench',
          file: 'layer-bench.json',
          content: '[]',
          verdict: VERDICT.RED,
          asOf: TODAY,
          count: 0,
        }),
      ],
      generatedAt: TODAY,
    });
    assert.equal(validateManifest(manifest).ok, true, '单层 red 不该让 manifest 失效');
  });
});
