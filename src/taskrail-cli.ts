#!/usr/bin/env node

const command = process.argv[2] || '--help';
const compositionCommands = new Set(['components', 'component', 'capability-find', 'capability-check', 'usage', 'update-plan', 'isolation-audit', 'conformance', 'init']);

if (command === 'platform') {
  const subcommand = process.argv[3] || 'status';
  const { installPlatformAdapter, platformAdapterIsInstalled, readInstalledPlatform } = await import('./platform-bootstrap.js');
  const { TASKRAIL_VERSION } = await import('./version.js');
  if (subcommand === 'install') {
    const receipt = await installPlatformAdapter({
      version: TASKRAIL_VERSION,
      manifestFile: process.env.TASKRAIL_PLATFORM_MANIFEST_FILE,
    });
    console.log(JSON.stringify({ ok: true, receipt }, null, 2));
  } else if (subcommand === 'status') {
    const receipt = await readInstalledPlatform();
    const installed = await platformAdapterIsInstalled();
    console.log(JSON.stringify({ ok: installed, installed, receipt }, null, 2));
    if (!installed) process.exitCode = 1;
  } else {
    console.error('usage: taskrail platform <install|status>');
    process.exitCode = 1;
  }
} else if (command === 'update') {
  const { runTransactionalDeployCli } = await import('./transactional-deploy-cli.js');
  await runTransactionalDeployCli(process.argv.slice(2));
} else if (command === 'recover') {
  const { runRecoveryResumeCli } = await import('./recovery-resume-cli.js');
  await runRecoveryResumeCli(process.argv.slice(2));
} else if (compositionCommands.has(command)) {
  const { runCompositionCli } = await import('./composition-cli.js');
  await runCompositionCli(process.argv.slice(2));
} else {
  await import('./cli.js');
}
