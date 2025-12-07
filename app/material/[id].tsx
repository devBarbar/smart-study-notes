import { useMemo } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { v4 as uuid } from 'uuid';

import { PdfWebView } from '@/components/pdf-webview';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useMaterials } from '@/hooks/use-materials';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { createSession, getSupabase } from '@/lib/supabase';
import { StudySession } from '@/types';
import { useLanguage } from '@/contexts/language-context';

export default function MaterialDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: materials = [], isFetching } = useMaterials();
  const router = useRouter();
  const { t } = useLanguage();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(palette), [palette]);

  const material = useMemo(() => materials.find((m) => m.id === id), [materials, id]);

  const startSession = async () => {
    if (!material) return;
    const sessionId = uuid();
    const newSession: StudySession = {
      id: sessionId,
      materialId: material.id,
      title: `${material.title} session`,
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    if (getSupabase()) {
      await createSession(newSession);
    }

    router.push(`/study/${sessionId}?materialId=${material.id}`);
  };

  if (isFetching && !material) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
        <ThemedText>{t('materialDetail.loading')}</ThemedText>
      </ThemedView>
    );
  }

  if (!material) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText>{t('materialDetail.notFound')}</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <ThemedView style={styles.header}>
        <ThemedText type="title">{material.title}</ThemedText>
        <ThemedText>{material.description || t('materialDetail.noDescription')}</ThemedText>
        <Pressable style={styles.button} onPress={startSession}>
          <ThemedText type="defaultSemiBold" style={styles.buttonText}>
            {t('materialDetail.startSession')}
          </ThemedText>
        </Pressable>
      </ThemedView>

      {material.type === 'pdf' ? (
        <PdfWebView uri={material.uri} />
      ) : (
        <Image source={{ uri: material.uri }} style={styles.image} />
      )}
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
    header: {
      gap: Spacing.sm,
    },
    button: {
      backgroundColor: palette.primary,
      borderRadius: Radii.md,
      paddingVertical: 12,
      paddingHorizontal: 16,
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderColor: `${palette.primary}26`,
    },
    buttonText: {
      color: palette.textOnPrimary,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.md,
      backgroundColor: palette.background,
    },
    image: {
      height: 360,
      borderRadius: Radii.lg,
    },
  });

