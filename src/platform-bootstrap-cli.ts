#!/usr/bin/env node

import { installPlatformAdapter, platformAdapterIsInstalled, readInstalledPlatform } from './platform-bootstrap.js';
import { TASKRAIL_VERSION } from './version.js';

const args = process.argv.slice(2);
const command = args[0] || 'install';
const bestEffort = args.includes('--best-effort');

async function main() {
  if (process.env.TASKRAIL_SKIP_PLATFORM_SETUP === '1') {
    console.log('TaskRail platform setup skipped by TASKRAIL_SKIP_PLATFORM_SETUP=1');
    return;
  }

  if (command === 'status') {
    const receipt = await readInstalledPlatform();
    console.log(JSON.stringify({ installed: await platformAdapterIsInstalled(), receipt }, null, 2));
    return;
  }

  if (command !== 'install') throw new Error('usage: taskrail-platform-bootstrap [install|status] [--best-effort]');
  const receipt = await installPlatformAdapter({
    version: TASKRAIL_VERSION,
    manifestFile: process.env.TASKRAIL_PLATFORM_MANIFEST_FILE,
  });
  console.log(`TaskRail platform adapter installed: ${receipt.platform} (${receipt.adapterId})`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (bestEffort) {
    console.warn(`TaskRail platform setup deferred: ${message}`);
    console.warn('Run `taskrail platform install` when GitHub is reachable.');
    return;
  }
  console.error(message);
  process.exitCode = 1;
});
