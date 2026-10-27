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

import { computeChanges, countByType, describeChange } from '../pipeline/derive/changes-engine.mjs';
import { renderAtom } from '../pipeline/derive/atom.mjs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

/** 站点需要复制的静态文件：源在仓库根，落到 dist 同名位置。 */
const STATIC_FILES = ['index.html', 'favicon.svg', '_headers'];

/** 页面用 import 共享的模块（S9.1：构建期与浏览器共用同一份视图代码的基础）。 */
// 页面共用的纯函数模块：构建期复制进 dist/lib/，浏览器直接 import（S9.1）。
// effective-cost 是有效成本公式与画像的唯一来源，中转站与比价页都读它。
const SHARED_MODULES = ['lib/url.js', 'lib/cost.js', 'lib/effective-cost.js', 'lib/offers.js'];

/** 静态资源目录：整目录复制（自托管字体在这里，S9.6）。 */
const ASSET_DIRS = ['assets'];

/* 样式与客户端模块（T5.2）：预渲染的 HTML 引用它们。 */
const EXTRA_DIRS = [
  ['site/styles', 'styles'],
  ['site/client', 'client'],
  ['site/scripts', 'scripts'],
];

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

const { ROUTES } = await import('./routes/index.mjs');

const argv = process.argv.slice(2);
const dataDir = parseDataDir(argv);

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

for (const [from, to] of EXTRA_DIRS) {
  const src = join(ROOT, from);
  if (!existsSync(src)) {
    console.error(`[build] 缺少目录：${from}`);
    process.exit(1);
  }
  cpSync(src, join(DIST, to), { recursive: true });
  copied.push(`${to}/`);
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
  const hashed = name.replace(/\.json$/, `.${digest.slice(0, 8)}.json`);

  writeFileSync(join(DATA_DIR, hashed), text, 'utf8');
  published.push({
    name,
    file: `data/${hashed}`,
    hash: digest,
    bytes: Buffer.byteLength(text, 'utf8'),
  });

  cpSync(src, join(DIST, name));
  copiedData.push(name);
  copiedData.push(`data/${hashed}`);
}

/* dist/data/manifest.json（T3.9 · S3.5）：页面通过它找数据文件。
 * 采集侧那份记「层 → 文件 → 门禁结论」，这份记「文件 → 内容哈希 → 体积」，
 * 两者一起构成发布凭据；部署后逐层核对哈希（第 3 步）。 */
/* 情报按月分片清单（T5.2 · S9.3）：客户端据此按需拉某个月，
 * 不必一次拿全部。目录不存在时是空数组，页面会退化成只显示索引。 */
const newsShardMonths = (() => {
  /* T4.1 把归档迁到了 data 分支的 news/。构建时它在 .data/news/，
   * 也可能在 --data 指定的目录旁。两处都找。 */
  const candidates = [join(dataDir, 'news'), join(ROOT, '.data', 'news')];

  for (const dir of candidates) {
    try {
      const months = readdirSync(dir)
        .filter((f) => /^\d{4}-\d{2}\.json$/.test(f))
        .map((f) => f.replace(/\.json$/, ''))
        .sort();
      if (!months.length) continue;

      mkdirSync(join(DIST, 'news'), { recursive: true });
      for (const m of months) {
        cpSync(join(dir, `${m}.json`), join(DIST, 'news', `${m}.json`));
      }
      return months;
    } catch {
      /* 这个位置没有：试下一个 */
    }
  }
  return [];
})();

const buildManifest = {
  schema_version: 'data-manifest/v1',
  files: published,
  newsShards: newsShardMonths,
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

/* 变化引擎与 Atom 源（T4.3 · S5.2）。
 *
 * 需要「上一版快照」。来源优先级：
 *   1. `--prev <目录>` 显式指定的快照目录
 *   2. data 目录里的 snapshots/（真实运行时）
 *   3. 没有上一版 → 跳过（首次构建不该产出空 feed 冒充「有变化」）
 */
const prevDir = (() => {
  const at = argv.indexOf('--prev');
  if (at >= 0 && argv[at + 1]) return resolve(argv[at + 1]);
  const fromData = join(dataDir, 'snapshots');
  return existsSync(fromData) ? fromData : null;
})();

if (prevDir) {
  const readLayer = (dir, name) => {
    for (const cand of [name, name.replace(/s$/, '')]) {
      const p = join(dir, `${cand}.json`);
      if (existsSync(p)) {
        try {
          return JSON.parse(readFileSync(p, 'utf8'));
        } catch {
          return null;
        }
      }
    }
    return null;
  };

  const prevData = {};
  for (const layer of ['models', 'offers', 'subs', 'relays', 'events']) {
    const v = readLayer(prevDir, layer);
    if (v) prevData[layer] = v;
  }

  const prevBench = join(prevDir, 'bench.json');
  const prevBenchObj = existsSync(prevBench) ? JSON.parse(readFileSync(prevBench, 'utf8')) : null;

  const currData = JSON.parse(readFileSync(join(dataDir, 'data.json'), 'utf8'));
  const currBench = existsSync(join(dataDir, 'bench.json'))
    ? JSON.parse(readFileSync(join(dataDir, 'bench.json'), 'utf8'))
    : currData.bench;

  if (Object.keys(prevData).length) {
    const events = computeChanges(
      { data: prevData, bench: prevBenchObj },
      { data: currData, bench: currBench },
      { date: currData.meta?.date || '' },
    );

    mkdirSync(join(DIST, 'feeds'), { recursive: true });
    writeFileSync(
      join(DIST, 'feeds', 'changes.xml'),
      renderAtom({
        events,
        updated: `${currData.meta?.date || '1970-01-01'}T00:00:00Z`,
        describe: describeChange,
      }),
      'utf8',
    );

    /* 变化数据也给页面用（首页「今日变化」模块）。 */
    writeFileSync(
      join(DATA_DIR, 'changes.json'),
      JSON.stringify(
        { date: currData.meta?.date || '', events, counts: countByType(events) },
        null,
        2,
      ),
      'utf8',
    );
    copiedData.push('feeds/changes.xml', 'data/changes.json');
    console.log(
      `[build] 变化 ${events.length} 条（${Object.keys(countByType(events)).length} 类）→ feeds/changes.xml`,
    );
  }
}

if (!copiedData.includes('data.json')) {
  console.error(`[build] ${dataDir} 里没有 data.json，页面无数据可渲染`);
  process.exit(1);
}

/* ────────────────────────── 预渲染（T5.2 · S9.1） ──────────────────────────
 *
 * 每个路由一个独立 HTML，不开 JS 也能读。这是 S9.3 的要求，也是读者
 * 「搜一个价格」时最该有的体验：不该为此下载 146 KB 数据再等 JS。
 *
 * 首页的 index.html 仍然由 prerender 生成——旧的单体页面不再作为生产入口，
 * 但它留在仓库里作为对照（M5 后续任务会清理）。
 */
{
  const { prerenderAll, sitemap } = await import('./routes/prerender.mjs');
  const { publicDatasets, UPSTREAMS, datasetJsonLd } = await import('../pipeline/datasets.mjs');

  /* 完整数据：data.json 里 only 目录，boards 在 bench.json。合并一份给视图用。 */
  const fullData = JSON.parse(readFileSync(join(dataDir, 'data.json'), 'utf8'));
  if (existsSync(join(dataDir, 'bench.json'))) {
    try {
      fullData.bench = JSON.parse(readFileSync(join(dataDir, 'bench.json'), 'utf8'));
    } catch {
      /* bench 坏了就让视图自己降级 */
    }
  }

  /* 数据质量周报（T7.3）：优先读预生成的 status.json；没有就用 dataDir/status/*.ndjson 现算。 */
  try {
    const statusJson = join(dataDir, 'status.json');
    if (existsSync(statusJson)) {
      fullData.status = JSON.parse(readFileSync(statusJson, 'utf8'));
    } else {
      const { weeklyStatusFromDir } = await import('../pipeline/status-report.mjs');
      const day = fullData.meta?.date || '1970-01-01';
      fullData.status = weeklyStatusFromDir(dataDir, {
        now: new Date(`${day}T00:00:00Z`),
        nowISO: `${day}T00:00:00Z`,
      });
    }
  } catch {
    fullData.status = { weeks: [], layers: {}, labels: [] };
  }

  /* 变化数据（T4.3 已在上面生成）读回来喂给首页。 */
  let changes = null;
  try {
    changes = JSON.parse(readFileSync(join(DATA_DIR, 'changes.json'), 'utf8'));
  } catch {
    changes = null;
  }

  const baseUrl = (
    JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).homepage || ''
  ).replace(/\/+$/, '');

  /* 数据页要的文件清单与上游署名（T5.10 · S9.9）。 */
  const builtManifest = (() => {
    try {
      return JSON.parse(readFileSync(join(DATA_DIR, 'manifest.json'), 'utf8'));
    } catch {
      return {};
    }
  })();
  const datasets = publicDatasets({ manifest: builtManifest });
  const upstreams = UPSTREAMS;

  const { pages, failed } = prerenderAll({
    outDir: join(DIST, 'pages'),
    data: fullData,
    changes,
    datasets,
    upstreams,
    /* 默认分享图（T5.10）：仓库内的静态 PNG，1200×630。 */
    image: '/assets/og.png',
    /* 数据页加 schema.org Dataset（S9.9）。 */
    jsonLdFor: (route) =>
      route.path === '/data'
        ? datasetJsonLd({ baseUrl, datasets, lastmod: fullData.meta?.date })
        : null,
    baseUrl,
    log: (m) => console.log(`[build]   ${m}`),
  });

  writeFileSync(
    join(DIST, 'sitemap.xml'),
    sitemap({ baseUrl, lastmod: fullData.meta?.date }),
    'utf8',
  );
  copied.push('sitemap.xml');

  /* robots.txt（T5.10 · S9.9）：允许全部页面，指向 sitemap。 */
  writeFileSync(
    join(DIST, 'robots.txt'),
    ['User-agent: *', 'Allow: /', '', `Sitemap: ${baseUrl}/sitemap.xml`, ''].join('\n'),
    'utf8',
  );
  copied.push('robots.txt');

  console.log(`[build] 预渲染 ${pages.length}/${pages.length + failed.length} 页`);
  for (const p of pages) copiedData.push(join('pages', p.file));

  if (failed.length) {
    /* 单页渲染失败不该让整个构建失败：其它页照常发布，
     * 但必须在日志里说清哪一页没出来。 */
    for (const f of failed) console.error(`[build] 未渲染：${f.path} — ${f.error}`);
  }
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

/* ────────────────────────── 性能预算（T5.7 · S9.7） ──────────────────────────
 *
 * 按 brotli 算读者真正下载的量，不是未压缩字节数。
 * 字体不算：它是并行请求，且 font-display: swap 不阻塞首屏。
 *
 * 超预算就**让构建失败**——预算是硬线，写在文档里但构建不管等于没有。
 */
{
  const { BUDGET, firstPaintBytes, checkBudget, renderBudgetTable, brotliSize } = await import(
    '../pipeline/budgets.mjs'
  );

  /** 读一个文件，读不到给空串。 */
  const readOr = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

  /* 所有路由共用的 CSS 与 JS（首屏要下载的就是这些）。 */
  const sharedCss = [
    readOr(join(DIST, 'styles', 'tokens.css')),
    readOr(join(DIST, 'styles', 'main.css')),
  ];
  const sharedJs = [readOr(join(DIST, 'scripts', 'boot.js'))];

  const checks = [];

  /* 1. 每个路由的首屏传输。 */
  for (const route of [...ROUTES]) {
    const html = readOr(
      join(DIST, route.file === 'index.html' ? 'index.html' : `pages/${route.file}`),
    );
    if (!html) continue;

    /* 主脚本：预渲染页用 client/main.js，旧首页用 scripts/app.js。 */
    const mainJs =
      route.file === 'index.html'
        ? readOr(join(DIST, 'scripts', 'app.js'))
        : readOr(join(DIST, 'client', 'main.js'));

    const sizes = firstPaintBytes({
      html,
      css: sharedCss,
      js: [...sharedJs, mainJs],
    });

    checks.push(checkBudget(`${route.path} 首屏`, sizes.total, BUDGET.firstPaintBytes));
  }

  /* 2. 懒加载数据请求。 */
  const dataFiles = ['data.json', 'bench.json', 'news-milestones.json', 'data/changes.json'];
  for (const name of dataFiles) {
    const p = join(DIST, name.replace('data/', 'data/'));
    if (!existsSync(p)) continue;
    checks.push(checkBudget(`${name} 懒加载`, brotliSize(readFileSync(p)), BUDGET.lazyDataBytes));
  }

  /* 3. 汇总。 */
  const failed = checks.filter((c) => !c.pass);
  console.log('[build] 性能预算：');
  for (const line of renderBudgetTable(checks).split('\n')) console.log(`[build]   ${line}`);

  if (failed.length) {
    console.error(`[build] ${failed.length} 项超预算：`);
    for (const f of failed) {
      console.error(
        `[build]   ${f.label}：${(f.actual / 1024).toFixed(1)} KB > ${(f.limit / 1024).toFixed(1)} KB`,
      );
    }
    /* S9.7：超预算即失败。只有超了才考虑引入压缩工具，不是一上来就加一层构建。 */
    process.exitCode = 1;
  }
}

const stats = dirStats(DIST);
console.log(`[build] 数据来源：${dataDir.replace(ROOT, '.')}`);
console.log(`[build] 静态：${copied.join(', ')}`);
console.log(`[build] 数据：${copiedData.join(', ')}`);
console.log(`[build] dist/ 共 ${stats.files} 个文件，${(stats.bytes / 1024 / 1024).toFixed(2)} MB`);
