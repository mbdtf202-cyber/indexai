/**
 * 采集编排器（唯一入口）。
 *
 * ## 为什么需要这个文件
 *
 * T3.1 把采集拆成 12 个层对象（`pipeline/layers/<id>/index.js`），每层都是完整实现。
 * 但拆完之后**没有写编排器**：`pipeline/index.mjs` 与 `pipeline/main.mjs` 各自直接调用
 * `fetchers.mjs`，给每层塞进硬编码的空响应（`fetch: () => Promise.resolve({ USDCNY: 7.2 })`、
 * `fetch: async () => ({ devpost: [], luma: [] })` …），然后打印 `{meta:{}}` 就退出。
 *
 * 结果：`npm run collect` 跑一轮什么也不产出，12 个真实层从没被调用过。
 * 逐源实现与判定函数则留在已删除的 `collect.mjs` 里，成了孤儿（见 DIAGNOSIS.md）。
 *
 * 本文件按层契约注入真实依赖，逐层 fetch → normalize → merge → 记账，不做任何空实现。
 * 层失败只影响该层（INV-1），其余层照常发布。
 *
 * ## 层契约
 *
 *   { id, sources, budget, 抓取, 归一, 合并, 门禁 }  —— 四个方法都收 ctx
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as http from '../lib/http.js';
import { nowISO, todayISO } from '../lib/clock.js';
import { effectiveCost, PROFILES } from '../lib/effective-cost.js';
import { FLAGSHIP } from '../lib/relay-pricing.js';
import { unsafeUrlStats, resetUnsafeUrlStats } from '../lib/safe-url.js';
import { eventKind, eventRegion, eventStatus, foldRegions } from '../lib/event-classify.js';
/* 逐源实现与 ctx 的构造都已拆出去：
 *   sources/   —— 每个源怎么抓
 *   context.mjs —— 层需要什么依赖
 * 编排器只留「逐层跑 + 记账 + 写盘」。 */
import * as sources from './sources/index.mjs';
import { buildCtx } from './context.mjs';
import { buildSources } from './sources-registry.mjs';
import { persist } from './persist.mjs';

import fxLayer from './layers/fx/index.js';
import adoptionLayer from './layers/adoption/index.js';
import resourcesLayer from './layers/resources/index.js';
import modelsLayer from './layers/models/index.js';
import benchLayer from './layers/bench/index.js';
import relaysLayer from './layers/relays/index.js';
import subsLayer from './layers/subs/index.js';
import offersLayer from './layers/offers/index.js';
import newsLayer from './layers/news/index.js';
import eventsLayer from './layers/events/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

export const TEST_PROFILE = String(process.env.INDEXAI_PROFILE || '').toLowerCase() === 'test';

/** 输出目录：INDEXAI_OUT_DIR > 测试档位的 fixtures/data > 仓库 .data（生成物，不进仓库）。 */
function resolveOutDir() {
  const explicit = process.env.INDEXAI_OUT_DIR;
  if (explicit) return String(explicit).replace(/\/+$/, '');
  if (TEST_PROFILE) return join(ROOT, 'fixtures', 'data');
  return join(ROOT, '.data');
}

const readJson = async (path) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
};

const readCurated = (name) => readJson(join(ROOT, 'curated', name));

/**
 * 读取上一版完整评测快照（F02）。
 *
 * 必须从 `bench.json` 读，不能从 `data.json`：后者只存目录（`boards` 已拆出去），
 * `prev.bench.boards` 恒为空——这正是「失败沿用上次」在线上从未生效的根因。
 *
 * 缺文件／坏 JSON／缺 boards 一律返回 null（首次运行的合法情况）。
 */
export function readPrevBench(path = join(resolveOutDir(), 'bench.json')) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.boards) return null;
    return parsed;
  } catch {
    return null;
  }
}

/* ─────────────────────────── 层清单 ─────────────────────────── */

/**
 * 顺序即依赖顺序：fx 与 adoption 先跑（中转站报价的人民币折算要汇率、模型页要排名），
 * events 最后（它最慢，且不影响其它层）。
 */
const LAYERS = [
  fxLayer,
  adoptionLayer,
  resourcesLayer,
  modelsLayer,
  benchLayer,
  relaysLayer,
  subsLayer,
  offersLayer,
  newsLayer,
  eventsLayer,
];

/* ─────────────────────────── ctx ─────────────────────────── */

/* ─────────────────────────── 逐层执行 ─────────────────────────── */

/**
 * 跑一层。失败只影响本层（INV-1）。
 */
async function runLayer(layer, ctx, prevRows) {
  const started = Date.now();
  const rec = { layer: layer.id, status: 'ok', n: 0, ms: 0 };

  try {
    const raw = await layer.fetch(ctx);

    let next;
    try {
      next = layer.normalize(raw, ctx);
    } catch (e) {
      throw new Error(`normalize 失败：${e.message}`);
    }

    /* 契约细节：normalize 可能返回 `{records, quarantined}`（多数层），
     * 也可能直接返回数组。merge 一律期望数组，这里统一取出 records。
     * adoption 的 records 是 `{apps}` 对象而非数组——按对象形状原样传下去。 */
    const nextRows = Array.isArray(next)
      ? next
      : next?.records !== undefined &&
          !Array.isArray(next.records) &&
          typeof next.records === 'object'
        ? next.records
        : (next?.records ?? []);

    let merged;
    try {
      merged = layer.merge(prevRows, nextRows, ctx);
    } catch (e) {
      throw new Error(`merge 失败：${e.message}`);
    }

    /* 两种交付形状（层契约允许）：
     *   - 数组：rows 型层（events / models / relays / news …）
     *   - 对象：单值型层（fx 交付 {USDCNY, as_of}）或带 rows 包装的层
     * 用「是不是数组」区分，比猜字段名可靠。 */
    if (Array.isArray(merged)) {
      rec.n = merged.length;
      rec.status = 'ok';
      rec._ms = Date.now() - started;
      return { value: merged, rec };
    }

    if (merged && typeof merged === 'object') {
      const isRowsWrapper = Array.isArray(merged.rows);
      rec.n = isRowsWrapper ? merged.rows.length : Object.keys(merged).length;
      rec.status = merged.stale ? 'stale' : 'ok';
      rec._ms = Date.now() - started;
      return { value: merged, rec };
    }

    /* null / undefined：这一层确实没有产出 */
    rec.n = 0;
    rec.status = 'failed';
    rec.error = 'merge 返回空';
    rec._ms = Date.now() - started;
    return { value: prevRows ?? [], rec };
  } catch (e) {
    rec.status = 'failed';
    rec.error = e.message;
    rec._ms = Date.now() - started;
    ctx.log(`${layer.id} 失败：${e.message}`, { level: 'warn' });
    // 整层失败：沿用上一版（INV-1），标 stale
    return { value: prevRows ?? [], rec };
  }
}

/* ─────────────────────────── 主流程 ─────────────────────────── */

export async function collect({ outDir = resolveOutDir() } = {}) {
  console.log('[collect] 开始');
  resetUnsafeUrlStats();

  const prev = (await readJson(join(outDir, 'data.json'))) || {};

  /* 唯一需要运行期状态的层：events 的 Luma 冷却（S4.4）。 */
  const lumaState = { blocked: false, reason: null, cooldownMs: 0, gaveUp: 0 };
  const state = { luma: lumaState };

  const ctx = await buildCtx(prev, outDir, state);

  const out = { ...prev };
  const collectLog = [];
  /* 页面读 meta.dedupe 的三个计数（去重丢弃 / 无价剔除 / 白嫖合并）。
   * 这些量由层在 merge 时算出，编排器只负责累加，不再自己数一遍。 */
  const dedupe = { aggregator_dropped: 0, unpriced_dropped: 0, offers_merged: 0 };

  for (const layer of LAYERS) {
    const prevRows = prev[layer.id];
    const { value, rec } = await runLayer(layer, ctx, prevRows);

    /* 写回。三种形状（契约允许）：
     *   - 数组：直接写（events / models / relays / news …）
     *   - {rows}: 取 rows（bench）
     *   - 多产物对象：subs 层一次交回 {subs, subsThird, subsRegions}，
     *     页面按这三个顶层键读，所以按字段名摊平写回，而不是塞成 out.subs = {...}。 */
    if (Array.isArray(value)) {
      out[layer.id] = value;
    } else if (value && Array.isArray(value.rows)) {
      out[layer.id] = value.rows;
    } else if (layer.id === 'subs' && value && Array.isArray(value.subs)) {
      out.subs = value.subs;
      out.subsThird = value.subsThird ?? [];
      out.subsRegions = value.subsRegions ?? [];
    } else {
      out[layer.id] = value;
    }
    /* 层的去重账目（models / offers 提供）：页面底部与运行说明读 meta.dedupe。 */
    if (value && !Array.isArray(value)) {
      if (Number.isFinite(value.dropped)) dedupe.aggregator_dropped += value.dropped;
      if (Number.isFinite(value.merged)) dedupe.offers_merged += value.merged;
      if (Number.isFinite(value.unpriced)) dedupe.unpriced_dropped += value.unpriced;
    }
    collectLog.push(rec);
  }

  /* 活动：合并后统一做状态 / 类型 / 地区判定（原 collect.mjs:2410 的职责）。
   * 这一步曾经在拆层时丢失——`events` 层的 normalize 只做合并，不做判定，
   * 于是 T1.8 修的地区与类型逻辑等于没生效。 */
  const eventRows = Array.isArray(out.events) ? out.events : [];
  if (eventRows.length) {
    out.events = foldRegions(
      eventRows.map((e) => {
        const row = { ...e, kind: eventKind(e), region: eventRegion(e) };
        row.status = eventStatus(row);
        // 判定用的三个原始字段到此为止：算完地区即丢（页面不读）
        delete row.countryCode;
        delete row.geoCityFallback;
        delete row.countryName;
        return row;
      }),
    ).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /* 来源登记表：交给独立模块（各层地址的收拢与去重）。 */
  const sourcesList = buildSources(out, out.bench?.sources);

  /* X 一手情报（人工核实）：curated/signals.json。页面读 data.signals。 */
  const signalsCurated = (await readCurated('signals.json')) || [];
  const signals = [
    ...new Map(
      (Array.isArray(signalsCurated) ? signalsCurated : []).map((s) => [s.url, s]),
    ).values(),
  ].sort((a, b) => String(b.date).localeCompare(String(a.date)));

  /* 厂商清单：比价页的下拉与分组都读它（meta.vendors）。 */
  const vendorsList = [...new Set((out.models || []).map((m) => m.vendor).filter(Boolean))].sort();

  /* 官方直连参考价（给 meta.flagships 用）：在本次模型清单里找同名的 direct 行，
   * 找不到就退回 FLAGSHIP 里登记的人核官方价（f.official）。 */
  const directRef = {};
  for (const f of FLAGSHIP) {
    const hit = (out.models || []).find(
      (m) => m.channelKind === 'direct' && f.re.test(String(m.name || '')) && m.input > 0,
    );
    if (hit)
      directRef[f.key] = { input: hit.input, output: hit.output, cache_read: hit.cache_read };
  }

  /* meta（INV-2 / INV-4）：时间、汇率、网络账、Luma 状态、丢弃计数 */
  const lumaBlock = sources.getLumaBlockState();
  out.meta = {
    ...(prev.meta || {}),
    generated_at: nowISO(),
    date: todayISO(),
    brand: 'IndexAI',
    /* 汇率是单值，契约上属于 meta（页面读 meta.fx.USDCNY）。 */
    fx: out.fx ?? prev.meta?.fx ?? null,
    /* 只留确定性字段：耗时 _ms 不进 data.json（INV-7，同一输入必须同一输出）。 */
    collected: collectLog
      .slice()
      .sort((a, b) => (a.layer < b.layer ? -1 : a.layer > b.layer ? 1 : 0))
      .map(({ _ms, ...rest }) => rest),
    net: {
      ...(prev.meta?.net || {}),
      http: http.httpTotals(),
      lumaBlocked: lumaBlock.blocked,
      lumaBlockReason: lumaBlock.reason,
      lumaCooldownMs: lumaBlock.cooldownMs,
      lumaCooldownCapMs: lumaBlock.capMs,
    },
    counts: {
      ...(prev.meta?.counts || {}),
      events: out.events?.length ?? 0,
      models: Array.isArray(out.models) ? out.models.length : 0,
      relays: Array.isArray(out.relays) ? out.relays.length : 0,
      news: Array.isArray(out.news) ? out.news.length : 0,
      resources: Array.isArray(out.resources) ? out.resources.length : 0,
      sources: sourcesList.length,
    },
    dropped: unsafeUrlStats(),
    dedupe,
    vendors: vendorsList,
    /* 旗舰清单（F19）：页面画「官方参考线」只读这份，不再用正则猜官方价。
     * 同时下发按中转画像算出的官方有效成本，避免页面自己算第二遍。 */
    flagships: FLAGSHIP.map((f) => {
      const ref = directRef[f.key] || {};
      const input = ref.input ?? f.official?.[0] ?? null;
      const output = ref.output ?? f.official?.[1] ?? null;
      const officialEff =
        input != null && output != null
          ? effectiveCost({ kind: 'per_1m', input, output }, PROFILES.agent)
          : null;
      return {
        key: f.key,
        label: f.label,
        input,
        output,
        cache_read: ref.cache_read ?? null,
        officialEff: officialEff == null ? null : Number(officialEff.toFixed(4)),
      };
    }),
  };

  delete out.fx;

  out.sources = sourcesList;
  out.signals = signals;

  console.log('[collect] 完成');
  for (const r of collectLog) {
    console.log(
      `  ${r.layer}: ${r.status}${r.error ? ` (${r.error})` : ''} n=${r.n} ${r._ms ?? 0}ms`,
    );
  }

  return out;
}

/* 直接运行时：采集 → 落盘。 */
const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  const outDir = resolveOutDir();
  collect({ outDir })
    .then(async (data) => {
      await persist(outDir, data);
      console.log(`[collect] 写入 ${outDir}/{data,bench,news-archive}.json`);
    })
    .catch((e) => {
      console.error('[collect] 失败：', e.message);
      process.exit(1);
    });
}
