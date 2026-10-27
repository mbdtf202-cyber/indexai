#!/usr/bin/env node
/**
 * 人工数据结构化（T3.8 · F14 / F15 / F57 · S7）。
 *
 * ## 为什么要补这些字段
 *
 * `curated/*.json` 是手写的。手写数据最大的问题不是「错」，而是**没人知道它有多旧**：
 * 一条「ChatGPT 有免费额度」可能已经失效三个月，页面却照常显示，读者点进去才发现
 * 什么都没有。这比缺数据更伤信任。
 *
 * 所以每条记录必须能回答三个问题：
 *   1. 什么时候核实的？（`verified_at`）
 *   2. 什么时候该再核一次？（`review_by`，核实日 + 90 天）
 *   3. 证据在哪？（`evidence: [{url, quote, captured_at}]`）
 *
 * ## 怎么填
 *
 * `verified_at` 取 git 历史里**该条目最后一次被修改的日期**——这是唯一诚实的来源，
 * 不能拿「今天」凑数（那等于声称今天核实过）。拿不到就退回文件的最后提交日期。
 * `review_by` 一律是 `verified_at + 90 天`，之后由 T6.5 的维护流程滚动更新。
 *
 * ## 用法
 *
 * ```sh
 * node scripts/structure-curated.mjs          # 预览
 * node scripts/structure-curated.mjs --write  # 落盘
 * ```
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CURATED = join(ROOT, 'curated');

/** 每个文件的 schema 版本与记录数组的位置。 */
const FILES = {
  'official-prices.json': { schema: 'curated.official-prices/v1', pick: (d) => d.items ?? d },
  'offers.json': { schema: 'curated.offers/v1', pick: (d) => d.items ?? d },
  'toolkit.json': { schema: 'curated.toolkit/v1', pick: (d) => d.items ?? d },
  'relays.json': { schema: 'curated.relays/v1', pick: (d) => d.relays ?? d.items ?? d },
  'signals.json': { schema: 'curated.signals/v1', pick: (d) => d.items ?? d },
  // milestones 是嵌套结构（epochs[].events[]），记录不在一层数组里：只补 schema 版本
  'milestones.json': { schema: 'curated.milestones/v1', pick: (d) => d.epochs ?? null },
};

/** 复核周期：核实后 90 天。 */
const REVIEW_DAYS = 90;

/** 加天数（纯日期字符串）。 */
function addDays(date, days) {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * 某条目最后一次被修改的日期（git）。
 *
 * 用 `git log -1 --format=%cs -- <file>` 拿文件级的日期；
 * 条目级更精确的做法要解析 patch，收益不抵复杂度——文件级已经足够诚实：
 * 它至少保证「不早于该条目存在的最后一天」。
 *
 * @param {string} rel 相对仓库根的路径
 * @returns {string|null} `YYYY-MM-DD`
 */
function lastCommitDate(rel) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', rel], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * 给一条记录补结构化字段。
 *
 * 已经有的不覆盖——这条脚本是**幂等**的，重复跑不会把核实日期往后推。
 */
function structureRecord(rec, fallbackDate, kind) {
  const verified = rec.verified_at || fallbackDate;
  const out = { ...rec };

  if (!out.verified_at && verified) out.verified_at = verified;
  if (!out.review_by && verified) out.review_by = addDays(verified, REVIEW_DAYS);

  /* evidence：把已有的 `src` / `url` / `source` 提升为结构化证据。
   * 不编造：没有 URL 的条目就留空数组，让页面知道「这条没有出处」。 */
  if (!Array.isArray(out.evidence)) {
    const urls = new Set();
    for (const k of ['src', 'url', 'source', 'buy']) {
      const v = rec[k];
      if (typeof v === 'string' && /^https?:\/\//i.test(v)) urls.add(v);
    }
    for (const v of rec.sources || []) {
      if (typeof v === 'string' && /^https?:\/\//i.test(v)) urls.add(v);
    }
    out.evidence = [...urls].map((url) => ({
      url,
      quote: rec.claim || rec.note || rec.why || '',
      captured_at: verified || null,
    }));
  }

  // 信号层自带 quote/lang，证据就是那条推文
  if (kind === 'signals' && (!out.evidence || !out.evidence.length) && rec.url) {
    out.evidence = [{ url: rec.url, quote: rec.quote || '', captured_at: verified || null }];
  }

  return out;
}

/* ────────────────────────── 主流程 ────────────────────────── */

const write = process.argv.includes('--write');
const report = [];

for (const [file, cfg] of Object.entries(FILES)) {
  const path = join(CURATED, file);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    report.push({ file, skipped: `读不到：${e.message}` });
    continue;
  }

  const kind = basename(file, '.json');
  const fallback = lastCommitDate(`curated/${file}`);
  const isArray = Array.isArray(parsed);
  const rows = cfg.pick(parsed);

  if (!Array.isArray(rows)) {
    report.push({ file, skipped: '找不到记录数组' });
    continue;
  }

  /* milestones 是嵌套结构：记录在 epochs[].events[] 里，已经没有一层数组可补。
   * 它自带顶层 verified_at，这里只补 schema 版本。 */
  if (kind === 'milestones') {
    const next = { schema: cfg.schema, ...parsed };
    if (write) writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
    report.push({
      file,
      schema: cfg.schema,
      records: 0,
      verified: 0,
      withEvidence: 0,
      note: '嵌套结构，只补 schema 版本',
      written: write,
    });
    continue;
  }

  const structured = rows.map((r) => structureRecord(r, fallback, kind));

  let next;
  if (isArray) {
    /* 顶层是数组的文件：要升格成 {schema, items} 才能带版本号。
     * 直接写回数组会让 schema 无处可放（第一版就是这么漏的）。 */
    next = { schema: cfg.schema, items: structured };
  } else {
    next = { ...parsed };
    for (const k of ['items', 'relays', 'apps']) {
      if (Array.isArray(parsed[k])) next[k] = structured;
    }
    // schema 版本放最前（人读文件时第一眼能看到）
    next = { schema: cfg.schema, ...next };
  }

  if (write) {
    writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`);
  }

  const verifiedCount = structured.filter((r) => r.verified_at).length;
  const evidenceCount = structured.filter((r) => r.evidence?.length).length;
  report.push({
    file,
    schema: cfg.schema,
    records: structured.length,
    verified: verifiedCount,
    withEvidence: evidenceCount,
    fallbackDate: fallback,
    written: write,
  });
}

console.log(JSON.stringify(report, null, 2));
if (!write) {
  console.log('\n（预览模式。加 --write 才会落盘）');
}
