/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from 'react-native';

const paletteLight = {
  text: '#0f172a',
  textMuted: '#475569',
  textOnPrimary: '#f8fafc',
  background: '#f6f7fb',
  surface: '#ffffff',
  surfaceAlt: '#eef2ff',
  border: '#e2e8f0',
  tint: '#4338ca',
  primary: '#4338ca',
  primaryStrong: '#312e81',
  accent: '#06b6d4',
  icon: '#64748b',
  tabIconDefault: '#94a3b8',
  tabIconSelected: '#4338ca',
  muted: '#e2e8f0',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  overlay: 'rgba(15, 23, 42, 0.06)',
  shadow: 'rgba(15, 23, 42, 0.12)',
  glass: 'rgba(255, 255, 255, 0.72)',
  gradientStart: '#0f172a',
  gradientEnd: '#312e81',
};

const paletteDark = {
  text: '#e2e8f0',
  textMuted: '#94a3b8',
  textOnPrimary: '#e2e8f0',
  background: '#0b1220',
  surface: '#111827',
  surfaceAlt: '#1f2937',
  border: '#1f2937',
  tint: '#a5b4fc',
  primary: '#a5b4fc',
  primaryStrong: '#6366f1',
  accent: '#06b6d4',
  icon: '#cbd5e1',
  tabIconDefault: '#94a3b8',
  tabIconSelected: '#a5b4fc',
  muted: '#1f2937',
  success: '#22c55e',
  warning: '#fbbf24',
  danger: '#f87171',
  overlay: 'rgba(255, 255, 255, 0.06)',
  shadow: 'rgba(0, 0, 0, 0.35)',
  glass: 'rgba(17, 24, 39, 0.72)',
  gradientStart: '#0f172a',
  gradientEnd: '#312e81',
};

export const Colors = {
  light: paletteLight,
  dark: paletteDark,
};

export const Gradients = {
  hero: [paletteLight.gradientStart, paletteLight.gradientEnd],
  card: ['rgba(67, 56, 202, 0.08)', 'rgba(6, 182, 212, 0.08)'],
  primary: [paletteLight.primaryStrong, paletteLight.accent],
};

export const Spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
};

export const Radii = {
  sm: 10,
  md: 14,
  lg: 20,
  pill: 999,
};

export const Shadows = {
  sm: {
    shadowColor: paletteLight.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  md: {
    shadowColor: paletteLight.shadow,
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
};

export const Typography = {
  display: {
    fontSize: 30,
    lineHeight: 38,
    fontWeight: '700',
  },
  title: {
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 18,
    lineHeight: 26,
    fontWeight: '600',
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
  },
  label: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  footnote: {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.2,
  },
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
