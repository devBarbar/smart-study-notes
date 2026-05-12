const appJson = require('./app.json');

const sentryOrg = process.env.SENTRY_ORG;
const sentryProject = process.env.SENTRY_PROJECT;

const plugins = [...(appJson.expo.plugins ?? [])];

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

module.exports = {
  expo: {
    ...appJson.expo,
    plugins,
  },
};
