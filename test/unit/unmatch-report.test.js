/**
 * 未匹配报告与质量线（T4.6 · S6.5）。
 *
 * 这个文件原本只有「模块文件存在」这一条断言，等于什么都没测。
 * 现在测真正的质量线：三条硬线是 S6.5 的规定，掉下去就是回归。
 *
 * 与 `unmatch.test.js` 的分工：那边测**函数行为**，这边测**规格数字**。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  QUALITY_LINE,
  checkQualityLine,
  checkAllQualityLines,
  matchRate,
  collectUnmatched,
  buildUnmatchedReport,
} from '../../lib/unmatch-report.js';
import { FLAGSHIP } from '../../lib/relay-pricing.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const readJson = (rel) => {
  try {
    return JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
  } catch {
    return null;
  }
};

describe('S6.5 质量线的数字', () => {
  test('OpenRouter 用量前 100', () => {
    assert.equal(QUALITY_LINE.openrouterTop, 100);
  });

  test('评测榜前 30 名', () => {
    assert.equal(QUALITY_LINE.benchTop, 30);
  });

  test('用量与旗舰 ≥ 95%', () => {
    assert.equal(QUALITY_LINE.minRateUsage, 0.95);
  });

  test('评测榜 ≥ 90%', () => {
    assert.equal(QUALITY_LINE.minRateBench, 0.9);
  });
});

describe('质量线判定逻辑', () => {
  test('恰好达标算通过（用 >= 不用 >）', () => {
    // 95/100 = 0.95
    const names = Array.from({ length: 100 }, (_, i) =>
      i < 95 ? 'anthropic/claude-opus-5-5' : `ghost-${i}`,
    );
    const r = checkQualityLine('x', names, 0.95);
    assert.equal(r.rate, 0.95);
    assert.equal(r.pass, true);
  });

  test('差一个点就不通过', () => {
    const names = Array.from({ length: 100 }, (_, i) =>
      i < 94 ? 'anthropic/claude-opus-5-5' : `ghost-${i}`,
    );
    assert.equal(checkQualityLine('x', names, 0.95).pass, false);
  });
});

describe('真数据：三条线都达标', () => {
  const data = readJson('fixtures/golden/data.json') || {};
  const bench = readJson('fixtures/golden/bench.json') || {};

  const orNames = (data.models || [])
    .filter((m) => m.channelKind === 'aggregator')
    .map((m) => m.id);

  const benchBoards = {};
  for (const [id, board] of Object.entries(bench.boards || {})) {
    benchBoards[id] = (board.rows || []).map((r) => r.model);
  }

  test('OpenRouter 用量前 100 ≥ 95%', () => {
    const r = checkQualityLine('or', orNames.slice(0, 100), 0.95);
    assert.ok(r.pass, `${(r.rate * 100).toFixed(1)}% < 95%`);
  });

  test('全部旗舰 ≥ 95%', () => {
    const r = checkQualityLine(
      'flagship',
      FLAGSHIP.map((f) => f.label),
      0.95,
    );
    assert.ok(r.pass, `${(r.rate * 100).toFixed(1)}% < 95%`);
  });

  test('每个评测榜前 30 名 ≥ 90%', () => {
    const failures = [];
    for (const [boardId, names] of Object.entries(benchBoards)) {
      const r = checkQualityLine(boardId, names.slice(0, 30), 0.9);
      if (!r.pass) failures.push(`${boardId}: ${(r.rate * 100).toFixed(1)}%`);
    }
    assert.deepEqual(failures, [], failures.join(', '));
  });

  test('checkAllQualityLines 总体通过', () => {
    const r = checkAllQualityLines({
      openrouterTop: orNames,
      flagship: FLAGSHIP.map((f) => f.label),
      benchBoards,
    });
    assert.equal(r.pass, true);
    assert.ok(r.lines.length >= 5, '至少覆盖用量、旗舰与几个榜');
  });
});

describe('报告能写进 status/unmatched.json', () => {
  test('结构含 at / total / matched / rate / sources', () => {
    const r = buildUnmatchedReport([{ source: 'x', names: ['ghost'] }], { at: '2026-10-24' });
    for (const k of ['at', 'total', 'matched', 'rate', 'sources']) {
      assert.ok(Object.hasOwn(r, k), `缺字段 ${k}`);
    }
  });

  test('每源条目带 unmatched_total（截断前的真实数量）', () => {
    const many = Array.from({ length: 80 }, (_, i) => `ghost-${i}`);
    const r = buildUnmatchedReport([{ source: 'x', names: many }]);
    assert.equal(r.sources[0].unmatched.length, 50);
    assert.equal(r.sources[0].unmatched_total, 80);
  });

  test('matchRate 与 collectUnmatched 口径一致', () => {
    const names = ['anthropic/claude-opus-5-5', 'ghost'];
    const rate = matchRate(names);
    const col = collectUnmatched('x', names);
    assert.equal(rate.matched, col.matched);
    assert.equal(rate.total, col.total);
  });
});
