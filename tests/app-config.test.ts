import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const runAppConfig = (env: Record<string, string | undefined>) =>
  spawnSync(
    process.execPath,
    [
      '-e',
      "const config = require('./app.config.js')({ config: { plugins: [] } }); console.log(JSON.stringify(config.plugins));",
    ],
    {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH ?? '',
        HOME: process.env.HOME ?? '',
        ...env,
      },
      encoding: 'utf8',
    },
  );

const productionBuildEnv = {
  NODE_ENV: 'production',
  EAS_BUILD: 'true',
  EXPO_PUBLIC_SUPABASE_URL: 'https://unit-test.supabase.co',
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'unit-test-anon-key',
};

test('production config fails clearly when Sentry runtime env is missing', () => {
  const result = runAppConfig(productionBuildEnv);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Missing required Expo production telemetry environment variables: EXPO_PUBLIC_SENTRY_DSN, SENTRY_ORG, SENTRY_PROJECT/,
  );
});

test('production config adds the Sentry Expo plugin when telemetry env is present', () => {
  const result = runAppConfig({
    ...productionBuildEnv,
    EXPO_PUBLIC_SENTRY_DSN: 'https://example@sentry.io/1',
    SENTRY_ORG: 'devbarbar',
    SENTRY_PROJECT: 'smart-learning-notes',
  });

  assert.equal(result.status, 0, result.stderr);
  const plugins = JSON.parse(result.stdout);
  assert.deepEqual(plugins.at(-1), [
    '@sentry/react-native/expo',
    {
      url: 'https://sentry.io/',
      organization: 'devbarbar',
      project: 'smart-learning-notes',
    },
  ]);
});
