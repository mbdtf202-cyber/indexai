#!/usr/bin/env node
/**
 * IndexAI 采集入口：抓取 → 归一 → 去重 → 合并 → 门禁 → 写盘。
 *
 * 每个数据层都走同一套流程（见 makeTracker 与 T.run）：
 * 本次抓取失败且上一版有内容时沿用上一版并记 stale，门禁不通过就不写盘。
 * 层的清单不写在这里——它随任务变化，写在 AGENTS.md 与 IMPLEMENTATION_PLAN.md 里。
 *
 * 网络只走 lib/http.js（超时/重试/限速/记账都在那里），
 * 时间与睡眠只走 lib/clock.js，外链只信 lib/url.js 的 safeUrl。
 *
 * 输出：data.json / bench.json / news-archive.json（站点数据源）
 * 运行：node collect.mjs（CI 每日一次；本地只为排障）
 */

import { writeFile, readFile } from 'node:fs/promises';
import { httpGet, httpJson, httpText, httpTotals } from '../lib/http.js';
import { safeUrl } from '../lib/url.js';
import { effectiveCost as costOf, profileOf } from '../lib/cost.js';
import { subsThirdStats, subsThirdTotal } from '../lib/subs-stats.js';
import fxLayer from '../pipeline/layers/fx/index.js';
import adoptionLayer from '../pipeline/layers/adoption/index.js';
import resourcesLayer from '../pipeline/layers/resources/index.js';
import newsLayer from '../pipeline/layers/news/index.js';
import benchLayer from '../pipeline/layers/bench/index.js';
import subsLayer from '../pipeline/layers/subs/index.js';
import offersLayer from '../pipeline/layers/offers/index.js';
import modelsLayer from '../pipeline/layers/models/index.js';
import relaysLayer from '../pipeline/layers/relays/index.js';
import eventsLayer from '../pipeline/layers/events/index.js';
import { isGrayGroup, splitGroups } from '../lib/relay-groups.js';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * 读 `curated/` 下的人工维护数据（T3.1b · F57）。
 *
 * 这些数据以前是 collect.mjs 里的巨型数组字面量——改一条价格要在两千行里定位，
 * diff 里看不出改了什么，也没法给非程序员编辑。搬成 JSON 后：
 * 改数据只动 `curated/*.json`，改逻辑只动代码，两者在 review 时分开看。
 *
 * 读不到就抛：缺文件是部署错误，不是「这条数据不存在」。
 * @param {string} name 文件名，例如 `official-prices.json`
 * @returns {any[]}
 */
function readCurated(name) {
  const file = fileURLToPath(new URL(`./curated/${name}`, import.meta.url));
  return JSON.parse(readFileSync(file, 'utf8'));
}

import { assertLayers } from './health.mjs';
import { fetchBenchmarks } from './bench.mjs';
import {
  parseNewsYaml, mergeArchive, archiveStats, buildIndex,
} from '../lib/news.js';
import { now, nowISO, todayISO, mark, since, sleep } from '../lib/clock.js';

const OPENROUTER = 'https://openrouter.ai/api/v1/models';
/* ────────────────────────── 运行档位与输出目录 ──────────────────────────
 * INDEXAI_PROFILE=test 缩小迭代集合，让 golden 能在 30 秒内离线跑完；
 * 生产不设该变量，所有取值保持原样。
 * INDEXAI_OUT_DIR 指定输出目录（默认仓库根），golden 用它写到临时目录。 */
const TEST_PROFILE = String(process.env.INDEXAI_PROFILE || '').toLowerCase() === 'test';
const OUT_DIR = process.env.INDEXAI_OUT_DIR ? String(process.env.INDEXAI_OUT_DIR).replace(/\/+$/, '') : null;
const outUrl = (name) =>
  OUT_DIR ? new URL(`file://${OUT_DIR}/${name}`) : new URL(`./${name}`, import.meta.url);

const OUT = outUrl('data.json');
const BENCH_OUT = outUrl('bench.json');

/**
 * 读上一版评测快照（F02）。
 *
 * 为什么不能只用 data.json：那里的 `bench` 只剩目录（catalog / stats / file），
 * `boards` 已经拆进 bench.json。拿它当基线等于 `prev.boards === undefined`，
 * bench.mjs 的「整源失败沿用上次」因此从未生效——任一评测源挂掉，它的榜直接消失。
 *
 * @param {string|URL} [path] 默认读本次输出目录里的 bench.json
 * @returns {object|null} 完整快照；文件不存在或读不懂时返回 null（首次运行的合法情况）
 */
export function readPrevBench(path = BENCH_OUT) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.boards) return null;
    return parsed;
  } catch {
    return null;
  }
}

/* ────────────────────────── 1. 厂商显示名 ────────────────────────── */
const VENDOR = {
  openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', deepseek: 'DeepSeek',
  qwen: 'Alibaba Qwen', 'z-ai': 'Zhipu', moonshotai: 'Moonshot', minimax: 'MiniMax',
  'x-ai': 'xAI', mistralai: 'Mistral', meta: 'Meta', 'meta-llama': 'Meta',
  nvidia: 'NVIDIA', tencent: 'Tencent', bytedance: 'ByteDance', 'bytedance-seed': 'ByteDance',
  baidu: 'Baidu', cohere: 'Cohere', xiaomi: 'Xiaomi', amazon: 'Amazon', ai21: 'AI21',
  liquid: 'Liquid AI', poolside: 'Poolside', stepfun: 'StepFun', inclusionai: 'InclusionAI',
  allenai: 'Allen AI', nousresearch: 'NousResearch', 'arcee-ai': 'Arcee', morph: 'Morph',
  relace: 'Relace', 'nex-agi': 'Nex AGI', sao10k: 'Sao10K', upstage: 'Upstage',
  openrouter: 'OpenRouter', cognitivecomputations: 'Cognitive', 'ibm-granite': 'IBM',
  microsoft: 'Microsoft', meituan: 'Meituan', rekaai: 'Reka', sakana: 'Sakana',
  'prism-ml': 'Prism ML', perceptron: 'Perceptron', 'inference-net': 'Inference.net',
  scaledown: 'ScaleDown', typesafe: 'TypeSafe', reflection: 'Reflection',
  'xingchen-agi': 'Xingchen', 'dots-studio': 'Dots Studio', 'aion-labs': 'Aion Labs',
  'anthracite-org': 'Anthracite', gryphe: 'Gryphe', mancer: 'Mancer', undi95: 'Undi95',
  thedrummer: 'TheDrummer', moondream: 'Moondream', writer: 'Writer', inception: 'Inception',
  elorian: 'Elorian', recursive: 'Recursive', thinkingmachines: 'Thinking Machines',
  unbiased: 'Unbiased', fireworks: 'Fireworks',
};

/* ────────────────────────── 2. 官方直连定价（人工核实层） ──────────────────────────
 * 字段：vendor / model / ctx(千 token) / in / out / cr(缓存读) / cw(缓存写)，
 *      价格单位 USD / 1M tokens；cny 为官方原币数字（若按人民币标价）；
 *      cm = 缓存机制说明；src = 官方定价页；conf = high|med|low
 * 空数组 = 尚未核实，站点会自动降级为仅展示聚合层。
 */
// 人工核校的官方价：见 curated/official-prices.json（T3.1b 外置）。
// 结构化 schema 留给 T3.8；这一步只做搬运，行为一字不变。
const CURATED_OFFICIAL = readCurated('official-prices.json');

/* ────────────────────────── 3. 白嫖渠道（人工核实层） ────────────────────────── */
// 人工核校的免费额度：见 curated/offers.json
const CURATED_OFFERS = readCurated('offers.json');

/* ────────────────────────── 4. 一手情报 ────────────────────────── */
// 一手价格信号：见 curated/signals.json
const SIGNALS = readCurated('signals.json');


/* ────────────────────────── 4. 订阅（官方价） ──────────────────────────
 * 订阅档位一律从 aibijia 的 apple_subscriptions.json 派生（美国区 App Store 明码），
 * 不再手写常量、也不再留硬编码兜底。
 *
 * 历史教训：这里曾经是 `const SUBSCRIPTIONS = []`，而前端照常渲染「官方档位 0」，
 * README 还写着「订阅 10 档」。死数据 + 看不出来的空，比少一层更糟。
 * 现在：派生不出来 → health 直接红线 → 拒绝发布。
 */

/* ────────────────────────── 5. 中转站（自动探测 /api/pricing） ────────────────────────── */
// auto: 该站公开 OneAPI/NewAPI 价目接口，脚本每天自动采；false 的只登记、等人工核价
// 中转站在册名单：见 curated/relays.json
const RELAYS = readCurated('relays.json');

// 用来对比的旗舰模型：key 固定，正则匹配上游命名差异。
// 正则只负责「圈定家族」，变体（-thinking/-high/-low/日期尾巴）由 pickFlagship 剔除。
const FLAGSHIP = [
  { key: 'sonnet55', label: 'Claude Sonnet 5.5', re: /claude[-_ ]?sonnet[-_ ]?5[.\-]?5/i, official: [2, 10] },
  { key: 'opus55', label: 'Claude Opus 5.5', re: /claude[-_ ]?opus[-_ ]?5[.\-]?5/i, official: [4, 20] },
  { key: 'gpt61sol', label: 'GPT-6.1 Sol', re: /gpt[-_ ]?6[.\-]?1[-_ ]?sol/i, official: [2, 10] },
  { key: 'gemini4argon', label: 'Gemini 4 Argon', re: /gemini[-_ ]?4[-_ ]?argon/i, official: [2, 10] },
  // deepseek-flash 与 deepseek-v4-1-flash 是两个不同的模型，
  // 旧正则 /deepseek.*flash/ 会先命中前者（75/150），把正确价（2/8）挤掉。
  { key: 'deepseekflash', label: 'DeepSeek V4.1 Flash', re: /deepseek[-_ ]?v?4[.\-]?1[-_ ]?flash/i, official: [0.1408, 0.5634] },
];

// 有效成本与用量画像只有一份，在 lib/cost.js（INV-5、F36）。
// 这里重新导出，保持既有 import 路径可用（collect/bench 的调用点不用改）。
export { effectiveCost, PROFILES, FORMULA } from '../lib/cost.js';

/* ────────────────────────── helpers ────────────────────────── */
export const per1M = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null; // -1 = 不计价的纯路由产品
  return Number((n * 1e6).toFixed(6));
};
const slugify = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/(^-|-$)/g, '');

/** 同模型归一：去掉厂商前缀、日期尾巴、:free 后缀、变体标记 */
export function familyKey(vendorId, id, name) {
  let base = id.replace(/^[^/]+\//, '').replace(/:free$/, '');
  base = base.replace(/-(?:latest|\d{4}-\d{2}-\d{2}|\d{6}|\d{4})$/, '');
  base = base.replace(/[-_ ]?(preview|exp|experimental|beta|alpha|thinking|reasoning|high|low|mini-beta)$/, '');
  base = base.replace(/\./g, '-');
  if (!base) base = slugify(name || id);
  return `${vendorId}::${base}`;
}

export function band(input, free) {
  if (free) return 'free';
  if (input == null) return 'unknown';
  if (input < 0.25) return 'budget';
  if (input < 1.5) return 'standard';
  return 'premium';
}

/** 峰谷价：OpenRouter 用 overrides 表达分时价，取最小/最大 prompt 价做提示 */
export function peakNote(pricing) {
  const ov = pricing?.overrides;
  if (!Array.isArray(ov) || !ov.length) return null;
  const vals = ov.map((o) => per1M(o.prompt)).filter((n) => n != null);
  const base = per1M(pricing.prompt);
  const all = [base, ...vals].filter((n) => n != null);
  const lo = Math.min(...all), hi = Math.max(...all);
  if (!(hi > lo)) return null;
  const weekend = ov.every((o) => Array.isArray(o.utc_days) && o.utc_days.length && o.created_at == null);
  return {
    label: weekend ? '分时/分日价' : '分时价',
    min: lo,
    max: hi,
    ratio: Number((hi / lo).toFixed(2)),
    note: `同一模型在不同时段/日期标价 $${lo}–$${hi} /1M input`,
  };
}

/* ────────────────────────── OpenRouter 归一 ────────────────────────── */
export function normalizeOpenRouter(payload) {
  const rows = [];
  const seen = new Set();
  let dropped = 0;
  let unpriced = 0;
  for (const m of payload.data || []) {
    if (!m?.id || seen.has(m.id)) { dropped++; continue; }
    const p = m.pricing || {};
    const pin = Number(p.prompt);
    if (!Number.isFinite(pin) || pin < 0) { unpriced++; continue; } // 路由/竞价产品没有挂牌价
    const free = pin === 0 && Number(p.completion) === 0;
    const rawPrefix = m.id.split('/')[0] || 'unknown';
    const vendorId = rawPrefix.replace(/^~/, '');
    const alias = rawPrefix.startsWith('~');
    const row = {
      id: m.id,
      name: (m.name || m.id).replace(/\s*\(free\)$/i, ''),
      vendor: VENDOR[vendorId] || vendorId.replace(/(^|-)([a-z])/g, (_, a, b) => (a ? ' ' : '') + b.toUpperCase()),
      vendorId,
      alias: alias || undefined,
      channel: 'OpenRouter',
      channelKind: 'aggregator',
      ctx: m.context_length || m.top_provider?.context_length || null,
      input: free ? 0 : per1M(p.prompt),
      output: free ? 0 : per1M(p.completion),
      cache_read: per1M(p.input_cache_read),
      cache_write: per1M(p.input_cache_write),
      free,
      band: band(per1M(p.prompt), free),
      family: familyKey(vendorId, m.id, m.name),
      modality: m.architecture?.modality || null,
      created: m.created || null,
      expires: m.expiration_date || null,
      peak: peakNote(p),
      url: `https://openrouter.ai/${m.id}`,
      src: OPENROUTER,
      srcType: 'api',
      conf: 'high',
      cm: p.input_cache_read ? `聚合层标价，命中按 $${per1M(p.input_cache_read)}/1M 计` : '该渠道未公布缓存价',
      note: m.description ? String(m.description).slice(0, 220) : '',
      seen: todayISO(),
    };
    seen.add(m.id);
    rows.push(row);
  }
  return { rows, dropped, unpriced };
}

/* ────────────────────────── 4. 去重 ────────────────────────── */
/**
 * 规则（站点「方法」页同步展示）：
 *  R1 聚合层以 OpenRouter model id 为唯一键，重复 id 丢弃；
 *  R2 官方直连层以 vendor+model 为唯一键，重复保留置信度高者；
 *  R3 两层不合并：channel 是指纹的一部分，只通过 family 关联（不覆盖任何一方价格）；
 *  R4 白嫖渠道以 product 为唯一键，多入口合并进 entries，冲突额度保留官方来源；
 *  R5 情报以 url 为唯一键。
 */
export function dedupeModels(rows) {
  const byKey = new Map();
  let dropped = 0;
  for (const r of rows) {
    const key = r.channelKind === 'aggregator' ? `or::${r.id}` : `off::${r.vendorId}::${r.id}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, r); continue; }
    dropped++;
    const rank = { high: 3, med: 2, low: 1 };
    if ((rank[r.conf] || 0) > (rank[prev.conf] || 0)) byKey.set(key, r);
  }
  return { rows: [...byKey.values()], dropped };
}

export function dedupeOffers(list) {
  const map = new Map();
  let merged = 0;
  for (const o of list) {
    const key = slugify(o.product);
    const prev = map.get(key);
    if (!prev) { map.set(key, { ...o, entries: [...(o.entries || [])] }); continue; }
    merged++;
    const entries = [...new Set([...(prev.entries || []), ...(o.entries || [])])];
    const sources = [...new Set([...(prev.sources || [prev.source]), ...(o.sources || [o.source])].filter(Boolean))];
    const better = (o.conf || '') === 'high' && (prev.conf || '') !== 'high';
    map.set(key, { ...(better ? o : prev), entries, sources });
  }
  return { rows: [...map.values()], merged };
}


/* ────────────────────────── 中转站探测 ──────────────────────────
 * OneAPI / NewAPI 的零售价有两套并存的写法，优先级从高到低：
 *
 * ① billing_expr　表达式计费（NewAPI 新版，实测 183/1308 行使用）
 *      tier("base", p * 2 + c * 10 + cr * 0.1)
 *      p=输入 c=输出 cr=缓存读 cc=缓存写；这是真实挂牌价。
 * ② model_ratio × group_ratio × 2　倍率计费（老版 OneAPI）
 *      到手价 = model_ratio × 分组倍率 × 2
 *      output = 上式 × completion_ratio
 *      缓存读 = 上式 × cache_ratio
 *
 * 踩过的坑（本站最严重的一次）：
 *  - 只采 model_ratio，把它当唯一价格 → 全行业都是同一个常量，页面「所有站一个价」；
 *  - 站点同时给了 billing_expr 和 model_ratio 时优先信 model_ratio → 得到 75/75 这种
 *    与真实价（$2/$10）毫无关系的数，再把它们当「口径?异常」标出来，属于自己造异常；
 *  - 分组倍率跨站差 20–220 倍（Nova 0.0001→2，年华 0.05→11），不采就等于丢弃真实价差。
 */

/** 分组倍率表：OneAPI 顶层 group_ratio 是 {组名: 倍率}，也见过数组形式 */
export function groupRatioTable(j) {
  const raw = j?.group_ratio ?? j?.groupRatio;
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const map = {};
    for (const g of raw) {
      const nm = g?.name ?? g?.group ?? g?.key;
      const v = Number(g?.ratio ?? g?.value);
      if (nm != null && Number.isFinite(v) && v > 0) map[String(nm)] = v;
    }
    return Object.keys(map).length ? map : null;
  }
  if (typeof raw === 'object') {
    const map = {};
    for (const [k, v] of Object.entries(raw)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) map[k] = n;
    }
    return Object.keys(map).length ? map : null;
  }
  return null;
}

/** 该行可用的分组倍率（只看 enable_groups 里列出的） */
export function rowGroups(row, table) {
  const names = Array.isArray(row.enable_groups) ? row.enable_groups.map(String) : [];
  const all = table
    ? names.filter((n) => table[n] != null).map((n) => ({ name: n, ratio: table[n] }))
    : names.map((n) => ({ name: n, ratio: null }));
  const fallback = () => (table && table.default != null ? [{ name: 'default', ratio: table.default }] : [{ name: 'default', ratio: null }]);
  if (!all.length) return fallback();

  /*
   * 代表分组的选择。三种站点命名习惯都要覆盖：
   *  ① 有 default / 自动 / auto   → 直接用（最常见）
   *  ② 组名里写倍率，如「a全模型综合组-1倍率」「纯Azure稳定无审核-0.6倍率」
   *  ③ 只有一堆渠道名          → 取倍率最接近 1 的
   *
   * 绝不能直接取最小值：最便宜的分组往往是「测试」「逆向」「特价」这类
   * 不可靠或功能受限的渠道，拿它做跨站比较等于用别人的地板价充自己的招牌价。
   * 也绝不能按字母序取第一个：GGWK 的 enable_groups 首位是「a全模型综合组」，
   * 但别的站首位可能是「特殊逆向claude」。
   */
  const NAME_RATIO = /[-_]?\s*([\d.]+)\s*(?:倍率|x|×)/i;
  const reliable = (g) => {
    if (g.ratio == null) return false;
    if (/(测试|调试|probation|dummy|演示|free|免费)/i.test(g.name)) return false;
    return true;
  };

  const byDefault = all.filter((g) => /^(default|自动|auto|默认)$/i.test(g.name) && g.ratio != null);
  let rep;
  if (byDefault.length) {
    rep = byDefault[0];
  } else {
    // 组名里的倍率优先于「接近 1」的经验值
    const named = all
      .map((g) => {
        const m = g.name.match(NAME_RATIO);
        const declared = m ? Number(m[1]) : null;
        return { ...g, declared: Number.isFinite(declared) ? declared : null };
      })
      .filter((g) => g.ratio != null);
    const withDeclared = named.filter((g) => g.declared != null);
    const pool = (withDeclared.length ? withDeclared : named).filter(reliable);
    const usable = pool.length ? pool : named;
    usable.sort((a, b) => {
      // 声明倍率离 1 越近越好；没声明的按实际倍率离 1 远近
      const ka = a.declared != null ? Math.abs(Math.log(a.declared)) : Math.abs(Math.log(a.ratio));
      const kb = b.declared != null ? Math.abs(Math.log(b.declared)) : Math.abs(Math.log(b.ratio));
      return ka - kb;
    });
    rep = usable[0] || all[0];
  }

  /* 「最低可达价」排除两类分组（F49 / D3）：
   * 1. 测试/调试类渠道 —— 不是给人用的；
   * 2. 逆向 / 特价 类渠道 —— 破解协议或低于成本的引流价，不代表真实行情。
   *
   * 灰色分组**保留在 count 里**（用户该知道这家有 12 个分组，其中 3 个是灰色的），
   * 但不出现在 lo / hi 与代表价里。页面会显示被排除的数量。 */
  const USABLE_SKIP = /(测试|调试|probation|dummy|演示)/i;
  const usableGroups = all.filter(
    (g) => g.ratio != null && g.ratio > 0 && !USABLE_SKIP.test(g.name) && !isGrayGroup(g.name),
  );
  const lo = usableGroups.length ? usableGroups.reduce((m, g) => (g.ratio < m.ratio ? g : m)) : null;
  const hi = usableGroups.length ? usableGroups.reduce((m, g) => (g.ratio > m.ratio ? g : m)) : null;
  const grayCount = splitGroups(all).grayCount;
  return [{
    ...rep,
    lo: lo?.ratio ?? null, loName: lo?.name ?? null,
    hi: hi?.ratio ?? null, hiName: hi?.name ?? null,
    count: all.length,
    // 被排除的灰色分组数（页面据此显示「另有 N 个灰色分组未计入」）
    grayGroups: grayCount,
  }];
}

/** 从表达式里抠系数：先长后缀再单字母，避免 c 命中 cc / cr 的开头 */
export function exprCoefficients(body) {
  const num = (re) => {
    const m = body.match(re);
    if (!m) return null;
    const v = Number(m[1]);
    return Number.isFinite(v) ? v : null;
  };
  return {
    p: num(/\bp\s*\*\s*([\d.]+)/),
    c: num(/\bc\s*\*\s*([\d.]+)/),
    cr: num(/\bcr\s*\*\s*([\d.]+)/),
    cc: num(/\bcc(?!1h)\s*\*\s*([\d.]+)/) ?? num(/\bcc1h\s*\*\s*([\d.]+)/),
    fixed: num(/fixed\s*\(\s*([\d.]+)\s*\)/),
    secs: num(/\bu\("seconds"\)\s*\*\s*([\d.]+)/),
  };
}

/** 切出所有 tier("name", ...)，括号按深度平衡（表达式里有嵌套三元） */
export function tierBranches(expr) {
  const out = [];
  const re = /tier\s*\(\s*"([^"]+)"\s*,/g;
  let m;
  while ((m = re.exec(expr))) {
    let i = re.lastIndex;
    let depth = 1;
    const start = i;
    for (; i < expr.length && depth > 0; i++) {
      const ch = expr[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    out.push({ name: m[1], body: expr.slice(start, i - 1).trim() });
  }
  return out;
}

const TIER_PRIORITY = ['base', 'standard', 'auto', 'default', 'off_peak', 'peak', 'short', 'none'];

/**
 * 解析 billing_expr。选档 base > standard > 其他，
 * 避免取到 long_context（长上下文档通常直接翻倍）。
 */
export function parseBillingExpr(expr) {
  if (!expr || typeof expr !== 'string') return null;
  const branches = tierBranches(expr);
  if (!branches.length) return null;

  const priced = [];
  for (const b of branches) {
    const co = exprCoefficients(b.body);
    if (co.p == null && co.fixed == null && co.secs == null) continue;
    priced.push({ name: b.name, ...co });
  }
  if (!priced.length) return null;

  const rank = (n) => {
    const i = TIER_PRIORITY.indexOf(String(n).toLowerCase());
    return i < 0 ? 50 : i;
  };
  const sorted = priced.slice().sort((a, b) => rank(a.name) - rank(b.name));
  const main = sorted[0];
  const alt = sorted.find((x) => x !== main && x.p != null);
  const branchesNote = priced.length > 1
    ? priced.map((x) => ({ name: x.name, input: x.p, output: x.c, cacheRead: x.cr }))
    : null;

  if (main.fixed != null) return { kind: 'per_call', usd: Number(main.fixed.toFixed(4)), via: 'expr' };
  if (main.secs != null) return { kind: 'per_unit', unit: 'second', perUnit: Number(main.secs.toFixed(6)), via: 'expr' };
  if (main.p == null) return null;

  return {
    kind: 'per_1m',
    input: Number(main.p.toFixed(4)),
    output: Number((main.c ?? main.p).toFixed(4)),
    ...(main.cr != null ? { cacheRead: Number(main.cr.toFixed(4)) } : {}),
    ...(main.cc != null ? { cacheWrite: Number(main.cc.toFixed(4)) } : {}),
    comp: main.c != null && main.p > 0 ? Number((main.c / main.p).toFixed(4)) : 1,
    tier: main.name,
    via: 'expr',
    ...(branchesNote ? { branches: branchesNote } : {}),
    ...(alt ? { longContext: { name: alt.name, input: alt.p, output: alt.c } } : {}),
  };
}

/**
 * 单价。优先 billing_expr（真实挂牌价），退回 model_ratio 倍率法。
 *
 * 这是本页曾经「所有站一个价」和「11 家 75/75 异常」两个 bug 的正解：
 * 有 billing_expr 的站点，其 model_ratio 是废弃占位字段，
 * 拿它算出来的 $75 与挂牌 $2 毫无关系，必须让表达式优先。
 */
export function relayPrice(row, group) {
  const n = (x) => (x == null || x === '' ? null : Number(x));
  const g = group?.ratio == null ? 1 : group.ratio;

  // ① 表达式计费
  const viaExpr = parseBillingExpr(row.billing_expr);
  if (viaExpr) {
    if (viaExpr.kind !== 'per_1m') return { ...viaExpr, group: group?.name ?? null };
    // 表达式里的系数已是美元价，不再乘分组倍率（分组倍率只作用于 model_ratio 体系）
    return {
      ...viaExpr,
      comp: viaExpr.comp ?? 1,
      group: group?.name ?? null,
      groupKnown: group?.ratio != null,
    };
  }

  // ② 倍率计费
  const perCall = n(row.model_price ?? row.modelPrice);
  if (perCall && perCall > 0) return { kind: 'per_call', usd: Number(perCall.toFixed(4)), group: group?.name ?? null };
  const ratio = n(row.model_ratio ?? row.modelRatio ?? row.ratio);
  if (ratio == null || !Number.isFinite(ratio) || ratio <= 0) return null;
  const comp = n(row.completion_ratio ?? row.completionRatio) || 1;
  const cache = n(row.cache_ratio);
  const out = {
    kind: 'per_1m',
    input: Number((ratio * 2 * g).toFixed(4)),
    output: Number((ratio * comp * 2 * g).toFixed(4)),
    comp: Number(comp.toFixed(4)),
    group: group?.name ?? 'default',
    groupKnown: group?.ratio != null,
    via: 'ratio',
  };
  if (cache != null && Number.isFinite(cache) && cache >= 0) {
    out.cacheRead = Number((ratio * cache * 2 * g).toFixed(4));
    out.cacheRatio = Number(cache.toFixed(4));
  }
  return out;
}

export function parseJsonLoose(text) {
  try { return JSON.parse(text); } catch {}
  try { return JSON.parse(text.split('\n')[0]); } catch {}
  const i = text.indexOf('{');
  if (i < 0) return null;
  try { return JSON.parse(text.slice(i)); } catch { return null; }
}

async function probeRelay(entry) {
  const url = `https://${entry.domain}/api/pricing`;
  try {
    // 部分站 /api/pricing 301 到另一个域（如 aigcbest → api2.aigcbest.top）：
    // 跟随由 lib/http.js 负责，且每一跳都过协议校验（INV-14）。
    const res = await httpGet(url, { timeoutMs: 9000, tries: 2, backoffMs: 300, label: `relay/${entry.domain}` });
    if (!res.ok) return { ...entry, status: `http_${res.status}`, url };
    const text = await res.text();
    const j = parseJsonLoose(text);
    const rows = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
    if (!rows.length) return { ...entry, status: 'no_pricing', url };

    const gTable = groupRatioTable(j);
    const gValues = gTable ? [...new Set(Object.values(gTable))].sort((a, b) => a - b) : [];
    const models = new Set();
    for (const r of rows) { const n = r.model_name || r.modelName || r.id; if (n) models.add(n); }

    const prices = {};
    let flagPicked = [];
    for (const f of FLAGSHIP) {
      const picked = pickFlagship(rows, f, gTable);
      if (!picked) continue;
      const { row, price, candidates, groupCount, grayGroups, tiered, variant, floor } = picked;
      /*
       * 异常判定只标「明显贵到不合常理」的情况。
       *
       * 旧实现用 +1 美元的绝对容差，对便宜模型完全失效：
       * deepseek-flash 官方 $0.14，任何正常加价（$1）都会被判异常，
       * 结果是 9 家全标红——那不是市场异常，是判定公式写错了。
       * 现在改为纯倍率判定，且阈值随价位收紧：便宜模型容许多一点加价
       * （小模型常按最低 $1 起售），贵模型只认 2 倍。
       */
      let anomaly = false;
      if (price.kind === 'per_1m') {
        const inRatio = price.input / f.official[0];
        const outRatio = price.output / f.official[1];
        const cap = f.official[0] < 0.5 ? 8 : 2.5; // 便宜模型：绝对差价主导，放宽
        anomaly = inRatio > cap || outRatio > cap;
      }
      prices[f.key] = {
        ...price,
        model: String(row.model_name || row.modelName || row.id),
        anomaly: !!anomaly,
        variants: candidates,
        groups: groupCount,
        ...(grayGroups ? { grayGroups } : {}),
        ...(floor ? { floor } : {}),
        // 只有变体可选时如实标注，不假装是基础版
        ...(variant ? { variantOnly: true } : {}),
        ...(tiered ? { tiered: true } : {}),
      };
      flagPicked.push(f.key);
    }

    // 样本：按官方价格档位分层抽样，保证旗舰与低价模型都能进样本
    const samples = [];
    const seen = new Set();
    const priced = rows
      .map((r) => {
        const grp = rowGroups(r, gTable)[0];
        const pr = relayPrice(r, grp);
        const nm = String(r.model_name || r.modelName || r.id || '').slice(0, 48);
        return pr && pr.kind === 'per_1m' && nm ? { n: nm, i: pr.input, o: pr.output, c: pr.comp } : null;
      })
      .filter(Boolean)
      // 同价时按模型名排序：否则 samples 顺序随源端返回顺序漂移（INV-7）
      .sort((a, b) => (a.i - b.i) || (a.n < b.n ? -1 : a.n > b.n ? 1 : 0));
    // 从最便宜到最贵等距取，避免「前 40 条全是小模型」
    const step = Math.max(1, Math.floor(priced.length / 40));
    for (let k = 0; k < priced.length && samples.length < 40; k += step) {
      const s = priced[k];
      if (seen.has(s.n)) continue;
      seen.add(s.n);
      samples.push(s);
    }

    return {
      ...entry,
      status: 'ok',
      url,
      resolved: res.url && res.url !== url ? res.url : undefined,
      models: models.size,
      prices,
      samples,
      groups: gTable ? {
        count: Object.keys(gTable).length,
        min: gValues[0],
        max: gValues[gValues.length - 1],
        spread: gValues.length > 1 ? Number((gValues[gValues.length - 1] / gValues[0]).toFixed(1)) : 1,
        names: Object.keys(gTable).slice(0, 40),
      } : null,
      checked_at: todayISO(),
    };
  } catch (e) {
    // 超时由 lib/http.js 统一转换：TimeoutError 直接标 timeout，其余算 unreachable
    const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError' || /超时/.test(e.message || '');
    return { ...entry, status: timedOut ? 'timeout' : 'unreachable', url };
  }
}

/**
 * 在一个站的价目行里挑出「基础版」旗舰，而不是第一个正则命中。
 *
 * 历史问题：
 *  1) rows.find(re) 会命中 claude-opus-5-5-thinking / -high / -low 等变体；
 *  2) /deepseek.*flash/ 会先命中 deepseek-flash（75/150），跳过正确的 deepseek-v4-1-flash（2/8）。
 * 现在：排除变体与日期后缀 → 优先分组 known → 输出/输入比最贴官方 → 价低者。
 */
const VARIANT_RE = /(thinking|reasoning|reasoner|nothink|non-?thinking|high|low|medium|xhigh|max|effort|beta|alpha|preview|experimental|exp|latest|search|online|image|vision|audio|omni|realtime|transcribe|tts|codex|instruct)/i;
const DATED_RE = /-\d{6,8}(?:$|-)/;
/*
 * 免费额度行不是报价，不该参与比价：
 *   deepseek-v4.1-flash-free / :free / -0x 等，价格常是 0 或象征值，
 *   混进来会让「最低价」永远指向免费额度，价差被拉成 100 倍以上。
 */
const FREE_RE = /(?:^|[-_\/:])(free|gratis|trial|试用|公益|福利)(?:$|[-_\/:])|:free$/i;

export function pickFlagship(rows, f, gTable) {
  const named = rows.filter((r) => {
    const nm = String(r.model_name || r.modelName || r.id || '');
    return f.re.test(nm);
  });
  if (!named.length) return null;

  const isVariant = (r) => {
    const nm = String(r.model_name || r.modelName || r.id || '');
    const base = nm.replace(f.re, '').replace(/^[-_.\s]+|[-_.\s]+$/g, '');
    // 只对「名字里比正则多出来的部分」判变体，避免把 claude-sonnet-5-5 本身判成变体
    return VARIANT_RE.test(base) || DATED_RE.test(nm) || FREE_RE.test(nm);
  };

  const scored = [];
  for (const r of named) {
    const groups = rowGroups(r, gTable);
    const g = groups[0];
    const p = relayPrice(r, g);
    if (!p) continue;
    const perCall = p.kind === 'per_call';
    const variant = isVariant(r);
    let score = 0;
    // 基础版压倒一切：宁可显示「按次计价的基础版」，也不要显示变体的单价。
    if (!variant) score += 100;
    if (p.kind === 'per_1m') {
      const wantRatio = f.official[1] / f.official[0];
      const ratioErr = Math.abs(Math.log((p.comp || 1) / wantRatio));
      score -= ratioErr * 18;
      score -= Math.log10(Math.max(p.input, 0.0001)) * 0.6; // 同分时略偏好低价
    }
    if (p.groupKnown) score += 20;
    if (!p.tiered) score += 10;
    if (perCall) score -= 4; // 计费口径不同，排在同名 per_1m 之后
    scored.push({ row: r, price: p, score, variant, groups, tiered: Boolean(p.tiered), perCall });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score || (a.price.input ?? a.price.usd ?? 0) - (b.price.input ?? b.price.usd ?? 0));
  const best = scored[0];

  /*
   * 最低可达价：同一行在「最便宜可用分组」下的单价。
   * 这是用户真正会问的问题（「这家最低能到多少」），但它依赖具体分组
   * （有的组要买会员、有的组只给 Claude Code 用），所以和代表价分开存，
   * 页面上必须标出组名，不能拿它冒充无门槛价格。
   */
  let floor = null;
  const g0 = best.groups[0];
  if (g0 && g0.lo != null && best.price.via === 'ratio' && g0.ratio > 0 && g0.lo !== g0.ratio) {
    const k = g0.lo / g0.ratio;
    floor = {
      input: Number((best.price.input * k).toFixed(4)),
      output: Number((best.price.output * k).toFixed(4)),
      group: g0.loName,
      disc: Number(k.toFixed(3)),
    };
  }

  return {
    row: best.row,
    price: best.price,
    candidates: scored.length,
    groupCount: best.groups.length,
    // 被排除的灰色分组数（逆向 / 特价）：页面要说「另有 N 个未计入」
    grayGroups: best.groups.reduce((n, g) => n + (g.grayGroups || 0), 0),
    tiered: best.tiered,
    variant: best.variant,
    floor,
  };
}



/* ────────────────────────── 6. 汇率 ────────────────────────── */

/** 存档补回的早期条目（可选文件，CI 里没有也不该失败） */
async function readSeed() {
  try {
    const raw = JSON.parse(await readFile(SEED, 'utf8'));
    return Array.isArray(raw) ? raw : raw.items || [];
  } catch {
    return [];
  }
}

/* ────────────────────────── 7. AI 活动 ────────────────────────── */
/* AIOS 活动库：可选层，**只认环境变量** `AIOS_OPPORTUNITIES`。
 *
 * 旧实现带一串写死的候选路径（含带用户名的 Desktop 绝对路径）外加一个
 * 最多扫 400 个目录的递归查找，等于把某台机器的目录结构焊进了采集器：
 * 换机器必定静默丢整层，别人的机器上还要白扫一遍 Desktop（F50）。
 * 现在只认显式环境变量；没设就跳过这一源，并在日志里说清是「没配置」而不是「读失败」。
 * CI 本来就没有这个文件，跳过是正常路径。 */
const AIOS_FILE_ENV = process.env.AIOS_OPPORTUNITIES || null;

/* AIOS 是可选层。探测放到第一次用到时（T0.3），这样 import 本模块不打日志、不读文件。 */
let AIOS_FILE = null;
let AIOS_PROBED = false;
function aiosFile() {
  if (!AIOS_PROBED) {
    AIOS_PROBED = true;
    if (!AIOS_FILE_ENV) {
      console.log('[collect] 未设置 AIOS_OPPORTUNITIES，跳过 AIOS 活动库（可选层）');
      return null;
    }
    try {
      AIOS_FILE = existsSync(AIOS_FILE_ENV) ? AIOS_FILE_ENV : null;
    } catch {
      AIOS_FILE = null;
    }
    if (!AIOS_FILE) {
      console.warn(`[collect] AIOS_OPPORTUNITIES 指向的文件不存在：${AIOS_FILE_ENV}，跳过这一源`);
    } else {
      console.log(`[collect] AIOS 活动库：${AIOS_FILE}`);
    }
  }
  return AIOS_FILE;
}

/* Devpost 的 submission_period_dates 有三种真实写法，旧实现只认第一种，
 * 结果 20/65 个活动日期解析成 null、被标成「未知」，白白丢掉 30% 的数据：
 *   "Oct 05 - Nov 12, 2026"      年月都在后面
 *   "Oct 05 - 27, 2026"          结束月省略（同月）
 *   "Jul 16, 2026 - Jan 15, 2027" 两端各带年份，跨年
 * 统一按「从左到右，缺年份继承上一个」处理，跨年靠月序回退纠正。 */
export function parseDevpostDates(s) {
  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const str = String(s || '');
  const iso = (y, mo, d) => new Date(Date.UTC(y, mo, d)).toISOString().slice(0, 10);

  // 拆出所有 (月份, 日, 年份?) 片段，按出现顺序
  const re = /\b([A-Z][a-z]{2})\.?\s+(\d{1,2})(?:,\s*(\d{4}))?/g;
  const parts = [];
  let m;
  while ((m = re.exec(str))) {
    const mo = MONTHS[m[1]];
    if (mo == null) continue;
    parts.push({ mo, day: Number(m[2]), year: m[3] ? Number(m[3]) : null });
  }
  if (!parts.length) return { start: null, end: null };

  // 末尾单独的年份（"Oct 05 - Nov 12, 2026" 的年份会挂到最后一段上）
  const tail = str.match(/,\s*(\d{4})\s*$/);
  const tailYear = tail ? Number(tail[1]) : null;

  // "Oct 05 - 27, 2026"：只有孤立的日号，结束日继承起点的月
  // 单日活动（"Oct 23, 2026"）走同一个分支但**没有** `-`，旧实现拿不到 bare 就直接
  // return null，把 37 条源里明明带日期的活动判成「未知」。实测 Devpost 192 条里
  // 单日格式就有 37 条，占 19%，一批真实活动因此从 open/upcoming 里消失。
  if (parts.length === 1) {
    const bare = str.match(/-\s*(\d{1,2})(?:,\s*(\d{4}))?\s*$/);
    if (!bare) {
      // 单日活动：start = end = 当天
      const y = parts[0].year ?? tailYear;
      if (y == null) return { start: null, end: null };
      const day = iso(y, parts[0].mo, parts[0].day);
      return { start: day, end: day };
    }
    const y = Number(bare[2]) || parts[0].year || tailYear;
    if (y == null) return { start: null, end: null };
    const a = parts[0];
    return { start: iso(y, a.mo, a.day), end: iso(y, a.mo, Number(bare[1])) };
  }

  const a = { ...parts[0] };
  const b = { ...parts[1] };
  // 年份补全：自身 > 尾随年份 > 另一端
  if (b.year == null) b.year = tailYear ?? a.year;
  if (a.year == null) a.year = b.year ?? tailYear;
  if (a.year == null && b.year == null) return { start: null, end: null };

  // 跨年纠正：起点月晚于终点月且只有终点带年份，说明起点在上一年
  let y1 = a.year;
  const y2 = b.year;
  if (y1 == null) y1 = y2;
  if (y2 != null && a.mo > b.mo && y1 >= y2) y1 = y2 - 1;

  return { start: iso(y1, a.mo, a.day), end: iso(y2 ?? y1, b.mo, b.day) };
}

/* Devpost：**必须按 status 分组全翻**。
 * 实测 2026-10-24：
 *   status[]=open     meta.total_count=59   每页被服务器压到 9 条  → 需 7 页
 *   status[]=upcoming meta.total_count=133  每页 9 条              → 需 15 页
 * 旧实现只拉 open、且只翻 5 页，实收 45 条，另外 133 个未开始的活动一条没进。
 * 现在按 EV_DEVPOST_STATUS 逐个 status 翻到 entries 为空或收满 total_count，
 * 页上限 EV_DEVPOST_MAX_PAGES 兜底防失控（服务器分页行为变了也不会无限翻）。 */
const EV_DEVPOST_STATUS = ['open', 'upcoming'];
const EV_DEVPOST_MAX_PAGES = TEST_PROFILE ? 2 : 40;

async function devpostPage(status, page, attempt = 0) {
  const url = `https://devpost.com/api/hackathons?status[]=${status}&limit=24&page=${page}`;
  try {
    return await httpJson(url, { label: `devpost/${status}/p${page}` });
  } catch (e) {
    // 翻到深页偶发 5xx/超时，退避重试一次，别把整页数据丢掉
    if (attempt < 2) {
      await sleep(400 * (attempt + 1));
      return devpostPage(status, page, attempt + 1);
    }
    throw e;
  }
}

async function fetchDevpost() {
  const all = [];
  const stats = {};
  for (const status of EV_DEVPOST_STATUS) {
    let total = null;
    let got = 0;
    for (let page = 1; page <= EV_DEVPOST_MAX_PAGES; page += 1) {
      let j;
      try {
        j = await devpostPage(status, page);
      } catch (e) {
        console.warn(`[collect] devpost ${status} p${page} 放弃：${e.message}`);
        break;
      }
      if (total == null && Number.isFinite(j?.meta?.total_count)) total = Number(j.meta.total_count);
      const list = j?.hackathons || [];
      if (!list.length) break;
      all.push(...list);
      got += list.length;
      // 收满 total_count 就停；total 缺失时靠 entries 为空自然结束
      if (total != null && got >= total) break;
    }
    stats[status] = { total, got };
  }
  console.log(`[collect] devpost 分状态：${Object.entries(stats).map(([k, v]) => `${k} ${v.got}/${v.total ?? '?'}`).join(' · ')}`);

  const seen = new Set();
  return all
    .filter((h) => { if (!h?.id || seen.has(h.id)) return false; seen.add(h.id); return true; })
    .map((h) => {
      const d = parseDevpostDates(h.submission_period_dates);
      const row = {
        id: `devpost-${h.id}`, title: h.title, url: h.url, dates: h.submission_period_dates,
        start: d.start, end: d.end, location: h.displayed_location?.location || '线上',
        org: h.organization_name || '',
        prize: h.prize_amount ? String(h.prize_amount).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : null,
        regs: h.registrations_count || 0,
        themes: (h.themes || []).map((t) => t.name), source: 'Devpost',
      };
      // 摘要：源里没有正文字段，用「主题 + 奖池 + 报名数」拼一条可读的一句话，前端只展示一行
      row.summary = devpostSummary(row);
      row.status = eventStatus(row);   // 按日期判，不再一律 open
      row.url = keepSafeUrl(row.url, 'event:devpost');
      return row;
    });
}

/* Devpost 的 API 不返回描述正文，能代表“这场活动是什么”的只有 themes / prize / regs。
 * 拼成一句话，长度控制在 280 字符内，跟 Luma 的 summary 字段同形态。 */
function devpostSummary(row) {
  const bits = [];
  if (row.regs) bits.push(`${row.regs.toLocaleString('en-US')} 人已报名`);
  if (row.prize) bits.push(`奖池 ${row.prize}`);
  const th = (row.themes || []).filter(Boolean).slice(0, 4);
  if (th.length) bits.push(th.join(' / '));
  const s = bits.join(' · ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 280) : null;
}

/* Luma 公开发现流：单 query 上限 50 且 has_more 恒为 false，**不是数据只有 50 条，是查询被截断**。
 * 实测 2026-10-24：单个 query 返回 50 条 has_more:false；多关键词并集按 api_id 去重 600+。
 * 旧实现只查 query=AI → 只拿到 50 条里过原始正则的那 43 条，占真实量的 1/10。
 * 现在并发查 EV_LUMA_QUERIES，按 api_id 去重。
 *
 * 另外实测：带空格/中文的 query 会偶发 HTTP 500（LLM、大模型、Machine Learning 都中过），
 * 重试一次即可拿到 50 条 —— 这是源端抖动，不是查询无效，所以必须重试而不是当空结果收下。 */
const EV_LUMA_QUERIES = [
  'AI', 'LLM', 'Agent', 'Agentic', 'Machine Learning', 'Deep Learning', 'Neural Network',
  'OpenAI', 'GPT', 'ChatGPT', 'Claude', 'Anthropic', 'Gemini', 'Copilot', 'Mistral', 'Llama',
  'Stable Diffusion', 'Generative AI', 'RAG', 'AI Startup', 'AI Meetup', 'AI Summit',
  'AI Workshop', 'AI Hackathon', 'AI Tools', 'AI Agents',
  '大模型', '智能体', '人工智能', '机器学习',
];
const EV_LUMA_CONCURRENCY = 8;

/* ── 地理维度：带经纬度返回「该城市周边的 AI 活动」，与不带 geo 的结果**完全不重叠** ──
 * 实测 2026-10-24：同一个 query=AI，无 geo 与 SF geo 的返回集合交集为 0。
 * 也就是说 geo 不是「同一批数据加个坐标」，而是另一条索引 —— 这是最大的一处漏采。
 *
 * region 字段是**兜底**：事件自带 country_code 时以 country_code 为准（见 lumaCountryRegion），
 * 只有 geo 缺失时才用城市坐标所属的 region。城市坐标只是「这次查询问的是哪儿」，
 * 不代表活动真的在那个国家（海外场次也会被周边查询带出来），所以顺序不能反。 */
const EV_LUMA_CITIES = [
  // 北美
  { slug: 'sf',          lat: 37.7749,  lng: -122.4194, region: 'us' },
  { slug: 'nyc',         lat: 40.7128,  lng: -74.0060,  region: 'us' },
  { slug: 'boston',      lat: 42.3601,  lng: -71.0589,  region: 'us' },
  { slug: 'seattle',     lat: 47.6062,  lng: -122.3321, region: 'us' },
  { slug: 'austin',      lat: 30.2672,  lng: -97.7431,  region: 'us' },
  { slug: 'toronto',     lat: 43.6532,  lng: -79.3832,  region: 'ca' },
  { slug: 'vancouver',   lat: 49.2827,  lng: -123.1207, region: 'ca' },
  // 欧洲
  { slug: 'london',      lat: 51.5074,  lng: -0.1278,   region: 'uk' },
  { slug: 'berlin',      lat: 52.5200,  lng: 13.4050,   region: 'eu' },
  { slug: 'paris',       lat: 48.8566,  lng: 2.3522,    region: 'eu' },
  { slug: 'amsterdam',   lat: 52.3676,  lng: 4.9041,    region: 'eu' },
  { slug: 'zurich',      lat: 47.3769,  lng: 8.5417,    region: 'eu' },
  // 亚洲
  { slug: 'tokyo',       lat: 35.6762,  lng: 139.6503,  region: 'jp' },
  { slug: 'seoul',       lat: 37.5665,  lng: 126.9780,  region: 'kr' },
  { slug: 'singapore',   lat: 1.3521,   lng: 103.8198,  region: 'sg' },
  { slug: 'bangalore',   lat: 12.9716,  lng: 77.5946,   region: 'in' },
  { slug: 'beijing',     lat: 39.9042,  lng: 116.4074,  region: 'cn' },
  { slug: 'shanghai',    lat: 31.2304,  lng: 121.4737,  region: 'cn' },
  { slug: 'shenzhen',    lat: 22.5431,  lng: 114.0579,  region: 'cn' },
  { slug: 'hangzhou',    lat: 30.2741,  lng: 120.1551,  region: 'cn' },
  { slug: 'taipei',      lat: 25.0330,  lng: 121.5654,  region: 'cn' },
  { slug: 'hongkong',    lat: 22.3193,  lng: 114.1694,  region: 'cn' },
  // 其他
  { slug: 'dubai',       lat: 25.2048,  lng: 55.2708,   region: 'ae' },
  { slug: 'sydney',      lat: -33.8688, lng: 151.2093,  region: 'au' },
  { slug: 'telaviv',     lat: 32.0853,  lng: 34.7818,   region: 'middle-east' },
  { slug: 'saopaulo',    lat: -23.5505, lng: -46.6333,  region: 'latam' },
  { slug: 'mexicocity',  lat: 19.4326,  lng: -99.1332,  region: 'latam' },
];

/* geo 循环只配这 8 个词：全量 30 个词 × 27 城市 = 810 次请求会被源端封。
 * 8 × 27 = 216 次，加上无 geo 的 30 次 = 246 次，落在 250 的预算内。
 * 选词依据：AI / LLM / Agent 是发现流里覆盖面最广的三个（实测单城各 50 条），
 * OpenAI / hackathon / GenAI 补厂商与活动形态，中文三个词是亚洲城市的主要命中词。 */
const EV_LUMA_GEO_QUERIES = ['AI', 'LLM', 'Agent', 'OpenAI', 'hackathon', '大模型', '人工智能', 'GenAI'];

const EV_LUMA_CITY_BY_SLUG = new Map(EV_LUMA_CITIES.map((c) => [c.slug, c]));

/* 测试档位的有效集合：生产用全量，test 用缩小切片。
 * 切片只影响「跑多少」，不影响「怎么算」，所以 golden 仍能覆盖所有分支。 */
const LUMA_QUERIES = TEST_PROFILE ? EV_LUMA_QUERIES.slice(0, 2) : EV_LUMA_QUERIES;
const LUMA_CITIES = TEST_PROFILE ? EV_LUMA_CITIES.slice(0, 1) : EV_LUMA_CITIES;
const LUMA_GEO_QUERIES = TEST_PROFILE ? EV_LUMA_GEO_QUERIES.slice(0, 2) : EV_LUMA_GEO_QUERIES;

/* country_code → region：**第一优先级**的地区判定依据。
 * 实测 2026-10-24：Luma 的 geo_address_info.country_code 确实有值（'US' / 'JP' / 'IN' / 'HK' …），
 * 比拿 location 字符串跑国家正则准得多 —— 后者在「校园名 / 缩写 / 非拉丁文」上大量漏判，
 * 这正是 region=other 常年 12% 的根因。
 * 值只映射到 region 用的大区码；没列到的国家落 'other'，交给字符串正则兜底。 */
const EV_COUNTRY_REGION = {
  // 大中华区（港澳台按项目既有口径并入 cn，与 EV_REGION_RULES 的中文区一致）
  CN: 'cn', HK: 'cn', TW: 'cn', MO: 'cn',
  JP: 'jp', KR: 'kr', SG: 'sg', IN: 'in',
  // 欧洲
  GB: 'uk',
  DE: 'eu', FR: 'eu', NL: 'eu', CH: 'eu', ES: 'eu', IT: 'eu', PT: 'eu', SE: 'eu',
  FI: 'eu', DK: 'eu', NO: 'eu', PL: 'eu', CZ: 'eu', AT: 'eu', BE: 'eu', IE: 'eu',
  HU: 'eu', RO: 'eu', BG: 'eu', LU: 'eu', EE: 'eu', LV: 'eu', LT: 'eu', GR: 'eu',
  HR: 'eu', SI: 'eu', SK: 'eu', RS: 'eu', UA: 'eu', TR: 'eu',
  // 北美
  US: 'us', CA: 'ca',
  // 中东
  AE: 'ae', IL: 'middle-east', SA: 'middle-east', QA: 'middle-east',
  JO: 'middle-east', LB: 'middle-east', KW: 'middle-east', BH: 'middle-east', OM: 'middle-east',
  // 拉美
  BR: 'latam', MX: 'latam', AR: 'latam', CL: 'latam', CO: 'latam', PE: 'latam',
  UY: 'latam', PY: 'latam', EC: 'latam', CR: 'latam', PA: 'latam',
  // 大洋洲
  AU: 'au', NZ: 'au',
  // 非洲
  NG: 'africa', KE: 'africa', ZA: 'africa', EG: 'africa', GH: 'africa', MA: 'africa',
  TN: 'africa', UG: 'africa', TZ: 'africa', RW: 'africa', ET: 'africa',
  // 东南亚 / 南亚其余
  PH: 'asia', ID: 'asia', VN: 'asia', TH: 'asia', MY: 'asia', LK: 'asia',
  NP: 'asia', BD: 'asia', KH: 'asia', MM: 'asia', PK: 'asia',
};

/** 国家码 → region，未知国家返回 null（交给正则兜底，不瞎猜） */
export function regionFromCountryCode(cc) {
  if (!cc) return null;
  return EV_COUNTRY_REGION[String(cc).trim().toUpperCase()] || null;
}

/* 英文国名 → region：给 Devfolio 这类只给国名、不给 ISO 码的源用。
 * 用 ^...$ 全匹配，避免 "India" 被 "Indiana" 之类的城市名误命中。 */
const EV_COUNTRY_NAME_RULES = [
  ['us', /^(United States|United States of America|USA|US)$/i],
  ['uk', /^(United Kingdom|UK|England|Scotland|Wales|Northern Ireland|Great Britain)$/i],
  ['cn', /^(China|Hong Kong|Macao|Macau|Taiwan)$/i],
  ['jp', /^Japan$/i], ['kr', /^(South Korea|Korea)$/i], ['sg', /^Singapore$/i],
  ['in', /^India$/i], ['ca', /^Canada$/i], ['au', /^(Australia|New Zealand)$/i],
  ['ae', /^(United Arab Emirates|UAE)$/i],
  ['eu', /^(Germany|France|Netherlands|Switzerland|Spain|Italy|Portugal|Sweden|Finland|Denmark|Norway|Poland|Czechia|Czech Republic|Austria|Belgium|Ireland|Hungary|Romania|Bulgaria|Luxembourg|Estonia|Latvia|Lithuania|Greece|Croatia|Slovenia|Slovakia|Serbia|Ukraine|Turkey|Türkiye)$/i],
  ['middle-east', /^(Israel|Saudi Arabia|Qatar|Jordan|Lebanon|Kuwait|Bahrain|Oman)$/i],
  ['latam', /^(Brazil|Mexico|Argentina|Chile|Colombia|Peru|Uruguay|Paraguay|Ecuador|Costa Rica|Panama)$/i],
  ['africa', /^(Nigeria|Kenya|South Africa|Egypt|Ghana|Morocco|Tunisia|Uganda|Tanzania|Rwanda|Ethiopia)$/i],
  ['asia', /^(Philippines|Indonesia|Vietnam|Thailand|Malaysia|Sri Lanka|Nepal|Bangladesh|Cambodia|Myanmar|Pakistan)$/i],
];

/* 限速：这里是**实测**出来的硬约束，不是拍脑袋。
 * 2026-10-24 实测：
 *   - 并发 8 + 80ms 节流 → 216 个 geo job 里 167 个失败（403/429）
 *   - 封禁是**有状态**的：封后单请求间隔 400ms / 1500ms 仍 429
 *   - 解封曲线：+30s 429 · +60s 429 · +120s 429 · **+180s 才 200**
 *   - 顺序 + 间隔 900ms → 连发 12 个全 200；1500ms 同样 12/12
 * 所以：geo 走**单线程顺序队列**，每请求间隔 EV_LUMA_GAP_MS，命中 429 就指数退避到
 * EV_LUMA_COOLDOWN_MS 再继续。并发在这里不是优化，是自杀 —— 跟 Eventbrite 是同一形态。 */
const EV_LUMA_GAP_MS = 900;
const EV_LUMA_COOLDOWN_MS = 180000;   // 实测封禁约 3 分钟才解
const EV_LUMA_MAX_RETRY = 3;

/* geo 循环的总预算：宁可少采几个城市，也不能让整次 collect 挂在网络里。
 * 正常跑满 216 次 × 900ms ≈ 195s；预留一倍余量。一旦撞到多次 429 把冷却叠起来，
 * 超预算就中断剩余城市、用已有结果继续，并把「未采完」如实记进 meta.collect 的 note。
 * 这里不抛错 —— 抛错会让 T.run 走 stale 丢掉本次已采到的新城市数据，那是更糟的结果。 */
const EV_LUMA_GEO_BUDGET_MS = 480000;   // 8 分钟

/* 请求计数器与限速观测点。
 * 验收要报「总请求数」，逐次累加而不是事后估算。
 * blocked/最长冷却单独记账：这个源是**有状态封禁**，哪天它把阈值调紧，
 * 我们要能从 meta.collect 里立刻看出来，而不是等条数掉了再回头排查。 */
/* 单主机冷却总上限（F04、S2.3）。
 * 实测封禁约 3 分钟解封；但旧逻辑按 attempt 递增（180s→360s→540s→720s），
 * 一次请求就能睡掉 12 分钟，比整层的 8 分钟预算还长——最后睡完还不重试，纯浪费。
 * 现在：本次运行累计冷却一旦会超过这个上限，就不再睡、直接标受阻返回，
 * 让「已采到的部分」照常发布，并把原因写进 meta.net。 */
const EV_LUMA_COOLDOWN_CAP_MS = 6 * 60 * 1000;   // 6 分钟

const netStat = { requests: 0, blocked: 0, maxCooldownMs: 0 };

/* 被丢弃的不安全外链计数（F46 / INV-14）。
 * normalize 阶段就把非 http(s) 的地址丢掉，而不是留到页面再挡——
 * 下游去重键、情报归档都拿 url 当主键，脏 url 会污染这些不变量。 */
const unsafeUrl = { dropped: 0, samples: [] };

/** 过一遍外链白名单。不安全时记一次并返回 null，调用方据此丢掉整行。 */
function keepSafeUrl(u, where) {
  const ok = safeUrl(u);
  if (ok) return ok;
  unsafeUrl.dropped += 1;
  if (unsafeUrl.samples.length < 5) unsafeUrl.samples.push({ where, url: String(u ?? '').slice(0, 120) });
  return null;
}

/* 本次运行的 Luma 受阻状态。受阻后不再发起新请求：这个源是有状态封禁，
 * 继续试探只会把解封时间往后推（实测 +180s 才 200）。 */
const lumaState = { blocked: false, reason: null, cooldownMs: 0, gaveUp: 0 };

/** 供测试与 meta 读取的受阻快照。 */
export function getLumaBlockState() {
  return {
    blocked: lumaState.blocked,
    reason: lumaState.reason,
    cooldownMs: lumaState.cooldownMs,
    requests: netStat.requests,
    gaveUp: lumaState.gaveUp,
    capMs: EV_LUMA_COOLDOWN_CAP_MS,
    geoBudgetMs: EV_LUMA_GEO_BUDGET_MS,
  };
}

/** 重置 Luma 的限速状态（测试用；生产一次运行只走一遍）。 */
export function resetLumaState() {
  lumaState.blocked = false;
  lumaState.reason = null;
  lumaState.cooldownMs = 0;
  lumaState.gaveUp = 0;
  netStat.requests = 0;
  netStat.blocked = 0;
  netStat.maxCooldownMs = 0;
}

const lumaSleep = (ms) => sleep(ms);

/** 本次 geo 循环的起点。lumaGet 判断「冷却后会不会越过预算」要用它。 */
let geoStart = 0;

/** 统一出口：计数 + 429 冷却。返回 entries 数组。
 *  @param {object} opt { gap } 请求前是否等一个间隔（geo 队列用，无 geo 的并发池不用） */
async function lumaGet(q, geo, opt = {}) {
  const gap = opt.gap ?? 0;
  let params = `limit=50&query=${encodeURIComponent(q)}`;
  if (geo) params += `&latitude=${geo.lat}&longitude=${geo.lng}`;
  const url = `https://api.lu.ma/discover/get-paginated-events?${params}`;

  if (lumaState.blocked) return [];

  for (let attempt = 0; attempt <= EV_LUMA_MAX_RETRY; attempt += 1) {
    if (gap) await lumaSleep(gap);           // 请求前睡，保证任意两次之间都有间隔
    try {
      netStat.requests += 1;
      // tries: 1：429 的退避由本函数按 Luma 的实测冷却曲线处理，
      // 客户端再自动重试只会把封禁时间往后推（见上方限速注释）。
      const res = await httpGet(url, { tries: 1, deadline: geoStart ? geoStart + EV_LUMA_GEO_BUDGET_MS : undefined, label: `luma/${q}` });
      if (res.status === 429 || res.status === 403) {
        // 429/403 是封禁信号，不是「这个查询没结果」。冷却后重试，不能当空数组吃下去。
        netStat.blocked += 1;
        const wait = EV_LUMA_COOLDOWN_MS * (attempt + 1);

        // 冷却必须先过两道闸（F04、INV-8）：
        // - 本次运行的累计冷却不能超过单主机上限；
        // - 冷却完也不能越过 geo 预算（预算是给整层的，不是给单请求的）。
        // 任一不满足就停手，把「部分结果 + 受阻原因」交回上层，而不是继续睡。
        const overCap = lumaState.cooldownMs + wait > EV_LUMA_COOLDOWN_CAP_MS;
        const overBudget = since(geoStart) + wait > EV_LUMA_GEO_BUDGET_MS;
        if (overCap || overBudget) {
          lumaState.blocked = true;
          lumaState.reason = overCap
            ? `单主机冷却已达上限（${Math.round(lumaState.cooldownMs / 1000)}s + ${Math.round(wait / 1000)}s > ${EV_LUMA_COOLDOWN_CAP_MS / 1000}s）`
            : `再冷却 ${Math.round(wait / 1000)}s 会越过 geo 预算`;
          console.warn(`[collect] luma ${res.status}，停止采集：${lumaState.reason}`);
          return [];
        }

        lumaState.cooldownMs += wait;
        if (wait > netStat.maxCooldownMs) netStat.maxCooldownMs = wait;
        console.warn(`[collect] luma ${res.status}（${geo ? geo.slug : '无geo'} / ${q}），冷却 ${Math.round(wait / 1000)}s 后第 ${attempt + 1} 次重试`);
        await lumaSleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      return j.entries || [];
    } catch (e) {
      if (attempt >= EV_LUMA_MAX_RETRY) {
        lumaState.gaveUp += 1;
        console.warn(`[collect] luma query "${q}"${geo ? `@${geo.slug}` : ''} 放弃：${e.message}`);
        return [];
      }
      // 5xx / 网络抖动：短退避，别升级成长冷却（501 是源端抖动，不是封禁）
      await lumaSleep(350 * (attempt + 1));
    }
  }
  return [];
}

/** Luma 层（导出供 T1.3 的限速用例直接调用）。 */
export async function fetchLuma() {
  try {
    const byId = new Map();
    let failedQueries = 0;
    let cursor = 0;

    // 小并发池：一口气发 30 个请求容易被源端 5xx，8 路足够快也不会自我限流
    const worker = async () => {
      while (cursor < LUMA_QUERIES.length) {
        if (lumaState.blocked) return;
        const q = LUMA_QUERIES[cursor++];
        const entries = await lumaGet(q);
        if (!entries.length) failedQueries += 1;
        for (const entry of entries) {
          const ev = entry?.event || entry;
          const id = ev?.api_id;
          if (!id || !ev?.url || byId.has(id)) continue;
          byId.set(id, ev);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(EV_LUMA_CONCURRENCY, LUMA_QUERIES.length) }, worker));
    const noGeoCount = byId.size;

    /* ── 地理维度：顺序队列 + 间隔 + 总预算 ──
     * 为什么不是并发 8：实测并发会把源端打成有状态封禁（见 EV_LUMA_GAP_MS 上方注释）。
     * 顺序 + 900ms 间隔实测稳定 200，代价是 216 × 0.9 ≈ 195s。
     * 这个站每天只跑一次，3 分钟可以接受；封禁后再解要 3 分钟且期间全部城市失败，更亏。 */
    geoStart = mark();
    const citiesDone = [];
    const citiesSkipped = [];
    let geoHits = 0;
    let aborted = false;

    for (const city of LUMA_CITIES) {
      if (aborted) { citiesSkipped.push(city.slug); continue; }
      let cityNew = 0;
      for (const q of LUMA_GEO_QUERIES) {
        // 两道刹车：预算用超了，或者源已经把我们挡住了（受阻后继续请求只会延长封禁）
        if (since(geoStart) > EV_LUMA_GEO_BUDGET_MS) { aborted = true; break; }
        if (lumaState.blocked) { aborted = true; break; }
        const entries = await lumaGet(q, city, { gap: EV_LUMA_GAP_MS });
        for (const entry of entries) {
          const ev = entry?.event || entry;
          const id = ev?.api_id;
          if (!id || !ev?.url || byId.has(id)) continue;
          // 记住这条是从哪个城市问出来的：geo 缺失时用它兜底 region。
          // 挂一个非持久字段，下游建 row 时用掉后就不再带走。
          ev.__geoCity = city.slug;
          byId.set(id, ev);
          cityNew += 1;
        }
      }
      if (aborted) { citiesSkipped.push(city.slug); break; }
      citiesDone.push(city.slug);
      geoHits += cityNew;
      if (cityNew) console.log(`[collect] luma geo ${city.slug} +${cityNew}（累计 ${byId.size}）`);
    }
    const geoMs = since(geoStart);
    const stopNote = lumaState.blocked ? ` · 受阻停止：${lumaState.reason}` : '';
    console.log(`[collect] luma geo ${citiesDone.length}/${LUMA_CITIES.length} 城完成 · 新增 ${geoHits} 条 · 耗时 ${(geoMs / 1000).toFixed(0)}s${citiesSkipped.length ? ` · 未采完 ${citiesSkipped.length} 城` : ''}${stopNote}`);

    // 关键词本身已经是 AI 相关，这里只做一次轻过滤把明显无关的挡掉：命中任一 AI 词即收。
    //
    // 实测复盘（2026-10-24，并集 1099 条）：旧正则漏掉 570 条，其中真实 AI 活动约 52 条，
    // 最直接的两个 bug：
    //   1) `\bAI\b` 匹配不到 `OpenAI` —— `N` 到 `A` 之间不是词边界。而 OpenAI Student
    //      Collective / OpenAI DevDay / OpenAI Forum 是大批量真实活动，一个词表漏一项就是几十条。
    //   2) 厂商名、模型名、AI 工程语义（devday / devfest / vibe coding / inference / eval）全不在词表。
    //
    // 另一条实测结论：**calendar 名在这批数据里全是空的**（454 条里 org 有值的 0 条），
    // 所以「用主办方兜底识别」在当前源上不成立；识别只能靠 title + 地址。
    // 泛词（machine / human / club / brunch / deep alone）一律不进词表 ——
    // "Machine Cinema" / "Paramount Machine Tour" / "Deep Chats" / "Sunday Brunch" 是纯噪音，
    // 被筛掉是对的。宁可少收，不要污染。
    const re = AI_EVENT_RE;
    const out = [];
    for (const ev of byId.values()) {
      const name = ev.name || '';
      const cal = ev.calendar?.name || '';
      const addressText = [ev.geo_address_info?.city, ev.geo_address_info?.country, ev.geo_address_info?.address]
        .filter(Boolean).join(' ');
      // calendar 名照旧参与匹配（现在为空，但源一旦补上就能自动生效）
      const hay = `${name} ${cal} ${addressText}`;
      if (!re.test(hay)) continue;
      const start = String(ev.start_at || '').slice(0, 10);
      const geo = ev.geo_address_info || {};
      const cityFallback = ev.__geoCity ? EV_LUMA_CITY_BY_SLUG.get(ev.__geoCity) : null;
      const row = {
        id: `luma-${ev.api_id}`, title: name, url: `https://luma.com/${ev.url}`,
        dates: start, start, end: String(ev.end_at || '').slice(0, 10),
        // 城市 + 国家都留着：eventRegion 要按国家判，只存城市名会让东京/首尔的场次落 other
        location: ev.location_type === 'online'
          ? '线上'
          : [geo.city || geo.region, geo.country].filter(Boolean).join(', ') || '线下',
        org: ev.calendar?.name || 'Luma', prize: null, regs: ev.guest_count || 0,
        themes: [], source: 'Luma',
        // region 的两个权威来源，按可信度排：country_code 直接来自源，最准；
        // 城市兜底只在「源没给国家」时用，且必须明确标出来，方便事后核查。
        countryCode: geo.country_code || null,
        geoCityFallback: (!geo.country_code && cityFallback) ? cityFallback.region : null,
      };
      // 发现流条目**不含 description/summary 字段**（2026-10-24 实测：event 对象里
      // 没有 description、description_mirror，/event/get 详情接口对发现流的 api_id 返回 400）。
      // 所以没有正文可截，summary 置 null，前端遇到 null 就不渲染那一行，别造假数据。
      row.summary = null;
      row.status = eventStatus(row);   // 按日期判
      out.push(row);
    }
    console.log(`[collect] luma 无geo ${LUMA_QUERIES.length} 词 → ${noGeoCount} 条 · 加 geo ${LUMA_CITIES.length} 城 → 去重 ${byId.size} 条 → AI 过滤后 ${out.length} 条${failedQueries ? `（${failedQueries} 个查询无结果）` : ''}`);
    return out;
  } catch (e) {
    console.error(`[collect] luma 失败：${e.message}`);
    return [];
  }
}

/* ══════════════════════ Devfolio（第 4 个活动源） ══════════════════════
 * 公开 API，无认证、无 key、无 Cookie：
 *   https://api.devfolio.co/api/hackathons?page=N&limit=50
 * 返回 { result: [...], count: 2038, pages: 41 }，第 42 页起为空（实测 2026-10-24）。
 *
 * 取舍：这个源历史 2038 条，但**未截止的只有 35 条，其中 AI 相关 9 条**。
 * 量小，但它是唯一一个给出「完整字段 + 真实奖池金额 + 报名人数」的黑客松源，
 * 而且这 9 条在 Devpost / Luma 上都没有 —— 所以作为**补充源**收下，不追求量。
 *
 * 注意 themes 是**对象数组** `[{uuid,name,verified}]`，直接 join 会得到 "[object Object]"，
 * 必须从 t.name 取（实测踩过）。
 *
 * 过滤：**绝不能放宽**。这个源的主体是通用黑客松（No Restrictions 主题占绝大多数），
 * 不做 AI 过滤会往站里灌几百条无关活动，比少收 9 条糟得多。宁可少收。
 * ═══════════════════════════════════════════════════════════════════════ */
const DV_API = 'https://api.devfolio.co/api/hackathons';
const DV_MAX_PAGES = TEST_PROFILE ? 2 : 45;      // 实测 41 页到底，留 4 页余量防源端多一页时漏
const DV_LIMIT = 50;

async function devfolioPage(page, attempt = 0) {
  const url = `${DV_API}?page=${page}&limit=${DV_LIMIT}`;
  try {
    netStat.requests += 1;
    return await httpJson(url, { label: `devfolio/p${page}` });
  } catch (e) {
    if (attempt < 2) {
      await sleep(400 * (attempt + 1));
      return devfolioPage(page, attempt + 1);
    }
    throw e;
  }
}

/* 活动 AI 相关性词表：Luma 与 Devfolio 共用同一份，避免两个源口径漂移。
 * 词表的取舍说明见下方 fetchLuma 内的原始注释（哪些泛词被刻意排除）。 */
export const AI_EVENT_RE = new RegExp([
    // 通用 AI 词
    '\\bAI\\b', '\\bA\\.I\\.', '\\bLLMs?\\b', '\\bGPT-?\\d?', '\\bChatGPT\\b', '\\bClaude\\b',
    '\\bGemini\\b', '\\bCopilot\\b', '\\bLlama\\b', '\\bLLaMA\\b', '\\bMistral\\b', '\\bGemma\\b',
    '\\bSora\\b', '\\bQwen\\b', '\\bKimi\\b', '\\bDeepSeek\\b', '\\bMidjourney\\b', '\\bRunway\\b',
    // 厂商 / 平台
    '\\bOpenAI\\b', '\\bAnthropic\\b', '\\bDeepMind\\b', 'Hugging ?Face', '\\bCohere\\b',
    '\\bPerplexity\\b', '\\bStability AI\\b', '\\bNvidia\\b', '\\bNVIDIA\\b',
    // 中文
    '模型', '人工智能', '机器学习', '大模型', '智能体', '通义', '豆包', '文心', '生成式',
    // 英文 ML 语义
    'machine learning', 'deep learning', 'neural\\s?(?:net|network)', 'generative',
    'stable diffusion', '\\bdiffusion\\b', '\\bRAG\\b', '\\bagentic\\b', '\\bAI agents?\\b',
    '\\binference\\b', '\\bfine-?tun', '\\bprompt(?:ing|s)?\\b', '\\bvector (?:db|database)\\b',
    '\\bembeddings?\\b', '\\bLLM\\b', '\\btransformer model',
    // 活动形态（AI 场次常用的命名）
    'hackathon', '黑客松', 'ハッカソン', 'ハック', '\\bdevday\\b', '\\bdev ?day\\b', '\\bdevfest\\b',
    '\\bhacksprint\\b', '\\bhack ?sprint\\b', '\\bbuild night\\b', '\\bvibe cod',
    // 注意：单独的 eval / showcase / agents 太宽（"Showcase" 是什么展都会用的词），
    // 只在跟 AI 词同现时才有意义，所以这里都收窄成组合形态
    '\\bmodel eval', '\\bAI showcase',
    // 多语言 AI 词根（日/意/西/德/法）
    '生成AI', 'AI 活用', 'intelligen\\w*', 'artificiali', 'inteligencia', '\\bIA\\b', '\\bKI\\b',
    'künstliche', '\\bIA génér', '\\bML\\b',
  ].join('|'), 'i');

/* Devfolio 的 AI 相关判定。两路任一命中即算：
 *   1) themes 里明确列了 AI / 数据 / 机器学习主题
 *   2) name / tagline / desc 命中 **Devfolio 专用**的 AI 词表（见下）
 *
 * 为什么不能直接复用 AI_EVENT_RE（踩过）：
 * 那份词表里含 'hackathon' / '黑客松' / 'devfest' 这类「活动形态词」——
 * 对 Luma 是对的（那些查询本身就是 query=AI 调的，活动形态词只是收窄用），
 * 但 Devfolio 里 95% 的活动名字里就带 Hackathon，一命中就全收进来。
 * 实测直接复用 → 35 条未截止几乎全过（25 条），全是印度高校通用黑客松，站内被污染。
 * 所以这里只认**语义上的 AI 词**，不认活动形态词。
 *
 * 刻意**不接受** "No Restrictions" —— 那是「不限主题」，不代表跟 AI 有关。
 * 实测这就是 35 条里只剩 9 条的关键。 */
const DV_AI_THEME = /\bAI\b|\bA\.?I\.?\b|machine ?learning|deep ?learning|\bML\b|\bLLM|data ?science|neural|generative|computer vision|\bNLP\b/i;

// Devfolio 专用的 AI 语义词表：只有真正的 AI 词，没有任何活动形态词
const DV_AI_RE = new RegExp([
  '\\bAI\\b', '\\bA\\.I\\.', '\\bLLMs?\\b', '\\bGPT-?\\d?', '\\bChatGPT\\b', '\\bClaude\\b',
  '\\bGemini\\b', '\\bCopilot\\b', '\\bLlama\\b', '\\bMistral\\b', '\\bGemma\\b', '\\bQwen\\b',
  '\\bDeepSeek\\b', '\\bMidjourney\\b', '\\bOpenAI\\b', '\\bAnthropic\\b', '\\bDeepMind\\b',
  'Hugging ?Face', '\\bCohere\\b', '\\bPerplexity\\b', '\\bStability AI\\b',
  'machine learning', 'deep learning', 'neural\\s?(?:net|network)', '\\bgenerative ai\\b',
  'stable diffusion', '\\bdiffusion model', '\\bRAG\\b', '\\bagentic\\b',
  '\\bcomputer vision\\b', '\\bNLP\\b', '\\bML\\b', '\\bGenAI\\b',
  '人工智能', '机器学习', '大模型', '智能体', '深度学习',
].join('|'), 'i');

export function devfolioIsAI(h) {
  const themes = (h.themes || []).map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean);
  if (themes.some((t) => DV_AI_THEME.test(t))) return true;
  // desc 只看前 600 字：Devfolio 的 desc 是完整 markdown 规则书，
  // 通篇可能多处提到 AI 是泛泛而谈；截断后命中更接近「这场活动的主旨」。
  const hay = `${h.name || ''} ${h.tagline || ''} ${String(h.desc || '').slice(0, 600)}`;
  return DV_AI_RE.test(hay);
}

/* 奖池：prizes 是对象数组，每项有 currency + amount + name。
 * 不同货币不能直接相加，所以只取「最常见的那一种货币」求和，其余额度不参与，
 * 并在有多个币种时拼一句提示 —— 不把 ₹ 和 $ 加成一个假数字。 */
export function devfolioPrize(prizes) {
  const rows = (prizes || [])
    .map((p) => ({ amount: Number(p?.amount), currency: (p?.currency || '').toUpperCase() || null }))
    .filter((p) => Number.isFinite(p.amount) && p.amount > 0);
  if (!rows.length) return null;
  const byCur = {};
  for (const r of rows) { const k = r.currency || '?'; byCur[k] = (byCur[k] || 0) + r.amount; }
  const [cur, sum] = Object.entries(byCur).sort((a, b) => b[1] - a[1])[0];
  const symbol = { USD: '$', INR: '₹', EUR: '€', GBP: '£' }[cur] || '';
  const n = Math.round(sum).toLocaleString('en-US');
  const others = Object.keys(byCur).length - 1;
  return `${symbol}${n}${cur && cur !== '?' && !symbol ? ` ${cur}` : ''}${others > 0 ? ` 等 ${others + 1} 种币种` : ''}`;
}

async function fetchDevfolio() {
  const today = todayISO();
  const all = [];
  let total = null;
  let pagesHint = null;

  for (let page = 1; page <= DV_MAX_PAGES; page += 1) {
    let j;
    try {
      j = await devfolioPage(page);
    } catch (e) {
      console.warn(`[collect] devfolio p${page} 放弃：${e.message}`);
      break;
    }
    if (total == null && Number.isFinite(j?.count)) total = Number(j.count);
    if (pagesHint == null && Number.isFinite(j?.pages)) pagesHint = Number(j.pages);
    const list = j?.result || [];
    if (!list.length) break;                       // 实测第 42 页到底
    all.push(...list);
    if (pagesHint != null && page >= pagesHint) break;
  }

  // 去重（uuid），并丢掉已截止的：这个源 2038 条里 2003 条是历史活动，收进来只会污染
  const seen = new Set();
  const live = [];
  for (const h of all) {
    const k = h?.uuid || h?.slug;
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const end = String(h.ends_at || '').slice(0, 10);
    const start = String(h.starts_at || '').slice(0, 10);
    // 没有截止日的不猜（跟 eventStatus 的 unknown 口径一致），也不收
    const last = end || start;
    if (!last || last < today) continue;
    live.push(h);
  }

  const ai = live.filter(devfolioIsAI);
  const rows = ai.map((h) => {
    const start = String(h.starts_at || '').slice(0, 10);
    const end = String(h.ends_at || '').slice(0, 10);
    const cityCountry = [h.city, h.country].filter(Boolean).join(', ');
    const row = {
      id: `devfolio-${h.uuid || h.slug}`,
      title: h.name || '',
      url: h.slug ? `https://${h.slug}.devfolio.co/` : null,
      dates: [start, end].filter(Boolean).join(' → ') || null,
      start: start || null,
      end: end || null,
      location: h.is_online ? '线上' : (h.location || cityCountry || '线下'),
      org: h.hackathon_brand?.name || '',
      prize: devfolioPrize(h.prizes),
      regs: Number(h.participants_count || 0),
      themes: (h.themes || []).map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean),
      source: 'Devfolio',
      // country 是英文国名（"India" / "Germany"），交给 eventRegion 的国名正则；
      // 这里不塞两位码 —— Devfolio 给的是国名不是 ISO 码，硬凑容易错。
      countryName: h.country || null,
    };
    const tag = String(h.tagline || '').replace(/\s+/g, ' ').trim();
    row.summary = tag ? tag.slice(0, 280) : null;
    row.status = eventStatus(row);
    row.url = keepSafeUrl(row.url, 'event:devfolio');
    return row;
  });

  console.log(`[collect] devfolio ${all.length} 条历史（共 ${total ?? '?'}）→ 未截止 ${live.length} → AI 相关 ${rows.length}`);
  return rows;
}

/* ══════════════════ 已实测排除的活动源（别再试了） ══════════════════
 * 这些都是 2026-10-24 实际跑过、有明确失败原因的，写在这里免得后来人重复踩：
 *
 * - Eventbrite：结构其实最好（列表页内嵌 jsonld ItemList，每页 20 个完整 Event 对象，
 *   日期/地点/票价全齐），但 **429 限速极严，且是长效封禁**：连续请求后退避 20 秒仍 429。
 *   不适合每日自动采集。若将来要用，必须降到极低频（单城市单次）并接受随时被挡。
 * - 活动行 huodongxing：列表页有真实中文 AI 活动（实测「大模型安全与备案政策宣讲会」），
 *   但**列表页不含日期字段**，日期只在详情页 —— 要 N 条就 N 次详情请求，成本高且易被封。
 *   结论：除非找到带日期的接口，否则不做（原来这里挂过一条无编号待办，已按 R5 清掉）。
 * - OpenAI 官网活动页：403（Cloudflare 拦截无头请求）。
 * - Kaggle /api/v1/competitions/list：401，需要账号认证 —— 与项目「不注册账号」的边界冲突。
 * - MLH：302 重定向到一个已失效的页面。
 * - dev.events：有干净的 iCal，但实测 AI 相关度只有 2/30，价值太低不值得占一层。
 * - mlcontests.com：RSS 里只有 1 条博客，根本不是活动清单。
 * - HuggingFace /api/events：401。
 * - meetup.com GraphQL：`keywordSearch` 字段已不存在（schema 变更），旧查询直接报错。
 * ═══════════════════════════════════════════════════════════════════ */


/* 活动类型与地区：从标题 / 主题 / 场地推断，前端用来做细分筛选 */
/* 活动状态：只由日期决定，不由数据源决定。
 * 以前 Devpost 一律硬编码 status:'open'，导致 25 个已经过了截止日的活动还挂在「开放中」，
 * 用户点进去发现早结束了——数字看着对、语义是错的，最伤信任。
 * 规则（按优先级）：
 *   past     —— end 已过（没有 end 就用 start）
 *   upcoming —— start 在未来
 *   open     —— 正在进行中
 *   unknown  —— 两个日期都没有，无法判断，宁可标未知也不假装开放 */
export function eventStatus(e, today = todayISO()) {
  const start = e.start || '';
  const end = e.end || '';
  const last = end || start;
  if (last && last < today) return 'past';
  if (!start && !end) return 'unknown';
  if (start && start > today) return 'upcoming';
  return 'open';
}

/* 活动类型：从标题 / 主题 / 场地 / 主办推断。
 * 规则按「越具体越先判」排，先命中先归类；都不命中才落 other（兜底，不追求 0）。
 *
 * 实测复盘（2026-10-24，620 条）：旧逻辑把 126 个 Devpost 活动打成 other，占 20%，
 * 原因是 Devpost 的活动名不用 hackathon 这个字，而是 Hacks / HackSprint / -Thon /
 * Datathon / Databowl / Design Jam…，主题里又写着 "Machine Learning/AI"。
 * 这里补上这些真实写法（都是线上数据里实际出现过的后缀，不是猜的）。 */
export function eventKind(e) {
  const b = `${e.title || ''} ${(e.themes || []).join(' ')} ${e.dates || ''} ${e.org || ''} ${e.kindHint || ''}`;

  // 竞赛 / 黑客松：hack day、hackweek、-thon、datathon、data bowl、jam、挑战赛都算
  // 注意 "-thon" 要写成带连字符或词尾，否则会误吃 marathon/marathon-like 的词
  if (/hackathon|hack ?day|hackweek|hack ?week|hacks?\b|hacksprint|hack ?sprint|黑客松|challenge|datathon|data ?bowl|\bjam\b|competition|contest|竞赛|大赛|挑战赛|kaggle|sprint|\bthon\b|-thon\b|\bchip\b hack/i.test(b)) return 'hackathon';
  // 大展会 / 峰会 / 大会
  // F11：con\b 曾经吃掉 "Silicon Valley Con..."；英文 forum 把 OpenAI Forum 系列判成会议。
  // 会议只认真正的会议词，中文「论坛」保留（它确实是会议）。
  if (/summit|conference|convention|symposium|大会|峰会|论坛|expo|展会|博览|world congress|tech week|conference week/i.test(b)) return 'conference';
  // 奖项 / 评选
  if (/award|prize|评选|颁奖|film festival/i.test(b)) return 'award';
  // 工作坊 / 课程 / 训练营
  if (/workshop|工作坊|training|tutorial|bootcamp|训练营|课程|讲座|seminar|masterclass|course|lesson|lab session|study group|paper club|reading group|class\b/i.test(b)) return 'workshop';
  // 演示日 / 路演 / 展会型
  if (/demo ?day|roadshow|路演|showcase|pitch ?day|pitch night|launch day|exhibition|开放日|open day|design jam/i.test(b)) return 'demo';
  // 聚会 / 社区场 / networking
  if (/meetup|聚会|community|salon|drinks|networking|night|party|talk|session|panel|roundtable|dinner|coffee|brunch|happy hour|gathering|沙龙|圆桌/i.test(b)) return 'meetup';
  // Luma 以社区活动为主，没命中关键词的按 meetup 归
  if (e.source === 'Luma') return 'meetup';
  // Devpost 上的活动几乎都是提交型开发活动：有提交期、有奖池、有报名数，
  // 名字起得再随意（"Build With AI: Basics" / "Life After Code"）也仍然是 hackathon 性质。
  // 这个兜底只对 Devpost 生效，别的源不乱套。
  if (e.source === 'Devpost') return 'hackathon';
  /* Devfolio 同理：它的 API 里 type 字段固定是 'HACKATHON'，整个站就是黑客松平台。
   * 但名字常常不带 hackathon（"Unbuilt" / "AgentVerse" / "Cognition 2026"），
   * 主题又常是 "No Restrictions"，上面几条规则都命中不了 —— 实测 13 条里 7 条落 other。
   * 那是**源性质**决定的，不是推断失灵，所以给它跟 Devpost 同样的兜底。 */
  if (e.source === 'Devfolio') return 'hackathon';
  return 'other';
}

/* 地区：location + org + 标题联合判断。
 * 旧实现只看 location，而 Luma 的 location 之前只存了城市名（不带国家），
 * Devpost 常常只给学校名（"University of Florida"），结果大量真实地区被吞成 other。
 *
 * 实测复盘（2026-10-24）：other 140 条里 80 条是 Devpost 的**校园/场馆名**，
 * 名字里没有国家但校名本身就说明国家（McMaster=加拿大、NC State=美国）。
 * 所以这里除了城市/国家，还认大学与州的缩写 —— 都是线上数据里实际出现过的。
 * 仍然保留 other 兜底：Luma 有 44 条 geo 完全空着（location 只有「线下」），
 * 那是源缺数据，不猜。 */
const EV_REGION_RULES = [
  // 中文区（含港澳台）
  ['cn', /中国|上海|北京|深圳|杭州|广州|成都|南京|武汉|西安|苏州|厦门|重庆|天津|香港|澳门|台北|台灣|台湾|\bChina\b|Shanghai|Beijing|Shenzhen|Hangzhou|Guangzhou|Chengdu|Nanjing|\bWuhan\b|\bXiamen\b|Suzhou|Chongqing|Tianjin|Hong ?Kong|Macau|Macao|Taipei|Taiwan/i],
  ['jp', /日本|东京|東京|大阪|京都|名古屋|福冈|札幌|横滨|\bJapan\b|Tokyo|Shibuya|Chiyoda|Minato|Meguro|Osaka|Kyoto|Nagoya|Fukuoka|Sapporo|Yokohama/i],
  ['kr', /韩国|韓國|首尔|首爾|서울|부산|Seoul|Korea|Busan/i],
  ['sg', /新加坡|Singapore|Singapur/i],
  // F10：Islamabad/Pakistan 搬到 asia 那一档（国家码表里 PK→asia，正则不能再跟它打架）
  ['in', /印度|班加罗尔|孟买|新德里|海得拉巴|浦那|金奈|科钦|\bIndia\b|\bBangalore\b|\bBengaluru\b|\bMumbai\b|New Delhi|\bDelhi\b|\bHyderabad\b|\bPune\b|\bChennai\b|\bKochi\b|Coimbatore|Tamil ?Nadu/i],
  ['ae', /迪拜|杜拜|阿布扎比|阿聯酋|阿联酋|\bDubai\b|Abu Dhabi|\bUAE\b|United Arab Emirates/i],
  ['uk', /英国|英國|伦敦|倫敦|曼彻斯特|爱丁堡|牛津|剑桥|\bUK\b|\bU\.K\.|United Kingdom|England|London|Manchester|Edinburgh|Cambridge|Oxford|Bristol|Glasgow/i],
  // 欧洲（含实测出现的小国：匈牙利/罗马尼亚/保加利亚/卢森堡/土耳其）
  ['eu', /欧洲|歐盟|德国|法国|荷兰|西班牙|意大利|葡萄牙|瑞典|芬兰|丹麦|挪威|瑞士|波兰|捷克|奥地利|比利时|爱尔兰|匈牙利|罗马尼亚|保加利亚|卢森堡|土耳其|柏林|巴黎|阿姆斯特丹|慕尼黑|巴塞罗那|米兰|斯德哥尔摩|赫尔辛基|苏黎世|维也纳|布达佩斯|布加勒斯特|索菲亚|Europe|Germany|Berlin|Munich|France|Paris|Netherlands|Amsterdam|Spain|Barcelona|Madrid|Italy|Milan|Portugal|Lisbon|Sweden|Stockholm|Finland|Helsinki|Turku|Denmark|Copenhagen|Norway|Oslo|Switzerland|Zurich|Poland|Warsaw|Czech|Prague|Austria|Vienna|Belgium|Brussels|Ireland|Dublin|Hungary|Budapest|Romania|Bucure[sș]ti|Bulgaria|\bSofia\b,|Sofia, Bulgaria|Luxembourg|T[uü]rkiye|Turkey|Istanbul|Volkshochschule/i],
  // F10：补上省名。Ontario 里有 "Rio"，以前会被 latam 的 Rio 先吃掉，判成巴西。
  ['ca', /加拿大|多伦多|溫哥華|温哥华|蒙特利尔|渥太华|滑铁卢|卡尔加里|温莎|\bCanada\b|\bToronto\b|\bVancouver\b|\bMontreal\b|\bOttawa\b|\bWaterloo\b|\bCalgary\b|\bWindsor\b|Manitoba|McMaster|Sheridan|Hazel McCallion|Bayview Yards|\bOntario\b|\bQuebec\b|Qu[eé]bec|British Columbia|\bAlberta\b|\bKitchener\b|\bMississauga\b|\bHamilton\b|\bVictoria\b, BC/i],
  ['au', /澳大利亚|澳洲|悉尼|墨爾本|墨尔本|布里斯班|珀斯|\bAustralia\b|Sydney|Melbourne|Brisbane|Perth|Wellington|New Zealand|Auckland/i],
  // 美国：城市 + 州名/缩写 + 实测出现的高校与园区
  ['us', /美国|美國|纽约|紐約|旧金山|舊金山|西雅图|西雅圖|硅谷|洛杉矶|芝加哥|奥斯汀|波士顿|圣地亚哥|华盛顿|迈阿密|丹佛|亚特兰大|匹兹堡|费城|休斯顿|达拉斯|凤凰城|波特兰|纳什维尔|夏洛特|底特律|辛辛那提|坦帕|奥兰多|拉斯维加斯|罗利|安娜堡|盖恩斯维尔|沃斯堡|明尼阿波利斯|圣路易斯|堪萨斯城|盐湖城|圣安东尼奥|哥伦布|印第安纳波利斯|密尔沃基|布法罗|罗切斯特|纽黑文|纽瓦克|泽西城|长滩|奥克兰|萨克拉门托|弗雷斯诺|图森|阿尔伯克基|俄克拉荷马城|塔尔萨|孟菲斯|新奥尔良|伯明翰|杰克逊维尔|塔拉哈西|诺克斯维尔|路易斯维尔|列克星敦|代顿|托莱多|阿克伦|兰辛|麦迪逊|林肯|奥马哈|得梅因|普罗维登斯|哈特福德|波特兰缅因|\bUS\b|\bUSA\b|United States|New York|San Francisco|San Jose|Seattle|Silicon Valley|Los Angeles|Chicago|Austin|Boston|San Diego|Washington|Miami|Denver|Atlanta|Pittsburgh|Philadelphia|Houston|Dallas|Phoenix|Portland|Nashville|Charlotte|Detroit|Cincinnati|Tampa|Orlando|Las Vegas|Raleigh|Ann Arbor|Gainesville|Fort Worth|Arlington|Plano|Irving|Frisco|Minneapolis|St\.? Louis|Kansas City|Salt Lake|San Antonio|Columbus|Indianapolis|Milwaukee|Buffalo|Rochester|New Haven|Newark|Jersey City|Long Beach|Oakland|Sacramento|Fresno|Tucson|Albuquerque|Oklahoma City|Tulsa|Memphis|New Orleans|Birmingham|Jacksonville|Tallahassee|Knoxville|Louisville|Lexington|Dayton|Toledo|Akron|Lansing|Madison|Lincoln|Omaha|Des Moines|Providence|Hartford|Stanford|Berkeley|Cal Hacks|MIT|Harvard|CMU|Cornell|Princeton|Yale|Columbia University|NYU|UCLA|UC Berkeley|UC Riverside|UC San Diego|University of California|UCF|UGA|UNC|NC State|Penn State|Pennovation|Purdue|Georgia Tech|Michigan State|Central Michigan|MSU|Ohio State|Rutgers|Columbia|Northwestern|\bIllinois\b|Texas A&M|Texas A＆M|A&M|UT Dallas|UT Austin|University of Florida|Florida State|Virginia Tech|West Virginia|WPI|RPI|SJSU|San Jose State|Cal Poly|Arizona State|ASU|Embry-Riddle|Kent State|Binghamton|Towson|Lehman|GSU|Georgia State|Baylor|Rice University|Duke|Vanderbilt|Clemson|Auburn|Alabama|Oklahoma|Kansas|Nebraska|Iowa|Minnesota|Wisconsin|Indiana|Missouri|Tennessee|Kentucky|Arkansas|Mississippi|Louisiana|Colorado|Utah|Nevada|Oregon|Idaho|Montana|Wyoming|Alaska|Hawaii|\bNYC\b|New York City|Community Branch Library|\bHack Club\b|Pololu/i],
  // F10：Rio / Lima 这类三四个字母的地名必须带词边界，否则 Ontario 里的 "Rio" 会命中。
  ['latam', /巴西|墨西哥|阿根廷|智利|哥伦比亚|秘鲁|巴拉圭|乌拉圭|\bBrazil\b|\bBrasil\b|S[aã]o Paulo|\bRio\b|\bMexico\b|M[eé]xico|\bCDMX\b|Guadalajara|\bArgentina\b|Buenos Aires|\bChile\b|\bSantiago\b|\bColombia\b|Bogot[aá]|\bPeru\b|\bLima\b|\bParaguay\b|Asunci[oó]n|\bUruguay\b|Montevideo|CETYS|\bM[eé]xico\b|Ense[ñn]anza T[eé]cnica/i],
  ['africa', /非洲|尼日利亚|肯尼亚|南非|埃及|乌干达|加纳|摩洛哥|突尼斯|坦桑尼亚|Africa|Nigeria|Lagos|Kenya|Nairobi|South Africa|Cape Town|Johannesburg|Egypt|Cairo|Uganda|Kampala|Ghana|Accra|Morocco|Tunisia|Tunis|Tanzania/i],
  ['middle-east', /中东|中東|沙特|卡塔尔|以色列|约旦|黎巴嫩|\bIsrael\b|Tel Aviv|Jerusalem|Saudi|Riyadh|Qatar|Doha|Jordan|Amman|Lebanon|Beirut/i],
  // 东南亚/南亚剩余国家
  // F10：巴基斯坦从「印度」那条搬到这里——国家码表里 PK→asia，正则必须一致。
  ['asia', /菲律宾|印度尼西亚|印尼|越南|泰国|马来西亚|斯里兰卡|尼泊尔|孟加拉|柬埔寨|缅甸|亚美尼亚|巴基斯坦|伊斯兰堡|拉合尔|Ph ?ilippines|\bManila\b|\bIndonesia\b|\bJakarta\b|\bVietnam\b|\bHanoi\b|Ho Chi Minh|\bThailand\b|\bBangkok\b|\bMalaysia\b|Kuala Lumpur|Sri Lanka|\bColombo\b|\bNepal\b|\bKathmandu\b|\bBangladesh\b|\bDhaka\b|\bCambodia\b|\bMyanmar\b|\bArmenia\b|\bYerevan\b|\bPakistan\b|\bIslamabad\b|\bLahore\b|\bKarachi\b/i],
];

export function eventRegion(e) {
  const loc = String(e.location || '');
  // 线上优先：但是「线上 + 线下」混合场次（Luma 常见）按线下判，因为地点更有信息量
  const onlineOnly = /^(线上|online|remote|virtual|anywhere)$/i.test(loc.trim());
  if (onlineOnly) return 'online';

  /* 判定顺序（越靠前越权威）：
   *   1. 源的 country_code —— 直接来自数据源的国家码，不靠猜
   *   2. 城市 geo 兜底 —— 只有源没给国家时才用（本次是从该城市坐标问出来的）
   *   3. location / org / 标题字符串正则 —— 老办法，作为兜底
   *   4. other
   * 线上场次已经在上面早返回，不会被国家码覆盖成线下地区。
   * 注意「线上」+ 有国家码的混合场次：先判线上只认纯线上，混合场次继续往下走国家码，这是对的。 */
  const byCountry = regionFromCountryCode(e.countryCode);
  if (byCountry) return byCountry;

  if (e.geoCityFallback) return e.geoCityFallback;

  // Devfolio 给的是英文国名（"India" / "Germany"），不是 ISO 两位码，
  // 单独走一次国名正则，比把国名塞进 loc 再靠城市名命中更靠谱
  if (e.countryName) {
    const byName = EV_COUNTRY_NAME_RULES.find(([, re]) => re.test(e.countryName));
    if (byName) return byName[0];
  }

  // 只看地点与主办方，**绝不拼标题**（F10）。
  // 活动标题里塞满地名人名（"Fireside with Jordan"、"Austin Powers Night"），
  // 拼进来就等于让标题决定地区——实测这条贡献了大部分错判。
  const hay = `${loc} ${e.org || ''}`;
  for (const [code, re] of EV_REGION_RULES) {
    // 中文地名与「Sofia, Bulgaria」这类完整写法不带词边界；纯英文短词已在正则里加了 \b
    if (re.test(hay)) return code;
  }
  // 没有可识别地区，但源明确说是线上 → online；否则 other
  if (/线上|online|remote|virtual|anywhere/i.test(loc)) return 'online';

  /*
   * other 会因为这些情况「升高」，而且这是对的（T1.8 实测复盘）：
   *
   * 61 条线下场次的 location 只有「线下」两个字，既没有国家码也没有 geo 城市
   * （Luma 59 条、Devfolio 2 条）。旧实现靠标题里碰巧出现的「Toronto」「CDMX」
   * 「Bangalore」蒙对 10 条——那正是 F10 要治的病：标题里的地名可能是人名、
   * 可能是线上活动的口号、也可能是别的城市。现在一律落 other，等源补 geo。
   *
   * 因此 other 从 5.1% 升到 5.7% 是「去掉猜地名」的代价，不是退化。
   * S8.5 的质量线（region=other ≤ 10%）仍然满足。
   */
  return 'other';
}

/* 地区归并：值太碎就没法当筛选维度用。
 * 实测问题（2026-10-24）：`ae`（阿联酋）只有 1 条、`kr`（韩国）2 条，
 * 前端按实际数据生成筛选按钮时会列出一堆点开只有 1 条的空按钮。
 * 原则：**国家**值条数 < EV_REGION_MIN 就并入所属大区；原始值不再回写（T2.2 起）。
 * 大区值（asia / eu / latam / middle-east / africa / online / other）不参与归并。
 * 阈值不写死在别处：条数变化时自动生效，不需要再改代码。 */
const EV_REGION_MIN = 5;
// 小国家值并到哪个大区（先查这张表，查不到就按 fallback 再查，最后落 other）
const EV_REGION_FOLD = { ae: 'middle-east', kr: 'asia' };
/*
 * 小国家的归并目标必须同洲。
 * F10：旧表把 ca → latam、au → asia，于是「拉美」筛选里会出现多伦多。
 * 没有同洲大区可归的（加拿大、澳洲）就落 other —— 宁可不归并，也不要错归。
 */
const EV_REGION_FOLD_FALLBACK = {
  ae: 'middle-east', kr: 'asia', sg: 'asia', jp: 'asia', cn: 'asia', in: 'asia',
  uk: 'eu',
};
const EV_REGION_REGIONS = new Set(['online', 'other', 'asia', 'eu', 'latam', 'middle-east', 'africa']);

export function foldRegions(events) {
  const count = events.reduce((a, e) => { a[e.region] = (a[e.region] || 0) + 1; return a; }, {});
  const fold = { ...EV_REGION_FOLD };
  for (const [code, n] of Object.entries(count)) {
    if (EV_REGION_REGIONS.has(code)) continue;             // 大区本身不动
    if (n >= EV_REGION_MIN) continue;                       // 够量就保留独立值
    if (fold[code] == null) fold[code] = EV_REGION_FOLD_FALLBACK[code] || 'other';
  }
  const applied = Object.entries(fold).filter(([from]) => count[from] != null && count[from] < EV_REGION_MIN);
  if (applied.length) {
    console.log(`[collect] region 归并（<${EV_REGION_MIN} 条并入大区）：${applied.map(([k, v]) => `${k}(${count[k]})→${v}`).join(' · ')}`);
  }
  // 归并只改 region；原始值不再回写（页面不读，S6.5 的展示分组另有字典）
  return events.map((e) => (fold[e.region] ? { ...e, region: fold[e.region] } : e));
}

/* Aibijia 公开数据：第三方挂单（带真实商品链接）+ App Store 各国订阅价 */
const AIBIJIA_PRODUCTS = 'https://data.aibijia.org/products.json';
const AIBIJIA_APPLE = 'https://data.aibijia.org/apple_subscriptions.json';



/* 官方订阅档位：从苹果区价里取美国区价格，一档一行。
 * 这是「官网写多少就是多少」里唯一能自动化且可复核的口径——App Store 商品页是公开明码。
 * 拿不到美国区价格的档位直接跳过，不猜价、不用历史值填。 */
const SUB_VENDOR = { chatgpt: 'OpenAI', claude: 'Anthropic', gemini: 'Google', grok: 'xAI' };
const SUB_NOTE = {
  chatgpt: 'App Store 美国区内购价；网页版可能另有年付折扣',
  claude: 'App Store 美国区内购价；官网另有年付 17% 折扣',
  gemini: 'Google One AI 套餐，经 App Store 美国区购买',
  grok: 'X Premium+ 内的 Grok 档位，美国区定价',
};


/* ────────────────────────── 情报层（news） ──────────────────────────
 * 唯一原则：**跨度换信息量时，只能加不能减。**
 *
 * 旧实现每天只留 20 条高分条目，其余直接销毁——结果是跑了 70 天也只有 4 天跨度
 * （源站 news-frontline.yaml 本身只吐最近约 50 条，跨不出 4 天）。
 *
 * 现在三层都入归档（同一套 schema、URL 唯一键）：
 *   1. news-frontline.yaml      —— 官方精选，每天约 50 条，带摘要
 *   2. aihot.news /api/v1/items —— 全量流，window 只开放 24h/7d，7 天内约 1900 条
 *   3. news-seed.json           —— 从存档补回的早期条目（date 来自页面内嵌 JSON-LD）
 *
 * 落盘前压缩：短键 + 只留标题里没有的摘要 + 每天门面永不被预算删除。
 */
const NEWS_FEED = 'https://data.aibijia.org/news-frontline.yaml';
const AIHOT_ITEMS = 'https://aihot.news/api/v1/items';
const ARCHIVE = outUrl('news-archive.json');
const SEED = new URL('./news-seed.json', import.meta.url);

/* 全量流的分类映射：AIHOT 自己的 category → 本站主题 */
const AIHOT_CATEGORY = {
  'ai-models': 'model',
  'ai-products': 'product',
  industry: 'funding',
  paper: 'research',
  tip: 'other',
};

function toRow(x) {
  return { date: x.date, time: x.time, title: x.title, summary: x.summary, url: x.url };
}

/** 官方精选：每天约 50 条，摘要最全，优先用它 */

/**
 * 全量流：window 只接受 24h / 7d，游标翻页。
 * mode=all 才给全部；selected 只给人工精选的 50 条。
 * 分类之间不重叠，所以要逐个分类翻，不然会漏掉一大半。
 */

/** 存档补回的早期条目（可选文件，CI 里没有也不该失败） */



async function fetchAios() {
  const file = aiosFile();
  if (!file) return [];   // 可选层，没有就是没有，交给 aiosFile() 的 warn 说明
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'));
    const rows = Array.isArray(raw) ? raw : raw.data || [];
    return rows.map((o) => {
      const row = {
        id: o.id, title: o.title, url: o.canonicalUrl || o.sourceUrl, dates: (o.startsAt || '').slice(0, 10),
        start: (o.startsAt || '').slice(0, 10), end: (o.endsAt || '').slice(0, 10),
        location: o.mode === 'online' ? '线上' : (o.city || '线下'),
        org: o.organizerName || '', prize: o.priceLabel || null, regs: 0,
        themes: o.topics || [], source: 'AIOS',
        worth: o.worthScore ?? null,
        // AIOS 自带一句话摘要（其余两源都没有），直接用；detail 给前端做更长的说明
        summary: (o.summary || o.recommendationReason || '').slice(0, 280) || null,
        detail: (o.recommendationReason || '').slice(0, 280) || null,
        // type 字段是 AIOS 自己的分类（event / program / …），交给 eventKind 参考
        kindHint: o.type || null,
      };
      row.status = eventStatus(row);   // AIOS 是本地历史库，绝大多数会正确翻成 past
      row.url = keepSafeUrl(row.url, 'event:aios');
      return row;
    }).sort((a, b) => String(a.start).localeCompare(String(b.start)));
  } catch (e) {
    // AIOS 是本地文件，CI 里读不到是正常的（没配 AIOS_OPPORTUNITIES），这里只提示不报错
    console.warn(`[collect] AIOS 活动库不可用，跳过这一源：${e.message}`);
    return [];
  }
}

/* ────────────────────────── 8. 智力评测（Vals Index） ────────────────────────── */

/* ────────────────────────── 9. 工具箱（人工精选 + GitHub 自动校准） ────────────────────────── */
// 只收真正在用的：skill、MCP、CLI。星数与更新时间每天从 GitHub 拉一遍，
// 归档/停更的会被标出来，不静默留在榜上。
// 人工精选工具箱：见 curated/toolkit.json
const CURATED_RESOURCES = readCurated('toolkit.json');

const USE_LABEL = { design: '设计', writing: '写作', content: '内容', engineering: '工程', research: '调研', tool: '工具' };

/* 网络请求重试：偶发的 5xx、429、连接重置不应该让整层数据蒸发。
 * 指数退避 + 抖动，只对「值得重试」的状态码重试（4xx 里除 408/429 之外都是确定性失败，不重试）。
 * 这解决过一个真实问题：fetchResources 串行打 21 个 GitHub 仓库，偶尔限流掉几个就跌破健康红线，
 * 整轮采集白跑。 */



/* ────────────────────────── OpenRouter 真实使用量（民间口碑 + 工具采纳） ────────────────────────── */
const OPENROUTER_RANKINGS = 'https://openrouter.ai/rankings';

export function parseOpenRouter(html) {
  const h = html.replace(/\\+"/g, '"').replace(/\\n/g, ' ');

  // 应用（谁在用哪个工具）——只取 day 窗口，跨窗口的 token 不可比
  const dayAt = h.indexOf('"day":[');
  const scope = dayAt >= 0 ? h.slice(dayAt, dayAt + 30000) : h;
  const apps = [];
  for (const p of scope.split('"app_id":').slice(1)) {
    const id = p.match(/^(\d+)/);
    const tok = p.match(/"total_tokens":"?(\d+)"?/);
    const rk = p.match(/"rank":(\d+)/);
    const ttl = p.match(/"title":"((?:[^"\\]|\\.)*)"/);
    const slug = p.match(/"slug":"((?:[^"\\]|\\.)*)"/);
    const cats = p.match(/"categories":\[([^\]]*)\]/);
    const desc = p.match(/"description":"((?:[^"\\]|\\.)*)"/);
    if (!id || !ttl || !rk) continue;
    apps.push({
      id: +id[1],
      title: ttl[1],
      slug: slug ? slug[1] : '',
      rank: +rk[1],
      tokens: tok ? +tok[1] : 0,
      categories: cats ? cats[1].replace(/"/g, '').split(',').filter(Boolean) : [],
      desc: desc ? desc[1].slice(0, 240) : '',
    });
  }
  const appMap = new Map();
  for (const a of apps) {
    if (!appMap.has(a.title)) appMap.set(a.title, a);
  }

  // 模型调用量（真实选择）
  const models = [];
  const reM = /\{"date":"([^"]+)","model_permaslug":"([^"]+)","variant":"([^"]*)","total_completion_tokens":(\d+),"total_prompt_tokens":(\d+)/g;
  let m;
  while ((m = reM.exec(h))) models.push({ slug: m[2], tokens: +m[4] + +m[5] });
  const modelMap = new Map();
  for (const r of models) modelMap.set(r.slug, (modelMap.get(r.slug) || 0) + r.tokens);

  return {
    apps: [...appMap.values()].sort((a, b) => b.tokens - a.tokens).map((a, i) => ({ ...a, rank: i + 1 })),
    models: [...modelMap.entries()]
      .map(([slug, tokens]) => ({ slug, tokens }))
      .sort((a, b) => b.tokens - a.tokens),
  };
}

/**
 * OpenRouter 模型目录（F06、INV-1）。
 *
 * 以前这里是裸的 `throw`：它一失败，整次采集中止，白嫖额度、活动、评测
 * 这些跟它无关的层当天全都不更新。现在包成「拿不到就返回空」，
 * 由 T.run 决定沿用上一版并标 stale，与其它层同一套语义。
 */
async function fetchModelCatalog() {
  const res = await httpGet(OPENROUTER, { label: 'openrouter-models' });
  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
  const payload = await res.json();
  return normalizeOpenRouter(payload);
}

async function fetchOpenRouter() {
  try {
    const res = await httpText(OPENROUTER_RANKINGS, { label: 'openrouter-rankings' });
    if (!res.ok) {
      console.error(`[collect] openrouter rankings HTTP ${res.status}`);
      return { apps: [], models: [] };
    }
    const html = res.text;
    if (html.length < 10000) {
      console.error(`[collect] openrouter rankings 页面过短（${html.length}），可能被拦`);
      return { apps: [], models: [] };
    }
    const parsed = parseOpenRouter(html);
    if (!parsed.apps.length && !parsed.models.length) {
      console.error('[collect] openrouter rankings 解析出 0 条——页面结构可能变了');
    }
    return parsed;
  } catch (e) {
    console.error(`[collect] openrouter rankings 失败：${e.message}`);
    return { apps: [], models: [] };
  }
}


/* ────────────────────────── Artificial Analysis 综合智能指数 ────────────────────────── */

/* ────────────────────────── Hacker News：民间公开讨论度 ────────────────────────── */
const HN_API = 'https://hn.algolia.com/api/v1/search';

async function fetchHNSignal(names) {
  const out = [];
  const list = TEST_PROFILE ? names.slice(0, 2) : names;
  for (const name of list) {
    if (!name || name.length < 4) continue;   // 太短的词没有区分度
    try {
      // 只搜标题，避免 API/Raspberry Pi 这类词把无关帖算进来
      const url = `${HN_API}?query=${encodeURIComponent('"' + name + '"')}&tags=story&hitsPerPage=30&restrictSearchableAttributes=title`;
      const res = await httpGet(url, { tries: 2, label: `hn/${name}` });
      if (!res.ok) continue;
      const j = await res.json();
      const hits = j.hits || [];
      const heat = hits.reduce((n, h) => n + (h.points || 0), 0);
      const talk = hits.reduce((n, h) => n + (h.num_comments || 0), 0);
      const top = hits.sort((a, b) => (b.points || 0) - (a.points || 0))[0];
      out.push({
        name,
        mentions: j.nbHits || 0,
        heat,
        talk,
        topTitle: top?.title || '',
        topPoints: top?.points || 0,
        topComments: top?.num_comments || 0,
        topUrl: top?.url || (top?.objectID ? `https://news.ycombinator.com/item?id=${top.objectID}` : ''),
      });
      await sleep(120);  // 对公共接口客气一点
    } catch { /* 单个失败不影响整体 */ }
  }
  return out.sort((a, b) => b.heat - a.heat);
}

/* ────────────────────────── 分层采集：状态可追溯 ──────────────────────────
 * 每个数据层都经过这里。约定：
 *   fresh  —— 本次拿到了非空结果
 *   stale  —— 本次为空/异常，沿用上一版（prev 里有值）
 *   failed —— 本次为空且上一版也没有，这一层真的没了（health 会判红线）
 * 采集结果写进 meta.collect[]，前端和 health.mjs 都能读到，不再靠数数去猜。 */
function makeTracker() {
  const log = [];
  return {
    log,
    /** @param {string} layer 层名
     *  @param {Function} run 返回 Promise<{value:any, valid?:boolean}>
     *  valid 显式覆盖「非空」判定（值本身是对象、空对象也算空时用） */
    async run(layer, run, prevValue) {
      const started = mark();
      let value = null;
      let error = null;
      let valid = null;
      try {
        const out = await run();
        value = out?.value ?? null;
        valid = out?.valid ?? null;
      } catch (e) {
        error = e.message;
      }
      const size = (v) => {
        if (v == null) return 0;
        if (Array.isArray(v)) return v.length;
        if (typeof v === 'object') {
          // {prod, apple} 这种聚合对象：任一子字段有内容就算有值
          const sub = Object.values(v).filter((x) => x != null);
          if (sub.length) return sub.reduce((n, x) => n + (Array.isArray(x) ? x.length : typeof x === 'object' ? Object.keys(x).length : 1), 0);
          return Object.keys(v).length;
        }
        return 1;
      };
      const n = valid === false ? 0 : size(value);
      const prevN = size(prevValue);

      if (n > 0) {
        log.push({ layer, status: 'fresh', n, ms: since(started) });
        return value;
      }
      if (prevN > 0) {
        log.push({ layer, status: 'stale', n: 0, prev: prevN, ms: since(started), error });
        console.warn(`[collect] ${layer} 本次为空${error ? `（${error}）` : ''}，沿用上一版 ${prevN} 条`);
        return prevValue;
      }
      log.push({ layer, status: 'failed', n: 0, ms: since(started), error });
      console.error(`[collect] ${layer} 本次为空且无上一版${error ? `（${error}）` : ''}`);
      return value;
    },
  };
}

/* ────────────────────────── 主流程 ────────────────────────── */
async function main() {
  let prev = null;
  try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* 首次运行 */ }
  // 上一版评测快照必须从 bench.json 读：data.json 里的 bench 只剩目录（F02）。
  const prevBench = readPrevBench();

  /* fx 走层契约（T3.1c）：编排器只认 id/sources/fetch/normalize/merge/health，
   * 层自己不读文件、不直接 fetch、不碰 Date.now()——全部经 ctx 注入。
   * 这一步先只搬 fx（最小的层），验证契约形态可行；其余层按 T3.1c1/c2 继续。 */
  const fxCtx = {
    http: { json: httpJson },
    now,
    prev: prev?.meta?.fx ?? null,
  };
  let fx;
  try {
    const raw = await fxLayer.fetch(fxCtx);
    const norm = fxLayer.normalize(raw, fxCtx);
    fx = fxLayer.merge(fxCtx.prev, norm.records, fxCtx);
    const verdict = fxLayer.health.rules[0].check(fx);
    if (verdict.level !== 'ok') {
      console.warn(`[collect] fx 门禁：${verdict.level} — ${verdict.message || ''}`.trim());
    }
  } catch (e) {
    console.warn(`[collect] fx 抓取失败：${e.message}`);
    fx = fxLayer.merge(fxCtx.prev, null, fxCtx);
  }
  const T = makeTracker();

  /* 活动层的 ctx（T3.1c10）。四源记账仍由编排器负责——meta.collect 里的四行
   * 是排障第一现场。层负责的是并发调度、单源失败收敛，以及 ctx.state 的显式传递
   * （Luma 有有状态封禁，需要记住本次已冷却多久）。 */
  const eventsCtx = {
    fetchDevpost,
    fetchLuma,
    fetchDevfolio,
    fetchAios,
    testProfile: TEST_PROFILE,
    state: lumaState,
    log: (m, opt) => {
      if (opt?.level === 'warn') console.warn(`[collect] ${m}`);
      else console.log(`[collect] ${m}`);
    },
  };

  // 并行拉取，每层独立记账；失败不互相拖累
  // 顺序必须与下面的 Promise.all 一一对应：aibijia 已交给 subs 层自己抓（T3.1c6）
  /* 四源由层统一调度；每个源仍各自 T.run 记账（meta.collect 要有四行）。
   * 层这边只多做一件事：把「并发」与「单源失败收敛」收进一处。 */
  const eventsRaw = eventsLayer.fetch({
    ...eventsCtx,
    fetchDevpost: () =>
      T.run('devpost', async () => ({ value: await fetchDevpost() }), prev?.events?.filter((e) => e.source === 'Devpost')),
    fetchAios: () =>
      T.run('aios', async () => ({ value: await fetchAios() }), prev?.events?.filter((e) => e.source === 'AIOS')),
    fetchLuma: () =>
      T.run('luma', async () => ({ value: await fetchLuma() }), prev?.events?.filter((e) => e.source === 'Luma')),
    fetchDevfolio: () =>
      T.run('devfolio', async () => ({ value: await fetchDevfolio() }), prev?.events?.filter((e) => e.source === 'Devfolio')),
  });

  const [eventsData, resources, openrouter] = await Promise.all([
    eventsRaw,
    T.run(
      'resources',
      async () => {
        const ctx = {
          http: { get: httpGet },
          sleep,
          now,
          curated: { toolkit: CURATED_RESOURCES },
          useLabel: USE_LABEL,
          testProfile: TEST_PROFILE,
          githubHeaders: (() => {
            const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
            const h = { Accept: 'application/vnd.github+json' };
            if (token) h.Authorization = `Bearer ${token}`;
            return h;
          })(),
        };
        const raw = await resourcesLayer.fetch(ctx);
        const norm = resourcesLayer.normalize(raw, ctx);
        return { value: resourcesLayer.merge(prev?.resources, norm.records) };
      },
      prev?.resources,
    ),
    T.run(
      'openrouter',
      async () => {
        const ctx = { http: { text: httpText }, parse: parseOpenRouter };
        const raw = await adoptionLayer.fetch(ctx);
        const norm = adoptionLayer.normalize(raw, ctx);
        const merged = adoptionLayer.merge(prev ? { apps: prev.orApps } : null, norm.records);
        return { value: merged };
      },
      prev ? { apps: prev.orApps } : null,
    ),
  ]);

  // 情报层：归档文件是唯一存储，data.json 里只留极简索引（计数 / 跨度 / 逐日条数）
  // 情报层用于判断「有没有可沿用的东西」：直接读现有归档。
  // 必须是真数组：T.run 在「本次为空」时会把这个基线原样返回，代理对象会让下游炸。
  let newsArchiveBefore = [];
  try {
    const raw = JSON.parse(await readFile(ARCHIVE, 'utf8'));
    newsArchiveBefore = Array.isArray(raw) ? raw : raw.items || [];
  } catch { /* 首次运行 */ }

  const newsArchive = await T.run(
    'news',
    async () => {
      /* news 走层契约（T3.1c4）。层不碰文件系统：归档的读写由这里注入，
       * 层只负责「抓什么、怎么并、算多新鲜」。 */
      const ctx = {
        http: { get: httpGet, text: httpText },
        sleep,
        parseYaml: parseNewsYaml,
        keepSafeUrl,
        readSeed,
        mergeArchive,
        today: todayISO,
        testProfile: TEST_PROFILE,
        urls: { frontline: NEWS_FEED, aihot: AIHOT_ITEMS },
        log: (m, opt) => {
          if (opt?.level === 'warn') console.warn(`[collect] ${m}`);
          else console.log(`[collect] ${m}`);
        },
      };
      const raw = await newsLayer.fetch(ctx);
      const norm = newsLayer.normalize(raw, ctx);
      const archive = newsLayer.merge(newsArchiveBefore, norm.records, ctx);
      const fresh = archive?.__freshCount ?? 0;

      // 归档只增不删，所以「有内容」不等于「今天拿到了新东西」。
      // 三路源全挂时 freshCount 为 0：这一层必须记 stale 并写明原因（F09）。
      if (!fresh) console.warn('[collect] news 三路源本次都没拿到新条目，沿用现有归档');

      // 写回归档（层不写，这里写）
      try {
        await writeFile(ARCHIVE, JSON.stringify(archive), 'utf8');
      } catch { /* 只读环境 */ }
      const st = archiveStats(archive);
      console.log(
        `[collect] news 跨度 ${st.spanDays} 天 / ${st.days} 个有新闻的日子，${(st.bytes / 1024).toFixed(0)}KB`,
      );

      // valid: false → T.run 走「沿用上一版」分支：有归档记 stale，连归档都没有才记 failed
      return { value: archive, valid: fresh > 0 };
    },
    // 情报层的「上一版」就是磁盘上现有的归档：它不是快照，但确实是这次沿用下来的东西。
    // 归档本身就是上一版：条数即 size()，语义也对（沿用哪一份就交回哪一份）。
    newsArchiveBefore.length ? newsArchiveBefore : null,
  );
  const newsIndex = buildIndex(newsArchive || []);

  // 民间讨论：拿使用量前 18 的工具名去 HN 查公开帖
  const hnTargets = (openrouter?.apps || []).slice(0, 18).map((a) => a.title).filter(Boolean);
  const hnSignals = hnTargets.length
    ? await T.run('hn', async () => ({ value: await fetchHNSignal(hnTargets) }), prev?.hnSignals)
    : (prev?.hnSignals || []);

  // 评测：8 个公开源并采（LMArena 24 榜 / SWE-bench / Aider / Terminal-Bench / τ-bench / Vals / ARC-AGI / SimpleBench）
  // T.run 的基线只用于「本次为空时是否沿用」的判断，给个轻量代理：
  // prevBench 是 ~3MB 的对象，交给 size() 只会数出一堆无意义的键。
  const benchPrevMarker = prevBench ? { boards: prevBench.stats?.boards || 0 } : null;
  const bench = await T.run(
    'bench',
    async () => {
      /* 评测走层契约（T3.1c5）：层很薄，重活仍在 bench.mjs。
       * 注意 ctx.prev 传的是「上一版完整快照」而不是 prev.bench（那是目录，
       * 没有 boards）。整源失败时 bench.mjs 会沿用该源自己的旧榜并标 stale（F02、S8.6）。 */
      const ctx = { fetchBenchmarks, prev: prevBench };
      const raw = await benchLayer.fetch(ctx);
      const norm = benchLayer.normalize(raw);
      return { value: benchLayer.merge(prevBench, norm.records) };
    },
    benchPrevMarker,
  );

  /*
   * 模型目录走分层记账（F06）。基线只取上一版里的 aggregator 行：
   * 官方直连是人工核实的，不该在「目录拉不到」时被一起沿用成 stale。
   */
  const prevAggregator = (prev?.models || []).filter((m) => m.channelKind === 'aggregator');
  /* 只把「聚合目录」交给 T.run 记账：人工官方价不参与抓取失败判定（见层的注释）。
   * 层在下面用同一个 ctx 把两者合并。 */
  const or = await T.run(
    'models',
    async () => ({ value: await fetchModelCatalog(), valid: undefined }),
    prevAggregator.length ? { rows: prevAggregator } : null,
  );

  /* 模型目录走契约（T3.1c8）。层负责「两个源怎么合」，
   * 纯函数（band / familyKey / dedupeModels / slugify）经 ctx 注入——
   * 它们有独立测试且被多处引用，搬进层会造成重复实现。 */
  const modelsCtx = {
    fetchCatalog: () => or && Array.isArray(or.rows) ? or : { rows: [] },
    curated: { official: CURATED_OFFICIAL },
    band,
    familyKey,
    dedupeModels,
    slugify,
    today: todayISO,
  };
  const modelsRaw = await modelsLayer.fetch(modelsCtx);
  const modelsNorm = modelsLayer.normalize(modelsRaw, modelsCtx);
  const modelsDedup = modelsLayer.merge(prev?.models, modelsNorm.records);
  const catalog = modelsRaw.catalog && Array.isArray(modelsRaw.catalog.rows)
    ? modelsRaw.catalog
    : { rows: [], dropped: 0, unpriced: 0, stale: false };
  /* 免费额度走契约（T3.1c7）。这一层没有网络请求，数据来自人工名单；
   * 去重函数留在 collect.mjs 经 ctx 注入——它被多处引用且有独立测试。 */
  const offersCtx = { curated: { offers: CURATED_OFFERS }, dedupeOffers };
  const offersRaw = await offersLayer.fetch(offersCtx);
  const offersNorm = offersLayer.normalize(offersRaw, offersCtx);
  const offersDedup = offersLayer.merge(prev?.offers ? { rows: prev.offers } : null, offersNorm.records);
  const signals = [...new Map(SIGNALS.map((s) => [s.url, s])).values()]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  // 主键 input 升序；次级键保证同一价位的行顺序稳定（INV-7：输出必须确定）
  const models = modelsDedup.rows.slice().sort((a, b) => {
    const d = (a.input ?? 9e9) - (b.input ?? 9e9);
    if (d !== 0) return d;
    const ka = `${a.channelKind}::${a.id}::${a.channel}`;
    const kb = `${b.channelKind}::${b.id}::${b.channel}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  // 探测交给 relays 层（T3.1c9）：并发度与超时都在层里定

  // 官方参考价（direct 渠道），用来给每一列算「对官方 %」
  const officialRef = {};
  for (const f of FLAGSHIP) {
    const m = (models || []).find((x) => x.channelKind === 'direct' && f.re.test(String(x.name || '')) && x.input > 0);
    officialRef[f.key] = { input: m?.input ?? f.official[0], output: m?.output ?? f.official[1] };
  }

  /* 沿用旧价的 TTL（S3.3：中转站 14 天）。
   * 旧实现只看「上一版有没有价」，于是停更的站可以永远挂着昨天的数字。
   * 现在超过 TTL 就不再沿用：宁可少一条，也不要展示两周前的价还装作今天的。 */
  const RELAY_STALE_TTL_DAYS = 14;
  const daysSince = (iso) => {
    if (!iso) return Number.POSITIVE_INFINITY;
    const t = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
    if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
    return Math.round((Date.parse(`${todayISO()}T00:00:00Z`) - t) / 86400000);
  };

  /*
   * 旗舰清单与官方参考价（F19）。
   *
   * 页面以前用「展示名拼正则」去找官方价，DS V4.1 Flash 这种简写永远匹配不到 DeepSeek，
   * 于是中转站页的「官方 $x」参考线从来不画。采集端这里已经算好了 officialRef，
   * 直接下发：key / label / 官方 input·output·cache_read，以及按中转画像算出的官方有效成本。
   * 页面只读这份数据，不再自己猜。
   */
  const flagships = FLAGSHIP.map((f) => {
    const ref = officialRef[f.key] || {};
    const input = ref.input ?? f.official[0] ?? null;
    const output = ref.output ?? f.official[1] ?? null;
    const cacheRead = ref.cache_read ?? null;
    const officialEff = input != null && output != null
      ? costOf({ kind: 'per_1m', input, output, cacheRead }, profileOf('agent'))
      : null;
    return {
      key: f.key,
      label: f.label,
      input,
      output,
      cache_read: cacheRead,
      officialEff: officialEff == null ? null : Number(officialEff.toFixed(4)),
    };
  });

  /* 中转站走契约（T3.1c9）：探测在层内做（有并发与超时），
   * 逐站沿用也在层内做；价格加工（eff / vsOfficial）作为 enrich 注入——
   * 它依赖 officialRef 与 lib/cost.js，属于编排器侧的知识。 */
  const relayCtx = {
    // 测试档位只探前 3 个站：回放数据只覆盖这几个，全探会打出上百次失败请求
    entries: TEST_PROFILE ? RELAYS.slice(0, 3) : RELAYS,
    probe: probeRelay,
    concurrency: 5,
  };
  const relaysRaw = await relaysLayer.fetch(relayCtx);
  const relaysNorm = relaysLayer.normalize(relaysRaw);

  /** 给每个旗舰价补上「有效成本」与「对官方比」，缺值留 null 而不是 0。 */
  const enrichRelay = (base) => {
    const prices = {};
    for (const [k, p] of Object.entries(base.prices || {})) {
      if (!p) continue;
      const ref = officialRef[k];
      const row = { ...p };
      if (p.kind === 'per_1m') {
        row.eff = costOf(p, profileOf('agent'));
        row.vsOfficial = ref && ref.input > 0 ? Number((p.input / ref.input).toFixed(3)) : null;
      }
      // 按次计价不参与每百万 token 的比较，只留原值
      prices[k] = row;
    }
    const effs = Object.entries(prices).filter(([, p]) => p.kind === 'per_1m' && p.eff != null && !p.anomaly);
    return {
      ...base,
      prices,
      comparable: effs.length,
      grayGroups: Object.values(prices).reduce((n, p) => n + (p.grayGroups || 0), 0),
    };
  };

  const relays = relaysLayer
    .merge(prev?.relays, relaysNorm.records, {
      ttlDays: RELAY_STALE_TTL_DAYS,
      today: todayISO(),
      enrich: enrichRelay,
    })
    .sort((a, b) => (b.models || 0) - (a.models || 0));

  // 订阅层：官方月费从苹果区价派生；第三方挂单只认 aibijia 的实时挂单，没有就是没有。
  // aibijia 整体挂掉时沿用上一版的派生结果（而不是让订阅页空掉）。
  const prevSubs = Array.isArray(prev?.subs) ? prev.subs : [];
  const prevSubsThird = Array.isArray(prev?.subsThird) ? prev.subsThird : [];
  const prevSubsRegions = Array.isArray(prev?.subsRegions) ? prev.subsRegions : [];

  /* 订阅层走契约（T3.1c6）：层负责派生三种产物与各自的沿用。
   * 汇率折算是跨层顺序依赖（subs 依赖 fx 先算出），留在编排器这一侧补。 */
  const subsCtx = {
    http: { get: httpGet },
    urls: { prod: AIBIJIA_PRODUCTS, apple: AIBIJIA_APPLE },
    subsThirdStats,
    log: (m, opt) => {
      if (opt?.level === 'warn') console.warn(`[collect] ${m}`);
      else console.log(`[collect] ${m}`);
    },
  };
  const subsRaw = await subsLayer.fetch(subsCtx);
  // 源级记账：aibijia 的两个 JSON 是否拿到。原来这一行由 T.run('aibijia') 负责，
  // 源抓取搬进层之后要显式补记，否则 meta.collect 会少一层、排障时看不出是源挂了。
  T.log.push({
    layer: 'aibijia',
    status: subsRaw.prod || subsRaw.apple ? 'fresh' : 'failed',
    // 新口径：这两个源真正的记录条数（products 的条目 + apple 的套餐数）。
    // 旧值 8 是 size({prod, apple, valid}) 数顶层键数得来的——它描述 JSON 的形状，
    // 不描述拿到多少数据，排障时没有信息量。改成有意义的量（见提交信息说明）。
    n:
      (subsRaw.prod?.products || []).length + (subsRaw.apple?.apps || []).reduce((n, a) => n + (a.plans || []).length, 0),
    ms: 0,
    ...(subsRaw.prod || subsRaw.apple ? {} : { error: '两个源都没拿到' }),
  });
  const subsNorm = subsLayer.normalize(subsRaw, subsCtx);
  const subsMerged = subsLayer.merge(
    { subs: prevSubs, subsRegions: prevSubsRegions, subsThird: prevSubsThird },
    subsNorm.records,
  );

  // cny 折算依赖 fx，是跨层顺序依赖，不属于层的职责
  const subs = subsMerged.subs.map((x) => ({
    ...x,
    cny: Number((x.price * fx.USDCNY).toFixed(1)),
  }));
  const subsThird = subsMerged.subsThird;
  const subsRegions = subsMerged.subsRegions;

  // 三种产物分别记账（沿用与否各自独立）
  if (!subsNorm.records.subs.length && prevSubs.length) {
    T.log.push({ layer: 'subs', status: 'stale', n: 0, prev: prevSubs.length, ms: 0, error: 'apple 源为空' });
    console.warn(`[collect] subs 派生为空，沿用上一版 ${prevSubs.length} 档`);
  }
  if (!subsNorm.records.subsThird.length && prevSubsThird.length) {
    T.log.push({ layer: 'subsThird', status: 'stale', n: 0, prev: prevSubsThird.length, ms: 0, error: 'products 源为空' });
    console.warn(`[collect] 挂单统计为空，沿用上一版 ${prevSubsThird.length} 个产品`);
  }
  if (!subsNorm.records.subsRegions.length && prevSubsRegions.length) {
    T.log.push({ layer: 'subsRegions', status: 'stale', n: 0, prev: prevSubsRegions.length, ms: 0, error: 'apple 源为空' });
    console.warn(`[collect] subsRegions 为空，沿用上一版 ${prevSubsRegions.length} 组`);
  }

  // 来源登记表：所有 URL 去重，标注类型与命中次数
  /* 四源由 events 层调度后装在 eventsData 里。下游沿用原来的四个名字，
   * 这样这次改动的 diff 只反映「谁来调度」，不夹杂重命名噪声。 */
  const { devpost = [], luma = [], devfolio: devfolioRows = [], aios = [] } = eventsData || {};
  const devfolio = devfolioRows;

  const srcMap = new Map();
  const addSrc = (url, type, label) => {
    if (!url) return;
    const e = srcMap.get(url) || { url, type, label, refs: 0 };
    e.refs++;
    srcMap.set(url, e);
  };
  for (const m of models) addSrc(m.src, m.srcType, m.channel);
  for (const o of offersDedup.rows) {
    for (const u of (o.sources && o.sources.length ? o.sources : [o.source])) {
      addSrc(u, o.srcType || 'official', o.product);
    }
  }
  for (const s of signals) addSrc(s.url, s.source_type || 'x', s.handle || 'signal');
  // F16：订阅的链接字段叫 buy，不是 url（以前这里登记的全是 undefined）
  for (const s of subs) addSrc(s.buy || s.source, 'official', s.product);
  if (subsThird.length) addSrc('https://aibijia.org/', 'marketplace', '第三方挂单价');
  for (const r of subsRegions.slice(0, 4)) addSrc('https://data.aibijia.org/apple_subscriptions.json', 'marketplace', r.plan);
  if (luma.length) addSrc('https://api.lu.ma/discover/get-paginated-events', 'events', 'Luma');
  if ((newsArchive || []).length) {
    addSrc('https://data.aibijia.org/news-frontline.yaml', 'news', 'AI 要闻精选');
    addSrc('https://aihot.news/api/v1/items', 'news', 'AIHOT 全量流（7 天窗口）');
  }
  if (resources.length) addSrc('https://api.github.com/repos', 'toolkit', 'GitHub 精选');
  if (openrouter.apps.length) addSrc('https://openrouter.ai/rankings', 'adoption', 'OpenRouter 实际调用量');
  if (hnSignals.length) addSrc('https://hn.algolia.com/api', 'community', 'Hacker News 公开讨论');
  for (const r of relays) addSrc(`https://${r.domain}/api/pricing`, 'relay', r.name);
  addSrc('https://devpost.com/api/hackathons', 'events', 'Devpost');
  if (devfolio.length) addSrc('https://api.devfolio.co/api/hackathons', 'events', 'Devfolio');
  // 评测按 bench.sources 逐源登记（F16）：以前只写死了一个 Vals，另外 8 个源在页面上不存在
  for (const src of bench.sources || []) {
    if (src.ok === false) continue;
    addSrc(src.home, 'bench', src.name);
  }

  const cacheDiscount = models
    .filter((m) => m.cache_read != null && m.input)
    .map((m) => ({ id: m.id, off: 1 - m.cache_read / m.input }))
    .sort((a, b) => b.off - a.off);

  const vendors = [...new Set(models.map((m) => m.vendor))].sort();

  // 活动：状态统一由 eventStatus 按日期判定，四个来源一视同仁
  const allEvents = foldRegions([...devpost, ...luma, ...aios, ...devfolio].map((e) => {
    const row = { ...e, kind: eventKind(e), region: eventRegion(e) };
    row.status = eventStatus(row);
    // 判定用的三个原始字段到此为止：算完地区即丢（页面不读，S6.5 只按 ISO 代码存）
    delete row.countryCode;
    delete row.geoCityFallback;
    delete row.countryName;
    return row;
  }));
  // 限速观测点：把本次遇到的封禁次数与最长冷却写进 meta.net，随 data.json 落盘。
  // 这个源是**有状态封禁**（实测解封要 ~3 分钟），如果哪天它把阈值调紧，
  // 从 meta.net.blocked 抬升 + Luma 条数下降就能立刻看出是限速而不是源没数据。
  // 放在 meta 顶层而不是塞进某一个层，因为 Devfolio 也用同一个计数器。
  const netMeta = {
    // 统一 HTTP 客户端的账目（S2.1）：谁发了多少、多少字节、被限流几次、等多久。
    // 这些数字回答「这次为什么慢/为什么少了」，是排障的第一现场。
    http: httpTotals(),
    requests: netStat.requests,
    blocked: netStat.blocked,
    maxCooldownMs: netStat.maxCooldownMs,
    lumaCities: LUMA_CITIES.length,
    lumaGeoBudgetMs: EV_LUMA_GEO_BUDGET_MS,
    // 受阻要响（INV-4）：页面与状态页据此说「中转/活动这层被限速了」，而不是默默少几条
    lumaBlocked: lumaState.blocked,
    lumaBlockReason: lumaState.reason,
    lumaCooldownMs: lumaState.cooldownMs,
    lumaCooldownCapMs: EV_LUMA_COOLDOWN_CAP_MS,
  };
  const eventsOpen = allEvents.filter((e) => e.status === 'open' || e.status === 'upcoming').length;
  const eventsPast = allEvents.filter((e) => e.status === 'past').length;
  const eventsUnknown = allEvents.filter((e) => e.status === 'unknown').length;

  const data = {
    meta: {
      generated_at: nowISO(),
      date: todayISO(),
      brand: 'IndexAI',
      fx,
      net: netMeta,
      // 按层 id 排序：并行采集的完成顺序不稳定，输出必须确定（INV-7）
      collect: T.log.slice().sort((a, b) => (a.layer < b.layer ? -1 : a.layer > b.layer ? 1 : 0)),
      counts: {
        models: models.length,
        aggregator: models.filter((m) => m.channelKind === 'aggregator').length,
        direct: models.filter((m) => m.channelKind === 'direct').length,
        freeModels: models.filter((m) => m.free).length,
        withCache: models.filter((m) => m.cache_read != null).length,
        vendors: vendors.length,
        offers: offersDedup.rows.length,
        signals: signals.length,
        subs: subs.length,
        // 挂单总数从统计行累加（原始挂单只在层内部存在，D3）
        subsThird: subsThird.reduce((n, x) => n + (x.listings || 0), 0),
        subsThirdProducts: subsThird.length,
        subsRegions: subsRegions.length,
        subsRegionsRaw: subsRegions.reduce((n, r) => n + r.total, 0),
        news: newsArchive?.length || 0,
        resources: resources.filter((r) => r.status === 'ok').length,
        orApps: openrouter.apps.length,
        hnSignals: hnSignals.length,
        relays: relays.length,
        relaysLive: relays.filter((r) => r.status === 'ok').length,
        relayQuotes: relays.reduce((n, r) => n + Object.keys(r.prices || {}).length, 0),
        relayComparable: relays.filter((r) => (r.comparable || 0) > 0).length,
        relayGroups: relays.reduce((n, r) => n + (r.groups?.count || 0), 0),
        events: allEvents.length,
        eventsOpen,
        eventsPast,
        eventsUnknown,
        bench: bench.stats?.boards || 0,
        // 「几个榜单源」与「几个榜」是两件事（F22）：前者约 8–9，后者 160+，别再混用
        benchSources: (bench.sources || []).filter((x) => x.ok).length,
        benchRows: bench.stats?.rows || 0,
        benchModels: bench.stats?.models || 0,
        sources: srcMap.size,
      },
      dedupe: { aggregator_dropped: catalog.dropped || 0, unpriced_dropped: catalog.unpriced || 0, models_dropped: modelsDedup.dropped, offers_merged: offersDedup.merged },
      // 被外链白名单挡下的地址（F46）：数量要可观测，样例只留前 5 条
      dropped: { unsafeUrl: unsafeUrl.dropped, unsafeUrlSamples: unsafeUrl.samples },
      bestCacheDiscount: cacheDiscount[0] ? { ...cacheDiscount[0], pct: Math.round(cacheDiscount[0].off * 100) } : null,
      // 旗舰清单（F19）：页面画参考线只读这份，不再用正则猜官方价
      flagships,
      vendors,
    },
    models,
    offers: offersDedup.rows.sort((a, b) => String(a.product).localeCompare(String(b.product))),
    subs,
    subsThird,
    subsRegions,
    resources,
    orApps: openrouter.apps,
    hnSignals,
    relays,
    // 场次型输出按 id 排序：多源并行的完成顺序不稳定，输出必须确定（INV-7）
    events: allEvents.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    bench,
    signals,
    sources: [...srcMap.values()].sort((a, b) => b.refs - a.refs),
  };

  // 健康门禁：不达标就抛，绝不写出残缺的 data.json 再发布出去
  const prevCounts = prev?.meta?.counts || null;
  const prevOf = (k) => {
    if (!prev) return null;
    // subsThird 现在是「按产品的统计行」；门禁比的是挂单总数（meta.counts.subsThird）
    if (k === 'subsThird') return prev.meta?.counts?.subsThird || 0;
    if (k === 'relaysLive') return (prev.relays || []).filter((r) => r.status === 'ok').length;
    if (k === 'subsRegions') return (prev.subsRegions || []).length;
    return prevCounts?.[k] ?? (Array.isArray(prev[k]) ? prev[k].length : null);
  };
  const health = assertLayers(data, prevOf, { allowDegraded: process.env.ALLOW_DEGRADED === '1' });
  data.meta.health = {
    ok: health.ok,
    red: health.red.map((i) => `${i.key}: ${i.msg}`),
    warn: health.warn.map((i) => `${i.key}: ${i.msg}`),
  };

  // 评测数据量大（~3MB），拆到 bench.json 按需加载；data.json 只留目录与统计供首屏用
  const benchFull = data.bench;
  // 目录型字段之外一律不进 data.json：`boards` 含全部行的分数（~3 MB），
  // 它只能出现在 bench.json。页面与采集基线都靠 data.bench.file 找到真实文件（F02）。
  data.bench = {
    as_of: benchFull.as_of,
    latest: benchFull.latest,
    groups: benchFull.groups,
    sources: benchFull.sources,
    stats: benchFull.stats,
    catalog: benchFull.catalog,
    file: 'bench.json',
  };
  await writeFile(BENCH_OUT, JSON.stringify(benchFull));
  // 情报：完整条目在 news-archive.json（页面按需拉），data.json 只带索引
  data.news = newsIndex;
  await writeFile(OUT, JSON.stringify(data));
  console.log(JSON.stringify({ ...data.meta, counts: data.meta.counts }, null, 2));
}

/* 只在直接运行本文件时采集；被 import 时（特征测试）不产生任何副作用。 */
const isDirectRun = process.argv[1]?.endsWith('run.js') || process.argv[1]?.endsWith('pipeline/run.js');
if (isDirectRun) {
  main().catch((e) => { console.error('[collect] failed:', e.message); process.exit(1); });
}
