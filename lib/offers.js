/**
 * 免费额度（T6.11 · S8.2）。
 *
 * `curated/offers.json` 里每条记录除了原文 `quota_raw`，还有结构化 quota：
 * `{ amount, unit, period, scope }`。这个文件只做两件事：
 * 1. 把结构化额度渲染成人能读的短句；
 * 2. 给「按价值排序」一个可比较的粗估值（不同单位之间本来不可精确换算，
 *    这里只用于把「明显更大方」的额度排前面，不冒充美元定价）。
 */

export const QUOTA_UNITS = {
  tokens: 'token',
  requests: '次请求',
  messages: '条消息',
  credits: '点额度',
  usd: '美元',
  neurons: 'Neurons',
  hours: '小时',
  seats: '个席位',
  unlimited: '无限',
  unknown: '未公开',
};

const PERIOD = {
  day: '/天',
  month: '/月',
  year: '/年',
  'one-time': '（一次性）',
  trial: '（试用期）',
  session: '（会话窗口）',
  unknown: '',
};

/** 结构化额度 → 展示文案。 */
export function quotaLabel(q) {
  if (!q || typeof q !== 'object') return '未公开';
  const unit = QUOTA_UNITS[q.unit] || q.unit || '未公开';
  if (q.unit === 'unlimited') return '无限';
  if (q.unit === 'unknown' || q.amount == null) return '未公开';
  const amount = q.unit === 'usd' ? `$${q.amount}` : `${q.amount} ${unit}`;
  return `${amount}${PERIOD[q.period] || ''}`;
}

/**
 * 粗估「额度价值」，只用于排序：
 * - 美元/credits 按面值；
 * - token 按 $2/1M 的保守单价折算；
 * - 请求/消息按 $0.01/次折算（足够把数量级分开）；
 * - 无限额度排在所有有限额度之前。
 */
export function quotaValue(q) {
  if (!q || typeof q !== 'object') return 0;
  if (q.unit === 'unlimited') return 1e9;
  const amount = Number(q.amount);
  if (!Number.isFinite(amount)) return 0;
  const per = q.period === 'day' ? 30 : q.period === 'year' ? 1 / 12 : 1;
  switch (q.unit) {
    case 'usd':
    case 'credits':
      return amount;
    case 'tokens':
      return (amount / 1e6) * 2 * per;
    case 'requests':
    case 'messages':
      return amount * 0.01 * per;
    case 'neurons':
      return (amount / 1e6) * 0.5 * per;
    case 'hours':
      return amount * 2;
    case 'seats':
      return amount * 5;
    default:
      return 0;
  }
}

/** 按额度价值从大到小排；不修改原数组。 */
export function sortByQuotaValue(rows) {
  return [...(rows || [])].sort((a, b) => quotaValue(b.quota) - quotaValue(a.quota));
}
