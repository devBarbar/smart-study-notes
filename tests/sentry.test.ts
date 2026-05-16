import './utils/react-native-test-env';

import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSentryInitOptions } from '../lib/sentry';

const baseEnv = {
  NODE_ENV: 'production',
  EXPO_PUBLIC_SENTRY_DSN: 'https://example@sentry.io/1',
  EXPO_PUBLIC_SUPABASE_URL: 'https://unit-test.supabase.co',
};

test('sentry launch config can be built from runtime defaults', () => {
  const options = buildSentryInitOptions();

  assert.equal(options.release, 'smart-learning-notes@1.0.0-test');
  assert.equal(options.dist, 'ios');
});

test('sentry launch config does not enable mobile replay by default', () => {
  const options = buildSentryInitOptions({
    env: baseEnv,
    expoConfig: { slug: 'smart-learning-notes', version: '1.0.0' },
    platformOS: 'ios',
  });

  assert.equal(options.replaysSessionSampleRate, 0);
  assert.equal(options.replaysOnErrorSampleRate, 0);
});

test('sentry launch config does not enable Hermes profiling by default', () => {
  const options = buildSentryInitOptions({
    env: baseEnv,
    expoConfig: { slug: 'smart-learning-notes', version: '1.0.0' },
    platformOS: 'ios',
  });

  assert.equal(options.profilesSampleRate, 0);
});

test('sentry native replay stays disabled even with positive replay sample rates', () => {
  const options = buildSentryInitOptions({
    env: {
      ...baseEnv,
      EXPO_PUBLIC_SENTRY_REPLAY_SESSION_SAMPLE_RATE: '0.25',
      EXPO_PUBLIC_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE: '1',
    },
    expoConfig: { slug: 'smart-learning-notes', version: '1.0.0' },
    platformOS: 'ios',
  });

  assert.equal(options.replaysSessionSampleRate, 0);
  assert.equal(options.replaysOnErrorSampleRate, 0);
});

test('sentry web replay is opt-in through positive replay sample rates', () => {
  const options = buildSentryInitOptions({
    env: {
      ...baseEnv,
      EXPO_PUBLIC_SENTRY_REPLAY_SESSION_SAMPLE_RATE: '0.25',
      EXPO_PUBLIC_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE: '1',
    },
    expoConfig: { slug: 'smart-learning-notes', version: '1.0.0' },
    platformOS: 'web',
  });

  assert.equal(options.replaysSessionSampleRate, 0.25);
  assert.equal(options.replaysOnErrorSampleRate, 1);
});

test('sentry Hermes profiling stays disabled when only a positive profile sample rate is set', () => {
  const options = buildSentryInitOptions({
    env: {
      ...baseEnv,
      EXPO_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE: '0.5',
    },
    expoConfig: { slug: 'smart-learning-notes', version: '1.0.0' },
    platformOS: 'ios',
  });

  assert.equal(options.profilesSampleRate, 0);
});

test('sentry native profiling stays disabled with an explicit enable flag and positive profile sample rate', () => {
  const options = buildSentryInitOptions({
    env: {
      ...baseEnv,
      EXPO_PUBLIC_SENTRY_ENABLE_PROFILING: 'true',
      EXPO_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE: '0.5',
    },
    expoConfig: { slug: 'smart-learning-notes', version: '1.0.0' },
    platformOS: 'ios',
  });

  assert.equal(options.profilesSampleRate, 0);
});

test('sentry web profiling requires an explicit enable flag and positive profile sample rate', () => {
  const options = buildSentryInitOptions({
    env: {
      ...baseEnv,
      EXPO_PUBLIC_SENTRY_ENABLE_PROFILING: 'true',
      EXPO_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE: '0.5',
    },
    expoConfig: { slug: 'smart-learning-notes', version: '1.0.0' },
    platformOS: 'web',
  });

  assert.equal(options.profilesSampleRate, 0.5);
});

test('sentry trace sample rates are clamped and fall back when invalid', () => {
  const highRate = buildSentryInitOptions({
    env: {
      ...baseEnv,
      EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: '2',
    },
    expoConfig: { slug: 'smart-learning-notes', version: '1.0.0' },
    platformOS: 'ios',
  });
  const invalidRate = buildSentryInitOptions({
    env: {
      ...baseEnv,
      EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE: 'not-a-number',
    },
    expoConfig: { slug: 'smart-learning-notes', version: '1.0.0' },
    platformOS: 'ios',
  });

  assert.equal(highRate.tracesSampleRate, 1);
  assert.equal(invalidRate.tracesSampleRate, 1);
});

test('sentry trace propagation targets include Supabase only when configured', () => {
  const withSupabase = buildSentryInitOptions({
    env: baseEnv,
    expoConfig: { slug: 'smart-learning-notes', version: '1.0.0' },
    platformOS: 'ios',
  });
  const withoutSupabase = buildSentryInitOptions({
    env: {
      NODE_ENV: 'production',
      EXPO_PUBLIC_SENTRY_DSN: 'https://example@sentry.io/1',
    },
    expoConfig: { slug: 'smart-learning-notes', version: '1.0.0' },
    platformOS: 'ios',
  });

  assert.equal(withSupabase.tracePropagationTargets?.[0], baseEnv.EXPO_PUBLIC_SUPABASE_URL);
  assert.ok(withoutSupabase.tracePropagationTargets?.[0] instanceof RegExp);
});

test('sentry replay sample rates of zero or invalid values keep replay disabled', () => {
  const options = buildSentryInitOptions({
    env: {
      ...baseEnv,
      EXPO_PUBLIC_SENTRY_REPLAY_SESSION_SAMPLE_RATE: '0',
      EXPO_PUBLIC_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE: 'not-a-number',
    },
    expoConfig: { slug: 'smart-learning-notes', version: '1.0.0' },
    platformOS: 'ios',
  });

  assert.equal(options.replaysSessionSampleRate, 0);
  assert.equal(options.replaysOnErrorSampleRate, 0);
});

test('sentry runtime reporting is enabled when a DSN is configured', () => {
  const options = buildSentryInitOptions({
    env: baseEnv,
    expoConfig: { slug: 'smart-learning-notes', version: '1.0.0' },
    platformOS: 'ios',
  });

  assert.equal(options.enabled, true);
});
