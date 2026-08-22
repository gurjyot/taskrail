import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/validation.js';
import type { FrameworkConfig } from '../src/types.js';

function configWithPlugins(plugins: FrameworkConfig['manifest']['plugins']): FrameworkConfig {
  return {
    projectName: 'plugin-contract',
    environment: {},
    manifest: {
      name: 'plugin-contract',
      runtime: 'node',
      managed: true,
      sourceDir: '.',
      deployDir: './live',
      validationCommand: 'node --check index.js',
      testCommand: 'node --test',
      plugins,
    },
  };
}

test('manifest permits zero or one operational plugin and rejects multiple plugins', () => {
  assert.equal(validateConfig(configWithPlugins([])).includes('manifest.plugins supports at most one operational plugin'), false);
  assert.equal(validateConfig(configWithPlugins([{ name: 'one', module: './one.js' }])).includes('manifest.plugins supports at most one operational plugin'), false);
  assert.equal(validateConfig(configWithPlugins([
    { name: 'one', module: './one.js' },
    { name: 'two', module: './two.js' },
  ])).includes('manifest.plugins supports at most one operational plugin'), true);
});
