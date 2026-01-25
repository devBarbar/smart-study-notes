import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';

import { MarkdownText } from '@/components/markdown-text';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Shadows, Spacing } from '@/constants/theme';
import { useLanguage } from '@/contexts/language-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Flashcard, FlashcardDifficulty } from '@/types';

type FlashcardCardProps = {
  flashcard: Flashcard;
  onDifficultySelect?: (difficulty: FlashcardDifficulty) => void;
  onDelete?: () => void;
  showDifficultyButtons?: boolean;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export const FlashcardCard = ({
  flashcard,
  onDifficultySelect,
  onDelete,
  showDifficultyButtons = true,
}: FlashcardCardProps) => {
  const { t } = useLanguage();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);

  // Flip animation state (0 = front/question, 1 = back/answer)
  const flipProgress = useSharedValue(0);
  const isFlipped = useSharedValue(false);

  const handleFlip = () => {
    isFlipped.value = !isFlipped.value;
    flipProgress.value = withTiming(isFlipped.value ? 1 : 0, { duration: 400 });
  };

  // Front card animation style (question side)
  const frontAnimatedStyle = useAnimatedStyle(() => {
    const rotateY = interpolate(flipProgress.value, [0, 1], [0, 180]);
    return {
      transform: [{ perspective: 1000 }, { rotateY: `${rotateY}deg` }],
      backfaceVisibility: 'hidden',
      opacity: flipProgress.value < 0.5 ? 1 : 0,
    };
  });

  // Back card animation style (answer side)
  const backAnimatedStyle = useAnimatedStyle(() => {
    const rotateY = interpolate(flipProgress.value, [0, 1], [180, 360]);
    return {
      transform: [{ perspective: 1000 }, { rotateY: `${rotateY}deg` }],
      backfaceVisibility: 'hidden',
      opacity: flipProgress.value > 0.5 ? 1 : 0,
    };
  });

  const handleDifficultySelect = (difficulty: FlashcardDifficulty) => {
    if (onDifficultySelect) {
      onDifficultySelect(difficulty);
    }
  };

  return (
    <View style={styles.container}>
      <Pressable style={styles.cardContainer} onPress={handleFlip}>
        {/* Front Side - Question */}
        <Animated.View style={[styles.card, styles.cardFront, frontAnimatedStyle]}>
          <View style={styles.cardHeader}>
            <View style={styles.cardLabel}>
              <Ionicons name="help-circle" size={16} color={palette.primary} />
              <ThemedText style={styles.cardLabelText}>{t('flashcards.question')}</ThemedText>
            </View>
            {onDelete && (
              <Pressable style={styles.deleteButton} onPress={onDelete}>
                <Ionicons name="trash-outline" size={18} color={palette.danger} />
              </Pressable>
            )}
          </View>
          <View style={styles.cardContent}>
            <ThemedText style={styles.questionText}>{flashcard.questionText}</ThemedText>
          </View>
          <View style={styles.cardFooter}>
            <Ionicons name="sync" size={14} color={palette.textMuted} />
            <ThemedText style={styles.tapHint}>{t('flashcards.tapToFlip')}</ThemedText>
          </View>
        </Animated.View>

        {/* Back Side - Answer */}
        <Animated.View style={[styles.card, styles.cardBack, backAnimatedStyle]}>
          <View style={styles.cardHeader}>
            <View style={styles.cardLabel}>
              <Ionicons name="checkmark-circle" size={16} color={palette.success} />
              <ThemedText style={[styles.cardLabelText, { color: palette.success }]}>
                {t('flashcards.answer')}
              </ThemedText>
            </View>
          </View>
          <View style={styles.cardContent}>
            {flashcard.answerText ? (
              <ThemedText style={styles.answerText}>{flashcard.answerText}</ThemedText>
            ) : null}
            {flashcard.answerImageUri ? (
              <View style={styles.answerImageSection}>
                <View style={styles.answerImageHeader}>
                  <Ionicons name="pencil" size={14} color={palette.primary} />
                  <ThemedText style={styles.answerImageLabel}>
                    {t('flashcards.handwrittenAnswer')}
                  </ThemedText>
                </View>
                <Pressable onPress={() => setImagePreviewOpen(true)}>
                  <Image
                    source={{ uri: flashcard.answerImageUri }}
                    style={styles.answerImage}
                    resizeMode="contain"
                  />
                </Pressable>
              </View>
            ) : null}
            {flashcard.aiExplanation ? (
              <View style={styles.explanationSection}>
                <View style={styles.explanationHeader}>
                  <Ionicons name="bulb" size={14} color={palette.warning} />
                  <ThemedText style={styles.explanationLabel}>{t('flashcards.explanation')}</ThemedText>
                </View>
                <MarkdownText content={flashcard.aiExplanation} />
              </View>
            ) : null}
            {flashcard.visualBlocks && flashcard.visualBlocks.length > 0 && (
              <View style={styles.visualBlocksIndicator}>
                <Ionicons name="git-network" size={14} color={palette.primary} />
                <ThemedText style={styles.visualBlocksText}>
                  {t('flashcards.hasDiagrams', { count: flashcard.visualBlocks.length })}
                </ThemedText>
              </View>
            )}
          </View>
          <View style={styles.cardFooter}>
            <Ionicons name="sync" size={14} color={palette.textMuted} />
            <ThemedText style={styles.tapHint}>{t('flashcards.tapToFlip')}</ThemedText>
          </View>
        </Animated.View>
      </Pressable>

      {/* Difficulty Buttons */}
      {showDifficultyButtons && (
        <View style={styles.difficultyContainer}>
          <ThemedText style={styles.difficultyPrompt}>{t('flashcards.howWasIt')}</ThemedText>
          <View style={styles.difficultyButtons}>
            <AnimatedPressable
              style={[styles.difficultyButton, styles.difficultyHard]}
              onPress={() => handleDifficultySelect('hard')}
            >
              <Ionicons name="close-circle" size={18} color="#ef4444" />
              <ThemedText style={[styles.difficultyText, { color: '#ef4444' }]}>
                {t('flashcards.hard')}
              </ThemedText>
            </AnimatedPressable>
            <AnimatedPressable
              style={[styles.difficultyButton, styles.difficultyMedium]}
              onPress={() => handleDifficultySelect('medium')}
            >
              <Ionicons name="ellipse" size={18} color="#f59e0b" />
              <ThemedText style={[styles.difficultyText, { color: '#f59e0b' }]}>
                {t('flashcards.medium')}
              </ThemedText>
            </AnimatedPressable>
            <AnimatedPressable
              style={[styles.difficultyButton, styles.difficultyEasy]}
              onPress={() => handleDifficultySelect('easy')}
            >
              <Ionicons name="checkmark-circle" size={18} color="#22c55e" />
              <ThemedText style={[styles.difficultyText, { color: '#22c55e' }]}>
                {t('flashcards.easy')}
              </ThemedText>
            </AnimatedPressable>
          </View>
        </View>
      )}

      {/* Mastery Info */}
      <View style={styles.masteryInfo}>
        <View style={styles.masteryBadge}>
          <Ionicons name="trophy" size={12} color={palette.warning} />
          <ThemedText style={styles.masteryText}>
            {t('flashcards.mastery', { score: flashcard.masteryScore })}
          </ThemedText>
        </View>
        <ThemedText style={styles.reviewCountText}>
          {t('flashcards.reviewed', { count: flashcard.reviewCount })}
        </ThemedText>
      </View>

      <Modal
        visible={imagePreviewOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setImagePreviewOpen(false)}
      >
        <Pressable
          style={styles.imagePreviewBackdrop}
          onPress={() => setImagePreviewOpen(false)}
        >
          <View style={styles.imagePreviewContainer}>
            <Image
              source={{ uri: flashcard.answerImageUri || '' }}
              style={styles.imagePreview}
              resizeMode="contain"
            />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
};

const createStyles = (palette: typeof Colors.light) =>
  StyleSheet.create({
    container: {
      gap: Spacing.md,
    },
    cardContainer: {
      width: '100%',
      height: 440,
      position: 'relative',
    },
    card: {
      position: 'absolute',
      width: '100%',
      height: '100%',
      borderRadius: Radii.lg,
      padding: Spacing.lg,
      ...Shadows.md,
    },
    cardFront: {
      backgroundColor: palette.surface,
      borderWidth: 2,
      borderColor: palette.primary,
    },
    cardBack: {
      backgroundColor: palette.surfaceAlt,
      borderWidth: 2,
      borderColor: palette.success,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: Spacing.sm,
    },
    cardLabel: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    cardLabelText: {
      fontSize: 14,
      fontWeight: '600',
      color: palette.primary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    deleteButton: {
      padding: Spacing.xs,
    },
    cardContent: {
      flex: 1,
      justifyContent: 'center',
    },
    questionText: {
      fontSize: 18,
      lineHeight: 26,
      color: palette.text,
      textAlign: 'center',
    },
    answerText: {
      fontSize: 16,
      lineHeight: 24,
      color: palette.text,
      marginBottom: Spacing.sm,
    },
    answerImageSection: {
      backgroundColor: `${palette.primary}08`,
      borderRadius: Radii.md,
      padding: Spacing.sm,
      marginBottom: Spacing.sm,
      gap: Spacing.xs,
    },
    answerImageHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    answerImageLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: palette.primary,
    },
    answerImage: {
      width: '100%',
      height: 260,
      borderRadius: Radii.sm,
      backgroundColor: palette.surface,
    },
    imagePreviewBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.8)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: Spacing.lg,
    },
    imagePreviewContainer: {
      width: '100%',
      height: '100%',
      backgroundColor: palette.surface,
      borderRadius: Radii.lg,
      padding: Spacing.md,
    },
    imagePreview: {
      width: '100%',
      height: '100%',
    },
    explanationSection: {
      backgroundColor: `${palette.warning}10`,
      borderRadius: Radii.md,
      padding: Spacing.sm,
      marginTop: Spacing.xs,
    },
    explanationHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      marginBottom: Spacing.xs,
    },
    explanationLabel: {
      fontSize: 12,
      fontWeight: '600',
      color: palette.warning,
      textTransform: 'uppercase',
    },
    visualBlocksIndicator: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      marginTop: Spacing.sm,
      paddingVertical: Spacing.xs,
      paddingHorizontal: Spacing.sm,
      backgroundColor: `${palette.primary}12`,
      borderRadius: Radii.sm,
      alignSelf: 'flex-start',
    },
    visualBlocksText: {
      fontSize: 12,
      color: palette.primary,
      fontWeight: '500',
    },
    cardFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      paddingTop: Spacing.sm,
    },
    tapHint: {
      fontSize: 12,
      color: palette.textMuted,
    },
    difficultyContainer: {
      alignItems: 'center',
      gap: Spacing.sm,
    },
    difficultyPrompt: {
      fontSize: 14,
      color: palette.textMuted,
      fontWeight: '500',
    },
    difficultyButtons: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    difficultyButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: Radii.md,
      borderWidth: 1,
    },
    difficultyHard: {
      backgroundColor: '#fef2f2',
      borderColor: '#fecaca',
    },
    difficultyMedium: {
      backgroundColor: '#fffbeb',
      borderColor: '#fde68a',
    },
    difficultyEasy: {
      backgroundColor: '#f0fdf4',
      borderColor: '#bbf7d0',
    },
    difficultyText: {
      fontSize: 14,
      fontWeight: '600',
    },
    masteryInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: Spacing.xs,
    },
    masteryBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingVertical: 4,
      paddingHorizontal: Spacing.sm,
      backgroundColor: `${palette.warning}12`,
      borderRadius: Radii.pill,
    },
    masteryText: {
      fontSize: 12,
      color: palette.warning,
      fontWeight: '600',
    },
    reviewCountText: {
      fontSize: 12,
      color: palette.textMuted,
    },
  });
