/**
 * Atom 源生成（T4.3 · S5.2）。
 *
 * ## 为什么要 Atom 而不只是页面
 *
 * 变化是**事件流**，不是当前状态。页面只能显示「今天变了什么」，
 * 而读者想「有变化就推给我」——那需要一个可轮询、可订阅的格式。
 *
 * Atom 比 RSS 更适合：`<updated>` 是必填且语义明确，条目 id 用 `tag:` URI
 * 可以做到跨平台唯一。
 *
 * ## 结构必须合规（验收要求）
 *
 * ```
 * <feed xmlns="http://www.w3.org/2005/Atom">
 *   <title/><id/><updated/>            ← 三个必填
 *   <link rel="self" href="..."/>
 *   <link href="..."/>
 *   <entry>
 *     <title/><id/><updated/>          ← 三个必填
 *   </entry>
 * </feed>
 * ```
 */

import { BASE_URL, HOST } from './config.js';

/** Atom 里最多列多少条（全量在 changes/<date>.json）。 */
export const FEED_MAX_ENTRIES = 100;

/** XML 转义。 */
export function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * 生成条目 id。
 *
 * `tag:` URI 是 Atom 推荐的稳定标识：它是 URI，不是 URL，不需要真的可访问。
 * 不能用时间戳——同一件事在两个时刻生成会得到两个 id，读者会看到重复条目。
 *
 * @param {object} e 事件
 * @returns {string}
 */
export function entryId(e) {
  const key = e.id ?? e.domain ?? `${e.boardId || ''}|${e.model || ''}` ?? e.product ?? '';
  return `tag:${HOST},${e.date || '2026'}:changes:${e.type}:${String(key).replace(/[^\w|.:-]/g, '-')}`;
}

/**
 * 生成 Atom XML。
 *
 * @param {object} opt
 * @param {object[]} opt.events 事件（computeChanges 的产出）
 * @param {string} opt.updated 本次生成时刻（ISO 8601）
 * @param {(e: object) => string} opt.describe 事件 → 人类可读标题
 * @param {string} [opt.feedPath] 默认 feeds/changes.xml
 * @returns {string}
 */
export function renderAtom(opt) {
  const { events = [], updated, describe = (e) => e.type, feedPath = 'feeds/changes.xml' } = opt;

  const selfUrl = `${BASE_URL}/${feedPath}`;
  const siteUrl = `${BASE_URL}/`;
  const list = events.slice(0, FEED_MAX_ENTRIES);

  /* feed 级的 <updated> 取「最新事件的时间」，没有事件就用生成时刻。
   * 用它而不是每次的生成时刻：内容没变时 feed 的 updated 不该跳，
   * 否则所有订阅者每天都会收到一次「更新」。 */
  const latest = list.length ? String(list[0].date || updated) : updated;
  const feedUpdated = /^\d{4}-\d{2}-\d{2}$/.test(latest) ? `${latest}T00:00:00Z` : latest;

  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    '  <title>IndexAI · 变化</title>',
    `  <id>tag:${HOST},2026:changes</id>`,
    `  <updated>${escapeXml(feedUpdated)}</updated>`,
    `  <link rel="self" type="application/atom+xml" href="${escapeXml(selfUrl)}"/>`,
    `  <link rel="alternate" type="text/html" href="${escapeXml(siteUrl)}"/>`,
    '  <author><name>IndexAI</name></author>',
    '  <subtitle>模型价格、免费额度、订阅、中转站、评测与活动的变化</subtitle>',
  ];

  for (const e of list) {
    const at = String(e.date || feedUpdated);
    const entryUpdated = /^\d{4}-\d{2}-\d{2}$/.test(at) ? `${at}T00:00:00Z` : at;
    const title = describe(e);
    const link = e.url ? String(e.url) : `${BASE_URL}/`;

    lines.push('  <entry>');
    lines.push(`    <title>${escapeXml(title)}</title>`);
    lines.push(`    <id>${escapeXml(entryId(e))}</id>`);
    lines.push(`    <updated>${escapeXml(entryUpdated)}</updated>`);
    lines.push(`    <link rel="alternate" type="text/html" href="${escapeXml(link)}"/>`);
    lines.push(`    <category term="${escapeXml(e.type)}"/>`);
    lines.push(`    <summary>${escapeXml(title)}</summary>`);
    lines.push('  </entry>');
  }

  lines.push('</feed>');
  return `${lines.join('\n')}\n`;
}
