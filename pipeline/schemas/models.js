/**
 * models 层的行 schema（T3.5 · S3.2）。
 *
 * 行的形状见 layer/normalize：`id` / `name` / `channelKind` 是骨架，
 * 价格三件（input / output / cache_read）可以缺失（免费额度与路由产品就是没有价）。
 *
 * ## 语义红线降到行级
 *
 * `input = 0 且 output > 0` 这种行，过去会让**整次采集**抛错（F03）——
 * OpenRouter 里偶尔混进一条计价字段错乱的记录，全站当天就不更新了。
 * 现在它是**行级规则**：这一行进 quarantined，其余行照常发布。
 */

import { HTTP_URL, NON_NEGATIVE, ISO_DATE } from '../../lib/schema.js';

/** models 层的单行契约。 */
export const MODEL_ROW = {
  id: { type: 'string', required: true },
  name: { type: 'string', required: true },
  vendor: { type: 'string', required: true },
  vendorId: { type: 'string', required: true },
  channel: { type: 'string', required: true },
  channelKind: { type: 'enum', required: true, values: ['direct', 'aggregator'] },
  input: NON_NEGATIVE,
  output: NON_NEGATIVE,
  cache_read: NON_NEGATIVE,
  cache_write: NON_NEGATIVE,
  band: { type: 'enum', values: ['free', 'budget', 'standard', 'premium', 'unknown'] },
  free: { type: 'boolean' },
  seen: { type: 'string', pattern: ISO_DATE },
  src: { type: 'string', pattern: HTTP_URL },
};

/**
 * 行级语义规则：schema 表达不了的「跨字段一致性」放这里。
 *
 * 每条返回 null 表示通过，返回字符串表示原因。
 * @type {Array<{id: string, check: (row: object) => string|null}>}
 */
export const MODEL_ROW_RULES = [
  {
    id: 'price-zero-mismatch',
    /* input=0 但 output>0：源站计价字段错乱（实测 OpenRouter 偶发）。
     * 这种行不能进比价表——「免费输入、要钱输出」会让「最便宜」的排序完全失真。 */
    check: (row) =>
      row.input === 0 && row.output > 0 ? `input=0 但 output=${row.output}（计价字段错乱）` : null,
  },
  {
    id: 'negative-price',
    check: (row) => {
      for (const k of ['input', 'output', 'cache_read', 'cache_write']) {
        if (row[k] != null && row[k] < 0) return `${k}=${row[k]} 为负数`;
      }
      return null;
    },
  },
  {
    id: 'cache-read-over-input',
    /* 缓存读比输入还贵：只有两种可能——源站写反了，或者这是非缓存计价。
     * 无论哪种，拿它算「缓存折扣」都会得出负折扣，直接隔离。 */
    check: (row) =>
      row.cache_read != null && row.input != null && row.cache_read > row.input
        ? `cache_read=${row.cache_read} > input=${row.input}`
        : null,
  },
];

/** 本层的隔离比例阈值：2%（见 lib/schema.js 的 quarantineRatio）。 */
export const MODEL_QUARANTINE_THRESHOLD = 0.02;
