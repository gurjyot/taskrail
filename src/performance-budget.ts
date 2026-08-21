export interface PerformanceBudget {
  maxCompressedBytes?: number;
  maxUnpackedBytes?: number;
  maxStartupMs?: number;
  maxValidationMs?: number;
  maxMemoryMb?: number;
}

export interface PerformanceMeasurement {
  compressedBytes?: number;
  unpackedBytes?: number;
  startupMs?: number;
  validationMs?: number;
  memoryMb?: number;
}

export interface PerformanceViolation {
  metric: keyof PerformanceMeasurement;
  actual: number;
  limit: number;
}

export const DEFAULT_PERFORMANCE_BUDGET: PerformanceBudget = Object.freeze({
  maxCompressedBytes: 512 * 1024,
  maxUnpackedBytes: 2 * 1024 * 1024,
  maxStartupMs: 1000,
  maxValidationMs: 5000,
  maxMemoryMb: 128,
});

export function assessPerformanceBudget(measurement: PerformanceMeasurement, budget: PerformanceBudget = DEFAULT_PERFORMANCE_BUDGET) {
  const violations: PerformanceViolation[] = [];
  const check = (metric: keyof PerformanceMeasurement, actual: number | undefined, limit: number | undefined) => {
    if (actual == null || limit == null) return;
    if (actual > limit) violations.push({ metric, actual, limit });
  };
  check('compressedBytes', measurement.compressedBytes, budget.maxCompressedBytes);
  check('unpackedBytes', measurement.unpackedBytes, budget.maxUnpackedBytes);
  check('startupMs', measurement.startupMs, budget.maxStartupMs);
  check('validationMs', measurement.validationMs, budget.maxValidationMs);
  check('memoryMb', measurement.memoryMb, budget.maxMemoryMb);
  return { ok: violations.length === 0, violations };
}
