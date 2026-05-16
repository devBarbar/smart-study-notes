import path from 'node:path';
import Module from 'node:module';
import React from 'react';

process.env.EXPO_PUBLIC_SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://unit-test.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'unit-test-anon-key';

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
      captureException: () => undefined,
      startSpan: (_options: unknown, callback: () => unknown) => callback(),
      addBreadcrumb: () => undefined,
      addIntegration: () => undefined,
      supabaseIntegration: () => ({}),
      wrap: (component: unknown) => component,
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
