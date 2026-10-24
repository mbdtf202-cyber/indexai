#!/usr/bin/env node
/**
 * 站点构建（T0.5 第 0 版 · UPGRADE_PLAN S3.5）。
 *
 * 这一版只做「把静态文件与数据复制到 dist/」，不做预渲染 ——
 * 预渲染在 M5（T5.x）才落地。先有 dist/，e2e 才能对着真实产物跑。
 *
 * 用法：
 *   npm run build                       # 用 fixtures/data/
 *   npm run build -- --data .           # 用仓库根的真实数据
 *   npm run build -- --data <目录>
 *
 * 产物清单写在 FILES 里；`dist/` 只能出现清单里的文件（R8，T3.9 启用）。
 */

import { cpSync, mkdirSync, rmSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

/** 站点需要复制的静态文件：源在仓库根，落到 dist 同名位置。 */
const STATIC_FILES = ['index.html', 'favicon.svg', '_headers'];

/** 页面用 import 共享的模块（S9.1：构建期与浏览器共用同一份视图代码的基础）。 */
const SHARED_MODULES = ['lib/url.js', 'lib/cost.js'];

/** 静态资源目录：整目录复制（自托管字体在这里，S9.6）。 */
const ASSET_DIRS = ['assets'];

/** 数据文件名：从 --data 指定的目录复制。 */
const DATA_FILES = ['data.json', 'bench.json', 'news-archive.json', 'news-milestones.json'];

/** 解析 `--data <目录>`，默认 fixtures/data。 */
function parseDataDir(argv) {
  const at = argv.indexOf('--data');
  const raw = at >= 0 ? argv[at + 1] : null;
  const dir = raw ? (raw.startsWith('/') ? raw : join(ROOT, raw)) : join(ROOT, 'fixtures', 'data');
  return dir;
}

const dataDir = parseDataDir(process.argv.slice(2));

if (!existsSync(dataDir)) {
  console.error(`[build] 数据目录不存在：${dataDir}`);
  console.error('[build] 先运行 npm run fixture:data 生成 fixtures/data，或指定 --data <目录>');
  process.exit(1);
}

// 每次全量重建，避免上一版残留文件混进来
rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

const copied = [];
for (const name of STATIC_FILES) {
  const src = join(ROOT, name);
  if (!existsSync(src)) {
    console.error(`[build] 缺少静态文件：${name}`);
    process.exit(1);
  }
  cpSync(src, join(DIST, name));
  copied.push(name);
}

for (const dir of ASSET_DIRS) {
  const src = join(ROOT, dir);
  if (!existsSync(src)) {
    console.error(`[build] 缺少资源目录：${dir}`);
    process.exit(1);
  }
  cpSync(src, join(DIST, dir), { recursive: true });
  copied.push(`${dir}/`);
}

for (const rel of SHARED_MODULES) {
  const src = join(ROOT, rel);
  if (!existsSync(src)) {
    console.error(`[build] 缺少共享模块：${rel}`);
    process.exit(1);
  }
  mkdirSync(dirname(join(DIST, rel)), { recursive: true });
  cpSync(src, join(DIST, rel));
  copied.push(rel);
}

const copiedData = [];
for (const name of DATA_FILES) {
  const src = join(dataDir, name);
  if (!existsSync(src)) continue;
  cpSync(src, join(DIST, name));
  copiedData.push(name);
}

if (!copiedData.includes('data.json')) {
  console.error(`[build] ${dataDir} 里没有 data.json，页面无数据可渲染`);
  process.exit(1);
}

/** 产物统计：文件数、总字节，用于构建日志与后续预算检查。 */
function dirStats(dir) {
  let files = 0;
  let bytes = 0;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else {
        files += 1;
        bytes += st.size;
      }
    }
  };
  walk(dir);
  return { files, bytes };
}

const stats = dirStats(DIST);
console.log(`[build] 数据来源：${dataDir.replace(ROOT, '.')}`);
console.log(`[build] 静态：${copied.join(', ')}`);
console.log(`[build] 数据：${copiedData.join(', ')}`);
console.log(`[build] dist/ 共 ${stats.files} 个文件，${(stats.bytes / 1024 / 1024).toFixed(2)} MB`);
