/**
 * Devpost 黑客松源（从 `41dec66:collect.mjs` 原样搬出）。
 *
 * 必须按 status 分组全翻。实测 2026-10-24：
 *   status[]=open     meta.total_count=59   每页被服务器压到 9 条  → 需 7 页
 *   status[]=upcoming meta.total_count=133  每页 9 条              → 需 15 页
 * 旧实现只拉 open、且只翻 5 页，实收 45 条，另外 133 个未开始的活动一条没进。
 */

import { httpJson } from '../../lib/http.js';
import { sleep } from '../../lib/clock.js';
import { parseDevpostDates } from '../../lib/devpost-dates.js';
import { eventStatus } from '../../lib/event-classify.js';
import { keepSafeUrl } from '../../lib/safe-url.js';

const TEST_PROFILE = String(process.env.INDEXAI_PROFILE || '').toLowerCase() === 'test';
const EV_DEVPOST_STATUS = ['open', 'upcoming'];
const EV_DEVPOST_MAX_PAGES = TEST_PROFILE ? 2 : 40;

async function devpostPage(status, page, attempt = 0) {
  const url = `https://devpost.com/api/hackathons?status[]=${status}&limit=24&page=${page}`;
  try {
    return await httpJson(url, { label: `devpost/${status}/p${page}` });
  } catch (e) {
    // 翻到深页偶发 5xx/超时，退避重试一次，别把整页数据丢掉
    if (attempt < 2) {
      await sleep(400 * (attempt + 1));
      return devpostPage(status, page, attempt + 1);
    }
    throw e;
  }
}

export async function fetchDevpost() {
  const all = [];
  const stats = {};
  for (const status of EV_DEVPOST_STATUS) {
    let total = null;
    let got = 0;
    for (let page = 1; page <= EV_DEVPOST_MAX_PAGES; page += 1) {
      let j;
      try {
        j = await devpostPage(status, page);
      } catch (e) {
        console.warn(`[collect] devpost ${status} p${page} 放弃：${e.message}`);
        break;
      }
      if (total == null && Number.isFinite(j?.meta?.total_count))
        total = Number(j.meta.total_count);
      const list = j?.hackathons || [];
      if (!list.length) break;
      all.push(...list);
      got += list.length;
      // 收满 total_count 就停；total 缺失时靠 entries 为空自然结束
      if (total != null && got >= total) break;
    }
    stats[status] = { total, got };
  }
  console.log(
    `[collect] devpost 分状态：${Object.entries(stats)
      .map(([k, v]) => `${k} ${v.got}/${v.total ?? '?'}`)
      .join(' · ')}`,
  );

  const seen = new Set();
  return all
    .filter((h) => {
      if (!h?.id || seen.has(h.id)) return false;
      seen.add(h.id);
      return true;
    })
    .map((h) => {
      const d = parseDevpostDates(h.submission_period_dates);
      const row = {
        id: `devpost-${h.id}`,
        title: h.title,
        url: h.url,
        dates: h.submission_period_dates,
        start: d.start,
        end: d.end,
        location: h.displayed_location?.location || '线上',
        org: h.organization_name || '',
        prize: h.prize_amount
          ? String(h.prize_amount)
              .replace(/<[^>]+>/g, '')
              .replace(/\s+/g, ' ')
              .trim()
          : null,
        regs: h.registrations_count || 0,
        themes: (h.themes || []).map((t) => t.name),
        source: 'Devpost',
      };
      // 摘要：源里没有正文字段，用「主题 + 奖池 + 报名数」拼一条可读的一句话，前端只展示一行
      row.summary = devpostSummary(row);
      row.status = eventStatus(row); // 按日期判，不再一律 open
      row.url = keepSafeUrl(row.url, 'event:devpost');
      return row;
    });
}

/* Devpost 的 API 不返回描述正文，能代表“这场活动是什么”的只有 themes / prize / regs。
 * 拼成一句话，长度控制在 280 字符内，跟 Luma 的 summary 字段同形态。 */
function devpostSummary(row) {
  const bits = [];
  if (row.regs) bits.push(`${row.regs.toLocaleString('en-US')} 人已报名`);
  if (row.prize) bits.push(`奖池 ${row.prize}`);
  const th = (row.themes || []).filter(Boolean).slice(0, 4);
  if (th.length) bits.push(th.join(' / '));
  const s = bits.join(' · ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 280) : null;
}
