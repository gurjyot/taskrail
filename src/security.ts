import { readFile } from 'node:fs/promises';

const patterns = [
  /api[_-]?key/i,
  /bearer\s+[A-Za-z0-9._-]{16,}/i,
  /bot[a-z0-9]{6,}:[A-Za-z0-9_-]{20,}/i,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
];

export async function scanForSecrets(files: string[]): Promise<string[]> {
  const hits: string[] = [];
  for (const file of files) {
    const text = await readFile(file, 'utf8').catch(() => '');
    if (text.includes('=.env')) hits.push(`${file}: embedded env reference`);
    for (const pattern of patterns) if (pattern.test(text)) hits.push(`${file}: likely secret pattern`);
  }
  return hits;
}
