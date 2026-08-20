export interface IdempotencyRecord {
  key: string;
  scope: string;
  createdAt: string;
}

export function idempotencyKey(scope: string, parts: Array<string | number | boolean>): string {
  return [scope, ...parts.map(String)].join('::');
}
