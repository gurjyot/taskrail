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
const diagnosticsSecurity = await readFile(path.join(root, 'docs', 'diagnostics-and-security.md'), 'utf8');
const releaseWorkflow = await readFile(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');

add('version:package-source', versionMatch?.[1] === pkg.version, `${pkg.version} / ${versionMatch?.[1] || 'missing'}`);
add('version:platform-manifest', platformManifest.taskrailVersion === pkg.version, `${pkg.version} / ${platformManifest.taskrailVersion}`);
add('runtime-dependencies:none', !pkg.dependencies || Object.keys(pkg.dependencies).length === 0, String(Object.keys(pkg.dependencies || {}).length));
add('package:platform-assets-excluded', !pkg.files?.some((item) => String(item).startsWith('platform-install') || String(item).startsWith('installers') || String(item).startsWith('adapters/mcp')), JSON.stringify(pkg.files || []));
add('package:agent-api', Boolean(pkg.exports?.['./agent']), './agent');
add('package:platform-api', Boolean(pkg.exports?.['./platform']), './platform');
add('check:strict-security', String(pkg.scripts?.check || '').includes('security audit --strict --root src'), 'npm run check');
add('script:fault-contract', Boolean(pkg.scripts?.['fault:contract']), 'fault:contract');
add('script:certify', Boolean(pkg.scripts?.certify), 'certify');
add('script:size-sync', Boolean(pkg.scripts?.['size:sync']), 'size:sync');
add('script:size-check', Boolean(pkg.scripts?.['size:check']), 'size:check');
add('release:sigstore-attestation', releaseWorkflow.includes('actions/attest@v4') && releaseWorkflow.includes('id-token: write') && releaseWorkflow.includes('attestations: write'), 'actions/attest@v4');
add('release:certification', releaseWorkflow.includes('npm run certify'), 'npm run certify');

for (const file of [
  'installers/taskrail-install-linux.sh',
  'installers/TaskRail-Install.command',
  'installers/TaskRail-Install.ps1',
  'platform-install/linux/adapter.mjs',
  'platform-install/darwin/adapter.mjs',
  'platform-install/win32/adapter.mjs',
  'src/diagnostics.ts',
  'src/diagnostic-intake.ts',
  'src/error-intelligence.ts',
  'src/security.ts',
  'src/security-registry.ts',
  'src/security-modules.ts',
  'src/security-policy.ts',
  'src/validation-registry.ts',
  'src/validation-modules.ts',
  'src/reboot-recovery.ts',
  'src/retention-policy.ts',
  'src/performance-budget.ts',
  'src/backward-compatibility.ts',
  'src/provenance.ts',
  'src/compatibility-contract.ts',
  'src/certification.ts',
  'src/fault-injection.ts',
  'src/agent-surface.ts',
  'src/agent-grants.ts',
  'src/recovery-resume.ts',
  'src/platform-contract.ts',
  'src/execution-guardrails.ts',
  'src/public/platform.ts',
  'test/diagnostics-security.test.ts',
  'test/diagnostic-intake.test.ts',
  'test/agent-surface.test.ts',
  'test/modular-hardening.test.ts',
  'test/modular-architecture.test.ts',
  'test/deployment-private-state.test.ts',
  'test/platform-bootstrap.test.ts',
  'test/platform-contract.test.ts',
  'scripts/certify-release.mjs',
  'scripts/test-mcp-packed.mjs',
  'scripts/sync-readme-size.mjs',
  'docs/diagnostics-and-security.md',
  '.github/workflows/ci.yml',
  '.github/workflows/golden-path.yml',
  '.github/workflows/installer-golden-path.yml',
  '.github/workflows/mcp-adapter.yml',
  '.github/workflows/fault-injection.yml',
  '.github/workflows/release.yml',
  '.github/workflows/sentinel.yml',
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
  'Release provenance',
  'Versioned security policy',
  'Fault injection',
  'TaskRail certification',
  'Optional MCP adapter',
]) add(`readme:${phrase}`, readme.includes(phrase), phrase);

add('readme:removed-diagram-note', !readme.includes('The diagram is intentionally plain text') && !readme.includes('The diagram is plain text so it renders directly'), 'diagram explanatory note removed');

for (const phrase of [
  'Transactional update model',
  'Rollback/recovery contract',
  'Shared dependency usage graph',
  '1,000+ automation',
  'Sentinel',
]) add(`architecture:${phrase}`, architecture.includes(phrase), phrase);

for (const phrase of [
  'TaskRail core does not transmit telemetry',
  'private GitHub repository',
  'authorized automation',
  'parameterized SQL',
  'stdio',
  'read: allowed',
  'write: denied',
  'control/deployment/recovery: denied',
]) add(`security-doc:${phrase}`, diagnosticsSecurity.includes(phrase), phrase);

for (const exportName of ['./components', './capabilities', './manifest', './testing', './control', './agent', './platform']) {
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
await mkdir(path.join(root, '.taskrail'), { recursive: true, mode: 0o700 });
await writeFile(path.join(root, '.taskrail', 'release-readiness.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
if (!ok) process.exitCode = 1;
