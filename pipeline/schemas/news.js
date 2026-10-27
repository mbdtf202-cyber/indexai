/**
 * news 层的行 schema（T3.5 · S3.2）。
 *
 * 情报条目用**短键**（encodeNews 的压缩格式，见 lib/news.js）：
 *   u=URL  v=聚合入口  d=日期  tm=时刻  t=标题  tp=主题  s=摘要  sc=分数  im=重要标记  ns=来源数
 *
 * 压缩是为了让归档不膨胀（2,000+ 条 × 每条几百字节）。
 * 这里的 schema 必须跟着短键走，不能写成长名——那是两个不同的形状。
 */

import { HTTP_URL, ISO_DATE } from '../../lib/schema.js';

export const NEWS_ROW = {
  u: { type: 'string', required: true, pattern: HTTP_URL },
  d: { type: 'string', required: true, pattern: ISO_DATE },
  t: { type: 'string', required: true },
  // tp 是主题的**数字编码**（TOPIC_CODE，见 lib/news.js），不是字符串
  tp: { type: 'number' },
  tm: { type: 'string' },
  v: { type: 'string', pattern: HTTP_URL },
  sc: { type: 'number' },
  ns: { type: 'number' },
};

export const NEWS_ROW_RULES = [
  {
    /* 标题为空但 URL 在：这种条目点进去有意义，列表里却是一片空白。
     * 宁可不收——情报页每一行都是标题驱动。 */
    id: 'empty-title',
    check: (row) => (!row.t || !row.t.trim() ? '标题为空' : null),
  },
];

export const NEWS_QUARANTINE_THRESHOLD = 0.02;
