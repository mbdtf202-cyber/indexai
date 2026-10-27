/**
 * subs 层（T3.1c6）。
 *
 * 这一层从两个上游 JSON 派生三种形状完全不同的产物，而且**三种产物各自沿用**：
 * 订阅拉到了但挂单没拉到，不该让挂单跟着用旧值——它们来自同一个响应的不同部分，
 * 但语义上互不依赖。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { subsThirdStats } from '../../lib/subs-stats.js';

const apple = {
  apps: [
    {
      slug: 'chatgpt',
      display_name: 'ChatGPT',
      plans: [
        {
          slug: 'plus',
          label: 'ChatGPT Plus',
          duration_label: '1月',
          regions: [
            {
              country_code: 'US',
              price_value: 20,
              currency_code: 'USD',
              cny_price: 142,
              country_label: '美国',
              price_text: '$20.00',
              app_store_url: 'https://apps.apple.com/x',
              fetched_at: '2026-10-24T00:00:00Z',
            },
            {
              country_code: 'PH',
              price_value: 15,
              currency_code: 'PHP',
              cny_price: 105,
              country_label: '菲律宾',
              price_text: '₱ 999',
            },
          ],
        },
      ],
    },
  ],
};

const prod = {
  products: [
    {
      name: 'ChatGPT',
      offers: [
        { url: 'https://evil.example/1', price: 10, platform_name: 'A', status: 'in_stock' },
        { url: 'https://evil.example/2', price: 30, platform_name: 'B', status: 'sold_out' },
      ],
    },
  ],
};

describe('subs 层（T3.1c6）', () => {
  let layer;
  const ctx = { subsThirdStats };

  test('加载并按契约导出', async () => {
    layer = (await import('../../pipeline/layers/subs/index.js')).default;
    assert.equal(layer.id, 'subs');
    assert.equal(layer.sources.length, 2);
  });

  test('只拿美国区明码的档位（拿不到就不猜价）', () => {
    const out = layer.normalize({ apple, prod }, ctx);
    assert.equal(out.records.subs.length, 1);
    assert.equal(out.records.subs[0].price, 20);
    assert.equal(out.records.subs[0].vendor, 'OpenAI');
  });

  test('官网价作为第二渠道挂到对应档位（T6.12）', () => {
    const official = [
      {
        productSlug: 'chatgpt',
        tier: 'Plus',
        price: 20,
        currency: 'USD',
        period: '1月',
        url: 'https://openai.com/pricing',
        note: '官网价',
        verified_at: '2026-10-28',
        evidence: [{ url: 'https://openai.com/pricing', quote: '$20' }],
      },
    ];
    const out = layer.normalize({ apple, prod, official }, ctx);
    assert.equal(out.records.subs[0].official.price, 20);
    assert.equal(out.records.subs[0].official.url, 'https://openai.com/pricing');
  });

  test('没有美国区价格的档位被跳过', () => {
    const noUs = {
      apps: [
        {
          ...apple.apps[0],
          plans: [
            {
              ...apple.apps[0].plans[0],
              regions: [{ country_code: 'PH', price_value: 15, cny_price: 105 }],
            },
          ],
        },
      ],
    };
    const out = layer.normalize({ apple: noUs, prod: null }, ctx);
    assert.equal(out.records.subs.length, 0);
  });

  test('区价保留最便宜若干并强制包含美国区', () => {
    const out = layer.normalize({ apple, prod: null }, ctx);
    const g = out.records.subsRegions[0];
    assert.ok(
      g.rows.some((r) => r.c === 'US'),
      '美国区必须在里面：它是官方价的锚',
    );
    assert.equal(g.total, 2, '两个国家都有 cny_price');
  });

  test('挂单只出统计，不含商品页链接', () => {
    const out = layer.normalize({ apple: null, prod }, ctx);
    const json = JSON.stringify(out.records.subsThird);
    assert.ok(!json.includes('evil.example'), '挂单统计里不该有链接');
    assert.equal(out.records.subsThird[0].listings, 2);
    assert.equal(out.records.subsThird[0].inStock, 1);
  });

  test('三种产物各自沿用：挂单没拉到不影响订阅', () => {
    const prev = {
      subs: [{ id: 'old', product: 'Old', price: 1 }],
      subsRegions: [],
      subsThird: [{ product: 'Old', listings: 9 }],
    };
    const next = {
      subs: [{ id: 'new', product: 'New', price: 2 }],
      subsRegions: [],
      subsThird: [],
    };
    const out = layer.merge(prev, next);
    assert.equal(out.subs[0].id, 'new', '订阅用新值');
    assert.equal(out.subsThird[0].listings, 9, '挂单沿用旧值');
  });

  test('全空时交出空数组而不是 undefined', () => {
    const out = layer.merge(null, { subs: [], subsRegions: [], subsThird: [] });
    assert.deepEqual(out, { subs: [], subsRegions: [], subsThird: [] });
  });

  test('门禁：没有官方档位告警', () => {
    const rule = layer.health.rules[0];
    assert.equal(rule.check({ subs: [] }).level, 'warn');
    assert.equal(rule.check({ subs: [{ id: 'x' }] }).level, 'ok');
  });
});
