/**
 * Luma 的查询/城市表与 AI 相关性词表。
 *
 * 全是**配置**：改词表不该让采集逻辑的 diff 变得不可读。词表的取舍理由
 * 见下面每段的注释——那些理由来自线上实测，改动前先读。
 */

export const TEST_PROFILE = String(process.env.INDEXAI_PROFILE || '').toLowerCase() === 'test';

export const EV_LUMA_QUERIES = [
  'AI',
  'LLM',
  'Agent',
  'Agentic',
  'Machine Learning',
  'Deep Learning',
  'Neural Network',
  'OpenAI',
  'GPT',
  'ChatGPT',
  'Claude',
  'Anthropic',
  'Gemini',
  'Copilot',
  'Mistral',
  'Llama',
  'Stable Diffusion',
  'Generative AI',
  'RAG',
  'AI Startup',
  'AI Meetup',
  'AI Summit',
  'AI Workshop',
  'AI Hackathon',
  'AI Tools',
  'AI Agents',
  '大模型',
  '智能体',
  '人工智能',
  '机器学习',
];
/** 小并发池的宽度：一口气发 30 个请求容易被源端 5xx，8 路足够快也不会自我限流。 */
export const EV_LUMA_CONCURRENCY = 8;

/* ── 地理维度：带经纬度返回「该城市周边的 AI 活动」，与不带 geo 的结果**完全不重叠** ──
 * 实测 2026-10-24：同一个 query=AI，无 geo 与 SF geo 的返回集合交集为 0。
 * 也就是说 geo 不是「同一批数据加个坐标」，而是另一条索引 —— 这是最大的一处漏采。
 *
 * region 字段是**兜底**：事件自带 country_code 时以 country_code 为准（见 lumaCountryRegion），
 * 只有 geo 缺失时才用城市坐标所属的 region。城市坐标只是「这次查询问的是哪儿」，
 * 不代表活动真的在那个国家（海外场次也会被周边查询带出来），所以顺序不能反。 */
export const EV_LUMA_CITIES = [
  // 北美
  { slug: 'sf', lat: 37.7749, lng: -122.4194, region: 'us' },
  { slug: 'nyc', lat: 40.7128, lng: -74.006, region: 'us' },
  { slug: 'boston', lat: 42.3601, lng: -71.0589, region: 'us' },
  { slug: 'seattle', lat: 47.6062, lng: -122.3321, region: 'us' },
  { slug: 'austin', lat: 30.2672, lng: -97.7431, region: 'us' },
  { slug: 'toronto', lat: 43.6532, lng: -79.3832, region: 'ca' },
  { slug: 'vancouver', lat: 49.2827, lng: -123.1207, region: 'ca' },
  // 欧洲
  { slug: 'london', lat: 51.5074, lng: -0.1278, region: 'uk' },
  { slug: 'berlin', lat: 52.52, lng: 13.405, region: 'eu' },
  { slug: 'paris', lat: 48.8566, lng: 2.3522, region: 'eu' },
  { slug: 'amsterdam', lat: 52.3676, lng: 4.9041, region: 'eu' },
  { slug: 'zurich', lat: 47.3769, lng: 8.5417, region: 'eu' },
  // 亚洲
  { slug: 'tokyo', lat: 35.6762, lng: 139.6503, region: 'jp' },
  { slug: 'seoul', lat: 37.5665, lng: 126.978, region: 'kr' },
  { slug: 'singapore', lat: 1.3521, lng: 103.8198, region: 'sg' },
  { slug: 'bangalore', lat: 12.9716, lng: 77.5946, region: 'in' },
  { slug: 'beijing', lat: 39.9042, lng: 116.4074, region: 'cn' },
  { slug: 'shanghai', lat: 31.2304, lng: 121.4737, region: 'cn' },
  { slug: 'shenzhen', lat: 22.5431, lng: 114.0579, region: 'cn' },
  { slug: 'hangzhou', lat: 30.2741, lng: 120.1551, region: 'cn' },
  { slug: 'taipei', lat: 25.033, lng: 121.5654, region: 'cn' },
  { slug: 'hongkong', lat: 22.3193, lng: 114.1694, region: 'cn' },
  // 其他
  { slug: 'dubai', lat: 25.2048, lng: 55.2708, region: 'ae' },
  { slug: 'sydney', lat: -33.8688, lng: 151.2093, region: 'au' },
  { slug: 'telaviv', lat: 32.0853, lng: 34.7818, region: 'middle-east' },
  { slug: 'saopaulo', lat: -23.5505, lng: -46.6333, region: 'latam' },
  { slug: 'mexicocity', lat: 19.4326, lng: -99.1332, region: 'latam' },
];

/* geo 循环只配这 8 个词：全量 30 个词 × 27 城市 = 810 次请求会被源端封。
 * 8 × 27 = 216 次，加上无 geo 的 30 次 = 246 次，落在 250 的预算内。
 * 选词依据：AI / LLM / Agent 是发现流里覆盖面最广的三个（实测单城各 50 条），
 * OpenAI / hackathon / GenAI 补厂商与活动形态，中文三个词是亚洲城市的主要命中词。 */
export const EV_LUMA_GEO_QUERIES = [
  'AI',
  'LLM',
  'Agent',
  'OpenAI',
  'hackathon',
  '大模型',
  '人工智能',
  'GenAI',
];

export const EV_LUMA_CITY_BY_SLUG = new Map(EV_LUMA_CITIES.map((c) => [c.slug, c]));

/* 测试档位的有效集合：生产用全量，test 用缩小切片。
 * 切片只影响「跑多少」，不影响「怎么算」，所以 golden 仍能覆盖所有分支。 */
/* 活动 AI 相关性词表：Luma 与 Devfolio 共用同一份，避免两个源口径漂移。
 * 词表的取舍说明见下方 fetchLuma 内的原始注释（哪些泛词被刻意排除）。 */
export const AI_EVENT_RE = new RegExp(
  [
    // 通用 AI 词
    '\\bAI\\b',
    '\\bA\\.I\\.',
    '\\bLLMs?\\b',
    '\\bGPT-?\\d?',
    '\\bChatGPT\\b',
    '\\bClaude\\b',
    '\\bGemini\\b',
    '\\bCopilot\\b',
    '\\bLlama\\b',
    '\\bLLaMA\\b',
    '\\bMistral\\b',
    '\\bGemma\\b',
    '\\bSora\\b',
    '\\bQwen\\b',
    '\\bKimi\\b',
    '\\bDeepSeek\\b',
    '\\bMidjourney\\b',
    '\\bRunway\\b',
    // 厂商 / 平台
    '\\bOpenAI\\b',
    '\\bAnthropic\\b',
    '\\bDeepMind\\b',
    'Hugging ?Face',
    '\\bCohere\\b',
    '\\bPerplexity\\b',
    '\\bStability AI\\b',
    '\\bNvidia\\b',
    '\\bNVIDIA\\b',
    // 中文
    '模型',
    '人工智能',
    '机器学习',
    '大模型',
    '智能体',
    '通义',
    '豆包',
    '文心',
    '生成式',
    // 英文 ML 语义
    'machine learning',
    'deep learning',
    'neural\\s?(?:net|network)',
    'generative',
    'stable diffusion',
    '\\bdiffusion\\b',
    '\\bRAG\\b',
    '\\bagentic\\b',
    '\\bAI agents?\\b',
    '\\binference\\b',
    '\\bfine-?tun',
    '\\bprompt(?:ing|s)?\\b',
    '\\bvector (?:db|database)\\b',
    '\\bembeddings?\\b',
    '\\bLLM\\b',
    '\\btransformer model',
    // 活动形态（AI 场次常用的命名）
    'hackathon',
    '黑客松',
    'ハッカソン',
    'ハック',
    '\\bdevday\\b',
    '\\bdev ?day\\b',
    '\\bdevfest\\b',
    '\\bhacksprint\\b',
    '\\bhack ?sprint\\b',
    '\\bbuild night\\b',
    '\\bvibe cod',
    // 注意：单独的 eval / showcase / agents 太宽（"Showcase" 是什么展都会用的词），
    // 只在跟 AI 词同现时才有意义，所以这里都收窄成组合形态
    '\\bmodel eval',
    '\\bAI showcase',
    // 多语言 AI 词根（日/意/西/德/法）
    '生成AI',
    'AI 活用',
    'intelligen\\w*',
    'artificiali',
    'inteligencia',
    '\\bIA\\b',
    '\\bKI\\b',
    'künstliche',
    '\\bIA génér',
    '\\bML\\b',
  ].join('|'),
  'i',
);
