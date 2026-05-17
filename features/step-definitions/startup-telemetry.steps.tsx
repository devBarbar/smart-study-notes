import assert from 'node:assert/strict';

import { Given, Then, When } from '@cucumber/cucumber';
import { render } from '@testing-library/react-native/pure';
import React from 'react';
import { Text, View } from 'react-native';

import {
  buildSentryInitOptions,
  captureSentryStartupTelemetry,
  logTelemetryCheckpoint,
} from '../../lib/sentry';
import { AppWorld } from '../support/world';

type StartupTelemetryWorld = AppWorld & {
  telemetryEnv?: Record<string, string | undefined>;
};
type StartupTelemetryGlobal = typeof globalThis & {
  __sentryMockState?: {
    messages: Array<unknown>;
    logs: Array<unknown>;
    breadcrumbs: Array<unknown>;
  };
  __smartLearningNotesSentryStartupCaptured?: boolean;
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
    (options.replaysOnErrorSampleRate ?? 0) > 0 ||
    (options.replaysSessionSampleRate ?? 0) > 0;
  const profilingEnabled = (options.profilesSampleRate ?? 0) > 0;
  captureSentryStartupTelemetry(options);
  captureSentryStartupTelemetry(options);
  const sentryMockState = (globalThis as StartupTelemetryGlobal).__sentryMockState;

  return (
    <View>
      <Text testID="startup-replay-status">
        {replayEnabled ? 'enabled' : 'disabled'}
      </Text>
      <Text testID="startup-profiling-status">
        {profilingEnabled ? 'enabled' : 'disabled'}
      </Text>
      <Text testID="startup-sentry-status">
        {options.enabled ? 'enabled' : 'disabled'}
      </Text>
      <Text testID="startup-sentry-signal-count">
        {`${sentryMockState?.messages.length ?? 0}:${sentryMockState?.logs.length ?? 0}`}
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
  const startupGlobal = globalThis as StartupTelemetryGlobal;
  startupGlobal.__smartLearningNotesSentryStartupCaptured = false;
  startupGlobal.__sentryMockState?.messages.splice(0);
  startupGlobal.__sentryMockState?.logs.splice(0);
  startupGlobal.__sentryMockState?.breadcrumbs.splice(0);
  this.screen = render(<StartupTelemetryHarness env={this.telemetryEnv} />);
});

When('the app records a diagnostic checkpoint', function (this: StartupTelemetryWorld) {
  const startupGlobal = globalThis as StartupTelemetryGlobal;
  startupGlobal.__sentryMockState?.messages.splice(0);
  startupGlobal.__sentryMockState?.logs.splice(0);
  startupGlobal.__sentryMockState?.breadcrumbs.splice(0);

  logTelemetryCheckpoint('study.submitAnswer.integration.checkpoint', {
    checkpoint: 'integration.checkpoint',
    hasFeedback: true,
  });
});

Then(
  'startup telemetry reports native replay and profiling disabled',
  function (this: StartupTelemetryWorld) {
  assert.equal(this.screen!.getByTestId('startup-replay-status').props.children, 'disabled');
  assert.equal(this.screen!.getByTestId('startup-profiling-status').props.children, 'disabled');
  },
);

Then('startup telemetry reports Sentry enabled', function (this: StartupTelemetryWorld) {
  assert.equal(this.screen!.getByTestId('startup-sentry-status').props.children, 'enabled');
});

Then('startup telemetry emits one Sentry startup signal', function (this: StartupTelemetryWorld) {
  assert.equal(this.screen!.getByTestId('startup-sentry-signal-count').props.children, '1:1');
});

Then(
  'startup telemetry emits one diagnostic log and breadcrumb',
  function () {
    const sentryMockState = (globalThis as StartupTelemetryGlobal).__sentryMockState;
    assert.equal(sentryMockState?.logs.length, 1);
    assert.equal(sentryMockState?.breadcrumbs.length, 1);
  },
);
