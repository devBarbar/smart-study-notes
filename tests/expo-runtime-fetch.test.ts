import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module from 'node:module';
import test from 'node:test';

type ModuleWithLoad = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
};

test('app entry opts out of Expo native fetch before Expo Router loads', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(packageJson.main, './index.js');

  const moduleWithLoad = Module as ModuleWithLoad;
  const originalUseRnFetch = process.env.EXPO_PUBLIC_USE_RN_FETCH;
  const originalLoad = moduleWithLoad._load;
  let loadedEntry = false;

  process.env.EXPO_PUBLIC_USE_RN_FETCH = '';
  moduleWithLoad._load = ((request: string, parent: NodeModule | null, isMain: boolean) => {
    if (request === 'expo-router/entry') {
      loadedEntry = true;
      assert.equal(process.env.EXPO_PUBLIC_USE_RN_FETCH, 'true');
      return {};
    }
    return originalLoad.call(Module, request, parent, isMain);
  }) as ModuleWithLoad['_load'];

  try {
    delete require.cache[require.resolve('../index.js')];
    require('../index.js');
    assert.equal(loadedEntry, true);
  } finally {
    moduleWithLoad._load = originalLoad;
    if (originalUseRnFetch === undefined) {
      delete process.env.EXPO_PUBLIC_USE_RN_FETCH;
    } else {
      process.env.EXPO_PUBLIC_USE_RN_FETCH = originalUseRnFetch;
    }
    delete require.cache[require.resolve('../index.js')];
  }
});
