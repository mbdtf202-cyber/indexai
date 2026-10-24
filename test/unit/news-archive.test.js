/**
 * lib/news.mjs 第二批用例（T0.3）：摘要压缩、编码解码、归档合并。
 *
 * F07（标题截到 96 字且不加省略号）与 F08（情报只剩聚合站链接）
 * 以 todo 用例记录，本任务不修。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  squeezeSummary,
  encodeNews,
  decodeNews,
  parseNewsYaml,
  mergeArchive,
  archiveStats,
  buildIndex,
  retentionDays,
} from '../../lib/news.mjs';

describe('squeezeSummary', () => {
  test('去掉来源尾巴（🔗 / via AIHOT / 阅读原文）', () => {
    assert.equal(
      squeezeSummary('标题', '正文内容足够长的一句话。🔗 https://x').includes('🔗'),
      false,
    );
    assert.equal(
      squeezeSummary('标题', '正文内容足够长的一句话。 via AIHOT').includes('via AIHOT'),
      false,
    );
  });

  test('去掉开场套话', () => {
    const out = squeezeSummary('模型发布', '据报道，某公司今天发布了新模型。');
    assert.equal(out.startsWith('据报道'), false);
  });

  test('纯复述标题的句子被丢弃', () => {
    const title = 'OpenAI 发布 GPT-6 Astra 模型';
    const out = squeezeSummary(title, 'OpenAI 发布 GPT-6 Astra 模型。');
    assert.equal(out, '');
  });

  test('空摘要返回空字符串', () => {
    assert.equal(squeezeSummary('t', ''), '');
    assert.equal(squeezeSummary('t', null), '');
  });

  test('压缩结果不超过预算', () => {
    const long = '这是一段很长的摘要。'.repeat(40);
    const out = squeezeSummary('短标题', long);
    assert.ok(out.length <= 168, `实际长度 ${out.length}`);
  });

  test('标题越短，摘要预算越大', () => {
    const body = '每个句子都完全不同而且足够长来避免被当成复述。'.repeat(6);
    const short = squeezeSummary('短', body);
    const long = squeezeSummary('一个非常非常非常非常非常非常长的标题占用了大量预算空间', body);
    assert.ok(short.length >= long.length);
  });
});

describe('encodeNews / decodeNews', () => {
  const item = {
    url: 'https://example.com/a',
    title: '某公司发布新模型',
    date: '2026-10-24',
    time: '10:30',
    summary: '正文里有一句足够长的、与标题不重复的描述性内容。',
    score: 5,
  };

  test('编码出紧凑字段', () => {
    const enc = encodeNews(item);
    assert.equal(enc.u, item.url);
    assert.equal(enc.d, '2026-10-24');
    assert.equal(enc.tm, '10:30');
    assert.equal(enc.t, item.title);
    assert.equal(typeof enc.tp, 'number');
    assert.equal(enc.sc, 5);
  });

  test('没有 url 或 title 返回 null', () => {
    assert.equal(encodeNews({ title: 'x' }), null);
    assert.equal(encodeNews({ url: 'https://x' }), null);
  });

  test('编码解码往返保住关键字段', () => {
    const enc = encodeNews(item);
    const dec = decodeNews(enc);
    assert.equal(dec.url, item.url);
    assert.equal(dec.title, item.title);
    assert.equal(dec.date, item.date);
  });

  test('没有摘要时不写 s 字段', () => {
    const enc = encodeNews({ url: 'https://x/y', title: '标题', summary: '' });
    assert.equal('s' in enc, false);
  });

  test('非 8 位日期的 d 字段被安全处理', () => {
    const enc = encodeNews({ url: 'https://x/y', title: 't', date: '2026-10-24T10:00:00Z' });
    assert.equal(enc.d, '2026-10-24');
  });

  test('F07：超长标题不应被静默截断且不加省略号', { todo: 'F07 标题截到 96 字不省略' }, () => {
    const longTitle = '标'.repeat(200);
    const enc = encodeNews({ url: 'https://x/y', title: longTitle });
    assert.equal(enc.t.length, longTitle.length);
  });

  test('F07：超长 URL 不应被截断（会生成死链）', { todo: 'F07 URL 截到 168 字' }, () => {
    const longUrl = `https://example.com/${'a'.repeat(200)}`;
    const enc = encodeNews({ url: longUrl, title: 't' });
    assert.equal(enc.u, longUrl);
  });
});

describe('parseNewsYaml', () => {
  // 真实格式：每条以 "- date:" 开头，title / summary 可带引号，url 必须存在
  const yaml = [
    '- date: 2026-10-24',
    '  time: "10:30"',
    '  title: 第一条标题',
    '  url: https://x/1',
    '  summary: 第一段的摘要内容足够长。',
    '- date: 2026-10-23',
    '  title: 第二条标题',
    '  url: https://x/2',
  ].join('\n');

  test('从第二条开始解析（split 会吞掉首条，现状行为）', () => {
    const items = parseNewsYaml(yaml);
    assert.equal(items.length, 1);
    assert.equal(items[0].title, '第二条标题');
    assert.equal(items[0].date, '2026-10-23');
  });

  test('首条前补换行可完整解析全部条目', () => {
    const items = parseNewsYaml(`\n${yaml}`);
    assert.equal(items.length, 2);
    assert.equal(items[0].title, '第一条标题');
    assert.equal(items[0].date, '2026-10-24');
    assert.equal(items[0].time, '10:30');
  });

  test('F09 相关：格式以 "- date:" 开头才能识别（现状）', { todo: 'F09 首条丢失' }, () => {
    const items = parseNewsYaml(yaml);
    assert.equal(items.length, 2);
  });

  test('缺 url 的条目被跳过', () => {
    const items = parseNewsYaml('- date: 2026-10-24\n  title: 只有标题');
    assert.deepEqual(items, []);
  });

  test('带引号的 title 去掉引号与转义', () => {
    const items = parseNewsYaml(
      '\n- date: 2026-10-24\n  title: "他说\\"好\\""\n  url: https://x/1',
    );
    assert.equal(items.length, 1);
    assert.match(items[0].title, /他说"好"/);
  });

  test('空文本返回空数组', () => {
    assert.deepEqual(parseNewsYaml(''), []);
  });
});

describe('mergeArchive', () => {
  // fresh 是「抓取形态」：url / title / date；history 是「存档形态」：u / d / t
  const mk = (url, date) => ({ url, title: `title ${url}`, date, summary: '' });

  test('新条目并入归档（返回数组）', () => {
    const out = mergeArchive([], [mk('https://x/1', '2026-10-24')]);
    assert.ok(Array.isArray(out));
    assert.equal(out.length, 1);
  });

  test('同一 URL 不重复', () => {
    const first = mergeArchive([], [mk('https://x/1', '2026-10-24')]);
    const second = mergeArchive(first, [mk('https://x/1', '2026-10-25')]);
    assert.equal(second.length, 1);
  });

  test('结果按日期降序', () => {
    const out = mergeArchive(
      [],
      [mk('https://x/1', '2026-10-20'), mk('https://x/2', '2026-10-24')],
      { today: '2026-10-24' },
    );
    assert.equal(out[0].d, '2026-10-24');
  });

  test('预算上限生效', () => {
    const many = Array.from({ length: 20 }, (_, i) => mk(`https://x/${i}`, '2026-10-24'));
    const out = mergeArchive([], many, { budget: 5, today: '2026-10-24' });
    assert.ok(out.length <= 5);
  });

  test('空输入不抛错', () => {
    assert.doesNotThrow(() => mergeArchive([], []));
  });
});

describe('archiveStats', () => {
  test('统计条数、跨度与天数', () => {
    const archive = [
      { u: 'https://x/1', d: '2026-10-20', im: 'daily' },
      { u: 'https://x/2', d: '2026-10-24', im: 'major' },
    ];
    const s = archiveStats(archive, '2026-10-24');
    assert.equal(s.n, 2);
    assert.ok(s.spanDays >= 4);
  });

  test('空归档不抛错', () => {
    assert.doesNotThrow(() => archiveStats([], '2026-10-24'));
  });
});

describe('buildIndex', () => {
  const archive = [
    { u: 'https://x/1', d: '2026-10-24', t: '今日', sc: 9, im: 'major', tp: 0 },
    { u: 'https://x/2', d: '2026-10-20', t: '稍旧', sc: 1, im: 'daily', tp: 1 },
  ];

  test('索引含今日与近期条目', () => {
    const idx = buildIndex(archive, { today: '2026-10-24', days: 7 });
    assert.ok(idx);
    assert.equal(typeof idx, 'object');
  });

  test('空归档不抛错', () => {
    assert.doesNotThrow(() => buildIndex([], { today: '2026-10-24' }));
  });
});

describe('retentionDays（补充）', () => {
  test('importance 字段别名也能识别', () => {
    assert.equal(retentionDays({ importance: 'major' }), Infinity);
  });

  test('缺字段时按 daily 下限处理', () => {
    assert.equal(retentionDays({}), 30);
  });
});
