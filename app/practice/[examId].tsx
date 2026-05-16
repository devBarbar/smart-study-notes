import { Button as ExpoButton, Host } from '@expo/ui';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import { Stack, useLocalSearchParams } from 'expo-router';
import { type ComponentProps, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
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
import { Colors, Fonts, Radii, Spacing } from '@/constants/theme';
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
import { PracticeExam, PracticeExamQuestion, PracticeExamResponse, ReviewQuality, StudyFeedback } from '@/types';

type ScoreTone = 'success' | 'warning' | 'danger' | 'muted';

const stripFeedbackCodeFence = (value: string) => {
  const fenceMatch = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenceMatch ? fenceMatch[1].trim() : value.trim();
};

const parseFeedbackJson = (value?: string) => {
  if (!value) return undefined;
  const clean = stripFeedbackCodeFence(value);
  if (!clean.startsWith('{')) return undefined;

  try {
    return JSON.parse(clean) as Partial<StudyFeedback>;
  } catch {
    return undefined;
  }
};

const normalizeFeedback = (raw: unknown): StudyFeedback | undefined => {
  if (!raw) return undefined;

  const base =
    typeof raw === 'string'
      ? ({ summary: raw, correctness: 'unknown' } as StudyFeedback)
      : ({ ...(raw as StudyFeedback) } as StudyFeedback);

  const parsed = parseFeedbackJson(base.summary);
  const merged = parsed ? { ...base, ...parsed } : base;

  return {
    ...merged,
    summary: typeof merged.summary === 'string' ? stripFeedbackCodeFence(merged.summary) : '',
    correctness: typeof merged.correctness === 'string' ? merged.correctness : 'unknown',
    whatWentRight: Array.isArray(merged.whatWentRight) ? merged.whatWentRight : [],
    whatWentWrong: Array.isArray(merged.whatWentWrong) ? merged.whatWentWrong : [],
    improvements: Array.isArray(merged.improvements) ? merged.improvements : [],
    misconceptions: Array.isArray(merged.misconceptions) ? merged.misconceptions : [],
    sourceNotes: Array.isArray(merged.sourceNotes) ? merged.sourceNotes : [],
    missingPrerequisites: Array.isArray(merged.missingPrerequisites) ? merged.missingPrerequisites : [],
  };
};

const getScoreTone = (score?: number): ScoreTone => {
  if (score === undefined) return 'muted';
  if (score >= 80) return 'success';
  if (score >= 50) return 'warning';
  return 'danger';
};

const getToneColor = (palette: typeof Colors.light, tone: ScoreTone) => {
  if (tone === 'success') return palette.success;
  if (tone === 'warning') return palette.warning;
  if (tone === 'danger') return palette.danger;
  return palette.textMuted;
};

const formatScore = (score?: number) => (score === undefined ? '--' : `${Math.round(score)}`);

const getCorrectnessIcon = (correctness?: string) => {
  if (correctness === 'correct') return 'checkmark-circle';
  if (correctness === 'partial') return 'contrast';
  if (correctness === 'incorrect') return 'close-circle';
  return 'sparkles';
};

export default function PracticeExamScreen() {
  const { examId, lectureId } = useLocalSearchParams<{ examId: string; lectureId?: string }>();
  const { t, agentLanguage } = useLanguage();
  const colorScheme = useColorScheme();
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const palette = Colors[scheme];
  const { width } = useWindowDimensions();
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

  const loadExam = useCallback(async (options: { showLoading?: boolean; showError?: boolean } = {}) => {
    if (!examId) return;
    const showLoading = options.showLoading ?? true;
    const showError = options.showError ?? true;
    if (showLoading) setLoading(true);
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
      if (showError) {
        Alert.alert(t('common.errorGeneric'), t('practiceExam.loadError'));
      }
    } finally {
      setLoading(false);
    }
  }, [examId, t]);

  useEffect(() => {
    loadExam();
  }, [loadExam]);

  const examIsGenerating = Boolean(
    exam &&
      exam.status !== 'completed' &&
      exam.status !== 'failed' &&
      (exam.status === 'pending' || questions.length === 0)
  );

  useEffect(() => {
    if (!examId || !examIsGenerating) return;

    const timer = setInterval(() => {
      loadExam({ showLoading: false, showError: false });
    }, 2500);

    return () => clearInterval(timer);
  }, [examId, examIsGenerating, loadExam]);

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
  }, [agentLanguage, answerImages, answers, examId, lectureId, questions, t]);

  const activeQuestion = useMemo(
    () => questions.find((q) => q.id === activeQuestionId),
    [activeQuestionId, questions]
  );

  const activeQuestionIndex = useMemo(() => {
    if (!activeQuestionId) return undefined;
    const idx = questions.findIndex((q) => q.id === activeQuestionId);
    return idx >= 0 ? idx + 1 : undefined;
  }, [activeQuestionId, questions]);

  const resultItems = useMemo(
    () =>
      questions.map((question) => {
        const response = responses[question.id];
        const feedback = normalizeFeedback(response?.feedback);
        return {
          question,
          response,
          feedback,
          score: response?.score ?? feedback?.score,
        };
      }),
    [questions, responses]
  );

  const answeredCount = useMemo(
    () =>
      questions.filter((question) => {
        const response = responses[question.id];
        return Boolean(
          answerImages[question.id] ||
            answers[question.id]?.trim() ||
            response?.userAnswer?.trim()
        );
      }).length,
    [answerImages, answers, questions, responses]
  );

  const gradedCount = resultItems.filter((item) => item.feedback || item.score !== undefined).length;
  const scoredItems = resultItems.filter((item) => item.score !== undefined);
  const computedAverage =
    scoredItems.length > 0
      ? scoredItems.reduce((sum, item) => sum + (item.score ?? 0), 0) / scoredItems.length
      : undefined;
  const averageScore = exam?.score ?? computedAverage;
  const scoreTone = getScoreTone(averageScore);
  const scoreColor = getToneColor(palette, scoreTone);
  const isCompact = width < 430;
  const firstImprovement = resultItems.find((item) => item.feedback?.improvements?.length)?.feedback
    ?.improvements?.[0];
  const firstGap = resultItems.find((item) => item.feedback?.whatWentWrong?.length)?.feedback
    ?.whatWentWrong?.[0];
  const heroInsight =
    firstImprovement ?? firstGap ?? (exam?.status === 'completed' ? t('practiceExam.resultReady') : t('practiceExam.resultPending'));

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
      <Stack.Screen
        options={{
          title: exam.title,
          headerBackTitle: t('practiceExam.back'),
        }}
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.container}
      >
        <View style={styles.hero}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroCopy}>
              <View style={styles.statusPill}>
                <View style={[styles.statusDot, { backgroundColor: scoreColor }]} />
                <ThemedText style={styles.statusPillText}>
                  {t(`practiceExam.status.${exam.status}`)}
                </ThemedText>
              </View>
              <ThemedText type="display" style={styles.heroTitle}>
                {exam.status === 'completed'
                  ? t('practiceExam.resultTitle')
                  : t('practiceExam.workbenchTitle')}
              </ThemedText>
              <ThemedText style={styles.heroSubtitle} selectable>
                {heroInsight}
              </ThemedText>
            </View>

            <View style={[styles.scoreRing, { borderColor: scoreColor }]}>
              <ThemedText style={[styles.scoreRingValue, { color: scoreColor }]}>
                {formatScore(averageScore)}
              </ThemedText>
              <ThemedText style={styles.scoreRingUnit}>/100</ThemedText>
            </View>
          </View>

          <View style={[styles.metricGrid, isCompact && styles.metricGridCompact]}>
            <View style={styles.metricTile}>
              <Ionicons name="document-text" size={18} color={palette.accent} />
              <View>
                <ThemedText style={styles.metricValue}>
                  {answeredCount}/{questions.length}
                </ThemedText>
                <ThemedText style={styles.metricLabel}>{t('practiceExam.answered')}</ThemedText>
              </View>
            </View>
            <View style={styles.metricTile}>
              <Ionicons name="ribbon" size={18} color={scoreColor} />
              <View>
                <ThemedText style={styles.metricValue}>{gradedCount}</ThemedText>
                <ThemedText style={styles.metricLabel}>{t('practiceExam.graded')}</ThemedText>
              </View>
            </View>
            <View style={styles.metricTile}>
              <Ionicons name="layers" size={18} color={palette.primary} />
              <View>
                <ThemedText style={styles.metricValue}>{exam.questionCount}</ThemedText>
                <ThemedText style={styles.metricLabel}>{t('practiceExam.questionsShort')}</ThemedText>
              </View>
            </View>
          </View>

          {exam.category && (
            <View style={styles.clusterBadge}>
              <Ionicons name="folder" size={14} color={palette.primary} />
              <ThemedText style={styles.clusterBadgeText}>
                {t('clusterQuiz.clusterLabel', { category: exam.category })}
              </ThemedText>
            </View>
          )}
        </View>

        {exam.status === 'pending' && (
          <View style={styles.generatingCard}>
            <ActivityIndicator color={palette.primary} />
            <ThemedText style={styles.generatingText}>{t('practiceExam.generating')}</ThemedText>
          </View>
        )}

        <View style={styles.sectionHeader}>
          <ThemedText type="subtitle">{t('practiceExam.reviewTitle')}</ThemedText>
          <ThemedText style={styles.sectionSubtitle}>{t('practiceExam.reviewSubtitle')}</ThemedText>
        </View>

        {resultItems.map(({ question: q, response, feedback, score }, idx) => {
          const tone = getScoreTone(score);
          const toneColor = getToneColor(palette, tone);
          const sourceLabel = q.sourceType ? t(`practiceExam.source.${q.sourceType}`) : undefined;
          const answerUri = answerImages[q.id];
          const savedAnswer = response?.userAnswer ?? answers[q.id];
          return (
            <View key={q.id} style={styles.questionCard}>
              <View style={styles.questionHeader}>
                <View style={styles.questionTitleBlock}>
                  <View style={styles.questionEyebrowRow}>
                    <ThemedText style={styles.questionEyebrow}>
                      {t('practiceExam.questionLabel', { index: idx + 1 })}
                    </ThemedText>
                    {sourceLabel && (
                      <View style={styles.sourceBadge}>
                        <ThemedText style={styles.sourceBadgeText}>{sourceLabel}</ThemedText>
                      </View>
                    )}
                  </View>
                  <View style={styles.questionPromptWrapper}>
                    <MarkdownText content={q.prompt} />
                  </View>
                </View>
                {score !== undefined && (
                  <View style={[styles.scoreBadge, { backgroundColor: `${toneColor}16`, borderColor: `${toneColor}44` }]}>
                    <ThemedText style={[styles.scoreBadgeText, { color: toneColor }]}>
                      {formatScore(score)}
                    </ThemedText>
                  </View>
                )}
              </View>

              <Pressable
                style={styles.answerInput}
                onPress={() => openCanvasForQuestion(q.id)}
                disabled={grading || exam.status === 'completed'}
              >
                {answerUri ? (
                  <View style={styles.answerPreview}>
                    <Image
                      source={{ uri: answerUri }}
                      style={styles.answerPreviewImage}
                      resizeMode="contain"
                    />
                    <View style={styles.answerPreviewFooter}>
                      <Ionicons name="create" size={15} color={palette.textMuted} />
                      <ThemedText style={styles.answerPreviewLabel}>
                        {exam.status === 'completed'
                          ? t('practiceExam.yourAnswer')
                          : t('practiceExam.tapToAnswer')}
                      </ThemedText>
                    </View>
                  </View>
                ) : (
                  <View style={styles.answerPlaceholderWrap}>
                    <View style={styles.answerPlaceholderIcon}>
                      <Ionicons name="pencil" size={18} color={palette.primary} />
                    </View>
                    <View style={styles.answerPlaceholderCopy}>
                      <ThemedText style={styles.answerPlaceholderTitle}>
                        {savedAnswer?.trim() ? t('practiceExam.answerSaved') : t('practiceExam.tapToAnswer')}
                      </ThemedText>
                      <ThemedText style={styles.answerPlaceholder}>
                        {exam.status === 'completed'
                          ? t('practiceExam.noCanvasPreview')
                          : t('practiceExam.answerPromptHint')}
                      </ThemedText>
                    </View>
                  </View>
                )}
              </Pressable>

              {feedback && (
                <View style={styles.feedbackCard}>
                  <View style={styles.feedbackHeader}>
                    <View style={[styles.feedbackIcon, { backgroundColor: `${toneColor}18` }]}>
                      <Ionicons
                        name={getCorrectnessIcon(feedback.correctness)}
                        size={18}
                        color={toneColor}
                      />
                    </View>
                    <View style={styles.feedbackHeaderCopy}>
                      <ThemedText style={styles.feedbackTitle}>{t('practiceExam.feedback')}</ThemedText>
                      <ThemedText style={styles.feedbackText} selectable>
                        {feedback.summary}
                      </ThemedText>
                    </View>
                  </View>

                  {feedback.whatWentWrong && feedback.whatWentWrong.length > 0 && (
                    <FeedbackBlock
                      icon="alert-circle"
                      title={t('practiceExam.whatWentWrong')}
                      items={feedback.whatWentWrong}
                      palette={palette}
                      toneColor={palette.danger}
                      styles={styles}
                    />
                  )}
                  {feedback.correctAnswer && (
                    <FeedbackBlock
                      icon="bulb"
                      title={t('practiceExam.correctAnswer')}
                      body={feedback.correctAnswer}
                      palette={palette}
                      toneColor={palette.success}
                      styles={styles}
                    />
                  )}
                  {feedback.rewriteExample && (
                    <FeedbackBlock
                      icon="sparkles"
                      title={t('practiceExam.rewriteExample')}
                      body={feedback.rewriteExample}
                      palette={palette}
                      toneColor={palette.accent}
                      styles={styles}
                    />
                  )}
                  {feedback.improvements && feedback.improvements.length > 0 && (
                    <FeedbackBlock
                      icon="trending-up"
                      title={t('practiceExam.nextSteps')}
                      items={feedback.improvements}
                      palette={palette}
                      toneColor={palette.primary}
                      styles={styles}
                    />
                  )}
                  {feedback.misconceptions && feedback.misconceptions.length > 0 && (
                    <FeedbackBlock
                      icon="git-compare"
                      title={t('practiceExam.misconceptions')}
                      items={feedback.misconceptions}
                      palette={palette}
                      toneColor={palette.warning}
                      styles={styles}
                    />
                  )}
                </View>
              )}
            </View>
          );
        })}

        <View style={styles.submitPanel}>
          <View style={styles.submitCopy}>
            <ThemedText style={styles.submitTitle}>
              {exam.status === 'completed' ? t('practiceExam.completedTitle') : t('practiceExam.readyToGrade')}
            </ThemedText>
            <ThemedText style={styles.submitSubtitle}>
              {exam.status === 'completed'
                ? t('practiceExam.completedBody', { score: Math.round(averageScore ?? 0) })
                : t('practiceExam.readyToGradeHint')}
            </ThemedText>
          </View>
          {grading && <ActivityIndicator color={palette.primary} />}
          <Host matchContents={{ vertical: true }} style={styles.nativeButtonHost}>
            <ExpoButton
              label={grading ? t('practiceExam.grading') : t('practiceExam.submit')}
              onPress={handleGrade}
              disabled={grading || exam.status === 'completed'}
              variant="filled"
            />
          </Host>
        </View>
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

function FeedbackBlock({
  icon,
  title,
  body,
  items,
  palette,
  toneColor,
  styles,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  title: string;
  body?: string;
  items?: string[];
  palette: typeof Colors.light;
  toneColor: string;
  styles: Record<string, any>;
}) {
  return (
    <View style={styles.feedbackBlock}>
      <View style={[styles.feedbackBlockIcon, { backgroundColor: `${toneColor}16` }]}>
        <Ionicons name={icon} size={16} color={toneColor} />
      </View>
      <View style={styles.feedbackBlockCopy}>
        <ThemedText style={styles.feedbackBlockTitle}>{title}</ThemedText>
        {body && (
          <ThemedText style={styles.feedbackBlockBody} selectable>
            {body}
          </ThemedText>
        )}
        {items && items.length > 0 && (
          <View style={styles.feedbackList}>
            {items.map((item, index) => (
              <View key={`${title}-${index}`} style={styles.feedbackListItem}>
                <View style={[styles.feedbackBullet, { backgroundColor: toneColor }]} />
                <ThemedText style={[styles.feedbackBlockBody, { color: palette.textMuted }]} selectable>
                  {item}
                </ThemedText>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const createStyles = (palette: typeof Colors.light) =>
  StyleSheet.create({
    container: {
      padding: Spacing.md,
      paddingBottom: Spacing.xl,
      gap: Spacing.lg,
      backgroundColor: palette.background,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      backgroundColor: palette.background,
    },
    hero: {
      padding: Spacing.lg,
      borderRadius: Radii.lg,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      gap: Spacing.lg,
      overflow: 'hidden',
      boxShadow: `0 18px 45px ${palette.shadow}`,
    },
    heroTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      gap: Spacing.md,
    },
    heroCopy: {
      flex: 1,
      gap: Spacing.sm,
    },
    statusPill: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: Radii.pill,
      backgroundColor: palette.surfaceAlt,
      borderWidth: 1,
      borderColor: palette.border,
    },
    statusDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
    },
    statusPillText: {
      color: palette.textMuted,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
    },
    heroTitle: {
      color: palette.text,
      fontSize: 28,
      lineHeight: 34,
    },
    heroSubtitle: {
      color: palette.textMuted,
      fontSize: 15,
      lineHeight: 22,
      maxWidth: 680,
    },
    scoreRing: {
      width: 104,
      height: 104,
      borderRadius: 52,
      borderWidth: 8,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: palette.background,
    },
    scoreRingValue: {
      fontSize: 30,
      lineHeight: 34,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
      fontFamily: Fonts?.rounded,
    },
    scoreRingUnit: {
      color: palette.textMuted,
      fontSize: 12,
      fontWeight: '700',
    },
    metricGrid: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    metricGridCompact: {
      flexDirection: 'column',
    },
    metricTile: {
      flex: 1,
      minHeight: 74,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      padding: Spacing.md,
      borderRadius: Radii.md,
      backgroundColor: palette.background,
      borderWidth: 1,
      borderColor: palette.border,
    },
    metricValue: {
      color: palette.text,
      fontSize: 18,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    metricLabel: {
      color: palette.textMuted,
      fontSize: 12,
      fontWeight: '600',
    },
    sectionHeader: {
      gap: 4,
    },
    sectionSubtitle: {
      color: palette.textMuted,
      fontSize: 14,
      lineHeight: 20,
    },
    generatingCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      padding: Spacing.md,
      borderRadius: Radii.md,
      backgroundColor: `${palette.primary}12`,
      borderWidth: 1,
      borderColor: `${palette.primary}30`,
    },
    generatingText: {
      color: palette.text,
      fontWeight: '600',
    },
    questionCard: {
      padding: Spacing.md,
      borderRadius: Radii.lg,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      gap: Spacing.md,
      boxShadow: `0 10px 28px ${palette.shadow}`,
    },
    questionHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: Spacing.md,
    },
    questionTitleBlock: {
      flex: 1,
      gap: Spacing.sm,
    },
    questionEyebrowRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: Spacing.xs,
    },
    questionEyebrow: {
      color: palette.primary,
      fontSize: 12,
      fontWeight: '800',
      textTransform: 'uppercase',
    },
    questionPromptWrapper: {
      gap: Spacing.xs,
    },
    sourceBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: Radii.pill,
      backgroundColor: `${palette.accent}14`,
      borderWidth: 1,
      borderColor: `${palette.accent}35`,
    },
    sourceBadgeText: {
      color: palette.accent,
      fontSize: 11,
      fontWeight: '800',
      textTransform: 'uppercase',
    },
    scoreBadge: {
      minWidth: 54,
      height: 54,
      borderRadius: 16,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scoreBadgeText: {
      fontSize: 20,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    answerInput: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: Radii.lg,
      padding: Spacing.md,
      backgroundColor: palette.background,
      minHeight: 116,
      justifyContent: 'center',
      overflow: 'hidden',
    },
    answerPlaceholderWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
    },
    answerPlaceholderIcon: {
      width: 44,
      height: 44,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: `${palette.primary}14`,
    },
    answerPlaceholderCopy: {
      flex: 1,
      gap: 2,
    },
    answerPlaceholderTitle: {
      color: palette.text,
      fontWeight: '700',
    },
    answerPlaceholder: {
      color: palette.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    answerPreview: {
      gap: Spacing.sm,
    },
    answerPreviewLabel: {
      color: palette.textMuted,
      fontSize: 13,
      fontWeight: '600',
    },
    answerPreviewImage: {
      width: '100%',
      height: 210,
      borderRadius: Radii.md,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
    },
    answerPreviewFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    feedbackCard: {
      padding: Spacing.md,
      borderRadius: Radii.lg,
      backgroundColor: palette.background,
      borderWidth: 1,
      borderColor: palette.border,
      gap: Spacing.md,
    },
    feedbackHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.sm,
    },
    feedbackIcon: {
      width: 38,
      height: 38,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
    },
    feedbackHeaderCopy: {
      flex: 1,
      gap: 3,
    },
    feedbackTitle: {
      color: palette.text,
      fontSize: 15,
      fontWeight: '800',
    },
    feedbackText: {
      color: palette.textMuted,
      fontSize: 14,
      lineHeight: 20,
    },
    feedbackBlock: {
      flexDirection: 'row',
      gap: Spacing.sm,
      padding: Spacing.sm,
      borderRadius: Radii.md,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
    },
    feedbackBlockIcon: {
      width: 32,
      height: 32,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
    },
    feedbackBlockCopy: {
      flex: 1,
      gap: Spacing.xs,
    },
    feedbackBlockTitle: {
      color: palette.text,
      fontSize: 14,
      fontWeight: '800',
    },
    feedbackBlockBody: {
      color: palette.text,
      fontSize: 14,
      lineHeight: 20,
    },
    feedbackList: {
      gap: Spacing.xs,
    },
    feedbackListItem: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.xs,
    },
    feedbackBullet: {
      width: 6,
      height: 6,
      borderRadius: 3,
      marginTop: 7,
    },
    submitPanel: {
      padding: Spacing.md,
      borderRadius: Radii.lg,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      gap: Spacing.md,
      marginBottom: Spacing.md,
    },
    submitCopy: {
      gap: 4,
    },
    submitTitle: {
      color: palette.text,
      fontWeight: '800',
      fontSize: 16,
    },
    submitSubtitle: {
      color: palette.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    nativeButtonHost: {
      alignSelf: 'stretch',
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
      padding: Spacing.md,
      borderRadius: Radii.lg,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
    },
    modalCanvasWrapper: {
      flex: 1,
      borderRadius: Radii.lg,
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
      borderRadius: Radii.pill,
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
      borderRadius: Radii.pill,
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
    clusterBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: Radii.pill,
      backgroundColor: `${palette.primary}14`,
      borderWidth: 1,
      borderColor: `${palette.primary}33`,
      alignSelf: 'flex-start',
    },
    clusterBadgeText: {
      color: palette.primary,
      fontSize: 13,
      fontWeight: '500',
    },
  });
