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
