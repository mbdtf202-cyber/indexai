/**
 * 模型实体匹配（T4.5 · S6.2 / S6.3 · F24）。
 *
 * ## F24 的教训
 *
 * 散点图与中转站旗舰曾经用前缀匹配找对应模型：
 * `bnorm(m.name).startsWith(key)`。
 * - `Claude Sonnet 5` → 匹配到 `Claude Sonnet 5.5`
 * - `GPT-6` → 匹配到 `GPT-6.1 Sol`
 *
 * 图上那个点看着像对的，其实是另一个模型的数据。**比未匹配更糟**：
 * 未匹配至少显示「—」，读者知道缺数据；错匹配是安静地说错话。
 *
 * ## 三级规则（S6.3）
 *
 * 精确别名 → 归一后精确相等 → 未匹配。没有第四级。
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeModelName,
  splitVariant,
  loadModels,
  matchModel,
  matchMany,
  modelForEntity,
  resetModelCache,
  VARIANT_MARKERS,
} from '../../lib/match.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

before(() => resetModelCache());

describe('归一：不做任何截断', () => {
  test('小写、去厂商前缀、统一分隔符', () => {
    assert.equal(normalizeModelName('Anthropic/Claude Opus 5.5'), 'claude-opus-5-5');
    assert.equal(normalizeModelName('openai/gpt-6.1-sol'), 'gpt-6-1-sol');
  });

  test('不做前缀裁剪（F24 的关键）', () => {
    // 归一后仍是完整名字，不是某种「前缀」
    assert.equal(normalizeModelName('Claude Sonnet 5.5'), 'claude-sonnet-5-5');
    assert.notEqual(normalizeModelName('Claude Sonnet 5.5'), normalizeModelName('Claude Sonnet 5'));
  });

  test('空值与异常输入不炸', () => {
    assert.equal(normalizeModelName(''), '');
    assert.equal(normalizeModelName(null), '');
  });
});

describe('变体：只切末尾的档位标记', () => {
  test('thinking 结尾被切成变体', () => {
    assert.deepEqual(splitVariant('claude-opus-5.5-thinking'), {
      parent: 'claude-opus-5-5',
      variant: 'thinking',
    });
  });

  test('不收 max / high / medium（它们是模型名的一部分）', () => {
    for (const name of ['qwen3.8-max', 'mistral-medium-3-5', 'gpt-6-high']) {
      assert.equal(splitVariant(name), null, `${name} 不该被当变体`);
    }
  });

  test('中间的标记不切（thinking-machines 是厂商名）', () => {
    assert.equal(splitVariant('thinking-machines/model-x'), null);
  });

  test('标记表只含明确的推理档词', () => {
    for (const bad of ['max', 'high', 'low', 'medium']) {
      assert.equal(VARIANT_MARKERS.includes(bad), false, `${bad} 不该在标记表里`);
    }
  });
});

/* ────────────────────────── 三条路径 ────────────────────────── */

describe('匹配：三条路径（验收）', () => {
  let dir;
  const TABLE = {
    schema: 'registry.models/v1',
    models: [
      {
        id: 'anthropic/claude-opus-5-5',
        name: 'Claude Opus 5.5',
        vendor: 'Anthropic',
        aliases: { openrouter: ['anthropic/claude-opus-5.5'], official: ['claude-opus-5-5'] },
        variants: ['thinking'],
      },
      {
        id: 'openai/gpt-6-1-sol',
        name: 'GPT-6.1 Sol',
        vendor: 'OpenAI',
        aliases: { openrouter: ['openai/gpt-6.1-sol'] },
      },
    ],
  };

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'indexai-models-'));
    writeFileSync(join(dir, 'models.json'), JSON.stringify(TABLE));
  });

  test('路径 1：精确别名命中', () => {
    const r = matchModel('anthropic/claude-opus-5.5', { path: join(dir, 'models.json') });
    assert.equal(r.matched, true);
    assert.equal(r.via, 'alias');
    assert.equal(r.id, 'anthropic/claude-opus-5-5');
  });

  test('路径 2：归一后精确相等', () => {
    /* 用「大小写与分隔符不同、但不是登记别名」的写法，
     * 才会真的走到第二级。`Claude Opus 5.5` 恰好就是注册的 name，
     * 走别名是对的。 */
    const r = matchModel('claude_opus 5.5', { path: join(dir, 'models.json') });
    assert.equal(r.matched, true);
    assert.equal(r.via, 'normalized');
  });

  test('路径 3：未匹配，不猜', () => {
    const r = matchModel('totally-unheard-of-model', { path: join(dir, 'models.json') });
    assert.equal(r.matched, false);
    assert.equal(r.via, 'none');
    assert.equal(r.id, null);
  });

  test('F24 回归：GPT-6 不会匹配到 GPT-6.1 Sol', () => {
    const r = matchModel('GPT-6', { path: join(dir, 'models.json') });
    assert.equal(r.matched, false, '前缀匹配会把 GPT-6 认成 GPT-6.1 Sol，这里必须不匹配');
  });

  test('F24 回归：Claude Opus 5 不会匹配到 5.5', () => {
    const r = matchModel('claude-opus-5', { path: join(dir, 'models.json') });
    assert.equal(r.matched, false);
  });

  test('变体：挂到父模型并标 variant', () => {
    const r = matchModel('claude-opus-5.5-thinking', { path: join(dir, 'models.json') });
    assert.equal(r.matched, true);
    assert.equal(r.id, 'anthropic/claude-opus-5-5');
    assert.equal(r.variant, 'thinking');
  });

  test('父模型不存在时变体不匹配', () => {
    const r = matchModel('nonexistent-model-thinking', { path: join(dir, 'models.json') });
    assert.equal(r.matched, false);
  });

  test('大小写不敏感', () => {
    const r = matchModel('CLAUDE OPUS 5.5', { path: join(dir, 'models.json') });
    assert.equal(r.matched, true);
  });

  test('matchMany 汇总命中与未命中', () => {
    const r = matchMany(['Claude Opus 5.5', 'fake-1', 'gpt-6.1-sol', 'fake-2'], {
      path: join(dir, 'models.json'),
    });
    assert.equal(r.matched.length, 2);
    assert.deepEqual(r.unmatched, ['fake-1', 'fake-2']);
  });

  test('matchMany 按实体 id 分组（变体归到同一 id）', () => {
    const r = matchMany(['claude-opus-5.5', 'claude-opus-5.5-thinking'], {
      path: join(dir, 'models.json'),
    });
    assert.equal(r.byId.size, 1, '两个名字都是同一个实体');
    assert.equal(r.byId.get('anthropic/claude-opus-5-5').length, 2);
  });

  test('modelForEntity 用实体 id 找行', () => {
    const pool = [
      { id: 'anthropic/claude-opus-5-5', name: 'Claude Opus 5.5' },
      { id: 'openai/gpt-6-1-sol', name: 'GPT-6.1 Sol' },
    ];
    const hit = modelForEntity('Claude Opus 5.5', pool, { path: join(dir, 'models.json') });
    assert.equal(hit.id, 'anthropic/claude-opus-5-5');
    assert.equal(modelForEntity('nonexistent', pool, { path: join(dir, 'models.json') }), null);
  });
});

/* ────────────────────────── 真表 ────────────────────────── */

describe('registry/models.json（S6.2）', () => {
  test('文件存在且结构正确', () => {
    const reg = JSON.parse(readFileSync(join(ROOT, 'registry', 'models.json'), 'utf8'));
    assert.equal(reg.schema, 'registry.models/v1');
    assert.ok(Array.isArray(reg.models) && reg.models.length > 0);
  });

  test('每个实体有规范 id（vendor/model 形式）', () => {
    const { models } = loadModels();
    for (const m of models) {
      assert.match(
        m.id,
        /^[a-z0-9_-]+\/[a-z0-9._:-]+$/,
        `${m.id} 不是 vendor/model 形式（允许 :batch 这类后缀）`,
      );
      assert.ok(m.name, `${m.id} 缺显示名`);
      assert.ok(m.vendor, `${m.id} 缺厂商`);
    }
  });

  test('实体 id 唯一', () => {
    const { models } = loadModels();
    const ids = models.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('别名只收精确写法，不做机器猜测', () => {
    const { models } = loadModels();
    for (const m of models) {
      for (const group of Object.values(m.aliases || {})) {
        for (const a of Array.isArray(group) ? group : [group]) {
          // 别名里不该出现通配或「前缀 + *」
          assert.equal(/[*?]/.test(a), false, `${m.id} 的别名 ${a} 含通配符`);
        }
      }
    }
  });

  test('真表里能匹配到大部分模型名', () => {
    const { models } = loadModels();
    const names = models.slice(0, 50).map((m) => m.id);
    const r = matchMany(names);
    assert.equal(r.unmatched.length, 0, `自己表里的 id 应当全部能匹配：${r.unmatched.join(', ')}`);
  });
});

/* ────────────────────────── 页面不再有前缀匹配 ────────────────────────── */

describe('页面里检索不到前缀匹配（验收）', () => {
  test('index.html 里没有 startsWith 形式的模型匹配', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

    // 只查真正的代码，不查注释
    const code = html
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\s*\/\/.*$/gm, '');

    assert.equal(
      /startsWith\s*\(\s*(?:bnorm|normalizeModelName)/.test(code),
      false,
      '页面里不该再有前缀匹配（F24）',
    );
    assert.equal(/bnorm\s*\(/.test(code), false, 'bnorm 应当已经删掉');
  });

  test('页面内联的归一与 lib 同口径', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    assert.match(
      html,
      /function normalizeModelName\(name\)/,
      '页面要内联一份（浏览器不能 import Node 模块）',
    );
    assert.match(html, /VARIANT_MARKERS\s*=/, '变体标记表也要内联');
  });
});
