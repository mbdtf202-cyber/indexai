/**
 * 预渲染（T5.2 · S9.1 / S9.3）。
 *
 * ## 每个路由一个独立 HTML
 *
 * 不开 JS 也能读完整内容——这不是「加分项」，是这类参考站的基本要求：
 * 读者可能只是想搜一个价格，不该为此下载 146 KB 数据再等 JS 跑一遍。
 *
 * ## 首屏数据内嵌
 *
 * 每个 HTML 里带一小份 `<script type="application/json" id="__data">`，
 * 是**这一页**需要的数据摘要，不是完整 data.json。
 * 客户端启动时直接读它，不必再发一次请求。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { ROUTES, SITE_NAME, navItems } from './index.mjs';
import { dataFor } from './data.mjs';

/** XML/HTML 转义。 */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 页面骨架。
 *
 * 导航是静态的（从路由表生成），不依赖 JS。
 *
 * @param {object} opt
 * @returns {string}
 */
export function shell(opt) {
  const { route, body, embedded, baseUrl = '', jsonLd = null, image = null } = opt;
  const canonical = `${baseUrl}${route.path === '/' ? '/' : route.path}`;

  const nav = navItems()
    .map(
      (n) =>
        `<a href="${esc(n.path)}"${n.path === route.path ? ' aria-current="page"' : ''}>${esc(n.label)}</a>`,
    )
    .join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(route.title)}</title>
<meta name="description" content="${esc(route.description)}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/atom+xml" title="变化" href="/feeds/changes.xml">
<meta property="og:title" content="${esc(route.title)}">
<meta property="og:description" content="${esc(route.description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(canonical)}">
<meta name="theme-color" content="#0b0d10">
${image ? `<meta property="og:image" content="${esc(baseUrl + image)}">\n<meta name="twitter:card" content="summary_large_image">` : ''}
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
<link rel="stylesheet" href="/styles/main.css">
</head>
<body>
<a class="skip" href="#view">跳到内容</a>
<header class="site">
  <a class="brand" href="/">${esc(SITE_NAME)}</a>
  <nav aria-label="主导航">${nav}</nav>
</header>
<main id="view" data-route="${esc(route.path)}">
${body}
</main>
<footer class="site">
  <p>数据每日采集，来源与方法写在 <a href="/methodology">方法</a>。价格以官方为准。</p>
</footer>
<script type="application/json" id="__data">${String(embedded).replace(/</g, '\\u003c')}</script>
<script type="module" src="/client/main.js"></script>
</body>
</html>
`;
}

/**
 * 预渲染全部路由。
 *
 * @param {object} opt
 * @param {string} opt.outDir 输出目录（`dist`）
 * @param {object} opt.data 完整数据
 * @param {object} [opt.changes] 变化数据
 * @param {string} [opt.baseUrl] 站点根 URL（canonical 用）
 * @param {(msg: string) => void} [opt.log]
 * @returns {{pages: Array<{path: string, file: string, bytes: number}>, failed: Array<{path: string, error: string}>}}
 */
export function prerenderAll(opt) {
  const {
    outDir,
    data,
    changes,
    datasets,
    upstreams,
    image = null,
    jsonLdFor = null,
    baseUrl = '',
    log = () => {},
  } = opt;
  const pages = [];
  const failed = [];

  for (const route of ROUTES) {
    try {
      const viewData = dataFor(route.data, data, { changes, datasets, upstreams });
      const body = route.render(viewData);

      /* 内嵌数据只放这一页要的摘要，并且截断成最小可用形状：
       * 完整 data.json 塞进每个页面会让 HTML 变成几百 KB。 */
      const embeddedData = summarise(route.data, viewData);
      /* 转义交给 shell：这样任何调用方（包括测试直接调 shell）都不会漏。 */
      const embedded = JSON.stringify(embeddedData);

      const html = shell({
        route,
        body,
        embedded,
        baseUrl,
        image,
        jsonLd: jsonLdFor ? jsonLdFor(route) : null,
      });
      const file = join(outDir, route.file);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, html, 'utf8');

      pages.push({ path: route.path, file: route.file, bytes: Buffer.byteLength(html, 'utf8') });
      log(`✓ ${route.path} → ${route.file}（${(Buffer.byteLength(html) / 1024).toFixed(1)} KB）`);
    } catch (e) {
      failed.push({ path: route.path, error: e.message });
      log(`✗ ${route.path}: ${e.message}`);
    }
  }

  return { pages, failed };
}

/**
 * 内嵌数据的摘要形状。
 *
 * @param {string} kind
 * @param {object} viewData
 * @returns {object}
 */
export function summarise(kind, viewData) {
  const meta = {
    generated_at: viewData?.meta?.generated_at ?? null,
    date: viewData?.meta?.date ?? null,
    counts: viewData?.meta?.counts ?? null,
    vendorOrder: viewData?.meta?.vendorOrder ?? null,
  };

  if (kind === 'home') {
    return {
      meta,
      latestNews: (viewData?.latestNews || []).slice(0, 8),
      recentChanges: (viewData?.recentChanges || []).slice(0, 20),
      topModels: (viewData?.topModels || []).slice(0, 12),
    };
  }

  return { meta, route: kind };
}

/**
 * 生成 sitemap.xml（从同一张路由表，避免漏页）。
 *
 * @param {object} opt
 * @returns {string}
 */
export function sitemap(opt) {
  const { baseUrl = '', lastmod = null, only = null } = opt;

  /* only：只列这些路径。入口切换前后会用到——sitemap 必须只列**真的能用**的页面，
   * 列了 404 的路径比不列更糟。 */
  const list = only ? ROUTES.filter((r) => only.includes(r.path)) : ROUTES;
  const urls = list.map(
    (r) =>
      `  <url><loc>${esc(baseUrl + r.path)}</loc>${lastmod ? `<lastmod>${esc(lastmod)}</lastmod>` : ''}</url>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}
