#!/usr/bin/env node
/**
 * 架构适应度检查（UPGRADE_PLAN S1.5）。
 *
 * 每条规则有 id、说明、启用开关与检查函数。检查函数返回违例数组，
 * 每项形如 { file, line, message }。有违例即退出码 1。
 *
 * 规则随任务逐条启用，启用顺序见 IMPLEMENTATION_PLAN.md 的「适应度规则启用表」。
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 各条规则的启用状态。到了任务就打开，之后永远开着。 */
export const ENABLED = {
  R1: true, // T0.1
  R9: true, // T0.2 起包含 fixtures/http 与 fixtures/golden；T0.5 扩到 fixtures/data
  R2a: true, // T1.4
  R8: true, // T2.1（根目录部分）
  R5: true, // T2.2
  R10: true, // T2.5
  R12: true, // T0.6
};

/** 需要扫描的源码目录与根目录文件后缀。 */
const SCAN_DIRS = ['lib', 'test', 'scripts', 'site', 'pipeline'];
const ROOT_EXTS = ['.mjs', '.js', '.ts', '.json'];
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.wrangler',
  '.ralph',
  'dist',
  'coverage',
  'fixtures',
]);

/** 递归收集待检查文件。 */
function collectFiles(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectFiles(full, acc);
    } else if (extname(name) === '.mjs' || extname(name) === '.js') {
      acc.push(full);
    }
  }
  return acc;
}

/** 读取文件为行数组；文件不存在返回空。 */
function readLines(file) {
  try {
    return readFileSync(file, 'utf8').split('\n');
  } catch {
    return [];
  }
}

/** 把绝对路径转成相对仓库根的路径，用于输出。 */
function rel(file) {
  return relative(ROOT, file) || file;
}

/**
 * R1：package.json 没有 dependencies。
 * 运行时零依赖（INV-6），依赖面越小供应链风险越低。
 */
function checkR1() {
  const pkgPath = join(ROOT, 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  } catch (error) {
    return [{ file: 'package.json', line: 1, message: `无法读取 package.json：${error.message}` }];
  }
  if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
    const names = Object.keys(pkg.dependencies).join(', ');
    return [
      {
        file: 'package.json',
        line: 1,
        message: `R1 违反：不允许 dependencies，发现 ${names}`,
      },
    ];
  }
  return [];
}

/**
 * fixtures 各目录的体积上限（S1.4，单位字节）：
 *   http   ≤ 5 MB   回放数据必须小而真实
 *   golden ≤ 3 MB   采集输出的逐字节基线
 *   data   ≤ 1 MB   页面测试用的裁剪快照（T0.5）
 */
export const FIXTURE_LIMITS = {
  http: 5 * 1024 * 1024,
  golden: 3 * 1024 * 1024,
  data: 1 * 1024 * 1024,
};

/** 统计目录总字节数；目录不存在返回 0。 */
function dirSize(dir) {
  let total = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(d, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else total += st.size;
    }
  };
  walk(dir);
  return total;
}

/**
 * R9：fixtures 各目录不超过体积上限。
 * 回放数据必须小到能随仓库走，否则本地与 CI 都会变慢。
 */
function checkR9() {
  const violations = [];
  for (const [name, limit] of Object.entries(FIXTURE_LIMITS)) {
    const dir = join(ROOT, 'fixtures', name);
    const size = dirSize(dir);
    if (size > limit) {
      const mb = (size / 1024 / 1024).toFixed(2);
      const capMb = (limit / 1024 / 1024).toFixed(1);
      violations.push({
        file: `fixtures/${name}`,
        line: 1,
        message: `R9 违反：${mb} MB 超过上限 ${capMb} MB`,
      });
    }
  }
  return violations;
}

/**
 * R10：用量画像与有效成本公式只在 `lib/cost.js`（INV-5 · F36）。
 *
 * 理由：同一个公式曾在四处各写一份、参数还不一样（采集端 s=0.3、比价页 s=0.2、
 * 中转页 s=0.3、方法页两套都抄）。任何一处改动，另外三处就悄悄错，
 * 而表现出来的只是「同一个模型在两张表里价格不同」——读者只会看到矛盾。
 *
 * 检查两件事：
 * 1. 除 lib/cost.js 外，任何文件里不该再出现 `(1 - h` 这类公式骨架；
 * 2. 除 lib/cost.js 与方法页文案渲染处，不该再出现写死的阶梯数字 0.7 / 0.2 / 0.3
 *    与 `h`/`s` 成对赋值（画像只在这里定义）。
 */
function checkR10() {
  const violations = [];
  const files = [
    'collect.mjs',
    'bench.mjs',
    'health.mjs',
    ...collectFiles(join(ROOT, 'lib')).map((f) => relative(ROOT, f)),
    ...collectFiles(join(ROOT, 'site')).map((f) => relative(ROOT, f)),
  ];
  try {
    statSync(join(ROOT, 'index.html'));
    files.push('index.html');
  } catch {
    // 站点入口已迁走时跳过
  }

  const ALLOWED = new Set(['lib/cost.js', join('lib', 'cost.js')]);

  for (const rel of files) {
    if (ALLOWED.has(rel)) continue;
    readLines(join(ROOT, rel)).forEach((line, i) => {
      // 公式骨架：(1 - h) / (1−h) 出现在别处 = 又复刻了一份
      if (/\(\s*1\s*[-−]\s*h\s*\)/.test(line)) {
        violations.push({
          file: rel,
          line: i + 1,
          message: 'R10 违反：有效成本公式在别处复刻，应调用 lib/cost.js 的 effectiveCost()',
        });
      }
      // 画像成对赋值（h: 0.7 / s: 0.3 这种）也是复刻
      if (/\bh\s*[:=]\s*0\.\d+/.test(line) && /\bs\s*[:=]\s*0\.\d+/.test(line)) {
        violations.push({
          file: rel,
          line: i + 1,
          message: 'R10 违反：用量画像在别处定义，应读 lib/cost.js 的 PROFILES',
        });
      }
    });
  }
  return violations;
}

/**
 * R5：`TODO` / `FIXME` 必须带任务编号，例如 `TODO(T4.2)`。
 *
 * 理由（INV-4、INV-10）：没有编号的 TODO 等于一句遗言——没人知道它是谁留下的、
 * 什么时候该处理、算不算「已完成」。带编号才能被计划表追踪，或者干脆删掉。
 */
function checkR5() {
  const violations = [];
  const files = [
    ...['collect.mjs', 'bench.mjs', 'health.mjs'].map((f) => f),
    ...collectFiles(join(ROOT, 'lib')).map((f) => relative(ROOT, f)),
    ...collectFiles(join(ROOT, 'site')).map((f) => relative(ROOT, f)),
    ...collectFiles(join(ROOT, 'scripts')).map((f) => relative(ROOT, f)),
  ];
  try {
    statSync(join(ROOT, 'index.html'));
    files.push('index.html');
  } catch {
    // 文件可能已迁到 site/
  }

  for (const rel of files) {
    // 规则自己的实现与文档里必然出现「TODO」这个词，跳过本文件
    if (rel === join('scripts', 'check-invariants.js')) continue;
    readLines(join(ROOT, rel)).forEach((line, i) => {
      // 只看真正的标记：TODO 后面必须紧跟 (T<数字>.<数字>) 才算合格
      const m = line.match(/\b(TODO|FIXME)\b(?!\s*\()/);
      if (!m) return;
      violations.push({
        file: rel,
        line: i + 1,
        message: `R5 违反：${m[1]} 没有任务编号（写成 ${m[1]}(T4.2) 或删掉）`,
      });
    });
  }
  return violations;
}

/**
 * R8：仓库根目录只有白名单文件（dist/ 的部分等 M5 有构建清单后再加）。
 *
 * 理由（INV-10）：根目录每多一个文件，新人就要多猜一次「这是不是还在用」。
 * 孤儿文件、草稿页、一次性脚本都是这么留下来的 —— F28、F30、F37 全是这个形态。
 * 白名单是**穷举**：新增根目录文件必须同时改这张表，改动会出现在 diff 里。
 */
const ROOT_WHITELIST = new Set([
  // 文档与协作
  '.gitignore',
  '.node-version',
  'AGENTS.md',
  'IMPLEMENTATION_PLAN.md',
  'PROMPT_build.md',
  'README.md',
  'UPGRADE_PLAN.md',
  'LICENSE.txt',
  // 工具链
  'package.json',
  'package-lock.json',
  'biome.jsonc',
  'tsconfig.json',
  'playwright.config.js',
  'loop.sh',
  // 采集与体检（T3.1 起并入 pipeline/）
  'collect.mjs',
  'bench.mjs',
  'health.mjs',
  // 站点（M5 起拆进 site/）
  'index.html',
  'favicon.svg',
  '_headers',
  // 数据：只有人工维护的种子与归档进仓库
  'news-archive.json',
  'news-seed.json',
  'news-milestones.json',
  // 本地预览（T3.1d 起迁到 scripts/serve.js）
  'serve.mjs',
  // 目录
  'lib',
  'test',
  'scripts',
  'site',
  'pipeline',
  'fixtures',
  'assets',
  'dist',
  'curated',
  'registry',
  'types',
  'node_modules',
]);

/** 读 .gitignore 的顶层模式，用来判断某个根目录项是否属于「生成物」。 */
function ignoredRootNames() {
  const names = new Set();
  let raw;
  try {
    raw = readFileSync(join(ROOT, '.gitignore'), 'utf8');
  } catch {
    return names;
  }
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || t.startsWith('!')) continue;
    // 只认顶层条目（不含 / 的，或形如 name/ 的）
    if (t.includes('/') && !/^\/?[^/]+\/$/.test(t)) continue;
    names.add(t.replace(/^\//, '').replace(/\/$/, ''));
  }
  return names;
}

function checkR8() {
  const violations = [];
  const ignored = ignoredRootNames();
  let entries;
  try {
    entries = readdirSync(ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const e of entries) {
    // 点开头的是工具与编辑器临时物（.git / .wrangler / .DS_Store / .ralph …）
    if (e.name.startsWith('.')) continue;
    if (ROOT_WHITELIST.has(e.name)) continue;
    // 被 .gitignore 忽略的是生成物，不属于「仓库里有什么」
    if (ignored.has(e.name)) continue;
    violations.push({
      file: e.name,
      line: 1,
      message: `R8 违反：根目录不该出现 ${e.name}（要么删掉，要么加进 ROOT_WHITELIST 并说明理由）`,
    });
  }
  return violations;
}

/**
 * R2a：采集端（collect.mjs / bench.mjs / health.mjs / lib/*.js）的 `fetch(`
 * 只出现在 `lib/http.js`。
 *
 * 理由（S2.1、INV-8）：超时、重试、限速、记账都收在那一个出口里。
 * 任何一处绕过它，就等于多一个「没有超时」的漏洞 —— F05 就是这么来的。
 * 浏览器端另有 R2c，规则不同，不要混。
 */
function checkR2a() {
  const targets = ['collect.mjs', 'bench.mjs', 'health.mjs'];
  const dirs = ['lib', 'pipeline'];
  const files = [];
  for (const name of targets) {
    try {
      statSync(join(ROOT, name));
      files.push(name);
    } catch {
      // 文件可能已迁移到 pipeline/，不存在就跳过
    }
  }
  for (const dir of dirs) {
    try {
      for (const f of collectFiles(join(ROOT, dir))) files.push(relative(ROOT, f));
    } catch {
      // 目录还不存在
    }
  }

  const violations = [];
  for (const rel of files) {
    // 回放/录制层是「替换 fetch」这件事本身，不是调用方
    if (/^test\//.test(rel) || rel === join('lib', 'http.js')) continue;
    readLines(join(ROOT, rel)).forEach((line, i) => {
      // 去掉行注释与块注释的粗略处理：够用，误报比漏报便宜
      const code = line.replace(/\/\/.*$/, '');
      if (/\bfetch\s*\(/.test(code)) {
        violations.push({
          file: rel,
          line: i + 1,
          message: 'R2a 违反：采集端 fetch( 只能出现在 lib/http.js',
        });
      }
    });
  }
  return violations;
}

/**
 * R12：工作流里的 `uses:` 全部是 40 位 SHA；不出现 `npx --yes`、Node 20。
 * 浮动的主版本标签会静默换实现，`npx --yes` 会从网络拉未锁定版本，
 * Node 20 已于 2026-04-30 停止维护 —— 三者都是供应链与可复现的漏洞。
 */
function checkR12() {
  const dir = join(ROOT, '.github', 'workflows');
  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  } catch {
    return [];
  }

  const violations = [];
  for (const name of files) {
    const rel = `.github/workflows/${name}`;
    readLines(join(dir, name)).forEach((line, i) => {
      const n = i + 1;
      // uses: 必须带 40 位 SHA；注释里可写版本号
      const uses = line.match(/^\s*(?:-\s*)?uses:\s*(\S+)/);
      if (uses) {
        const ref = uses[1];
        const [, sha] = ref.split('@');
        if (!sha || !/^[0-9a-f]{40}$/.test(sha)) {
          violations.push({
            file: rel,
            line: n,
            message: `R12 违反：uses 未固定到 40 位 SHA（${ref}）`,
          });
        }
      }
      if (/npx\s+--yes/.test(line)) {
        violations.push({ file: rel, line: n, message: 'R12 违反：出现 npx --yes（未锁定版本）' });
      }
      if (/node-version:\s*["']?20["']?\b/.test(line)) {
        violations.push({
          file: rel,
          line: n,
          message: 'R12 违反：Node 20 已停止维护，改用 .node-version',
        });
      }
    });
  }
  return violations;
}

/** 规则表。每条含 id、说明与检查函数。 */
export const RULES = [
  { id: 'R1', description: 'package.json 没有 dependencies', check: checkR1 },
  {
    id: 'R9',
    description: 'fixtures 各目录不超过体积上限',
    check: checkR9,
  },
  {
    id: 'R10',
    description: '用量画像与有效成本公式只在 lib/cost.js',
    check: checkR10,
  },
  {
    id: 'R5',
    description: 'TODO/FIXME 必须带任务编号',
    check: checkR5,
  },
  {
    id: 'R8',
    description: '根目录只有白名单文件',
    check: checkR8,
  },
  {
    id: 'R2a',
    description: '采集端 fetch( 只在 lib/http.js',
    check: checkR2a,
  },
  {
    id: 'R12',
    description: 'workflow 的 uses 固定 SHA，无 npx --yes 与 Node 20',
    check: checkR12,
  },
];

/**
 * 运行启用的规则，返回全部违例。
 */
export function runRules() {
  const violations = [];
  for (const rule of RULES) {
    if (!ENABLED[rule.id]) continue;
    for (const v of rule.check()) {
      violations.push({ rule: rule.id, ...v });
    }
  }
  return violations;
}

/** 供未来规则复用的工具导出。 */
export const _internal = { ROOT, collectFiles, readLines, rel, SCAN_DIRS, ROOT_EXTS };

// 直接运行时执行检查
if (import.meta.url === `file://${process.argv[1]}`) {
  const violations = runRules();
  if (violations.length === 0) {
    const active = Object.entries(ENABLED)
      .filter(([, on]) => on)
      .map(([id]) => id);
    console.log(`适应度检查通过（启用规则：${active.join(', ') || '无'}）`);
    process.exit(0);
  }
  for (const v of violations) {
    console.error(`${v.file}:${v.line}  [${v.rule}] ${v.message}`);
  }
  console.error(`\n共 ${violations.length} 处违例。`);
  process.exit(1);
}
