import Constants from 'expo-constants';
import { Platform } from 'react-native';
import * as Sentry from '@sentry/react-native';

type SentryInitOptions = Parameters<typeof Sentry.init>[0];
type TelemetryEnv = Record<string, string | undefined>;
type TelemetryExpoConfig = {
  slug?: string;
  version?: string;
};
type BuildSentryInitOptionsParams = { env?: TelemetryEnv; expoConfig?: TelemetryExpoConfig | null; platformOS?: string };
const SUPABASE_FUNCTION_TRACE_TARGET = /^https:\/\/.*\.supabase\.co\/functions\/v1\//;
const LOCAL_FUNCTION_TRACE_TARGETS = [/^http:\/\/localhost(:\d+)?\/functions\/v1\//, /^http:\/\/127\.0\.0\.1(:\d+)?\/functions\/v1\//];
const STARTUP_TELEMETRY_MESSAGE = 'smart-learning-notes startup telemetry initialized';
const getRuntimeTelemetryEnv = (): TelemetryEnv => {
  const env: TelemetryEnv = {};
  env.NODE_ENV = process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV; env.EXPO_PUBLIC_SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
  env.EXPO_PUBLIC_SENTRY_ENABLE_PROFILING = process.env.EXPO_PUBLIC_SENTRY_ENABLE_PROFILING;
  env.EXPO_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE = process.env.EXPO_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE;
  env.EXPO_PUBLIC_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE = process.env.EXPO_PUBLIC_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE;
  env.EXPO_PUBLIC_SENTRY_REPLAY_SESSION_SAMPLE_RATE = process.env.EXPO_PUBLIC_SENTRY_REPLAY_SESSION_SAMPLE_RATE;
  env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE = process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE;
  env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
  return env;
};

const parseSampleRate = (value: number, fallback: number) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
};

export const buildSentryInitOptions = (params: BuildSentryInitOptionsParams = {}): SentryInitOptions => {
  const env = params.env ?? getRuntimeTelemetryEnv();
  const expoConfig = params.expoConfig ?? Constants.expoConfig;
  const platformOS = params.platformOS ?? Platform.OS;
  const sentryDsn = env.EXPO_PUBLIC_SENTRY_DSN;
  const appVersion = expoConfig?.version ?? '0.0.0';
  const appSlug = expoConfig?.slug ?? 'smart-learning-notes';
  const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL;
  const replaySessionSampleRate =
    env.EXPO_PUBLIC_SENTRY_REPLAY_SESSION_SAMPLE_RATE === undefined
      ? undefined
      : parseSampleRate(Number(env.EXPO_PUBLIC_SENTRY_REPLAY_SESSION_SAMPLE_RATE), 0);
  const replayOnErrorSampleRate =
    env.EXPO_PUBLIC_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE === undefined
      ? undefined
      : parseSampleRate(Number(env.EXPO_PUBLIC_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE), 0);
  const profilingEnabled = env.EXPO_PUBLIC_SENTRY_ENABLE_PROFILING === 'true';
  const profilesSampleRate =
    env.EXPO_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE === undefined
      ? undefined
      : parseSampleRate(Number(env.EXPO_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE), 0);
  const nativeTelemetryRiskDisabled = platformOS === 'ios' || platformOS === 'android';

  const options: SentryInitOptions = {
    dsn: sentryDsn,
    enabled: Boolean(sentryDsn),
    debug: env.EXPO_PUBLIC_SENTRY_DEBUG === 'true',
    environment:
      env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? env.NODE_ENV ?? 'development',
    release: `${appSlug}@${appVersion}`,
    dist: platformOS,
    sendDefaultPii: true,
    enableLogs: true,
    enableCaptureFailedRequests: true,
    enableUserInteractionTracing: true,
    attachViewHierarchy: true,
    tracesSampleRate: parseSampleRate(Number(env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? '1'), 1),
    tracePropagationTargets: [
      ...(supabaseUrl ? [supabaseUrl] : []),
      SUPABASE_FUNCTION_TRACE_TARGET,
      ...LOCAL_FUNCTION_TRACE_TARGETS,
    ],
  };

  if (!nativeTelemetryRiskDisabled && profilingEnabled && profilesSampleRate !== undefined && profilesSampleRate > 0) options.profilesSampleRate = profilesSampleRate;
  if (!nativeTelemetryRiskDisabled && replayOnErrorSampleRate !== undefined && replayOnErrorSampleRate > 0) options.replaysOnErrorSampleRate = replayOnErrorSampleRate;
  if (!nativeTelemetryRiskDisabled && replaySessionSampleRate !== undefined && replaySessionSampleRate > 0) options.replaysSessionSampleRate = replaySessionSampleRate;
  if (nativeTelemetryRiskDisabled) Object.assign(options, { profilesSampleRate: 0, replaysOnErrorSampleRate: 0, replaysSessionSampleRate: 0 });
  return options;
};

export const captureSentryStartupTelemetry = (options: SentryInitOptions) => {
  if (!options.enabled || !options.dsn) return;

  const startupGlobal = globalThis as typeof globalThis & Record<'__smartLearningNotesSentryStartupCaptured', boolean | undefined>;
  if (startupGlobal.__smartLearningNotesSentryStartupCaptured) return;
  startupGlobal.__smartLearningNotesSentryStartupCaptured = true;

  const attributes = {
    release: options.release,
    environment: options.environment,
    dist: options.dist,
  };

  Sentry.captureMessage(STARTUP_TELEMETRY_MESSAGE, {
    level: 'info',
    tags: { 'telemetry.source': 'startup' },
    extra: attributes,
  });
  Sentry.logger.info(STARTUP_TELEMETRY_MESSAGE, attributes);
};

const sentryInitOptions = buildSentryInitOptions();
Sentry.init(sentryInitOptions);
captureSentryStartupTelemetry(sentryInitOptions);

type TelemetryUser = {
  id?: string;
  email?: string | null;
};

export const setTelemetryUser = (user: TelemetryUser | null | undefined) => {
  if (!user?.id) {
    Sentry.setUser(null);
    return;
  }

  Sentry.setUser({
    id: user.id,
    email: user.email ?? undefined,
  });
};

export const captureTelemetryError = (
  error: unknown,
  context?: {
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
  }
) => {
  Sentry.captureException(error, {
    tags: context?.tags,
    extra: context?.extra,
  });
};

type TelemetryCheckpointAttributes = Record<string, string | number | boolean | null | undefined>;

/* c8 ignore start -- covered by unit tests; Cucumber's Babel/V8 mapping misses this wrapper declaration. */
export const logTelemetryCheckpoint = (
  message: string,
  attributes: TelemetryCheckpointAttributes = {},
) => {
  try {
    console.info(`[telemetry] ${message}`, attributes);
    Sentry.addBreadcrumb({
      category: 'telemetry.checkpoint',
      level: 'info',
      message,
      data: attributes,
    });
    Sentry.logger.info(message, attributes);
  } catch {
    // Telemetry must never interrupt the user flow we are trying to diagnose.
  }
};
/* c8 ignore stop */

export const traceAsyncOperation = async <T>(
  name: string,
  op: string,
  callback: () => Promise<T>,
  attributes?: Record<string, string | number | boolean | undefined>
): Promise<T> =>
  Sentry.startSpan(
    {
      name,
      op,
      forceTransaction: true,
      attributes,
    },
    async () => callback()
  );

export const addTelemetryBreadcrumb = Sentry.addBreadcrumb;
export const instrumentSupabaseTelemetry = (supabaseClient: unknown) => {
  Sentry.addIntegration(Sentry.supabaseIntegration({ supabaseClient }));
};
export const wrapWithTelemetry = Sentry.wrap;
