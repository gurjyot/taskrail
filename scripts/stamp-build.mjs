import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
let revision = null;
try {
  revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch { /* Source archives retain an explicit unknown revision. */ }
await writeFile(new URL('../dist/src/build-info.json', import.meta.url), `${JSON.stringify({ revision })}\n`);
