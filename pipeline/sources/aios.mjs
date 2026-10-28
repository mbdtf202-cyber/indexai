/**
 * AIOS 本地活动库（从 `41dec66:collect.mjs` 原样搬出）。
 *
 * 可选层：**只认环境变量** `AIOS_OPPORTUNITIES`。
 * 旧实现带一串写死的候选路径（含带用户名的 Desktop 绝对路径）外加一个最多扫 400 个
 * 目录的递归查找，等于把某台机器的目录结构焊进了采集器：换机器必定静默丢整层，
 * 别人的机器上还要白扫一遍 Desktop（F50）。
 *
 * 现在只认显式环境变量；没设就跳过这一源，并在日志里说清是「没配置」而不是「读失败」。
 * CI 本来就没有这个文件，跳过是正常路径。
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { eventStatus } from '../../lib/event-classify.js';
import { keepSafeUrl } from '../../lib/safe-url.js';

const AIOS_FILE_ENV = process.env.AIOS_OPPORTUNITIES || null;

/* 探测放到第一次用到时，这样 import 本模块不打日志、不读文件。 */
let AIOS_FILE = null;
let AIOS_PROBED = false;
function aiosFile() {
  if (!AIOS_PROBED) {
    AIOS_PROBED = true;
    if (!AIOS_FILE_ENV) {
      console.log('[collect] 未设置 AIOS_OPPORTUNITIES，跳过 AIOS 活动库（可选层）');
      return null;
    }
    try {
      AIOS_FILE = existsSync(AIOS_FILE_ENV) ? AIOS_FILE_ENV : null;
    } catch {
      AIOS_FILE = null;
    }
    if (!AIOS_FILE) {
      console.warn(`[collect] AIOS_OPPORTUNITIES 指向的文件不存在：${AIOS_FILE_ENV}，跳过这一源`);
    } else {
      console.log(`[collect] AIOS 活动库：${AIOS_FILE}`);
    }
  }
  return AIOS_FILE;
}

export async function fetchAios() {
  const file = aiosFile();
  if (!file) return []; // 可选层，没有就是没有，交给 aiosFile() 的 warn 说明
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'));
    const rows = Array.isArray(raw) ? raw : raw.data || [];
    return rows
      .map((o) => {
        const row = {
          id: o.id,
          title: o.title,
          url: o.canonicalUrl || o.sourceUrl,
          dates: (o.startsAt || '').slice(0, 10),
          start: (o.startsAt || '').slice(0, 10),
          end: (o.endsAt || '').slice(0, 10),
          location: o.mode === 'online' ? '线上' : o.city || '线下',
          org: o.organizerName || '',
          prize: o.priceLabel || null,
          regs: 0,
          themes: o.topics || [],
          source: 'AIOS',
          worth: o.worthScore ?? null,
          // AIOS 自带一句话摘要（其余两源都没有），直接用；detail 给前端做更长的说明
          summary: (o.summary || o.recommendationReason || '').slice(0, 280) || null,
          detail: (o.recommendationReason || '').slice(0, 280) || null,
          // type 字段是 AIOS 自己的分类（event / program / …），交给 eventKind 参考
          kindHint: o.type || null,
        };
        row.status = eventStatus(row); // AIOS 是本地历史库，绝大多数会正确翻成 past
        row.url = keepSafeUrl(row.url, 'event:aios');
        return row;
      })
      .sort((a, b) => String(a.start).localeCompare(String(b.start)));
  } catch (e) {
    // AIOS 是本地文件，CI 里读不到是正常的（没配 AIOS_OPPORTUNITIES），这里只提示不报错
    console.warn(`[collect] AIOS 活动库不可用，跳过这一源：${e.message}`);
    return [];
  }
}
