/* IndexAI · 公开评测采集
 *
 * 目标：把散落在各家的公开榜单拉到同一套结构里，页面只读这一份。
 * 原则：
 *   1. 只采公开数据，不注册、不绕过登录、不用 API key。
 *   2. 每个源独立失败，不拖累其它源；失败保留上次快照并标记 stale。
 *   3. 单位统一成「百分数 0–100」写进 out.unit，绝不全局 ×100（各家口径不同）。
 *   4. 模型名保留原始写法，归一匹配放到页面层做（评测发布方与价格方命名不一致）。
 *
 * 输出结构：
 *   {
 *     as_of, sources: [{id,name,url,home,unit,updated,rows,ok,note}],
 *     boards: { <boardId>: { id, name, family, unit, updated, url, source, rows:[{rank,model,org,score,lo,hi,votes,config}] } },
 *     catalog: [{ id, name, family, group, unit, rows, updated, source, url, note }]
 *   }
 */

import { readParquet } from './lib/parquet.mjs';
import { httpGet, httpText, httpBuffer } from './lib/http.js';

const UA = { 'User-Agent': 'IndexAI/1.0 (+https://indexai.pages.dev)' };
const HF = 'https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset/resolve/main';

/**
 * 本次采集的「上一版评测快照」。由 fetchBenchmarks 开头写入（见 setPrevBench），
 * 供各源函数做配置级回退。它在本模块内是只读的：只有 setPrevBench 能改。
 */
let PREV_BENCH = null;

/** @param {object|null} prev 完整的上一版 bench 快照（带 boards） */
export function setPrevBench(prev) {
  PREV_BENCH = prev && typeof prev === 'object' ? prev : null;
}

/* ─────────────── 通用工具 ─────────────── */

import { now, nowISO, todayISO, sleep } from './lib/clock.js';

/** 测试档位：缩小迭代集合，生产默认不变（见 UPGRADE_PLAN T0.4）。 */
const TEST_PROFILE = String(process.env.INDEXAI_PROFILE || '').toLowerCase() === 'test';

/**
 * 取文本。超时、重试、限速、记账都交给 lib/http.js（S2.1）：
 * 这里只保留各源原本的 tries / timeout 数值，行为不变但终于有了默认边界。
 */
async function fetchText(url, { tries = 3, timeout = 45000, headers = UA } = {}) {
  const res = await httpText(url, { tries, timeoutMs: timeout, headers, label: url.split('/')[2] });
  if (!res.ok) throw new Error(`${url.split('/')[2]}: HTTP ${res.status}`);
  return res.text;
}

/** 取二进制（parquet）。同上，出口统一。 */
export async function fetchBuffer(url, opt = {}) {
  return httpBuffer(url, {
    tries: opt.tries ?? 3,
    timeoutMs: opt.timeout ?? 90000,
    label: url.split('/')[2],
  });
}

// 把 "Claude Opus 5.5 (Max)" 拆成 基名 + 推理档位
const CONFIG_RE = /\s*[（(]\s*(max|high|xhigh|medium|low|thinking|think|reasoning|32k think|default)[^)）]*[)）]\s*$/i;
export function splitConfig(name) {
  const s = String(name || '').trim();
  const m = s.match(CONFIG_RE);
  if (!m) return { base: s, config: null };
  return { base: s.slice(0, m.index).trim(), config: m[1].toLowerCase().replace(/\s+/g, '') };
}
// 档位强弱：用于「同一模型保留最强档」
const CONFIG_RANK = { xhigh: 5, max: 4, high: 3, thinking: 2, think: 2, medium: 1, low: 0, default: 0 };

const round = (v, d = 2) => (v == null || Number.isNaN(v) ? null : Number(Number(v).toFixed(d)));

/**
 * 同一模型的多档位合并成一条，保留最强档。
 * 用于所有非 arena 源：它们的模型名里带 (Max)/(high)/(32k think) 这类配置，
 * 不合并的话同一个模型会重复上榜，排名看起来虚高。
 * @param {Array} rows 已带 score 的行
 * @param {(r)=>string} nameOf 取显示名的函数
 */
export function mergeByModel(rows, nameOf = (r) => r.model) {
  const best = new Map();
  for (const r of rows) {
    const { base, config } = splitConfig(nameOf(r));
    if (!base) continue;
    const key = base.toLowerCase();
    const rank = CONFIG_RANK[config] ?? -1;
    const cur = best.get(key);
    if (!cur || rank > cur._rank || (rank === cur._rank && r.score > cur.row.score)) {
      best.set(key, { row: { ...r, model: base, config: config || null }, _rank: rank });
    }
  }
  return [...best.values()]
    .map((x) => x.row)
    .sort((a, b) => b.score - a.score)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/* ─────────────── 1. LMArena（HF 官方数据集，24 个榜） ─────────────── */

// 数据集里的 config 目录名 → 展示信息。group 决定页面分组。
const ARENA_BOARDS = [
  { cfg: 'text',                 name: '文本·总榜',        group: 'text',   note: '普通用户盲测投票的 Elo，最常被引用的那个总榜。' },
  { cfg: 'text_factuality',      name: '文本·事实性',      group: 'text',   note: '只看事实正确与否的胜负，不看文采。' },
  { cfg: 'text_style_control',   name: '文本·文风控制',    group: 'text',   note: '控掉文风偏好后重算，检验是不是只会讨好。' },
  { cfg: 'vision',               name: '视觉·总榜',        group: 'vision', note: '图片理解与多模态问答。' },
  { cfg: 'vision_style_control', name: '视觉·文风控制',    group: 'vision', note: '视觉侧控掉文风偏好的版本。' },
  { cfg: 'webdev',               name: '前端·WebDev',      group: 'code',   note: 'Web 开发实战对局：写页面、改组件、修交互。' },
  { cfg: 'text_to_image',        name: '文生图',           group: 'media',  note: '文字生成图片的偏好对局。' },
  { cfg: 'image_edit',           name: '图像编辑',         group: 'media',  note: '按指令改图。' },
  { cfg: 'text_to_video',        name: '文生视频',         group: 'media',  note: '文字生成视频。' },
  { cfg: 'image_to_video',       name: '图生视频',         group: 'media',  note: '给定首帧生成视频。' },
  { cfg: 'video_edit',           name: '视频编辑',         group: 'media',  note: '按指令改视频。' },
  { cfg: 'search',               name: '搜索·总榜',        group: 'agent',  note: '带联网检索的问答对局。' },
  { cfg: 'search_factuality',    name: '搜索·事实性',      group: 'agent',  note: '检索结果是否真的对得上事实。' },
  { cfg: 'search_style_control', name: '搜索·文风控制',    group: 'agent',  note: '控掉文风后的检索能力。' },
  { cfg: 'document',             name: '文档理解',         group: 'agent',  note: '读长文档、抽取与问答。' },
  { cfg: 'document_style_control', name: '文档·文风控制',  group: 'agent',  note: '文档侧控掉文风的版本。' },
  { cfg: 'agent',                name: 'Agent·总榜',       group: 'agent',  note: '多轮工具调用的任务完成率（非 Elo）。' },
  { cfg: 'agent_task_outcome_explicit', name: 'Agent·任务达成', group: 'agent', note: '只看任务有没有真正完成。' },
  { cfg: 'agent_bash_reliability',      name: 'Agent·Bash 可靠性', group: 'agent', note: '干脏活：长串 shell 命令不出错的比例。' },
  { cfg: 'agent_bash_reliability_no_prereq', name: 'Agent·Bash 容错', group: 'agent', note: '前置条件缺失时还能不能自愈。' },
  { cfg: 'agent_bash_recovery_steps',   name: 'Agent·错误恢复', group: 'agent', note: '出错后需要几步才能救回来。' },
  { cfg: 'agent_tool_hallucination',    name: 'Agent·工具幻觉', group: 'agent', note: '有没有瞎编不存在的工具或参数。' },
  { cfg: 'agent_steerability',          name: 'Agent·可操纵性', group: 'agent', note: '指令改变时能不能及时调整方向。' },
  { cfg: 'agent_praise_complaint',      name: 'Agent·态度',     group: 'agent', note: '被夸与被骂时的稳定性。' },
];

// LMArena 文本榜的细分分类（category 字段），只取有实际意义的
const ARENA_TEXT_CATS = [
  ['overall', '总榜'], ['english', '英文'], ['chinese', '中文'], ['non_english', '非英语'],
  ['coding', '编程'], ['math', '数学'], ['hard_prompts', '高难题'], ['hard_prompts_english', '高难题·英'],
  ['expert', '专家级'], ['instruction_following', '指令跟随'], ['multi_turn', '多轮'],
  ['longer_query', '长提问'], ['creative_writing', '创意写作'], ['exclude_ties', '去平局'],
  ['industry_software_and_it_services', '软件与 IT'],
  ['industry_writing_and_literature_and_language', '写作与语言'],
  ['industry_mathematical', '数理'],
  ['industry_legal_and_government', '法律与政务'],
  ['industry_medicine_and_healthcare', '医疗健康'],
  ['industry_business_and_management_and_financial_operations', '商业与金融'],
  ['industry_life_and_physical_and_social_science', '生命与社科'],
  ['industry_entertainment_and_sports_and_media', '娱乐与媒体'],
  ['german', '德语'], ['french', '法语'], ['spanish', '西语'], ['japanese', '日语'],
  ['korean', '韩语'], ['russian', '俄语'], ['polish', '波兰语'],
];
const CAT_LABEL = Object.fromEntries(ARENA_TEXT_CATS);

async function fetchArenaBoards() {
  const out = [];
  const failed = [];
  // 本次实际抓到的榜（不含配置级回退的旧榜）：判断这一源是否新鲜只能看它
  const fresh = [];

  // 串行下载：24 个文件总计 1.7MB，逐个来最稳，也不给 CDN 添乱
  const boards = arenaBoardSet();
  for (const b of boards) {
    const url = `${HF}/${b.cfg}/latest-00000-of-00001.parquet`;
    try {
      const buf = await fetchBuffer(url);
      const pq = readParquet(buf);
      const all = pq.rows.filter((r) => r.model_name);

      // 同一个 latest 文件里可能混着几代快照（如 text_to_image 有 2025-01/2025-02/2026-10 三批），
      // 只保留最新那一批，否则旧模型会挤进当前榜单。
      const dates = all.map((r) => r.leaderboard_publish_date).filter(Boolean).sort();
      const newest = dates[dates.length - 1] || null;
      const rows = newest ? all.filter((r) => r.leaderboard_publish_date === newest) : all;

      // 该榜的数值字段：Elo 榜用 rating，agent 榜用 score（0–1 → 百分数）
      const usesScore = rows.length > 0 && rows[0].rating == null && rows[0].score != null;
      const pick = (r) => (usesScore ? r.score * 100 : r.rating);
      const pickLo = (r) => (usesScore ? (r.score_ci_lower ?? r.score) * 100 : r.rating_lower);
      const pickHi = (r) => (usesScore ? (r.score_ci_upper ?? r.score) * 100 : r.rating_upper);
      const votes = (r) => (usesScore ? r.session_count ?? r.observation_count : r.vote_count);

      const cats = [...new Set(rows.map((r) => r.category))];
      for (const cat of cats) {
        const sub = rows.filter((r) => r.category === cat);
        // 同一模型多档位（High/Max/xHigh）合并：保留最强档
        const best = new Map();
        for (const r of sub) {
          const { base, config } = splitConfig(r.model_name);
          const score = pick(r);
          if (score == null) continue;
          const cur = best.get(base);
          const rank = CONFIG_RANK[config] ?? -1;
          if (!cur || rank > cur._cfgRank || (rank === cur._cfgRank && score > cur.score)) {
            best.set(base, {
              model: base,
              config,
              org: r.organization ? String(r.organization) : null,
              score: round(score, 2),
              lo: round(pickLo(r), 2),
              hi: round(pickHi(r), 2),
              votes: votes(r) == null ? null : Math.round(votes(r)),
              _cfgRank: rank,
            });
          }
        }
        const list = [...best.values()]
          .sort((a, b) => b.score - a.score)
          .map((r, i) => {
            delete r._cfgRank;
            return { ...r, rank: i + 1 };
          });
        if (!list.length) continue;

        const publishDate = sub[0]?.leaderboard_publish_date || null;
        const id = cat === 'overall' ? b.cfg : `${b.cfg}__${cat}`;
        fresh.push({ id, cfg: b.cfg });
        out.push({
          id,
          name: cat === 'overall' ? b.name : `${b.name.replace(/·总榜$/, '')}·${CAT_LABEL[cat] || cat}`,
          family: 'arena',
          group: b.group,
          sub: cat === 'overall' ? null : cat,
          cfg: b.cfg,
          unit: usesScore ? 'pct' : 'elo',
          metric: usesScore ? 'score' : 'rating',
          updated: publishDate,
          url: `https://lmarena.ai/leaderboard/${b.cfg}`,
          source: 'arena',
          note: b.note,
          rows: list,
        });
      }
    } catch (e) {
      failed.push(`${b.cfg}: ${e.message}`);
    }
  }

  /*
   * 配置级回退（F02）：某个配置的 parquet 拉不到时，这一配置的历史榜仍然要发布，
   * 只是标 stale。整源失败时这里同样会补上——上层再用 prev.boards 兜底，
   * 两层保险覆盖「所有配置都失败」与「只有个别配置失败」。
   */
  for (const b of boards) {
    if (!failed.some((m) => m.startsWith(`${b.cfg}:`))) continue;
    for (const old of oldBoardsFor(b.cfg)) {
      if (out.some((nb) => nb.id === old.id)) continue;
      out.push({ ...old, stale: true });
    }
  }

  return { boards: out, failed, freshCount: fresh.length };
}

/**
 * 取某个配置的上一版榜。
 * fetchArenaBoards 没有 prev 参数，靠模块级的「上一版快照」传进来（见 setPrevBench）。
 * 这样不必改 8 个源函数签名，也不会让它们互相依赖。
 */
function oldBoardsFor(cfg) {
  return Object.values(PREV_BENCH?.boards || {}).filter((b) => b.source === 'arena' && b.cfg === cfg);
}

/* ─────────────── 2. SWE-bench（官网内嵌 JSON，5 个榜） ─────────────── */

async function fetchSwebench() {
  const html = await fetchText('https://www.swebench.com/');
  const blocks = [...html.matchAll(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)];
  if (!blocks.length) throw new Error('找不到内嵌 JSON');

  const payload = JSON.parse(blocks[0][1]);
  const boards = payload.boards || payload;
  if (!Array.isArray(boards)) throw new Error('JSON 结构变了');

  const out = [];
  for (const b of boards) {
    const raw = b.results || [];
    if (!raw.length) continue;
    // 同一模型可能被多个 agent 脚手架跑过；按「模型+分数」去重，保留最新提交
    const byKey = new Map();
    for (const r of raw) {
      if (typeof r.resolved !== 'number') continue;
      const model = String(r.model_display || r.model || r.agent || '').trim();
      if (!model) continue;
      const key = `${model}\u0000${r.resolved}`;
      const cur = byKey.get(key);
      if (!cur || String(r.date || '') > String(cur.date || '')) {
        byKey.set(key, {
          model,
          agent: r.agent ? String(r.agent) : null,
          score: round(r.resolved, 1),   // 官网就是百分数，不再 ×100
          date: r.date || null,
          folder: r.folder || null,
        });
      }
    }
    const rows = mergeByModel([...byKey.values()]);

    if (!rows.length) continue;
    const dates = rows.map((r) => r.date).filter(Boolean).sort();
    out.push({
      id: `swebench__${b.name.toLowerCase()}`,
      name: `SWE-bench ${b.name}`,
      family: 'swe',
      group: 'code',
      unit: 'pct',
      metric: 'resolved',
      updated: dates[dates.length - 1] || null,
      url: 'https://www.swebench.com/',
      source: 'swebench',
      note: b.name === 'Verified'
        ? '真实 GitHub issue 修 bug，500 道人工核验过的题，目前编码能力最硬的公开尺子。'
        : `SWE-bench ${b.name} 子榜。`,
      rows,
    });
  }
  if (!out.length) throw new Error('没有解析出任何榜');
  return { boards: out };
}

/* ─────────────── 3. Aider polyglot（官方 YAML，6 语言 225 题） ─────────────── */

export function parseAiderYaml(text) {
  // 该文件是扁平的 list<map>，不引第三方 YAML 库，按缩进手解
  const entries = [];
  let cur = null;
  for (const line of text.split('\n')) {
    const start = line.match(/^- (\w+):\s*(.*)$/);
    if (start) { cur = {}; cur[start[1]] = start[2]; entries.push(cur); continue; }
    const kv = line.match(/^ {2}(\w+):\s*(.*)$/);
    if (kv && cur) cur[kv[1]] = kv[2];
  }
  return entries;
}

async function fetchAider() {
  const text = await fetchText('https://raw.githubusercontent.com/Aider-AI/aider/main/aider/website/_data/polyglot_leaderboard.yml');
  const entries = parseAiderYaml(text).filter((e) => e.model && e.pass_rate_2);

  const best = new Map();
  for (const e of entries) {
    const score = Number(e.pass_rate_2);
    if (!Number.isFinite(score)) continue;
    const model = String(e.model).trim();
    const cur = best.get(model);
    if (!cur || score > cur.score) {
      best.set(model, {
        model,
        score: round(score, 1),
        score1: e.pass_rate_1 ? round(Number(e.pass_rate_1), 1) : null,
        cost: e.total_cost ? round(Number(e.total_cost), 2) : null,
        editFormat: e.edit_format || null,
        date: e.date || null,
        tests: e.test_cases ? Number(e.test_cases) : null,
      });
    }
  }
  const rows = mergeByModel([...best.values()]);
  if (!rows.length) throw new Error('没有解析出模型');

  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  return {
    boards: [{
      id: 'aider__polyglot',
      name: 'Aider Polyglot',
      family: 'aider',
      group: 'code',
      unit: 'pct',
      metric: 'pass_rate_2',
      updated: dates[dates.length - 1] || null,
      url: 'https://aider.chat/docs/leaderboards/',
      source: 'aider',
      note: '6 种语言 225 道练习题，要求直接改对真实仓库的代码，还公布每道题花多少钱。',
      rows,
    }],
  };
}

/* ─────────────── 4. Terminal-Bench（RSC 水合数据） ─────────────── */

export function sliceBalanced(text, startIdx) {
  // 从 startIdx 处的 { 或 [ 开始，切出配平的 JSON
  const open = text[startIdx];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = startIdx; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return null;
}

async function fetchTerminalBench() {
  const html = await fetchText('https://www.tbench.ai/leaderboard', { timeout: 60000 });

  // Next.js RSC 把数据切成多段 self.__next_f.push([1,"..."])，先拼回去
  const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)]
    .map((m) => {
      try { return JSON.parse(`"${m[1]}"`); } catch { return ''; }
    });
  const flight = chunks.join('');

  // 数据在 TanStack Query 的水合状态里：找 "rows":[...] 后配平切片
  let rows = [];
  const at = flight.search(/"rows":\s*\[/);
  if (at >= 0) {
    const arr = sliceBalanced(flight, flight.indexOf('[', at));
    if (arr) {
      try {
        const parsed = JSON.parse(arr);
        if (Array.isArray(parsed) && parsed.length) rows = parsed;
      } catch { /* 落到兜底 */ }
    }
  }

  // 兜底：直接扫 accuracy + model 的组合
  if (!rows.length) {
    const re = /"accuracy":([0-9.]+)[\s\S]{0,600}?"model_display":\{"url":"[^"]*","label":"([^"]+)"/g;
    let m;
    while ((m = re.exec(flight))) rows.push({ metrics: { accuracy: Number(m[1]) }, metadata: { model_display: { label: m[2] } } });
  }
  if (!rows.length) throw new Error('RSC 里没找到榜单');

  const flat = rows
    .map((r) => {
      const acc = r?.metrics?.accuracy;
      if (typeof acc !== 'number') return null;
      const model = r?.metadata?.model_display?.label || '—';
      const agent = r?.metadata?.agent_display?.label || null;
      const eff = r?.metadata?.reasoning_effort || null;
      const pass2 = typeof r?.metrics?.pass_at_2 === 'number' ? r.metrics.pass_at_2 : null;
      return {
        model: String(model).trim(),
        agent: agent ? String(agent) : null,
        effort: eff,
        score: round(acc, 2),                                   // accuracy 本身是百分数
        passAt2: pass2 == null ? null : round(pass2 * 100, 1),   // pass@k 是比率，单独换算
        trials: r?.metrics?.n_trials ?? null,
        cost: r?.metrics?.total_cost_usd != null ? round(r.metrics.total_cost_usd, 0) : null,
        date: r?.metadata?.date || null,
      };
    })
    .filter(Boolean);
  const list = mergeByModel(flat);
  if (!list.length) throw new Error('没有可用行');

  const dates = list.map((r) => r.date).filter(Boolean).sort();
  return {
    boards: [{
      id: 'terminalbench__4',
      name: 'Terminal-Bench 4.0',
      family: 'tbench',
      group: 'agent',
      unit: 'pct',
      metric: 'accuracy',
      updated: dates[dates.length - 1] || null,
      url: 'https://www.tbench.ai/leaderboard',
      source: 'tbench',
      note: '在真终端里干完整活：装环境、跑命令、把任务做到验收通过。分数是任务完成率。',
      rows: list,
    }],
  };
}

/* ─────────────── 5. τ-bench（S3 公开 manifest） ─────────────── */

async function fetchTauBench() {
  const base = 'https://sierra-tau-bench-public.s3.us-west-2.amazonaws.com';
  const manifest = JSON.parse(await fetchText(`${base}/submissions/manifest.json`));
  // manifest 是字符串数组：["claude-opus-4-5_sierra_2026-02-26", ...]
  const items = Array.isArray(manifest) ? manifest : manifest.submissions || [];
  const slugs = items
    .map((x) => (typeof x === 'string' ? x : x.slug || x.name || x.path))
    .filter(Boolean)
    .slice(0, TEST_PROFILE ? 3 : 40);
  if (!slugs.length) throw new Error('manifest 结构不明');

  const rows = [];
  // 串行抓，S3 单对象很小，但别一次并发 40 个
  for (const slug of slugs) {
    const url = `${base}/submissions/${slug}/submission.json`;
    try {
      const j = JSON.parse(await fetchText(url, { tries: 2, timeout: 20000 }));
      const res = j.results || {};
      const domains = Object.entries(res).filter(([, v]) => v && typeof v.pass_1 === 'number');
      if (!domains.length) continue;
      // 主指标：各 domain 的 pass_1 平均（τ-bench 原始口径）
      const avg = domains.reduce((a, [, v]) => a + v.pass_1, 0) / domains.length;
      // slug 里带 -none / -think 等后缀时补进显示名，否则不同推理配置会同名撞车
      let model = String(j.model_name || slug).trim();
      const slugTail = slug.split('_')[0] || '';
      if (/-none($|-)/i.test(slugTail) && !/\(none\)/i.test(model)) model += ' (none)';
      else if (/-think/i.test(slugTail) && !/think/i.test(model)) model += ' (think)';
      rows.push({
        model,
        org: j.model_organization || null,
        score: round(avg, 1),
        domains: domains.map(([k]) => k),
        perDomain: Object.fromEntries(domains.map(([k, v]) => [k, round(v.pass_1, 1)])),
        date: j.submission_date || null,
      });
    } catch { /* 单个 submission 坏了不影响整体 */ }
  }
  if (!rows.length) throw new Error('没有可用 submission');

  rows.sort((a, b) => b.score - a.score).forEach((r, i) => { r.rank = i + 1; });
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  return {
    boards: [{
      id: 'taubench__pass1',
      name: 'τ-bench',
      family: 'tau',
      group: 'agent',
      unit: 'pct',
      metric: 'pass_1',
      updated: dates[dates.length - 1] || null,
      url: 'https://taubench.com/',
      source: 'tau',
      note: '模拟真实客服与业务规则：退换货、订票、银行流程，看能不能按规矩把事办成。分数是各场景首次成功率平均。',
      rows,
    }],
  };
}

/* ─────────────── 6. Vals Index（保留原有，正则提取） ─────────────── */

async function fetchVals() {
  const url = 'https://www.vals.ai/benchmarks/vals_index';
  const html = await fetchText(url);
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');

  // Vals 页面写的是美式 MM/DD/YYYY，统一转成 ISO，否则站点里日期排序和比较会错乱
  const rawDate = (text.match(/Updated (\d{2}\/\d{2}\/\d{4})/) || text.match(/As of ([A-Z][a-z]+ \d+, \d{4})/) || [])[1] || null;
  let asOf = null;
  if (rawDate) {
    const us = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (us) asOf = `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
    else {
      const d = new Date(rawDate);
      asOf = Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
  }
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
  if (!rows.length) throw new Error('页面上没有分数');
  return {
    boards: [{
      id: 'vals__index',
      name: 'Vals Index',
      family: 'vals',
      group: 'general',
      unit: 'pct',
      metric: 'index',
      updated: asOf,
      url,
      source: 'vals',
      note: '把同一批题打包成一个综合指数。',
      rows,
    }],
  };
}

/* ─────────────── 7. ARC-AGI Prize（官方 evaluations.json + models.json） ─────────────── */

async function fetchArc() {
  const [evalRaw, modelRaw] = await Promise.all([
    fetchText('https://arcprize.org/media/data/evaluations.json', { timeout: 60000 }),
    fetchText('https://arcprize.org/media/data/models.json', { timeout: 60000 }),
  ]);
  const evals = JSON.parse(evalRaw);
  const models = JSON.parse(modelRaw);
  if (!Array.isArray(evals) || !Array.isArray(models)) throw new Error('结构变了');

  const modelById = new Map(models.map((m) => [m.id, m]));

  // 数据集：v2 是最新主线，v1 留作历史
  const DATASETS = [
    { id: 'v2_Semi_Private', name: 'ARC-AGI v2', note: '半私有集，官方主推口径。人类面板约 60%，是当前最硬的通用推理尺子之一。' },
    { id: 'v1_Semi_Private', name: 'ARC-AGI v1', note: '第一代半私有集，题目更难被训练数据覆盖。' },
  ];

  const out = [];
  for (const ds of DATASETS) {
    const all = evals
      .filter((e) => e.datasetId === ds.id && e.display !== false && typeof e.score === 'number')
      .map((e) => {
        const m = modelById.get(e.modelId) || {};
        const isHuman = /human/i.test(String(m.displayName || e.modelId));
        return {
          model: String(m.displayName || e.modelId),
          org: m.providerId || null,
          score: round(e.score * 100, 1),           // 0–1 → 百分数
          costPerTask: typeof e.costPerTask === 'number' ? round(e.costPerTask, 2) : null,
          type: m.modelType || null,
          released: m.modelReleaseDate ? String(m.modelReleaseDate).slice(0, 10) : null,
          human: isHuman || undefined,
        };
      })
      .sort((a, b) => b.score - a.score);
    const humans = all.filter((r) => r.human);
    const models = mergeByModel(all.filter((r) => !r.human));
    // 人类基线放在最前作参照，但不占用模型名次（rank 用 null 区分）
    const rows = [
      ...humans.map((r) => ({ ...r, rank: null })),
      ...models,
    ];

    if (!rows.length) continue;
    const rel = rows.map((r) => r.released).filter(Boolean).sort();
    out.push({
      id: `arc__${ds.id.toLowerCase().replace(/_/g, '-')}`,
      name: ds.name,
      family: 'arc',
      group: 'general',
      unit: 'pct',
      metric: 'score',
      updated: rel[rel.length - 1] || null,
      url: 'https://arcprize.org/leaderboard',
      source: 'arc',
      note: ds.note,
      rows,
    });
  }
  if (!out.length) throw new Error('没有解析出榜单');
  return { boards: out };
}

/* ─────────────── 8. SimpleBench（官方 JS 数据文件） ─────────────── */

async function fetchSimpleBench() {
  const js = await fetchText('https://simple-bench.com/static/js/leaderboard-data.js');
  const at = js.indexOf('[');
  if (at < 0) throw new Error('找不到数组');
  const arr = sliceBalanced(js, at);
  if (!arr) throw new Error('数组不完整');

  // 该文件是合法 JSON 的数组字面量（key 已带引号），可直接 parse
  let data;
  try {
    data = JSON.parse(arr);
  } catch {
    // 兜底：给裸 key 补引号后再试
    data = JSON.parse(arr.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":'));
  }
  if (!Array.isArray(data) || !data.length) throw new Error('不是数组');

  const rows = data
    .map((d) => {
      const raw = d.score ?? d.Score;
      const num = typeof raw === 'number' ? raw : parseFloat(String(raw).replace('%', ''));
      if (!Number.isFinite(num)) return null;
      const isHuman = /human|baseline/i.test(String(d.model || ''));
      return {
        model: String(d.model || '—').trim().replace(/\*+$/, ''),
        org: d.organization ? String(d.organization) : null,
        score: round(num, 1),
        date: d.dateAdded || null,
        human: isHuman || undefined,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);
  if (!rows.length) throw new Error('没有可用行');
  const humans = rows.filter((r) => r.human);
  const list = [
    ...humans.map((r) => ({ ...r, rank: null })),
    ...mergeByModel(rows.filter((r) => !r.human)),
  ];

  const dates = list.map((r) => r.date).filter(Boolean).sort();
  return {
    boards: [{
      id: 'simplebench__core',
      name: 'SimpleBench',
      family: 'simplebench',
      group: 'general',
      unit: 'pct',
      metric: 'score',
      updated: dates[dates.length - 1] || null,
      url: 'https://simple-bench.com/',
      source: 'simplebench',
      note: '题目对人类很简单、对模型很难（常识与空间直觉）。用来暴露「刷榜但不真懂」。',
      rows: list,
    }],
  };
}

/* ─────────────── 9. Artificial Analysis（RSC 头绕开 key，272 模型 × 34 项） ─────────────── */

// AA 的每个指标在页面上都独立成榜。unit 全部是「百分数或指数分」，不做二次换算。
// unit: 'pct' 表示源数据就是 0–1 比率，需 ×100 对齐其它榜；
//       'index' 表示本身就是指数分（不换算）。各家口径不同，逐项标，绝不全局换算。
const AA_METRICS = [
  { key: 'intelligenceIndex', name: '综合智能指数', group: 'general', unit: 'index', note: 'AA 把十来项公开评测合成一个指数，是目前覆盖面最广的综合刻照。' },
  { key: 'hle',               name: 'HLE 人类最后考试', group: 'general', unit: 'pct', note: "Humanity's Last Exam：跨学科的专家级难题，防止靠背答案刷分。" },
  { key: 'gpqa',              name: 'GPQA 研究生问答', group: 'general', unit: 'pct', note: '物理/化学/生物的研究生级选择题，答错说明推理链断了。' },
  { key: 'omniscience',       name: '事实知识',          group: 'general', unit: 'index', note: 'Omniscience 事实性指数：知道多少、以及会不会瞎编（可为负）。' },
  { key: 'critpt',            name: '临界点物理',        group: 'general', unit: 'pct', note: 'Critical-point physics，考的是真做物理而不是套公式。' },
  { key: 'lcr',               name: '长上下文',          group: 'text',    unit: 'pct', note: 'Long-context reasoning：长材料里找线索并推理。' },
  { key: 'ifbench',           name: '指令跟随',          group: 'text',    unit: 'pct', note: 'IFBench：严格按格式与约束输出，不自由发挥。' },
  { key: 'terminalBench40',   name: 'Terminal-Bench 4.0', group: 'agent', unit: 'pct', note: 'AA 侧独立复测的终端任务完成率，可与官方榜交叉对照。' },
  { key: 'terminalbenchHard', name: 'Terminal 硬题',     group: 'agent',  unit: 'pct', note: 'Terminal-Bench 高难题子集。' },
  { key: 'tau2',              name: 'τ²-bench',          group: 'agent',  unit: 'pct', note: '第二代 τ-bench：多领域对话式任务，看能不能按业务规则办成事。' },
  { key: 'tauBanking',        name: 'τ² 银行场景',       group: 'agent',  unit: 'pct', note: 'τ² 的银行知识子项，规则最复杂的一档。' },
  { key: 'scicode',           name: 'SciCode',           group: 'code',   unit: 'pct', note: '把论文里的科学计算写成能跑的代码。' },
  { key: 'mmmuPro',           name: 'MMMU-Pro',          group: 'vision', unit: 'pct', note: '大学水平的多模态理解：图表、公式、界面截图。' },
  { key: 'gdpvalNormalized',  name: 'GDPval',            group: 'general', unit: 'pct', note: '用真实职业任务衡量经济价值产出。' },
];

async function fetchAA() {
  // 加 RSC 头拿到 3 倍小的 flight 负载，且 initialModels 是可直接 parse 的 JSON
  const res = await httpText('https://artificialanalysis.ai/leaderboards/models?_rsc=indexai', {
    headers: { ...UA, RSC: '1' },
    label: 'aa-rsc',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = res.text;

  const at = text.indexOf('initialModels');
  if (at < 0) throw new Error('RSC 里没有 initialModels');
  const arrStart = text.indexOf('[', at);
  if (arrStart < 0) throw new Error('找不到数组起点');
  const json = sliceBalanced(text, arrStart);
  if (!json) throw new Error('数组不完整');

  const models = JSON.parse(json);
  if (!Array.isArray(models) || !models.length) throw new Error('不是数组');
  const fetchedAt = todayISO();

  // 同一模型的多档位合并（AA 的 name 里带 "(max with fallback)" 这类尾巴）
  const cleanName = (m) => {
    const raw = String(m.shortName || m.name || m.slug || '').trim();
    return raw.replace(/\s*\(([^)]*(?:fallback|max|high|xhigh|low|none)[^)]*)\)\s*/gi, ' ');
  };

  const boards = [];
  for (const spec of AA_METRICS) {
    const rows = models
      .filter((m) => typeof m?.[spec.key] === 'number' && !m.deprecated)
      .map((m) => ({
        model: cleanName(m),
        org: m.modelCreatorName || null,
        // 比率制 ×100 对齐其它榜；指数制原样保留
        score: round(spec.unit === 'pct' ? m[spec.key] * 100 : m[spec.key], 1),
        ctx: m.contextWindowTokens || null,
        reasoning: m.isReasoning || undefined,
        open: m.isOpenWeights || undefined,
      }));
    if (rows.length < 3) continue;
    const merged = mergeByModel(rows);
    boards.push({
      id: `aa__${spec.key.toLowerCase()}`,
      name: `AA·${spec.name}`,
      family: 'aa',
      group: spec.group,
      unit: spec.unit,
      metric: spec.key,
      updated: fetchedAt,
      url: 'https://artificialanalysis.ai/leaderboards/models',
      source: 'aa',
      note: spec.note,
      rows: merged,
    });
  }
  if (!boards.length) throw new Error('没有解析出任何指标');
  return { boards };
}

/* ─────────────── 汇总 ─────────────── */

const GROUPS = [
  { id: 'general', name: '综合', hint: '把很多榜合成一个数' },
  { id: 'text', name: '文本', hint: '写字、推理、事实与中文' },
  { id: 'code', name: '编程', hint: '真的改代码' },
  { id: 'agent', name: 'Agent', hint: '自己动手把活干完' },
  { id: 'vision', name: '视觉', hint: '看图' },
  { id: 'media', name: '生成', hint: '出图出视频' },
];

const SOURCE_INFO = {
  arena: { name: 'LMArena', home: 'https://lmarena.ai/', note: '官方在 HuggingFace 公开的榜单数据集' },
  swebench: { name: 'SWE-bench', home: 'https://www.swebench.com/', note: '普林斯顿等机构维护' },
  aider: { name: 'Aider', home: 'https://aider.chat/docs/leaderboards/', note: '官方公布，含每题成本' },
  tbench: { name: 'Terminal-Bench', home: 'https://www.tbench.ai/', note: '斯坦福 / Laude Institute' },
  tau: { name: 'τ-bench', home: 'https://taubench.com/', note: 'Sierra 官方 submission' },
  vals: { name: 'Vals Index', home: 'https://www.vals.ai/', note: '综合指数' },
  arc: { name: 'ARC-AGI', home: 'https://arcprize.org/', note: 'ARC Prize Foundation 官方数据' },
  simplebench: { name: 'SimpleBench', home: 'https://simple-bench.com/', note: '常识与空间直觉' },
  aa: { name: 'Artificial Analysis', home: 'https://artificialanalysis.ai/', note: '多榜合成，含独立复测' },
};

/**
 * 采全部评测源。
 * @param {object|null} prev 上一次的 bench 结果，用于失败时保留快照
 */
export async function fetchBenchmarks(prev) {
  // 各源函数做配置级回退时要用同一份上一版（见 oldBoardsFor）
  setPrevBench(prev);
  const tasks = [
    ['arena', fetchArenaBoards],
    ['swebench', fetchSwebench],
    ['aider', fetchAider],
    ['tbench', fetchTerminalBench],
    ['tau', fetchTauBench],
    ['vals', fetchVals],
    ['arc', fetchArc],
    ['simplebench', fetchSimpleBench],
    ['aa', fetchAA],
  ];

  const settled = await Promise.all(tasks.map(async ([id, fn]) => {
    try {
      const r = await fn();
      return { id, ok: true, ...r };
    } catch (e) {
      return { id, ok: false, error: e.message };
    }
  }));

  const boards = {};
  const sources = [];
  const stale = [];

  /** 这一源本轮是否真抓到了东西（freshCount 只在 arena 提供；其它源看 boards）。 */
  const hasFresh = (r) => (typeof r.freshCount === 'number' ? r.freshCount > 0 : (r.boards?.length || 0) > 0);

  for (const src of settled) {
    // 「有榜」不等于「抓到了」：配置级回退会用旧榜把 boards 补满，
    // 若本轮实际解析出 0 条，这一源必须按失败处理（标 stale、别报 ok）。
    const nothingFresh = !hasFresh(src);
    const s = nothingFresh ? { ...src, ok: false, error: src.error || '本轮没有任何配置解析成功' } : src;
    const prevBoards = Object.values(prev?.boards || {}).filter((b) => b.source === s.id);
    if (s.ok && s.boards?.length) {
      for (const b of s.boards) boards[b.id] = b;
      const upd = s.boards.map((b) => b.updated).filter(Boolean).sort();
      sources.push({
        id: s.id,
        name: SOURCE_INFO[s.id]?.name || s.id,
        home: SOURCE_INFO[s.id]?.home || null,
        note: SOURCE_INFO[s.id]?.note || null,
        boards: s.boards.length,
        rows: s.boards.reduce((a, b) => a + b.rows.length, 0),
        updated: upd[upd.length - 1] || null,
        ok: true,
        partial: s.failed?.length ? s.failed : undefined,
      });
    } else {
      // 失败：沿用上次快照，标记 stale。
      // 注意不能覆盖配置级回退已经放进来、已经标过 stale 的同 id 旧榜：
      // 那种情况下 rows 数量是「有」的，统计口径要保持一致，sources 也如实记 ok:false。
      for (const b of prevBoards) {
        if (boards[b.id]) continue;
        boards[b.id] = { ...b, stale: true };
      }
      // 实际发布出去的这条源的榜：配置级回退可能已经放进了一部分，不能只数 prevBoards
      const published = Object.values(boards).filter((b) => b.source === s.id);
      const carried = prevBoards.length > 0 || published.length > 0;
      sources.push({
        id: s.id,
        name: SOURCE_INFO[s.id]?.name || s.id,
        home: SOURCE_INFO[s.id]?.home || null,
        note: SOURCE_INFO[s.id]?.note || null,
        boards: published.length,
        rows: published.reduce((a, b) => a + (b.rows?.length || 0), 0),
        updated: prevBoards.map((b) => b.updated).filter(Boolean).sort().pop() || null,
        ok: false,
        error: s.error,
      });
      if (carried) stale.push(s.id);
    }
  }

  const boardList = Object.values(boards);

  // 瘦身：去掉空字段与内部标记，控制 data.json 体积
  for (const b of boardList) {
    b.rows = b.rows.map((r) => {
      const o = {};
      for (const [k, v] of Object.entries(r)) {
        if (k.startsWith('_') || v === undefined || v === null || v === '') continue;
        o[k] = v;
      }
      return o;
    });
  }

  // 相对采集时间，超过 6 个月没更新的榜标记为「陈旧」，页面上要显式提示，
  // 不然读者会把一年前的分数当成现在的能力。
  const today = now();
  const monthsOld = (iso) => {
    if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const d = new Date(iso + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) return null;
    return (today - d) / (1000 * 60 * 60 * 24 * 30.44);
  };

  // 目录：给页面做「一张总表 + 列切换」用
  const catalog = boardList.map((b) => ({
    id: b.id,
    name: b.name,
    family: b.family,
    group: b.group,
    sub: b.sub || null,
    unit: b.unit,
    metric: b.metric,
    rows: b.rows.length,
    updated: b.updated,
    source: b.source,
    url: b.url,
    note: b.note || null,
    stale: !!b.stale,
    ageMonths: (() => { const m = monthsOld(b.updated); return m == null ? null : Math.round(m); })(),
    outdated: (() => { const m = monthsOld(b.updated); return m != null && m > 6; })(),
  })).sort((a, b) => {
    const gi = GROUPS.findIndex((g) => g.id === a.group) - GROUPS.findIndex((g) => g.id === b.group);
    if (gi) return gi;
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    return (a.sub || '').localeCompare(b.sub || '');
  });

  // 跨榜共有的模型（用于总表首列）
  const modelSet = new Map();
  for (const b of boardList) {
    for (const r of b.rows) {
      const key = r.model.toLowerCase();
      if (!modelSet.has(key)) modelSet.set(key, { model: r.model, org: r.org || null, boards: 0 });
      modelSet.get(key).boards++;
    }
  }

  const updates = boardList.map((b) => b.updated).filter(Boolean).sort();

  return {
    as_of: todayISO(),
    latest: updates[updates.length - 1] || null,
    groups: GROUPS,
    sources,
    catalog,
    boards,
    stats: {
      boards: boardList.length,
      rows: boardList.reduce((a, b) => a + b.rows.length, 0),
      models: modelSet.size,
      sources: sources.filter((s) => s.ok).length,
      stale,
    },
  };
}

/*
 * 测试档位用的榜单集合覆盖（T1.2）。
 * 与 INDEXAI_PROFILE 的区别：profile 按固定切片缩（前 2 条），这里允许测试点名
 * 具体配置，用它自己的回放数据跑「整源失败 / 单配置失败」两条路径。
 * 生产不设这个变量，集合恒为 ARENA_BOARDS。
 */
function arenaBoardSet() {
  const raw = process.env.INDEXAI_ARENA_BOARDS;
  if (!raw) return TEST_PROFILE ? ARENA_BOARDS.slice(0, 2) : ARENA_BOARDS;
  const wanted = JSON.parse(raw);
  const byCfg = new Map(ARENA_BOARDS.map((b) => [b.cfg, b]));
  return wanted.map((w) => ({ ...byCfg.get(w.cfg), ...w }));
}

export { GROUPS, SOURCE_INFO, ARENA_BOARDS };
