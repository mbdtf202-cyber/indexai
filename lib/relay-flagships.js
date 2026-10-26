/**
 * 中转站比价用的常量：旗舰清单 + 变体判定正则。
 *
 * 这些是**配置**不是逻辑：改旗舰就改这里，解析与打分的代码不为它改动。
 * 从 relay-pricing.js 拆出来，是为了让那个文件专心做解析（R3 单文件 ≤ 400 行）。
 */

/** 对比用的旗舰模型。正则只圈定家族，变体由 `pickFlagship` 剔除。 */
export const FLAGSHIP = [
  { key: 'sonnet55', label: 'Claude Sonnet 5.5', re: /claude[-_ ]?sonnet[-_ ]?5[.\-]?5/i, official: [2, 10] },
  { key: 'opus55', label: 'Claude Opus 5.5', re: /claude[-_ ]?opus[-_ ]?5[.\-]?5/i, official: [4, 20] },
  { key: 'gpt61sol', label: 'GPT-6.1 Sol', re: /gpt[-_ ]?6[.\-]?1[-_ ]?sol/i, official: [2, 10] },
  { key: 'gemini4argon', label: 'Gemini 4 Argon', re: /gemini[-_ ]?4[-_ ]?argon/i, official: [2, 10] },
  // deepseek-flash 与 deepseek-v4-1-flash 是两个不同的模型，
  // 旧正则 /deepseek.*flash/ 会先命中前者（75/150），把正确价（2/8）挤掉。
  {
    key: 'deepseekflash',
    label: 'DeepSeek V4.1 Flash',
    re: /deepseek[-_ ]?v?4[.\-]?1[-_ ]?flash/i,
    official: [0.1408, 0.5634],
  },
];

/** 变体标记：名字里比正则多出这些部分，说明是变体而不是基础版。 */
export const VARIANT_RE =
  /(thinking|reasoning|reasoner|nothink|non-?thinking|high|low|medium|xhigh|max|effort|beta|alpha|preview|experimental|exp|latest|search|online|image|vision|audio|omni|realtime|transcribe|tts|codex|instruct)/i;
export const DATED_RE = /-\d{6,8}(?:$|-)/;
export const FREE_RE = /(?:^|[-_\/:])(free|gratis|trial|试用|公益|福利)(?:$|[-_\/:])|:free$/i;
