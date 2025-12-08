import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { v4 as uuid } from 'uuid';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useLanguage } from '@/contexts/language-context';
import { useLectures } from '@/hooks/use-lectures';
import { getItemsDueForReview, selectDailyQuizItems } from '@/lib/mastery';
import { createSession, getSupabase, getUserStreak } from '@/lib/supabase';
import { StudyPlanEntry, StreakInfo, StudySession } from '@/types';

export default function ReviewDeckScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(palette), [palette]);
  const { t } = useLanguage();
  const { data: lectures = [], isFetching } = useLectures();
  const [startingEntryId, setStartingEntryId] = useState<string | null>(null);

  const { data: streak, isFetching: loadingStreak } = useQuery<StreakInfo>({
    queryKey: ['user-streak'],
    queryFn: getUserStreak,
  });

  const allEntries = useMemo(
    () => lectures.flatMap((lecture) => lecture.studyPlan ?? []),
    [lectures]
  );

  const dueItems = useMemo(
    () => getItemsDueForReview(allEntries, new Date()),
    [allEntries]
  );

  const weakItems = useMemo(
    () => allEntries.filter((entry) => (entry.masteryScore ?? 0) < 50),
    [allEntries]
  );

  const averageMastery = useMemo(() => {
    if (allEntries.length === 0) return 0;
    const sum = allEntries.reduce((acc, entry) => acc + (entry.masteryScore ?? 0), 0);
    return Math.round(sum / allEntries.length);
  }, [allEntries]);

  const dailyQuizItems = useMemo(
    () => selectDailyQuizItems(allEntries, 6, new Date()),
    [allEntries]
  );

  const startReviewSession = useCallback(
    async (entry: StudyPlanEntry) => {
      if (!entry.lectureId) return;
      setStartingEntryId(entry.id);
      try {
        const sessionId = uuid();
        const session: StudySession = {
          id: sessionId,
          lectureId: entry.lectureId,
          studyPlanEntryId: entry.id,
          title: `${entry.title}`,
          status: 'active',
          createdAt: new Date().toISOString(),
        };
        if (getSupabase()) {
          await createSession(session);
        }
        const params = new URLSearchParams({
          lectureId: entry.lectureId,
          studyPlanEntryId: entry.id,
        });
        router.push(`/study/${sessionId}?${params.toString()}`);
      } finally {
        setStartingEntryId(null);
      }
    },
    [router]
  );

  const startDailyQuiz = useCallback(() => {
    const target = dailyQuizItems[0] ?? dueItems[0] ?? weakItems[0];
    if (!target) return;
    startReviewSession(target);
  }, [dailyQuizItems, dueItems, weakItems, startReviewSession]);

  if (isFetching) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
        <ThemedText>{t('reviewDeck.loading', {}, 'Loading review data...')}</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedView style={styles.headerCard}>
        <View style={styles.headerRow}>
          <ThemedText type="title">{t('reviewDeck.title', {}, 'Review Deck')}</ThemedText>
          <View style={styles.masteryBadge}>
            <ThemedText style={styles.masteryBadgeLabel}>
              {t('reviewDeck.mastery', {}, 'Avg mastery')}
            </ThemedText>
            <ThemedText style={styles.masteryBadgeValue}>{averageMastery}%</ThemedText>
          </View>
        </View>
        <View style={styles.streakRow}>
          <Ionicons name="flame" size={18} color={palette.warning} />
          {loadingStreak ? (
            <ActivityIndicator size="small" />
          ) : (
            <>
              <ThemedText type="defaultSemiBold">
                {t('reviewDeck.streak', { value: streak?.current ?? 0 }, `${streak?.current ?? 0} day streak`)}
              </ThemedText>
              <ThemedText style={styles.mutedText}>
                {t('reviewDeck.longest', { value: streak?.longest ?? 0 }, `Longest ${streak?.longest ?? 0}`)}
              </ThemedText>
            </>
          )}
        </View>
        <Pressable
          style={[styles.primaryButton, (startingEntryId !== null || (!dailyQuizItems.length && !dueItems.length)) && styles.buttonDisabled]}
          onPress={startDailyQuiz}
          disabled={startingEntryId !== null || (!dailyQuizItems.length && !dueItems.length)}
        >
          {startingEntryId ? (
            <ActivityIndicator color={palette.textOnPrimary} />
          ) : (
            <>
              <Ionicons name="flash" size={18} color={palette.textOnPrimary} />
              <ThemedText type="defaultSemiBold" style={styles.primaryButtonText}>
                {t('reviewDeck.startQuiz', {}, 'Start daily quiz')}
              </ThemedText>
            </>
          )}
        </Pressable>
        <ThemedText style={styles.mutedText}>
          {t('reviewDeck.dueCount', { count: dueItems.length }, `${dueItems.length} due today`)}
        </ThemedText>
      </ThemedView>

      <Section title={t('reviewDeck.dueToday', {}, 'Due today')} hint={t('reviewDeck.dueHint', {}, 'Topics scheduled for review')}>
        {dueItems.length === 0 ? (
          <ThemedText style={styles.mutedText}>
            {t('reviewDeck.noDue', {}, 'Nothing due — great job!')}
          </ThemedText>
        ) : (
          dueItems.map((entry) => (
            <ReviewCard
              key={entry.id}
              entry={entry}
              onStart={() => startReviewSession(entry)}
              busy={startingEntryId === entry.id}
              palette={palette}
              styles={styles}
            />
          ))
        )}
      </Section>

      <Section title={t('reviewDeck.weak', {}, 'Weak concepts')} hint={t('reviewDeck.weakHint', {}, 'Reinforce low-mastery topics')}>
        {weakItems.length === 0 ? (
          <ThemedText style={styles.mutedText}>
            {t('reviewDeck.noWeak', {}, 'No weak items. Keep going!')}
          </ThemedText>
        ) : (
          weakItems.map((entry) => (
            <ReviewCard
              key={entry.id}
              entry={entry}
              onStart={() => startReviewSession(entry)}
              busy={startingEntryId === entry.id}
              palette={palette}
              styles={styles}
            />
          ))
        )}
      </Section>

      <Section title={t('reviewDeck.dailyMix', {}, 'Daily mix')} hint={t('reviewDeck.dailyMixHint', {}, 'Balanced set of due, weak, and high-priority items')}>
        {dailyQuizItems.length === 0 ? (
          <ThemedText style={styles.mutedText}>
            {t('reviewDeck.noDaily', {}, 'No items selected.')}
          </ThemedText>
        ) : (
          dailyQuizItems.map((entry) => (
            <ReviewCard
              key={entry.id}
              entry={entry}
              onStart={() => startReviewSession(entry)}
              busy={startingEntryId === entry.id}
              palette={palette}
              styles={styles}
            />
          ))
        )}
      </Section>
    </ScrollView>
  );
}

type SectionProps = {
  title: string;
  hint?: string;
  children: React.ReactNode;
};

const Section = ({ title, hint, children }: SectionProps) => (
  <View style={{ gap: 6 }}>
    <ThemedText type="subtitle">{title}</ThemedText>
    {hint && <ThemedText style={{ color: '#64748b' }}>{hint}</ThemedText>}
    <View style={{ gap: 8 }}>{children}</View>
  </View>
);

type ReviewCardProps = {
  entry: StudyPlanEntry;
  onStart: () => void;
  busy: boolean;
  palette: typeof Colors.light;
  styles: ReturnType<typeof createStyles>;
};

const ReviewCard = ({ entry, onStart, busy, palette, styles }: ReviewCardProps) => {
  const mastery = entry.masteryScore ?? 0;
  const dueDate = entry.nextReviewAt ? new Date(entry.nextReviewAt) : null;
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.entryBadge}>
          <ThemedText style={styles.entryBadgeText}>{Math.round(mastery)}%</ThemedText>
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <ThemedText type="defaultSemiBold" numberOfLines={1}>
            {entry.title}
          </ThemedText>
          <ThemedText style={styles.mutedText} numberOfLines={1}>
            {dueDate ? `Next: ${dueDate.toLocaleDateString()}` : 'Schedule not set'}
          </ThemedText>
        </View>
        <Pressable
          style={[styles.secondaryButton, busy && styles.buttonDisabled]}
          onPress={onStart}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={palette.text} size="small" />
          ) : (
            <>
              <Ionicons name="play" size={14} color={palette.text} />
              <ThemedText style={styles.secondaryButtonText}>Start</ThemedText>
            </>
          )}
        </Pressable>
      </View>
      {entry.description && (
        <ThemedText style={styles.mutedText} numberOfLines={2}>
          {entry.description}
        </ThemedText>
      )}
    </View>
  );
};

const createStyles = (palette: typeof Colors.light) =>
  StyleSheet.create({
    container: {
      padding: Spacing.lg,
      gap: Spacing.lg,
      backgroundColor: palette.background,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      padding: Spacing.lg,
      backgroundColor: palette.background,
    },
    headerCard: {
      gap: Spacing.xs,
      padding: Spacing.lg,
      borderRadius: Radii.lg,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    masteryBadge: {
      backgroundColor: `${palette.primary}14`,
      borderRadius: Radii.md,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderWidth: 1,
      borderColor: `${palette.primary}33`,
      alignItems: 'flex-end',
    },
    masteryBadgeLabel: {
      fontSize: 12,
      color: palette.textMuted,
    },
    masteryBadgeValue: {
      fontWeight: '700',
      color: palette.primary,
      fontSize: 16,
    },
    streakRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    mutedText: {
      color: palette.textMuted,
      fontSize: 13,
    },
    primaryButton: {
      marginTop: Spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      backgroundColor: palette.primary,
      borderRadius: Radii.md,
      paddingVertical: 12,
      paddingHorizontal: 16,
    },
    primaryButtonText: {
      color: palette.textOnPrimary,
      fontWeight: '600',
    },
    secondaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      borderRadius: Radii.md,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceAlt,
    },
    secondaryButtonText: {
      color: palette.text,
      fontWeight: '600',
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    card: {
      gap: Spacing.xs,
      padding: Spacing.md,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    entryBadge: {
      minWidth: 54,
      alignItems: 'center',
      paddingVertical: 6,
      paddingHorizontal: 8,
      borderRadius: Radii.md,
      backgroundColor: `${palette.primary}14`,
      borderWidth: 1,
      borderColor: `${palette.primary}33`,
    },
    entryBadgeText: {
      color: palette.primary,
      fontWeight: '700',
    },
  });
