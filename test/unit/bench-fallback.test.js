/**
 * 评测层回退（T1.2 · F02 · S8.6）——用可控的假 LMArena 数据。
 *
 * F02 的根因不是「bench.mjs 没有回退逻辑」：它写了整源失败沿用 prev.boards
 * 并标 stale。问题是送进去的 prev 恒为空——collect 拿 data.json 当基线，
 * 而那里的 bench 只剩目录（boards 已拆进 bench.json）；CI 也只拉了 data.json。
 *
 * 这个文件只测「上一版从哪来、怎么用」，不碰网络：
 * - fetch 由本文件自己接管，按 URL 返回提交在 fixtures/files/ 里的真实 parquet；
 * - 通过 INDEXAI_ARENA_BOARDS 把榜单集合缩到两条真实存在的配置
 *   （text / agent），单用例内即可跑完；
 * - 用 readPrevBench 从一份「数据区」读到上一版，模拟 CI 的真实路径。
 *
 * 采集整条管线由 golden 覆盖（test/golden/collect.test.js），这里不重复。
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SAMPLE = join(ROOT, 'fixtures', 'files', 'lmarena-agent-latest.parquet');

/** 这套工具只用两条配置，都真实存在于 ARENA_BOARDS，且用同一份真实 parquet。 */
const BOARDS = JSON.stringify([
  {
    cfg: 'agent',
    name: 'Agent·总榜',
    group: 'agent',
    note: '多轮工具调用的任务完成率（非 Elo）。',
  },
  {
    cfg: 'agent_bash_reliability',
    name: 'Agent·Bash 可靠性',
    group: 'agent',
    note: '长串 shell 命令不出错的比例。',
  },
]);

/** 按配置返回同一份真实 parquet；用一个开关模拟「整源或单配置故障」。 */
const faults = { all: false, cfgs: new Set() };
const realFetch = globalThis.fetch;

function installFetch() {
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('huggingface.co') && url.endsWith('.parquet')) {
      const match = url.match(/leaderboard-dataset\/resolve\/main\/([^/]+)\//);
      const cfg = match?.[1] ?? '';
      if (faults.all || faults.cfgs.has(cfg)) {
        return new Response('', { status: 503 });
      }
      return new Response(readFileSync(SAMPLE), {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      });
    }
    // 非 HF 的源（SWE-bench / Aider / Vals …）在本用例里一律「暂时不可用」。
    // 不用抛错：抛网络错误会走 bench.mjs 的指数退避重试，8 个源 × 3 次 × 1.2s
    // 会把用例拖到 60 秒。返回 5xx 让它们立刻失败、按 stale 处理。
    return new Response('', { status: 503 });
  };
}

describe('评测回退（F02）', () => {
  let bench;
  let benchModule;

  before(async () => {
    process.env.INDEXAI_ARENA_BOARDS = BOARDS;
    installFetch();
    // 在设置好的环境里再 import，模块顶层的 TEST_PROFILE / 榜单集合才会读到
    benchModule = await import('../../bench.mjs');
  });

  after(() => {
    globalThis.fetch = realFetch;
    delete process.env.INDEXAI_ARENA_BOARDS;
  });

  test('基线：两条配置都能解析出榜', async () => {
    faults.all = false;
    bench = await benchModule.fetchBenchmarks(null);
    const arena = Object.values(bench.boards).filter((b) => b.source === 'arena');
    assert.ok(arena.length > 0, '基线应当拿到 arena 榜');
    assert.ok(
      arena.every((b) => b.rows.length > 0),
      '每个榜都要有行',
    );
  });

  test('整源失败：LMArena 的榜一个不少地沿用，并标 stale', async () => {
    // 自己先采一份健康基线：node:test 的兄弟用例可能并发，不共享外层变量
    faults.all = false;
    const prev = await benchModule.fetchBenchmarks(null);
    const before = Object.values(prev.boards).filter((b) => b.source === 'arena');
    assert.ok(before.length > 0, '基线应当拿到 arena 榜');

    faults.all = true;
    const next = await benchModule.fetchBenchmarks(prev);
    faults.all = false;

    const after = Object.values(next.boards).filter((b) => b.source === 'arena');
    assert.equal(
      after.length,
      before.length,
      `榜从 ${before.length} 掉到 ${after.length}：上一版没被喂进去`,
    );
    assert.ok(
      after.every((b) => b.stale === true),
      '沿用的榜必须标 stale，页面才能说「沿用 N 天」',
    );
    assert.ok(next.stats.stale.includes('arena'), 'stats.stale 要列出 arena');

    // arena 失败不能记成 ok（INV-4：沿用要响）
    const arenaSrc = next.sources.find((s) => s.id === 'arena');
    assert.equal(arenaSrc.ok, false, 'arena 沿用旧榜也必须记 ok:false');
    assert.ok(arenaSrc.error, '要带上失败原因');
    assert.equal(arenaSrc.boards, after.length, 'sources.boards 应等于实际发布的条数');
  });

  test('单配置失败：按 cfg 沿用该配置的旧榜，其它配置照常刷新', async () => {
    faults.all = false;
    const prev = await benchModule.fetchBenchmarks(null);
    faults.cfgs.add('agent');
    const next = await benchModule.fetchBenchmarks(prev);
    faults.cfgs.delete('agent');

    const staleText = Object.values(next.boards).filter((b) => b.cfg === 'agent');
    assert.ok(staleText.length > 0, '失败配置的旧榜必须留下');
    assert.ok(
      staleText.every((b) => b.stale === true),
      '失败配置的榜要标 stale',
    );

    const freshOther = Object.values(next.boards).filter((b) => b.cfg === 'agent_bash_reliability');
    assert.ok(freshOther.length > 0, '没失败的配置照常出榜');
    assert.ok(
      freshOther.every((b) => !b.stale),
      '没失败的配置不该被标 stale',
    );

    const arena = next.sources.find((s) => s.id === 'arena');
    assert.ok(arena, 'arena 源记录必须在');
    assert.ok(
      Array.isArray(arena.partial) && arena.partial.some((m) => m.startsWith('agent:')),
      '要记下失败的配置',
    );
  });

  test('没有上一版时不凭空造榜（首次运行的合法情况）', async () => {
    faults.all = true;
    const next = await benchModule.fetchBenchmarks(null);
    faults.all = false;
    assert.equal(Object.values(next.boards).filter((b) => b.source === 'arena').length, 0);
  });
});

describe('上一版快照要从 bench.json 读（F02 的根因）', () => {
  test('data.json 里的 bench 只有目录，没有 boards', () => {
    const data = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'data', 'data.json'), 'utf8'));
    assert.equal(data.bench.boards, undefined, 'data.json 的 bench 不应含 boards');
    assert.equal(data.bench.file, 'bench.json', 'data.json 应指向 bench.json');
  });

  test('readPrevBench 从 bench.json 读完整快照', async () => {
    const { readPrevBench } = await import('../../collect.mjs');
    const bench = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'data', 'bench.json'), 'utf8'));
    assert.ok(bench.boards, 'fixture 的 bench.json 必须带 boards');

    const loaded = readPrevBench(join(ROOT, 'fixtures', 'data', 'bench.json'));
    assert.ok(loaded, '应当读到上一版');
    assert.ok(Object.keys(loaded.boards).length > 0, '读到的上一版必须有榜');
  });

  test('默认路径读不到时返回 null，不抛错', async () => {
    const { readPrevBench } = await import('../../collect.mjs');
    const dir = mkdtempSync(join(tmpdir(), 'indexai-prevbench-'));
    try {
      assert.equal(readPrevBench(join(dir, 'bench.json')), null, '文件不存在');
      writeFileSync(join(dir, 'bench.json'), '{"boards":'); // 截断的 JSON
      assert.equal(readPrevBench(join(dir, 'bench.json')), null, '坏 JSON');
      writeFileSync(join(dir, 'bench.json'), '{"as_of":"2026-10-24"}'); // 缺 boards
      assert.equal(readPrevBench(join(dir, 'bench.json')), null, '缺 boards');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
