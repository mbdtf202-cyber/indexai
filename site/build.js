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

import {
  cpSync,
  mkdirSync,
  rmSync,
  readdirSync,
  existsSync,
  statSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

/** 站点需要复制的静态文件：源在仓库根，落到 dist 同名位置。 */
const STATIC_FILES = ['index.html', 'favicon.svg', '_headers'];

/** 页面用 import 共享的模块（S9.1：构建期与浏览器共用同一份视图代码的基础）。 */
// 页面共用的纯函数模块：构建期复制进 dist/lib/，浏览器直接 import（S9.1）。
// effective-cost 是有效成本公式与画像的唯一来源，中转站与比价页都读它。
const SHARED_MODULES = ['lib/url.js', 'lib/cost.js', 'lib/effective-cost.js'];

/** 静态资源目录：整目录复制（自托管字体在这里，S9.6）。 */
const ASSET_DIRS = ['assets'];

/** 数据文件名：从 --data 指定的目录复制。 */
// news-archive.json 按需拉取，不进构建产物（T4.1）
// manifest.json 记录每层的文件名 / 哈希 / 门禁结论（T3.7 · S3.5）：
// 页面据此判断「这一层是不是沿用了上一版」，从而只在相关页显示「沿用 N 天」
const DATA_FILES = ['data.json', 'bench.json', 'news-milestones.json', 'manifest.json'];

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
/* 数据文件带内容哈希（T3.9 · S3.5）。
 *
 * 为什么：发布出去的文件名里带哈希，CDN 就能给它设长缓存，而内容一变文件名就变——
 * 不存在「用户拿到旧缓存」这种事。manifest 自己记录哈希，所以它必须不缓存。
 *
 *   dist/data/manifest.json          不缓存，页面先读它
 *   dist/data/<name>.<hash8>.json    长缓存
 *   dist/<name>                      兼容层：页面旧路径仍可用
 */
const DATA_DIR = join(DIST, 'data');
mkdirSync(DATA_DIR, { recursive: true });

const hashOf = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

const published = [];

for (const name of DATA_FILES) {
  const src = join(dataDir, name);
  if (!existsSync(src)) continue;

  /* 采集侧的 manifest 原样搬：它自己记录哈希，不该被再哈希一次。 */
  if (name === 'manifest.json') {
    cpSync(src, join(DATA_DIR, 'manifest.json'));
    copiedData.push('data/manifest.json');
    continue;
  }

  const text = readFileSync(src, 'utf8');
  const digest = hashOf(text);
  const hashed = name.replace(/\.json$/, '.' + digest.slice(0, 8) + '.json');

  writeFileSync(join(DATA_DIR, hashed), text, 'utf8');
  published.push({
    name,
    file: 'data/' + hashed,
    hash: digest,
    bytes: Buffer.byteLength(text, 'utf8'),
  });

  cpSync(src, join(DIST, name));
  copiedData.push(name);
  copiedData.push('data/' + hashed);
}

/* dist/data/manifest.json（T3.9 · S3.5）：页面通过它找数据文件。
 * 采集侧那份记「层 → 文件 → 门禁结论」，这份记「文件 → 内容哈希 → 体积」，
 * 两者一起构成发布凭据；部署后逐层核对哈希（第 3 步）。 */
const buildManifest = {
  schema_version: 'data-manifest/v1',
  files: published,
  total_bytes: published.reduce((n, f) => n + f.bytes, 0),
};
writeFileSync(
  join(DATA_DIR, 'manifest.json.build'),
  JSON.stringify(buildManifest, null, 2),
  'utf8',
);

/* 两份 manifest 要合并成一个：页面只读一份。
 * 采集侧的层信息 + 构建侧的文件信息，缺一不可。 */
const collectManifestPath = join(dataDir, 'manifest.json');
let merged = buildManifest;
if (existsSync(collectManifestPath)) {
  try {
    const collectManifest = JSON.parse(readFileSync(collectManifestPath, 'utf8'));
    merged = { ...buildManifest, layers: collectManifest.layers || [], collect: collectManifest };
  } catch {
    /* 采集侧 manifest 坏了就用构建侧这份，不让构建失败 */
  }
}
writeFileSync(join(DATA_DIR, 'manifest.json'), JSON.stringify(merged, null, 2), 'utf8');
rmSync(join(DATA_DIR, 'manifest.json.build'), { force: true });
copiedData.push('data/manifest.json');

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
