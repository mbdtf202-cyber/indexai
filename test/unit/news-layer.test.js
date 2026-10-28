/**
 * news 层（T3.1c4）。
 *
 * 这是第一个读写仓库文件的层，也是唯一一个「有内容 ≠ 新鲜」的层：
 * 归档只增不删，三路源全挂时它照样有几百条。所以 merge 必须同时交出
 * 「合并后的归档」和「本次真正新增了几条」，否则上层会把 stale 记成 fresh（F09）。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const urls = {
  frontline: 'https://example.test/frontline.yaml',
  aihot: 'https://example.test/items',
};

/** 精简版归档合并：按 url 去重、按日期倒序——足以验证层的接线，不重复测 lib/news.js。 */
function mergeArchive(archive, fresh) {
  const byUrl = new Map(archive.map((x) => [x.url, x]));
  for (const item of fresh) {
    if (!item?.url) continue;
    if (!byUrl.has(item.url)) byUrl.set(item.url, item);
  }
  return [...byUrl.values()];
}

function makeCtx(overrides = {}) {
  const logs = [];
  return {
    logs,
    ctx: {
      http: {
        get: async () => ({ ok: true, json: async () => ({ items: [] }) }),
        text: async () => ({ ok: true, text: '' }),
      },
      sleep: async () => {},
      parseYaml: () => [],
      keepSafeUrl: (u) => u,
      readSeed: async () => [],
      mergeArchive,
      today: () => '2026-10-24',
      testProfile: true,
      now: () => new Date('2026-10-24T01:00:00.000Z'),
      parseFeed: () => [],
      urls: { ...urls, hn: 'https://example.test/hn' },
      log: (m, opt) => logs.push({ m, level: opt?.level || 'info' }),
      ...overrides,
    },
  };
}

describe('news 层（T3.1c4）', () => {
  let layer;

  test('加载并按契约导出', async () => {
    layer = (await import('../../pipeline/layers/news/index.js')).default;
    assert.equal(layer.id, 'news');
    assert.ok(layer.sources.length >= 6, `来源数 ${layer.sources.length}`);
  });

  test('单路失败不拖累其它两路', async () => {
    const { ctx, logs } = makeCtx({
      http: {
        text: async () => {
          throw new Error('frontline down');
        },
        get: async () => ({
          ok: true,
          json: async () => ({
            items: [
              { id: 1, title: 'A', publishedAt: '2026-10-24T03:00:00Z', link: 'https://x/1' },
            ],
          }),
        }),
      },
    });
    const raw = await layer.fetch(ctx);
    assert.equal(raw.frontline.length, 0, 'frontline 失败为空');
    assert.equal(raw.bulk.length, 1, 'aihot 仍然有数据');
    assert.ok(
      logs.some((l) => l.level === 'warn'),
      '失败要记 warn',
    );
  });

  test('aihot 条目优先存原始链接，聚合入口单独存 via（F08）', async () => {
    const { ctx } = makeCtx({
      http: {
        text: async () => ({ ok: true, text: '' }),
        get: async () => ({
          ok: true,
          json: async () => ({
            items: [
              {
                id: 'x1',
                title: '原始出处测试',
                publishedAt: '2026-10-24T03:00:00Z',
                links: {
                  aihot: 'https://aihot.news/items/x1',
                  original: 'https://example.com/post/1?utm_source=x',
                },
              },
            ],
          }),
        }),
      },
    });
    const rows = await layer.fetchBulk(ctx);
    assert.equal(rows[0].url, 'https://example.com/post/1?utm_source=x');
    assert.equal(rows[0].via, 'https://aihot.news/items/x1');
  });

  test('三路全空时被判定为「没抓到」（隔离原因清晰）', () => {
    const { records, quarantined } = layer.normalize({ frontline: [], bulk: [], seed: [] });
    assert.equal(records.length, 0);
    assert.equal(quarantined.length, 1);
    assert.match(quarantined[0].reason, /三路/);
  });

  test('全量流的分类映射成 topic', () => {
    const { records } = layer.normalize({
      frontline: [],
      bulk: [{ title: 'x', date: '2026-10-24', cat: 'ai-models' }],
      seed: [],
    });
    assert.equal(records[0].topic, 'model');
  });

  test('精选在前：合并时它的摘要不会被全量流覆盖', () => {
    const { records } = layer.normalize({
      frontline: [{ title: 'a', url: 'https://x/a', summary: '长摘要' }],
      bulk: [{ title: 'a', url: 'https://x/a', summary: '短' }],
      seed: [],
    });
    assert.equal(records[0].summary, '长摘要');
  });

  test('merge 交出合并归档与本次新增数', () => {
    const prev = [{ title: 'old', url: 'https://x/old', date: '2026-10-01' }];
    const { ctx } = makeCtx();
    const merged = layer.merge(
      prev,
      [{ title: 'new', url: 'https://x/new', date: '2026-10-24' }],
      ctx,
    );
    assert.equal(merged.length, 2);
    assert.equal(merged.__freshCount, 1);
  });

  test('三路全挂时 freshCount 为 0，但归档仍在（F09 的关键区分）', () => {
    const prev = [{ title: 'old', url: 'https://x/old' }];
    const { ctx } = makeCtx();
    const merged = layer.merge(prev, [], ctx);
    assert.equal(merged.length, 1, '归档不会因为今天没抓到就清空');
    assert.equal(merged.__freshCount, 0, '但新鲜度必须是 0');
  });

  test('__freshCount 不可枚举：不改变 JSON 形态', () => {
    const { ctx } = makeCtx();
    const merged = layer.merge([], [{ title: 'n', url: 'https://x/n' }], ctx);
    assert.ok(!Object.keys(merged).includes('__freshCount'));
    assert.equal(JSON.parse(JSON.stringify(merged)).__freshCount, undefined);
  });

  test('门禁：归档为空判红', () => {
    const rule = layer.health.rules[0];
    assert.equal(rule.check([]).level, 'red');
    assert.equal(rule.check([{ url: 'x' }]).level, 'ok');
  });
});
