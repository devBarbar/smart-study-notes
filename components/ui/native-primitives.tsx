import { PropsWithChildren } from 'react';
import {
  Pressable,
  TextInput as RNTextInput,
  StyleSheet,
  Text,
  View,
  type ColorValue,
  type KeyboardTypeOptions,
  type NativeSyntheticEvent,
  type TextInputSubmitEditingEventData,
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
  autoComplete?: React.ComponentProps<typeof RNTextInput>['autoComplete'];
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
  glassEffectStyle?: 'clear' | 'regular';
  isInteractive?: boolean;
  testID?: string;
}>;

export const isLiquidGlassSupported = () => false;

export function LiquidGlassSurface({
  children,
  style,
  spacing: _spacing = 12,
  tintColor: _tintColor,
  glassEffectStyle: _glassEffectStyle = 'regular',
  isInteractive: _isInteractive = false,
  testID,
}: LiquidGlassSurfaceProps) {
  return (
    <View style={style} testID={testID}>
      {children}
    </View>
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        variant === 'outlined' && styles.outlinedButton,
        variant === 'text' && styles.textButton,
        style as StyleProp<ViewStyle>,
        (pressed || disabled) && styles.buttonPressedOrDisabled,
      ]}
    >
      <Text
        style={[
          styles.buttonText,
          variant === 'outlined' && styles.outlinedButtonText,
          variant === 'text' && styles.textButtonText,
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
  const handleSubmitEditing = (
    event: NativeSyntheticEvent<TextInputSubmitEditingEventData>
  ) => {
    onSubmitEditing?.(event.nativeEvent.text);
  };

  return (
    <RNTextInput
      value={value}
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
      style={[style as StyleProp<TextStyle>, textStyle]}
      numberOfLines={numberOfLines}
      maxLength={maxLength}
      onSubmitEditing={handleSubmitEditing}
    />
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressedOrDisabled: {
    opacity: 0.65,
  },
  buttonText: {
    color: '#ffffff',
    fontWeight: '600',
    textAlign: 'center',
  },
  outlinedButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  outlinedButtonText: {
    color: '#0f172a',
  },
  textButton: {
    backgroundColor: 'transparent',
  },
  textButtonText: {
    color: '#0f172a',
  },
});
