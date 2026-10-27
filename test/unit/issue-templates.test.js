/**
 * T6.10：GitHub issue forms 的结构校验。
 *
 * 不引入 YAML 依赖：这三个模板只需要顶层字段、body 元素类型与必填项，
 * 用逐行结构检查就足以挡住「GitHub 打不开表单」这类错误。
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, '..', '..', '.github', 'ISSUE_TEMPLATE');
const ALLOWED = new Set(['markdown', 'input', 'textarea', 'dropdown', 'checkboxes']);

function parseTemplate(text) {
  const top = {};
  for (const key of ['name', 'description', 'title']) {
    const m = text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
    if (m) top[key] = m[1].trim();
  }
  const bodyStart = text.indexOf('\nbody:');
  const bodyText = bodyStart >= 0 ? text.slice(bodyStart) : '';
  const chunks = bodyText.split(/\n  - type:\s*/).slice(1);
  const body = chunks.map((chunk) => {
    const type = chunk.slice(0, chunk.indexOf('\n')).trim();
    const id = (chunk.match(/\n    id:\s*(.+)/) || [])[1]?.trim();
    return { type, id, chunk };
  });
  return { top, body };
}

describe('GitHub issue forms', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.yml'));

  test('三个模板齐全', () => {
    assert.deepEqual(files.sort(), ['report.yml', 'submit-offer.yml', 'submit-tool.yml']);
  });

  for (const file of files) {
    test(`${file} 有 name / description / body，元素类型合法`, () => {
      const { top, body } = parseTemplate(readFileSync(join(DIR, file), 'utf8'));
      assert.ok(top.name, '缺 name');
      assert.ok(top.description, '缺 description');
      assert.ok(body.length >= 2, `body 只有 ${body.length} 个元素`);
      const ids = [];
      for (const item of body) {
        assert.ok(ALLOWED.has(item.type), `非法 type：${item.type}`);
        if (item.type !== 'markdown') {
          assert.ok(item.id, `${item.type} 缺 id`);
          ids.push(item.id);
        }
      }
      assert.equal(new Set(ids).size, ids.length, '元素 id 重复');
    });
  }

  test('report.yml 带 record_id 与 source 字段并必填 record_id', () => {
    const { body } = parseTemplate(readFileSync(join(DIR, 'report.yml'), 'utf8'));
    const record = body.find((x) => x.id === 'record_id');
    assert.ok(record, '缺 record_id');
    assert.match(record.chunk, /required:\s*true/);
    assert.ok(
      body.some((x) => x.id === 'source'),
      '缺 source',
    );
  });
});
