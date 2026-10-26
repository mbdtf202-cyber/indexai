/**
 * subs 层的行 schema（T3.5 · S3.2）。
 *
 * 订阅档位行的骨架：产品 + 档位 + 价格 + 周期。价格是正的美元数。
 */

import { HTTP_URL } from '../../lib/schema.js';

export const SUB_ROW = {
  id: { type: 'string', required: true },
  product: { type: 'string', required: true },
  vendor: { type: 'string', required: true },
  price: { type: 'number', required: true, min: 0 },
  currency: { type: 'string', required: true },
  buy: { type: 'string', pattern: HTTP_URL },
};

export const SUB_ROW_RULES = [
  {
    /* 价格是 0 却标成付费档：要么是「免费档」误入，要么是价格没取到。
     * 前者属于 offers 层，后者是解析失败——两种都不该进订阅计算器。 */
    id: 'zero-price-plan',
    check: (row) =>
      row.price === 0 && row.tier && !/free/i.test(row.tier) ? '付费档价格却为 0' : null,
  },
];

export const SUB_QUARANTINE_THRESHOLD = 0.02;
