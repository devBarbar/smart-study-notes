const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;
const isEasBuild = process.env.EAS_BUILD === 'true' || Boolean(process.env.EAS_BUILD_PROFILE);
const requiredBuildEnv = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'];

if (isEasBuild) {
  const missing = requiredBuildEnv.filter((name) => !process.env[name]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required EAS build environment variables: ${missing.join(', ')}. ` +
        'Load .env.local for local builds or configure them in EAS before creating a release.'
    );
  }
}

module.exports = ({ config }) => {
  const plugins = [...(config.plugins ?? [])];

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
    plugins,
  };
};
