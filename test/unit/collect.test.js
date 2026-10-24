/**
 * collect.mjs 的特征测试（T0.3）。
 *
 * 用例优先取代码注释里记录的真实事故：Devpost 三种日期写法、单日活动、
 * tier("base", ...) 表达式、model_ratio 误用、分组名带倍率、
 * deepseek-flash 与 deepseek-v4-1-flash 混淆。
 *
 * 已知缺陷写成带 F 编号的 todo 用例，本任务不修。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseDevpostDates,
  eventStatus,
  eventKind,
  eventRegion,
  foldRegions,
  regionFromCountryCode,
  devfolioIsAI,
  devfolioPrize,
  parseBillingExpr,
  exprCoefficients,
  tierBranches,
  relayPrice,
  rowGroups,
  groupRatioTable,
  pickFlagship,
  familyKey,
  band,
  per1M,
  peakNote,
  effectiveCost,
  dedupeModels,
  dedupeOffers,
  parseOpenRouter,
  parseJsonLoose,
} from '../../collect.mjs';

describe('parseDevpostDates', () => {
  test('第一种写法：同月跨日 "Oct 05 - 27, 2026"', () => {
    assert.deepEqual(parseDevpostDates('Oct 05 - 27, 2026'), {
      start: '2026-10-05',
      end: '2026-10-27',
    });
  });

  test('第二种写法：跨月带年份 "Oct 05 - Nov 12, 2026"', () => {
    assert.deepEqual(parseDevpostDates('Oct 05 - Nov 12, 2026'), {
      start: '2026-10-05',
      end: '2026-11-12',
    });
  });

  test('第三种写法：单日活动 "Oct 23, 2026"（曾经 37 条因此消失）', () => {
    assert.deepEqual(parseDevpostDates('Oct 23, 2026'), {
      start: '2026-10-23',
      end: '2026-10-23',
    });
  });

  test('跨年纠正：起点月晚于终点月', () => {
    const r = parseDevpostDates('Dec 20 - Jan 05, 2027');
    assert.equal(r.start, '2026-12-20');
    assert.equal(r.end, '2027-01-05');
  });

  test('无法解析时两端都是 null', () => {
    assert.deepEqual(parseDevpostDates('TBD'), { start: null, end: null });
  });

  test('空输入不抛错', () => {
    assert.deepEqual(parseDevpostDates(''), { start: null, end: null });
    assert.deepEqual(parseDevpostDates(undefined), { start: null, end: null });
  });
});

describe('eventStatus', () => {
  test('已结束', () => {
    assert.equal(eventStatus({ start: '2026-01-01', end: '2026-01-02' }, '2026-10-24'), 'past');
  });

  test('进行中（open）', () => {
    assert.equal(eventStatus({ start: '2026-10-20', end: '2026-11-01' }, '2026-10-24'), 'open');
  });

  test('尚未开始', () => {
    assert.equal(eventStatus({ start: '2026-12-01', end: '2026-12-02' }, '2026-10-24'), 'upcoming');
  });

  test('没有日期是 unknown', () => {
    assert.equal(eventStatus({}, '2026-10-24'), 'unknown');
  });

  test('只有 start 且就是今天算 open', () => {
    assert.equal(eventStatus({ start: '2026-10-24' }, '2026-10-24'), 'open');
  });
});

describe('eventKind', () => {
  test('hackathon 命中', () => {
    assert.equal(eventKind({ title: 'OpenAI Hackathon 2026' }), 'hackathon');
  });

  test('summit 是 conference', () => {
    assert.equal(eventKind({ title: 'AI Summit London' }), 'conference');
  });

  test('award 单独成一类', () => {
    assert.equal(eventKind({ title: 'AI Film Award' }), 'award');
  });

  test('workshop', () => {
    assert.equal(eventKind({ title: 'RAG Workshop' }), 'workshop');
  });

  test('meetup', () => {
    assert.equal(eventKind({ title: 'AI meetup Berlin' }), 'meetup');
  });

  test('Luma 未命中关键词按 meetup 兜底', () => {
    assert.equal(eventKind({ title: '随便一个名字', source: 'Luma' }), 'meetup');
  });

  test('Devpost 按 hackathon 兜底', () => {
    assert.equal(eventKind({ title: 'Life After Code', source: 'Devpost' }), 'hackathon');
  });

  test('Devfolio 按 hackathon 兜底', () => {
    assert.equal(eventKind({ title: 'Unbuilt', source: 'Devfolio' }), 'hackathon');
  });

  test('无来源无关键词归 other', () => {
    assert.equal(eventKind({ title: 'zzz' }), 'other');
  });

  test('F11：con\\b 不再误命中 Silicon Valley', () => {
    // 旧规则里 con\b 让任何 "Silicon Valley ..." 都成了会议
    assert.notEqual(eventKind({ title: 'Silicon Valley Builders Meetup' }), 'conference');
    assert.equal(eventKind({ title: 'Silicon Valley GenAI Meetup' }), 'meetup');
  });

  test('F11：英文 forum 不再当会议（保留「论坛」）', () => {
    assert.notEqual(eventKind({ title: 'OpenAI Forum Series' }), 'conference');
    // 中文「论坛」仍然算会议
    assert.equal(eventKind({ title: 'AI 安全论坛' }), 'conference');
  });
});

describe('eventRegion / regionFromCountryCode', () => {
  test('纯线上判 online', () => {
    assert.equal(eventRegion({ location: '线上' }), 'online');
    assert.equal(eventRegion({ location: 'Online' }), 'online');
  });

  test('国家码优先于地点字符串（返回小写地区码）', () => {
    assert.equal(eventRegion({ location: 'Singapore', countryCode: 'JP' }), 'jp');
  });

  test('未知国家码回退到地点正则', () => {
    assert.equal(eventRegion({ location: 'Berlin', countryCode: 'ZZ' }), 'eu');
  });

  test('混合场次（线上 + 有国家码）仍按国家码', () => {
    assert.equal(eventRegion({ location: '线上 + 东京', countryCode: 'JP' }), 'jp');
  });

  test('无法识别归 other', () => {
    assert.equal(eventRegion({ location: '某处' }), 'other');
  });

  test('regionFromCountryCode 大小写无关', () => {
    assert.equal(regionFromCountryCode('in'), regionFromCountryCode('IN'));
    assert.equal(regionFromCountryCode('JP'), 'jp');
  });

  test('regionFromCountryCode 空值返回 null', () => {
    assert.equal(regionFromCountryCode(''), null);
    assert.equal(regionFromCountryCode(null), null);
  });

  test('F10：PK 归 asia，不是印度', () => {
    assert.equal(regionFromCountryCode('PK'), 'asia');
  });

  test('F10：Pakistan / Islamabad / Lahore 不再被判成印度', () => {
    for (const location of ['Islamabad, Pakistan', 'Lahore, Pakistan', 'ISLAMABAD']) {
      assert.notEqual(eventRegion({ location }), 'in', `${location} 不该判成印度`);
      assert.equal(eventRegion({ location }), 'asia', `${location} 应归 asia`);
    }
  });

  test('F10：Ontario / Quebec 归加拿大（Rio 不再命中 Ontario）', () => {
    for (const location of [
      'Kitchener, Ontario',
      'Waterloo, Ontario',
      'Montreal, Quebec',
      'Mississauga, Ontario',
    ]) {
      assert.equal(eventRegion({ location }), 'ca', `${location} 应归 ca`);
    }
  });

  test('F10：短地名一律带词边界，不当人名误命中', () => {
    // 标题里出现人名 Jordan，地点是伦敦：应当看地点，不是看标题
    assert.equal(eventRegion({ title: 'Fireside with Jordan Lee', location: 'London' }), 'uk');
    // 地点里没有地名时，不该因为正文有 Austin/Sofia 这类词就判成某国
    assert.notEqual(eventRegion({ location: 'Room 3', org: 'Sofia Collective' }), 'eu');
  });

  test('F10：eventRegion 不再读标题', () => {
    // 同样的地点，标题里塞满地名也不该影响判定
    assert.equal(eventRegion({ location: 'Berlin', title: 'Tokyo Seoul Austin Lima Rio' }), 'eu');
  });
});

describe('foldRegions', () => {
  test('低于阈值的小区并入大区，不再回写 regionRaw', () => {
    const events = Array.from({ length: 3 }, () => ({ region: 'japan' }));
    const out = foldRegions(events);
    assert.ok(
      out.every((e) => !('regionRaw' in e)),
      'T2.2 起不再写 regionRaw：页面不读，展示分组另有字典（S6.5）',
    );
  });

  test('空数组不抛错', () => {
    assert.deepEqual(foldRegions([]), []);
  });

  test('小区并入大区时只改 region（canada → other）', () => {
    const out = foldRegions([{ region: 'canada' }]);
    assert.equal(out[0].region, 'other');
    assert.ok(!('regionRaw' in out[0]), '不再透传源站的原始地区值');
  });

  test('F10：小国家归并不再做跨洲映射', () => {
    // ca / au 过去被并进 latam / asia —— 加拿大与澳洲都不属于任何跨洲大区，
    // 归并只能在同洲内做，否则筛选出来的「拉美」里会出现多伦多。
    const out = foldRegions([{ region: 'ca' }, { region: 'au' }]);
    assert.notEqual(out[0].region, 'latam', '加拿大不该被并进拉美');
    assert.notEqual(out[1].region, 'asia', '澳洲不该被并进亚洲');
  });
});

describe('devfolioIsAI / devfolioPrize', () => {
  test('主题是对象数组也能识别（themes 取 t.name）', () => {
    assert.equal(devfolioIsAI({ name: 'x', themes: [{ name: 'AI/ML' }, { name: 'Web3' }] }), true);
  });

  test('主题是字符串数组也能识别', () => {
    assert.equal(devfolioIsAI({ name: 'x', themes: ['Machine Learning'] }), true);
  });

  test('desc 超过 600 字后不再参与判定', () => {
    const long = `${'a'.repeat(700)} Artificial Intelligence`;
    assert.equal(devfolioIsAI({ name: 'x', desc: long }), false);
  });

  test('奖池按币种汇总并取最大币种', () => {
    const s = devfolioPrize([
      { amount: 1000, currency: 'USD' },
      { amount: 500, currency: 'USD' },
      { amount: 100, currency: 'INR' },
    ]);
    assert.match(s, /\$1,500/);
    assert.match(s, /2 种币种/);
  });

  test('没有有效奖池返回 null', () => {
    assert.equal(devfolioPrize([]), null);
    assert.equal(devfolioPrize([{ amount: 0 }]), null);
  });
});

describe('tierBranches / exprCoefficients / parseBillingExpr', () => {
  test('tierBranches 能取出嵌套括号内的分支体', () => {
    const branches = tierBranches('tier("base", p * 2 + c * 10 + cr * 0.1)');
    assert.equal(branches.length, 1);
    assert.equal(branches[0].name, 'base');
    assert.match(branches[0].body, /p \* 2/);
  });

  test('tierBranches 支持多分支', () => {
    const branches = tierBranches('tier("base", p * 2) + tier("long", p * 4 + c * 8)');
    assert.equal(branches.length, 2);
    assert.deepEqual(
      branches.map((b) => b.name),
      ['base', 'long'],
    );
  });

  test('exprCoefficients 解析 p / c / cr', () => {
    const co = exprCoefficients('p * 2 + c * 10 + cr * 0.1');
    assert.equal(co.p, 2);
    assert.equal(co.c, 10);
    assert.equal(co.cr, 0.1);
  });

  test('exprCoefficients 解析 fixed 与 u("seconds")', () => {
    assert.equal(exprCoefficients('fixed(0.02)').fixed, 0.02);
    assert.equal(exprCoefficients('u("seconds") * 0.0001').secs, 0.0001);
  });

  test('parseBillingExpr：真实事故 tier("base", p * 2 + c * 10 + cr * 0.1)', () => {
    const r = parseBillingExpr('tier("base", p * 2 + c * 10 + cr * 0.1)');
    assert.equal(r.kind, 'per_1m');
    assert.equal(r.input, 2);
    assert.equal(r.output, 10);
    assert.equal(r.cacheRead, 0.1);
    assert.equal(r.comp, 5);
    assert.equal(r.tier, 'base');
    assert.equal(r.via, 'expr');
  });

  test('parseBillingExpr：按次计费走 fixed', () => {
    const r = parseBillingExpr('tier("base", fixed(0.02))');
    assert.equal(r.kind, 'per_call');
    assert.equal(r.usd, 0.02);
  });

  test('parseBillingExpr：按秒计费', () => {
    const r = parseBillingExpr('tier("base", u("seconds") * 0.0001)');
    assert.equal(r.kind, 'per_unit');
    assert.equal(r.unit, 'second');
  });

  test('parseBillingExpr：无有效系数返回 null', () => {
    assert.equal(parseBillingExpr(''), null);
    assert.equal(parseBillingExpr(null), null);
    assert.equal(parseBillingExpr('tier("base", 1)'), null);
  });

  test('多 tier 时给出 branches 与 longContext', () => {
    const r = parseBillingExpr('tier("base", p * 2 + c * 10) + tier("long", p * 4 + c * 20)');
    assert.ok(Array.isArray(r.branches));
    assert.equal(r.branches.length, 2);
    assert.ok(r.longContext);
  });
});

describe('relayPrice', () => {
  test('表达式优先于 model_ratio（避免 75/75 这类自造的异常价）', () => {
    const row = {
      billing_expr: 'tier("base", p * 2 + c * 10)',
      model_ratio: 37.5,
      completion_ratio: 2,
    };
    const p = relayPrice(row, { name: 'default', ratio: 1 });
    assert.equal(p.via, 'expr');
    assert.equal(p.input, 2);
    assert.equal(p.output, 10);
  });

  test('model_ratio 乘以 2 与分组倍率', () => {
    const p = relayPrice({ model_ratio: 1, completion_ratio: 3 }, { name: 'default', ratio: 0.5 });
    assert.equal(p.via, 'ratio');
    assert.equal(p.input, 1); // 1 * 2 * 0.5
    assert.equal(p.output, 3); // 1 * 3 * 2 * 0.5
  });

  test('model_price 按次计价', () => {
    const p = relayPrice({ model_price: 0.05 }, { name: 'default', ratio: 1 });
    assert.equal(p.kind, 'per_call');
    assert.equal(p.usd, 0.05);
  });

  test('无效倍率返回 null', () => {
    assert.equal(relayPrice({}, null), null);
    assert.equal(relayPrice({ model_ratio: 0 }, null), null);
    assert.equal(relayPrice({ model_ratio: -1 }, null), null);
  });

  test('cache_ratio 折算缓存读价', () => {
    const p = relayPrice(
      { model_ratio: 2, completion_ratio: 2, cache_ratio: 0.5 },
      { name: 'd', ratio: 1 },
    );
    assert.equal(p.cacheRead, 2); // 2 * 0.5 * 2 * 1
  });
});

describe('groupRatioTable / rowGroups', () => {
  test('对象形式的分组表', () => {
    const t = groupRatioTable({ group_ratio: { default: 1, vip: 0.8 } });
    assert.deepEqual(t, { default: 1, vip: 0.8 });
  });

  test('数组形式的分组表', () => {
    const t = groupRatioTable({ group_ratio: [{ name: 'default', ratio: 1 }] });
    assert.deepEqual(t, { default: 1 });
  });

  test('非法倍率被丢弃，全非法返回 null', () => {
    assert.equal(groupRatioTable({ group_ratio: { a: 0, b: -1 } }), null);
    assert.equal(groupRatioTable({}), null);
  });

  test('有 default 组直接用 default 作代表分组', () => {
    const table = { default: 1, vip: 0.5 };
    const groups = rowGroups({ enable_groups: ['vip', 'default'] }, table);
    assert.equal(groups[0].name, 'default');
  });

  test('组名带「-1倍率」时按声明倍率选代表组（真实事故：GGWK）', () => {
    const table = { 'a全模型综合组-1倍率': 1, '纯Azure稳定无审核-0.6倍率': 0.6 };
    const groups = rowGroups(
      { enable_groups: ['a全模型综合组-1倍率', '纯Azure稳定无审核-0.6倍率'] },
      table,
    );
    assert.equal(groups[0].name, 'a全模型综合组-1倍率');
  });

  test('不回退到最便宜分组（避免用逆向渠道地板价冒充招牌价）', () => {
    const table = { 特殊逆向claude: 0.05, normal: 1 };
    const groups = rowGroups({ enable_groups: ['特殊逆向claude', 'normal'] }, table);
    assert.notEqual(groups[0].name, '特殊逆向claude');
  });

  test('没有 enable_groups 时回退 default', () => {
    const groups = rowGroups({}, { default: 1 });
    assert.equal(groups[0].name, 'default');
    assert.equal(groups[0].ratio, 1);
  });
});

describe('pickFlagship', () => {
  const flagship = {
    key: 'deepseekflash',
    label: 'DeepSeek V4.1 Flash',
    re: /deepseek[-_ ]?v?4[.-]?1[-_ ]?flash/i,
    official: [0.1408, 0.5634],
  };

  test('deepseek-flash 与 deepseek-v4-1-flash 不能混淆（真实事故）', () => {
    const rows = [
      { model_name: 'deepseek-flash', model_ratio: 37.5, completion_ratio: 2 },
      { model_name: 'deepseek-v4-1-flash', model_ratio: 0.0704, completion_ratio: 4 },
    ];
    const picked = pickFlagship(rows, flagship, { default: 1 });
    assert.equal(picked.row.model_name, 'deepseek-v4-1-flash');
  });

  test('没有匹配行返回 null', () => {
    assert.equal(pickFlagship([{ model_name: 'gpt-4' }], flagship, { default: 1 }), null);
  });

  test(':free 行被判为变体而排在基础版之后', () => {
    const rows = [
      { model_name: 'deepseek-v4-1-flash:free', model_ratio: 0, completion_ratio: 1 },
      { model_name: 'deepseek-v4-1-flash', model_ratio: 0.0704, completion_ratio: 4 },
    ];
    const picked = pickFlagship(rows, flagship, { default: 1 });
    assert.equal(picked.variant, false);
    assert.equal(picked.row.model_name, 'deepseek-v4-1-flash');
  });
});

describe('familyKey / band / per1M', () => {
  test('familyKey 去掉厂商前缀并把点换成连字符', () => {
    assert.equal(
      familyKey('anthropic', 'anthropic/claude-opus-5.5', 'X'),
      'anthropic::claude-opus-5-5',
    );
  });

  test('familyKey 去掉变体标记', () => {
    assert.equal(familyKey('x', 'x/model-preview', 'X'), 'x::model');
  });

  test(
    'F24：familyKey 未剥离 8 位日期尾巴，跨层对齐仍靠模糊匹配',
    { todo: 'F24：familyKey 未剥离 8 位日期尾巴，跨层对齐仍靠模糊匹配' },
    () => {
      assert.equal(
        familyKey('anthropic', 'anthropic/claude-opus-5.5-20260101', 'X'),
        familyKey('anthropic', 'anthropic/claude-opus-5-5', 'X'),
      );
    },
  );

  test('familyKey 去掉 :free', () => {
    assert.equal(familyKey('meta', 'meta/llama-4:free', 'Llama 4'), 'meta::llama-4');
  });

  test('band 分档边界', () => {
    assert.equal(band(null, true), 'free');
    assert.equal(band(null, false), 'unknown');
    assert.equal(band(0.1, false), 'budget');
    assert.equal(band(0.25, false), 'standard');
    assert.equal(band(1.5, false), 'premium');
  });

  test('per1M 换算与非法值', () => {
    assert.equal(per1M('0.000001'), 1);
    assert.equal(per1M(-1), null);
    assert.equal(per1M(''), null);
    assert.equal(per1M(null), null);
  });
});

describe('peakNote / effectiveCost', () => {
  test('没有 overrides 返回 null', () => {
    assert.equal(peakNote({ prompt: '0.000001' }), null);
  });

  test('有峰谷差异时给出区间与倍数', () => {
    const note = peakNote({
      prompt: '0.000001',
      overrides: [{ prompt: '0.000002', utc_days: [1, 2] }],
    });
    assert.equal(note.min, 1);
    assert.equal(note.max, 2);
    assert.equal(note.ratio, 2);
  });

  test('effectiveCost 对非 per_1m 返回 null', () => {
    assert.equal(effectiveCost({ kind: 'per_call', usd: 1 }), null);
    assert.equal(effectiveCost(null), null);
  });

  test('effectiveCost 按 agent 编程画像折算（h=0.7, s=0.3）', () => {
    // (1-s)*[(1-h-w)*input + h*cacheRead + w*cacheWrite] + s*output
    // (1-0.3)*[(1-0.7-0)*2 + 0.7*0.5 + 0*2] + 0.3*10 = 3.665
    assert.equal(effectiveCost({ kind: 'per_1m', input: 2, output: 10, cacheRead: 0.5 }), 3.665);
  });

  test('缺缓存价时按输入价处理（不虚构折扣）', () => {
    const withCache = effectiveCost({ kind: 'per_1m', input: 2, output: 10, cacheRead: 2 });
    const without = effectiveCost({ kind: 'per_1m', input: 2, output: 10 });
    assert.equal(without, withCache);
  });
});

describe('parseJsonLoose', () => {
  test('正常 JSON 直接解析', () => {
    assert.deepEqual(parseJsonLoose('{"a":1}'), { a: 1 });
  });

  test('容忍首尾空白与 BOM', () => {
    assert.deepEqual(parseJsonLoose('\ufeff {"a":1} '), { a: 1 });
  });

  test('非法 JSON 返回 null 而不是抛错', () => {
    assert.equal(parseJsonLoose('not json'), null);
    assert.equal(parseJsonLoose(''), null);
  });
});

describe('dedupeModels / dedupeOffers', () => {
  test('dedupeModels 按 id 去重并报告丢弃数', () => {
    const { rows, dropped } = dedupeModels([{ id: 'a' }, { id: 'a' }, { id: 'b' }]);
    assert.equal(rows.length, 2);
    assert.equal(dropped, 1);
  });

  test('dedupeModels 空数组', () => {
    assert.deepEqual(dedupeModels([]), { rows: [], dropped: 0 });
  });

  test('dedupeOffers 按产品 slug 合并并报告合并数', () => {
    const { rows, merged } = dedupeOffers([
      { product: 'Claude Pro' },
      { product: 'Claude Pro', entries: ['a'] },
      { product: 'GPT Plus' },
    ]);
    assert.equal(rows.length, 2);
    assert.equal(merged, 1);
  });

  test('dedupeOffers 子项与来源取并集', () => {
    const { rows } = dedupeOffers([
      { product: 'X', entries: ['a'], source: 's1' },
      { product: 'X', entries: ['a', 'b'], source: 's2' },
    ]);
    assert.deepEqual(rows[0].entries.sort(), ['a', 'b']);
    assert.deepEqual(rows[0].sources.sort(), ['s1', 's2']);
  });

  test('dedupeOffers 空数组', () => {
    assert.deepEqual(dedupeOffers([]), { rows: [], merged: 0 });
  });
});

describe('parseOpenRouter / normalizeOpenRouter', () => {
  test('parseOpenRouter 接受 HTML 文本，返回 {apps, models}', () => {
    const out = parseOpenRouter('<html><body><p>no tables here</p></body></html>');
    assert.deepEqual(Object.keys(out).sort(), ['apps', 'models']);
    assert.equal(out.apps.length, 0);
  });

  test('空 HTML 不抛错', () => {
    assert.doesNotThrow(() => parseOpenRouter(''));
  });
});
