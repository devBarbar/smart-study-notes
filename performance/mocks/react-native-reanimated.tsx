import React from 'react';
import { View } from 'react-native';

const createAnimatedComponent = <T,>(Component: T) => Component;

const Animated = {
  View,
  createAnimatedComponent,
};

export default Animated;
export { createAnimatedComponent };
export const useSharedValue = (value: unknown) => ({ value });
export const useAnimatedStyle = (factory: () => unknown) => factory();
export const getUseOfValueInStyleWarning = () => undefined;
