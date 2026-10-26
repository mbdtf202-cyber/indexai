/**
 * Luma 公开发现流（从 `41dec66:collect.mjs` 原样搬出）。
 *
 * 这个源是**有状态封禁**：429 之后继续试探会把解封时间往后推（实测 +180s 才恢复）。
 * 因此必须：
 *   - 冷却累计有上限（6 分钟），超了就停手，不再睡；
 *   - geo 循环有总预算（8 分钟），超了用已采到的部分继续，不抛错；
 *   - 受阻后不再发起任何新请求，并把原因写进 meta。
 *
 * 查询/城市表与 AI 词表在 `luma-config.mjs`（配置与逻辑分开放）。
 */

import { httpGet } from '../../lib/http.js';
import { sleep, mark, since } from '../../lib/clock.js';
import { eventStatus } from '../../lib/event-classify.js';
import {
  AI_EVENT_RE,
  EV_LUMA_CITIES,
  EV_LUMA_CITY_BY_SLUG,
  EV_LUMA_GEO_QUERIES,
  EV_LUMA_CONCURRENCY,
  EV_LUMA_QUERIES,
} from './luma-config.mjs';

export { AI_EVENT_RE };

const TEST_PROFILE = String(process.env.INDEXAI_PROFILE || '').toLowerCase() === 'test';

const LUMA_QUERIES = TEST_PROFILE ? EV_LUMA_QUERIES.slice(0, 2) : EV_LUMA_QUERIES;
const LUMA_CITIES = TEST_PROFILE ? EV_LUMA_CITIES.slice(0, 1) : EV_LUMA_CITIES;
const LUMA_GEO_QUERIES = TEST_PROFILE ? EV_LUMA_GEO_QUERIES.slice(0, 2) : EV_LUMA_GEO_QUERIES;

const EV_LUMA_COOLDOWN_MS = 180000; // 实测封禁约 3 分钟才解
const EV_LUMA_MAX_RETRY = 3;

/* 请求计数器与限速观测点。
 * 验收要报「总请求数」，逐次累加而不是事后估算。
 * blocked/最长冷却单独记账：这个源是**有状态封禁**，哪天它把阈值调紧，
 * 我们要能从 meta.collect 里立刻看出来，而不是等条数掉了再回头排查。 */
/* 单主机冷却总上限（F04、S2.3）。
 * 实测封禁约 3 分钟解封；但旧逻辑按 attempt 递增（180s→360s→540s→720s），
 * 一次请求就能睡掉 12 分钟，比整层的 8 分钟预算还长——最后睡完还不重试，纯浪费。
 * 现在：本次运行累计冷却一旦会超过这个上限，就不再睡、直接标受阻返回，
 * 让「已采到的部分」照常发布，并把原因写进 meta.net。 */
const EV_LUMA_COOLDOWN_CAP_MS = 6 * 60 * 1000; // 6 分钟

/* geo 循环的总预算：宁可少采几个城市，也不能让整次 collect 挂在网络里。
 * 正常跑满 216 次 × 900ms ≈ 195s；预留一倍余量。一旦撞到多次 429 把冷却叠起来，
 * 超预算就中断剩余城市、用已有结果继续，并把「未采完」如实记进 meta。
 * 这里不抛错 —— 抛错会让整层走 stale 丢掉本次已采到的新城市数据，那是更糟的结果。 */
const EV_LUMA_GAP_MS = 900;

const EV_LUMA_GEO_BUDGET_MS = 480000; // 8 分钟

const netStat = { requests: 0, blocked: 0, maxCooldownMs: 0 };

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
    if (gap) await lumaSleep(gap); // 请求前睡，保证任意两次之间都有间隔
    try {
      netStat.requests += 1;
      // tries: 1：429 的退避由本函数按 Luma 的实测冷却曲线处理，
      // 客户端再自动重试只会把封禁时间往后推（见上方限速注释）。
      const res = await httpGet(url, {
        tries: 1,
        deadline: geoStart ? geoStart + EV_LUMA_GEO_BUDGET_MS : undefined,
        label: `luma/${q}`,
      });
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
        console.warn(
          `[collect] luma ${res.status}（${geo ? geo.slug : '无geo'} / ${q}），冷却 ${Math.round(wait / 1000)}s 后第 ${attempt + 1} 次重试`,
        );
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
    await Promise.all(
      Array.from({ length: Math.min(EV_LUMA_CONCURRENCY, LUMA_QUERIES.length) }, worker),
    );
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
      if (aborted) {
        citiesSkipped.push(city.slug);
        continue;
      }
      let cityNew = 0;
      for (const q of LUMA_GEO_QUERIES) {
        // 两道刹车：预算用超了，或者源已经把我们挡住了（受阻后继续请求只会延长封禁）
        if (since(geoStart) > EV_LUMA_GEO_BUDGET_MS) {
          aborted = true;
          break;
        }
        if (lumaState.blocked) {
          aborted = true;
          break;
        }
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
      if (aborted) {
        citiesSkipped.push(city.slug);
        break;
      }
      citiesDone.push(city.slug);
      geoHits += cityNew;
      if (cityNew) console.log(`[collect] luma geo ${city.slug} +${cityNew}（累计 ${byId.size}）`);
    }
    const geoMs = since(geoStart);
    const stopNote = lumaState.blocked ? ` · 受阻停止：${lumaState.reason}` : '';
    console.log(
      `[collect] luma geo ${citiesDone.length}/${LUMA_CITIES.length} 城完成 · 新增 ${geoHits} 条 · 耗时 ${(geoMs / 1000).toFixed(0)}s${citiesSkipped.length ? ` · 未采完 ${citiesSkipped.length} 城` : ''}${stopNote}`,
    );

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
      const addressText = [
        ev.geo_address_info?.city,
        ev.geo_address_info?.country,
        ev.geo_address_info?.address,
      ]
        .filter(Boolean)
        .join(' ');
      // calendar 名照旧参与匹配（现在为空，但源一旦补上就能自动生效）
      const hay = `${name} ${cal} ${addressText}`;
      if (!re.test(hay)) continue;
      const start = String(ev.start_at || '').slice(0, 10);
      const geo = ev.geo_address_info || {};
      const cityFallback = ev.__geoCity ? EV_LUMA_CITY_BY_SLUG.get(ev.__geoCity) : null;
      const row = {
        id: `luma-${ev.api_id}`,
        title: name,
        url: `https://luma.com/${ev.url}`,
        dates: start,
        start,
        end: String(ev.end_at || '').slice(0, 10),
        // 城市 + 国家都留着：eventRegion 要按国家判，只存城市名会让东京/首尔的场次落 other
        location:
          ev.location_type === 'online'
            ? '线上'
            : [geo.city || geo.region, geo.country].filter(Boolean).join(', ') || '线下',
        org: ev.calendar?.name || 'Luma',
        prize: null,
        regs: ev.guest_count || 0,
        themes: [],
        source: 'Luma',
        // region 的两个权威来源，按可信度排：country_code 直接来自源，最准；
        // 城市兜底只在「源没给国家」时用，且必须明确标出来，方便事后核查。
        countryCode: geo.country_code || null,
        geoCityFallback: !geo.country_code && cityFallback ? cityFallback.region : null,
      };
      // 发现流条目**不含 description/summary 字段**（2026-10-24 实测：event 对象里
      // 没有 description、description_mirror，/event/get 详情接口对发现流的 api_id 返回 400）。
      // 所以没有正文可截，summary 置 null，前端遇到 null 就不渲染那一行，别造假数据。
      row.summary = null;
      row.status = eventStatus(row); // 按日期判
      out.push(row);
    }
    console.log(
      `[collect] luma 无geo ${LUMA_QUERIES.length} 词 → ${noGeoCount} 条 · 加 geo ${LUMA_CITIES.length} 城 → 去重 ${byId.size} 条 → AI 过滤后 ${out.length} 条${failedQueries ? `（${failedQueries} 个查询无结果）` : ''}`,
    );
    return out;
  } catch (e) {
    console.error(`[collect] luma 失败：${e.message}`);
    return [];
  }
}
