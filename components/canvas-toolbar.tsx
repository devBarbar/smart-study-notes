import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { CanvasMode } from './handwriting-canvas';
import { ThemedText } from './themed-text';

type Props = {
  mode: CanvasMode;
  color: string;
  onModeChange: (mode: CanvasMode) => void;
  onColorChange: (color: string) => void;
  onClear: () => void;
  onUndo: () => void;
};

const COLORS = [
  { name: 'Black', value: '#0f172a' },
  { name: 'Blue', value: '#2563eb' },
  { name: 'Red', value: '#dc2626' },
  { name: 'Green', value: '#16a34a' },
  { name: 'Purple', value: '#9333ea' },
  { name: 'Orange', value: '#ea580c' },
];

export const CanvasToolbar = ({ mode, color, onModeChange, onColorChange, onClear, onUndo }: Props) => {
  return (
    <View style={styles.container}>
      {/* Mode selection */}
      <View style={styles.section}>
        <Pressable
          style={[styles.toolButton, mode === 'pen' && styles.toolButtonActive]}
          onPress={() => onModeChange('pen')}
        >
          <Ionicons name="pencil" size={20} color={mode === 'pen' ? '#fff' : '#64748b'} />
          <ThemedText style={[styles.toolLabel, mode === 'pen' && styles.toolLabelActive]}>Pen</ThemedText>
        </Pressable>
        <Pressable
          style={[styles.toolButton, mode === 'eraser' && styles.toolButtonActive]}
          onPress={() => onModeChange('eraser')}
        >
          <Ionicons name="backspace-outline" size={20} color={mode === 'eraser' ? '#fff' : '#64748b'} />
          <ThemedText style={[styles.toolLabel, mode === 'eraser' && styles.toolLabelActive]}>Eraser</ThemedText>
        </Pressable>
      </View>

      {/* Color palette */}
      <View style={styles.section}>
        <ThemedText style={styles.sectionLabel}>Color</ThemedText>
        <View style={styles.colorRow}>
          {COLORS.map((c) => (
            <Pressable
              key={c.value}
              style={[
                styles.colorButton,
                { backgroundColor: c.value },
                color === c.value && styles.colorButtonActive,
              ]}
              onPress={() => onColorChange(c.value)}
            >
              {color === c.value && (
                <Ionicons name="checkmark" size={14} color="#fff" />
              )}
            </Pressable>
          ))}
        </View>
      </View>

      {/* Actions */}
      <View style={styles.section}>
        <Pressable style={styles.actionButton} onPress={onUndo}>
          <Ionicons name="arrow-undo" size={18} color="#64748b" />
          <ThemedText style={styles.actionLabel}>Undo</ThemedText>
        </Pressable>
        <Pressable style={[styles.actionButton, styles.clearButton]} onPress={onClear}>
          <Ionicons name="trash-outline" size={18} color="#dc2626" />
          <ThemedText style={[styles.actionLabel, styles.clearLabel]}>Clear</ThemedText>
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 8,
    gap: 16,
    flexWrap: 'wrap',
  },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionLabel: {
    fontSize: 12,
    color: '#94a3b8',
    marginRight: 4,
  },
  toolButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  toolButtonActive: {
    backgroundColor: '#0f172a',
  },
  toolLabel: {
    fontSize: 13,
    color: '#64748b',
  },
  toolLabelActive: {
    color: '#fff',
  },
  colorRow: {
    flexDirection: 'row',
    gap: 6,
  },
  colorButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorButtonActive: {
    borderColor: '#0f172a',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    backgroundColor: '#f1f5f9',
  },
  actionLabel: {
    fontSize: 12,
    color: '#64748b',
  },
  clearButton: {
    backgroundColor: '#fef2f2',
  },
  clearLabel: {
    color: '#dc2626',
  },
});



