import { useMemo } from 'react';
import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Colors, Radii, Shadows, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Material } from '@/types';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

type Props = {
  material: Material;
};

export const MaterialCard = ({ material }: Props) => {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(palette), [palette]);

  return (
    <Link href={`/material/${material.id}`} asChild>
      <Pressable style={styles.card}>
        <ThemedView variant="card" style={styles.cardSurface}>
          <View style={styles.preview}>
            <Image
              source={material.previewUri || material.uri}
              style={styles.previewImage}
              contentFit="cover"
            />
          </View>
          <View style={styles.meta}>
            <View style={styles.titleRow}>
              <ThemedText type="title" numberOfLines={1}>
                {material.title}
              </ThemedText>
              <View style={styles.badge}>
                <ThemedText type="label" tone="primary">
                  {material.type.toUpperCase()}
                </ThemedText>
              </View>
            </View>
            <ThemedText numberOfLines={2} tone="muted">
              {material.description || 'No description yet.'}
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
      ...Shadows.sm,
    },
    previewImage: {
      width: '100%',
      height: '100%',
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
  });

