const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;
const isEasBuild = process.env.EAS_BUILD === 'true' || Boolean(process.env.EAS_BUILD_PROFILE);
const shouldValidatePublicEnv =
  isEasBuild || process.env.REQUIRE_EXPO_PUBLIC_ENV === 'true';
const requiredBuildEnv = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'];

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

module.exports = ({ config }) => {
  const plugins = [...(config.plugins ?? [])];
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
