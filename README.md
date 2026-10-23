# IndexAI

AI 的价格与额度索引：**免费额度、模型价格、官方订阅、中转站价目、活动、公开评测**，每天采集一次。

## 文件

| 文件 | 作用 |
|---|---|
| `index.html` | 站点本体（单文件、无构建，浅色默认） |
| `collect.mjs` | 采集 / 归一 / 去重 / 探测，产出 `data.json` |
| `serve.mjs` | 零依赖静态服务器（launchd 常驻用，`node serve.mjs 4311`） |
| `data.json` | 站点唯一数据源（每次运行覆盖） |
| `README.md` | 这份说明 |

## 跑起来

站点：**http://127.0.0.1:4311/** —— 已由 launchd 常驻，开机自启、进程挂了自动重拉，不用手动起。

手动重采一次：

```bash
node collect.mjs          # 约 18 秒，覆盖 data.json（页面刷新即生效）
```

## 每天自动更新（已装好）

两个 LaunchAgent，已在 `gui/$(id -u)` 里生效：

| Label | 作用 | 时间 |
|---|---|---|
| `com.raki.indexai.collect` | 跑 `collect.mjs`，日志 `/tmp/indexai-collect.log` | 每天 09:00 |
| `com.raki.indexai.serve` | 常驻 `serve.mjs 4311`，日志 `/tmp/indexai-server.log` | 开机 + 崩溃重拉 |

```bash
# 查看状态
launchctl print gui/$(id -u)/com.raki.indexai.collect | head -5
launchctl print gui/$(id -u)/com.raki.indexai.serve   | head -5

# 立刻手动触发一次采集
launchctl kickstart -p gui/$(id -u)/com.raki.indexai.collect

# 改时间：编辑 ~/Library/LaunchAgents/com.raki.indexai.collect.plist 的 Hour/Minute 后
launchctl bootout   gui/$(id -u)/com.raki.indexai.collect
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.raki.indexai.collect.plist
```

> 注意：node 必须走绝对路径 `/Users/raki/.local/node/current/bin/node`（launchd 不读 shell 的 PATH）；
> 别用 `/usr/bin/python3 -m http.server`，Xcode 自带 python 在 launchd 下被 macOS TCC 挡住读不到桌面。

## 八层数据

| 层 | 来源 | 更新 |
|---|---|---|
| 免费额度（37） | 官方活动页 / 文档，写在 `CURATED_OFFERS` | 人工 |
| 比价（473） | OpenRouter 实时目录 + 官方定价页核实 | 自动 + 人工 |
| 订阅（10 档 + 18 套餐区价 777 条 + 240 条挂单） | 官网订阅页 + App Store 各区价 + 发卡平台直链 | 自动 |
| 中转站（54 在册 / 22 有公开价目 / 6,963 条报价） | 各站 `/api/pricing`（OneAPI/NewAPI） | 每次自动探测 |
| 活动（111 条 / 88 开放中） | Devpost 分页 + Luma 发现流 + 本地 AIOS 活动库，按类型/地区打标 | 每次自动 |
| 评测（16） | Vals Index 公开分数 | 每次自动，存快照比 Δ |
| 情报（24 条要闻 + 21 条信号） | 公开新闻流按主题打分 + X/官方博客正文 | 每次自动 |
| 工具箱（21 个） | 人工精选稀缺 skill / CLI，按用途分类；GitHub API 校准星数与更新时间 | 每次自动 |

## 口径

```
有效成本 = (1 − s) · [(1 − h) · input + h · cache_read] + s · output
中转账单价 = model_ratio × $2 / 1M（input）
            model_ratio × completion_ratio × $2 / 1M（output）
```

- 排序默认 **主流优先**：大厂在前，同厂商内新模型在前。
- 汇率来自 `open.er-api.com`，站点每 8 小时刷新一次，失败时沿用上次值。
- 中转站价目是接口披露价，不含充值折扣；与官方差 3 倍以上标「口径?」。
- 第三方挂单来自 `data.aibijia.org` 公开 JSON，**每条带商品页直链**；质保通常几小时，不推荐、不保证可用。
- 各区订阅价来自 `data.aibijia.org/apple_subscriptions.json`（App Store 公开页），每个国家都能点进对应区商店。
- 中转站域名池来自开源清单（awesome-ai-proxy / relayAPI / ai-coding-welfare / relaywatch），脚本逐个探 `/api/pricing`，探到才算「有价目」。
- 评测分数下跌标黄，提示可能的版本回退或渠道掺水，需人工复核。

## 加东西

- 官方直连：往 `CURATED_OFFICIAL` 加一条（USD/1M）。
- 免费额度：往 `CURATED_OFFERS` 加一条（带 `source`、`conf`）。
- 新闻：`data.aibijia.org/news-frontline.yaml`，`NEWS_TOPICS` 控制分类、`scoreNews` 控制精选权重。
- 中转站：往 `RELAYS` 加 `{domain, name, auto}`，`auto: true` 会每天探 `/api/pricing`；一次批量探测见 `probeRelays()` 的并发写法。
- 活动：默认读 `AIOS_OPPORTUNITIES` 指向的 AIOS 导出文件，可用环境变量覆盖。

## 边界

- 只采公开页面与公开接口；**不注册账号、不绕过登录**去拿需要授权的价格。
- 挂牌价 ≠ 账单：不含税、企业折扣、区域加价。
- `data.json` 不要提交到公开仓库（含大量第三方页面链接）。

## 部署到公网

**线上地址：https://indexai.pages.dev/**
仓库：https://github.com/mbdtf202-cyber/indexai

纯静态（HTML + JSON），没有后端、没有数据库。

### 两种运行模式

**A. 云端（推荐，不依赖本机）** — `.github/workflows/daily-collect.yml`

```
GitHub Actions  每天 09:00
      ├─ node collect.mjs
      ├─ 组装 dist/
      └─ wrangler pages deploy → Cloudflare Pages
```

启用只需要仓库里有一个 secret：

```bash
# 1. 建 token（30 秒）：Cloudflare Dash → My Profile → API Tokens → Create Token
#    https://dash.cloudflare.com/profile/api-tokens
#    模板选 "Edit Cloudflare Workers"，或自定义权限：
#    Account → Cloudflare Pages → Edit
# 2. 写进仓库（会提示粘贴，不回显）
gh secret set CLOUDFLARE_API_TOKEN -R mbdtf202-cyber/indexai
# 3. 手动触发一次验证
gh workflow run daily-collect -R mbdtf202-cyber/indexai
```

**B. 本地（当前在跑）** — `com.raki.indexai.collect`

```
launchd 每天 09:00 → node deploy.mjs → wrangler pages deploy
```

云端跑通后可以关掉本机定时，避免两边重复部署：

```bash
launchctl bootout gui/$(id -u)/com.raki.indexai.collect
```

### 为什么本地用 Node 驱动

macOS 的 TCC 会拦住 launchd 里由 `/bin/bash` 发起的对 `~/Desktop` 的读取（`Operation not permitted`），但 node 二进制不受此限制。所以本地编排写在 `deploy.mjs` 里，plist 直接执行 node，不经过 shell。云端无此限制。

一条命令手动发版：

```bash
node deploy.mjs                # 采集 + 发布
node deploy.mjs --skip-collect # 只发布，不重采
```

部署日志：`/tmp/indexai-deploy.log`

### 部署相关的三个文件

| 文件 | 作用 |
|---|---|
| `deploy.mjs` | 采集 + 构建 dist + `wrangler pages deploy`（必须用 node 跑，见下） |
| `_headers` | Cloudflare 缓存头：`index.html` 不缓存、`data.json` 缓存 5 分钟 |
| `.github/workflows/daily-collect.yml` | 备选：GitHub Actions 版定时采集（当前未启用） |

### 为什么必须用 Node 驱动

macOS 的 TCC 会拦住 launchd 里由 `/bin/bash` 发起的对 `~/Desktop` 的读取（`Operation not permitted`），但 node 二进制不受此限制。所以部署编排写在 `deploy.mjs` 里，plist 直接执行 node，不经过 shell。

### 定时任务

```bash
launchctl print gui/$(id -u)/com.raki.indexai.collect   # 看状态
launchctl kickstart -p gui/$(id -u)/com.raki.indexai.collect  # 立刻跑一次
```

plist 在 `~/Library/LaunchAgents/com.raki.indexai.collect.plist`，改时间改 `Hour`/`Minute` 后 `bootout` + `bootstrap`。

### 备选：交给 Cloudflare 自己构建

如果想让 Cloudflare 直接从 GitHub 构建（不依赖本机开机）：

1. Cloudflare Dash → Workers & Pages → `indexai` → Settings → Builds & deployments → Connect Git
2. 构建设置：Build command **留空**，Output directory **`/`**
3. 再在仓库 Settings → Secrets 里加 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`，把 `.github/workflows/daily-collect.yml` 的最后一步换成 `wrangler pages deploy`

### 成本

| 方案 | 月成本 | 国内访问 | 上线时间 |
|---|---|---|---|
| **Cloudflare Pages（当前）** | **¥0** | 中等 | 已完成 |
| Vercel Hobby | ¥0 | 较好 | 5 分钟 |
| GitHub Pages | ¥0 | 慢 | 3 分钟 |
| 阿里云 OSS + CDN | ¥5~15（需备案） | 快 | 1–3 天 |

无限带宽、免费 SSL、免费 `*.pages.dev` 域名。要绑自己的域名不用备案（走香港/新加坡节点）。

### 上线前要知道的

- **仓库体积**：`data.json` 600 KB，如果每天都 commit，一年 +200 MB。当前自动部署**不**提交 data.json（只上传到 Pages），仓库不会膨胀。
- **本机依赖**：定时采集跑在这台 Mac 上，关机就不跑。要彻底去机器依赖，用上面的「备选」接 Cloudflare Git 构建。
- **CI 里少一层数据**：`collect.mjs` 的 AIOS 活动读本地文件，非本机环境读不到 → 只有 Devpost + Luma。
- **没有密钥**：全部走公开接口，仓库里不放 token。
