/**
 * 公开数据清单（T5.10 · S9.9 · F51）。
 *
 * ## 为什么单独一页
 *
 * 站点的价值在「可复核」。读者看到一个价格，应当能顺着走到：
 *   哪个文件 → 什么 schema → 谁给的 → 什么许可。
 *
 * 这一层信息放在 `/data/` 页，同时以 schema.org `Dataset` 的 JSON-LD 输出，
 * 让搜索引擎也能索引到「这是一份可下载的数据集」。
 *
 * ## 上游署名（D2 / D7）
 *
 * 每个 `upstream` 条目写清：名字、地址、许可/要求、用在哪一层。
 * 漏掉一个上游就是漏掉一次署名义务——所以这张表**按源穷举**，
 * 而不是「列举几个主要的」。
 */

/** 站点自己的数据许可。 */
export const SITE_LICENSE = {
  name: 'CC BY 4.0',
  url: 'https://creativecommons.org/licenses/by/4.0/',
};

/**
 * 上游源清单。
 *
 * `requirement` 是「用它的数据时对方要求你做什么」。
 */
export const UPSTREAMS = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    url: 'https://openrouter.ai',
    license: 'CC BY 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    requirement: '署名 OpenRouter 并链接回源站',
    layers: ['models'],
    note: '模型目录与挂牌价。逆向 / 特价分组不参与代表价与最低可达价。',
  },
  {
    id: 'artificialanalysis',
    name: 'Artificial Analysis',
    url: 'https://artificialanalysis.ai',
    license: '公开榜单，署名要求',
    licenseUrl: null,
    requirement: '引用时注明数据来自 Artificial Analysis',
    layers: ['bench'],
    note: '智能指数等综合评测。',
  },
  {
    id: 'lmarena',
    name: 'LMArena',
    url: 'https://lmarena.ai',
    license: '公开数据集（HuggingFace）',
    licenseUrl: 'https://huggingface.co/lmarena-ai',
    requirement: '注明来自 LMArena 并链接',
    layers: ['bench'],
    note: '对战胜率榜，含 95% 置信区间与票数。',
  },
  {
    id: 'swebench',
    name: 'SWE-bench',
    url: 'https://www.swebench.com',
    license: '公开榜单',
    licenseUrl: null,
    requirement: '注明来自 SWE-bench',
    layers: ['bench'],
    note: '代码修复任务的提交榜。',
  },
  {
    id: 'aider',
    name: 'Aider',
    url: 'https://aider.chat/docs/leaderboards/',
    license: '公开榜单',
    licenseUrl: null,
    requirement: '注明来自 Aider leaderboards',
    layers: ['bench'],
    note: 'polyglot 等编程榜。',
  },
  {
    id: 'terminalbench',
    name: 'Terminal-Bench',
    url: 'https://www.tbench.ai',
    license: '公开榜单',
    licenseUrl: null,
    requirement: '注明来自 Terminal-Bench',
    layers: ['bench'],
    note: '终端任务榜。',
  },
  {
    id: 'taubench',
    name: 'τ-bench',
    url: 'https://taubench.com',
    license: '公开榜单',
    licenseUrl: null,
    requirement: '注明来自 τ-bench',
    layers: ['bench'],
    note: '工具调用与对话任务榜。',
  },
  {
    id: 'arcprize',
    name: 'ARC-AGI',
    url: 'https://arcprize.org',
    license: '公开榜单',
    licenseUrl: null,
    requirement: '注明来自 ARC Prize',
    layers: ['bench'],
    note: '抽象推理榜。',
  },
  {
    id: 'simplebench',
    name: 'SimpleBench',
    url: 'https://simple-bench.com',
    license: '公开榜单',
    licenseUrl: null,
    requirement: '注明来自 SimpleBench',
    layers: ['bench'],
    note: '常识推理榜。',
  },
  {
    id: 'vals',
    name: 'Vals AI',
    url: 'https://www.vals.ai',
    license: '公开榜单',
    licenseUrl: null,
    requirement: '注明来自 Vals AI',
    layers: ['bench'],
    note: '金融、法律等专业任务榜。',
  },
  {
    id: 'luma',
    name: 'Luma',
    url: 'https://lu.ma',
    license: '公开活动页',
    licenseUrl: null,
    requirement: '注明来源并链接活动页',
    layers: ['events'],
    note: '活动发现流。',
  },
  {
    id: 'devpost',
    name: 'Devpost',
    url: 'https://devpost.com',
    license: '公开活动页',
    licenseUrl: null,
    requirement: '注明来源并链接活动页',
    layers: ['events'],
    note: '黑客松目录。',
  },
  {
    id: 'devfolio',
    name: 'Devfolio',
    url: 'https://devfolio.co',
    license: '公开活动页',
    licenseUrl: null,
    requirement: '注明来源并链接活动页',
    layers: ['events'],
    note: '黑客松目录。',
  },
  {
    id: 'aihot',
    name: 'AIHOT',
    url: 'https://aihot.virxact.com',
    license: '公开新闻流',
    licenseUrl: null,
    requirement: '注明来源并链接原文',
    layers: ['news'],
    note: 'AI 新闻全量流。',
  },
  {
    id: 'official-feeds',
    name: '厂商官方博客与 Releases',
    url: 'https://openai.com/news/rss.xml',
    license: '公开 RSS / Atom',
    licenseUrl: null,
    requirement: '注明来源并链接原文',
    layers: ['news'],
    note: 'OpenAI / Anthropic / DeepMind / Hugging Face / Microsoft AI / vLLM / Ollama 的官方 feed。',
  },
  {
    id: 'hn',
    name: 'Hacker News',
    url: 'https://news.ycombinator.com',
    license: '公开 API',
    licenseUrl: null,
    requirement: '注明来自 Hacker News',
    layers: ['news'],
    note: '技术社区讨论。',
  },
  {
    id: 'github',
    name: 'GitHub',
    url: 'https://github.com',
    license: '公开 API',
    licenseUrl: null,
    requirement: '注明来自 GitHub，遵守其 API 条款',
    layers: ['resources'],
    note: '工具仓库的星数与更新时间。',
  },
  {
    id: 'appstore',
    name: 'App Store',
    url: 'https://www.apple.com/app-store/',
    license: '公开内购页',
    licenseUrl: null,
    requirement: '注明价格为当地商店公开价，可能随时变动',
    layers: ['subs'],
    note: '订阅档位与区价。',
  },
  {
    id: 'erapi',
    name: 'open.er-api.com',
    url: 'https://open.er-api.com',
    license: '免费汇率接口',
    licenseUrl: null,
    requirement: '注明汇率来源与抓取时间',
    layers: ['fx'],
    note: '人民币兑美元汇率，每 8 小时刷新一次。',
  },
];

/**
 * 公开数据文件清单。
 *
 * @param {object} opt
 * @param {object} [opt.manifest] 构建产出的 manifest（有 files 与 newsShards）
 * @param {string[]} [opt.layers] 有数据的层 id
 * @returns {object[]}
 */
export function publicDatasets(opt = {}) {
  const manifest = opt.manifest || {};
  const files = new Map((manifest.files || []).map((f) => [f.name, f]));

  const rows = [];

  /* 三份主输出：页面真正吃的就是这些。 */
  const MAIN = [
    [
      'data.json',
      '全站主数据',
      '全部层的一处汇总：模型、活动、订阅、免费额度、中转站、情报、信号、厂商顺序与计数',
    ],
    ['bench.json', '评测数据', '各榜排名、分数与采集时间；board 与行都在这里'],
    ['news-milestones.json', '超级大事件', '按时代划分的里程碑事件，带核验状态'],
  ];

  for (const [name, title, desc] of MAIN) {
    const f = files.get(name);
    if (!f) continue;
    rows.push({
      name,
      path: `/${f.file}`,
      title,
      description: desc,
      bytes: f.bytes,
      schema:
        name === 'data.json'
          ? 'data/v1'
          : name === 'bench.json'
            ? 'bench/v1'
            : 'news-milestones/v1',
      license: SITE_LICENSE,
    });
  }

  /* 分层文件（manifest 里的 layers）：每层可单独取用。 */
  for (const layer of manifest.layers || []) {
    rows.push({
      name: `layer-${layer.layer}.json`,
      path: `/data/${layer.served_file || layer.file}`,
      title: `${layer.layer} 层`,
      description: `第 ${layer.layer} 层的完整行，含门禁结论与采集时点`,
      bytes: null,
      schema: `layer/${layer.layer}/v1`,
      license: SITE_LICENSE,
      gate: layer.gate,
    });
  }

  return rows;
}

/**
 * schema.org `Dataset` 的 JSON-LD。
 *
 * @param {object} opt
 * @param {string} opt.baseUrl
 * @param {object[]} opt.datasets publicDatasets 的结果
 * @param {string} [opt.lastmod]
 * @returns {object}
 */
export function datasetJsonLd(opt) {
  const { baseUrl = '', datasets = [], lastmod = null } = opt;

  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'IndexAI 公开数据',
    description:
      'AI 模型价格、免费额度、订阅区价、中转站报价、活动与评测的公开数据。每日采集，含 schema 与门禁结论。',
    url: `${baseUrl}/data/`,
    license: SITE_LICENSE.url,
    ...(lastmod ? { dateModified: lastmod } : {}),
    creator: { '@type': 'Organization', name: 'IndexAI' },
    isAccessibleForFree: true,
    distribution: datasets.map((d) => ({
      '@type': 'DataDownload',
      name: d.name,
      description: d.description,
      contentUrl: `${baseUrl}${d.path}`,
      encodingFormat: 'application/json',
      ...(d.bytes ? { contentSize: `${d.bytes} B` } : {}),
    })),
  };
}
