export type FaultScenarioName =
  | 'network-interruption'
  | 'checksum-corruption'
  | 'permission-denied'
  | 'disk-full'
  | 'process-kill'
  | 'stale-lock'
  | 'state-corruption'
  | 'rollback-interruption';

export interface FaultScenario {
  name: FaultScenarioName;
  run: () => Promise<void>;
}

export interface FaultResult {
  name: FaultScenarioName;
  ok: boolean;
  error?: string;
}

export async function runFaultScenarios(scenarios: FaultScenario[], timeoutMs = 30_000): Promise<FaultResult[]> {
  const results: FaultResult[] = [];
  for (const scenario of scenarios) {
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        scenario.run(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`fault scenario timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
      results.push({ name: scenario.name, ok: true });
    } catch (error) {
      results.push({ name: scenario.name, ok: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return results;
}

export function faultGatePassed(results: FaultResult[]) {
  return results.length > 0 && results.every((result) => result.ok);
}
