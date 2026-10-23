# IndexAI

AI 的价格与额度索引：**免费额度、模型价格、官方订阅、中转站价目、活动、公开评测**，每天自动采集一次。

线上：**https://indexai.pages.dev/** · 仓库：https://github.com/mbdtf202-cyber/indexai

---

## 文件

| 文件 | 作用 |
|---|---|
| `index.html` | 站点本体（单文件、无构建，默认浅色，首屏总览） |
| `collect.mjs` | 采集 / 归一 / 去重 / 探测，产出 `data.json` |
| `health.mjs` | 分层健康检查：基线阈值 + 语义校验，采集和 CI 共用 |
| `serve.mjs` | 零依赖静态服务器（本地预览用） |
| `deploy.mjs` | 本机一键采集 + 发布（CI 的本地等价物，备用） |
| `bench.mjs` | 9 个公开评测源的采集与归一（每次运行覆盖 `bench.json`） |
| `bench.json` | 评测明细（约 3.5 MB，首屏不加载，打开评测页才拉） |
| `lib/parquet.mjs` | 零依赖 Parquet + Snappy 读取器（读 LMArena 官方数据集用） |
| `data.json` | 站点主数据源（每次运行覆盖；评测只留目录与统计） |
| `news-history.json` | 新闻历史（逐日累积，进仓库，用来撑「近一周／一月」跨度） |
| `_headers` | Cloudflare 缓存头 |
| `favicon.svg` | 站点图标 |

---

## 跑起来

```bash
node serve.mjs 4311        # 本地预览 → http://127.0.0.1:4311/
node collect.mjs           # 重采一次，约 25 秒，覆盖 data.json
node health.mjs            # 单独体检；不达标 exit 1
```

---

## 数据健康：这套东西为什么不会悄悄烂掉

这是本项目最重要的一条设计，也是踩过坑之后加的。

**问题**：所有数据源都包在 `try/catch` 里，失败就返回空数组。采集脚本照常写出 `data.json` 并发布，
站点看起来一切正常，实际上某一层已经空了好几天。曾经的真实事故：

- `SUBSCRIPTIONS = []`（死常量），页面照常渲染「官方档位 0」，README 却写着「订阅 10 档」
- `bench` 里把对象当数组 `.map()`，每次抛错被吞掉，「评测下跌标黄」从来没生效过
- Devpost 活动一律硬编码 `status: 'open'`，25 个已截止的活动还挂在「开放中」
- Devpost 日期解析只认一种格式，20/65 个活动日期变 null、被标成「未知」

**现在的机制**：

1. **逐层记账**（`collect.mjs` 的 `makeTracker`）。每个数据源记 `fresh / stale / failed`，
   写进 `meta.collect[]`。某层本次为空但有上一版 → 沿用上一版并打 `stale`；
   两版都没有 → `failed`。前端和方法页都能读到这个状态。
2. **硬门禁**（`health.mjs` 的 `assertLayers`）。每层设 `min`（绝对红线）和 `shrink`（相对缩水比例）。
   任一红线不过 → **抛错，不写 `data.json`，线上保持上一版**。残缺数据绝不覆盖好数据。
3. **语义校验**。数量够 ≠ 数据对，另外检查：
   - `status=open` 的活动不能已过截止日
   - 模型不能 `input=0` 但 `output>0`，不能没有任何价格，不能没有来源 URL
   - `generated_at` 不能是未来、不能超过 48 小时
   - 汇率必须在合理区间
   - 所有中转站不能全部探测失败
4. **CI 二次校验**。`node health.mjs` 作为独立 step 再跑一遍，
   防止将来改 `collect.mjs` 时绕过内嵌门禁。
5. **失败可见**。job 失败自动开 GitHub issue（已存在则追加评论），
   首屏有健康横幅（数据陈旧／某层空掉时出现，平时完全不存在）。

紧急情况下想强行发布残缺数据：`ALLOW_DEGRADED=1 node collect.mjs`。会有明显警告。

---

## 八层数据

| 层 | 来源 | 更新 |
|---|---|---|
| 免费额度（37） | 官方活动页 / 文档，写在 `CURATED_OFFERS` | 人工 |
| 比价（474） | OpenRouter 实时目录 + 官方定价页核实 | 自动 + 人工 |
| 订阅（16 档官方 / 18 组区价 774 条 / 209 条挂单） | App Store 公开内购页 + 发卡平台直链 | 自动 |
| 中转站（约 50 在册 / 约 20 有公开价目） | 各站 `/api/pricing`（OneAPI/NewAPI） | 每次自动探测 |
| 活动（111 条 / 约 88 开放中） | Devpost 分页 + Luma 发现流 + 本地 AIOS 活动库 | 每次自动 |
| 工具箱（21） | 人工精选稀缺 skill / CLI，GitHub API 校准星数 | 每次自动 |
| 评测（163 榜 / 3.2 万条分数 / 1,200 模型） | LMArena 24 榜、SWE-bench 5 榜、Aider、Terminal-Bench、τ-bench、ARC-AGI 2 榜、SimpleBench、Vals、Artificial Analysis 14 榜 | 每次自动 |
| 情报（每日约 50 条要闻 + 21 条信号） | 公开新闻流按主题打分 + X/官方博客正文 | 每次自动 |

另有几个辅助层：OpenRouter 应用榜（25）、模型调用量榜（20）、Hacker News 民间声量（16）、来源登记表（125）。

### 订阅层的口径

官方档位**不是手写的**，全部从 App Store 美国区的公开内购价派生：
`apple_subscriptions.json` → 取每个 plan 的美国区 `price_value` → 一档一行，带 `app_store_url`。
拿不到美国区价格的档位直接跳过，不猜价、不用历史值填。

> 曾经这里是 `const SUBSCRIPTIONS = []`，而 README 写着「10 档」。现在派生不出来就是 health 红线。

### 活动层的口径

状态**只由日期决定**，不照抄数据源的 `status` 字段：

```
past     —— end 已过（没有 end 就用 start）
upcoming —— start 在未来
open     —— 正在进行中
unknown  —— 两个日期都没有 → 标未知，不假装开放
```

Devpost 的 `submission_period_dates` 有三种真实写法，解析器都要认：
`Oct 05 - Nov 12, 2026` / `Oct 05 - 27, 2026` / `Jul 16, 2026 - Jan 15, 2027`。

---

## 口径

```
有效成本 = (1 − s) · [(1 − h) · input + h · cache_read] + s · output

中转站（两种写法并存，表达式优先）：
① billing_expr       tier("base", p * 2 + c * 10 + cr * 0.1)
                     p=输入 c=输出 cr=缓存读 cc=缓存写，单位即 $ / 1M
② model_ratio 倍率    input  = model_ratio × 分组倍率 × $2 / 1M
                     output = 上式 × completion_ratio
                     cache  = 上式 × cache_ratio
```

- 排序默认 **主流优先**：大厂在前，同厂商内新模型在前。
- 汇率来自 `open.er-api.com`，站点每 8 小时刷新一次，失败时沿用上次值。
- 中转站价目是接口披露价，不含充值折扣。
- **表达式必须优先于倍率**：同时给出两者的站点里 `model_ratio` 多是废弃占位值（实测某站 `37.5` 算出 $75，而其 `billing_expr` 写的是 `p*2+c*10`，真实价 $2/$10）。只认倍率会把一批正常站点误标成「异常」。
- **分组倍率（`group_ratio`）才是定价核心**，跨站差 20–220 倍。页面取「代表分组」（default，或组名声明倍率最接近 1 的公开组）做横向比较；「最低可达价」单列并标组名，因为通常要求特定分组权限。
- 免费额度行（`:free`、`-free`、`-0x`、公益/福利组）不计入比价，否则「最低价」永远指向免费额度。
- 与同口径官方价差 2.5 倍以上标「口径?」；便宜模型（官方 < $0.5）放宽到 8 倍，避免小模型被绝对差价误判。
- 页面价差计算会剔除偏离同模型中位价 10 倍以上的离群报价，并在页面上列出被剔除者及原因。
- 第三方挂单来自 `data.aibijia.org` 公开 JSON，**每条带商品页直链**；质保通常几小时，不推荐、不保证可用。
- 各区订阅价同源（App Store 公开页），每个国家都能点进对应区商店。
- 评测分数下跌标黄，提示可能的版本回退或渠道掺水，需人工复核。
- 评测各榜量纲不同（Elo / 百分数 / 指数），对照表按**榜内名次换算成相对位置**再并排，不直接相加。
- 同一模型的多个推理档位（High / Max / xHigh）合并成一条，保留最强档，避免一个模型刷屏。
- 榜单超过 6 个月没更新会标出「N 个月前」。SWE-bench 全系与 Aider 目前属于这一类：分数能看，但不代表当前能力。
- LMArena 的 `latest` 文件里可能混着几代快照（text_to_image 混了 2025 年的旧批次），采集时只保留最新 `leaderboard_publish_date` 那一批。

---

## 每天自动更新（云端）

```
GitHub Actions  .github/workflows/daily-collect.yml   每天 09:00（UTC 01:00）
      ├─ 拉线上 data.json 当基线   ← 保证 delta 与缩水检测有真实上一版
      ├─ node collect.mjs          采集（内含健康门禁）
      ├─ node health.mjs           二次独立校验
      ├─ 组装 dist/                 index.html + data.json + _headers
      ├─ 校验 Cloudflare token     权限不对立刻报错并给出修法
      ├─ wrangler pages deploy     → Cloudflare Pages
      ├─ 线上验证                   确认线上确实是本轮数据
      └─ on failure → 自动开 issue
```

不依赖任何一台机器开机。手动触发：

```bash
gh workflow run daily-collect -R mbdtf202-cyber/indexai
gh run list -R mbdtf202-cyber/indexai --limit 3
gh run view <run-id> -R mbdtf202-cyber/indexai --log-failed
```

### 需要的仓库 Secret

| Secret | 说明 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | 权限需含 **Account → Cloudflare Pages → Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | 账号 ID（也可直接写在 workflow 里） |

> **踩过的坑**：用 R2 模板创建的 token，`/tokens/verify` 会返回 `active`，
> 但调 Pages API 报 `Authentication error [code: 10000]`。
> 要选 **Edit Cloudflare Workers** 模板，或手动加 Pages 权限。
> 现在 token 预检这一步会明确告诉你这个原因，而不是抛一串 wrangler 原始报错。

### 为什么 data.json 不进仓库

每天 700 KB，一年 +250 MB。CI 只把它上传到 Pages，不 commit。
`news-history.json` 则进仓库——它需要逐日累积才能撑出时间跨度，且体积小。

---

## 本地备用

```bash
node deploy.mjs                # 采集 + 发布（走本机 wrangler 登录态）
node deploy.mjs --skip-collect # 只发布
```

日志 `/tmp/indexai-deploy.log`。

本机还有一个 launchd 常驻的本地预览服务：`com.raki.indexai.serve`（`serve.mjs 4311`，开机自启、崩溃重拉）。
**它只服务本地，不参与发布。**

```bash
launchctl print gui/$(id -u)/com.raki.indexai.serve | head -5
```

> **踩过的坑**：macOS 的 TCC 会拦住 launchd 里由 `/bin/bash` 发起的对 `~/Desktop` 的读取
> （`Operation not permitted`），但 node 二进制不受此限制。
> 所以 plist 直接执行 node，不经过 shell。

---

## 加东西

- 官方直连：往 `CURATED_OFFICIAL` 加一条（USD/1M，带 `src`）。
- 免费额度：往 `CURATED_OFFERS` 加一条（带 `source`、`conf`）。
- 新闻：`data.aibijia.org/news-frontline.yaml`，`NEWS_TOPICS` 控制分类、`scoreNews` 控制精选权重。
- 中转站：往 `RELAYS` 加 `{domain, name, auto}`，`auto: true` 会每天探 `/api/pricing`。
- 活动：默认读 `AIOS_OPPORTUNITIES` 指向的 AIOS 导出文件；该层可选，读不到会明确提示并跳过。
- 新增数据层：**同时**在 `collect.mjs` 用 `T.run(...)` 包起来、在 `health.mjs` 的 `LAYERS` 里加阈值。

---

## 边界

- 只采公开页面与公开接口；**不注册账号、不绕过登录**去拿需要授权的价格。
- 挂牌价 ≠ 账单：不含税、企业折扣、区域加价。
- 免费额度随时会变，卡片上的日期是核实日期，链接指向官方页。
