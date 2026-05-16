module.exports = {
  default: {
    paths: ['features/**/*.feature'],
    require: [
      'features/support/bootstrap.js',
      'features/support/**/*.ts',
      'features/step-definitions/**/*.{ts,tsx}',
    ],
    format: ['progress'],
    publishQuiet: true,
  },
};
