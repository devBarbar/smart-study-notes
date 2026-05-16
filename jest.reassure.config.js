module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/performance/**/*.perf-test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/performance/setup.ts'],
  transform: {
    '^.+\\.[jt]sx?$': ['babel-jest', { presets: ['babel-preset-expo'] }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^react-native$': '<rootDir>/performance/mocks/react-native.tsx',
    '^react-native-gesture-handler$':
      '<rootDir>/performance/mocks/react-native-gesture-handler.tsx',
    '^react-native-reanimated$':
      '<rootDir>/performance/mocks/react-native-reanimated.tsx',
    '^react-native-view-shot$':
      '<rootDir>/performance/mocks/react-native-view-shot.tsx',
    '^@shopify/react-native-skia$':
      '<rootDir>/performance/mocks/react-native-skia.tsx',
    '^react-native-svg$': '<rootDir>/performance/mocks/react-native-svg.tsx',
    '^expo-file-system/legacy$':
      '<rootDir>/performance/mocks/expo-file-system-legacy.ts',
    '^@expo/vector-icons$': '<rootDir>/performance/mocks/expo-vector-icons.tsx',
    '^@expo/ui$': '<rootDir>/performance/mocks/expo-ui.tsx',
    '^expo-glass-effect$': '<rootDir>/performance/mocks/expo-glass-effect.tsx',
    '^uuid$': '<rootDir>/performance/mocks/uuid.ts',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@testing-library/react-native|react-native|@react-native)/)',
  ],
};
