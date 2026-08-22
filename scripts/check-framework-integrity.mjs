import { access, readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = process.cwd();
const readJson = async (file) => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const exists = async (file) => access(path.join(root, file)).then(() => true, () => false);
const pkg = await readJson('package.json');
const registry = await readJson('framework-integrity.json');

function runNodeScript(script) {
  const result = spawnSync(process.execPath, [path.join(root, script)], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 2 * 1024 * 1024,
    shell: false,
  });
  return { ok: result.status === 0, detail: (result.stderr || result.stdout || '').trim().slice(0, 2000) };
}

async function checkSurface(checkId) {
  if (checkId === 'skills') return runNodeScript('scripts/check-skills-freshness.mjs');
  if (checkId === 'mcp') return runNodeScript('scripts/check-mcp-freshness.mjs');

  if (checkId === 'version-metadata') {
    const versionSource = await readFile(path.join(root, 'src', 'version.ts'), 'utf8');
    const sourceVersion = versionSource.match(/TASKRAIL_VERSION\s*=\s*['\"]([^'\"]+)['\"]/i)?.[1];
    const platform = await readJson('platform-install/manifest.json');
    const ok = sourceVersion === pkg.version && platform.taskrailVersion === pkg.version && registry.taskrailVersion === pkg.version;
    return { ok, detail: `package=${pkg.version} source=${sourceVersion || 'missing'} platform=${platform.taskrailVersion || 'missing'} registry=${registry.taskrailVersion || 'missing'}` };
  }

  if (checkId === 'public-contract') {
    const requiredExports = ['.', './components', './capabilities', './manifest', './testing', './control', './agent', './platform'];
    const requiredBins = ['taskrail', 'taskrail-supervise', 'taskrail-heartbeat', 'taskrail-systemd-sync', 'taskrail-platform-bootstrap'];
    const missingExports = requiredExports.filter((name) => !pkg.exports?.[name]);
    const missingBins = requiredBins.filter((name) => !pkg.bin?.[name]);
    return { ok: missingExports.length === 0 && missingBins.length === 0, detail: `missingExports=${missingExports.join(',') || 'none'} missingBins=${missingBins.join(',') || 'none'}` };
  }

  if (checkId === 'profiles') {
    const profileDir = path.join(root, 'profiles');
    const profileEntries = await readdir(profileDir, { withFileTypes: true }).catch(() => []);
    const hasProfiles = profileEntries.some((entry) => entry.isFile() || entry.isDirectory());
    const frameworkExists = await exists('src/framework.ts');
    const capabilityContractExists = await exists('src/capabilities.ts');
    return { ok: hasProfiles && frameworkExists && capabilityContractExists, detail: `profiles=${profileEntries.length} framework=${frameworkExists} capabilities=${capabilityContractExists}` };
  }

  if (checkId === 'release-control') {
    const required = [
      '.github/workflows/release.yml',
      '.github/workflows/installer-golden-path.yml',
      'scripts/certify-release.mjs',
      'scripts/build-install-release.mjs',
      'installers/taskrail-install-linux.sh',
      'installers/TaskRail-Install.command',
      'installers/TaskRail-Install.ps1',
    ];
    const states = await Promise.all(required.map(async (file) => [file, await exists(file)]));
    const missing = states.filter(([, ok]) => !ok).map(([file]) => file);
    return { ok: missing.length === 0, detail: `missing=${missing.join(',') || 'none'}` };
  }

  if (checkId === 'performance') {
    const required = ['scripts/performance-check.mjs', 'src/performance-budget.ts'];
    const states = await Promise.all(required.map(async (file) => [file, await exists(file)]));
    const baselineCandidates = ['performance-baseline.json', 'scripts/performance-baseline.json', '.taskrail/performance-baseline.json'];
    const baselineStates = await Promise.all(baselineCandidates.map(async (file) => [file, await exists(file)]));
    const missing = states.filter(([, ok]) => !ok).map(([file]) => file);
    const hasBaseline = baselineStates.some(([, ok]) => ok);
    return { ok: missing.length === 0 && hasBaseline, detail: `missing=${missing.join(',') || 'none'} baseline=${hasBaseline}` };
  }

  if (checkId === 'documentation') {
    const required = ['README.md', 'FRAMEWORK.md', 'AGENTS.md', 'CHANGELOG.md', 'docs'];
    const states = await Promise.all(required.map(async (file) => [file, await exists(file)]));
    const missing = states.filter(([, ok]) => !ok).map(([file]) => file);
    return { ok: missing.length === 0, detail: `missing=${missing.join(',') || 'none'}` };
  }

  return { ok: false, detail: `unknown checkId: ${checkId}` };
}

const results = [];
if (registry.taskrailVersion !== pkg.version) {
  results.push({ surface: 'registry', checkId: 'registry-version', reviewedForTaskRail: registry.taskrailVersion ?? null, expected: pkg.version, ok: false, detail: 'framework-integrity.json version mismatch' });
}

for (const surface of registry.surfaces ?? []) {
  const reviewed = surface.reviewedForTaskRail === pkg.version;
  const check = reviewed ? await checkSurface(surface.checkId) : { ok: false, detail: `review marker ${surface.reviewedForTaskRail || 'missing'} != ${pkg.version}` };
  results.push({
    surface: surface.name,
    checkId: surface.checkId,
    reviewedForTaskRail: surface.reviewedForTaskRail ?? null,
    expected: pkg.version,
    reviewed,
    ok: reviewed && check.ok,
    detail: check.detail,
  });
}

const names = results.filter((item) => item.surface !== 'registry').map((item) => item.surface);
const duplicateNames = names.filter((name, index) => names.indexOf(name) !== index);
const ok = results.length > 0 && duplicateNames.length === 0 && results.every((item) => item.ok);
const report = { schema: 1, taskrailVersion: pkg.version, registryVersion: registry.taskrailVersion, ok, surfaceCount: registry.surfaces?.length ?? 0, duplicateNames: [...new Set(duplicateNames)], results };
console.log(JSON.stringify(report, null, 2));
if (!ok) {
  console.error(`TaskRail framework integrity is stale for ${pkg.version}. Review every surface in framework-integrity.json and fix the failing implementation check before release.`);
  process.exitCode = 1;
}
