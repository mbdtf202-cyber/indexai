/**
 * 安全响应头与内联脚本（T5.8 · S10.1 · F46）。
 *
 * ## 静态检查为什么必要
 *
 * e2e 里监听 `securitypolicyviolation` 是运行时检查——只覆盖**真正跑到的代码**。
 * 条件分支里的内联脚本可能永远不会执行，测试永远绿，而它在某天被走到时就炸。
 *
 * 所以两条一起：单元测试扫构建产物与源文件（静态），e2e 监听违规（运行时）。
 * 这条测试就是静态那一半。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST = join(ROOT, 'dist');

/** S10.1 要求的四条响应头与关键片段。 */
const REQUIRED = {
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ],
  'Cross-Origin-Opener-Policy': ['same-origin'],
  'X-Content-Type-Options': ['nosniff'],
  'Referrer-Policy': ['strict-origin-when-cross-origin'],
};

/**
 * 找出 HTML 里的内联脚本（不算 JSON 数据块）。
 *
 * @param {string} html
 * @returns {string[]} 每个内联 script 的开始标签
 */
export function findInlineScripts(html) {
  const out = [];
  const re = /<script([^>]*)>/gi;
  let m;
  // biome-ignore lint/suspicious/noAssignInExpressions: 标准正则遍历
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/.test(attrs)) continue; // 外链，合规
    if (/type\s*=\s*["']application\/json["']/.test(attrs)) continue; // 数据块，不是脚本
    out.push(m[0]);
  }
  return out;
}

describe('_headers 写了 S10.1 的全部响应头', () => {
  const headers = readFileSync(join(ROOT, '_headers'), 'utf8');

  test('四个头都在', () => {
    for (const name of Object.keys(REQUIRED)) {
      assert.ok(headers.includes(name), `_headers 缺 ${name}`);
    }
  });

  test('CSP 的每个指令都在', () => {
    for (const needle of REQUIRED['Content-Security-Policy']) {
      assert.ok(headers.includes(needle), `CSP 缺 ${needle}`);
    }
  });

  test("script-src 只允许 'self'（不允许 unsafe-inline / unsafe-eval）", () => {
    const csp = headers.match(/Content-Security-Policy:\s*([^\n]+)/)?.[1] || '';
    const scriptSrc = csp.match(/script-src([^;]*)/)?.[1] || '';
    assert.ok(scriptSrc.includes("'self'"), "script-src 要有 'self'");
    assert.equal(scriptSrc.includes('unsafe-inline'), false, 'script-src 不该开 unsafe-inline');
    assert.equal(scriptSrc.includes('unsafe-eval'), false, 'script-src 不该开 unsafe-eval');
  });

  test("style-src-attr 允许 'unsafe-inline'（条形图的内联变量）", () => {
    const csp = headers.match(/Content-Security-Policy:\s*([^\n]+)/)?.[1] || '';
    assert.ok(csp.includes("style-src-attr 'unsafe-inline'"), '条形图用 style="--w:…"，需要这条');
  });
});

describe('构建产物没有内联脚本（验收）', () => {
  const htmls = () => {
    if (!existsSync(DIST)) return [];
    const out = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, name.name);
        if (name.isDirectory()) walk(p);
        else if (name.name.endsWith('.html')) out.push(p);
      }
    };
    walk(DIST);
    return out;
  };

  test('每个 HTML 的内联脚本为零', () => {
    const files = htmls();
    if (!files.length) return; // 未构建

    const offenders = [];
    for (const f of files) {
      const bad = findInlineScripts(readFileSync(f, 'utf8'));
      if (bad.length) offenders.push(`${f.replace(ROOT, '.')}: ${bad.join(' ')}`);
    }
    assert.deepEqual(offenders, [], `内联脚本会触发 CSP：\n${offenders.join('\n')}`);
  });

  test('没有内联事件属性（onclick= 之类）', () => {
    const files = htmls();
    if (!files.length) return;

    const offenders = [];
    for (const f of files) {
      const html = readFileSync(f, 'utf8');
      // 只看标签里的 on*=，不看正文里的文本
      const hits = html.match(/<[^>]+\son[a-z]+\s*=/gi);
      if (hits) offenders.push(`${f.replace(ROOT, '.')}: ${hits.slice(0, 3).join(' ')}`);
    }
    assert.deepEqual(offenders, [], `内联事件属性同样违反 CSP`);
  });

  test('没有 javascript: 链接', () => {
    const files = htmls();
    if (!files.length) return;
    for (const f of files) {
      const html = readFileSync(f, 'utf8');
      assert.equal(/href\s*=\s*["']javascript:/i.test(html), false, `${f} 里有 javascript: 链接`);
    }
  });
});

describe('源文件里的脚本也已外置', () => {
  test('index.html 没有内联脚本', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const bad = findInlineScripts(html);
    assert.deepEqual(bad, [], `index.html 还有内联脚本：${bad.join(' ')}`);
  });

  test('index.html 引用了 boot.js 与 app.js', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    assert.match(html, /src="\/scripts\/boot\.js"/, '缺 boot.js（防闪烁必须同步加载）');
    assert.match(html, /src="\/scripts\/app\.js"/, '缺 app.js');
  });

  test('boot.js 存在且很小（同步阻塞，不能大）', () => {
    const p = join(ROOT, 'site', 'scripts', 'boot.js');
    assert.ok(existsSync(p));
    const size = readFileSync(p).length;
    assert.ok(size < 2000, `boot.js ${size} 字节，同步脚本应当很小`);
  });

  test('app.js 用绝对路径 import（外置后相对路径会 404）', () => {
    const p = join(ROOT, 'site', 'scripts', 'app.js');
    if (!existsSync(p)) return;
    const src = readFileSync(p, 'utf8');
    const rel = src.match(/from\s+["']\.\/lib\//g);
    assert.equal(rel, null, `app.js 里有相对 lib 导入，会把 /scripts/lib/… 打成 404`);
  });
});

describe('findInlineScripts 本身', () => {
  test('认外链脚本为合规', () => {
    assert.deepEqual(findInlineScripts('<script src="/a.js"></script>'), []);
  });

  test('认 JSON 数据块为合规', () => {
    assert.deepEqual(findInlineScripts('<script type="application/json" id="x">{}</script>'), []);
  });

  test('抓到真正的内联脚本', () => {
    assert.equal(findInlineScripts('<script>alert(1)</script>').length, 1);
    assert.equal(findInlineScripts('<script type="module">x</script>').length, 1);
  });
});
