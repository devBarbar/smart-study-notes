import { useEffect, useRef, useMemo } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';

import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type SkeletonProps = {
  width?: number | string;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
};

export const Skeleton = ({
  width = '100%',
  height = 16,
  borderRadius = Radii.sm,
  style,
}: SkeletonProps) => {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: palette.muted,
          opacity,
        },
        style,
      ]}
    />
  );
};

type SkeletonCardProps = {
  height?: number;
  lines?: number;
};

export const SkeletonCard = ({ height = 120, lines = 3 }: SkeletonCardProps) => {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(palette), [palette]);

  return (
    <View style={[styles.card, { minHeight: height }]}>
      <Skeleton width="60%" height={20} />
      <View style={styles.linesContainer}>
        {Array.from({ length: lines }).map((_, i) => (
          <Skeleton
            key={i}
            width={i === lines - 1 ? '40%' : '100%'}
            height={14}
          />
        ))}
      </View>
    </View>
  );
};

type SkeletonEntryCardProps = {
  showBadges?: boolean;
};

export const SkeletonEntryCard = ({ showBadges = true }: SkeletonEntryCardProps) => {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(palette), [palette]);

  return (
    <View style={styles.entryCard}>
      <View style={styles.entryHeader}>
        <Skeleton width={28} height={28} borderRadius={14} />
        <View style={styles.entryContent}>
          <View style={styles.entryTitleRow}>
            <Skeleton width="50%" height={18} />
            {showBadges && (
              <View style={styles.badgesRow}>
                <Skeleton width={60} height={22} borderRadius={Radii.md} />
                <Skeleton width={50} height={22} borderRadius={Radii.md} />
              </View>
            )}
          </View>
          <Skeleton width="80%" height={14} />
        </View>
      </View>
      <Skeleton width="100%" height={40} borderRadius={Radii.md} />
    </View>
  );
};

export const SkeletonHeader = () => {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(palette), [palette]);

  return (
    <View style={styles.headerSkeleton}>
      <View style={styles.headerContent}>
        <Skeleton width="70%" height={24} />
        <Skeleton width="100%" height={16} />
        <Skeleton width="40%" height={14} />
      </View>
      <Skeleton width={100} height={100} borderRadius={50} />
    </View>
  );
};

const createStyles = (palette: typeof Colors.light) =>
  StyleSheet.create({
    card: {
      backgroundColor: palette.surface,
      borderRadius: Radii.lg,
      padding: Spacing.md,
      gap: Spacing.sm,
      borderWidth: 1,
      borderColor: palette.border,
    },
    linesContainer: {
      gap: Spacing.xs,
    },
    entryCard: {
      backgroundColor: palette.surface,
      borderRadius: Radii.lg,
      padding: Spacing.md,
      gap: Spacing.sm,
      borderWidth: 1,
      borderColor: palette.border,
    },
    entryHeader: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    entryContent: {
      flex: 1,
      gap: Spacing.xs,
    },
    entryTitleRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    badgesRow: {
      flexDirection: 'row',
      gap: Spacing.xs,
    },
    headerSkeleton: {
      flexDirection: 'row',
      gap: Spacing.md,
      alignItems: 'flex-start',
    },
    headerContent: {
      flex: 1,
      gap: Spacing.sm,
    },
  });
