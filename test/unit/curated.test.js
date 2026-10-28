/**
 * 人工数据结构化（T3.8 · F14 / F15 / F57 · S7）。
 *
 * ## 三条验收
 *
 * 1. **假时钟切价**：Gemini 4 Argon 在 2026-12-01 自动切到新价（`valid_until` /
 *    `valid_from` 两条记录）；
 * 2. **人民币价随汇率变化**：DeepSeek 的 1 元/百万 token 在汇率 7.10 与 7.30 下
 *    得到不同的美元价，且记录用了哪个汇率；
 * 3. **复核门禁**：`review_by` 进 7 天内为 warn，过期标「待复核」，
 *    不参与最低价计算。
 *
 * 还有一条基础但最容易被忽略的：**核实日期来自 git，不能拿今天凑数**。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  priceInUsd,
  fxFrom,
  validity,
  reviewState,
  priceShape,
  CNY,
  USD,
} from '../../lib/pricing-currency.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CURATED = join(ROOT, 'curated');

/* ────────────────────────── 汇率折算 ────────────────────────── */

describe('人民币价按当天汇率折算（T3.8 验收 2）', () => {
  const deepseek = {
    model: 'deepseek-v4.1-flash',
    cny: { currency: 'CNY', input: 1, output: 4, cache_read: 0.02 },
  };

  test('汇率 7.10：1 元 → 0.1408 美元', () => {
    const r = priceInUsd(deepseek, { rate: 7.1, date: '2026-10-24' });
    assert.equal(r.currency, CNY);
    assert.equal(r.input, 0.140845);
    assert.equal(r.output, 0.56338);
    assert.equal(r.usdRate, 7.1);
    assert.equal(r.rateDate, '2026-10-24');
    assert.equal(r.derived, true, '这个美元价是算出来的');
  });

  test('汇率变到 7.30：同一个人民币价得到不同美元价', () => {
    const a = priceInUsd(deepseek, { rate: 7.1, date: '2026-10-24' });
    const b = priceInUsd(deepseek, { rate: 7.3, date: '2026-11-01' });
    assert.notEqual(a.input, b.input, '汇率变了美元价必须跟着变');
    assert.ok(b.input < a.input, '人民币升值（汇率升）→ 美元价变低');
    assert.equal(b.usdRate, 7.3);
    assert.equal(b.rateDate, '2026-11-01');
  });

  test('没有汇率就不给美元价（不拿旧常数凑）', () => {
    const r = priceInUsd(deepseek, null);
    assert.equal(r.input, null);
    assert.equal(r.output, null);
    assert.equal(r.usdRate, null);
    assert.equal(r.derived, false);
    assert.equal(r.currency, CNY, '但原币价仍然保留');
    assert.equal(r.native.input, 1);
  });

  test('美元原价不需要折算', () => {
    const r = priceInUsd({ model: 'x', usd: { currency: 'USD', input: 2, output: 10 } }, null);
    assert.equal(r.input, 2);
    assert.equal(r.output, 10);
    assert.equal(r.currency, USD);
    assert.equal(r.derived, false);
  });

  test('历史手填的美分值照用，但标 derived:false', () => {
    const r = priceInUsd({ model: 'x', in: 0.5, out: 1.5 }, null);
    assert.equal(r.input, 0.5);
    assert.equal(r.currency, USD);
    assert.equal(r.derived, false, '手填的不是算出来的');
  });

  test('fxFrom 从汇率层结果取 USDCNY', () => {
    assert.equal(
      fxFrom({ USDCNY: 7.11, date: '2026-10-24', source: 'open.er-api.com' }).rate,
      7.11,
    );
    assert.equal(fxFrom({ USDCNY: 'abc' }), null);
    assert.equal(fxFrom(null), null);
  });
});

/* ────────────────────────── 有效期 ────────────────────────── */

describe('假时钟切价（T3.8 验收 1）', () => {
  const oldPrice = { model: 'gemini-4-argon', valid_until: '2026-11-30', in: 2 };
  const newPrice = { model: 'gemini-4-argon', valid_from: '2026-12-01', in: 3 };

  test('11-30 当天：旧价有效，新价未生效', () => {
    assert.equal(validity(oldPrice, '2026-11-30').active, true);
    assert.equal(validity(newPrice, '2026-11-30').active, false);
    assert.match(validity(newPrice, '2026-11-30').reason, /尚未生效/);
  });

  test('12-01 当天：旧价过期，新价生效', () => {
    assert.equal(validity(oldPrice, '2026-12-01').active, false);
    assert.match(validity(oldPrice, '2026-12-01').reason, /已过期/);
    assert.equal(validity(newPrice, '2026-12-01').active, true);
  });

  test('临界日两侧各只有一条生效', () => {
    for (const day of ['2026-11-29', '2026-11-30', '2026-12-01', '2026-12-02']) {
      const active = [oldPrice, newPrice].filter((p) => validity(p, day).active);
      assert.equal(active.length, 1, `${day} 应当恰好一条生效，实际 ${active.length}`);
    }
  });

  test('没有有效期字段的永远生效', () => {
    assert.equal(validity({ model: 'x' }, '2030-01-01').active, true);
  });
});

/* ────────────────────────── 复核 ────────────────────────── */

describe('复核门禁（T3.8 验收 3）', () => {
  test('还有 30 天 → ok', () => {
    assert.equal(reviewState({ review_by: '2026-11-24' }, '2026-10-24').state, 'ok');
  });

  test('进入 7 天内 → due（warn）', () => {
    const r = reviewState({ review_by: '2026-10-28' }, '2026-10-24');
    assert.equal(r.state, 'due');
    assert.equal(r.daysLeft, 4);
  });

  test('恰好 7 天 → due', () => {
    assert.equal(reviewState({ review_by: '2026-10-31' }, '2026-10-24').state, 'due');
  });

  test('8 天 → ok', () => {
    assert.equal(reviewState({ review_by: '2026-11-01' }, '2026-10-24').state, 'ok');
  });

  test('已过期 → overdue（待复核）', () => {
    const r = reviewState({ review_by: '2026-10-20' }, '2026-10-24');
    assert.equal(r.state, 'overdue');
    assert.equal(r.daysLeft, -4);
  });

  test('没有 review_by 的不告警', () => {
    assert.equal(reviewState({}, '2026-10-24').state, 'ok');
  });
});

/* ────────────────────────── 分档 / 分时 ────────────────────────── */

describe('分档价与分时价（规格第 2 条）', () => {
  test('分档价写 tiers', () => {
    const r = priceShape({ tiers: [{ max_ctx: 200000, in: 2, out: 10 }] });
    assert.equal(r.tiers.length, 1);
    assert.equal(r.schedule, null);
  });

  test('分时价写 schedule（DeepSeek 工作日高峰 ×2）', () => {
    const r = priceShape({ schedule: [{ when: 'weekday_peak', multiplier: 2 }] });
    assert.equal(r.schedule.length, 1);
    assert.equal(r.tiers, null);
  });

  test('都没有时返回 null 而不是空数组', () => {
    const r = priceShape({ model: 'x' });
    assert.equal(r.tiers, null);
    assert.equal(r.schedule, null);
  });
});

/* ────────────────────────── 结构化字段 ────────────────────────── */

describe('curated 文件已结构化（T3.8 · F14）', () => {
  const FILES = [
    'official-prices.json',
    'offers.json',
    'toolkit.json',
    'relays.json',
    'signals.json',
    'milestones.json',
  ];

  test('每个文件都带 schema 版本', () => {
    for (const f of FILES) {
      const p = join(CURATED, f);
      assert.ok(existsSync(p), `${f} 不存在`);
      const d = JSON.parse(readFileSync(p, 'utf8'));
      assert.match(String(d.schema || ''), /^curated\.[a-z-]+\/v\d+$/, `${f} 缺 schema 版本`);
    }
  });

  test('记录都带 verified_at 与 review_by', () => {
    for (const f of FILES) {
      if (f === 'milestones.json') continue; // 嵌套结构，只有顶层 verified_at
      const d = JSON.parse(readFileSync(join(CURATED, f), 'utf8'));
      const rows = d.items || d.relays || d;
      if (!Array.isArray(rows)) continue;
      for (const r of rows.slice(0, 5)) {
        assert.match(String(r.verified_at || ''), /^\d{4}-\d{2}-\d{2}$/, `${f} 条目缺 verified_at`);
        assert.match(String(r.review_by || ''), /^\d{4}-\d{2}-\d{2}$/, `${f} 条目缺 review_by`);
      }
    }
  });

  test('review_by 恰好是 verified_at + 90 天', () => {
    const d = JSON.parse(readFileSync(join(CURATED, 'offers.json'), 'utf8'));
    const rows = d.items || d;
    for (const r of rows.slice(0, 5)) {
      const v = Date.parse(`${r.verified_at}T00:00:00Z`);
      const b = Date.parse(`${r.review_by}T00:00:00Z`);
      assert.equal(Math.round((b - v) / 86_400_000), 90, `${r.id} 的复核周期不是 90 天`);
    }
  });

  test('verified_at 来自 git 而非「今天」', () => {
    // 拿文件的最后提交日期做上界：核实日期不该晚于它
    let last = '';
    try {
      last = execFileSync('git', ['log', '-1', '--format=%cs', '--', 'curated/offers.json'], {
        cwd: ROOT,
        encoding: 'utf8',
      }).trim();
    } catch {
      // 没有 git 历史时跳过这条（CI 浅克隆会这样）
      return;
    }
    if (!last) return;

    const d = JSON.parse(readFileSync(join(CURATED, 'offers.json'), 'utf8'));
    const rows = d.items || d;
    const future = rows.filter((r) => r.verified_at > last);
    assert.deepEqual(future, [], `核实日期不该晚于文件最后修改日 ${last}`);
  });

  test('signals 的证据就是那条推文', () => {
    const d = JSON.parse(readFileSync(join(CURATED, 'signals.json'), 'utf8'));
    const rows = d.items || d;
    const withEvidence = rows.filter((r) => Array.isArray(r.evidence) && r.evidence.length);
    assert.ok(withEvidence.length > 0, '信号应当带证据');
    assert.equal(withEvidence[0].evidence[0].url, withEvidence[0].url);
  });
});
