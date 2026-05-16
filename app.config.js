const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;
const isEasBuild = process.env.EAS_BUILD === 'true' || Boolean(process.env.EAS_BUILD_PROFILE);
const shouldValidatePublicEnv =
  isEasBuild || process.env.REQUIRE_EXPO_PUBLIC_ENV === 'true';
const requiredBuildEnv = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'];
const requiredProductionTelemetryEnv = [
  'EXPO_PUBLIC_SENTRY_DSN',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
];
const isProductionRelease =
  process.env.NODE_ENV === 'production' ||
  process.env.EAS_BUILD_PROFILE === 'production' ||
  process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT === 'production';

if (shouldValidatePublicEnv) {
  const missing = requiredBuildEnv.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required Expo public environment variables: ${missing.join(', ')}. ` +
        'Load .env.local for local builds, or configure them in the selected EAS environment ' +
        'and run updates with --environment.'
    );
  }
}

if (shouldValidatePublicEnv && isProductionRelease) {
  const missing = requiredProductionTelemetryEnv.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required Expo production telemetry environment variables: ${missing.join(', ')}. ` +
        'Configure them in the production EAS environment or load them before running a release build.'
    );
  }
}

module.exports = ({ config }) => {
  const plugins = [...(config.plugins ?? [])];
  const hasPlugin = (name) =>
    plugins.some((plugin) => plugin === name || plugin?.[0] === name);

  if (!hasPlugin('expo-sharing')) {
    plugins.push('expo-sharing');
  }
  if (!hasPlugin('@config-plugins/react-native-blob-util')) {
    plugins.push('@config-plugins/react-native-blob-util');
  }
  if (!hasPlugin('@config-plugins/react-native-pdf')) {
    plugins.push('@config-plugins/react-native-pdf');
  }
  const runtimeVersion =
    process.env.EXPO_UPDATES_FINGERPRINT_OVERRIDE ?? config.runtimeVersion;

  if (sentryOrg && sentryProject) {
    plugins.push([
      '@sentry/react-native/expo',
      {
        url: process.env.SENTRY_URL ?? 'https://sentry.io/',
        organization: sentryOrg,
        project: sentryProject,
      },
    ]);
  }

  return {
    ...config,
    runtimeVersion,
    plugins,
  };
};
