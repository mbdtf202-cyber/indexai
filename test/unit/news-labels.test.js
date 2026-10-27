/**
 * T6.4：情报主题标注集（S8.7）。
 *
 * 352 条标题按主题标注；用 macro-F1 衡量 classifyNews 的回归。
 * 这是质量线，不是精确字符串匹配——任何规则调整都必须让整体分类能力不下降。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { classifyNews, NEWS_TOPICS } from '../../lib/news.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const LABELS = JSON.parse(
  readFileSync(join(HERE, '..', '..', 'fixtures', 'labels', 'news.json'), 'utf8'),
).items;
const CLASSES = NEWS_TOPICS.map((t) => t.id).concat('other');

function macroF1(rows) {
  const cm = Object.fromEntries(
    CLASSES.map((c) => [c, Object.fromEntries(CLASSES.map((p) => [p, 0]))]),
  );
  for (const row of rows) {
    if (!cm[row.topic]) continue;
    cm[row.topic][classifyNews(row.title)] += 1;
  }
  const out = {};
  for (const c of CLASSES) {
    const tp = cm[c][c];
    const fp = CLASSES.reduce((n, x) => n + cm[x][c], 0) - tp;
    const fn = CLASSES.reduce((n, x) => n + cm[c][x], 0) - tp;
    const p = tp + fp ? tp / (tp + fp) : 0;
    const r = tp + fn ? tp / (tp + fn) : 0;
    out[c] = p + r ? (2 * p * r) / (p + r) : 0;
  }
  return {
    perClass: out,
    macro: CLASSES.reduce((n, c) => n + out[c], 0) / CLASSES.length,
  };
}

describe('news 主题标注集', () => {
  test('至少 300 条，且八类都有样本', () => {
    assert.ok(LABELS.length >= 300, `只有 ${LABELS.length} 条`);
    const seen = new Set(LABELS.map((x) => x.topic));
    for (const c of CLASSES) assert.ok(seen.has(c), `缺少 ${c} 类样本`);
  });

  test('macro-F1 ≥ 0.80', () => {
    const { macro, perClass } = macroF1(LABELS);
    assert.ok(
      macro >= 0.8,
      `macro-F1 ${macro.toFixed(3)} < 0.80：${JSON.stringify(
        Object.fromEntries(Object.entries(perClass).map(([k, v]) => [k, +v.toFixed(2)])),
      )}`,
    );
  });
});
