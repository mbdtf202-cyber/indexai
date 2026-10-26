#!/usr/bin/env node
/**
 * 重写采集 golden（T0.4）。
 *
 * 只在「这次差异是预期内的」时运行。提交时必须说明差异来源（UPGRADE_PLAN §7 第 4 条）。
 *
 * 内部直接复用 golden 测试的运行参数：回放 + 固定时钟 + 测试档位。
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GOLDEN = join(ROOT, 'fixtures', 'golden');
const OUTPUTS = ['data.json', 'bench.json', 'news-archive.json'];

const outDir = mkdtempSync(join(tmpdir(), 'indexai-golden-update-'));

const code = await new Promise((resolve) => {
  const child = spawn(
    process.execPath,
    ['--import', './test/support/http-replay.js', './pipeline/orchestrator.mjs'],
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        INDEXAI_HTTP: 'replay',
        INDEXAI_PROFILE: 'test',
        INDEXAI_OUT_DIR: outDir,
        INDEXAI_NOW: '2026-10-24T01:00:00.000Z',
        ALLOW_DEGRADED: '1',
      },
    },
  );
  child.on('close', resolve);
});

if (code !== 0) {
  rmSync(outDir, { recursive: true, force: true });
  console.error(`[golden:update] 采集失败（退出码 ${code}），golden 未改动`);
  process.exit(1);
}

mkdirSync(GOLDEN, { recursive: true });
for (const name of OUTPUTS) {
  cpSync(join(outDir, name), join(GOLDEN, name));
}
rmSync(outDir, { recursive: true, force: true });

console.log(`[golden:update] 已重写 ${OUTPUTS.join(' / ')}`);
console.log('[golden:update] 记得在提交信息里逐条说明差异来源与原因。');
