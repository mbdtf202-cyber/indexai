/**
 * run-report.json 的结构契约（T3.3 · S2.4）。
 *
 * 这个文件是 CI 的 job summary 与排障入口，**结构变了就是破坏性变更**：
 * dashboard、告警脚本、人肉排查都按这些字段读。所以要有 contract 测试守着，
 * 而不是等某天有人改了字段名才发现下游全空。
 *
 * 这里只锁「结构」不锁「数值」：层数、耗时、条数每次都不一样，
 * 但 schema / 必填字段 / 状态枚举 / totals 的自洽性必须永远成立。
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

/** 层的四种状态。partial 与 failed 必须分开：前者是「没跑完」，后者是「挂了」。 */
const LAYER_STATUS = new Set(['ok', 'stale', 'partial', 'failed']);

function runCollect(outDir) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--import', './test/support/http-replay.js', './pipeline/orchestrator.mjs'],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          INDEXAI_HTTP: 'replay',
          INDEXAI_PROFILE: 'test',
          INDEXAI_OUT_DIR: outDir,
          INDEXAI_NOW: '2026-10-24T01:00:00Z',
        },
      },
    );
    let stderr = '';
    child.stderr.on('data', (c) => {
      stderr += c.toString();
    });
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

describe('run-report.json 结构（T3.3）', () => {
  let dir;
  let report;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'indexai-runreport-'));
    const { code, stderr } = await runCollect(dir);
    assert.equal(code, 0, `采集失败：${stderr}`);
    const path = join(dir, 'run-report.json');
    assert.ok(existsSync(path), '应当产出 run-report.json');
    report = JSON.parse(readFileSync(path, 'utf8'));
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('schema 版本固定为 run-report/v1', () => {
    assert.equal(report.schema, 'run-report/v1');
  });

  test('顶层字段齐备', () => {
    for (const k of [
      'started_at',
      'finished_at',
      'duration_ms',
      'deadline_ms',
      'over_deadline',
      'profile',
      'layers',
      'totals',
      'net',
    ]) {
      assert.ok(Object.hasOwn(report, k), `缺少顶层字段 ${k}`);
    }
  });

  test('时间戳是 ISO 8601', () => {
    assert.match(report.started_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    assert.match(report.finished_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test('整次运行有 15 分钟截止', () => {
    assert.equal(report.deadline_ms, 15 * 60 * 1000);
    assert.equal(typeof report.over_deadline, 'boolean');
  });

  test('每层记录都有 id / status / n / ms，status 在枚举内', () => {
    assert.ok(report.layers.length >= 10, `层记录太少：${report.layers.length}`);
    for (const r of report.layers) {
      assert.equal(typeof r.id, 'string', `层缺 id：${JSON.stringify(r)}`);
      assert.ok(LAYER_STATUS.has(r.status), `未知状态 ${r.status}（层 ${r.id}）`);
      assert.equal(typeof r.n, 'number', `层 ${r.id} 的 n 不是数字`);
      assert.equal(typeof r.ms, 'number', `层 ${r.id} 的 ms 不是数字`);
    }
  });

  test('failed / partial 必须带原因字段', () => {
    for (const r of report.layers) {
      if (r.status === 'failed') assert.ok(r.error, `失败的层 ${r.id} 没写 error`);
      if (r.status === 'partial') assert.ok(r.reason, `partial 的层 ${r.id} 没写 reason`);
    }
  });

  test('totals 与 layers 自洽', () => {
    for (const k of ['ok', 'stale', 'partial', 'failed']) {
      const counted = report.layers.filter((r) => r.status === k).length;
      assert.equal(report.totals[k], counted, `totals.${k} 与层记录不符`);
    }
  });

  test('net 含请求总数与字节数', () => {
    assert.equal(typeof report.net.requests, 'number');
    assert.equal(typeof report.net.bytes, 'number');
    assert.equal(typeof report.net.hosts, 'number');
  });

  test('run-report.json 不进 data.json', () => {
    const data = JSON.parse(readFileSync(join(dir, 'data.json'), 'utf8'));
    assert.equal(data.__runReport, undefined, '运行报告不该混进站点数据');
  });
});
