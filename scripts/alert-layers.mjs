#!/usr/bin/env node
/**
 * 按层跑告警决策（T4.2 · S4.2）。
 *
 * ## 与旧做法的区别
 *
 * 旧 workflow 里「失败告警」是：采集失败就开一个「采集失败：2026-10-27」的 issue。
 * 三个问题：
 *   1. **按日期开**——同一个问题连挂三天就开三个 issue，没人关联得起来；
 *   2. **不区分层**——评测层挂了与情报层挂了是两件事，修法完全不同；
 *   3. **不会自己关**——修好了也没人关，越积越多，最后没人看。
 *
 * 现在：读 `status/<layer>.ndjson`，按层判「连续两次异常」，开或追加
 * 带 `layer:<id>` 标签的 issue；恢复后自动评论并关闭。
 *
 * ## 用法
 *
 * ```sh
 * node scripts/alert-layers.mjs --root .data [--dry-run]
 * ```
 *
 * 需要 `GH_TOKEN` 才能真的操作 issue；`--dry-run` 只打印决策。
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { readAttempts, dataRoot } from './data-scripts.mjs';
import {
  decideAlert,
  alertIssueMeta,
  alertBody,
  ALERT_ACTION,
} from '../pipeline/alerts/decision.mjs';

const args = process.argv.slice(2);
const rootAt = args.indexOf('--root');
const root = rootAt >= 0 ? args[rootAt + 1] : undefined;
const dryRun = args.includes('--dry-run');

/** 跑一条 gh 命令，失败返回 null（不中断整轮——一个层出错不该拖垮其它层）。 */
function gh(argv) {
  try {
    return execFileSync('gh', argv, { encoding: 'utf8' }).trim();
  } catch (e) {
    console.warn(`[alert] gh ${argv.slice(0, 2).join(' ')} 失败：${e.message.split('\n')[0]}`);
    return null;
  }
}

/** 查某层有没有未关闭的告警 issue，返回编号或 null。 */
function findOpenIssue(layer) {
  const out = gh([
    'issue',
    'list',
    '--label',
    `layer:${layer}`,
    '--state',
    'open',
    '--json',
    'number',
    '--jq',
    '.[0].number // empty',
  ]);
  if (!out) return null;
  const n = Number(out);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* 1. 找出所有有状态日志的层。 */
const statusDir = join(dataRoot(root), 'status');
if (!existsSync(statusDir)) {
  console.log('[alert] 没有状态日志，跳过');
  process.exit(0);
}

const layers = readdirSync(statusDir)
  .filter((f) => f.endsWith('.ndjson'))
  .map((f) => f.replace(/\.ndjson$/, ''))
  .sort();

console.log(`[alert] ${layers.length} 层：${layers.join(', ')}`);

/* 2. 逐层决策。 */
const decisions = [];

for (const layer of layers) {
  const history = readAttempts(layer, { root });
  const openIssue = dryRun ? null : findOpenIssue(layer);
  const decision = decideAlert({ history, openIssue, layer });
  decisions.push(decision);

  if (decision.action === ALERT_ACTION.NONE) continue;

  console.log(`[alert] ${layer}: ${decision.action} — ${decision.reason}`);

  if (dryRun) continue;

  const { labels, title } = alertIssueMeta(layer);
  const body = alertBody(decision);

  if (decision.action === ALERT_ACTION.OPEN) {
    const out = gh([
      'issue',
      'create',
      '--title',
      title,
      '--body',
      body,
      '--label',
      labels.join(','),
    ]);
    if (out) console.log(`[alert] 已开 issue：${out}`);
  } else if (decision.action === ALERT_ACTION.APPEND) {
    gh(['issue', 'comment', String(openIssue), '--body', body]);
    console.log(`[alert] 已追加到 #${openIssue}`);
  } else if (decision.action === ALERT_ACTION.CLOSE) {
    gh(['issue', 'comment', String(openIssue), '--body', `已恢复。\n\n${body}`]);
    gh(['issue', 'close', String(openIssue)]);
    console.log(`[alert] 已关闭 #${openIssue}`);
  }
}

/* 3. 汇总（写进 job summary）。 */
const summary = decisions
  .filter((d) => d.action !== ALERT_ACTION.NONE)
  .map((d) => `- \`${d.layer}\`：${d.action} — ${d.reason}`);

if (summary.length) {
  console.log('');
  console.log('## 分层告警');
  console.log('');
  for (const s of summary) console.log(s);
} else {
  console.log('[alert] 所有层都正常，无需操作');
}
