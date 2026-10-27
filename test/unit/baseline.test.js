/**
 * 动态基线门禁（T4.7 · S4.1 · F33）。
 *
 * ## 为什么不能只看上一版
 *
 * 缩水判定原来是「本次 vs 上一版」。问题：**上一版本身可能是异常低值**。
 * 某天源站只回了 6 条，第二天正常回 460 —— 那没问题；
 * 但若某天回到 100 条、再下一天回 460，拿 100 当基线就把「正常」判成「缩水」。
 *
 * 正确做法：拿**近 7 次成功快照的中位数**当基线。单日异常值不影响中位数。
 *
 * ## 历史不足时怎么办
 *
 * 至少 3 次才有可信的中位数。不足时**不做缩水判定**，只查绝对下限。
 * 不用 `min` 凑（会被单次异常拉低）、不用 `mean` 凑（会被它拉高）。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeBaseline,
  checkShrink,
  BASELINE_WINDOW,
  BASELINE_MIN_SAMPLES,
} from '../../pipeline/baseline.mjs';
import { runLayerGate, VERDICT } from '../../pipeline/manifest.mjs';

describe('常量', () => {
  test('回看 7 次（S4.1）', () => {
    assert.equal(BASELINE_WINDOW, 7);
  });

  test('至少 3 次才算得出基线', () => {
    assert.equal(BASELINE_MIN_SAMPLES, 3);
  });
});

describe('中位数基线（验收：单日异常不污染基线）', () => {
  test('正常序列的中位数是正确的', () => {
    const r = computeBaseline([460, 462, 458, 461, 459]);
    assert.equal(r.baseline, 460);
    assert.equal(r.source, 'median');
  });

  test('单日异常低值不污染基线', () => {
    // 6 次正常 + 1 次异常低
    const r = computeBaseline([460, 461, 6, 459, 460, 462, 458]);
    assert.equal(r.baseline, 460, '中位数仍是 460，不是 6');
  });

  test('单日异常高值也不污染', () => {
    const r = computeBaseline([460, 461, 9999, 459, 460]);
    assert.equal(r.baseline, 460);
  });

  test('偶数个样本取中间两个的平均', () => {
    assert.equal(computeBaseline([10, 20, 30, 40]).baseline, 25);
  });

  test('只取最近 7 次', () => {
    const many = [1, 1, 1, 460, 461, 459, 460, 462, 458, 461];
    const r = computeBaseline(many);
    assert.equal(r.samples, BASELINE_WINDOW);
    assert.equal(r.baseline, 460, '更早的 1 不该参与');
  });

  test('负数与非数字被过滤', () => {
    const r = computeBaseline([460, -5, 'abc', 461, 459]);
    assert.equal(r.samples, 3);
  });
});

describe('历史不足时退回下限判定（验收）', () => {
  test('少于 3 次 → 给不出基线', () => {
    const r = computeBaseline([460, 461]);
    assert.equal(r.baseline, null);
    assert.equal(r.source, 'insufficient');
  });

  test('空历史 → insufficient', () => {
    assert.equal(computeBaseline([]).source, 'insufficient');
  });

  test('checkShrink 在 insufficient 时返回 unknown 而不是 ok', () => {
    const r = checkShrink(100, [400], { shrink: 0.5 });
    assert.equal(r.verdict, 'unknown', '说 ok 等于假装检查过了');
    assert.match(r.reason, /不足/);
  });

  test('门禁在历史不足时只查绝对下限', () => {
    const layer = { health: { floor: 10, shrink: 0.5, rules: [] } };

    // 历史不足 + 条数够下限 → ok（不做缩水判定）
    assert.equal(
      runLayerGate(layer, new Array(20).fill({}), { history: [400] }).verdict,
      VERDICT.OK,
    );

    // 历史不足 + 条数低于下限 → red（下限仍然管用）
    assert.equal(
      runLayerGate(layer, new Array(5).fill({}), { history: [400] }).verdict,
      VERDICT.RED,
    );
  });
});

describe('缩水判定用中位数', () => {
  test('低于基线一半 → shrink', () => {
    const r = checkShrink(100, [460, 461, 459], { shrink: 0.5 });
    assert.equal(r.verdict, 'shrink');
    assert.equal(r.baseline, 460);
    assert.ok(r.ratio < 0.5);
  });

  test('达到基线一半 → ok', () => {
    assert.equal(checkShrink(240, [460, 461, 459], { shrink: 0.5 }).verdict, 'ok');
  });

  test('基线本身有单日低值时，正常条数仍判 ok', () => {
    // 这是 F33 的核心场景：历史里混着一个 6，中位数仍是 460
    const r = checkShrink(450, [460, 6, 461, 459], { shrink: 0.5 });
    assert.equal(r.verdict, 'ok', '450 相对中位数 460 是正常值');
    assert.equal(r.baseline, 459.5);
  });

  test('门禁跑 shrink 时用 history', () => {
    const layer = { health: { shrink: 0.5, rules: [] } };
    const r = runLayerGate(layer, new Array(100).fill({}), { history: [460, 461, 459] });
    assert.equal(r.verdict, VERDICT.RED);
    assert.match(r.reasons.join(' '), /缩水/);
  });

  test('没有 history 但有 prevCount 时退回单点比较，并说明', () => {
    const layer = { health: { shrink: 0.5, rules: [] } };
    const r = runLayerGate(layer, new Array(20).fill({}), { prevCount: 100 });
    assert.equal(r.verdict, VERDICT.RED);
    assert.match(r.reasons.join(' '), /历史不足/, '原因里要说清这是单点基线');
  });
});

describe('门禁代码里不再有手填的实测值（验收）', () => {
  test('manifest.mjs 的 shrink 判定走 baseline 模块', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('pipeline/manifest.mjs', 'utf8');
    assert.match(src, /from '\.\/baseline\.mjs'/, '要引用 baseline 模块');
    assert.match(src, /checkShrink\(/, '要用中位数基线判缩水');
  });
});
