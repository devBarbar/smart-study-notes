import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Text as SvgText } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getGradeColor, getGradeLabel, percentageToGrade } from '@/lib/mastery';
import { GermanGrade } from '@/types';

type CircularReadinessGraphProps = {
  percentage: number;
  predictedGrade?: GermanGrade;
  size?: number;
  strokeWidth?: number;
  summary?: string;
  onRefresh?: () => void;
  loading?: boolean;
  showRefreshButton?: boolean;
};

export const CircularReadinessGraph = ({
  percentage,
  predictedGrade,
  size = 120,
  strokeWidth = 10,
  summary,
  onRefresh,
  loading = false,
  showRefreshButton = true,
}: CircularReadinessGraphProps) => {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(palette), [palette]);

  const grade = predictedGrade ?? percentageToGrade(percentage);
  const gradeColor = getGradeColor(percentage);
  const gradeLabel = getGradeLabel(percentage);

  // SVG calculations
  const center = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progressOffset = circumference - (percentage / 100) * circumference;

  return (
    <View style={styles.container}>
      <View style={styles.graphContainer}>
        <Svg width={size} height={size}>
          <G rotation="-90" origin={`${center}, ${center}`}>
            {/* Background circle */}
            <Circle
              cx={center}
              cy={center}
              r={radius}
              stroke={palette.muted}
              strokeWidth={strokeWidth}
              fill="none"
            />
            {/* Progress circle */}
            <Circle
              cx={center}
              cy={center}
              r={radius}
              stroke={gradeColor}
              strokeWidth={strokeWidth}
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={progressOffset}
              strokeLinecap="round"
            />
          </G>
        </Svg>
        {/* Center content */}
        <View style={[styles.centerContent, { width: size, height: size }]}>
          <ThemedText style={[styles.percentageText, { color: gradeColor }]}>
            {Math.round(percentage)}%
          </ThemedText>
          <ThemedText style={[styles.gradeText, { color: gradeColor }]}>
            {grade}
          </ThemedText>
        </View>
      </View>

      <View style={styles.infoContainer}>
        <ThemedText style={[styles.gradeLabelText, { color: gradeColor }]}>
          {gradeLabel}
        </ThemedText>
        {summary && (
          <ThemedText style={styles.summaryText} numberOfLines={2}>
            {summary}
          </ThemedText>
        )}
        {showRefreshButton && onRefresh && (
          <Pressable
            style={[styles.refreshButton, loading && styles.buttonDisabled]}
            onPress={onRefresh}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={palette.textMuted} size="small" />
            ) : (
              <>
                <Ionicons name="refresh" size={14} color={palette.textMuted} />
                <ThemedText style={styles.refreshText}>Refresh</ThemedText>
              </>
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
};

const createStyles = (palette: typeof Colors.light) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
    },
    graphContainer: {
      position: 'relative',
    },
    centerContent: {
      position: 'absolute',
      top: 0,
      left: 0,
      justifyContent: 'center',
      alignItems: 'center',
    },
    percentageText: {
      fontSize: 24,
      fontWeight: '700',
    },
    gradeText: {
      fontSize: 16,
      fontWeight: '600',
    },
    infoContainer: {
      flex: 1,
      gap: Spacing.xs,
    },
    gradeLabelText: {
      fontSize: 16,
      fontWeight: '600',
    },
    summaryText: {
      fontSize: 13,
      color: palette.textMuted,
      lineHeight: 18,
    },
    refreshButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: Radii.sm,
      backgroundColor: palette.muted,
      borderWidth: 1,
      borderColor: palette.border,
      alignSelf: 'flex-start',
      marginTop: Spacing.xs,
    },
    refreshText: {
      fontSize: 12,
      color: palette.textMuted,
      fontWeight: '500',
    },
    buttonDisabled: {
      opacity: 0.6,
    },
  });
