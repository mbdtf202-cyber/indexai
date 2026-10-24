/**
 * bench.mjs 的特征测试（T0.3）。
 *
 * 重点是同一模型的多推理档位合并：不合并会让同一模型重复上榜、名次虚高。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { splitConfig, mergeByModel, parseAiderYaml, sliceBalanced } from '../../bench.mjs';

describe('splitConfig', () => {
  test('去掉括号里的推理档位', () => {
    assert.deepEqual(splitConfig('Claude Opus 5.5 (Max)'), {
      base: 'Claude Opus 5.5',
      config: 'max',
    });
  });

  test('中文括号同样识别', () => {
    assert.deepEqual(splitConfig('GPT-6 Sol（high）'), { base: 'GPT-6 Sol', config: 'high' });
  });

  test('档位名统一小写并去掉空白', () => {
    assert.equal(splitConfig('X (32k think)').config, '32kthink');
  });

  test('没有档位时 config 为 null', () => {
    assert.deepEqual(splitConfig('Plain Model'), { base: 'Plain Model', config: null });
  });

  test('空输入不抛错', () => {
    assert.deepEqual(splitConfig(''), { base: '', config: null });
    assert.deepEqual(splitConfig(null), { base: '', config: null });
  });

  test('只剥离尾部括号，不误伤中间括号', () => {
    assert.equal(splitConfig('Model (beta) Pro').config, null);
  });
});

describe('mergeByModel', () => {
  test('同一模型保留最强档（xhigh > max > high）', () => {
    const rows = [
      { model: 'M (low)', score: 10 },
      { model: 'M (xhigh)', score: 8 },
      { model: 'M (high)', score: 9 },
    ];
    const merged = mergeByModel(rows);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].config, 'xhigh');
  });

  test('同档位取更高分', () => {
    const rows = [
      { model: 'M (high)', score: 8 },
      { model: 'M (high)', score: 9 },
    ];
    assert.equal(mergeByModel(rows)[0].score, 9);
  });

  test('按分数降序并重新编号 rank', () => {
    const merged = mergeByModel([
      { model: 'A', score: 5 },
      { model: 'B', score: 9 },
      { model: 'C', score: 7 },
    ]);
    assert.deepEqual(
      merged.map((r) => r.model),
      ['B', 'C', 'A'],
    );
    assert.deepEqual(
      merged.map((r) => r.rank),
      [1, 2, 3],
    );
  });

  test('大小写不同视为同一模型', () => {
    const merged = mergeByModel([
      { model: 'Claude', score: 1 },
      { model: 'claude', score: 2 },
    ]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].score, 2);
  });

  test('空名字被跳过', () => {
    assert.deepEqual(mergeByModel([{ model: '', score: 1 }]), []);
  });

  test('支持自定义取名字段', () => {
    const merged = mergeByModel([{ model_name: 'X (max)', score: 3 }], (r) => r.model_name);
    assert.equal(merged[0].model, 'X');
    assert.equal(merged[0].config, 'max');
  });

  test('空数组返回空数组', () => {
    assert.deepEqual(mergeByModel([]), []);
  });
});

describe('parseAiderYaml', () => {
  const yaml = [
    '- model: gpt-6-sol',
    '  pass_rate_2: 88.5',
    '  total_cost: 12.30',
    '  edit_format: diff',
    '- model: claude-opus-5.5',
    '  pass_rate_2: 90.1',
    '  edit_format: whole',
  ].join('\n');

  test('解析扁平 list<map>', () => {
    const entries = parseAiderYaml(yaml);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].model, 'gpt-6-sol');
    assert.equal(entries[0].pass_rate_2, '88.5');
  });

  test('每条记录的第一个键成为新条目起点', () => {
    const entries = parseAiderYaml(yaml);
    assert.equal(entries[1].model, 'claude-opus-5.5');
    assert.equal(entries[1].edit_format, 'whole');
  });

  test('空文本返回空数组', () => {
    assert.deepEqual(parseAiderYaml(''), []);
  });
});

describe('sliceBalanced', () => {
  test('切出配平的 JSON 对象', () => {
    assert.equal(sliceBalanced('xx{"a":1}yy', 2), '{"a":1}');
  });

  test('切出配平的 JSON 数组', () => {
    assert.equal(sliceBalanced('xx[1,2]yy', 2), '[1,2]');
  });

  test('字符串里的括号不干扰计数', () => {
    assert.equal(sliceBalanced('{"s":"}"}', 0), '{"s":"}"}');
  });

  test('转义引号不干扰计数', () => {
    assert.equal(sliceBalanced('{"s":"a\\"}"}', 0), '{"s":"a\\"}"}');
  });

  test('嵌套结构完整切出', () => {
    assert.equal(sliceBalanced('{"a":{"b":[1]}}', 0), '{"a":{"b":[1]}}');
  });

  test('不配平时返回 null', () => {
    assert.equal(sliceBalanced('{"a":1', 0), null);
  });
});
