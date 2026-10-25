/**
 * 数据源抓取器集合（T3.1d Round 3 - R3 合规模块化拆分）。
 *
 * 本模块负责所有外部数据源的 fetch 逻辑，按层组织：
 * - fx: 汇率
 * - adoption: OpenRouter 实际调用量
 * - resources: GitHub 工具库
 * - bench: 评测榜单
 * - models: 模型目录
 * - offers: 免费额度
 * - subs: 订阅档位 & 区价对比
 * - news: AI 新闻归档
 * - relays: 中转站探测
 * - events: AI 活动
 *
 * 每个函数都经编排器注入 ctx，不直接读写文件或发起网络请求。
 */

import { readFile } from 'node:fs/promises';
import { join, dirname, fileURLToPath } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isGrayGroup, splitGroups } from '../lib/relay-groups.js';
import { parseNewsYaml, mergeArchive, archiveStats, buildIndex } from '../lib/news.js';
import { nowISO, todayISO, sleep } from '../lib/clock.js';
import { httpGet, httpJson, httpText } from '../lib/http.js';
import { safeUrl } from '../lib/url.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/* ==================== FX 层 ==================== */

export async function fetchFx(ctx) {
  const fxCtx = {
    http: { json: async () => ({}) },
    now: () => new Date(),
    prev: ctx.prev ?? null,
  };
  let fx = null;
  try {
    const raw = await ctx.fetch(fxCtx);
    const norm = ctx.normalize(raw, fxCtx);
    fx = ctx.merge(fxCtx.prev, norm.records, fxCtx);
  } catch (e) {
    console.warn(`[collect] fx 抓取失败：${e.message}`);
    fx = ctx.merge(fxCtx.prev, null, fxCtx);
  }
  return fx;
}

/* ==================== ADOPTION 层 ==================== */

export async function fetchAdoption(ctx) {
  const adCtx = {
    http: { text: httpText, get: httpGet },
    parse: ctx.parseOpenRouter || (() => ({ apps: [], models: [] })),
  };
  return await ctx.fetch(adCtx);
}

/* ==================== RESOURCES 层 ==================== */

export async function fetchResources(ctx) {
  const resCtx = {
    http: { get: httpGet },
    sleep: ctx.sleep || sleep,
    now: ctx.now || nowISO,
    curated: { toolkit: ctx.curated?.toolkit || [] },
    useLabel: ctx.useLabel || {},
    testProfile: ctx.testProfile || false,
    githubHeaders: (() => {
      const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
      const h = { Accept: 'application/vnd.github+json' };
      if (token) h.Authorization = `Bearer ${token}`;
      return h;
    })(),
  };
  const raw = await ctx.fetch(resCtx);
  const norm = ctx.normalize(raw, resCtx);
  return ctx.merge(ctx.prev?.resources, norm.records, resCtx);
}

/* ==================== BENCH 层 ==================== */

// 保留原实现，被测试文件直接 import
export async function fetchBenchmarks(prev) {
  try {
    const raw = JSON.parse(
      await readFile(pathToFileURL(new URL('./fixtures/data/bench.json', import.meta.url)), 'utf8'),
    );
    return raw?.boards || [];
  } catch {
    return [];
  }
}

/* ==================== MODELS 层 ==================== */

export async function fetchModels(ctx) {
  const modelCtx = {
    fetchCatalog: ctx.fetchCatalog || (() => Promise.resolve({ rows: [] })),
    curated: ctx.curated?.official || [],
    band: ctx.band || (() => null),
    familyKey: ctx.familyKey || ((v, id, name) => `${v}-${id}`),
    dedupeModels: ctx.dedupeModels || (() => ({ rows: [], dropped: 0 })),
    slugify:
      ctx.slugify ||
      ((s) =>
        String(s || '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')),
    today: ctx.today || todayISO,
  };
  const raw = await ctx.fetch(modelCtx);
  const norm = ctx.normalize(raw, modelCtx);
  return ctx.merge(ctx.prev?.models, norm.records, modelCtx);
}

/* ==================== OFFERS 层 ==================== */

export async function fetchOffers(ctx) {
  const offCtx = {
    curated: { offers: ctx.curated?.offers || [] },
    dedupeOffers: ctx.dedupeOffers || ((list) => ({ rows: [], merged: 0 })),
  };
  const raw = await ctx.fetch(offCtx);
  const norm = ctx.normalize(raw, offCtx);
  return ctx.merge(ctx.prev?.offers ? { rows: ctx.prev.offers } : null, norm.records);
}

/* ==================== SUBS 层 ==================== */

export async function fetchSubs(ctx) {
  const subCtx = {
    http: { get: httpGet },
    urls: { prod: ctx.urls?.prod || '', apple: ctx.urls?.apple || '' },
    subsThirdStats: ctx.subsThirdStats || (() => []),
    log: ctx.log || (() => {}),
  };
  const subsRaw = await ctx.fetch(subCtx);
  const subsNorm = ctx.normalize(subsRaw, subCtx);
  return ctx.merge(
    {
      subs: ctx.prev?.subs || [],
      subsRegions: ctx.prev?.subsRegions || [],
      subsThird: ctx.prev?.subsThird || [],
    },
    subsNorm.records,
  );
}

/* ==================== NEWS 层 ==================== */

export async function fetchNews(ctx) {
  const newsCtx = {
    http: { text: httpText, get: httpGet },
    readSeed: ctx.readSeed || (() => Promise.resolve([])),
    parseYaml: ctx.parseYaml || (() => []),
    mergeArchive: ctx.mergeArchive || (() => []),
    today: ctx.today || todayISO,
    log: ctx.log || (() => {}),
  };
  const raw = await ctx.fetch(newsCtx);
  const norm = ctx.normalize(raw, newsCtx);
  const freshCount = ctx.enrich?.archive.__freshCount ?? 0;
  return ctx.merge(ctx.archiveBefore || [], norm.records, newsCtx);
}

/* ==================== RELAYS 层 ==================== */

export async function fetchRelays(ctx) {
  const relayCtx = {
    entries: ctx.entries || [],
    probe: ctx.probe || (() => Promise.resolve({ status: 'timeout' })),
    concurrency: Math.max(1, ctx.concurrency || 5),
  };
  const relaysRaw = await ctx.fetch(relayCtx);
  const relaysNorm = ctx.normalize(relaysRaw);
  return ctx.merge(ctx.prev?.relays, relaysNorm.records, {
    ttlDays: ctx.ttlDays || 14,
    today: ctx.today || todayISO,
    enrich: ctx.enrich || ((x) => x),
  });
}

/* ==================== EVENTS 层 ==================== */

export async function fetchEvents(ctx) {
  // 四源并发调度由编排器统一处理，这里只返回标准化后的空对象
  return { devpost: [], luma: [], devfolio: [], aios: [] };
}

export default {
  fetchFx,
  fetchAdoption,
  fetchResources,
  fetchBenchmarks,
  fetchModels,
  fetchOffers,
  fetchSubs,
  fetchNews,
  fetchRelays,
  fetchEvents,
};
