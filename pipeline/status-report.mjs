/**
 * 数据质量周报（T7.3 · S4.4）。
 *
 * 把 `.data/status/*.ndjson` 的逐次尝试聚合成最近 8 周的趋势：
 * 门禁通过率、匹配率、隔离率、采集数量，以及标注集指标。
 * 状态视图只消费这里产出的纯数据，不在渲染层重算。
 */

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readAttempts, recordAttempt } from '../scripts/data-scripts.mjs';
import { buildUnmatchedReport } from '../lib/unmatch-report.js';

const WEEK_MS = 7 * 864e5;

/** ISO 周的周一（UTC），用作聚合键。 */
export function weekStart(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7; // 周日=7
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

/** 8 个周桶，key 是周一 ISO 日期，label 是 MM-DD。 */
export function weekBuckets(now, weeks = 8) {
  const thisWeek = weekStart(now);
  const out = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const d = new Date(thisWeek.getTime() - i * WEEK_MS);
    out.push({
      key: d.toISOString().slice(0, 10),
      label: d.toISOString().slice(5, 10),
      start: d.toISOString(),
      end: new Date(d.getTime() + WEEK_MS).toISOString(),
    });
  }
  return out;
}

/** 模型名匹配率：只算模型 id，不把评测榜名字混进来。 */
export function modelMatchRateForModels(models) {
  const names = (Array.isArray(models) ? models : []).map((m) => m.id).filter(Boolean);
  if (!names.length) return null;
  try {
    return buildUnmatchedReport([{ source: 'models', names }]).rate;
  } catch {
    return null;
  }
}

function avg(list, key) {
  const vals = list.map((x) => Number(x[key])).filter((n) => Number.isFinite(n));
  return vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(4)) : null;
}

/** 单层的一次尝试是否通过门禁：优先看显式 gate，其次看 status。 */
function gatePass(row) {
  if (row.gate) return row.gate === 'ok';
  return row.status === 'ok';
}

/**
 * 从 attemptsByLayer 聚合周报。
 *
 * @param {Record<string, object[]>} attemptsByLayer
 * @param {{weeks?: object[], labels?: object[]}} [opt]
 */
export function buildWeeklyStatus(attemptsByLayer = {}, opt = {}) {
  const weeks =
    opt.weeks || weekBuckets(opt.now || new Date(opt.nowISO || '1970-01-01T00:00:00Z'), 8);
  const layers = {};
  for (const [layer, rows] of Object.entries(attemptsByLayer)) {
    layers[layer] = weeks.map((w) => {
      const inWeek = (rows || []).filter((r) => {
        const t = Date.parse(r.at || '');
        return Number.isFinite(t) && t >= Date.parse(w.start) && t < Date.parse(w.end);
      });
      return {
        week: w.key,
        label: w.label,
        runs: inWeek.length,
        okRate: inWeek.length
          ? Number((inWeek.filter(gatePass).length / inWeek.length).toFixed(3))
          : 0,
        gateOk: inWeek.length ? inWeek.every(gatePass) : false,
        matchRate: avg(inWeek, 'matchRate'),
        quarantineRate: avg(inWeek, 'quarantineRate'),
        count: avg(inWeek, 'count'),
      };
    });
  }
  return {
    schema: 'status-weekly/v1',
    generated_at: opt.nowISO || opt.now?.toISOString?.() || null,
    weeks: weeks.map((w) => ({ key: w.key, label: w.label })),
    layers,
    labels: opt.labels || [],
  };
}

/**
 * 从 data 目录（`.data` 或 `fixtures/data`）的 status/*.ndjson 生成周报。
 * 没有历史时返回空周数组，页面显示「暂无历史」，不抛错。
 */
export function weeklyStatusFromDir(root, opt = {}) {
  const dir = join(root, 'status');
  const attemptsByLayer = {};
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.ndjson')) continue;
      const layer = name.replace(/\.ndjson$/, '');
      attemptsByLayer[layer] = readAttempts(layer, { root });
    }
  } catch {
    return {
      schema: 'status-weekly/v1',
      generated_at: opt.nowISO || null,
      weeks: [],
      layers: {},
      labels: [],
    };
  }
  return buildWeeklyStatus(attemptsByLayer, opt);
}

/**
 * 把一次 run-report 的每层结果写进 status/*.ndjson（T7.3）。
 * 匹配率只记在 models 层；门禁与隔离率每层都记。
 */
export function recordRunAttempts({ dataDir, report, models }) {
  if (!dataDir || !report?.layers?.length) return;
  const matchRate = modelMatchRateForModels(models);
  for (const r of report.layers) {
    recordAttempt(
      r.id,
      {
        status: r.status,
        count: r.n,
        ms: r.ms,
        error: r.error,
        reason: r.reason,
        gate: report.gate?.[r.id]?.verdict,
        matchRate: r.id === 'models' ? matchRate : undefined,
        quarantineRate: report.quarantine?.[r.id]?.ratio,
      },
      { root: dataDir, at: report.finished_at },
    );
  }
}
