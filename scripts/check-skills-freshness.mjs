import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const skillsRoot = path.join(root, 'skills');
const entries = await readdir(skillsRoot, { withFileTypes: true });
const skillDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();

if (skillDirs.length === 0) {
  console.error('No packaged TaskRail skills found.');
  process.exit(1);
}

const results = [];
for (const name of skillDirs) {
  const file = path.join(skillsRoot, name, 'SKILL.md');
  let content = '';
  try {
    content = await readFile(file, 'utf8');
  } catch (error) {
    results.push({ skill: name, ok: false, reviewedFor: null, error: `missing SKILL.md: ${error.code || error.message}` });
    continue;
  }

  const match = content.match(/^reviewed_for_taskrail:\s*["']?([^\s"']+)["']?\s*$/m);
  const reviewedFor = match?.[1] || null;
  results.push({
    skill: name,
    ok: reviewedFor === pkg.version,
    reviewedFor,
    expected: pkg.version,
  });
}

const ok = results.every((result) => result.ok);
const report = {
  schema: 1,
  taskrailVersion: pkg.version,
  skillCount: results.length,
  ok,
  results,
};

console.log(JSON.stringify(report, null, 2));
if (!ok) {
  console.error(`TaskRail skills are stale. Review every skills/*/SKILL.md and set reviewed_for_taskrail: ${pkg.version}.`);
  process.exitCode = 1;
}
