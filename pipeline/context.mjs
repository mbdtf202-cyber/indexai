/**
 * 编排器 ctx 的构造。
 *
 * 层的契约只认 ctx：网络、时钟、人工数据、纯函数、逐源 fetcher 全部经这里注入，
 * 层自己不 import 实现、不读文件、不碰 Date.now()。把「谁提供什么」收在一个文件里，
 * 层失败时才能一眼看出依赖是否齐备。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as http from '../lib/http.js';
import { now, nowISO, todayISO, sleep } from '../lib/clock.js';
import { parseNewsYaml, mergeArchive } from '../lib/news.js';
import { band, familyKey, slugify, peakNote } from '../lib/model-keys.js';
import { keepSafeUrl } from '../lib/safe-url.js';
import { eventKind, eventRegion, eventStatus, foldRegions } from '../lib/event-classify.js';
import { effectiveCost, PROFILES } from '../lib/effective-cost.js';
import { FLAGSHIP } from '../lib/relay-pricing.js';
import { parseOpenRouter } from '../lib/openrouter-rankings.js';
import { dedupeModels, dedupeOffers, subsThirdStats } from './processors.mjs';
import * as sources from './sources/index.mjs';
/** 评测采集的真实实现在根目录 bench.mjs（43 KB 单体，8 个源）。
 * fetchers.mjs 里那个同名函数是读 fixture 的桩，不能用来生产。 */
import { fetchBenchmarks } from '../bench.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const TEST_PROFILE = String(process.env.INDEXAI_PROFILE || '').toLowerCase() === 'test';

const readJson = async (path) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
};

const readCurated = (name) => readJson(join(ROOT, 'curated', name));

/** OpenRouter 模型目录（models 层唯一的网络源）。 */
async function fetchCatalog() {
  const res = await http.httpText('https://openrouter.ai/api/v1/models', { label: 'openrouter' });
  if (!res.ok) throw new Error(`openrouter /models HTTP ${res.status}`);
  const json = JSON.parse(res.text);
  const rows = (json?.data || []).map((m) => ({
    id: m.id,
    name: m.name,
    created: m.created,
    input: m.pricing?.prompt != null ? Number(m.pricing.prompt) * 1e6 : null,
    output: m.pricing?.completion != null ? Number(m.pricing.completion) * 1e6 : null,
    cache_read:
      m.pricing?.input_cache_read != null ? Number(m.pricing.input_cache_read) * 1e6 : null,
    cache_write:
      m.pricing?.input_cache_write != null ? Number(m.pricing.input_cache_write) * 1e6 : null,
    pricing: m.pricing,
  }));
  return { rows, dropped: 0, unpriced: rows.filter((r) => r.input == null).length, stale: false };
}

/** 存档补回的早期条目（可选文件，CI 里没有也不该失败）。 */
async function readSeedRows() {
  const raw = await readJson(join(ROOT, 'news-seed.json'));
  if (!raw) return [];
  return Array.isArray(raw) ? raw : (raw.items ?? []);
}

async function buildCtx(prev, outDir, state) {
  const [officialPrices, offers, relaysCurated, toolkit] = await Promise.all([
    readCurated('official-prices.json'),
    readCurated('offers.json'),
    readCurated('relays.json'),
    readCurated('toolkit.json'),
  ]);

  const githubHeaders = (() => {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
    const h = { Accept: 'application/vnd.github+json' };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  })();

  return {
    /* 网络：唯一出口（R2a）。层按 ctx.http.json/text/get/buffer 调用，
     * 而 lib/http.js 导出顶层函数，这里做命名空间适配。 */
    http: {
      get: (url, opt) => http.httpGet(url, opt),
      text: (url, opt) => http.httpText(url, opt),
      json: (url, opt) => http.httpJson(url, opt),
      buffer: (url, opt) => http.httpBuffer(url, opt),
      stats: () => http.httpStats(),
      totals: () => http.httpTotals(),
    },

    /* 时间：唯一出口（R2b） */
    now,
    nowISO,
    today: todayISO,
    sleep,

    testProfile: TEST_PROFILE,
    log: (msg, opts = {}) => {
      const fn = opts.level === 'warn' ? console.warn : console.log;
      fn(`[collect] ${msg}`);
    },

    prev,
    state,

    /* 人工数据 */
    curated: {
      official: officialPrices?.models || officialPrices || [],
      offers: offers?.offers || offers || [],
      relays: relaysCurated?.relays || relaysCurated || [],
      toolkit: toolkit?.toolkit || toolkit?.tools || toolkit || [],
    },

    /* 纯函数（INV-5：单一来源，层不自带实现） */
    band,
    familyKey,
    slugify,
    peakNote,
    dedupeModels,
    dedupeOffers,
    subsThirdStats,
    keepSafeUrl,
    mergeArchive,
    parseYaml: parseNewsYaml,
    parse: parseOpenRouter,
    eventKind,
    eventRegion,
    eventStatus,
    foldRegions,

    /* 情报归档：读写由编排器注入（层不碰文件系统） */
    archive: {
      read: async () => (await readJson(join(outDir, 'news-archive.json'))) || [],
      write: async (rows) => {
        await mkdir(outDir, { recursive: true });
        await writeFile(join(outDir, 'news-archive.json'), JSON.stringify(rows), 'utf8');
      },
    },
    readSeed: readSeedRows,

    /* 订阅层的中转站报价页 */
    urls: {
      aibijia: 'https://data.aibijia.org/api/pricing',
      frontline: 'https://data.aibijia.org/news-frontline.yaml',
      aihot: 'https://aihot.news/api/v1/items',
      apple: 'https://data.aibijia.org/apple_subscriptions.json',
      prod: 'https://data.aibijia.org/products.json',
    },

    /* events 层的逐源 fetcher（真实请求，见 sources/） */
    fetchDevpost: (...a) => sources.fetchDevpost(...a),
    fetchLuma: (...a) => sources.fetchLuma(...a),
    fetchDevfolio: (...a) => sources.fetchDevfolio(...a),
    fetchAios: (...a) => sources.fetchAios(...a),

    /* relays 层：探测 + 人工名单 */
    entries: TEST_PROFILE
      ? (relaysCurated?.relays || relaysCurated || []).slice(0, 3)
      : relaysCurated?.relays || relaysCurated || [],
    probe: (entry) => sources.probeRelay(entry),
    concurrency: 5,
    ttlDays: 14,
    /* 价格加工：层只管「哪些站要沿用」，eff 与「对官方比」的算法在这里。
     * 它依赖 flagship 清单与有效成本公式，属于编排器侧的知识。 */
    enrich: (base) => {
      const prices = {};
      for (const [k, p] of Object.entries(base.prices || {})) {
        if (!p) continue;
        const row = { ...p };
        if (p.kind === 'per_1m') {
          row.eff = effectiveCost(p, PROFILES.agent);
          const ref = FLAGSHIP.find((f) => f.key === k);
          row.vsOfficial =
            ref && ref.official?.[0] > 0 ? Number((p.input / ref.official[0]).toFixed(3)) : null;
        }
        // 按次计价不参与每百万 token 的比较，只留原值
        prices[k] = row;
      }
      return {
        ...base,
        prices,
        comparable: Object.keys(prices).filter((k) => prices[k].eff != null).length,
        grayGroups: Object.values(prices).reduce((n, p) => n + (p.grayGroups || 0), 0),
      };
    },

    githubHeaders,
    fetchCatalog,
    fetchBenchmarks,
  };
}

export { buildCtx };
