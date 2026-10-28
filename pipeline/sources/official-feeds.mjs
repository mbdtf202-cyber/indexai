/**
 * 官方情报源清单（T6.4 · S8.7）。
 *
 * 只收「厂商自己的博客 / changelog」与「指定仓库的 GitHub releases」。
 * `weight` 进入打分（官方源优先），`maxAgeHours` 是每个源的独立新鲜度门禁：
 * 超过这个年龄的条目直接丢弃，避免旧文占满归档。
 */

export const OFFICIAL_FEEDS = [
  {
    id: 'openai-news',
    name: 'OpenAI News',
    url: 'https://openai.com/news/rss.xml',
    weight: 4,
    maxAgeHours: 168,
  },
  {
    id: 'anthropic-news',
    name: 'Anthropic News',
    url: 'https://www.anthropic.com/news/rss.xml',
    weight: 4,
    maxAgeHours: 168,
  },
  {
    id: 'deepmind-blog',
    name: 'Google DeepMind Blog',
    url: 'https://deepmind.google/blog/rss.xml',
    weight: 3,
    maxAgeHours: 168,
  },
  {
    id: 'huggingface-blog',
    name: 'Hugging Face Blog',
    url: 'https://huggingface.co/blog/feed.xml',
    weight: 3,
    maxAgeHours: 168,
  },
  {
    id: 'microsoft-ai-blog',
    name: 'Microsoft AI Blog',
    url: 'https://blogs.microsoft.com/ai/feed/',
    weight: 3,
    maxAgeHours: 168,
  },
  {
    id: 'vllm-releases',
    name: 'vLLM Releases',
    url: 'https://github.com/vllm-project/vllm/releases.atom',
    weight: 2,
    maxAgeHours: 336,
  },
  {
    id: 'ollama-releases',
    name: 'Ollama Releases',
    url: 'https://github.com/ollama/ollama/releases.atom',
    weight: 2,
    maxAgeHours: 336,
  },
];

/** HN 热帖查询词；每个词一条搜索请求，只搜标题。 */
export const HN_QUERIES = ['Claude Code', 'Command Code', 'OpenAI', 'LLM'];

/** 单个源的最大年龄（毫秒），用于 runLayer 内部过滤。 */
export function feedCutoff(now, maxAgeHours) {
  return now.getTime() - maxAgeHours * 3600 * 1000;
}
