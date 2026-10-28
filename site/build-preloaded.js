/**
 * Pre-rendering Builder for Multi-page Site (T5.2 Round 3)
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUTPUT_DIR = join(ROOT, 'dist', 'pre-rendered');

// View modules to pre-render (relative paths from here)
const viewsToRender = [
  { name: 'Home', module: './views/home.mjs', route: '/' },
  { name: 'Models', module: './views/models.mjs', route: '/models' },
  { name: 'Bench', module: './views/bench.mjs', route: '/benchmarks' },
  { name: 'Subs', module: './views/subs.mjs', route: '/subscriptions' },
  { name: 'Free', module: './views/free.mjs', route: '/free' },
  { name: 'Relays', module: './views/relays.mjs', route: '/relays' },
  { name: 'Events', module: './views/events.mjs', route: '/events' },
  { name: 'Tools', module: './views/tools.mjs', route: '/tools' },
  { name: 'Vendors', module: './views/vendors.mjs', route: '/vendors' },
  { name: 'Signals', module: './views/signals.mjs', route: '/signals' },
  { name: 'Method', module: './views/method.mjs', route: '/methodology' },
];

export async function buildPreRenderedSite() {
  console.log('[build] Starting pre-rendering build...\n');

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  const results = { success: 0, failed: 0, pages: [] };

  for (const view of viewsToRender) {
    try {
      console.log(`[build] Rendering ${view.name} (${view.route})...`);

      const html = await renderView(view);

      if (html) {
        const filePath = join(
          OUTPUT_DIR,
          `${view.route.replace(/^\//, '') || 'index'}${view.route.includes('.') ? '' : '.html'}`,
        );

        const dir = dirname(filePath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        writeFileSync(filePath, html);
        results.success++;
        results.pages.push({ name: view.name, route: view.route, path: filePath });
        console.log(`[build] ✓ Written: ${filePath}`);
      } else {
        results.failed++;
        console.log(`[build] ✗ Failed: ${view.name}`);
      }
    } catch (e) {
      results.failed++;
      console.error(`[build] Error rendering ${view.name}:`, e.message);
    }
  }

  generateLazyManifest(results.pages);

  console.log(`\n[build] Complete! ${results.success}/${viewsToRender.length} pages rendered`);
  if (results.failed > 0) {
    console.warn(`⚠️  ${results.failed} pages failed to render`);
  }

  return results;
}

async function renderView(viewSpec) {
  const modulePath = `./${viewSpec.module}`;

  try {
    const module = await import(modulePath);
    const renderFunc = module[`render${viewSpec.name}`];

    if (!renderFunc) {
      console.warn(`No render function found for ${viewSpec.name}`);
      return '';
    }

    const mockData = generateMockData(viewSpec.name);
    const htmlContent = renderFunc(mockData);

    return wrapInPageStructure(htmlContent, viewSpec.name, viewSpec.route);
  } catch (e) {
    console.error(`Failed to import view ${viewSpec.name}:`, e.message);
    return '';
  }
}

function generateMockData(viewName) {
  switch (viewName) {
    case 'Home':
      return {
        stats: { modelsCount: 150, gateways: 51, lastUpdated: new Date().toISOString() },
        latestNews: [],
        recentChanges: [],
        topModels: [],
        benchmarks: [],
      };
    case 'Models':
      return {
        models: Array.from({ length: 10 }, (_, i) => ({
          id: `model-${i}`,
          name: `Model ${String.fromCharCode(65 + i)}`,
          vendor: ['openai', 'anthropic', 'google'][i % 3],
          input: 0.5 + Math.random(),
          output: 1.5 + Math.random() * 2,
          free: null,
        })),
        filters: {},
        sortBy: 'input',
        sortOrder: 'asc',
      };
    case 'Bench':
      return {
        boards: [{ id: 'swe-bench-lite', name: 'SWE-bench Lite', avgScore: 0.8 }],
        rankings: {},
      };
    default:
      return { data: true };
  }
}

function wrapInPageStructure(content, pageName, _route) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${pageName} | IndexAI</title>
  <meta name="description" content="${pageName} page for AI pricing comparison">
  <link rel="stylesheet" href="/styles/main.css">
</head>
<body>
  <div id="app">${content}</div>
  <script defer src="/scripts/lazy-load.js"></script>
</body>
</html>`;
}

function generateLazyManifest(pages) {
  const manifest = {
    version: '1.0',
    generated_at: new Date().toISOString(),
    pages: pages.map((p) => ({ route: p.route, name: p.name })),
    lazy_load_enabled: true,
  };

  writeFileSync(join(OUTPUT_DIR, 'lazy-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('[build] Generated lazy loading manifest');
}

if (process.argv[1]?.endsWith('build-preloaded.js')) {
  buildPreRenderedSite().catch(console.error);
}

export default { buildPreRenderedSite, renderView };
