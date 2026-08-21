import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const mime = new Map([['.json', 'application/json'], ['.tgz', 'application/gzip'], ['.mjs', 'text/javascript']]);

function safePath(url) {
  const pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  const resolved = path.resolve(root, `.${pathname}`);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error('path traversal');
  return resolved;
}

function executable(bin) {
  if (process.platform !== 'win32') return bin;
  if (/\.(?:exe|cmd|bat)$/i.test(bin) || bin.includes('/') || bin.includes('\\')) return bin;
  const shims = new Set(['taskrail', 'taskrail-platform-bootstrap', 'npm', 'npx', 'pnpm', 'yarn']);
  return shims.has(bin.toLowerCase()) ? `${bin}.cmd` : bin;
}

const server = createServer(async (request, response) => {
  try {
    const file = safePath(request.url || '/');
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    response.statusCode = 200;
    response.setHeader('content-type', mime.get(path.extname(file)) || 'application/octet-stream');
    response.setHeader('content-length', String(info.size));
    response.end(await readFile(file));
  } catch {
    response.statusCode = 404;
    response.end('not found');
  }
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
if (!address || typeof address === 'string') throw new Error('unable to resolve fixture server port');
const base = `http://127.0.0.1:${address.port}`;

const env = {
  ...process.env,
  TASKRAIL_RELEASE_API: `${base}/release-install/release.json`,
  TASKRAIL_RELEASE_BASE: `${base}/release-install`,
  TASKRAIL_PLATFORM_MANIFEST_URL: `${base}/release-install/taskrail-platform-manifest.json`,
  TASKRAIL_PLATFORM_ROOT: path.join(root, '.installer-platform-fixture'),
};

let command;
let args;
if (process.platform === 'win32') {
  command = 'pwsh';
  args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'installers', 'TaskRail-Install.ps1')];
} else if (process.platform === 'darwin') {
  command = 'bash';
  args = [path.join(root, 'installers', 'TaskRail-Install.command')];
} else if (process.platform === 'linux') {
  command = 'bash';
  args = [path.join(root, 'installers', 'taskrail-install-linux.sh')];
} else {
  throw new Error(`unsupported golden-path host: ${process.platform}`);
}

function run(bin, binArgs) {
  const resolvedBin = executable(bin);
  let spawnBin = resolvedBin;
  let spawnArgs = binArgs;
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(resolvedBin)) {
    spawnBin = process.env.ComSpec || 'cmd.exe';
    spawnArgs = ['/d', '/c', 'call', resolvedBin, ...binArgs];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(spawnBin, spawnArgs, { cwd: root, env, stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${resolvedBin} exited with ${code}`)));
  });
}

try {
  await run(command, args);
  await run('taskrail-platform-bootstrap', ['status']);
  console.log(`Installer golden path passed for ${process.platform}`);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
