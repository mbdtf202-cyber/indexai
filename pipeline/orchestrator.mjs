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

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as http from '../lib/http.js';
import { mark, now, nowISO, since, todayISO } from '../lib/clock.js';
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
import { runLayer } from './budget.mjs';
import { buildSources } from './sources-registry.mjs';
import { vendorOrder } from '../lib/vendors.js';
import { quarantineLayer, summarizeQuarantine } from './validate.mjs';
import { SCHEMAS } from './schemas/index.mjs';
import { gateAndFallback, VERDICT } from './manifest.mjs';
import { buildCounts } from './counts.mjs';
import { persist, resolveOutDir } from './persist.mjs';
import { createHistoryReader, loadPrevious, readPrevBench } from './previous.mjs';

export { readPrevBench };

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
const readJson = async (path) => {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;
  }
};

const readCurated = (name) => readJson(join(ROOT, 'curated', name));

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
/**
 * 层预算（T3.3 · S2.2 · INV-8）。
 *
 * 每层自己声明 `budget: { ms, requests }`。超预算不是「失败」，是 **partial**：
 * 已经拿到的部分照常交付，并在报告里写明为什么没跑完。这两者必须分开——
 * 超时把它当 failed 会丢掉已采到的数据，那是更糟的结果（T1.3 的教训）。
 */
/* ─────────────────────────── 主流程 ─────────────────────────── */

export async function collect({ outDir = resolveOutDir() } = {}) {
  console.log('[collect] 开始');
  resetUnsafeUrlStats();

  /* 上一版（T4.1）：优先 data 分支快照，退回 outDir。 */
  const dataDir = process.env.INDEXAI_DATA_DIR || null;
  const prevPick = await loadPrevious({ layers: LAYERS, outDir, dataDir });
  const prev = prevPick.prev;
  if (prevPick.source === 'data') {
    console.log(`[collect] 上一版来自 data 分支快照（${prevPick.layers} 层）`);
  }

  /* 唯一需要运行期状态的层：events 的 Luma 冷却（S4.4）。 */
  const lumaState = { blocked: false, reason: null, cooldownMs: 0, gaveUp: 0 };
  const state = { luma: lumaState };

  /* 整次运行的硬截止（T3.3 · S2.2）：15 分钟。
   * 超过它，后面的层直接标 partial 跳过，而不是让 job 被 CI 砍掉——
   * 那样连报告都写不出来，等于一无所知。 */
  const RUN_DEADLINE_MS = 15 * 60 * 1000;
  /* 截止时间必须用真实时钟（now()），不能用 mark()：
   * mark() 在回放模式下恒为 0，会让「剩余时间」变成负数，所有层被误判为超时。
   * 而耗时统计（duration_ms）用 mark()/since() 是对的——那里要保持输出确定。 */
  const runStartedWall = now().getTime();
  const runDeadline = runStartedWall + RUN_DEADLINE_MS;
  const runStarted = mark();

  const ctx = await buildCtx(prev, outDir, state);

  const out = { ...prev };
  const collectLog = [];
  /* 页面读 meta.dedupe 的三个计数（去重丢弃 / 无价剔除 / 白嫖合并）。
   * 这些量由层在 merge 时算出，编排器只负责累加，不再自己数一遍。 */
  const dedupe = { aggregator_dropped: 0, unpriced_dropped: 0, offers_merged: 0 };

  /* 每层的隔离明细（T3.5）：进 run-report，页面不读。 */
  /* 该层历史条数（T4.7）：交给 previous.mjs，结果带缓存。 */
  const historyOf = createHistoryReader(dataDir);

  const quarantineReport = {};
  /* 分层门禁结论（T3.7）：进 manifest 与 report。 */
  const gateReport = {};

  for (const layer of LAYERS) {
    const prevRows = prev[layer.id];
    const { value, rec } = await runLayer(layer, ctx, prevRows, runDeadline);

    /* 逐行校验（T3.5）：必须在 merge 之后、写盘之前——沿用的旧数据也过一遍，
     * 坏行不会借「沿用」溜进发布。 */
    const spec = SCHEMAS[layer.id];
    const rowsForCheck = Array.isArray(value)
      ? value
      : Array.isArray(value?.rows)
        ? value.rows
        : Array.isArray(value?.subs)
          ? value.subs
          : null;

    if (spec && rowsForCheck) {
      const q = quarantineLayer(rowsForCheck, spec);
      quarantineReport[layer.id] = summarizeQuarantine(q);

      if (q.total !== q.kept) {
        rec.n = q.kept;
        if (q.overThreshold) {
          rec.status = 'failed';
          rec.error = `隔离 ${q.quarantined.length}/${q.total} 行超过阈值 ${(q.threshold * 100).toFixed(0)}%`;
          ctx.log(`${layer.id} 隔离比例超阈值：${rec.error}`, { level: 'warn' });
        } else {
          ctx.log(`${layer.id} 隔离 ${q.quarantined.length}/${q.total} 行，其余照常发布`, {
            level: 'warn',
          });
        }
      }

      if (Array.isArray(value)) value.splice(0, value.length, ...q.rows);
      else if (Array.isArray(value.rows)) value.rows = q.rows;
      else if (Array.isArray(value.subs)) value.subs = q.rows;
    }

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
    /* 分层门禁（T3.7 · S4.1）：隔离管"行"，门禁管"层"。red 时
     * gateAndFallback 把上一版的行放回 out[layer.id]。 */
    /* 历史计数（T4.7 · S4.1）：从 data 分支的状态日志里取该层最近的成功条数。
     * 没有 dataDir 时给 null，门禁会退回「只看上一版」并在原因里说明。 */
    const g = gateAndFallback({
      layer,
      data: out,
      prev,
      history: historyOf(layer.id),
      asOf: nowISO(),
    });
    gateReport[layer.id] = { verdict: g.verdict, reasons: g.reasons };

    if (g.servedPrev) {
      rec.status = 'stale';
      rec.reason = g.reasons.join('；');
      ctx.log(`${layer.id} 门禁 red，沿用上一版：${rec.reason}`, { level: 'warn' });
    } else if (g.verdict === VERDICT.WARN) {
      rec.warn = g.reasons.join('；');
      ctx.log(`${layer.id} 门禁 warn：${rec.warn}`, { level: 'warn' });
    }
    /* 层的去重账目：页面底部读 meta.dedupe。 */
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
    /* 计数（T5.9 · S9.10）：页面上的每个数字都从产出算，见 pipeline/counts.mjs。 */
    counts: {
      ...(prev.meta?.counts || {}),
      ...buildCounts(out, { now: nowISO(), sources: sourcesList.length }),
    },
    dropped: unsafeUrlStats(),
    dedupe,
    vendors: vendorsList,
    /* 厂商排序（T4.4）：页面按这个顺序排，不再自己维护一份 VENDOR_RANK。 */
    vendorOrder: vendorOrder(),
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

  /* 运行报告（T3.3 · S2.4）：CI 写进 job summary，也作为 artifact 保留。
   * 结构固定，有 contract 测试守着（test/contract/run-report.test.js）。 */
  const runReport = {
    schema: 'run-report/v1',
    started_at: new Date(runStarted).toISOString(),
    finished_at: nowISO(),
    duration_ms: since(runStarted),
    deadline_ms: RUN_DEADLINE_MS,
    over_deadline: now().getTime() > runDeadline,
    profile: TEST_PROFILE ? 'test' : 'full',
    layers: collectLog.map((r) => ({
      id: r.layer,
      status: r.status,
      n: r.n,
      ms: r._ms ?? 0,
      ...(r.error ? { error: r.error } : {}),
      ...(r.reason ? { reason: r.reason } : {}),
    })),
    totals: {
      ok: collectLog.filter((r) => r.status === 'ok').length,
      stale: collectLog.filter((r) => r.status === 'stale').length,
      partial: collectLog.filter((r) => r.status === 'partial').length,
      failed: collectLog.filter((r) => r.status === 'failed').length,
    },
    net: http.httpTotals(),
    /* 隔离明细（T3.5）：哪层隔离了多少行、为什么。页面不读，排障用。 */
    quarantine: quarantineReport,
    /* 每层的门禁结论（T3.7 · S4.1）。 */
    gate: gateReport,
  };

  console.log('[collect] 完成');
  for (const r of collectLog) {
    console.log(
      `  ${r.layer}: ${r.status}${r.error ? ` (${r.error})` : ''} n=${r.n} ${r._ms ?? 0}ms`,
    );
  }

  out.__runReport = runReport;
  return out;
}

/* 直接运行时：采集 → 落盘。 */
const isDirectRun = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  const outDir = resolveOutDir();
  collect({ outDir })
    .then(async (data) => {
      await persist(outDir, data, { dataDir: process.env.INDEXAI_DATA_DIR || null });
      console.log(`[collect] 写入 ${outDir}/{data,bench,news-archive}.json`);
    })
    .catch((e) => {
      console.error('[collect] 失败：', e.message);
      process.exit(1);
    });
}
