declare module 'react-native-math-view' {
  import type { ComponentType } from 'react';
  import type { StyleProp, ViewStyle } from 'react-native';

  type MathViewProps = {
    math: string;
    color?: string;
    resizeMode?: 'contain' | 'cover' | 'stretch' | 'center';
    style?: StyleProp<ViewStyle>;
  };

  const MathView: ComponentType<MathViewProps>;
  export default MathView;
}
