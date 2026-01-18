import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type ProgressCounts = {
  passed: number;
  inProgress: number;
  notStarted: number;
  failed: number;
};

type LinearProgressBarProps = {
  counts: ProgressCounts;
  showLabels?: boolean;
  height?: number;
};

export const LinearProgressBar = ({
  counts,
  showLabels = true,
  height = 8,
}: LinearProgressBarProps) => {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(palette, height), [palette, height]);

  const total = counts.passed + counts.inProgress + counts.notStarted + counts.failed;
  
  if (total === 0) {
    return null;
  }

  const passedPercent = (counts.passed / total) * 100;
  const inProgressPercent = (counts.inProgress / total) * 100;
  const failedPercent = (counts.failed / total) * 100;
  const notStartedPercent = (counts.notStarted / total) * 100;

  return (
    <View style={styles.container}>
      <View style={styles.barContainer}>
        {passedPercent > 0 && (
          <View style={[styles.segment, styles.passedSegment, { width: `${passedPercent}%` }]} />
        )}
        {inProgressPercent > 0 && (
          <View style={[styles.segment, styles.inProgressSegment, { width: `${inProgressPercent}%` }]} />
        )}
        {failedPercent > 0 && (
          <View style={[styles.segment, styles.failedSegment, { width: `${failedPercent}%` }]} />
        )}
        {notStartedPercent > 0 && (
          <View style={[styles.segment, styles.notStartedSegment, { width: `${notStartedPercent}%` }]} />
        )}
      </View>
      
      {showLabels && (
        <View style={styles.labelsRow}>
          {counts.passed > 0 && (
            <View style={styles.labelItem}>
              <View style={[styles.labelDot, styles.passedDot]} />
              <ThemedText style={styles.labelText}>{counts.passed} passed</ThemedText>
            </View>
          )}
          {counts.inProgress > 0 && (
            <View style={styles.labelItem}>
              <View style={[styles.labelDot, styles.inProgressDot]} />
              <ThemedText style={styles.labelText}>{counts.inProgress} active</ThemedText>
            </View>
          )}
          {counts.failed > 0 && (
            <View style={styles.labelItem}>
              <View style={[styles.labelDot, styles.failedDot]} />
              <ThemedText style={styles.labelText}>{counts.failed} failed</ThemedText>
            </View>
          )}
          {counts.notStarted > 0 && (
            <View style={styles.labelItem}>
              <View style={[styles.labelDot, styles.notStartedDot]} />
              <ThemedText style={styles.labelText}>{counts.notStarted} remaining</ThemedText>
            </View>
          )}
        </View>
      )}
    </View>
  );
};

const createStyles = (palette: typeof Colors.light, height: number) =>
  StyleSheet.create({
    container: {
      gap: Spacing.xs,
    },
    barContainer: {
      flexDirection: 'row',
      height,
      borderRadius: height / 2,
      backgroundColor: palette.muted,
      overflow: 'hidden',
    },
    segment: {
      height: '100%',
    },
    passedSegment: {
      backgroundColor: palette.success,
    },
    inProgressSegment: {
      backgroundColor: palette.warning,
    },
    failedSegment: {
      backgroundColor: palette.danger,
    },
    notStartedSegment: {
      backgroundColor: palette.muted,
    },
    labelsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.md,
    },
    labelItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    labelDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    passedDot: {
      backgroundColor: palette.success,
    },
    inProgressDot: {
      backgroundColor: palette.warning,
    },
    failedDot: {
      backgroundColor: palette.danger,
    },
    notStartedDot: {
      backgroundColor: palette.muted,
    },
    labelText: {
      fontSize: 12,
      color: palette.textMuted,
    },
  });
