/**
 * resources 层（T3.1c3）。
 *
 * 这是第一个**逐条请求**的层：名单里每个 repo 发一次 GitHub API。
 * 也因此它暴露了其它层没有的两个问题：
 * 1. 部分失败是常态（限流、404、改名），必须逐条沿用上一版，而不是整层失败；
 * 2. 预算要能兜住「名单变长」——这条现在只验证字段存在，实际切流在 T3.3。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const ok = (extra = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({
    description: 'd',
    stargazers_count: 100,
    forks_count: 10,
    pushed_at: '2026-10-01T00:00:00Z',
    license: { spdx_id: 'MIT' },
    archived: false,
    language: 'Go',
    topics: ['a', 'b'],
    html_url: 'https://github.com/x/y',
    ...extra,
  }),
});

function makeCtx(handlers) {
  const calls = [];
  return {
    calls,
    ctx: {
      http: {
        get: async (url, opt) => {
          calls.push(url);
          const repo = url.split('/').pop();
          const h = handlers[repo];
          if (typeof h === 'function') return h();
          if (h) return h;
          throw new Error(`unexpected ${repo}`);
        },
      },
      sleep: async () => {},
      now: () => new Date('2026-10-24T01:00:00.000Z'),
      curated: { toolkit: handlers.list || [] },
      useLabel: { tool: '工具' },
      testProfile: false,
      githubHeaders: { Accept: 'application/vnd.github+json' },
    },
  };
}

describe('resources 层（T3.1c3）', () => {
  let layer;

  test('加载并按契约导出', async () => {
    layer = (await import('../../pipeline/layers/resources/index.js')).default;
    assert.equal(layer.id, 'resources', 'id 必须与既有数据键一致');
    assert.deepEqual(layer.sources, ['api.github.com/repos']);
    assert.ok(layer.budget.requests > 0, '逐条请求的层必须声明请求预算');
  });

  test('成功时把 GitHub 字段铺平', async () => {
    const list = [{ repo: 'x/y', use: 'tool' }];
    const { ctx } = makeCtx({ y: ok(), list });
    const rows = await layer.fetch(ctx);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].stars, 100);
    assert.equal(rows[0].license, 'MIT');
    assert.equal(rows[0].status, 'ok');
  });

  test('单条 404 不中断整层', async () => {
    const list = [{ repo: 'x/gone' }, { repo: 'x/live' }];
    const { ctx } = makeCtx({
      gone: { ok: false, status: 404 },
      live: ok(),
      list,
    });
    const rows = await layer.fetch(ctx);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].status, 'http_404');
    assert.equal(rows[1].status, 'ok');
  });

  test('单条抛错也继续下一条', async () => {
    const list = [{ repo: 'x/boom' }, { repo: 'x/fine' }];
    const { ctx } = makeCtx({
      boom: () => {
        throw new Error('network');
      },
      fine: ok(),
      list,
    });
    const rows = await layer.fetch(ctx);
    assert.equal(rows[0].status, 'error');
    assert.equal(rows[1].status, 'ok');
  });

  test('测试档位只抓前三条', async () => {
    const list = Array.from({ length: 10 }, (_, i) => ({ repo: `x/r${i}` }));
    const handlers = { list, testProfile: true };
    for (let i = 0; i < 10; i += 1) handlers[`r${i}`] = ok();
    const { ctx, calls } = makeCtx(handlers);
    ctx.testProfile = true;
    await layer.fetch(ctx);
    assert.equal(calls.length, 3, `测试档位应只抓 3 条，实际 ${calls.length}`);
  });

  test('normalize 补 useLabel 并隔离缺 repo 的条目', () => {
    const { records, quarantined } = layer.normalize(
      [{ repo: 'x/y', use: 'tool' }, { use: 'tool' }],
      { useLabel: { tool: '工具' } },
    );
    assert.equal(records.length, 1);
    assert.equal(records[0].useLabel, '工具');
    assert.equal(quarantined.length, 1);
  });

  test('逐条沿用：本次失败的条目取上一版已验证的值', () => {
    const prev = [{ repo: 'x/y', stars: 999, status: 'ok', url: 'https://github.com/x/y' }];
    const next = [{ repo: 'x/y', stars: null, status: 'http_403' }];
    const out = layer.merge(prev, next);
    assert.equal(out[0].stars, 999, '应当沿用上一版的星数');
    assert.equal(out[0].stale, true);
    assert.equal(out[0].status, 'ok');
  });

  test('上一版也是失败时不假装有值', () => {
    const prev = [{ repo: 'x/y', status: 'error' }];
    const next = [{ repo: 'x/y', status: 'http_403' }];
    const out = layer.merge(prev, next);
    assert.equal(out[0].status, 'http_403');
    assert.equal(out[0].stale, undefined);
  });

  test('门禁：成功比例过低要告警，全空判红', () => {
    const rule = layer.health.rules[0];
    assert.equal(rule.check([]).level, 'red');
    assert.equal(rule.check([{ status: 'ok' }, { status: 'error' }]).level, 'warn');
    assert.equal(rule.check([{ status: 'ok' }, { status: 'ok' }]).level, 'ok');
  });
});
