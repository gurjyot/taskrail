import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readdir, readFile, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = process.cwd();
const releaseDir = path.join(root, 'release-install');
const installManifest = JSON.parse(await readFile(path.join(releaseDir, 'taskrail-install-manifest.json'), 'utf8'));
const frameworkAsset = String(installManifest.framework.file);

function installerCommand() {
  if (process.platform === 'win32') return ['pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'installers', 'TaskRail-Install.ps1')]];
  if (process.platform === 'darwin') return ['bash', [path.join(root, 'installers', 'TaskRail-Install.command')]];
  if (process.platform === 'linux') return ['bash', [path.join(root, 'installers', 'taskrail-install-linux.sh')]];
  throw new Error(`unsupported failure-injection host: ${process.platform}`);
}

function run(bin, args, env, expectSuccess) {
  let spawnBin = bin;
  let spawnArgs = args;
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(bin)) {
    spawnBin = process.env.ComSpec || 'cmd.exe';
    spawnArgs = ['/d', '/c', 'call', bin, ...args];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(spawnBin, spawnArgs, { cwd: root, env, stdio: 'pipe', shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('exit', (code) => {
      const ok = code === 0;
      if (ok !== expectSuccess) return reject(new Error(`unexpected installer exit ${code}; stdout=${stdout.slice(-2000)} stderr=${stderr.slice(-2000)}`));
      resolve({ code, stdout, stderr });
    });
  });
}

async function platformStatus() {
  const bin = process.platform === 'win32' ? 'taskrail-platform-bootstrap.cmd' : 'taskrail-platform-bootstrap';
  const result = await run(bin, ['status'], process.env, true);
  return JSON.parse(result.stdout);
}

async function tempArtifacts() {
  const entries = await readdir(os.tmpdir()).catch(() => []);
  return entries.filter((name) => name.startsWith('taskrail-install-')).sort();
}

async function withFixtureServer(mode, operation) {
  let releaseAttempts = 0;
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
      if (mode === 'retry-release' && pathname.endsWith('/release.json') && releaseAttempts++ < 2) {
        response.statusCode = 503;
        response.end('transient fixture failure');
        return;
      }
      if (mode === 'missing-platform' && pathname.endsWith('/taskrail-platform-manifest.json')) {
        response.statusCode = 404;
        response.end('missing fixture platform manifest');
        return;
      }
      const name = path.basename(pathname);
      const file = path.join(releaseDir, name);
      const info = await stat(file);
      if (!info.isFile()) throw new Error('not a file');
      let bytes = await readFile(file);
      if (mode === 'corrupt-package' && name === frameworkAsset) {
        bytes = Buffer.from(bytes);
        bytes[Math.max(0, bytes.length - 8)] ^= 0xff;
      }
      response.statusCode = 200;
      response.setHeader('content-length', String(bytes.length));
      response.end(bytes);
    } catch {
      response.statusCode = 404;
      response.end('not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('unable to resolve failure-injection server');
    const base = `http://127.0.0.1:${address.port}`;
    return await operation({
      base,
      releaseAttempts: () => releaseAttempts,
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const before = await platformStatus();
const beforeTemp = await tempArtifacts();
const [installer, installerArgs] = installerCommand();

for (const mode of ['corrupt-package', 'missing-platform']) {
  await withFixtureServer(mode, async ({ base }) => {
    const env = {
      ...process.env,
      TASKRAIL_RELEASE_API: `${base}/release.json`,
      TASKRAIL_RELEASE_BASE: base,
      TASKRAIL_PLATFORM_MANIFEST_URL: `${base}/taskrail-platform-manifest.json`,
    };
    await run(installer, installerArgs, env, false);
  });
  const after = await platformStatus();
  if (JSON.stringify(after.receipt) !== JSON.stringify(before.receipt)) {
    throw new Error(`${mode} changed the previously working platform receipt`);
  }
}

await withFixtureServer('retry-release', async ({ base, releaseAttempts }) => {
  const env = {
    ...process.env,
    TASKRAIL_RELEASE_API: `${base}/release.json`,
    TASKRAIL_RELEASE_BASE: base,
    TASKRAIL_PLATFORM_MANIFEST_URL: `${base}/taskrail-platform-manifest.json`,
  };
  await run(installer, installerArgs, env, true);
  if (releaseAttempts() < 3) throw new Error('installer did not exercise retry recovery');
});

const afterTemp = await tempArtifacts();
const leaked = afterTemp.filter((item) => !beforeTemp.includes(item));
if (leaked.length) throw new Error(`installer leaked temporary directories: ${leaked.join(', ')}`);
console.log(`Installer failure injection passed for ${process.platform}`);
