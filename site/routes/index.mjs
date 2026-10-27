/**
 * 路由表（T5.2 · S9.1）。
 *
 * ## 单一事实来源
 *
 * 页面路径、标题、描述、数据依赖、渲染函数全在这一张表里。三个消费者：
 *
 * 1. **构建**：为每个路由输出独立 HTML（预渲染）；
 * 2. **客户端**：URL 变化时据此选视图、据此知道要懒加载哪份数据；
 * 3. **SEO**：`sitemap.xml` 与每页的 `<link rel="canonical">` 都从这张表生成。
 *
 * 三处各写一份路由表是这类项目最典型的退化：加了一个页，构建出了、
 * 客户端不知道、sitemap 漏了。
 *
 * ## 「不开 JS 可读」（S9.3）
 *
 * 每个路由的 `render(data)` 是**纯函数**，只吃数据、只吐 HTML 字符串。
 * 构建期跑一遍写进静态文件；浏览器里的入口模块只做交互增强，
 * 首屏内容不依赖任何 JS。
 */

import { renderHome } from '../views/home.mjs';
import { renderModels } from '../views/models.mjs';
import { renderBench } from '../views/bench.mjs';
import { renderSubs } from '../views/subs.mjs';
import { renderFree } from '../views/free.mjs';
import { renderRelays } from '../views/relays.mjs';
import { renderEvents } from '../views/events.mjs';
import { renderTools } from '../views/tools.mjs';
import { renderSignals } from '../views/signals.mjs';
import { renderMethods } from '../views/method.mjs';
import { renderData } from '../views/data.mjs';
import { renderChanges } from '../views/changes.mjs';
import { renderCalculator } from '../views/cost-calculator.mjs';

/** 站点名与默认描述（SEO 用）。 */
export const SITE_NAME = 'IndexAI';
export const SITE_TAGLINE = 'AI 模型价格、免费额度、订阅与评测的一处真相';

/**
 * 路由定义。
 *
 * 字段：
 * - `path`：URL 路径（`/` 表示首页）
 * - `file`：输出文件名（相对 `dist/`）
 * - `title` / `description`：SEO
 * - `render`：`(data) => html` 纯函数
 * - `data`：需要哪些数据（`'home'` / `'models'` / `'bench'` / `'relays'` / `'all'`）
 * - `nav`：是否出现在导航里（详情页不进导航）
 */
export const ROUTES = [
  {
    path: '/',
    file: 'index.html',
    title: `${SITE_NAME} · ${SITE_TAGLINE}`,
    description: 'AI 模型价格、免费额度、订阅与评测的一处真相。全部数字可复核。',
    render: renderHome,
    data: 'home',
    nav: true,
    navLabel: '首页',
  },
  {
    path: '/models',
    file: 'models.html',
    title: `模型价格 · ${SITE_NAME}`,
    description: '按厂商与价格分档浏览全部模型，含上下文与有效成本。',
    render: renderModels,
    data: 'models',
    nav: true,
    navLabel: '模型',
  },
  {
    path: '/benchmarks',
    file: 'benchmarks.html',
    title: `评测 · ${SITE_NAME}`,
    description: '各榜排名与分数，标出较上次下降的项。',
    render: renderBench,
    data: 'bench',
    nav: true,
    navLabel: '评测',
  },
  {
    path: '/subscriptions',
    file: 'subscriptions.html',
    title: `订阅 · ${SITE_NAME}`,
    description: '官方订阅档位与区价对比。',
    render: renderSubs,
    data: 'all',
    nav: true,
    navLabel: '订阅',
  },
  {
    path: '/free',
    file: 'free.html',
    title: `免费额度 · ${SITE_NAME}`,
    description: '各家的免费额度、限制与核实日期。',
    render: renderFree,
    data: 'all',
    nav: true,
    navLabel: '免费',
  },
  {
    path: '/relays',
    file: 'relays.html',
    title: `中转站 · ${SITE_NAME}`,
    description: '第三方中转站的旗舰价对比。',
    render: renderRelays,
    data: 'relays',
    nav: true,
    navLabel: '中转站',
  },
  {
    path: '/events',
    file: 'events.html',
    title: `活动 · ${SITE_NAME}`,
    description: 'AI 相关的比赛与活动。',
    render: renderEvents,
    data: 'all',
    nav: true,
    navLabel: '活动',
  },
  {
    path: '/tools',
    file: 'tools.html',
    title: `工具 · ${SITE_NAME}`,
    description: '值得关注的工具与仓库。',
    render: renderTools,
    data: 'all',
    nav: true,
    navLabel: '工具',
  },
  {
    path: '/signals',
    file: 'signals.html',
    title: `信号 · ${SITE_NAME}`,
    description: '从业者公开说过的话：价格、路线、能力边界。每条带原文与出处，可回查。',
    render: renderSignals,
    data: 'all',
    nav: true,
    navLabel: '信号',
  },
  {
    path: '/changes',
    file: 'changes.html',
    title: `变化 · ${SITE_NAME}`,
    description: '今天变了什么：价格、额度、订阅、中转站、评测。',
    render: renderChanges,
    data: 'home',
    nav: true,
    navLabel: '变化',
  },
  {
    path: '/cost',
    file: 'cost.html',
    title: `成本计算 · ${SITE_NAME}`,
    description: '按输入输出 token 量算有效成本。',
    render: renderCalculator,
    data: 'models',
    nav: true,
    navLabel: '成本',
  },
  {
    path: '/data',
    file: 'data.html',
    title: `数据与署名 · ${SITE_NAME}`,
    description: '公开数据文件、schema、许可与全部上游署名。每个数字都可以顺着走到原始文件。',
    render: renderData,
    data: 'datasets',
    nav: true,
    navLabel: '数据',
  },
  {
    path: '/methodology',
    file: 'methodology.html',
    title: `方法 · ${SITE_NAME}`,
    description: '每一层数据的来源、去重规则、有效成本公式、汇率与评测口径。',
    render: renderMethods,
    data: 'all',
    nav: true,
    navLabel: '方法',
  },
];

/**
 * 按路径查路由。
 *
 * @param {string} path
 * @returns {object|null}
 */
export function routeByPath(path) {
  const clean =
    String(path || '/')
      .split('?')[0]
      .split('#')[0] || '/';
  return ROUTES.find((r) => r.path === clean) ?? null;
}

/** 导航项（首页排最前，其余按表顺序）。 */
export function navItems() {
  return ROUTES.filter((r) => r.nav).map((r) => ({ path: r.path, label: r.navLabel }));
}
