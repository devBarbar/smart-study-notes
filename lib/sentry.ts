import Constants from 'expo-constants';
import { Platform } from 'react-native';
import * as Sentry from '@sentry/react-native';

const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const SENTRY_ENVIRONMENT =
  process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development';
const SENTRY_TRACES_SAMPLE_RATE = Number(process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? '1');
const SENTRY_PROFILES_SAMPLE_RATE = Number(process.env.EXPO_PUBLIC_SENTRY_PROFILES_SAMPLE_RATE ?? '1');
const SENTRY_REPLAY_SESSION_SAMPLE_RATE = Number(
  process.env.EXPO_PUBLIC_SENTRY_REPLAY_SESSION_SAMPLE_RATE ?? '0.1'
);
const SENTRY_DEBUG = process.env.EXPO_PUBLIC_SENTRY_DEBUG === 'true';

const appVersion = Constants.expoConfig?.version ?? '0.0.0';
const appSlug = Constants.expoConfig?.slug ?? 'smart-learning-notes';
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;

const parseSampleRate = (value: number, fallback: number) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
};

const tracePropagationTargets = [
  ...(supabaseUrl ? [supabaseUrl] : []),
  /^https:\/\/.*\.supabase\.co\/functions\/v1\//,
  /^http:\/\/localhost(:\d+)?\/functions\/v1\//,
  /^http:\/\/127\.0\.0\.1(:\d+)?\/functions\/v1\//,
];

Sentry.init({
  dsn: SENTRY_DSN,
  enabled: Boolean(SENTRY_DSN),
  debug: SENTRY_DEBUG,
  environment: SENTRY_ENVIRONMENT,
  release: `${appSlug}@${appVersion}`,
  dist: Platform.OS,
  sendDefaultPii: true,
  enableLogs: true,
  enableCaptureFailedRequests: true,
  enableUserInteractionTracing: true,
  attachViewHierarchy: true,
  tracesSampleRate: parseSampleRate(SENTRY_TRACES_SAMPLE_RATE, 1),
  profilesSampleRate: parseSampleRate(SENTRY_PROFILES_SAMPLE_RATE, 1),
  replaysOnErrorSampleRate: 1,
  replaysSessionSampleRate: parseSampleRate(SENTRY_REPLAY_SESSION_SAMPLE_RATE, 0.1),
  tracePropagationTargets,
});

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
