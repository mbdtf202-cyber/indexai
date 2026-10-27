/**
 * subs 层：官方订阅档位、区价与第三方挂单统计（T3.1c6）。
 *
 * 这一层从两个上游 JSON 派生三种形状完全不同的产物：
 * - `subs`：官方档位，一档一行（只有拿到美国区明码才进这一层）
 * - `subsRegions`：区价对比，每个套餐保留最便宜的若干国家 + 美国区
 * - `subsThird`：第三方挂单**只出统计**（D3：不给商品页链接）
 *
 * 三者共用一个源、一次请求，但产出互不相干；放在同一层是因为
 * 「官方价与挂单价的口径必须一起变」——分开写很容易一边改了另一边忘。
 */

import { normalizeVendor } from '../../../lib/vendors.js';

/* 厂商归一交给 registry/vendors.json（T4.4）。
 * 曾经这里是四条硬编码（chatgpt/claude/gemini/grok），新增一个订阅产品
 * 就得改代码，而且与页面的 VENDOR_RANK 各自维护。 */

const SUB_NOTE = {
  chatgpt: 'App Store 美国区内购价；网页版可能另有年付折扣',
  claude: 'App Store 美国区内购价；官网另有年付 17% 折扣',
  gemini: 'Google One AI 套餐，经 App Store 美国区购买',
  grok: 'X Premium+ 内的 Grok 档位，美国区定价',
};

export default {
  id: 'subs',
  sources: ['data.aibijia.org/apple_subscriptions.json', 'data.aibijia.org/products.json'],
  /** 合并策略（T3.6 · S3.3）：目录型（S3.3）：本次没拿到的条目沿用上一版并记 lastOk，超过 TTL 才移除。 */
  mergeStrategy: 'catalog',

  budget: { ms: 60_000, requests: 2 },

  /**
   * 抓两个源。任一成功即算有值——订阅与挂单可以分别降级。
   * @param {{http: {get: Function}, urls: {prod: string, apple: string}, log: Function}} ctx
   */
  async fetch(ctx) {
    const get = async (u) => {
      try {
        const r = await ctx.http.get(u, { label: 'aibijia' });
        if (!r.ok) {
          ctx.log(`aibijia ${u} → HTTP ${r.status}`, { level: 'warn' });
          return null;
        }
        return await r.json();
      } catch (e) {
        ctx.log(`aibijia ${u} 失败：${e.message}`, { level: 'warn' });
        return null;
      }
    };
    const [prod, apple] = await Promise.all([get(ctx.urls.prod), get(ctx.urls.apple)]);
    return { prod, apple };
  },

  /**
   * 派生三种产物。全部是纯变换——没有网络、没有文件、没有时钟
   * （汇率折算 `cny` 由编排器在拿到 fx 之后补，那是跨层的顺序依赖，不属于本层）。
   *
   * @param {{prod: object|null, apple: object|null}} raw
   * @param {{subsThirdStats: Function}} ctx
   */
  normalize(raw, ctx) {
    const subs = buildSubs(raw?.apple);
    const subsRegions = buildSubsRegions(raw?.apple);
    // 挂单：原始行只在这里存在，出去的是统计（D3）
    const subsThird = ctx.subsThirdStats(flattenOffers(raw?.prod));
    return {
      records: { subs, subsRegions, subsThird },
      quarantined: [],
    };
  },

  /**
   * 合并：三种产物各自沿用。
   *
   * 注意三者**分别判断**：订阅拉到了但挂单没拉到，不该让挂单也跟着变成整份旧值。
   *
   * @param {{subs?: object[], subsRegions?: object[], subsThird?: object[]}|null} prev
   * @param {{subs: object[], subsRegions: object[], subsThird: object[]}} next
   */
  merge(prev, next) {
    const pick = (key, mark) => {
      const fresh = next?.[key] || [];
      if (fresh.length) return fresh;
      const old = prev?.[key] || [];
      // 沿用时不改形状，只在编排器侧记 stale：这一层没有单条记录的 lastSeen
      return mark && old.length ? old : old;
    };
    return {
      subs: pick('subs'),
      subsRegions: pick('subsRegions'),
      subsThird: pick('subsThird'),
    };
  },

  /** 门禁：官方档位为空说明苹果源整体失败。 */
  health: {
    floor: null,
    shrink: null,
    freshness: null,
    rules: [
      {
        id: 'subs-not-empty',
        /* 门禁收到的是行数组（pipeline/manifest.mjs 统一传入）；
         * normalize 的产物是 {subs, subsThird, subsRegions}。两种形状都认。 */
        check: (v) => {
          const n = Array.isArray(v) ? v.length : (v?.subs?.length ?? 0);
          if (!n) return { level: 'warn', message: '没有任何官方档位' };
          return { level: 'ok' };
        },
      },
    ],
  },
};

/**
 * 官方订阅档位：从苹果区价里取美国区价格，一档一行。
 *
 * 这是「官网写多少就是多少」里唯一能自动化且可复核的口径——App Store 商品页是公开明码。
 * 拿不到美国区价格的档位直接跳过，不猜价、不用历史值填。
 */
function buildSubs(apple) {
  if (!apple) return [];
  const out = [];
  for (const app of apple.apps || []) {
    /* slug 当成可能的别名去查表；认不出来时留空（不猜，也不当成新厂商）。 */
    const vendorName = normalizeVendor(app.slug || app.title || '');
    const vendor = vendorName.matched ? vendorName.name : '';
    for (const plan of app.plans || []) {
      const us = (plan.regions || []).find((r) => r.country_code === 'US');
      if (!us || !(Number(us.price_value) > 0)) continue;
      const tier =
        String(plan.label || plan.slug || '')
          .replace(new RegExp(`^${app.display_name}\\s*`, 'i'), '')
          .trim() || plan.label;
      out.push({
        id: `${app.slug}-${plan.slug}`,
        product: app.display_name,
        productSlug: app.slug,
        vendor,
        tier,
        price: Number(us.price_value),
        currency: us.currency_code || 'USD',
        period: plan.duration_label || '1月',
        buy: us.app_store_url || '',
        quota: '',
        note: SUB_NOTE[app.slug] || '',
        source: 'apple',
        checked: (us.fetched_at || '').slice(0, 10) || null,
      });
    }
  }
  return out.sort((a, b) => a.product.localeCompare(b.product) || a.price - b.price);
}

/** 区价：每个套餐保留最便宜的若干国家，且美国区必须在里面（它是官方价的锚）。 */
function buildSubsRegions(apple) {
  if (!apple) return [];
  const out = [];
  for (const app of apple.apps || []) {
    for (const plan of app.plans || []) {
      const rs = (plan.regions || [])
        .filter((r) => Number(r.cny_price) > 0)
        .sort((a, b) => a.cny_price - b.cny_price);
      if (!rs.length) continue;
      const keep = rs.slice(0, 10);
      const us = rs.find((r) => r.country_code === 'US');
      if (us && !keep.includes(us)) keep.push(us);
      out.push({
        app: app.display_name,
        appSlug: app.slug,
        plan: plan.label,
        planSlug: plan.slug,
        duration: plan.duration_label || '',
        total: rs.length,
        cheapest: Number(Number(rs[0].cny_price).toFixed(2)),
        priciest: Number(Number(rs[rs.length - 1].cny_price).toFixed(2)),
        rows: keep.map((r) => ({
          c: r.country_code,
          n: r.country_label,
          cur: r.currency_code,
          p: r.price_text,
          cny: Number(Number(r.cny_price).toFixed(2)),
          url: r.app_store_url,
        })),
      });
    }
  }
  return out;
}

/**
 * 第三方挂单的**扁平化**：只保留统计需要的字段，商品页 url 在这一步就丢掉（D3 · F49）。
 *
 * 返回的是原始挂单数组（单个产品多条），聚合发生在 subsThirdStats 里。
 * 这样「原始挂单」始终只存在于本层内部，不会被误带进 data.json。
 */
function flattenOffers(prod) {
  if (!prod) return [];
  const rows = [];
  for (const p of prod.products || []) {
    for (const o of p.offers || []) {
      // 没有价格或没有链接的挂单不参与统计：前者无从比较，后者无从核实
      if (!o.url || o.price == null) continue;
      rows.push({
        product: p.name,
        platform: o.platform_name || '',
        price: Number(o.price),
        status: o.status || 'unknown',
      });
    }
  }
  return rows;
}
