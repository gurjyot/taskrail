import test from 'node:test';
import assert from 'node:assert/strict';
import { checkUpdates } from '../src/update-check.js';
const revision = 'a'.repeat(40);
function remote(data: unknown[]) {
  return (async () => new Response(JSON.stringify(data.shift()), { status: 200 })) as typeof fetch;
}
test('reports both new release and newer source', async () => {
  const result = await checkUpdates({ installed: { version: '3.1.0', revision }, fetchImpl: remote([
    { tag_name: 'v3.2.0' }, { sha: 'b'.repeat(40) }, { status: 'ahead' },
  ]) });
  assert.equal(result.status, 'ok');
  assert.equal(result.releaseAvailable, true);
  assert.equal(result.sourceChangesAvailable, true);
});
test('same version source changes are still reported', async () => {
  const result = await checkUpdates({ installed: { version: '3.2.0', revision: null }, fetchImpl: remote([
    { tag_name: 'v3.2.0' }, { sha: revision }, { status: 'ahead' },
  ]) });
  assert.equal(result.releaseAvailable, false);
  assert.equal(result.sourceChangesAvailable, true);
});
test('identical installed build is current and ahead installation is not downgraded', async () => {
  const result = await checkUpdates({ installed: { version: '3.3.0', revision }, fetchImpl: remote([
    { tag_name: 'v3.2.0' }, { sha: revision },
  ]) });
  assert.equal(result.status, 'ok');
  assert.equal(result.releaseAvailable, false);
  assert.equal(result.sourceChangesAvailable, false);
});
test('network failure and invalid remote metadata remain unknown', async () => {
  for (const fetchImpl of [remote([{ tag_name: 'bad' }]), (async () => { throw new Error('private transport detail'); }) as typeof fetch]) {
    const result = await checkUpdates({ installed: { version: '3.2.0', revision }, fetchImpl });
    assert.equal(result.status, 'unknown');
    assert.ok(!JSON.stringify(result).includes('private transport detail'));
  }
});
