/**
 * Devfolio 黑客松源（从 `41dec66:collect.mjs` 原样搬出）。
 *
 * 公开 API，无认证、无 key。历史 2038 条，但**未截止的只有 35 条，其中 AI 相关 9 条**。
 * 量小，但它是唯一给出「完整字段 + 真实奖池 + 报名人数」的黑客松源，且这 9 条
 * 在 Devpost / Luma 上都没有，所以作为补充源收下，不追求量。
 *
 * 过滤**绝不能放宽**：主体是通用黑客松（No Restrictions 占绝大多数），
 * 不做 AI 过滤会往站里灌几百条无关活动。宁可少收。
 */

import { httpJson } from '../../lib/http.js';
import { sleep, todayISO } from '../../lib/clock.js';
import { eventStatus } from '../../lib/event-classify.js';
import { keepSafeUrl } from '../../lib/safe-url.js';

const TEST_PROFILE = String(process.env.INDEXAI_PROFILE || '').toLowerCase() === 'test';

const DV_API = 'https://api.devfolio.co/api/hackathons';
const DV_MAX_PAGES = TEST_PROFILE ? 2 : 45; // 实测 41 页到底，留 4 页余量防源端多一页时漏
const DV_LIMIT = 50;

async function devfolioPage(page, attempt = 0) {
  const url = `${DV_API}?page=${page}&limit=${DV_LIMIT}`;
  try {
    return await httpJson(url, { label: `devfolio/p${page}` });
  } catch (e) {
    if (attempt < 2) {
      await sleep(400 * (attempt + 1));
      return devfolioPage(page, attempt + 1);
    }
    throw e;
  }
}

/* 活动 AI 相关性词表。Devfolio 项目**不复用** Luma 的 AI_EVENT_RE（见下）。 */

const DV_AI_THEME =
  /\bAI\b|\bA\.?I\.?\b|machine ?learning|deep ?learning|\bML\b|\bLLM|data ?science|neural|generative|computer vision|\bNLP\b/i;

// Devfolio 专用的 AI 语义词表：只有真正的 AI 词，没有任何活动形态词
const DV_AI_RE = new RegExp(
  [
    '\\bAI\\b',
    '\\bA\\.I\\.',
    '\\bLLMs?\\b',
    '\\bGPT-?\\d?',
    '\\bChatGPT\\b',
    '\\bClaude\\b',
    '\\bGemini\\b',
    '\\bCopilot\\b',
    '\\bLlama\\b',
    '\\bMistral\\b',
    '\\bGemma\\b',
    '\\bQwen\\b',
    '\\bDeepSeek\\b',
    '\\bMidjourney\\b',
    '\\bOpenAI\\b',
    '\\bAnthropic\\b',
    '\\bDeepMind\\b',
    'Hugging ?Face',
    '\\bCohere\\b',
    '\\bPerplexity\\b',
    '\\bStability AI\\b',
    'machine learning',
    'deep learning',
    'neural\\s?(?:net|network)',
    '\\bgenerative ai\\b',
    'stable diffusion',
    '\\bdiffusion model',
    '\\bRAG\\b',
    '\\bagentic\\b',
    '\\bcomputer vision\\b',
    '\\bNLP\\b',
    '\\bML\\b',
    '\\bGenAI\\b',
    '人工智能',
    '机器学习',
    '大模型',
    '智能体',
    '深度学习',
  ].join('|'),
  'i',
);

export function devfolioIsAI(h) {
  const themes = (h.themes || []).map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean);
  if (themes.some((t) => DV_AI_THEME.test(t))) return true;
  // desc 只看前 600 字：Devfolio 的 desc 是完整 markdown 规则书，
  // 通篇可能多处提到 AI 是泛泛而谈；截断后命中更接近「这场活动的主旨」。
  const hay = `${h.name || ''} ${h.tagline || ''} ${String(h.desc || '').slice(0, 600)}`;
  return DV_AI_RE.test(hay);
}

/* 奖池：prizes 是对象数组，每项有 currency + amount + name。
 * 不同货币不能直接相加，所以只取「最常见的那一种货币」求和，其余额度不参与，
 * 并在有多个币种时拼一句提示 —— 不把 ₹ 和 $ 加成一个假数字。 */
export function devfolioPrize(prizes) {
  const rows = (prizes || [])
    .map((p) => ({
      amount: Number(p?.amount),
      currency: (p?.currency || '').toUpperCase() || null,
    }))
    .filter((p) => Number.isFinite(p.amount) && p.amount > 0);
  if (!rows.length) return null;
  const byCur = {};
  for (const r of rows) {
    const k = r.currency || '?';
    byCur[k] = (byCur[k] || 0) + r.amount;
  }
  const [cur, sum] = Object.entries(byCur).sort((a, b) => b[1] - a[1])[0];
  const symbol = { USD: '$', INR: '₹', EUR: '€', GBP: '£' }[cur] || '';
  const n = Math.round(sum).toLocaleString('en-US');
  const others = Object.keys(byCur).length - 1;
  return `${symbol}${n}${cur && cur !== '?' && !symbol ? ` ${cur}` : ''}${others > 0 ? ` 等 ${others + 1} 种币种` : ''}`;
}

export async function fetchDevfolio() {
  const today = todayISO();
  const all = [];
  let total = null;
  let pagesHint = null;

  for (let page = 1; page <= DV_MAX_PAGES; page += 1) {
    let j;
    try {
      j = await devfolioPage(page);
    } catch (e) {
      console.warn(`[collect] devfolio p${page} 放弃：${e.message}`);
      break;
    }
    if (total == null && Number.isFinite(j?.count)) total = Number(j.count);
    if (pagesHint == null && Number.isFinite(j?.pages)) pagesHint = Number(j.pages);
    const list = j?.result || [];
    if (!list.length) break; // 实测第 42 页到底
    all.push(...list);
    if (pagesHint != null && page >= pagesHint) break;
  }

  // 去重（uuid），并丢掉已截止的：这个源 2038 条里 2003 条是历史活动，收进来只会污染
  const seen = new Set();
  const live = [];
  for (const h of all) {
    const k = h?.uuid || h?.slug;
    if (!k || seen.has(k)) continue;
    seen.add(k);
    const end = String(h.ends_at || '').slice(0, 10);
    const start = String(h.starts_at || '').slice(0, 10);
    // 没有截止日的不猜（跟 eventStatus 的 unknown 口径一致），也不收
    const last = end || start;
    if (!last || last < today) continue;
    live.push(h);
  }

  const ai = live.filter(devfolioIsAI);
  const rows = ai.map((h) => {
    const start = String(h.starts_at || '').slice(0, 10);
    const end = String(h.ends_at || '').slice(0, 10);
    const cityCountry = [h.city, h.country].filter(Boolean).join(', ');
    const row = {
      id: `devfolio-${h.uuid || h.slug}`,
      title: h.name || '',
      url: h.slug ? `https://${h.slug}.devfolio.co/` : null,
      dates: [start, end].filter(Boolean).join(' → ') || null,
      start: start || null,
      end: end || null,
      location: h.is_online ? '线上' : h.location || cityCountry || '线下',
      org: h.hackathon_brand?.name || '',
      prize: devfolioPrize(h.prizes),
      regs: Number(h.participants_count || 0),
      themes: (h.themes || []).map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean),
      source: 'Devfolio',
      // country 是英文国名（"India" / "Germany"），交给 eventRegion 的国名正则；
      // 这里不塞两位码 —— Devfolio 给的是国名不是 ISO 码，硬凑容易错。
      countryName: h.country || null,
    };
    const tag = String(h.tagline || '')
      .replace(/\s+/g, ' ')
      .trim();
    row.summary = tag ? tag.slice(0, 280) : null;
    row.status = eventStatus(row);
    row.url = keepSafeUrl(row.url, 'event:devfolio');
    return row;
  });

  console.log(
    `[collect] devfolio ${all.length} 条历史（共 ${total ?? '?'}）→ 未截止 ${live.length} → AI 相关 ${rows.length}`,
  );
  return rows;
}
