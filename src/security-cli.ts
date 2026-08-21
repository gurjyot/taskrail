import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { auditSourceSecurity, securityPrinciples } from './security.js';

const ignored = new Set(['.git', 'node_modules', 'dist', 'release-install', '.taskrail']);
const extensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.php', '.sh', '.ps1']);

function flagValue(args: string[], flag: string) {
  const index = args.indexOf(flag);
  return index >= 0 && args[index + 1] ? args[index + 1] : undefined;
}

async function collect(root: string) {
  const files: string[] = [];
  async function walk(current: string) {
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(target);
      else if (extensions.has(path.extname(entry.name).toLowerCase())) files.push(target);
    }
  }
  await walk(root);
  return files.sort();
}

export async function runSecurityCli(args = process.argv.slice(2)) {
  const subcommand = args[1] || 'audit';
  if (subcommand === 'principles') {
    console.log(JSON.stringify(securityPrinciples(), null, 2));
    return;
  }
  if (subcommand !== 'audit') {
    console.error('usage: taskrail security <audit|principles> [--strict] [--root <dir>]');
    process.exitCode = 1;
    return;
  }
  const root = path.resolve(process.cwd(), flagValue(args, '--root') || '.');
  const files = await collect(root);
  const report = await auditSourceSecurity(files, args.includes('--strict'));
  console.log(JSON.stringify({ ...report, root, filesScanned: files.length }, null, 2));
  if (!report.ok) process.exitCode = 1;
}
