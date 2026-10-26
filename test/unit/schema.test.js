/**
 * schema 与坏行隔离（T3.5 · S3.2 · F03）。
 *
 * ## 这一条要防的是什么
 *
 * F03 的现场：OpenRouter 出现一行 `input=0 && output>0`，语义校验在**整次采集**
 * 层面判定失败，全站当天不更新。一行脏数据冻结十几个源——这是最贵的一种脆弱。
 *
 * 正解：**把语义红线降到行级**。坏行进 `quarantined`，其余行照常发布；
 * 只有隔离比例超过阈值（默认 2%）才判红，因为那时说明源站结构变了。
 *
 * 验收三条：
 * 1. `input=0 && output>0` 的行被隔离，层为 ok 或 warn，运行不失败；
 * 2. 隔离明细出现在运行报告里；
 * 3. 超过阈值时才判红（用比例验证，不靠运气）。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateRow,
  partitionRows,
  quarantineRatio,
  HTTP_URL,
  ISO_DATE,
} from '../../lib/schema.js';
import { quarantineLayer, summarizeQuarantine } from '../../pipeline/validate.mjs';
import { SCHEMAS } from '../../pipeline/schemas/index.mjs';
import { MODEL_ROW, MODEL_ROW_RULES } from '../../pipeline/schemas/models.js';

describe('lib/schema.js：零依赖校验原语', () => {
  test('类型检查', () => {
    const spec = { a: { type: 'string' }, b: { type: 'number' }, c: { type: 'boolean' } };
    assert.equal(validateRow(spec, { a: 'x', b: 1, c: true }).ok, true);
    const r = validateRow(spec, { a: 1, b: 'x', c: 'y' });
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 3);
  });

  test('必填：缺失 / null / 空串都算缺失', () => {
    const spec = { a: { type: 'string', required: true } };
    for (const v of [{}, { a: null }, { a: '' }]) {
      assert.equal(validateRow(spec, v).ok, false, `${JSON.stringify(v)} 应判缺失`);
    }
  });

  test('非必填缺失不报错', () => {
    assert.equal(validateRow({ a: { type: 'string' } }, {}).ok, true);
  });

  test('enum 是独立类型，值必须在列表里', () => {
    const spec = { s: { type: 'enum', values: ['a', 'b'] } };
    assert.equal(validateRow(spec, { s: 'a' }).ok, true);
    const bad = validateRow(spec, { s: 'c' });
    assert.equal(bad.ok, false);
    assert.match(bad.errors[0], /不在枚举内/);
  });

  test('enum 缺 values 时报错而不是静默通过', () => {
    const r = validateRow({ s: { type: 'enum' } }, { s: 'x' });
    assert.equal(r.ok, false);
    assert.match(r.errors[0], /必须给 values/);
  });

  test('数值范围', () => {
    const spec = { n: { type: 'number', min: 0, max: 10 } };
    assert.equal(validateRow(spec, { n: 5 }).ok, true);
    assert.equal(validateRow(spec, { n: -1 }).ok, false);
    assert.equal(validateRow(spec, { n: 11 }).ok, false);
  });

  test('整数约束', () => {
    assert.equal(validateRow({ n: { type: 'number', integer: true } }, { n: 1.5 }).ok, false);
  });

  test('NaN / Infinity 不算有限数值', () => {
    assert.equal(validateRow({ n: { type: 'number' } }, { n: Number.NaN }).ok, false);
    assert.equal(validateRow({ n: { type: 'number' } }, { n: Number.POSITIVE_INFINITY }).ok, false);
  });

  test('URL 与 ISO 日期正则', () => {
    assert.equal(
      validateRow({ u: { type: 'string', pattern: HTTP_URL } }, { u: 'https://a.b/c' }).ok,
      true,
    );
    assert.equal(
      validateRow({ u: { type: 'string', pattern: HTTP_URL } }, { u: 'javascript:alert(1)' }).ok,
      false,
    );
    assert.equal(
      validateRow({ d: { type: 'string', pattern: ISO_DATE } }, { d: '2026-10-24' }).ok,
      true,
    );
    assert.equal(
      validateRow({ d: { type: 'string', pattern: ISO_DATE } }, { d: '2026-10-24T00:00' }).ok,
      false,
    );
  });

  test('数组不是对象', () => {
    assert.equal(validateRow({}, []).ok, false);
    assert.equal(validateRow({}, null).ok, false);
  });

  test('partitionRows 把好坏分开', () => {
    const spec = { id: { type: 'string', required: true } };
    const { good, bad } = partitionRows(spec, [{ id: 'a' }, {}, { id: 'c' }]);
    assert.equal(good.length, 2);
    assert.equal(bad.length, 1);
  });
});

describe('隔离比例', () => {
  test('低于阈值不红', () => {
    const r = quarantineRatio(100, 1);
    assert.equal(r.over, false);
    assert.equal(r.ratio, 0.01);
  });

  test('超过阈值才红', () => {
    assert.equal(quarantineRatio(100, 3).over, true);
  });

  test('恰好等于阈值不红（用 > 不用 >=）', () => {
    assert.equal(quarantineRatio(100, 2).over, false);
  });

  test('空集合不算红', () => {
    assert.equal(quarantineRatio(0, 0).over, false);
  });
});

describe('验收：input=0 且 output>0 的行被隔离，层不失败', () => {
  test('该行被隔离并写明原因', () => {
    const row = {
      id: 'x/broken',
      name: 'Broken',
      vendor: 'X',
      vendorId: 'x',
      channel: 'OpenRouter',
      channelKind: 'aggregator',
      input: 0,
      output: 10,
    };
    const r = quarantineLayer([row], SCHEMAS.models);
    assert.equal(r.quarantined.length, 1, '这一行必须被隔离');
    assert.equal(r.kept, 0);
    assert.match(r.quarantined[0].reasons.join(' '), /input=0 但 output=10/);
  });

  test('层仍为 ok：少量坏行不影响整体', () => {
    // 50 行里坏 1 行 = 2%，未超过阈值
    const good = Array.from({ length: 49 }, (_, i) => ({
      id: `x/m${i}`,
      name: `M${i}`,
      vendor: 'X',
      vendorId: 'x',
      channel: 'OpenRouter',
      channelKind: 'aggregator',
      input: 1,
      output: 2,
    }));
    const bad = { ...good[0], id: 'x/broken', input: 0, output: 10 };
    const r = quarantineLayer([...good, bad], SCHEMAS.models);
    assert.equal(r.kept, 49);
    assert.equal(r.quarantined.length, 1);
    assert.equal(r.overThreshold, false, '2% 不该判红');
  });

  test('超过阈值时判红（阈值 10% 时 12% 超）', () => {
    const spec = { ...SCHEMAS.models, threshold: 0.1 };
    const rows = Array.from({ length: 50 }, (_, i) => ({
      id: `x/m${i}`,
      name: `M${i}`,
      vendor: 'X',
      vendorId: 'x',
      channel: 'OpenRouter',
      channelKind: 'aggregator',
      // 前 6 行坏 = 12%
      input: i < 6 ? 0 : 1,
      output: 10,
    }));
    const r = quarantineLayer(rows, spec);
    assert.equal(r.quarantined.length, 6);
    assert.equal(r.overThreshold, true, '12% 超过 10% 阈值应判红');
  });
});

describe('models 层的三条语义红线', () => {
  const base = {
    id: 'x/m',
    name: 'M',
    vendor: 'X',
    vendorId: 'x',
    channel: 'OpenRouter',
    channelKind: 'aggregator',
  };

  test('input=0 但 output>0', () => {
    const r = quarantineLayer([{ ...base, input: 0, output: 5 }], SCHEMAS.models);
    assert.equal(r.quarantined.length, 1);
  });

  test('价格为负（OpenRouter 的 -1000000 占位符）', () => {
    const r = quarantineLayer([{ ...base, input: -1e6, output: -1e6 }], SCHEMAS.models);
    assert.equal(r.quarantined.length, 1);
    assert.match(r.quarantined[0].reasons.join(' '), /下限 0|负数/);
  });

  test('缓存读比输入还贵', () => {
    const r = quarantineLayer([{ ...base, input: 0.1, cache_read: 0.2 }], SCHEMAS.models);
    assert.equal(r.quarantined.length, 1);
    assert.match(r.quarantined[0].reasons.join(' '), /cache_read/);
  });

  test('正常行不被隔离', () => {
    const r = quarantineLayer([{ ...base, input: 1, output: 2, cache_read: 0.1 }], SCHEMAS.models);
    assert.equal(r.quarantined.length, 0);
    assert.equal(r.kept, 1);
  });

  test('免费行（input=0 且 output=0）是合法的', () => {
    const r = quarantineLayer([{ ...base, input: 0, output: 0 }], SCHEMAS.models);
    assert.equal(r.quarantined.length, 0, '全免费的行不该被隔离');
  });
});

describe('验收：隔离明细出现在运行报告', () => {
  test('摘要含计数、比例、阈值与样例', () => {
    const row = {
      id: 'x/bad',
      name: 'B',
      vendor: 'X',
      vendorId: 'x',
      channel: 'c',
      channelKind: 'aggregator',
      input: 0,
      output: 9,
    };
    const r = quarantineLayer([row], SCHEMAS.models);
    const s = summarizeQuarantine(r);

    assert.equal(s.total, 1);
    assert.equal(s.kept, 0);
    assert.equal(s.quarantined, 1);
    assert.equal(s.ratio, 1);
    assert.equal(s.threshold, 0.02);
    assert.equal(s.over_threshold, true);
    assert.ok(Array.isArray(s.samples));
    assert.equal(s.samples[0].id, 'x/bad');
    assert.match(s.samples[0].reasons.join(' '), /input=0/);
  });

  test('样例最多 5 条（报告体积可控）', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `x/b${i}`,
      name: 'B',
      vendor: 'X',
      vendorId: 'x',
      channel: 'c',
      channelKind: 'aggregator',
      input: 0,
      output: 9,
    }));
    const s = summarizeQuarantine(quarantineLayer(rows, SCHEMAS.models));
    assert.equal(s.quarantined, 20);
    assert.equal(s.samples.length, 5, '只留 5 条样例');
  });
});

describe('层契约完整性', () => {
  test('已登记的层都有 schema 与阈值', () => {
    for (const [id, spec] of Object.entries(SCHEMAS)) {
      assert.ok(spec.schema, `${id} 缺 schema`);
      assert.equal(typeof spec.threshold, 'number', `${id} 缺阈值`);
      assert.ok(Array.isArray(spec.rules), `${id} 的 rules 应为数组`);
    }
  });

  test('MODEL_ROW 引用了通名规则片段', () => {
    assert.deepEqual(MODEL_ROW.input, { type: 'number', min: 0 });
    assert.ok(MODEL_ROW_RULES.length >= 3);
  });
});
