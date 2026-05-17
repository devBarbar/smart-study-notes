global.__DEV__ = true;
process.env.EXPO_PUBLIC_SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://unit-test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'unit-test-anon-key';

const Module = require('module');
const path = require('path');
const React = require('react');

const originalLoad = Module._load;
const projectRoot = path.resolve(__dirname, '..', '..');
const sentryMockState = {
  messages: [],
  logs: [],
};
global.__sentryMockState = sentryMockState;
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
  useColorScheme: () => 'light',
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

  if (request === 'expo-secure-store') {
    return {
      getItemAsync: async () => null,
      setItemAsync: async () => undefined,
      deleteItemAsync: async () => undefined,
    };
  }

  if (request === '@sentry/react-native') {
    return {
      init: () => undefined,
      setUser: () => undefined,
      captureMessage: (message, context) => {
        sentryMockState.messages.push({ message, context });
        return 'test-message-id';
      },
      captureException: () => undefined,
      startSpan: (_options, callback) => callback(),
      addBreadcrumb: () => undefined,
      addIntegration: () => undefined,
      logger: {
        info: (message, attributes) => {
          sentryMockState.logs.push({ level: 'info', message, attributes });
        },
      },
      supabaseIntegration: () => ({}),
      wrap: (component) => component,
    };
  }

  if (request === '@expo/vector-icons') {
    return {
      Ionicons: hostComponent('Ionicons'),
    };
  }

  if (request.startsWith('@/')) {
    return originalLoad.call(
      this,
      path.join(projectRoot, request.slice(2)),
      parent,
      isMain,
    );
  }

  return originalLoad.apply(this, arguments);
};

require('@babel/register')({
  presets: ['babel-preset-expo'],
  extensions: ['.js', '.jsx', '.ts', '.tsx'],
  ignore: [/node_modules\/(?!@testing-library\/react-native)/],
});
