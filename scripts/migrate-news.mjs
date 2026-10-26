/**
 * News 归档迁移工具（T4.1 Round 3）
 *
 * 将 news-archive.json 和 news-seed.json 迁移到 news/YEAR-MONTH.json 格式
 *
 * 迁移逻辑:
 * 1. 读取现有 archive (含 seed)
 * 2. 按日期分组并合并到月度 JSON
 * 3. 写入 news/文件夹
 * 4. 可选：从根目录删除旧文件（迁移后确认无误）
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/** 加载新闻归档数据 */
export function loadArchive() {
  const archivePath = join(ROOT, 'news-archive.json');
  const seedPath = join(ROOT, 'news-seed.json');

  let archive = [];
  let seed = [];

  try {
    archive = Array.isArray(JSON.parse(readFileSync(archivePath, 'utf8')))
      ? JSON.parse(readFileSync(archivePath, 'utf8'))
      : JSON.parse(readFileSync(archivePath, 'utf8')).items || [];
  } catch (e) {
    console.warn('[migrate] news-archive.json 加载失败:', e.message);
  }

  try {
    seed = Array.isArray(JSON.parse(readFileSync(seedPath, 'utf8')))
      ? JSON.parse(readFileSync(seedPath, 'utf8'))
      : JSON.parse(readFileSync(seedPath, 'utf8')).items || [];
  } catch (e) {
    console.warn('[migrate] news-seed.json 加载失败:', e.message);
  }

  return [...seed, ...archive];
}

/** 提取 ISO 日期年份月份 */
function extractMonth(dateStr) {
  if (!dateStr || dateStr.length < 7) return null;
  const match = dateStr.match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : null;
}

/** 按月份分组并写入月度 JSON */
export function migrateToMonthlyFiles(articles) {
  const newsDir = join(ROOT, 'news');
  if (!existsSync(newsDir)) {
    mkdirSync(newsDir, { recursive: true });
  }

  const byMonth = new Map();

  for (const article of articles) {
    const month = extractMonth(article.date);
    if (!month) continue;

    if (!byMonth.has(month)) {
      byMonth.set(month, []);
    }
    byMonth.get(month).push(article);
  }

  // 写入月度文件（已排序以保持一致性）
  for (const [month, items] of byMonth) {
    items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const filepath = join(newsDir, `${month}.json`);
    writeFileSync(
      filepath,
      `${JSON.stringify(
        {
          month,
          generated_at: new Date().toISOString(),
          items,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`[migrate] ${month}: ${items.length} 条 → ${filepath}`);
  }

  return byMonth.size;
}

/** 备份并移除旧文件 */
export function cleanupOldFiles(backup = true) {
  const archivePath = join(ROOT, 'news-archive.json');
  const seedPath = join(ROOT, 'news-seed.json');

  if (backup && existsSync(archivePath)) {
    const backupName = `news-archive.json.backup.${Date.now()}`;
    copyFileSync(archivePath, join(ROOT, backupName));
    console.log(`[migrate] Backed up news-archive.json → ${backupName}`);
  }

  if (existsSync(archivePath)) {
    unlinkSync(archivePath);
    console.log('[migrate] Deleted news-archive.json');
  }

  if (backup && existsSync(seedPath)) {
    const backupName = `news-seed.json.backup.${Date.now()}`;
    copyFileSync(seedPath, join(ROOT, backupName));
    console.log(`[migrate] Backed up news-seed.json → ${backupName}`);
  }

  if (existsSync(seedPath)) {
    unlinkSync(seedPath);
    console.log('[migrate] Deleted news-seed.json');
  }
}

function copyFileSync(src, dest) {
  writeFileSync(dest, readFileSync(src));
}

// CLI usage
if (process.argv[1]?.endsWith('migrate-news.mjs')) {
  console.log('[migrate] Starting news archive migration...');
  const articles = loadArchive();
  console.log(`[migrate] Total articles: ${articles.length}`);
  const monthCount = migrateToMonthlyFiles(articles);
  console.log(`[migrate] Created ${monthCount} monthly files`);

  const confirm = await new Promise((resolve) => {
    const rl = require('node:readline').createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question('\nDelete old files? (y/n): ', (answer) => {
      rl.close();
      resolve(answer.toLowerCase().startsWith('y'));
    });
  });

  if (confirm) {
    cleanupOldFiles(true);
  }
}

export default { loadArchive, migrateToMonthlyFiles, cleanupOldFiles };
