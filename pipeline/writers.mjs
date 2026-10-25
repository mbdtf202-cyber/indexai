/**
 * 写盘操作模块（T3.1d Round 4 - R3 合规模块化拆分）。
 *
 * 本模块负责所有数据写盘操作：
 * - data.json
 * - bench.json
 * - news-archive.json
 *
 * 与其他模块解耦，只做纯粹的 I/O 操作。
 */

import { writeFile } from 'node:fs/promises';
import { join, dirname, fileURLToPath } from 'node:path';
import { pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

// 输出路径定义
const OUT_URL = new URL('./fixtures/data/data.json', import.meta.url);
const BENCH_OUT_URL = new URL('./fixtures/data/bench.json', import.meta.url);
const NEWS_ARCHIVE_URL = new URL('./fixtures/data/news-archive.json', import.meta.url);

/** 写盘操作 */
async function writeJson(url, data) {
  const p = fileURLToPath(url);
  await writeFile(p, JSON.stringify(data, null, 2));
}

/** 写入 data.json */
export async function writeData(data) {
  await writeJson(OUT_URL, data);
}

/** 写入 bench.json */
export async function writeBench(bench) {
  await writeJson(BENCH_OUT_URL, bench);
}

/** 写入 news-archive.json */
export async function writeNewsArchive(archive) {
  await writeJson(NEWS_ARCHIVE_URL, archive);
}

export default {
  writeData,
  writeBench,
  writeNewsArchive,
};
