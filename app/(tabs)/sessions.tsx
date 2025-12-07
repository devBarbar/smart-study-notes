import { useMemo } from 'react';
import { ActivityIndicator, ImageBackground, ScrollView, StyleSheet, View } from 'react-native';
import { Link } from 'expo-router';

import { SessionCard } from '@/components/session-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSessions } from '@/hooks/use-sessions';
import { useLanguage } from '@/contexts/language-context';

const heroBg = require('@/assets/images/gradient-hero.png');

export default function SessionsScreen() {
  const { data: sessions = [], isFetching } = useSessions();
  const { t } = useLanguage();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(palette), [palette]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedView variant="plain" style={styles.hero}>
        <ImageBackground source={heroBg} resizeMode="cover" style={styles.heroBg} imageStyle={styles.heroBgImage}>
          <View style={styles.heroContent}>
            <ThemedText type="display" tone="inverse">
              {t('sessions.title')}
            </ThemedText>
            <ThemedText tone="inverse" style={styles.heroSubtitle}>
              {t('sessions.subtitle')}
            </ThemedText>
            <Link href="/" style={styles.link}>
              <ThemedText type="defaultSemiBold" tone="inverse">
                {t('sessions.backToLibrary')}
              </ThemedText>
            </Link>
          </View>
        </ImageBackground>
      </ThemedView>

      {isFetching && (
        <View style={styles.row}>
          <ActivityIndicator color={palette.primary} />
          <ThemedText>{t('sessions.loading')}</ThemedText>
        </View>
      )}

      {sessions.map((session) => (
        <SessionCard key={session.id} session={session} />
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
      gap: Spacing.sm,
    },
    heroSubtitle: {
      maxWidth: 320,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    link: {
      marginTop: 8,
    },
  });

