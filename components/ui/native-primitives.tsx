import {
  Host,
  TextInput as ExpoTextInput,
  useNativeState,
} from '@expo/ui';
import {
  GlassContainer,
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
} from 'expo-glass-effect';
import { PropsWithChildren, useEffect } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ColorValue,
  type KeyboardTypeOptions,
  type ReturnKeyTypeOptions,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

type NativeButtonProps = {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  testID?: string;
  variant?: 'filled' | 'outlined' | 'text';
  style?: StyleProp<ViewStyle | TextStyle>;
  textStyle?: StyleProp<TextStyle>;
};

type NativeTextInputProps = {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  editable?: boolean;
  secureTextEntry?: boolean;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  returnKeyType?: ReturnKeyTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  autoComplete?: React.ComponentProps<typeof ExpoTextInput>['autoComplete'];
  placeholderTextColor?: ColorValue;
  testID?: string;
  style?: StyleProp<ViewStyle | TextStyle>;
  textStyle?: StyleProp<TextStyle>;
  numberOfLines?: number;
  maxLength?: number;
  onSubmitEditing?: (text: string) => void;
};

type LiquidGlassSurfaceProps = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  spacing?: number;
  tintColor?: string;
  glassEffectStyle?: React.ComponentProps<typeof GlassView>['glassEffectStyle'];
  isInteractive?: boolean;
  testID?: string;
}>;

export const isLiquidGlassSupported = () => {
  if (Platform.OS !== 'ios') return false;

  try {
    return isLiquidGlassAvailable() && isGlassEffectAPIAvailable();
  } catch {
    return false;
  }
};

export function LiquidGlassSurface({
  children,
  style,
  spacing = 12,
  tintColor,
  glassEffectStyle = 'regular',
  isInteractive = false,
  testID,
}: LiquidGlassSurfaceProps) {
  if (!isLiquidGlassSupported()) {
    return (
      <View style={style} testID={testID}>
        {children}
      </View>
    );
  }

  return (
    <GlassContainer spacing={spacing} style={styles.glassContainer} testID={testID}>
      <GlassView
        glassEffectStyle={glassEffectStyle}
        tintColor={tintColor}
        isInteractive={isInteractive}
        style={style}
      >
        {children}
      </GlassView>
    </GlassContainer>
  );
}

export function NativeButton({
  label,
  onPress,
  disabled = false,
  testID,
  variant = 'filled',
  style,
  textStyle,
}: NativeButtonProps) {
  const flattenedTextStyle = StyleSheet.flatten(textStyle);
  const defaultTextColor = variant === 'filled' ? '#ffffff' : '#111827';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        variant === 'text' && styles.textButton,
        style as StyleProp<ViewStyle>,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
    >
      <Text
        numberOfLines={2}
        style={[
          styles.buttonLabel,
          { color: flattenedTextStyle?.color ?? defaultTextColor },
          textStyle,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function NativeTextInput({
  value,
  onChangeText,
  placeholder,
  editable,
  secureTextEntry,
  multiline,
  keyboardType,
  returnKeyType,
  autoCapitalize,
  autoCorrect,
  autoComplete,
  placeholderTextColor,
  testID,
  style,
  textStyle,
  numberOfLines,
  maxLength,
  onSubmitEditing,
}: NativeTextInputProps) {
  const nativeValue = useNativeState(value);

  useEffect(() => {
    if (nativeValue.value !== value) {
      nativeValue.value = value;
    }
  }, [nativeValue, value]);

  return (
    <Host matchContents={{ vertical: true }} style={style as StyleProp<ViewStyle>}>
      <ExpoTextInput
        value={nativeValue}
        onChangeText={onChangeText}
        placeholder={placeholder}
        editable={editable}
        secureTextEntry={secureTextEntry}
        multiline={multiline}
        keyboardType={keyboardType}
        returnKeyType={returnKeyType}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        autoComplete={autoComplete}
        placeholderTextColor={placeholderTextColor}
        testID={testID}
        style={StyleSheet.flatten(style) as React.ComponentProps<typeof ExpoTextInput>['style']}
        textStyle={
          StyleSheet.flatten(textStyle) as React.ComponentProps<typeof ExpoTextInput>['textStyle']
        }
        numberOfLines={numberOfLines}
        maxLength={maxLength}
        onSubmitEditing={onSubmitEditing}
      />
    </Host>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  textButton: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonLabel: {
    fontSize: 16,
    lineHeight: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
  glassContainer: {
    width: '100%',
  },
});
