/**
 * T6.4：来源、原始出处、聚类与 feed 解析。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFeed } from '../../lib/feed.js';
import {
  normalizeNewsUrl,
  titleSimilarity,
  clusterNews,
  newsSourceQuality,
} from '../../lib/news.js';
import newsLayer from '../../pipeline/layers/news/index.js';
import { OFFICIAL_FEEDS } from '../../pipeline/sources/official-feeds.mjs';

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title><![CDATA[OpenAI 发布 GPT-6 Astra]]></title>
    <link>https://openai.com/news/gpt-6-astra?utm_source=rss</link>
    <pubDate>Fri, 23 Oct 2026 09:30:00 GMT</pubDate>
    <description><![CDATA[<p>新模型支持更长的上下文。</p>]]></description>
  </item>
  <item>
    <title>没有链接的条目</title>
    <pubDate>Fri, 23 Oct 2026 10:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>vLLM v1.2.0</title>
    <link rel="alternate" href="https://github.com/vllm-project/vllm/releases/tag/v1.2.0"/>
    <updated>2026-10-22T08:00:00Z</updated>
    <summary>修复了批量推理的崩溃。</summary>
  </entry>
</feed>`;

describe('官方源清单', () => {
  test('至少 6 个源，每个都有权重与新鲜度门禁', () => {
    assert.ok(OFFICIAL_FEEDS.length >= 6, `只有 ${OFFICIAL_FEEDS.length} 个源`);
    for (const feed of OFFICIAL_FEEDS) {
      assert.ok(feed.weight > 0, `${feed.id} 缺权重`);
      assert.ok(feed.maxAgeHours > 0, `${feed.id} 缺新鲜度门禁`);
      assert.match(feed.url, /^https:\/\//);
    }
  });
});

describe('parseFeed', () => {
  test('解析 RSS 的 title/link/date/summary', () => {
    const rows = parseFeed(RSS);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'OpenAI 发布 GPT-6 Astra');
    assert.equal(rows[0].url, 'https://openai.com/news/gpt-6-astra?utm_source=rss');
    assert.equal(rows[0].date, '2026-10-23');
    assert.equal(rows[0].summary, '新模型支持更长的上下文。');
  });

  test('解析 Atom 的 link href 与 updated', () => {
    const rows = parseFeed(ATOM);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, 'vLLM v1.2.0');
    assert.equal(rows[0].url, 'https://github.com/vllm-project/vllm/releases/tag/v1.2.0');
    assert.equal(rows[0].date, '2026-10-22');
  });

  test('没有链接的条目被跳过', () => {
    assert.equal(parseFeed(RSS).length, 1);
  });

  test('空输入返回空数组', () => {
    assert.deepEqual(parseFeed(''), []);
    assert.deepEqual(parseFeed(null), []);
  });
});

describe('normalizeNewsUrl', () => {
  test('去掉 utm 与末尾斜杠', () => {
    assert.equal(
      normalizeNewsUrl('https://example.com/a/?utm_source=x&utm_medium=y&id=3'),
      'https://example.com/a?id=3',
    );
  });

  test('保留有效 query 与 hash 去掉', () => {
    assert.equal(normalizeNewsUrl('https://example.com/a?id=3#part'), 'https://example.com/a?id=3');
  });

  test('拒绝非 http(s) 与非法地址', () => {
    assert.equal(normalizeNewsUrl('javascript:alert(1)'), '');
    assert.equal(normalizeNewsUrl('not a url'), '');
  });
});

describe('clusterNews', () => {
  test('48 小时内高度相似标题合并，ns 记录来源数', () => {
    const rows = [
      {
        u: 'https://a/1',
        d: '2026-10-24',
        t: 'Kimi 发布 K3.1 Pro：2.8T 参数、100 万上下文',
        sc: 7,
      },
      {
        u: 'https://b/2',
        d: '2026-10-23',
        t: 'Kimi 发布 K3.1 Pro，2.8T 参数与 100 万上下文',
        sc: 5,
      },
      {
        u: 'https://c/3',
        d: '2026-10-20',
        t: 'Kimi 发布 K3.1 Pro：2.8T 参数、100 万上下文',
        sc: 3,
      },
    ];
    const out = clusterNews(rows);
    assert.equal(out.length, 2, '超过 48 小时的不合并');
    assert.equal(out.find((x) => x.u === 'https://a/1').ns, 2);
  });

  test('不相似的同日标题不合并', () => {
    const out = clusterNews([
      { d: '2026-10-24', t: 'OpenAI 发布新模型', sc: 5 },
      { d: '2026-10-24', t: '欧盟通过 AI 监管法案', sc: 4 },
    ]);
    assert.equal(out.length, 2);
  });

  test('标题相似度对完全相同为 1', () => {
    assert.equal(titleSimilarity('同一个标题', '同一个标题'), 1);
  });
});

describe('newsSourceQuality', () => {
  test('采集 golden 里来自 aihot 的条目 100% 有原始出处', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const archive = JSON.parse(
      readFileSync(join(root, 'fixtures', 'golden', 'news-archive.json'), 'utf8'),
    );
    const viaRows = archive.filter((x) => x.v);
    const q = newsSourceQuality(viaRows);
    assert.ok(viaRows.length >= 40, `只有 ${viaRows.length} 条带 via`);
    assert.ok(q.ratio >= 0.9, `原始出处覆盖率 ${(q.ratio * 100).toFixed(1)}%`);
  });

  test('原始出处覆盖率只统计非聚合域名', () => {
    const rows = [
      ...Array.from({ length: 9 }, (_, i) => ({ u: `https://site${i}.example/post` })),
      { u: 'https://aihot.news/items/x' },
    ];
    const q = newsSourceQuality(rows);
    assert.equal(q.total, 10);
    assert.equal(q.original, 9);
    assert.equal(q.ratio, 0.9);
  });

  test('空集不除零', () => {
    assert.deepEqual(newsSourceQuality([]), { total: 0, original: 0, missing: 0, ratio: 0 });
  });
});

describe('news layer 新来源', () => {
  function ctx(overrides = {}) {
    return {
      testProfile: false,
      now: () => new Date('2026-10-24T01:00:00.000Z'),
      urls: { hn: 'https://hn.test/search' },
      parseFeed,
      http: {
        text: async (url) =>
          String(url).includes('openai.com')
            ? { ok: true, status: 200, text: RSS }
            : { ok: false, status: 404, text: '' },
        get: async () => ({
          ok: true,
          status: 200,
          json: async () => ({
            hits: [
              {
                objectID: '1',
                title: 'Claude Code is marking requests',
                url: 'https://thereallo.dev/blog/cc',
                created_at: '2026-10-23T12:00:00Z',
                story_text: '',
              },
              {
                objectID: '2',
                title: 'Old story',
                url: 'https://old.example/x',
                created_at: '2025-01-01T00:00:00Z',
                story_text: '',
              },
            ],
          }),
        }),
      },
      log: () => {},
      ...overrides,
    };
  }

  test('fetchOfficial 解析并按新鲜度门禁过滤', async () => {
    const rows = await newsLayer.fetchOfficial(ctx());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].date, '2026-10-23');
    assert.equal(rows[0].source, 'OpenAI News');
  });

  test('fetchHN 只保留时间窗口内条目，并记录 HN 讨论页', async () => {
    const rows = await newsLayer.fetchHN(ctx());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].url, 'https://thereallo.dev/blog/cc');
    assert.match(rows[0].via, /news\.ycombinator\.com\/item\?id=1/);
  });

  test('单源失败不影响同一层的其它源', async () => {
    const bad = ctx({
      http: {
        text: async () => {
          throw new Error('feed down');
        },
        get: async () => ({ ok: true, json: async () => ({ hits: [] }) }),
      },
    });
    assert.deepEqual(await newsLayer.fetchOfficial(bad), []);
    assert.deepEqual(await newsLayer.fetchHN(bad), []);
  });
});
