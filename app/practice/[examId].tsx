import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { v4 as uuid } from 'uuid';

import { CanvasToolbar } from '@/components/canvas-toolbar';
import {
  CanvasMode,
  CanvasStroke,
  HandwritingCanvas,
  HandwritingCanvasHandle,
} from '@/components/handwriting-canvas';
import { MarkdownText } from '@/components/markdown-text';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useLanguage } from '@/contexts/language-context';
import { evaluateAnswer } from '@/lib/openai';
import { computeMasteryScore, computeNextReviewDate } from '@/lib/mastery';
import {
  addReviewEvent,
  getPracticeExam,
  getPracticeExamQuestions,
  getUserStreak,
  listPracticeExamResponses,
  listReviewEvents,
  savePracticeExamResponse,
  updatePracticeExamStatus,
  updateStudyPlanEntryMastery,
  updateUserStreak,
} from '@/lib/supabase';
import { PracticeExam, PracticeExamQuestion, PracticeExamResponse, ReviewQuality } from '@/types';

export default function PracticeExamScreen() {
  const { examId, lectureId } = useLocalSearchParams<{ examId: string; lectureId?: string }>();
  const router = useRouter();
  const { t, agentLanguage } = useLanguage();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(palette), [palette]);

  const [exam, setExam] = useState<PracticeExam | null>(null);
  const [questions, setQuestions] = useState<PracticeExamQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [responses, setResponses] = useState<Record<string, PracticeExamResponse>>({});
  const [loading, setLoading] = useState(true);
  const [grading, setGrading] = useState(false);
  const [canvasVisible, setCanvasVisible] = useState(false);
  const [activeQuestionId, setActiveQuestionId] = useState<string | null>(null);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>('pen');
  const [canvasColor, setCanvasColor] = useState('#0f172a');
  const [canvasStrokes, setCanvasStrokes] = useState<Record<string, CanvasStroke[]>>({});
  const [draftStrokes, setDraftStrokes] = useState<CanvasStroke[]>([]);
  const [canvasInstanceKey, setCanvasInstanceKey] = useState(0);
  const [answerImages, setAnswerImages] = useState<Record<string, string>>({});

  const canvasRef = useRef<HandwritingCanvasHandle>(null);

  const loadExam = useCallback(async () => {
    if (!examId) return;
    setLoading(true);
    try {
      const [examData, examQuestions, existingResponses] = await Promise.all([
        getPracticeExam(examId),
        getPracticeExamQuestions(examId),
        listPracticeExamResponses(examId),
      ]);

      setExam(examData);
      setQuestions(examQuestions);

      const responseMap: Record<string, PracticeExamResponse> = {};
      const answerMap: Record<string, string> = {};
      existingResponses.forEach((resp) => {
        responseMap[resp.questionId] = resp;
        if (resp.userAnswer) answerMap[resp.questionId] = resp.userAnswer;
      });
      setResponses(responseMap);
      setAnswers(answerMap);

      if (examData?.status === 'ready') {
        await updatePracticeExamStatus(examId, { status: 'in_progress' });
        setExam({ ...examData, status: 'in_progress' });
      }
    } catch (err) {
      console.warn('[practice] failed to load exam', err);
      Alert.alert(t('common.errorGeneric'), t('practiceExam.loadError'));
    } finally {
      setLoading(false);
    }
  }, [examId, t]);

  useEffect(() => {
    loadExam();
  }, [loadExam]);

  const openCanvasForQuestion = useCallback(
    (questionId: string) => {
      setActiveQuestionId(questionId);
      setDraftStrokes(canvasStrokes[questionId] ?? []);
      setCanvasMode('pen');
      setCanvasVisible(true);
      setCanvasInstanceKey((key) => key + 1);
    },
    [canvasStrokes]
  );

  const closeCanvas = useCallback(() => {
    setCanvasVisible(false);
    setActiveQuestionId(null);
    setDraftStrokes([]);
  }, []);

  const handleCanvasStrokesChange = useCallback((strokes: CanvasStroke[]) => {
    setDraftStrokes(strokes);
  }, []);

  const handleCanvasClear = useCallback(() => {
    setDraftStrokes([]);
    canvasRef.current?.clear();
  }, []);

  const handleCanvasSave = useCallback(async () => {
    if (!activeQuestionId) return;

    const strokes = canvasRef.current?.getStrokes?.() ?? draftStrokes;
    setCanvasStrokes((prev) => ({ ...prev, [activeQuestionId]: strokes }));

    try {
      const uri = await canvasRef.current?.exportAsImage();
      if (uri) {
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const dataUrl = `data:image/png;base64,${base64}`;
        setAnswerImages((prev) => ({ ...prev, [activeQuestionId]: dataUrl }));
      }
    } catch (err) {
      console.warn('[practice] failed to export canvas', err);
      Alert.alert(t('common.errorGeneric'), t('practiceExam.gradingError'));
    } finally {
      closeCanvas();
    }
  }, [activeQuestionId, closeCanvas, draftStrokes, t]);

  const handleGrade = useCallback(async () => {
    if (!examId || questions.length === 0) return;
    setGrading(true);
    try {
      const newResponses: PracticeExamResponse[] = [];
      let recordedReviews = 0;

      for (const question of questions) {
        const userAnswer = answers[question.id] ?? '';
        const answerImageDataUrl = answerImages[question.id];
        const feedback = await evaluateAnswer(
          {
            question: { id: question.id, prompt: question.prompt },
            answerText: userAnswer,
            answerImageDataUrl,
            lectureId: lectureId as string | undefined,
          },
          agentLanguage
        );

        const response: PracticeExamResponse = {
          id: uuid(),
          practiceExamId: examId,
          questionId: question.id,
          userAnswer,
          feedback,
          score: feedback.score,
          createdAt: new Date().toISOString(),
        };

        await savePracticeExamResponse(response);
        newResponses.push(response);

        if (question.studyPlanEntryId) {
          recordedReviews += 1;
          const responseQuality: ReviewQuality =
            feedback.correctness === 'correct'
              ? 'correct'
              : feedback.correctness === 'incorrect'
              ? 'incorrect'
              : 'partial';

          await addReviewEvent({
            studyPlanEntryId: question.studyPlanEntryId,
            score: feedback.score,
            responseQuality,
            reviewedAt: new Date().toISOString(),
          });

          try {
            const history = await listReviewEvents(question.studyPlanEntryId, 50);
            const masteryScore = computeMasteryScore({ history });
            const reviewCount = history?.length ?? 0;
            const nextReviewAt = computeNextReviewDate({
              masteryScore,
              easeFactor: 2.5,
              reviewCount,
            });
            await updateStudyPlanEntryMastery(question.studyPlanEntryId, {
              masteryScore,
              nextReviewAt,
              reviewCount,
            });
          } catch (err) {
            console.warn('[practice] mastery update failed', err);
          }
        }
      }

      const average =
        newResponses.reduce((sum, resp) => sum + (resp.score ?? 0), 0) /
        (newResponses.length || 1);

      await updatePracticeExamStatus(examId, {
        status: 'completed',
        score: average,
        completedAt: new Date().toISOString(),
        error: null,
      });

      // Update streak once per exam completion
      if (recordedReviews > 0) {
        try {
          const streak = await getUserStreak();
          const today = new Date();
          const todayDate = today.toISOString().slice(0, 10);
          const last = streak.lastReviewDate;
          let current = 1;
          if (last === todayDate) {
            current = streak.current;
          } else if (last) {
            const lastDate = new Date(last);
            const diffDays = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays === 1) current = streak.current + 1;
          }
          const longest = Math.max(streak.longest, current);
          await updateUserStreak({
            current,
            longest,
            lastReviewDate: todayDate,
          });
        } catch (err) {
          console.warn('[practice] streak update failed', err);
        }
      }

      setResponses((prev) => {
        const merged = { ...prev };
        newResponses.forEach((r) => {
          merged[r.questionId] = r;
        });
        return merged;
      });

      setExam((prev) => (prev ? { ...prev, status: 'completed', score: average } : prev));

      Alert.alert(
        t('practiceExam.completedTitle'),
        t('practiceExam.completedBody', { score: Math.round(average) })
      );
    } catch (err) {
      console.warn('[practice] grading failed', err);
      Alert.alert(t('common.errorGeneric'), t('practiceExam.gradingError'));
    } finally {
      setGrading(false);
    }
  }, [agentLanguage, answers, examId, lectureId, questions, t]);

  const activeQuestion = useMemo(
    () => questions.find((q) => q.id === activeQuestionId),
    [activeQuestionId, questions]
  );

  const activeQuestionIndex = useMemo(() => {
    if (!activeQuestionId) return undefined;
    const idx = questions.findIndex((q) => q.id === activeQuestionId);
    return idx >= 0 ? idx + 1 : undefined;
  }, [activeQuestionId, questions]);

  if (!examId) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText>{t('practiceExam.notFound')}</ThemedText>
      </ThemedView>
    );
  }

  if (loading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
        <ThemedText>{t('practiceExam.loading')}</ThemedText>
      </ThemedView>
    );
  }

  if (!exam) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText>{t('practiceExam.notFound')}</ThemedText>
      </ThemedView>
    );
  }

  return (
    <>
      <ScrollView contentContainerStyle={styles.container}>
        <ThemedView style={styles.header}>
          <Pressable style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={18} color={palette.text} />
            <ThemedText>{t('practiceExam.back')}</ThemedText>
          </Pressable>
          <ThemedText type="title">{exam.title}</ThemedText>
          <ThemedText style={styles.metaText}>
            {t('practiceExam.metaDetail', {
              status: t(`practiceExam.status.${exam.status}`),
              count: exam.questionCount,
            })}
          </ThemedText>
          {exam.score !== undefined && (
            <ThemedText style={styles.scoreText}>
              {t('practiceExam.score', { value: Math.round(exam.score) })}
            </ThemedText>
          )}
        </ThemedView>

        {exam.status === 'pending' && (
          <ThemedText style={styles.metaText}>{t('practiceExam.generating')}</ThemedText>
        )}

        {questions.map((q, idx) => {
          const feedback = responses[q.id]?.feedback;
          return (
            <View key={q.id} style={styles.questionCard}>
              <View style={styles.questionHeader}>
                <ThemedText type="defaultSemiBold" style={styles.questionTitle}>
                  {t('practiceExam.questionLabel', { index: idx + 1 })}
                </ThemedText>
                {feedback?.score !== undefined && (
                  <View style={styles.scoreBadge}>
                    <ThemedText style={styles.scoreBadgeText}>{feedback.score}</ThemedText>
                  </View>
                )}
              </View>
              <View style={styles.questionPromptWrapper}>
                <MarkdownText content={q.prompt} />
              </View>
              <Pressable
                style={styles.answerInput}
                onPress={() => openCanvasForQuestion(q.id)}
                disabled={grading || exam.status === 'completed'}
              >
                {answerImages[q.id] ? (
                  <View style={styles.answerPreview}>
                    <ThemedText style={styles.answerPreviewLabel}>
                      {t('practiceExam.tapToAnswer')}
                    </ThemedText>
                    <Image
                      source={{ uri: answerImages[q.id] }}
                      style={styles.answerPreviewImage}
                      resizeMode="contain"
                    />
                  </View>
                ) : (
                  <ThemedText style={styles.answerPlaceholder}>{t('practiceExam.tapToAnswer')}</ThemedText>
                )}
              </Pressable>
              {feedback && (
                <View style={styles.feedbackCard}>
                  <ThemedText type="defaultSemiBold">{t('practiceExam.feedback')}</ThemedText>
                  <ThemedText style={styles.feedbackText}>{feedback.summary}</ThemedText>
                  {feedback.improvements && feedback.improvements.length > 0 && (
                    <View style={styles.feedbackList}>
                      {feedback.improvements.map((tip, tipIdx) => (
                        <ThemedText key={tipIdx} style={styles.feedbackTip}>
                          • {tip}
                        </ThemedText>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </View>
          );
        })}

        <Pressable
          style={[styles.submitButton, grading && styles.buttonDisabled]}
          onPress={handleGrade}
          disabled={grading || exam.status === 'completed'}
        >
          {grading ? (
            <ActivityIndicator color={palette.textOnPrimary} />
          ) : (
            <>
              <Ionicons name="checkmark" size={18} color={palette.textOnPrimary} />
              <ThemedText type="defaultSemiBold" style={styles.submitButtonText}>
                {t('practiceExam.submit')}
              </ThemedText>
            </>
          )}
        </Pressable>
      </ScrollView>

      <Modal visible={canvasVisible} animationType="slide" onRequestClose={closeCanvas}>
        <ThemedView style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Pressable style={styles.modalBackButton} onPress={closeCanvas}>
              <Ionicons name="close" size={18} color={palette.text} />
              <ThemedText>{t('common.cancel')}</ThemedText>
            </Pressable>
            {activeQuestionIndex && (
              <ThemedText type="title">
                {t('practiceExam.questionLabel', { index: activeQuestionIndex })}
              </ThemedText>
            )}
          </View>

          {activeQuestion && (
            <View style={styles.modalPrompt}>
              <MarkdownText content={activeQuestion.prompt} />
            </View>
          )}

          <CanvasToolbar
            mode={canvasMode}
            color={canvasColor}
            onModeChange={(mode) => {
              setCanvasMode(mode);
              canvasRef.current?.setMode(mode);
            }}
            onColorChange={(color) => {
              setCanvasColor(color);
              canvasRef.current?.setColor(color);
            }}
            onClear={handleCanvasClear}
            onUndo={() => canvasRef.current?.undo()}
          />

          <View style={styles.modalCanvasWrapper}>
            <HandwritingCanvas
              key={`${activeQuestionId ?? 'canvas'}-${canvasInstanceKey}`}
              ref={canvasRef}
              height={420}
              strokeColor={canvasColor}
              mode={canvasMode}
              initialStrokes={draftStrokes}
              onStrokesChange={handleCanvasStrokesChange}
            />
          </View>

          <View style={styles.modalActions}>
            <Pressable style={[styles.secondaryButton, styles.modalButton]} onPress={handleCanvasClear}>
              <ThemedText style={styles.secondaryButtonText}>{t('practiceExam.clearCanvas')}</ThemedText>
            </Pressable>
            <Pressable style={[styles.primaryButton, styles.modalButton]} onPress={handleCanvasSave}>
              <ThemedText style={styles.primaryButtonText}>{t('practiceExam.saveAnswer')}</ThemedText>
            </Pressable>
          </View>
        </ThemedView>
      </Modal>
    </>
  );
}

const createStyles = (palette: typeof Colors.light) =>
  StyleSheet.create({
    container: {
      padding: Spacing.lg,
      gap: Spacing.md,
      backgroundColor: palette.background,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      backgroundColor: palette.background,
    },
    header: {
      gap: Spacing.xs,
      marginBottom: Spacing.sm,
    },
    metaText: {
      color: palette.textMuted,
      fontSize: 13,
    },
    backButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      marginBottom: Spacing.xs,
    },
    scoreText: {
      color: palette.success,
      fontSize: 16,
      fontWeight: '700',
    },
    questionCard: {
      padding: Spacing.md,
      borderRadius: Radii.md,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      gap: Spacing.sm,
    },
    questionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    questionTitle: {
      color: palette.text,
      fontSize: 15,
    },
    questionPromptWrapper: {
      gap: Spacing.xs,
    },
    answerInput: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: Radii.md,
      padding: Spacing.sm,
      backgroundColor: palette.surfaceAlt,
      minHeight: 100,
      justifyContent: 'center',
      gap: Spacing.xs,
    },
    answerPlaceholder: {
      color: palette.textMuted,
    },
    answerPreview: {
      gap: Spacing.xs,
    },
    answerPreviewLabel: {
      color: palette.textMuted,
      fontSize: 13,
    },
    answerPreviewImage: {
      width: '100%',
      height: 180,
      borderRadius: Radii.md,
      backgroundColor: palette.surface,
    },
    submitButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      backgroundColor: palette.primary,
      paddingVertical: 12,
      borderRadius: Radii.md,
      marginBottom: Spacing.lg,
    },
    submitButtonText: {
      color: palette.textOnPrimary,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    scoreBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: Radii.pill,
      backgroundColor: `${palette.success}14`,
      borderWidth: 1,
      borderColor: `${palette.success}33`,
    },
    scoreBadgeText: {
      color: palette.success,
      fontWeight: '700',
    },
    feedbackCard: {
      padding: Spacing.sm,
      borderRadius: Radii.md,
      backgroundColor: palette.surfaceAlt,
      borderWidth: 1,
      borderColor: palette.border,
      gap: Spacing.xs,
    },
    feedbackText: {
      color: palette.text,
    },
    feedbackList: {
      gap: 4,
    },
    feedbackTip: {
      color: palette.textMuted,
      fontSize: 13,
    },
    modalContainer: {
      flex: 1,
      backgroundColor: palette.background,
      padding: Spacing.lg,
      gap: Spacing.md,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    modalBackButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    modalPrompt: {
      maxHeight: 180,
      padding: Spacing.sm,
      borderRadius: Radii.md,
      backgroundColor: palette.surfaceAlt,
      borderWidth: 1,
      borderColor: palette.border,
    },
    modalCanvasWrapper: {
      flex: 1,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      overflow: 'hidden',
      backgroundColor: palette.surface,
    },
    modalActions: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    modalButton: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingVertical: 12,
    },
    primaryButton: {
      backgroundColor: palette.primary,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: Radii.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
    },
    primaryButtonText: {
      color: palette.textOnPrimary,
      fontWeight: '600',
    },
    secondaryButton: {
      borderRadius: Radii.md,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      justifyContent: 'center',
      alignItems: 'center',
    },
    secondaryButtonText: {
      color: palette.text,
      fontWeight: '600',
    },
  });


