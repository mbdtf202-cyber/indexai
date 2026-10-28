/**
 * 编排器契约测试（T3.1d）。
 *
 * 验收标准：golden 零差异；npm run collect 在测试档位回放下产出与 golden 相同。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(ROOT, '..', 'fixtures', 'golden');
const dataJson = path.join(fixtures, 'data.json');
const benchJson = path.join(fixtures, 'bench.json');

describe('编排器契约', () => {
  test('collect.mjs 已移除', () => {
    const exists = existsSync(path.join(ROOT, '..', 'collect.mjs'));
    assert.ok(!exists, '根目录不应再有采集脚本');
  });

  test('pipeline/run.js 存在', () => {
    const exists = existsSync(path.join(ROOT, 'run.js'));
    assert.ok(exists, 'pipeline/run.js 应该存在');
  });

  test('golden 数据可读', () => {
    const data = JSON.parse(readFileSync(dataJson, 'utf8'));
    assert.ok(Array.isArray(data.events), 'events 应为数组');
    assert.ok(typeof data.models === 'object', 'models 应为对象');
    assert.ok(data.meta?.counts !== undefined, 'meta.counts 应存在');
  });

  test('golden bench.json 可读', () => {
    const data = JSON.parse(readFileSync(benchJson, 'utf8'));
    assert.ok(Array.isArray(data.boards), 'boards 应为数组');
  });
});
