import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export type SupportedPlatform = 'linux' | 'darwin' | 'win32';

export interface PlatformAdapterManifestEntry {
  id: string;
  file: string;
  sha256: string;
  bytes?: number;
}

export interface PlatformAdapterManifest {
  schema: 1;
  taskrailVersion: string;
  platforms: Record<SupportedPlatform, PlatformAdapterManifestEntry>;
}

export interface InstalledPlatformReceipt {
  schema: 1;
  platform: SupportedPlatform;
  adapterId: string;
  taskrailVersion: string;
  sha256: string;
  adapterPath: string;
  installedAt: string;
  source: string;
}

export interface InstallPlatformOptions {
  platform?: NodeJS.Platform;
  version: string;
  root?: string;
  manifestUrl?: string;
  manifestFile?: string;
}

const supported = new Set<SupportedPlatform>(['linux', 'darwin', 'win32']);
const DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_ADAPTER_BYTES = 4 * 1024 * 1024;

export function detectSupportedPlatform(platform: NodeJS.Platform = process.platform): SupportedPlatform {
  if (!supported.has(platform as SupportedPlatform)) throw new Error(`unsupported TaskRail platform: ${platform}`);
  return platform as SupportedPlatform;
}

export function defaultPlatformRoot() {
  const override = process.env.TASKRAIL_PLATFORM_ROOT;
  if (override) return path.resolve(override);
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || os.homedir(), 'TaskRail', 'platform');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'taskrail', 'platform');
}

export function releaseManifestUrl(version: string) {
  const override = process.env.TASKRAIL_PLATFORM_MANIFEST_URL;
  if (override) return override;
  return `https://github.com/gurjyot/taskrail/releases/download/v${version}/taskrail-platform-manifest.json`;
}

async function readLocalBytes(source: string, maxBytes: number, label: string) {
  const file = new URL(source);
  const info = await stat(file);
  if (info.size > maxBytes) throw new Error(`${label} exceeds ${maxBytes} byte limit`);
  return readFile(file);
}

async function readResponseBytes(response: Response, maxBytes: number, label: string) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error(`${label} exceeds ${maxBytes} byte limit`);
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`${label} exceeds ${maxBytes} byte limit`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function fetchBounded(source: string, label: string, maxBytes: number) {
  const response = await fetch(source, {
    redirect: 'follow',
    headers: { 'user-agent': 'taskrail-platform-bootstrap' },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${label} download failed: ${response.status} ${response.statusText}`);
  return readResponseBytes(response, maxBytes, label);
}

async function readTextSource(source: string) {
  const bytes = source.startsWith('file://')
    ? await readLocalBytes(source, MAX_MANIFEST_BYTES, 'platform manifest')
    : await fetchBounded(source, 'platform manifest', MAX_MANIFEST_BYTES);
  return bytes.toString('utf8');
}

async function readBytesSource(source: string, maxBytes = MAX_ADAPTER_BYTES) {
  if (source.startsWith('file://')) return readLocalBytes(source, maxBytes, 'platform adapter');
  return fetchBounded(source, 'platform adapter', maxBytes);
}

function validateManifest(value: unknown, version: string): PlatformAdapterManifest {
  if (!value || typeof value !== 'object') throw new Error('invalid platform manifest');
  const manifest = value as PlatformAdapterManifest;
  if (manifest.schema !== 1) throw new Error(`unsupported platform manifest schema: ${String((manifest as any).schema)}`);
  if (manifest.taskrailVersion !== version) throw new Error(`platform manifest version mismatch: expected ${version}, got ${manifest.taskrailVersion}`);
  return manifest;
}

function resolveAdapterSource(manifestSource: string, file: string) {
  if (/^[a-z]+:\/\//i.test(file)) return file;
  if (manifestSource.startsWith('file://')) return new URL(file, manifestSource).href;
  return new URL(file, manifestSource).href;
}

function sha256(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function atomicWrite(file: string, bytes: Buffer | string) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, bytes, { mode: 0o600 });
  try {
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function installPlatformAdapter(options: InstallPlatformOptions): Promise<InstalledPlatformReceipt> {
  const platform = detectSupportedPlatform(options.platform);
  const root = path.resolve(options.root || defaultPlatformRoot());
  const manifestSource = options.manifestFile
    ? pathToFileURL(path.resolve(options.manifestFile)).href
    : (options.manifestUrl || releaseManifestUrl(options.version));
  const manifest = validateManifest(JSON.parse(await readTextSource(manifestSource)), options.version);
  const entry = manifest.platforms?.[platform];
  if (!entry?.file || !entry.sha256 || !entry.id) throw new Error(`platform manifest has no valid ${platform} adapter`);
  if (entry.bytes !== undefined && (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > MAX_ADAPTER_BYTES)) {
    throw new Error(`platform adapter size declaration is invalid for ${platform}`);
  }
  const adapterSource = resolveAdapterSource(manifestSource, entry.file);
  const bytes = await readBytesSource(adapterSource, entry.bytes ?? MAX_ADAPTER_BYTES);
  const digest = sha256(bytes);
  if (digest !== entry.sha256.toLowerCase()) throw new Error(`platform adapter checksum mismatch for ${platform}`);
  if (entry.bytes !== undefined && bytes.length !== entry.bytes) throw new Error(`platform adapter size mismatch for ${platform}`);

  const installDir = path.join(root, options.version, platform);
  const adapterPath = path.join(installDir, 'adapter.mjs');
  await atomicWrite(adapterPath, bytes);
  const receipt: InstalledPlatformReceipt = {
    schema: 1,
    platform,
    adapterId: entry.id,
    taskrailVersion: options.version,
    sha256: digest,
    adapterPath,
    installedAt: new Date().toISOString(),
    source: adapterSource,
  };
  await atomicWrite(path.join(installDir, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  await atomicWrite(path.join(root, 'current.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
}

export async function readInstalledPlatform(root = defaultPlatformRoot()): Promise<InstalledPlatformReceipt | null> {
  try {
    return JSON.parse(await readFile(path.join(root, 'current.json'), 'utf8')) as InstalledPlatformReceipt;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function platformAdapterIsInstalled(root = defaultPlatformRoot()) {
  const receipt = await readInstalledPlatform(root);
  if (!receipt) return false;
  return stat(receipt.adapterPath).then((item) => item.isFile(), () => false);
}

export async function loadInstalledPlatformAdapter(root = defaultPlatformRoot()) {
  const receipt = await readInstalledPlatform(root);
  if (!receipt) throw new Error('TaskRail platform adapter is not installed');
  const module = await import(`${pathToFileURL(receipt.adapterPath).href}?sha=${receipt.sha256}`);
  return module.default ?? module.platformAdapter ?? module;
}
