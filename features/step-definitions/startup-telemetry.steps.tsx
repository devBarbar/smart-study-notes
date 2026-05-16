import assert from 'node:assert/strict';

import { Given, Then, When } from '@cucumber/cucumber';
import { render } from '@testing-library/react-native/pure';
import React from 'react';
import { Text, View } from 'react-native';

import { buildSentryInitOptions } from '../../lib/sentry';
import { AppWorld } from '../support/world';

type StartupTelemetryWorld = AppWorld & {
  telemetryEnv?: Record<string, string | undefined>;
};

const StartupTelemetryHarness = ({
  env,
}: {
  env: Record<string, string | undefined>;
}) => {
  const options = buildSentryInitOptions({
    env,
    expoConfig: { slug: 'smart-learning-notes', version: '1.0.0' },
    platformOS: 'ios',
  });
  const replayEnabled =
    'replaysOnErrorSampleRate' in options || 'replaysSessionSampleRate' in options;
  const profilingEnabled = 'profilesSampleRate' in options;

  return (
    <View>
      <Text testID="startup-replay-status">
        {replayEnabled ? 'enabled' : 'disabled'}
      </Text>
      <Text testID="startup-profiling-status">
        {profilingEnabled ? 'enabled' : 'disabled'}
      </Text>
    </View>
  );
};

Given(
  'production telemetry is configured without replay opt in',
  function (this: StartupTelemetryWorld) {
    this.telemetryEnv = {
      NODE_ENV: 'production',
      EXPO_PUBLIC_SENTRY_DSN: 'https://example@sentry.io/1',
      EXPO_PUBLIC_SUPABASE_URL: 'https://unit-test.supabase.co',
    };
  },
);

Given(
  'production telemetry is configured with a profile sample rate only',
  function (this: StartupTelemetryWorld) {
    this.telemetryEnv = {
      NODE_ENV: 'production',
      EXPO_PUBLIC_SENTRY_DSN: 'https://example@sentry.io/1',
      EXPO_PUBLIC_SUPABASE_URL: 'https://unit-test.supabase.co',
      EXPO_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE: '0.5',
    };
  },
);

When('the app prepares startup telemetry', function (this: StartupTelemetryWorld) {
  assert.ok(this.telemetryEnv, 'Expected telemetry env to be configured');
  this.screen = render(<StartupTelemetryHarness env={this.telemetryEnv} />);
});

Then(
  'startup telemetry reports native replay and profiling disabled',
  function (this: StartupTelemetryWorld) {
  assert.equal(this.screen!.getByTestId('startup-replay-status').props.children, 'disabled');
  assert.equal(this.screen!.getByTestId('startup-profiling-status').props.children, 'disabled');
  },
);
