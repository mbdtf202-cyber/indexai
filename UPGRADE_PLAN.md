# IndexAI 长期升级方案

Opus 5.5 深度审查 · 2026-10-24 · 基于审查时的工作区（标签 `review-base`）与 2026-10-23T21:54Z 生成的 `data.json` · §9 的决策已全部定案

本文件是升级工作的唯一规格源（spec of record），只描述「要什么、为什么、怎么验收」。任务、步骤与状态在 `IMPLEMENTATION_PLAN.md`，本文件只在规格本身变化时修改。

## 0. 怎么用

| 文件 | 作用 | 谁维护 |
|---|---|---|
| `UPGRADE_PLAN.md` | 发现、不变量、架构、规格、里程碑、决策 | 人；Ralph 发现规格矛盾只记录，不擅改 |
| `IMPLEMENTATION_PLAN.md` | 按顺序排好的任务：步骤、依赖、验收、状态 | Opus 编写，Ralph 执行时维护；不用 plan 模式重写 |
| `PROMPT_build.md` · `loop.sh` | 构建循环本身，每轮一个任务 | 人 |
| `AGENTS.md` | 每轮必读的操作手册 | Ralph，保持在 60 行内 |

Ralph 每轮读 `AGENTS.md`、当前任务、本文件 §2 不变量与 §7 完成定义，再按需读任务引用的 §3 发现与 §5 规格节。

编号约定：`F` 审查发现，`INV` 不变量，`S` 规格，`T` 任务，`D` 决策，`R` 架构适应度规则，`H` 需要人做的事。任务引用发现与规格，例如 `T1.3 → F04, S2.3`。

审查方法：逐行阅读全部源码（collect / bench / health / lib / index.html / CI / 文档），用 `data.json`、`news-archive.json` 的真实内容核对行为。本次环境无法执行脚本，所有结论来自静态阅读加数据核对，未经运行复现的条目已注明。

---

## 1. 结论

产品方向是对的，口径意识也明显强于同类站点：分层健康门禁、按日期判活动状态、中转站表达式优先、评测按榜内名次对齐，这些都是踩坑后沉淀下来的正确设计。问题在于工程地基已经到顶：两个单体文件（`collect.mjs` 2,737 行、`index.html` 4,031 行）、零测试、手填阈值、没有历史数据。继续在这上面堆功能，每一轮迭代都会更脆。

当前最危险的三件事：

1. 发布是整站原子的。任一层红线，所有层当天都不更新；而评测层「失败沿用上次」在线上从未生效（F02、F03）。LMArena 一次故障就能冻结全站。
2. 外部请求没有边界。Luma 的 429 冷却单请求最长睡 30 分钟，超过 job 的 20 分钟超时，且该路径最近一次采集已触发（F04、F05）。
3. 页面在 `data.json` 读取失败时整页空白，连 `<noscript>` 都看不见（F01）。

升级主线按顺序是：

1. **护栏**：工具链、测试、离线回放、CI 门禁。这是 Ralph 能自主迭代的前提，必须最先做。
2. **止血**：修掉会停更、白屏、丢数据的缺陷。
3. **清理**：删死代码、孤儿文件、文档漂移，统一常量来源。
4. **管线**：拆模块，统一 HTTP 客户端，分层发布，人工数据结构化。
5. **资产**：每日快照与变化流，统一模型实体。这一步把「每天覆盖的一个 JSON」变成「可回溯的价格索引」。
6. **前端**：预渲染多页、真实路由、可访问、自托管字体、性能预算。
7. **增长**：模型详情页、今日变化、订阅值不值计算器、官方定价页监测、Atom 与 iCal 订阅源、公开数据页。

---

## 2. 不变量

按重要性排序。任何任务都不得违反；与本节冲突的需求以本节为准，冲突本身记入 `IMPLEMENTATION_PLAN.md` 交给人裁决。

| ID | 规则 | 为什么 |
|---|---|---|
| INV-1 | 残缺不覆盖：某层未过门禁，线上保留该层上一版；门禁在层级粒度生效，不再整站原子。 | 旧数据比坏数据好，一层坏不该拖垮其它层 |
| INV-2 | 每个数字可回溯：记录带来源 URL、抓取时间、口径（`api` / `official` / `curated` / `derived`）与置信度；人工数据另带 `verified_at` 与证据。 | 这是索引站唯一的护城河 |
| INV-3 | 只用公开数据与官方免费接口：可以为官方免费 API 申请 key（D2），除此之外不注册、不登录、不绕过鉴权或限流、不伪装；按源要求署名。 | 合规与长期可持续 |
| INV-4 | 失败要响：任何降级、沿用、隔离都写进 manifest 并在页面可见；禁止 `catch` 后静默返回空。 | 静默腐烂是本项目踩过最多的坑 |
| INV-5 | 单一事实来源：公式、用量画像、旗舰清单、主题表、标签字典只定义一处，采集端与页面共享；文档与页面里的统计数字由数据生成，不手写。 | 当前大量漂移都源于复制粘贴 |
| INV-6 | 运行时零依赖：采集与站点运行时不引入 npm 包；开发工具可以用，精确锁版本并提交 lockfile。 | 每日无人值守任务的供应链面越小越好 |
| INV-7 | 确定性：时间来自注入的时钟，网络只走统一 HTTP 客户端，测试离线回放；同一输入必须得到同一输出。 | 没有确定性就没有回压 |
| INV-8 | 外部请求有边界：每个请求有超时，每层有时间与次数预算，每个主机有限速；超预算返回部分结果并标注，不无限等待。 | F04、F05 |
| INV-9 | 存原始，派生可重建：先落规范化快照，展示数据全部由快照派生；标题、URL 等不可再生字段禁止有损截断。 | F07；改进分类器后要能重算历史 |
| INV-10 | 删除优于兼容：不保留旧形态适配层、死代码、孤儿文件；迁移一次做完。 | 「干净整洁」的可执行定义 |
| INV-11 | 小模块：单个源码文件不超过 400 行（数据文件除外），一个模块一个职责。 | Ralph 每轮上下文有限，小文件才改得准 |
| INV-12 | 可达：所有交互键盘可达，重绘不丢焦点，对比度达标；首屏内容不依赖 JS 才能看见。 | F01、F43 |
| INV-13 | 不打扰访客：页面运行时不请求任何第三方域名（字体、汇率、统计一律自托管或在构建期获取）。 | 隐私、速度、大陆可达性 |
| INV-14 | 安全输出：所有外部字符串转义，外部 URL 只允许 `http:` / `https:`，站点带 CSP。 | F46 |
| INV-15 | 界面克制：少用次级标签与说明文字，让布局说话（沿用现有 `AGENTS.md` 原则）。 | 设计一致性 |
| INV-16 | Ralph 边界：循环只在 `ralph/*` 分支工作，不持有生产密钥，不部署生产，不写数据分支。 | 自主循环的爆炸半径必须可控 |

---

## 3. 审查发现

行号对应审查时的工作区（最新提交 `a9c30b0`）；开工提交打了标签 `review-base`，用 `git show review-base:<文件>` 对照。「去向」是 `IMPLEMENTATION_PLAN.md` 里的任务编号。

### 3.1 会导致停更、白屏或丢数据（P0）

| ID | 问题 | 证据 | 去向 |
|---|---|---|---|
| F01 | `data.json` 读取失败时整页空白：`body` 初始 `opacity:0`，只有启动成功才加 `.ready`；失败分支提前 `return`，错误提示和 `<noscript>` 都不可见。 | `index.html:1020, 4009-4013, 4018, 1090` | T1.1 |
| F02 | 评测层「失败沿用上次快照」在线上从未生效：`data.json` 只存瘦身目录，CI 的基线只拉 `data.json`，于是 `prev.bench.boards` 恒为空；任一评测源失败，它的榜单直接消失，`bench.json` 被覆盖。 | `collect.mjs:2719-2729`、`daily-collect.yml:45-51`、`bench.mjs:816` | T1.2 |
| F03 | 发布是整站原子的：任一层红线即整次采集抛错，所有层当天都不更新。实例：LMArena 贡献 137/163 个榜，HF 故障即跌破 `bench.min=120`；Luma 部分采集低于 524 同理；OpenRouter 出现一行 `input=0 && output>0` 也会整站拒发。语义校验没有行级隔离。 | `health.mjs:42, 67, 117-124, 266-277`、`collect.mjs:2711` | T3.5–T3.7 |
| F04 | Luma 429 冷却没有上界：单请求最多睡 180+360+540+720 秒，最后一次睡完不再重试；geo 预算只在两次请求之间检查；job 超时 20 分钟。最近一次采集 `meta.net.blocked=1, maxCooldownMs=180000`，该路径已在生产触发。 | `collect.mjs:1239-1251, 1305`、`daily-collect.yml:34` | T1.3 |
| F05 | 大部分请求没有超时：只有中转站探测和情报两处设置了超时，Devpost、Luma、Devfolio、aibijia、汇率、GitHub、OpenRouter、AA、HN 都依赖 undici 默认值（分钟级）。 | `collect.mjs:667, 1854, 1885` 以外的全部 `fetch` | T1.4, T3.2 |
| F06 | OpenRouter 模型目录不经过分层记账：该源一次失败即整次采集失败，没有沿用路径。 | `collect.mjs:2433-2435` | T1.5 |

### 3.2 数据正确性（P1）

| ID | 问题 | 证据 | 去向 |
|---|---|---|---|
| F07 | 新闻标题入库时截到 96 字且不加省略号，永久丢失，与注释「标题不压」矛盾；归档里已有实例（「…只是经济学的基本原」）。URL 截到 168 字会生成死链并污染去重键（当前归档尚无超过 160 字的 URL，属潜伏）。 | `lib/news.mjs:155-165` | T1.6 |
| F08 | 情报层完全依赖 aihot.news：归档 2,259 条链接全部是 `aihot.news/items/*`，没有原始出处；该站改版或下线即全部失效。 | `news-archive.json`、`collect.mjs:1898` | T6.4 |
| F09 | 情报新鲜度不可见：`fetchNews` 返回合并后的归档，三路源全挂也记为 `fresh`；门禁只查跨度与天数，不查最新一条的年龄。 | `collect.mjs:1920-1948, 2418`、`health.mjs:151-160` | T1.7 |
| F10 | 活动地区判错：正则把 Pakistan / ISLAMABAD 归到印度，与国家码表 `PK→asia` 矛盾；小国归并表把加拿大并入拉美、澳洲并入亚洲；正则同时扫描标题且大量无词边界（`Rio` 命中 `Ontario`，人名 Jordan、Austin、Sofia 命中地名）。 | `collect.mjs:1656, 1180, 1717, 1697` | T1.8, T6.6 |
| F11 | 活动类型判错：`con\b` 命中 “Silicon Valley …”，任何硅谷 meetup 都成了「会议」；`forum` 把 OpenAI Forum 系列判为会议。 | `collect.mjs:1618` | T1.8 |
| F12 | 「AI 活动」混入非 AI 活动：geo 查询词含 `hackathon`，AI 词表又接受 `hackathon`，通用黑客松直接入库；`Runway`、`Gemini`、`Llama`、`Claude` 在非 AI 语境同样命中。精确率从未度量。 | `collect.mjs:1146, 1418-1442` | T6.6 |
| F13 | 时间口径未定义：Luma `start_at` / `end_at` 与情报 `publishedAt` 直接取前 10 位，前端再按 `+08:00` 解释。若源为 UTC，东八区晚间场次与凌晨新闻会错一天（未运行复现，需用回放数据确认）。 | `collect.mjs:1349, 1354, 1894`、`index.html:3212` | T3.4 |
| F14 | 人工数据没有核实日期：README 与方法页承诺「卡片上的日期是核实日期」，但 `CURATED_OFFERS` 没有日期字段，卡片也不渲染；官方直连价被打上 `seen: 今天`，抽屉里显示为「采集日」，把手填价伪装成当日采集。已知到期点：Gemini 4 Argon 促销价 11-30 截止、Fireworks 免费微调 11/30、DeepSeek Search API 10-31 起计费。 | `README.md:220`、`index.html:3696`、`collect.mjs:111, 122, 171, 2463` | T3.8 |
| F15 | 人民币标价按 7.1 预先折成美元写死，而汇率每天更新；`FX_CNY` 定义了却没用；旗舰官方价在 `FLAGSHIP.official` 与 `CURATED_OFFICIAL` 各写一份。 | `collect.mjs:24, 56-79, 254-262` | T3.8 |
| F16 | 来源登记表漏登：订阅行用 `buy` 字段，登记时读 `s.url`，订阅来源从未入表；评测只登记 Vals，另外 8 个源不在表里。 | `collect.mjs:1809, 2594, 2609` | T2.5 |
| F17 | `effVsOfficial` 的官方基准不含缓存价，结果系统性偏向中转站；该字段与 `effSpread`、`groupSpread`、`template`、`templateSame`、`regionRaw`、`geoCityFallback` 都随 `data.json` 发布，页面从不读取；`samples` 只被不可达的 `openRelay` 读取。 | `collect.mjs:2494, 2512, 2519-2554` | T2.2 |
| F18 | 比价表「缓存读」列与「折扣」列共用排序键 `cache`：点「缓存读」实际按折扣率排序，两个表头同时显示排序状态。 | `index.html:1659-1660, 1522` | T1.9 |
| F19 | 中转站页文案写「竖线是官方直连的 $x」，图上没有这条线；前端用展示名拼正则找官方价，`DS V4.1 Flash` 永远匹配不到 DeepSeek。采集端早已算出 `officialRef`，却没有发给页面。 | `index.html:2080, 1981-1988`、`collect.mjs:2491-2495` | T1.9 |
| F20 | 中转站当天探测失败但有旧数据的站从页面整体消失：`live` 只收 `status=ok`，`notLive` 又排除了 `models>0`。 | `index.html:1979, 2046`、`collect.mjs:2499-2501` | T1.9 |
| F21 | 首页价格叙事被情报加载绑住：该区块包在 `news.length ? … : ""` 里，首屏不出现，归档（2.3k 条）拉完后插入造成布局跳动，归档失败则永不出现。 | `index.html:1729-1755` | T1.1 |
| F22 | 首页「评测」入口把 163 个榜写成「163 个模型」；方法页「评测层（163 个模型）：Vals Index 的公开分数」同错且过时。 | `index.html:1710, 3642` | T2.4 |
| F23 | 汇率回退到写死的 7.1 时门禁照样通过，只检查区间，不检查 `source`、`stale`。 | `collect.mjs:874`、`health.mjs:143-144` | T1.7 |
| F24 | 评测与价格靠前端模糊前缀匹配对齐（两个方向都 `startsWith`），可能把别的模型的价格挂上去；跨层没有统一的模型实体。 | `index.html:2797-2816` | T4.4–T4.6 |
| F25 | τ-bench 只取 manifest 前 40 条，若 manifest 按时间正序会漏掉最新提交（顺序未核实）。 | `bench.mjs:455` | T6.8 |
| F26 | 情报打分对标题含「马斯克」直接 −6，会压低 xAI 的模型与价格新闻。 | `lib/news.mjs:43, 56` | T6.4 |
| F27 | Luma 链接仍用 `lu.ma`（已跳转到 `luma.com`）；缺主办方时回退成 `"Luma"`，把平台名当成主办方。 | `collect.mjs:1353, 1359` | T2.6 |

### 3.3 文档与代码漂移

| ID | 问题 | 证据 | 去向 |
|---|---|---|---|
| F28 | README 写 `news-history.json` 逐日累积进仓库，实际是 `news-archive.json` + `news-seed.json`；`news-history.json`、`news-provenance.json` 成了孤儿文件，`health.mjs` 的 `HISTORY` 常量未用，workflow 注释仍写 news-history。 | `README.md:22, 179`、`health.mjs:21`、`daily-collect.yml:17, 79-85` | T2.1, T2.4 |
| F29 | 「评测分数下跌标黄」在 README 与评测页头承诺，代码里不存在任何 delta 计算或渲染（旧实现随死函数 `fetchBench` 一起失效）。 | `README.md:134`、`index.html:1207`、`collect.mjs:2027-2032` | T4.3 |
| F30 | README 说 `data.json` 不进仓库，`.gitignore` 注释说它仍被跟踪。 | `README.md:176-179`、`.gitignore:9-12` | T2.1, T2.4 |
| F31 | 页面文案过时：订阅页与方法页提到 Copilot 档位，数据源里没有；方法页说 Devpost「分页 5 页」、只收 open；`HERO.method` 写「五层数据」；「区价覆盖 49 个国家」是手写数；README「订阅 16 档」，实测 12。 | `index.html:1203, 1209, 3638, 3640, 3673, 3676`、`README.md:78` | T2.4, T5.9 |
| F32 | 品牌残留：采集脚本头注释仍是「FreeAI Radar · 三个数据层」，UA 混用 `FreeAI-Radar/2.0` 与 `IndexAI/1.0`，localStorage 键是 `fr.*`。 | `collect.mjs:1-13, 673`、`index.html:3902` | T2.3 |
| F33 | 健康阈值是手填的「实测值」，`TODO(校准)` 注释已过期（仍写 Luma 463，实测 1,498），且只和上一版比较，不看多日基线。 | `health.mjs:32-71` | T4.7 |

### 3.4 死代码、重复与孤儿文件

| ID | 问题 | 证据 | 去向 |
|---|---|---|---|
| F34 | 采集端：`fetchBench`（旧 Vals 采集）、`decodeNews` 导入、`FX_CNY`、`KIND_LABEL` 未使用；AA 在 `collect.mjs` 与 `bench.mjs` 各有一套抓取与解析。 | `collect.mjs:20, 24, 2006-2038, 2101, 2248-2301`、`bench.mjs:704-760` | T2.2 |
| F35 | 页面端：`renderStarBand` 从未调用，`growBars` 未用，`openRelay` 没有入口（页面不产出 `data-relay`），`vendors` 路由分支与 `[data-benchtab]` 选择器无对应；CSS 中 `.distbar`、`.jump`、`.home-side`、`.starband`、`.sbrow` 无元素；`.starmini` 与 `.pips` 有元素无样式（活动「推荐」指数实际不可见）；动效选择器里的 `.irow`、`.evcard`、`.subrow` 不存在；`window.__newsBuckets` 是全局变量通信。 | `index.html:127-131, 1138, 2198, 2351, 2371, 2719, 3326, 3742, 3786, 3805` | T2.2 |
| F36 | 前端复刻采集端的常量：主题下标表、旗舰清单、有效成本画像（比价页 `s=0.2`、中转页 `s=0.3`，方法页两处都写）。任一端改动另一端就错。 | `index.html:1236-1237, 1278-1280, 1960-1966, 2022-2024`、`collect.mjs:254-266`、`lib/news.mjs:18-30` | T2.5 |
| F37 | 两条发布路径不一致：`deploy.mjs` 写死 `/Users/raki/...`，发布清单漏了 `news-archive.json` 与 `news-milestones.json`，本地发布出的情报页是坏的。设计草稿页 `directions.html`、`logo-preview.html` 被发布到生产。 | `deploy.mjs:9-17, 47`、`daily-collect.yml:69-72` | T2.1, T3.9 |
| F38 | 采集中途写盘：情报归档在门禁之前就写回文件，与「残缺不覆盖」不一致。 | `collect.mjs:1944` | T3.6 |

### 3.5 前端缺陷

| ID | 问题 | 证据 | 去向 |
|---|---|---|---|
| F39 | `.rcard` 同时被订阅区价卡与中转站移动卡使用，移动端区价卡吃到中转站卡的样式。 | `index.html:185, 670, 1911, 2152` | T1.10 |
| F40 | 深色模式缺陷：时间轴黑客松颜色写死 `#0a0a0a`，与深色背景同色不可见；`var(--fg)` 未定义；十余处颜色绕过设计令牌。 | `index.html:2284, 2604, 624, 149-154, 500, 907-909` | T1.10, T5.6 |
| F41 | 移动端出现 8–8.5px 字号；同一媒体查询内规则互相覆盖；`.topnav`、`.home-side` 等选择器多处重复定义。 | `index.html:660, 943-948, 59/71, 687/701/978` | T1.10, T5.6 |
| F42 | 导航是 `role=tab` 的按钮加 `replaceState`：不产生历史记录（返回键直接离开站点），不能在新标签打开，也不符合 tablist 的方向键模式；筛选状态不进 URL，无法分享。 | `index.html:1369-1372, 3798, 3807-3818` | T5.3 |
| F43 | 每次点筛选都整块重写 `#view`，键盘焦点丢失；表格行只能鼠标点开详情；抽屉不是 dialog，不移交、不归还焦点。 | `index.html:3770-3800, 1579, 3891, 3923-3927, 1088, 3709-3741` | T5.4 |
| F44 | 筛选控件重复：厂商下拉与厂商快捷 chip 并存，价格带「免费」与「仅免费」开关并存。 | `index.html:1618-1646` | T5.9 |
| F45 | 汇率在浏览器端直连 `open.er-api.com`，返回后整页重绘一次（首屏闪动、焦点丢失）。 | `index.html:3942-3959, 4019` | T1.11 |

### 3.6 安全与合规

| ID | 问题 | 证据 | 去向 |
|---|---|---|---|
| F46 | 外部链接只做 HTML 转义、不校验协议，情报、挂单、活动等第三方 URL 直接进 `href`；`e.worth` 未转义插值；`_headers` 没有 CSP。 | `index.html:1247, 1938, 2233, 2251, 3595`、`_headers` | T1.12, T5.8 |
| F47 | CI：`npx --yes wrangler@4` 浮动主版本；actions 用标签而非 SHA 固定；Node 20 已于 2026-04-30 EOL；整个 job 持有 contents 与 issues 写权限；bot 每天直接 push 到 `main`，会与任何开发分支（包括 Ralph）持续冲突。 | `daily-collect.yml:16-18, 37-41, 77-88, 122` | T0.6, T3.9, T4.1 |
| F48 | AA 通过 RSC 请求头抓取，注释写明「绕开 key」，与 README 的「不绕过登录」边界冲突。AA 有要求署名的官方免费 API，旧 `/api/v2/data/*` 端点 2026-11-04 退役；OpenRouter 的排行与应用榜有官方 Data API（CC BY 4.0）。两者都要 key。 | `bench.mjs:682-709`、`collect.mjs:2174-2244, 2248-2301` | T2.2, T6.9 |
| F49 | 第三方挂单逐条直链到发卡平台，订阅页给出低价区与合租路子。多数厂商条款禁止账号转售与共享，逐条直链放大了站点被投诉、被下架与用户受损的风险。 | `index.html:1840-1845, 1930-1945`、`collect.mjs:1759-1776` | T2.7 |
| F50 | `serve.mjs` 以整个仓库为根（含 `.git`、`.wrangler`），不校验 Host。只绑 127.0.0.1，风险低，但可被 DNS rebinding 读取。 | `serve.mjs:7-33` | T2.6 |
| F51 | 仓库没有 LICENSE；站点没有面向上游数据的署名页，而 OpenRouter（CC BY 4.0）、AA 等源有署名要求。 | 仓库根目录 | T2.9, T5.10 |

### 3.7 性能与可达性

| ID | 问题 | 证据 | 去向 |
|---|---|---|---|
| F52 | 字体走 `fonts.googleapis.com` 的阻塞样式表，在中国大陆不可靠；`pages.dev` 在大陆的连通性本身也不稳定。 | `index.html:8, 18-19` | T1.11, T2.8, T7.4 |
| F53 | 首页为了 4 条要闻拉整个情报归档；每个页面都先下载约 700 KB 的 `data.json`；评测页一次拉 3.5 MB 的 `bench.json`；对照表每个单元格做一次 `indexOf`。 | `index.html:1688-1692, 3776, 4006, 2752, 2924` | T5.1, T5.2 |

### 3.8 结构性问题

| ID | 问题 | 去向 |
|---|---|---|
| F54 | 零测试、零 lint、零类型检查、没有 `package.json`。Ralph 没有任何回压信号，这是自主迭代最大的障碍。 | M0 |
| F55 | 没有历史：`data.json` 每天覆盖，价格、中转、额度、评测都没有时间序列。「降价」「回退」类结论无从计算，门禁只能和上一版比。 | M4 |
| F56 | 单体文件：`collect.mjs` 把人工数据、抓取、归一、去重、健康、写盘混在一起；`index.html` 约 1,000 行 CSS 加 3,000 行 JS，状态是一个近 50 个字段的全局对象，事件分发是一条近 40 个选择器的 if 链。 | M3, M5 |
| F57 | 人工数据以 JS 常量形态内嵌在采集脚本里（官方价、免费额度、信号、中转站、工具箱），没有 schema、没有到期提醒、没有证据字段。 | T3.8 |

---

## 4. 目标架构

### 4.1 数据流

```
上游源 ──ctx.http（超时·限速·预算·记录/回放）──▶ fetch
      ──▶ normalize（schema 校验，坏行隔离）
      ──▶ merge（与上一版快照合并：TTL、lastSeen、部分结果补齐）
      ──▶ health（层级门禁：ok / warn / red）
      ──▶ 通过：写快照　未通过：保留上一版并记 stale
      ──▶ derive（跨层对齐、有效成本、变化流、价格序列）
      ──▶ site/build（预渲染多页 + 分层数据文件 + manifest）
      ──▶ 发布 ──▶ 线上自检
```

站点是 `(代码, 数据快照)` 的纯函数。任何一天的站点都能用当天的快照重建，测试用小型快照离线构建。

### 4.2 存储分工

| 位置 | 内容 | 谁写 |
|---|---|---|
| `main` 分支 | 代码、人工输入（`curated/`）、实体注册表（`registry/`）、测试与回放数据（`fixtures/`） | 人与 Ralph，经 PR |
| `data` 分支（orphan） | 每层最近一次通过门禁的快照、每次尝试的状态日志、情报月度分片、派生的序列与变化流 | 只有 CI bot |
| Actions artifact | 当次上游原始响应，保留 30 天，用于排障与重放 | CI |

`data` 分支替代现在「bot 每天往 `main` 提交归档」的做法，开发分支不再和数据提交冲突。是否改用独立仓库或 R2 见 D1。

### 4.3 目录

```
├─ AGENTS.md  UPGRADE_PLAN.md  IMPLEMENTATION_PLAN.md  PROMPT_build.md  loop.sh
├─ README.md  LICENSE  _headers  favicon.svg
├─ package.json  package-lock.json  .node-version  tsconfig.json  biome.jsonc  playwright.config.js
├─ assets/      自托管字体与静态图片
├─ curated/     official-prices · offers · signals · relays · toolkit · milestones（JSON）
├─ registry/    vendors.json · models.json
├─ pipeline/
│  ├─ run.js                 入口：选层、注入上下文、编排、写快照
│  ├─ layers/<id>/           fetch.js · normalize.js · health.js · index.js
│  ├─ derive/                跨层对齐、有效成本、变化流、序列
│  └─ publish/               manifest、last-good 合并
├─ lib/         http · clock · schema · cost · html · format · geo · text · log
├─ site/
│  ├─ build.js               快照 → dist/
│  ├─ routes/                每个路由一个文件：路径、标题、数据依赖、视图
│  ├─ views/                 纯函数 (data, state) → HTML，构建期与浏览器共用
│  ├─ client/                浏览器入口：交互增强与局部重绘
│  └─ styles/                tokens.css 与组件样式
├─ types/       数据契约的 .d.ts（供 JSDoc 与 checkJs 使用）
├─ scripts/     check-invariants · make-fixture-data · data-pull · serve
├─ test/        unit · golden · contract · e2e · support（回放与录制的预加载）
└─ fixtures/    http 回放 · golden 输出 · 标注集 · 小型数据快照
```

全部用 `.js` 加 `"type": "module"`，现有 `.mjs` 在迁移时一次改名。

### 4.4 层契约

每个数据层是一个模块，导出同一形状。编排器只认这个形状，不认具体层。

```js
export default {
  id: 'models',
  sources: ['openrouter', 'curated:official-prices'],   // 登记来源，自动进来源表
  budget: { ms: 60_000, requests: 30 },                 // 超出即返回部分结果
  fetch: async (ctx) => raw,                            // 只能经 ctx.http / ctx.curated
  normalize: (raw, ctx) => ({ records, quarantined }),  // 逐行 schema 校验，坏行隔离并说明原因
  merge: (prev, next, ctx) => records,                  // 部分结果与上一版合并（TTL、lastSeen）
  health: { floor, shrink, freshness, rules },          // 层级门禁，规则与层放在一起
};
```

`ctx` 提供 `now`、`today(tz)`、`http`、`curated`、`registry`、`prev`（上一版快照）与 `log`。层模块不得读写文件、不得直接 `fetch`、不得调用 `Date.now()`。

### 4.5 发布物

```
dist/
├─ index.html  compare/  models/<id>/  vendors/<id>/  free/  subs/  relays/
│  events/  bench/  news/  tools/  method/  status/  changes/
├─ assets/               带内容哈希的 JS、CSS、字体
├─ data/manifest.json    不缓存：每层文件名、哈希、status、as_of、last_ok、计数、门禁结论
├─ data/<layer>.<hash>.json      长缓存（immutable）
├─ data/news/<YYYY-MM>.<hash>.json
├─ feeds/changes.xml  feeds/events.ics
└─ sitemap.xml  robots.txt  _headers
```

页面首屏是预渲染好的 HTML，交互需要的数据按层懒加载。层失败时 manifest 指向上一版文件，页面据此显示该层的「沿用 N 天」标记。

---

## 5. 规格

每节描述目标状态与验收口径。实现方式由 Ralph 决定，除非本节明确规定。

### S1 工程地基

**S1.1 运行环境。** `.node-version` 固定 Node 24（Active LTS），`engines.node` 写 `>=24`。Node 26 于 2026-10-28 进入 LTS，升级作为单独任务（T7.1）。

**S1.2 包与依赖。** `package.json` 为 `"private": true`、`"type": "module"`，没有 `dependencies` 字段。`devDependencies` 只允许：`typescript`、`@types/node`、`@biomejs/biome`、`@playwright/test`、`@axe-core/playwright`、`wrangler`，全部精确版本，提交 `package-lock.json`，CI 用 `npm ci`。新增开发依赖需在 `IMPLEMENTATION_PLAN.md` 写明理由。

**S1.3 命令。**

| 命令 | 作用 |
|---|---|
| `npm run lint` | Biome 检查 JS / JSON / CSS |
| `npm run typecheck` | `tsc --noEmit`，`allowJs` + `checkJs`，类型用 JSDoc 与 `types/*.d.ts` |
| `npm test` | `node --test`：unit、golden、contract，强制回放模式，不访问网络 |
| `npm run test:e2e` | Playwright：路由、溢出、控制台错误、键盘流程、axe、外部请求、截图 |
| `npm run invariants` | 架构适应度检查（S1.5） |
| `npm run build` | 用指定快照（默认 `fixtures/data/`）生成 `dist/` |
| `npm run verify` | 以上全部，任何一步失败即失败；目标耗时 3 分钟内 |
| `npm run collect` | 真实采集（CI 每日运行；本地只为排障运行） |
| `npm run record` | 以测试档位真实请求一遍并写回放数据（M3 起支持 `-- <layer>`） |
| `npm run golden:update` | 重写 golden，提交信息必须说明差异来源 |
| `npm run data:pull` | 把 `data` 分支拉到 `.data/`，用于本地真实数据构建 |

命令随任务落地逐步加入，不预先写空壳。

**S1.4 测试分层。**

- unit：纯函数（日期解析、表达式计价、分组倍率、地区与类型推断、摘要压缩、归档合并、Parquet 读取、名称归一）。
- golden：采集在回放模式、固定时钟、测试档位（缩小查询集合，生产默认值不变）下跑一遍，输出与 `fixtures/golden/` 逐字节相同。更新 golden 必须在提交信息里说明哪些差异是预期的。
- 回放数据保持小而真实：`fixtures/http/` 不超过 5 MB，`fixtures/golden/` 不超过 3 MB，`fixtures/data/`（页面测试用的裁剪快照）不超过 1 MB。
- contract：视图函数接受当前 schema 的快照；schema 版本变化时旧快照必须被明确拒绝。
- e2e：见 S9.8。
- 质量回归集：活动 AI 相关性、类型、地区，情报主题，模型名对齐，各有标注集与最低指标（S8）。

**S1.5 架构适应度检查（`scripts/check-invariants.js`）。** 每条失败都给出文件与行号。规则随任务逐条启用，启用顺序见 `IMPLEMENTATION_PLAN.md`。

| 规则 | 内容 |
|---|---|
| R1 | `package.json` 没有 `dependencies` |
| R2a | 采集端：`fetch(` 只出现在 `lib/http.js` |
| R2b | 采集端：取当前时间（无参 `new Date()`、`Date.now()`）与睡眠只出现在 `lib/clock.js` |
| R2c | 浏览器端：`fetch(` 只在 `site/client/data.js` 且只请求同源，当前时间只从 `site/client/clock.js` 取 |
| R3 | 源码文件不超过 400 行（`curated/`、`registry/`、`fixtures/`、`types/` 除外） |
| R4 | 十六进制颜色只出现在 `site/styles/tokens.css` |
| R5 | `TODO` / `FIXME` 必须带任务编号，例如 `TODO(T4.2)` |
| R6 | 不出现绝对用户路径（`/Users/`、`/home/`） |
| R7 | `innerHTML` 赋值只出现在 `site/client/render.js` |
| R8 | 仓库根目录只有白名单文件；`dist/` 只有构建清单里的文件 |
| R9 | fixtures 各目录不超过 S1.4 的体积上限 |
| R10 | 用量画像（缓存命中率、输出占比等参数）只在 `lib/cost.js` 定义 |
| R11 | 每个 CSS 选择器只定义一次 |
| R12 | 工作流里的 `uses:` 全部是 40 位 SHA；不出现 `npx --yes`、Node 20 |

**S1.6 CI。** `verify.yml` 在每个 PR 与 `ralph/*` 分支推送时运行 `npm run verify`，`main` 设为必须通过。所有 actions 固定到 commit SHA，使用运行在 Node 24 上的主版本；默认 `permissions: contents: read`，写权限只给需要的 job。

### S2 采集运行时

**S2.1 HTTP 客户端（`lib/http.js`）。** 全项目唯一的网络出口。

- 每个请求必有超时（默认首字节 20 秒、总计 60 秒），并与所在层的截止时间合并（`AbortSignal.any`）。
- 重试只针对幂等 GET 的网络错误与 408 / 429 / 5xx，指数退避加抖动，遵守 `Retry-After`。
- 按主机配置策略：并发上限、最小间隔、429/403 冷却时长、单主机冷却总上限、最大重试次数。策略表集中在一个文件，层代码不得自定义睡眠。
- 记账：每个主机的请求数、字节数、状态码分布、重试次数、被限流次数、累计等待时间，写进运行报告。
- 统一 UA：`IndexAI/<version> (+https://indexai.pages.dev)`，版本取自 `package.json`。
- 三种模式：`live`、`record`（真实请求并落盘到 `fixtures/http/`）、`replay`（只读回放，缺失即报错）。测试强制 `replay`。
- 只允许 `http:` / `https:`，重定向目标同样校验。

**S2.2 时钟与时间口径（`lib/clock.js`）。**

- `ctx.now` 由编排器注入，测试固定为 `2026-10-24T01:00:00Z`。
- 存储一律 ISO 8601 带时区偏移；只有日期的字段必须注明时区。
- 活动存 `startAt` / `endAt`（ISO）与 `tz`（源提供时）；状态判定用活动所在时区的「今天」，展示用访客时区。
- 情报存 `publishedAt`（ISO），按 `Asia/Shanghai` 归日。
- 先用回放数据确认各源时间戳的真实时区，结论写进对应层的 `normalize.js` 注释（F13）。

**S2.3 预算。** 整次运行截止 15 分钟（job 超时设 25 分钟）。每层有时间与请求数预算，冷却等待计入预算。超预算时停止该主机，返回已拿到的部分并标记 `partial`，原因写进报告。Luma 的有状态封禁（实测约 3 分钟解封）用「单主机冷却总上限」约束，不再出现单请求睡 30 分钟。

**S2.4 运行报告。** 每次运行产出 `run-report.json`：每层的状态、计数、耗时、请求账目、`partial` 原因、隔离行数与原因、警告。CI 把它写进 job summary，并作为 artifact 保留。

### S3 管线与发布

**S3.1 编排。** `pipeline/run.js` 按依赖顺序运行各层（采集层并行，派生层在后），支持 `--layer <id>` 单独运行。输出顺序稳定：记录按主键排序，对象键按 schema 顺序。

**S3.2 坏行隔离。** `normalize` 逐行校验 schema，不合格的行进 `quarantined` 并附原因，不进快照。只有隔离比例超过该层阈值（默认 2%）或跌破下限时才判红。现在「一行 `input=0 && output>0` 就整站拒发」改为「隔离这一行并在状态页列出」。

**S3.3 合并策略。** 每层声明一种：

| 策略 | 适用层 | 规则 |
|---|---|---|
| 目录型 | 模型、中转站、订阅 | 今天没拿到的条目沿用上一版并记 `lastOk`；超过 TTL（中转站 14 天，其余 3 天）才移除 |
| 场次型 | 活动 | 与上一版里未结束、`lastSeen` 不超过 3 天的场次取并集；部分采集不再导致数量塌缩 |
| 归档型 | 情报 | 只增不删，按月分片 |
| 人工型 | 额度、官方价、信号、工具箱、大事件 | 直接读 `curated/`，校验到期日 |

**S3.4 写快照。** 只有门禁通过后才写，先写临时文件再原子改名；运行中任何阶段都不改动已有快照（F38）。

**S3.5 发布。** 构建从快照生成 `dist/`，层失败时沿用上一版快照对应的文件并在 manifest 标 `stale`。部署后拉线上 manifest，核对每层哈希与本次一致；不一致即告警。`ALLOW_DEGRADED` 改为按层放行：`--allow-degraded <layer>`，放行记录写进 manifest 与页面。

### S4 健康与可观测

**S4.1 层级门禁。** 每层的门禁与层代码放在一起，包含：

- 下限：绝对最小值，只拦灾难性失败，数值保守且稳定。
- 缩水：相对最近 7 次成功快照计数的中位数，而不是只比上一版。历史可用之前（M4 前）沿用现有阈值。
- 新鲜度：每个源最新条目的年龄。例：情报最新一条不超过 36 小时；活动最近 3 天内有新增；汇率 `source` 不是回退值。
- 语义规则：现有规则全部保留，迁入对应层，按行隔离而非整层判死。
- 结论：`ok` / `warn` / `red`。`red` 保留上一版，`warn` 发布但在页面标注。

**S4.2 告警。** 同一层连续两次 `red` 或 `stale`：开或追加带 `layer:<id>` 标签的 issue；恢复后自动评论并关闭。不再按日期开 issue。

**S4.3 页面可见性。** 每页只显示本页所用层的状态（例如「中转站数据沿用 2 天」），全站横幅只在有层 `red` 或沿用超过 1 天时出现。

**S4.4 状态页 `/status/`。** 每层、每个源最近 30 次运行的状态、计数趋势、耗时、请求账目与被限流次数，数据来自 `data` 分支的状态日志。

### S5 历史与变化

**S5.1 快照即历史。** `data` 分支每天一个提交，只提交有变化的层。快照稳定排序、一行一条记录，git 的增量压缩让每日成本只有变化行；`git log -p snapshots/models.json` 就是价格史。

**S5.2 变化引擎（`pipeline/derive/changes.js`）。** 比较今天与上一版快照，产出类型化的变化事件：

| 层 | 事件 |
|---|---|
| 模型 | 新增、下架、输入/输出/缓存读/缓存写价格变化（旧值、新值、幅度）、上下文变化 |
| 免费额度 | 新增、移除、额度文本变化、到期 |
| 订阅 | 任一区价变化超过 1%、新档位、下架 |
| 中转站 | 旗舰价变化、上线/下线、新站 |
| 评测 | 新榜、各榜前 20 名次变化、同一模型分数下降超过阈值（兑现 F29 的承诺） |
| 活动 | 新增的高价值场次（奖池或报名数超过阈值） |

输出 `changes/<date>.json`、Atom 源 `feeds/changes.xml`，以及首页「今日变化」模块。

**S5.3 价格序列。** `series/models/<id>.json` 只存变化点 `[{date, channel, input, output, cacheRead, cacheWrite}]`，模型详情页据此画价格线。中转站、订阅区价同理。

**S5.4 回填。** 历史从 `data` 分支第一天开始积累。可选的一次性回填：用 Wayback 存档里的线上 `data.json` 补价格史，回填记录标 `backfill: true`。

### S6 统一实体

**S6.1 厂商表 `registry/vendors.json`。** `id`、显示名、各源别名（OpenRouter 前缀、AA 的 creator 名、LMArena 的 organization）、所属区域、官网与定价页。替代现在的 `VENDOR` 常量和前端的 `VENDOR_RANK`。

**S6.2 模型表 `registry/models.json`。** 规范 ID 形如 `anthropic/claude-opus-5.5`；字段有显示名、厂商、发布日期、模态、上下文、状态、`flagship`，以及按源分组的精确别名（OpenRouter id、官方 model id、AA slug、LMArena 名、评测名、中转站模型名）。推理档位（thinking / high / max）挂到父模型下，用 `variant` 区分。

**S6.3 匹配规则。** 精确别名 → 归一后精确相等（小写、去厂商前缀、统一分隔符）→ 否则判为未匹配。禁止前缀与模糊匹配（F24）。

**S6.4 未匹配报告。** 每个源的未匹配名称与出现次数写进 `status/unmatched.json` 并在状态页列出。补别名是一类常规任务；LLM 可以离线提议别名，经审阅后提交，运行时不调用 LLM。

**S6.5 质量线。** OpenRouter 用量前 100 的模型与全部旗舰匹配率不低于 95%；每个评测榜前 30 名匹配率不低于 90%。中转站的旗舰对比改由 `flagship` 标记与别名驱动，页面不再拼正则（F19）。

### S7 人工数据

**S7.1 结构。** `curated/*.json`，每个文件带 `schema` 版本。每条记录至少有：`id`、`verified_at`（人工核实日）、`review_by`（下次复核日）、`evidence: [{url, quote, captured_at}]`。价格与额度类记录另有 `valid_from` / `valid_until`。

**S7.2 价格建模。**

- 按官方原币与原数字存储（人民币就是人民币），美元价在构建期用当天汇率折算，并记录所用汇率与日期（F15）。
- 分档价：`tiers: [{upTo, input, output, cacheRead, cacheWrite}]`（如 Haiku 5.5 的 ≤100K / >100K）。
- 分时价：`schedule: [{days, from, to, tz, multiplier}]`（如 DeepSeek 工作日高峰 ×2）。
- 其它独立 SKU：Batch 折扣、缓存写入的不同 TTL、Fast / Priority 档，各自成行，不折叠成「最低价」。

**S7.3 预定变化。** 已知的未来价格变化写成两条有效期首尾相接的记录（Gemini 4 Argon：`valid_until: 2026-11-30` 与 `valid_from: 2026-12-01`），到期自动切换，不依赖人在当天改文件。

**S7.4 门禁与展示。** `review_by` 进入 7 天内为 `warn`；过期的记录在页面标「待复核」，并且不参与「最低价」「同族最低」等结论。卡片与抽屉显示「核实于 YYYY-MM-DD」与证据链接，兑现 README 的承诺（F14）。`verified_at`（人工确认数字）与 `checked_at`（机器确认页面未变，见 S8.8）分开显示。

### S8 各数据层

**S8.1 比价。**

- 有效成本只在 `lib/cost.js` 定义一次，含缓存写入项 `w`。用量画像集中定义（例如 对话、agent 编程、RAG、批处理），比价页、中转页、方法页都从同一个对象读取默认值与说明（F36）。
- 分档、分时、Batch 在表里可见：默认按第一档、非高峰计算，单元格提示其它档位。
- 「同族最低」改用实体表的模型 ID，不再用正则拼的 `familyKey`。

**S8.2 免费额度。**

- 额度结构化：`quota: {amount, unit, period, scope}`（单位如 requests / tokens / credits / usd，周期如 day / month / once），原文另存，以便按价值排序。
- 到期自动归档到「已结束」，不再挂在在架列表里。
- 当前 7 条 `confidence: low` 的记录（`collect.mjs:126-146`，多为前端渲染页抓不到正文）列为复核任务，补证据或下架。

**S8.3 订阅。**

- 结构：产品 → 档位 → 渠道（App Store 各区 / 官网）→ 价格（币种、是否含税、核实日）。
- 官网价作为第二渠道人工维护并附证据，页面可以对比「App Store 价 vs 官网价」。
- 降低对 aibijia 的单点依赖：App Store 公开商品页作为交叉校验源（可选，低优先级）。
- 第三方挂单只展示每个产品的挂单数、在售数与价格区间（最低、中位、最高），不下发、不展示任何商品页链接（D3）。「买法」一节保留文字说明与风险标注，不放链接。

**S8.4 中转站。**

- 名单迁入 `curated/relays.json`，带 `added_at`、`discovered_via`；移除站点留下记录与原因。
- 探测失败但在 TTL 内的站照常显示，标「上次成功 N 天前」（F20）。
- 每站的旗舰价序列与 30 天可用率（探测成功次数 / 总次数）。
- 页面写明「N 家是同一个价目模板」：模板分组由派生层计算并下发（T2.2 先删掉现在只写不读的版本）。
- 分组名带「逆向」「特价」等字样的分组标风险，不参与代表价与最低可达价，页面只显示被排除的分组数（D3）。

**S8.5 活动。**

- AI 相关性：活动形态词（hackathon、devday 等）单独出现时不算命中；每条记录写 `matchedBy`（命中的规则与词）。
- 标注集 `fixtures/labels/events.json` 不少于 300 条，按来源分层抽样，字段为 `isAI`、`kind`、`region`。质量线：AI 精确率 ≥ 0.95、召回率 ≥ 0.85，类型准确率 ≥ 0.90，地区准确率 ≥ 0.95，`region=other` ≤ 10%。
- 地区：国家码优先；其次用地名表（城市 → 国家，含中文名，一次生成后入库）；只匹配地点字段，永不匹配标题；短词一律带词边界。地区按 ISO 代码存储，展示分组只在一个字典里定义：「中国大陆」与「港澳台」分开显示（D11）。
- 跨源去重：规范化 URL，加上「标题相似 + 同日 + 同城」。
- 时区按 S2.2；`lu.ma` 链接改 `luma.com`；没有主办方就留空。
- 提供 `feeds/events.ics`，可按类型与地区过滤。

**S8.6 评测。**

- 每个评测源独立门禁：单源失败只让本层 `warn`，其它源照常发布，失败源沿用上一版快照里它自己的榜（F02）。
- AA 只保留一套接入，方式按 D2。
- 每个榜一个数据文件按需加载，目录与统计进 manifest；名次在构建期预计算，页面不再逐格 `indexOf`。
- 名次与分数变化由变化引擎产出，页面标出「较上次下降」（F29）。
- `lib/parquet` 用录制的 HF 文件做 golden 测试；解析失败时退到 HF dataset viewer 的 JSON 接口（`/rows`）。
- 新增评测源须同时满足：官方维护、公开可下载、近 6 个月有更新、口径能在方法页说清楚。

**S8.7 情报。**

- 每条存原始出处 `url` 与聚合入口 `via`；从聚合页解析原始链接，去重以规范化后的原始 URL 为键（F08）。
- 源多样化：厂商官方博客与 changelog 的 RSS / Atom、指定开源仓库的 GitHub releases、HN 上的 AI 相关热帖。每个源有独立权重与新鲜度门禁。
- 事件聚类：48 小时内标题高度相似的条目合并为一个事件，显示来源数。
- 主题分类与打分规则集中在一个文件；标注集不少于 300 条标题，主题 macro-F1 ≥ 0.80；去掉按人名扣分（F26），改为按主题相关性打分。
- 原始摘要入快照，压缩版只用于展示；标题、URL 不截断（F07）。
- 按月分片；首页只读构建期算好的精选，不再拉整个归档。

**S8.8 一手信号与官方页面监测。**

- 现有 21 条信号迁入 `curated/signals.json`。
- 监测器：对人工数据里每个证据 URL 每日抓取，去掉脚本、样式、导航后归一化正文并取哈希。哈希变化时产出带前后文的差异摘录，进入状态页「待复核」，并开带 `review:pricing` 标签的 issue；人或 Ralph 核实后更新 `curated/` 与 `verified_at`。
- 哈希未变时自动刷新 `checked_at`；前端渲染、正文抓不到的页面标 `watch: false` 并写明原因。
- 这层把「一手信号」从手写常量变成自动发现、人工确认的流水线。

**S8.9 工具箱。** 迁入 `curated/toolkit.json`，带 `added_at`。每日从 GitHub 校准星数、许可、最近推送；已归档或 180 天无推送标「停更」。投稿走 issue 模板（D10）。

**S8.10 采纳与声量。** OpenRouter 排行按 D2 改用官方 Data API 并按 CC BY 4.0 署名；在此之前保留页面解析，但必须有 golden 测试与 schema。HN 匹配用整词、最短 4 个字符，只统计近 12 个月。

### S9 前端

**S9.1 架构。** 预渲染的多页站点，不引入框架，不需要打包器。

- 视图是纯函数 `view(data, state) → html`，构建期用来预渲染，浏览器里用来局部重绘，同一份代码。
- 每个路由一个浏览器入口模块，只负责交互增强。所有 DOM 写入经 `site/client/render.js` 这一个出口，按区域重绘（筛选区、列表区分开），重绘后恢复焦点与滚动位置。
- 状态放在 URL 查询参数里，任何筛选结果都能复制链接分享。
- 跨页切换用 View Transitions（`@view-transition { navigation: auto; }`）渐进增强，不支持的浏览器就是普通跳转。
- 只有预算超标时才引入 esbuild 做压缩，且只作为开发依赖。

**S9.2 路由。**

| 路径 | 内容 |
|---|---|
| `/` | 今日变化、关键事实、入口 |
| `/compare/` | 模型比价表（筛选、排序、画像） |
| `/models/<id>/` | 模型详情：各渠道价格、价格史、评测、谁在转售、相关免费额度与新闻 |
| `/vendors/<id>/` | 厂商详情 |
| `/free/` `/subs/` `/relays/` `/events/` `/bench/` `/news/` `/tools/` | 各层 |
| `/changes/` | 变化流（按日） |
| `/method/` | 口径说明，由代码常量生成 |
| `/status/` | 数据健康 |

旧的 `#compare` 这类入口由首页的入口模块跳转到新路径（不写内联脚本，见 S10.1）。

**S9.3 数据加载。** 首屏 HTML 自带本页首屏数据；交互所需的层数据从 manifest 指向的文件懒加载；评测按榜、情报按月加载；首页数据在构建期单独产出。没有任何页面需要完整的 `data.json`。

**S9.4 可访问性。**

- 导航是带 `aria-current` 的普通链接；排序表头是 `th` 里的 `button`，带 `aria-sort`；详情用 `<dialog>`，打开时移交焦点、关闭后归还。
- 表格里模型名是链接，通向 `/models/<id>/`，不再依赖整行点击。
- 任何文字不小于 10px，正文不小于 11px；文字对比度满足 WCAG AA；尊重 `prefers-reduced-motion`。
- 不开 JS 也能看到首屏内容：入场动画只在 `<html class="js">` 且未开启减弱动效时生效。
- 自动化检查覆盖不了的部分（读屏体验等）需要定期人工复核，axe 通过不等于完全合规。

**S9.5 视觉系统。**

- `site/styles/tokens.css` 定义颜色、间距、字号阶梯、圆角、动效时长；组件样式只引用令牌。深色模式只换令牌值，不写第二套组件样式。
- 默认跟随 `prefers-color-scheme`，手动切换覆盖系统设置。
- 每个选择器只定义一次；类名按组件命名空间（例如 `.relay-card`、`.region-card`），杜绝 F39 这类碰撞。
- 颗粒纹理、滚动叙事这类装饰在 T5.9 评审时决定去留，前提是满足性能预算且不挤占首屏信息。

**S9.6 字体。** Inter 与 IBM Plex Mono（均为 OFL 许可）的拉丁子集 woff2 自托管，`font-display: swap` 并预加载；中文走系统字体（PingFang SC、Noto Sans SC）。

**S9.7 性能预算。** 由构建脚本与 e2e 共同执行：

| 指标 | 上限 |
|---|---|
| 任一路由首屏传输（HTML + CSS + JS，brotli，不含字体） | 120 KB |
| 任一懒加载数据请求（brotli） | 300 KB |
| CLS（e2e 实测） | 0.05 |
| 首屏渲染期间的长任务（4 倍 CPU 降速） | 不超过 200 ms |

**S9.8 e2e。** 每个路由在 360 / 768 / 1280 三种宽度、浅色与深色下检查：

- 无控制台错误；无横向溢出（`scrollWidth ≤ clientWidth`）。
- axe 无 serious / critical 级问题。
- 键盘：Tab 能到达所有控件；激活筛选后焦点仍在原控件上；详情对话框可用键盘打开与关闭。
- 不请求任何非同源地址。
- DOM 快照对比（与平台无关，本地与 CI 结果一致）作为重构的回归网；快照只能在任务目标本身是界面改动时更新，并在提交信息说明。
- 截图对比只在 CI 的 Linux 容器里执行（字体渲染随系统变化），基线由专用工作流生成；本地截图只作为审美评审的输入。
- 禁用 JS 后主体内容仍然存在。

**S9.9 SEO 与分享。** 站点地址只在 `package.json` 的 `homepage` 定义一次（换自定义域名只改这一处，D4）。每个路由有独立标题、描述、canonical；生成 `sitemap.xml` 与 `robots.txt`；用 schema.org `Dataset` 的 JSON-LD 描述公开数据（含许可与下载地址）；模型详情页标题直接写价格（例如「Claude Opus 5.5 价格：输入 $4 / 输出 $20 · IndexAI」）。默认分享图为仓库内的静态 PNG。

**S9.10 文案。** 统一术语（有效成本、代表分组、最低可达价、沿用、待复核）；删掉布局已经表达清楚的次级说明（INV-15）；页面上的统计数字一律来自数据。

### S10 安全与运维

**S10.1 响应头（`_headers`）。**

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self';
  style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self';
  connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'
Cross-Origin-Opener-Policy: same-origin
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
```

`style-src-attr 'unsafe-inline'` 只为条形图的 `style="--w:…"` 保留，值全部是构建期算出的数字。

**S10.2 外部 URL。** `normalize` 阶段丢弃非 `http(s)` 链接并记入隔离原因；渲染层的 `safeUrl()` 再校验一次；外链统一 `rel="noopener"`。

**S10.3 CI。** actions 固定 SHA；每个 job 最小权限，部署密钥只出现在部署 job；wrangler 来自 lockfile；Dependabot 每周更新 actions 与开发依赖，分组提交。

**S10.4 对上游客气。** UA 带站点地址；HTML 抓取先查 `robots.txt`（每日缓存）；支持 ETag / `If-Modified-Since` 的源走条件请求；所有并发与间隔都在主机策略表里。

**S10.5 本地预览。** 预览服务只服务 `dist/`，拒绝点文件，Host 只接受 `127.0.0.1` 与 `localhost`。

### S11 文档

- `README.md`：是什么、怎么跑、怎么加数据、架构一图，链接到本文件。不写任何会过期的统计数字。
- `AGENTS.md`：Ralph 每轮必读，只写操作信息（命令、目录约定、已知坑），不超过 60 行，保留现有的「少用次级标签」原则。
- 方法页由 `lib/cost.js`、各层的 `sources` 与门禁声明生成，与代码不可能不一致。
- 决策记录只写在本文件 §9，不另建 ADR 目录。

---

## 6. 里程碑

顺序即优先级：前一个里程碑的退出条件满足后才进入下一个。任务、步骤、依赖与验收都在 `IMPLEMENTATION_PLAN.md`。

| 里程碑 | 目标 | 退出条件 | 任务 |
|---|---|---|---|
| M0 护栏 | 不改行为，只建回压 | `npm run verify` 在本地与 CI 都通过；现有采集与页面行为被单元测试、golden、DOM 快照锁住 | T0.1–T0.6 |
| M1 止血 | 修掉停更、白屏、丢数据 | 去向为 T1.x 的发现全部关闭，对应的 `todo` 用例转正并通过 | T1.1–T1.12 |
| M2 清理 | 删掉不该存在的东西，落实已定决策 | 去向为 T2.x 的发现全部关闭；R5、R6、R8（根目录部分）、R10 启用 | T2.1–T2.9 |
| M3 管线 | 分层、有边界、可隔离 | 任一层失败不影响其它层发布；外部请求全部受策略表约束；人工数据有 schema 与到期日 | T3.1–T3.9 |
| M4 资产 | 历史、变化、统一实体 | 站点能回答「什么变了」与「这个模型在各处多少钱、多强」 | T4.1–T4.8 |
| M5 前端 | 预渲染、可达、快 | S9 全部条目由 e2e 与构建检查执行；`index.html` 单体文件不复存在 | T5.1–T5.10 |
| M6 增长 | 让索引变成工具 | 按价值逐个交付，每项独立验收 | T6.1–T6.12 |
| M7 持续 | 长期维护 | 没有终点，按节奏执行 | T7.1–T7.4 |

---

## 7. 完成定义

每个任务提交前全部满足：

1. `npm run verify` 通过。
2. 一次只做一个任务，提交信息以任务编号开头，例如 `T1.3: cap Luma cooldown within geo budget`。
3. 新行为有测试；修缺陷先写出能复现的失败用例。
4. golden、DOM 快照、截图基线、门禁阈值的任何改动，都在提交信息里逐条说明原因。
5. 数据契约变化时，schema 版本、fixtures、contract 测试同步更新。
6. 被替代的旧代码当场删除，不留注释掉的代码，不留兼容分支。
7. 行为变化同步到方法页与 README；`IMPLEMENTATION_PLAN.md` 标记完成并记下新发现。
8. 改动 `curated/` 时附证据 URL 与 `verified_at`。

---

## 8. Ralph 运行指南

### 8.1 循环

- 只用 build 模式：`bash loop.sh [轮数]`。每轮把 `PROMPT_build.md` 交给一个全新上下文，完成 `IMPLEMENTATION_PLAN.md` 中第一个可做的任务，提交、推送后退出。
- 没有可做的任务时 Ralph 写 `.ralph/DONE`，循环结束；连续两轮异常退出或连续三轮没有新提交，循环自动停下。
- 计划由 Opus 编写。计划明显偏离事实时停下循环，让 Opus 重写计划，不交给 plan 模式。

### 8.2 分支与安全

- Ralph 只在 `ralph/work` 上工作。每个里程碑完成时开 PR 到 `main`，人用 merge commit 合并（保留按任务的提交）；每个里程碑开始前 Ralph 把 `origin/main` 合并进来，不 rebase、不强推。
- `main` 开启分支保护，要求 PR 与 `verify` 检查通过。
- 循环环境里没有生产密钥：不设 `CLOUDFLARE_*`，本机不保留 wrangler 登录态，`loop.sh` 启动时会检查。推荐在容器里运行；直接在本机运行意味着 Claude 可以读写本机文件。
- 回放数据由 Ralph 自己录制，只访问公开接口；每个上游每天最多录一次，Luma 按策略表的间隔。

### 8.3 审美评审（非确定性回压）

确定性检查（溢出、对比度、焦点、预算）放进 e2e。审美类判断在每个前端里程碑结束时跑一次：Playwright 对全部路由截 3 种宽度 × 浅深两色，Ralph 以 review 模式逐张判定下列条目，每条只答通过或不通过并给一句理由，不通过的转成任务：

1. 首屏主角明确，一眼知道这一页回答什么问题。
2. 没有文字重叠、截断、溢出，数字列对齐，单位清楚。
3. 浅色与深色都清晰可读，强调色只用在需要注意的地方。
4. 没有布局已经说明白的冗余文字。
5. 同类信息在不同页面样式一致。

### 8.4 观察信号

| 现象 | 处理 |
|---|---|
| Ralph 重复实现已有工具函数 | 在 `AGENTS.md` 的约定里写明它的位置 |
| 为让测试通过而改 golden 或快照 | 收紧 `PROMPT_build.md` 的护栏，必要时把 golden 目录设为需人审 |
| 同一任务连续三轮未完成 | 任务过大，在计划里原位拆分，或补一个更小的前置任务 |
| 计划越来越乱 | 停下循环，请 Opus 按代码现状重写计划 |
| 规格与代码事实冲突 | Ralph 记进「发现」，人修改本文件 |

---

## 9. 决策

2026-10-24 由项目所有者确认：全部按默认意见执行。以后改变决策时，在对应行写新结论与日期，并同步受影响的任务。

| ID | 问题 | 结论 | 落地 |
|---|---|---|---|
| D1 | 数据快照存哪 | 本仓库的 orphan `data` 分支；原始响应只留 Actions artifact 30 天。不新增基础设施与密钥 | T4.1 |
| D2 | 需要 key 的官方接口（AA、OpenRouter Data API） | 申请官方免费 key 并按要求署名；INV-3 已相应修改。页面抓取在接入官方接口后删除 | H7 → T6.9 |
| D3 | 灰色渠道的呈现 | 第三方挂单只展示数量与价格区间，不下发、不展示商品页链接；「买法」保留文字与风险标注；中转站的逆向、特价分组不参与代表价与最低价 | T2.7 |
| D4 | 中国大陆可达 | 先绑定自定义域名；站点地址只在 `package.json` 的 `homepage` 定义一次。国内镜像（需备案）看流量再议 | T2.8 → H8 → T7.4 |
| D5 | 托管形态 | 维持 Cloudflare Pages；真正需要边缘逻辑时再迁 Workers 静态资源 | 无 |
| D6 | LLM 是否进入管线 | 只离线辅助：标注集、别名提议、审美评审。运行时不调用 | 无 |
| D7 | 许可 | 代码 MIT；`curated/` 等自有整理数据 CC BY 4.0；上游数据按各自许可署名 | T2.9 → T5.10 |
| D8 | 英文版 | 先不做 | 无 |
| D9 | 更新频率 | 维持每日；分层管线完成后再议 | 无 |
| D10 | 外部投稿 | 开放 issue 模板投稿免费额度与工具，审核后入库 | T6.10 |
| D11 | 地区展示分组 | 「中国大陆」与「港澳台」分开显示；存储一律用 ISO 代码 | T6.6 |

---

## 10. 附录：外部事实（核对于 2026-10-24）

- Node.js 20 于 2026-04-30 停止维护；Node 24 为 Active LTS；Node 26 于 2026-10-28 进入 LTS。[Node.js Releases](https://nodejs.org/en/about/previous-releases)
- GitHub Actions 已在 2026 年 9 月移除 Node 20 运行时，旧版 actions 需升级到 Node 24 的主版本（具体日期以 GitHub changelog 为准）。[DEV 社区汇总](https://dev.to/devopsdaily/github-actions-removed-node-20-find-every-node20-action-you-still-run-1eai)
- Cloudflare 对新项目推荐 Workers 静态资源，Pages 仍受支持。[Migrate from Pages to Workers](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)
- `pages.dev` 在中国大陆的连通性时好时坏，Cloudflare 的中国网络仅限企业版。[Cloudflare Community](https://community.cloudflare.com/t/i-use-pages-domain-names-in-china-and-it-times-out-but-not-all-pages-domains-time/814870)
- Luma 的 `lu.ma` 已跳转到 `luma.com`，官方帮助文档的活动链接也已改为 `luma.com/<slug>`。[Luma Help](https://help.luma.com/p/updating-event-information)
- Artificial Analysis 免费 API 要求署名，旧 `/api/v2/data/*` 端点 2026-11-04 退役。[AA API Reference](https://artificialanalysis.ai/documentation)、[迁移说明](https://artificialanalysis.ai/data-api/migrate-v2-data)
- OpenRouter Data API 提供每日模型排行与应用榜，数据以 CC BY 4.0 授权。[OpenRouter Data API](https://openrouter.ai/docs/cookbook/administration/data-api)
- Hugging Face dataset viewer 提供 `/parquet` 与 `/rows` 接口，可作为 Parquet 解析的回退。[Dataset viewer · rows](https://huggingface.co/docs/dataset-viewer/rows)
- Ralph 的文件结构与提示词约定参考 [how-to-ralph-wiggum](https://github.com/ghuntley/how-to-ralph-wiggum)。

