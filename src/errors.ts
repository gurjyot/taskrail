import { TASKRAIL_VERSION } from './version.js';
import type { FailureReport } from './types.js';

export function buildFailureReport(report: FailureReport): string {
  return JSON.stringify({ version: TASKRAIL_VERSION, ...report });
}
