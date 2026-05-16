import React, { useMemo } from 'react';
import { TextInput as NativeTextInput, View } from 'react-native';

export const Host = ({ children, ...props }: any) =>
  React.createElement(View, props, children);

export const TextInput = (props: Record<string, unknown>) =>
  React.createElement(NativeTextInput, props);

export const useNativeState = (value: unknown) =>
  useMemo(() => ({ value }), [value]);
