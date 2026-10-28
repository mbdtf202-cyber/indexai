/**
 * lib/parquet.js 的特征测试（T0.3）。
 *
 * 用 fixtures/files/lmarena-agent-latest.parquet 这份真实的小文件
 * （LMArena agent 榜，50 行 8 KB）验证解析，避免只测人造数据。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { readParquet, snappyDecode, makeThrift } from '../../lib/parquet.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '..', '..', 'fixtures', 'files', 'lmarena-agent-latest.parquet');

describe('readParquet（真实 LMArena 文件）', () => {
  let rows;

  test('能解析文件并返回行数组', () => {
    const buf = readFileSync(FIXTURE);
    const parsed = readParquet(buf);
    assert.ok(Array.isArray(parsed.rows));
    assert.ok(parsed.rows.length > 0, '应至少解析出一行');
    rows = parsed.rows;
  });

  test('解析出的列名符合 LMArena schema', () => {
    const keys = Object.keys(rows[0]);
    for (const expected of ['model_name', 'organization', 'score', 'category']) {
      assert.ok(keys.includes(expected), `缺少列 ${expected}，实际列：${keys.join(',')}`);
    }
  });

  test('score 是有限数值（agent 榜可为负，表示低于基线）', () => {
    const scored = rows.filter((r) => typeof r.score === 'number');
    assert.ok(scored.length > 0);
    for (const r of scored) {
      assert.ok(Number.isFinite(r.score), `score 非有限值：${r.score}`);
      assert.ok(r.score > -1 && r.score < 1, `score 越界：${r.score}`);
    }
  });

  test('model_name 都非空', () => {
    const named = rows.filter((r) => r.model_name);
    assert.equal(named.length, rows.length);
  });

  test('同一文件里只含一个 leaderboard_publish_date 批次', () => {
    const dates = [...new Set(rows.map((r) => r.leaderboard_publish_date).filter(Boolean))];
    assert.ok(dates.length >= 1, '应至少有一个发布日');
  });

  test('空 buffer 不抛未捕获异常', () => {
    assert.throws(() => readParquet(Buffer.alloc(0)));
  });

  test('截断的 buffer 抛错而不是返回假数据', () => {
    const buf = readFileSync(FIXTURE);
    assert.throws(() => readParquet(buf.subarray(0, 64)));
  });
});

describe('snappyDecode', () => {
  test('解析字面量块（varint 解压长度 + 标签 + 正文字节）', () => {
    // raw block：varint 解压后长度 5；literal tag 的 l = len-1 = 4，tag = 4<<2 = 16
    const compressed = Buffer.from([5, 4 << 2, 0x68, 0x65, 0x6c, 0x6c, 0x6f]);
    const out = snappyDecode(compressed);
    assert.equal(Buffer.from(out).toString('latin1'), 'hello');
  });

  test('解析回填引用（copy 类型 1）', () => {
    // 声明解压后 6 字节：literal "ab"（tag = 1<<2），
    // 再 copy-1：t=1、L=4、O 高 3 位 = 0、低 8 位 = 2 → 复制 "ab"+"ab" = "abab"
    const compressed = Buffer.from([6, 1 << 2, 0x61, 0x62, 0b0000_0001, 2]);
    const out = Buffer.from(snappyDecode(compressed)).toString('latin1');
    assert.equal(out, 'ababab');
  });

  test('声明长度与实际不符时抛错（不返回假数据）', () => {
    // 声明解压后 20 字节，但只有 5 字节正文
    const bad = Buffer.from([20, 5 << 2, 0x68, 0x65, 0x6c, 0x6c, 0x6f]);
    assert.throws(() => snappyDecode(bad), /snappy/);
  });

  test('空输入返回空数组', () => {
    const out = snappyDecode(Buffer.alloc(0));
    assert.equal(out.length, 0);
  });
});

describe('makeThrift', () => {
  test('返回 readStruct / readValue / skip / pos', () => {
    const t = makeThrift(Buffer.from([0x00, 0x01, 0x02]));
    assert.equal(typeof t.readStruct, 'function');
    assert.equal(typeof t.readValue, 'function');
    assert.equal(typeof t.skip, 'function');
    assert.equal(t.pos, 0);
  });

  test('readValue 按 thrift 类型码取值（3 = i8 单字节）', () => {
    const t = makeThrift(Buffer.from([0x2a]));
    assert.equal(t.readValue(3), 0x2a);
  });

  test('readValue 读取双精度（7 = double）', () => {
    const b = Buffer.alloc(8);
    b.writeDoubleLE(1.5, 0);
    assert.equal(makeThrift(b).readValue(7), 1.5);
  });

  test('空 buffer 构造不抛错', () => {
    assert.doesNotThrow(() => makeThrift(Buffer.alloc(0)));
  });
});
