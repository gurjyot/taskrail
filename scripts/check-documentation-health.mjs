#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const required = [
  'README.md',
  'AGENTS.md',
  'FRAMEWORK.md',
  'CHANGELOG.md',
  'docs/README.md',
  'docs/DOCUMENTATION_POLICY.md',
  'docs/diagnostics-and-security.md'
];

const issues = [];
for (const file of required) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) issues.push(`missing required documentation: ${file}`);
  else if (!fs.statSync(full).size) issues.push(`empty required documentation: ${file}`);
}

const docsRoot = path.join(root, 'docs');
const docsIndex = fs.existsSync(path.join(docsRoot, 'README.md'))
  ? fs.readFileSync(path.join(docsRoot, 'README.md'), 'utf8')
  : '';

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

for (const full of walk(docsRoot)) {
  const rel = path.relative(docsRoot, full).replaceAll(path.sep, '/');
  if (rel === 'README.md') continue;
  const base = path.basename(rel);
  const linked = docsIndex.includes(rel) || docsIndex.includes(base) || docsIndex.includes(`${path.dirname(rel)}/`);
  if (!linked) issues.push(`documentation not discoverable from docs/README.md: docs/${rel}`);
}

for (const file of ['README.md', 'AGENTS.md', 'FRAMEWORK.md', 'docs/README.md', 'docs/DOCUMENTATION_POLICY.md']) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  const text = fs.readFileSync(full, 'utf8');
  if (/TODO\s*:\s*documentation|DOCUMENTATION_TODO|docs?\s+TBD/i.test(text)) {
    issues.push(`unresolved documentation placeholder in ${file}`);
  }
}

const policy = path.join(docsRoot, 'DOCUMENTATION_POLICY.md');
if (fs.existsSync(policy)) {
  const text = fs.readFileSync(policy, 'utf8');
  for (const phrase of ['documentation is a maintained product surface', 'documentation diagnostics', 'new documentation']) {
    if (!text.toLowerCase().includes(phrase)) issues.push(`documentation policy missing governance phrase: ${phrase}`);
  }
}

if (issues.length) {
  console.error('DOCUMENTATION_DIAGNOSTICS FAIL');
  for (const issue of issues) console.error(`- ${issue}`);
  process.exit(1);
}

console.log(`DOCUMENTATION_DIAGNOSTICS PASS (${walk(docsRoot).length + 4} markdown surfaces checked)`);
