#!/usr/bin/env node
/**
 * 把 run-report.json 渲染成 GitHub job summary（T3.3 · S2.4）。
 *
 * 为什么单独一个脚本：workflow 里内联一段 shell + node -e 的嵌套引号
 * 几乎没法维护，也不好在本地试跑。这里读文件、写 markdown 到 stdout，
 * workflow 只负责重定向到 `$GITHUB_STEP_SUMMARY`。
 *
 * 用法：`node scripts/summarize-run.mjs [run-report.json]`
 */

import { readFileSync } from 'node:fs';

const path = process.argv[2] || 'run-report.json';

let report;
try {
  report = JSON.parse(readFileSync(path, 'utf8'));
} catch (e) {
  console.log(`> 读不到 \`${path}\`：${e.message}`);
  process.exit(0);
}

const STATUS_LABEL = {
  ok: '✅ ok',
  stale: '⚠️ stale',
  partial: '⏱ partial',
  failed: '❌ failed',
};

const lines = [];
lines.push('## 采集运行报告');
lines.push('');
lines.push(
  `${report.profile} · 耗时 ${(report.duration_ms / 1000).toFixed(1)}s / 截止 ${
    report.deadline_ms / 60000
  } 分钟${report.over_deadline ? ' · **已超截止**' : ''}`,
);
lines.push('');
lines.push('| 层 | 状态 | 条数 | 耗时 |');
lines.push('|---|---|---:|---:|');

for (const l of report.layers) {
  const note = l.error ? `（${l.error}）` : l.reason ? `（${l.reason}）` : '';
  lines.push(
    `| ${l.id} | ${STATUS_LABEL[l.status] || l.status} | ${l.n} | ${l.ms}ms${note ? ' ' + note : ''} |`,
  );
}

lines.push('');
lines.push(
  `**总计**：ok ${report.totals.ok} · stale ${report.totals.stale} · partial ${report.totals.partial} · failed ${report.totals.failed}`,
);

if (report.net) {
  lines.push('');
  lines.push(
    `**网络**：${report.net.requests} 次请求 / ${report.net.hosts} 个主机 / ` +
      `${(report.net.bytes / 1024 / 1024).toFixed(1)} MB / 重试 ${report.net.retries ?? 0} / 被限流 ${report.net.throttled ?? 0}`,
  );
}

/* 隔离明细（T3.5）：只在真的有隔离时才出这一段。
 * 一两行脏数据是源站常态，报告里不显眼地记一笔即可；
 * 超过阈值的层已经在上面的表里标成 failed 了。 */
const q = report.quarantine || {};
const quarantined = Object.entries(q).filter(([, v]) => v.quarantined > 0);
if (quarantined.length) {
  lines.push('');
  lines.push('### 坏行隔离');
  lines.push('');
  lines.push('| 层 | 隔离 / 总数 | 比例 | 阈值 | 样例 |');
  lines.push('|---|---:|---:|---:|---|');
  for (const [id, v] of quarantined) {
    const pct = (v.ratio * 100).toFixed(1) + '%';
    const cap = (v.threshold * 100).toFixed(0) + '%';
    const sample = (v.samples || [])
      .slice(0, 2)
      .map((s) => `\`${s.id}\`：${s.reasons[0]}`)
      .join('；');
    lines.push(`| ${id} | ${v.quarantined} / ${v.total} | ${pct} | ${cap} | ${sample} |`);
  }
}

// 有 failed 就显式提醒：旧数据比坏数据好，别急着发布
if (report.totals.failed > 0) {
  lines.push('');
  lines.push('> ⚠️ 有层彻底失败。线上仍是上一版（残缺不覆盖，INV-1）。');
}

console.log(lines.join('\n'));
