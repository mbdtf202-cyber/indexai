/**
 * offers 层的行 schema（T3.5 · S3.2）。
 *
 * 免费额度行的骨架：产品名、供应商、属于哪一类优惠。
 * 这一层没有网络请求，数据全来自人工核校的 curated/offers.json，
 * 所以校验主要防「人工编辑时写漏字段」。
 */

import { HTTP_URL } from '../../lib/schema.js';

export const OFFER_ROW = {
  product: { type: 'string', required: true },
  vendor: { type: 'string', required: true },
  category: { type: 'string', required: true },
  source: { type: 'string', pattern: HTTP_URL },
};

export const OFFER_ROW_RULES = [
  {
    /* 没有任何来源链接：读者无法核实这条额度是否还在。
     * 免费额度是会过期的，没有出处的条目是负债而不是资产。 */
    id: 'no-source',
    check: (row) =>
      (!row.sources || !row.sources.length) && !row.source ? '既无 sources 也无 source' : null,
  },
];

export const OFFER_QUARANTINE_THRESHOLD = 0.02;
