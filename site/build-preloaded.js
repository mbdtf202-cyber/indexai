/**
 * Pre-rendering Builder for Multi-page Site (T5.2 Round 1)
 *
 * Generates pre-rendered HTML for all views + lazy loading infrastructure
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUTPUT_DIR = join(ROOT, 'dist', 'pre-rendered');

// View modules to pre-render
const VIEWS_TO_RENDER = [
  { name: 'home', path: 'site/views/home.mjs', route: '/' },
  { name: 'models', path: 'site/views/models.mjs', route: '/models' },
  { name: 'bench', path: 'site/views/bench.mjs', route: '/benchmarks' },
  { name: 'subs', path: 'site/views/subs.mjs', route: '/subscriptions' },
  { name: 'free', path: 'site/views/free.mjs', route: '/free' },
  { name: 'relays', path: 'site/views/relays.mjs', route: '/relays' },
  { name: 'events', path: 'site/views/events.mjs', route: '/events' },
  { name: 'tools', path: 'site/views/tools.mjs', route: '/tools' },
  { name: 'vendors', path: 'site/views/vendors.mjs', route: '/vendors' },
  { name: 'signals', path: 'site/views/signals.mjs', route: '/signals' },
  { name: 'method', path: 'site/views/method.mjs', route: '/methodology' },
];

/**
 * Mock data generators for each view type
 */
export function getMockData(viewName) {
  const now = new Date().toISOString();

  switch (viewName) {
    case 'home':
      return {
        stats: { modelsCount: 150, gateways: 51, lastUpdated: now },
        latestNews: [],
        recentChanges: [],
        topModels: [],
        benchmarks: [],
      };

    case 'models':
      return {
        models: Array.from({ length: 20 }, (_, i) => ({
          id: `model-${i}`,
          name: `Model ${String.fromCharCode(65 + i)}`,
          vendor: i % 3 === 0 ? 'openai' : i % 3 === 1 ? 'anthropic' : 'google',
          input: 0.5 + Math.random(),
          output: 1.5 + Math.random() * 2,
          free: i < 5 ? Math.floor(Math.random() * 1000) : null,
        })),
        filters: {},
        sortBy: 'input',
        sortOrder: 'asc',
      };

    // Add more mock data generators for other views...
    default:
      return { data: true };
  }
}

/**
 * Render view to static HTML
 */
export async function renderViewToHTML(viewName) {
  try {
    const module = await import(`../${VIEWS_TO_RENDER.find((v) => v.name === viewName).path}`);
    const renderFunc = module[`render${viewName.charAt(0).toUpperCase() + viewName.slice(1)}`];

    if (!renderFunc) {
      console.warn(`No render function found for ${viewName}`);
      return '';
    }

    const mockData = getMockData(viewName);
    const htmlContent = renderFunc(mockData);

    // Wrap in full HTML structure
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>${viewName.charAt(0).toUpperCase() + viewName.slice(1)} | IndexAI</title>
  <meta name="description" content="${viewName} page for AI pricing comparison">
  <link rel="stylesheet" href="/styles/main.css">
</head>
<body>
  <div id="app">${htmlContent}</div>
  <script defer src="/scripts/lazy-load.js"></script>
</body>
</html>`;
  } catch (e) {
    console.error(`Failed to render ${viewName}:`, e.message);
    return '';
  }
}

/**
 * Generate all pre-rendered pages
 */
export async function buildPreRenderedSite() {
  console.log('[build] Starting pre-rendering build...\n');

  // Create output directory
  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  let successCount = 0;
  let failCount = 0;

  // Render each view
  for (const { name, route } of VIEWS_TO_RENDER) {
    try {
      console.log(`[build] Rendering ${name} page...`);

      const html = await renderViewToHTML(name);

      if (html) {
        const filePath = join(
          OUTPUT_DIR,
          `${route.replace(/^\//, '') || 'index'}${route.includes('.') ? '' : '.html'}`,
        );

        // Ensure directory exists
        const dir = dirname(filePath);
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        writeFileSync(filePath, html);
        successCount++;
        console.log(`[build] ✓ Written: ${filePath}`);
      } else {
        failCount++;
        console.log(`[build] ✗ Failed: ${name}`);
      }
    } catch (e) {
      failCount++;
      console.error(`[build] Error rendering ${name}:`, e.message);
    }
  }

  // Generate lazy load manifest
  generateLazyLoadManifest(VIEWS_TO_RENDER.map((v) => v.route));

  console.log(
    `\n[build] Complete! ${successCount}/${VIEWS_TO_RENDER.length} views rendered successfully.`,
  );
  if (failCount > 0) {
    console.warn(`⚠️  ${failCount} views failed to render`);
  }

  return { successCount, failCount, total: VIEWS_TO_RENDER.length };
}

/**
 * Generate lazy loading configuration manifest
 */
function generateLazyLoadManifest(routes) {
  const manifest = {
    version: '1.0',
    generated_at: new Date().toISOString(),
    lazy_loaded_routes: routes.filter((r) => !['/', '/home'].includes(r)),
    preload_strategy: 'intersection_observer',
    priority_threshold: 200,
    deferrable_scripts: ['scripts/lazy-load.js'],
  };

  const manifestPath = join(OUTPUT_DIR, 'lazy-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`[build] Generated lazy loading manifest: ${manifestPath}`);
}

// CLI entry point
if (process.argv[1]?.endsWith('build-preloaded.js')) {
  buildPreRenderedSite().catch(console.error);
}

export default { buildPreRenderedSite, renderViewToHTML };
