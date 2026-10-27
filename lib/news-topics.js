/**
 * 情报主题与打分（T6.4 · S8.7）。
 *
 * 规则集中在这一个文件：分类词表、分类优先级、主题权重与打分。
 * lib/news.js 只消费这些纯函数，不重复定义关键词。
 */

export const NEWS_TOPICS = [
  { id: 'price', label: '价格与额度', re: /(价格|定价|降价|涨价|免费|额度|计费|折扣|半价|白嫖|成本|订阅|月费|收费|账单|价目)/ },
  { id: 'funding', label: '融资并购', re: /(融资|估值|亿美元|并购|收购|IPO|招股|募资|上市|投资|市值|财报|收入|营收|亏损|定价目标)/ },
  { id: 'policy', label: '政策监管', re: /(国务院|政策|监管|法案|部委|合规|立法|禁令|反垄断|出口管制|政府|议会|欧盟|白宫|国防|法院|起诉|诉讼|传票|检察长|总理|参议院|议员|协定|协议|版权|封禁)/ },
  { id: 'safety', label: '安全对齐', re: /(对齐|越狱|漏洞|红队|安全研究员|攻击|恶意|投毒|事故|披露|安全|失控|水印|伪造|调查|风险|被捕|指控|窃取|泄露)/ },
  { id: 'model', label: '模型发布', re: /(开源|权重|总参数|激活|新模型|模型发布|多模态|推理模型|发布|模型|参数|上下文|MoE|预览|GPT-|Claude|Gemini|Kimi|Grok|Qwen|MiniMax|DeepSeek|GLM|Llama|Mistral|vLLM|Sora|FLUX|Kling|可灵)/ },
  { id: 'product', label: '产品更新', re: /(上线|功能|更新|插件|SDK|开发工具|集成|Agent|智能体|应用|开放|推出|支持|接入|桌面|移动端|网页|平台|工具)/ },
  { id: 'research', label: '研究评测', re: /(论文|研究|基准|benchmark|评测|榜单|实验|证明|发现|理论|课程|报告|数据集|指数)/ },
];

/** 分类优先级：融资/政策/安全先于模型名；模型名又先于泛化的「发布/上线」。 */
const CLASSIFY_PRIORITY = ['funding', 'policy', 'safety', 'price', 'model', 'product', 'research'];

export const TOPIC_LABEL = Object.fromEntries(NEWS_TOPICS.map((t) => [t.id, t.label]));
export const TOPIC_CODE = Object.fromEntries(NEWS_TOPICS.map((t, i) => [t.id, i]));
export const CODE_TOPIC = NEWS_TOPICS.map((t) => t.id);

const TOPIC_CACHE = new Map();

/** 分类只打标题：正文里的「评测」「研究」会把一篇融资稿误判成研究稿 */
export function classifyNews(title = '') {
  if (TOPIC_CACHE.has(title)) return TOPIC_CACHE.get(title);
  const byId = Object.fromEntries(NEWS_TOPICS.map((t) => [t.id, t]));
  const hit = CLASSIFY_PRIORITY.map((id) => byId[id]).find((t) => t.re.test(title));
  const id = hit ? hit.id : 'other';
  if (TOPIC_CACHE.size < 20000) TOPIC_CACHE.set(title, id);
  return id;
}

/**
 * 主题相关性权重（S8.7 · F26）。
 *
 * 旧实现按人名扣分：标题里出现「马斯克」直接 -6，导致 xAI 的价格与模型新闻
 * 被系统性压低。人名不是主题信号——现在分数只看「标题命中了哪些主题」。
 * 规则集中在本文件的 NEWS_TOPICS 里，别处不再写第二套关键词。
 */
export const TOPIC_WEIGHT = {
  price: 5,
  model: 4,
  funding: 3,
  policy: 3,
  safety: 3,
  product: 2,
  research: 2,
  other: 0,
};

/** 分数只决定「排前面」和「留多久」，不决定要不要。0 分条目照样进归档。 */
export function scoreNews(n) {
  const t = n.title || '';
  const s = n.summary || '';
  const blob = `${t} ${s}`;
  let score = TOPIC_WEIGHT[classifyNews(t)] ?? 0;
  // 官方源 / 指定仓库的权重（S8.7）：同主题下官方稿排在聚合稿前面。
  if (Number.isFinite(n.weight)) score += Math.min(3, Math.max(0, n.weight));
  // 摘要里出现价格词仍要加分：标题可能没写，正文才是信息所在。
  if (/(价格|定价|降价|涨价|免费|额度|计费|折扣|半价|白嫖)/.test(blob)) score += 2;
  if (s.length > 60) score += 1;
  return score;
}

const MAJOR_RE = /(融资|估值|亿美元|收购|IPO|政策|监管|法案|国务院|发布|开源|权重|降价|涨价|定价|事故|诉讼|安全报告|漏洞)/;

export function newsImportance(n) {
  const score = n.score ?? scoreNews(n);
  if (score >= 7) return 'major';
  if (score >= 4 && MAJOR_RE.test(n.title || '')) return 'major';
  return 'daily';
}

/**
 * 保留天数。跨度靠这个函数撑起来：
 * major 在预算内永久保留；daily 最短 30 天，分数越高越久，最多一年。
 */
export const RETENTION = { major: Infinity, daily0: 30, dailyStep: 15, dailyCap: 365 };

export function retentionDays(n) {
  if ((n.im || n.importance) === 'major') return Infinity;
  const score = Math.max(0, n.sc ?? n.score ?? 0);
  return Math.min(RETENTION.dailyCap, RETENTION.daily0 + score * RETENTION.dailyStep);
}

