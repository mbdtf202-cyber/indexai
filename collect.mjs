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
import { httpGet, httpJson, httpText, httpTotals } from './lib/http.js';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { assertLayers } from './health.mjs';
import { fetchBenchmarks } from './bench.mjs';
import {
  parseNewsYaml, mergeArchive, archiveStats, buildIndex, decodeNews,
} from './lib/news.mjs';
import { now, nowISO, todayISO, mark, since, sleep } from './lib/clock.js';

const OPENROUTER = 'https://openrouter.ai/api/v1/models';
const FX_CNY = 7.1; // 2026-10-23 记账汇率，仅用于把人民币价折算成 USD 对比
/* ────────────────────────── 运行档位与输出目录 ──────────────────────────
 * INDEXAI_PROFILE=test 缩小迭代集合，让 golden 能在 30 秒内离线跑完；
 * 生产不设该变量，所有取值保持原样。
 * INDEXAI_OUT_DIR 指定输出目录（默认仓库根），golden 用它写到临时目录。 */
const TEST_PROFILE = String(process.env.INDEXAI_PROFILE || '').toLowerCase() === 'test';
const OUT_DIR = process.env.INDEXAI_OUT_DIR ? String(process.env.INDEXAI_OUT_DIR).replace(/\/+$/, '') : null;
const outUrl = (name) =>
  OUT_DIR ? new URL(`file://${OUT_DIR}/${name}`) : new URL(`./${name}`, import.meta.url);

const OUT = outUrl('data.json');
const BENCH_OUT = outUrl('bench.json');

/**
 * 读上一版评测快照（F02）。
 *
 * 为什么不能只用 data.json：那里的 `bench` 只剩目录（catalog / stats / file），
 * `boards` 已经拆进 bench.json。拿它当基线等于 `prev.boards === undefined`，
 * bench.mjs 的「整源失败沿用上次」因此从未生效——任一评测源挂掉，它的榜直接消失。
 *
 * @param {string|URL} [path] 默认读本次输出目录里的 bench.json
 * @returns {object|null} 完整快照；文件不存在或读不懂时返回 null（首次运行的合法情况）
 */
export function readPrevBench(path = BENCH_OUT) {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || !parsed.boards) return null;
    return parsed;
  } catch {
    return null;
  }
}

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


/* ────────────────────────── 4. 订阅（官方价） ──────────────────────────
 * 订阅档位一律从 aibijia 的 apple_subscriptions.json 派生（美国区 App Store 明码），
 * 不再手写常量、也不再留硬编码兜底。
 *
 * 历史教训：这里曾经是 `const SUBSCRIPTIONS = []`，而前端照常渲染「官方档位 0」，
 * README 还写着「订阅 10 档」。死数据 + 看不出来的空，比少一层更糟。
 * 现在：派生不出来 → health 直接红线 → 拒绝发布。
 */

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
  { domain: 'api.oneapi.dev', name: 'OneAPI 演示站', auto: true },
  // 2026-10 移除：api.apifox.com（API 文档工具）、api.dujiaoka.com（发卡面板）、
  // api.linshiyouxiang.net（临时邮箱）。三者都不是中转站，来自清单误收，
  // 曾以「在册站点」出现在页面上，污染在册数。

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

// 用来对比的旗舰模型：key 固定，正则匹配上游命名差异。
// 正则只负责「圈定家族」，变体（-thinking/-high/-low/日期尾巴）由 pickFlagship 剔除。
const FLAGSHIP = [
  { key: 'sonnet55', label: 'Claude Sonnet 5.5', re: /claude[-_ ]?sonnet[-_ ]?5[.\-]?5/i, official: [2, 10] },
  { key: 'opus55', label: 'Claude Opus 5.5', re: /claude[-_ ]?opus[-_ ]?5[.\-]?5/i, official: [4, 20] },
  { key: 'gpt61sol', label: 'GPT-6.1 Sol', re: /gpt[-_ ]?6[.\-]?1[-_ ]?sol/i, official: [2, 10] },
  { key: 'gemini4argon', label: 'Gemini 4 Argon', re: /gemini[-_ ]?4[-_ ]?argon/i, official: [2, 10] },
  // deepseek-flash 与 deepseek-v4-1-flash 是两个不同的模型，
  // 旧正则 /deepseek.*flash/ 会先命中前者（75/150），把正确价（2/8）挤掉。
  { key: 'deepseekflash', label: 'DeepSeek V4.1 Flash', re: /deepseek[-_ ]?v?4[.\-]?1[-_ ]?flash/i, official: [0.1408, 0.5634] },
];

// 有效成本画像：agent 编程的典型 token 构成
// h = 缓存命中比例，s = 输出占全部计费 token 的比例，w = 缓存写入比例
const WORKLOAD = { h: 0.7, s: 0.3, w: 0.0, label: 'agent 编程' };

/**
 * 把一个报价折成「每百万有效 token 的美元成本」。
 * 有效成本 = (1−s)·[(1−h−w)·input + h·cache_read + w·cache_write] + s·output
 * 缺缓存价时按「无折扣」处理（cache_read := input），宁可高估不虚构折扣。
 */
export function effectiveCost(p) {
  if (!p || p.kind !== 'per_1m') return null;
  const { h, s } = WORKLOAD;
  const cacheRead = p.cacheRead != null ? p.cacheRead : p.input;
  const cacheWrite = p.input;
  const inPart = (1 - h - WORKLOAD.w) * p.input + h * cacheRead + WORKLOAD.w * cacheWrite;
  return Number(((1 - s) * inPart + s * p.output).toFixed(4));
}

/* ────────────────────────── helpers ────────────────────────── */
export const per1M = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null; // -1 = 不计价的纯路由产品
  return Number((n * 1e6).toFixed(6));
};
const slugify = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/(^-|-$)/g, '');

/** 同模型归一：去掉厂商前缀、日期尾巴、:free 后缀、变体标记 */
export function familyKey(vendorId, id, name) {
  let base = id.replace(/^[^/]+\//, '').replace(/:free$/, '');
  base = base.replace(/-(?:latest|\d{4}-\d{2}-\d{2}|\d{6}|\d{4})$/, '');
  base = base.replace(/[-_ ]?(preview|exp|experimental|beta|alpha|thinking|reasoning|high|low|mini-beta)$/, '');
  base = base.replace(/\./g, '-');
  if (!base) base = slugify(name || id);
  return `${vendorId}::${base}`;
}

export function band(input, free) {
  if (free) return 'free';
  if (input == null) return 'unknown';
  if (input < 0.25) return 'budget';
  if (input < 1.5) return 'standard';
  return 'premium';
}

/** 峰谷价：OpenRouter 用 overrides 表达分时价，取最小/最大 prompt 价做提示 */
export function peakNote(pricing) {
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
export function normalizeOpenRouter(payload) {
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
      seen: todayISO(),
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
export function dedupeModels(rows) {
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

export function dedupeOffers(list) {
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


/* ────────────────────────── 中转站探测 ──────────────────────────
 * OneAPI / NewAPI 的零售价有两套并存的写法，优先级从高到低：
 *
 * ① billing_expr　表达式计费（NewAPI 新版，实测 183/1308 行使用）
 *      tier("base", p * 2 + c * 10 + cr * 0.1)
 *      p=输入 c=输出 cr=缓存读 cc=缓存写；这是真实挂牌价。
 * ② model_ratio × group_ratio × 2　倍率计费（老版 OneAPI）
 *      到手价 = model_ratio × 分组倍率 × 2
 *      output = 上式 × completion_ratio
 *      缓存读 = 上式 × cache_ratio
 *
 * 踩过的坑（本站最严重的一次）：
 *  - 只采 model_ratio，把它当唯一价格 → 全行业都是同一个常量，页面「所有站一个价」；
 *  - 站点同时给了 billing_expr 和 model_ratio 时优先信 model_ratio → 得到 75/75 这种
 *    与真实价（$2/$10）毫无关系的数，再把它们当「口径?异常」标出来，属于自己造异常；
 *  - 分组倍率跨站差 20–220 倍（Nova 0.0001→2，年华 0.05→11），不采就等于丢弃真实价差。
 */

/** 分组倍率表：OneAPI 顶层 group_ratio 是 {组名: 倍率}，也见过数组形式 */
export function groupRatioTable(j) {
  const raw = j?.group_ratio ?? j?.groupRatio;
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const map = {};
    for (const g of raw) {
      const nm = g?.name ?? g?.group ?? g?.key;
      const v = Number(g?.ratio ?? g?.value);
      if (nm != null && Number.isFinite(v) && v > 0) map[String(nm)] = v;
    }
    return Object.keys(map).length ? map : null;
  }
  if (typeof raw === 'object') {
    const map = {};
    for (const [k, v] of Object.entries(raw)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) map[k] = n;
    }
    return Object.keys(map).length ? map : null;
  }
  return null;
}

/** 该行可用的分组倍率（只看 enable_groups 里列出的） */
export function rowGroups(row, table) {
  const names = Array.isArray(row.enable_groups) ? row.enable_groups.map(String) : [];
  const all = table
    ? names.filter((n) => table[n] != null).map((n) => ({ name: n, ratio: table[n] }))
    : names.map((n) => ({ name: n, ratio: null }));
  const fallback = () => (table && table.default != null ? [{ name: 'default', ratio: table.default }] : [{ name: 'default', ratio: null }]);
  if (!all.length) return fallback();

  /*
   * 代表分组的选择。三种站点命名习惯都要覆盖：
   *  ① 有 default / 自动 / auto   → 直接用（最常见）
   *  ② 组名里写倍率，如「a全模型综合组-1倍率」「纯Azure稳定无审核-0.6倍率」
   *  ③ 只有一堆渠道名          → 取倍率最接近 1 的
   *
   * 绝不能直接取最小值：最便宜的分组往往是「测试」「逆向」「特价」这类
   * 不可靠或功能受限的渠道，拿它做跨站比较等于用别人的地板价充自己的招牌价。
   * 也绝不能按字母序取第一个：GGWK 的 enable_groups 首位是「a全模型综合组」，
   * 但别的站首位可能是「特殊逆向claude」。
   */
  const NAME_RATIO = /[-_]?\s*([\d.]+)\s*(?:倍率|x|×)/i;
  const reliable = (g) => {
    if (g.ratio == null) return false;
    if (/(测试|调试|probation|dummy|演示|free|免费)/i.test(g.name)) return false;
    return true;
  };

  const byDefault = all.filter((g) => /^(default|自动|auto|默认)$/i.test(g.name) && g.ratio != null);
  let rep;
  if (byDefault.length) {
    rep = byDefault[0];
  } else {
    // 组名里的倍率优先于「接近 1」的经验值
    const named = all
      .map((g) => {
        const m = g.name.match(NAME_RATIO);
        const declared = m ? Number(m[1]) : null;
        return { ...g, declared: Number.isFinite(declared) ? declared : null };
      })
      .filter((g) => g.ratio != null);
    const withDeclared = named.filter((g) => g.declared != null);
    const pool = (withDeclared.length ? withDeclared : named).filter(reliable);
    const usable = pool.length ? pool : named;
    usable.sort((a, b) => {
      // 声明倍率离 1 越近越好；没声明的按实际倍率离 1 远近
      const ka = a.declared != null ? Math.abs(Math.log(a.declared)) : Math.abs(Math.log(a.ratio));
      const kb = b.declared != null ? Math.abs(Math.log(b.declared)) : Math.abs(Math.log(b.ratio));
      return ka - kb;
    });
    rep = usable[0] || all[0];
  }

  // 「最低可达价」：排除测试/调试类渠道后的最便宜分组
  const USABLE_SKIP = /(测试|调试|probation|dummy|演示)/i;
  const usableGroups = all.filter((g) => g.ratio != null && g.ratio > 0 && !USABLE_SKIP.test(g.name));
  const lo = usableGroups.length ? usableGroups.reduce((m, g) => (g.ratio < m.ratio ? g : m)) : null;
  const hi = usableGroups.length ? usableGroups.reduce((m, g) => (g.ratio > m.ratio ? g : m)) : null;
  return [{
    ...rep,
    lo: lo?.ratio ?? null, loName: lo?.name ?? null,
    hi: hi?.ratio ?? null, hiName: hi?.name ?? null,
    count: all.length,
  }];
}

/** 从表达式里抠系数：先长后缀再单字母，避免 c 命中 cc / cr 的开头 */
export function exprCoefficients(body) {
  const num = (re) => {
    const m = body.match(re);
    if (!m) return null;
    const v = Number(m[1]);
    return Number.isFinite(v) ? v : null;
  };
  return {
    p: num(/\bp\s*\*\s*([\d.]+)/),
    c: num(/\bc\s*\*\s*([\d.]+)/),
    cr: num(/\bcr\s*\*\s*([\d.]+)/),
    cc: num(/\bcc(?!1h)\s*\*\s*([\d.]+)/) ?? num(/\bcc1h\s*\*\s*([\d.]+)/),
    fixed: num(/fixed\s*\(\s*([\d.]+)\s*\)/),
    secs: num(/\bu\("seconds"\)\s*\*\s*([\d.]+)/),
  };
}

/** 切出所有 tier("name", ...)，括号按深度平衡（表达式里有嵌套三元） */
export function tierBranches(expr) {
  const out = [];
  const re = /tier\s*\(\s*"([^"]+)"\s*,/g;
  let m;
  while ((m = re.exec(expr))) {
    let i = re.lastIndex;
    let depth = 1;
    const start = i;
    for (; i < expr.length && depth > 0; i++) {
      const ch = expr[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    out.push({ name: m[1], body: expr.slice(start, i - 1).trim() });
  }
  return out;
}

const TIER_PRIORITY = ['base', 'standard', 'auto', 'default', 'off_peak', 'peak', 'short', 'none'];

/**
 * 解析 billing_expr。选档 base > standard > 其他，
 * 避免取到 long_context（长上下文档通常直接翻倍）。
 */
export function parseBillingExpr(expr) {
  if (!expr || typeof expr !== 'string') return null;
  const branches = tierBranches(expr);
  if (!branches.length) return null;

  const priced = [];
  for (const b of branches) {
    const co = exprCoefficients(b.body);
    if (co.p == null && co.fixed == null && co.secs == null) continue;
    priced.push({ name: b.name, ...co });
  }
  if (!priced.length) return null;

  const rank = (n) => {
    const i = TIER_PRIORITY.indexOf(String(n).toLowerCase());
    return i < 0 ? 50 : i;
  };
  const sorted = priced.slice().sort((a, b) => rank(a.name) - rank(b.name));
  const main = sorted[0];
  const alt = sorted.find((x) => x !== main && x.p != null);
  const branchesNote = priced.length > 1
    ? priced.map((x) => ({ name: x.name, input: x.p, output: x.c, cacheRead: x.cr }))
    : null;

  if (main.fixed != null) return { kind: 'per_call', usd: Number(main.fixed.toFixed(4)), via: 'expr' };
  if (main.secs != null) return { kind: 'per_unit', unit: 'second', perUnit: Number(main.secs.toFixed(6)), via: 'expr' };
  if (main.p == null) return null;

  return {
    kind: 'per_1m',
    input: Number(main.p.toFixed(4)),
    output: Number((main.c ?? main.p).toFixed(4)),
    ...(main.cr != null ? { cacheRead: Number(main.cr.toFixed(4)) } : {}),
    ...(main.cc != null ? { cacheWrite: Number(main.cc.toFixed(4)) } : {}),
    comp: main.c != null && main.p > 0 ? Number((main.c / main.p).toFixed(4)) : 1,
    tier: main.name,
    via: 'expr',
    ...(branchesNote ? { branches: branchesNote } : {}),
    ...(alt ? { longContext: { name: alt.name, input: alt.p, output: alt.c } } : {}),
  };
}

/**
 * 单价。优先 billing_expr（真实挂牌价），退回 model_ratio 倍率法。
 *
 * 这是本页曾经「所有站一个价」和「11 家 75/75 异常」两个 bug 的正解：
 * 有 billing_expr 的站点，其 model_ratio 是废弃占位字段，
 * 拿它算出来的 $75 与挂牌 $2 毫无关系，必须让表达式优先。
 */
export function relayPrice(row, group) {
  const n = (x) => (x == null || x === '' ? null : Number(x));
  const g = group?.ratio == null ? 1 : group.ratio;

  // ① 表达式计费
  const viaExpr = parseBillingExpr(row.billing_expr);
  if (viaExpr) {
    if (viaExpr.kind !== 'per_1m') return { ...viaExpr, group: group?.name ?? null };
    // 表达式里的系数已是美元价，不再乘分组倍率（分组倍率只作用于 model_ratio 体系）
    return {
      ...viaExpr,
      comp: viaExpr.comp ?? 1,
      group: group?.name ?? null,
      groupKnown: group?.ratio != null,
    };
  }

  // ② 倍率计费
  const perCall = n(row.model_price ?? row.modelPrice);
  if (perCall && perCall > 0) return { kind: 'per_call', usd: Number(perCall.toFixed(4)), group: group?.name ?? null };
  const ratio = n(row.model_ratio ?? row.modelRatio ?? row.ratio);
  if (ratio == null || !Number.isFinite(ratio) || ratio <= 0) return null;
  const comp = n(row.completion_ratio ?? row.completionRatio) || 1;
  const cache = n(row.cache_ratio);
  const out = {
    kind: 'per_1m',
    input: Number((ratio * 2 * g).toFixed(4)),
    output: Number((ratio * comp * 2 * g).toFixed(4)),
    comp: Number(comp.toFixed(4)),
    group: group?.name ?? 'default',
    groupKnown: group?.ratio != null,
    via: 'ratio',
  };
  if (cache != null && Number.isFinite(cache) && cache >= 0) {
    out.cacheRead = Number((ratio * cache * 2 * g).toFixed(4));
    out.cacheRatio = Number(cache.toFixed(4));
  }
  return out;
}

export function parseJsonLoose(text) {
  try { return JSON.parse(text); } catch {}
  try { return JSON.parse(text.split('\n')[0]); } catch {}
  const i = text.indexOf('{');
  if (i < 0) return null;
  try { return JSON.parse(text.slice(i)); } catch { return null; }
}

async function probeRelay(entry) {
  const url = `https://${entry.domain}/api/pricing`;
  try {
    // 部分站 /api/pricing 301 到另一个域（如 aigcbest → api2.aigcbest.top）：
    // 跟随由 lib/http.js 负责，且每一跳都过协议校验（INV-14）。
    const res = await httpGet(url, { timeoutMs: 9000, tries: 2, backoffMs: 300, label: `relay/${entry.domain}` });
    if (!res.ok) return { ...entry, status: `http_${res.status}`, url };
    const text = await res.text();
    const j = parseJsonLoose(text);
    const rows = Array.isArray(j?.data) ? j.data : Array.isArray(j) ? j : [];
    if (!rows.length) return { ...entry, status: 'no_pricing', url };

    const gTable = groupRatioTable(j);
    const gValues = gTable ? [...new Set(Object.values(gTable))].sort((a, b) => a - b) : [];
    const models = new Set();
    for (const r of rows) { const n = r.model_name || r.modelName || r.id; if (n) models.add(n); }

    const prices = {};
    let flagPicked = [];
    for (const f of FLAGSHIP) {
      const picked = pickFlagship(rows, f, gTable);
      if (!picked) continue;
      const { row, price, candidates, groupCount, tiered, variant, floor } = picked;
      /*
       * 异常判定只标「明显贵到不合常理」的情况。
       *
       * 旧实现用 +1 美元的绝对容差，对便宜模型完全失效：
       * deepseek-flash 官方 $0.14，任何正常加价（$1）都会被判异常，
       * 结果是 9 家全标红——那不是市场异常，是判定公式写错了。
       * 现在改为纯倍率判定，且阈值随价位收紧：便宜模型容许多一点加价
       * （小模型常按最低 $1 起售），贵模型只认 2 倍。
       */
      let anomaly = false;
      if (price.kind === 'per_1m') {
        const inRatio = price.input / f.official[0];
        const outRatio = price.output / f.official[1];
        const cap = f.official[0] < 0.5 ? 8 : 2.5; // 便宜模型：绝对差价主导，放宽
        anomaly = inRatio > cap || outRatio > cap;
      }
      prices[f.key] = {
        ...price,
        model: String(row.model_name || row.modelName || row.id),
        anomaly: !!anomaly,
        variants: candidates,
        groups: groupCount,
        ...(floor ? { floor } : {}),
        // 只有变体可选时如实标注，不假装是基础版
        ...(variant ? { variantOnly: true } : {}),
        ...(tiered ? { tiered: true } : {}),
      };
      flagPicked.push(f.key);
    }

    // 样本：按官方价格档位分层抽样，保证旗舰与低价模型都能进样本
    const samples = [];
    const seen = new Set();
    const priced = rows
      .map((r) => {
        const grp = rowGroups(r, gTable)[0];
        const pr = relayPrice(r, grp);
        const nm = String(r.model_name || r.modelName || r.id || '').slice(0, 48);
        return pr && pr.kind === 'per_1m' && nm ? { n: nm, i: pr.input, o: pr.output, c: pr.comp } : null;
      })
      .filter(Boolean)
      // 同价时按模型名排序：否则 samples 顺序随源端返回顺序漂移（INV-7）
      .sort((a, b) => (a.i - b.i) || (a.n < b.n ? -1 : a.n > b.n ? 1 : 0));
    // 从最便宜到最贵等距取，避免「前 40 条全是小模型」
    const step = Math.max(1, Math.floor(priced.length / 40));
    for (let k = 0; k < priced.length && samples.length < 40; k += step) {
      const s = priced[k];
      if (seen.has(s.n)) continue;
      seen.add(s.n);
      samples.push(s);
    }

    return {
      ...entry,
      status: 'ok',
      url,
      resolved: res.url && res.url !== url ? res.url : undefined,
      models: models.size,
      prices,
      samples,
      groups: gTable ? {
        count: Object.keys(gTable).length,
        min: gValues[0],
        max: gValues[gValues.length - 1],
        spread: gValues.length > 1 ? Number((gValues[gValues.length - 1] / gValues[0]).toFixed(1)) : 1,
        names: Object.keys(gTable).slice(0, 40),
      } : null,
      checked_at: todayISO(),
    };
  } catch (e) {
    // 超时由 lib/http.js 统一转换：TimeoutError 直接标 timeout，其余算 unreachable
    const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError' || /超时/.test(e.message || '');
    return { ...entry, status: timedOut ? 'timeout' : 'unreachable', url };
  }
}

/**
 * 在一个站的价目行里挑出「基础版」旗舰，而不是第一个正则命中。
 *
 * 历史问题：
 *  1) rows.find(re) 会命中 claude-opus-5-5-thinking / -high / -low 等变体；
 *  2) /deepseek.*flash/ 会先命中 deepseek-flash（75/150），跳过正确的 deepseek-v4-1-flash（2/8）。
 * 现在：排除变体与日期后缀 → 优先分组 known → 输出/输入比最贴官方 → 价低者。
 */
const VARIANT_RE = /(thinking|reasoning|reasoner|nothink|non-?thinking|high|low|medium|xhigh|max|effort|beta|alpha|preview|experimental|exp|latest|search|online|image|vision|audio|omni|realtime|transcribe|tts|codex|instruct)/i;
const DATED_RE = /-\d{6,8}(?:$|-)/;
/*
 * 免费额度行不是报价，不该参与比价：
 *   deepseek-v4.1-flash-free / :free / -0x 等，价格常是 0 或象征值，
 *   混进来会让「最低价」永远指向免费额度，价差被拉成 100 倍以上。
 */
const FREE_RE = /(?:^|[-_\/:])(free|gratis|trial|试用|公益|福利)(?:$|[-_\/:])|:free$/i;

export function pickFlagship(rows, f, gTable) {
  const named = rows.filter((r) => {
    const nm = String(r.model_name || r.modelName || r.id || '');
    return f.re.test(nm);
  });
  if (!named.length) return null;

  const isVariant = (r) => {
    const nm = String(r.model_name || r.modelName || r.id || '');
    const base = nm.replace(f.re, '').replace(/^[-_.\s]+|[-_.\s]+$/g, '');
    // 只对「名字里比正则多出来的部分」判变体，避免把 claude-sonnet-5-5 本身判成变体
    return VARIANT_RE.test(base) || DATED_RE.test(nm) || FREE_RE.test(nm);
  };

  const scored = [];
  for (const r of named) {
    const groups = rowGroups(r, gTable);
    const g = groups[0];
    const p = relayPrice(r, g);
    if (!p) continue;
    const perCall = p.kind === 'per_call';
    const variant = isVariant(r);
    let score = 0;
    // 基础版压倒一切：宁可显示「按次计价的基础版」，也不要显示变体的单价。
    if (!variant) score += 100;
    if (p.kind === 'per_1m') {
      const wantRatio = f.official[1] / f.official[0];
      const ratioErr = Math.abs(Math.log((p.comp || 1) / wantRatio));
      score -= ratioErr * 18;
      score -= Math.log10(Math.max(p.input, 0.0001)) * 0.6; // 同分时略偏好低价
    }
    if (p.groupKnown) score += 20;
    if (!p.tiered) score += 10;
    if (perCall) score -= 4; // 计费口径不同，排在同名 per_1m 之后
    scored.push({ row: r, price: p, score, variant, groups, tiered: Boolean(p.tiered), perCall });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score || (a.price.input ?? a.price.usd ?? 0) - (b.price.input ?? b.price.usd ?? 0));
  const best = scored[0];

  /*
   * 最低可达价：同一行在「最便宜可用分组」下的单价。
   * 这是用户真正会问的问题（「这家最低能到多少」），但它依赖具体分组
   * （有的组要买会员、有的组只给 Claude Code 用），所以和代表价分开存，
   * 页面上必须标出组名，不能拿它冒充无门槛价格。
   */
  let floor = null;
  const g0 = best.groups[0];
  if (g0 && g0.lo != null && best.price.via === 'ratio' && g0.ratio > 0 && g0.lo !== g0.ratio) {
    const k = g0.lo / g0.ratio;
    floor = {
      input: Number((best.price.input * k).toFixed(4)),
      output: Number((best.price.output * k).toFixed(4)),
      group: g0.loName,
      disc: Number(k.toFixed(3)),
    };
  }

  return {
    row: best.row,
    price: best.price,
    candidates: scored.length,
    groupCount: best.groups.length,
    tiered: best.tiered,
    variant: best.variant,
    floor,
  };
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
    const j = await httpJson('https://open.er-api.com/v6/latest/USD', { label: 'fx', tries: 2 });
    const rate = j?.rates?.CNY;
    if (!rate) throw new Error('no CNY');
    return { USDCNY: Number(rate.toFixed(4)), as_of: (j.time_last_update_utc || '').slice(0, 16), source: 'open.er-api.com', fetched_at: nowISO() };
  } catch {
    return prev ? { ...prev, stale: true } : { USDCNY: 7.1, as_of: 'fallback', source: 'fallback', fetched_at: nowISO() };
  }
}

/* ────────────────────────── 7. AI 活动 ────────────────────────── */
/* AIOS 活动库：可选层，本地有就用、没有就跳过。
 * 以前是一个写死的绝对路径（还重复了一段 Desktop/AIOS），换机器或上 CI 必然读不到，
 * 而且读不到时没有任何提示。现在按候选顺序探测，都不在就明确说一句「跳过」。
 *
 * 实测（2026-10）：真正有那 23 条的文件是
 *   ~/Desktop/AIOS/Users/raki/Desktop/AIOS/.artifacts/production-receipts/local-current/api-opportunities.json
 * 而 ~/Desktop/AIOS/.artifacts/... 并不存在。原实现把这一条排在最前，一旦有人
 * 补上这个浅路径就会读到错的文件；同时没有任何递归查找兜底，换个目录就静默丢整层。
 * 现在的顺序：显式 env → 已知实证路径 → 递归 glob 取最新的一份。 */
const AIOS_HOME = `${process.env.HOME || ''}/Desktop/AIOS`;
const AIOS_CANDIDATES = [
  process.env.AIOS_OPPORTUNITIES,
  `${AIOS_HOME}/Users/raki/Desktop/AIOS/.artifacts/production-receipts/local-current/api-opportunities.json`,
  `${AIOS_HOME}/.artifacts/production-receipts/local-current/api-opportunities.json`,
].filter(Boolean);

/* 递归找 api-opportunities.json，取 mtime 最新的一个。
 * 目录层级很深（.artifacts/production-receipts/local-current/…），只认浅路径迟早再翻车。 */
function globAiosFile(root, { maxDepth = 8, maxDirs = 400 } = {}) {
  if (!root || !existsSync(root)) return null;
  const queue = [{ dir: root, depth: 0 }];
  let visited = 0;
  const hits = [];
  const SKIP = new Set(['node_modules', '.git', 'Corpus', 'caches', 'Cache']);
  while (queue.length && visited < maxDirs) {
    const { dir, depth } = queue.shift();
    visited += 1;
    let ents;
    try { ents = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const d of ents) {
      const p = `${dir}/${d.name}`;
      if (d.isDirectory()) {
        if (depth + 1 > maxDepth || SKIP.has(d.name)) continue;
        queue.push({ dir: p, depth: depth + 1 });
      } else if (d.name === 'api-opportunities.json') {
        try { hits.push({ p, m: statSync(p).mtimeMs }); } catch { /* 读不到就算了 */ }
      }
    }
    // 一旦在较浅的层级里找到，就不再往深处挖
    if (hits.length && depth >= 2) break;
  }
  if (!hits.length) return null;
  hits.sort((a, b) => b.m - a.m);
  return hits[0].p;
}

function resolveAiosFile() {
  for (const p of AIOS_CANDIDATES) {
    try {
      if (existsSync(p)) return p;
    } catch { /* 下一个 */ }
  }
  return globAiosFile(AIOS_HOME);
}
/* AIOS 是可选层。探测放到第一次用到时（T0.3），这样 import 本模块不会打日志、不读文件。 */
let AIOS_FILE = null;
let AIOS_PROBED = false;
function aiosFile() {
  if (!AIOS_PROBED) {
    AIOS_PROBED = true;
    AIOS_FILE = resolveAiosFile();
    if (!AIOS_FILE) {
      console.warn('[collect] 没找到 AIOS 活动库（可选层），本次活动只收 Devpost + Luma');
    } else {
      console.log(`[collect] AIOS 活动库：${AIOS_FILE}`);
    }
  }
  return AIOS_FILE;
}

/* Devpost 的 submission_period_dates 有三种真实写法，旧实现只认第一种，
 * 结果 20/65 个活动日期解析成 null、被标成「未知」，白白丢掉 30% 的数据：
 *   "Oct 05 - Nov 12, 2026"      年月都在后面
 *   "Oct 05 - 27, 2026"          结束月省略（同月）
 *   "Jul 16, 2026 - Jan 15, 2027" 两端各带年份，跨年
 * 统一按「从左到右，缺年份继承上一个」处理，跨年靠月序回退纠正。 */
export function parseDevpostDates(s) {
  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const str = String(s || '');
  const iso = (y, mo, d) => new Date(Date.UTC(y, mo, d)).toISOString().slice(0, 10);

  // 拆出所有 (月份, 日, 年份?) 片段，按出现顺序
  const re = /\b([A-Z][a-z]{2})\.?\s+(\d{1,2})(?:,\s*(\d{4}))?/g;
  const parts = [];
  let m;
  while ((m = re.exec(str))) {
    const mo = MONTHS[m[1]];
    if (mo == null) continue;
    parts.push({ mo, day: Number(m[2]), year: m[3] ? Number(m[3]) : null });
  }
  if (!parts.length) return { start: null, end: null };

  // 末尾单独的年份（"Oct 05 - Nov 12, 2026" 的年份会挂到最后一段上）
  const tail = str.match(/,\s*(\d{4})\s*$/);
  const tailYear = tail ? Number(tail[1]) : null;

  // "Oct 05 - 27, 2026"：只有孤立的日号，结束日继承起点的月
  // 单日活动（"Oct 23, 2026"）走同一个分支但**没有** `-`，旧实现拿不到 bare 就直接
  // return null，把 37 条源里明明带日期的活动判成「未知」。实测 Devpost 192 条里
  // 单日格式就有 37 条，占 19%，一批真实活动因此从 open/upcoming 里消失。
  if (parts.length === 1) {
    const bare = str.match(/-\s*(\d{1,2})(?:,\s*(\d{4}))?\s*$/);
    if (!bare) {
      // 单日活动：start = end = 当天
      const y = parts[0].year ?? tailYear;
      if (y == null) return { start: null, end: null };
      const day = iso(y, parts[0].mo, parts[0].day);
      return { start: day, end: day };
    }
    const y = Number(bare[2]) || parts[0].year || tailYear;
    if (y == null) return { start: null, end: null };
    const a = parts[0];
    return { start: iso(y, a.mo, a.day), end: iso(y, a.mo, Number(bare[1])) };
  }

  const a = { ...parts[0] };
  const b = { ...parts[1] };
  // 年份补全：自身 > 尾随年份 > 另一端
  if (b.year == null) b.year = tailYear ?? a.year;
  if (a.year == null) a.year = b.year ?? tailYear;
  if (a.year == null && b.year == null) return { start: null, end: null };

  // 跨年纠正：起点月晚于终点月且只有终点带年份，说明起点在上一年
  let y1 = a.year;
  const y2 = b.year;
  if (y1 == null) y1 = y2;
  if (y2 != null && a.mo > b.mo && y1 >= y2) y1 = y2 - 1;

  return { start: iso(y1, a.mo, a.day), end: iso(y2 ?? y1, b.mo, b.day) };
}

/* Devpost：**必须按 status 分组全翻**。
 * 实测 2026-10-24：
 *   status[]=open     meta.total_count=59   每页被服务器压到 9 条  → 需 7 页
 *   status[]=upcoming meta.total_count=133  每页 9 条              → 需 15 页
 * 旧实现只拉 open、且只翻 5 页，实收 45 条，另外 133 个未开始的活动一条没进。
 * 现在按 EV_DEVPOST_STATUS 逐个 status 翻到 entries 为空或收满 total_count，
 * 页上限 EV_DEVPOST_MAX_PAGES 兜底防失控（服务器分页行为变了也不会无限翻）。 */
const EV_DEVPOST_STATUS = ['open', 'upcoming'];
const EV_DEVPOST_MAX_PAGES = TEST_PROFILE ? 2 : 40;

async function devpostPage(status, page, attempt = 0) {
  const url = `https://devpost.com/api/hackathons?status[]=${status}&limit=24&page=${page}`;
  try {
    return await httpJson(url, { label: `devpost/${status}/p${page}` });
  } catch (e) {
    // 翻到深页偶发 5xx/超时，退避重试一次，别把整页数据丢掉
    if (attempt < 2) {
      await sleep(400 * (attempt + 1));
      return devpostPage(status, page, attempt + 1);
    }
    throw e;
  }
}

async function fetchDevpost() {
  const all = [];
  const stats = {};
  for (const status of EV_DEVPOST_STATUS) {
    let total = null;
    let got = 0;
    for (let page = 1; page <= EV_DEVPOST_MAX_PAGES; page += 1) {
      let j;
      try {
        j = await devpostPage(status, page);
      } catch (e) {
        console.warn(`[collect] devpost ${status} p${page} 放弃：${e.message}`);
        break;
      }
      if (total == null && Number.isFinite(j?.meta?.total_count)) total = Number(j.meta.total_count);
      const list = j?.hackathons || [];
      if (!list.length) break;
      all.push(...list);
      got += list.length;
      // 收满 total_count 就停；total 缺失时靠 entries 为空自然结束
      if (total != null && got >= total) break;
    }
    stats[status] = { total, got };
  }
  console.log(`[collect] devpost 分状态：${Object.entries(stats).map(([k, v]) => `${k} ${v.got}/${v.total ?? '?'}`).join(' · ')}`);

  const seen = new Set();
  return all
    .filter((h) => { if (!h?.id || seen.has(h.id)) return false; seen.add(h.id); return true; })
    .map((h) => {
      const d = parseDevpostDates(h.submission_period_dates);
      const row = {
        id: `devpost-${h.id}`, title: h.title, url: h.url, dates: h.submission_period_dates,
        start: d.start, end: d.end, location: h.displayed_location?.location || '线上',
        org: h.organization_name || '',
        prize: h.prize_amount ? String(h.prize_amount).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : null,
        regs: h.registrations_count || 0,
        themes: (h.themes || []).map((t) => t.name), source: 'Devpost',
      };
      // 摘要：源里没有正文字段，用「主题 + 奖池 + 报名数」拼一条可读的一句话，前端只展示一行
      row.summary = devpostSummary(row);
      row.status = eventStatus(row);   // 按日期判，不再一律 open
      return row;
    });
}

/* Devpost 的 API 不返回描述正文，能代表“这场活动是什么”的只有 themes / prize / regs。
 * 拼成一句话，长度控制在 280 字符内，跟 Luma 的 summary 字段同形态。 */
function devpostSummary(row) {
  const bits = [];
  if (row.regs) bits.push(`${row.regs.toLocaleString('en-US')} 人已报名`);
  if (row.prize) bits.push(`奖池 ${row.prize}`);
  const th = (row.themes || []).filter(Boolean).slice(0, 4);
  if (th.length) bits.push(th.join(' / '));
  const s = bits.join(' · ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, 280) : null;
}

/* Luma 公开发现流：单 query 上限 50 且 has_more 恒为 false，**不是数据只有 50 条，是查询被截断**。
 * 实测 2026-10-24：单个 query 返回 50 条 has_more:false；多关键词并集按 api_id 去重 600+。
 * 旧实现只查 query=AI → 只拿到 50 条里过原始正则的那 43 条，占真实量的 1/10。
 * 现在并发查 EV_LUMA_QUERIES，按 api_id 去重。
 *
 * 另外实测：带空格/中文的 query 会偶发 HTTP 500（LLM、大模型、Machine Learning 都中过），
 * 重试一次即可拿到 50 条 —— 这是源端抖动，不是查询无效，所以必须重试而不是当空结果收下。 */
const EV_LUMA_QUERIES = [
  'AI', 'LLM', 'Agent', 'Agentic', 'Machine Learning', 'Deep Learning', 'Neural Network',
  'OpenAI', 'GPT', 'ChatGPT', 'Claude', 'Anthropic', 'Gemini', 'Copilot', 'Mistral', 'Llama',
  'Stable Diffusion', 'Generative AI', 'RAG', 'AI Startup', 'AI Meetup', 'AI Summit',
  'AI Workshop', 'AI Hackathon', 'AI Tools', 'AI Agents',
  '大模型', '智能体', '人工智能', '机器学习',
];
const EV_LUMA_CONCURRENCY = 8;

/* ── 地理维度：带经纬度返回「该城市周边的 AI 活动」，与不带 geo 的结果**完全不重叠** ──
 * 实测 2026-10-24：同一个 query=AI，无 geo 与 SF geo 的返回集合交集为 0。
 * 也就是说 geo 不是「同一批数据加个坐标」，而是另一条索引 —— 这是最大的一处漏采。
 *
 * region 字段是**兜底**：事件自带 country_code 时以 country_code 为准（见 lumaCountryRegion），
 * 只有 geo 缺失时才用城市坐标所属的 region。城市坐标只是「这次查询问的是哪儿」，
 * 不代表活动真的在那个国家（海外场次也会被周边查询带出来），所以顺序不能反。 */
const EV_LUMA_CITIES = [
  // 北美
  { slug: 'sf',          lat: 37.7749,  lng: -122.4194, region: 'us' },
  { slug: 'nyc',         lat: 40.7128,  lng: -74.0060,  region: 'us' },
  { slug: 'boston',      lat: 42.3601,  lng: -71.0589,  region: 'us' },
  { slug: 'seattle',     lat: 47.6062,  lng: -122.3321, region: 'us' },
  { slug: 'austin',      lat: 30.2672,  lng: -97.7431,  region: 'us' },
  { slug: 'toronto',     lat: 43.6532,  lng: -79.3832,  region: 'ca' },
  { slug: 'vancouver',   lat: 49.2827,  lng: -123.1207, region: 'ca' },
  // 欧洲
  { slug: 'london',      lat: 51.5074,  lng: -0.1278,   region: 'uk' },
  { slug: 'berlin',      lat: 52.5200,  lng: 13.4050,   region: 'eu' },
  { slug: 'paris',       lat: 48.8566,  lng: 2.3522,    region: 'eu' },
  { slug: 'amsterdam',   lat: 52.3676,  lng: 4.9041,    region: 'eu' },
  { slug: 'zurich',      lat: 47.3769,  lng: 8.5417,    region: 'eu' },
  // 亚洲
  { slug: 'tokyo',       lat: 35.6762,  lng: 139.6503,  region: 'jp' },
  { slug: 'seoul',       lat: 37.5665,  lng: 126.9780,  region: 'kr' },
  { slug: 'singapore',   lat: 1.3521,   lng: 103.8198,  region: 'sg' },
  { slug: 'bangalore',   lat: 12.9716,  lng: 77.5946,   region: 'in' },
  { slug: 'beijing',     lat: 39.9042,  lng: 116.4074,  region: 'cn' },
  { slug: 'shanghai',    lat: 31.2304,  lng: 121.4737,  region: 'cn' },
  { slug: 'shenzhen',    lat: 22.5431,  lng: 114.0579,  region: 'cn' },
  { slug: 'hangzhou',    lat: 30.2741,  lng: 120.1551,  region: 'cn' },
  { slug: 'taipei',      lat: 25.0330,  lng: 121.5654,  region: 'cn' },
  { slug: 'hongkong',    lat: 22.3193,  lng: 114.1694,  region: 'cn' },
  // 其他
  { slug: 'dubai',       lat: 25.2048,  lng: 55.2708,   region: 'ae' },
  { slug: 'sydney',      lat: -33.8688, lng: 151.2093,  region: 'au' },
  { slug: 'telaviv',     lat: 32.0853,  lng: 34.7818,   region: 'middle-east' },
  { slug: 'saopaulo',    lat: -23.5505, lng: -46.6333,  region: 'latam' },
  { slug: 'mexicocity',  lat: 19.4326,  lng: -99.1332,  region: 'latam' },
];

/* geo 循环只配这 8 个词：全量 30 个词 × 27 城市 = 810 次请求会被源端封。
 * 8 × 27 = 216 次，加上无 geo 的 30 次 = 246 次，落在 250 的预算内。
 * 选词依据：AI / LLM / Agent 是发现流里覆盖面最广的三个（实测单城各 50 条），
 * OpenAI / hackathon / GenAI 补厂商与活动形态，中文三个词是亚洲城市的主要命中词。 */
const EV_LUMA_GEO_QUERIES = ['AI', 'LLM', 'Agent', 'OpenAI', 'hackathon', '大模型', '人工智能', 'GenAI'];

const EV_LUMA_CITY_BY_SLUG = new Map(EV_LUMA_CITIES.map((c) => [c.slug, c]));

/* 测试档位的有效集合：生产用全量，test 用缩小切片。
 * 切片只影响「跑多少」，不影响「怎么算」，所以 golden 仍能覆盖所有分支。 */
const LUMA_QUERIES = TEST_PROFILE ? EV_LUMA_QUERIES.slice(0, 2) : EV_LUMA_QUERIES;
const LUMA_CITIES = TEST_PROFILE ? EV_LUMA_CITIES.slice(0, 1) : EV_LUMA_CITIES;
const LUMA_GEO_QUERIES = TEST_PROFILE ? EV_LUMA_GEO_QUERIES.slice(0, 2) : EV_LUMA_GEO_QUERIES;

/* country_code → region：**第一优先级**的地区判定依据。
 * 实测 2026-10-24：Luma 的 geo_address_info.country_code 确实有值（'US' / 'JP' / 'IN' / 'HK' …），
 * 比拿 location 字符串跑国家正则准得多 —— 后者在「校园名 / 缩写 / 非拉丁文」上大量漏判，
 * 这正是 region=other 常年 12% 的根因。
 * 值只映射到 region 用的大区码；没列到的国家落 'other'，交给字符串正则兜底。 */
const EV_COUNTRY_REGION = {
  // 大中华区（港澳台按项目既有口径并入 cn，与 EV_REGION_RULES 的中文区一致）
  CN: 'cn', HK: 'cn', TW: 'cn', MO: 'cn',
  JP: 'jp', KR: 'kr', SG: 'sg', IN: 'in',
  // 欧洲
  GB: 'uk',
  DE: 'eu', FR: 'eu', NL: 'eu', CH: 'eu', ES: 'eu', IT: 'eu', PT: 'eu', SE: 'eu',
  FI: 'eu', DK: 'eu', NO: 'eu', PL: 'eu', CZ: 'eu', AT: 'eu', BE: 'eu', IE: 'eu',
  HU: 'eu', RO: 'eu', BG: 'eu', LU: 'eu', EE: 'eu', LV: 'eu', LT: 'eu', GR: 'eu',
  HR: 'eu', SI: 'eu', SK: 'eu', RS: 'eu', UA: 'eu', TR: 'eu',
  // 北美
  US: 'us', CA: 'ca',
  // 中东
  AE: 'ae', IL: 'middle-east', SA: 'middle-east', QA: 'middle-east',
  JO: 'middle-east', LB: 'middle-east', KW: 'middle-east', BH: 'middle-east', OM: 'middle-east',
  // 拉美
  BR: 'latam', MX: 'latam', AR: 'latam', CL: 'latam', CO: 'latam', PE: 'latam',
  UY: 'latam', PY: 'latam', EC: 'latam', CR: 'latam', PA: 'latam',
  // 大洋洲
  AU: 'au', NZ: 'au',
  // 非洲
  NG: 'africa', KE: 'africa', ZA: 'africa', EG: 'africa', GH: 'africa', MA: 'africa',
  TN: 'africa', UG: 'africa', TZ: 'africa', RW: 'africa', ET: 'africa',
  // 东南亚 / 南亚其余
  PH: 'asia', ID: 'asia', VN: 'asia', TH: 'asia', MY: 'asia', LK: 'asia',
  NP: 'asia', BD: 'asia', KH: 'asia', MM: 'asia', PK: 'asia',
};

/** 国家码 → region，未知国家返回 null（交给正则兜底，不瞎猜） */
export function regionFromCountryCode(cc) {
  if (!cc) return null;
  return EV_COUNTRY_REGION[String(cc).trim().toUpperCase()] || null;
}

/* 英文国名 → region：给 Devfolio 这类只给国名、不给 ISO 码的源用。
 * 用 ^...$ 全匹配，避免 "India" 被 "Indiana" 之类的城市名误命中。 */
const EV_COUNTRY_NAME_RULES = [
  ['us', /^(United States|United States of America|USA|US)$/i],
  ['uk', /^(United Kingdom|UK|England|Scotland|Wales|Northern Ireland|Great Britain)$/i],
  ['cn', /^(China|Hong Kong|Macao|Macau|Taiwan)$/i],
  ['jp', /^Japan$/i], ['kr', /^(South Korea|Korea)$/i], ['sg', /^Singapore$/i],
  ['in', /^India$/i], ['ca', /^Canada$/i], ['au', /^(Australia|New Zealand)$/i],
  ['ae', /^(United Arab Emirates|UAE)$/i],
  ['eu', /^(Germany|France|Netherlands|Switzerland|Spain|Italy|Portugal|Sweden|Finland|Denmark|Norway|Poland|Czechia|Czech Republic|Austria|Belgium|Ireland|Hungary|Romania|Bulgaria|Luxembourg|Estonia|Latvia|Lithuania|Greece|Croatia|Slovenia|Slovakia|Serbia|Ukraine|Turkey|Türkiye)$/i],
  ['middle-east', /^(Israel|Saudi Arabia|Qatar|Jordan|Lebanon|Kuwait|Bahrain|Oman)$/i],
  ['latam', /^(Brazil|Mexico|Argentina|Chile|Colombia|Peru|Uruguay|Paraguay|Ecuador|Costa Rica|Panama)$/i],
  ['africa', /^(Nigeria|Kenya|South Africa|Egypt|Ghana|Morocco|Tunisia|Uganda|Tanzania|Rwanda|Ethiopia)$/i],
  ['asia', /^(Philippines|Indonesia|Vietnam|Thailand|Malaysia|Sri Lanka|Nepal|Bangladesh|Cambodia|Myanmar|Pakistan)$/i],
];

/* 限速：这里是**实测**出来的硬约束，不是拍脑袋。
 * 2026-10-24 实测：
 *   - 并发 8 + 80ms 节流 → 216 个 geo job 里 167 个失败（403/429）
 *   - 封禁是**有状态**的：封后单请求间隔 400ms / 1500ms 仍 429
 *   - 解封曲线：+30s 429 · +60s 429 · +120s 429 · **+180s 才 200**
 *   - 顺序 + 间隔 900ms → 连发 12 个全 200；1500ms 同样 12/12
 * 所以：geo 走**单线程顺序队列**，每请求间隔 EV_LUMA_GAP_MS，命中 429 就指数退避到
 * EV_LUMA_COOLDOWN_MS 再继续。并发在这里不是优化，是自杀 —— 跟 Eventbrite 是同一形态。 */
const EV_LUMA_GAP_MS = 900;
const EV_LUMA_COOLDOWN_MS = 180000;   // 实测封禁约 3 分钟才解
const EV_LUMA_MAX_RETRY = 3;

/* geo 循环的总预算：宁可少采几个城市，也不能让整次 collect 挂在网络里。
 * 正常跑满 216 次 × 900ms ≈ 195s；预留一倍余量。一旦撞到多次 429 把冷却叠起来，
 * 超预算就中断剩余城市、用已有结果继续，并把「未采完」如实记进 meta.collect 的 note。
 * 这里不抛错 —— 抛错会让 T.run 走 stale 丢掉本次已采到的新城市数据，那是更糟的结果。 */
const EV_LUMA_GEO_BUDGET_MS = 480000;   // 8 分钟

/* 请求计数器与限速观测点。
 * 验收要报「总请求数」，逐次累加而不是事后估算。
 * blocked/最长冷却单独记账：这个源是**有状态封禁**，哪天它把阈值调紧，
 * 我们要能从 meta.collect 里立刻看出来，而不是等条数掉了再回头排查。 */
/* 单主机冷却总上限（F04、S2.3）。
 * 实测封禁约 3 分钟解封；但旧逻辑按 attempt 递增（180s→360s→540s→720s），
 * 一次请求就能睡掉 12 分钟，比整层的 8 分钟预算还长——最后睡完还不重试，纯浪费。
 * 现在：本次运行累计冷却一旦会超过这个上限，就不再睡、直接标受阻返回，
 * 让「已采到的部分」照常发布，并把原因写进 meta.net。 */
const EV_LUMA_COOLDOWN_CAP_MS = 6 * 60 * 1000;   // 6 分钟

const netStat = { requests: 0, blocked: 0, maxCooldownMs: 0 };

/* 本次运行的 Luma 受阻状态。受阻后不再发起新请求：这个源是有状态封禁，
 * 继续试探只会把解封时间往后推（实测 +180s 才 200）。 */
const lumaState = { blocked: false, reason: null, cooldownMs: 0, gaveUp: 0 };

/** 供测试与 meta 读取的受阻快照。 */
export function getLumaBlockState() {
  return {
    blocked: lumaState.blocked,
    reason: lumaState.reason,
    cooldownMs: lumaState.cooldownMs,
    requests: netStat.requests,
    gaveUp: lumaState.gaveUp,
    capMs: EV_LUMA_COOLDOWN_CAP_MS,
    geoBudgetMs: EV_LUMA_GEO_BUDGET_MS,
  };
}

/** 重置 Luma 的限速状态（测试用；生产一次运行只走一遍）。 */
export function resetLumaState() {
  lumaState.blocked = false;
  lumaState.reason = null;
  lumaState.cooldownMs = 0;
  lumaState.gaveUp = 0;
  netStat.requests = 0;
  netStat.blocked = 0;
  netStat.maxCooldownMs = 0;
}

const lumaSleep = (ms) => sleep(ms);

/** 本次 geo 循环的起点。lumaGet 判断「冷却后会不会越过预算」要用它。 */
let geoStart = 0;

/** 统一出口：计数 + 429 冷却。返回 entries 数组。
 *  @param {object} opt { gap } 请求前是否等一个间隔（geo 队列用，无 geo 的并发池不用） */
async function lumaGet(q, geo, opt = {}) {
  const gap = opt.gap ?? 0;
  let params = `limit=50&query=${encodeURIComponent(q)}`;
  if (geo) params += `&latitude=${geo.lat}&longitude=${geo.lng}`;
  const url = `https://api.lu.ma/discover/get-paginated-events?${params}`;

  if (lumaState.blocked) return [];

  for (let attempt = 0; attempt <= EV_LUMA_MAX_RETRY; attempt += 1) {
    if (gap) await lumaSleep(gap);           // 请求前睡，保证任意两次之间都有间隔
    try {
      netStat.requests += 1;
      // tries: 1：429 的退避由本函数按 Luma 的实测冷却曲线处理，
      // 客户端再自动重试只会把封禁时间往后推（见上方限速注释）。
      const res = await httpGet(url, { tries: 1, deadline: geoStart ? geoStart + EV_LUMA_GEO_BUDGET_MS : undefined, label: `luma/${q}` });
      if (res.status === 429 || res.status === 403) {
        // 429/403 是封禁信号，不是「这个查询没结果」。冷却后重试，不能当空数组吃下去。
        netStat.blocked += 1;
        const wait = EV_LUMA_COOLDOWN_MS * (attempt + 1);

        // 冷却必须先过两道闸（F04、INV-8）：
        // - 本次运行的累计冷却不能超过单主机上限；
        // - 冷却完也不能越过 geo 预算（预算是给整层的，不是给单请求的）。
        // 任一不满足就停手，把「部分结果 + 受阻原因」交回上层，而不是继续睡。
        const overCap = lumaState.cooldownMs + wait > EV_LUMA_COOLDOWN_CAP_MS;
        const overBudget = since(geoStart) + wait > EV_LUMA_GEO_BUDGET_MS;
        if (overCap || overBudget) {
          lumaState.blocked = true;
          lumaState.reason = overCap
            ? `单主机冷却已达上限（${Math.round(lumaState.cooldownMs / 1000)}s + ${Math.round(wait / 1000)}s > ${EV_LUMA_COOLDOWN_CAP_MS / 1000}s）`
            : `再冷却 ${Math.round(wait / 1000)}s 会越过 geo 预算`;
          console.warn(`[collect] luma ${res.status}，停止采集：${lumaState.reason}`);
          return [];
        }

        lumaState.cooldownMs += wait;
        if (wait > netStat.maxCooldownMs) netStat.maxCooldownMs = wait;
        console.warn(`[collect] luma ${res.status}（${geo ? geo.slug : '无geo'} / ${q}），冷却 ${Math.round(wait / 1000)}s 后第 ${attempt + 1} 次重试`);
        await lumaSleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      return j.entries || [];
    } catch (e) {
      if (attempt >= EV_LUMA_MAX_RETRY) {
        lumaState.gaveUp += 1;
        console.warn(`[collect] luma query "${q}"${geo ? `@${geo.slug}` : ''} 放弃：${e.message}`);
        return [];
      }
      // 5xx / 网络抖动：短退避，别升级成长冷却（501 是源端抖动，不是封禁）
      await lumaSleep(350 * (attempt + 1));
    }
  }
  return [];
}

/** Luma 层（导出供 T1.3 的限速用例直接调用）。 */
export async function fetchLuma() {
  try {
    const byId = new Map();
    let failedQueries = 0;
    let cursor = 0;

    // 小并发池：一口气发 30 个请求容易被源端 5xx，8 路足够快也不会自我限流
    const worker = async () => {
      while (cursor < LUMA_QUERIES.length) {
        if (lumaState.blocked) return;
        const q = LUMA_QUERIES[cursor++];
        const entries = await lumaGet(q);
        if (!entries.length) failedQueries += 1;
        for (const entry of entries) {
          const ev = entry?.event || entry;
          const id = ev?.api_id;
          if (!id || !ev?.url || byId.has(id)) continue;
          byId.set(id, ev);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(EV_LUMA_CONCURRENCY, LUMA_QUERIES.length) }, worker));
    const noGeoCount = byId.size;

    /* ── 地理维度：顺序队列 + 间隔 + 总预算 ──
     * 为什么不是并发 8：实测并发会把源端打成有状态封禁（见 EV_LUMA_GAP_MS 上方注释）。
     * 顺序 + 900ms 间隔实测稳定 200，代价是 216 × 0.9 ≈ 195s。
     * 这个站每天只跑一次，3 分钟可以接受；封禁后再解要 3 分钟且期间全部城市失败，更亏。 */
    geoStart = mark();
    const citiesDone = [];
    const citiesSkipped = [];
    let geoHits = 0;
    let aborted = false;

    for (const city of LUMA_CITIES) {
      if (aborted) { citiesSkipped.push(city.slug); continue; }
      let cityNew = 0;
      for (const q of LUMA_GEO_QUERIES) {
        // 两道刹车：预算用超了，或者源已经把我们挡住了（受阻后继续请求只会延长封禁）
        if (since(geoStart) > EV_LUMA_GEO_BUDGET_MS) { aborted = true; break; }
        if (lumaState.blocked) { aborted = true; break; }
        const entries = await lumaGet(q, city, { gap: EV_LUMA_GAP_MS });
        for (const entry of entries) {
          const ev = entry?.event || entry;
          const id = ev?.api_id;
          if (!id || !ev?.url || byId.has(id)) continue;
          // 记住这条是从哪个城市问出来的：geo 缺失时用它兜底 region。
          // 挂一个非持久字段，下游建 row 时用掉后就不再带走。
          ev.__geoCity = city.slug;
          byId.set(id, ev);
          cityNew += 1;
        }
      }
      if (aborted) { citiesSkipped.push(city.slug); break; }
      citiesDone.push(city.slug);
      geoHits += cityNew;
      if (cityNew) console.log(`[collect] luma geo ${city.slug} +${cityNew}（累计 ${byId.size}）`);
    }
    const geoMs = since(geoStart);
    const stopNote = lumaState.blocked ? ` · 受阻停止：${lumaState.reason}` : '';
    console.log(`[collect] luma geo ${citiesDone.length}/${LUMA_CITIES.length} 城完成 · 新增 ${geoHits} 条 · 耗时 ${(geoMs / 1000).toFixed(0)}s${citiesSkipped.length ? ` · 未采完 ${citiesSkipped.length} 城` : ''}${stopNote}`);

    // 关键词本身已经是 AI 相关，这里只做一次轻过滤把明显无关的挡掉：命中任一 AI 词即收。
    //
    // 实测复盘（2026-10-24，并集 1099 条）：旧正则漏掉 570 条，其中真实 AI 活动约 52 条，
    // 最直接的两个 bug：
    //   1) `\bAI\b` 匹配不到 `OpenAI` —— `N` 到 `A` 之间不是词边界。而 OpenAI Student
    //      Collective / OpenAI DevDay / OpenAI Forum 是大批量真实活动，一个词表漏一项就是几十条。
    //   2) 厂商名、模型名、AI 工程语义（devday / devfest / vibe coding / inference / eval）全不在词表。
    //
    // 另一条实测结论：**calendar 名在这批数据里全是空的**（454 条里 org 有值的 0 条），
    // 所以「用主办方兜底识别」在当前源上不成立；识别只能靠 title + 地址。
    // 泛词（machine / human / club / brunch / deep alone）一律不进词表 ——
    // "Machine Cinema" / "Paramount Machine Tour" / "Deep Chats" / "Sunday Brunch" 是纯噪音，
    // 被筛掉是对的。宁可少收，不要污染。
    const re = AI_EVENT_RE;
    const out = [];
    for (const ev of byId.values()) {
      const name = ev.name || '';
      const cal = ev.calendar?.name || '';
      const addressText = [ev.geo_address_info?.city, ev.geo_address_info?.country, ev.geo_address_info?.address]
        .filter(Boolean).join(' ');
      // calendar 名照旧参与匹配（现在为空，但源一旦补上就能自动生效）
      const hay = `${name} ${cal} ${addressText}`;
      if (!re.test(hay)) continue;
      const start = String(ev.start_at || '').slice(0, 10);
      const geo = ev.geo_address_info || {};
      const cityFallback = ev.__geoCity ? EV_LUMA_CITY_BY_SLUG.get(ev.__geoCity) : null;
      const row = {
        id: `luma-${ev.api_id}`, title: name, url: `https://lu.ma/${ev.url}`,
        dates: start, start, end: String(ev.end_at || '').slice(0, 10),
        // 城市 + 国家都留着：eventRegion 要按国家判，只存城市名会让东京/首尔的场次落 other
        location: ev.location_type === 'online'
          ? '线上'
          : [geo.city || geo.region, geo.country].filter(Boolean).join(', ') || '线下',
        org: ev.calendar?.name || 'Luma', prize: null, regs: ev.guest_count || 0,
        themes: [], source: 'Luma',
        // region 的两个权威来源，按可信度排：country_code 直接来自源，最准；
        // 城市兜底只在「源没给国家」时用，且必须明确标出来，方便事后核查。
        countryCode: geo.country_code || null,
        geoCityFallback: (!geo.country_code && cityFallback) ? cityFallback.region : null,
      };
      // 发现流条目**不含 description/summary 字段**（2026-10-24 实测：event 对象里
      // 没有 description、description_mirror，/event/get 详情接口对发现流的 api_id 返回 400）。
      // 所以没有正文可截，summary 置 null，前端遇到 null 就不渲染那一行，别造假数据。
      row.summary = null;
      row.status = eventStatus(row);   // 按日期判
      out.push(row);
    }
    console.log(`[collect] luma 无geo ${LUMA_QUERIES.length} 词 → ${noGeoCount} 条 · 加 geo ${LUMA_CITIES.length} 城 → 去重 ${byId.size} 条 → AI 过滤后 ${out.length} 条${failedQueries ? `（${failedQueries} 个查询无结果）` : ''}`);
    return out;
  } catch (e) {
    console.error(`[collect] luma 失败：${e.message}`);
    return [];
  }
}

/* ══════════════════════ Devfolio（第 4 个活动源） ══════════════════════
 * 公开 API，无认证、无 key、无 Cookie：
 *   https://api.devfolio.co/api/hackathons?page=N&limit=50
 * 返回 { result: [...], count: 2038, pages: 41 }，第 42 页起为空（实测 2026-10-24）。
 *
 * 取舍：这个源历史 2038 条，但**未截止的只有 35 条，其中 AI 相关 9 条**。
 * 量小，但它是唯一一个给出「完整字段 + 真实奖池金额 + 报名人数」的黑客松源，
 * 而且这 9 条在 Devpost / Luma 上都没有 —— 所以作为**补充源**收下，不追求量。
 *
 * 注意 themes 是**对象数组** `[{uuid,name,verified}]`，直接 join 会得到 "[object Object]"，
 * 必须从 t.name 取（实测踩过）。
 *
 * 过滤：**绝不能放宽**。这个源的主体是通用黑客松（No Restrictions 主题占绝大多数），
 * 不做 AI 过滤会往站里灌几百条无关活动，比少收 9 条糟得多。宁可少收。
 * ═══════════════════════════════════════════════════════════════════════ */
const DV_API = 'https://api.devfolio.co/api/hackathons';
const DV_MAX_PAGES = TEST_PROFILE ? 2 : 45;      // 实测 41 页到底，留 4 页余量防源端多一页时漏
const DV_LIMIT = 50;

async function devfolioPage(page, attempt = 0) {
  const url = `${DV_API}?page=${page}&limit=${DV_LIMIT}`;
  try {
    netStat.requests += 1;
    return await httpJson(url, { label: `devfolio/p${page}` });
  } catch (e) {
    if (attempt < 2) {
      await sleep(400 * (attempt + 1));
      return devfolioPage(page, attempt + 1);
    }
    throw e;
  }
}

/* 活动 AI 相关性词表：Luma 与 Devfolio 共用同一份，避免两个源口径漂移。
 * 词表的取舍说明见下方 fetchLuma 内的原始注释（哪些泛词被刻意排除）。 */
export const AI_EVENT_RE = new RegExp([
    // 通用 AI 词
    '\\bAI\\b', '\\bA\\.I\\.', '\\bLLMs?\\b', '\\bGPT-?\\d?', '\\bChatGPT\\b', '\\bClaude\\b',
    '\\bGemini\\b', '\\bCopilot\\b', '\\bLlama\\b', '\\bLLaMA\\b', '\\bMistral\\b', '\\bGemma\\b',
    '\\bSora\\b', '\\bQwen\\b', '\\bKimi\\b', '\\bDeepSeek\\b', '\\bMidjourney\\b', '\\bRunway\\b',
    // 厂商 / 平台
    '\\bOpenAI\\b', '\\bAnthropic\\b', '\\bDeepMind\\b', 'Hugging ?Face', '\\bCohere\\b',
    '\\bPerplexity\\b', '\\bStability AI\\b', '\\bNvidia\\b', '\\bNVIDIA\\b',
    // 中文
    '模型', '人工智能', '机器学习', '大模型', '智能体', '通义', '豆包', '文心', '生成式',
    // 英文 ML 语义
    'machine learning', 'deep learning', 'neural\\s?(?:net|network)', 'generative',
    'stable diffusion', '\\bdiffusion\\b', '\\bRAG\\b', '\\bagentic\\b', '\\bAI agents?\\b',
    '\\binference\\b', '\\bfine-?tun', '\\bprompt(?:ing|s)?\\b', '\\bvector (?:db|database)\\b',
    '\\bembeddings?\\b', '\\bLLM\\b', '\\btransformer model',
    // 活动形态（AI 场次常用的命名）
    'hackathon', '黑客松', 'ハッカソン', 'ハック', '\\bdevday\\b', '\\bdev ?day\\b', '\\bdevfest\\b',
    '\\bhacksprint\\b', '\\bhack ?sprint\\b', '\\bbuild night\\b', '\\bvibe cod',
    // 注意：单独的 eval / showcase / agents 太宽（"Showcase" 是什么展都会用的词），
    // 只在跟 AI 词同现时才有意义，所以这里都收窄成组合形态
    '\\bmodel eval', '\\bAI showcase',
    // 多语言 AI 词根（日/意/西/德/法）
    '生成AI', 'AI 活用', 'intelligen\\w*', 'artificiali', 'inteligencia', '\\bIA\\b', '\\bKI\\b',
    'künstliche', '\\bIA génér', '\\bML\\b',
  ].join('|'), 'i');

/* Devfolio 的 AI 相关判定。两路任一命中即算：
 *   1) themes 里明确列了 AI / 数据 / 机器学习主题
 *   2) name / tagline / desc 命中 **Devfolio 专用**的 AI 词表（见下）
 *
 * 为什么不能直接复用 AI_EVENT_RE（踩过）：
 * 那份词表里含 'hackathon' / '黑客松' / 'devfest' 这类「活动形态词」——
 * 对 Luma 是对的（那些查询本身就是 query=AI 调的，活动形态词只是收窄用），
 * 但 Devfolio 里 95% 的活动名字里就带 Hackathon，一命中就全收进来。
 * 实测直接复用 → 35 条未截止几乎全过（25 条），全是印度高校通用黑客松，站内被污染。
 * 所以这里只认**语义上的 AI 词**，不认活动形态词。
 *
 * 刻意**不接受** "No Restrictions" —— 那是「不限主题」，不代表跟 AI 有关。
 * 实测这就是 35 条里只剩 9 条的关键。 */
const DV_AI_THEME = /\bAI\b|\bA\.?I\.?\b|machine ?learning|deep ?learning|\bML\b|\bLLM|data ?science|neural|generative|computer vision|\bNLP\b/i;

// Devfolio 专用的 AI 语义词表：只有真正的 AI 词，没有任何活动形态词
const DV_AI_RE = new RegExp([
  '\\bAI\\b', '\\bA\\.I\\.', '\\bLLMs?\\b', '\\bGPT-?\\d?', '\\bChatGPT\\b', '\\bClaude\\b',
  '\\bGemini\\b', '\\bCopilot\\b', '\\bLlama\\b', '\\bMistral\\b', '\\bGemma\\b', '\\bQwen\\b',
  '\\bDeepSeek\\b', '\\bMidjourney\\b', '\\bOpenAI\\b', '\\bAnthropic\\b', '\\bDeepMind\\b',
  'Hugging ?Face', '\\bCohere\\b', '\\bPerplexity\\b', '\\bStability AI\\b',
  'machine learning', 'deep learning', 'neural\\s?(?:net|network)', '\\bgenerative ai\\b',
  'stable diffusion', '\\bdiffusion model', '\\bRAG\\b', '\\bagentic\\b',
  '\\bcomputer vision\\b', '\\bNLP\\b', '\\bML\\b', '\\bGenAI\\b',
  '人工智能', '机器学习', '大模型', '智能体', '深度学习',
].join('|'), 'i');

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
    .map((p) => ({ amount: Number(p?.amount), currency: (p?.currency || '').toUpperCase() || null }))
    .filter((p) => Number.isFinite(p.amount) && p.amount > 0);
  if (!rows.length) return null;
  const byCur = {};
  for (const r of rows) { const k = r.currency || '?'; byCur[k] = (byCur[k] || 0) + r.amount; }
  const [cur, sum] = Object.entries(byCur).sort((a, b) => b[1] - a[1])[0];
  const symbol = { USD: '$', INR: '₹', EUR: '€', GBP: '£' }[cur] || '';
  const n = Math.round(sum).toLocaleString('en-US');
  const others = Object.keys(byCur).length - 1;
  return `${symbol}${n}${cur && cur !== '?' && !symbol ? ` ${cur}` : ''}${others > 0 ? ` 等 ${others + 1} 种币种` : ''}`;
}

async function fetchDevfolio() {
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
    if (!list.length) break;                       // 实测第 42 页到底
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
      location: h.is_online ? '线上' : (h.location || cityCountry || '线下'),
      org: h.hackathon_brand?.name || '',
      prize: devfolioPrize(h.prizes),
      regs: Number(h.participants_count || 0),
      themes: (h.themes || []).map((t) => (typeof t === 'string' ? t : t?.name)).filter(Boolean),
      source: 'Devfolio',
      // country 是英文国名（"India" / "Germany"），交给 eventRegion 的国名正则；
      // 这里不塞两位码 —— Devfolio 给的是国名不是 ISO 码，硬凑容易错。
      countryName: h.country || null,
    };
    const tag = String(h.tagline || '').replace(/\s+/g, ' ').trim();
    row.summary = tag ? tag.slice(0, 280) : null;
    row.status = eventStatus(row);
    return row;
  });

  console.log(`[collect] devfolio ${all.length} 条历史（共 ${total ?? '?'}）→ 未截止 ${live.length} → AI 相关 ${rows.length}`);
  return rows;
}

/* ══════════════════ 已实测排除的活动源（别再试了） ══════════════════
 * 这些都是 2026-10-24 实际跑过、有明确失败原因的，写在这里免得后来人重复踩：
 *
 * - Eventbrite：结构其实最好（列表页内嵌 jsonld ItemList，每页 20 个完整 Event 对象，
 *   日期/地点/票价全齐），但 **429 限速极严，且是长效封禁**：连续请求后退避 20 秒仍 429。
 *   不适合每日自动采集。若将来要用，必须降到极低频（单城市单次）并接受随时被挡。
 * - 活动行 huodongxing：列表页有真实中文 AI 活动（实测「大模型安全与备案政策宣讲会」），
 *   但**列表页不含日期字段**，日期只在详情页 —— 要 N 条就 N 次详情请求，成本高且易被封。
 *   TODO：若要做，先找是否有带日期的接口，否则不做。
 * - OpenAI 官网活动页：403（Cloudflare 拦截无头请求）。
 * - Kaggle /api/v1/competitions/list：401，需要账号认证 —— 与项目「不注册账号」的边界冲突。
 * - MLH：302 重定向到一个已失效的页面。
 * - dev.events：有干净的 iCal，但实测 AI 相关度只有 2/30，价值太低不值得占一层。
 * - mlcontests.com：RSS 里只有 1 条博客，根本不是活动清单。
 * - HuggingFace /api/events：401。
 * - meetup.com GraphQL：`keywordSearch` 字段已不存在（schema 变更），旧查询直接报错。
 * ═══════════════════════════════════════════════════════════════════ */


/* 活动类型与地区：从标题 / 主题 / 场地推断，前端用来做细分筛选 */
/* 活动状态：只由日期决定，不由数据源决定。
 * 以前 Devpost 一律硬编码 status:'open'，导致 25 个已经过了截止日的活动还挂在「开放中」，
 * 用户点进去发现早结束了——数字看着对、语义是错的，最伤信任。
 * 规则（按优先级）：
 *   past     —— end 已过（没有 end 就用 start）
 *   upcoming —— start 在未来
 *   open     —— 正在进行中
 *   unknown  —— 两个日期都没有，无法判断，宁可标未知也不假装开放 */
export function eventStatus(e, today = todayISO()) {
  const start = e.start || '';
  const end = e.end || '';
  const last = end || start;
  if (last && last < today) return 'past';
  if (!start && !end) return 'unknown';
  if (start && start > today) return 'upcoming';
  return 'open';
}

/* 活动类型：从标题 / 主题 / 场地 / 主办推断。
 * 规则按「越具体越先判」排，先命中先归类；都不命中才落 other（兜底，不追求 0）。
 *
 * 实测复盘（2026-10-24，620 条）：旧逻辑把 126 个 Devpost 活动打成 other，占 20%，
 * 原因是 Devpost 的活动名不用 hackathon 这个字，而是 Hacks / HackSprint / -Thon /
 * Datathon / Databowl / Design Jam…，主题里又写着 "Machine Learning/AI"。
 * 这里补上这些真实写法（都是线上数据里实际出现过的后缀，不是猜的）。 */
export function eventKind(e) {
  const b = `${e.title || ''} ${(e.themes || []).join(' ')} ${e.dates || ''} ${e.org || ''} ${e.kindHint || ''}`;

  // 竞赛 / 黑客松：hack day、hackweek、-thon、datathon、data bowl、jam、挑战赛都算
  // 注意 "-thon" 要写成带连字符或词尾，否则会误吃 marathon/marathon-like 的词
  if (/hackathon|hack ?day|hackweek|hack ?week|hacks?\b|hacksprint|hack ?sprint|黑客松|challenge|datathon|data ?bowl|\bjam\b|competition|contest|竞赛|大赛|挑战赛|kaggle|sprint|\bthon\b|-thon\b|\bchip\b hack/i.test(b)) return 'hackathon';
  // 大展会 / 峰会 / 大会
  if (/summit|conference|convention|symposium|大会|峰会|论坛|forum|expo|展会|博览|world congress|tech week|conference week|con\b/i.test(b)) return 'conference';
  // 奖项 / 评选
  if (/award|prize|评选|颁奖|film festival/i.test(b)) return 'award';
  // 工作坊 / 课程 / 训练营
  if (/workshop|工作坊|training|tutorial|bootcamp|训练营|课程|讲座|seminar|masterclass|course|lesson|lab session|study group|paper club|reading group|class\b/i.test(b)) return 'workshop';
  // 演示日 / 路演 / 展会型
  if (/demo ?day|roadshow|路演|showcase|pitch ?day|pitch night|launch day|exhibition|开放日|open day|design jam/i.test(b)) return 'demo';
  // 聚会 / 社区场 / networking
  if (/meetup|聚会|community|salon|drinks|networking|night|party|talk|session|panel|roundtable|dinner|coffee|brunch|happy hour|gathering|沙龙|圆桌/i.test(b)) return 'meetup';
  // Luma 以社区活动为主，没命中关键词的按 meetup 归
  if (e.source === 'Luma') return 'meetup';
  // Devpost 上的活动几乎都是提交型开发活动：有提交期、有奖池、有报名数，
  // 名字起得再随意（"Build With AI: Basics" / "Life After Code"）也仍然是 hackathon 性质。
  // 这个兜底只对 Devpost 生效，别的源不乱套。
  if (e.source === 'Devpost') return 'hackathon';
  /* Devfolio 同理：它的 API 里 type 字段固定是 'HACKATHON'，整个站就是黑客松平台。
   * 但名字常常不带 hackathon（"Unbuilt" / "AgentVerse" / "Cognition 2026"），
   * 主题又常是 "No Restrictions"，上面几条规则都命中不了 —— 实测 13 条里 7 条落 other。
   * 那是**源性质**决定的，不是推断失灵，所以给它跟 Devpost 同样的兜底。 */
  if (e.source === 'Devfolio') return 'hackathon';
  return 'other';
}

/* 地区：location + org + 标题联合判断。
 * 旧实现只看 location，而 Luma 的 location 之前只存了城市名（不带国家），
 * Devpost 常常只给学校名（"University of Florida"），结果大量真实地区被吞成 other。
 *
 * 实测复盘（2026-10-24）：other 140 条里 80 条是 Devpost 的**校园/场馆名**，
 * 名字里没有国家但校名本身就说明国家（McMaster=加拿大、NC State=美国）。
 * 所以这里除了城市/国家，还认大学与州的缩写 —— 都是线上数据里实际出现过的。
 * 仍然保留 other 兜底：Luma 有 44 条 geo 完全空着（location 只有「线下」），
 * 那是源缺数据，不猜。 */
const EV_REGION_RULES = [
  // 中文区（含港澳台）
  ['cn', /中国|上海|北京|深圳|杭州|广州|成都|南京|武汉|西安|苏州|厦门|重庆|天津|香港|澳门|台北|台灣|台湾|\bChina\b|Shanghai|Beijing|Shenzhen|Hangzhou|Guangzhou|Chengdu|Nanjing|\bWuhan\b|\bXiamen\b|Suzhou|Chongqing|Tianjin|Hong ?Kong|Macau|Macao|Taipei|Taiwan/i],
  ['jp', /日本|东京|東京|大阪|京都|名古屋|福冈|札幌|横滨|\bJapan\b|Tokyo|Shibuya|Chiyoda|Minato|Meguro|Osaka|Kyoto|Nagoya|Fukuoka|Sapporo|Yokohama/i],
  ['kr', /韩国|韓國|首尔|首爾|서울|부산|Seoul|Korea|Busan/i],
  ['sg', /新加坡|Singapore|Singapur/i],
  ['in', /印度|班加罗尔|孟买|新德里|海得拉巴|浦那|金奈|科钦|\bIndia\b|Bangalore|Bengaluru|Mumbai|New Delhi|Delhi|Hyderabad|Pune|Chennai|Kochi|Coimbatore|Tamil ?Nadu|ISLAMABAD|Pakistan/i],
  ['ae', /迪拜|杜拜|阿布扎比|阿聯酋|阿联酋|\bDubai\b|Abu Dhabi|\bUAE\b|United Arab Emirates/i],
  ['uk', /英国|英國|伦敦|倫敦|曼彻斯特|爱丁堡|牛津|剑桥|\bUK\b|\bU\.K\.|United Kingdom|England|London|Manchester|Edinburgh|Cambridge|Oxford|Bristol|Glasgow/i],
  // 欧洲（含实测出现的小国：匈牙利/罗马尼亚/保加利亚/卢森堡/土耳其）
  ['eu', /欧洲|歐盟|德国|法国|荷兰|西班牙|意大利|葡萄牙|瑞典|芬兰|丹麦|挪威|瑞士|波兰|捷克|奥地利|比利时|爱尔兰|匈牙利|罗马尼亚|保加利亚|卢森堡|土耳其|柏林|巴黎|阿姆斯特丹|慕尼黑|巴塞罗那|米兰|斯德哥尔摩|赫尔辛基|苏黎世|维也纳|布达佩斯|布加勒斯特|索菲亚|Europe|Germany|Berlin|Munich|France|Paris|Netherlands|Amsterdam|Spain|Barcelona|Madrid|Italy|Milan|Portugal|Lisbon|Sweden|Stockholm|Finland|Helsinki|Turku|Denmark|Copenhagen|Norway|Oslo|Switzerland|Zurich|Poland|Warsaw|Czech|Prague|Austria|Vienna|Belgium|Brussels|Ireland|Dublin|Hungary|Budapest|Romania|Bucure[sș]ti|Bulgaria|Sofia|Luxembourg|T[uü]rkiye|Turkey|Istanbul|Volkshochschule/i],
  ['ca', /加拿大|多伦多|溫哥華|温哥华|蒙特利尔|渥太华|滑铁卢|卡尔加里|温莎|\bCanada\b|Toronto|Vancouver|Montreal|Ottawa|Waterloo|Calgary|Windsor|Manitoba|McMaster|Sheridan|Hazel McCallion|Bayview Yards/i],
  ['au', /澳大利亚|澳洲|悉尼|墨爾本|墨尔本|布里斯班|珀斯|\bAustralia\b|Sydney|Melbourne|Brisbane|Perth|Wellington|New Zealand|Auckland/i],
  // 美国：城市 + 州名/缩写 + 实测出现的高校与园区
  ['us', /美国|美國|纽约|紐約|旧金山|舊金山|西雅图|西雅圖|硅谷|洛杉矶|芝加哥|奥斯汀|波士顿|圣地亚哥|华盛顿|迈阿密|丹佛|亚特兰大|匹兹堡|费城|休斯顿|达拉斯|凤凰城|波特兰|纳什维尔|夏洛特|底特律|辛辛那提|坦帕|奥兰多|拉斯维加斯|罗利|安娜堡|盖恩斯维尔|沃斯堡|明尼阿波利斯|圣路易斯|堪萨斯城|盐湖城|圣安东尼奥|哥伦布|印第安纳波利斯|密尔沃基|布法罗|罗切斯特|纽黑文|纽瓦克|泽西城|长滩|奥克兰|萨克拉门托|弗雷斯诺|图森|阿尔伯克基|俄克拉荷马城|塔尔萨|孟菲斯|新奥尔良|伯明翰|杰克逊维尔|塔拉哈西|诺克斯维尔|路易斯维尔|列克星敦|代顿|托莱多|阿克伦|兰辛|麦迪逊|林肯|奥马哈|得梅因|普罗维登斯|哈特福德|波特兰缅因|\bUS\b|\bUSA\b|United States|New York|San Francisco|San Jose|Seattle|Silicon Valley|Los Angeles|Chicago|Austin|Boston|San Diego|Washington|Miami|Denver|Atlanta|Pittsburgh|Philadelphia|Houston|Dallas|Phoenix|Portland|Nashville|Charlotte|Detroit|Cincinnati|Tampa|Orlando|Las Vegas|Raleigh|Ann Arbor|Gainesville|Fort Worth|Arlington|Plano|Irving|Frisco|Minneapolis|St\.? Louis|Kansas City|Salt Lake|San Antonio|Columbus|Indianapolis|Milwaukee|Buffalo|Rochester|New Haven|Newark|Jersey City|Long Beach|Oakland|Sacramento|Fresno|Tucson|Albuquerque|Oklahoma City|Tulsa|Memphis|New Orleans|Birmingham|Jacksonville|Tallahassee|Knoxville|Louisville|Lexington|Dayton|Toledo|Akron|Lansing|Madison|Lincoln|Omaha|Des Moines|Providence|Hartford|Stanford|Berkeley|Cal Hacks|MIT|Harvard|CMU|Cornell|Princeton|Yale|Columbia University|NYU|UCLA|UC Berkeley|UC Riverside|UC San Diego|University of California|UCF|UGA|UNC|NC State|Penn State|Pennovation|Purdue|Georgia Tech|Michigan State|Central Michigan|MSU|Ohio State|Rutgers|Columbia|Northwestern|Illinois|Texas A&M|Texas A＆M|A&M|UT Dallas|UT Austin|University of Florida|Florida State|Virginia Tech|West Virginia|WPI|RPI|SJSU|San Jose State|Cal Poly|Arizona State|ASU|Embry-Riddle|Kent State|Binghamton|Towson|Lehman|GSU|Georgia State|Baylor|Rice University|Duke|Vanderbilt|Clemson|Auburn|Alabama|Oklahoma|Kansas|Nebraska|Iowa|Minnesota|Wisconsin|Indiana|Missouri|Tennessee|Kentucky|Arkansas|Mississippi|Louisiana|Colorado|Utah|Nevada|Oregon|Idaho|Montana|Wyoming|Alaska|Hawaii|\bNYC\b|New York City/i],
  ['latam', /巴西|墨西哥|阿根廷|智利|哥伦比亚|秘鲁|巴拉圭|乌拉圭|Brazil|Brasil|S[aã]o Paulo|Rio|Mexico|M[eé]xico|\bCDMX\b|Guadalajara|Argentina|Buenos Aires|Chile|Santiago|Colombia|Bogot[aá]|Peru|Lima|Paraguay|Asunci[oó]n|Uruguay|Montevideo/i],
  ['africa', /非洲|尼日利亚|肯尼亚|南非|埃及|乌干达|加纳|摩洛哥|突尼斯|坦桑尼亚|Africa|Nigeria|Lagos|Kenya|Nairobi|South Africa|Cape Town|Johannesburg|Egypt|Cairo|Uganda|Kampala|Ghana|Accra|Morocco|Tunisia|Tunis|Tanzania/i],
  ['middle-east', /中东|中東|沙特|卡塔尔|以色列|约旦|黎巴嫩|\bIsrael\b|Tel Aviv|Jerusalem|Saudi|Riyadh|Qatar|Doha|Jordan|Amman|Lebanon|Beirut/i],
  // 东南亚/南亚剩余国家
  ['asia', /菲律宾|印度尼西亚|印尼|越南|泰国|马来西亚|斯里兰卡|尼泊尔|孟加拉|柬埔寨|缅甸|亚美尼亚|Philippines|Manila|Indonesia|Jakarta|Vietnam|Hanoi|Ho Chi Minh|Thailand|Bangkok|Malaysia|Kuala Lumpur|Sri Lanka|Colombo|Nepal|Kathmandu|Bangladesh|Dhaka|Cambodia|Myanmar|Armenia|Yerevan/i],
];

export function eventRegion(e) {
  const loc = String(e.location || '');
  // 线上优先：但是「线上 + 线下」混合场次（Luma 常见）按线下判，因为地点更有信息量
  const onlineOnly = /^(线上|online|remote|virtual|anywhere)$/i.test(loc.trim());
  if (onlineOnly) return 'online';

  /* 判定顺序（越靠前越权威）：
   *   1. 源的 country_code —— 直接来自数据源的国家码，不靠猜
   *   2. 城市 geo 兜底 —— 只有源没给国家时才用（本次是从该城市坐标问出来的）
   *   3. location / org / 标题字符串正则 —— 老办法，作为兜底
   *   4. other
   * 线上场次已经在上面早返回，不会被国家码覆盖成线下地区。
   * 注意「线上」+ 有国家码的混合场次：先判线上只认纯线上，混合场次继续往下走国家码，这是对的。 */
  const byCountry = regionFromCountryCode(e.countryCode);
  if (byCountry) return byCountry;

  if (e.geoCityFallback) return e.geoCityFallback;

  // Devfolio 给的是英文国名（"India" / "Germany"），不是 ISO 两位码，
  // 单独走一次国名正则，比把国名塞进 loc 再靠城市名命中更靠谱
  if (e.countryName) {
    const byName = EV_COUNTRY_NAME_RULES.find(([, re]) => re.test(e.countryName));
    if (byName) return byName[0];
  }

  const hay = `${loc} ${e.org || ''} ${e.title || ''}`;
  for (const [code, re] of EV_REGION_RULES) {
    if (re.test(hay)) return code;
  }
  // 没有可识别地区，但源明确说是线上 → online；否则 other
  if (/线上|online|remote|virtual|anywhere/i.test(loc)) return 'online';
  return 'other';
}

/* 地区归并：值太碎就没法当筛选维度用。
 * 实测问题（2026-10-24）：`ae`（阿联酋）只有 1 条、`kr`（韩国）2 条，
 * 前端按实际数据生成筛选按钮时会列出一堆点开只有 1 条的空按钮。
 * 原则：**国家**值条数 < EV_REGION_MIN 就并入所属大区，原始值留在 regionRaw 里备查。
 * 大区值（asia / eu / latam / middle-east / africa / online / other）不参与归并。
 * 阈值不写死在别处：条数变化时自动生效，不需要再改代码。 */
const EV_REGION_MIN = 5;
// 小国家值并到哪个大区（先查这张表，查不到就按 fallback 再查，最后落 other）
const EV_REGION_FOLD = { ae: 'middle-east', kr: 'asia' };
const EV_REGION_FOLD_FALLBACK = {
  ae: 'middle-east', kr: 'asia', sg: 'asia', jp: 'asia', cn: 'asia', in: 'asia',
  uk: 'eu', ca: 'latam', au: 'asia', africa: 'africa',
};
const EV_REGION_REGIONS = new Set(['online', 'other', 'asia', 'eu', 'latam', 'middle-east', 'africa']);

export function foldRegions(events) {
  const count = events.reduce((a, e) => { a[e.region] = (a[e.region] || 0) + 1; return a; }, {});
  const fold = { ...EV_REGION_FOLD };
  for (const [code, n] of Object.entries(count)) {
    if (EV_REGION_REGIONS.has(code)) continue;             // 大区本身不动
    if (n >= EV_REGION_MIN) continue;                       // 够量就保留独立值
    if (fold[code] == null) fold[code] = EV_REGION_FOLD_FALLBACK[code] || 'other';
  }
  const applied = Object.entries(fold).filter(([from]) => count[from] != null && count[from] < EV_REGION_MIN);
  if (applied.length) {
    console.log(`[collect] region 归并（<${EV_REGION_MIN} 条并入大区）：${applied.map(([k, v]) => `${k}(${count[k]})→${v}`).join(' · ')}`);
  }
  return events.map((e) => (fold[e.region] ? { ...e, region: fold[e.region], regionRaw: e.region } : e));
}

/* Aibijia 公开数据：第三方挂单（带真实商品链接）+ App Store 各国订阅价 */
const AIBIJIA_PRODUCTS = 'https://data.aibijia.org/products.json';
const AIBIJIA_APPLE = 'https://data.aibijia.org/apple_subscriptions.json';

async function fetchAibijia() {
  const get = async (u) => {
    try {
      const r = await httpGet(u, { label: 'aibijia' });
      if (!r.ok) {
        console.error(`[collect] aibijia ${u} → HTTP ${r.status}`);
        return null;
      }
      return await r.json();
    } catch (e) {
      console.error(`[collect] aibijia ${u} 失败：${e.message}`);
      return null;
    }
  };
  const [prod, apple] = await Promise.all([get(AIBIJIA_PRODUCTS), get(AIBIJIA_APPLE)]);
  // 两个源都挂 = 这一层真的没了；只挂一个仍然算有值（订阅和挂单可以分别降级）
  return { prod, apple, valid: !!(prod || apple) };
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

/* 官方订阅档位：从苹果区价里取美国区价格，一档一行。
 * 这是「官网写多少就是多少」里唯一能自动化且可复核的口径——App Store 商品页是公开明码。
 * 拿不到美国区价格的档位直接跳过，不猜价、不用历史值填。 */
const SUB_VENDOR = { chatgpt: 'OpenAI', claude: 'Anthropic', gemini: 'Google', grok: 'xAI' };
const SUB_NOTE = {
  chatgpt: 'App Store 美国区内购价；网页版可能另有年付折扣',
  claude: 'App Store 美国区内购价；官网另有年付 17% 折扣',
  gemini: 'Google One AI 套餐，经 App Store 美国区购买',
  grok: 'X Premium+ 内的 Grok 档位，美国区定价',
};

function buildSubs(apple) {
  if (!apple) return [];
  const out = [];
  for (const app of apple.apps || []) {
    const vendor = SUB_VENDOR[app.slug] || '';
    for (const plan of app.plans || []) {
      const us = (plan.regions || []).find((r) => r.country_code === 'US');
      if (!us || !(Number(us.price_value) > 0)) continue;   // 没有美国区明码就不进这一层
      const tier = String(plan.label || plan.slug || '')
        .replace(new RegExp(`^${app.display_name}\\s*`, 'i'), '')
        .trim() || plan.label;
      out.push({
        id: `${app.slug}-${plan.slug}`,
        product: app.display_name,
        productSlug: app.slug,
        vendor,
        tier,
        price: Number(us.price_value),
        currency: us.currency_code || 'USD',
        period: plan.duration_label || '1月',
        buy: us.app_store_url || '',
        quota: '',
        note: SUB_NOTE[app.slug] || '',
        source: 'apple',
        checked: (us.fetched_at || '').slice(0, 10) || null,
      });
    }
  }
  return out.sort((a, b) => a.product.localeCompare(b.product) || a.price - b.price);
}

/* ────────────────────────── 情报层（news） ──────────────────────────
 * 唯一原则：**跨度换信息量时，只能加不能减。**
 *
 * 旧实现每天只留 20 条高分条目，其余直接销毁——结果是跑了 70 天也只有 4 天跨度
 * （源站 news-frontline.yaml 本身只吐最近约 50 条，跨不出 4 天）。
 *
 * 现在三层都入归档（同一套 schema、URL 唯一键）：
 *   1. news-frontline.yaml      —— 官方精选，每天约 50 条，带摘要
 *   2. aihot.news /api/v1/items —— 全量流，window 只开放 24h/7d，7 天内约 1900 条
 *   3. news-seed.json           —— 从存档补回的早期条目（date 来自页面内嵌 JSON-LD）
 *
 * 落盘前压缩：短键 + 只留标题里没有的摘要 + 每天门面永不被预算删除。
 */
const NEWS_FEED = 'https://data.aibijia.org/news-frontline.yaml';
const AIHOT_ITEMS = 'https://aihot.news/api/v1/items';
const ARCHIVE = outUrl('news-archive.json');
const SEED = new URL('./news-seed.json', import.meta.url);

/* 全量流的分类映射：AIHOT 自己的 category → 本站主题 */
const AIHOT_CATEGORY = {
  'ai-models': 'model',
  'ai-products': 'product',
  industry: 'funding',
  paper: 'research',
  tip: 'other',
};

function toRow(x) {
  return { date: x.date, time: x.time, title: x.title, summary: x.summary, url: x.url };
}

/** 官方精选：每天约 50 条，摘要最全，优先用它 */
async function fetchFrontline(log) {
  try {
    const res = await httpText(NEWS_FEED, { label: 'news/frontline' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = parseNewsYaml(res.text);
    log?.(`frontline ${rows.length} 条`);
    return rows;
  } catch (e) {
    console.error(`[collect] news 精选源失败：${e.message}`);
    return [];
  }
}

/**
 * 全量流：window 只接受 24h / 7d，游标翻页。
 * mode=all 才给全部；selected 只给人工精选的 50 条。
 * 分类之间不重叠，所以要逐个分类翻，不然会漏掉一大半。
 */
async function fetchAihotBulk(log) {
  const cats = [null, 'ai-models', 'ai-products', 'industry', 'paper', 'tip'];
  const seen = new Map();
  let requests = 0;

  // 测试档位只翻主分类的第 1 页，够覆盖解析与去重，又不拉整个 7 天窗口
  const catsToFetch = TEST_PROFILE ? [null] : cats;
  const maxPages = TEST_PROFILE ? 1 : 40;
  for (const cat of catsToFetch) {
    let cursor = null;
    for (let page = 0; page < maxPages; page += 1) {
      const url = new URL(AIHOT_ITEMS);
      url.searchParams.set('window', '7d');
      url.searchParams.set('mode', 'all');
      if (cat) url.searchParams.set('category', cat);
      if (cursor) url.searchParams.set('cursor', cursor);
      let d;
      try {
        const res = await httpGet(url, { label: `news/aihot${cat ? `/${cat}` : ''}` });
        requests += 1;
        if (!res.ok) break;
        d = await res.json();
      } catch { break; }
      for (const it of d.items || []) {
        if (!it.id || !it.title) continue;
        const pub = it.publishedAt || it.discoveredAt || '';
        seen.set(it.id, {
          date: pub.slice(0, 10),
          time: pub.slice(11, 16),
          title: it.title,
          summary: it.summary || '',
          url: it.link || `https://aihot.news/items/${it.id}`,
          cat: it.category || null,
        });
      }
      if (!d.page?.hasMore || !d.page.nextCursor) break;
      cursor = d.page.nextCursor;
      await sleep(250);
    }
    await sleep(250);
  }
  log?.(`aihot 全量 ${seen.size} 条 / ${requests} 次请求`);
  return [...seen.values()];
}

/** 存档补回的早期条目（可选文件，CI 里没有也不该失败） */
async function readSeed() {
  try {
    const raw = JSON.parse(await readFile(SEED, 'utf8'));
    return Array.isArray(raw) ? raw : raw.items || [];
  } catch { return []; }
}

async function fetchNews(log) {
  const [frontline, bulk, seed] = await Promise.all([fetchFrontline(log), fetchAihotBulk(log), readSeed()]);

  // 精选优先，所以后面合并时它的摘要不会被短版覆盖
  const fresh = [
    ...frontline.map(toRow),
    ...bulk.map((x) => ({
      ...toRow(x),
      // 全量流的摘要要靠标题去重，分类用源站自己的标签兜底
      topic: AIHOT_CATEGORY[x.cat] || undefined,
    })),
    ...seed.map(toRow),
  ];

  let archive = [];
  try {
    const raw = JSON.parse(await readFile(ARCHIVE, 'utf8'));
    archive = Array.isArray(raw) ? raw : raw.items || [];
  } catch { /* 首次 */ }

  const before = archive.length;
  const merged = mergeArchive(archive, fresh, { today: todayISO() });
  const stats = archiveStats(merged);

  try { await writeFile(ARCHIVE, JSON.stringify(merged), 'utf8'); } catch { /* 只读环境 */ }
  console.log(`[collect] news 归档 ${before} → ${merged.length} 条，跨度 ${stats.spanDays} 天 / ${stats.days} 个有新闻的日子，${(stats.bytes / 1024).toFixed(0)}KB`);

  return merged;
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
  const file = aiosFile();
  if (!file) return [];   // 可选层，没有就是没有，交给 aiosFile() 的 warn 说明
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'));
    const rows = Array.isArray(raw) ? raw : raw.data || [];
    return rows.map((o) => {
      const row = {
        id: o.id, title: o.title, url: o.canonicalUrl || o.sourceUrl, dates: (o.startsAt || '').slice(0, 10),
        start: (o.startsAt || '').slice(0, 10), end: (o.endsAt || '').slice(0, 10),
        location: o.mode === 'online' ? '线上' : (o.city || '线下'),
        org: o.organizerName || '', prize: o.priceLabel || null, regs: 0,
        themes: o.topics || [], source: 'AIOS',
        worth: o.worthScore ?? null,
        // AIOS 自带一句话摘要（其余两源都没有），直接用；detail 给前端做更长的说明
        summary: (o.summary || o.recommendationReason || '').slice(0, 280) || null,
        detail: (o.recommendationReason || '').slice(0, 280) || null,
        // type 字段是 AIOS 自己的分类（event / program / …），交给 eventKind 参考
        kindHint: o.type || null,
      };
      row.status = eventStatus(row);   // AIOS 是本地历史库，绝大多数会正确翻成 past
      return row;
    }).sort((a, b) => String(a.start).localeCompare(String(b.start)));
  } catch (e) {
    // AIOS 是本地文件，CI 里读不到是正常的（没配 AIOS_OPPORTUNITIES），这里只提示不报错
    console.warn(`[collect] AIOS 活动库不可用，跳过这一源：${e.message}`);
    return [];
  }
}

/* ────────────────────────── 8. 智力评测（Vals Index） ────────────────────────── */
async function fetchBench(prev) {
  const url = 'https://www.vals.ai/benchmarks/vals_index';
  try {
    const res = await httpText(url, { label: 'vals-index' });
    const text = res.text.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
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
    // 注意：prev.bench 是 { as_of, source, rows, fetched_at } 对象，不是数组。
    // 这里以前写成 (prev?.bench || []).map(...)，每次抛 TypeError 被 catch 吞掉，
    // 导致 bench 永久 stale、delta 永远为 null——「分数下跌标黄」从来没生效过。
    const prevRows = Array.isArray(prev?.rows) ? prev.rows : [];
    const old = new Map(prevRows.map((b) => [b.model, b.score]));
    for (const r of rows) {
      const o = old.get(r.model);
      r.delta = o == null ? null : Number((r.score - o).toFixed(2));
    }
    return { as_of: asOf, source: url, rows, fetched_at: nowISO() };
  } catch (e) {
    console.error(`[collect] bench 抓取失败：${e.message}`);
    return prev ? { ...prev, stale: true } : { as_of: null, source: url, rows: [], fetched_at: null, stale: true };
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

/* 网络请求重试：偶发的 5xx、429、连接重置不应该让整层数据蒸发。
 * 指数退避 + 抖动，只对「值得重试」的状态码重试（4xx 里除 408/429 之外都是确定性失败，不重试）。
 * 这解决过一个真实问题：fetchResources 串行打 21 个 GitHub 仓库，偶尔限流掉几个就跌破健康红线，
 * 整轮采集白跑。 */

async function fetchResources() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
  const headers = { 'User-Agent': 'IndexAI/1.0', Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const out = [];
  for (const item of (TEST_PROFILE ? CURATED_RESOURCES.slice(0, 3) : CURATED_RESOURCES)) {
    const row = { ...item, useLabel: USE_LABEL[item.use] || item.use };
    try {
      const res = await httpGet(`https://api.github.com/repos/${item.repo}`, { headers, label: `github/${item.repo}` });
      if (!res.ok) {
        console.error(`[collect] github/${item.repo} → HTTP ${res.status}`);
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
    } catch (e) {
      console.error(`[collect] github/${item.repo} 失败：${e.message}`);
      out.push({ ...row, status: 'error' });
    }
    await sleep(90);
  }
  // 按人工排序（谁更值得先看），不按星数
  return out;
}


/* ────────────────────────── OpenRouter 真实使用量（民间口碑 + 工具采纳） ────────────────────────── */
const OPENROUTER_RANKINGS = 'https://openrouter.ai/rankings';

export function parseOpenRouter(html) {
  const h = html.replace(/\\+"/g, '"').replace(/\\n/g, ' ');

  // 应用（谁在用哪个工具）——只取 day 窗口，跨窗口的 token 不可比
  const dayAt = h.indexOf('"day":[');
  const scope = dayAt >= 0 ? h.slice(dayAt, dayAt + 30000) : h;
  const apps = [];
  for (const p of scope.split('"app_id":').slice(1)) {
    const id = p.match(/^(\d+)/);
    const tok = p.match(/"total_tokens":"?(\d+)"?/);
    const rk = p.match(/"rank":(\d+)/);
    const ttl = p.match(/"title":"((?:[^"\\]|\\.)*)"/);
    const slug = p.match(/"slug":"((?:[^"\\]|\\.)*)"/);
    const cats = p.match(/"categories":\[([^\]]*)\]/);
    const desc = p.match(/"description":"((?:[^"\\]|\\.)*)"/);
    if (!id || !ttl || !rk) continue;
    apps.push({
      id: +id[1],
      title: ttl[1],
      slug: slug ? slug[1] : '',
      rank: +rk[1],
      tokens: tok ? +tok[1] : 0,
      categories: cats ? cats[1].replace(/"/g, '').split(',').filter(Boolean) : [],
      desc: desc ? desc[1].slice(0, 240) : '',
    });
  }
  const appMap = new Map();
  for (const a of apps) {
    if (!appMap.has(a.title)) appMap.set(a.title, a);
  }

  // 模型调用量（真实选择）
  const models = [];
  const reM = /\{"date":"([^"]+)","model_permaslug":"([^"]+)","variant":"([^"]*)","total_completion_tokens":(\d+),"total_prompt_tokens":(\d+)/g;
  let m;
  while ((m = reM.exec(h))) models.push({ slug: m[2], tokens: +m[4] + +m[5] });
  const modelMap = new Map();
  for (const r of models) modelMap.set(r.slug, (modelMap.get(r.slug) || 0) + r.tokens);

  return {
    apps: [...appMap.values()].sort((a, b) => b.tokens - a.tokens).map((a, i) => ({ ...a, rank: i + 1 })),
    models: [...modelMap.entries()]
      .map(([slug, tokens]) => ({ slug, tokens }))
      .sort((a, b) => b.tokens - a.tokens),
  };
}

async function fetchOpenRouter() {
  try {
    const res = await httpText(OPENROUTER_RANKINGS, { label: 'openrouter-rankings' });
    if (!res.ok) {
      console.error(`[collect] openrouter rankings HTTP ${res.status}`);
      return { apps: [], models: [] };
    }
    const html = res.text;
    if (html.length < 10000) {
      console.error(`[collect] openrouter rankings 页面过短（${html.length}），可能被拦`);
      return { apps: [], models: [] };
    }
    const parsed = parseOpenRouter(html);
    if (!parsed.apps.length && !parsed.models.length) {
      console.error('[collect] openrouter rankings 解析出 0 条——页面结构可能变了');
    }
    return parsed;
  } catch (e) {
    console.error(`[collect] openrouter rankings 失败：${e.message}`);
    return { apps: [], models: [] };
  }
}


/* ────────────────────────── Artificial Analysis 综合智能指数 ────────────────────────── */
const AA_URL = 'https://artificialanalysis.ai/leaderboards/models';

function parseAA(html) {
  let h = html.replace(/\\+"/g, '"').replace(/\\n/g, ' ');
  const at = h.indexOf('"initialModels":[');
  if (at < 0) return [];
  let i = h.indexOf('[', at), depth = 0, end = i;
  for (; end < h.length; end++) {
    if (h[end] === '[') depth++;
    else if (h[end] === ']') { depth--; if (depth === 0) { end++; break; } }
  }
  let arr;
  try { arr = JSON.parse(h.slice(i, end)); } catch { return []; }
  return arr
    .filter((m) => m && typeof m.intelligenceIndex === 'number' && !m.deprecated)
    .map((m) => ({
      slug: m.slug,
      name: String(m.name || m.shortName || '')
        .replace(/\s*,?\s*Default Fallback\s*/gi, '')
        .replace(/\s*\(\s*\)/, '')
        .trim(),
      fullName: m.name,
      vendor: m.modelCreatorName || '',
      idx: Number(m.intelligenceIndex.toFixed(2)),
      ctx: m.contextWindowTokens || null,
      openWeights: !!m.isOpenWeights,
      estimated: !!m.intelligenceIndexIsEstimated,
      // 细分项，有就带上
      terminal: typeof m.terminalbenchHard === 'number' ? Number((m.terminalbenchHard * 100).toFixed(1)) : null,
      tau2: typeof m.tau2 === 'number' ? Number((m.tau2 * 100).toFixed(1)) : null,
    }))
    .sort((a, b) => b.idx - a.idx);
}

async function fetchAA() {
  try {
    const res = await httpText(AA_URL, { label: 'artificialanalysis' });
    if (!res.ok) {
      console.error(`[collect] artificialanalysis HTTP ${res.status}`);
      return [];
    }
    const html = res.text;
    if (html.length < 50000) {
      console.error(`[collect] artificialanalysis 页面过短（${html.length}），可能被拦`);
      return [];
    }
    const parsed = parseAA(html);
    if (!parsed.length) console.error('[collect] AA 解析出 0 条——initialModels 结构可能变了');
    return parsed;
  } catch (e) {
    console.error(`[collect] artificialanalysis 失败：${e.message}`);
    return [];
  }
}


/* ────────────────────────── Hacker News：民间公开讨论度 ────────────────────────── */
const HN_API = 'https://hn.algolia.com/api/v1/search';

async function fetchHNSignal(names) {
  const out = [];
  const list = TEST_PROFILE ? names.slice(0, 2) : names;
  for (const name of list) {
    if (!name || name.length < 4) continue;   // 太短的词没有区分度
    try {
      // 只搜标题，避免 API/Raspberry Pi 这类词把无关帖算进来
      const url = `${HN_API}?query=${encodeURIComponent('"' + name + '"')}&tags=story&hitsPerPage=30&restrictSearchableAttributes=title`;
      const res = await httpGet(url, { tries: 2, label: `hn/${name}` });
      if (!res.ok) continue;
      const j = await res.json();
      const hits = j.hits || [];
      const heat = hits.reduce((n, h) => n + (h.points || 0), 0);
      const talk = hits.reduce((n, h) => n + (h.num_comments || 0), 0);
      const top = hits.sort((a, b) => (b.points || 0) - (a.points || 0))[0];
      out.push({
        name,
        mentions: j.nbHits || 0,
        heat,
        talk,
        topTitle: top?.title || '',
        topPoints: top?.points || 0,
        topComments: top?.num_comments || 0,
        topUrl: top?.url || (top?.objectID ? `https://news.ycombinator.com/item?id=${top.objectID}` : ''),
      });
      await sleep(120);  // 对公共接口客气一点
    } catch { /* 单个失败不影响整体 */ }
  }
  return out.sort((a, b) => b.heat - a.heat);
}

/* ────────────────────────── 分层采集：状态可追溯 ──────────────────────────
 * 每个数据层都经过这里。约定：
 *   fresh  —— 本次拿到了非空结果
 *   stale  —— 本次为空/异常，沿用上一版（prev 里有值）
 *   failed —— 本次为空且上一版也没有，这一层真的没了（health 会判红线）
 * 采集结果写进 meta.collect[]，前端和 health.mjs 都能读到，不再靠数数去猜。 */
function makeTracker() {
  const log = [];
  return {
    log,
    /** @param {string} layer 层名
     *  @param {Function} run 返回 Promise<{value:any, valid?:boolean}>
     *  valid 显式覆盖「非空」判定（值本身是对象、空对象也算空时用） */
    async run(layer, run, prevValue) {
      const started = mark();
      let value = null;
      let error = null;
      let valid = null;
      try {
        const out = await run();
        value = out?.value ?? null;
        valid = out?.valid ?? null;
      } catch (e) {
        error = e.message;
      }
      const size = (v) => {
        if (v == null) return 0;
        if (Array.isArray(v)) return v.length;
        if (typeof v === 'object') {
          // {prod, apple} 这种聚合对象：任一子字段有内容就算有值
          const sub = Object.values(v).filter((x) => x != null);
          if (sub.length) return sub.reduce((n, x) => n + (Array.isArray(x) ? x.length : typeof x === 'object' ? Object.keys(x).length : 1), 0);
          return Object.keys(v).length;
        }
        return 1;
      };
      const n = valid === false ? 0 : size(value);
      const prevN = size(prevValue);

      if (n > 0) {
        log.push({ layer, status: 'fresh', n, ms: since(started) });
        return value;
      }
      if (prevN > 0) {
        log.push({ layer, status: 'stale', n: 0, prev: prevN, ms: since(started), error });
        console.warn(`[collect] ${layer} 本次为空${error ? `（${error}）` : ''}，沿用上一版 ${prevN} 条`);
        return prevValue;
      }
      log.push({ layer, status: 'failed', n: 0, ms: since(started), error });
      console.error(`[collect] ${layer} 本次为空且无上一版${error ? `（${error}）` : ''}`);
      return value;
    },
  };
}

/* ────────────────────────── 主流程 ────────────────────────── */
async function main() {
  let prev = null;
  try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch { /* 首次运行 */ }
  // 上一版评测快照必须从 bench.json 读：data.json 里的 bench 只剩目录（F02）。
  const prevBench = readPrevBench();

  const fx = await fetchFx(prev?.meta?.fx);
  const T = makeTracker();

  // 并行拉取，每层独立记账；失败不互相拖累
  const [devpost, aios, luma, devfolio, aibijia, resources, openrouter, aaModels] = await Promise.all([
    T.run('devpost', async () => ({ value: await fetchDevpost() }), prev?.events?.filter((e) => e.source === 'Devpost')),
    // AIOS 读仓库外的本机文件，内容不在版本控制里：测试档位跳过，保证回放输出确定
    TEST_PROFILE
      ? Promise.resolve([])
      : T.run('aios', async () => ({ value: await fetchAios() }), prev?.events?.filter((e) => e.source === 'AIOS')),
    T.run('luma', async () => ({ value: await fetchLuma() }), prev?.events?.filter((e) => e.source === 'Luma')),
    // Devfolio 是补充源，只有 9 条：失败不能拖累整体，同样走 T.run 记账。
    // 注意它没有上一版可比（首次上线），所以首跑 failed 也是合法的 —— health 里设成可选源即可。
    T.run('devfolio', async () => ({ value: await fetchDevfolio() }), prev?.events?.filter((e) => e.source === 'Devfolio')),
    T.run('aibijia', async () => {
      const v = await fetchAibijia();
      return { value: v, valid: v.valid };
    }, null),
    T.run('resources', async () => ({ value: await fetchResources() }), prev?.resources),
    T.run('openrouter', async () => ({ value: await fetchOpenRouter() }), prev ? { apps: prev.orApps, models: prev.orModels } : null),
    T.run('aa', async () => ({ value: await fetchAA() }), prev?.aaModels),
  ]);

  // 情报层：归档文件是唯一存储，data.json 里只留极简索引（计数 / 跨度 / 逐日条数）
  const newsArchive = await T.run('news', async () => ({ value: await fetchNews((m) => console.log(`[collect] ${m}`)) }), null);
  const newsIndex = buildIndex(newsArchive || []);

  // 民间讨论：拿使用量前 18 的工具名去 HN 查公开帖
  const hnTargets = (openrouter?.apps || []).slice(0, 18).map((a) => a.title).filter(Boolean);
  const hnSignals = hnTargets.length
    ? await T.run('hn', async () => ({ value: await fetchHNSignal(hnTargets) }), prev?.hnSignals)
    : (prev?.hnSignals || []);

  // 评测：8 个公开源并采（LMArena 24 榜 / SWE-bench / Aider / Terminal-Bench / τ-bench / Vals / ARC-AGI / SimpleBench）
  // T.run 的基线只用于「本次为空时是否沿用」的判断，给个轻量代理：
  // prevBench 是 ~3MB 的对象，交给 size() 只会数出一堆无意义的键。
  const benchPrevMarker = prevBench ? { boards: prevBench.stats?.boards || 0 } : null;
  const bench = await T.run('bench', async () => {
    // 注意传的是「上一版完整快照」而不是 prev.bench（那是目录，没有 boards）。
    // 整源失败时 bench.mjs 会沿用该源自己的旧榜并标 stale（F02、S8.6）。
    const b = await fetchBenchmarks(prevBench);
    return { value: b.stats.boards ? b : (prevBench || b) };
  }, benchPrevMarker);

  const res = await httpGet(OPENROUTER, { label: 'openrouter-models' });
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
    seen: todayISO(),
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

  // 主键 input 升序；次级键保证同一价位的行顺序稳定（INV-7：输出必须确定）
  const models = modelsDedup.rows.slice().sort((a, b) => {
    const d = (a.input ?? 9e9) - (b.input ?? 9e9);
    if (d !== 0) return d;
    const ka = `${a.channelKind}::${a.id}::${a.channel}`;
    const kb = `${b.channelKind}::${b.id}::${b.channel}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const relaysToProbe = TEST_PROFILE ? RELAYS.slice(0, 3) : RELAYS;
  const probed = await probeAll(relaysToProbe);
  const prevRelays = new Map((prev?.relays || []).map((r) => [r.domain, r]));

  // 官方参考价（direct 渠道），用来给每一列算「对官方 %」
  const officialRef = {};
  for (const f of FLAGSHIP) {
    const m = (models || []).find((x) => x.channelKind === 'direct' && f.re.test(String(x.name || '')) && x.input > 0);
    officialRef[f.key] = { input: m?.input ?? f.official[0], output: m?.output ?? f.official[1] };
  }

  const relays = [...probed.values()].map((r) => {
    const old = prevRelays.get(r.domain);
    const base = r.status === 'ok'
      ? r
      : { ...r, stale: true, prices: old?.prices || {}, models: old?.models || 0, groups: old?.groups || null, checked_at: old?.checked_at || null };

    // 给每个旗舰价补上「有效成本」与「对官方比」，缺值留 null 而不是 0
    const prices = {};
    for (const [k, p] of Object.entries(base.prices || {})) {
      if (!p) continue;
      const ref = officialRef[k];
      const row = { ...p };
      if (p.kind === 'per_1m') {
        row.eff = effectiveCost(p);
        row.vsOfficial = ref && ref.input > 0 ? Number((p.input / ref.input).toFixed(3)) : null;
        const officialEff = ref ? effectiveCost({ kind: 'per_1m', input: ref.input, output: ref.output, cacheRead: ref.cache_read }) : null;
        row.effVsOfficial = officialEff ? Number((row.eff / officialEff).toFixed(3)) : null;
      }
      // 按次计价不参与每百万 token 的比较，只留原值
      prices[k] = row;
    }

    // 站点级画像：用「有效成本」算，才有可比性
    const effs = Object.entries(prices)
      .filter(([, p]) => p.kind === 'per_1m' && p.eff != null && !p.anomaly)
      .map(([k, p]) => ({ k, eff: p.eff, input: p.input, output: p.output }));
    const effSpread = effs.length > 1 ? Number((Math.max(...effs.map((x) => x.eff)) / Math.min(...effs.map((x) => x.eff))).toFixed(2)) : null;

    return {
      ...base,
      prices,
      // 有多少个旗舰能给出可比单价（决定这一行在页面上有多大信息量）
      comparable: effs.length,
      effSpread,
      groupSpread: base.groups?.spread ?? null,
    };
  }).sort((a, b) => (b.models || 0) - (a.models || 0));

  // 「这是同一个价目模板」的分组：completion_ratio 与分组结构一致的站归一类，
  // 让页面能说出「这 11 家其实是一个模板」，而不是把 11 个 75/75 当 11 个独立异常。
  const templateKey = (r) => {
    const p = r.prices?.sonnet55 || r.prices?.opus55;
    if (!p || p.kind !== 'per_1m') return null;
    return `${p.input}/${p.output}/${p.comp ?? '?'}`;
  };
  const templates = new Map();
  for (const r of relays.filter((x) => x.status === 'ok')) {
    const k = templateKey(r);
    if (!k) continue;
    if (!templates.has(k)) templates.set(k, []);
    templates.get(k).push(r.name);
  }
  for (const r of relays) {
    const k = templateKey(r);
    const same = k ? templates.get(k) : null;
    r.template = k;
    r.templateSame = same && same.length > 1 ? same.filter((n) => n !== r.name) : null;
  }

  // 订阅层：官方月费从苹果区价派生；第三方挂单只认 aibijia 的实时挂单，没有就是没有。
  // aibijia 整体挂掉时沿用上一版的派生结果（而不是让订阅页空掉）。
  const prevSubs = Array.isArray(prev?.subs) ? prev.subs : [];
  const prevSubsThird = Array.isArray(prev?.subsThird) ? prev.subsThird : [];
  const prevSubsRegions = Array.isArray(prev?.subsRegions) ? prev.subsRegions : [];

  let subs = buildSubs(aibijia.apple).map((x) => ({ ...x, cny: Number((x.price * fx.USDCNY).toFixed(1)) }));
  let subsThird = buildSubsThird(aibijia.prod);
  let subsRegions = buildSubsRegions(aibijia.apple);

  if (!subs.length && prevSubs.length) {
    subs = prevSubs; T.log.push({ layer: 'subs', status: 'stale', n: 0, prev: prevSubs.length, ms: 0, error: 'apple 源为空' });
    console.warn(`[collect] subs 派生为空，沿用上一版 ${prevSubs.length} 档`);
  }
  if (!subsThird.length && prevSubsThird.length) {
    subsThird = prevSubsThird; T.log.push({ layer: 'subsThird', status: 'stale', n: 0, prev: prevSubsThird.length, ms: 0, error: 'products 源为空' });
    console.warn(`[collect] subsThird 为空，沿用上一版 ${prevSubsThird.length} 条`);
  }
  if (!subsRegions.length && prevSubsRegions.length) {
    subsRegions = prevSubsRegions; T.log.push({ layer: 'subsRegions', status: 'stale', n: 0, prev: prevSubsRegions.length, ms: 0, error: 'apple 源为空' });
    console.warn(`[collect] subsRegions 为空，沿用上一版 ${prevSubsRegions.length} 组`);
  }

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
  if ((newsArchive || []).length) {
    addSrc('https://data.aibijia.org/news-frontline.yaml', 'news', 'AI 要闻精选');
    addSrc('https://aihot.news/api/v1/items', 'news', 'AIHOT 全量流（7 天窗口）');
  }
  if (resources.length) addSrc('https://api.github.com/repos', 'toolkit', 'GitHub 精选');
  if (openrouter.apps.length) addSrc('https://openrouter.ai/rankings', 'adoption', 'OpenRouter 实际调用量');
  if (aaModels.length) addSrc(AA_URL, 'bench', 'Artificial Analysis 智能指数');
  if (hnSignals.length) addSrc('https://hn.algolia.com/api', 'community', 'Hacker News 公开讨论');
  for (const r of relays) addSrc(`https://${r.domain}/api/pricing`, 'relay', r.name);
  addSrc('https://devpost.com/api/hackathons', 'events', 'Devpost');
  if (devfolio.length) addSrc('https://api.devfolio.co/api/hackathons', 'events', 'Devfolio');
  addSrc('https://www.vals.ai/benchmarks/vals_index', 'bench', 'Vals Index');

  const cacheDiscount = models
    .filter((m) => m.cache_read != null && m.input)
    .map((m) => ({ id: m.id, off: 1 - m.cache_read / m.input }))
    .sort((a, b) => b.off - a.off);

  const vendors = [...new Set(models.map((m) => m.vendor))].sort();

  // 活动：状态统一由 eventStatus 按日期判定，四个来源一视同仁
  const allEvents = foldRegions([...devpost, ...luma, ...aios, ...devfolio].map((e) => {
    const row = { ...e, kind: eventKind(e), region: eventRegion(e) };
    row.status = eventStatus(row);
    return row;
  }));
  // 限速观测点：把本次遇到的封禁次数与最长冷却写进 meta.net，随 data.json 落盘。
  // 这个源是**有状态封禁**（实测解封要 ~3 分钟），如果哪天它把阈值调紧，
  // 从 meta.net.blocked 抬升 + Luma 条数下降就能立刻看出是限速而不是源没数据。
  // 放在 meta 顶层而不是塞进某一个层，因为 Devfolio 也用同一个计数器。
  const netMeta = {
    // 统一 HTTP 客户端的账目（S2.1）：谁发了多少、多少字节、被限流几次、等多久。
    // 这些数字回答「这次为什么慢/为什么少了」，是排障的第一现场。
    http: httpTotals(),
    requests: netStat.requests,
    blocked: netStat.blocked,
    maxCooldownMs: netStat.maxCooldownMs,
    lumaCities: LUMA_CITIES.length,
    lumaGeoBudgetMs: EV_LUMA_GEO_BUDGET_MS,
    // 受阻要响（INV-4）：页面与状态页据此说「中转/活动这层被限速了」，而不是默默少几条
    lumaBlocked: lumaState.blocked,
    lumaBlockReason: lumaState.reason,
    lumaCooldownMs: lumaState.cooldownMs,
    lumaCooldownCapMs: EV_LUMA_COOLDOWN_CAP_MS,
  };
  const eventsOpen = allEvents.filter((e) => e.status === 'open' || e.status === 'upcoming').length;
  const eventsPast = allEvents.filter((e) => e.status === 'past').length;
  const eventsUnknown = allEvents.filter((e) => e.status === 'unknown').length;

  const data = {
    meta: {
      generated_at: nowISO(),
      date: todayISO(),
      brand: 'IndexAI',
      fx,
      net: netMeta,
      // 按层 id 排序：并行采集的完成顺序不稳定，输出必须确定（INV-7）
      collect: T.log.slice().sort((a, b) => (a.layer < b.layer ? -1 : a.layer > b.layer ? 1 : 0)),
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
        news: newsArchive?.length || 0,
        resources: resources.filter((r) => r.status === 'ok').length,
        orApps: openrouter.apps.length,
        orModels: openrouter.models.length,
        aaModels: aaModels.length,
        hnSignals: hnSignals.length,
        relays: relays.length,
        relaysLive: relays.filter((r) => r.status === 'ok').length,
        relayQuotes: relays.reduce((n, r) => n + Object.keys(r.prices || {}).length, 0),
        relaySamples: relays.reduce((n, r) => n + (r.samples || []).length, 0),
        relayComparable: relays.filter((r) => (r.comparable || 0) > 0).length,
        relayGroups: relays.reduce((n, r) => n + (r.groups?.count || 0), 0),
        events: allEvents.length,
        eventsOpen,
        eventsPast,
        eventsUnknown,
        bench: bench.stats?.boards || 0,
        benchRows: bench.stats?.rows || 0,
        benchModels: bench.stats?.models || 0,
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
    resources,
    orApps: openrouter.apps,
    orModels: openrouter.models,
    aaModels,
    hnSignals,
    relays,
    // 场次型输出按 id 排序：多源并行的完成顺序不稳定，输出必须确定（INV-7）
    events: allEvents.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    bench,
    signals,
    sources: [...srcMap.values()].sort((a, b) => b.refs - a.refs),
  };

  // 健康门禁：不达标就抛，绝不写出残缺的 data.json 再发布出去
  const prevCounts = prev?.meta?.counts || null;
  const prevOf = (k) => {
    if (!prev) return null;
    if (k === 'subsThird') return (prev.subsThird || []).length;
    if (k === 'relaysLive') return (prev.relays || []).filter((r) => r.status === 'ok').length;
    if (k === 'subsRegions') return (prev.subsRegions || []).length;
    return prevCounts?.[k] ?? (Array.isArray(prev[k]) ? prev[k].length : null);
  };
  const health = assertLayers(data, prevOf, { allowDegraded: process.env.ALLOW_DEGRADED === '1' });
  data.meta.health = {
    ok: health.ok,
    red: health.red.map((i) => `${i.key}: ${i.msg}`),
    warn: health.warn.map((i) => `${i.key}: ${i.msg}`),
  };

  // 评测数据量大（~3MB），拆到 bench.json 按需加载；data.json 只留目录与统计供首屏用
  const benchFull = data.bench;
  // 目录型字段之外一律不进 data.json：`boards` 含全部行的分数（~3 MB），
  // 它只能出现在 bench.json。页面与采集基线都靠 data.bench.file 找到真实文件（F02）。
  data.bench = {
    as_of: benchFull.as_of,
    latest: benchFull.latest,
    groups: benchFull.groups,
    sources: benchFull.sources,
    stats: benchFull.stats,
    catalog: benchFull.catalog,
    file: 'bench.json',
  };
  await writeFile(BENCH_OUT, JSON.stringify(benchFull));
  // 情报：完整条目在 news-archive.json（页面按需拉），data.json 只带索引
  data.news = newsIndex;
  await writeFile(OUT, JSON.stringify(data));
  console.log(JSON.stringify({ ...data.meta, counts: data.meta.counts }, null, 2));
}

/* 只在直接运行本文件时采集；被 import 时（特征测试）不产生任何副作用。 */
const isDirectRun = process.argv[1] && process.argv[1].endsWith('collect.mjs');
if (isDirectRun) {
  main().catch((e) => { console.error('[collect] failed:', e.message); process.exit(1); });
}
