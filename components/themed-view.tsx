import { View, type ViewProps } from 'react-native';

import { Colors, Radii, Shadows } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useThemeColor } from '@/hooks/use-theme-color';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
  variant?: 'plain' | 'muted' | 'surface' | 'card' | 'tinted';
  padded?: boolean;
};

export function ThemedView({
  style,
  lightColor,
  darkColor,
  variant = 'plain',
  padded = false,
  ...otherProps
}: ThemedViewProps) {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const backgroundColor = useThemeColor({ light: lightColor, dark: darkColor }, 'background');

  const variantStyle = (() => {
    switch (variant) {
      case 'muted':
        return {
          backgroundColor: palette.muted,
          borderRadius: Radii.md,
        };
      case 'surface':
        return {
          backgroundColor: palette.surface,
          borderRadius: Radii.md,
          borderWidth: 1,
          borderColor: palette.border,
        };
      case 'card':
        return {
          backgroundColor: palette.surface,
          borderRadius: Radii.lg,
          borderWidth: 1,
          borderColor: palette.border,
          ...Shadows.sm,
        };
      case 'tinted':
        return {
          backgroundColor: palette.surfaceAlt,
          borderRadius: Radii.lg,
          borderWidth: 1,
          borderColor: palette.border,
        };
      default:
        return {};
    }
  })();

  return (
    <View
      style={[
        { backgroundColor, ...(padded ? { padding: 16 } : {}) },
        variantStyle,
        style,
      ]}
      {...otherProps}
    />
  );
}
