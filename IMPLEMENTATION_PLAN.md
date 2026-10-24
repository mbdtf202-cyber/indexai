# IMPLEMENTATION_PLAN

Opus 5.5 于 2026-10-24 编写。理由与规格见 `UPGRADE_PLAN.md`；本文件是执行清单，由 Ralph 在 build 模式下逐项执行并维护。不要用 plan 模式重写它。

当前里程碑：**M1 止血**

## 规则

1. 每轮只做一个任务：从上往下，第一个标题为 `[ ]` 且依赖都已完成的任务。
2. 完成时：标题改为 `[x]`，删掉「步骤」，保留「验收」，末尾加一行「结果：」写实际做了什么、怎么验证的。
3. 一轮做不完：在原位拆成 `T1.3a`、`T1.3b`……，本轮只做第一个。不改已有编号。
4. 新问题写进「发现」（编号 N01 起）；当场能修的小问题当场修并注明。需要人做的事写进「需要人做的事」。
5. 里程碑第一个任务开始前：`git fetch origin && git merge origin/main`（不 rebase，不强推）。
6. 里程碑最后一个任务完成后：`gh pr create --base main --head ralph/work`（已有则更新描述），标题「M0：护栏」这种格式，正文列出完成的任务、验证方式、需要人看的点。不合并。然后把上面的「当前里程碑」改成下一个。
7. 没有可做的任务（全部完成，或剩下的都在等人勾选 H 项，或只剩未到期的周期任务）：创建 `.ralph/DONE`，写一句原因，结束本轮。
8. UPGRADE_PLAN 里的行号对应开工时的代码，开工提交打了标签 `review-base`，用 `git show review-base:<文件>` 对照。

## 需要人做的事

- [ ] **H1 开工**（现在）：先 `git status`。这批文件之外的改动与未跟踪文件（如 `news-provenance.json`）先单独提交，循环要求工作区干净，孤儿文件由 T2.1 清理。然后：
  ```
  git checkout -b ralph/work
  git add UPGRADE_PLAN.md IMPLEMENTATION_PLAN.md PROMPT_build.md AGENTS.md loop.sh .gitignore
  git commit -m "plan: upgrade spec, implementation plan and Ralph loop"
  git tag review-base
  git push -u origin ralph/work --tags
  bash loop.sh 10
  ```
- [ ] **H2 环境**（现在）：`node -v` 为 24 或更高；Claude Code 命令行已登录；`gh auth status` 正常（Ralph 要开 PR）。推荐在容器里运行循环。若直接在本机运行：执行 `npx wrangler logout`，shell 里不要有 `CLOUDFLARE_*` 变量，并接受 Claude 在 `--dangerously-skip-permissions` 下可以读写本机文件。
- [ ] **H3 分支保护**（T0.6 已完成，可以做了；需先把 `ralph/work` 推上去让 `verify` 在 GitHub 上跑一次）：Settings → Branches 保护 `main`，要求 PR，且必须通过 `verify` 检查。
- [ ] **H4 合并里程碑**（每个里程碑）：审阅 Ralph 开的 PR，用 merge commit 合并，不要 squash。
- [ ] **H5 本机预览**（T2.6 之后）：预览服务改为只服务 `dist/`。用本机真实数据构建一次：`npm run build -- --data .`；launchd 的 `com.raki.indexai.serve` 不用改。
- [ ] **H6 预览脚本迁移**（T3.1d 之后）：预览脚本移到 `scripts/serve.js`，更新 launchd plist 的程序参数并 `launchctl kickstart -k gui/$(id -u)/com.raki.indexai.serve`。
- [ ] **H7 API key**（T6.9 之前，越早越好）：申请 Artificial Analysis 与 OpenRouter 的免费 API key；GitHub 仓库 Secrets 添加 `AA_API_KEY`、`OPENROUTER_API_KEY`；Ralph 录制回放数据时，在循环环境里提供同名环境变量（只读 key，不是部署密钥）。
- [ ] **H8 自定义域名**（D4，T2.8 之后任何时候）：选定并购买域名，在 Cloudflare Pages 项目 `indexai` 绑定；然后只改 `package.json` 的 `homepage`。

## 发现

（Ralph 在这里记录新问题，格式：`- [ ] N01（来自 T0.3）：问题。去向：T1.8 / 新任务 T2.10 / 已当场修复`）

- [ ] N01（来自 T1.1）：禁用 JS 时 Playwright 的 `getByText` 找不到 `<noscript>` 里的文案（Chromium 把它当文本节点而非元素），可见性断言会得出错误结论。已改用 `noscript .empty` 选择器 + 几何断言，并记入 AGENTS.md 已知坑。去向：已当场处理，AGENTS.md 保留。
- [ ] N02（来自 T1.1）：`index.html` 里有两个同名的 `best`——`viewHome` 指「中转站最低 Sonnet」，`renderKpis` 指「最大缓存折扣」。首屏把关键数字下移到 KPI 时极易串味（本次已用 `cheapestSonnet` 绕开）。去向：T5.9 / T4.4–T4.6 统一实体后一并清掉。
- [ ] N07（来自 T1.4）：`httpText` 返回的是 `{status, ok, url, text}` 而不是 `Response`，迁移时两处调用点还写着 `await res.text()`，`openrouter` 与 `aa` 两层当场变成 `failed`。这类形状差异在纯 JS 里没有编译期保护，靠 golden 与 R2a 之外还需要 contract 测试（S1.4 已有该档）。去向：T1.6 之后补 contract 用例，或在 T3.1 拆层时让每层只通过 `ctx.http` 取值。
- [ ] N06（来自 T1.3）：`npm test` 之前在非回放环境下会真的睡眠（Luma 冷却 180s 实测），现在由脚本自己钉死回放信号。任何新增用例都不要再依赖「外面传了环境变量」。去向：已修，AGENTS.md 记一条。
- [ ] N04（来自 T1.2）：HF 上 LMArena 的 `latest-00000-of-00001.parquet` 在两个回放 fixture 里都解析失败（一层 Thrift 里没读出任何列，一层报 `unsupported value type 15`）。`text` 配置报 `numRows 1`，是覆盖 `model_name` 列的那层。这不是本轮引入的：T0.4 的 golden 里 arena 一直是 0 榜、`ok:false`。导致「LMArena 贡献 137/163 个榜」这件事在离线环境里完全无法验证（F03 的实例数据也因此只能来自线上）。去向：需要重新录制一份能解析的 parquet（`npm run record`）并补 golden，建议并入 T6.8（τ-bench 一并处理）或单开任务。
- [ ] N05（来自 T1.2）：`INDEXAI_ARENA_BOARDS` 是为测试新增的环境变量，与 S1.3 的「命令随任务落地逐步加入」不冲突，但它是第二套「缩小迭代集合」的机制。M3 拆层时应与 `INDEXAI_PROFILE` 合并成一个 `ctx.profile`。去向：T3.1。
- [ ] N03（来自 T1.1）：`smoke.spec.js` 的「整页可见」断言一直是假绿（见结果 1），Playwright 默认 `reducedMotion: reduce` 会掩盖 `opacity:0` 的缺陷。之后所有可见性断言都必须读计算样式而不是 `toBeVisible`。去向：已写进 AGENTS.md。

## 适应度规则启用表

规则定义见 UPGRADE_PLAN S1.5，实现在 `scripts/check-invariants.js`。到了「启用于」的任务就打开对应规则，之后永远开着。

| 规则 | 启用于 | 说明 |
|---|---|---|
| R1 | T0.1 | 没有 `dependencies` |
| R9 | T0.2 / T0.4 / T0.5 | 随 `fixtures/http`、`fixtures/golden`、`fixtures/data` 出现分别启用 |
| R12 | T0.6 | 工作流固定 SHA |
| R2a | T1.4 | 采集端网络只走 `lib/http.js`（此时范围：根目录 `*.mjs` 与 `lib/`） |
| R8 根目录 | T2.1 | 根目录白名单；之后任何任务新增根目录文件都要同步白名单 |
| R5 | T2.2 | TODO 带任务编号 |
| R10 | T2.5 | 用量画像只在 `lib/cost.js` |
| R6 | T2.6 | 无绝对用户路径 |
| R3 | T3.1c（`pipeline/`、`lib/`）/ T5.2（`site/`） | 单文件 ≤ 400 行 |
| R2b | T3.3 | 采集端时间与睡眠只走 `lib/clock.js` |
| R8 dist | T3.9 | `dist/` 只有构建清单里的文件 |
| R2c | T5.2 | 浏览器端网络与时间各只有一个出口 |
| R7 | T5.4 | `innerHTML` 只在 `render.js` |
| R4、R11 | T5.6 | 颜色只在令牌文件；选择器只定义一次 |

---

## M0 护栏：不改行为，只建回压

退出条件：`npm run verify` 在本地与 CI 都通过；现有采集与页面行为被单元测试、golden、DOM 快照锁住。M0 期间不修任何缺陷，已知缺陷只写成带编号的 `todo` 用例。

### [x] T0.1 工具链骨架

依据：F54 · S1.1–S1.3 · 依赖：无

验收：
- 干净检出上 `npm ci && npm run verify` 通过。
- `node -e "process.exit(require('./package.json').dependencies ? 1 : 0)"` 退出码为 0。
- 本任务的提交不改动 `collect.mjs`、`bench.mjs`、`health.mjs`、`index.html`。

结果：新建 `package.json`（private、ESM、无 dependencies、devDeps 精确锁定 typescript 5.9.3 / @types/node 24.10.1 / @biomejs/biome 2.3.4）、`.node-version`＝24、`biome.jsonc`（旧 `.mjs` 与 `index.html` 的错误规则在 overrides 里关闭，待 T3.1e 恢复）、`tsconfig.json`（allowJs+checkJs，仅 lib/**，0 类型错误）、`scripts/check-invariants.js`（规则框架，启用 R1）、`test/unit/news.test.js`（22 通过 + 1 todo 记录 F26）、`.gitignore` 追加 `coverage/` 与 `.data/`。在 `/tmp` 模拟干净检出执行 `npm ci && npm run verify` 通过；`dependencies` 检查退出码 0；`git diff HEAD -- collect.mjs bench.mjs health.mjs index.html` 为空。本机原本只有 Node 22，已装 Node 24.11.0 到 `~/.local/node/` 用于验证。

### [x] T0.2 回放与录制

依据：S2.1 · INV-7 · 依赖：T0.1

验收：
- 往返测试逐字节一致；未录制请求抛错且信息含 URL；三种故障注入各有用例。
- 断网时 `npm test` 仍通过。

结果：新增 `test/support/http-replay.js`（`sha1('GET '+url)` 键、`fixtures/http/<host>/<sha1>.json`、超 64 KB 走 `gzip+base64`、`finalUrl` 覆盖 `Response.url`、同步读盘后返回已决 Promise 以保证并发顺序确定、未录制请求抛错并带完整 URL）与 `test/support/http-record.js`（只存状态码/最终 URL/content-type/正文，不存请求头，只允许 GET）。故障注入支持 `{status}`、`{networkError}`、`{hang}`、`{body}`，可由 `INDEXAI_FAULTS` 环境变量或进程内 `setFaults()` 配置。`test/unit/http-replay.test.js` 10 个用例覆盖往返一致、gzip 还原、重定向 finalUrl、未录制报错、三种故障注入、`installReplay` 幂等。启用 R9 的 `fixtures/http`（≤5 MB）部分，新建 `fixtures/http/`。踩坑记录：`node --test` 会设置 `NODE_TEST_CONTEXT`，最初的自动安装条件把它当成回放信号，把测试里的真实 `fetch` 悄悄换掉；已收窄为只认 `INDEXAI_REPLAY=1` 或 `--import` 预加载。用 `HTTP_PROXY=http://127.0.0.1:9` 模拟断网，`npm test` 33 项仍全过。

### [x] T0.3 特征测试

依据：S1.4 · 依赖：T0.1

验收：
- 列表中每个函数都有典型、边界、事故三类用例。
- 每个 `todo` 用例都带 F 编号。
- `node collect.mjs` 直接运行时的行为不变（T0.4 的 golden 会锁定）。

结果：`collect.mjs` 的 AIOS 路径探测改为惰性 `aiosFile()`，`main()` 收进 `isDirectRun` 判断，import 时零副作用；给 25 个目标函数与 `AI_EVENT_RE` 加 `export`，`bench.mjs` 补 `mergeByModel` / `parseAiderYaml` / `sliceBalanced` 导出（`splitConfig` 原本已导出），`health.mjs` 的 `checkData` 与 `LAYERS` 原本已导出，均未移动代码。新增 5 个测试文件：`collect.test.js`（110 项，覆盖 Devpost 三种日期写法与单日活动、tier("base", p*2+c*10+cr*0.1)、model_ratio=37.5 被 billing_expr 压过、分组名「a全模型综合组-1倍率」、deepseek-flash 与 deepseek-v4-1-flash 区分、:free 变体、Devfolio themes 对象数组）、`bench.test.js`（22 项）、`news-archive.test.js`（30 项）、`health.test.js`（9 项）、`parquet.test.js`（15 项，用真实 8 KB LMArena agent parquet）。5 个 `todo` 用例分别标注 F07（标题与 URL 截断）、F09（parseNewsYaml 首条被 split 吞掉）、F10（PK/ISLAMABAD 判成印度）、F11（`con\b` 命中 Silicon Valley）、F24（familyKey 未剥离日期尾巴）。过程中把多处测试从「我以为的行为」校正为代码真实行为：`eventRegion` 返回小写地区码（`jp` / `eu`）、`dedupeModels` / `dedupeOffers` 返回 `{rows, dropped|merged}`、`parseOpenRouter` 吃 HTML 并返回 `{apps, models}`、`parseNewsYaml` 要求 `- date:` 开头、`mergeArchive` 的 fresh 用抓取形态而 history 用存档形态、`snappyDecode` 是 raw block 且 tag 为 `(len-1)<<2`、`makeThrift` 只有 4 个方法。`npm test` 192 项、184 通过、0 失败、5 todo；`node collect.mjs` 仍只在直接运行时采集。

### [x] T0.4 采集 golden（测试档位）

依据：S1.4 · INV-7 · 依赖：T0.2、T0.3

验收：
- 连续两次回放运行，三份输出逐字节相同；golden 测试单次 ≤ 30 秒。
- 不设任何 `INDEXAI_*` 变量时，所有常量的默认值与改动前一致（逐项核对，写进「结果」）。

结果：新增 `lib/clock.js`（`now` / `nowISO` / `todayISO` / `mark` / `since` / `sleep`，`INDEXAI_NOW` 固定时钟，回放时 `sleep` 立即返回并累计 `takeRequestedSleepMs()` 供 T1.3 断言上界）；`collect.mjs`、`bench.mjs`、`lib/news.mjs`、`health.mjs` 里所有取当前时间、睡眠与耗时统计全部改走它。新增 `INDEXAI_PROFILE=test`（用派生切片而非改常量，生产默认不变）与 `INDEXAI_OUT_DIR`（三份输出统一重定向）。`scripts/update-golden.js` + `npm run golden:update`。`test/golden/collect.test.js` 三个用例：30 秒内跑通、与 golden 逐字节一致、两次运行互相一致；失败时打印第一个不同的 JSON 路径。生产默认值逐项核对：Luma 30 词 / 27 城 / 8 geo 词、Devpost 40 页、Devfolio 45 页、`TEST_PROFILE` 默认 false、`OUT_DIR` 默认 null（写仓库根）—— 与改动前完全一致。体积：`fixtures/http` 3.2 MB、`fixtures/golden` 1.1 MB，均在 R9 上限内，R9 已扩到 golden。golden 实测 1.1 秒，`npm test` 195 项全过。过程中发现并修掉五处不确定性：`collect` 日志顺序随并行完成顺序漂移（按层 id 排序）、`models` 同价行顺序不稳（加 `channelKind::id::channel` 次级键）、`events` 未排序（按 id 排序）、中转站 `samples` 同价顺序不稳（加模型名次级键）、AIOS 读仓库外本机文件（测试档位跳过）。另修掉 `collect.mjs` 里残留的旧 UA `FreeAI-Radar/2.0`（F32 的一部分）与回放自动安装判据——`node --import` 下 `argv[1]` 是被执行脚本而非本文件，故改为认 `INDEXAI_HTTP=replay`。

### [x] T0.5 页面冒烟与 DOM 快照

依据：S9.8（子集）· 依赖：T0.1

验收：
- 10 个标签全部通过；连续两次运行 DOM 快照一致。
- 断网时 e2e 仍通过。

结果：`scripts/make-fixture-data.js` 从本机真实数据裁出 `fixtures/data/`（0.52 MB，上限 1 MB），裁剪按结构覆盖而非随机抽样：模型保留全部官方直连 + 每厂商一条 + band 四个分支各两条 + 有/无缓存价各两条（共 80 条）；活动按 source × status 全覆盖 + 每个 kind 与每个 region 各一条 + 按报名数补足（60 条）；评测按六个分组各取 2 个榜、每榜前 20 名（12 榜 240 行）；情报按月均匀抽样（200 条，跨多个月）。`site/build.js` 第 0 版把 `index.html` / `favicon.svg` / `_headers` 与 `--data`（默认 `fixtures/data/`）的数据复制到 `dist/`，每次全量重建。`scripts/serve.js` 只服务 `dist/`、校验 Host 只接受回环、拒绝点开头路径段（S10.5 的一部分，早于 T2.6 落地）。`playwright.config.js` 只跑 Chromium、视口 1280×800、`reducedMotion: reduce`、`page.clock` 固定在 2026-10-24T01:00Z（+08:00 09:00）。`test/e2e/smoke.spec.js` 覆盖 10 个标签：无真正前端错误、`#view` 文本 > 50、`body` 计算 opacity 为 1（对 F01 的锁）；非同源请求全部 abort 并记为 annotation（页面仍直连 Google Fonts 与汇率接口，属 F45/F52 未修，故与被拦截产生的 resource error 分开断言），另有 `__dom__/<tab>.html` 快照，跨平台无后缀。`verify` 末尾加 `build` 与 `test:e2e`，R9 扩到 `fixtures/data`。两次运行快照一致；`HTTP_PROXY=http://127.0.0.1:9` 断网下 10 个标签仍全过（需给 webServer 探测加 `NO_PROXY=127.0.0.1,localhost`，否则代理拦回环）。完整 `npm run verify` 10 秒。

### [x] T0.6 CI

依据：S1.6 · F47 · 依赖：T0.5

验收：
- R12 通过；`grep -rE "wrangler@4|npx --yes|node-version: \"20\"" .github` 无结果。
- 推送后 `gh run list --workflow verify.yml --limit 1` 显示成功。在 H3 后面注明「可以做了」。

结果：新增 `.github/workflows/verify.yml`（`pull_request` 与推送 `main` / `ralph/**` 触发，`permissions: contents: read`，`concurrency` 按 ref 分组并取消旧运行，步骤 checkout → setup-node（`node-version-file: .node-version` + npm 缓存）→ `npm ci` → `npx playwright install --with-deps chromium` → `npm run verify`，失败上传 Playwright 报告）。改 `daily-collect.yml`：顶层权限收窄为 `contents: read`，写权限（`contents: write` / `issues: write`）下放到唯一需要的 job；`setup-node` 改读 `.node-version` 并开 npm 缓存；采集前加 `npm ci`；部署改用 lockfile 里的 wrangler（`npx wrangler pages deploy`，去掉 `--yes` 与 `@4`）；`timeout-minutes` 从 20 提到 25。`wrangler` 以 `-E` 装为 4.152.0 开发依赖并进 lockfile。三个 action 的 SHA 用 `git ls-remote` 现查现填，并逐个读 `action.yml` 确认 `using: node24`（F47 要求）：checkout v7.0.1 `3d3c42e5…`、setup-node v7.1.0 `949feb24…`、upload-artifact v7.0.2 `cf430e03…`。启用 R12：校验 `uses:` 都是 40 位 SHA、无 `npx --yes`、无 `node-version: "20"`。验收 grep 无结果，R12 通过，两份 YAML 用 PyYAML 解析有效。**未验证项**：`gh run list` 需要推送到 GitHub 并等 Actions 跑完，本机没有可用的远程写入，留给 H3。

---

## M1 止血：修掉停更、白屏、丢数据

退出条件：去向为 T1.x 的发现全部关闭；T0.3 里对应的 `todo` 用例转为正式用例并通过。改到 golden 或 DOM 快照的任务，在提交信息里列出差异。

### [x] T1.1 首屏可见与首页解耦

依据：F01、F21 · INV-12 · 依赖：T0.5

步骤：
1. 页面脚本第一行给 `<html>` 加 `js` 类；`body` 的淡入与 `[data-reveal]` 的隐藏只在 `.js` 下生效。启动失败分支与全局 `error` 事件里也加 `.ready`，任何路径都不会停在透明状态。
2. 首页把价格分布叙事移出 `news.length ? … : ""`；要闻区单独占位（固定最小高度），归档到达后只填充要闻区。
3. e2e 新增四个场景：`data.json` 返回 500；禁用 JS；阻断 `news-archive.json`；首页 CLS（用 PerformanceObserver 累计 layout-shift）。

验收：
- 前三个场景下 `body` 的计算 `opacity` 都是 1，且分别能看到错误文案、`<noscript>` 文案、`#priceAxis circle`。注意 Playwright 的 `toBeVisible` 把 `opacity:0` 当作可见，必须断言计算样式。
- 首页 CLS ≤ 0.05。

结果：新增 `test/e2e/firstpaint.spec.js`（4 个场景：data.json 500、禁用 JS、阻断归档、CLS），先全部失败后转绿。主要改动：

1. **F01 的根因不是「失败分支没加 .ready」。** `body{opacity:0}` 在 `prefers-reduced-motion: reduce` 下被一条 `body{opacity:1}` 的媒体查询覆盖，而 Playwright 默认就开减少动效——旧断言因此一直是假绿，真实浏览器里仍然是「先透明、启动成功才淡入」。改为 `html.js body{opacity:0}`＋`<head>` 内联脚本加 `.js`＋`<noscript><style>html.js body{opacity:1}`：有无 JS 都不会停在透明。启动失败分支、全局 `error` / `unhandledrejection` 也补了 `.ready`，错误文案带上 HTTP 状态。
2. **F21** 把价格叙事移出 `news.length ? … : ""`；要闻的标题与条数首屏就有（`nHead` 取 data.json 索引，归档到了再换成归档头），归档未到时用同高骨架占位；归档到达只做原地重绘（`rerenderInPlace()` 保住滚动位置，不再把人弹回顶部）。
3. **CLS 的真正来源是 hero 塌陷**：总览页 `renderHero` 给 `#hero` 加 `is-hidden`，首屏那块 384px 的 hero 在数据到达后整块消失，`#view` 从 444 上移到 60——0.93 的 CLS 全在这里。改为首屏就让 hero `hidden`，并在 `#view` 里用照 `viewHome` 版式排好的静态壳子（home-h / home-sub / home-facts / entries / shead / newsrow）占位，数据到了原地换字。CLS 0.93 → **0.002**。
4. 顺手修掉两处会让快照随帧抖动的老问题：`history.replaceState` 在首屏把地址补成 `#home`，触发浏览器按锚点恢复滚动（首屏跳过 replaceState，并设 `scrollRestoration = "manual"`）；`MOTION.tag()` 给已在视口的元素打 `data-reveal` 后要等两帧 rAF 才加 `.in`（改为立即 `.in`）。
5. 主题在 `</body>` 前同步恢复，深色用户不再看到一帧浅色。

DOM 快照：10 个标签全部重生成，差异只有两类——首屏元素从 `card`（两帧后才 `in`）变成 `card in`，以及 home 多了首屏就存在的 `.home-top` 壳子与要闻骨架（正是本任务的目标）。快照连跑三轮一致。

### [x] T1.2 评测回退

依据：F02 · S8.6 · 依赖：T0.4

步骤：
1. `collect.mjs` 启动时读取输出目录里的上一版完整 `bench.json`，传给 `fetchBenchmarks`，替代现在只有目录的 `prev.bench`。
2. `daily-collect.yml` 的基线步骤同时拉线上 `bench.json`。
3. `bench.mjs`：整源失败时沿用该源上一版的全部榜；LMArena 个别配置失败时，按 `cfg` 沿用对应的旧榜。沿用的榜标 `stale: true`，来源记 `partial`。
4. 用例：故障注入 `huggingface.co` 全部 404，并提供一份上一版 `bench.json` fixture。

验收：用例输出里 arena 榜一个不少且都标 `stale`；`bench.json` 不丢榜；该场景下评测层不跌破门禁下限。

结果：新增 `test/unit/bench-fallback.test.js`（7 项，全绿）。fetch 由测试自己接管，按 URL 返回 `fixtures/files/lmarena-agent-latest.parquet`（真实 parquet），用 `INDEXAI_ARENA_BOARDS` 把榜单缩到 `agent` / `agent_bash_reliability` 两条，单用例内即可跑完。

代码改动：

1. `collect.mjs` 新增并导出 `readPrevBench(path = BENCH_OUT)`：读输出目录的完整 `bench.json`，缺文件／坏 JSON／缺 `boards` 一律返回 `null`（首次运行的合法情况）。`main()` 用它取上一版，传进 `fetchBenchmarks`。
2. `bench.mjs`：
   - 新增 `setPrevBench`（模块级只读引用），`fetchBenchmarks` 开头写入，供各源函数做**配置级**回退；
   - `fetchArenaBoards` 在 catch 之后，对失败配置把上一版同 `cfg` 的榜放回来并标 `stale: true`，同时记 `failed`（走 `sources[].partial`）；
   - 整源失败分支不再覆盖已有的（配置级回退放进来的）旧榜；
   - **「有榜」不等于「抓到了」**：arena 返回 `freshCount`，本轮一条都没解析出来时按 `ok:false` 处理——否则旧榜把 boards 补满，页面会把「沿用」说成「新鲜」（INV-4）。`sources[].boards`/`rows` 也改为统计实际发布出去的条数。
3. `daily-collect.yml` 的基线步骤同时拉 `bench.json`（`${PREV_DATA_URL%/*}/bench.json`），缺失只 warn 不失败。
4. `scripts/make-fixture-data.js`：`fixtures/data/data.json` 的 `bench` 改为目录（删 `boards`、补 `file: 'bench.json'`），与 collect 的瘦身规则一致。**这就是 F02 一直被掩盖的原因**：页面测试的 data.json 带着 boards，谁都不会发现线上基线是空的。

golden 差异（两处，同一原因）：`data.json` 的 `$.bench.sources[0].error` 与 `bench.json` 的 `$.sources[0].error` 各新增一项——回放数据里的 HF parquet 解析不了（见 N04），arena 这一源现在会如实带上失败原因。榜数、行数、其它源全部不变。

### [x] T1.3 Luma 冷却上界

依据：F04 · INV-8 · 依赖：T0.4

步骤：
1. `lumaGet`：冷却前检查「本次运行 Luma 累计冷却」与「geo 剩余预算」，任一会超限就把 Luma 标为受阻并返回空；最后一次尝试失败后不再睡。新增常量：单主机冷却总上限 6 分钟。
2. geo 循环与无 geo 并发池都检查受阻标记，受阻后立即停止；已采结果照常返回，`meta.net` 记 `lumaBlocked` 与原因。
3. 用例：故障注入 `api.lu.ma` 全部 429，用 `lib/clock.js` 的睡眠统计断言。

验收：该用例中冷却总时长 ≤ 6 分钟、全部睡眠 ≤ geo 预算（8 分钟）；Luma 层返回已采部分，meta 里能看到受阻原因。

结果：新增 `test/unit/luma-backoff.test.js`（3 项，全绿）。

`collect.mjs`：

1. 新常量 `EV_LUMA_COOLDOWN_CAP_MS = 6 分钟`，以及模块级 `lumaState`（`blocked / reason / cooldownMs / gaveUp`），导出 `getLumaBlockState()` 与 `resetLumaState()`。
2. `lumaGet` 的 429/403 分支在睡之前过两道闸：**累计冷却 + 本次等待 > 6 分钟**、或**再等会越过 geo 预算**，任一成立就标受阻、立刻返回空，不再睡。旧逻辑按 attempt 递增（180→360→540→720 秒），最后一次睡完还不重试，单请求就能睡掉 12 分钟。
3. 受阻后 `lumaGet` 直接返回空，不再发起新请求：这个源是有状态封禁，继续试探只会把解封时间往后推。
4. geo 循环与无 geo 并发池都检查受阻标记，立刻停手；剩余城市照旧计入 skipped，但日志不再打印 240 个城市名（只报数量）。
5. `meta.net` 新增 `lumaBlocked / lumaBlockReason / lumaCooldownMs / lumaCooldownCapMs`，受阻可被页面与状态页读到（INV-4）。

**同时修掉两个测试基础设施问题**（都是这次才暴露的，不修就做不到「`npm test` 几秒内跑完」）：

- `package.json` 的 `test` 现在自己带 `INDEXAI_HTTP=replay` 与 `--import ./test/support/http-replay.js`。以前靠外部传环境变量，直接跑 `npm test` 时 `lib/clock.js` 会真的睡——Luma 的 180 秒冷却被真实等待，一次 `npm test` 要 60 秒以上。
- `installReplay()` 现在把原生 fetch 存到 `globalThis.__liveFetch`，「录制 → 回放」往返用例用它打本地 HTTP 服务（否则它会去回放表里找 `http://127.0.0.1:PORT/redirect`）。
- `bench-fallback.test.js` 对非 HF 主机返回 503 而不是抛网络错误：抛错会走 `bench.mjs` 的指数退避（8 源 × 3 次 × 1.2s），把用例拖到 60 秒。

golden 差异（4 处，全部是新增字段）：`$.meta.net.lumaBlocked / lumaBlockReason / lumaCooldownMs / lumaCooldownCapMs`。榜数、行数、活动数、其它层全部不变。

耗时：`npm test` 60s → **1.1s**；`npm run verify` 全流程 **12s**（S1.3 目标是 3 分钟内）。

### [x] T1.4 统一超时

依据：F05 · 依赖：T0.4

步骤：
1. `lib/http.js` 第一版：`httpGet(url, opts)`。默认首字节 20 秒、总计 60 秒（`AbortSignal.timeout` 与调用方信号用 `AbortSignal.any` 合并）；网络错误与 408 / 429 / 5xx 指数退避重试（Luma 自己处理 429，可关闭）；统一 UA，从 `package.json` 读 `version` 与 `homepage`；按主机记账，`httpStats()` 并入 `meta.net`。
2. 替换 `collect.mjs`、`bench.mjs` 里全部 `fetch(`、`fetchRetry`、`fetchText`、`fetchBuffer`，各处的重试与超时参数保持原值。
3. 启用 R2a。
4. 用例：故障注入「永不返回」，把超时调小，验证该层变 stale 而不是挂住。

验收：R2a 通过；用例通过；golden 的差异只在 `meta.net` 新增的记账字段。

结果：新增 `lib/http.js`（`httpGet` / `httpText` / `httpJson` / `httpBuffer` + `httpStats` / `httpTotals` / `resetHttpStats` / `assertHttpUrl`）与 `test/unit/http-client.test.js`（11 项，全绿）。

能力（S2.1 全量）：

- 每个请求必有超时，默认 60 秒；与调用方给的 `deadline` 取更紧的那个，已过截止时间直接抛错不发请求。
- 重试只对网络错误与 408 / 429 / 5xx，指数退避加抖动、封顶 8 秒，**遵守 `Retry-After`**（秒数或 HTTP 日期都认）。4xx（非 408/429）是终态，原样交回调用方判断——这条把「一行坏数据整站拒发」的可能性从根上去掉了。
- **手动跟重定向**（最多 5 跳）：不用 `redirect: 'follow'`，因为那样拿不到中间 Location，也就没法拒掉 `ftp://` 之类的跳转目标（INV-14）。每一跳都过 `assertHttpUrl`。
- 统一 UA：`IndexAI/<version> (+homepage)`，版本与首页地址都从 `package.json` 读（D4、S9.9 的单一来源）。
- 按主机记账：请求数、字节、状态码分布、重试次数、被限流次数、累计等待。读正文时通过包装过的 `text/json/arrayBuffer` 累加字节，不读内容就不记流量。

迁移与删除：

- `collect.mjs`：`fetchRetry` 整个删掉（重试/退避/记账已并入客户端）；`devpostPage` / `devfolioPage` / `aibijia` / `frontline` / `aihot` / `fx` / `lumaGet` / `probeRelay` 全部改走统一出口；`probeRelay` 的 `AbortController` + `clearTimeout` 也删了（超时由客户端负责），超时判定改为认 `TimeoutError`。
- `lumaGet` 用 `tries: 1`：429 的退避必须由 T1.3 的冷却闸自己管，客户端再自动重试只会把封禁往后推。
- `bench.mjs`：`fetchText` / `fetchBuffer` 变成客户端薄封装（签名与各源的 tries/timeout 数值不变），`fetchAA` 的裸 fetch 改走 `httpText`。
- `meta.net.http` 新增 `httpTotals()`：主机数、请求数、字节、重试、被限流次数、累计等待。

R2a 已启用，并且**立刻抓出 bench.mjs 里还剩下的 3 处 `fetch(`**——规则不是形式主义，这次是真接线。

golden 差异（1 处，新增字段）：`$.meta.net.http`。测试档位下的账目是 21 个主机 / 40 次请求 / 11.3 MB / 0 次重试 / 0 次限流。其它所有字节不变，说明迁移是行为等价的。

### [ ] T1.5 模型目录纳入记账

依据：F06 · 依赖：T1.4

步骤：OpenRouter 模型目录改走 `T.run('models', …)`，上一版取 `prev.models` 中 `channelKind === 'aggregator'` 的行；失败时沿用并标 stale，后续官方直连合并照常进行。

验收：故障注入 `openrouter.ai/api/v1/models` 返回 503 时采集不中止，模型层 stale，其它层照常输出。

### [ ] T1.6 情报不截断

依据：F07 · INV-9 · 依赖：T0.3

步骤：
1. `encodeNews` 去掉标题与 URL 截断，删除 `CLIP_TITLE`、`CLIP_URL`。
2. 统计现有归档中长度恰为 96 的标题（疑似已被截断），把数量与三个样例写进「发现」，修复交给 T6.4（解析原始出处时一并重取）。
3. F07 的 `todo` 用例转正。

验收：300 字符 URL 与 150 字标题入库后完全一致；去重键使用完整 URL。

### [ ] T1.7 新鲜度门禁

依据：F09、F23 · 依赖：T0.4

步骤：
1. `fetchNews` 返回本次新抓的条数；三路都为 0 时情报层记 `stale`（上一版就是现有归档）。
2. health：按 Asia/Shanghai 日期，最新条目早于今天 2 天及以上为 warn，3 天及以上为 red。
3. health：`meta.fx.source === 'fallback'` 或 `meta.fx.stale` 时 warn；页面健康横幅说明汇率在沿用。

验收：故障注入三路情报源失败，配合固定时钟分别得到 warn 与 red；汇率回退时出现 warn 且页面可见。

### [ ] T1.8 地区与类型硬伤

依据：F10、F11 · 依赖：T0.3

步骤：
1. 地区正则：`in` 删除 `ISLAMABAD|Pakistan`，巴基斯坦城市并入 `asia`；`ca` 补 `Ontario`、`Quebec`、`Québec`、`British Columbia`、`Alberta`、`Kitchener`、`Mississauga`；逐个审 ≤ 6 个字母或能当人名、普通词的英文地名（Rio、Lima、Sofia、Jordan、Georgia、Columbia、Austin、Victoria 等），加词边界或改成更具体的写法。
2. `eventRegion` 的匹配文本只用地点与主办方，不再拼标题。
3. 归并表删掉跨洲映射：`ca`、`au` 不再并入别的区。
4. `eventKind`：删除 `con\b`；会议规则删掉英文 `forum`（保留「论坛」）。
5. F10、F11 的 `todo` 用例转正，并补充：`Lahore, Pakistan` 不是 `in`；`Kitchener, Ontario` 是 `ca`；`Silicon Valley GenAI Meetup` 是 meetup；标题含 Jordan、地点为 London 的场次是 `uk`。

验收：用例全部通过；用本机 `data.json` 的全部活动离线重算一遍，`region=other` 与各 kind 的前后数量写进提交信息，`other` 不得升高。

### [ ] T1.9 比价与中转页

依据：F18、F19、F20 · 依赖：T0.5

步骤：
1. 比价表「缓存读」列的排序键改为 `cache_read`，「折扣」保留 `cache`。
2. `collect.mjs` 下发 `meta.flagships`：每个旗舰的 `key`、`label`、官方 `input` / `output` / `cache_read`，以及按中转画像算出的官方有效成本。前端删除 `RELAY_FLAGS` 与 `officialOf`，改读这份数据。
3. 中转站条形图画出官方有效成本参考线，与现有文案一致。
4. 采集端：探测失败、沿用旧价的站保留原 `checked_at`，超过 14 天不再沿用；前端把这类站放进主列表，状态显示「上次成功 MM-DD」。
5. e2e：点「缓存读」后首行的 `cache_read` 最小，且只有一个表头的 `aria-sort` 不是 none；每个旗舰都画出参考线（DeepSeek 也要有）；fixture 里放一个 stale 站并断言它出现。

验收：上述 e2e 与采集端的单元测试通过。

### [ ] T1.10 样式硬伤

依据：F39、F40、F41 · 依赖：T0.5

步骤：
1. 类名：中转站移动卡 `.rcard` 改为 `.relay-card`，订阅区价卡 `.rcard` 改为 `.region-card`，同步更新动效选择器。
2. `var(--fg)` 改为 `var(--ink)`。
3. 时间轴颜色改为类名加 CSS 变量（`--kind-hackathon`、`--kind-conference`、`--kind-meetup`、`--kind-other`），浅色与深色各一套值，图例用同一组变量。
4. 字号：任何文字 ≥ 10px，正文 ≥ 11px；删掉同一媒体查询内互相覆盖的规则（`.iconbtn`、`.stamp`、`.nav` 等）。
5. e2e：360 宽下订阅页与中转站页的 DOM 快照；脚本扫描所有可见文本节点的计算字号；深色模式下时间轴四类颜色与背景的对比度 ≥ 3:1。

验收：上述检查通过。

### [ ] T1.11 去掉第三方运行时请求

依据：F45、F52 · INV-13 · 依赖：T0.5

步骤：
1. 下载 Inter（可变字重）与 IBM Plex Mono 400 / 500 / 600 的拉丁子集 woff2 到 `assets/fonts/`，附 OFL 许可文件；写 `@font-face`（`font-display: swap`）并预加载正文字体；删除 Google Fonts 的 `link` 与 `preconnect`。`site/build.js` 复制 `assets/`。
2. 删除浏览器端汇率请求 `syncFx` 及其缓存键 `idx.fx`；汇率只读 `data.meta.fx`。
3. e2e：把「拦截非同源请求」改为「出现任何非同源请求即失败」。

验收：e2e 通过；字体文件合计 ≤ 150 KB；启动后整页渲染只发生一次（给 `render` 计数断言）。

### [ ] T1.12 外链白名单

依据：F46 · INV-14 · 依赖：T0.5

步骤：
1. 页面脚本改为 `<script type="module">`（行为不变，DOM 快照不变），为之后共享模块铺路。
2. `lib/url.js`：`safeUrl(u)` 只放行 `http:` / `https:` 绝对地址，处理大小写与前导空白。`site/build.js` 把它复制为 `dist/lib/url.js`，页面 import 使用；采集端同样使用。
3. 页面所有外部 `href` 经 `safeUrl` 渲染，不安全的渲染为纯文本。采集端对活动、情报、挂单、AIOS 的 URL 先过同一规则，丢弃的计入 `meta.dropped.unsafeUrl`。
4. `e.worth` 等数字字段渲染前用 `Number.isFinite` 检查。
5. 用例：`javascript:alert(1)`、`JAVASCRIPT:…`、前导空白的 `javascript:`、`data:`、`vbscript:`、相对地址；e2e 用 fixture 注入一条带恶意链接的活动。

验收：用例全部通过；页面上不存在非 http(s) 的外部 `href`。

---

## M2 清理：删掉不该存在的东西，落实已定决策

退出条件：去向为 T2.x 的发现全部关闭；R5、R6、R8（根目录）、R10 启用并通过。

### [ ] T2.1 删除孤儿与草稿

依据：F28、F30、F37 · 依赖：T0.6

步骤：
1. `git rm` 掉 `news-history.json`、`news-provenance.json`、`directions.html`、`logo-preview.html`、`deploy.mjs`，并清掉 `daily-collect.yml`、README、`health.mjs`（`HISTORY` 常量）里的全部引用。
2. 本地发布不再保留脚本：README 写明人工发布方式（`npm run build -- --data .` 后用 wrangler 发布 `dist/`）。Ralph 永远不执行这条。
3. 若 `data.json`、`bench.json` 仍被 git 跟踪，`git rm --cached` 并写进 `.gitignore`；清理 `.gitignore` 里过时的注释。
4. 启用 R8 的根目录部分，白名单按当前根目录实际应有的文件列出。

验收：`git ls-files` 不含上述文件；R8（根目录）通过；workflow 的发布清单只含站点真正需要的文件。

### [ ] T2.2 删死代码与死数据

依据：F17、F34、F35、F48 · 依赖：T0.4、T0.5

步骤：
1. `collect.mjs`：删除 `fetchBench`、`decodeNews` 导入、`FX_CNY`、`KIND_LABEL`。删除独立的 AA 抓取层（`fetchAA`、`parseAA`、`aaModels`）：页面只用它的计数，内容由评测层的 AA 源提供。删除页面从不读取的 `orModels`（T6.9 改用官方接口时再按需加回）。同步删掉 `health.mjs` 的 `aaModels`、`orModels` 门禁与页面健康横幅里的对应句子。
2. 停止写出页面不读的字段：`effVsOfficial`、`effSpread`、`groupSpread`、`template`、`templateSame`、`samples`、`comparable`（计数照算）、`regionRaw`、`geoCityFallback`、`countryCode`、`countryName`（算完地区即丢）。
3. `index.html`：删除 `renderStarBand`、`growBars`、`openRelay` 与 `data-relay` 分支、`vendors` 路由分支、`[data-benchtab]`、`.distbar`、`.jump`、`.home-side`、`.hs-*`、`.starband`、`.sbrow`、动效选择器里不存在的类；`.starmini` 元素删掉；`.pips` 要么补样式要么删掉（建议删，只显示数字）；`window.__newsBuckets` 改为模块内变量。
4. 清理过期注释与无编号 TODO（`health.mjs` 的 `TODO(校准)`、`collect.mjs` 活动行那条 `TODO`），启用 R5。
5. 已纳入类型检查的目录开启 `noUnusedLocals`。

验收：上述符号、CSS 与字段全部消失；R5 通过；`noUnusedLocals` 零报错；golden 与 DOM 快照的差异只来自删除的字段与元素。

### [ ] T2.3 命名统一

依据：F32 · 依赖：T1.4

步骤：重写 `collect.mjs` 头注释；UA 只保留 `lib/http.js` 里的一份；localStorage 键 `fr.theme`、`fr.density` 改为 `idx.theme`、`idx.density`（不做迁移，旧偏好丢一次可以接受）。

验收：全仓检索 `FreeAI`、`fr.theme`、`fr.density`、`IndexAI/1.0` 均为 0（两份计划文档除外）。

### [ ] T2.4 文档与文案对齐

依据：F22、F28–F31 · 依赖：T2.1、T2.2

步骤：
1. README 按 S11 重写：是什么、本地运行、数据层与来源、健康机制、怎么加数据、边界、许可、规划（链接 UPGRADE_PLAN）。保留原 README 里有价值的「踩过的坑」，但不写任何会过期的数字和文件清单。
2. 方法页与各页 HERO：Devpost 分页与状态、Devfolio、订阅只写实际有的产品（没有 Copilot）、评测写真实的源与榜数（由数据算）、「五层」改正确、「49 个国家」改为由 `subsRegions` 计算。首页评测入口单位改为「个榜」。
3. 尚未实现的承诺先删掉（「分数下跌标黄」），T4.3 实现后再写回。

验收：除两份计划文档外，检索「Copilot」「五层」「分页 5 页」「news-history」「163 个模型」「下跌标黄」均为 0；README 中没有手写统计数字；DOM 快照更新并在提交信息说明。

### [ ] T2.5 单一事实来源

依据：F16、F36 · INV-5 · 依赖：T1.12

步骤：
1. `lib/cost.js`：`effectiveCost(price, profile)` 与用量画像对象（先如实收录现有两套：比价页 `h=0.7, s=0.2`，中转页 `h=0.7, s=0.3`，各起一个名字），附公式的展示文本。采集端、页面（经 `dist/lib/cost.js` import）、方法页都从这里读，删掉页面里的 `effort()` 复刻与写死的 0.7 / 0.3。
2. 页面的主题表改为 import `lib/news.mjs` 的 `decodeNews` 与主题常量（构建时复制为 `dist/lib/news.js`），删掉 `loadNews` 里的复刻表。
3. 来源登记表修正：订阅读 `buy` 字段；评测按 `bench.sources` 逐源登记，删掉单独写死的 Vals。
4. 启用 R10。

验收：R10 通过；来源表包含 9 个评测源与订阅来源；方法页公式由 `lib/cost.js` 渲染；DOM 快照不变（数字一致）。

### [ ] T2.6 小修

依据：F27、F50 · 依赖：T0.5

步骤：
1. Luma 链接改为 `https://luma.com/<slug>`；没有主办方时 `org` 为空字符串。
2. AIOS 只认环境变量 `AIOS_OPPORTUNITIES`，删除写死的候选路径与递归查找；没设变量就跳过这一源（CI 本来就没有它）。
3. `serve.mjs`：根目录固定为脚本旁边的 `dist/`（不再依赖 cwd）；拒绝以点开头的路径段；`Host` 只接受 `127.0.0.1:<端口>` 与 `localhost:<端口>`；同步改 `playwright.config.js`。
4. 启用 R6。在 H5 后面注明「可以做了」。

验收：R6 通过；用例覆盖点文件拒绝与 Host 校验；e2e 照常通过。

### [ ] T2.7 灰色渠道呈现（D3）

依据：F49 · 依赖：T2.2

步骤：
1. 采集端用 `subsThirdStats` 替代 `subsThird`：按产品给出挂单数、在售数、价格最低 / 中位 / 最高（人民币）与平台数，不再下发任何商品页链接。门禁的 `subsThird` 改为统计挂单总数。
2. 订阅页「第三方挂单」改为统计表，没有外链；「买法」一节保留文字与风险标注。
3. 中转站：分组名命中「逆向」「特价」「reverse」等的分组不参与代表价与最低可达价，页面显示被排除的分组数。
4. 方法页同步口径。

验收：`data.json` 与页面中不再出现发卡平台的商品链接（用 fixture 断言）；中转站的单元测试覆盖排除规则。

### [ ] T2.8 站点地址单点（D4 准备）

依据：F52 · INV-5 · 依赖：T1.4

步骤：站点地址只从 `package.json` 的 `homepage` 读取：UA、workflow（用 `node -p` 读取）、README 之外的所有代码都改为引用它。

验收：代码与工作流里检索 `indexai.pages.dev` 只剩 `package.json` 一处（README 与两份计划文档除外）。在 H8 后面注明「可以做了」。

### [ ] T2.9 许可证（D7）

依据：F51 · 依赖：T2.1

步骤：根目录加 `LICENSE`（MIT，`Copyright (c) 2026 mbdtf202-cyber`）；README 的「许可」一节写明 `curated/` 等自有整理数据采用 CC BY 4.0，上游数据按各自许可，署名清单在 T5.10 的数据页。根目录白名单加入 `LICENSE`。

验收：`LICENSE` 存在且 `package.json` 的 `license` 为 MIT；R8 通过。

---

## M3 管线：分层、有边界、可隔离

退出条件：任一层失败都不影响其它层发布；所有外部请求受主机策略表约束；人工数据有 schema 与到期日。T3.1a–e 期间 golden 必须逐字节不变。

### [ ] T3.1a 基础库归位

依据：F56 · §4.3 · 依赖：M2 完成

步骤：`lib/news.mjs`、`lib/parquet.mjs` 改名为 `.js`；`lib/http.js`、`lib/clock.js`、`lib/url.js`、`lib/cost.js` 补齐 JSDoc 类型；`tsconfig.json` 覆盖整个 `lib/`；更新所有导入与 `site/build.js` 的复制清单。

验收：golden 与 DOM 快照不变；`typecheck` 覆盖 `lib/**` 并通过。

### [ ] T3.1b 人工数据外置

依据：F57 · 依赖：T3.1a

步骤：`CURATED_OFFICIAL`、`CURATED_OFFERS`、`SIGNALS`、`RELAYS`、`CURATED_RESOURCES` 原样搬进 `curated/official-prices.json`、`offers.json`、`signals.json`、`relays.json`、`toolkit.json`，`news-milestones.json` 搬到 `curated/milestones.json`；采集端与页面改读新位置。结构化留给 T3.8。

验收：golden 与 DOM 快照不变；`collect.mjs` 里不再有这些常量。

### [ ] T3.1c 采集层拆分

依据：F56 · S4.4 契约 · INV-11 · 依赖：T3.1b

步骤：按 §4.3 建 `pipeline/layers/<id>/`：models、offers、subs、relays、events（devpost、luma、devfolio、aios 作为同层的源）、news、bench、toolkit、adoption、fx。每层导出契约里的 `id`、`sources`、`fetch`、`normalize`；`merge` 与 `health` 先原样沿用现有逻辑。一次搬一两层也可以，按 T3.1c1、T3.1c2 原位拆分。

验收：golden 不变；R3 对 `pipeline/`、`lib/` 启用并通过。

### [ ] T3.1d 编排器替代 collect.mjs

依据：S3.1 · 依赖：T3.1c

步骤：`pipeline/run.js` 接管 `main()`；`health.mjs` 迁入 `pipeline/health/`；`serve.mjs` 移到 `scripts/serve.js`；`npm run collect` 指向新入口；删除 `collect.mjs`、`bench.mjs`、`health.mjs`、`serve.mjs`；更新 workflow、Playwright 配置、`AGENTS.md`、根目录白名单。在 H6 后面注明「可以做了」。

验收：golden 不变；根目录不再有采集脚本；`npm run collect` 在测试档位回放下产出与 golden 相同。

### [ ] T3.1e 格式化与规则恢复

依据：§S1 · 依赖：T3.1d

步骤：对迁移后的全部代码启用 Biome 格式化（单独一个提交），恢复 T0.1 里标「T3.1e 恢复」的 lint 规则并修掉报错。

验收：`biome.jsonc` 里没有「T3.1e 恢复」的豁免；lint 零报错；golden 不变。

### [ ] T3.2 HTTP 客户端完整版

依据：S2.1 · 依赖：T3.1d

步骤：主机策略表 `lib/http-policy.js`（Luma 并发 1、间隔 900 ms、冷却 180 s、冷却总上限 6 min；Devpost、Devfolio、HF 并发 2；GitHub 并发 4；AIHOT 间隔 250 ms；HN 间隔 120 ms；中转站全局并发 5、单站 1；其余默认并发 4）。`lib/http.js` 按表排队与限速，支持 `Retry-After`；层代码里不再出现任何睡眠；回放与录制并入 `lib/http.js` 的 `INDEXAI_HTTP` 模式，`test/support/` 的预加载改为调用它。

验收：层代码中检索不到 `sleep(` 与 `setTimeout(`；运行报告含每主机账目；golden 只有 `meta.net` 的结构变化。

### [ ] T3.3 运行上下文、预算与运行报告

依据：S2.2–S2.4 · INV-7 · 依赖：T3.2

步骤：编排器构造 `ctx`（`now`、`today(tz)`、`http`、`curated`、`registry`、`prev`、`log`）注入各层；层模块不再 import 时钟与网络。每层声明 `budget`，超时或超次返回 `partial` 并写明原因；整次运行截止 15 分钟，workflow 的 job 超时改为 25 分钟。产出 `run-report.json`，CI 写进 job summary 并作为 artifact 保留 30 天（原始响应同样作为 artifact 保留 30 天）。启用 R2b。

验收：R2b 通过；用例「某层超预算」返回 partial 且其它层不受影响；报告结构有 contract 测试。

### [ ] T3.4 时间口径

依据：F13 · S2.2 · 依赖：T3.3

步骤：先用回放数据确认 Luma、Devpost、Devfolio、AIHOT 时间戳的真实时区，结论写进各层 `normalize.js` 的注释；活动存 `startAt` / `endAt`（ISO）与 `tz`，状态按活动所在时区的「今天」判定；情报存 `publishedAt`，按 Asia/Shanghai 归日；页面按访客时区显示。

验收：东京 19:00 开始的场次在 `Asia/Tokyo` 下日期正确；北京时间凌晨发布的新闻归入当天；页面显示有 e2e 用例。

### [ ] T3.5 schema 与坏行隔离

依据：S3.2 · F03 · 依赖：T3.3

步骤：`lib/schema.js`（零依赖：类型、必填、枚举、URL、ISO 日期、数值范围）；每层一份 schema，类型同时写进 `types/*.d.ts`；`normalize` 逐行校验，坏行进 `quarantined` 并附原因；隔离比例超过该层阈值（默认 2%）才判红。现有的语义红线（如 `input=0 && output>0`）改为行级规则。

验收：用例「OpenRouter 某行 input=0、output>0」中该行被隔离、层为 ok 或 warn、运行不失败；隔离明细出现在运行报告。

### [ ] T3.6 合并策略与原子写入

依据：S3.3、S3.4 · F38 · 依赖：T3.5

步骤：每层声明合并策略（目录型、场次型、归档型、人工型，见 S3.3）；门禁通过后才写盘，先写临时文件再原子改名；运行过程中不改动任何已有快照与归档。

验收：用例「Luma 今天只拿到一半」中活动数不低于上一版仍在 TTL 内的场次数；用例「门禁失败」中磁盘上的快照与归档字节不变。

### [ ] T3.7 分层门禁与分层发布

依据：F03 · S3.5、S4.1–S4.3 · 依赖：T3.6

步骤：门禁按层产出结论；每层输出一个文件，输出目录里的 `manifest.json` 记录每层文件名、哈希、status、as_of、last_ok、计数、门禁结论（构建时进入 `dist/data/`，见 T3.9）。某层 red 时沿用上一版：在 data 分支建立之前，从线上 manifest 指向的文件取回。整站只在 manifest 本身或 schema 版本出错时失败。`ALLOW_DEGRADED` 改为 `--allow-degraded <layer>`。页面读 manifest，只在用到该层的页面显示「沿用 N 天」。

验收：用例「评测层 red」中其它层照常更新，manifest 里评测层为 `stale` 并指向上一版文件；只有评测页显示沿用标记。

### [ ] T3.8 人工数据结构化

依据：F14、F15、F57 · S7 · 依赖：T3.5

步骤：
1. `curated/*.json` 每个文件带 `schema` 版本；每条记录补 `verified_at`、`review_by`、`evidence: [{url, quote, captured_at}]`。`verified_at` 先按 git 历史里该条目最后一次修改的日期填，`review_by` 统一设为其后 90 天，之后由 T6.5 维护。
2. 官方价按原币与原数字存储（DeepSeek、MiniMax 为人民币），美元价在派生阶段用当天汇率折算并记录汇率与日期；分档价写 `tiers`，分时价写 `schedule`（DeepSeek 工作日高峰 ×2）；Gemini 4 Argon 拆成 `valid_until: 2026-11-30` 与 `valid_from: 2026-12-01` 两条；`FLAGSHIP.official` 改为从官方价派生。
3. 门禁：`review_by` 进入 7 天内为 warn；过期记录标「待复核」，不参与最低价与同族最低。
4. 页面：免费额度卡片与模型抽屉显示「核实于 YYYY-MM-DD」与证据链接；手填价不再显示「采集日 = 今天」。

验收：schema 校验覆盖全部人工数据；假时钟用例中 Gemini 4 Argon 在 2026-12-01 自动切到新价；人民币价随汇率变化的用例通过；e2e 能看到核实日期。

### [ ] T3.9 单一构建与发布

依据：F37、F47 · S3.5 · 依赖：T3.7

步骤：
1. `site/build.js` 读取采集输出与 manifest，把每层数据写成带内容哈希的文件，生成 `dist/data/manifest.json`；页面通过 manifest 找数据文件。`_headers`：manifest 不缓存，带哈希的文件长缓存。
2. `daily-collect.yml` 拆成 collect、build、deploy 三个 job：只有 deploy 拿 Cloudflare 密钥；只有需要写仓库的 job 拿写权限。
3. 部署后拉线上 manifest，逐层核对哈希；不一致即失败并告警。
4. 启用 R8 的 `dist/` 部分。

验收：workflow 的组装步骤只有 `npm run build`；Cloudflare 密钥只出现在 deploy job；R8 通过；线上自检比对的是哈希。

---

## M4 资产：历史、变化、统一实体

退出条件：站点能回答「什么变了」与「这个模型在各处多少钱、多强」。

### [ ] T4.1 data 分支

依据：D1 · S5.1、S4.2 · 依赖：T3.9

步骤：
1. CI 首次运行时创建 orphan 分支 `data`（只有 bot 写）。布局：`snapshots/<layer>.json`（稳定排序，一行一条记录）、`status/<layer>.ndjson`（每次尝试一行）、`news/<YYYY-MM>.json`、`series/`、`changes/`。
2. 采集的上一版从 data 分支读取，不再从线上站点下载；构建从 data 分支的快照生成站点。
3. 把现有 `news-archive.json` 与 `news-seed.json` 合并迁入 `news/` 月度分片，从 `main` 删除这两个文件；停止向 `main` 推送任何数据提交。
4. `npm run data:pull`：把 data 分支检出到 `.data/`（加入 `.gitignore`），本地可用 `npm run build -- --data .data` 构建真实站点。

验收：`main` 之后不再出现 bot 提交；用 data 分支任意一天的快照都能构建出完整站点（用两天的 fixture 快照测试）。

### [ ] T4.2 状态日志、告警与状态页

依据：S4.2、S4.4 · 依赖：T4.1

步骤：告警逻辑做成纯函数：读 `status/<layer>.ndjson`，同一层连续两次 red 或 stale 时开或追加带 `layer:<id>` 标签的 issue，恢复后评论并关闭；替换现在按日期开 issue 的步骤。页面加「状态」视图（M5 迁为 `/status/`）：每层、每个源最近 30 次运行的状态、计数趋势、耗时、请求账目与被限流次数。

验收：告警决策有单元测试（开、追加、关闭三种路径）；状态视图有 e2e。

### [ ] T4.3 变化引擎与 Atom 源

依据：S5.2 · F29 · 依赖：T4.1

步骤：`pipeline/derive/changes.js` 比较今天与上一版快照，产出 S5.2 表中的全部事件类型，写入 data 分支的 `changes/<date>.json`；构建生成 `dist/feeds/changes.xml`（Atom）；评测页标出「较上次下降」的分数；README 与评测页头恢复相应描述。

验收：两份 fixture 快照的 golden 覆盖每一类事件；Atom 源通过结构校验（解析成功、必填元素齐全）。

### [ ] T4.4 厂商表

依据：S6.1 · 依赖：T3.8

步骤：`registry/vendors.json` 收录现有 `VENDOR` 映射与页面的 `VENDOR_RANK`（排序字段 `rank`）；各层的厂商名经它归一；未知厂商进未匹配报告。

验收：代码里不再有 `VENDOR` 与 `VENDOR_RANK` 常量；归一有单元测试。

### [ ] T4.5 模型表与匹配器

依据：S6.2、S6.3 · F24 · 依赖：T4.4

步骤：
1. 用一次性脚本从 OpenRouter 目录、官方价、评测各源、中转站旗舰生成 `registry/models.json` 初稿；别名只收精确写法。可以让 LLM 离线提议别名，逐条核对后再提交（D6）。
2. `lib/match.js`：精确别名 → 归一后精确相等 → 未匹配；推理档位挂到父模型的 `variant`。
3. 评测对照表、散点、中转站旗舰全部改为经实体 ID 关联；删除页面的 `bnorm` / `modelFor` 前缀匹配。

验收：匹配器测试覆盖别名、变体、未匹配三条路径；页面里检索不到前缀匹配代码。

### [ ] T4.6 未匹配报告与质量线

依据：S6.4、S6.5 · 依赖：T4.5

步骤：每个源的未匹配名称与次数写进 `status/unmatched.json`，在状态视图列出；补齐别名直到达到 S6.5 的质量线。

验收：测试按 fixture 快照断言 OpenRouter 用量前 100 与全部旗舰的匹配率 ≥ 95%、每个评测榜前 30 名 ≥ 90%。

### [ ] T4.7 动态基线门禁

依据：F33 · S4.1 · 依赖：T4.2

步骤：缩水判定改为相对近 7 次成功快照计数的中位数；删除门禁代码里所有手填的「实测值」与相关注释，只保留保守的绝对下限。

验收：用例覆盖「单日异常低值不污染基线」「历史不足 7 次时退回下限判定」。

### [ ] T4.8 价格序列

依据：S5.3 · 依赖：T4.3、T4.5

步骤：派生 `series/models/<id>.json`、`series/relays/<domain>.json`、`series/subs/<plan>.json`，只存变化点。

验收：由多日 fixture 快照派生的三类序列只含变化点，都有测试。

---

## M5 前端：预渲染、可达、快

退出条件：S9 全部条目由 e2e 与构建检查执行；`index.html` 单体文件不复存在。每个任务结束时 DOM 快照只允许出现任务目标本身带来的差异。

### [ ] T5.1 纯函数视图

依据：S9.1 · 依赖：M4 完成

步骤：把 `index.html` 里的每个 `viewX()` 搬到 `site/views/<page>.js`，改成 `(data, state) → html` 的纯函数，不读全局状态；格式化函数（`money`、`ctx`、`pct`、`kfmt` 等）进 `site/views/format.js`；样式搬到 `site/styles/`；页面脚本只剩状态管理与事件绑定。按页面原位拆成 T5.1a、T5.1b……逐页搬。

验收：每个视图有 HTML 快照测试；e2e 的 DOM 快照不变。

### [ ] T5.2 预渲染多页与懒加载

依据：S9.1–S9.3 · F53 · 依赖：T5.1

步骤：`site/routes/` 每个路由一个文件（路径、标题、描述、数据依赖、视图）；构建为每个路由输出独立 HTML，首屏数据内嵌；浏览器入口模块只做交互增强，经 `site/client/data.js` 懒加载 manifest 指向的数据（评测按榜、情报按月）；首页数据在构建期单独产出。启用 R3（`site/`）与 R2c。

验收：每个路由不开 JS 可读；没有页面请求完整的 `data.json`；首页不请求情报归档。

### [ ] T5.3 真实路由与 URL 状态

依据：F42 · S9.2 · 依赖：T5.2

步骤：导航改为带 `aria-current` 的链接；筛选状态读写 URL 查询参数；首页入口模块把旧的 `#tab` 地址跳转到新路径；跨页切换加 `@view-transition { navigation: auto; }`。

验收：e2e：浏览器返回键回到上一页；任意筛选组合复制 URL 后在新页面结果一致；`/#compare` 跳到 `/compare/`。

### [ ] T5.4 局部重绘、焦点与对话框

依据：F43 · S9.4 · 依赖：T5.2

步骤：`site/client/render.js` 成为唯一的 DOM 写入口，按区域重绘并恢复焦点与滚动位置；模型详情改为 `<dialog>`（打开移交焦点、关闭归还）；表格里模型名是指向 `/models/<id>/` 的链接，排序表头是 `th` 里的 `button`。启用 R7。

验收：e2e：点击任一筛选后 `document.activeElement` 仍是该控件；对话框可用 Esc 关闭并归还焦点；表格中每个模型名都可用 Tab 聚焦。

### [ ] T5.5 e2e 全量与视觉回归

依据：S9.8 · 依赖：T5.4

步骤：e2e 覆盖每个路由 × 360 / 768 / 1280 × 浅色与深色：控制台错误、横向溢出、axe（serious / critical 为零）、键盘流程、只请求同源、禁用 JS。新增 `visual.yml`：在 Playwright 官方 Linux 容器里做截图对比；基线只由手动触发的工作流生成并提交。

验收：S9.8 全部条目在 CI 中执行并通过；`visual.yml` 首次运行生成基线。

### [ ] T5.6 设计令牌与深色模式

依据：F40、F41 · S9.5 · 依赖：T5.1

步骤：`site/styles/tokens.css` 定义颜色、间距、字号阶梯、圆角、动效时长，浅色与深色两套值；组件样式只引用令牌，类名按组件命名空间；默认跟随 `prefers-color-scheme`，手动切换覆盖。写一个检查脚本：每个选择器只定义一次。启用 R4、R11。

验收：R4、R11 通过；浅色与深色下 axe 的 `color-contrast` 规则零违规。

### [ ] T5.7 性能预算

依据：S9.7 · 依赖：T5.2

步骤：构建结束时按 brotli 计算每个路由的首屏传输量与每个懒加载数据文件的大小，超出 S9.7 即失败；e2e 在 4 倍 CPU 降速下记录 CLS 与长任务并断言上限。只有超预算才考虑引入 esbuild 压缩。

验收：预算检查在构建与 e2e 中执行并通过。

### [ ] T5.8 安全响应头

依据：F46 · S10.1 · 依赖：T5.2

步骤：`_headers` 写入 S10.1 的全部响应头；页面不留任何内联 `<script>`（JSON-LD 数据块除外）；e2e 监听 `securitypolicyviolation` 事件。

验收：e2e 中没有 CSP 违规；检索构建产物没有内联脚本。

### [ ] T5.9 文案、控件与审美评审

依据：F31、F44 · S9.10 · INV-15 · 依赖：T5.6

步骤：比价页合并重复的厂商筛选与价格带筛选；统一术语（有效成本、代表分组、最低可达价、沿用、待复核）；删掉布局已经说清楚的次级说明；决定颗粒纹理与滚动叙事的去留（必须满足预算且不挤占首屏）；按 UPGRADE_PLAN §8.3 跑一次审美评审，不通过的条目转成新任务。

验收：比价页只有一组厂商筛选和一组价格带筛选；审美评审五条全部通过并把结论写进「结果」。

### [ ] T5.10 SEO、署名与数据页

依据：F51 · S9.9 · D7 · 依赖：T5.3

步骤：每个路由独立的 `title`、`description`、canonical（地址来自 `package.json` 的 `homepage`）；生成 `sitemap.xml`、`robots.txt`；`/data/` 页列出每个公开数据文件、schema、许可与上游署名（OpenRouter CC BY 4.0、Artificial Analysis 署名要求、LMArena 等），并以 schema.org `Dataset` JSON-LD 描述；默认分享图用仓库内的静态 PNG。

验收：sitemap 覆盖全部路由与模型页；每页标题唯一；`/data/` 页的署名覆盖全部上游源。

---

## M6 增长：让索引变成工具

按顺序做，每项独立交付。

### [ ] T6.1 模型详情页与厂商页

依据：S6、S5.3 · 依赖：M5 完成

步骤：为注册表里每个模型生成 `/models/<id>/`：各渠道价格（官方、聚合、中转）、价格线、评测、在售中转站、相关免费额度与新闻；为每个厂商生成 `/vendors/<id>/`。标题直接写价格（S9.9）。

验收：每个模型与厂商都有页面；通过 e2e 与性能预算。

### [ ] T6.2 首页「今日变化」与变化页

依据：S5.2 · 依赖：T6.1

步骤：首页首屏以当日变化为主角，按类型分组并可跳到详情；没有变化的日子显示最近一次变化的日期；`/changes/` 按日列出全部变化。

验收：e2e 覆盖「有变化」与「无变化」两种 fixture。

### [ ] T6.3 订阅值不值计算器

依据：S8.1、S8.3 · 依赖：T6.1

步骤：在订阅页加计算器：输入月用量或选一个用量画像，比较各订阅档位与按 API 计价（官方、聚合、中转三种渠道）的月成本，给出盈亏平衡点。计算是 `lib/cost.js` 里的纯函数，参数进 URL。

验收：纯函数有单元测试；结果可经 URL 分享；用到的每个价格都能点到来源。

### [ ] T6.4 情报出处、多源与聚类

依据：F08、F26 · S8.7 · 依赖：T4.1

步骤：
1. 从 aihot 条目页解析原始链接，存为 `url`，聚合页存为 `via`；去重以规范化后的原始 URL 为键；T1.6 记下的疑似截断标题一并重取修复。
2. 接入至少 6 个官方源（厂商博客或 changelog 的 RSS / Atom、指定仓库的 GitHub releases）与 HN 的 AI 热帖，每个源有权重与新鲜度门禁。
3. 48 小时内标题高度相似的条目合并为一个事件，显示来源数。
4. 主题与打分规则集中到一个文件，去掉按人名扣分；标注集 `fixtures/labels/news.json` ≥ 300 条。

验收：新入库条目 ≥ 90% 带非聚合域名的原始出处；同一事件只显示一次；主题 macro-F1 ≥ 0.80。

### [ ] T6.5 官方页面监测

依据：S8.8 · 依赖：T3.8

步骤：对 `curated/` 里每个证据 URL 每日抓取，去掉脚本、样式、导航后归一化正文取哈希；哈希变化时产出带前后文的差异摘录，进状态视图「待复核」，并开带 `review:pricing` 标签的 issue；未变化时自动刷新 `checked_at`。前端渲染、抓不到正文的页面标 `watch: false` 并写原因。

验收：每个证据 URL 都有监测状态；用例中正文变化触发待复核与 issue，未变化时 `checked_at` 前进。

### [ ] T6.6 活动质量

依据：F10、F12 · S8.5 · D11 · 依赖：T3.4

步骤：
1. 标注集 `fixtures/labels/events.json` ≥ 300 条，按来源分层抽样（`isAI`、`kind`、`region`）。可让 LLM 离线初标，逐条复核后提交。
2. AI 相关性：活动形态词单独出现不算命中，每条记录写 `matchedBy`。
3. 地区：国家码优先，其次用一次性生成的地名表（城市 → 国家，含中文名）；只匹配地点字段；按 ISO 代码存储，展示字典里「中国大陆」与「港澳台」分开。
4. 跨源去重：规范化 URL，加上「标题相似 + 同日 + 同城」。
5. 生成 `feeds/events.ics`，可按类型与地区过滤。

验收：S8.5 的质量线全部在测试里断言；跨源重复率 < 1%；ics 文件通过 iCalendar 结构校验。

### [ ] T6.7 中转站历史与可用率

依据：S8.4 · 依赖：T4.8

步骤：`curated/relays.json` 补 `added_at`、`discovered_via`，移除的站保留记录与原因；每站显示旗舰价序列与 30 天可用率；页面写明「N 家是同一个价目模板」（模板分组在派生层重新计算）。

验收：可用率与模板分组有单元测试；页面有 e2e。

### [ ] T6.8 评测加载与源修正

依据：F25 · S8.6 · 依赖：T5.2

步骤：评测页初次只加载目录与当前所选的榜；名次在构建期预计算；τ-bench 先按 `submission_date` 排序再截取；`lib/parquet.js` 解析失败时退到 HF dataset viewer 的 `/rows` JSON 接口。

验收：e2e 断言评测页首次只请求目录与一个榜；Parquet 回退用例通过。

### [ ] T6.9 官方 API 接入

依据：F48 · D2 · 依赖：H7、T3.2

步骤：Artificial Analysis 改走官方免费 API（新的 V2 端点，不用 2026-11-04 退役的 `/api/v2/data/*`），OpenRouter 排行与应用榜改走官方 Data API；页面与 `/data/` 页按要求署名；删除 RSC 抓取与 HTML 正则解析代码；录制时请求头里的 key 不落盘。

验收：两源走官方接口；旧抓取代码检索不到；回放数据里检索不到 key。

### [ ] T6.10 纠错入口、投稿模板与全站搜索

依据：D10 · 依赖：T5.4

步骤：每条记录有「报错」链接，打开预填记录 ID 与来源的 GitHub issue；`.github/ISSUE_TEMPLATE/` 加「报错」「投稿免费额度」「投稿工具」三个模板；Ctrl / ⌘ + K 打开全站搜索，按名称跳到模型、厂商、免费额度。

验收：e2e 覆盖搜索的键盘流程；模板文件通过 GitHub issue forms 的 schema 校验。

### [ ] T6.11 免费额度结构化

依据：S8.2 · 依赖：T3.8

步骤：在架记录补结构化 `quota`（`amount`、`unit`、`period`、`scope`），原文另存；支持按价值排序；到期记录自动归档到「已结束」；7 条低置信记录逐条复核，补证据或下架。

验收：全部在架记录有结构化额度；低置信记录为 0 或都有明确的复核结论。

### [ ] T6.12 订阅渠道完善

依据：S8.3 · 依赖：T3.8、T4.3

步骤：ChatGPT、Claude、Gemini 的官网价作为第二渠道人工维护并附证据；页面对比「App Store 价 vs 官网价」；区价变化进入变化流。

验收：三个产品都有官网价与证据；区价变化有变化流用例。

---

## M7 持续

### [ ] T7.1 升级 Node 26

依赖：M6 完成，且日期在 2026-10-28 之后（Node 26 进入 LTS）。

步骤：`.node-version` 改为 26，`engines.node` 改为 `>=26`，CI 跟随。

验收：本地与 CI 的 `npm run verify` 通过。

### [ ] T7.2 月度审计（周期任务）

依赖：今天不早于「下次执行」日期。下次执行：2026-11-24。

步骤：依赖更新；上游条款与署名复核；a11y 抽查（读屏、键盘）；性能预算余量；死代码与过期注释。结论追加到本节末尾（一行一次），问题转成新任务。做完后不打勾，把「下次执行」改为 30 天后。

### [ ] T7.3 数据质量周报

依赖：T4.2

步骤：各层门禁、匹配率、隔离率、标注集指标的周趋势，自动出现在状态视图。

验收：状态视图展示最近 8 周的趋势，有 e2e。

### [ ] T7.4 大陆可达

依赖：H8 已勾选。

步骤：自定义域名生效后，核对 canonical、sitemap、UA 都已指向新域名；记录大陆主要运营商的可达性抽测方法与结果。国内镜像（需备案）在流量足够时另行决定。

验收：线上 canonical 与 sitemap 使用新域名。

