/**
 * relays 层的行 schema（T3.5 · S3.2）。
 *
 * 中转站行的骨架：域名、状态、以及最重要的「价格对象」。
 * 价格本身的结构由 lib/relay-pricing.js 保证，这里只校验外层。
 */

import { HTTP_URL } from '../../lib/schema.js';

export const RELAY_ROW = {
  domain: { type: 'string', required: true },
  name: { type: 'string', required: true },
  status: {
    type: 'enum',
    required: true,
    values: [
      'ok',
      'timeout',
      'unreachable',
      'http_400',
      'http_401',
      'http_403',
      'http_404',
      'http_429',
      'no_pricing',
    ],
  },
  url: { type: 'string', pattern: HTTP_URL },
  models: { type: 'number', min: 0 },
  checked_at: { type: 'string' },
  stale: { type: 'boolean' },
};

export const RELAY_ROW_RULES = [
  {
    /* 状态是 ok 却没有任何价格：静默腐烂的典型。要么源站给了空价目，
     * 要么解析器失效——无论哪种，这行都在骗页面「这家可用」。 */
    id: 'ok-without-prices',
    check: (row) =>
      row.status === 'ok' && (!row.prices || !Object.keys(row.prices).length)
        ? 'status=ok 但 priced 为空'
        : null,
  },
];

export const RELAY_QUARANTINE_THRESHOLD = 0.02;
