#!/usr/bin/env node
/**
 * FreeAI Radar — 每日数据采集 / 归一 / 去重
 *
 * 三个数据层，全部字段都带来源：
 *   1. OpenRouter 实时目录  —— 聚合渠道价，含 cache read / cache write（唯一实时层）
 *   2. CURATED_OFFICIAL     —— 厂商官方直连价（人工从官方定价页核实，带 URL）
 *   3. CURATED_OFFERS       —— 白嫖渠道（免费额度 / 免费模型 / 赠送金，带 URL）
 *   4. SIGNALS              —— X / 官方 blog 一手情报（带 URL 与日期）
 *
 * 输出：data.json（站点唯一数据源）
 * 运行：node collect.mjs
 */

import { writeFile, readFile } from 'node:fs/promises';

const OPENROUTER = 'https://openrouter.ai/api/v1/models';
const FX_CNY = 7.1; // 2026-10-23 记账汇率，仅用于把人民币价折算成 USD 对比
const OUT = new URL('./data.json', import.meta.url);

/* ────────────────────────── 1. 厂商显示名 ────────────────────────── */
const VENDOR = {
  openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', deepseek: 'DeepSeek',
  qwen: 'Alibaba Qwen', 'z-ai': 'Zhipu', moonshotai: 'Moonshot', minimax: 'MiniMax',
  'x-ai': 'xAI', mistralai: 'Mistral', meta: 'Meta', 'meta-llama': 'Meta',
  nvidia: 'NVIDIA', tencent: 'Tencent', bytedance: 'ByteDance', 'bytedance-seed': 'ByteDance',
  baidu: 'Baidu', cohere: 'Cohere', xiaomi: 'Xiaomi', amazon: 'Amazon', ai21: 'AI21',
  liquid: 'Liquid AI', poolside: 'Poolside', stepfun: 'StepFun', inclusionai: 'InclusionAI',
  allenai: 'Allen AI', nousresearch: 'NousResearch', 'arcee-ai': 'Arcee', morph: 'Morph',
  relace: 'Relace', 'nex-agi': 'Nex AGI', sao10k: 'Sao10K', upstage: 'Upstage',
  openrouter: 'OpenRouter', cognitivecomputations: 'Cognitive', 'ibm-granite': 'IBM',
  microsoft: 'Microsoft', meituan: 'Meituan', rekaai: 'Reka', sakana: 'Sakana',
  'prism-ml': 'Prism ML', perceptron: 'Perceptron', 'inference-net': 'Inference.net',
  scaledown: 'ScaleDown', typesafe: 'TypeSafe', reflection: 'Reflection',
  'xingchen-agi': 'Xingchen', 'dots-studio': 'Dots Studio', 'aion-labs': 'Aion Labs',
  'anthracite-org': 'Anthracite', gryphe: 'Gryphe', mancer: 'Mancer', undi95: 'Undi95',
  thedrummer: 'TheDrummer', moondream: 'Moondream', writer: 'Writer', inception: 'Inception',
  elorian: 'Elorian', recursive: 'Recursive', thinkingmachines: 'Thinking Machines',
  unbiased: 'Unbiased', fireworks: 'Fireworks',
};

/* ────────────────────────── 2. 官方直连定价（人工核实层） ──────────────────────────
 * 字段：vendor / model / ctx(千 token) / in / out / cr(缓存读) / cw(缓存写)，
 *      价格单位 USD / 1M tokens；cny 为官方原币数字（若按人民币标价）；
 *      cm = 缓存机制说明；src = 官方定价页；conf = high|med|low
 * 空数组 = 尚未核实，站点会自动降级为仅展示聚合层。
 */
const CURATED_OFFICIAL = [
  { vendor: 'DeepSeek', model: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', ctx: 1024,
    in: 0.1408, out: 0.5634, cr: 0.0028, cw: null,
    cny: { currency: 'CNY', input: 1, output: 4, cache_read: 0.02 },
    cm: '自动前缀缓存，命中 0.02 元/1M；缓存自动写入不单独计费，未命中按输入价',
    src: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing', conf: 'high',
    note: '本行取空闲时段价（1 / 4 / 0.02 元）；高峰时段=工作日 9–12、14–18（北京时间），价格 ×2（2 / 8 / 0.04 元）' },
  { vendor: 'DeepSeek', model: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', ctx: 1024,
    in: 0.6338, out: 1.9014, cr: 0.0211, cw: null,
    cny: { currency: 'CNY', input: 4.5, output: 13.5, cache_read: 0.15 },
    cm: '自动前缀缓存，命中 0.15 元/1M；未命中按输入价',
    src: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing', conf: 'high',
    note: '本行取空闲时段价；高峰时段为 9 / 27 / 0.30 元' },
  { vendor: 'MiniMax', model: 'minimax-m3.1-flash', name: 'MiniMax M3.1 Flash', ctx: 512,
    in: 0.1408, out: 0.5634, cr: 0.0141, cw: null,
    cny: { currency: 'CNY', input: 1, output: 4, cache_read: 0.1 },
    cm: '缓存读取按 0.10 元/1M 计；写入未单列',
    src: 'https://platform.minimaxi.com/document/price', conf: 'high',
    note: '官方语言模型价目表原文：输入 1.00 / 输出 4.00 / 缓存读取 0.10 元每百万 tokens' },
  { vendor: 'MiniMax', model: 'minimax-m3', name: 'MiniMax M3 (≤512K)', ctx: 512,
    in: 0.2958, out: 1.1831, cr: 0.0592, cw: null,
    cny: { currency: 'CNY', input: 2.1, output: 8.4, cache_read: 0.42 },
    cm: '缓存读取 0.42 元/1M；≤512K 输入档',
    src: 'https://platform.minimaxi.com/document/price', conf: 'high',
    note: '页面标注「永久五折」，本行为折后价；标准价 4.20 / 16.80 / 0.84 元' },
  { vendor: 'Anthropic', model: 'claude-fable-5.1', name: 'Claude Fable 5.1', ctx: 1000,
    in: 10, out: 50, cr: 0.25, cw: 12.5,
    cm: '提示缓存 5 分钟 TTL；读 $0.25 / 写 $12.50 每 1M', src: 'https://www.anthropic.com/pricing', conf: 'high',
    note: '官方 Latest models 表原文；Batch 五折另计' },
  { vendor: 'Anthropic', model: 'claude-opus-5.5', name: 'Claude Opus 5.5', ctx: 1000,
    in: 4, out: 20, cr: 0.2, cw: 5,
    cm: '提示缓存 5 分钟 TTL；读 $0.20 / 写 $5 每 1M', src: 'https://www.anthropic.com/pricing', conf: 'high',
    note: 'Fast mode 为 2 倍标准价；Batch 五折' },
  { vendor: 'Anthropic', model: 'claude-sonnet-5.5', name: 'Claude Sonnet 5.5', ctx: 1000,
    in: 2, out: 10, cr: 0.1, cw: 2.5,
    cm: '提示缓存 5 分钟 TTL；读 $0.10 / 写 $2.50 每 1M', src: 'https://www.anthropic.com/pricing', conf: 'high',
    note: 'Batch 五折' },
  { vendor: 'Anthropic', model: 'claude-haiku-5.5', name: 'Claude Haiku 5.5 (≤100K)', ctx: 200,
    in: 0.1, out: 0.5, cr: 0.01, cw: 0.125,
    cm: '≤100K 提示档：读 $0.01 / 写 $0.125；>100K 档为 0.50 / 2.50 / 0.05 / 0.625',
    src: 'https://www.anthropic.com/pricing', conf: 'high', note: '本行为 ≤100K tokens 档' },
  { vendor: 'OpenAI', model: 'gpt-6-astra', name: 'GPT-6 Astra', ctx: 400,
    in: 10, out: 50, cr: 1, cw: 12.5,
    cm: '自动缓存；写入 30 分钟 $12.50、12 小时 $25 每 1M', src: 'https://platform.openai.com/docs/pricing', conf: 'high',
    note: 'Standard 档；Batch 五折、Fast 2 倍、Ultrafast 6 倍' },
  { vendor: 'OpenAI', model: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', ctx: 400,
    in: 2, out: 10, cr: 0.1, cw: 2.5,
    cm: '自动缓存；写入 30 分钟 $2.50、12 小时 $5 每 1M', src: 'https://platform.openai.com/docs/pricing', conf: 'high',
    note: 'Standard 档；Fast 档 4 / 20 / 0.20' },
  { vendor: 'OpenAI', model: 'gpt-6-luna', name: 'GPT-6 Luna', ctx: 400,
    in: 0.1, out: 0.5, cr: 0.01, cw: 0.125,
    cm: '自动缓存；写入 30 分钟 $0.125、12 小时 $0.25 每 1M', src: 'https://platform.openai.com/docs/pricing', conf: 'high',
    note: 'Standard 档' },
  { vendor: 'Google', model: 'gemini-4-argon', name: 'Gemini 4 Argon', ctx: 1000,
    in: 2, out: 10, cr: 0.1, cw: null,
    cm: '仅隐式缓存（不支持显式缓存），命中 $0.10 每 1M', src: 'https://ai.google.dev/gemini-api/docs/pricing', conf: 'high',
    note: '促销价至 2026-11-30；12-01 起翻倍为 4 / 20 / 0.20，且无免费额度' },
];

/* ────────────────────────── 3. 白嫖渠道（人工核实层） ────────────────────────── */
const CURATED_OFFERS = [
  { id: "qdev-free", product: "Amazon Q Developer", vendor: "AWS", category: "coding-agent", claim: "永久 Free Tier：每月 50 次 agentic 请求（问答+Agent 编码），Java 升级 1,000 LOC/月", free_scope: "长期", quota: "50 agentic requests per month；1,000 LOC per month", requirements: "AWS Builder ID 或 IAM 用户", region: "GLOBAL", price_after: "Pro（页面未列价格）", entries: ["IDE 插件", "CLI", "AWS Console"], source: "https://aws.amazon.com/q/developer/pricing/", sources: ["https://aws.amazon.com/q/developer/pricing/"], source_type: "official", confidence: "high", note: "IDE 内 Free Tier 额度仅对 Builder ID 用户开放" },
  { id: "cerebras-free", product: "Cerebras Inference", vendor: "Cerebras", category: "api-credit", claim: "注册即送 $5 免费额度，可在免费层跑推理，付费层速率限制提升 10 倍", free_scope: "新用户", quota: "$5 in free credit（注册后发放）", requirements: "邮箱注册；免费层无需信用卡", region: "GLOBAL", price_after: "$10 起充值（页面：Add funds starting at $10）", entries: ["API", "Playground"], source: "https://www.cerebras.ai/inference", sources: ["https://www.cerebras.ai/inference"], source_type: "official", confidence: "high", note: "免费层速率限制低于付费层" },
  { id: "claude-free", product: "Claude", vendor: "Anthropic", category: "chat", claim: "Free 档免费使用 Claude 聊天，无固定消息条数，按 5 小时滚动窗口限流", free_scope: "长期", quota: "no fixed message count；rolling five-hour session window", requirements: "邮箱/手机号注册", region: "GLOBAL", price_after: "Pro（页面未列价格）", entries: ["网页", "桌面", "移动"], source: "https://www.anthropic.com/pricing", sources: ["https://www.anthropic.com/pricing"], source_type: "official", confidence: "high", note: "页面明示 Free covers everyday questions；Claude Code 属付费档能力" },
  { id: "cline-free", product: "Cline", vendor: "Cline Bot", category: "ide", claim: "开源扩展对个人开发者完全免费，只付推理费，可自带各家 API Key", free_scope: "长期", quota: "free for individual developers；pay only for AI inference", requirements: "VSCode/JetBrains 安装，无需注册即可 BYOK", region: "GLOBAL", price_after: "$0（工具免费）；推理按量", entries: ["VSCode 扩展", "CLI", "JetBrains 插件"], source: "https://cline.bot/pricing", sources: ["https://cline.bot/pricing"], source_type: "official", confidence: "high", note: "支持 OpenAI/Anthropic/Gemini/DeepSeek/Groq/Cerebras 等 provider" },
  { id: "cf-workers-ai-free", product: "Cloudflare Workers AI", vendor: "Cloudflare", category: "api-free-models", claim: "Workers Free 计划每日 10,000 Neurons 免费推理额度，超出需 Workers Paid", free_scope: "长期", quota: "10,000 Neurons per day", requirements: "Cloudflare 账号；免费计划即可", region: "GLOBAL", price_after: "$0.011 / 1,000 Neurons（Workers Paid）", entries: ["API", "Workers 绑定"], source: "https://developers.cloudflare.com/workers-ai/platform/pricing/", sources: ["https://developers.cloudflare.com/workers-ai/platform/pricing/"], source_type: "official", confidence: "high", note: "页面注明 kimi-k2.6/glm-5.x/deepseek-v4 系列等模型需付费计划或 AI Gateway 预付额度" },
  { id: "cursor-free", product: "Cursor", vendor: "Anysphere", category: "ide", claim: "Free 档 $0：受限 AI 用量、受限 agent 请求与 chat 请求", free_scope: "长期", quota: "Limited AI usage；Limited agent requests；Limited Chat requests", requirements: "邮箱/Google/GitHub 登录", region: "GLOBAL", price_after: "Plus $8/mo", entries: ["桌面 IDE", "Web/Cloud Agents"], source: "https://cursor.com/pricing", sources: ["https://cursor.com/pricing"], source_type: "official", confidence: "high", note: "页面另注明部分第三方模型按 API 价单独计费" },
  { id: "fireworks-free", product: "Fireworks AI", vendor: "Fireworks", category: "api-credit", claim: "Muse Glimmer 30B 的 SFT 微调免费（UI 与 Serverless Training API），无需信用卡", free_scope: "限时", quota: "free via UI and Serverless Training API until 11/30", models: ["Muse Glimmer 30B"], requirements: "账号注册；无需信用卡", region: "GLOBAL", price_after: "按 token 预付费", entries: ["API", "Web UI"], source: "https://fireworks.ai/pricing", sources: ["https://fireworks.ai/pricing"], source_type: "official", confidence: "medium", note: "免费范围仅微调训练，不含推理 token；页面未列新用户赠送额度" },
  { id: "gemini-cli-free", product: "Gemini CLI", vendor: "Google", category: "cli", claim: "Google 账号登录免费 1,000 请求/天；用 Gemini API Key 免费层 250 请求/天", free_scope: "长期", quota: "1,000 requests per user per day（Google account）；250 requests（Free tier API key）", requirements: "Google 账号（或 AI Studio API Key）", region: "GLOBAL", price_after: "Google AI Pro 1,500 req/day；Ultra 2,000 req/day", entries: ["CLI", "Gemini Code Assist 免费层"], source: "https://google-gemini.github.io/gemini-cli/docs/quota-and-pricing.html", sources: ["https://google-gemini.github.io/gemini-cli/docs/quota-and-pricing.html"], source_type: "official", confidence: "high", note: "额度表来自官方仓库 docs/quota-and-pricing.md，按用户每日计" },
  { id: "copilot-free", product: "GitHub Copilot", vendor: "GitHub (Microsoft)", category: "ide", claim: "Copilot Free 每月有限 chat 与 agent 用量，支持 CLI 与 agent mode", free_scope: "长期", quota: "Free plan: Limited chat and agent usage", requirements: "GitHub 账号", region: "GLOBAL", price_after: "Pro（页面未列价格）", entries: ["VSCode", "JetBrains", "CLI", "GitHub 网页"], source: "https://github.com/features/copilot/plans", sources: ["https://github.com/features/copilot/plans"], source_type: "official", confidence: "high", note: "页面：Free plan supports CLI and agent mode；AI 用量以 GitHub AI Credits 计量" },
  { id: "groq-free", product: "GroqCloud", vendor: "Groq", category: "api-free-models", claim: "Free Plan 免费层可调用开源模型，按模型给出 RPM/RPD/TPM/TPD 限制", free_scope: "长期", quota: "Free Plan Limits 表（例：meta-llama/llama-prompt-guard-2-22m = 30 RPM / 14.4K RPD / 15K TPM / 500K TPD）", requirements: "邮箱注册", region: "GLOBAL", price_after: "Developer 计划（更高限速，页面未列价）", entries: ["API", "Playground"], source: "https://console.groq.com/docs/rate-limits", sources: ["https://console.groq.com/docs/rate-limits"], source_type: "official", confidence: "high", note: "各模型限额不同，需在账号 Limits 页查看实时值" },
  { id: "jetbrains-ai-free", product: "JetBrains AI", vendor: "JetBrains", category: "ide", claim: "IDE 内置 AI 提供免费档（详情页正文未抓取成功）", free_scope: "长期", quota: "未公开", requirements: "JetBrains 账号 + IDE", region: "GLOBAL", price_after: "未公开", entries: ["IDE 插件"], source: "https://www.jetbrains.com/ai-ides/", sources: ["https://www.jetbrains.com/ai-ides/"], source_type: "official", confidence: "low", note: "页面未抓取成功（纯前端渲染，正文仅 33 字符）；免费额度数值未确认" },
  { id: "kiro-free", product: "Kiro", vendor: "AWS", category: "coding-agent", claim: "Kiro Free 永久免费档含 50 credits，可用开源权重模型与 Claude Sonnet 4.5（含 DeepSeek 3.2、Qwen3 Coder Next、MiniMax M2.1）", free_scope: "长期", quota: "50 credits（perpetual Free tier）", models: ["Claude Sonnet 4.5", "DeepSeek 3.2", "Qwen3 Coder Next", "MiniMax M2.1"], requirements: "社交登录或 AWS Builder ID（免费）", region: "GLOBAL", price_after: "Pro $20/mo", entries: ["桌面 IDE", "spec 驱动 Agent"], source: "https://kiro.dev/pricing/", sources: ["https://kiro.dev/pricing/"], source_type: "official", confidence: "high", note: "页面：perpetual Kiro Free tier；Free Tier 模型访问受速率限制" },
  { id: "mistral-free", product: "Mistral Le Chat", vendor: "Mistral AI", category: "chat", claim: "Free 计划限量使用 Vibe（含最新模型）、chat/search/creation 与终端 Vibe for code，并可访问 Mistral Studio", free_scope: "长期", quota: "limited access（具体额度未公开）", requirements: "邮箱/手机号注册", region: "GLOBAL", price_after: "Pro（页面未列价格）", entries: ["网页", "移动", "CLI（Vibe for code）", "Studio"], source: "https://mistral.ai/pricing", sources: ["https://mistral.ai/pricing"], source_type: "official", confidence: "high", note: "页面：On the Free plan, you also get access to Mistral Studio" },
  { id: "nvidia-nim-free", product: "NVIDIA NIM", vendor: "NVIDIA", category: "api-free-models", claim: "build.nvidia.com 提供免费推理端点，含 DeepSeek-V4.1-Flash、Nemotron 系列等", free_scope: "长期", quota: "未公开（页面标注 Free inference with leading models）", models: ["deepseek-v4.1-flash", "nemotron-3.5-super-vl-120b-a12b", "nemotron-3.5-lightning-30b-a3b", "nemotron-3-ultra-550b-a55b"], requirements: "NVIDIA 账号", region: "GLOBAL", price_after: "未公开", entries: ["API", "Playground"], source: "https://build.nvidia.com/", sources: ["https://build.nvidia.com/"], source_type: "official", confidence: "medium", note: "页面确认免费推理与模型清单，但未给出请求额度数字" },
  { id: "codex-free", product: "OpenAI Codex CLI", vendor: "OpenAI", category: "cli", claim: "Codex 含在 ChatGPT Free 计划内，免费档可用但额度受限；Free 档不含图片生成", free_scope: "长期", quota: "included in ChatGPT Free plan（具体额度未公开）", requirements: "ChatGPT 账号（邮箱）", region: "GLOBAL", price_after: "Go/Plus（页面未列价格）", entries: ["CLI", "IDE 插件", "网页"], source: "https://developers.openai.com/codex/pricing", sources: ["https://developers.openai.com/codex/pricing"], source_type: "official", confidence: "high", note: "页面原文：ChatGPT Work and Codex are included in your ChatGPT Free, Go, Plus, Pro... plan" },
  { id: "openrouter-free", product: "OpenRouter", vendor: "OpenRouter", category: "api-free-models", claim: "带 :free 后缀的模型输入/输出均 $0/M，免费模型有每分钟/每日请求上限", free_scope: "长期", quota: "free-model RPM/RPD 上限（页面 Free usage limits 表，具体数值前端未渲染）", models: ["Recursive: Flint (free)", "Baseten: Mammoth 1 (free)", "Baseten: Elephant 1 (free)", "NVIDIA: Nemotron 3.5 Embed 1B (free)"], requirements: "邮箱/Google 登录", region: "GLOBAL", price_after: "$0（免费模型）；付费模型按量", entries: ["API", "Web"], source: "https://openrouter.ai/models?max_price=0", sources: ["https://openrouter.ai/models?max_price=0"], source_type: "official", confidence: "high", note: "模型列表页实测多个 $0/M input/output 的 :free 模型" },
  { id: "perplexity-comet-free", product: "Perplexity / Comet", vendor: "Perplexity AI", category: "chat", claim: "Comet 浏览器提供免费档（FAQ 有 Is Comet free? 条目）", free_scope: "长期", quota: "未公开", requirements: "邮箱/Google 登录", region: "GLOBAL", price_after: "Pro（页面未列价格）", entries: ["网页", "Comet 浏览器"], source: "https://www.perplexity.ai/comet", sources: ["https://www.perplexity.ai/comet"], source_type: "official", confidence: "low", note: "页面未抓取成功：FAQ 答案由前端渲染，正文仅有问题标题；定价页 /pricing 返回 404" },
  { id: "qoder-free", product: "Qoder", vendor: "Alibaba", category: "coding-agent", claim: "国际版 Free：2 周 Pro 试用 300 Credits + 桌面端每日可领 100 Credits；内置 DeepSeek-Flash 按 0.1× Credits 计（白嫖的是 Credits）；也可用自带 DeepSeek Key 直连，按 DeepSeek 原价结算、不占 Credits", free_scope: "长期", quota: "2-week Pro trial: 300 credits；Claim 100 Credits every day（每份 30 天有效，可结转）", models: ["DeepSeek-Flash", "DeepSeek-V4-Pro", "Qwen3.8-Flash", "GLM-5.3-Flash", "MiniMax-M3.1-Flash"], requirements: "邮箱注册；需 Qoder International（国际版）", region: "GLOBAL", price_after: "Lite $10/mo", entries: ["桌面应用（Qoder IDE）"], source: "https://docs.qoder.com/account/pricing.md", sources: ["https://docs.qoder.com/account/pricing.md", "https://docs.qoder.com/qoder/model-selector", "https://api-docs.deepseek.com/zh-cn/quick_start/agent_integrations/qoder"], source_type: "official", confidence: "high", note: "模型清单与倍率来自 docs.qoder.com/qoder/model-selector；DeepSeek 两档采用峰谷价；100 Credits 活动 2026-09-18 起，结束时间待公布" },
  { id: "roo-code-free", product: "Roo Code (Roomote)", vendor: "Roomote", category: "ide", claim: "自托管版对 ≤10 用户免费；Roomote Cloud 提供 7 天免费试用（无需信用卡）", free_scope: "长期", quota: "Self-hosted free for up to 10 users；Cloud 7-day trial", requirements: "自托管部署；云端试用仅需邮箱", region: "GLOBAL", price_after: "$49/mo（Cloud）", entries: ["VSCode 扩展", "自托管", "Cloud"], source: "https://roocode.com/pricing", sources: ["https://roocode.com/pricing"], source_type: "official", confidence: "high", note: "开源代理式编码工具，推理需自备各家 Key" },
  { id: "together-free", product: "Together AI", vendor: "Together AI", category: "api-free-models", claim: "部分模型标价 $0（如 Tev1 4B Experimental），可免费调用", free_scope: "长期", quota: "模型级 Free（定价 $0）", models: ["Tev1 4B Experimental"], requirements: "邮箱注册", region: "GLOBAL", price_after: "其余模型按 $/1M tokens 计费", entries: ["API"], source: "https://www.together.ai/pricing", sources: ["https://www.together.ai/pricing"], source_type: "official", confidence: "medium", note: "页面未列新用户赠送额度，仅个别实验模型免费" },
  { id: "trae-free", product: "Trae", vendor: "ByteDance", category: "ide", claim: "Free $0：仅 Auto 模式、有限用量与有限自动补全，5,000 次补全/月", free_scope: "长期", quota: "Autocompletion 5000 / month；Limited usage；2 concurrent cloud tasks", requirements: "邮箱/Google 登录；国际版 trae.ai", region: "GLOBAL", price_after: "Pro $20/mo", entries: ["桌面 IDE", "TraeWork 云任务"], source: "https://www.trae.ai/pricing", sources: ["https://www.trae.ai/pricing"], source_type: "official", confidence: "high", note: "Free 档仅 Auto mode，不含全部模型选择" },
  { id: "windsurf-free", product: "Windsurf", vendor: "Cognition", category: "ide", claim: "Free $0：轻量 agent 编码额度 + 无限 Tab 补全与 inline edits，可用 SWE-2", free_scope: "长期", quota: "light quota to code with agents；unlimited Tab completions / inline edits", models: ["SWE-2"], requirements: "邮箱注册", region: "GLOBAL", price_after: "未公开", entries: ["桌面 IDE", "JetBrains 插件"], source: "https://windsurf.com/pricing", sources: ["https://windsurf.com/pricing"], source_type: "official", confidence: "high", note: "页面：limited model availability" },
  { id: "workbuddy-free", product: "WorkBuddy", vendor: "Tencent（CodeBuddy 团队）", category: "coding-agent", claim: "腾讯 CodeBuddy 团队的办公 AI Agent 国际版；官网写 start free；DeepSeek 官方文档确认可用自有 Key 接入 deepseek-flash（BYOK），内置模型的免费额度未公开", free_scope: "公测", quota: "start free（具体额度未公开，需客户端内查看）", requirements: "桌面客户端（Mac / Windows）", region: "GLOBAL", price_after: "未公开", entries: ["桌面 App", "网页"], source: "https://workbuddy.ai/", sources: ["https://workbuddy.ai/"], source_type: "official", confidence: "low", note: "官网为纯前端 SPA，正文仅标题；meta description 原文为 start free。用户线索称可用 DeepSeek 4.1 Flash，官方页面未证实，故未写入模型清单" },
  { id: "zed-free", product: "Zed", vendor: "Zed Industries", category: "ide", claim: "Personal 计划 $0 永久免费；自带 API Key 或接 Claude Agent / Codex CLI 可无限使用", free_scope: "长期", quota: "$0 forever；unlimited use with your API keys or external agents", requirements: "本地安装，无需注册", region: "GLOBAL", price_after: "Pro $10/mo（含 $5 tokens）", entries: ["桌面编辑器", "Agent 面板"], source: "https://zed.dev/pricing", sources: ["https://zed.dev/pricing"], source_type: "official", confidence: "high", note: "Zed 托管模型属 Pro；Personal 仅编辑器 + 外部 agent" },
  { id: "minimax-free", product: "MiniMax 开放平台", vendor: "MiniMax", category: "api-credit", claim: "存在免费额度（计费页按“超出免费额度后”计价），具体额度未公开", free_scope: "新用户", quota: "未公开", requirements: "手机号注册", region: "CN", price_after: "按量计费（元/百万 tokens）", entries: ["API"], source: "https://platform.minimaxi.com/document/Price", sources: ["https://platform.minimaxi.com/document/Price"], source_type: "official", confidence: "low", note: "页面仅出现“超出免费额度后”，未给出免费额度数值与有效期" },
  { id: "modelscope-free", product: "ModelScope 魔搭", vendor: "Alibaba", category: "api-free-models", claim: "提供免费模型 API 推理（文档页前端渲染，正文未抓到）", free_scope: "长期", quota: "未公开", requirements: "阿里云账号", region: "CN", price_after: "未公开", entries: ["API", "Notebook"], source: "https://modelscope.cn/docs/model-service/API-Inference/intro", sources: ["https://modelscope.cn/docs/model-service/API-Inference/intro"], source_type: "official", confidence: "low", note: "页面未抓取成功：返回仅 7 字符的 SPA 壳；免费调用额度未确认" },
  { id: "iflow-free", product: "心流 iFlow", vendor: "iFlow", category: "chat", claim: "免费 AI 助手（网页/App），提供问答、网页总结、文档撰写", free_scope: "长期", quota: "未公开", requirements: "手机号/邮箱注册", region: "CN", price_after: "未公开", entries: ["网页", "App"], source: "https://iflow.cn/", sources: ["https://iflow.cn/"], source_type: "official", confidence: "medium", note: "落地页确认产品免费使用，未列出调用额度" },
  { id: "zhipu-free", product: "智谱 GLM", vendor: "Zhipu AI", category: "api-free-models", claim: "GLM-4.7-Flash、GLM-4.5-Flash、GLM-4-Flash、GLM-4.6V-Flash 等为免费模型，另有多款免费图像/视频模型", free_scope: "长期", quota: "免费模型不计费（页面标注“免费文本模型/免费模型”）", models: ["GLM-4.7-Flash", "GLM-4.5-Flash", "GLM-4-Flash-250414", "GLM-4.6V-Flash", "GLM-4.1V-Thinking-Flash", "GLM-4V-Flash", "CogView-3-Flash", "CogVideoX-Flash"], requirements: "手机号注册", region: "CN", price_after: "GLM-5.3 等旗舰模型按量计费", entries: ["API", "Web"], source: "https://docs.bigmodel.cn/cn/guide/start/model-overview", sources: ["https://docs.bigmodel.cn/cn/guide/start/model-overview"], source_type: "official", confidence: "high", note: "GLM Coding Plan 为付费订阅（Lite 2,000 积分/5h、10,000/周），不属免费额度" },
  { id: "volc-doubao-free", product: "火山方舟（豆包）", vendor: "ByteDance", category: "api-credit", claim: "Managed Agents 首次开通赠 30 小时 Agent 运行时 + 500 次 web_search；doubao-seedream 图片模型首张免费/部分型号免费", free_scope: "新用户", quota: "30 小时 Agent 运行时 + 500 次 web_search 调用；doubao-seedream-5-0-pro 首张免费（第2张起 0.02 元）", models: ["doubao-seedream-5-0-flash", "doubao-seedream-4-5"], requirements: "火山引擎账号 + 实名", region: "CN", price_after: "按量计费（元/百万 token）", entries: ["API", "控制台"], source: "https://www.volcengine.com/docs/82379/1099320", sources: ["https://www.volcengine.com/docs/82379/1099320"], source_type: "official", confidence: "medium", note: "免费额度以资源包形式优先抵扣；文本模型未见免费 token 额度" },
  { id: "comate-free", product: "百度 Comate（文心快码）", vendor: "Baidu", category: "ide", claim: "价格页标注免费（个人免费档），具体额度未抓取", free_scope: "长期", quota: "未公开", requirements: "百度账号", region: "CN", price_after: "未公开", entries: ["IDE 插件"], source: "https://comate.baidu.com/zh/pricing", sources: ["https://comate.baidu.com/zh/pricing"], source_type: "official", confidence: "low", note: "页面未抓取成功：正文由前端渲染，仅标题含“免费”；额度数值未确认" },
  { id: "qianfan-free", product: "百度千帆", vendor: "Baidu", category: "api-credit", claim: "产品页多处标注“免费试用”，新用户可领试用额度（具体数值未公开）", free_scope: "新用户", quota: "未公开", requirements: "百度智能云账号 + 实名", region: "CN", price_after: "按量计费（元/千 tokens）", entries: ["API", "控制台"], source: "https://cloud.baidu.com/product/qianfan", sources: ["https://cloud.baidu.com/product/qianfan"], source_type: "official", confidence: "low", note: "页面确认“免费试用”入口，未列具体额度；另有 Token Plan 个人版（付费）" },
  { id: "siliconflow-free", product: "硅基流动 SiliconFlow", vendor: "SiliconFlow", category: "api-free-models", claim: "多款模型标价“免费”，可直接调用（如腾讯 Hunyuan-MT-7B、BAAI bge-m3、PaddleOCR-VL）", free_scope: "长期", quota: "模型级免费（页面价格列显示“免费”）", models: ["tencent/Hunyuan-MT-7B", "BAAI/bge-m3", "BAAI/bge-reranker-v2-m3", "PaddlePaddle/PaddleOCR-VL-1.5", "XingChenAGI/Xing4.0-29B"], requirements: "手机号注册", region: "CN", price_after: "其余模型按 ¥/M tokens", entries: ["API", "Web"], source: "https://siliconflow.cn/pricing", sources: ["https://siliconflow.cn/pricing"], source_type: "official", confidence: "high", note: "免费模型以 embedding/OCR/翻译类为主，旗舰对话模型仍计费" },
  { id: "codebuddy-free", product: "腾讯 CodeBuddy", vendor: "Tencent", category: "ide", claim: "提供免费个人版，另有“限时免费企业旗舰版”", free_scope: "长期", quota: "免费个人版（额度未公开）", requirements: "腾讯云账号", region: "CN", price_after: "未公开", entries: ["IDE 插件", "独立 IDE"], source: "https://copilot.tencent.com/pricing", sources: ["https://copilot.tencent.com/pricing"], source_type: "official", confidence: "medium", note: "页面正文由前端渲染，报价文案来自页面元信息：免费个人版、限时免费企业旗舰版" },
  { id: "hunyuan-free", product: "腾讯混元", vendor: "Tencent", category: "api-credit", claim: "首次开通送 100 万 tokens 免费资源包（生文），有效期 1 年", free_scope: "新用户", quota: "共100万 tokens，共享消耗；资源包有效期 1 年", requirements: "腾讯云个人/企业实名认证", region: "CN", price_after: "按量后付费", entries: ["API"], source: "https://cloud.tencent.com/document/product/1729/97731", sources: ["https://cloud.tencent.com/document/product/1729/97731"], source_type: "official", confidence: "high", note: "页面提示混元能力正迁移至 TokenHub，原平台不再新增模型能力" },
  { id: "spark-free", product: "讯飞星火", vendor: "iFlytek", category: "api-credit", claim: "Spark Lite 免费使用；控制台可领免费额度（数值未公开）", free_scope: "长期", quota: "Lite 免费使用；免费额度需在产品页/控制台领取", models: ["Spark Lite"], requirements: "手机号注册 + 实名认证", region: "CN", price_after: "按 tokens 计费", entries: ["API", "Web"], source: "https://www.xfyun.cn/doc/spark/HTTP%E8%B0%83%E7%94%A8%E6%96%87%E6%A1%A3.html", sources: ["https://www.xfyun.cn/doc/spark/HTTP%E8%B0%83%E7%94%A8%E6%96%87%E6%A1%A3.html"], source_type: "official", confidence: "medium", note: "文档：Lite 具有更高响应速度、支持免费使用；各版本独立计量 tokens" },
  { id: "lingma-free", product: "通义灵码", vendor: "Alibaba", category: "ide", claim: "个人免费使用、企业免费开通；含编程智能体、终端命令执行与 Lingma IDE（公测）", free_scope: "长期", quota: "个人免费使用（额度未公开）", requirements: "阿里云账号", region: "CN", price_after: "$0", entries: ["Lingma IDE", "VSCode 插件", "JetBrains 插件", "Visual Studio 插件"], source: "https://lingma.aliyun.com/", sources: ["https://lingma.aliyun.com/"], source_type: "official", confidence: "high", note: "页面原文：企业免费开通 个人免费使用；Lingma IDE 全面公测" },
  { id: "bailian-free", product: "阿里云百炼", vendor: "Alibaba", category: "api-credit", claim: "首次开通自动发放各模型新人免费额度，90 天有效；qwen-max 总免费额度 100 万 Token", free_scope: "新用户", quota: "qwen-max 总免费额度 100 万 Token；免费额度有效期 90 天", models: ["qwen-max"], requirements: "阿里云账号 + 实名认证；仅华北2（北京）地域", region: "CN", price_after: "额度用尽转按量计费", entries: ["API", "控制台"], source: "https://help.aliyun.com/zh/model-studio/new-free-quota", sources: ["https://help.aliyun.com/zh/model-studio/new-free-quota"], source_type: "official", confidence: "high", note: "各模型额度独立不互通；Batch/调优/部署不可抵扣；同一实名主体重注册不再发" },
];

/* ────────────────────────── 4. 一手情报 ────────────────────────── */
const SIGNALS = [
  { id: "x-001", handle: "@deepseek_ai", date: "2026-10-17", url: "https://x.com/deepseek_ai/status/2111375640717033777", quote: "DeepSeek-V4.1-Flash-1017 is here! Stronger benchmark performance, faster task completion, and shorter outputs than the previous version—a Pareto improvement in performance and cost.", lang: "en", topic: "new-model", affects: ["DeepSeek-V4.1-Flash-1017", "deepseek-flash"], source_type: "x", confidence: "high", note: "官方账号原话，已打开原帖核对正文" },
  { id: "x-002", handle: "@Alibaba_Qwen", date: "2026-10-07", url: "https://x.com/Alibaba_Qwen/status/2107706772815499318", quote: "We're extending FREE Qwen 3.8 Max + Flash for 7 more days! And we've increased rate limits across all 3 models.", lang: "en", topic: "free-tier", affects: ["Qwen3.8-Max", "Qwen3.8-Flash", "Wan3.0"], source_type: "x", confidence: "high", note: "官方账号原话；免费期延长+提额，未写结束绝对日期" },
  { id: "x-003", handle: "@Alibaba_Qwen", date: "2026-10-06", url: "https://x.com/Alibaba_Qwen/status/2107510552792854783", quote: "Qwen 3.8 Max, Qwen 3.8 Flash, and Wan 3.0 are FREE on GMI Cloud for the next 12 hours … Running Qwen at scale? Apply for up to $10K in credits per org", lang: "en", topic: "free-tier", affects: ["Qwen3.8-Max", "Qwen3.8-Flash", "Wan3.0", "GMI Cloud"], source_type: "x", confidence: "high", note: "渠道侧限时免费（GMI Cloud），另含最高 $10K 额度申请" },
  { id: "x-004", handle: "@Alibaba_Qwen", date: "2026-08-26", url: "https://x.com/Alibaba_Qwen/status/2092591393424515114", quote: "The production version Qwen3.8-Flash will be available soon via QwenCloud API at just $0.16/1M input tokens and $0.47/1M output tokens.", lang: "en", topic: "new-model", affects: ["Qwen3.8-Flash", "QwenCloud API"], source_type: "x", confidence: "high", note: "官方账号公布 API 定价（发布时点）" },
  { id: "x-005", handle: "@cursor_ai", date: "2026-10-13", url: "https://x.com/cursor_ai/status/2110087611763368271", quote: "Gemini 4 Argon is now available in Cursor! … Priced at $2/M input and $10/M output tokens.", lang: "en", topic: "new-model", affects: ["Gemini 4 Argon", "Cursor"], source_type: "x", confidence: "high", note: "编辑器侧转售定价，可与 Google 官方价对比" },
  { id: "x-006", handle: "@cursor_ai", date: "2026-10-15", url: "https://x.com/cursor_ai/status/2110867556693430293", quote: "Muse Wonder from Meta Superintelligence Labs is now available in Cursor! … Priced at $4/M input and $20/M output tokens.", lang: "en", topic: "new-model", affects: ["Muse Wonder", "Cursor"], source_type: "x", confidence: "high", note: "Meta 新模型在 Cursor 的定价，官方账号原话" },
  { id: "x-007", handle: "@OpenAI", date: "2026-08-06", url: "https://openai.com/index/improving-gpt-5-6-sol-in-chatgpt", quote: "For Free users, we're updating the default model to GPT-5.6 Luna and expanding access with unlimited text chats.", lang: "en", topic: "free-tier", affects: ["ChatGPT Free", "GPT-5.6 Luna"], source_type: "blog", confidence: "high", note: "日期取自 OpenAI 官方 RSS pubDate；正文经代理抓取" },
  { id: "x-008", handle: "@OpenAI", date: "2026-09-22", url: "https://openai.com/index/introducing-gpt-6-sol-and-luna", quote: "GPT-6 Sol: $4 → $2 input, $20 → $10 output (50% cheaper); GPT-6 Luna: $0.20 → $0.10, $1.20 → $0.50. Prices per 1M tokens.", lang: "en", topic: "price-cut", affects: ["GPT-6 Sol", "GPT-6 Luna", "OpenAI API"], source_type: "blog", confidence: "high", note: "官方定价表原文，降价幅度 50%" },
  { id: "x-009", handle: "@OpenAI", date: "2026-09-22", url: "https://openai.com/index/better-prompt-caching-for-gpt-6", quote: "OpenAI caches that shared context … giving developers discounts of up to 90% on cached input tokens. We now give cache discounts for eligible shared prefixes reused within a 30-minute window.", lang: "en", topic: "cache-pricing", affects: ["GPT-6", "OpenAI Prompt Caching"], source_type: "blog", confidence: "high", note: "缓存折扣最高 90%，新增 30 分钟窗口与命中诊断" },
  { id: "x-010", handle: "@OpenAI", date: "2026-09-29", url: "https://openai.com/index/introducing-gpt-6-1-sol", quote: "…nearly matches GPT-6 Astra's intelligence … at one-fifth of Astra's standard input and output token prices. Cached input costs just $0.10 per million tokens—95% less than standard input pricing", lang: "en", topic: "new-model", affects: ["GPT-6.1 Sol"], source_type: "blog", confidence: "high", note: "同时给出缓存价 $0.10/M（比 GPT-6 Sol 缓存价再低 50%）" },
  { id: "x-011", handle: "@AnthropicAI", date: "2026-09-22", url: "https://www.anthropic.com/claude-opus-5-5", quote: "Input and output tokens are $4 and $20 per million, 20% less than Opus 5. Cache reads … $0.20 per million tokens, 60% less than Opus 5 … 40% less than Opus 5 on typical workloads.", lang: "en", topic: "price-cut", affects: ["Claude Opus 5.5"], source_type: "newsroom", confidence: "high", note: "Newsroom 公告页；另称提高 Pro/Max/Team 的五小时用量上限" },
  { id: "x-012", handle: "@AnthropicAI", date: "2026-09-28", url: "https://www.anthropic.com/claude-sonnet-5-5", quote: "…priced the same as Sonnet 5 at $2 per million input tokens and $10 per million output tokens … Cache reads cost $0.10 per million tokens, half of Sonnet 5's $0.20.", lang: "en", topic: "new-model", affects: ["Claude Sonnet 5.5"], source_type: "newsroom", confidence: "high", note: "单价持平但缓存读减半，官方称每任务成本降约 30%" },
  { id: "x-013", handle: "@AnthropicAI", date: "2026-10-07", url: "https://www.anthropic.com/claude-haiku-5-5", quote: "Haiku 5.5 … costs around 75% less to run [than Haiku 4.5]. Input $0.10/$0.50, output $0.50/$2.50, cache reads $0.01/$0.05 per 1M; new monthly API credit for Claude Max and Team subscribers.", lang: "en", topic: "price-cut", affects: ["Claude Haiku 5.5", "Claude Max", "Claude Team"], source_type: "newsroom", confidence: "high", note: "≤100k / >100k 两档价；同时下调 Sonnet 5.5 缓存读价" },
  { id: "x-014", handle: "@deepseek_ai", date: "2026-09-10", url: "https://api-docs.deepseek.com/news/news260910", quote: "More efficient architecture. Lower API prices… Off-peak rates are 50% of peak rates… New pricing takes effect at 04:00 UTC on Sept 10, 2026.", lang: "en", topic: "price-cut", affects: ["DeepSeek-V4.1-Flash", "deepseek-flash"], source_type: "blog", confidence: "high", note: "同文称 KV cache 仅需前代 1/4 HBM、1/8 SSD，直接压低 cache-hit 成本" },
  { id: "x-015", handle: "@deepseek_ai", date: "2026-10-17", url: "https://api-docs.deepseek.com/news/news261017", quote: "Search & Fetch APIs are now open to everyone! Each endpoint: $0.75 per 1,000 calls… free for DeepSeek API users. Billing starts Oct 31, 2026, at 16:00 UTC.", lang: "en", topic: "free-tier", affects: ["DeepSeek Search API", "DeepSeek Fetch API", "DeepSeek Harness"], source_type: "blog", confidence: "high", note: "Harness/Claude Code/Codex 内的服务端调用目前免费，10/31 起计费" },
  { id: "x-016", handle: "@deepseek_ai", date: "2026-10-23", url: "https://api-docs.deepseek.com/quick_start/pricing", quote: "deepseek-flash: cache hit $0.003 off-peak / $0.006 peak; cache miss $0.15 / $0.30; output $0.60 / $1.20 per 1M tokens. Off-peak rates are half of the peak rates.", lang: "en", topic: "cache-pricing", affects: ["deepseek-flash", "DeepSeek-V4.1-Flash-1017"], source_type: "blog", confidence: "medium", note: "价格页当日快照（未标生效日）；V4-Pro 缓存价 $0.022/$0.044" },
  { id: "x-017", handle: "@OpenRouterAI", date: "2026-09-22", url: "https://openrouter.ai/blog/announcements/batch-api/", quote: "…a provider gets to choose when during a 24 hour window they will complete the request, and in exchange they generally charge 50% (and sometimes less) of their normal per-token price.", lang: "en", topic: "price-cut", affects: ["OpenRouter Batch API"], source_type: "blog", confidence: "high", note: "覆盖 70+ 模型；Beta 期 23 万批次中位 7 分钟完成" },
  { id: "x-018", handle: "@MiniMax_AI", date: "2026-10-19", url: "https://www.minimax.io/blog/minimax-m31f", quote: "…reducing usage costs by 70%. Flat pricing per 1M tokens: $0.15 input · $0.60 output · $0.015 cached input.", lang: "en", topic: "price-cut", affects: ["MiniMax M3.1 Flash"], source_type: "blog", confidence: "high", note: "官方 blog，文内明确 70% 降本与三档单价" },
  { id: "x-019", handle: "@xai", date: "2026-10-14", url: "https://x.ai/news/grok-voice-3", quote: "…available today in the API at the same price as its predecessor… costs less than other frontier models.", lang: "en", topic: "price-cut", affects: ["Grok Voice 3.0", "xAI API"], source_type: "blog", confidence: "high", note: "涨价未发生：新款按前代原价卖，官方称比同类前沿语音模型便宜" },
  { id: "x-020", handle: "Google (Gemini API)", date: "2026-10-22", url: "https://ai.google.dev/gemini-api/docs/pricing", quote: "Gemini 4 Argon: input $2.00 through Nov 30, 2026, $4.00 from Dec 1; output $10.00 → $20.00; context caching $0.10 → $0.20 (implicit caching only). Free tier: not available.", lang: "en", topic: "cache-pricing", affects: ["Gemini 4 Argon"], source_type: "blog", confidence: "high", note: "文档页标注的发布/更新时间为 2026-10-22；12/1 起价格翻倍，需提前锁量" },
  { id: "x-021", handle: "Z.ai (Zhipu)", date: "2026-10-23", url: "https://docs.z.ai/guides/overview/pricing", quote: "GLM-5.3 $1.4 in / $0.26 cached / $4.4 out; GLM-5.3-Flash $0.15 / $0.03 / $0.50; GLM-4.7-Flash Free (per 1M tokens); cached-input storage 'Limited-time Free'.", lang: "en", topic: "cache-pricing", affects: ["GLM-5.3", "GLM-5.3-Flash", "GLM-4.7-Flash"], source_type: "blog", confidence: "medium", note: "价格页当日快照；GLM-5.3-Flash 发布日 2026-08-26（官方 release notes）" },
];


/* ────────────────────────── 4. 订阅（官方价，人工核实） ────────────────────────── */
const SUBSCRIPTIONS = [
  { product: 'ChatGPT', vendor: 'OpenAI', tier: 'Go', price: 8, period: '月', note: '含广告；额度低于 Plus', url: 'https://openai.com/chatgpt/pricing/', buy: 'https://chatgpt.com/explore/go', conf: 'high' },
  { product: 'ChatGPT', vendor: 'OpenAI', tier: 'Plus', price: 20, period: '月', note: 'GPT-6 推理、扩展 Codex', url: 'https://openai.com/chatgpt/pricing/', buy: 'https://chatgpt.com/explore/plus', conf: 'high' },
  { product: 'ChatGPT', vendor: 'OpenAI', tier: 'Pro', price: 100, period: '月起', note: '官网写 From $100，含 3 档用量', url: 'https://openai.com/chatgpt/pricing/', buy: 'https://chatgpt.com/explore/pro', conf: 'high' },
  { product: 'Claude', vendor: 'Anthropic', tier: 'Pro', buy: 'https://claude.com/pricing', price: 20, period: '月', note: '年付折算 $17/月（一次付 $200）', url: 'https://claude.com/pricing', conf: 'high' },
  { product: 'Claude', vendor: 'Anthropic', tier: 'Max 5x', buy: 'https://claude.com/pricing', price: 100, period: '月', note: '5 倍用量', url: 'https://claude.com/pricing', conf: 'high' },
  { product: 'Claude', vendor: 'Anthropic', tier: 'Max 20x', buy: 'https://claude.com/pricing', price: 200, period: '月', note: '20 倍用量', url: 'https://claude.com/pricing', conf: 'high' },
  { buy: 'https://github.com/features/copilot/plans', product: 'GitHub Copilot', vendor: 'GitHub', tier: 'Free', price: 0, period: '月', note: '有限 chat / agent 用量', url: 'https://github.com/features/copilot/plans', conf: 'high' },
  { buy: 'https://github.com/features/copilot/plans', product: 'GitHub Copilot', vendor: 'GitHub', tier: 'Pro', price: 10, period: '月', note: '含每月 $15 credits', url: 'https://github.com/features/copilot/plans', conf: 'high' },
  { buy: 'https://github.com/features/copilot/plans', product: 'GitHub Copilot', vendor: 'GitHub', tier: 'Pro+', price: 39, period: '月', note: '含每月 $70 credits', url: 'https://github.com/features/copilot/plans', conf: 'high' },
  { buy: 'https://github.com/features/copilot/plans', product: 'GitHub Copilot', vendor: 'GitHub', tier: 'Max', price: 100, period: '月', note: '含每月 $200 credits', url: 'https://github.com/features/copilot/plans', conf: 'high' },
];


/* 第三方挂单价样本：公开挂单页快照，仅作行情参考，不构成购买建议 */
const SUBS_THIRD = [
  { product: 'ChatGPT Go', route: '官方直充月卡', price_cny: 48, platform: 'Tokyo', note: '页面称真实付费开通；官方 $8≈¥56.8' },
  { product: 'ChatGPT Plus', route: '成品号（首登质保）', price_cny: 25.52, platform: 'LDXP', note: '账号+密码，质保首登；稳定性自负' },
  { product: 'ChatGPT Plus', route: '成品号 + 反代', price_cny: 28.18, platform: 'LDXP', note: '网页与反代双用，标称老号耐活' },
  { product: 'ChatGPT Plus', route: '月卡成品号', price_cny: 40, platform: 'LDXP', note: '整月可用，首登质保' },
  { product: 'ChatGPT Plus', route: '镜像站 周卡', price_cny: 24, platform: 'LDXP', note: '共享镜像站，非官方账号' },
  { product: 'ChatGPT Plus', route: '镜像站 天卡', price_cny: 4.5, platform: 'LDXP', note: '按天试用，稳定性未知' },
];

/* ────────────────────────── 5. 中转站（自动探测 /api/pricing） ────────────────────────── */
// auto: 该站公开 OneAPI/NewAPI 价目接口，脚本每天自动采；false 的只登记、等人工核价
const RELAYS = [
  { domain: 'api.laozhang.ai', name: '老张 API', auto: true },
  { domain: 'api.bltcy.ai', name: '柏拉图 API', auto: true },
  { domain: 'api.right.codes', name: 'Right Code', auto: true },
  { domain: 'packycode.com', name: 'Packy Code', auto: true },
  { domain: 'cctq.ai', name: 'CCTQ', auto: true },
  { domain: 'api.ephone.ai', name: 'Ephone', auto: true },
  { domain: 'newapi.dev', name: 'NewAPI 演示站', auto: true },
  { domain: 'api.catbeeai.com', name: 'CatBee AI', auto: true },
  { domain: 'api.dogbeeai.com', name: 'DogBee AI', auto: true },
  { domain: 'micu.ai', name: 'Micu', auto: true },
  { domain: '4router.com', name: '4Router', auto: true },
  { domain: 'api.4router.com', name: '4Router API', auto: true },
  { domain: 'api.aihubmix.com', name: 'AiHubMix', auto: true },
  { domain: 'api.openai-hk.com', name: 'OpenAI-HK', auto: true },
  { domain: 'api.chatanywhere.tech', name: 'ChatAnywhere', auto: true },
  { domain: 'api.gptgod.online', name: 'GPTGOD', auto: true },
  { domain: 'api.closeai-asia.com', name: 'CloseAI', auto: true },
  { domain: 'api.api2d.com', name: 'API2D', auto: true },
  { domain: 'api.deerapi.com', name: 'DeerAPI', auto: true },
  { domain: 'api.wokaai.com', name: 'WokaAI', auto: true },
  { domain: 'api.poloapi.com', name: 'PoloAPI', auto: true },
  { domain: 'api.yunwu.ai', name: '云雾 API', auto: true },
  { domain: 'api.nanoapi.ai', name: 'NanoAPI', auto: true },
  { domain: 'api.302.ai', name: '302.AI', auto: true },
  { domain: 'api.aicodemirror.com', name: 'AI Code Mirror', auto: true },
  { domain: 'api.duckcoding.com', name: 'DuckCoding', auto: true },
  { domain: 'api.apicat.ai', name: 'APICat', auto: true },
  { domain: 'api.v3.cm', name: 'V3 API', auto: true },
  { domain: 'api.oaipro.com', name: 'OAIPRO', auto: true },
  { domain: 'api.gptsapi.net', name: 'GPTS API', auto: true },
  { domain: 'api.aiproxy.io', name: 'AIProxy', auto: true },
  { domain: 'api.openai-sb.com', name: 'OpenAI-SB', auto: true },
  { domain: 'api.gptapi.us', name: 'GPTAPI', auto: true },
  { domain: 'api.subapi.cc', name: 'SubAPI', auto: true },
  { domain: 'api.apifox.com', name: 'Apifox', auto: true },
  { domain: 'api.oneapi.dev', name: 'OneAPI 演示站', auto: true },
  { domain: 'api.dujiaoka.com', name: 'Dujiaoka', auto: false },
  { domain: 'api.linshiyouxiang.net', name: '临时邮箱（参考）', auto: false },

  // 2026-10 从 open-source 中转站清单（awesome-ai-proxy / relayAPI /
  // ai-coding-welfare / relaywatch）批量探测出的公开价目站
  { domain: 'kfcv50.link', name: 'KFC API', auto: true },
  { domain: '35.aigcbest.top', name: 'AIGCBest', auto: true },
  { domain: 'www.ggwk1.online', name: 'GGWK', auto: true },
  { domain: 'go.sbgpt.site', name: 'SBGPT', auto: true },
  { domain: 'api.aabao.top', name: 'AABao', auto: true },
  { domain: 'apipro.maynor1024.live', name: 'Maynor', auto: true },
  { domain: 'www.openai-labs.com', name: 'OpenAI Labs', auto: true },
  { domain: 'cnapi.kksj.org', name: 'KKSJ', auto: true },
  { domain: 'us-3.nianhuaapi.com', name: '年华 API', auto: true },
  { domain: 'api.nekoapi.com', name: 'NekoAPI', auto: true },
  { domain: 'nova.vcrauo.com', name: 'Nova', auto: true },
  { domain: 'api456.me', name: 'API456', auto: true },
  { domain: 'xeduapi.com', name: 'XEdu', auto: true },
  { domain: 'agentrouter.org', name: 'AgentRouter', auto: true },
  { domain: 'ps.air-outer.com', name: 'Air Outer', auto: true },
  { domain: 'chuan.sylu.cc', name: '川流 API', auto: true },
];

// 用来对比的旗舰模型：key 固定，正则匹配上游命名差异
const FLAGSHIP = [
  { key: 'sonnet55', label: 'Claude Sonnet 5.5', re: /claude.*sonnet.*5[.\-]?5/i, official: [2, 10] },
  { key: 'opus55', label: 'Claude Opus 5.5', re: /claude.*opus.*5[.\-]?5/i, official: [4, 20] },
  { key: 'gpt61sol', label: 'GPT-6.1 Sol', re: /gpt[.\-]?6[.\-]?1[.\-]?sol/i, official: [2, 10] },
  { key: 'gemini4argon', label: 'Gemini 4 Argon', re: /gemini[.\-]?4[.\-]?argon/i, official: [2, 10] },
  { key: 'deepseekflash', label: 'DeepSeek V4.1 Flash', re: /deepseek.*flash/i, official: [0.1408, 0.5634] },
];

/* ────────────────────────── helpers ────────────────────────── */
const per1M = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null; // -1 = 不计价的纯路由产品
  return Number((n * 1e6).toFixed(6));
};
const slugify = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/(^-|-$)/g, '');

/** 同模型归一：去掉厂商前缀、日期尾巴、:free 后缀、变体标记 */
function familyKey(vendorId, id, name) {
  let base = id.replace(/^[^/]+\//, '').replace(/:free$/, '');
  base = base.replace(/-(?:latest|\d{4}-\d{2}-\d{2}|\d{6}|\d{4})$/, '');
  base = base.replace(/[-_ ]?(preview|exp|experimental|beta|alpha|thinking|reasoning|high|low|mini-beta)$/, '');
  base = base.replace(/\./g, '-');
  if (!base) base = slugify(name || id);
  return `${vendorId}::${base}`;
}

function band(input, free) {
  if (free) return 'free';
  if (input == null) return 'unknown';
  if (input < 0.25) return 'budget';
  if (input < 1.5) return 'standard';
  return 'premium';
}

/** 峰谷价：OpenRouter 用 overrides 表达分时价，取最小/最大 prompt 价做提示 */
function peakNote(pricing) {
  const ov = pricing?.overrides;
  if (!Array.isArray(ov) || !ov.length) return null;
  const vals = ov.map((o) => per1M(o.prompt)).filter((n) => n != null);
  const base = per1M(pricing.prompt);
  const all = [base, ...vals].filter((n) => n != null);
  const lo = Math.min(...all), hi = Math.max(...all);
  if (!(hi > lo)) return null;
  const weekend = ov.every((o) => Array.isArray(o.utc_days) && o.utc_days.length && o.created_at == null);
  return {
    label: weekend ? '分时/分日价' : '分时价',
    min: lo,
    max: hi,
    ratio: Number((hi / lo).toFixed(2)),
    note: `同一模型在不同时段/日期标价 $${lo}–$${hi} /1M input`,
  };
}

/* ────────────────────────── OpenRouter 归一 ────────────────────────── */
function normalizeOpenRouter(payload) {
  const rows = [];
  const seen = new Set();
  let dropped = 0;
  let unpriced = 0;
  for (const m of payload.data || []) {
    if (!m?.id || seen.has(m.id)) { dropped++; continue; }
    const p = m.pricing || {};
    const pin = Number(p.prompt);
    if (!Number.isFinite(pin) || pin < 0) { unpriced++; continue; } // 路由/竞价产品没有挂牌价
    const free = pin === 0 && Number(p.completion) === 0;
    const rawPrefix = m.id.split('/')[0] || 'unknown';
    const vendorId = rawPrefix.replace(/^~/, '');
    const alias = rawPrefix.startsWith('~');
    const row = {
      id: m.id,
      name: (m.name || m.id).replace(/\s*\(free\)$/i, ''),
      vendor: VENDOR[vendorId] || vendorId.replace(/(^|-)([a-z])/g, (_, a, b) => (a ? ' ' : '') + b.toUpperCase()),
      vendorId,
      alias: alias || undefined,
      channel: 'OpenRouter',
      channelKind: 'aggregator',
      ctx: m.context_length || m.top_provider?.context_length || null,
      input: free ? 0 : per1M(p.prompt),
      output: free ? 0 : per1M(p.completion),
      cache_read: per1M(p.input_cache_read),
      cache_write: per1M(p.input_cache_write),
      free,
      band: band(per1M(p.prompt), free),
      family: familyKey(vendorId, m.id, m.name),
      modality: m.architecture?.modality || null,
      created: m.created || null,
      expires: m.expiration_date || null,
      peak: peakNote(p),
      url: `https://openrouter.ai/${m.id}`,
      src: OPENROUTER,
      srcType: 'api',
      conf: 'high',
      cm: p.input_cache_read ? `聚合层标价，命中按 $${per1M(p.input_cache_read)}/1M 计` : '该渠道未公布缓存价',
      note: m.description ? String(m.description).slice(0, 220) : '',
      seen: new Date().toISOString().slice(0, 10),
    };
    seen.add(m.id);
    rows.push(row);
  }
  return { rows, dropped, unpriced };
}

/* ────────────────────────── 4. 去重 ────────────────────────── */
/**
 * 规则（站点「方法」页同步展示）：
 *  R1 聚合层以 OpenRouter model id 为唯一键，重复 id 丢弃；
 *  R2 官方直连层以 vendor+model 为唯一键，重复保留置信度高者；
 *  R3 两层不合并：channel 是指纹的一部分，只通过 family 关联（不覆盖任何一方价格）；
 *  R4 白嫖渠道以 product 为唯一键，多入口合并进 entries，冲突额度保留官方来源；
 *  R5 情报以 url 为唯一键。
 */
function dedupeModels(rows) {
  const byKey = new Map();
  let dropped = 0;
  for (const r of rows) {
    const key = r.channelKind === 'aggregator' ? `or::${r.id}` : `off::${r.vendorId}::${r.id}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, r); continue; }
    dropped++;
    const rank = { high: 3, med: 2, low: 1 };
    if ((rank[r.conf] || 0) > (rank[prev.conf] || 0)) byKey.set(key, r);
  }
  return { rows: [...byKey.values()], dropped };
}

function dedupeOffers(list) {
  const map = new Map();
  let merged = 0;
  for (const o of list) {
    const key = slugify(o.product);
    const prev = map.get(key);
    if (!prev) { map.set(key, { ...o, entries: [...(o.entries || [])] }); continue; }
    merged++;
    const entries = [...new Set([...(prev.entries || []), ...(o.entries || [])])];
    const sources = [...new Set([...(prev.sources || [prev.source]), ...(o.sources || [o.source])].filter(Boolean))];
    const better = (o.conf || '') === 'high' && (prev.conf || '') !== 'high';
    map.set(key, { ...(better ? o : prev), entries, sources });
  }
  return { rows: [...map.values()], merged };
}


/* ────────────────────────── 中转站探测 ────────────────────────── */
function relayPrice(row) {
  const n = (x) => (x == null || x === '' ? null : Number(x));
  const perCall = n(row.model_price ?? row.modelPrice);
  if (perCall && perCall > 0) return { kind: 'per_call', usd: Number(perCall.toFixed(4)) };
  const ratio = n(row.model_ratio ?? row.modelRatio ?? row.ratio);
  const comp = n(row.completion_ratio ?? row.completionRatio) || 1;
  if (ratio == null || !Number.isFinite(ratio)) return null;
  return { kind: 'per_1m', input: Number((ratio * 2).toFixed(4)), output: Number((ratio * comp * 2).toFixed(4)) };
}

function parseJsonLoose(text) {
  try { return JSON.parse(text); } catch {}
  try { return JSON.parse(text.split('\n')[0]); } catch {}
  const i = text.indexOf('{');
  if (i < 0) return null;
  try { return JSON.parse(text.slice(i)); } catch { return null; }
}

async function probeRelay(entry) {
  const url = `https://${entry.domain}/api/pricing`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 9000);
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'FreeAI-Radar/2.0', Accept: 'application/json' } });
    if (!res.ok) return { ...entry, status: `http_${res.status}`, url };
    const text = await res.text();
    const j = parseJsonLoose(text);
    const rows = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
    if (!rows.length) return { ...entry, status: 'no_pricing', url };
    const models = new Set();
    for (const r of rows) { const n = r.model_name || r.modelName || r.id; if (n) models.add(n); }
    const prices = {};
    for (const f of FLAGSHIP) {
      const hit = rows.find((r) => f.re.test(String(r.model_name || r.modelName || r.id || '')));
      if (!hit) continue;
      const p = relayPrice(hit);
      if (!p) continue;
      const anomaly = p.kind === 'per_1m' && (p.input > f.official[0] * 3 + 1 || p.output > f.official[1] * 3 + 1);
      prices[f.key] = { ...p, model: hit.model_name || hit.modelName || hit.id, anomaly: !!anomaly };
    }
    const samples = [];
    for (const r of rows) {
      const nm = r.model_name || r.modelName || r.id;
      if (!nm) continue;
      const pr = relayPrice(r);
      if (!pr || pr.kind !== 'per_1m') continue;
      if (pr.input > 60 || pr.output > 200) continue;
      samples.push({ n: String(nm).slice(0, 48), i: pr.input, o: pr.output });
      if (samples.length >= 40) break;
    }
    return { ...entry, status: 'ok', url, models: models.size, prices, samples, checked_at: new Date().toISOString().slice(0, 10) };
  } catch (e) {
    return { ...entry, status: e.name === 'AbortError' ? 'timeout' : 'unreachable', url };
  } finally { clearTimeout(t); }
}

async function probeAll(entries) {
  const out = new Map();
  const queue = [...entries];
  const workers = Array.from({ length: 5 }, async () => {
    while (queue.length) {
      const item = queue.shift();
      out.set(item.domain, await probeRelay(item));
    }
  });
  await Promise.all(workers);
  return out;
}


/* ────────────────────────── 6. 汇率 ────────────────────────── */
async function fetchFx(prev) {
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { headers: { 'User-Agent': 'IndexAI/1.0' } });
    const j = await res.json();
    const rate = j?.rates?.CNY;
    if (!rate) throw new Error('no CNY');
    return { USDCNY: Number(rate.toFixed(4)), as_of: (j.time_last_update_utc || '').slice(0, 16), source: 'open.er-api.com', fetched_at: new Date().toISOString() };
  } catch {
    return prev ? { ...prev, stale: true } : { USDCNY: 7.1, as_of: 'fallback', source: 'fallback', fetched_at: new Date().toISOString() };
  }
}

/* ────────────────────────── 7. AI 活动 ────────────────────────── */
const AIOS_FILE = process.env.AIOS_OPPORTUNITIES || '/Users/raki/Desktop/AIOS/Users/raki/Desktop/AIOS/.artifacts/production-receipts/local-current/api-opportunities.json';

function parseDevpostDates(s) {
  const m = String(s || '').match(/^([A-Z][a-z]{2}) (\d{1,2}) - ([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
  if (!m) return { start: null, end: null };
  const months = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const [, m1, d1, m2, d2, y] = m;
  let y1 = Number(y);
  if (months[m1] > months[m2]) y1 -= 1;
  return {
    start: new Date(Date.UTC(y1, months[m1], Number(d1))).toISOString().slice(0, 10),
    end: new Date(Date.UTC(Number(y), months[m2], Number(d2))).toISOString().slice(0, 10),
  };
}

async function fetchDevpost() {
  const all = [];
  for (const page of [1, 2, 3, 4, 5]) {
    try {
      const res = await fetch(`https://devpost.com/api/hackathons?status[]=open&limit=24&page=${page}`, { headers: { 'User-Agent': 'IndexAI/1.0' } });
      if (!res.ok) break;
      const j = await res.json();
      const list = j.hackathons || [];
      if (!list.length) break;
      all.push(...list);
    } catch { break; }
  }
  const seen = new Set();
  return all
    .filter((h) => { if (seen.has(h.id)) return false; seen.add(h.id); return true; })
    .map((h) => {
      const d = parseDevpostDates(h.submission_period_dates);
      return {
        id: `devpost-${h.id}`, title: h.title, url: h.url, dates: h.submission_period_dates,
        start: d.start, end: d.end, location: h.displayed_location?.location || '线上',
        org: h.organization_name || '',
        prize: h.prize_amount ? String(h.prize_amount).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : null,
        regs: h.registrations_count || 0,
        themes: (h.themes || []).map((t) => t.name), source: 'Devpost', status: 'open',
      };
    });
}

/* Luma 公开发现流：按 AI 关键词过滤，补 Devpost 覆盖不到的 meetup / 社区场 */
async function fetchLuma() {
  try {
    const res = await fetch('https://api.lu.ma/discover/get-paginated-events?limit=50&query=AI', {
      headers: { 'User-Agent': 'IndexAI/1.0', Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const j = await res.json();
    const today = new Date().toISOString().slice(0, 10);
    const re = /(\bAI\b|LLM|GPT|Claude|Gemini|agent|模型|人工智能|machine learning|大模型|智能体)/i;
    const out = [];
    const seen = new Set();
    for (const entry of j.entries || []) {
      const ev = entry.event || entry;
      const name = ev.name || '';
      const desc = String(ev.description_mirror || ev.description || '');
      if (!re.test(`${name} ${desc}`)) continue;
      if (!ev.url || seen.has(ev.api_id)) continue;
      seen.add(ev.api_id);
      const start = String(ev.start_at || '').slice(0, 10);
      out.push({
        id: `luma-${ev.api_id}`, title: name, url: `https://lu.ma/${ev.url}`,
        dates: start, start, end: String(ev.end_at || '').slice(0, 10),
        location: ev.location_type === 'online' ? '线上' : (ev.geo_address_info?.city || '线下'),
        org: ev.calendar?.name || 'Luma', prize: null, regs: ev.guest_count || 0,
        themes: [], source: 'Luma', status: start >= today ? 'upcoming' : 'open',
      });
    }
    return out;
  } catch { return []; }
}


/* 活动类型与地区：从标题 / 主题 / 场地推断，前端用来做细分筛选 */
function eventKind(e) {
  const b = `${e.title || ''} ${(e.themes || []).join(' ')} ${e.dates || ''}`;
  if (/hackathon|hack\b|黑客松|challenge|jam|competition|竞赛|大赛|hack ?day/i.test(b)) return 'hackathon';
  if (/summit|conference|大会|峰会|forum|expo|展会|convention|symposium/i.test(b)) return 'conference';
  if (/film festival|award|prize|评选|awards/i.test(b)) return 'award';
  if (/workshop|工作坊|training|tutorial|bootcamp|课程|讲座|seminar/i.test(b)) return 'workshop';
  if (/meetup|聚会|community|salon|drinks|networking|night|party|talk|session|panel|forum/i.test(b)) return 'meetup';
  // Luma 以社区活动为主，没命中关键词的按 meetup 归
  if (e.source === 'Luma') return 'meetup';
  return 'other';
}

function eventRegion(e) {
  const loc = String(e.location || '');
  if (/线上|online|remote|virtual|anywhere/i.test(loc)) return 'online';
  if (/中国|上海|北京|深圳|杭州|广州|成都|China|Shanghai|Beijing|Shenzhen|Hangzhou/i.test(loc)) return 'cn';
  if (/日本|东京|Tokyo|Shibuya|Chiyoda|Osaka|Japan/i.test(loc)) return 'jp';
  if (/美国|纽约|旧金山|西雅图|US\b|United States|New York|San Francisco|Seattle|Austin|Boston|California/i.test(loc)) return 'us';
  if (/英国|伦敦|欧洲|Berlin|London|Paris|Amsterdam|Europe|Germany/i.test(loc)) return 'eu';
  if (/新加坡|Singapore|印度|India|Bangalore|Dubai|UAE/i.test(loc)) return 'asia';
  return 'other';
}

/* Aibijia 公开数据：第三方挂单（带真实商品链接）+ App Store 各国订阅价 */
const AIBIJIA_PRODUCTS = 'https://data.aibijia.org/products.json';
const AIBIJIA_APPLE = 'https://data.aibijia.org/apple_subscriptions.json';

async function fetchAibijia() {
  const get = async (u) => {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'IndexAI/1.0' } });
      return r.ok ? await r.json() : null;
    } catch { return null; }
  };
  const [prod, apple] = await Promise.all([get(AIBIJIA_PRODUCTS), get(AIBIJIA_APPLE)]);
  return { prod, apple };
}

function buildSubsThird(prod) {
  if (!prod) return [];
  const rows = [];
  for (const p of prod.products || []) {
    for (const o of p.offers || []) {
      if (!o.url || o.price == null) continue;
      rows.push({
        product: p.name, productSlug: p.slug,
        title: o.source_title || '', platform: o.platform_name || '', route: o.source_store_name || '',
        price: Number(o.price), currency: o.currency || 'CNY',
        status: o.status || 'unknown', url: o.url, tags: o.display_tags || [],
      });
    }
  }
  return rows.sort(
    (a, b) => (a.status === 'in_stock' ? 0 : 1) - (b.status === 'in_stock' ? 0 : 1) || a.price - b.price,
  );
}

/* AI 圈新闻：公开新闻流，按主题分类 + 打分精选 */
const AIBIJIA_NEWS = 'https://data.aibijia.org/news-frontline.yaml';

const NEWS_TOPICS = [
  { id: 'price', label: '价格与额度', re: /(价格|定价|降价|涨价|免费额度|白嫖|计费|折扣|半价|定价页)/ },
  { id: 'funding', label: '融资并购', re: /(融资|估值|亿美元|并购|收购|IPO|募资)/ },
  { id: 'policy', label: '政策监管', re: /(国务院|政策|监管|法案|部委|合规|立法|禁令|反垄断)/ },
  { id: 'safety', label: '安全对齐', re: /(对齐|越狱|漏洞|红队|安全研究员|攻击|恶意|投毒|事故)/ },
  { id: 'model', label: '模型发布', re: /(开源|权重|总参数|激活|新模型|模型发布|多模态|推理模型)/ },
  { id: 'product', label: '产品更新', re: /(上线|功能|更新|插件|SDK|集成|Agent|应用)/ },
  { id: 'research', label: '研究评测', re: /(论文|研究|基准|benchmark|评测|榜单|实验)/ },
];

function parseNewsYaml(text) {
  const items = [];
  const chunks = String(text || '').split(/\n\s*-\s+date:\s*/).slice(1);
  for (const ch of chunks) {
    const date = (ch.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
    const time = (ch.match(/\n\s*time:\s*"?([\d:]+)"?/) || [])[1] || null;
    const title = (ch.match(/\n\s*title:\s*"((?:[^"\\]|\\.)*)"/) || ch.match(/\n\s*title:\s*(.+)/) || [])[1];
    let summary = (ch.match(/\n\s*summary:\s*"((?:[^"\\]|\\.)*)"/) || ch.match(/\n\s*summary:\s*(.+)/) || [])[1] || '';
    const url = (ch.match(/\n\s*url:\s*"?([^"\n\s]+)"?/) || [])[1] || null;
    if (!title || !url) continue;
    summary = summary
      .replace(/\\"/g, '"')
      .replace(/\s*🔗.*$/s, '')
      .replace(/\s*via\s+AIHOT.*$/is, '')
      .trim();
    items.push({ date, time, title: String(title).replace(/\\"/g, '"').trim(), summary, url });
  }
  return items;
}

function scoreNews(n) {
  const blob = `${n.title} ${n.summary}`;
  let score = 0;
  if (/(价格|定价|降价|涨价|免费|额度|计费|折扣|半价|白嫖)/.test(blob)) score += 5;
  if (/(开源|权重|模型发布|新模型|发布.*模型|preview)/i.test(blob)) score += 4;
  if (/(融资|估值|亿美元|收购|IPO)/.test(blob)) score += 3;
  if (/(政策|监管|法案|国务院|合规)/.test(blob)) score += 3;
  if (/(安全|对齐|越狱|漏洞|事故)/.test(blob)) score += 2;
  if (/(裁员|解雇|诉讼|八卦|恋情|SpaceX|特斯拉|马斯克)/.test(blob)) score -= 6;
  if (n.summary.length > 60) score += 1;
  return score;
}

function classifyNews(n) {
  const blob = `${n.title} ${n.summary}`;
  const hit = NEWS_TOPICS.find((t) => t.re.test(blob));
  return hit ? hit.id : 'other';
}

async function fetchNews() {
  try {
    const res = await fetch(AIBIJIA_NEWS, { headers: { 'User-Agent': 'IndexAI/1.0' } });
    if (!res.ok) return [];
    const raw = await res.text();
    const rows = parseNewsYaml(raw).map((n) => {
      const topic = classifyNews(n);
      const score = scoreNews(n);
      return { ...n, topic, topicLabel: (NEWS_TOPICS.find((t) => t.id === topic) || {}).label || '其他', score };
    });
    // 每天保留当日 top 8，再整体按时间倒序
    const byDate = new Map();
    for (const r of rows) {
      const k = r.date || '';
      if (!byDate.has(k)) byDate.set(k, []);
      byDate.get(k).push(r);
    }
    const picked = [];
    for (const [d, list] of byDate) {
      picked.push(...list.sort((a, b) => b.score - a.score).slice(0, 8));
    }
    // 日期倒序优先，同一天内按精选分倒序
    return picked.sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.score - a.score || `${b.time || ''}`.localeCompare(`${a.time || ''}`));
  } catch { return []; }
}

function buildSubsRegions(apple) {
  if (!apple) return [];
  const out = [];
  for (const app of apple.apps || []) {
    for (const plan of app.plans || []) {
      const rs = (plan.regions || []).filter((r) => Number(r.cny_price) > 0).sort((a, b) => a.cny_price - b.cny_price);
      if (!rs.length) continue;
      const keep = rs.slice(0, 10);
      const us = rs.find((r) => r.country_code === 'US');
      if (us && !keep.includes(us)) keep.push(us);
      out.push({
        app: app.display_name, appSlug: app.slug,
        plan: plan.label, planSlug: plan.slug, duration: plan.duration_label || '',
        total: rs.length,
        cheapest: Number(Number(rs[0].cny_price).toFixed(2)),
        priciest: Number(Number(rs[rs.length - 1].cny_price).toFixed(2)),
        rows: keep.map((r) => ({
          c: r.country_code, n: r.country_label, cur: r.currency_code,
          p: r.price_text, cny: Number(Number(r.cny_price).toFixed(2)), url: r.app_store_url,
        })),
      });
    }
  }
  return out;
}

async function fetchAios() {
  try {
    const raw = JSON.parse(await readFile(AIOS_FILE, 'utf8'));
    const rows = Array.isArray(raw) ? raw : raw.data || [];
    const today = new Date().toISOString().slice(0, 10);
    return rows.map((o) => ({
      id: o.id, title: o.title, url: o.canonicalUrl || o.sourceUrl, dates: (o.startsAt || '').slice(0, 10),
      start: (o.startsAt || '').slice(0, 10), location: o.mode === 'online' ? '线上' : (o.city || '线下'),
      org: o.organizerName || '', prize: o.priceLabel || null, regs: 0,
      themes: o.topics || [], source: 'AIOS', status: (o.startsAt || '').slice(0, 10) >= today ? 'upcoming' : 'past',
      worth: o.worthScore ?? null,
    })).sort((a, b) => String(a.start).localeCompare(String(b.start)));
  } catch { return []; }
}

/* ────────────────────────── 8. 智力评测（Vals Index） ────────────────────────── */
async function fetchBench(prev) {
  const url = 'https://www.vals.ai/benchmarks/vals_index';
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'IndexAI/1.0' } });
    const html = await res.text();
    const text = html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
    const asOf = (text.match(/Updated (\d{2}\/\d{2}\/\d{4})/) || text.match(/As of ([A-Z][a-z]+ \d+, \d{4})/) || [])[1] || null;
    const re = /(\d{1,2})\s+([A-Z][A-Za-z0-9.+\- ]{2,36}?)\s+(\d{2}\.\d{2})%/g;
    const rows = [];
    const seen = new Set();
    let m;
    while ((m = re.exec(text)) && rows.length < 16) {
      const name = m[2].trim();
      if (seen.has(name) || /^(Index|Benchmarks?|Updated)/i.test(name)) continue;
      seen.add(name);
      rows.push({ rank: Number(m[1]), model: name, score: Number(m[3]) });
    }
    const old = new Map((prev?.bench || []).map((b) => [b.model, b.score]));
    for (const r of rows) {
      const o = old.get(r.model);
      r.delta = o == null ? null : Number((r.score - o).toFixed(2));
    }
    return { as_of: asOf, source: url, rows, fetched_at: new Date().toISOString() };
  } catch {
    return prev ? { ...prev, stale: true } : { as_of: null, source: url, rows: [], fetched_at: null };
  }
}


/* ────────────────────────── 9. 工具箱（人工精选 + GitHub 自动校准） ────────────────────────── */
// 只收真正在用的：skill、MCP、CLI。星数与更新时间每天从 GitHub 拉一遍，
// 归档/停更的会被标出来，不静默留在榜上。
const CURATED_RESOURCES = [
  // ── 设计 ──
  { id: 'baoyu-design', repo: 'JimLiu/baoyu-design', use: 'design', title: 'baoyu-design',
    why: '把 Claude 的设计方法论和工艺标准搬进本地 Agent：先确认方向再动手，产出单文件 HTML，能在 Cursor / Claude Code 里跑。' },
  { id: 'huashu-design', repo: 'alchaincyf/huashu-design', use: 'design', title: '花叔 Design 3.0',
    why: '中文语境下最完整的 agent 设计 skill：一句话拿回可交付的网页 / App 原型 / 可编辑稿。' },
  { id: 'anatomy', repo: 'wheresryan22/anatomy', use: 'design', title: 'Anatomy',
    why: '机器与复杂系统的等距交互插图，直接生成带 WebGL 效果的 SVG。技术讲解配图终于不用手画。' },
  { id: 'gzh-design-skill', repo: 'isjiamu/gzh-design-skill', use: 'design', title: '公众号排版',
    why: 'Markdown 一键变成能直接粘进公众号编辑器的 HTML：6 套主题 + 主题生成器 + 双关卡校验，不用再手动调间距。' },
  { id: 'ip-as-logo', repo: 's1dashu/ip-as-logo-skill', use: 'design', title: 'IP as Logo',
    why: '生成极简、圆润、能直接上公司的吉祥物 IP。做品牌第一版不需要插画师。' },
  { id: 'scroll-craft', repo: 'nateherkai/scroll-craft', use: 'design', title: 'Scroll Craft',
    why: '做高端滚动叙事网站的完整工作流：引擎 + 参考 + 验证工具，不是给你一段 CSS 就完事。' },
  { id: 'effective-html', repo: 'plannotator/effective-html', use: 'design', title: 'Effective HTML',
    why: '线框、原型、图表、图解——专注「有用的 HTML 制品」，输出自包含、能直接给人看。' },
  { id: 'taste-skill', repo: 'Leonxlnx/taste-skill', use: 'design', title: 'Taste',
    why: '给编码 Agent 装审美：艺术指导、排版、留白。专治「功能全对但就是难看」。' },

  // ── 写作 ──
  { id: 'sepia', repo: 'Nanako0129/sepia', use: 'writing', title: 'Sepia',
    why: '去 AI 味不去词汇，而是修叙事架构——虚构先补故事结构，专业文本按场景换规则。有行为评测跑在 CI 上。' },
  { id: 'simple-english', repo: 'AminBlg/SimpleEnglish', use: 'writing', title: 'SimpleEnglish',
    why: '用 ASD-STE100 航空维修手册那套受控语言写文档，1983 年用到现在，就是怕人误读。技术文档的降噪器。' },
  { id: 'answer-me-with-html', repo: 'QingYunA/answer-me-with-html', use: 'writing', title: 'Answer me with HTML',
    why: '复杂问题别用一屏终端文字回答，生成一页能读的 HTML：可离线、单文件、带讲解视频。' },

  // ── 内容 ──
  { id: 'dashi-ppt', repo: 'chuspeeism/dashi-ppt-skill', use: 'content', title: 'Dashi PPT',
    why: '生成浏览器里可直接编辑的演示稿，导出 HTML / PDF / PPTX。改字不用回到代码。' },
  { id: 'shuohao-skills', repo: 'eternityspring/shuohao-skills', use: 'content', title: '硕昊短剧',
    why: 'AI 短剧全链路：拆角色、排大纲、出场景道具设定、写剧本、切分镜。中文内容生产里少见的完整流水线。' },
  { id: 'huashu-art-motion', repo: 'alchaincyf/huashu-art-motion', use: 'content', title: '花叔 Art Motion',
    why: '35 种艺术风格 + 9 种解说语法的动画 skill，用代码让画面动起来，不是套模板。' },

  // ── 工程 ──
  { id: 'security-audit', repo: 'cloudflare/security-audit-skill', use: 'engineering', title: 'Security Audit',
    why: 'Cloudflare 出的多阶段安全审计 skill：每个结论都要独立验证、可机器读取，不是让模型自由发挥编漏洞。' },

  // ── 调研 ──
  { id: 'last30days', repo: 'mvanhorn/last30days-skill', use: 'research', title: 'last30days',
    why: '跨 Reddit / X / YouTube 扫近 30 天讨论。做选题和竞品分析时，比搜索引擎给的是一手体感。' },
  { id: 'geo-sleuth', repo: 'Oldcircle/geo-sleuth', use: 'research', title: 'Geo Sleuth',
    why: '看照片猜地点，而且把推理过程摊开：OSM 几何、等高线天际线、卫星图、街景逐条对。OSINT 里最硬的一类活。' },
  { id: 'social-media-research', repo: 'ScrapeCreators/social-media-research-skills', use: 'research', title: '社媒研究',
    why: 'TikTok / IG / YouTube / Reddit / X / LinkedIn 的异常贴挖掘、评论采矿、竞品拆解、广告库比对。' },

  // ── 工具 ──
  { id: 'magpie', repo: 'yetone/magpie', use: 'tool', title: 'Magpie',
    why: '一个入口调所有模型：Codex 走 DeepSeek、Claude Code 走别的供应商，配一次到处能用。省钱不用改工作流。' },
  { id: 'headroom', repo: 'headroomlabs-ai/headroom', use: 'tool', title: 'Headroom',
    why: '工具输出、日志、RAG 片段先压一遍再进上下文。长任务省 token 最直接的一招。' },
  { id: 'genoffice', repo: 'genspark-ai/genoffice', use: 'tool', title: 'GenOffice',
    why: '开源 AI Office：Docs / Sheets / Slides / PDF 全带内置 agent，还有 CLI 和 skill 接口。' },
];

const USE_LABEL = { design: '设计', writing: '写作', content: '内容', engineering: '工程', research: '调研', tool: '工具' };
const KIND_LABEL = { skill: 'Skill', mcp: 'MCP', tool: '工具', list: '清单' };

async function fetchResources() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  const headers = { 'User-Agent': 'IndexAI/1.0', Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const out = [];
  for (const item of CURATED_RESOURCES) {
    const row = { ...item, useLabel: USE_LABEL[item.use] || item.use };
    try {
      const res = await fetch(`https://api.github.com/repos/${item.repo}`, { headers });
      if (!res.ok) {
        out.push({ ...row, status: `http_${res.status}` });
      } else {
        const j = await res.json();
        out.push({
          ...row,
          desc: j.description || '',
          stars: j.stargazers_count ?? null,
          forks: j.forks_count ?? null,
          updated: (j.pushed_at || '').slice(0, 10),
          license: j.license?.spdx_id || null,
          archived: !!j.archived,
          lang: j.language || null,
          topics: Array.isArray(j.topics) ? j.topics.slice(0, 6) : [],
          url: j.html_url,
          status: 'ok',
        });
      }
    } catch {
      out.push({ ...row, status: 'error' });
    }
    await new Promise((r) => setTimeout(r, 90));
  }
  // 按人工排序（谁更值得先看），不按星数
  return out;
}

/* ────────────────────────── 主流程 ────────────────────────── */
async function main() {
  let prev = null;
  try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* 首次运行 */ }

  const fx = await fetchFx(prev?.meta?.fx);
  const [devpost, aios, luma, aibijia, news, resources] = await Promise.all([fetchDevpost(), fetchAios(), fetchLuma(), fetchAibijia(), fetchNews(), fetchResources()]);
  const bench = await fetchBench(prev?.bench);

  const res = await fetch(OPENROUTER, { headers: { 'User-Agent': 'IndexAI/1.0' } });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
  const payload = await res.json();

  const or = normalizeOpenRouter(payload);

  const curated = CURATED_OFFICIAL.map((r) => ({
    id: r.model,
    name: r.name || r.model,
    vendor: r.vendor,
    vendorId: slugify(r.vendor),
    channel: r.channel || '官方直连',
    channelKind: 'direct',
    ctx: r.ctx ? r.ctx * 1000 : null,
    input: r.in ?? null,
    output: r.out ?? null,
    cache_read: r.cr ?? null,
    cache_write: r.cw ?? null,
    free: (r.in === 0 && r.out === 0) || false,
    band: band(r.in, r.in === 0),
    family: familyKey(slugify(r.vendor), `${r.model}`, r.model),
    modality: 'text->text',
    peak: null,
    cny: r.cny || null,
    url: r.src,
    src: r.src,
    srcType: 'official',
    conf: r.conf || 'high',
    cm: r.cm || '官方页未说明',
    note: r.note || '',
    seen: new Date().toISOString().slice(0, 10),
  }));

  const createdByFamily = new Map();
  for (const m of or.rows) {
    if (!m.created) continue;
    createdByFamily.set(m.family, Math.max(createdByFamily.get(m.family) || 0, m.created));
  }
  for (const m of curated) {
    if (!m.created && createdByFamily.has(m.family)) m.created = createdByFamily.get(m.family);
  }

  const modelsDedup = dedupeModels([...or.rows, ...curated]);
  const offersDedup = dedupeOffers(CURATED_OFFERS.map((o) => ({
    ...o,
    conf: o.conf || o.confidence || 'med',
    srcType: o.srcType || o.source_type || 'official',
    sources: o.sources && o.sources.length ? o.sources : [o.source],
  })));
  const signals = [...new Map(SIGNALS.map((s) => [s.url, s])).values()]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const models = modelsDedup.rows.sort((a, b) => (a.input ?? 9e9) - (b.input ?? 9e9));

  const probed = await probeAll(RELAYS);
  const prevRelays = new Map((prev?.relays || []).map((r) => [r.domain, r]));
  const relays = [...probed.values()].map((r) => {
    const old = prevRelays.get(r.domain);
    if (r.status === 'ok') return r;
    return { ...r, stale: true, prices: old?.prices || {}, models: old?.models || 0, checked_at: old?.checked_at || null };
  }).sort((a, b) => (b.models || 0) - (a.models || 0));

  const subs = SUBSCRIPTIONS.map((x) => ({ ...x, cny: Number((x.price * fx.USDCNY).toFixed(1)) }));
  const aibijiaThird = buildSubsThird(aibijia.prod);
  const subsThird = aibijiaThird.length
    ? aibijiaThird
    : SUBS_THIRD.map((x) => ({ ...x, usd: Number((x.price_cny / fx.USDCNY).toFixed(2)), url: 'https://aibijia.org/', status: 'unknown' }));
  const subsRegions = buildSubsRegions(aibijia.apple);

  // 来源登记表：所有 URL 去重，标注类型与命中次数
  const srcMap = new Map();
  const addSrc = (url, type, label) => {
    if (!url) return;
    const e = srcMap.get(url) || { url, type, label, refs: 0 };
    e.refs++;
    srcMap.set(url, e);
  };
  for (const m of models) addSrc(m.src, m.srcType, m.channel);
  for (const o of offersDedup.rows) {
    for (const u of (o.sources && o.sources.length ? o.sources : [o.source])) {
      addSrc(u, o.srcType || 'official', o.product);
    }
  }
  for (const s of signals) addSrc(s.url, s.source_type || 'x', s.handle || 'signal');
  for (const s of subs) addSrc(s.url, 'official', s.product);
  if (subsThird.length) addSrc('https://aibijia.org/', 'marketplace', '第三方挂单价');
  for (const r of subsRegions.slice(0, 4)) addSrc('https://data.aibijia.org/apple_subscriptions.json', 'marketplace', r.plan);
  if (luma.length) addSrc('https://api.lu.ma/discover/get-paginated-events', 'events', 'Luma');
  if (news.length) addSrc('https://data.aibijia.org/news-frontline.yaml', 'news', 'AI 要闻');
  if (resources.length) addSrc('https://api.github.com/repos', 'toolkit', 'GitHub 精选');
  for (const r of relays) addSrc(`https://${r.domain}/api/pricing`, 'relay', r.name);
  addSrc('https://devpost.com/api/hackathons', 'events', 'Devpost');
  addSrc('https://www.vals.ai/benchmarks/vals_index', 'bench', 'Vals Index');

  const cacheDiscount = models
    .filter((m) => m.cache_read != null && m.input)
    .map((m) => ({ id: m.id, off: 1 - m.cache_read / m.input }))
    .sort((a, b) => b.off - a.off);

  const vendors = [...new Set(models.map((m) => m.vendor))].sort();

  const data = {
    meta: {
      generated_at: new Date().toISOString(),
      date: new Date().toISOString().slice(0, 10),
      brand: 'IndexAI',
      fx,
      counts: {
        models: models.length,
        aggregator: models.filter((m) => m.channelKind === 'aggregator').length,
        direct: models.filter((m) => m.channelKind === 'direct').length,
        freeModels: models.filter((m) => m.free).length,
        withCache: models.filter((m) => m.cache_read != null).length,
        vendors: vendors.length,
        offers: offersDedup.rows.length,
        signals: signals.length,
        subs: subs.length,
        subsThird: subsThird.length,
        subsRegions: subsRegions.length,
        subsRegionsRaw: subsRegions.reduce((n, r) => n + r.total, 0),
        news: news.length,
        resources: resources.filter((r) => r.status === 'ok').length,
        relays: relays.length,
        relaysLive: relays.filter((r) => r.status === 'ok').length,
        relayQuotes: relays.reduce((n, r) => n + Object.keys(r.prices || {}).length, 0),
        relaySamples: relays.reduce((n, r) => n + (r.samples || []).length, 0),
        events: devpost.length + luma.length + aios.length,
        eventsOpen: devpost.length + luma.filter((e) => e.status !== 'past').length,
        bench: bench.rows.length,
        sources: srcMap.size,
      },
      dedupe: { aggregator_dropped: or.dropped, unpriced_dropped: or.unpriced, models_dropped: modelsDedup.dropped, offers_merged: offersDedup.merged },
      bestCacheDiscount: cacheDiscount[0] ? { ...cacheDiscount[0], pct: Math.round(cacheDiscount[0].off * 100) } : null,
      vendors,
    },
    models,
    offers: offersDedup.rows.sort((a, b) => String(a.product).localeCompare(String(b.product))),
    subs,
    subsThird,
    subsRegions,
    news,
    resources,
    relays,
    events: [...devpost, ...luma, ...aios].map((e) => ({ ...e, kind: eventKind(e), region: eventRegion(e) })),
    bench,
    signals,
    sources: [...srcMap.values()].sort((a, b) => b.refs - a.refs),
  };

  await writeFile(OUT, JSON.stringify(data));
  console.log(JSON.stringify(data.meta, null, 2));
}

main().catch((e) => { console.error('[collect] failed:', e.message); process.exit(1); });
