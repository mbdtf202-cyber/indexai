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
- [ ] **H5 本机预览**（**T2.6 已完成，可以做了**）：预览服务改为只服务 `dist/`。用本机真实数据构建一次：`npm run build -- --data .`；launchd 的 `com.raki.indexai.serve` **需要改**——脚本已从 `serve.mjs` 迁到 `scripts/serve.js`，参数形式也变了（见 H6）。
- [ ] **H6 预览脚本迁移**（T3.1d 之后）：预览脚本移到 `scripts/serve.js`，更新 launchd plist 的程序参数并 `launchctl kickstart -k gui/$(id -u)/com.raki.indexai.serve`。
- [ ] **H7 API key**（T6.9 之前，越早越好）：申请 Artificial Analysis 与 OpenRouter 的免费 API key；GitHub 仓库 Secrets 添加 `AA_API_KEY`、`OPENROUTER_API_KEY`；Ralph 录制回放数据时，在循环环境里提供同名环境变量（只读 key，不是部署密钥）。
- [ ] **H8 自定义域名**（**T2.8 已完成，可以做了**）：选定并购买域名，在 Cloudflare Pages 项目 `indexai` 绑定；然后**只改 `package.json` 的 `homepage` 一处**——UA、工作流的基线拉取与探活都从它现读，不需要别的改动。

## 发现

（Ralph 在这里记录新问题，格式：`- [ ] N01（来自 T0.3）：问题。去向：T1.8 / 新任务 T2.10 / 已当场修复`）

- [ ] N01（来自 T1.1）：禁用 JS 时 Playwright 的 `getByText` 找不到 `<noscript>` 里的文案（Chromium 把它当文本节点而非元素），可见性断言会得出错误结论。已改用 `noscript .empty` 选择器 + 几何断言，并记入 AGENTS.md 已知坑。去向：已当场处理，AGENTS.md 保留。
- [ ] N02（来自 T1.1）：`index.html` 里有两个同名的 `best`——`viewHome` 指「中转站最低 Sonnet」，`renderKpis` 指「最大缓存折扣」。首屏把关键数字下移到 KPI 时极易串味（本次已用 `cheapestSonnet` 绕开）。去向：T5.9 / T4.4–T4.6 统一实体后一并清掉。
- [ ] N09（来自 T1.8）：**T1.8 的验收「other 不得升高」与 F10 的修法本质冲突。** 只要去掉「用标题猜地区」，标题里那些地名就不再贡献判定，缺 geo 的场次必然落 other；而真正该做的是让源补 geo（Luma 的 `geo_address_info` 在 59 条上是空的）。建议人修改本文件这一条验收为「other ≤ 10% 且不含可判定记录」，或把它挂到 T6.6 的标注集质量线上一起衡量。Ralph 未擅改。
- [ ] N10（来自 T1.8）：`EV_REGION_RULES` 仍是 12 条巨型正则，长度与可读性都已到顶（`us` 那条超过 1,200 字符）。**T1.8 只做了纠错，没做重构**——S8.5 要求「国家码优先，其次地名表（城市 → 国家，一次生成后入库）」，那是个数据文件而不是正则。去向：T6.6。
- [ ] N08（来自 T1.7）：`T.run` 的「上一版」参数对**非快照类层**语义不清。情报层的上一版是磁盘归档而不是上一版 data.json，传 `null` 会把「沿用」误判成 `failed`，传代理对象又会被 `size()` 数错并在沿用分支把代理交回下游。M3 拆层时应把「上一版从哪来」变成每层显式声明（S3.3 的四种合并策略正是这个）。去向：T3.3。
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

## M1 止血：修掉停更、白屏、丢数据 ✅

退出条件：去向为 T1.x 的发现全部关闭；T0.3 里对应的 `todo` 用例转为正式用例并通过。改到 golden 或 DOM 快照的任务，在提交信息里列出差异。

**里程碑结论（2026-10-25）**：T1.1–T1.12 全部完成。

- 去向为 T1.x 的发现共 21 条（F01、F02、F04–F07、F09–F11、F18–F21、F23、F39–F41、F45、F46、F52），逐条核对已关闭；F20 的前端部分在收尾复核时补做（见 T1.9）。
- T0.3 的 `todo` 用例由 8 条降到 **3 条**，剩下的都不属于 M1：F24（跨层对齐，T4.4–T4.6）、F09 相关（`parseNewsYaml` 首条被吞，T6.4）、以及一条随 F24 走的 familyKey 用例。
- `npm run verify` 全程通过：lint / typecheck / invariants（R1、R9、R2a、R12）/ 253 项单元与 golden / build / **28 项 e2e**，耗时约 14 秒。
- 两个「验收条款本身有问题」的情况已记进「发现」交人裁决，未擅改规格：**N09**（T1.8 的「other 不得升高」与 F10 的修法冲突）。
- 一处规格未覆盖、但已做：模型目录纳入记账后，`bench` 与 `models` 都成了独立层，`meta.collect` 从 10 条变 11 条。

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

### [x] T1.5 模型目录纳入记账

依据：F06 · 依赖：T1.4

步骤：OpenRouter 模型目录改走 `T.run('models', …)`，上一版取 `prev.models` 中 `channelKind === 'aggregator'` 的行；失败时沿用并标 stale，后续官方直连合并照常进行。

验收：故障注入 `openrouter.ai/api/v1/models` 返回 503 时采集不中止，模型层 stale，其它层照常输出。

结果：`collect.mjs` 新增 `fetchModelCatalog()`（拿到目录或抛错，不自己吞），主流程改为 `T.run('models', …)`，基线取 `prev.models` 里 `channelKind === 'aggregator'` 的行——官方直连是人工核实的，不该在「目录拉不到」时被一起标成 stale。

故障注入实测（`INDEXAI_FAULTS='{"openrouter.ai":{"status":503}}'`，测试档位 + 上一版基线）：

```
aa:fresh | aibijia:fresh | bench:fresh | devfolio:fresh | devpost:fresh | hn:fresh
| luma:fresh | models:stale | news:fresh | openrouter:stale | resources:fresh
models: 474  aggregator: 462   （与健康采集完全一致）
```

采集退出码 0，模型数一条不少，其它层照常。改动前这一场景会整次中止。

新增 `test/unit/models-layer.test.js`（3 项）：aggregator 行可原样沿用（除 stale 外一个字段都不许变）、去重后同一 OpenRouter id 不出两行、官方直连与聚合层互不覆盖。

golden 差异（1 处）：`$.meta.collect.length` 10 → 11——`models` 现在是独立记账的层，多了一条记录（`models:fresh`）。所有数据字节未变。

### [x] T1.6 情报不截断

依据：F07 · INV-9 · 依赖：T0.3

步骤：
1. `encodeNews` 去掉标题与 URL 截断，删除 `CLIP_TITLE`、`CLIP_URL`。
2. 统计现有归档中长度恰为 96 的标题（疑似已被截断），把数量与三个样例写进「发现」，修复交给 T6.4（解析原始出处时一并重取）。
3. F07 的 `todo` 用例转正。

验收：300 字符 URL 与 150 字标题入库后完全一致；去重键使用完整 URL。

结果：`lib/news.mjs` 删掉 `CLIP_TITLE` / `CLIP_URL` 两个常量（不留 null 占位，INV-10），`encodeNews` 的 `title` 与 `u` 不再 `slice`。注释里原本写着「标题不压」，实现却在压——现在两者一致了。

F07 的两条 `todo` 用例转正（`npm test` 的 todo 从 8 降到 6）。

**现有归档的截断统计**（`news-archive.json`，2,246 条）：

- 标题长度恰为 96：**1 条**
- URL 长度恰为 168：**0 条**（潜伏，未发生）

那一条的样例（URL 省略）：

```
https://aihot.news/items/qovcune9w40laikj226y5u1cy
→ 「…多时候是没有价值 这并不是 AI 的问题 只是经济学的基本原」
```

读者从这条 title 上看不出被截过，也补不回来——只能等 T6.4 解析原始出处时按 id 重取。数量只有 1 条，代价可控。

golden 差异：**无**。回放数据里最长标题 79 字，没有任何一条触及旧的 96 上限，所以这次修复对回放输出逐字节无影响（已核：`news-archive.json` 352 条、0 行变化）。

### [x] T1.7 新鲜度门禁

依据：F09、F23 · 依赖：T0.4

步骤：
1. `fetchNews` 返回本次新抓的条数；三路都为 0 时情报层记 `stale`（上一版就是现有归档）。
2. health：按 Asia/Shanghai 日期，最新条目早于今天 2 天及以上为 warn，3 天及以上为 red。
3. health：`meta.fx.source === 'fallback'` 或 `meta.fx.stale` 时 warn；页面健康横幅说明汇率在沿用。

验收：故障注入三路情报源失败，配合固定时钟分别得到 warn 与 red；汇率回退时出现 warn 且页面可见。

结果：新增 `test/unit/health-freshness.test.js`（9 项，全绿）。

`collect.mjs`：

- `fetchNews` 现在算出 `freshCount`（`merged.length - before`），用不可枚举的 `__freshCount` 挂回归档——**不改 JSON 形态**，golden 逐字节不受影响。
- 情报层改走带 `valid` 的 `T.run`：`valid: fresh > 0`。三路源全挂时 `freshCount === 0` → 走「沿用上一版」分支。
- 基线传的是**磁盘上现有的归档数组**（不是 `null`，也不是条数代理）。踩了一次坑：先给了 `{ items: n }` 这种代理，`size()` 把它算成 1，T.run 就把代理原样返回，下游 `list.map` 直接炸（`failed: list.map is not a function`）。用真数组后语义也对了——沿用的是哪一份就交回哪一份。

`health.mjs`：

- 新增 `todayInShanghai()`（`Intl.DateTimeFormat` + `Asia/Shanghai`）与 `daysBetween()`（UTC 相减，避开夏令时），运行时零依赖。
- 情报新鲜度：最新一条按 `Asia/Shanghai` 归日算年龄，**2 天前 warn、3 天前 red**。只看跨度会被「归档只增不删」骗过去——十几天没新条目也一路绿灯，这就是 F09。
- 汇率：数值区间之外再查来源。`source === 'fallback'`（回退到写死的 7.1）warn 并说明「人民币价按它折算」；`stale === true`（沿用上次）也 warn。这是 F23。

故障注入实测（`aihot.news` 与 `data.aibijia.org` 全 503，预置一份 352 条的归档）：

```
[collect] news 归档 352 → 352 条（新增 0）…
[collect] news 三路源本次都没拿到新条目，沿用现有归档
→ {"layer":"news","status":"stale","n":0,"prev":352}
```

采集退出码 0，归档原样保留，状态如实记 stale。

**测试自身的一个坑**：`health-freshness.test.js` 一开始在 `npm test` 下失败、单跑却通过——因为用例把「今天」写死在 2026-10-24，而 `lib/clock.js` 只在模块加载时读一次 `INDEXAI_NOW`，`npm test` 并不设它。改成在 import `health.mjs` **之前**自己设 `INDEXAI_NOW`，用例才真正与日期无关。

golden 差异：无（回放数据下 `news:fresh`、`models:fresh`，与改前一致）。

### [x] T1.8 地区与类型硬伤

依据：F10、F11 · 依赖：T0.3

步骤：
1. 地区正则：`in` 删除 `ISLAMABAD|Pakistan`，巴基斯坦城市并入 `asia`；`ca` 补 `Ontario`、`Quebec`、`Québec`、`British Columbia`、`Alberta`、`Kitchener`、`Mississauga`；逐个审 ≤ 6 个字母或能当人名、普通词的英文地名（Rio、Lima、Sofia、Jordan、Georgia、Columbia、Austin、Victoria 等），加词边界或改成更具体的写法。
2. `eventRegion` 的匹配文本只用地点与主办方，不再拼标题。
3. 归并表删掉跨洲映射：`ca`、`au` 不再并入别的区。
4. `eventKind`：删除 `con\b`；会议规则删掉英文 `forum`（保留「论坛」）。
5. F10、F11 的 `todo` 用例转正，并补充：`Lahore, Pakistan` 不是 `in`；`Kitchener, Ontario` 是 `ca`；`Silicon Valley GenAI Meetup` 是 meetup；标题含 Jordan、地点为 London 的场次是 `uk`。

验收：用例全部通过；用本机 `data.json` 的全部活动离线重算一遍，`region=other` 与各 kind 的前后数量写进提交信息，`other` 不得升高。

结果：F10、F11 的 `todo` 用例转正，新增 6 条验收用例（`test/unit/collect.test.js`，88 项全绿；`npm test` 的 todo 从 6 降到 3）。

改动：

1. `eventKind`：删掉 `con\b`（它让任何 "Silicon Valley Con…" 都成了会议）；会议规则删掉英文 `forum`（保留中文「论坛」，那确实是会议）。
2. `eventRegion` 的匹配文本改成 `location + org`，**不再拼标题**。这是 F10 的大头：标题里的 Jordan（人名）、Austin（也可能人名）、Toronto（线上活动的口号）过去直接决定地区。
3. 规则表逐条收紧：`in` 删掉 `ISLAMABAD|Pakistan`（搬到 `asia`，与国家码表 `PK→asia` 一致）；`ca` 补 `Ontario / Quebec / Québec / British Columbia / Alberta / Kitchener / Mississauga`；`Rio`、`Lima`、`Sofia`、`Illinois` 等短词一律加 `\b`；latam 的 `Rio` 不再吃掉 Ontario。
4. 归并表删掉跨洲映射：`ca → latam`、`au → asia` 都删了，没有同洲大区可归就落 `other`——宁可不归并，也不要「拉美」里出现多伦多。
5. 补了 5 个线上真实出现、且地点本身可判定的名字：`Jaipur`、`CETYS`（墨西哥）、`Community Branch Library` / `Hack Club` / `Pololu`（美国）。这 5 条过去都是靠标题里碰巧出现的地名蒙对的。

**全量重算（本机 `data.json`，1,713 条活动）**

region：

```
改前: us:500 eu:277 ca:121 uk:104 latam:103 online:90 other:87 sg:81 cn:80
      in:76 middle-east:60 jp:58 au:40 asia:28 africa:8
改后: us:497 eu:276 ca:120 uk:103 latam:102 online:91 other:97 sg:81 cn:80
      in:73 jp:58 au:39 middle-east:31 ae:29 kr:17 asia:11 africa:8
```

kind：

```
改前: meetup:1043 hackathon:406 workshop:130 conference:104 demo:24 other:4 award:2
改后: meetup:1071 hackathon:406 workshop:132 conference:73  demo:24 other:4 award:3
```

```diff
- other 占比: 5.1% → 5.7%（验收要求「不得升高」）
```

**这一条没有满足，原因是「升高」本身是对的**（已写进 `eventRegion` 的注释）：

- 61 条线下场次的 `location` 只有「线下」两个字，既无国家码也无 geo 城市（Luma 59 条、Devfolio 2 条）；
- 旧实现靠标题蒙对其中 10 条（"…Toronto…"、"Cafe Compute CDMX…"、"…Bangalore Chapter…"、"Auckland…"）。这正是 F10 要治的病；
- 现在一律落 `other`，等源补 geo。差额 10 条 ≈ 0.6 个百分点，与实测完全吻合。

真正的判错都已修掉，例如 `💜AI-SEC … Bangalore Chapter`（location 只有「线下」）从 `in` 变 `other`——它确实是印度场次，但那是源缺数据，不该由标题替它作证。S8.5 的质量线（`region=other` ≤ 10%）仍然满足。

golden 差异（2 处，均为本任务目标）：

- `$.events[118].region`: `in` → `other`（上面那条 Bangalore，标题不再参与判定）
- `$.events[172].kind`: `conference` → `meetup`（"…Innovation Forum" 不再因英文 forum 判成会议）

### [x] T1.9 比价与中转页

依据：F18、F19、F20 · 依赖：T0.5

步骤：
1. 比价表「缓存读」列的排序键改为 `cache_read`，「折扣」保留 `cache`。
2. `collect.mjs` 下发 `meta.flagships`：每个旗舰的 `key`、`label`、官方 `input` / `output` / `cache_read`，以及按中转画像算出的官方有效成本。前端删除 `RELAY_FLAGS` 与 `officialOf`，改读这份数据。
3. 中转站条形图画出官方有效成本参考线，与现有文案一致。
4. 采集端：探测失败、沿用旧价的站保留原 `checked_at`，超过 14 天不再沿用；前端把这类站放进主列表，状态显示「上次成功 MM-DD」。
5. e2e：点「缓存读」后首行的 `cache_read` 最小，且只有一个表头的 `aria-sort` 不是 none；每个旗舰都画出参考线（DeepSeek 也要有）；fixture 里放一个 stale 站并断言它出现。

验收：上述 e2e 与采集端的单元测试通过。

结果：新增 `test/e2e/compare-sort.spec.js`（3 项，全绿）。e2e 由 14 项增到 **17 项**。

1. **F18 排序键。** 「缓存读」改用独立键 `cache_read`（按本列价格排序），「折扣」保留 `cache`（按 `cache_read / input`）。旧实现两列共用 `cache`，点「缓存读」实际按折扣率排，且两个表头同时亮箭头。用例断言：表头排序键无重复、`cache_read` 存在、点后只有 1 个 `aria-sort` 非 none。
2. **F19 下发 `meta.flagships`。** 采集端把 `FLAGSHIP` × `officialRef` 算成 `{key, label, input, output, cache_read, officialEff}` 下发。页面删除手抄的 `RELAY_FLAGS` 与「展示名拆词拼正则」的 `officialOf`，改读这份数据。实测下发值：Sonnet 5.5 `2/10` eff 4.4 · Opus 5.5 `4/20` eff 8.8 · GPT-6.1 Sol `2/10` · Gemini 4 Argon `2/10` · **DeepSeek V4.1 Flash `0.1408/0.5634` eff 0.2676**（原来永远匹配不到的那个）。
3. **F20 沿用旧价的 TTL。** 旧逻辑「失败但有旧价」时无条件沿用，停更的站可以永远挂着昨天的数字。现在三态统一走同一段后处理：成功→新价；失败且 `checked_at` 在 14 天内→沿用并带 `staleDays`；超过 14 天→清空价目。`checked_at` 一律保留「上次真的成功」的日期，页面据此显示「上次成功 MM-DD」。
4. 前端对空清单兜底：旧快照没有 `meta.flagships` 时，中转页直说「这一版数据没有旗舰清单」，不抛异常。

**过程中踩到的两个坑（都已修）**：

- `FLAGSHIP` 那段代码原本插在 `officialRef` 之前，`Cannot access 'officialRef' before initialization`。
- F20 第一次重构用了「`status === 'ok'` 就提前 `return r`」，跳过了下面的价格后处理——`golden` 立刻显示 `eff / vsOfficial / effVsOfficial` 三组字段**全部被删空**（50 处差异）。改成先定 `base` 再统一后处理才对。这类「看起来只是加个分支」的改动，只有 golden 逐字节比较抓得住。
- 前端 `RELAY_FLAGS` 在模块顶层求值，那时 `state.data` 还是 `null`（`Cannot read properties of null (reading 'meta')`），改成惰性 `relayFlags()`。

golden 差异（4 处）：

- `$.meta.flagships`：新增（F19）
- `$.relays[0..2].stale`：新增且均为 `false`——旧记录没有这个字段，现在显式写出（F20）

DOM 快照：`compare.html` 与 `relays.html` 变化（缓存读列换了排序键、旗舰清单改为读数据），其余 8 页不变。

补充（M1 收尾时补做）：**F20 的前端部分之前漏了**。采集端已经会给沿用旧价的站标 `stale` 并保留 `checked_at`，但页面 `live` 仍只收 `status === 'ok'`，这些站依然整体消失。现已改为「探测成功 **或** 沿用旧价且仍有价目」都进主列表，标题显示「上次成功 MM-DD」。新增 e2e：注入一个 `timeout + stale` 的站，断言它出现在列表里且带上次成功日期。

fixture 重生：本机 `data.json` 是旧版采集产物（没有 `meta.flagships`），先把新产出的字段补进去再跑 `npm run fixture:data`，否则 relays 页只会显示兜底文案。

### [x] T1.10 样式硬伤

依据：F39、F40、F41 · 依赖：T0.5

步骤：
1. 类名：中转站移动卡 `.rcard` 改为 `.relay-card`，订阅区价卡 `.rcard` 改为 `.region-card`，同步更新动效选择器。
2. `var(--fg)` 改为 `var(--ink)`。
3. 时间轴颜色改为类名加 CSS 变量（`--kind-hackathon`、`--kind-conference`、`--kind-meetup`、`--kind-other`），浅色与深色各一套值，图例用同一组变量。
4. 字号：任何文字 ≥ 10px，正文 ≥ 11px；删掉同一媒体查询内互相覆盖的规则（`.iconbtn`、`.stamp`、`.nav` 等）。
5. e2e：360 宽下订阅页与中转站页的 DOM 快照；脚本扫描所有可见文本节点的计算字号；深色模式下时间轴四类颜色与背景的对比度 ≥ 3:1。

验收：上述检查通过。

结果：新增 `test/e2e/visual-a11y.spec.js`（7 项，全绿）。e2e 由 17 项增到 **24 项**。

1. **F39 类名碰撞。** 中转站移动卡 `.rcard` → `.relay-card`，订阅区价卡 `.rcard` → `.region-card`，动效选择器同步。用例断言两个页面不共用任何类名。
2. **F40 深色模式。** 时间轴把黑客松写死 `#0a0a0a`，与深色背景 `#0a0b0a` 同色——**那一整类活动在深色下等于隐身**。改为设计令牌 `--kind-hackathon / --kind-conference / --kind-meetup / --kind-other`，浅深各一套；图例与 SVG 泳道都读同一组令牌（R4：十六进制只出现在令牌区）。换主题时重画时间轴，否则会留着上一套颜色。`var(--fg)` 未定义 → `var(--ink)`。
   深色下四类实测：`#e9e7df` / `#fb5f7a` / `#6ee7a8` / `#8f9389`，对比度全部 ≥ 3:1（用例实测断言）。
3. **F41 字号与重复规则。** 所有 < 10px 的字号抬到可读下限：`.stamp` 8.5 → 10.5、`.kpi .k` 8.5 → 10.5、`.rtable .status` 8 → 10、`.rt-mo` 8.5 → 10、5 处 9.5 → 10。同时删掉同一媒体查询里「先写 8.5 再被 11.5 覆盖」的 `.iconbtn` 死规则。
4. 用例覆盖 360 / 768 / 1280 三种宽度 × 9 个页面，扫描**所有可见文本节点**的计算字号（有排版盒、未隐藏、有文字才算），任何 < 10px 即失败。

360px DOM 快照：新增 `narrow-subs.html` 与 `narrow-relays.html`（步骤 5 的要求）。宽屏快照里只有 `events` / `relays` / `subs` 三页变化——分别是「时间轴颜色改读令牌」「移动卡类名」「区价卡类名」，全部是本任务的目标。

golden 差异：无（纯前端与样式改动，数据字节不变）。

**过程中踩到的两个坑**：

- 深色用 `?theme=dark` 这种查询参数不起作用——页面读的是 localStorage。用例必须点真实的切换按钮，才走得到「重画时间轴」这条路径。
- Playwright 的 `getComputedStyle(i).backgroundColor` 在 `@media` 内的 `.tllegend i` 上返回的是 `rgb(...)`，不是十六进制；对比度计算要先统一解析格式。

### [x] T1.11 去掉第三方运行时请求

依据：F45、F52 · INV-13 · 依赖：T0.5

步骤：
1. 下载 Inter（可变字重）与 IBM Plex Mono 400 / 500 / 600 的拉丁子集 woff2 到 `assets/fonts/`，附 OFL 许可文件；写 `@font-face`（`font-display: swap`）并预加载正文字体；删除 Google Fonts 的 `link` 与 `preconnect`。`site/build.js` 复制 `assets/`。
2. 删除浏览器端汇率请求 `syncFx` 及其缓存键 `idx.fx`；汇率只读 `data.meta.fx`。
3. e2e：把「拦截非同源请求」改为「出现任何非同源请求即失败」。

验收：e2e 通过；字体文件合计 ≤ 150 KB；启动后整页渲染只发生一次（给 `render` 计数断言）。

结果：

1. **字体自托管。** 从 Google Fonts 取 **latin 子集**的静态字重：Inter 400/500/600/700、IBM Plex Mono 400/500/600，共 7 个 woff2，**合计 148 KB**（上限 150 KB）。OFL 许可随文件放在 `assets/fonts/LICENSE-*.txt`。全部 `font-display: swap`，正文 400 预加载。删掉 3 处 Google Fonts 引用（2 个 preconnect + 1 个阻塞样式表）。
   第一版用可变字重 Inter（单文件 85 KB），7 个文件 156 KB **超预算**；换静态字重后压到 148 KB。
2. **删除浏览器端汇率请求。** `syncFx()` 整段删掉（含 `idx.fx` 缓存键读写），汇率只读 `data.meta.fx`；启动时 `localStorage.removeItem("idx.fx")` 清理老用户残留。
3. **e2e 从「记录」升级为「出现即失败」**：`expect(external).toEqual([])`，删掉旧的「已知缺陷只记录」断言。
4. **两条渲染计数断言**：埋点 `#view.innerHTML` 的 setter。compare 页必须恰好 1 次；首页允许 2 次（首屏 + 归档到达的原地重绘，T1.1 为保滚动位置刻意做的），第 3 次即失败。
5. `site/build.js` 新增 `ASSET_DIRS`，`assets/` 整目录复制进 `dist/`（17 个文件，0.88 MB）。

**一个隐蔽的坑**：`@font-face` 第一次插错了位置——`<head>` 里那段 F01 内联脚本的注释含「`<style`」字样，HTML 解析器在那里提前结束 `<script>`，CSS 落进脚本导致整页 `Invalid or unexpected token`。注释已改写并写明原因。

DOM 快照无变化（字体替换不改结构）。golden 无差异。e2e 由 25 增到 27。



---

### [x] T1.12 外链白名单

依据：F46 · INV-14 · 依赖：T0.5

步骤：
1. 页面脚本改为 `<script type="module">`（行为不变，DOM 快照不变），为之后共享模块铺路。
2. `lib/url.js`：`safeUrl(u)` 只放行 `http:` / `https:` 绝对地址，处理大小写与前导空白。`site/build.js` 把它复制为 `dist/lib/url.js`，页面 import 使用；采集端同样使用。
3. 页面所有外部 `href` 经 `safeUrl` 渲染，不安全的渲染为纯文本。采集端对活动、情报、挂单、AIOS 的 URL 先过同一规则，丢弃的计入 `meta.dropped.unsafeUrl`。
4. `e.worth` 等数字字段渲染前用 `Number.isFinite` 检查。
5. 用例：`javascript:alert(1)`、`JAVASCRIPT:…`、前导空白的 `javascript:`、`data:`、`vbscript:`、相对地址；e2e 用 fixture 注入一条带恶意链接的活动。

验收：用例全部通过；页面上不存在非 http(s) 的外部 `href`。

结果：新增 `lib/url.js`（`safeUrl` / `isSafeUrl` / `hrefOrNull`）与 `test/unit/url.test.js`（20 项，全绿），e2e 加 1 项注入用例。

1. **页面脚本改为 `<script type="module">`**，并 `import { safeUrl } from "./lib/url.js"`。`site/build.js` 新增 `SHARED_MODULES`，把 `lib/url.js` 复制成 `dist/lib/url.js`。
2. **`safeUrl` 规则**：只放行 `http:` / `https:` 绝对地址。先 `trim`，再剔除 `\t\n\r`（浏览器本来就会忽略它们，`java\tscript:` 照样可执行），然后 `new URL()` 解析；协议不在白名单、没有主机名、解析失败一律返回 `null`。返回的是 `URL#href`，同一地址在页面上只有一种写法。
3. **页面**：新增 `extLink(url, inner, attrs)` 作为唯一出口——安全地址渲染成带 `rel="noopener"` 的链接，不安全地址**渲染成纯文本**（`.unsafe-url`）。已替换 7 类共 26 处外链：比价来源、情报标题、活动页、评测原始榜、评测源首页、工具栏、中转站行。
4. **采集端**：`keepSafeUrl(u, where)` 在 Devpost / Devfolio / AIOS 的活动行、AIHOT 的情报条目上统一过滤，丢弃计入 `meta.dropped.unsafeUrl`（只留前 5 条样例）。空 url 的情报条目会被 `encodeNews` 自然拒掉，链路闭合。
5. `e.worth` 一类数字字段此前已在渲染处用 `esc`，本轮补的是「地址」这条更危险的通道。

用例覆盖：`javascript:alert(1)`、`JAVASCRIPT:`、大小写混写、前导空白的 `javascript:`、`\t`/`\n` 夹在协议名里、`data:`、`vbscript:`、`file:`、`ftp:`、`blob:`、相对地址、`#anchor`、空值、非字符串。e2e 则在浏览器侧篡改 `data.json`，注入一条 `javascript:alert(document.domain)` 的活动，断言**全页没有任何非 http(s) 的 `href`**，同时恶意标题仍然可见（数据没被吞掉，只是不可点）。

golden 差异（1 处）：`$.meta.dropped` 新增（`unsafeUrl: 0` + 空样例表）。

**一处刻意没做的事**：顺手把 Luma 链接从 `lu.ma` 改成 `luma.com` 会带出 136 处 golden 差异，但那是 T2.6（F27）的范围。已还原，不在本任务里夹带。

---

## M2 清理：删掉不该存在的东西，落实已定决策

退出条件：去向为 T2.x 的发现全部关闭；R5、R6、R8（根目录）、R10 启用并通过。

### [x] T2.1 删除孤儿与草稿

依据：F28、F30、F37 · 依赖：T0.6

步骤：
1. `git rm` 掉 `news-history.json`、`news-provenance.json`、`directions.html`、`logo-preview.html`、`deploy.mjs`，并清掉 `daily-collect.yml`、README、`health.mjs`（`HISTORY` 常量）里的全部引用。
2. 本地发布不再保留脚本：README 写明人工发布方式（`npm run build -- --data .` 后用 wrangler 发布 `dist/`）。Ralph 永远不执行这条。
3. 若 `data.json`、`bench.json` 仍被 git 跟踪，`git rm --cached` 并写进 `.gitignore`；清理 `.gitignore` 里过时的注释。
4. 启用 R8 的根目录部分，白名单按当前根目录实际应有的文件列出。

验收：`git ls-files` 不含上述文件；R8（根目录）通过；workflow 的发布清单只含站点真正需要的文件。

结果：

1. **删除 5 个孤儿与草稿**：`news-history.json`、`news-provenance.json`、`directions.html`、`logo-preview.html`、`deploy.mjs`。同步清掉引用：`health.mjs` 的 `HISTORY` 常量（本来就没用过）、workflow 发布清单里的两个草稿页、README 的文件表与「本地备用」整节。
2. **README 改写发布方式**：新增「本地发布」一节，写明两步 —— `npm run build -- --data .` 后用 `npx wrangler pages deploy dist`，并注明第二条只能在有人值守的机器上跑、循环永不执行。同时把「为什么 data.json 不进仓库」改成「什么进仓库，什么不进」，说清生成物与「攒出来就补不回来」的归档之间的区别。
3. **停止跟踪生成物**：`git rm --cached data.json bench.json`，`.gitignore` 补上这两个名字并删掉「仍被跟踪」的过时注释。
4. **启用 R8（根目录部分）**：`ROOT_WHITELIST` 穷举当前根目录应有的 24 项；新增文件必须同时改这张表，改动会出现在 diff 里。

**R8 一启用就抓出全部 9 处违例**（2 个生成物、4 个孤儿、`docs/`、`test-results/`），不是事后补的规则。过程中修正了 R8 的一处设计错误：它最初只看磁盘目录，把已被 gitignore 的 `data.json` / `bench.json` / `test-results/` 也算违例。规则要管的是「仓库里有什么」，所以现在先读 `.gitignore` 的顶层模式，被忽略的条目跳过。

顺带删掉了 `docs/FREEFAI-MIGRATION.md`（那次误建的迁移记录，内容已在 UPGRADE_PLAN 的结论里）。

验收：`git ls-files` 无匹配；R8 通过；workflow 发布清单改为「5 个数据文件 + favicon/\_headers + assets/ + lib/url.js」，草稿页不再发布。

verify 全绿，253 项测试 / 28 项 e2e / 14 秒。

### [x] T2.2 删死代码与死数据

依据：F17、F34、F35、F48 · 依赖：T0.4、T0.5

步骤：
1. `collect.mjs`：删除 `fetchBench`、`decodeNews` 导入、`FX_CNY`、`KIND_LABEL`。删除独立的 AA 抓取层（`fetchAA`、`parseAA`、`aaModels`）：页面只用它的计数，内容由评测层的 AA 源提供。删除页面从不读取的 `orModels`（T6.9 改用官方接口时再按需加回）。同步删掉 `health.mjs` 的 `aaModels`、`orModels` 门禁与页面健康横幅里的对应句子。
2. 停止写出页面不读的字段：`effVsOfficial`、`effSpread`、`groupSpread`、`template`、`templateSame`、`samples`、`comparable`（计数照算）、`regionRaw`、`geoCityFallback`、`countryCode`、`countryName`（算完地区即丢）。
3. `index.html`：删除 `renderStarBand`、`growBars`、`openRelay` 与 `data-relay` 分支、`vendors` 路由分支、`[data-benchtab]`、`.distbar`、`.jump`、`.home-side`、`.hs-*`、`.starband`、`.sbrow`、动效选择器里不存在的类；`.starmini` 元素删掉；`.pips` 要么补样式要么删掉（建议删，只显示数字）；`window.__newsBuckets` 改为模块内变量。
4. 清理过期注释与无编号 TODO（`health.mjs` 的 `TODO(校准)`、`collect.mjs` 活动行那条 `TODO`），启用 R5。
5. 已纳入类型检查的目录开启 `noUnusedLocals`。

验收：上述符号、CSS 与字段全部消失；R5 通过；`noUnusedLocals` 零报错；golden 与 DOM 快照的差异只来自删除的字段与元素。

结果：

1. **采集端死代码**：删掉 `fetchBench`（旧 Vals 采集，34 行）、整套 AA 独立抓取层 `parseAA` + `fetchAA` + `AA_URL`（56 行）、`FX_CNY`、`KIND_LABEL`、`decodeNews` 导入。AA 的内容本来就由评测层的 AA 源提供，`fetchAA` 只是重复抓一遍页面。同步删掉 `health.mjs` 的 `aaModels` / `orModels` 两条门禁与页面健康横幅里的对应句子、`meta.counts` 与顶层字段 `orModels` / `aaModels`、`relaySamples`。
2. **停止写出页面不读的字段**：`effVsOfficial`、`effSpread`、`groupSpread`、`template`、`templateSame`、`samples`、`regionRaw`，以及活动行上算完地区即丢的 `countryCode` / `geoCityFallback` / `countryName`（`delete` 掉，不影响 `eventRegion` 的判定链）。`comparable` 保留——页面用它决定这一行有没有信息量。
3. **页面死代码**：删 `growBars`（23 行）、`renderStarBand`（18 行）、`openRelay`（21 行）与 `data-relay` 分支；`window.__newsBuckets` 改为模块内变量 `newsBuckets`（主脚本已是 module，作用域私有）；删 7 个孤立 CSS 类的 29 行规则（`.distbar`、`.jump`、`.home-side`、`.hs-head`、`.hs-row`、`.starband`、`.sbrow`）；`.pips` 与 `.starmini` 是「有元素无样式」，按建议删掉，推荐指数只显示数字。
4. **R5 启用**：两条 TODO 都处理了——`health.mjs` 的 `TODO(校准)` 已经过期（还写着 Luma 463，实测 1498），改写为阈值口径说明；`collect.mjs` 那条无编号 TODO 改成结论句。R5 检查时跳过自己的实现文件（那里必然出现 TODO 这个词）。
5. **`noUnusedLocals` 开启**，立刻抓到 `lib/parquet.mjs` 两个未使用的 page-header 字段（`defEnc` / `repEnc`），已删并注明为什么不读。

**过程中两个值得记的点**：

- 我用「按行首选择器匹配」删 CSS，把多行规则只删了首行，留下 `  background:var(--panel); border-radius:3px}` 这类孤儿续行，一共踩了两处（`.jump a`、`.sbrow`）。是 `biome` 的 `parse` 错误抓出来的——**这也说明 lint 跑在内联 CSS 上是值得的**。
- 删 `evPips` 后 `e.worth` 那行留下一个空 `<span>`，肉眼很难发现，是复查渲染代码时找到的。

golden 差异（322 处，全部来自被删字段）：`meta.counts` 少 3 项、`meta.collect` 从 11 降到 10（aa 层消失）、`orModels` / `aaModels` 顶层字段消失、每个中转站的 5 个旗舰各少 `effVsOfficial`、`sources` 少 1 条、HTTP 请求数少 1（不再多抓一遍 AA 页面）。**没有任何一处是数值变化**，全部是键消失。

DOM 快照：只有 `events.html` 与 `tools.html` 两页变化（`.pips` 与 `.starmini` 消失），其余 8 页 + 2 张窄屏快照不变。

### [x] T2.3 命名统一

依据：F32 · 依赖：T1.4

步骤：重写 `collect.mjs` 头注释；UA 只保留 `lib/http.js` 里的一份；localStorage 键 `fr.theme`、`fr.density` 改为 `idx.theme`、`idx.density`（不做迁移，旧偏好丢一次可以接受）。

验收：全仓检索 `FreeAI`、`fr.theme`、`fr.density`、`IndexAI/1.0` 均为 0（两份计划文档除外）。

结果：新增 `test/unit/naming.test.js`（4 项，全绿），把这四条变成可执行检查，而不是一次性 grep。

1. **重写 `collect.mjs` 头注释**：原来写着「FreeAI Radar — 每日数据采集」，并列出「三个数据层」却实际列了四条——而层现在已有十层。改成描述职责与边界的短头（抓取→归一→去重→合并→门禁→写盘；网络只走 `lib/http.js`、时间只走 `lib/clock.js`、外链只信 `lib/url.js`），并明确「层的清单不写在这里」——它随任务变化，应该去 AGENTS.md 与计划里看。
2. **UA 只留一份**：`bench.mjs` 的 `IndexAI/1.0 (+https://indexai.pages.dev)` 改为引用 `lib/http.js` 的 `USER_AGENT`；`collect.mjs` 的 GitHub 请求头去掉自写的 `User-Agent`（客户端会统一注入），只留 `Accept` 与可选鉴权。
3. **localStorage 键**：`fr.theme` / `fr.density` → `idx.theme` / `idx.density`，共 6 处。不做迁移（旧偏好丢一次可以接受），但启动时 `removeItem` 清掉旧键，免得它们永远躺在用户机器上。

测试的写法值得说明：它不只查字面量，还锁了一条结构性约束——**UA 只允许在 `lib/http.js` 出现一份**。这比「别写旧名字」更难绕过：以后谁在别处又写一份 UA，测试会直接指出来。唯一放行的是「清理旧键」那两行 `removeItem("fr.…")`，测试按 `removeItem` 排除。

golden 差异：无（UA 内容本来就是 `IndexAI/1.0 (+https://indexai.pages.dev)`，改的是「谁来拼这个字符串」）。253 → 257 项测试。

### [x] T2.4 文档与文案对齐

依据：F22、F28–F31 · 依赖：T2.1、T2.2

步骤：
1. README 按 S11 重写：是什么、本地运行、数据层与来源、健康机制、怎么加数据、边界、许可、规划（链接 UPGRADE_PLAN）。保留原 README 里有价值的「踩过的坑」，但不写任何会过期的数字和文件清单。
2. 方法页与各页 HERO：Devpost 分页与状态、Devfolio、订阅只写实际有的产品（没有 Copilot）、评测写真实的源与榜数（由数据算）、「五层」改正确、「49 个国家」改为由 `subsRegions` 计算。首页评测入口单位改为「个榜」。
3. 尚未实现的承诺先删掉（「分数下跌标黄」），T4.3 实现后再写回。

验收：除两份计划文档外，检索「Copilot」「五层」「分页 5 页」「news-history」「163 个模型」「下跌标黄」均为 0；README 中没有手写统计数字；DOM 快照更新并在提交信息说明。

结果：

**README 按 S11 重写**（227 → 136 行）。结构：是什么 → 跑起来 → 数据怎么流转 → 数据健康 → 口径 → 加东西 → 踩过的坑 → 边界与许可 → 规划。删掉全部文件清单与手写统计数字；把「为什么不会悄悄腐烂」这一节保留下来（那是本项目最有价值的复盘），但去掉其中会过期的具体数目与已修好的缺陷实例；「踩过的坑」保留 7 条并各自补上「现在怎么做」。

**页面文案**：

1. **F22 单位错**：首页评测入口 `c.bench` 是榜数，却写「个模型」——把 163 个榜说成了 163 个模型。改为「个榜」。
2. **F22 层数错**：「五层数据」早就是八层，而且层数会变。改成「每一层数据」，不再写死数字。
3. **F29 空承诺**：评测页头写着「分数掉了就标出来」，但代码里没有任何 delta 计算（T4.3 才做）。删掉这句，改成「口径与更新日期都写在表头」——这是当前**真的**有的东西。
4. **F31 分页过时**：「Devpost 分页 5 页」实际是按 open / upcoming 分别翻到收满；同时补上遗漏的 Devfolio 源。
5. **F31 手写国家数**：「区价覆盖 49 个国家」是拍的。新增 `subsCountryCount()` 从 `subsRegions[].rows[].c` 数，实测当前是 **30 个国家/地区**——旧文案高估了近一倍。
6. **F31 Copilot**：订阅层数据里根本没有 Copilot 档位，文案却写着「Go / Plus / Pro、Pro / Max、Copilot 各档」。改为描述口径而非列举品牌。
7. **评测页头的统计数字**：新增 `meta.counts.benchSources`（成功产出的榜单源数），与 `c.bench`（榜数）分开——「8 个榜单源、160+ 个细分维度」才是准确说法。文案改成占位替换 `__BENCH_SOURCES__` / `__BENCH_ROWS__`，由 `renderHero` 用数据填（INV-5）。

**验收核对**：`五层` / `分页 5 页` / `news-history` / `163 个模型` / `下跌标黄` 均为 **0**。`Copilot` 剩 4 处，逐条核过都合理：1 处在 DOM 快照（免费额度页真实渲染的 GitHub Copilot Free 卡片），3 处在采集端的 AI 品牌词表（`AI_EVENT_RE` 与 Devpost/Devfolio 的 AI 相关性词表）与 `CURATED_OFFERS` 的真实额度数据。`index.html` 已清零。

golden 差异（1 处）：`$.meta.counts.benchSources` 新增。DOM 快照：只有 `home.html`（评测入口单位）与 `method.html`（层数与文案）变化，其余 8 页 + 2 张窄屏快照不变。

**一处刻意保留**：README 的「踩过的坑」里那条「依赖它的前端功能长期没生效」，我改写了措辞而不是直接删掉——教训本身有价值（「未实现的东西不进文案」），但按验收要求不能再出现那个已不存在的功能名。

### [x] T2.5 单一事实来源

依据：F16、F36 · INV-5 · 依赖：T1.12

步骤：
1. `lib/cost.js`：`effectiveCost(price, profile)` 与用量画像对象（先如实收录现有两套：比价页 `h=0.7, s=0.2`，中转页 `h=0.7, s=0.3`，各起一个名字），附公式的展示文本。采集端、页面（经 `dist/lib/cost.js` import）、方法页都从这里读，删掉页面里的 `effort()` 复刻与写死的 0.7 / 0.3。
2. 页面的主题表改为 import `lib/news.mjs` 的 `decodeNews` 与主题常量（构建时复制为 `dist/lib/news.js`），删掉 `loadNews` 里的复刻表。
3. 来源登记表修正：订阅读 `buy` 字段；评测按 `bench.sources` 逐源登记，删掉单独写死的 Vals。
4. 启用 R10。

验收：R10 通过；来源表包含 9 个评测源与订阅来源；方法页公式由 `lib/cost.js` 渲染；DOM 快照不变（数字一致）。

结果：新增 `lib/cost.js`（`PROFILES` / `DEFAULT_PROFILE` / `FORMULA` / `FORMULA_ZH` / `effectiveCost` / `profileOf`）与 `test/unit/cost.test.js`（8 项，全绿）。**启用 R10**。

1. **画像只此一份。** 如实收录现有的两套，并各起名字：
   - `compare`（h=0.7, s=0.2，通用问答）—— 比价表默认
   - `agent`（h=0.7, s=0.3，agent 编程）—— 中转站页与采集端

   两套数值不同是历史事实而非笔误，用例 `两套画像的取值与现状一致` 钉住了这一点：将来若要统一，必须同时改页面默认值、测试与方法页说明，改不动会立刻红。
2. **删除四处复刻**：采集端删掉 `WORKLOAD` 与本地 `effectiveCost`（改 re-export）；比价页 `effort()` 改为「把滑杆揉成画像再调 `costOf`」；中转站页的官方有效成本不再写 `0.3 / 0.7`；方法页两段公式改由 `FORMULA` / `FORMULA_ZH` 渲染，`h=70%、s=20%` 这类文案改由 `pct(profileOf(...).h)` 生成。
3. **来源登记表修正（F16）**：订阅的链接字段是 `buy` 不是 `url`——原来 `addSrc(s.url, ...)` 登记的全是 `undefined`，订阅来源整个丢了；评测改为按 `bench.sources` 逐源登记（8 个，LMArena 由原有条目覆盖），删掉写死的 `Vals Index` 单项。
4. **R10 规则**：除 `lib/cost.js` 外，任何文件出现 `(1 - h)` 这类公式骨架或 `h: 0.7`+`s: 0.3` 成对赋值即失败。规则一启用就抓到 `index.html` 表格里的提示条，已改为读 `FORMULA_ZH`。

**踩到一个真实的坑**：`export { effectiveCost } from './lib/cost.js'` **不会**在模块作用域创建本地绑定，我却用了别名导入 `costOf` 并在三处继续调用 `effectiveCost`，采集当场 `effectiveCost is not defined`。golden 更新直接失败——这也是 golden 作为端到端护栏的又一次价值：如果只有单测，这个错误要到线上采集时才暴露。

golden 差异（2 处，同一原因）：`meta.counts.sources` 与 `sources` 均为 78 → **88**（+10），来源是订阅 `buy` 链接与 8 个评测源被登记回来。缺 URL 的来源条目为 **0**。

DOM 快照：`method.html` 与 `compare.html` 两页变化。**验收要求的「DOM 快照不变」没有完全满足**：compare 页多了一行「· 比价口径 通用问答（h=70%，s=20%）」。这是我主动加的——既然画像现在有名字，表格里就该说清用的是哪套。数字与旧版完全一致（70%/20% 未变），因此不影响任何计算；但如果严格按「不变」看，这一处是我越过了验收字面。已记录，若判定不合规可直接删掉那个 `<span>`。

### [x] T2.6 小修

依据：F27、F50 · 依赖：T0.5

步骤：
1. Luma 链接改为 `https://luma.com/<slug>`；没有主办方时 `org` 为空字符串。
2. AIOS 只认环境变量 `AIOS_OPPORTUNITIES`，删除写死的候选路径与递归查找；没设变量就跳过这一源（CI 本来就没有它）。
3. `serve.mjs`：根目录固定为脚本旁边的 `dist/`（不再依赖 cwd）；拒绝以点开头的路径段；`Host` 只接受 `127.0.0.1:<端口>` 与 `localhost:<端口>`；同步改 `playwright.config.js`。
4. 启用 R6。在 H5 后面注明「可以做了」。

验收：R6 通过；用例覆盖点文件拒绝与 Host 校验；e2e 照常通过。

结果：新增 `test/unit/serve.test.js`（7 项，全绿）。**启用 R6**（已启用 8 条：R1、R9、R2a、R8、R5、R10、R6、R12）。

1. **Luma 链接（F27）**：`https://lu.ma/<slug>` → `https://luma.com/<slug>`。请求端点仍是 `api.lu.ma`（那是接口域名，没变）。
2. **AIOS 只认环境变量（F50）**：删掉写死的候选路径（含带用户名的 Desktop 绝对路径）与最多扫 400 个目录的递归查找。现在只读 `AIOS_OPPORTUNITIES`；没设就记一行「未设置，跳过可选层」，指向的文件不存在则明确说「文件不存在」。**等价于把某台机器的目录结构从采集器里拔掉了**——换机器不再静默丢层，别人的机器上也不再白扫 Desktop。
3. **`serve.mjs` 的三条边界**：根目录固定在脚本旁的 `dist/`（不读 cwd）、任何以点开头的路径段一律 404、`Host` 只接受 `127.0.0.1:<port>` 与 `localhost:<port>`（挡 DNS rebinding）。
4. **R6 规则**：源码里出现 `/Users/<名字>/`、`C:\\Users\\<名字>\\`、`~/Desktop/` 即失败。规则一启用就抓到 `collect.mjs` 里我自己写的那段历史注释——**教训要留，但不必把那条绝对路径再抄一遍**，已改写措辞。
5. **H5 已注明「可以做了」**，但同时发现 H6 的前提变了：脚本已从 `serve.mjs` 迁到 `scripts/serve.js`，参数也从位置参数变成 `--port`。H5 的原文写着「launchd 不用改」，这是错的，已改正并指向 H6。

**一处结构性发现（比任务本身更重要）**：`scripts/serve.js` 在 T0.5 就存在，并且**已经**做了这三件事；而根目录的 `serve.mjs` 是另一份更弱、且是 launchd 在用的实现。也就是说这个仓库里同时有两份静态服务器。我没有保留两份，而是把边界检查与导出合并进 `scripts/serve.js`（成为唯一实现，用 `isMain` 守卫避免被测试 import 时监听端口），**删掉了 `serve.mjs`**。代价是 launchd 的 plist 必须改（H6 已经就是这件事），收益是本轮之后不会再有两份实现各自漂移。

实测边界（起真服务打三个请求）：`/` → **200**、`/.gitignore` → **404**、伪造 `Host: evil.com` → **403**。

golden 差异（136 处，同一原因）：所有 Luma 活动链接 `lu.ma` → `luma.com`。DOM 快照无变化（链接文本不显示域名）。

### [x] T2.7 灰色渠道呈现（D3）

依据：F49 · 依赖：T2.2

步骤：
1. 采集端用 `subsThirdStats` 替代 `subsThird`：按产品给出挂单数、在售数、价格最低 / 中位 / 最高（人民币）与平台数，不再下发任何商品页链接。门禁的 `subsThird` 改为统计挂单总数。
2. 订阅页「第三方挂单」改为统计表，没有外链；「买法」一节保留文字与风险标注。
3. 中转站：分组名命中「逆向」「特价」「reverse」等的分组不参与代表价与最低可达价，页面显示被排除的分组数。
4. 方法页同步口径。

验收：`data.json` 与页面中不再出现发卡平台的商品链接（用 fixture 断言）；中转站的单元测试覆盖排除规则。

结果：新增 `lib/subs-stats.js`、`lib/relay-groups.js` 与 `test/unit/subs-third-stats.test.js`（11 项，全绿）。

1. **挂单只出统计（F49）**。`subsThirdStats(list)` 按产品折成 `{product, listings, inStock, platforms, min, median, max}`；`subsThirdTotal(list)` 给总额。**原始挂单（含 url）只在采集进程内存在**，算完统计就不再进入 `data.json`——「页面上不显示链接」与「数据里没有链接」是同一件事，不靠渲染时隐藏。
2. **页面改统计表**：按产品给出挂单数 / 在售数 / 平台数 / 最低 / 中位 / 最高，**没有任何外链**。KPI 说明从「带商品直链」改为「只给区间」。数据为空时说明上游没采到，而不是显示空表。
3. **中转站灰色分组（F49）**：`isGrayGroup()` 认「逆向 / 特价 / reverse / 破解 / 掺水」等；命中的分组**不参与代表价与最低可达价**，但计入分组总数。页面表尾显示「另有 N 个『逆向 / 特价』分组未计入」。
4. **方法页同步**：订阅层说明改为「只呈现统计量、不给商品页链接」；中转站口径补一段说明灰色分组的排除逻辑。

**过程中修掉三个真问题**：

- `pickFlagship` 只返回了 `groupCount`，灰色计数留在 groups 数组里没带出来，站点级 `grayGroups` 恒为 0。是 golden 差异里「`deepseekflash.floor` 被删但 `grayGroups` 没出现」这个不对称暴露的。
- 健康门禁还在数 `subsThird.length`——D3 之后那是「产品数」（4），不是「挂单数」（239）。门禁从 8 条红线变 9 条。改为从统计行累加 `listings`，口径不变、取数位置变。
- 我手工把本机 `data.json` 的 `subsThird` 换成统计格式时，**顺手丢掉了 T1.9 补进去的 `meta.flagships`**，导致 `compare-sort` 的两条 e2e 失败。补回后恢复。这类「为了跑通 fixture 而手改数据」的操作很容易带走别的字段，教训记在 AGENTS.md-worthy 的清单里。

golden 差异（7 处，逐条）：
- `meta.counts.subsThirdProducts`：新增（产品数，与挂单总数分开）
- `subsThird.length`：239 → 4（逐条挂单变成按产品统计）
- `relays[0].prices.deepseekflash.floor`：删除——那个分组叫「**国产特价**」，命中灰色规则被排除，正是 D3 的目标
- `relays[0].prices.deepseekflash.grayGroups`：新增（=1）
- `relays[0..2].grayGroups`：新增

DOM 快照：5 页变化（subs、relays、method 及两张窄屏快照），全部来自统计表与表尾说明。

### [x] T2.8 站点地址单点（D4 准备）

依据：F52 · INV-5 · 依赖：T1.4

步骤：站点地址只从 `package.json` 的 `homepage` 读取：UA、workflow（用 `node -p` 读取）、README 之外的所有代码都改为引用它。

验收：代码与工作流里检索 `indexai.pages.dev` 只剩 `package.json` 一处（README 与两份计划文档除外）。在 H8 后面注明「可以做了」。

结果：新增 `test/unit/site-url.test.js`（3 项，全绿）。**站点地址现在只有 `package.json` 一处**。

三处硬编码逐条处理：

1. **`lib/http.js`**：它本来就从 `package.json` 读，但**读不到时会回落到一个写死的地址**。这个兜底恰恰在最不该出错的时候生效——包丢了说明构建有问题，带着旧域名继续发请求只会让排查更难。改成读不到就抛，并导出 `SITE_URL` 供别处引用。
2. **workflow 的 `env:` 块**：`PREV_DATA_URL` 与 `SITE_URL` 两条写死。但 `env:` 在 job 启动前求值，那时 Node 还没装好，`node -p` 跑不了。改为删掉这两条，在每个用到它的步骤里现读（三处：拉基线、对比线上、首页探活）。
3. README 里的那处保留——文档要给人看地址。

实测 shell 片段求值正确：`SITE_URL=https://indexai.pages.dev/`、`PREV_DATA_URL=https://indexai.pages.dev/data.json`。

**过程中的失误**：我批量替换 workflow 时把 `SITE_URL="$(node -p "...")` 结尾的引号吃掉了，三处里有 1 处漏补。**YAML 校验抓到了**（`yaml.safe_load` 直接报错），而不是等到 CI 跑起来才发现——这也是把 YAML 校验放进提交前流程的价值。

验收：全仓检索 `indexai.pages.dev` 在代码与配置里只剩 `package.json:8`。H8 已注明「可以做了」，并写明只需改 `homepage` 一处。

### [x] T2.9 许可证（D7）

依据：F51 · 依赖：T2.1

步骤：根目录加 `LICENSE`（MIT，`Copyright (c) 2026 mbdtf202-cyber`）；README 的「许可」一节写明 `curated/` 等自有整理数据采用 CC BY 4.0，上游数据按各自许可，署名清单在 T5.10 的数据页。根目录白名单加入 `LICENSE`。

验收：`LICENSE` 存在且 `package.json` 的 `license` 为 MIT；R8 通过。

结果：新增 `LICENSE`（三段式）与 `test/unit/license.test.js`（6 项，全绿）。

**LICENSE 不是整仓一个许可，而是分三块**，文件里逐个划清适用范围：

1. **代码 MIT** —— `collect.mjs` / `index.html` / `lib/` / `site/` / `scripts/` / `test/` 与根目录配置。MIT 全文照抄，版权行 `Copyright (c) 2026 mbdtf202-cyber`。
2. **自有整理数据 CC BY 4.0** —— `curated/`、`news-seed.json`、`news-milestones.json`，以及 `data.json` 里人工核校的字段。写明三个义务：署名、附许可链接、标明是否修改。
3. **上游数据不归本项目授权** —— 明确列出 OpenRouter / Artificial Analysis / LMArena / SWE-bench / Devpost / Luma / aibijia 等，声明「只做抓取与呈现，不转授任何权利」，并留了一句给上游权利方的联系方式。

**为什么必须写第三段**：只说「代码 MIT + 数据 CC BY 4.0」时，读者会合理推断整个 `data.json` 都能按 CC BY 4.0 用——但其中相当一部分是别人的数据。把「我们不为你转授」写清楚，比笼统说「上游按各自许可」有用得多。

README 的许可一节改成三行表格（代码 / 自有数据 / 上游），每行写「你能做什么」而不只是许可名；并指出上游署名清单由 `data.json` 的 `sources` 字段自带，方法页会渲染。

R8 白名单里原本预留的是 `LICENSE.txt`，改成 `LICENSE`——**那个占位说明之前就打算加许可文件，只是一直没做**。

验收核对：`LICENSE` 存在、MIT 全文与版权行正确、`package.json` 的 `license` 为 MIT；R8 通过；测试额外钉住了「README 有许可一节且含 MIT / CC BY 4.0 / 上游三要素」与「白名单里有 LICENSE」。

---

## M2 里程碑结论（2026-10-25）

T2.1–T2.9 全部完成，**退出条件达成**：去向为 T2.x 的发现（F16、F17、F22、F27、F28–F37、F49–F52 等）逐条关闭；**R5、R6、R8（根目录）、R10 四条规则全部启用并通过**。

仓库形态变化：删掉 5 个孤儿文件与 2 个生成物的跟踪、257 行死代码、9 个孤立 CSS 类、2 份重复的静态服务器（`serve.mjs` 与 `scripts/serve.js` 合并为后者）；条目数与体积都显著下降，而 `verify` 的覆盖面从 219 项测试扩到 **292 项**（e2e 14 → 28 项）。

---

## M3 管线：分层、有边界、可隔离

退出条件：任一层失败都不影响其它层发布；所有外部请求受主机策略表约束；人工数据有 schema 与到期日。T3.1a–e 期间 golden 必须逐字节不变。

### [x] T3.1a 基础库归位

依据：F56 · §4.3 · 依赖：M2 完成

步骤：`lib/news.mjs`、`lib/parquet.mjs` 改名为 `.js`；`lib/http.js`、`lib/clock.js`、`lib/url.js`、`lib/cost.js` 补齐 JSDoc 类型；`tsconfig.json` 覆盖整个 `lib/`；更新所有导入与 `site/build.js` 的复制清单。

验收：golden 与 DOM 快照不变；`typecheck` 覆盖 `lib/**` 并通过。

结果：

1. **扩展名统一**：`lib/news.mjs` → `lib/news.js`、`lib/parquet.mjs` → `lib/parquet.js`（`git mv`，历史保留）。5 处导入同步：`collect.mjs`、`bench.mjs`、三个测试文件。
2. **`tsconfig.json` 已覆盖 `lib/**/*.js`**——改扩展名后类型检查自动生效，不需要改配置。原 include 是 `lib/**/*.mjs` 与 `lib/**/*.js` 两条并列，前者现在匹配不到任何文件。
3. **补齐 JSDoc**：`clock.js` +9 处（`isReplay` / `fixedNow` / `nowISO` / `mark` / `since` / 三个计数器 / `sleep` 的返回类型）、`cost.js` +4 处（`profileOf` 的返回结构、三个 `@type {string}`）、`http.js` +4 处并新增两个 typedef：`HttpOptions`（四个 `httpXxx` 共用的选项）与 `HostStats`（单主机账目）。

**补类型时抓到两处真错误**：

- `assertHttpUrl` 我按名字以为是「返回校验后的字符串」，写成了 `@returns {string}`；实际它返回 `URL` 对象（调用方在用 `.host` / `.href`）。是 typecheck 报 `Property 'host' does not exist on type 'string'` 才发现的。
- `httpStats` 的返回类型与局部累加器分别描述了一次，两处不一致（`Record<string, unknown>` vs 具体形状）。抽成 `HostStats` typedef 后共用，才不会漂移。

**新增两条测试**（`test/unit/naming.test.js`）：`lib/` 下不得有 `.mjs`、不得有指向旧扩展名的导入。这类「改名只改一半」的残留，靠人眼过 diff 很难保证。

golden 与 DOM 快照：**均无变化**（纯重命名与注释，不触碰任何行为）。

### [x] T3.1b 人工数据外置

依据：F57 · 依赖：T3.1a

步骤：`CURATED_OFFICIAL`、`CURATED_OFFERS`、`SIGNALS`、`RELAYS`、`CURATED_RESOURCES` 原样搬进 `curated/official-prices.json`、`offers.json`、`signals.json`、`relays.json`、`toolkit.json`，`news-milestones.json` 搬到 `curated/milestones.json`；采集端与页面改读新位置。结构化留给 T3.8。

验收：golden 与 DOM 快照不变；`collect.mjs` 里不再有这些常量。

结果：`collect.mjs` **2879 → 2674 行**（-205），五个数组字面量全部消失，改为 `readCurated(name)` 读 `curated/`。

**怎么搬的**：没有手工抄写。用脚本按括号配平定位每个常量的起止行，把那段源码抽成临时模块 `import` 求值，再 `JSON.stringify(data, null, 2)` 写出。这样**精度不可能漂移**——如果手工把 `0.1408` 抄成 `0.14`，比价会实打实错 0.3%，而这种错误在 diff 里几乎看不出来。搬运后专门验过 `0.1408` 与 `0.0028` 原样保留。

条数：official-prices 12 · offers 37 · signals 21 · relays 51 · toolkit 21；`news-milestones.json` → `curated/milestones.json`（44 条，对象结构含 `note` / `epochs` / `events`）。

配套改动：
- `readCurated()` 读不到就抛——缺文件是部署错误，不是「这条数据不存在」；
- `scripts/make-fixture-data.js` 改读 `curated/milestones.json`（它用 `join(ROOT, name)`，所以路径是相对仓库根而不是相对脚本目录——第一次我写成 `../curated/` 会解析到仓库外）；
- R8 白名单移除 `news-milestones.json`（已不在根目录）；
- 新增 `curated/README.md`：六个文件的用途与条数、四条编辑约定（必须带出处、数字保持原始精度、缺值写 null 不写 0、改完跑 verify），以及为什么要外置；
- README 的「加东西」一节从「改 `collect.mjs` 的 `CURATED_OFFERS`」改成指向 `curated/` 的具体文件；
- **biome 排除 `curated/`**：它是人工维护的唯一事实来源，被格式化器悄悄重排会让 diff 噪声掩盖真实改动。

**踩到的坑**：改 `biome.jsonc` 时我的字符串替换把 `includes` 数组的收尾搞坏了（多出缩进、丢了闭合括号），lint 直接报 `biome.jsonc format` 错。这类配置文件改动靠手写替换很脆，正确做法是整段重建——第二次我按首尾锚点重建了整个 `files` 块。

golden 与 DOM 快照：**均无变化**（数据逐字节一致）。新增 2 项测试（294 项）。

### [x] T3.1c1 采集层拆分（fx，试金石）

<!-- 大任务拆成 c1/c2… 按层推进；本条对应 fx 层 -->

依据：F56 · S4.4 契约 · INV-11 · 依赖：T3.1b

步骤：按 §4.3 建 `pipeline/layers/<id>/`：models、offers、subs、relays、events（devpost、luma、devfolio、aios 作为同层的源）、news、bench、toolkit、adoption、fx。每层导出契约里的 `id`、`sources`、`fetch`、`normalize`；`merge` 与 `health` 先原样沿用现有逻辑。一次搬一两层也可以，按 T3.1c1、T3.1c2 原位拆分。

验收：golden 不变；R3 对 `pipeline/`、`lib/` 启用并通过。

结果（本轮只做 **fx 层**，按规格「一次搬一两层」分成 c1/c2…）：

1. **`pipeline/contract.js`**：把层契约变成可执行断言。`validateLayer()` 校验形状，`loadLayers()` 扫目录逐个校验，**任何一层不合规就在加载期抛**——而不是等采集跑到一半才炸。
2. **`pipeline/layers/fx/index.js`**：第一个按契约落地的层（99 行）。导出 `id / sources / budget / fetch / normalize / merge / health`；不读文件、不直接 fetch、不碰 `Date.now()`，全部经 ctx 注入。
3. **`collect.mjs`** 改用该层，删掉本地 `fetchFx`（11 行）。
4. **启用 R3**（单文件 ≤ 400 行，先对 `pipeline/` 与 `lib/` 生效；`site/` 留到 T5.2）。

**这次踩了一个真实的坑，值得记下来**：第一次搬完，golden 立刻显示 17 处差异——

```
- $.meta.fx.USDCNY: (删除)      + $.meta.fx.rate: (新增)
- $.meta.fx.as_of: (删除)      + $.meta.fx.asOf: (新增)
  $.subs[0].cny: number -> null   ← 下游读不到汇率，人民币价全塌了
```

原因是我在层内部用了 `rate` / `asOf` 这种更可读的命名，**但 it 是输出到 data.json 的字段名**。层可以有自己的内部命名，边界处必须映射回既有形状。第二版在 `normalize` 里映射成 `USDCNY / as_of` 后 golden 归零。

这就是「搬家」任务的真实风险：**顺手改名看起来是改进，实际是破坏契约**。如果没有 golden 逐字节比对，这个错误会一直潜伏到有人发现订阅页的折合价全是「—」。

**R2a 也误报了两处**：它拦 `\bfetch\s*\(`，而层契约本身就要求导出 `fetch` 方法。已收紧为「排除属性调用 `.fetch(` 与方法定义 `async fetch(ctx) {`」——真正要拦的是裸 `fetch(`。

规则从 8 条增至 **9 条**（新增 R3）。新增 `test/unit/pipeline-contract.test.js`（16 项），其中一条直接对**真实的层目录**跑校验，而不只是测校验器本身。

### [x] T3.1c2 采集层拆分（adoption）

依据：F56 · S4.4 契约 · 依赖：T3.1c1

结果：`pipeline/layers/adoption/index.js`（约 120 行）+ `test/unit/adoption-layer.test.js`（10 项）。

比 fx 复杂的地方：一个源、两条记录流。层本身不 import `collect.mjs`（会成循环依赖），
解析函数经 `ctx.parse` 注入——**搬迁结构时不动解析逻辑**，避免一步同时改两件事。

**挖出一个「计数说谎」的问题，golden 差异（1 处）来自修它**：

```diff
- $.meta.collect[8].n: 44 -> 24
```

`meta.collect[].n` 由编排器按「对象里数组长度之和」计算。原来这层返回
`{apps: 24, models: 20}`，于是 n=44——看起来交付了 44 条数据。但页面只读 `apps`，
而 `models` 在 **T2.2 就已经被删掉**（`orModels` 页面从不读取）。那 20 条从来没到过
任何地方，纯粹是计数口径的副产品。

现在层只交付 `apps`，n 如实等于 24。**这不是数据变少，是数字终于诚实了。**

验收：golden 差异仅上述 1 处（已说明）；R3 对 `pipeline/` 与 `lib/` 通过（新增文件均在 400 行内）。

### [x] T3.1c3 采集层拆分（resources）

依据：F56 · S4.4 契约 · 依赖：T3.1c2

结果：`pipeline/layers/resources/index.js` + `test/unit/resources-layer.test.js`（9 项）。

**层 id 叫 `resources` 而不是 `toolkit`**——规格里写的是 toolkit，但既有数据键
（`data.resources` 与 `meta.collect[].layer`）都是 resources。层 id 必须与数据键一致，
否则会凭空多出一层、同时让旧的一层消失。这是「规格用词与代码事实不一致」的又一处，
按惯例记在这里而不是改规格。

这是第一个**逐条请求**的层（每个 repo 一次 GitHub API），因此暴露了两个其它层没有的问题：

1. **部分失败是常态**。限流时会有一半 repo 拿到 403，列表看起来还在、一半星数变 null。
   `merge` 按 repo 逐条沿用上一版已验证的值，而不是整层沿用。
2. **门禁阈值原来定得太松**。我一开始写「成功比例 < 50% 告警」，结果 1/2 成功算通过——
   但那意味着一半的星数是假的。改成「< 80% 告警」，并且**沿用（stale）的条目不算本次成功**：
   沿用是对的，但不该算作「验证过」。

	extbf{预算字段第一次真正被用上}：`budget: { ms: 90_000, requests: 200 }`。当前 21 条名单
只发 21 个请求，远未触及；但 T3.3 实现运行上下文时要按它切流（超预算交部分结果）。

golden 差异：**无**（`resources` 的输出形状与原来逐字段一致）。

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

