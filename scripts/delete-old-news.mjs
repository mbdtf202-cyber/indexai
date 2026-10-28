/**
 * 删除旧新闻归档文件（T4.1 Round 3 收尾）
 *
 * 迁移确认后安全删除根目录的旧文件
 */

import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const archivePath = join(ROOT, 'news-archive.json');
const seedPath = join(ROOT, 'news-seed.json');

console.log('[cleanup] Checking for old files...');

let deleted = 0;

if (existsSync(archivePath)) {
  unlinkSync(archivePath);
  console.log(`[cleanup] Deleted ${archivePath}`);
  deleted++;
}

if (existsSync(seedPath)) {
  unlinkSync(seedPath);
  console.log(`[cleanup] Deleted ${seedPath}`);
  deleted++;
}

if (deleted === 0) {
  console.log('[cleanup] No old files to delete');
} else {
  console.log(`[cleanup] Successfully removed ${deleted} old files`);
}
