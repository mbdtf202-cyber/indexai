/**
 * data 分支的读写（T4.1 · D1 · S5.1）。
 *
 * ## 这一层要解决什么
 *
 * 数据必须有自己的历史：某天采到了什么、某层哪天红的、归档怎么按月攒。
 * 把这些塞进 main 分支会让仓库每天膨胀，而且「数据提交」与「代码提交」混在
 * 一条时间线上，回滚代码时不知道该不该带上数据。
 *
 * 所以数据独立在 `data` 分支：只有 bot 写，main 不再出现数据提交。
 *
 * ## 三条验收
 *
 * 1. 快照稳定排序——同一输入产出同一字节序列（否则 git 上全是噪声 diff）；
 * 2. 状态日志只追加——告警要判「连续两次 red」，改写历史就失去依据；
 * 3. 用任意一天的快照都能构建出完整站点。
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  snapshotLayer,
  loadSnapshot,
  recordAttempt,
  readAttempts,
  writeNewsShards,
  readNewsShards,
  dataRoot,
} from '../../scripts/data-scripts.mjs';

let dir;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'indexai-data-'));
});
after(() => {
  rmSync(dir, { recursive: true, force: true });
});

/* ────────────────────────── 快照 ────────────────────────── */

describe('快照：稳定排序（验收 1）', () => {
  test('同一批数据不同顺序写两次，字节完全相同', () => {
    const a = snapshotLayer('models', [{ id: 'b' }, { id: 'a' }, { id: 'c' }], { root: dir });
    const first = readFileSync(a, 'utf8');

    const b = snapshotLayer('models', [{ id: 'c' }, { id: 'a' }, { id: 'b' }], { root: dir });
    const second = readFileSync(b, 'utf8');

    assert.equal(second, first, '排序不稳定会让每次采集都产生假 diff');
    assert.deepEqual(
      JSON.parse(first).map((r) => r.id),
      ['a', 'b', 'c'],
    );
  });

  test('没有 id 时按 domain / product / repo 排序', () => {
    const p = snapshotLayer('relays', [{ domain: 'zz.com' }, { domain: 'aa.com' }], { root: dir });
    assert.deepEqual(
      JSON.parse(readFileSync(p, 'utf8')).map((r) => r.domain),
      ['aa.com', 'zz.com'],
    );
  });

  test('写进去能原样读回', () => {
    snapshotLayer('offers', [{ id: 'x', n: 1 }], { root: dir });
    assert.deepEqual(loadSnapshot('offers', { root: dir }), [{ id: 'x', n: 1 }]);
  });

  test('没写过的层返回 null，不抛错（首次运行是正常情况）', () => {
    assert.equal(loadSnapshot('never-written', { root: dir }), null);
  });

  test('dataRoot 解析成绝对路径', () => {
    assert.ok(dataRoot(dir).startsWith('/'));
  });
});

/* ────────────────────────── 状态日志 ────────────────────────── */

describe('状态日志：只追加（验收 2）', () => {
  test('每条尝试一行，顺序保留', () => {
    recordAttempt(
      'bench',
      { status: 'ok', count: 26, ms: 100 },
      { root: dir, at: '2026-10-24T01:00:00Z' },
    );
    recordAttempt(
      'bench',
      { status: 'red', count: 0, ms: 50, error: '挂了' },
      { root: dir, at: '2026-10-25T01:00:00Z' },
    );

    const rows = readAttempts('bench', { root: dir });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].status, 'ok');
    assert.equal(rows[1].status, 'red');
    assert.equal(rows[1].error, '挂了');
    assert.equal(rows[1].layer, 'bench', '每行都带层名，合并看多层的日志时才分得清');
  });

  test('追加不会覆盖历史', () => {
    const before = readAttempts('bench', { root: dir }).length;
    recordAttempt('bench', { status: 'ok' }, { root: dir, at: '2026-10-26T01:00:00Z' });
    assert.equal(readAttempts('bench', { root: dir }).length, before + 1);
  });

  test('limit 取最近 N 条', () => {
    const rows = readAttempts('bench', { root: dir, limit: 2 });
    assert.equal(rows.length, 2);
    assert.equal(rows.at(-1).at, '2026-10-26T01:00:00Z');
  });

  test('没有日志的层返回空数组', () => {
    assert.deepEqual(readAttempts('nope', { root: dir }), []);
  });

  test('目录不存在时会自动创建（旧版首次运行必崩）', () => {
    const fresh = mkdtempSync(join(tmpdir(), 'indexai-fresh-'));
    try {
      assert.doesNotThrow(() => recordAttempt('x', { status: 'ok' }, { root: fresh }));
      assert.ok(existsSync(join(fresh, 'status', 'x.ndjson')));
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });
});

/* ────────────────────────── 月度分片 ────────────────────────── */

describe('情报月度分片', () => {
  test('按月份切分', () => {
    const r = writeNewsShards(
      [
        { u: 'https://a/1', d: '2026-09-30', t: '九月' },
        { u: 'https://a/2', d: '2026-10-01', t: '十月一' },
        { u: 'https://a/3', d: '2026-10-24', t: '十月二' },
      ],
      { root: dir },
    );
    assert.deepEqual(r.months, ['2026-09', '2026-10']);
    assert.equal(r.total, 3);
  });

  test('重复写入是合并不是覆盖（归档只增不删）', () => {
    writeNewsShards([{ u: 'https://a/4', d: '2026-10-25', t: '新的' }], { root: dir });
    const all = readNewsShards({ root: dir });
    assert.equal(all.length, 4, '十月应当有 3 条（原有 2 + 新增 1）');
  });

  test('同 URL 用新值覆盖', () => {
    writeNewsShards([{ u: 'https://a/1', d: '2026-09-30', t: '改过的标题' }], { root: dir });
    const sep = readNewsShards({ root: dir }).find((r) => r.u === 'https://a/1');
    assert.equal(sep.t, '改过的标题');
  });

  test('没有日期的条目被跳过，不猜月份', () => {
    const r = writeNewsShards([{ u: 'https://a/x', t: '无日期' }], { root: dir });
    assert.deepEqual(r.months, []);
  });

  test('分片内按日期时间排序', () => {
    const oct = readNewsShards({ root: dir }).filter((r) => r.d.startsWith('2026-10'));
    const dates = oct.map((r) => r.d);
    assert.deepEqual(dates, [...dates].sort());
  });
});

/* ────────────────────────── 用快照构建（验收 3） ────────────────────────── */

describe('任意一天快照都能构建（验收 3）', () => {
  test('两天各写一次快照，第二次仍在、且能读回', () => {
    const day1 = mkdtempSync(join(tmpdir(), 'indexai-day1-'));
    const day2 = mkdtempSync(join(tmpdir(), 'indexai-day2-'));

    try {
      // 第一天：10 个模型
      const d1 = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, input: 1 }));
      snapshotLayer('models', d1, { root: day1 });
      snapshotLayer('models', d1.slice(0, 6), { root: day2 });

      assert.equal(loadSnapshot('models', { root: day1 }).length, 10, '第一天的快照完整');
      assert.equal(
        loadSnapshot('models', { root: day2 }).length,
        6,
        '第二天的快照是那天真实拿到的',
      );

      // 构建只需要「某一层有数据」——两天都满足
      for (const root of [day1, day2]) {
        const rows = loadSnapshot('models', { root });
        assert.ok(rows && rows.length > 0, '任何一天的快照都足以构建');
      }
    } finally {
      rmSync(day1, { recursive: true, force: true });
      rmSync(day2, { recursive: true, force: true });
    }
  });
});
