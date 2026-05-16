import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = () => readFileSync('scripts/eas-local-ios-production.sh', 'utf8');

test('local iOS production build loads Expo production env before building', () => {
  const source = script();

  assert.match(source, /env:exec production/);
  assert.match(source, /EAS_LOCAL_PRODUCTION_ENV_LOADED=1/);
});

test('local iOS production build validates Sentry runtime telemetry', () => {
  const source = script();

  assert.match(source, /EXPO_PUBLIC_SENTRY_DSN/);
  assert.match(source, /SENTRY_ORG/);
  assert.match(source, /SENTRY_PROJECT/);
});

test('local iOS production build leaves source map upload enabled when token exists', () => {
  const source = script();

  assert.match(source, /SENTRY_DISABLE_AUTO_UPLOAD:-false/);
});
