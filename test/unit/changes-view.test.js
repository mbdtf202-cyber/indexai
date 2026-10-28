/**
 * Today's Changes Feed Tests (T6.2)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('changes view module', () => {
  test('changes view exists and exports correctly', async () => {
    const viewPath = 'site/views/changes.mjs';

    assert.ok(fs.existsSync(viewPath), `Changes view should exist at ${viewPath}`);

    const content = fs.readFileSync(viewPath, 'utf8');
    assert.ok(
      content.includes('export function renderChanges'),
      'Should export renderChanges function',
    );
    assert.ok(content.includes('change-item'), 'Should generate change items');
  });

  test('rendering handles empty data gracefully', async () => {
    const { renderChanges } = await import('../../site/views/changes.mjs');

    // Test with no changes
    let html = renderChanges();
    assert.ok(
      html.includes('No changes') || html.includes('no-changes'),
      'Should show empty state for no changes',
    );

    // Test with partial data
    html = renderChanges({ recentChanges: [] });
    assert.ok(
      html.includes('No changes') || html.includes('empty'),
      'Should handle empty array gracefully',
    );
  });
});
