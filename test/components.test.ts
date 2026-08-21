import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import {
  createExecutionContext,
  LocalStateStore,
  IdempotencyStore,
  runIdempotent,
  withRetry,
  withTimeout,
  mapConcurrent,
  config,
  fsSafe,
  http,
  log,
} from '../src/components/index.js';

test('component surface exposes existing hardened execution primitives', async () => {
  const context = createExecutionContext('demo', path.join(tmpdir(), 'taskrail-components'));
  assert.match(context.executionId, /^demo-/);
  assert.equal(typeof LocalStateStore, 'function');
  assert.equal(typeof IdempotencyStore, 'function');
  assert.equal(typeof runIdempotent, 'function');
  assert.equal(typeof withRetry, 'function');
  assert.equal(typeof withTimeout, 'function');
  assert.equal(typeof mapConcurrent, 'function');
});

test('config component parses required typed values without exposing values in errors', () => {
  const env = { NAME: 'taskrail', COUNT: '4', ENABLED: 'yes', PAYLOAD: '{"ok":true}' };
  assert.equal(config.required('NAME', env), 'taskrail');
  assert.equal(config.number('COUNT', env), 4);
  assert.equal(config.boolean('ENABLED', env), true);
  assert.deepEqual(config.json('PAYLOAD', env), { ok: true });
  assert.throws(() => config.required('MISSING', env), /missing required configuration: MISSING/);
});

test('safe filesystem component writes atomically and fails loudly on corrupt json', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'taskrail-fs-'));
  try {
    const file = path.join(root, 'nested', 'state.json');
    await fsSafe.writeJson(file, { value: 1 });
    assert.deepEqual(await fsSafe.readJson(file), { value: 1 });
    await fsSafe.atomicWriteText(file, '{broken');
    await assert.rejects(() => fsSafe.readJson(file));
    const journal = path.join(root, 'events.jsonl');
    await fsSafe.appendJsonl(journal, { event: 'one' });
    await fsSafe.appendJsonl(journal, { event: 'two' });
    assert.equal((await readFile(journal, 'utf8')).trim().split('\n').length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('logging component redacts secret-shaped keys recursively', () => {
  const body = log.format({
    level: 'info',
    scope: 'demo',
    message: 'test',
    data: { token: 'secret', nested: { apiKey: 'key', safe: 'ok' } },
  });
  const parsed = JSON.parse(body);
  assert.equal(parsed.data.token, '[REDACTED]');
  assert.equal(parsed.data.nested.apiKey, '[REDACTED]');
  assert.equal(parsed.data.nested.safe, 'ok');
});

test('http component retries safe methods, avoids unsafe retries by default, and parses json', async () => {
  let getAttempts = 0;
  let postAttempts = 0;
  const server = createServer((req, res) => {
    if (req.url === '/retry') {
      getAttempts += 1;
      if (getAttempts < 3) {
        res.statusCode = 503;
        res.end('try again');
        return;
      }
      res.setHeader('content-type', 'application/json');
      res.end('{"ok":true}');
      return;
    }
    if (req.url === '/post') {
      postAttempts += 1;
      res.statusCode = 503;
      res.end('failed');
      return;
    }
    res.statusCode = 404;
    res.end('missing');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const base = `http://127.0.0.1:${address.port}`;
    const result = await http.json<{ ok: boolean }>(`${base}/retry`, {
      retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, jitter: false },
    });
    assert.equal(result.data.ok, true);
    assert.equal(getAttempts, 3);
    await assert.rejects(() => http.request(`${base}/post`, {
      method: 'POST',
      retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, jitter: false },
    }), /HTTP 503/);
    assert.equal(postAttempts, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
