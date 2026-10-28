/**
 * 第三方挂单只呈现统计（T2.7 · D3 · F49）。
 *
 * F49：209 条挂单每条都带商品页直链，等于给发卡平台做了导流。
 * 站点不推荐、不保证可用，却把购买入口摆在页面上——这个矛盾要消掉。
 *
 * 结论（D3）：只下发**统计**——挂单数、在售数、价格区间、平台数。
 * 不保留任何商品页链接，采集端就不把它放进 data.json。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 造的挂单样本，覆盖在售 / 售罄 / 缺价三种。 */
const SAMPLE = [
  {
    product: 'Grok',
    platform: 'A',
    route: 'R1',
    price: 1.0,
    currency: 'CNY',
    status: 'in_stock',
    url: 'https://evil.example/item/1',
  },
  {
    product: 'Grok',
    platform: 'A',
    route: 'R1',
    price: 3.0,
    currency: 'CNY',
    status: 'in_stock',
    url: 'https://evil.example/item/2',
  },
  {
    product: 'Grok',
    platform: 'B',
    route: 'R2',
    price: 2.0,
    currency: 'CNY',
    status: 'sold_out',
    url: 'https://evil.example/item/3',
  },
  {
    product: 'Claude',
    platform: 'A',
    route: 'R1',
    price: null,
    currency: 'CNY',
    status: 'in_stock',
    url: 'https://evil.example/item/4',
  },
];

describe('subsThirdStats（T2.7 · D3）', () => {
  let stats;

  test('加载', async () => {
    stats = await import('../../lib/subs-stats.js');
    assert.equal(typeof stats.subsThirdStats, 'function');
  });

  test('按产品聚合：挂单数、在售数、平台数', () => {
    const out = stats.subsThirdStats(SAMPLE);
    const grok = out.find((x) => x.product === 'Grok');
    assert.equal(grok.listings, 3, 'Grok 有 3 条挂单');
    assert.equal(grok.inStock, 2, '其中 2 条在售');
    assert.equal(grok.platforms, 2, '来自 2 个平台');
  });

  test('价格给出最低 / 中位 / 最高，缺价不参与', () => {
    const out = stats.subsThirdStats(SAMPLE);
    const grok = out.find((x) => x.product === 'Grok');
    assert.equal(grok.min, 1);
    assert.equal(grok.max, 3);
    assert.equal(grok.median, 2);
    const claude = out.find((x) => x.product === 'Claude');
    assert.equal(claude.min, null, '没有可比较的价格时给 null，不补 0');
    assert.equal(claude.listings, 1);
  });

  test('输出里不含任何商品页链接', () => {
    const out = stats.subsThirdStats(SAMPLE);
    const json = JSON.stringify(out);
    assert.ok(!json.includes('evil.example'), `统计里不该出现链接：${json}`);
    assert.ok(!json.includes('"url"'), '不该保留 url 字段');
    for (const item of out) {
      assert.ok(!('url' in item) && !('buy' in item) && !('link' in item), JSON.stringify(item));
    }
  });

  test('空输入返回空数组', () => {
    assert.deepEqual(stats.subsThirdStats([]), []);
    assert.deepEqual(stats.subsThirdStats(null), []);
  });

  test('汇总总数：挂单总数与在售总数', () => {
    const total = stats.subsThirdTotal(SAMPLE);
    assert.equal(total.listings, 4);
    assert.equal(total.inStock, 3);
    assert.equal(total.platforms, 2);
  });
});

describe('分组排除规则（T2.7 · F49）', () => {
  let relays;

  test('加载', async () => {
    relays = await import('../../lib/relay-groups.js');
    assert.equal(typeof relays.isGrayGroup, 'function');
  });

  test('逆向 / 特价 / reverse 类分组判为灰色', () => {
    for (const name of [
      '逆向',
      '官方逆向',
      '特价',
      '特价分组',
      'reverse',
      'Reverse-Engineered',
      '逆向工程',
    ]) {
      assert.equal(relays.isGrayGroup(name), true, `${name} 应判为灰色`);
    }
  });

  test('正常分组不误判', () => {
    for (const name of ['default', 'Claude Code', 'vip', '纯血', '官方', 'pro', '']) {
      assert.equal(relays.isGrayGroup(name), false, `${name} 不该被判为灰色`);
    }
  });
});

describe('fixture 与页面不含发卡平台链接（T2.7 验收）', () => {
  test('fixtures/data 的 subsThird 只有统计，没有商品页链接', () => {
    const data = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'data', 'data.json'), 'utf8'));
    const rows = data.subsThird || [];
    assert.ok(rows.length > 0, 'fixture 应当有挂单统计');
    for (const row of rows) {
      assert.ok(!('url' in row), `统计行不该有 url：${JSON.stringify(row).slice(0, 120)}`);
      assert.ok(!('buy' in row) && !('link' in row), '不该有 buy / link');
    }
    // 统计字段齐备
    for (const row of rows) {
      for (const key of ['product', 'listings', 'inStock', 'platforms']) {
        assert.ok(key in row, `${row.product} 缺 ${key}`);
      }
    }
  });

  test('页面源码里第三方挂单不再渲染外链', () => {
    /* 页面逻辑自 T5.8 起在 site/scripts/app.js（CSP 要求无内联脚本）。 */
    const html =
      readFileSync(join(ROOT, 'site', 'scripts', 'app.js'), 'utf8') +
      readFileSync(join(ROOT, 'index.html'), 'utf8');
    // 找那段渲染挂单的代码：不应再出现 x.url 这样的链接
    assert.ok(!/subsThird\.map\(\s*x\s*=>\s*`<tr>/.test(html), '旧逐条渲染还在');
    assert.match(html, /renderThirdStats/, '应当有统计渲染函数');
  });
});
