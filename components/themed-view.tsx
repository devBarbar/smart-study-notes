import { View, type ViewProps } from 'react-native';

import { LiquidGlassSurface, isLiquidGlassSupported } from '@/components/ui/native-primitives';
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
  const palette = Colors[colorScheme === 'dark' ? 'dark' : 'light'];
  const backgroundColor = useThemeColor({ light: lightColor, dark: darkColor }, 'background');
  const glassEnabled =
    isLiquidGlassSupported() &&
    (variant === 'surface' || variant === 'card' || variant === 'tinted');

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

  const resolvedStyle = [
    { backgroundColor: glassEnabled ? 'transparent' : backgroundColor, ...(padded ? { padding: 16 } : {}) },
    variantStyle,
    style,
  ];

  if (glassEnabled) {
    return (
      <LiquidGlassSurface
        style={resolvedStyle}
        tintColor={palette.surface}
        isInteractive={variant === 'card'}
        {...otherProps}
      />
    );
  }

  return <View style={resolvedStyle} {...otherProps} />;
}
