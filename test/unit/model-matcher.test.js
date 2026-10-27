/**
 * 模型表的结构校验（T4.5 · S6.2）。
 *
 * 匹配行为在 `match.test.js` 里测；这里只管「表长什么样」——
 * 字段齐备、id 规范、别名按源分组。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { loadModels } from '../../lib/match.js';

describe('registry/models.json 结构', () => {
  test('文件存在且是合法 JSON', () => {
    const raw = JSON.parse(readFileSync('registry/models.json', 'utf8'));
    assert.ok(Array.isArray(raw.models), '要有 models 数组');
    assert.ok(raw.models.length >= 5, '至少 5 个实体');
  });

  test('每个实体有 id / name / vendor', () => {
    const { models } = loadModels();
    for (const m of models) {
      assert.ok(m.id, 'Model 必须有 id');
      assert.ok(m.name, `Model ${m.id} 必须有 name`);
      assert.ok(m.vendor, `Model ${m.id} 必须有 vendor`);
    }
  });

  test('别名按源分组（对象而不是数组）', () => {
    const { models } = loadModels();
    for (const m of models) {
      if (m.aliases == null) continue;
      assert.equal(typeof m.aliases, 'object', `${m.id} 的 aliases 应当是对象`);
      assert.equal(Array.isArray(m.aliases), false, `${m.id} 的 aliases 不该是数组（要按源分组）`);

      for (const [kind, list] of Object.entries(m.aliases)) {
        const arr = Array.isArray(list) ? list : [list];
        for (const a of arr) {
          assert.equal(typeof a, 'string', `${m.id}.aliases.${kind} 里应当全是字符串`);
        }
      }
    }
  });

  test('推理档位挂在父模型的 variants 下（不建独立实体）', () => {
    const { models } = loadModels();
    const withVariants = models.filter((m) => Array.isArray(m.variants) && m.variants.length);
    for (const m of withVariants) {
      assert.equal(
        models.some((x) => x.id === `${m.id}-thinking`),
        false,
        `${m.id} 的变体不该同时是独立实体`,
      );
    }
  });

  test('表可以加载成索引（byAlias / byNorm）', () => {
    const { byAlias, byNorm } = loadModels();
    assert.ok(byAlias instanceof Map);
    assert.ok(byNorm instanceof Map);
    assert.ok(byAlias.size >= 5);
  });
});
