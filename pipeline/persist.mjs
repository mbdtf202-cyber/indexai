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

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

export async function persist(outDir, data) {
  await mkdir(outDir, { recursive: true });

  /* 运行报告单独一个文件（T3.3 · S2.4）：它不是站点数据，是给 CI 与排障看的。
   * 从 data 里取出来后就删掉，绝不进 data.json——那会给页面多一个没人读的字段。 */
  if (data.__runReport) {
    await writeFile(
      join(outDir, 'run-report.json'),
      JSON.stringify(data.__runReport, null, 2),
      'utf8',
    );
    delete data.__runReport;
  }

  /* 评测：把 boards 拆进 bench.json，data.json 只留目录与统计（F02）。
   * 页面与采集基线都靠 data.bench.file 找到真实文件。 */
  const benchFull = data.bench;
  if (benchFull && typeof benchFull === 'object') {
    await writeFile(join(outDir, 'bench.json'), JSON.stringify(benchFull), 'utf8');
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
    await writeFile(join(outDir, 'news-archive.json'), JSON.stringify(archive), 'utf8');
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

  await writeFile(join(outDir, 'data.json'), JSON.stringify(data), 'utf8');
}
