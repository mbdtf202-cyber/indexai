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

/** 规则表。每条含 id、说明与检查函数。 */
export const RULES = [{ id: 'R1', description: 'package.json 没有 dependencies', check: checkR1 }];

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
