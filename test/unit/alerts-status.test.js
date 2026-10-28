/**
 * 告警决策与状态视图（T4.2 · S4.2 · S4.4）。
 *
 * ## 验收三条路径
 *
 * | 场景 | 期望 |
 * |---|---|
 * | 连续两次 bad，无 issue | `open` |
 * | 连续两次 bad，已有 issue | `append` |
 * | 最新一次 ok，已有 issue | `close` |
 *
 * ## 上一版为什么不对
 *
 * `redCount >= 2` 数的是**有史以来**任何两次失败，不是「连续」——
 * 隔三天失败一次也被当成连续。而且它没读已有 issue 状态，永远返回 `open`，
 * 每次都开新 issue。这类 bug 只有在「同一个问题连着挂几天」时才暴露，
 * 而那时已经攒了一堆没人看的 issue。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  decideAlert,
  normalizeHistory,
  consecutiveBad,
  alertBody,
  alertIssueMeta,
  ALERT_ACTION,
  BAD_STATES,
  CONSECUTIVE_THRESHOLD,
} from '../../pipeline/alerts/decision.mjs';
import { layerStatus, statusOverview, renderStatusText, WINDOW } from '../../pipeline/status.mjs';
import { recordAttempt } from '../../scripts/data-scripts.mjs';

/** 造一条尝试记录。 */
const run = (day, status, extra = {}) => ({
  at: `2026-10-${String(day).padStart(2, '0')}T01:00:00Z`,
  status,
  count: extra.count ?? 100,
  ms: extra.ms ?? 50,
  ...extra,
});

/* ────────────────────────── 三种路径 ────────────────────────── */

describe('告警决策：三条路径（T4.2 验收）', () => {
  test('连续两次失败、无 issue → open', () => {
    const d = decideAlert({
      history: [run(24, 'failed'), run(23, 'failed'), run(22, 'ok')],
      openIssue: null,
      layer: 'bench',
    });
    assert.equal(d.action, ALERT_ACTION.OPEN);
    assert.equal(d.consecutive, 2);
  });

  test('连续两次失败、已有 issue → append（不重复开）', () => {
    const d = decideAlert({
      history: [run(24, 'failed'), run(23, 'failed')],
      openIssue: 42,
      layer: 'bench',
    });
    assert.equal(d.action, ALERT_ACTION.APPEND);
    assert.match(d.reason, /#42/);
  });

  test('恢复 ok、已有 issue → close', () => {
    const d = decideAlert({
      history: [run(24, 'ok'), run(23, 'failed'), run(22, 'failed')],
      openIssue: 42,
      layer: 'bench',
    });
    assert.equal(d.action, ALERT_ACTION.CLOSE);
  });

  test('恢复 ok、没有 issue → 什么都不做', () => {
    const d = decideAlert({ history: [run(24, 'ok')], openIssue: null });
    assert.equal(d.action, ALERT_ACTION.NONE);
  });

  test('只挂一次 → 不动（噪声控制）', () => {
    const d = decideAlert({
      history: [run(24, 'failed'), run(23, 'ok'), run(22, 'ok')],
      openIssue: null,
    });
    assert.equal(d.action, ALERT_ACTION.NONE);
    assert.match(d.reason, /未达阈值/);
  });

  test('没有历史 → none', () => {
    assert.equal(decideAlert({ history: [] }).action, ALERT_ACTION.NONE);
  });
});

/* ────────────────────────── 「连续」的语义 ────────────────────────── */

describe('「连续」必须是真的连续', () => {
  test('失败 → ok → 失败 不算连续 → none', () => {
    const d = decideAlert({
      history: [run(24, 'failed'), run(23, 'ok'), run(22, 'failed')],
      openIssue: null,
    });
    assert.equal(d.action, ALERT_ACTION.NONE, '中间有 ok 就断了');
    assert.equal(d.consecutive, 1);
  });

  test('连续三次失败 → consecutive 是 3', () => {
    const d = decideAlert({
      history: [run(24, 'failed'), run(23, 'red'), run(22, 'stale'), run(21, 'ok')],
      openIssue: null,
    });
    assert.equal(d.consecutive, 3);
    assert.equal(d.action, ALERT_ACTION.OPEN);
  });

  test('red / failed / stale / partial 都算坏', () => {
    for (const s of ['red', 'failed', 'stale', 'partial']) {
      assert.ok(BAD_STATES.has(s), `${s} 应当算坏状态`);
    }
    assert.equal(BAD_STATES.has('ok'), false);
  });

  test('阈值就是 2', () => {
    assert.equal(CONSECUTIVE_THRESHOLD, 2);
  });
});

/* ────────────────────────── 顺序无关 ────────────────────────── */

describe('顺序：调用方给反了也要判对', () => {
  test('normalizeHistory 统一成最新在前', () => {
    const rows = normalizeHistory([run(22, 'ok'), run(24, 'ok'), run(23, 'failed')]);
    assert.equal(rows[0].at, '2026-10-24T01:00:00Z');
  });

  test('反序输入仍得到正确结论', () => {
    const newestFirst = [run(24, 'failed'), run(23, 'failed')];
    const oldestFirst = [...newestFirst].reverse();
    assert.equal(
      decideAlert({ history: oldestFirst, openIssue: null }).action,
      decideAlert({ history: newestFirst, openIssue: null }).action,
    );
  });

  test('consecutiveBad 只数开头', () => {
    assert.equal(consecutiveBad([{ status: 'ok' }, { status: 'failed' }]), 0);
    assert.equal(consecutiveBad([{ status: 'failed' }, { status: 'failed' }, { status: 'ok' }]), 2);
  });
});

/* ────────────────────────── issue 内容 ────────────────────────── */

describe('issue 元数据与正文', () => {
  test('标签带 layer:<id>，标题点名层', () => {
    const m = alertIssueMeta('events');
    assert.ok(m.labels.includes('layer:events'), '标签要能让 GH 按层筛');
    assert.match(m.title, /events/);
  });

  test('正文含状态、时间、条数、耗时', () => {
    const d = decideAlert({
      history: [run(24, 'failed', { error: 'HTTP 500' }), run(23, 'failed')],
      openIssue: null,
      layer: 'bench',
    });
    const body = alertBody(d);
    assert.match(body, /bench/);
    assert.match(body, /failed/);
    assert.match(body, /HTTP 500/);
    assert.match(body, /其它层不受影响/, '要说清分层隔离：读的人最关心这个');
  });
});

/* ────────────────────────── 状态视图 ────────────────────────── */

describe('状态视图（S4.4）', () => {
  let dir;
  const setup = () => {
    dir = mkdtempSync(join(tmpdir(), 'indexai-status-'));
    return dir;
  };

  test('读最近 WINDOW 次，按时间正序', () => {
    const root = setup();
    try {
      for (let i = 1; i <= 35; i += 1) {
        recordAttempt('models', { status: 'ok', count: i, ms: 10 }, { root, at: run(i, 'ok').at });
      }
      const s = layerStatus('models', { root });
      assert.equal(s.runs, WINDOW, `只留最近 ${WINDOW} 次`);
      assert.equal(s.trend.at(-1), 35, '最新一次在最后');
      assert.equal(s.trend[0], 6, '35 - 30 + 1 = 6');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('成功率与连续异常', () => {
    const root = setup();
    try {
      recordAttempt('bench', { status: 'ok', count: 5 }, { root, at: run(20, 'ok').at });
      recordAttempt('bench', { status: 'ok', count: 6 }, { root, at: run(21, 'ok').at });
      recordAttempt('bench', { status: 'failed', count: 0 }, { root, at: run(22, 'failed').at });
      recordAttempt('bench', { status: 'failed', count: 0 }, { root, at: run(23, 'failed').at });

      const s = layerStatus('bench', { root });
      assert.equal(s.okRate, 0.5);
      assert.equal(s.consecutiveBad, 2);
      assert.equal(s.healthy, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('平均耗时只算非零的（没跑的不拉低平均）', () => {
    const root = setup();
    try {
      recordAttempt('x', { status: 'ok', ms: 100 }, { root, at: run(20, 'ok').at });
      recordAttempt('x', { status: 'ok', ms: 200 }, { root, at: run(21, 'ok').at });
      recordAttempt('x', { status: 'failed', ms: 0 }, { root, at: run(22, 'failed').at });
      assert.equal(layerStatus('x', { root }).msAvg, 150);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('总览把异常的排前面', () => {
    const root = setup();
    try {
      recordAttempt('healthy', { status: 'ok' }, { root, at: run(24, 'ok').at });
      recordAttempt('sick', { status: 'failed' }, { root, at: run(24, 'failed').at });
      recordAttempt('sick', { status: 'failed' }, { root, at: run(23, 'failed').at });

      const o = statusOverview(['healthy', 'sick'], { root });
      assert.equal(o[0].layer, 'sick', '有问题的排前面');
      assert.equal(o[1].healthy, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('没有日志的层按健康处理（首次运行）', () => {
    const root = mkdtempSync(join(tmpdir(), 'indexai-empty-'));
    try {
      const s = layerStatus('never', { root });
      assert.equal(s.runs, 0);
      assert.equal(s.okRate, 1);
      assert.equal(s.healthy, true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('文本渲染含表格与状态标记', () => {
    const text = renderStatusText([
      {
        layer: 'a',
        runs: 3,
        consecutiveBad: 0,
        okRate: 1,
        msAvg: 50,
        last: { count: 10 },
        healthy: true,
      },
      {
        layer: 'b',
        runs: 2,
        consecutiveBad: 2,
        okRate: 0,
        msAvg: null,
        last: { count: 0 },
        healthy: false,
      },
    ]);
    assert.match(text, /✅ a/);
    assert.match(text, /⚠️ b/);
    assert.match(text, /\| 层 \|/);
  });
});
