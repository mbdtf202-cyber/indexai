/**
 * 中转站价目探测（从 `41dec66:collect.mjs` 原样搬出）。
 *
 * 只探测、只解析：超时与重定向由 `lib/http.js` 负责（INV-8、INV-14），
 * 价格语义由 `lib/relay-pricing.js` 负责，这里只做「请求 → 归一」的粘合。
 */

import { httpGet } from '../../lib/http.js';
import { todayISO } from '../../lib/clock.js';
import {
  FLAGSHIP,
  pickFlagship,
  groupRatioTable,
  rowGroups,
  relayPrice,
  parseJsonLoose,
} from '../../lib/relay-pricing.js';

export async function probeRelay(entry) {
  const url = `https://${entry.domain}/api/pricing`;
  try {
    // 部分站 /api/pricing 301 到另一个域（如 aigcbest → api2.aigcbest.top）：
    // 跟随由 lib/http.js 负责，且每一跳都过协议校验（INV-14）。
    const res = await httpGet(url, {
      timeoutMs: 9000,
      tries: 2,
      backoffMs: 300,
      label: `relay/${entry.domain}`,
    });
    if (!res.ok) return { ...entry, status: `http_${res.status}`, url };
    const text = await res.text();
    const j = parseJsonLoose(text);
    const rows = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
    if (!rows.length) return { ...entry, status: 'no_pricing', url };

    const gTable = groupRatioTable(j);
    const gValues = gTable ? [...new Set(Object.values(gTable))].sort((a, b) => a - b) : [];
    const models = new Set();
    for (const r of rows) {
      const n = r.model_name || r.modelName || r.id;
      if (n) models.add(n);
    }

    const prices = {};
    const flagPicked = [];
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
        return pr && pr.kind === 'per_1m' && nm
          ? { n: nm, i: pr.input, o: pr.output, c: pr.comp }
          : null;
      })
      .filter(Boolean)
      // 同价时按模型名排序：否则 samples 顺序随源端返回顺序漂移（INV-7）
      .sort((a, b) => a.i - b.i || (a.n < b.n ? -1 : a.n > b.n ? 1 : 0));
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
      groups: gTable
        ? {
            count: Object.keys(gTable).length,
            min: gValues[0],
            max: gValues[gValues.length - 1],
            spread:
              gValues.length > 1
                ? Number((gValues[gValues.length - 1] / gValues[0]).toFixed(1))
                : 1,
            names: Object.keys(gTable).slice(0, 40),
          }
        : null,
      checked_at: todayISO(),
    };
  } catch (e) {
    // 超时由 lib/http.js 统一转换：TimeoutError 直接标 timeout，其余算 unreachable
    const timedOut =
      e.name === 'TimeoutError' || e.name === 'AbortError' || /超时/.test(e.message || '');
    return { ...entry, status: timedOut ? 'timeout' : 'unreachable', url };
  }
}
