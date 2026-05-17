import path from 'node:path';
import Module from 'node:module';
import React from 'react';

process.env.EXPO_PUBLIC_SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://unit-test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'unit-test-anon-key';
process.env.EXPO_PUBLIC_SENTRY_DSN =
  process.env.EXPO_PUBLIC_SENTRY_DSN ?? 'https://example@sentry.io/1';
process.env.EXPO_PUBLIC_SENTRY_DEBUG =
  process.env.EXPO_PUBLIC_SENTRY_DEBUG ?? 'false';
process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT =
  process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? 'production';
process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE =
  process.env.EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? '1';

(globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

type ModuleLoader = (
  request: string,
  parent: NodeModule | null,
  isMain: boolean,
) => unknown;

const moduleWithLoader = Module as unknown as {
  _load: ModuleLoader;
};
const originalLoad = moduleWithLoader._load;
const projectRoot = path.resolve(__dirname, '..', '..');
const sentryMockState = {
  messages: [] as Array<{ message: string; context: unknown }>,
  logs: [] as Array<{ level: string; message: string; attributes: unknown }>,
  breadcrumbs: [] as Array<{ category?: string; message?: string; data?: unknown }>,
};

(globalThis as typeof globalThis & { __sentryMockState?: typeof sentryMockState }).__sentryMockState =
  sentryMockState;

const hostComponent = (name: string) =>
  React.forwardRef(({ children, ...props }: any, ref) =>
    React.createElement(name, { ...props, ref }, children),
  );

const reactNativeShim = {
  AccessibilityInfo: {},
  ActivityIndicator: hostComponent('ActivityIndicator'),
  FlatList: hostComponent('FlatList'),
  I18nManager: { isRTL: false },
  Modal: hostComponent('Modal'),
  Platform: {
    OS: 'ios',
    select: (values: Record<string, unknown>) => values.ios ?? values.default,
  },
  Pressable: hostComponent('Pressable'),
  ScrollView: hostComponent('ScrollView'),
  StyleSheet: {
    create: (styles: unknown) => styles,
    flatten: (style: unknown) => style,
  },
  Text: hostComponent('Text'),
  TextInput: hostComponent('TextInput'),
  View: hostComponent('View'),
  findNodeHandle: () => null,
  useColorScheme: () => 'light',
};

const loadPatchedModule = function (
  this: unknown,
  request: string,
  parent: NodeModule | null,
  isMain: boolean,
) {
  if (request === 'react-native') {
    return reactNativeShim;
  }

  if (request === 'expo-secure-store') {
    return {
      getItemAsync: async () => null,
      setItemAsync: async () => undefined,
      deleteItemAsync: async () => undefined,
    };
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
      captureMessage: (message: string, context: unknown) => {
        sentryMockState.messages.push({ message, context });
        return 'test-message-id';
      },
      captureException: () => undefined,
      startSpan: (_options: unknown, callback: () => unknown) => callback(),
      addBreadcrumb: (breadcrumb: { category?: string; message?: string; data?: unknown }) => {
        sentryMockState.breadcrumbs.push(breadcrumb);
      },
      addIntegration: () => undefined,
      logger: {
        info: (message: string, attributes: unknown) => {
          sentryMockState.logs.push({ level: 'info', message, attributes });
        },
      },
      supabaseIntegration: () => ({}),
      wrap: (component: unknown) => component,
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

  return originalLoad.call(this, request, parent, isMain);
};

moduleWithLoader._load = loadPatchedModule;
