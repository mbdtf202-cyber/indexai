/**
 * lib/news.js 的第一批用例（T0.1）。
 *
 * 这些用例锁定现有行为作为特征测试，不表达「应该怎样」。
 * 已知缺陷（F07 标题截断、F26 按人名扣分）以 todo 用例记录，
 * 由对应任务修好后再转正。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { classifyNews, scoreNews, newsImportance, retentionDays } from '../../lib/news.js';

describe('classifyNews', () => {
  test('价格类标题归到 price', () => {
    assert.equal(classifyNews('DeepSeek 宣布 API 降价 50%'), 'price');
  });

  test('融资类标题归到 funding', () => {
    assert.equal(classifyNews('Mistral 完成 30 亿欧元融资'), 'funding');
  });

  test('政策类标题归到 policy', () => {
    assert.equal(classifyNews('欧盟通过新的 AI 监管法案'), 'policy');
  });

  test('开源模型发布归到 model', () => {
    assert.equal(classifyNews('智谱开源 GLM-5.3 新模型'), 'model');
  });

  test('无关键词时归到 other', () => {
    assert.equal(classifyNews('一个普通的日子'), 'other');
  });

  test('空标题归到 other', () => {
    assert.equal(classifyNews(''), 'other');
  });

  test('只匹配标题，不匹配正文（优先顺序按 NEWS_TOPICS 声明）', () => {
    // 「降价」在 price 之前声明，所以同时含「降价」与「开源」时取 price
    assert.equal(classifyNews('开源模型降价'), 'price');
  });

  test('相同标题重复调用结果一致（缓存不改变结论）', () => {
    const title = 'OpenAI 发布 GPT-6 Astra 模型';
    const first = classifyNews(title);
    const second = classifyNews(title);
    assert.equal(first, second);
  });
});

describe('scoreNews', () => {
  test('价格类关键词加分', () => {
    const scored = scoreNews({ title: '模型降价', summary: '' });
    assert.ok(scored >= 5, `期望 >= 5，实际 ${scored}`);
  });

  test('开源发布加分', () => {
    const scored = scoreNews({ title: '开源权重模型', summary: '' });
    assert.ok(scored >= 4, `期望 >= 4，实际 ${scored}`);
  });

  test('长摘要额外加 1 分', () => {
    const short = scoreNews({ title: 'x', summary: '短' });
    const long = scoreNews({ title: 'x', summary: 'a'.repeat(80) });
    assert.equal(long - short, 1);
  });

  test('标题含负面人名扣分', () => {
    const neutral = scoreNews({ title: '某公司发布模型', summary: '' });
    const negative = scoreNews({ title: '马斯克发布模型', summary: '' });
    assert.ok(negative < neutral, '含扣分词应更低');
  });

  test('缺失 title 与 summary 不抛错', () => {
    assert.doesNotThrow(() => scoreNews({}));
  });

  test.todo('F26：不应按人名扣分（改为按主题相关性打分）', () => {
    // 修好后转为正式断言：含「马斯克」的 xAI 价格新闻不应被压低
  });
});

describe('newsImportance', () => {
  test('高分条目为 major', () => {
    assert.equal(newsImportance({ title: 'x', score: 8 }), 'major');
  });

  test('低分为 daily', () => {
    assert.equal(newsImportance({ title: 'x', score: 1 }), 'daily');
  });

  test('中等分数但标题含重要词为 major', () => {
    assert.equal(newsImportance({ title: '某公司获得融资', score: 4 }), 'major');
  });

  test('未提供 score 时会自行计算', () => {
    const result = newsImportance({ title: 'API 降价与免费额度', summary: '' });
    assert.equal(result, 'major');
  });
});

describe('retentionDays', () => {
  test('major 永久保留', () => {
    assert.equal(retentionDays({ im: 'major' }), Infinity);
  });

  test('daily 最低 30 天', () => {
    assert.equal(retentionDays({ im: 'daily', sc: 0 }), 30);
  });

  test('分数越高保留越久', () => {
    const low = retentionDays({ im: 'daily', sc: 1 });
    const high = retentionDays({ im: 'daily', sc: 5 });
    assert.ok(high > low);
  });

  test('有上限 365 天', () => {
    assert.equal(retentionDays({ im: 'daily', sc: 100 }), 365);
  });

  test('负数分数按 0 处理', () => {
    assert.equal(retentionDays({ im: 'daily', sc: -10 }), 30);
  });
});
