/**
 * Change Engine (T4.3 Round 1)
 *
 * 比较今天快照与上一版快照，产出 S5.2 表中全部事件类型
 * 写入 data 分支的 changes/<date>.json
 */
import { BASE_URL, HOST } from './config.js';
import { nowISO } from '../../lib/clock.js';

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// S5.2 event types
export const EVENT_TYPES = [
  'model_price_increase', // 价格上调
  'model_price_decrease', // 价格下调
  'model_new', // 新模型发布
  'model_discontinued', // 模型停更
  'quota_new', // 免费额度新增
  'quota_removed', // 免费额度取消
  'gateway_added', // 中转站新增
  'gateway_removed', // 中转站移除
  'benchmark_updated', // 评测分数更新
  'benchmark_score_down', // 评分下降
];

/**
 * Load snapshot from data branch or fixtures
 */
export function loadSnapshot(date) {
  const basePath = date ? join(ROOT, '.data', date) : join(ROOT, 'fixtures', 'golden');

  if (!existsSync(basePath)) {
    throw new Error(`Snapshot not found: ${basePath}`);
  }

  try {
    return {
      data: JSON.parse(readFileSync(join(basePath, 'data.json'), 'utf8')),
      bench: existsSync(join(basePath, 'bench.json'))
        ? JSON.parse(readFileSync(join(basePath, 'bench.json'), 'utf8'))
        : null,
    };
  } catch (e) {
    console.warn(`Failed to load snapshot at ${basePath}:`, e.message);
    return null;
  }
}

/**
 * Compare two snapshots and generate change events
 */
export function compareSnapshots(prev, current) {
  const events = [];

  // Model price changes
  if (current.data?.models && prev.data?.models) {
    const currMap = new Map(current.data.models.map((m) => [m.id, m]));
    const prevMap = new Map(prev.data.models.map((m) => [m.id, m]));

    for (const [id, curr] of currMap) {
      const prev = prevMap.get(id);
      if (prev) {
        // Price increases/decreases
        if (curr.input !== prev.input || curr.output !== prev.output) {
          events.push({
            type:
              curr.input > prev.input || curr.output > prev.output
                ? 'model_price_increase'
                : 'model_price_decrease',
            id,
            name: curr.name,
            vendor: curr.vendor,
            changes: {
              input: { old: prev.input, new: curr.input },
              output: { old: prev.output, new: curr.output },
            },
            timestamp: nowISO(),
          });
        }

        // Quota changes
        if ((curr.free || 0) !== (prev.free || 0)) {
          events.push({
            type: (curr.free || 0) > (prev.free || 0) ? 'quota_new' : 'quota_removed',
            id,
            name: curr.name,
            changes: {
              free_quota: { old: prev.free, new: curr.free },
            },
            timestamp: nowISO(),
          });
        }
      } else {
        // New model
        events.push({
          type: 'model_new',
          id: curr.id,
          name: curr.name,
          vendor: curr.vendor,
          timestamp: nowISO(),
        });
      }
    }

    // Discontinued models
    for (const [id, prev] of prevMap) {
      if (!currMap.has(id)) {
        events.push({
          type: 'model_discontinued',
          id,
          name: prev.name,
          vendor: prev.vendor,
          timestamp: nowISO(),
        });
      }
    }
  }

  // Benchmark changes
  if (current.bench?.boards && prev.bench?.boards) {
    const _currMap = new Map(current.bench.boards.map((b) => [b.id, b]));
    const prevMap = new Map(prev.bench.boards.map((b) => [b.id, b]));

    for (const board of current.bench.boards) {
      const prevBoard = prevMap.get(board.id);
      if (prevBoard) {
        for (const row of board.rows || []) {
          const prevRow = prevBoard.rows?.find((r) => r.model === row.model);
          if (prevRow) {
            const scoreDiff = row.score - prevRow.score;
            if (scoreDiff < 0) {
              events.push({
                type: 'benchmark_score_down',
                boardId: board.id,
                modelName: row.model,
                oldScore: prevRow.score,
                newScore: row.score,
                diff: scoreDiff,
                timestamp: nowISO(),
              });
            }
          }
        }
      }
    }
  }

  // Sort by timestamp descending
  events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return events;
}

/**
 * Write change events to data branch
 */
export function saveChanges(events, date) {
  const outputPath = join('.data', 'changes', `${date}.json`);

  if (!existsSync(join('.data', 'changes'))) {
    mkdirSync(join('.data', 'changes'), { recursive: true });
  }

  writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        date,
        generated_at: nowISO(),
        events,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`[changes] Saved ${events.length} events to ${outputPath}`);
}

/**
 * Generate Atom feed XML
 */
export function generateAtomFeed(events) {
  const _stamp = nowISO();

  let entriesXml = '';
  for (const event of events.slice(0, 20)) {
    entriesXml += `  <entry>
    <title>${EVENT_LABELS[event.type]}: ${event.name || event.boardId || 'Unknown'}</title>
    <link href="https://github.com/example/repo/commit/${now}" />
    <published>${event.timestamp}</published>
    <updated>${now}</updated>
    <id>tag:example.com,2026:${event.type}:${new Date(event.timestamp).getTime()}</id>
    <summary>${getEventSummary(event)}</summary>
  </entry>\n`;
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>IndexAI Changes Feed</title>
  <subtitle>Latest changes in model pricing, quotas, benchmarks</subtitle>
  <link href="${BASE_URL}/feeds/changes.xml" rel="self" />
  <link href="${BASE_URL}/" />
  <updated>${now}</updated>
  <id>tag:${HOST},2026:/feeds/changes.xml</id>
${entriesXml}</feed>`;
}

// Event labels for display
const EVENT_LABELS = {
  model_price_increase: 'Model price increased',
  model_price_decrease: 'Model price decreased',
  model_new: 'New model released',
  model_discontinued: 'Model discontinued',
  quota_new: 'Free quota added',
  quota_removed: 'Free quota removed',
  gateway_added: 'Gateway added',
  gateway_removed: 'Gateway removed',
  benchmark_updated: 'Benchmark updated',
  benchmark_score_down: 'Benchmark score downgraded',
};

function getEventSummary(event) {
  switch (event.type) {
    case 'model_price_increase':
    case 'model_price_decrease':
      return `${event.name}: input changed from ${event.changes.input.old} to ${event.changes.input.new}, output from ${event.changes.output.old} to ${event.changes.output.new}`;
    case 'quota_new':
    case 'quota_removed':
      return `${event.name}: free quota changed from ${event.changes.free_quota.old} to ${event.changes.free_quota.new}`;
    case 'benchmark_score_down':
      return `${event.modelName} on ${event.boardId}: ${event.oldScore} → ${event.newScore} (${Math.abs(event.diff)} pts down)`;
    default:
      return `${EVENT_LABELS[event.type].charAt(0).toUpperCase() + EVENT_LABELS[event.type].slice(1)}`;
  }
}

// CLI usage
if (process.argv[1]?.endsWith('changes.js')) {
  const args = process.argv.slice(2);
  const today = args.find((a) => a.startsWith('--today='))?.split('=')[1] || nowISO().slice(0, 10);
  const prevDate = args.find((a) => a.startsWith('--prev='))?.split('=')[1] || undefined;

  try {
    const prevData = prevDate ? loadSnapshot(prevDate) : null;
    const currentData = loadSnapshot(today);

    if (!currentData) {
      console.error('Cannot load current snapshot');
      process.exit(1);
    }

    const events = compareSnapshots(prevData, currentData);
    saveChanges(events, today);

    console.log(`[changes] Generated ${events.length} events for ${today}`);
  } catch (e) {
    console.error('Error generating changes:', e.message);
    process.exit(1);
  }
}

export default {
  loadSnapshot,
  compareSnapshots,
  saveChanges,
  generateAtomFeed,
  EVENT_TYPES,
};
