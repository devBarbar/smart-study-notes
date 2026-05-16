import React from 'react';

const hostComponent = (name: string) =>
  React.forwardRef(({ children, style, ...props }: any, ref) => {
    const resolvedStyle =
      typeof style === 'function' ? style({ pressed: false }) : style;
    return React.createElement(name, { ...props, ref, style: resolvedStyle }, children);
  });

export const View = hostComponent('View');
export const Text = hostComponent('Text');
export const Pressable = hostComponent('Pressable');
export const ScrollView = hostComponent('ScrollView');
export const Image = hostComponent('Image');
export const TextInput = hostComponent('TextInput');
export const TouchableOpacity = hostComponent('TouchableOpacity');
export const ActivityIndicator = hostComponent('ActivityIndicator');

export const Modal = ({ children, visible = true, ...props }: any) =>
  visible ? React.createElement('Modal', props, children) : null;

export const StyleSheet = {
  absoluteFill: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  create: <T extends Record<string, unknown>>(styles: T) => styles,
  flatten: (style: unknown) => {
    if (!Array.isArray(style)) return style;
    return Object.assign({}, ...style.filter(Boolean));
  },
};

export const Platform = {
  OS: 'ios',
  select: (values: Record<string, unknown>) => values.ios ?? values.default,
};

export const useWindowDimensions = () => ({
  width: 1024,
  height: 900,
  scale: 1,
  fontScale: 1,
});

export const useColorScheme = () => 'light';
export const findNodeHandle = () => null;
export const AccessibilityInfo = {};
export const I18nManager = { isRTL: false };
