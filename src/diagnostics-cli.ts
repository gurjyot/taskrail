import { createDiagnosticReport, diagnosticSystemSummary } from './diagnostics.js';

function value(args: string[], flag: string) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export async function runDiagnosticsCli(args = process.argv.slice(2)) {
  const subcommand = args[1] || 'preview';
  if (subcommand !== 'preview') {
    console.error('usage: taskrail diagnostics preview --code <code> --stage <stage> --message <message> [--severity <level>]');
    process.exitCode = 1;
    return;
  }
  const code = value(args, '--code') || 'MANUAL_DIAGNOSTIC';
  const stage = value(args, '--stage') || 'unknown';
  const message = value(args, '--message') || 'No message supplied.';
  const severity = value(args, '--severity') || 'error';
  if (!['info', 'warning', 'error', 'critical'].includes(severity)) throw new Error(`invalid diagnostic severity: ${severity}`);
  const report = createDiagnosticReport({ code, stage, message, severity: severity as any, details: diagnosticSystemSummary() });
  console.log(JSON.stringify({
    notice: 'LOCAL PREVIEW ONLY. TaskRail does not submit diagnostics automatically.',
    report,
  }, null, 2));
}
