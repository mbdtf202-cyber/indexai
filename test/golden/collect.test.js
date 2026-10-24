/**
 * 采集 golden（T0.4 · S1.4）。
 *
 * 在回放模式下用固定时钟跑一遍 `collect.mjs`，把 data.json / bench.json /
 * news-archive.json 与 `fixtures/golden/` 逐字节比较。
 *
 * 三条硬约束：
 * - 必须离线：`INDEXAI_HTTP=replay` 让 fetch 变成读 fixtures，未录制的请求直接抛错。
 * - 必须确定：`INDEXAI_NOW` 固定时钟，`sleep()` 不真等，输出才可比。
 * - 必须在 30 秒内：测试档位把迭代集合缩小到能覆盖所有分支的最小量。
 *
 * 不一致时打印第一个不同的 JSON 路径，而不是扔一整行 diff 让人肉眼找。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const GOLDEN = join(ROOT, 'fixtures', 'golden');

const OUTPUTS = ['data.json', 'bench.json', 'news-archive.json'];

/**
 * 跑一次采集（子进程），返回 { code, stdout, stderr, dir }。
 * 环境由调用方给全，测试本身不改 process.env。
 */
function runCollect(outDir) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--import', './test/support/http-replay.js', './collect.mjs'],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          INDEXAI_HTTP: 'replay',
          INDEXAI_PROFILE: 'test',
          INDEXAI_OUT_DIR: outDir,
          INDEXAI_NOW: '2026-10-24T01:00:00.000Z',
          // 测试档位的数量必然低于生产门禁；这不是「放行坏数据」，
          // 而是用一个真实的缩小窗口跑通整条管线。
          ALLOW_DEGRADED: '1',
        },
      },
    );

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** 找到两个 JSON 值第一个不同的路径，用于失败的诊断输出。 */
function firstJsonDiff(a, b, path = '$') {
  if (a === b) return null;
  const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
  const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
  if (ta !== tb) return { path, a: `${ta}`, b: `${tb}` };

  if (ta === 'array') {
    if (a.length !== b.length) {
      return { path: `${path}.length`, a: a.length, b: b.length };
    }
    for (let i = 0; i < a.length; i += 1) {
      const d = firstJsonDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }

  if (ta === 'object') {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    for (const k of keysA) {
      if (!(k in b)) return { path: `${path}.${k}`, a: 'present', b: 'missing' };
      const d = firstJsonDiff(a[k], b[k], `${path}.${k}`);
      if (d) return d;
    }
    for (const k of keysB) {
      if (!(k in a)) return { path: `${path}.${k}`, a: 'missing', b: 'present' };
    }
    return null;
  }

  return { path, a: String(a).slice(0, 200), b: String(b).slice(0, 200) };
}

describe('collect golden（回放 + 固定时钟 + 测试档位）', () => {
  let dir;
  let first;

  test('首次运行在 30 秒内完成且退出码为 0', async () => {
    dir = mkdtempSync(join(tmpdir(), 'indexai-golden-'));
    const started = Date.now();
    first = await runCollect(dir);
    const elapsed = Date.now() - started;

    assert.equal(first.code, 0, `采集失败：\n${first.stderr.slice(-2000)}`);
    assert.ok(elapsed < 30_000, `耗时 ${elapsed}ms 超过 30 秒上限`);

    for (const name of OUTPUTS) {
      assert.ok(existsSync(join(dir, name)), `缺少输出 ${name}`);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test('三份输出与 golden 逐字节一致', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'indexai-golden-cmp-'));
    try {
      const result = await runCollect(outDir);
      assert.equal(result.code, 0, `采集失败：\n${result.stderr.slice(-2000)}`);

      for (const name of OUTPUTS) {
        const actual = readFileSync(join(outDir, name));
        const expected = readFileSync(join(GOLDEN, name));

        if (actual.equals(expected)) continue;

        // 逐字节不同时，退一步找第一个不同的 JSON 路径，让失败信息可操作
        const actualJson = JSON.parse(actual.toString('utf8'));
        const expectedJson = JSON.parse(expected.toString('utf8'));
        const diff = firstJsonDiff(actualJson, expectedJson);
        const where = diff
          ? `${diff.path}\n  实际: ${JSON.stringify(diff.a).slice(0, 300)}\n  期望: ${JSON.stringify(diff.b).slice(0, 300)}`
          : '（JSON 语义相同，仅序列化格式不同）';

        assert.fail(
          `${name} 与 golden 不一致，第一个差异在：\n${where}\n\n` +
            '如果这次差异是预期内的，运行 npm run golden:update 并在提交信息里说明原因。',
        );
      }
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  test('第二次运行与第一次逐字节相同（确定性）', async () => {
    const dirA = mkdtempSync(join(tmpdir(), 'indexai-det-a-'));
    const dirB = mkdtempSync(join(tmpdir(), 'indexai-det-b-'));
    try {
      const a = await runCollect(dirA);
      const b = await runCollect(dirB);
      assert.equal(a.code, 0, `第一次运行失败：\n${a.stderr.slice(-1500)}`);
      assert.equal(b.code, 0, `第二次运行失败：\n${b.stderr.slice(-1500)}`);

      for (const name of OUTPUTS) {
        const bufA = readFileSync(join(dirA, name));
        const bufB = readFileSync(join(dirB, name));
        assert.ok(
          bufA.equals(bufB),
          `${name} 两次运行结果不同：输出不确定，检查是否有 Date.now / 并发顺序 / 随机源泄漏`,
        );
      }
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });
});
