#!/usr/bin/env node
/**
 * 从 data 目录的 status/*.ndjson 生成 status.json（T7.3）。
 *
 * 用法：node scripts/status-report.mjs [--root .data] [--out .data/status.json]
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { weeklyStatusFromDir } from '../pipeline/status-report.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const root = resolve(arg('--root', '.data'));
const out = resolve(arg('--out', `${root}/status.json`));
const now = new Date();
const report = weeklyStatusFromDir(root, { now, nowISO: now.toISOString() });
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(
  `[status] 写入 ${out}：${report.weeks.length} 周 / ${Object.keys(report.layers).length} 层`,
);
