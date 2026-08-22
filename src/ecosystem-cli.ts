import path from 'node:path';
import { loadEcosystemConfig, verifyEcosystem } from './ecosystem.js';

function argValue(args: string[], name: string) { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; }

export async function runEcosystemCli(args = process.argv.slice(2)) {
  const subcommand = args[1] || 'verify';
  if (subcommand === '--help' || subcommand === 'help') { console.log('taskrail ecosystem verify [--config taskrail.ecosystem.json] [--strict] [--json]'); return; }
  if (subcommand !== 'verify') { console.error('usage: taskrail ecosystem verify [--config path] [--strict] [--json]'); process.exitCode = 1; return; }
  const configPath = path.resolve(process.cwd(), argValue(args, '--config') || 'taskrail.ecosystem.json');
  const config = await loadEcosystemConfig(configPath);
  const result = await verifyEcosystem(config, { cwd: path.dirname(configPath), strict: args.includes('--strict') });
  if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`STATUS: ${result.ok ? 'PASS' : 'FAIL'}`);
    console.log(`TASKRAIL: ${result.taskrailVersion}`);
    for (const repo of result.repositories) {
      console.log(`${repo.ok ? 'PASS' : 'FAIL'} ${repo.name} publications=${repo.publications} commands=${repo.commands.filter((item) => item.ok).length}/${repo.commands.length}`);
      for (const warning of repo.warnings) console.log(`WARN ${repo.name}: ${warning}`);
      for (const error of repo.errors) console.log(`ERROR ${repo.name}: ${error}`);
    }
  }
  if (!result.ok) process.exitCode = 1;
}
