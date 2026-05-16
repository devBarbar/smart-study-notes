global.__DEV__ = true;
process.env.EXPO_PUBLIC_SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://unit-test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'unit-test-anon-key';

const Module = require('module');
const React = require('react');

const originalLoad = Module._load;
const hostComponent = (name) =>
  React.forwardRef(({ children, ...props }, ref) =>
    React.createElement(name, { ...props, ref }, children),
  );

const reactNativeShim = {
  AccessibilityInfo: {},
  I18nManager: { isRTL: false },
  Platform: {
    OS: 'ios',
    select: (values) => values.ios ?? values.default,
  },
  Pressable: hostComponent('Pressable'),
  StyleSheet: {
    create: (styles) => styles,
    flatten: (style) => style,
  },
  Text: hostComponent('Text'),
  View: hostComponent('View'),
  findNodeHandle: () => null,
};

Module._load = function load(request, parent, isMain) {
  if (request === 'react-native') {
    return reactNativeShim;
  }

  if (request === 'expo-constants') {
    return {
      __esModule: true,
      default: {
        expoConfig: {
          slug: 'smart-learning-notes',
          version: '1.0.0-test',
        },
      },
    };
  }

  if (request === '@sentry/react-native') {
    return {
      init: () => undefined,
      setUser: () => undefined,
      captureException: () => undefined,
      startSpan: (_options, callback) => callback(),
      addBreadcrumb: () => undefined,
      addIntegration: () => undefined,
      supabaseIntegration: () => ({}),
      wrap: (component) => component,
    };
  }

  return originalLoad.apply(this, arguments);
};

require('@babel/register')({
  presets: ['babel-preset-expo'],
  extensions: ['.js', '.jsx', '.ts', '.tsx'],
  ignore: [/node_modules\/(?!@testing-library\/react-native)/],
});
