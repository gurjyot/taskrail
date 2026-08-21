#!/usr/bin/env node

const command = process.argv[2] || '--help';
const compositionCommands = new Set(['components', 'component', 'capability-find', 'capability-check', 'usage', 'update-plan', 'isolation-audit', 'init']);

if (compositionCommands.has(command)) {
  const { runCompositionCli } = await import('./composition-cli.js');
  await runCompositionCli(process.argv.slice(2));
} else {
  await import('./cli.js');
}
