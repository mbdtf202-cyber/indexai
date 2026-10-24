# AGENTS.md

每轮必读的操作手册：只写「怎么做」。进度在 IMPLEMENTATION_PLAN.md，规格在 UPGRADE_PLAN.md。

## 命令

| 命令 | 作用 | 可用于 |
|---|---|---|
| `npm run collect` | 真实采集，约 9 分钟，覆盖 data.json、bench.json、news-archive.json。只在 CI 运行，Ralph 不运行 | 可用 |
| `node health.mjs` | 体检 data.json，不达标退出码 1 | 可用 |
| `npm ci` | 安装锁定的开发依赖 | 可用 |
| `npm run lint` | Biome 检查 JS / JSON / CSS | 可用 |
| `npm run typecheck` | `tsc --noEmit`（仅 `lib/**`，JSDoc + `types/`） | 可用 |
| `npm run invariants` | 架构适应度检查；R1 已启用 | 可用 |
| `npm run verify` | lint → typecheck → invariants → test → build → e2e，提交前必须全过 | 可用 |
| `npm test` | 离线回放的 unit、golden、contract 测试 | 可用 |
| `npm run record` | 测试档位真实请求一遍，写 `fixtures/http/` | 可用 |
| `npm run golden:update` | 重写 golden，提交信息写明差异来源 | 可用 |
| `npm run build` | 用 `fixtures/data/` 生成 `dist/`；`-- --data .` 用本机真实数据 | 可用 |
| `npm run test:e2e` | Playwright（只有 Chromium：`npx playwright install chromium`） | 可用 |

某个命令落地后，把它的「可用于」改成「可用」；M0 结束时删掉这一列。

Node 用 24（`.node-version`）；本机若 PATH 里还是 22，用 `export PATH=~/.local/node/node-v24.11.0-darwin-arm64/bin:$PATH`。

## 环境变量（测试与 golden）

| 变量 | 作用 |
|---|---|
| `INDEXAI_HTTP` | `replay` 时 fetch 改读 `fixtures/http/`，睡眠立即返回；`record` 时真实请求并落盘 |
| `INDEXAI_NOW` | 固定当前时刻（ISO 8601），让输出可复现 |
| `INDEXAI_PROFILE` | `test` 缩小迭代集合（Luma 2 词 1 城、Devpost 2 页、中间站 3 个、HN 2 词、LMArena 2 榜、τ-bench 3 提交） |
| `INDEXAI_OUT_DIR` | 输出目录，默认仓库根；golden 用它写临时目录 |
| `ALLOW_DEGRADED` | `1` 时门禁未过也继续写盘（只给测试档位用） |
| `INDEXAI_FIXTURE_ROOT` | 覆盖回放数据目录（测试用临时目录时设它） |
| `UPDATE_DOM_SNAPSHOTS` | `1` 时 e2e 重写 `test/e2e/__dom__/`；只在界面改动是任务目标时用 |

## 目录

- `collect.mjs`、`bench.mjs`、`health.mjs`：采集、评测、门禁（T3.1 起拆进 `pipeline/`）
- `index.html`：整个站点（M5 起拆进 `site/`）；`lib/`：共享的纯函数模块
- `fixtures/`：回放数据、golden、页面测试数据；`test/`：unit、golden、contract、e2e
- 生成物，不手改、不提交：`data.json`、`bench.json`、`dist/`、`.ralph/`、`coverage/`、`test-results/`
- `fixtures/data/`：`npm run fixture:data` 从真实数据裁出，≤ 1 MB；页面 e2e 用它
- `scripts/serve.js`：只服务 `dist/`，校验 Host、拒绝点文件

## 规则

- 只在 `ralph/work` 分支工作；一轮一个任务；提交信息以任务编号开头
- 不部署，不运行 wrangler 的发布与登录命令，不读密钥，不写 data 分支
- 测试一律离线回放；需要真实响应就用录制工具，每个上游每天最多录一次，不跑真实采集
- 网络只走 `lib/http.js`（T1.4 起），时间与睡眠只走 `lib/clock.js`（T0.4 起）
- UPGRADE_PLAN 的行号对应标签 `review-base`：`git show review-base:collect.mjs`

## 已知坑

- Luma：有状态封禁，并发就会被封，封后约 3 分钟才解；只能顺序请求，间隔 ≥ 900 ms
- Luma：带 geo 与不带 geo 的结果互不重叠；单个 query 最多 50 条，`has_more` 恒为 false
- Devpost：必须按 status（open、upcoming）分别翻页，每页实际只给 9 条
- Devfolio：`themes` 是对象数组，取 `t.name`
- 中转站：`billing_expr` 优先于 `model_ratio`；分组倍率才是价差核心；部分站 `/api/pricing` 会 301 到别的域
- LMArena：`latest` 文件里混着几批快照，只取最新的 `leaderboard_publish_date`
- AIHOT：分类之间不重叠，要逐个分类翻页
- macOS launchd 下 `/bin/bash` 读不到 `~/Desktop`，本机常驻任务直接执行 node
- Playwright 的 `toBeVisible` 把 `opacity:0` 当作可见，判断真可见要看计算样式
- e2e 要拦非同源请求：页面仍直连 Google Fonts 与汇率接口（F45、F52 未修），
  被拦后会产生 `Failed to load resource` 的 console.error —— 这类与前端错误分开断言
- 断网跑 e2e 要给 webServer 的探测加 `NO_PROXY=127.0.0.1,localhost`，否则代理会拦回环

## 前端原则

- 少用次级标签和说明文字，让布局说话
