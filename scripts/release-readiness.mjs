import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const checks = [];
const add = (name, ok, detail = '') => checks.push({ name, ok, detail });
const exists = async (file) => access(path.join(root, file)).then(() => true, () => false);

const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const versionSource = await readFile(path.join(root, 'src', 'version.ts'), 'utf8');
const versionMatch = versionSource.match(/TASKRAIL_VERSION\s*=\s*['"]([^'"]+)['"]/);
const platformManifest = JSON.parse(await readFile(path.join(root, 'platform-install', 'manifest.json'), 'utf8'));
const readme = await readFile(path.join(root, 'README.md'), 'utf8');
const architecture = await readFile(path.join(root, 'docs', 'taskrail-3-reliability-architecture.md'), 'utf8');

add('version:package-source', versionMatch?.[1] === pkg.version, `${pkg.version} / ${versionMatch?.[1] || 'missing'}`);
add('version:platform-manifest', platformManifest.taskrailVersion === pkg.version, `${pkg.version} / ${platformManifest.taskrailVersion}`);
add('runtime-dependencies:none', !pkg.dependencies || Object.keys(pkg.dependencies).length === 0, String(Object.keys(pkg.dependencies || {}).length));
add('package:platform-assets-excluded', !pkg.files?.some((item) => String(item).startsWith('platform-install') || String(item).startsWith('installers')), JSON.stringify(pkg.files || []));

for (const file of [
  'installers/taskrail-install-linux.sh',
  'installers/TaskRail-Install.command',
  'installers/TaskRail-Install.ps1',
  'platform-install/linux/adapter.mjs',
  'platform-install/darwin/adapter.mjs',
  'platform-install/win32/adapter.mjs',
  '.github/workflows/ci.yml',
  '.github/workflows/golden-path.yml',
  '.github/workflows/installer-golden-path.yml',
  '.github/workflows/release.yml',
  'skills/taskrail/SKILL.md',
  'skills/taskrail-capability/SKILL.md',
  'skills/taskrail-core/SKILL.md',
]) add(`required:${file}`, await exists(file), file);

for (const marker of [
  '<!-- taskrail-size:start -->',
  '<!-- taskrail-size:end -->',
  '<!-- taskrail-footprint:start -->',
  '<!-- taskrail-footprint:end -->',
]) add(`readme:${marker}`, readme.includes(marker), marker);

for (const phrase of [
  'COMPONENT CATALOG',
  'CAPABILITY REGISTRY',
  'zero runtime npm dependencies',
  'taskrail update',
  'TaskRail-Install.ps1',
  'TaskRail-Install.command',
  'taskrail-install-linux.sh',
]) add(`readme:${phrase}`, readme.includes(phrase), phrase);

for (const phrase of [
  'Transactional update model',
  'Rollback/recovery contract',
  'Shared dependency usage graph',
  '1,000+ automation',
  'Sentinel',
]) add(`architecture:${phrase}`, architecture.includes(phrase), phrase);

for (const exportName of ['./components', './capabilities', './manifest', './testing', './control']) {
  add(`public-api:${exportName}`, Boolean(pkg.exports?.[exportName]), exportName);
}

const ok = checks.every((item) => item.ok);
const report = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  taskrailVersion: pkg.version,
  ok,
  passed: checks.filter((item) => item.ok).length,
  failed: checks.filter((item) => !item.ok).length,
  checks,
};
await mkdir(path.join(root, '.taskrail'), { recursive: true });
await writeFile(path.join(root, '.taskrail', 'release-readiness.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (!ok) process.exitCode = 1;
