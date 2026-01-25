import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useLanguage } from '@/contexts/language-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSessions } from '@/hooks/use-sessions';
import { SectionStatus, StudyPlanEntry, StudySession } from '@/types';

type EntryActionSheetProps = {
  visible: boolean;
  onClose: () => void;
  entry: StudyPlanEntry | null;
  existingSession: StudySession | null;
  onStartSession: (entry: StudyPlanEntry, forceNew?: boolean) => void;
  onContinueSession: (session: StudySession) => void;
  loading?: boolean;
};

export const EntryActionSheet = ({
  visible,
  onClose,
  entry,
  existingSession,
  onStartSession,
  onContinueSession,
  loading = false,
}: EntryActionSheetProps) => {
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(palette), [palette]);
  const { t } = useLanguage();
  const { isFetching: loadingSessions } = useSessions();

  if (!entry) return null;

  const status = (entry.status ?? 'not_started') as SectionStatus;
  const isPassed = status === 'passed';

  const handleAction = (action: 'start' | 'continue' | 'review' | 'new') => {
    if (loading) return;
    
    switch (action) {
      case 'start':
        onStartSession(entry);
        break;
      case 'continue':
        if (existingSession) onContinueSession(existingSession);
        break;
      case 'review':
        if (existingSession) onContinueSession(existingSession);
        break;
      case 'new':
        onStartSession(entry, true);
        break;
    }
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <View style={styles.sheet}>
          <View style={styles.handle} />
          
          <ThemedText type="subtitle" style={styles.title}>
            {entry.title}
          </ThemedText>
          
          {entry.description && (
            <ThemedText style={styles.description} numberOfLines={2}>
              {entry.description}
            </ThemedText>
          )}
          
          <View style={styles.actions}>
            {isPassed ? (
              <>
                {existingSession && (
                  <Pressable 
                    style={styles.actionButton}
                    onPress={() => handleAction('review')}
                    disabled={loading || loadingSessions}
                  >
                    <View style={[styles.actionIcon, styles.primaryIcon]}>
                      <Ionicons name="play" size={20} color="#fff" />
                    </View>
                    <View style={styles.actionContent}>
                      <ThemedText type="defaultSemiBold">{t('lectureDetail.review')}</ThemedText>
                      <ThemedText style={styles.actionHint}>
                        {t('lectureDetail.reviewSessionHint')}
                      </ThemedText>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={palette.textMuted} />
                  </Pressable>
                )}
                <Pressable 
                  style={styles.actionButton}
                  onPress={() => handleAction('new')}
                  disabled={loading}
                >
                  <View style={[styles.actionIcon, styles.secondaryIcon]}>
                    <Ionicons name="refresh" size={20} color={palette.text} />
                  </View>
                  <View style={styles.actionContent}>
                    <ThemedText type="defaultSemiBold">{t('lectureDetail.startAgain')}</ThemedText>
                    <ThemedText style={styles.actionHint}>
                      {t('lectureDetail.startAgainHint')}
                    </ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={palette.textMuted} />
                </Pressable>
              </>
            ) : existingSession ? (
              <>
                <Pressable 
                  style={styles.actionButton}
                  onPress={() => handleAction('continue')}
                  disabled={loading || loadingSessions}
                >
                  <View style={[styles.actionIcon, styles.successIcon]}>
                    <Ionicons name="play" size={20} color="#fff" />
                  </View>
                  <View style={styles.actionContent}>
                    <ThemedText type="defaultSemiBold">{t('lectureDetail.continue')}</ThemedText>
                    <ThemedText style={styles.actionHint}>
                      {t('lectureDetail.continueSessionHint')}
                    </ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={palette.textMuted} />
                </Pressable>
                <Pressable 
                  style={styles.actionButton}
                  onPress={() => handleAction('new')}
                  disabled={loading || loadingSessions}
                >
                  <View style={[styles.actionIcon, styles.secondaryIcon]}>
                    <Ionicons name="add" size={20} color={palette.text} />
                  </View>
                  <View style={styles.actionContent}>
                    <ThemedText type="defaultSemiBold">{t('lectureDetail.new')}</ThemedText>
                    <ThemedText style={styles.actionHint}>
                      {t('lectureDetail.newSessionHint')}
                    </ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={palette.textMuted} />
                </Pressable>
              </>
            ) : (
              <Pressable 
                style={styles.actionButton}
                onPress={() => handleAction('start')}
                disabled={loading || loadingSessions}
              >
                <View style={[styles.actionIcon, styles.primaryIcon]}>
                  <Ionicons name="play" size={20} color="#fff" />
                </View>
                <View style={styles.actionContent}>
                  <ThemedText type="defaultSemiBold">{t('lectureDetail.startSession')}</ThemedText>
                  <ThemedText style={styles.actionHint}>
                    {t('lectureDetail.startSessionHint')}
                  </ThemedText>
                </View>
                <Ionicons name="chevron-forward" size={20} color={palette.textMuted} />
              </Pressable>
            )}
          </View>
          
          <Pressable style={styles.cancelButton} onPress={onClose}>
            <ThemedText style={styles.cancelText}>{t('common.cancel')}</ThemedText>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
};

const createStyles = (palette: typeof Colors.light) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      justifyContent: 'flex-end',
    },
    sheet: {
      backgroundColor: palette.surface,
      borderTopLeftRadius: Radii.lg,
      borderTopRightRadius: Radii.lg,
      padding: Spacing.lg,
      paddingBottom: 40,
      gap: Spacing.md,
    },
    handle: {
      width: 36,
      height: 4,
      backgroundColor: palette.muted,
      borderRadius: 2,
      alignSelf: 'center',
      marginBottom: Spacing.xs,
    },
    title: {
      fontSize: 18,
      textAlign: 'center',
    },
    description: {
      color: palette.textMuted,
      fontSize: 14,
      textAlign: 'center',
      lineHeight: 20,
    },
    actions: {
      gap: Spacing.sm,
      marginTop: Spacing.sm,
    },
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      padding: Spacing.md,
      backgroundColor: palette.surfaceAlt,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: palette.border,
    },
    actionIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryIcon: {
      backgroundColor: palette.primary,
    },
    successIcon: {
      backgroundColor: palette.success,
    },
    secondaryIcon: {
      backgroundColor: palette.muted,
    },
    actionContent: {
      flex: 1,
      gap: 2,
    },
    actionHint: {
      fontSize: 13,
      color: palette.textMuted,
    },
    cancelButton: {
      paddingVertical: Spacing.md,
      alignItems: 'center',
      marginTop: Spacing.xs,
    },
    cancelText: {
      color: palette.textMuted,
      fontSize: 16,
      fontWeight: '600',
    },
  });
