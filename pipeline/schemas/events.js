/**
 * events 层的行 schema（T3.5 · S3.2）。
 *
 * 活动行来自四个源，形态已经由各源的 normalize 统一（见 sources/*）。
 * 这里守的是「统一之后的骨架」：有 id、有标题、有合法 URL、地区与类型在枚举内。
 *
 * 注意：`kind` / `region` 由编排器在合并后统一判定，所以这里只校验「判定结果合法」，
 * 不重复判一遍。
 */

import { HTTP_URL, ISO_DATE, ISO_DATETIME } from '../../lib/schema.js';

export const EVENT_ROW = {
  id: { type: 'string', required: true },
  title: { type: 'string', required: true },
  url: { type: 'string', pattern: HTTP_URL },
  source: { type: 'enum', required: true, values: ['Devpost', 'Luma', 'Devfolio', 'AIOS'] },
  start: { type: 'string', pattern: ISO_DATE },
  end: { type: 'string', pattern: ISO_DATE },
  startAt: { type: 'string', pattern: ISO_DATETIME },
  endAt: { type: 'string', pattern: ISO_DATETIME },
  status: { type: 'enum', values: ['open', 'upcoming', 'past', 'unknown'] },
  kind: {
    type: 'enum',
    values: ['hackathon', 'conference', 'workshop', 'demo', 'meetup', 'award', 'other'],
  },
  regs: { type: 'number', min: 0 },
};

/** 跨字段规则。 */
export const EVENT_ROW_RULES = [
  {
    /* 结束早于开始：源站字段写反，或者跨年的年份补错。
     * 这种行的 status 判定必然失真，隔离掉比让它进时间轴好。 */
    id: 'end-before-start',
    check: (row) =>
      row.start && row.end && row.end < row.start ? `end=${row.end} 早于 start=${row.start}` : null,
  },
  {
    id: 'missing-both-dates',
    /* 两个日期都没有：无法判定状态，但也不该整行丢掉（有标题就有信息量）。
     * 这里只提示，不作为隔离理由——真正的问题是「源缺数据」，由 health 管。 */
    check: () => null,
  },
];

export const EVENT_QUARANTINE_THRESHOLD = 0.02;
