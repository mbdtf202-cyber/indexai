/**
 * 每层的行契约登记表（T3.5 · S3.2）。
 *
 * 只有出现在这里、且声明了 `schema` 的层才会被逐行校验。
 * **没登记不是「静默通过」**，而是「这一层还没有行契约」——等写 schema 时补上。
 *
 * 阈值默认 2%：一两行脏数据是源站常态，超过才说明结构变了（见 lib/schema.js）。
 */

import { MODEL_ROW, MODEL_ROW_RULES, MODEL_QUARANTINE_THRESHOLD } from './models.js';
import { EVENT_ROW, EVENT_ROW_RULES, EVENT_QUARANTINE_THRESHOLD } from './events.js';
import { RELAY_ROW, RELAY_ROW_RULES, RELAY_QUARANTINE_THRESHOLD } from './relays.js';
import { OFFER_ROW, OFFER_ROW_RULES, OFFER_QUARANTINE_THRESHOLD } from './offers.js';
import { SUB_ROW, SUB_ROW_RULES, SUB_QUARANTINE_THRESHOLD } from './subs.js';
import { NEWS_ROW, NEWS_ROW_RULES, NEWS_QUARANTINE_THRESHOLD } from './news.js';
import { RESOURCE_ROW, RESOURCE_ROW_RULES, RESOURCE_QUARANTINE_THRESHOLD } from './resources.js';

export const SCHEMAS = {
  models: {
    schema: MODEL_ROW,
    rules: MODEL_ROW_RULES,
    threshold: MODEL_QUARANTINE_THRESHOLD,
  },
  events: {
    schema: EVENT_ROW,
    rules: EVENT_ROW_RULES,
    threshold: EVENT_QUARANTINE_THRESHOLD,
  },
  relays: {
    schema: RELAY_ROW,
    rules: RELAY_ROW_RULES,
    threshold: RELAY_QUARANTINE_THRESHOLD,
  },
  offers: {
    schema: OFFER_ROW,
    rules: OFFER_ROW_RULES,
    threshold: OFFER_QUARANTINE_THRESHOLD,
  },
  subs: {
    schema: SUB_ROW,
    rules: SUB_ROW_RULES,
    threshold: SUB_QUARANTINE_THRESHOLD,
  },
  news: {
    schema: NEWS_ROW,
    rules: NEWS_ROW_RULES,
    threshold: NEWS_QUARANTINE_THRESHOLD,
  },
  resources: {
    schema: RESOURCE_ROW,
    rules: RESOURCE_ROW_RULES,
    threshold: RESOURCE_QUARANTINE_THRESHOLD,
  },
};
