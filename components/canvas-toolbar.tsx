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
  variant?: 'inline' | 'floating';
};

const COLORS = [
  { name: 'Black', value: '#0f172a' },
  { name: 'Blue', value: '#2563eb' },
  { name: 'Red', value: '#dc2626' },
  { name: 'Green', value: '#16a34a' },
  { name: 'Purple', value: '#9333ea' },
  { name: 'Orange', value: '#ea580c' },
];

export const CanvasToolbar = ({
  mode,
  color,
  onModeChange,
  onColorChange,
  onClear,
  onUndo,
  variant = 'inline',
}: Props) => {
  const floating = variant === 'floating';

  return (
    <View style={[styles.container, floating && styles.containerFloating]}>
      <View style={styles.section}>
        <Pressable
          style={[
            styles.toolButton,
            floating && styles.toolButtonFloating,
            mode === 'pen' && styles.toolButtonActive,
          ]}
          onPress={() => onModeChange('pen')}
          accessibilityRole="button"
          accessibilityLabel="Pen"
        >
          <Ionicons
            name="pencil"
            size={20}
            color={mode === 'pen' ? '#fff' : floating ? '#cbd5e1' : '#64748b'}
          />
          {!floating && (
            <ThemedText
              style={[styles.toolLabel, mode === 'pen' && styles.toolLabelActive]}
            >
              Pen
            </ThemedText>
          )}
        </Pressable>
        <Pressable
          style={[
            styles.toolButton,
            floating && styles.toolButtonFloating,
            mode === 'eraser' && styles.toolButtonActive,
          ]}
          onPress={() => onModeChange('eraser')}
          accessibilityRole="button"
          accessibilityLabel="Eraser"
        >
          <Ionicons
            name="backspace-outline"
            size={20}
            color={mode === 'eraser' ? '#fff' : floating ? '#cbd5e1' : '#64748b'}
          />
          {!floating && (
            <ThemedText
              style={[styles.toolLabel, mode === 'eraser' && styles.toolLabelActive]}
            >
              Eraser
            </ThemedText>
          )}
        </Pressable>
      </View>

      <View style={styles.section}>
        {!floating && <ThemedText style={styles.sectionLabel}>Color</ThemedText>}
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
              accessibilityRole="button"
              accessibilityLabel={c.name}
            >
              {color === c.value && (
                <Ionicons name="checkmark" size={14} color="#fff" />
              )}
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Pressable
          style={[styles.actionButton, floating && styles.actionButtonFloating]}
          onPress={onUndo}
          accessibilityRole="button"
          accessibilityLabel="Undo"
        >
          <Ionicons
            name="arrow-undo"
            size={18}
            color={floating ? '#cbd5e1' : '#64748b'}
          />
          {!floating && <ThemedText style={styles.actionLabel}>Undo</ThemedText>}
        </Pressable>
        <Pressable
          style={[
            styles.actionButton,
            styles.clearButton,
            floating && styles.clearButtonFloating,
          ]}
          onPress={onClear}
          accessibilityRole="button"
          accessibilityLabel="Clear canvas"
        >
          <Ionicons name="trash-outline" size={18} color="#dc2626" />
          {!floating && (
            <ThemedText style={[styles.actionLabel, styles.clearLabel]}>
              Clear
            </ThemedText>
          )}
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
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 8,
    gap: 14,
    flexWrap: 'wrap',
  },
  containerFloating: {
    alignSelf: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.94)',
    borderColor: 'rgba(148, 163, 184, 0.35)',
    borderRadius: 18,
    padding: 7,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.24,
    shadowRadius: 22,
    elevation: 12,
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
  toolButtonFloating: {
    width: 38,
    height: 38,
    justifyContent: 'center',
    paddingHorizontal: 0,
    paddingVertical: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  toolButtonActive: {
    backgroundColor: '#4338ca',
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
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  colorButtonActive: {
    borderColor: '#fff',
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
  actionButtonFloating: {
    width: 38,
    height: 38,
    justifyContent: 'center',
    paddingHorizontal: 0,
    paddingVertical: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  actionLabel: {
    fontSize: 12,
    color: '#64748b',
  },
  clearButton: {
    backgroundColor: '#fef2f2',
  },
  clearButtonFloating: {
    backgroundColor: 'rgba(239, 68, 68, 0.14)',
  },
  clearLabel: {
    color: '#dc2626',
  },
});

