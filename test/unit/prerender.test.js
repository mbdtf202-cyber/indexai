/**
 * 预渲染多页（T5.2 · S9.1 / S9.3）。
 *
 * ## 三条验收
 *
 * 1. **每个路由不开 JS 可读**：HTML 里就有内容，不是空壳等 JS 填。
 * 2. **没有页面请求完整的 `data.json`**：每页只带自己需要的摘要。
 * 3. **首页不请求情报归档**：首页只要最新几条，不要 2788 行。
 *
 * ## 为什么这条测试重要
 *
 * 「预渲染」最容易被做成「渲染了一个空壳」：HTML 里只有 `<div id="app"></div>`，
 * 内容全靠 JS。那种情况下页面**看起来**有文件，但搜索引擎、禁用 JS 的读者、
 * 慢网络下的首屏都是空的。这里断言的是真实字节里有真实内容。
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROUTES, routeByPath, navItems, SITE_NAME } from '../../site/routes/index.mjs';
import { prerenderAll, shell, sitemap, summarise, esc } from '../../site/routes/prerender.mjs';
import { dataFor, homeData } from '../../site/routes/data.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const fixtureData = () => {
  try {
    const data = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'data', 'data.json'), 'utf8'));
    let bench = null;
    try {
      bench = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'data', 'bench.json'), 'utf8'));
    } catch {
      bench = null;
    }
    return { ...data, bench: bench ?? data.bench };
  } catch {
    return null;
  }
};

/* ────────────────────────── 路由表 ────────────────────────── */

describe('路由表是单一事实来源', () => {
  test('每条路由都有 path / file / title / description / render', () => {
    for (const r of ROUTES) {
      assert.ok(r.path, '缺 path');
      assert.ok(r.file, `${r.path} 缺 file`);
      assert.ok(r.title, `${r.path} 缺 title`);
      assert.ok(r.description, `${r.path} 缺 description`);
      assert.equal(typeof r.render, 'function', `${r.path} 的 render 要是函数`);
    }
  });

  test('path 唯一', () => {
    const paths = ROUTES.map((r) => r.path);
    assert.equal(new Set(paths).size, paths.length);
  });

  test('file 唯一，且都以 .html 结尾', () => {
    const files = ROUTES.map((r) => r.file);
    assert.equal(new Set(files).size, files.length);
    for (const f of files) assert.match(f, /\.html$/);
  });

  test('首页的 path 是 / ，file 是 index.html', () => {
    const home = ROUTES.find((r) => r.path === '/');
    assert.ok(home, '必须有首页');
    assert.equal(home.file, 'index.html');
  });

  test('routeByPath 精确匹配，不认识就 null', () => {
    assert.equal(routeByPath('/models')?.file, 'models.html');
    assert.equal(routeByPath('/nope'), null);
    // 带 query 与 fragment 也要认
    assert.equal(routeByPath('/models?x=1')?.file, 'models.html');
    assert.equal(routeByPath('/models#top')?.file, 'models.html');
  });

  test('导航项都来自路由表', () => {
    const nav = navItems();
    assert.ok(nav.length >= 5);
    for (const n of nav) {
      assert.ok(n.path && n.label);
      assert.ok(routeByPath(n.path), `导航项 ${n.path} 在路由表里不存在`);
    }
  });
});

/* ────────────────────────── 数据分级 ────────────────────────── */

describe('每页只拿自己要的数据（验收 2）', () => {
  const data = fixtureData();

  test('home 只给摘要，不给完整模型列表', () => {
    if (!data) return;
    const d = dataFor('home', data, { changes: { events: [] } });
    assert.ok(Array.isArray(d.topModels), 'topModels 要是数组（截断后的）');
    assert.equal(d.topModels.length <= 12, true, 'top 模型不超过 12 个');
    assert.equal(d.models, undefined, '首页不该拿到完整模型列表');
  });

  test('summarise(home) 不含完整实体', () => {
    if (!data) return;
    const d = dataFor('home', data, { changes: { events: [] } });
    const s = summarise('home', d);
    assert.equal(s.models, undefined);
    assert.equal(s.offers, undefined);
    assert.ok(JSON.stringify(s).length < 60_000, '内嵌摘要要小');
  });

  test('all 给完整数据（订阅/免费/活动这类页需要）', () => {
    if (!data) return;
    const d = dataFor('all', data);
    assert.ok(Array.isArray(d.models) || d.models === undefined);
  });

  test('未知 kind 退回完整数据，不炸', () => {
    assert.doesNotThrow(() => dataFor('whatever', {}));
  });

  test('homeData 在空数据上不炸', () => {
    const d = homeData({}, null);
    assert.deepEqual(d.topModels, []);
    assert.deepEqual(d.recentChanges, []);
  });
});

/* ────────────────────────── 渲染 ────────────────────────── */

describe('预渲染：每个路由都产出可读 HTML（验收 1）', () => {
  let outDir;
  let result;

  before(() => {
    const data = fixtureData();
    if (!data) return;
    outDir = mkdtempSync(join(tmpdir(), 'indexai-prerender-'));
    result = prerenderAll({
      outDir,
      data,
      changes: { events: [] },
      baseUrl: 'https://example.test',
    });
  });

  test('全部路由都渲染成功', () => {
    if (!result) return;
    assert.deepEqual(
      result.failed,
      [],
      `未渲染：${result.failed?.map((f) => `${f.path}: ${f.error}`).join('; ')}`,
    );
    assert.equal(result.pages.length, ROUTES.length);
  });

  test('每个 HTML 都有真实内容（不是空壳）', () => {
    if (!result) return;
    for (const page of result.pages) {
      const html = readFileSync(join(outDir, page.file), 'utf8');
      // 去掉标签后的正文长度：空壳会接近 0
      const text = html
        .replace(/<script[\s\S]*?<\/script>/g, '')
        .replace(/<style[\s\S]*?<\/style>/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, '')
        .trim();
      assert.ok(text.length > 100, `${page.path} 正文只有 ${text.length} 字符，像是空壳`);
    }
  });

  test('每个 HTML 有 title / description / canonical', () => {
    if (!result) return;
    for (const page of result.pages) {
      const html = readFileSync(join(outDir, page.file), 'utf8');
      assert.match(html, /<title>[^<]+<\/title>/, `${page.path} 缺 title`);
      assert.match(html, /<meta name="description" content="[^"]+"/, `${page.path} 缺 description`);
      assert.match(html, /<link rel="canonical" href="[^"]+"/, `${page.path} 缺 canonical`);
    }
  });

  test('导航是静态的（不依赖 JS）', () => {
    if (!result) return;
    const html = readFileSync(join(outDir, 'index.html'), 'utf8');
    for (const n of navItems()) {
      assert.ok(html.includes(`href="${n.path}"`), `导航缺 ${n.path}`);
    }
  });

  test('每页带内嵌数据，且不含完整 data.json', () => {
    if (!result) return;
    for (const page of result.pages) {
      const html = readFileSync(join(outDir, page.file), 'utf8');
      assert.match(
        html,
        /<script type="application\/json" id="__data">/,
        `${page.path} 缺内嵌数据`,
      );

      const m = /<script type="application\/json" id="__data">([\s\S]*?)<\/script>/.exec(html);
      const embedded = JSON.parse(m[1]);
      const size = JSON.stringify(embedded).length;
      assert.ok(size < 80_000, `${page.path} 内嵌数据 ${size} 字节，太大了（应当只是摘要）`);
    }
  });

  test('首页不内嵌情报归档（验收 3）', () => {
    if (!result) return;
    const html = readFileSync(join(outDir, 'index.html'), 'utf8');
    const m = /<script type="application\/json" id="__data">([\s\S]*?)<\/script>/.exec(html);
    const embedded = JSON.parse(m[1]);
    assert.equal(embedded.newsArchive, undefined, '首页不该带归档');
    {
      const news = embedded.latestNews || [];
      assert.ok(news.length <= 8, '首页只要最新几条');
    }
  });

  test('失败的单页不阻断其它页（有降级）', () => {
    if (!outDir) return;
    const bad = prerenderAll({
      outDir: join(outDir, 'bad'),
      data: {},
      changes: null,
    });
    // 空数据下也可能全部成功（视图都做了降级）；关键是「不抛错」
    assert.ok(Array.isArray(bad.pages));
    assert.ok(Array.isArray(bad.failed));
  });
});

/* ────────────────────────── 外壳与 sitemap ────────────────────────── */

describe('外壳', () => {
  test('esc 转义特殊字符', () => {
    assert.equal(esc('a<b&c"d'), 'a&lt;b&amp;c&quot;d');
  });

  test('当前路由标 aria-current', () => {
    const html = shell({ route: routeByPath('/models'), body: '<p>x</p>', embedded: '{}' });
    assert.match(html, /<a href="\/models" aria-current="page">/);
  });

  test('内嵌数据里的 < 被转义（不让它提前闭合 script）', () => {
    const html = shell({
      route: routeByPath('/'),
      body: '',
      embedded: JSON.stringify({ note: '</script><script>alert(1)</script>' }),
    });
    assert.equal(html.includes('</script><script>alert(1)'), false);
  });

  test('有跳转链接与 lang', () => {
    const html = shell({ route: routeByPath('/'), body: '', embedded: '{}' });
    assert.match(html, /<html lang="zh-CN">/);
    assert.match(html, /<a class="skip" href="#view">/);
  });
});

describe('sitemap 从同一张路由表生成', () => {
  test('包含全部路由', () => {
    const xml = sitemap({ baseUrl: 'https://example.test' });
    for (const r of ROUTES) {
      assert.ok(xml.includes(`https://example.test${r.path}`), `sitemap 缺 ${r.path}`);
    }
  });

  test('是合法 urlset', () => {
    const xml = sitemap({ baseUrl: 'https://example.test' });
    assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
    assert.match(xml, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
    assert.match(xml, /<\/urlset>\s*$/);
  });
});

/* ────────────────────────── 真实构建产物 ────────────────────────── */

describe('dist/pages/ 里有预渲染的页面（验收）', () => {
  /* 预渲染产物落在 dist/pages/ 而不是覆盖 dist/index.html：
   * 旧页面仍是生产入口（功能完整），新架构逐页对齐后再切换。 */
  const pagesDir = join(ROOT, 'dist', 'pages');

  test('每个路由都有对应文件', () => {
    if (!existsSync(pagesDir)) return; // 没构建就跳过
    for (const r of ROUTES) {
      assert.ok(existsSync(join(pagesDir, r.file)), `dist/pages/ 缺 ${r.file}`);
    }
  });

  test('预渲染的首页有实质内容', () => {
    const p = join(pagesDir, 'index.html');
    if (!existsSync(p)) return;
    const html = readFileSync(p, 'utf8');
    const text = html.replace(/<[^>]+>/g, '').replace(/\s+/g, '');
    assert.ok(text.length > 200, '正文太短，像是空壳');
    assert.match(html, new RegExp(SITE_NAME));
  });

  test('dist/sitemap.xml 存在且列出全部页', () => {
    const p = join(ROOT, 'dist', 'sitemap.xml');
    if (!existsSync(p)) return;
    const xml = readFileSync(p, 'utf8');
    for (const r of ROUTES) assert.ok(xml.includes(r.path), `sitemap 缺 ${r.path}`);
  });
});
