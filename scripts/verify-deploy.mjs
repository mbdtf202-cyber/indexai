#!/usr/bin/env node
/**
 * 部署后自检：拉线上 manifest，逐层核对哈希（T3.9 · S3.5 · 第 3 条）。
 *
 * ## 为什么比对哈希而不是时间戳
 *
 * 旧做法是比 `meta.generated_at`。它有两个漏洞：
 *   1. 时间戳相同不代表内容相同（同一天重跑两次，第二次的修复看不见）；
 *   2. 时间戳不同也不一定有问题（CDN 缓存了几秒）。
 *
 * 哈希是内容指纹：**线上文件的实际字节**算出来的哈希，必须与 manifest 里记的一致。
 * 不一致就是不一致，没有解释空间。
 *
 * ## 用法
 *
 * ```sh
 * node scripts/verify-deploy.mjs <本地 dist 目录> [站点根 URL]
 * ```
 *
 * 缺参数时从 `package.json` 的 `homepage` 取站点地址，从 `dist` 取构建产物。
 */

import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const distDir =
  process.argv[2] && !process.argv[2].startsWith('http') ? process.argv[2] : join(ROOT, 'dist');
const siteUrl = (
  process.argv.find((a) => a.startsWith('http')) ||
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).homepage ||
  ''
).replace(/\/+$/, '');

if (!siteUrl) {
  console.error('::error::不知道站点地址（package.json 缺 homepage）');
  process.exit(1);
}

const localManifestPath = join(distDir, 'data', 'manifest.json');
if (!existsSync(localManifestPath)) {
  console.error(`::error::构建产物里没有 ${localManifestPath}`);
  process.exit(1);
}

const local = JSON.parse(readFileSync(localManifestPath, 'utf8'));

/** 拉一个 URL 成文本，带重试（CDN 刚发布时可能还有几秒的 404/旧版）。 */
async function fetchText(url, tries = 5) {
  let lastErr = null;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (res.ok) return await res.text();
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw lastErr || new Error('拉取失败');
}

const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/* 1. 线上 manifest 必须能拉到，且 schema 版本一致（S3.5：整站只在这件事上失败）。 */
let live;
try {
  const text = await fetchText(`${siteUrl}/data/manifest.json`);
  live = JSON.parse(text);
} catch (e) {
  console.error(`::error::拉不到线上 manifest：${e.message}`);
  process.exit(1);
}

if (live.schema_version !== local.schema_version) {
  console.error(
    `::error::线上 manifest schema 版本不符：本地 ${local.schema_version}，线上 ${live.schema_version}`,
  );
  process.exit(1);
}

/* 2. 逐层核对哈希（第 3 条）。 */
const liveByFile = new Map((live.files || []).map((f) => [f.file, f]));
const failures = [];
const checked = [];

for (const f of local.files || []) {
  const remote = liveByFile.get(f.file);
  if (!remote) {
    failures.push(`${f.file}：线上 manifest 里没有这个文件`);
    continue;
  }
  if (remote.hash !== f.hash) {
    failures.push(
      `${f.file}：manifest 哈希不一致（本地 ${f.hash.slice(0, 8)}… 线上 ${remote.hash.slice(0, 8)}…）`,
    );
    continue;
  }

  // 真的把文件拉下来再算一遍：manifest 说一致不算，字节一致才算
  try {
    const body = await fetchText(`${siteUrl}/${f.file}`);
    const actual = sha(body);
    if (actual !== f.hash) {
      failures.push(`${f.file}：线上文件哈希与 manifest 不符（${actual.slice(0, 8)}…）`);
    } else {
      checked.push(f.file);
    }
  } catch (e) {
    failures.push(`${f.file}：拉不到（${e.message}）`);
  }
}

/* 3. 逐层核对门禁结论（第 3 条的后半：层必须在，且 stale 数对得上）。 */
const localLayers = local.layers || [];
const liveLayers = live.layers || [];
for (const l of localLayers) {
  const hit = liveLayers.find((x) => x.layer === l.layer);
  if (!hit) failures.push(`层 ${l.layer}：线上 manifest 里没有`);
  else if (hit.hash !== l.hash) failures.push(`层 ${l.layer}：哈希不一致`);
}

/* 4. 汇总。 */
console.log(`线上自检：${siteUrl}`);
console.log(`核对文件 ${checked.length} / ${(local.files || []).length}，层 ${liveLayers.length}`);

if (failures.length) {
  console.error('');
  console.error(`::error::部署自检失败 ${failures.length} 项`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('全部一致：线上字节与 manifest 记录的哈希逐一对上');
