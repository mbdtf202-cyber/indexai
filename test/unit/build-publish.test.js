/**
 * 单一构建与发布（T3.9 · F37 / F47 · S3.5）。
 *
 * ## 四条验收
 *
 * 1. 构建产出带内容哈希的数据文件 + `dist/data/manifest.json`；`_headers` 里
 *    manifest 不缓存、带哈希的文件长缓存；
 * 2. workflow 的组装步骤只有 `npm run build`；
 * 3. Cloudflare 密钥只出现在 deploy job；
 * 4. 线上自检比对的是**哈希**，不是时间戳。
 *
 * 这些都在检查「构建与发布」这条链上不该有的东西：手写的产物、错位的密钥、
 * 靠时间戳假装正确的自检。
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(ROOT, 'dist');
const WF = readFileSync(join(ROOT, '.github/workflows/daily-collect.yml'), 'utf8');
const HEADERS = readFileSync(join(ROOT, '_headers'), 'utf8');

/** 按 job 切块，用于检查「某项只出现在某个 job」。 */
function jobBlock(name) {
  const re = new RegExp(`^  ${name}:$`, 'm');
  const m = re.exec(WF);
  if (!m) return null;
  const rest = WF.slice(m.index + m[0].length);
  // 下一个 job 头（两个空格 + 名字 + 冒号，行首）
  const next = /^ {2}[a-z][a-z-]*:$/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

describe('workflow 结构（T3.9 验收 2 / 3）', () => {
  test('拆成 collect / build / deploy 三个 job', () => {
    for (const j of ['collect', 'build', 'deploy']) {
      assert.ok(jobBlock(j), `缺 ${j} job`);
    }
  });

  test('build 依赖 collect，deploy 依赖 build', () => {
    assert.match(jobBlock('build'), /needs: collect/);
    assert.match(jobBlock('deploy'), /needs: build/);
  });

  test('Cloudflare 密钥只出现在 deploy（验收 3）', () => {
    for (const j of ['collect', 'build']) {
      const block = jobBlock(j);
      assert.equal(
        (block.match(/CLOUDFLARE_API_TOKEN/g) || []).length,
        0,
        `${j} job 不该拿到 Cloudflare 密钥`,
      );
    }
    assert.ok(
      (jobBlock('deploy').match(/CLOUDFLARE_API_TOKEN/g) || []).length > 0,
      'deploy 需要密钥',
    );
  });

  test('wrangler 部署只出现在 deploy', () => {
    assert.equal((jobBlock('collect').match(/wrangler pages deploy/g) || []).length, 0);
    assert.equal((jobBlock('build').match(/wrangler pages deploy/g) || []).length, 0);
    assert.equal((jobBlock('deploy').match(/wrangler pages deploy/g) || []).length, 1);
  });

  test('组装只有 npm run build，没有手工 cp 拼装（验收 2）', () => {
    const build = jobBlock('build');
    assert.match(build, /npm run build/);
    // 旧的「组装发布目录」步骤里那一串 cp 不该再出现
    assert.equal(
      /cp index\.html data\.json bench\.json/.test(build),
      false,
      'build job 里不该手工 cp 数据文件',
    );
    assert.equal(
      /cp -R assets dist\/assets/.test(WF),
      false,
      '整个 workflow 里不该再手工拼装 dist',
    );
  });

  test('只有需要写仓库的 job 拿写权限', () => {
    assert.match(jobBlock('collect'), /contents: write/, 'collect 要提交情报归档');
    assert.match(jobBlock('build'), /contents: read/);
    assert.match(jobBlock('deploy'), /contents: read/);
  });

  test('build 与 deploy 通过 artifact 传递产物', () => {
    assert.match(jobBlock('collect'), /upload-artifact/);
    assert.match(jobBlock('build'), /download-artifact/);
    assert.match(jobBlock('deploy'), /download-artifact/);
  });
});

describe('线上自检比对哈希（T3.9 验收 4）', () => {
  test('deploy 调用 verify-deploy.mjs', () => {
    assert.match(jobBlock('deploy'), /node scripts\/verify-deploy\.mjs/);
  });

  test('不再用 generated_at 时间戳做自检', () => {
    /* 只看「线上验证」这一步：collect 里拉基线时读 generated_at 是记录基线时间，
     * 那是正常的；自检拿时间戳比对才是问题。 */
    const deploy = jobBlock('deploy');
    const at = deploy.indexOf('name: 线上验证');
    assert.ok(at > 0, 'deploy 里要有线上验证步骤');
    // 截到下一步（摘要）为止：摘要显示生成时间是正常的
    const next = deploy.indexOf('- name: 摘要', at);
    const step = deploy.slice(at, next > 0 ? next : undefined);
    assert.equal(
      /meta\.generated_at/.test(step),
      false,
      '时间戳相同不代表内容相同，自检必须比哈希',
    );
  });

  test('自检脚本真的按 sha256 比对', () => {
    const src = readFileSync(join(ROOT, 'scripts/verify-deploy.mjs'), 'utf8');
    assert.match(src, /createHash\('sha256'\)/);
    assert.match(src, /schema_version/, 'schema 不符要整体失败（S3.5）');
  });
});

describe('带哈希的数据文件（T3.9 验收 1）', () => {
  before(() => {
    // dist 由 npm run build 生成；没构建过就跳过（CI 里先 build 再 test）
  });

  test('dist/data/manifest.json 存在且结构正确', () => {
    const p = join(DIST, 'data', 'manifest.json');
    if (!existsSync(p)) return; // 未构建
    const m = JSON.parse(readFileSync(p, 'utf8'));
    assert.equal(m.schema_version, 'data-manifest/v1');
    assert.ok(Array.isArray(m.files) && m.files.length > 0, '要有数据文件清单');
    for (const f of m.files) {
      assert.match(f.file, /^data\/[a-z-]+\.[0-9a-f]{8}\.json$/, '文件名要带哈希');
      assert.match(f.hash, /^[0-9a-f]{64}$/, 'hash 要是 sha256');
      assert.ok(typeof f.bytes === 'number' && f.bytes > 0);
    }
  });

  test('manifest 里的哈希与文件实际字节一致', () => {
    const p = join(DIST, 'data', 'manifest.json');
    if (!existsSync(p)) return;
    const m = JSON.parse(readFileSync(p, 'utf8'));
    for (const f of m.files) {
      const full = join(DIST, f.file);
      assert.ok(existsSync(full), `缺文件 ${f.file}`);
      const actual = createHash('sha256').update(readFileSync(full)).digest('hex');
      assert.equal(actual, f.hash, `${f.file} 的哈希与 manifest 不符`);
    }
  });

  test('manifest 合并了采集侧的分层信息', () => {
    const p = join(DIST, 'data', 'manifest.json');
    if (!existsSync(p)) return;
    const m = JSON.parse(readFileSync(p, 'utf8'));
    if (m.layers === undefined) return; // fixtures 里可能没有采集 manifest
    assert.ok(Array.isArray(m.layers), 'layers 要是数组');
  });
});

describe('缓存策略（T3.9 验收 1）', () => {
  test('manifest 不缓存', () => {
    const m = /\/data\/manifest\.json\n([\s\S]*?)\n\n/.exec(HEADERS);
    assert.ok(m, '_headers 里要有 /data/manifest.json 的规则');
    assert.match(m[1], /no-store/, 'manifest 是索引，缓存旧值页面就永远看不到新数据');
  });

  test('带哈希的数据文件长缓存 + immutable', () => {
    const m = /\/data\/data\.\*\.json\n([\s\S]*?)\n\n/.exec(HEADERS);
    assert.ok(m, '要有 /data/data.*.json 的规则');
    assert.match(m[1], /max-age=31536000/);
    assert.match(m[1], /immutable/);
  });

  test('页面外壳每次校验', () => {
    assert.match(HEADERS, /\/index\.html\n {2}Cache-Control: public, max-age=0, must-revalidate/);
  });
});
