/**
 * SEO、署名与数据页（T5.10 · S9.9 · F51 · D7）。
 *
 * ## 三条验收
 *
 * 1. **sitemap 覆盖全部路由**（含未来的模型详情页）；
 * 2. **每页标题唯一**——两个页面同名 title 时搜索引擎会认错；
 * 3. **`/data/` 页的署名覆盖全部上游源**——漏一个就是漏一次署名义务。
 *
 * 第三条是这张清单最容易被做「大概齐」的地方：列五六个主要的上游，
 * 剩下的不提。所以测试断的是**穷举**：`UPSTREAMS` 里每一条都必须在页面上出现。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ROUTES } from '../../site/routes/index.mjs';
import {
  UPSTREAMS,
  SITE_LICENSE,
  publicDatasets,
  datasetJsonLd,
} from '../../pipeline/datasets.mjs';
import { renderData } from '../../site/views/data.mjs';
import { sitemap } from '../../site/routes/prerender.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(ROOT, 'dist', 'pages');

/* ────────────────────────── title / description ────────────────────────── */

describe('每页标题唯一（验收 2）', () => {
  test('12 个以上路由的 title 两两不同', () => {
    const titles = ROUTES.map((r) => r.title);
    assert.equal(new Set(titles).size, titles.length, `重复的标题：${titles.join(' | ')}`);
  });

  test('每个 description 都不同且非空', () => {
    const descs = ROUTES.map((r) => r.description);
    assert.equal(new Set(descs).size, descs.length);
    for (const d of descs) assert.ok(d.length > 10, `description 太短：${d}`);
  });

  test('title 都带站点名', () => {
    for (const r of ROUTES) {
      if (r.path === '/') continue; // 首页标题本身就是站点名 + 标语
      assert.match(r.title, /IndexAI/, `${r.path} 的标题缺站点名`);
    }
  });
});

/* ────────────────────────── sitemap 与 robots ────────────────────────── */

describe('sitemap 覆盖全部路由（验收 1）', () => {
  test('每条路由的路径都在 sitemap 里', () => {
    const xml = sitemap({ baseUrl: 'https://example.test' });
    for (const r of ROUTES) {
      assert.ok(xml.includes(`https://example.test${r.path}`), `sitemap 缺 ${r.path}`);
    }
  });

  test('URL 数等于路由数', () => {
    const xml = sitemap({ baseUrl: 'https://example.test' });
    const n = (xml.match(/<url>/g) || []).length;
    assert.equal(n, ROUTES.length);
  });

  test('支持 only 过滤（入口切换前后会用到）', () => {
    const xml = sitemap({ baseUrl: 'https://x.test', only: ['/'] });
    assert.equal((xml.match(/<url>/g) || []).length, 1);
  });

  test('dist 里有 robots.txt 且指向 sitemap', () => {
    const p = join(ROOT, 'dist', 'robots.txt');
    if (!existsSync(p)) return;
    const txt = readFileSync(p, 'utf8');
    assert.match(txt, /User-agent: \*/);
    assert.match(txt, /Sitemap: https?:\/\/.+\/sitemap\.xml/);
  });
});

/* ────────────────────────── 上游署名 ────────────────────────── */

describe('/data/ 页署名覆盖全部上游（验收 3）', () => {
  test('上游清单不少于 15 个（穷举而不是挑几个）', () => {
    assert.ok(UPSTREAMS.length >= 15, `只有 ${UPSTREAMS.length} 个上游，是不是漏了`);
  });

  test('每个上游都有名字、地址、署名要求、所属层', () => {
    for (const u of UPSTREAMS) {
      assert.ok(u.id, '缺 id');
      assert.ok(u.name, `${u.id} 缺 name`);
      assert.match(u.url, /^https:\/\//, `${u.id} 的地址不是 https`);
      assert.ok(u.requirement, `${u.id} 缺署名要求`);
      assert.ok(Array.isArray(u.layers) && u.layers.length, `${u.id} 缺 layers`);
    }
  });

  test('id 唯一', () => {
    const ids = UPSTREAMS.map((u) => u.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('渲染出来的页面里每个上游都出现（按名字与地址双查）', () => {
    const html = renderData({ datasets: [], upstreams: UPSTREAMS });
    const missing = [];
    for (const u of UPSTREAMS) {
      if (!html.includes(u.name)) missing.push(`${u.id}（名字）`);
      else if (!html.includes(u.url)) missing.push(`${u.id}（地址）`);
    }
    assert.deepEqual(missing, [], `页面里缺这些上游的署名：${missing.join(', ')}`);
  });

  test('CC BY 4.0 的上游带许可链接', () => {
    const html = renderData({ datasets: [], upstreams: UPSTREAMS });
    const cc = UPSTREAMS.filter((u) => u.license === 'CC BY 4.0');
    assert.ok(cc.length > 0, '至少 OpenRouter 是 CC BY 4.0');
    for (const u of cc) {
      assert.ok(u.licenseUrl, `${u.id} 是 CC BY 4.0 但没给许可链接`);
      assert.ok(html.includes(u.licenseUrl), `页面缺 ${u.id} 的许可链接`);
    }
  });

  test('站点自己的许可是 CC BY 4.0', () => {
    assert.equal(SITE_LICENSE.name, 'CC BY 4.0');
    assert.match(SITE_LICENSE.url, /creativecommons\.org/);
  });
});

/* ────────────────────────── 数据文件清单 ────────────────────────── */

describe('数据文件清单', () => {
  const manifest = {
    files: [
      { name: 'data.json', file: 'data/data.abc12345.json', hash: 'x', bytes: 146005 },
      { name: 'bench.json', file: 'data/bench.def67890.json', hash: 'y', bytes: 40000 },
    ],
    layers: [
      { layer: 'models', file: 'layer-models.json', served_file: 'layer-models.json', gate: 'ok' },
    ],
  };

  test('主输出都在清单里', () => {
    const rows = publicDatasets({ manifest });
    const names = rows.map((r) => r.name);
    assert.ok(names.includes('data.json'));
    assert.ok(names.includes('bench.json'));
  });

  test('每条都有 path / schema / license', () => {
    for (const d of publicDatasets({ manifest })) {
      assert.ok(d.path.startsWith('/'), `${d.name} 缺 path`);
      assert.ok(d.schema, `${d.name} 缺 schema`);
      assert.ok(d.license?.url, `${d.name} 缺许可`);
    }
  });

  test('分层文件也列出来', () => {
    const rows = publicDatasets({ manifest });
    assert.ok(rows.some((r) => r.name === 'layer-models.json'));
  });

  test('没有 manifest 时不炸，返回空', () => {
    assert.deepEqual(publicDatasets({}), []);
  });
});

/* ────────────────────────── JSON-LD ────────────────────────── */

describe('schema.org Dataset（S9.9）', () => {
  test('是 Dataset 类型且带 distribution', () => {
    const ld = datasetJsonLd({
      baseUrl: 'https://example.test',
      datasets: [
        { name: 'data.json', path: '/data/data.x.json', description: '主数据', bytes: 100 },
      ],
      lastmod: '2026-10-24',
    });
    assert.equal(ld['@type'], 'Dataset');
    assert.equal(ld['@context'], 'https://schema.org');
    assert.equal(ld.distribution.length, 1);
    assert.equal(ld.distribution[0]['@type'], 'DataDownload');
    assert.equal(ld.distribution[0].contentUrl, 'https://example.test/data/data.x.json');
    assert.equal(ld.isAccessibleForFree, true);
  });

  test('dist 的 data 页带 JSON-LD', () => {
    const p = join(DIST, 'data.html');
    if (!existsSync(p)) return;
    const html = readFileSync(p, 'utf8');
    assert.match(html, /<script type="application\/ld\+json">/);
    const m = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html);
    const ld = JSON.parse(m[1]);
    assert.equal(ld['@type'], 'Dataset');
    assert.ok(Array.isArray(ld.distribution) && ld.distribution.length > 0);
  });
});

/* ────────────────────────── 分享图 ────────────────────────── */

describe('默认分享图', () => {
  test('assets/og.png 是合法 PNG 且尺寸正确', () => {
    const p = join(ROOT, 'assets', 'og.png');
    assert.ok(existsSync(p), '缺 assets/og.png（由 scripts/make-og-image.mjs 生成）');
    const b = readFileSync(p);
    assert.equal(b.slice(1, 4).toString('ascii'), 'PNG');
    assert.equal(b.readUInt32BE(16), 1200);
    assert.equal(b.readUInt32BE(20), 630);
  });

  test('页面带 og:image 与 twitter:card', () => {
    const p = join(DIST, 'index.html');
    if (!existsSync(p)) return;
    const html = readFileSync(p, 'utf8');
    assert.match(html, /<meta property="og:image" content="https?:\/\/[^"]*og\.png">/);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  });
});

/* ────────────────────────── /data 路由 ────────────────────────── */

describe('/data 路由', () => {
  test('路由表里有 /data', () => {
    const r = ROUTES.find((x) => x.path === '/data');
    assert.ok(r, '缺 /data 路由');
    assert.equal(r.file, 'data.html');
    assert.ok(r.nav, '应当进导航——它是读者核对数据的入口');
  });

  test('数据页不开 JS 也能读（正文有内容）', () => {
    const html = renderData({ datasets: [], upstreams: UPSTREAMS });
    const text = html.replace(/<[^>]+>/g, '').replace(/\s+/g, '');
    assert.ok(text.length > 300, `正文只有 ${text.length} 字符`);
  });

  test('数据页说明采集与门禁机制', () => {
    const html = renderData({ datasets: [], upstreams: UPSTREAMS });
    assert.match(html, /沿用上一版|单层故障/, '要说明单层故障不冻结整站');
    assert.match(html, /manifest\.json/, '要指向 manifest');
  });
});
