/**
 * 三份输出的落盘规则（S3.3 分层发布）。
 *
 *   - data.json          全站主数据，bench 只留目录
 *   - bench.json         评测全量（~3 MB，页面按需拉）
 *   - news-archive.json  情报归档（只增不删，data.json 只带索引）
 *
 * 拆出来是因为「怎么算」与「怎么存」是两件事：编排器只产出内存里的对象，
 * 落盘规则（拆文件、瘦身、索引字段名）在这里集中维护。
 */

import { writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * 原子写入（T3.6 · S3.4 · F38）。
 *
 * 先写临时文件，再 `rename` 覆盖目标——`rename` 在同一文件系统内是原子的：
 * 读者要么看到完整的旧文件，要么看到完整的新文件，**不存在半个文件的中间态**。
 *
 * 为什么必须这样：直接 `writeFile` 覆盖时，如果进程在写了一半时被杀
 * （CI 超时、OOM、机器重启），磁盘上就留下一个截断的 JSON，
 * 下一次构建读到它就直接崩——线上站点宁可停在昨天，也不能坏在今天。
 *
 * 临时文件名带 pid 与随机后缀：并发跑两次采集（本机调试 + CI）不会互相踩。
 */
export async function writeFileAtomic(target, content) {
  const tmp = `${target}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, target);
  } catch (e) {
    // 失败就清掉临时文件，别在目录里留垃圾
    await rm(tmp, { force: true });
    throw e;
  }
}

/** 门禁判定结果（T3.6 · S3.4）。 */
export const GATE = {
  OK: 'ok',
  /** 有层失败，但允许降级发布（沿用上一版）。 */
  DEGRADED: 'degraded',
  /** 门禁未过且不允许降级：拒绝写盘。 */
  BLOCKED: 'blocked',
};

/**
 * 判断这次能不能写盘（T3.6 · S3.4）。
 *
 * S3.4 的原话是「只有门禁通过后才写」+「运行中任何阶段都不改动已有快照」。
 * 落到实现上分三种：
 *
 * - **ok**：所有层正常 → 正常写；
 * - **degraded**：有层失败，但失败层已经通过合并策略沿用了上一版（数据是完整的旧版），
 *   其余层是新数据 → 写，但报告里标出来；
 * - **blocked**：有层失败**且没有可沿用的旧数据**（首次运行就挂了）→ 拒绝写，
 *   让磁盘上的旧快照原样留着。宁可停在昨天，也不能把残缺数据推上线。
 *
 * @param {object} report run-report
 * @param {{allowDegraded?: boolean}} [opt]
 * @returns {{verdict: string, failed: string[], reason: string|null}}
 */
export function gateVerdict(report, opt = {}) {
  const layers = report?.layers || [];
  const failed = layers.filter((l) => l.status === 'failed').map((l) => l.id);
  const partial = layers.filter((l) => l.status === 'partial').map((l) => l.id);

  if (!failed.length && !partial.length) return { verdict: GATE.OK, failed: [], reason: null };

  if (opt.allowDegraded) {
    return {
      verdict: GATE.DEGRADED,
      failed,
      reason: `允许降级：${[...failed, ...partial].join(', ')} 沿用上一版`,
    };
  }

  /* 有层失败时，只要它「有上一版可沿用」就还能发布——
   * 合并策略已经把旧数据并进来了，残缺的不是数据而是新鲜度。
   * 这个判断交给调用方（编排器知道 prev 是否存在），这里只报事实。 */
  return {
    verdict: failed.length ? GATE.BLOCKED : GATE.DEGRADED,
    failed,
    reason: failed.length ? `层失败：${failed.join(', ')}` : null,
  };
}

export async function persist(outDir, data, opt = {}) {
  await mkdir(outDir, { recursive: true });

  /* 运行报告单独一个文件（T3.3 · S2.4）：它不是站点数据，是给 CI 与排障看的。
   * 从 data 里取出来后就删掉，绝不进 data.json——那会给页面多一个没人读的字段。
   *
   * 报告**永远写**，哪怕是 blocked——不然 CI 上什么都看不到，排障全靠猜。 */
  const report = data.__runReport || null;
  if (report) {
    delete data.__runReport;
  }

  const gate = report ? gateVerdict(report, opt) : { verdict: GATE.OK, failed: [], reason: null };

  if (gate.verdict === GATE.BLOCKED) {
    /* 拒绝写盘：磁盘上的旧 data.json / bench.json / news-archive.json 原样保留。
     * 只写报告，让 CI 知道发生了什么。 */
    if (report) {
      await writeFileAtomic(
        join(outDir, 'run-report.json'),
        JSON.stringify({ ...report, gate: gate.verdict, gate_reason: gate.reason }, null, 2),
      );
    }
    return { wrote: false, gate: gate.verdict, reason: gate.reason };
  }

  if (report) {
    await writeFileAtomic(
      join(outDir, 'run-report.json'),
      JSON.stringify({ ...report, gate: gate.verdict, gate_reason: gate.reason }, null, 2),
    );
  }

  /* 评测：把 boards 拆进 bench.json，data.json 只留目录与统计（F02）。
   * 页面与采集基线都靠 data.bench.file 找到真实文件。 */
  const benchFull = data.bench;
  if (benchFull && typeof benchFull === 'object') {
    await writeFileAtomic(join(outDir, 'bench.json'), JSON.stringify(benchFull));
    data.bench = {
      as_of: benchFull.as_of,
      latest: benchFull.latest,
      groups: benchFull.groups,
      sources: benchFull.sources,
      stats: benchFull.stats,
      catalog: benchFull.catalog,
      file: 'bench.json',
    };
  }

  /* 情报：完整条目在 news-archive.json，data.json 只带索引。 */
  const archive = Array.isArray(data.news) ? data.news : [];
  if (archive.length) {
    await writeFileAtomic(join(outDir, 'news-archive.json'), JSON.stringify(archive));
  }

  /* 归档条目用短键（encodeNews 的压缩格式）：d=日期 t=标题 u=URL s=摘要 tp=主题。 */
  const byDate = new Map();
  for (const item of archive) {
    const d = String(item?.d ?? item?.date ?? '').slice(0, 10);
    if (d) byDate.set(d, (byDate.get(d) || 0) + 1);
  }
  const days = [...byDate.keys()].sort();

  /* 索引字段名必须与页面契约一致（index.html 的 newsIndex）：
   * n / days / span / first / last / per。写错名字页面会一直当成「归档没到手」，
   * 于是卡在骨架、整个 signals 页永远等下去。 */
  data.news = {
    n: archive.length,
    days: days.length,
    span:
      days.length > 1 ? Math.round((Date.parse(days.at(-1)) - Date.parse(days[0])) / 86400000) : 0,
    first: days[0] || null,
    last: days.at(-1) || null,
    per: Object.fromEntries(byDate),
    bytes: Buffer.byteLength(JSON.stringify(archive), 'utf8'),
    file: 'news-archive.json',
  };

  await writeFileAtomic(join(outDir, 'data.json'), JSON.stringify(data));

  return { wrote: true, gate: gate.verdict, reason: gate.reason };
}
