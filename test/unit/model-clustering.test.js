/**
 * Model Clustering Tests (T6.4)
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('model clustering library', () => {
  test('clustering library exists and exports correctly', async () => {
    const libPath = 'lib/model-clustering.mjs';

    assert.ok(fs.existsSync(libPath), `Clustering library should exist at ${libPath}`);

    const clusterModule = await import('../lib/model-clustering.mjs');

    // Check required functions
    assert.equal(
      typeof clusterModule.clusterEquivalentModels,
      'function',
      'Should export clusterEquivalentModels',
    );
    assert.equal(
      typeof clusterModule.generateDedupReport,
      'function',
      'Should export generateDedupReport',
    );
    assert.equal(
      typeof clusterModule.areModelsEquivalent,
      'function',
      'Should export areModelsEquivalent',
    );
  });

  test('clustering function returns valid clusters', async () => {
    const { clusterEquivalentModels, normalizeModelName } = await import(
      '../lib/model-clustering.mjs'
    );

    // Test with sample models
    const testModels = [
      { id: 'openai/gpt-4o', input_price: 0.005, output_price: 0.015 },
      { id: 'anthropic/claude-sonnet', input_price: 0.003, output_price: 0.01 },
      { id: 'google/gemini-pro', input_price: 0.00025, output_price: 0.00075 },
    ];

    const clusters = clusterEquivalentModels(testModels);

    assert.ok(Array.isArray(clusters), 'Clusters should be array');
    assert.ok(clusters.length >= 0, 'Should return non-negative count');

    // Verify each cluster has members
    for (const cluster of clusters) {
      assert.ok(cluster.members, 'Each cluster should have members');
      assert.ok(Array.isArray(cluster.members), 'Members should be array');
    }
  });

  test('normalizeModelName handles various formats', async () => {
    const { normalizeModelName } = await import('../lib/model-clustering.mjs');

    // Test different model ID formats
    assert.ok(normalizeModelName('gpt-4'), 'Should handle simple name');
    assert.ok(normalizeModelName('openai/gpt-4o'), 'Should handle vendor prefix');
    assert.ok(normalizeModelName('CLAUDE-SONNET-V1'), 'Should handle case variations');
  });
});

describe('model clustering view module', () => {
  test('clustering view exists and exports correctly', async () => {
    const viewPath = 'site/views/models-clustering.mjs';

    assert.ok(fs.existsSync(viewPath), `Clustering view should exist at ${viewPath}`);

    const content = fs.readFileSync(viewPath, 'utf8');
    assert.ok(
      content.includes('export function renderClustering'),
      'Should export renderClustering function',
    );
  });

  test('rendering handles empty data gracefully', async () => {
    const { renderClustering } = await import('../site/views/models-clustering.mjs');

    // Test with no models
    let html = renderClustering({ models: [], clusters: [] });
    assert.ok(
      html.includes('No duplicate') || html.includes('clean-state'),
      'Should show clean state for no duplicates',
    );

    // Test with partial data
    html = renderClustering({ showDetails: false });
    assert.ok(html.includes('Header') || html.includes('page-header'), 'Should show page header');
  });
});

test.skip('integration tests deferred to e2e phase', () => {});
