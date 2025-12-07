import { useMemo } from 'react';
import { ActivityIndicator, ImageBackground, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';

import { LectureCard } from '@/components/lecture-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useLectures } from '@/hooks/use-lectures';
import { useLanguage } from '@/contexts/language-context';

const heroBg = require('@/assets/images/gradient-hero.png');

export default function LibraryScreen() {
  const { data: lectures = [], isFetching } = useLectures();
  const router = useRouter();
  const { t } = useLanguage();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(palette), [palette]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedView variant="plain" style={styles.hero}>
        <ImageBackground source={heroBg} resizeMode="cover" style={styles.heroBg} imageStyle={styles.heroBgImage}>
          <View style={styles.heroContent}>
            <View style={styles.heroTextGroup}>
              <ThemedText type="display" tone="inverse">
                {t('library.title')}
              </ThemedText>
              <ThemedText tone="inverse" style={styles.heroSubtitle}>
                {t('library.subtitle')}
              </ThemedText>
            </View>
            <View style={styles.ctaRow}>
              <Pressable style={styles.primaryButton} onPress={() => router.push('/lecture/new')}>
                <ThemedText type="defaultSemiBold" tone="inverse">
                  {t('library.addLecture')}
                </ThemedText>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => router.push('/(tabs)/sessions')}>
                <ThemedText type="defaultSemiBold" tone="primary">
                  {t('library.viewSessions', {}, 'View sessions')}
                </ThemedText>
              </Pressable>
            </View>
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <ThemedText type="title" tone="inverse">
                  {lectures.length}
                </ThemedText>
                <ThemedText tone="inverse" style={styles.statLabel}>
                  {t('library.lecturesCount', {}, 'Lectures saved')}
                </ThemedText>
              </View>
              <View style={styles.statCard}>
                <ThemedText type="title" tone="inverse">
                  AI-first
                </ThemedText>
                <ThemedText tone="inverse" style={styles.statLabel}>
                  {t('library.guidedPlans', {}, 'Guided plans & sessions')}
                </ThemedText>
              </View>
            </View>
          </View>
        </ImageBackground>
      </ThemedView>

      <View style={styles.sectionHeader}>
        <ThemedText type="subtitle">{t('library.latest', {}, 'Latest lectures')}</ThemedText>
        <ThemedText tone="muted">{t('library.latestHint', {}, 'Continue where you left off.')}</ThemedText>
      </View>

      {isFetching && (
        <View style={styles.row}>
          <ActivityIndicator color={palette.primary} />
          <ThemedText>{t('library.loading')}</ThemedText>
        </View>
      )}

      {lectures.map((lecture) => (
        <LectureCard key={lecture.id} lecture={lecture} />
      ))}
    </ScrollView>
  );
}

const createStyles = (palette: typeof Colors.light) =>
  StyleSheet.create({
    container: {
      padding: Spacing.lg,
      gap: Spacing.md,
      backgroundColor: palette.background,
    },
    hero: {
      borderRadius: Radii.lg,
      overflow: 'hidden',
    },
    heroBg: {
      width: '100%',
    },
    heroBgImage: {
      borderRadius: Radii.lg,
    },
    heroContent: {
      padding: Spacing.lg,
      gap: Spacing.md,
    },
    heroTextGroup: {
      gap: Spacing.xs,
    },
    heroSubtitle: {
      maxWidth: 320,
    },
    ctaRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
      flexWrap: 'wrap',
    },
    primaryButton: {
      backgroundColor: palette.primary,
      borderRadius: Radii.pill,
      paddingVertical: 12,
      paddingHorizontal: 18,
      borderWidth: 1,
      borderColor: `${palette.textOnPrimary}26`,
    },
    secondaryButton: {
      backgroundColor: `${palette.textOnPrimary}12`,
      borderRadius: Radii.pill,
      paddingVertical: 12,
      paddingHorizontal: 18,
      borderWidth: 1,
      borderColor: `${palette.textOnPrimary}26`,
    },
    statsRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
      flexWrap: 'wrap',
    },
    statCard: {
      backgroundColor: `${palette.textOnPrimary}14`,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: `${palette.textOnPrimary}24`,
    },
    statLabel: {
      fontSize: 13,
      opacity: 0.9,
    },
    sectionHeader: {
      gap: 4,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
  });
