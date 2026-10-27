/**
 * 未匹配报告与质量线（T4.6 · S6.4 / S6.5）。
 *
 * ## 两条验收
 *
 * 1. 每个源的未匹配名称与次数写进 `status/unmatched.json`，状态视图能列出来；
 * 2. 质量线：OpenRouter 用量前 100 与全部旗舰 ≥ 95%，每个评测榜前 30 名 ≥ 90%。
 *
 * ## 第三方概念：占位行
 *
 * 评测榜里有 `Multiple` / `Undisclosed` / `Human Baseline` 这类条目，它们**不是模型**。
 * 把它们算进分母，质量线永远差几个百分点，而且补多少别名都补不上；
 * 算成已匹配又会让报告显示「全对上」——两种都是自欺。
 *
 * 所以匹配器有第三个状态：`excluded`（不参与统计）。
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  collectUnmatched,
  buildUnmatchedReport,
  matchRate,
  checkQualityLine,
  checkAllQualityLines,
  QUALITY_LINE,
} from '../../lib/unmatch-report.js';
import { matchModel, resetModelCache } from '../../lib/match.js';
import { FLAGSHIP } from '../../lib/relay-pricing.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const readJson = (rel) => {
  try {
    return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
  } catch {
    return null;
  }
};

describe('质量线常量（S6.5）', () => {
  test('数字与规格一致', () => {
    assert.equal(QUALITY_LINE.openrouterTop, 100);
    assert.equal(QUALITY_LINE.benchTop, 30);
    assert.equal(QUALITY_LINE.minRateUsage, 0.95);
    assert.equal(QUALITY_LINE.minRateBench, 0.9);
  });
});

describe('占位行不参与统计', () => {
  test('Multiple 被标 excluded，不算匹配也不算未匹配', () => {
    const r = matchModel('Multiple');
    assert.equal(r.matched, false);
    assert.equal(r.via, 'excluded');
  });

  test('matchRate 的分母扣掉占位行', () => {
    const r = matchRate(['Multiple', 'Undisclosed', 'anthropic/claude-opus-5-5']);
    assert.equal(r.total, 1, '分母只留真实模型');
    assert.equal(r.matched, 1);
    assert.equal(r.rate, 1);
    assert.equal(r.excluded.length, 2);
  });

  test('全是占位行时匹配率算 1（没有可匹配的东西）', () => {
    const r = matchRate(['Multiple', 'Undisclosed']);
    assert.equal(r.total, 0);
    assert.equal(r.rate, 1);
  });
});

describe('未匹配报告（S6.4）', () => {
  test('按源收集，附出现次数', () => {
    const r = collectUnmatched('bench', ['ghost-model', 'ghost-model', 'another-ghost']);
    assert.equal(r.source, 'bench');
    // 次数降序：ghost-model(2) 在 another-ghost(1) 前面
    assert.deepEqual(r.unmatched, [
      { name: 'ghost-model', count: 2 },
      { name: 'another-ghost', count: 1 },
    ]);
  });

  test('次数降序，同次数按名字排（确定性）', () => {
    const r = collectUnmatched('s', ['b', 'a', 'a', 'c']);
    assert.deepEqual(
      r.unmatched.map((u) => u.name),
      ['a', 'b', 'c'],
    );
  });

  test('buildUnmatchedReport 汇总多源', () => {
    const report = buildUnmatchedReport(
      [
        { source: 'openrouter', names: ['ghost-a'] },
        { source: 'bench', names: ['ghost-b', 'ghost-b'] },
      ],
      { at: '2026-10-24T01:00:00Z' },
    );
    assert.equal(report.sources.length, 2);
    assert.equal(report.at, '2026-10-24T01:00:00Z');
    assert.ok(typeof report.rate === 'number');
  });

  test('每源最多列 50 条（报告体积可控）', () => {
    const many = Array.from({ length: 120 }, (_, i) => `ghost-${i}`);
    const r = collectUnmatched('s', many);
    const report = buildUnmatchedReport([{ source: 's', names: many }]);
    assert.equal(report.sources[0].unmatched.length, 50);
    assert.equal(report.sources[0].unmatched_total, r.unmatched.length);
  });
});

describe('checkQualityLine', () => {
  test('达到线 → pass', () => {
    const r = checkQualityLine('x', ['anthropic/claude-opus-5-5'], 0.9);
    assert.equal(r.pass, true);
    assert.equal(r.rate, 1);
  });

  test('低于线 → fail 并给出缺失样本', () => {
    const r = checkQualityLine('x', ['ghost'], 0.9);
    assert.equal(r.pass, false);
    assert.deepEqual(r.missing, ['ghost']);
  });

  test('空集合算通过（没有可匹配的东西）', () => {
    assert.equal(checkQualityLine('x', [], 0.95).pass, true);
  });
});

/* ────────────────────────── 验收：真数据 ────────────────────────── */

describe('验收：质量线在 fixture 快照上达标（S6.5）', () => {
  let input;

  before(() => {
    resetModelCache();
    const data = readJson('fixtures/golden/data.json') || {};
    const bench = readJson('fixtures/golden/bench.json') || {};

    const orNames = (data.models || [])
      .filter((m) => m.channelKind === 'aggregator')
      .map((m) => m.id);

    const benchBoards = {};
    for (const [id, board] of Object.entries(bench.boards || {})) {
      benchBoards[id] = (board.rows || []).map((r) => r.model);
    }

    input = {
      openrouterTop: orNames,
      flagship: FLAGSHIP.map((f) => f.label),
      benchBoards,
    };
  });

  test('OpenRouter 用量前 100 匹配率 ≥ 95%', () => {
    const r = checkQualityLine('or', input.openrouterTop.slice(0, 100), QUALITY_LINE.minRateUsage);
    assert.ok(
      r.rate >= 0.95,
      `实际 ${(r.rate * 100).toFixed(1)}%，缺 ${r.missing.slice(0, 5).join(', ')}`,
    );
  });

  test('全部旗舰匹配率 ≥ 95%', () => {
    const r = checkQualityLine('flagship', input.flagship, QUALITY_LINE.minRateUsage);
    assert.ok(r.rate >= 0.95, `实际 ${(r.rate * 100).toFixed(1)}%`);
  });

  test('每个评测榜前 30 名 ≥ 90%', () => {
    const failures = [];
    for (const [boardId, names] of Object.entries(input.benchBoards)) {
      const r = checkQualityLine(boardId, names.slice(0, 30), QUALITY_LINE.minRateBench);
      if (!r.pass) {
        failures.push(
          `${boardId}: ${(r.rate * 100).toFixed(1)}%（缺 ${r.missing.slice(0, 3).join(', ')}）`,
        );
      }
    }
    assert.deepEqual(failures, [], `未达标的榜：\n${failures.join('\n')}`);
  });

  test('checkAllQualityLines 总体通过', () => {
    const r = checkAllQualityLines(input);
    assert.equal(
      r.pass,
      true,
      `不达标：${r.lines
        .filter((l) => !l.pass)
        .map((l) => l.label)
        .join(', ')}`,
    );
  });
});

/* ────────────────────────── 实体表规模 ────────────────────────── */

describe('实体表覆盖了评测与用量两个方向', () => {
  test('表里有 OpenRouter 目录之外的老模型（评测榜需要）', () => {
    const reg = readJson('registry/models.json');
    const benchOnly = reg.models.filter((m) => m.aliases?.bench && !m.aliases?.openrouter);
    assert.ok(benchOnly.length > 20, `只用评测名登记的实体太少：${benchOnly.length}`);
  });

  test('表规模合理（不是几十条的手写清单）', () => {
    const reg = readJson('registry/models.json');
    assert.ok(reg.models.length >= 400, `实体太少：${reg.models.length}`);
  });

  test('排除清单记录了占位项', () => {
    const reg = readJson('registry/models.json');
    assert.ok(Array.isArray(reg.excluded));
    assert.ok(reg.excluded.includes('Multiple'));
  });
});
