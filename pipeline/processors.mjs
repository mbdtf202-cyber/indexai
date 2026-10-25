/**
 * 数据处理模块（T3.1d Round 4 - R3 合规模块化拆分）。
 *
 * 本模块负责所有 normalize/merge/去重逻辑：
 * - models 去重与优先级选择
 * - offers 去重与条目合并
 * - news archive 合并
 * - subs 统计聚合
 *
 * 与其他模块解耦，只提供纯数据处理函数。
 */

import { todayISO } from '../lib/clock.js';
import { splitGroups, isGrayGroup } from '../lib/relay-groups.js';

/* ==================== MODELS 去重 ==================== */

export function dedupeModels(rows) {
  const byKey = new Map();

  for (const r of rows) {
    if (!r.id || !r.name) continue; // 跳过无效行

    const key = r.channelKind === 'aggregator' ? `or::${r.id}` : `off::${r.vendorId}::${r.id}`;

    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, r);
      continue;
    }

    // 高优先级覆盖低优先级：direct > aggregator
    const rank = { direct: 3, aggregator: 2 };
    if ((rank[r.channelKind] || 0) > (rank[prev.channelKind] || 0)) {
      byKey.set(key, r);
    }
  }

  return { rows: [...byKey.values()], dropped: byKey.size < rows.length };
}

/* ==================== OFFERS 去重 ==================== */

export function dedupeOffers(list) {
  const map = new Map();
  let merged = 0;

  for (const o of list) {
    const key = o.product?.toLowerCase().replace(/\s+/g, '-') || '';
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...o, entries: [...(o.entries || [])] });
      continue;
    }

    merged++;
    const entries = [...new Set([...(prev.entries || []), ...(o.entries || [])])];
    const sources = [...(prev.sources || [prev.source]), ...(o.sources || [o.source])].filter(
      Boolean,
    );

    // high 置信度优先
    const better = (o.conf || '') === 'high' && (prev.conf || '') !== 'high';
    map.set(key, { ...(better ? o : prev), entries, sources });
  }

  return { rows: [...map.values()], merged };
}

/* ==================== NEWS Archive 合并 ==================== */

export function mergeNewsArchive(prev, fresh, options = {}) {
  const { before, after, spanDays, days, bytes } = options;
  const now = todayISO();

  const map = new Map((prev || []).map((x) => [x.url, x]));
  let count = 0;
  const kept = [];

  for (const f of fresh || []) {
    if (!f.url) continue; // 必须有 URL 才能作为唯一键

    const key = f.url.toLowerCase();
    const prevRow = map.get(key);

    if (!prevRow) {
      kept.push(f);
      count += 1;
      map.set(key, f);
      continue;
    }

    // 保留旧摘要（新源可能没有）
    const row = { ...f };
    if (prevRow.summary && !row.summary) {
      row.summary = prevRow.summary;
    }
    map.set(key, row);
  }

  return {
    items: [...map.values()].sort((a, b) => ((b.date || '') > (a.date || '') ? 1 : -1)),
    added: count,
    spanDays,
    days,
    bytes,
    last_updated: now,
  };
}

/* ==================== SUBS 统计 ==================== */

export function subsThirdStats(subsRaw) {
  if (!Array.isArray(subsRaw) || !subsRaw.length) return [];

  // 按产品聚合统计
  const byProduct = new Map();
  for (const s of subsRaw) {
    const p = s.product || 'Unknown';
    const existing = byProduct.get(p) || {
      product: p,
      listings: 0,
      inStock: 0,
      platforms: new Set(),
    };
    existing.listings += 1;
    if (s.status === 'in_stock') {
      existing.inStock += 1;
    }
    if (s.platform) {
      existing.platforms.add(s.platform);
    }
    byProduct.set(p, existing);
  }

  return [...byProduct.values()].map((x) => ({
    ...x,
    platforms: x.platforms.size,
  }));
}

export function subsThirdTotal(subsRaw) {
  if (!Array.isArray(subsRaw) || !subsRaw.length) return { listings: 0 };

  let listings = 0;
  let在售 = 0;

  for (const s of subsRaw) {
    listings += 1;
    if (s.status === 'in_stock') {
      在售 += 1;
    }
  }

  return { listings, 在售 };
}

export default {
  dedupeModels,
  dedupeOffers,
  mergeNewsArchive,
  subsThirdStats,
  subsThirdTotal,
};
