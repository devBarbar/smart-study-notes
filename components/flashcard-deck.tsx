import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { FlashcardCard } from '@/components/flashcard-card';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Shadows, Spacing } from '@/constants/theme';
import { useLanguage } from '@/contexts/language-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useDeleteFlashcard, useFlashcards, useUpdateFlashcardMastery } from '@/hooks/use-flashcards';
import { Flashcard, FlashcardDifficulty } from '@/types';

type FlashcardDeckProps = {
  lectureId: string;
};

type ViewMode = 'study' | 'browse';

export const FlashcardDeck = ({ lectureId }: FlashcardDeckProps) => {
  const { t } = useLanguage();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(palette), [palette]);

  const { data: flashcards = [], isFetching, refetch } = useFlashcards(lectureId);
  const updateMastery = useUpdateFlashcardMastery(lectureId);
  const deleteFlashcard = useDeleteFlashcard(lectureId);

  const [viewMode, setViewMode] = useState<ViewMode>('study');
  const [currentIndex, setCurrentIndex] = useState(0);

  // Sort flashcards by due date for study mode
  const sortedFlashcards = useMemo(() => {
    if (viewMode === 'study') {
      return [...flashcards].sort((a, b) => {
        const aDate = a.nextReviewAt ? new Date(a.nextReviewAt).getTime() : 0;
        const bDate = b.nextReviewAt ? new Date(b.nextReviewAt).getTime() : 0;
        return aDate - bDate;
      });
    }
    return flashcards;
  }, [flashcards, viewMode]);

  const currentFlashcard = sortedFlashcards[currentIndex];

  const handleDifficultySelect = useCallback(
    async (difficulty: FlashcardDifficulty) => {
      if (!currentFlashcard) return;

      try {
        await updateMastery.mutateAsync({
          flashcardId: currentFlashcard.id,
          difficulty,
        });

        // Move to next card
        if (currentIndex < sortedFlashcards.length - 1) {
          setCurrentIndex((prev) => prev + 1);
        } else {
          // End of deck - show completion
          setCurrentIndex(0);
        }
      } catch (err) {
        console.warn('[flashcard-deck] Failed to update mastery:', err);
      }
    },
    [currentFlashcard, currentIndex, sortedFlashcards.length, updateMastery]
  );

  const handleDelete = useCallback(
    async (flashcard: Flashcard) => {
      try {
        await deleteFlashcard.mutateAsync(flashcard.id);
        // Adjust index if needed
        if (currentIndex >= sortedFlashcards.length - 1 && currentIndex > 0) {
          setCurrentIndex((prev) => prev - 1);
        }
      } catch (err) {
        console.warn('[flashcard-deck] Failed to delete flashcard:', err);
      }
    },
    [currentIndex, deleteFlashcard, sortedFlashcards.length]
  );

  const handlePrevious = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  }, [currentIndex]);

  const handleNext = useCallback(() => {
    if (currentIndex < sortedFlashcards.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  }, [currentIndex, sortedFlashcards.length]);

  if (isFetching && flashcards.length === 0) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color={palette.primary} />
        <ThemedText style={styles.loadingText}>{t('flashcards.loading')}</ThemedText>
      </View>
    );
  }

  if (flashcards.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <View style={styles.emptyIcon}>
          <Ionicons name="layers-outline" size={48} color={palette.textMuted} />
        </View>
        <ThemedText type="subtitle" style={styles.emptyTitle}>
          {t('flashcards.emptyTitle')}
        </ThemedText>
        <ThemedText style={styles.emptyText}>{t('flashcards.emptyDescription')}</ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* View Mode Toggle */}
      <View style={styles.header}>
        <View style={styles.modeToggle}>
          <Pressable
            style={[styles.modeButton, viewMode === 'study' && styles.modeButtonActive]}
            onPress={() => setViewMode('study')}
          >
            <Ionicons
              name="flash"
              size={16}
              color={viewMode === 'study' ? palette.textOnPrimary : palette.textMuted}
            />
            <ThemedText
              style={[
                styles.modeButtonText,
                viewMode === 'study' && styles.modeButtonTextActive,
              ]}
            >
              {t('flashcards.studyMode')}
            </ThemedText>
          </Pressable>
          <Pressable
            style={[styles.modeButton, viewMode === 'browse' && styles.modeButtonActive]}
            onPress={() => setViewMode('browse')}
          >
            <Ionicons
              name="grid"
              size={16}
              color={viewMode === 'browse' ? palette.textOnPrimary : palette.textMuted}
            />
            <ThemedText
              style={[
                styles.modeButtonText,
                viewMode === 'browse' && styles.modeButtonTextActive,
              ]}
            >
              {t('flashcards.browseMode')}
            </ThemedText>
          </Pressable>
        </View>
        <Pressable style={styles.refreshButton} onPress={() => refetch()}>
          <Ionicons name="refresh" size={20} color={palette.textMuted} />
        </Pressable>
      </View>

      {viewMode === 'study' ? (
        /* Study Mode - Single card with navigation */
        <View style={styles.studyContainer}>
          {/* Progress Indicator */}
          <View style={styles.progressContainer}>
            <ThemedText style={styles.progressText}>
              {t('flashcards.progress', {
                current: currentIndex + 1,
                total: sortedFlashcards.length,
              })}
            </ThemedText>
            <View style={styles.progressBar}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${((currentIndex + 1) / sortedFlashcards.length) * 100}%` },
                ]}
              />
            </View>
          </View>

          {/* Current Card */}
          {currentFlashcard && (
            <FlashcardCard
              flashcard={currentFlashcard}
              onDifficultySelect={handleDifficultySelect}
              onDelete={() => handleDelete(currentFlashcard)}
              showDifficultyButtons={true}
            />
          )}

          {/* Navigation Buttons */}
          <View style={styles.navigationContainer}>
            <Pressable
              style={[styles.navButton, currentIndex === 0 && styles.navButtonDisabled]}
              onPress={handlePrevious}
              disabled={currentIndex === 0}
            >
              <Ionicons
                name="chevron-back"
                size={24}
                color={currentIndex === 0 ? palette.textMuted : palette.primary}
              />
            </Pressable>
            <Pressable
              style={[
                styles.navButton,
                currentIndex === sortedFlashcards.length - 1 && styles.navButtonDisabled,
              ]}
              onPress={handleNext}
              disabled={currentIndex === sortedFlashcards.length - 1}
            >
              <Ionicons
                name="chevron-forward"
                size={24}
                color={
                  currentIndex === sortedFlashcards.length - 1
                    ? palette.textMuted
                    : palette.primary
                }
              />
            </Pressable>
          </View>
        </View>
      ) : (
        /* Browse Mode - All cards in scrollable list */
        <ScrollView style={styles.browseContainer} contentContainerStyle={styles.browseContent}>
          {sortedFlashcards.map((flashcard, index) => (
            <View key={flashcard.id} style={styles.browseCard}>
              <View style={styles.browseCardHeader}>
                <ThemedText style={styles.browseCardIndex}>#{index + 1}</ThemedText>
                <Pressable
                  style={styles.browseDeleteButton}
                  onPress={() => handleDelete(flashcard)}
                >
                  <Ionicons name="trash-outline" size={16} color={palette.danger} />
                </Pressable>
              </View>
              <ThemedText style={styles.browseQuestion} numberOfLines={3}>
                {flashcard.questionText}
              </ThemedText>
              <View style={styles.browseCardMeta}>
                <View style={styles.masteryBadge}>
                  <Ionicons name="trophy" size={12} color={palette.warning} />
                  <ThemedText style={styles.masteryText}>{flashcard.masteryScore}%</ThemedText>
                </View>
                <ThemedText style={styles.reviewCount}>
                  {t('flashcards.reviewed', { count: flashcard.reviewCount })}
                </ThemedText>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
};

const createStyles = (palette: typeof Colors.light) =>
  StyleSheet.create({
    container: {
      flex: 1,
      gap: Spacing.md,
    },
    loadingContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      padding: Spacing.xl,
    },
    loadingText: {
      color: palette.textMuted,
      fontSize: 14,
    },
    emptyContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: Spacing.xl,
      gap: Spacing.md,
    },
    emptyIcon: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: palette.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyTitle: {
      color: palette.text,
      textAlign: 'center',
    },
    emptyText: {
      color: palette.textMuted,
      textAlign: 'center',
      fontSize: 14,
      lineHeight: 20,
      maxWidth: 280,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    modeToggle: {
      flexDirection: 'row',
      backgroundColor: palette.surfaceAlt,
      borderRadius: Radii.md,
      padding: 4,
    },
    modeButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: Radii.sm,
    },
    modeButtonActive: {
      backgroundColor: palette.primary,
    },
    modeButtonText: {
      fontSize: 13,
      fontWeight: '600',
      color: palette.textMuted,
    },
    modeButtonTextActive: {
      color: palette.textOnPrimary,
    },
    refreshButton: {
      padding: Spacing.sm,
    },
    studyContainer: {
      flex: 1,
      gap: Spacing.md,
    },
    progressContainer: {
      gap: Spacing.xs,
    },
    progressText: {
      fontSize: 13,
      color: palette.textMuted,
      textAlign: 'center',
    },
    progressBar: {
      height: 6,
      backgroundColor: palette.muted,
      borderRadius: 3,
      overflow: 'hidden',
    },
    progressFill: {
      height: '100%',
      backgroundColor: palette.primary,
      borderRadius: 3,
    },
    navigationContainer: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingTop: Spacing.sm,
    },
    navButton: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      alignItems: 'center',
      justifyContent: 'center',
      ...Shadows.sm,
    },
    navButtonDisabled: {
      opacity: 0.5,
    },
    browseContainer: {
      flex: 1,
    },
    browseContent: {
      gap: Spacing.sm,
      paddingBottom: Spacing.lg,
    },
    browseCard: {
      backgroundColor: palette.surface,
      borderRadius: Radii.md,
      padding: Spacing.md,
      borderWidth: 1,
      borderColor: palette.border,
      gap: Spacing.xs,
    },
    browseCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    browseCardIndex: {
      fontSize: 12,
      fontWeight: '600',
      color: palette.primary,
    },
    browseDeleteButton: {
      padding: Spacing.xs,
    },
    browseQuestion: {
      fontSize: 15,
      lineHeight: 22,
      color: palette.text,
    },
    browseCardMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: Spacing.xs,
    },
    masteryBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 3,
      paddingHorizontal: 8,
      backgroundColor: `${palette.warning}12`,
      borderRadius: Radii.pill,
    },
    masteryText: {
      fontSize: 11,
      fontWeight: '600',
      color: palette.warning,
    },
    reviewCount: {
      fontSize: 11,
      color: palette.textMuted,
    },
  });
