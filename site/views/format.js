/**
 * View Formatting Helpers (T5.1 Round 1)
 *
 * Pure formatting functions used by all views
 */

/** Format price with currency symbol and proper precision */
export function money(value, currency = '$') {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }

  const formatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency === '$' ? 'USD' : 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);

  return formatted.replace('$', currency).replace('¥', '¥');
}

/** Format percentage with % symbol */
export function pct(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  return `${(value * 100).toFixed(1)}%`;
}

/** Format large numbers with K/M/B suffixes */
export function kfmt(value) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }

  if (Math.abs(value) >= 1e9) {
    return `${(value / 1e9).toFixed(1)}B`;
  }
  if (Math.abs(value) >= 1e6) {
    return `${(value / 1e6).toFixed(1)}M`;
  }
  if (Math.abs(value) >= 1e3) {
    return `${(value / 1e3).toFixed(1)}K`;
  }

  return Math.round(value).toString();
}

/** Format context string for model pricing tiers */
export function ctx(ctxMs) {
  if (ctxMs === null || ctxMs === undefined) return '';
  return `⚡${ctxMs}ms`;
}

/** Truncate text with ellipsis */
export function truncate(text, maxLength = 60) {
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3)}...`;
}

/** Format date for display */
export function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default { money, pct, kfmt, ctx, truncate, formatDate };
