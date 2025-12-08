import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, LayoutChangeEvent, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { v4 as uuid } from 'uuid';

import { PdfWebView } from '@/components/pdf-webview';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Colors, Radii, Shadows, Spacing } from '@/constants/theme';
import { useLanguage } from '@/contexts/language-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useLectures } from '@/hooks/use-lectures';
import { usePracticeExams } from '@/hooks/use-practice-exams';
import { useSessions } from '@/hooks/use-sessions';
import { buildLectureChunks, ExtractedPdfPage, extractPdfText, generatePracticeExam, generateReadinessAndRoadmap, generateStudyPlan } from '@/lib/openai';
import { countLectureChunks, createSession, deleteLecture, deleteLectureChunksForLecture, getLectureTotalCost, getSupabase, saveLectureInsights, saveStudyPlanEntries, updateLectureFileText, updateLectureNotes, updateLecturePlanStatus, upsertLectureChunks } from '@/lib/supabase';
import { RoadmapStep, SectionStatus, StudyPlanEntry, StudyReadiness, StudySession } from '@/types';

const stripCodeFences = (text: string) => {
  const fenceMatch = text.match(/```(?:json)?\n?([\s\S]*?)```/i);
  return fenceMatch ? fenceMatch[1].trim() : text;
};

const GOAL_THRESHOLDS = { pass: 50, good: 70, ace: 80 };

export default function LectureDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: lectures = [], isFetching, refetch } = useLectures();
  const { data: sessions = [], refetch: refetchSessions } = useSessions();
  const { data: practiceExams = [], refetch: refetchPracticeExams, isFetching: loadingPracticeExams } = usePracticeExams(id);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t, agentLanguage } = useLanguage();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(palette), [palette]);
  const [startingSession, setStartingSession] = useState<string | null>(null);
  const [generatingPlan, setGeneratingPlan] = useState(false);
  const [generationProgress, setGenerationProgress] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [readiness, setReadiness] = useState<StudyReadiness | undefined>(undefined);
  const [roadmap, setRoadmap] = useState<RoadmapStep[] | undefined>(undefined);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [categoryOpen, setCategoryOpen] = useState<Record<string, boolean>>({});
  const [lectureCost, setLectureCost] = useState<number | null>(null);
  const [creatingPracticeExam, setCreatingPracticeExam] = useState(false);
  const [questionCount, setQuestionCount] = useState('5');
  const [deletingLecture, setDeletingLecture] = useState(false);

  // Refs for scroll-to functionality
  const scrollViewRef = useRef<ScrollView>(null);
  const entryPositionsRef = useRef<Record<string, number>>({});
  
  // Track previous passed count to detect when a topic is newly passed
  const prevPassedCountRef = useRef<number | null>(null);

  const lecture = useMemo(() => lectures.find((l) => l.id === id), [lectures, id]);
  
  // Find existing sessions for this lecture
  const existingFullSession = useMemo(() => 
    sessions.find(s => s.lectureId === id && !s.studyPlanEntryId),
    [sessions, id]
  );
  
  // Map of studyPlanEntryId -> existing session
  const existingEntrySessions = useMemo(() => {
    const map: Record<string, StudySession> = {};
    for (const session of sessions) {
      if (session.lectureId === id && session.studyPlanEntryId) {
        // Keep the most recent session per entry
        if (!map[session.studyPlanEntryId] || 
            new Date(session.createdAt) > new Date(map[session.studyPlanEntryId].createdAt)) {
          map[session.studyPlanEntryId] = session;
        }
      }
    }
    return map;
  }, [sessions, id]);
  
  // Refetch sessions on mount
  useEffect(() => {
    refetchSessions();
  }, [refetchSessions]);

  // Fetch lecture total cost
  useEffect(() => {
    if (!id) return;
    getLectureTotalCost(id)
      .then((cost) => setLectureCost(cost))
      .catch((err) => console.warn('[lecture] failed to fetch cost', err));
  }, [id]);

  useEffect(() => {
    if (!lecture) return;
    setNotesDraft(lecture.additionalNotes ?? '');
    setReadiness(lecture.readiness ?? undefined);
    setRoadmap(lecture.roadmap ?? undefined);
  }, [lecture?.id, lecture?.additionalNotes, lecture?.readiness, lecture?.roadmap]);

  const notesDirty = useMemo(
    () => (notesDraft ?? '') !== (lecture?.additionalNotes ?? ''),
    [lecture?.additionalNotes, notesDraft]
  );

  const embeddingsCheckedRef = useRef(false);

  useEffect(() => {
    const backfillEmbeddings = async () => {
      if (!lecture || embeddingsCheckedRef.current) return;
      embeddingsCheckedRef.current = true;
      try {
        const existingCount = await countLectureChunks(lecture.id);
        if ((existingCount ?? 0) > 0) return;

        const allChunks: {
          lectureId: string;
          lectureFileId: string;
          pageNumber: number;
          chunkIndex: number;
          content: string;
          embedding: number[];
          contentHash?: string;
        }[] = [];
        for (const file of lecture.files) {
          const chunks = await buildLectureChunks(lecture.id, file);
          chunks.forEach((chunk) =>
            allChunks.push({
              lectureId: lecture.id,
              lectureFileId: file.id,
              pageNumber: chunk.pageNumber,
              chunkIndex: chunk.chunkIndex,
              content: chunk.content,
              embedding: chunk.embedding,
              contentHash: chunk.contentHash,
            })
          );
        }

        if (allChunks.length > 0) {
          await deleteLectureChunksForLecture(lecture.id);
          await upsertLectureChunks(allChunks);
          console.log('[lecture] embeddings backfilled', { chunks: allChunks.length });
        }
      } catch (err) {
        console.warn('[lecture] embedding backfill skipped', err);
      }
    };

    backfillEmbeddings();
  }, [lecture]);

  const startSession = async (studyPlanEntry?: StudyPlanEntry, forceNew = false) => {
    if (!lecture) return;
    
    const entryId = studyPlanEntry?.id;
    setStartingSession(entryId || 'full');
    
    try {
      const sessionId = uuid();
      const sessionTitle = studyPlanEntry 
        ? `${lecture.title}: ${studyPlanEntry.title}`
        : `${lecture.title} - Full Study`;
      
      const newSession: StudySession = {
        id: sessionId,
        lectureId: lecture.id,
        studyPlanEntryId: entryId,
        title: sessionTitle,
        status: 'active',
        createdAt: new Date().toISOString(),
      };

      if (getSupabase()) {
        await createSession(newSession);
      }

      const params = new URLSearchParams({
        lectureId: lecture.id,
      });
      if (entryId) {
        params.set('studyPlanEntryId', entryId);
      }

      router.push(`/study/${sessionId}?${params.toString()}`);
    } finally {
      setStartingSession(null);
    }
  };
  
  const continueSession = (session: StudySession) => {
    if (!lecture) return;
    
    setStartingSession(session.studyPlanEntryId || 'full');
    
    const params = new URLSearchParams({
      lectureId: lecture.id,
    });
    if (session.studyPlanEntryId) {
      params.set('studyPlanEntryId', session.studyPlanEntryId);
    }

    router.push(`/study/${session.id}?${params.toString()}`);
    setStartingSession(null);
  };

  const goToPracticeExam = useCallback((examId: string) => {
    if (!lecture) return;
    router.push(`/practice/${examId}?lectureId=${lecture.id}`);
  }, [lecture, router]);

  const handleGeneratePracticeExam = useCallback(async () => {
    if (!lecture) return;
    setCreatingPracticeExam(true);
    try {
      const parsedCount = Math.max(1, Math.min(20, parseInt(questionCount, 10) || 5));
      const result = await generatePracticeExam({
        lectureId: lecture.id,
        questionCount: parsedCount,
        language: agentLanguage,
        title: `${lecture.title} Practice Exam`,
      });
      if (result.practiceExamId) {
        await refetchPracticeExams();
      }
      Alert.alert(t('practiceExam.createdTitle'), t('practiceExam.createdBody'));
    } catch (err) {
      console.warn('[lecture] practice exam generation failed', err);
      Alert.alert(t('common.errorGeneric'), t('practiceExam.errorCreating'));
    } finally {
      setCreatingPracticeExam(false);
    }
  }, [agentLanguage, lecture, questionCount, refetchPracticeExams, t]);

  const performDeleteLecture = useCallback(async () => {
    if (!lecture) return;
    setDeletingLecture(true);
    try {
      await deleteLecture(lecture.id, lecture.files);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lectures'] }),
        queryClient.invalidateQueries({ queryKey: ['sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['practice-exams', lecture.id] }),
      ]);
      Alert.alert(t('lectureDetail.deleteSuccessTitle'), t('lectureDetail.deleteSuccessBody'));
      router.replace('/');
    } catch (err) {
      console.warn('[lecture] delete failed', err);
      Alert.alert(t('common.errorGeneric'), t('lectureDetail.deleteError'));
    } finally {
      setDeletingLecture(false);
    }
  }, [lecture, queryClient, router, t]);

  const confirmDeleteLecture = useCallback(() => {
    if (!lecture || deletingLecture) return;
    Alert.alert(
      t('lectureDetail.deleteTitle'),
      t('lectureDetail.deleteConfirm'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('lectureDetail.deleteConfirmCta'), style: 'destructive', onPress: performDeleteLecture },
      ]
    );
  }, [deletingLecture, lecture, performDeleteLecture, t]);

  const generatePlan = async () => {
    if (!lecture || lecture.files.length === 0) {
      Alert.alert(t('lectureDetail.alert.noMaterialsTitle'), t('lectureDetail.alert.noMaterialsBody'));
      return;
    }

    const generationStartedAt = Date.now();
    const lectureId = lecture.id;
    setGeneratingPlan(true);
    setGenerationProgress(t('lectureDetail.statusPreparing'));
    let embeddingsPromise: Promise<void> | undefined;

    try {
      await updateLecturePlanStatus(lectureId, {
        planStatus: 'pending',
        planGeneratedAt: null,
        planError: null,
      });
      const notesForPlan = (notesDraft || lecture.additionalNotes || '').trim();

      // Step 1: Try to extract text from PDFs if not already extracted
      const extractedTexts: { fileName: string; text: string; isExam?: boolean }[] = [];
      let hasExtractedText = false;
      const extractedPages: Record<string, ExtractedPdfPage[] | undefined> = {};

      for (let i = 0; i < lecture.files.length; i++) {
        const file = lecture.files[i];
        setGenerationProgress(`Analyzing ${i + 1}/${lecture.files.length}: ${file.name}`);

        // Check if we already have extracted text
        if (file.extractedText && file.extractedText.length > 0) {
          extractedTexts.push({ fileName: file.name, text: file.extractedText, isExam: Boolean(file.isExam) });
          hasExtractedText = true;
        } else {
          // Try to extract text
          try {
            const extraction = await extractPdfText(file.uri);
            const text = extraction.text;
            extractedTexts.push({ fileName: file.name, text, isExam: Boolean(file.isExam) });
            extractedPages[file.id] = extraction.pages;
            if (text.length > 0) {
              hasExtractedText = true;
              // Save extracted text to database
              try {
                await updateLectureFileText(file.id, text);
              } catch (saveErr) {
                console.warn('[lecture] Failed to save extracted text:', saveErr);
              }
            }
          } catch (err) {
            console.warn(`[lecture] Failed to extract text from ${file.name}:`, err);
            extractedTexts.push({ fileName: file.name, text: '', isExam: Boolean(file.isExam) });
          }
        }
      }

      const indexEmbeddings = async () => {
        try {
          const allChunks: {
            lectureId: string;
            lectureFileId: string;
            pageNumber: number;
            chunkIndex: number;
            content: string;
            embedding: number[];
            contentHash?: string;
          }[] = [];
          for (const file of lecture.files) {
            const chunks = await buildLectureChunks(lectureId, file, extractedPages[file.id]);
            chunks.forEach((chunk) =>
              allChunks.push({
                lectureId,
                lectureFileId: file.id,
                pageNumber: chunk.pageNumber,
                chunkIndex: chunk.chunkIndex,
                content: chunk.content,
                embedding: chunk.embedding,
                contentHash: chunk.contentHash,
              })
            );
          }

          if (allChunks.length > 0) {
            await deleteLectureChunksForLecture(lectureId);
            await upsertLectureChunks(allChunks);
            console.log('[lecture] embeddings indexed', { chunks: allChunks.length });
          }
        } catch (err) {
          console.warn('[lecture] embedding indexing failed', err);
        }
      };

      embeddingsPromise = hasExtractedText ? indexEmbeddings() : Promise.resolve();

      // Step 2: Generate study plan
      setGenerationProgress(t('lectureDetail.generating'));

      let studyPlanEntries: Awaited<ReturnType<typeof generateStudyPlan>>['entries'] = [];
      let planCostUsd: number | undefined;
      
      if (hasExtractedText) {
        const planResult = await generateStudyPlan(extractedTexts, agentLanguage, {
          additionalNotes: notesForPlan || undefined,
          thresholds: GOAL_THRESHOLDS,
          lectureId,
        });
        studyPlanEntries = planResult.entries;
        planCostUsd = planResult.costUsd;
      } else {
        // Fallback: generate based on file names
        console.log('[lecture] No text extracted, generating plan from file names');
        const planResult = await generateStudyPlan(
          lecture.files.map(f => ({ 
            fileName: f.name, 
            text: `PDF Document: ${f.name}. This file covers topics related to ${f.name.replace('.pdf', '').replace(/[-_]/g, ' ')}.`,
            isExam: Boolean(f.isExam),
          })),
          agentLanguage,
          {
            additionalNotes: notesForPlan || undefined,
            thresholds: GOAL_THRESHOLDS,
            lectureId,
          }
        );
        studyPlanEntries = planResult.entries;
        planCostUsd = planResult.costUsd;
      }

      // Step 3: Save study plan to database
      setGenerationProgress(t('lectureDetail.progress.savingPlan'));

      if (studyPlanEntries.length > 0) {
        await saveStudyPlanEntries(lecture.id, studyPlanEntries);
      }

      await updateLecturePlanStatus(lectureId, {
        planStatus: 'ready',
        planGeneratedAt: new Date().toISOString(),
        planError: null,
      });

      if (embeddingsPromise) {
        await embeddingsPromise;
      }

      // Step 4: Refresh data
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['lectures'] });

      setGenerationProgress('');
      console.log('[lecture] study plan generation succeeded', {
        lectureId,
        entries: studyPlanEntries.length,
        costUsd: planCostUsd,
        durationMs: Date.now() - generationStartedAt,
      });
      Alert.alert('Success', `Study plan created with ${studyPlanEntries.length} topics!`);
    } catch (error) {
      const message = (error as any)?.message ?? String(error);
      console.error('[lecture] Study plan generation failed:', error);
      try {
        await updateLecturePlanStatus(lectureId, {
          planStatus: 'failed',
          planGeneratedAt: null,
          planError: message.slice(0, 500),
        });
      } catch (statusError) {
        console.warn('[lecture] Failed to update plan status after error:', statusError);
      }
      Alert.alert('Error', 'Failed to generate study plan. Please try again.');
      setGenerationProgress('');
      try {
        if (embeddingsPromise) {
          await embeddingsPromise;
        }
      } catch (err) {
        console.warn('[lecture] embedding indexing (post-error) failed', err);
      }
    } finally {
      setGeneratingPlan(false);
    }
  };

  const handleSaveNotes = useCallback(async () => {
    if (!lecture) return;
    setSavingNotes(true);
    try {
      await updateLectureNotes(lecture.id, notesDraft.trim() || null);
      queryClient.invalidateQueries({ queryKey: ['lectures'] });
    } catch (err) {
      console.warn('[lecture] failed to save notes', err);
      Alert.alert(t('common.errorGeneric'), t('lectureDetail.notesSaveError'));
    } finally {
      setSavingNotes(false);
    }
  }, [lecture, notesDraft, queryClient, t]);

  const toggleCategory = useCallback((category: string) => {
    setCategoryOpen((prev) => ({ ...prev, [category]: !prev[category] }));
  }, []);

  // Record position of a study plan entry for scroll-to
  const handleEntryLayout = useCallback((entryId: string, event: LayoutChangeEvent) => {
    const { y } = event.nativeEvent.layout;
    entryPositionsRef.current[entryId] = y;
  }, []);

  // Scroll to a study plan entry by matching title
  const scrollToEntry = useCallback((roadmapTitle: string) => {
    if (!orderedPlan || orderedPlan.length === 0) return;
    
    // Find matching entry by title (case-insensitive)
    const normalizedTitle = roadmapTitle.toLowerCase().trim();
    const matchingEntry = orderedPlan.find(
      (entry) => entry.title.toLowerCase().trim() === normalizedTitle
    );
    
    if (matchingEntry) {
      // Open the category containing this entry
      const category = matchingEntry.category || 'General';
      setCategoryOpen((prev) => ({ ...prev, [category]: true }));
      
      // Scroll to the entry after a brief delay to allow category to expand
      setTimeout(() => {
        const position = entryPositionsRef.current[matchingEntry.id];
        if (position !== undefined && scrollViewRef.current) {
          scrollViewRef.current.scrollTo({ y: position - 100, animated: true });
        }
      }, 150);
    }
  }, [orderedPlan]);

  if (isFetching && !lecture) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
        <ThemedText>{t('lectureDetail.loading')}</ThemedText>
      </ThemedView>
    );
  }

  if (!lecture) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText>{t('lectureDetail.notFound')}</ThemedText>
      </ThemedView>
    );
  }

  const orderedPlan = useMemo(
    () =>
      lecture?.studyPlan
        ? [...lecture.studyPlan].sort((a, b) => a.orderIndex - b.orderIndex)
        : [],
    [lecture?.studyPlan]
  );

  const planOrderLookup = useMemo(() => {
    const map: Record<string, number> = {};
    orderedPlan.forEach((entry, idx) => {
      map[entry.id] = idx + 1;
    });
    return map;
  }, [orderedPlan]);

  const categorizedPlan = useMemo(() => {
    const buckets = new Map<string, StudyPlanEntry[]>();
    orderedPlan.forEach((entry) => {
      const category = entry.category || 'General';
      if (!buckets.has(category)) {
        buckets.set(category, []);
      }
      buckets.get(category)!.push(entry);
    });
    return Array.from(buckets.entries()).map(([category, entries]) => ({
      category,
      entries,
    }));
  }, [orderedPlan]);

  useEffect(() => {
    setCategoryOpen((prev) => {
      const next = { ...prev };
      categorizedPlan.forEach((group, idx) => {
        if (next[group.category] === undefined) {
          next[group.category] = idx === 0;
        }
      });
      return next;
    });
  }, [categorizedPlan]);

  const hasStudyPlan = orderedPlan.length > 0;
  const planStatus = lecture.planStatus ?? (hasStudyPlan ? 'ready' : undefined);
  const isPlanPending = planStatus === 'pending';
  const isPlanFailed = planStatus === 'failed';
  const showGenerateSpinner = generatingPlan || isPlanPending;

  const sectionStatusCounts = useMemo(() => {
    let passed = 0;
    let failed = 0;
    let inProgress = 0;
    let notStarted = 0;
    orderedPlan.forEach((entry) => {
      const status = (entry.status ?? 'not_started') as SectionStatus;
      if (status === 'passed') passed += 1;
      else if (status === 'failed') failed += 1;
      else if (status === 'in_progress') inProgress += 1;
      else notStarted += 1;
    });
    return { passed, failed, inProgress, notStarted };
  }, [orderedPlan]);

  const refreshInsights = useCallback(async () => {
    if (!lecture || orderedPlan.length === 0) return;
    setLoadingInsights(true);
    setInsightError(null);
    try {
      const result = await generateReadinessAndRoadmap({
        planEntries: orderedPlan,
        additionalNotes: (notesDraft || lecture.additionalNotes || '').trim(),
        thresholds: GOAL_THRESHOLDS,
        progress: {
          passed: sectionStatusCounts.passed,
          inProgress: sectionStatusCounts.inProgress,
          notStarted: sectionStatusCounts.notStarted,
          failed: sectionStatusCounts.failed,
        },
        language: agentLanguage,
      });
      setReadiness(result.readiness);
      setRoadmap(result.roadmap);
      await saveLectureInsights(lecture.id, result);
      queryClient.invalidateQueries({ queryKey: ['lectures'] });
    } catch (err: any) {
      console.warn('[lecture] readiness refresh failed', err);
      setInsightError(err?.message ? String(err.message) : t('lectureDetail.insightsError'));
    } finally {
      setLoadingInsights(false);
    }
  }, [agentLanguage, lecture, notesDraft, orderedPlan, queryClient, sectionStatusCounts.failed, sectionStatusCounts.inProgress, sectionStatusCounts.notStarted, sectionStatusCounts.passed, t]);

  // Only auto-refresh insights when a topic is newly passed (not on every visit)
  useEffect(() => {
    if (!hasStudyPlan) {
      prevPassedCountRef.current = null;
      return;
    }
    
    // On first render with section counts, store the initial value without refreshing
    if (prevPassedCountRef.current === null) {
      prevPassedCountRef.current = sectionStatusCounts.passed;
      return;
    }
    
    // If passed count increased, a topic was just passed - refresh insights
    if (
      sectionStatusCounts.passed > prevPassedCountRef.current &&
      !loadingInsights
    ) {
      prevPassedCountRef.current = sectionStatusCounts.passed;
      refreshInsights();
    }
  }, [hasStudyPlan, sectionStatusCounts.passed, loadingInsights, refreshInsights]);

  const renderStatusBadge = (status: SectionStatus | undefined) => {
    const value = status ?? 'not_started';
    const label =
      value === 'passed'
        ? t('lectureDetail.sectionStatus.passed')
        : value === 'failed'
        ? t('lectureDetail.sectionStatus.failed')
        : value === 'in_progress'
        ? t('lectureDetail.sectionStatus.inProgress')
        : t('lectureDetail.sectionStatus.notStarted');
    const style =
      value === 'passed'
        ? styles.statusBadgePassed
        : value === 'failed'
        ? styles.statusBadgeFailed
        : value === 'in_progress'
        ? styles.statusBadgeInProgress
        : styles.statusBadgeNotStarted;

    return (
      <View style={[styles.statusBadge, style]}>
        <ThemedText style={styles.statusBadgeText}>{label}</ThemedText>
      </View>
    );
  };

  const renderReadinessRow = (label: string, value: number, target: number, color: string) => (
    <View style={styles.readinessRow}>
      <View style={styles.readinessRowHeader}>
        <ThemedText type="defaultSemiBold">{label}</ThemedText>
        <ThemedText style={styles.readinessTargetText}>
          {t('lectureDetail.readinessTarget', { target })}
        </ThemedText>
      </View>
      <View style={styles.readinessBar}>
        <View style={[styles.readinessFill, { width: `${Math.min(100, value)}%`, backgroundColor: color }]} />
        <ThemedText style={styles.readinessValue}>{`${Math.round(value)}%`}</ThemedText>
      </View>
    </View>
  );

  const readinessData = readiness ?? { pass: 0, good: 0, ace: 0 };
  const roadmapItems = roadmap ?? [];

  return (
    <ScrollView ref={scrollViewRef} contentContainerStyle={styles.container}>
      {/* Header Section */}
      <ThemedView style={styles.header}>
        <ThemedText type="title">{lecture.title}</ThemedText>
        <ThemedText style={styles.description}>
          {stripCodeFences(lecture.description) || t('lectureDetail.noDescription')}
        </ThemedText>
        {typeof lectureCost === 'number' && lectureCost > 0 && (
          <ThemedText style={styles.lectureCost}>
            {t('lectureDetail.aiCost', { value: lectureCost.toFixed(4) })}
          </ThemedText>
        )}
        <View style={styles.sessionButtonsRow}>
          {existingFullSession ? (
            <>
              <Pressable 
                style={[styles.button, styles.continueSessionButton]} 
                onPress={() => continueSession(existingFullSession)}
                disabled={startingSession !== null}
              >
                {startingSession === 'full' ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="play" size={18} color="#fff" />
                    <ThemedText type="defaultSemiBold" style={styles.buttonText}>
                      {t('lectureDetail.continueSession')}
                    </ThemedText>
                  </>
                )}
              </Pressable>
              <Pressable 
                style={[styles.button, styles.newSessionButton]} 
                onPress={() => startSession(undefined, true)}
                disabled={startingSession !== null}
              >
                <Ionicons name="add" size={18} color="#0f172a" />
                <ThemedText type="defaultSemiBold" style={styles.newSessionButtonText}>
                  {t('lectureDetail.newSession')}
                </ThemedText>
              </Pressable>
            </>
          ) : (
            <Pressable 
              style={[styles.button, styles.fullSessionButton]} 
              onPress={() => startSession()}
              disabled={startingSession !== null}
            >
              {startingSession === 'full' ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="school" size={18} color="#fff" />
                  <ThemedText type="defaultSemiBold" style={styles.buttonText}>
                    {t('lectureDetail.studyAll')}
                  </ThemedText>
                </>
              )}
            </Pressable>
          )}
        </View>
        <Pressable
          style={[styles.deleteButton, deletingLecture && styles.buttonDisabled]}
          onPress={confirmDeleteLecture}
          disabled={deletingLecture}
        >
          {deletingLecture ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="trash" size={18} color="#fff" />
              <ThemedText type="defaultSemiBold" style={styles.deleteButtonText}>
                {t('lectureDetail.deleteButton')}
              </ThemedText>
            </>
          )}
        </Pressable>
      </ThemedView>

      <View style={styles.notesCard}>
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionHeader}>
            <Ionicons name="create" size={18} color="#6366f1" />
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              {t('lectureDetail.additionalNotesTitle')}
            </ThemedText>
          </View>
          <Pressable
            style={[
              styles.regenerateButton,
              (savingNotes || !notesDirty) && styles.buttonDisabled,
            ]}
            onPress={handleSaveNotes}
            disabled={savingNotes || !notesDirty}
          >
            {savingNotes ? (
              <ActivityIndicator color="#64748b" size="small" />
            ) : (
              <>
                <Ionicons name="save" size={16} color="#64748b" />
                <ThemedText style={styles.regenerateButtonText}>
                  {t('common.save')}
                </ThemedText>
              </>
            )}
          </Pressable>
        </View>
        <ThemedText style={styles.sectionSubtitle}>
          {t('lectureDetail.additionalNotesHint')}
        </ThemedText>
        <TextInput
          style={styles.notesInput}
          placeholder={t('lectureDetail.additionalNotesPlaceholder')}
          placeholderTextColor={palette.textMuted}
          multiline
          numberOfLines={4}
          value={notesDraft}
          onChangeText={setNotesDraft}
          editable={!savingNotes}
        />
        <ThemedText style={styles.notesHelperText}>
          {t('lectureDetail.notesUsedInPlan')}
        </ThemedText>
      </View>

      {hasStudyPlan && (
        <View style={styles.readinessCard}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionHeader}>
              <Ionicons name="pulse" size={18} color="#0ea5e9" />
              <ThemedText type="subtitle" style={styles.sectionTitle}>
                {t('lectureDetail.readinessTitle')}
              </ThemedText>
            </View>
            <Pressable
              style={[
                styles.regenerateButton,
                (loadingInsights || generatingPlan) && styles.buttonDisabled,
              ]}
              onPress={refreshInsights}
              disabled={loadingInsights || generatingPlan}
            >
              {loadingInsights ? (
                <ActivityIndicator color="#64748b" size="small" />
              ) : (
                <>
                  <Ionicons name="refresh" size={16} color="#64748b" />
                  <ThemedText style={styles.regenerateButtonText}>
                    {t('lectureDetail.refreshInsights')}
                  </ThemedText>
                </>
              )}
            </Pressable>
          </View>
          <ThemedText style={styles.sectionSubtitle}>
            {t('lectureDetail.readinessSubtitle')}
          </ThemedText>

          {readiness?.summary && (
            <ThemedText style={styles.readinessSummary}>{readiness.summary}</ThemedText>
          )}

          {renderReadinessRow(t('lectureDetail.readinessPass'), readinessData.pass, GOAL_THRESHOLDS.pass, palette.success)}
          {renderReadinessRow(t('lectureDetail.readinessGood'), readinessData.good, GOAL_THRESHOLDS.good, palette.primary)}
          {renderReadinessRow(t('lectureDetail.readinessAce'), readinessData.ace, GOAL_THRESHOLDS.ace, palette.accent ?? '#f97316')}

          {readiness?.focusAreas && readiness.focusAreas.length > 0 && (
            <View style={styles.focusChipsRow}>
              {readiness.focusAreas.map((focus, idx) => (
                <View key={`${focus}-${idx}`} style={styles.focusChip}>
                  <ThemedText style={styles.focusChipText}>{focus}</ThemedText>
                </View>
              ))}
            </View>
          )}

          {readiness?.priorityExplanation && (
            <View style={styles.priorityExplanationCard}>
              <View style={styles.priorityExplanationHeader}>
                <Ionicons name="bulb" size={16} color="#f59e0b" />
                <ThemedText type="defaultSemiBold" style={styles.priorityExplanationTitle}>
                  {t('lectureDetail.priorityExplanation')}
                </ThemedText>
              </View>
              <ThemedText style={styles.priorityExplanationText}>
                {readiness.priorityExplanation}
              </ThemedText>
            </View>
          )}

          {insightError && (
            <ThemedText style={styles.errorText}>{insightError}</ThemedText>
          )}
        </View>
      )}

      <View style={styles.practiceExamCard}>
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionHeader}>
            <Ionicons name="clipboard" size={18} color="#0ea5e9" />
            <ThemedText type="subtitle" style={styles.sectionTitle}>
              {t('practiceExam.title')}
            </ThemedText>
          </View>
          <Pressable
            style={[
              styles.regenerateButton,
              (creatingPracticeExam || !lecture) && styles.buttonDisabled,
            ]}
            onPress={handleGeneratePracticeExam}
            disabled={creatingPracticeExam || !lecture}
          >
            {creatingPracticeExam ? (
              <ActivityIndicator color="#64748b" size="small" />
            ) : (
              <>
                <Ionicons name="flash" size={16} color="#64748b" />
                <ThemedText style={styles.regenerateButtonText}>
                  {t('practiceExam.generate')}
                </ThemedText>
              </>
            )}
          </Pressable>
        </View>
        <ThemedText style={styles.sectionSubtitle}>
          {t('practiceExam.description')}
        </ThemedText>

        <View style={styles.practiceExamControls}>
          <View style={styles.practiceExamInputGroup}>
            <ThemedText style={styles.practiceExamLabel}>{t('practiceExam.questionCount')}</ThemedText>
            <TextInput
              style={styles.practiceExamInput}
              keyboardType="number-pad"
              value={questionCount}
              onChangeText={setQuestionCount}
              editable={!creatingPracticeExam}
              maxLength={2}
              placeholder="5"
              placeholderTextColor={palette.textMuted}
            />
          </View>
          {creatingPracticeExam && (
            <View style={styles.practiceExamStatusRow}>
              <ActivityIndicator color={palette.primary} size="small" />
              <ThemedText style={styles.practiceExamStatusText}>
                {t('practiceExam.generating')}
              </ThemedText>
            </View>
          )}
        </View>

        {loadingPracticeExams ? (
          <ActivityIndicator color={palette.primary} />
        ) : practiceExams.length === 0 ? (
          <ThemedText style={styles.sectionSubtitle}>{t('practiceExam.empty')}</ThemedText>
        ) : (
          practiceExams.map((exam) => (
            <Pressable
              key={exam.id}
              style={styles.practiceExamItem}
              onPress={() => goToPracticeExam(exam.id)}
              disabled={exam.status === 'failed' || exam.status === 'pending'}
            >
              <View style={styles.practiceExamItemHeader}>
                <ThemedText type="defaultSemiBold" style={styles.practiceExamTitle}>
                  {exam.title}
                </ThemedText>
                <View style={[
                  styles.practiceExamBadge,
                  exam.status === 'completed'
                    ? styles.practiceExamBadgeSuccess
                    : exam.status === 'ready'
                    ? styles.practiceExamBadgeReady
                    : exam.status === 'in_progress'
                    ? styles.practiceExamBadgeInProgress
                    : exam.status === 'failed'
                    ? styles.practiceExamBadgeFailed
                    : styles.practiceExamBadgePending,
                ]}>
                  <ThemedText style={styles.practiceExamBadgeText}>
                    {t(`practiceExam.status.${exam.status}`)}
                  </ThemedText>
                </View>
              </View>
              <ThemedText style={styles.practiceExamMeta}>
                {t('practiceExam.meta', {
                  count: exam.questionCount,
                  score: exam.score ?? 0,
                  created: new Date(exam.createdAt).toLocaleDateString(),
                })}
              </ThemedText>
              {exam.error && (
                <ThemedText style={styles.errorText}>{exam.error}</ThemedText>
              )}
            </Pressable>
          ))
        )}
      </View>

      {(isPlanPending || isPlanFailed) && (
        <View style={[styles.planStatusCard, isPlanPending ? styles.planPendingCard : styles.planFailedCard]}>
          <View style={styles.planStatusHeader}>
            {isPlanPending ? (
              <ActivityIndicator color={isPlanFailed ? '#ef4444' : '#0ea5e9'} size="small" />
            ) : (
              <Ionicons name="warning" size={18} color="#ef4444" />
            )}
            <ThemedText type="defaultSemiBold">
              {isPlanPending ? t('lectureDetail.planPendingTitle') : t('lectureDetail.planFailedTitle')}
            </ThemedText>
          </View>
          <ThemedText style={styles.planStatusBody}>
            {isPlanPending
              ? generationProgress || t('lectureDetail.planPendingBody')
              : lecture.planError || t('lectureDetail.planFailedBody')}
          </ThemedText>
          {isPlanFailed && (
            <Pressable
              style={[styles.generateButton, styles.retryButton, generatingPlan && styles.buttonDisabled]}
              onPress={generatePlan}
              disabled={generatingPlan}
            >
              {generatingPlan ? (
                <View style={styles.generatingRow}>
                  <ActivityIndicator color="#fff" size="small" />
                  <ThemedText type="defaultSemiBold" style={styles.generateButtonText}>
                    {t('lectureDetail.generating')}
                  </ThemedText>
                </View>
              ) : (
                <>
                  <Ionicons name="refresh" size={18} color="#fff" />
                  <ThemedText type="defaultSemiBold" style={styles.generateButtonText}>
                    {t('lectureDetail.planRetry')}
                  </ThemedText>
                </>
              )}
            </Pressable>
          )}
        </View>
      )}

      {/* Study Plan Section */}
      {hasStudyPlan && (
        <View style={styles.studyPlanSection}>
          <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionHeader}>
              <Ionicons name="list" size={20} color="#10b981" />
              <ThemedText type="subtitle" style={styles.sectionTitle}>
                {t('lectureDetail.studyPlanTitle')}
              </ThemedText>
            </View>
            <Pressable 
              style={styles.regenerateButton}
              onPress={generatePlan}
              disabled={generatingPlan || isPlanPending}
            >
              {generatingPlan || isPlanPending ? (
                <ActivityIndicator color="#64748b" size="small" />
              ) : (
                <>
                  <Ionicons name="refresh" size={16} color="#64748b" />
                  <ThemedText style={styles.regenerateButtonText}>{t('lectureDetail.regenerate')}</ThemedText>
                </>
              )}
            </Pressable>
          </View>
          <ThemedText style={styles.sectionSubtitle}>
            {t('lectureDetail.planSubtitle')}
          </ThemedText>

          <View style={styles.statusSummaryRow}>
            <Ionicons name="checkmark-done" size={16} color={palette.success} />
            <ThemedText style={styles.statusSummaryText}>
              {t(
                'lectureDetail.sectionStatusSummary',
                {
                  passed: sectionStatusCounts.passed,
                  notStarted: sectionStatusCounts.notStarted,
                  inProgress: sectionStatusCounts.inProgress,
                  failed: sectionStatusCounts.failed,
                },
                `${sectionStatusCounts.passed} passed · ${sectionStatusCounts.notStarted} not started · ${sectionStatusCounts.inProgress} in progress · ${sectionStatusCounts.failed} failed`
              )}
            </ThemedText>
          </View>

          <View style={styles.roadmapSection}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionHeader}>
                <Ionicons name="trail-sign" size={20} color="#fb923c" />
                <ThemedText type="subtitle" style={styles.sectionTitle}>
                  {t('lectureDetail.roadmapTitle')}
                </ThemedText>
              </View>
              <Pressable
                style={[
                  styles.regenerateButton,
                  (loadingInsights || generatingPlan) && styles.buttonDisabled,
                ]}
                onPress={refreshInsights}
                disabled={loadingInsights || generatingPlan}
              >
                {loadingInsights ? (
                  <ActivityIndicator color="#64748b" size="small" />
                ) : (
                  <>
                    <Ionicons name="refresh" size={16} color="#64748b" />
                    <ThemedText style={styles.regenerateButtonText}>
                      {t('lectureDetail.refreshInsights')}
                    </ThemedText>
                  </>
                )}
              </Pressable>
            </View>
            <ThemedText style={styles.sectionSubtitle}>
              {t('lectureDetail.roadmapSubtitle')}
            </ThemedText>

            {roadmapItems.length === 0 && (
              <ThemedText style={styles.sectionSubtitle}>
                {t('lectureDetail.roadmapEmpty')}
              </ThemedText>
            )}

            {roadmapItems.length > 0 && (
              <ThemedText style={styles.tapToScrollHint}>
                {t('lectureDetail.tapToScroll')}
              </ThemedText>
            )}

            {roadmapItems.map((step) => (
              <Pressable 
                key={`${step.order}-${step.title}`} 
                style={styles.roadmapCard}
                onPress={() => scrollToEntry(step.title)}
              >
                <View style={styles.roadmapHeader}>
                  <View style={styles.orderBadge}>
                    <ThemedText style={styles.orderBadgeText}>{step.order}</ThemedText>
                  </View>
                  <View style={styles.roadmapTitleRow}>
                    <ThemedText type="defaultSemiBold" style={styles.entryTitle}>
                      {step.title}
                    </ThemedText>
                    <View
                      style={[
                        styles.targetBadge,
                        step.target === 'ace'
                          ? styles.tierBadgeStretch
                          : step.target === 'good'
                          ? styles.tierBadgeHigh
                          : styles.tierBadgeCore,
                      ]}
                    >
                      <ThemedText
                        style={[
                          styles.targetBadgeText,
                          step.target === 'ace'
                            ? styles.tierBadgeTextStretch
                            : step.target === 'good'
                            ? styles.tierBadgeTextHigh
                            : styles.tierBadgeTextCore,
                        ]}
                      >
                        {step.target.toUpperCase()}
                      </ThemedText>
                    </View>
                  </View>
                </View>
                <ThemedText style={styles.entryDescription}>
                  {step.action}
                </ThemedText>
                {step.reason && (
                  <ThemedText style={styles.roadmapReason}>
                    {step.reason}
                  </ThemedText>
                )}
                {step.examTopics && step.examTopics.length > 0 && (
                  <View style={styles.examTopicsRow}>
                    <Ionicons name="school" size={12} color={palette.warning} />
                    <ThemedText style={styles.examTopicsText}>
                      {t('lectureDetail.examTopicBadge')}: {step.examTopics.join(', ')}
                    </ThemedText>
                  </View>
                )}
                <View style={styles.roadmapMetaRow}>
                  {step.category && (
                    <ThemedText style={styles.roadmapMetaText}>
                      {step.category}
                    </ThemedText>
                  )}
                  {step.estimatedMinutes && (
                    <ThemedText style={styles.roadmapMetaText}>
                      {t('lectureDetail.estimatedMinutes', { value: step.estimatedMinutes })}
                    </ThemedText>
                  )}
                </View>
              </Pressable>
            ))}
          </View>

          <View style={styles.studyPlanList}>
            {categorizedPlan.map(({ category, entries }) => (
              <View key={category} style={styles.categoryGroup}>
                <Pressable style={styles.categoryHeader} onPress={() => toggleCategory(category)}>
                  <Ionicons
                    name={categoryOpen[category] ? 'chevron-down' : 'chevron-forward'}
                    size={16}
                    color="#10b981"
                  />
                  <Ionicons name="folder-open" size={16} color="#10b981" />
                  <ThemedText type="defaultSemiBold" style={styles.categoryTitle}>
                    {category}
                  </ThemedText>
                  <ThemedText style={styles.categoryCount}>{entries.length}</ThemedText>
                </Pressable>
                {categoryOpen[category] &&
                  entries.map((entry) => {
                  const orderNumber = planOrderLookup[entry.id] ?? entry.orderIndex + 1;
                  const tier =
                    (entry.importanceTier || 'core').toLowerCase() as 'core' | 'high-yield' | 'stretch';
                  const tierLabel = tier === 'high-yield' ? 'high-yield' : tier;
                  const tierBadgeStyle =
                    tier === 'stretch'
                      ? styles.tierBadgeStretch
                      : tier === 'high-yield'
                      ? styles.tierBadgeHigh
                      : styles.tierBadgeCore;
                  const tierBadgeTextStyle =
                    tier === 'stretch'
                      ? styles.tierBadgeTextStretch
                      : tier === 'high-yield'
                      ? styles.tierBadgeTextHigh
                      : styles.tierBadgeTextCore;
                  const statusValue = (entry.status ?? 'not_started') as SectionStatus;
                  const entrySession = existingEntrySessions[entry.id];
                  const isEntryPassed = statusValue === 'passed';

                  return (
                    <View 
                      key={entry.id} 
                      style={styles.studyPlanCard}
                      onLayout={(event) => handleEntryLayout(entry.id, event)}
                    >
                      <View style={styles.studyPlanCardHeader}>
                        <View style={styles.orderBadge}>
                          <ThemedText style={styles.orderBadgeText}>{orderNumber}</ThemedText>
                        </View>
                        <View style={styles.studyPlanCardContent}>
                          <View style={styles.entryHeaderRow}>
                            <ThemedText type="defaultSemiBold" style={styles.entryTitle}>
                              {entry.title}
                            </ThemedText>
                            <View style={styles.entryBadgesRow}>
                                {renderStatusBadge(statusValue)}
                              {(entry.fromExamSource || entry.examRelevance === 'high') && (
                                <View style={styles.examBadge}>
                                  <Ionicons name="school" size={10} color="#f59e0b" />
                                  <ThemedText style={styles.examBadgeText}>
                                    {t('lectureDetail.examTopicBadge')}
                                  </ThemedText>
                                </View>
                              )}
                              {entry.mentionedInNotes && (
                                <View style={styles.professorFocusBadge}>
                                  <Ionicons name="star" size={10} color="#8b5cf6" />
                                  <ThemedText style={styles.professorFocusBadgeText}>
                                    {t('lectureDetail.professorFocus')}
                                  </ThemedText>
                                </View>
                              )}
                              <View style={[styles.tierBadge, tierBadgeStyle]}>
                                <ThemedText style={[styles.tierBadgeText, tierBadgeTextStyle]}>
                                  {tierLabel}
                                </ThemedText>
                              </View>
                              {entry.priorityScore !== undefined && (
                                <View style={styles.priorityBadge}>
                                  <ThemedText style={styles.priorityBadgeText}>
                                    {`Priority ${entry.priorityScore}`}
                                  </ThemedText>
                                </View>
                              )}
                            </View>
                          </View>
                          {entry.description && (
                            <ThemedText style={styles.entryDescription}>
                              {entry.description}
                            </ThemedText>
                          )}
                        </View>
                      </View>

                      {entry.keyConcepts && entry.keyConcepts.length > 0 && (
                        <View style={styles.conceptsContainer}>
                          {entry.keyConcepts.map((concept, idx) => (
                            <View key={idx} style={styles.conceptTag}>
                              <ThemedText style={styles.conceptText}>{concept}</ThemedText>
                            </View>
                          ))}
                        </View>
                      )}

                      <View
                        style={[styles.entryButtonsRow, isEntryPassed && styles.passedActionsRow]}
                      >
                        {isEntryPassed ? (
                          <>
                            {entrySession && (
                              <Pressable
                                style={[
                                  styles.reviewLinkButton,
                                  startingSession === entry.id && styles.buttonDisabled,
                                ]}
                                onPress={() => continueSession(entrySession)}
                                disabled={startingSession !== null}
                              >
                                {startingSession === entry.id ? (
                                  <ActivityIndicator color={palette.primary} size="small" />
                                ) : (
                                  <>
                                    <Ionicons name="play" size={14} color={palette.primary} />
                                    <ThemedText style={styles.reviewLinkText}>
                                      {t('lectureDetail.review')}
                                    </ThemedText>
                                  </>
                                )}
                              </Pressable>
                            )}
                            <Pressable
                              style={[
                                styles.startAgainLinkButton,
                                startingSession === entry.id && styles.buttonDisabled,
                              ]}
                              onPress={() => startSession(entry, true)}
                              disabled={startingSession !== null}
                            >
                              {startingSession === entry.id ? (
                                <ActivityIndicator color={palette.textMuted} size="small" />
                              ) : (
                                <>
                                  <Ionicons name="refresh" size={14} color={palette.textMuted} />
                                  <ThemedText style={styles.startAgainLinkText}>
                                    {t('lectureDetail.startAgain')}
                                  </ThemedText>
                                </>
                              )}
                            </Pressable>
                          </>
                        ) : entrySession ? (
                          <>
                            <Pressable
                              style={[styles.continueEntryButton, startingSession === entry.id && styles.buttonDisabled]}
                              onPress={() => continueSession(entrySession)}
                              disabled={startingSession !== null}
                            >
                              {startingSession === entry.id ? (
                                <ActivityIndicator color="#fff" size="small" />
                              ) : (
                                <>
                                  <Ionicons name="play" size={16} color="#fff" />
                                  <ThemedText style={styles.startEntryButtonText}>
                                    {t('lectureDetail.continue')}
                                  </ThemedText>
                                </>
                              )}
                            </Pressable>
                            <Pressable
                              style={[styles.newEntryButton, startingSession === entry.id && styles.buttonDisabled]}
                              onPress={() => startSession(entry, true)}
                              disabled={startingSession !== null}
                            >
                              <Ionicons name="add" size={16} color="#10b981" />
                              <ThemedText style={styles.newEntryButtonText}>
                                {t('lectureDetail.new')}
                              </ThemedText>
                            </Pressable>
                          </>
                        ) : (
                          <Pressable
                            style={[styles.startEntryButton, startingSession === entry.id && styles.buttonDisabled]}
                            onPress={() => startSession(entry)}
                            disabled={startingSession !== null}
                          >
                            {startingSession === entry.id ? (
                              <ActivityIndicator color="#fff" size="small" />
                            ) : (
                              <>
                                <Ionicons name="play" size={16} color="#fff" />
                                <ThemedText style={styles.startEntryButtonText}>
                                    {t('lectureDetail.startSession')}
                                </ThemedText>
                              </>
                            )}
                          </Pressable>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      )}

      {/* No Study Plan - Show Generate Button */}
      {!hasStudyPlan && (
        <View style={styles.noStudyPlanCard}>
          <Ionicons name="sparkles" size={40} color="#10b981" />
          <ThemedText type="defaultSemiBold" style={styles.noStudyPlanTitle}>
            {t('lectureDetail.noPlanTitle')}
          </ThemedText>
          <ThemedText style={styles.noStudyPlanText}>
            {t('lectureDetail.noPlanText')}
          </ThemedText>
          <Pressable 
            style={[styles.generateButton, showGenerateSpinner && styles.buttonDisabled]}
            onPress={generatePlan}
            disabled={showGenerateSpinner}
          >
            {showGenerateSpinner ? (
              <View style={styles.generatingRow}>
                <ActivityIndicator color="#fff" size="small" />
                <ThemedText type="defaultSemiBold" style={styles.generateButtonText}>
                  {isPlanPending ? t('lectureDetail.planPendingCta') : t('lectureDetail.generating')}
                </ThemedText>
              </View>
            ) : (
              <>
                <Ionicons name="flash" size={18} color="#fff" />
                <ThemedText type="defaultSemiBold" style={styles.generateButtonText}>
                  {t('lectureDetail.generatePlan')}
                </ThemedText>
              </>
            )}
          </Pressable>
          {showGenerateSpinner && (
            <View style={styles.progressInfo}>
              <ThemedText style={styles.progressText}>
                {generationProgress || t('lectureDetail.planPendingBody')}
              </ThemedText>
            </View>
          )}
        </View>
      )}

      {/* Materials Section */}
      <View style={styles.materialsSection}>
        <View style={styles.sectionHeader}>
          <Ionicons name="documents" size={20} color="#3b82f6" />
          <ThemedText type="subtitle" style={styles.sectionTitle}>
            Materials ({lecture.files.length})
          </ThemedText>
        </View>

        {lecture.files.map((file) => (
          <View key={file.id} style={styles.fileCard}>
            <View style={styles.fileHeader}>
              <Ionicons name="document" size={18} color="#64748b" />
              <ThemedText type="defaultSemiBold">{file.name}</ThemedText>
              {file.extractedText && (
                <View style={styles.extractedBadge}>
                  <Ionicons name="checkmark-circle" size={12} color="#10b981" />
                  <ThemedText style={styles.extractedBadgeText}>Analyzed</ThemedText>
                </View>
              )}
            </View>
            <PdfWebView uri={file.uri} />
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const createStyles = (palette: typeof Colors.light) =>
  StyleSheet.create({
    container: {
      padding: Spacing.lg,
      gap: Spacing.lg,
      backgroundColor: palette.background,
    },
    header: {
      gap: Spacing.sm,
    },
    description: {
      color: palette.textMuted,
      lineHeight: 22,
    },
    lectureCost: {
      color: palette.textMuted,
      fontSize: 13,
    },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      borderRadius: Radii.md,
      paddingVertical: 12,
      paddingHorizontal: 16,
      alignSelf: 'flex-start',
      borderWidth: 1,
      borderColor: `${palette.primary}24`,
    },
    fullSessionButton: {
      backgroundColor: palette.primary,
      marginTop: 4,
    },
    deleteButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      backgroundColor: '#ef4444',
      borderColor: '#ef4444',
      borderWidth: 1,
      borderRadius: Radii.md,
      paddingVertical: 10,
      paddingHorizontal: 14,
      alignSelf: 'flex-start',
    },
    deleteButtonText: {
      color: '#fff',
    },
    sessionButtonsRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
      marginTop: 4,
      flexWrap: 'wrap',
    },
    continueSessionButton: {
      backgroundColor: palette.success,
      borderColor: `${palette.success}33`,
      borderWidth: 1,
    },
    newSessionButton: {
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
    },
    newSessionButtonText: {
      color: palette.text,
    },
    buttonText: {
      color: palette.textOnPrimary,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      backgroundColor: palette.background,
    },

    studyPlanSection: {
      gap: Spacing.md,
    },
    planStatusCard: {
      gap: Spacing.xs,
      padding: Spacing.md,
      borderRadius: Radii.lg,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      ...Shadows.sm,
    },
    planPendingCard: {
      borderColor: `${palette.primary}33`,
    },
    planFailedCard: {
      borderColor: '#ef444433',
      backgroundColor: `${palette.surfaceAlt}80`,
    },
    planStatusHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    planStatusBody: {
      color: palette.textMuted,
      lineHeight: 20,
    },
    retryButton: {
      marginTop: Spacing.xs,
      backgroundColor: palette.primary,
      borderColor: `${palette.primary}33`,
    },
    sectionHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    sectionTitle: {
      fontSize: 18,
    },
    sectionSubtitle: {
      color: palette.textMuted,
      fontSize: 14,
      marginTop: -4,
    },
    notesCard: {
      padding: Spacing.md,
      gap: Spacing.sm,
      borderRadius: Radii.lg,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      ...Shadows.sm,
    },
    notesInput: {
      width: '100%',
      minHeight: 96,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      padding: 12,
      color: palette.text,
      textAlignVertical: 'top',
      backgroundColor: palette.surfaceAlt,
    },
    notesHelperText: {
      color: palette.textMuted,
      fontSize: 12,
    },
    readinessCard: {
      padding: Spacing.md,
      gap: Spacing.sm,
      borderRadius: Radii.lg,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      ...Shadows.sm,
    },
    practiceExamCard: {
      padding: Spacing.md,
      gap: Spacing.sm,
      borderRadius: Radii.lg,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      ...Shadows.sm,
    },
    practiceExamControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      flexWrap: 'wrap',
    },
    practiceExamInputGroup: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    practiceExamLabel: {
      color: palette.textMuted,
      fontSize: 13,
    },
    practiceExamInput: {
      minWidth: 60,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceAlt,
      color: palette.text,
    },
    practiceExamStatusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    practiceExamStatusText: {
      color: palette.textMuted,
      fontSize: 13,
    },
    practiceExamItem: {
      paddingVertical: Spacing.sm,
      borderBottomWidth: 1,
      borderColor: palette.border,
      gap: Spacing.xs,
    },
    practiceExamItemHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      justifyContent: 'space-between',
    },
    practiceExamTitle: {
      fontSize: 15,
      color: palette.text,
      flex: 1,
    },
    practiceExamBadge: {
      borderRadius: Radii.pill,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderWidth: 1,
    },
    practiceExamBadgeText: {
      fontSize: 12,
      fontWeight: '700',
    },
    practiceExamBadgeSuccess: {
      backgroundColor: `${palette.success}14`,
      borderColor: `${palette.success}33`,
    },
    practiceExamBadgeReady: {
      backgroundColor: `${palette.primary}14`,
      borderColor: `${palette.primary}33`,
    },
    practiceExamBadgeInProgress: {
      backgroundColor: `${palette.warning}12`,
      borderColor: `${palette.warning}33`,
    },
    practiceExamBadgeFailed: {
      backgroundColor: '#fee2e2',
      borderColor: '#fca5a5',
    },
    practiceExamBadgePending: {
      backgroundColor: `${palette.muted}12`,
      borderColor: `${palette.muted}33`,
    },
    practiceExamMeta: {
      color: palette.textMuted,
      fontSize: 12,
    },
    readinessSummary: {
      color: palette.text,
      fontSize: 14,
      lineHeight: 20,
    },
    readinessRow: {
      gap: Spacing.xs,
      marginTop: Spacing.xs,
    },
    readinessRowHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    readinessTargetText: {
      color: palette.textMuted,
      fontSize: 12,
    },
    readinessBar: {
      height: 16,
      borderRadius: Radii.pill,
      backgroundColor: palette.muted,
      overflow: 'hidden',
      justifyContent: 'center',
    },
    readinessFill: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      borderRadius: Radii.pill,
    },
    readinessValue: {
      textAlign: 'center',
      fontSize: 12,
      color: palette.text,
      fontWeight: '700',
    },
    focusChipsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.xs,
      marginTop: Spacing.xs,
    },
    focusChip: {
      paddingVertical: 6,
      paddingHorizontal: 10,
      backgroundColor: palette.surfaceAlt,
      borderRadius: Radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
    },
    focusChipText: {
      color: palette.text,
      fontSize: 12,
    },
    regenerateButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: Radii.sm,
      backgroundColor: palette.muted,
      borderWidth: 1,
      borderColor: palette.border,
    },
    regenerateButtonText: {
      color: palette.textMuted,
      fontSize: 13,
      fontWeight: '500',
    },
    studyPlanList: {
      gap: Spacing.sm,
    },
    categoryGroup: {
      gap: Spacing.sm,
    },
    categoryHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      marginBottom: 4,
    },
    categoryCount: {
      marginLeft: 'auto',
      color: palette.textMuted,
      fontSize: 12,
    },
    categoryTitle: {
      color: palette.success,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    statusSummaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      marginTop: Spacing.xs,
      marginBottom: Spacing.xs,
    },
    statusSummaryText: {
      color: palette.textMuted,
      fontSize: 13,
    },
    errorText: {
      color: palette.danger,
      fontSize: 13,
    },
    roadmapSection: {
      gap: Spacing.sm,
    },
    roadmapCard: {
      backgroundColor: palette.surface,
      borderRadius: Radii.md,
      padding: Spacing.md,
      borderWidth: 1,
      borderColor: palette.border,
      gap: Spacing.xs,
    },
    roadmapHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    roadmapTitleRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      flexWrap: 'wrap',
    },
    roadmapReason: {
      color: palette.textMuted,
      fontSize: 13,
    },
    roadmapMetaRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
      flexWrap: 'wrap',
    },
    roadmapMetaText: {
      color: palette.textMuted,
      fontSize: 12,
    },
    studyPlanCard: {
      backgroundColor: palette.surface,
      borderRadius: Radii.lg,
      padding: Spacing.md,
      gap: Spacing.sm,
      borderWidth: 1,
      borderColor: palette.border,
      ...Shadows.sm,
    },
    studyPlanCardHeader: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    orderBadge: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: palette.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    orderBadgeText: {
      color: palette.textOnPrimary,
      fontWeight: '700',
      fontSize: 14,
    },
    studyPlanCardContent: {
      flex: 1,
      gap: 4,
    },
    entryHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.sm,
    },
    entryBadgesRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    statusBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: Radii.md,
      borderWidth: 1,
    },
    statusBadgePassed: {
      backgroundColor: `${palette.success}14`,
      borderColor: `${palette.success}40`,
    },
    statusBadgeFailed: {
      backgroundColor: '#fee2e2',
      borderColor: '#fecdd3',
    },
    statusBadgeInProgress: {
      backgroundColor: `${palette.warning}12`,
      borderColor: `${palette.warning}44`,
    },
    statusBadgeNotStarted: {
      backgroundColor: `${palette.muted}14`,
      borderColor: `${palette.muted}44`,
    },
    statusBadgeText: {
      fontSize: 11,
      fontWeight: '600',
      color: palette.text,
    },
    entryTitle: {
      fontSize: 16,
      color: palette.text,
    },
    entryDescription: {
      fontSize: 14,
      color: palette.textMuted,
      lineHeight: 20,
    },
    conceptsContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.xs,
    },
    conceptTag: {
      backgroundColor: `${palette.success}12`,
      borderWidth: 1,
      borderColor: `${palette.success}33`,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: Radii.md,
    },
    conceptText: {
      color: palette.success,
      fontSize: 12,
      fontWeight: '500',
    },
    tierBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: Radii.md,
      borderWidth: 1,
    },
    tierBadgeCore: {
      backgroundColor: `${palette.primary}12`,
      borderColor: `${palette.primary}33`,
    },
    tierBadgeHigh: {
      backgroundColor: `${palette.success}12`,
      borderColor: `${palette.success}44`,
    },
    tierBadgeStretch: {
      backgroundColor: `${palette.muted}18`,
      borderColor: `${palette.muted}44`,
    },
    tierBadgeText: {
      fontSize: 11,
      fontWeight: '600',
      textTransform: 'capitalize',
    },
    tierBadgeTextCore: {
      color: palette.primary,
    },
    tierBadgeTextHigh: {
      color: palette.success,
    },
    tierBadgeTextStretch: {
      color: palette.textMuted,
    },
    targetBadge: {
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: Radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceAlt,
    },
    targetBadgeText: {
      fontSize: 12,
      fontWeight: '600',
    },
    priorityBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: `${palette.border}`,
      backgroundColor: palette.surfaceAlt,
    },
    priorityBadgeText: {
      fontSize: 11,
      fontWeight: '600',
      color: palette.textMuted,
    },
    entryButtonsRow: {
      flexDirection: 'row',
      gap: Spacing.xs,
      marginTop: 4,
    },
    passedActionsRow: {
      alignItems: 'flex-start',
      gap: Spacing.xs,
    },
    reviewLinkButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingVertical: 6,
      paddingHorizontal: 0,
    },
    reviewLinkText: {
      color: palette.primary,
      fontWeight: '700',
      fontSize: 14,
    },
    startAgainLinkButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingVertical: 6,
      paddingHorizontal: 0,
    },
    startAgainLinkText: {
      color: palette.textMuted,
      fontWeight: '600',
      fontSize: 13,
    },
    startEntryButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      backgroundColor: palette.primary,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: Radii.md,
    },
    continueEntryButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      backgroundColor: palette.success,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: Radii.md,
    },
    newEntryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      backgroundColor: palette.surface,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: palette.border,
    },
    newEntryButtonText: {
      color: palette.text,
      fontWeight: '600',
      fontSize: 14,
    },
    startEntryButtonText: {
      color: palette.textOnPrimary,
      fontWeight: '600',
      fontSize: 14,
    },

    noStudyPlanCard: {
      backgroundColor: `${palette.success}12`,
      borderRadius: Radii.lg,
      padding: Spacing.lg,
      alignItems: 'center',
      gap: Spacing.sm,
      borderWidth: 1,
      borderColor: `${palette.success}33`,
    },
    noStudyPlanTitle: {
      fontSize: 18,
      color: palette.success,
    },
    noStudyPlanText: {
      color: palette.success,
      textAlign: 'center',
      lineHeight: 22,
      maxWidth: 300,
    },
    generateButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      backgroundColor: palette.primary,
      paddingVertical: 14,
      paddingHorizontal: 24,
      borderRadius: Radii.md,
      marginTop: 8,
    },
    generateButtonText: {
      color: palette.textOnPrimary,
      fontSize: 16,
    },
    generatingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    progressInfo: {
      marginTop: Spacing.xs,
    },
    progressText: {
      color: palette.success,
      fontSize: 13,
      textAlign: 'center',
    },

    materialsSection: {
      gap: Spacing.sm,
    },
    fileCard: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: Radii.md,
      padding: Spacing.md,
      gap: Spacing.sm,
      backgroundColor: palette.surface,
    },
    fileHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    extractedBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginLeft: 'auto',
      backgroundColor: `${palette.success}14`,
      paddingVertical: 2,
      paddingHorizontal: 8,
      borderRadius: Radii.sm,
    },
    extractedBadgeText: {
      color: palette.success,
      fontSize: 11,
      fontWeight: '500',
    },
    // New styles for exam badges and priority explanation
    examBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: Radii.sm,
      backgroundColor: '#fef3c7',
      borderWidth: 1,
      borderColor: '#fcd34d',
    },
    examBadgeText: {
      color: '#b45309',
      fontSize: 10,
      fontWeight: '600',
    },
    professorFocusBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: Radii.sm,
      backgroundColor: '#ede9fe',
      borderWidth: 1,
      borderColor: '#c4b5fd',
    },
    professorFocusBadgeText: {
      color: '#6d28d9',
      fontSize: 10,
      fontWeight: '600',
    },
    priorityExplanationCard: {
      backgroundColor: `${palette.warning}08`,
      borderRadius: Radii.md,
      padding: Spacing.md,
      marginTop: Spacing.sm,
      borderWidth: 1,
      borderColor: `${palette.warning}22`,
      gap: Spacing.xs,
    },
    priorityExplanationHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    priorityExplanationTitle: {
      color: '#b45309',
      fontSize: 14,
    },
    priorityExplanationText: {
      color: palette.text,
      fontSize: 13,
      lineHeight: 20,
    },
    tapToScrollHint: {
      color: palette.textMuted,
      fontSize: 12,
      fontStyle: 'italic',
      marginBottom: Spacing.xs,
    },
    examTopicsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      marginTop: Spacing.xs,
    },
    examTopicsText: {
      color: '#b45309',
      fontSize: 12,
    },
  });
