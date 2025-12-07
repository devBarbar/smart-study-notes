import { StyleSheet, Text, type TextProps } from 'react-native';

import { Colors, Fonts, Typography } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useThemeColor } from '@/hooks/use-theme-color';

export type ThemedTextProps = TextProps & {
  lightColor?: string;
  darkColor?: string;
  type?:
    | 'default'
    | 'title'
    | 'display'
    | 'defaultSemiBold'
    | 'subtitle'
    | 'label'
    | 'caption'
    | 'link';
  tone?: 'default' | 'muted' | 'primary' | 'inverse' | 'danger' | 'success';
};

export function ThemedText({
  style,
  lightColor,
  darkColor,
  type = 'default',
  tone = 'default',
  ...rest
}: ThemedTextProps) {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const color = useThemeColor(
    { light: lightColor, dark: darkColor },
    tone === 'muted'
      ? 'textMuted'
      : tone === 'primary'
      ? 'primary'
      : tone === 'inverse'
      ? 'textOnPrimary'
      : tone === 'danger'
      ? 'danger'
      : tone === 'success'
      ? 'success'
      : 'text'
  );

  return (
    <Text
      style={[
        { color, fontFamily: Fonts?.sans },
        type === 'default' && typography.default,
        type === 'title' && typography.title,
        type === 'display' && typography.display,
        type === 'subtitle' && typography.subtitle,
        type === 'label' && typography.label,
        type === 'caption' && typography.caption,
        type === 'defaultSemiBold' && typography.defaultSemiBold,
        type === 'link' && [typography.defaultSemiBold, { color: palette.primary }],
        style,
      ]}
      {...rest}
    />
  );
}

const typography = StyleSheet.create({
  default: {
    ...Typography.body,
  },
  defaultSemiBold: {
    ...Typography.body,
    fontWeight: '600',
  },
  title: {
    ...Typography.title,
  },
  display: {
    ...Typography.display,
  },
  subtitle: {
    ...Typography.subtitle,
  },
  label: {
    ...Typography.label,
  },
  caption: {
    ...Typography.footnote,
  },
});
