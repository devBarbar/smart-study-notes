import { useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useLanguage } from '@/contexts/language-context';
import { StudySession } from '@/types';

import { ThemedText } from './themed-text';
import { ThemedView } from './themed-view';

type Props = {
  session: StudySession;
};

const buildSessionHref = (session: StudySession): string => {
  const params = new URLSearchParams();
  if (session.materialId) params.set('materialId', session.materialId);
  if (session.lectureId) params.set('lectureId', session.lectureId);
  if (session.studyPlanEntryId) params.set('studyPlanEntryId', session.studyPlanEntryId);
  
  const queryString = params.toString();
  return `/study/${session.id}${queryString ? `?${queryString}` : ''}`;
};

const getStatusColor = (status: string, palette: typeof Colors.light): string => {
  switch (status) {
    case 'active': return palette.success;
    case 'completed': return palette.primary;
    default: return palette.textMuted;
  }
};

const getStatusIcon = (status: string): 'play-circle' | 'checkmark-circle' | 'pause-circle' => {
  switch (status) {
    case 'active': return 'play-circle';
    case 'completed': return 'checkmark-circle';
    default: return 'pause-circle';
  }
};

export const SessionCard = ({ session }: Props) => {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(palette), [palette]);
  const { t } = useLanguage();

  const translatedStatus = (() => {
    if (session.status === 'active') return t('sessionCard.status.active', {}, 'active');
    if (session.status === 'completed') return t('sessionCard.status.completed', {}, 'completed');
    return t('sessionCard.status.idle', {}, session.status);
  })();
  
  const statusColor = getStatusColor(session.status, palette);

  return (
    <Link href={buildSessionHref(session)} asChild>
      <Pressable style={styles.card}>
        <ThemedView variant="card" style={styles.container}>
          <View style={styles.header}>
            <ThemedText type="title" numberOfLines={2}>
              {session.title}
            </ThemedText>
            <View style={[styles.statusBadge, { backgroundColor: `${statusColor}1a`, borderColor: `${statusColor}33` }]}>
              <Ionicons name={getStatusIcon(session.status)} size={14} color={statusColor} />
              <ThemedText style={[styles.statusText, { color: statusColor }]}>
                {translatedStatus}
              </ThemedText>
            </View>
          </View>
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={14} color={palette.textMuted} />
            <ThemedText tone="muted" style={styles.metaText}>
              {new Date(session.createdAt).toLocaleDateString()}
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
    container: {
      gap: 10,
      borderColor: palette.border,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: Spacing.sm,
    },
    statusBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: Radii.pill,
      borderWidth: 1,
    },
    statusText: {
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'capitalize',
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    metaText: {
      fontSize: 13,
    },
  });

