import { StyleSheet, Text, type StyleProp } from 'react-native';

type MathViewProps = {
  math: string;
  color?: string;
  resizeMode?: string;
  style?: StyleProp<unknown>;
};

const MathView = ({ math, color, style }: MathViewProps) => (
  <Text style={[styles.math, color ? { color } : null, style]}>{math}</Text>
);

const styles = StyleSheet.create({
  math: {
    fontFamily: 'monospace',
  },
});

export default MathView;
