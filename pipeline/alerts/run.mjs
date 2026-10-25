/**
 * Alert Runner - CI Integration (T4.2 Round 3)
 *
 * Orchestrates alert detection and issue creation within CI workflow
 */

import { loadLayerHistory, detectAlertDecision } from './detect.mjs';
import { handleAlertDecision } from './github.mjs';
import { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const DATA_STATUS_DIR = join(ROOT, '.data', 'status');

/**
 * Main entry point for alert runner
 */
export async function runAlertCheck(options = {}) {
  const { owner, repo, token, layers, dryRun = false } = options;

  // Load layer history or initialize fresh status files
  await ensureStatusDir();

  const results = [];

  for (const layer of layers || getAvailableLayers()) {
    try {
      console.log(`[alert] Checking layer: ${layer}`);

      const history = loadLayerHistory(layer);
      const decision = detectAlertDecision(history);

      if (decision.action !== 'none') {
        const alertInfo = {
          layer,
          firstBad: decision.firstBad?.timestamp || null,
          reason: decision.reason,
          status: decision.action === 'close' ? 'resolved' : decision.action,
        };

        if (dryRun) {
          console.log(
            `[alert DRYRUN] Would ${decision.action} for ${layer}:`,
            JSON.stringify(alertInfo, null, 2),
          );
          results.push({ layer, action: decision.action, dryRun: true });
        } else if (owner && repo && token) {
          const result = await handleAlertDecision({
            owner,
            repo,
            token,
            alertInfo,
            action: decision.action,
          });

          results.push({
            layer,
            ...decision,
            ...result,
            dryRun: false,
          });

          if (result.success) {
            console.log(
              `[alert ✓] ${decision.action.toUpperCase()} for ${layer}${result.issue_number ? ` #${result.issue_number}` : ''}`,
            );
          }
        } else {
          console.warn(
            `[alert ⚠] No action taken for ${layer}: missing credentials (owner/repo/token required)`,
          );
          results.push({ layer, action: decision.action, skip: true, reason: 'No credentials' });
        }
      }
    } catch (e) {
      console.error(`[alert ✖] Error checking ${layer}:`, e.message);
      results.push({ layer, error: e.message });
    }
  }

  return results;
}

/**
 * Ensure status directory exists
 */
async function ensureStatusDir() {
  if (!existsSync(DATA_STATUS_DIR)) {
    mkdirSync(DATA_STATUS_DIR, { recursive: true });
    console.log(`[alert] Created status directory: ${DATA_STATUS_DIR}`);
  }
}

/**
 * Get available layers from .data/status directory
 */
function getAvailableLayers() {
  if (!existsSync(DATA_STATUS_DIR)) return [];
  return readdirSync(DATA_STATUS_DIR)
    .filter((f) => f.endsWith('.ndjson'))
    .map((f) => f.replace('.ndjson', ''));
}

// CLI usage
if (process.argv[1]?.endsWith('run.mjs')) {
  const args = process.argv.slice(2);
  const options = {};

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') options.dryRun = true;
    if (args[i] === '--layers') options.layers = args[++i]?.split(',') || undefined;
    if (args[i] === '--owner') options.owner = args[++i];
    if (args[i] === '--repo') options.repo = args[++i];
    if (args[i] === '--token') options.token = args[++i];
  }

  const result = await runAlertCheck(options);
  console.log('\n[summary] Alert check complete:', JSON.stringify(result, null, 2));
}

export default { runAlertCheck, getAvailableLayers };
