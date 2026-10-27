#!/usr/bin/env node
/**
 * 把 main 上的 `news-archive.json` 与 `news-seed.json` 迁进 data 分支的月度分片
 * （T4.1 · 第 3 条）。
 *
 * ## 为什么要搬
 *
 * 归档每天在长。放在 main 上：
 *   - 仓库每天膨胀（一天几百 KB，一年上百 MB）；
 *   - 数据提交与代码提交混在一条时间线上，回滚代码时不知道该不该带上数据；
 *   - `news-archive.json` 是一个越写越大的单文件，git 的 diff 对它没有意义。
 *
 * 搬到 data 分支后按月切片：单文件有上界，每月一个文件，diff 看得懂。
 *
 * ## 幂等
 *
 * 重复跑不会重复写：分片合并按 URL 去重。
 *
 * 用法：`node scripts/migrate-news.mjs [--root .data] [--delete-from-main]`
 */

import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeNewsShards, readNewsShards, dataRoot } from './data-scripts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const rootAt = args.indexOf('--root');
const root = rootAt >= 0 ? args[rootAt + 1] : undefined;
const del = args.includes('--delete-from-main');

/** 读一个 JSON 文件，失败返回 null。 */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/* 1. 收集两个来源。news-seed.json 是「补回早期条目」的存档，形态可能是
 * 数组，也可能是 {items}，都接受。 */
const sources = [];
for (const name of ['news-archive.json', 'news-seed.json']) {
  const p = join(ROOT, name);
  if (!existsSync(p)) {
    console.log(`[migrate-news] 没有 ${name}，跳过`);
    continue;
  }
  const raw = readJson(p);
  const rows = Array.isArray(raw) ? raw : (raw?.items ?? []);
  console.log(`[migrate-news] ${name}: ${rows.length} 条`);
  sources.push({ name, rows });
}

const all = sources.flatMap((s) => s.rows);

if (!all.length) {
  console.log('[migrate-news] 没有可迁的条目');
  process.exit(0);
}

/* 2. 写进月度分片。 */
const before = readNewsShards({ root }).length;
const result = writeNewsShards(all, { root });
const after = readNewsShards({ root }).length;

console.log(`[migrate-news] 写入 ${dataRoot(root)}/news/`);
console.log(`[migrate-news] 月份：${result.months.join(', ') || '（无）'}`);
console.log(`[migrate-news] 分片条数 ${before} → ${after}（合并去重后）`);

/* 3. 从 main 删除（可选）。删之前先确认分片里确实有数据——
 * 顺序错了就是「删了没存」，归档再也补不回来（源站只给最近 7 天）。 */
if (del) {
  if (after < all.length * 0.99) {
    console.error(
      `[migrate-news] 拒绝删除：分片只有 ${after} 条，少于来源的 ${all.length} 条。先查合并逻辑。`,
    );
    process.exit(1);
  }
  for (const { name } of sources) {
    const p = join(ROOT, name);
    if (existsSync(p)) {
      unlinkSync(p);
      console.log(`[migrate-news] 已删除 ${name}（内容已在 data 分支的月度分片里）`);
    }
  }
} else {
  console.log('[migrate-news] 预览模式：加 --delete-from-main 才会从 main 删除');
}
