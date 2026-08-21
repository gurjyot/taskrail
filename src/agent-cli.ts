import { agentActions, authorizeAgentAction, mcpSecurityContract } from './agent-surface.js';

export async function runAgentCli(args = process.argv.slice(2)) {
  const subcommand = args[1] || 'describe';
  if (subcommand === 'describe') {
    console.log(JSON.stringify({ protocol: mcpSecurityContract(), actions: agentActions() }, null, 2));
    return;
  }
  if (subcommand === 'authorize') {
    const name = args[2];
    if (!name) {
      console.error('usage: taskrail agent authorize <action> [--write] [--control]');
      process.exitCode = 1;
      return;
    }
    const result = authorizeAgentAction(name, { allowWrite: args.includes('--write'), allowControl: args.includes('--control') });
    console.log(JSON.stringify(result, null, 2));
    if (!result.allowed) process.exitCode = 1;
    return;
  }
  console.error('usage: taskrail agent <describe|authorize>');
  process.exitCode = 1;
}
