import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { Colors, Radii, Shadows, Spacing } from '@/constants/theme';
import { useLanguage } from '@/contexts/language-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Lecture } from '@/types';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

type Props = {
  lecture: Lecture;
};

export const LectureCard = ({ lecture }: Props) => {
  const { t } = useLanguage();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(palette), [palette]);
  const preview = lecture.files[0]?.uri;
  const statusCounts = useMemo(() => {
    const entries = lecture.studyPlan ?? [];
    let passed = 0;
    let failed = 0;
    let inProgress = 0;
    let notStarted = 0;
    entries.forEach((entry) => {
      const status = entry.status ?? 'not_started';
      if (status === 'passed') passed += 1;
      else if (status === 'failed') failed += 1;
      else if (status === 'in_progress') inProgress += 1;
      else notStarted += 1;
    });
    return { passed, failed, inProgress, notStarted };
  }, [lecture.studyPlan]);
  const hasSectionStatuses = (statusCounts.passed + statusCounts.failed + statusCounts.inProgress + statusCounts.notStarted) > 0;
  const statusBadge = useMemo(() => {
    switch (lecture.planStatus) {
      case 'pending':
        return {
          label: t('lectureCard.planPending', {}, 'Generating plan'),
          bg: `${palette.primary}14`,
          text: palette.primary,
          spinner: true,
        };
      case 'ready':
        return {
          label: t('lectureCard.planReady', {}, 'Plan ready'),
          bg: `${palette.success}1a`,
          text: palette.success,
        };
      case 'failed':
        return {
          label: t('lectureCard.planFailed', {}, 'Plan failed'),
          bg: '#fee2e2',
          text: '#b91c1c',
        };
      default:
        return null;
    }
  }, [lecture.planStatus, palette, t]);

  return (
    <Link href={`/lecture/${lecture.id}`} asChild>
      <Pressable style={styles.card}>
        <ThemedView variant="card" style={styles.cardSurface}>
          <View style={[styles.preview, preview ? styles.previewWithBorder : styles.previewFallback]}>
            {preview ? (
              <Image source={preview} style={styles.previewImage} contentFit="cover" />
            ) : (
              <ThemedView style={[styles.preview, styles.previewFallback]}>
                <ThemedText type="defaultSemiBold" tone="primary">
                  {t('lectureCard.pdf')}
                </ThemedText>
              </ThemedView>
            )}
          </View>
          <View style={styles.meta}>
            <View style={styles.titleRow}>
              <ThemedText type="title" numberOfLines={1}>
                {lecture.title}
              </ThemedText>
              <View style={styles.badge}>
                <ThemedText type="label" tone="primary">
                  {t('lectureCard.fileCount', { count: lecture.files.length }, `${lecture.files.length} file(s)`)}
                </ThemedText>
              </View>
            </View>
            {statusBadge && (
              <View style={[styles.statusBadge, { backgroundColor: statusBadge.bg }]}>
                {statusBadge.spinner && <ActivityIndicator size="small" color={statusBadge.text} />}
                <ThemedText style={[styles.statusBadgeText, { color: statusBadge.text }]}>
                  {statusBadge.label}
                </ThemedText>
              </View>
            )}
            {hasSectionStatuses && (
              <View style={styles.sectionStatusBadge}>
                <ThemedText style={styles.sectionStatusText}>
                  {t(
                    'lectureCard.sectionStatusSummary',
                    {
                      passed: statusCounts.passed,
                      inProgress: statusCounts.inProgress,
                    notStarted: statusCounts.notStarted,
                    failed: statusCounts.failed,
                    },
                  `${statusCounts.passed} passed · ${statusCounts.notStarted} not started · ${statusCounts.inProgress} in progress · ${statusCounts.failed} failed`
                  )}
                </ThemedText>
              </View>
            )}
            <ThemedText numberOfLines={2} tone="muted">
              {lecture.description || t('lectureCard.summaryFallback')}
            </ThemedText>
          </View>
        </ThemedView>
      </Pressable>
    </Link>
  );
};

const createStyles = (palette: typeof Colors.light) =>
  StyleSheet.create({
    card: {
      marginBottom: Spacing.sm,
    },
    cardSurface: {
      flexDirection: 'row',
      gap: Spacing.md,
      borderColor: palette.border,
    },
    preview: {
      width: 100,
      height: 110,
      borderRadius: Radii.md,
      overflow: 'hidden',
      backgroundColor: palette.muted,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: palette.border,
    },
    previewWithBorder: {
      ...Shadows.sm,
    },
    previewImage: {
      width: '100%',
      height: '100%',
    },
    previewFallback: {
      backgroundColor: palette.surfaceAlt,
      borderColor: `${palette.border}`,
    },
    meta: {
      flex: 1,
      gap: 8,
      justifyContent: 'center',
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    badge: {
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: Radii.pill,
      backgroundColor: `${palette.primary}14`,
      borderWidth: 1,
      borderColor: `${palette.primary}26`,
    },
    statusBadge: {
      marginTop: 4,
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: Radii.pill,
      borderWidth: 1,
      borderColor: `${palette.border}`,
    },
    statusBadgeText: {
      fontWeight: '600',
    },
    sectionStatusBadge: {
      marginTop: 4,
      alignSelf: 'flex-start',
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: Radii.pill,
      backgroundColor: `${palette.success}12`,
      borderWidth: 1,
      borderColor: `${palette.success}26`,
    },
    sectionStatusText: {
      color: palette.textMuted,
      fontWeight: '600',
      fontSize: 12,
    },
  });

