/**
 * 合并策略与原子写入（T3.6 · S3.3 · S3.4 · F38）。
 *
 * ## F38 是什么
 *
 * 拆层时把「合并」做成了「本次有就用本次」。后果：Luma 某天只拿到一半活动，
 * 活动数就直接腰斩——读者看到「今天活动少了」，而真相是「今天有个源没跑完」。
 * 部分采集不该导致数量塌缩。
 *
 * ## 两条验收
 *
 * 1. 「Luma 今天只拿到一半」→ 活动数不低于上一版仍在 TTL 内的场次数；
 * 2. 「门禁失败」→ 磁盘上的快照与归档**字节不变**。
 *
 * 第 2 条是 S3.4 的核心：宁可停在昨天，也不能把残缺数据推上线。
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  mergeCatalog,
  mergeSessions,
  mergeArchiveRows,
  validateCurated,
  MERGE_STRATEGIES,
} from '../../lib/merge-strategies.js';
import { persist, writeFileAtomic, gateVerdict, GATE } from '../../pipeline/persist.mjs';

const TODAY = '2026-10-24';

/* ────────────────────────── 场次型（F38 正解） ────────────────────────── */

describe('场次型合并：部分采集不塌缩（T3.6 验收 1）', () => {
  /** 上一版：10 个未来场次。 */
  const prev = Array.from({ length: 10 }, (_, i) => ({
    id: `ev-${i}`,
    title: `活动 ${i}`,
    start: `2026-11-0${(i % 9) + 1}`,
    end: `2026-11-1${i % 9}`,
    lastSeen: TODAY,
  }));

  test('Luma 只拿到一半：数量不塌缩', () => {
    // 本次只有 5 个（Luma 掉了一半）
    const next = prev.slice(0, 5).map((e) => ({ ...e, lastSeen: TODAY }));
    const merged = mergeSessions(prev, next, { today: TODAY });

    assert.equal(merged.length, 10, '应当是 10 条（5 新 + 5 沿用），而不是 5 条');
    assert.equal(merged.filter((e) => e.stale).length, 5, '沿用的 5 条要标 stale');
  });

  test('本次完全为空：全部沿用', () => {
    const merged = mergeSessions(prev, [], { today: TODAY });
    assert.equal(merged.length, 10);
  });

  test('已经结束的场次不再保留', () => {
    const withPast = [
      ...prev,
      { id: 'ev-past', title: '过期活动', start: '2026-10-01', end: '2026-10-05', lastSeen: TODAY },
    ];
    const merged = mergeSessions(withPast, [], { today: TODAY });
    assert.equal(
      merged.some((e) => e.id === 'ev-past'),
      false,
      '已结束的场次不该留在结果里',
    );
  });

  test('lastSeen 超过 3 天的场次视为下架', () => {
    const old = [{ id: 'ev-old', start: '2026-11-01', end: '2026-11-02', lastSeen: '2026-10-15' }];
    const merged = mergeSessions(old, [], { today: TODAY });
    assert.equal(merged.length, 0, '9 天没再出现，应当丢掉');
  });

  test('lastSeen 恰好 3 天内仍保留', () => {
    const recent = [{ id: 'ev-r', start: '2026-11-01', end: '2026-11-02', lastSeen: '2026-10-21' }];
    assert.equal(mergeSessions(recent, [], { today: TODAY }).length, 1);
  });

  test('本次的行打上 lastSeen', () => {
    const next = [{ id: 'ev-new', start: '2026-11-09', end: '2026-11-10' }];
    const merged = mergeSessions([], next, { today: TODAY });
    assert.equal(merged[0].lastSeen, TODAY);
  });

  test('去重：同一 id 不会出现两次', () => {
    const next = prev.slice(0, 5).map((e) => ({ ...e, title: '已更新' }));
    const merged = mergeSessions(prev, next, { today: TODAY });
    const ids = merged.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length, 'id 不能重复');
    assert.equal(merged.find((e) => e.id === 'ev-0').title, '已更新', '同 id 用本次的');
  });
});

/* ────────────────────────── 目录型 ────────────────────────── */

describe('目录型合并：逐条沿用，超 TTL 才移除', () => {
  test('本次少了一半：缺的沿用并标 stale', () => {
    const prev = Array.from({ length: 10 }, (_, i) => ({ id: `m-${i}`, seen: TODAY }));
    const next = prev.slice(0, 5).map((m) => ({ id: m.id, seen: TODAY }));
    const merged = mergeCatalog(prev, next, { today: TODAY, ttlDays: 3 });

    assert.equal(merged.length, 10);
    assert.equal(merged.filter((m) => m.stale).length, 5);
  });

  test('超过 TTL 的条目被移除', () => {
    const prev = [
      { id: 'm-old', seen: '2026-10-01' }, // 23 天前
      { id: 'm-ok', seen: '2026-10-23' },
    ];
    const merged = mergeCatalog(prev, [], { today: TODAY, ttlDays: 3 });
    assert.deepEqual(
      merged.map((m) => m.id),
      ['m-ok'],
    );
  });

  test('本次出现的条目不会重复', () => {
    const prev = [{ id: 'a', seen: TODAY }];
    const next = [{ id: 'a', seen: TODAY }];
    assert.equal(mergeCatalog(prev, next, { today: TODAY }).length, 1);
  });

  test('本次的行补 lastOk，不覆盖已有的 checked_at', () => {
    const next = [{ id: 'r1', checked_at: '2026-10-20' }];
    const merged = mergeCatalog([], next, { today: TODAY, lastOkField: 'lastOk' });
    assert.equal(merged[0].lastOk, '2026-10-20', '应当用 checked_at 作为 lastOk');
    assert.equal(merged[0].checked_at, '2026-10-20');
  });

  test('缺日期字段时不当作过期（宁可多留一轮）', () => {
    const prev = [{ id: 'm-nod' }];
    const merged = mergeCatalog(prev, [], { today: TODAY, ttlDays: 3 });
    assert.equal(merged.length, 1, '没有日期信息不该直接丢弃');
  });
});

/* ────────────────────────── 归档型 / 人工型 ────────────────────────── */

describe('归档型：只增不删', () => {
  test('旧条目永不因超时消失', () => {
    const prev = [{ u: 'https://a/1', d: '2020-01-01' }];
    const merged = mergeArchiveRows(prev, []);
    assert.equal(merged.length, 1, '归档型不该按 TTL 删');
  });

  test('同 key 用新值覆盖', () => {
    const prev = [{ u: 'https://a/1', t: '旧标题' }];
    const next = [{ u: 'https://a/1', t: '新标题' }];
    assert.equal(mergeArchiveRows(prev, next)[0].t, '新标题');
  });
});

describe('人工型：校验到期日', () => {
  test('已过期的条目被丢掉', () => {
    const rows = [
      { id: 'a', expires: '2026-10-01' },
      { id: 'b', expires: '2026-12-01' },
    ];
    assert.deepEqual(
      validateCurated(rows, { today: TODAY }).map((r) => r.id),
      ['b'],
    );
  });

  test('很久没核实过的标 stale 但不丢', () => {
    const rows = [{ id: 'a', verified: '2025-01-01' }];
    const out = validateCurated(rows, { today: TODAY, maxAgeDays: 180 });
    assert.equal(out.length, 1);
    assert.equal(out[0].stale, true);
  });

  test('没有日期字段的原样保留', () => {
    assert.equal(validateCurated([{ id: 'a' }], { today: TODAY }).length, 1);
  });
});

describe('策略登记表', () => {
  test('四个策略名都在表里', () => {
    for (const k of ['catalog', 'sessions', 'archive', 'curated']) {
      assert.equal(typeof MERGE_STRATEGIES[k], 'function', `${k} 缺实现`);
    }
  });
});

/* ────────────────────────── 原子写入 ────────────────────────── */

describe('原子写入（S3.4）', () => {
  let dir;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'indexai-atomic-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('写入后内容正确', async () => {
    const target = join(dir, 'a.json');
    await writeFileAtomic(target, '{"x":1}');
    assert.equal(readFileSync(target, 'utf8'), '{"x":1}');
  });

  test('覆盖已有文件后内容是新值，且不留临时文件', async () => {
    const target = join(dir, 'b.json');
    writeFileSync(target, '{"old":true}');
    await writeFileAtomic(target, '{"new":true}');
    assert.equal(readFileSync(target, 'utf8'), '{"new":true}');
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp-'));
    assert.deepEqual(leftovers, [], '不该留下临时文件');
  });

  test('写到不存在的目录会抛错并清理', async () => {
    const target = join(dir, 'nodir', 'c.json');
    await assert.rejects(() => writeFileAtomic(target, 'x'));
    assert.equal(existsSync(target), false);
  });
});

/* ────────────────────────── 门禁 ────────────────────────── */

describe('门禁：失败时不动磁盘（T3.6 验收 2）', () => {
  let dir;

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'indexai-gate-'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const reportWith = (layers) => ({
    schema: 'run-report/v1',
    started_at: '2026-10-24T01:00:00.000Z',
    finished_at: '2026-10-24T01:00:01.000Z',
    duration_ms: 1000,
    deadline_ms: 900000,
    over_deadline: false,
    profile: 'test',
    layers,
    totals: { ok: 0, stale: 0, partial: 0, failed: 0 },
    net: { requests: 1, bytes: 10, hosts: 1 },
  });

  test('全部 ok → 正常写盘', async () => {
    const data = { __runReport: reportWith([{ id: 'fx', status: 'ok', n: 1, ms: 1 }]), models: [] };
    const r = await persist(dir, data);
    assert.equal(r.wrote, true);
    assert.equal(r.gate, GATE.OK);
    assert.ok(existsSync(join(dir, 'data.json')));
  });

  test('有层 failed 且无降级许可 → 拒绝写盘', async () => {
    const before = readFileSync(join(dir, 'data.json'), 'utf8');

    const data = {
      __runReport: reportWith([{ id: 'models', status: 'failed', n: 0, ms: 1, error: '挂了' }]),
      models: [{ id: 'should-not-land' }],
    };
    const r = await persist(dir, data);

    assert.equal(r.wrote, false, '门禁未过不该写');
    assert.equal(r.gate, GATE.BLOCKED);
    const afterBytes = readFileSync(join(dir, 'data.json'), 'utf8');
    assert.equal(afterBytes, before, '磁盘上的快照必须字节不变');
    assert.equal(afterBytes.includes('should-not-land'), false, '残缺数据不能落地');
  });

  test('allowDegraded 时有失败也写，但标 degraded', async () => {
    const data = {
      __runReport: reportWith([{ id: 'models', status: 'failed', n: 0, ms: 1, error: '挂了' }]),
      models: [],
    };
    const r = await persist(dir, data, { allowDegraded: true });
    assert.equal(r.wrote, true);
    assert.equal(r.gate, GATE.DEGRADED);

    // 报告里要能看出降级放行过
    const report = JSON.parse(readFileSync(join(dir, 'run-report.json'), 'utf8'));
    assert.equal(report.gate, GATE.DEGRADED);
    assert.match(report.gate_reason, /允许降级/);
  });

  test('报告永远写，blocked 时也写（否则 CI 什么都看不到）', async () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'indexai-gate2-'));
    try {
      const data = {
        __runReport: reportWith([{ id: 'x', status: 'failed', n: 0, ms: 1, error: 'e' }]),
      };
      await persist(dir2, data);
      assert.ok(existsSync(join(dir2, 'run-report.json')));
      assert.equal(existsSync(join(dir2, 'data.json')), false, 'blocked 时不写 data.json');
    } finally {
      rmSync(dir2, { recursive: true, force: true });
    }
  });

  test('gateVerdict 判定', () => {
    assert.equal(gateVerdict(reportWith([{ id: 'a', status: 'ok' }])).verdict, GATE.OK);
    assert.equal(gateVerdict(reportWith([{ id: 'a', status: 'failed' }])).verdict, GATE.BLOCKED);
    assert.equal(
      gateVerdict(reportWith([{ id: 'a', status: 'partial' }])).verdict,
      GATE.DEGRADED,
      'partial 不阻断发布',
    );
  });
});
