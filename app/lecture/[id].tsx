import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, LayoutChangeEvent, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { v4 as uuid } from 'uuid';

import { CircularReadinessGraph } from '@/components/circular-readiness-graph';
import { EntryActionSheet } from '@/components/entry-action-sheet';
import { LinearProgressBar } from '@/components/linear-progress-bar';
import { PdfWebView } from '@/components/pdf-webview';
import { SkeletonCard, SkeletonEntryCard, SkeletonHeader } from '@/components/skeleton-loader';
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
import { PracticeExam, RoadmapStep, SectionStatus, StudyPlanEntry, StudyReadiness, StudySession } from '@/types';

const stripCodeFences = (text: string) => {
  const fenceMatch = text.match(/```(?:json)?\n?([\s\S]*?)```/i);
  return fenceMatch ? fenceMatch[1].trim() : text;
};

type TabKey = 'overview' | 'studyPlan' | 'practice' | 'materials';

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
  
  // Tab navigation state
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  
  // Action sheet state
  const [actionSheetEntry, setActionSheetEntry] = useState<StudyPlanEntry | null>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  
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
  const [creatingClusterQuiz, setCreatingClusterQuiz] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedEntries, setExpandedEntries] = useState<Record<string, boolean>>({});
  const CLUSTER_QUIZ_PASS_THRESHOLD = 70;

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

  // Pull-to-refresh handler
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refetch(),
        refetchSessions(),
        refetchPracticeExams(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refetch, refetchSessions, refetchPracticeExams]);

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

  const handleGenerateClusterQuiz = useCallback(async (category: string, topicCount: number) => {
    if (!lecture) return;
    setCreatingClusterQuiz(category);
    try {
      const questionCount = Math.min(10, Math.max(3, topicCount * 2));
      const result = await generatePracticeExam({
        lectureId: lecture.id,
        questionCount,
        language: agentLanguage,
        title: `${category} - Cluster Quiz`,
        category,
      });
      if (result.practiceExamId) {
        await refetchPracticeExams();
        goToPracticeExam(result.practiceExamId);
      }
    } catch (err) {
      console.warn('[lecture] cluster quiz generation failed', err);
      Alert.alert(t('common.errorGeneric'), t('clusterQuiz.errorCreating'));
    } finally {
      setCreatingClusterQuiz(null);
    }
  }, [agentLanguage, goToPracticeExam, lecture, refetchPracticeExams, t]);

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
    setShowMoreMenu(false);
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

      const extractedTexts: { fileName: string; text: string; isExam?: boolean }[] = [];
      let hasExtractedText = false;
      const extractedPages: Record<string, ExtractedPdfPage[] | undefined> = {};

      for (let i = 0; i < lecture.files.length; i++) {
        const file = lecture.files[i];
        setGenerationProgress(`Analyzing ${i + 1}/${lecture.files.length}: ${file.name}`);

        if (file.extractedText && file.extractedText.length > 0) {
          extractedTexts.push({ fileName: file.name, text: file.extractedText, isExam: Boolean(file.isExam) });
          hasExtractedText = true;
        } else {
          try {
            const extraction = await extractPdfText(file.uri);
            const text = extraction.text;
            extractedTexts.push({ fileName: file.name, text, isExam: Boolean(file.isExam) });
            extractedPages[file.id] = extraction.pages;
            if (text.length > 0) {
              hasExtractedText = true;
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

      setGenerationProgress(t('lectureDetail.generating'));

      let studyPlanEntries: Awaited<ReturnType<typeof generateStudyPlan>>['entries'] = [];
      let planCostUsd: number | undefined;
      
      if (hasExtractedText) {
        const planResult = await generateStudyPlan(extractedTexts, agentLanguage, {
          additionalNotes: notesForPlan || undefined,
          lectureId,
        });
        studyPlanEntries = planResult.entries;
        planCostUsd = planResult.costUsd;
      } else {
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
            lectureId,
          }
        );
        studyPlanEntries = planResult.entries;
        planCostUsd = planResult.costUsd;
      }

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

  const toggleEntryExpanded = useCallback((entryId: string) => {
    setExpandedEntries((prev) => ({ ...prev, [entryId]: !prev[entryId] }));
  }, []);

  const handleEntryLayout = useCallback((entryId: string, event: LayoutChangeEvent) => {
    const { y } = event.nativeEvent.layout;
    entryPositionsRef.current[entryId] = y;
  }, []);

  const orderedPlan = useMemo(
    () =>
      lecture?.studyPlan
        ? [...lecture.studyPlan].sort((a, b) => a.orderIndex - b.orderIndex)
        : [],
    [lecture?.studyPlan]
  );

  const scrollToEntry = useCallback((roadmapTitle: string) => {
    if (!orderedPlan || orderedPlan.length === 0) return;
    
    const normalizedTitle = roadmapTitle.toLowerCase().trim();
    const matchingEntry = orderedPlan.find(
      (entry) => entry.title.toLowerCase().trim() === normalizedTitle
    );
    
    if (matchingEntry) {
      const category = matchingEntry.category || 'General';
      setCategoryOpen((prev) => ({ ...prev, [category]: true }));
      setActiveTab('studyPlan');
      
      setTimeout(() => {
        const position = entryPositionsRef.current[matchingEntry.id];
        if (position !== undefined && scrollViewRef.current) {
          scrollViewRef.current.scrollTo({ y: position - 100, animated: true });
        }
      }, 150);
    }
  }, [orderedPlan]);

  // Loading state with skeleton
  if (isFetching && !lecture) {
    return (
      <ThemedView style={styles.loadingContainer}>
        <SkeletonHeader />
        <View style={styles.skeletonSection}>
          <SkeletonCard height={100} lines={2} />
          <SkeletonEntryCard />
          <SkeletonEntryCard />
        </View>
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

  const clusterQuizzesByCategory = useMemo(() => {
    const map: Record<string, PracticeExam[]> = {};
    practiceExams.forEach((exam) => {
      if (exam.category) {
        if (!map[exam.category]) {
          map[exam.category] = [];
        }
        map[exam.category].push(exam);
      }
    });
    return map;
  }, [practiceExams]);

  const getClusterStatus = useCallback((category: string, entries: StudyPlanEntry[]) => {
    const passed = entries.filter((e) => e.status === 'passed').length;
    const total = entries.length;
    const quizzes = clusterQuizzesByCategory[category] ?? [];
    const latestQuiz = quizzes[0];
    const quizPassed = latestQuiz?.status === 'completed' && (latestQuiz.score ?? 0) >= CLUSTER_QUIZ_PASS_THRESHOLD;
    const allTopicsPassed = passed === total && total > 0;
    
    return {
      passed,
      total,
      quizzes,
      latestQuiz,
      quizPassed,
      allTopicsPassed,
      clusterPassed: quizPassed || allTopicsPassed,
    };
  }, [clusterQuizzesByCategory]);

  const clusterQuizResults = useMemo(() => {
    const results: { category: string; score: number; passed: boolean; questionCount: number }[] = [];
    
    Object.entries(clusterQuizzesByCategory).forEach(([category, quizzes]) => {
      const completedQuiz = quizzes.find(q => q.status === 'completed' && q.score !== undefined);
      if (completedQuiz) {
        results.push({
          category,
          score: completedQuiz.score ?? 0,
          passed: (completedQuiz.score ?? 0) >= CLUSTER_QUIZ_PASS_THRESHOLD,
          questionCount: completedQuiz.questionCount,
        });
      }
    });
    
    return results;
  }, [clusterQuizzesByCategory]);

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
        progress: {
          passed: sectionStatusCounts.passed,
          inProgress: sectionStatusCounts.inProgress,
          notStarted: sectionStatusCounts.notStarted,
          failed: sectionStatusCounts.failed,
        },
        language: agentLanguage,
        clusterQuizResults,
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
  }, [agentLanguage, clusterQuizResults, lecture, notesDraft, orderedPlan, queryClient, sectionStatusCounts.failed, sectionStatusCounts.inProgress, sectionStatusCounts.notStarted, sectionStatusCounts.passed, t]);

  useEffect(() => {
    if (!hasStudyPlan) {
      prevPassedCountRef.current = null;
      return;
    }
    
    if (prevPassedCountRef.current === null) {
      prevPassedCountRef.current = sectionStatusCounts.passed;
      return;
    }
    
    if (
      sectionStatusCounts.passed > prevPassedCountRef.current &&
      !loadingInsights
    ) {
      prevPassedCountRef.current = sectionStatusCounts.passed;
      refreshInsights();
    }
  }, [hasStudyPlan, sectionStatusCounts.passed, loadingInsights, refreshInsights]);

  // Smart Next Action CTA logic
  const getSmartAction = useCallback(() => {
    if (!hasStudyPlan) {
      return { type: 'generate' as const, label: t('lectureDetail.generatePlan'), icon: 'flash' as const };
    }
    
    const allPassed = sectionStatusCounts.passed === orderedPlan.length && orderedPlan.length > 0;
    
    if (allPassed) {
      return { type: 'practice' as const, label: t('practiceExam.generate'), icon: 'clipboard' as const };
    }
    
    if (existingFullSession) {
      return { type: 'continue' as const, label: t('lectureDetail.continueSession'), icon: 'play' as const };
    }
    
    // Find the first incomplete topic as suggested next
    const suggestedEntry = orderedPlan.find(e => e.status !== 'passed');
    if (suggestedEntry) {
      const session = existingEntrySessions[suggestedEntry.id];
      if (session) {
        return { type: 'continueTopic' as const, label: t('lectureDetail.continue'), icon: 'play' as const, entry: suggestedEntry };
      }
      return { type: 'startTopic' as const, label: t('lectureDetail.startSession'), icon: 'play' as const, entry: suggestedEntry };
    }
    
    return { type: 'study' as const, label: t('lectureDetail.studyAll'), icon: 'school' as const };
  }, [hasStudyPlan, sectionStatusCounts.passed, orderedPlan, existingFullSession, existingEntrySessions, t]);

  const smartAction = getSmartAction();

  const handleSmartAction = useCallback(() => {
    switch (smartAction.type) {
      case 'generate':
        generatePlan();
        break;
      case 'practice':
        setActiveTab('practice');
        break;
      case 'continue':
        if (existingFullSession) continueSession(existingFullSession);
        break;
      case 'continueTopic':
        if (smartAction.entry) {
          const session = existingEntrySessions[smartAction.entry.id];
          if (session) continueSession(session);
        }
        break;
      case 'startTopic':
        if (smartAction.entry) startSession(smartAction.entry);
        break;
      case 'study':
        startSession();
        break;
    }
  }, [smartAction, existingFullSession, existingEntrySessions]);

  // Find suggested next topic for the roadmap integration
  const suggestedNextEntry = useMemo(() => {
    if (!hasStudyPlan) return null;
    return orderedPlan.find(e => e.status !== 'passed') ?? null;
  }, [hasStudyPlan, orderedPlan]);

  const renderStatusBadge = (status: SectionStatus | undefined, compact = false) => {
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
      <View style={[styles.statusBadge, style, compact && styles.statusBadgeCompact]}>
        <ThemedText style={[styles.statusBadgeText, compact && styles.statusBadgeTextCompact]}>{label}</ThemedText>
      </View>
    );
  };

  const readinessData = readiness ?? { percentage: 0, predictedGrade: 'Failed' as const };
  const roadmapItems = roadmap ?? [];

  // Tab rendering
  const tabs: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'overview', label: t('lectureDetail.tabs.overview'), icon: 'home' },
    { key: 'studyPlan', label: t('lectureDetail.tabs.studyPlan'), icon: 'list' },
    { key: 'practice', label: t('lectureDetail.tabs.practice'), icon: 'clipboard' },
    { key: 'materials', label: t('lectureDetail.tabs.materials'), icon: 'documents' },
  ];

  const renderOverviewTab = () => (
    <View style={styles.tabContent}>
      {/* Readiness Section */}
      {hasStudyPlan && (
        <View style={styles.readinessCard}>
          <View style={styles.readinessRow}>
            <CircularReadinessGraph
              percentage={readinessData.percentage}
              predictedGrade={readinessData.predictedGrade}
              summary={readiness?.summary}
              onRefresh={refreshInsights}
              loading={loadingInsights}
              size={90}
              strokeWidth={7}
              showRefreshButton={false}
            />
            <View style={styles.readinessInfo}>
              <LinearProgressBar counts={sectionStatusCounts} height={6} showLabels={false} />
              <View style={styles.progressLabels}>
                <ThemedText style={styles.progressLabel}>
                  {sectionStatusCounts.passed}/{orderedPlan.length} topics
                </ThemedText>
              </View>
            </View>
          </View>
          {insightError && (
            <ThemedText style={styles.errorText}>{insightError}</ThemedText>
          )}
        </View>
      )}

      {/* Smart Next Action */}
      <Pressable
        style={[styles.smartActionButton, showGenerateSpinner && styles.buttonDisabled]}
        onPress={handleSmartAction}
        disabled={showGenerateSpinner || startingSession !== null}
      >
        {showGenerateSpinner || startingSession !== null ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <>
            <Ionicons name={smartAction.icon} size={20} color="#fff" />
            <View style={styles.smartActionContent}>
              <ThemedText type="defaultSemiBold" style={styles.smartActionText}>
                {smartAction.label}
              </ThemedText>
              {smartAction.entry && (
                <ThemedText style={styles.smartActionSubtext}>
                  {smartAction.entry.title}
                </ThemedText>
              )}
            </View>
          </>
        )}
      </Pressable>

      {/* Suggested Next Topic (consolidated roadmap) */}
      {suggestedNextEntry && roadmapItems.length > 0 && (
        <Pressable
          style={styles.suggestedNextCard}
          onPress={() => scrollToEntry(suggestedNextEntry.title)}
        >
          <View style={styles.suggestedNextHeader}>
            <Ionicons name="trail-sign" size={16} color="#fb923c" />
            <ThemedText type="defaultSemiBold" style={styles.suggestedNextTitle}>
              {t('lectureDetail.suggestedNext')}
            </ThemedText>
          </View>
          <ThemedText style={styles.suggestedNextTopic}>{suggestedNextEntry.title}</ThemedText>
          {suggestedNextEntry.description && (
            <ThemedText style={styles.suggestedNextDesc} numberOfLines={2}>
              {suggestedNextEntry.description}
            </ThemedText>
          )}
        </Pressable>
      )}

      {/* Focus Areas Card */}
      {hasStudyPlan && (readiness?.focusAreas?.length || readiness?.priorityExplanation) && (
        <View style={styles.insightsCard}>
          <View style={styles.sectionHeader}>
            <Ionicons name="bulb" size={16} color="#f59e0b" />
            <ThemedText type="defaultSemiBold" style={styles.insightsTitle}>
              {t('lectureDetail.priorityExplanation')}
            </ThemedText>
          </View>
          {readiness?.priorityExplanation && (
            <ThemedText style={styles.priorityExplanationText}>
              {readiness.priorityExplanation}
            </ThemedText>
          )}
          {readiness?.focusAreas && readiness.focusAreas.length > 0 && (
            <View style={styles.focusChipsRow}>
              {readiness.focusAreas.slice(0, 3).map((focus, idx) => (
                <View key={`${focus}-${idx}`} style={styles.focusChip}>
                  <ThemedText style={styles.focusChipText}>{focus}</ThemedText>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Notes Card */}
      <View style={styles.notesCard}>
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionHeader}>
            <Ionicons name="create" size={16} color="#6366f1" />
            <ThemedText type="defaultSemiBold">{t('lectureDetail.additionalNotesTitle')}</ThemedText>
          </View>
          <Pressable
            style={[styles.smallButton, (savingNotes || !notesDirty) && styles.buttonDisabled]}
            onPress={handleSaveNotes}
            disabled={savingNotes || !notesDirty}
          >
            {savingNotes ? (
              <ActivityIndicator color="#64748b" size="small" />
            ) : (
              <ThemedText style={styles.smallButtonText}>{t('common.save')}</ThemedText>
            )}
          </Pressable>
        </View>
        <TextInput
          style={styles.notesInput}
          placeholder={t('lectureDetail.additionalNotesPlaceholder')}
          placeholderTextColor={palette.textMuted}
          multiline
          numberOfLines={3}
          value={notesDraft}
          onChangeText={setNotesDraft}
          editable={!savingNotes}
        />
      </View>

      {/* No Study Plan Card */}
      {!hasStudyPlan && (
        <View style={styles.noStudyPlanCard}>
          <Ionicons name="sparkles" size={36} color="#10b981" />
          <ThemedText type="defaultSemiBold" style={styles.noStudyPlanTitle}>
            {t('lectureDetail.noPlanTitle')}
          </ThemedText>
          <ThemedText style={styles.noStudyPlanText}>
            {t('lectureDetail.noPlanText')}
          </ThemedText>
          {showGenerateSpinner && (
            <View style={styles.progressInfo}>
              <ActivityIndicator color="#10b981" />
              <ThemedText style={styles.progressText}>
                {generationProgress || t('lectureDetail.planPendingBody')}
              </ThemedText>
            </View>
          )}
        </View>
      )}

      {/* Plan Status Cards */}
      {(isPlanPending || isPlanFailed) && (
        <View style={[styles.planStatusCard, isPlanFailed && styles.planFailedCard]}>
          <View style={styles.planStatusHeader}>
            {isPlanPending ? (
              <ActivityIndicator color="#0ea5e9" size="small" />
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
              style={[styles.retryButton, generatingPlan && styles.buttonDisabled]}
              onPress={generatePlan}
              disabled={generatingPlan}
            >
              <Ionicons name="refresh" size={16} color="#fff" />
              <ThemedText style={styles.retryButtonText}>{t('lectureDetail.planRetry')}</ThemedText>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );

  const renderStudyPlanTab = () => (
    <View style={styles.tabContent}>
      {!hasStudyPlan ? (
        <View style={styles.emptyStateCard}>
          <Ionicons name="list" size={40} color={palette.textMuted} />
          <ThemedText style={styles.emptyStateText}>
            {t('lectureDetail.noPlanText')}
          </ThemedText>
          <Pressable
            style={[styles.generateButton, showGenerateSpinner && styles.buttonDisabled]}
            onPress={generatePlan}
            disabled={showGenerateSpinner}
          >
            {showGenerateSpinner ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="flash" size={18} color="#fff" />
                <ThemedText style={styles.generateButtonText}>{t('lectureDetail.generatePlan')}</ThemedText>
              </>
            )}
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.progressBarContainer}>
            <LinearProgressBar counts={sectionStatusCounts} />
          </View>

          {/* Category Quick Jump Chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categoryChipsScroll}>
            <View style={styles.categoryChipsRow}>
              {categorizedPlan.map(({ category, entries }) => {
                const passed = entries.filter(e => e.status === 'passed').length;
                return (
                  <Pressable
                    key={category}
                    style={[styles.categoryChip, categoryOpen[category] && styles.categoryChipActive]}
                    onPress={() => toggleCategory(category)}
                  >
                    <ThemedText style={styles.categoryChipText}>
                      {category} ({passed}/{entries.length})
                    </ThemedText>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          <View style={styles.studyPlanList}>
            {categorizedPlan.map(({ category, entries }) => (
              <View key={category} style={styles.categoryGroup}>
                <Pressable style={styles.categoryHeader} onPress={() => toggleCategory(category)}>
                  <Ionicons
                    name={categoryOpen[category] ? 'chevron-down' : 'chevron-forward'}
                    size={16}
                    color="#10b981"
                  />
                  <ThemedText type="defaultSemiBold" style={styles.categoryTitle}>
                    {category}
                  </ThemedText>
                  <ThemedText style={styles.categoryCount}>{entries.length}</ThemedText>
                </Pressable>
                
                {categoryOpen[category] && entries.map((entry) => {
                  const orderNumber = planOrderLookup[entry.id] ?? entry.orderIndex + 1;
                  const statusValue = (entry.status ?? 'not_started') as SectionStatus;
                  const isExpanded = expandedEntries[entry.id];
                  const isSuggested = suggestedNextEntry?.id === entry.id;

                  // Show only the most important badge (exam or professor focus)
                  const showExamBadge = entry.fromExamSource || entry.examRelevance === 'high';
                  const showProfBadge = !showExamBadge && entry.mentionedInNotes;

                  return (
                    <Pressable
                      key={entry.id}
                      style={[styles.studyPlanCard, isSuggested && styles.suggestedCard]}
                      onPress={() => setActionSheetEntry(entry)}
                      onLayout={(event) => handleEntryLayout(entry.id, event)}
                    >
                      <View style={styles.studyPlanCardHeader}>
                        <View style={[styles.orderBadge, isSuggested && styles.orderBadgeSuggested]}>
                          <ThemedText style={styles.orderBadgeText}>{orderNumber}</ThemedText>
                        </View>
                        <View style={styles.studyPlanCardContent}>
                          <View style={styles.entryHeaderRow}>
                            <ThemedText type="defaultSemiBold" style={styles.entryTitle} numberOfLines={2}>
                              {entry.title}
                            </ThemedText>
                            <View style={styles.entryBadgesRow}>
                              {renderStatusBadge(statusValue, true)}
                              {showExamBadge && (
                                <View style={styles.examBadge}>
                                  <Ionicons name="school" size={10} color="#f59e0b" />
                                </View>
                              )}
                              {showProfBadge && (
                                <View style={styles.professorFocusBadge}>
                                  <Ionicons name="star" size={10} color="#8b5cf6" />
                                </View>
                              )}
                            </View>
                          </View>
                          {entry.description && (
                            <ThemedText style={styles.entryDescription} numberOfLines={isExpanded ? undefined : 2}>
                              {entry.description}
                            </ThemedText>
                          )}
                        </View>
                        <Pressable
                          style={styles.expandButton}
                          onPress={(e) => {
                            e.stopPropagation();
                            toggleEntryExpanded(entry.id);
                          }}
                        >
                          <Ionicons
                            name={isExpanded ? 'chevron-up' : 'chevron-down'}
                            size={18}
                            color={palette.textMuted}
                          />
                        </Pressable>
                      </View>

                      {/* Expanded Content */}
                      {isExpanded && (
                        <View style={styles.expandedContent}>
                          {entry.keyConcepts && entry.keyConcepts.length > 0 && (
                            <View style={styles.conceptsContainer}>
                              {entry.keyConcepts.map((concept, idx) => (
                                <View key={idx} style={styles.conceptTag}>
                                  <ThemedText style={styles.conceptText}>{concept}</ThemedText>
                                </View>
                              ))}
                            </View>
                          )}
                          <View style={styles.entryMetaRow}>
                            {entry.importanceTier && (
                              <ThemedText style={styles.entryMetaText}>
                                {entry.importanceTier}
                              </ThemedText>
                            )}
                            {entry.priorityScore !== undefined && (
                              <ThemedText style={styles.entryMetaText}>
                                Priority {entry.priorityScore}
                              </ThemedText>
                            )}
                          </View>
                        </View>
                      )}

                      {isSuggested && (
                        <View style={styles.suggestedBadge}>
                          <Ionicons name="arrow-forward" size={12} color="#fff" />
                          <ThemedText style={styles.suggestedBadgeText}>Next</ThemedText>
                        </View>
                      )}
                    </Pressable>
                  );
                })}
                
                {/* Cluster Quiz */}
                {categoryOpen[category] && (() => {
                  const clusterStatus = getClusterStatus(category, entries);
                  const isCreating = creatingClusterQuiz === category;
                  
                  return (
                    <View style={styles.clusterQuizCard}>
                      <View style={styles.clusterQuizHeader}>
                        <Ionicons
                          name={clusterStatus.clusterPassed ? 'checkmark-circle' : 'clipboard'}
                          size={16}
                          color={clusterStatus.clusterPassed ? palette.success : '#6366f1'}
                        />
                        <ThemedText style={styles.clusterQuizTitle}>
                          {t('clusterQuiz.title')}
                        </ThemedText>
                        {clusterStatus.clusterPassed && (
                          <View style={styles.clusterPassedBadge}>
                            <ThemedText style={styles.clusterPassedBadgeText}>{t('clusterQuiz.passed')}</ThemedText>
                          </View>
                        )}
                      </View>
                      <Pressable
                        style={[styles.clusterQuizButton, isCreating && styles.buttonDisabled]}
                        onPress={() => {
                          if (clusterStatus.latestQuiz?.status === 'ready' || clusterStatus.latestQuiz?.status === 'in_progress') {
                            goToPracticeExam(clusterStatus.latestQuiz.id);
                          } else {
                            handleGenerateClusterQuiz(category, entries.length);
                          }
                        }}
                        disabled={isCreating}
                      >
                        {isCreating ? (
                          <ActivityIndicator color="#fff" size="small" />
                        ) : (
                          <>
                            <Ionicons name="flash" size={14} color="#fff" />
                            <ThemedText style={styles.clusterQuizButtonText}>
                              {clusterStatus.latestQuiz?.status === 'ready' || clusterStatus.latestQuiz?.status === 'in_progress'
                                ? t('clusterQuiz.continue')
                                : clusterStatus.latestQuiz
                                ? t('clusterQuiz.retake')
                                : t('clusterQuiz.take')}
                            </ThemedText>
                          </>
                        )}
                      </Pressable>
                    </View>
                  );
                })()}
              </View>
            ))}
          </View>
        </>
      )}
    </View>
  );

  const renderPracticeTab = () => (
    <View style={styles.tabContent}>
      <View style={styles.practiceExamCard}>
        <View style={styles.sectionHeaderRow}>
          <View style={styles.sectionHeader}>
            <Ionicons name="clipboard" size={18} color="#0ea5e9" />
            <ThemedText type="defaultSemiBold">{t('practiceExam.title')}</ThemedText>
          </View>
        </View>
        <ThemedText style={styles.sectionSubtitle}>{t('practiceExam.description')}</ThemedText>

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
          <Pressable
            style={[styles.generateExamButton, creatingPracticeExam && styles.buttonDisabled]}
            onPress={handleGeneratePracticeExam}
            disabled={creatingPracticeExam || !lecture}
          >
            {creatingPracticeExam ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="flash" size={16} color="#fff" />
                <ThemedText style={styles.generateExamButtonText}>{t('practiceExam.generate')}</ThemedText>
              </>
            )}
          </Pressable>
        </View>
      </View>

      {loadingPracticeExams ? (
        <View style={styles.loadingExams}>
          <SkeletonCard height={80} lines={2} />
          <SkeletonCard height={80} lines={2} />
        </View>
      ) : practiceExams.length === 0 ? (
        <View style={styles.emptyStateCard}>
          <Ionicons name="clipboard-outline" size={40} color={palette.textMuted} />
          <ThemedText style={styles.emptyStateText}>{t('practiceExam.empty')}</ThemedText>
        </View>
      ) : (
        <View style={styles.practiceExamList}>
          {practiceExams.map((exam) => (
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
                  exam.status === 'completed' ? styles.practiceExamBadgeSuccess
                    : exam.status === 'ready' ? styles.practiceExamBadgeReady
                    : exam.status === 'in_progress' ? styles.practiceExamBadgeInProgress
                    : exam.status === 'failed' ? styles.practiceExamBadgeFailed
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
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );

  const renderMaterialsTab = () => (
    <View style={styles.tabContent}>
      <View style={styles.materialsHeader}>
        <Ionicons name="documents" size={18} color="#3b82f6" />
        <ThemedText type="defaultSemiBold">
          {lecture.files.length} {lecture.files.length === 1 ? 'file' : 'files'}
        </ThemedText>
      </View>
      
      {lecture.files.map((file) => (
        <View key={file.id} style={styles.fileCard}>
          <View style={styles.fileHeader}>
            <Ionicons name="document" size={16} color="#64748b" />
            <ThemedText type="defaultSemiBold" style={styles.fileName}>{file.name}</ThemedText>
            {file.extractedText && (
              <View style={styles.extractedBadge}>
                <Ionicons name="checkmark-circle" size={12} color="#10b981" />
              </View>
            )}
          </View>
          <PdfWebView uri={file.uri} />
        </View>
      ))}
    </View>
  );

  return (
    <>
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.container}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={palette.primary}
          />
        }
      >
        {/* Header Section */}
        <View style={styles.header}>
          <View style={styles.headerContent}>
            <ThemedText type="title" numberOfLines={2}>{lecture.title}</ThemedText>
            <ThemedText style={styles.description} numberOfLines={2}>
              {stripCodeFences(lecture.description) || t('lectureDetail.noDescription')}
            </ThemedText>
            {typeof lectureCost === 'number' && lectureCost > 0 && (
              <ThemedText style={styles.lectureCost}>
                {t('lectureDetail.aiCost', { value: lectureCost.toFixed(4) })}
              </ThemedText>
            )}
          </View>
          
          {/* More Menu Button (overflow menu) */}
          <Pressable style={styles.moreButton} onPress={() => setShowMoreMenu(!showMoreMenu)}>
            <Ionicons name="ellipsis-vertical" size={20} color={palette.textMuted} />
          </Pressable>
        </View>

        {/* More Menu Dropdown */}
        {showMoreMenu && (
          <View style={styles.moreMenu}>
            <Pressable style={styles.moreMenuItem} onPress={generatePlan} disabled={generatingPlan}>
              <Ionicons name="refresh" size={18} color={palette.text} />
              <ThemedText>{t('lectureDetail.regenerate')}</ThemedText>
            </Pressable>
            <Pressable
              style={[styles.moreMenuItem, styles.moreMenuItemDanger]}
              onPress={confirmDeleteLecture}
              disabled={deletingLecture}
            >
              <Ionicons name="trash" size={18} color="#ef4444" />
              <ThemedText style={styles.moreMenuItemDangerText}>{t('lectureDetail.deleteButton')}</ThemedText>
            </Pressable>
          </View>
        )}

        {/* Tab Navigation */}
        <View style={styles.tabBar}>
          {tabs.map((tab) => (
            <Pressable
              key={tab.key}
              style={[styles.tab, activeTab === tab.key && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Ionicons
                name={tab.icon}
                size={18}
                color={activeTab === tab.key ? palette.primary : palette.textMuted}
              />
              <ThemedText
                style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}
              >
                {tab.label}
              </ThemedText>
            </Pressable>
          ))}
        </View>

        {/* Tab Content */}
        {activeTab === 'overview' && renderOverviewTab()}
        {activeTab === 'studyPlan' && renderStudyPlanTab()}
        {activeTab === 'practice' && renderPracticeTab()}
        {activeTab === 'materials' && renderMaterialsTab()}
      </ScrollView>

      {/* Entry Action Sheet */}
      <EntryActionSheet
        visible={actionSheetEntry !== null}
        onClose={() => setActionSheetEntry(null)}
        entry={actionSheetEntry}
        existingSession={actionSheetEntry ? existingEntrySessions[actionSheetEntry.id] ?? null : null}
        onStartSession={startSession}
        onContinueSession={continueSession}
        loading={startingSession !== null}
      />
    </>
  );
}

const createStyles = (palette: typeof Colors.light) =>
  StyleSheet.create({
    container: {
      padding: Spacing.md,
      paddingBottom: 40,
      backgroundColor: palette.background,
    },
    loadingContainer: {
      flex: 1,
      padding: Spacing.md,
      backgroundColor: palette.background,
      gap: Spacing.lg,
    },
    skeletonSection: {
      gap: Spacing.md,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: palette.background,
    },
    
    // Header
    header: {
      flexDirection: 'row',
      gap: Spacing.md,
      marginBottom: Spacing.sm,
    },
    headerContent: {
      flex: 1,
      gap: Spacing.xs,
    },
    description: {
      color: palette.textMuted,
      fontSize: 14,
      lineHeight: 20,
    },
    lectureCost: {
      color: palette.textMuted,
      fontSize: 12,
    },
    moreButton: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: Radii.md,
      backgroundColor: palette.surfaceAlt,
    },
    moreMenu: {
      backgroundColor: palette.surface,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      marginBottom: Spacing.sm,
      ...Shadows.sm,
    },
    moreMenuItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
    },
    moreMenuItemDanger: {
      borderTopWidth: 1,
      borderTopColor: palette.border,
    },
    moreMenuItemDangerText: {
      color: '#ef4444',
    },
    
    // Tab Bar
    tabBar: {
      flexDirection: 'row',
      backgroundColor: palette.surface,
      borderRadius: Radii.md,
      padding: 4,
      marginBottom: Spacing.md,
      borderWidth: 1,
      borderColor: palette.border,
    },
    tab: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingVertical: Spacing.sm,
      borderRadius: Radii.sm,
    },
    tabActive: {
      backgroundColor: `${palette.primary}14`,
    },
    tabText: {
      fontSize: 12,
      color: palette.textMuted,
      fontWeight: '500',
    },
    tabTextActive: {
      color: palette.primary,
      fontWeight: '600',
    },
    
    // Tab Content
    tabContent: {
      gap: Spacing.md,
    },
    
    // Readiness Card
    readinessCard: {
      backgroundColor: palette.surface,
      borderRadius: Radii.lg,
      padding: Spacing.md,
      borderWidth: 1,
      borderColor: palette.border,
      gap: Spacing.sm,
    },
    readinessRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
    },
    readinessInfo: {
      flex: 1,
      gap: Spacing.xs,
    },
    progressLabels: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    progressLabel: {
      fontSize: 12,
      color: palette.textMuted,
    },
    
    // Smart Action Button
    smartActionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      backgroundColor: palette.primary,
      paddingVertical: 14,
      paddingHorizontal: Spacing.lg,
      borderRadius: Radii.md,
      ...Shadows.sm,
    },
    smartActionContent: {
      flex: 1,
    },
    smartActionText: {
      color: '#fff',
      fontSize: 16,
    },
    smartActionSubtext: {
      color: 'rgba(255,255,255,0.8)',
      fontSize: 13,
    },
    
    // Suggested Next Card
    suggestedNextCard: {
      backgroundColor: `${palette.warning}10`,
      borderRadius: Radii.md,
      padding: Spacing.md,
      borderWidth: 1,
      borderColor: `${palette.warning}30`,
      gap: Spacing.xs,
    },
    suggestedNextHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    suggestedNextTitle: {
      color: '#fb923c',
      fontSize: 13,
    },
    suggestedNextTopic: {
      fontSize: 16,
      fontWeight: '600',
      color: palette.text,
    },
    suggestedNextDesc: {
      fontSize: 13,
      color: palette.textMuted,
      lineHeight: 18,
    },
    
    // Insights Card
    insightsCard: {
      backgroundColor: palette.surface,
      borderRadius: Radii.md,
      padding: Spacing.md,
      borderWidth: 1,
      borderColor: palette.border,
      gap: Spacing.sm,
    },
    insightsTitle: {
      fontSize: 14,
    },
    priorityExplanationText: {
      color: palette.textMuted,
      fontSize: 13,
      lineHeight: 19,
    },
    focusChipsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.xs,
    },
    focusChip: {
      paddingVertical: 4,
      paddingHorizontal: 10,
      backgroundColor: palette.surfaceAlt,
      borderRadius: Radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
    },
    focusChipText: {
      fontSize: 12,
      color: palette.text,
    },
    
    // Notes Card
    notesCard: {
      backgroundColor: palette.surface,
      borderRadius: Radii.md,
      padding: Spacing.md,
      borderWidth: 1,
      borderColor: palette.border,
      gap: Spacing.sm,
    },
    notesInput: {
      minHeight: 70,
      borderRadius: Radii.sm,
      borderWidth: 1,
      borderColor: palette.border,
      padding: 10,
      color: palette.text,
      textAlignVertical: 'top',
      backgroundColor: palette.surfaceAlt,
      fontSize: 14,
    },
    
    // Section Headers
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
    sectionSubtitle: {
      color: palette.textMuted,
      fontSize: 13,
    },
    
    // Buttons
    smallButton: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: Radii.sm,
      backgroundColor: palette.muted,
    },
    smallButtonText: {
      fontSize: 13,
      color: palette.textMuted,
      fontWeight: '500',
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    
    // No Study Plan
    noStudyPlanCard: {
      backgroundColor: `${palette.success}10`,
      borderRadius: Radii.lg,
      padding: Spacing.lg,
      alignItems: 'center',
      gap: Spacing.sm,
      borderWidth: 1,
      borderColor: `${palette.success}30`,
    },
    noStudyPlanTitle: {
      fontSize: 17,
      color: palette.success,
    },
    noStudyPlanText: {
      color: palette.textMuted,
      textAlign: 'center',
      fontSize: 14,
      lineHeight: 20,
    },
    progressInfo: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      marginTop: Spacing.xs,
    },
    progressText: {
      color: palette.textMuted,
      fontSize: 13,
    },
    
    // Plan Status
    planStatusCard: {
      backgroundColor: palette.surface,
      borderRadius: Radii.md,
      padding: Spacing.md,
      borderWidth: 1,
      borderColor: palette.border,
      gap: Spacing.sm,
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
      fontSize: 13,
      lineHeight: 19,
    },
    retryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      backgroundColor: palette.primary,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: Radii.md,
      alignSelf: 'flex-start',
    },
    retryButtonText: {
      color: '#fff',
      fontWeight: '600',
      fontSize: 14,
    },
    
    // Progress Bar Container
    progressBarContainer: {
      marginBottom: Spacing.xs,
    },
    
    // Category Chips
    categoryChipsScroll: {
      marginHorizontal: -Spacing.md,
      paddingHorizontal: Spacing.md,
    },
    categoryChipsRow: {
      flexDirection: 'row',
      gap: Spacing.xs,
      paddingRight: Spacing.md,
    },
    categoryChip: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: Radii.pill,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
    },
    categoryChipActive: {
      backgroundColor: `${palette.primary}14`,
      borderColor: `${palette.primary}33`,
    },
    categoryChipText: {
      fontSize: 12,
      color: palette.text,
      fontWeight: '500',
    },
    
    // Study Plan List
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
      paddingVertical: Spacing.xs,
    },
    categoryTitle: {
      color: palette.success,
      fontSize: 13,
      textTransform: 'uppercase',
      letterSpacing: 0.3,
    },
    categoryCount: {
      marginLeft: 'auto',
      color: palette.textMuted,
      fontSize: 12,
    },
    
    // Study Plan Card
    studyPlanCard: {
      backgroundColor: palette.surface,
      borderRadius: Radii.md,
      padding: Spacing.md,
      borderWidth: 1,
      borderColor: palette.border,
      gap: Spacing.xs,
    },
    suggestedCard: {
      borderColor: `${palette.warning}50`,
      backgroundColor: `${palette.warning}05`,
    },
    studyPlanCardHeader: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    studyPlanCardContent: {
      flex: 1,
      gap: 4,
    },
    orderBadge: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: palette.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    orderBadgeSuggested: {
      backgroundColor: '#fb923c',
    },
    orderBadgeText: {
      color: '#fff',
      fontWeight: '700',
      fontSize: 13,
    },
    entryHeaderRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: Spacing.xs,
    },
    entryTitle: {
      flex: 1,
      fontSize: 15,
      color: palette.text,
    },
    entryBadgesRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    entryDescription: {
      fontSize: 13,
      color: palette.textMuted,
      lineHeight: 18,
    },
    expandButton: {
      padding: 4,
    },
    expandedContent: {
      gap: Spacing.sm,
      paddingTop: Spacing.xs,
      borderTopWidth: 1,
      borderTopColor: palette.border,
      marginTop: Spacing.xs,
    },
    conceptsContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 4,
    },
    conceptTag: {
      backgroundColor: `${palette.success}12`,
      borderWidth: 1,
      borderColor: `${palette.success}30`,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: Radii.sm,
    },
    conceptText: {
      color: palette.success,
      fontSize: 11,
      fontWeight: '500',
    },
    entryMetaRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    entryMetaText: {
      fontSize: 11,
      color: palette.textMuted,
    },
    suggestedBadge: {
      position: 'absolute',
      top: -6,
      right: Spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: '#fb923c',
      paddingVertical: 3,
      paddingHorizontal: 8,
      borderRadius: Radii.sm,
    },
    suggestedBadgeText: {
      color: '#fff',
      fontSize: 10,
      fontWeight: '700',
    },
    
    // Status Badges
    statusBadge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: Radii.sm,
      borderWidth: 1,
    },
    statusBadgeCompact: {
      paddingHorizontal: 6,
      paddingVertical: 2,
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
      borderColor: `${palette.warning}40`,
    },
    statusBadgeNotStarted: {
      backgroundColor: `${palette.muted}14`,
      borderColor: `${palette.muted}40`,
    },
    statusBadgeText: {
      fontSize: 10,
      fontWeight: '600',
      color: palette.text,
    },
    statusBadgeTextCompact: {
      fontSize: 9,
    },
    examBadge: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: '#fef3c7',
      borderWidth: 1,
      borderColor: '#fcd34d',
      alignItems: 'center',
      justifyContent: 'center',
    },
    professorFocusBadge: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: '#ede9fe',
      borderWidth: 1,
      borderColor: '#c4b5fd',
      alignItems: 'center',
      justifyContent: 'center',
    },
    
    // Cluster Quiz
    clusterQuizCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: `${palette.primary}08`,
      borderRadius: Radii.md,
      padding: Spacing.sm,
      borderWidth: 1,
      borderColor: `${palette.primary}20`,
    },
    clusterQuizHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      flex: 1,
    },
    clusterQuizTitle: {
      color: '#6366f1',
      fontSize: 13,
      fontWeight: '500',
    },
    clusterPassedBadge: {
      backgroundColor: `${palette.success}18`,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: Radii.sm,
    },
    clusterPassedBadgeText: {
      color: palette.success,
      fontSize: 10,
      fontWeight: '600',
    },
    clusterQuizButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: '#6366f1',
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: Radii.sm,
    },
    clusterQuizButtonText: {
      color: '#fff',
      fontSize: 12,
      fontWeight: '600',
    },
    
    // Practice Tab
    practiceExamCard: {
      backgroundColor: palette.surface,
      borderRadius: Radii.md,
      padding: Spacing.md,
      borderWidth: 1,
      borderColor: palette.border,
      gap: Spacing.sm,
    },
    practiceExamControls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
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
      width: 50,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: Radii.sm,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surfaceAlt,
      color: palette.text,
      textAlign: 'center',
    },
    generateExamButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      backgroundColor: palette.primary,
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: Radii.md,
    },
    generateExamButtonText: {
      color: '#fff',
      fontWeight: '600',
      fontSize: 14,
    },
    loadingExams: {
      gap: Spacing.md,
    },
    practiceExamList: {
      gap: Spacing.sm,
    },
    practiceExamItem: {
      backgroundColor: palette.surface,
      borderRadius: Radii.md,
      padding: Spacing.md,
      borderWidth: 1,
      borderColor: palette.border,
      gap: Spacing.xs,
    },
    practiceExamItemHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.sm,
    },
    practiceExamTitle: {
      flex: 1,
      fontSize: 14,
      color: palette.text,
    },
    practiceExamBadge: {
      borderRadius: Radii.pill,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderWidth: 1,
    },
    practiceExamBadgeText: {
      fontSize: 11,
      fontWeight: '600',
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
    
    // Empty State
    emptyStateCard: {
      backgroundColor: palette.surface,
      borderRadius: Radii.lg,
      padding: Spacing.xl,
      alignItems: 'center',
      gap: Spacing.md,
      borderWidth: 1,
      borderColor: palette.border,
    },
    emptyStateText: {
      color: palette.textMuted,
      textAlign: 'center',
      fontSize: 14,
      lineHeight: 20,
    },
    generateButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      backgroundColor: palette.primary,
      paddingVertical: 12,
      paddingHorizontal: 20,
      borderRadius: Radii.md,
    },
    generateButtonText: {
      color: '#fff',
      fontWeight: '600',
      fontSize: 15,
    },
    
    // Materials Tab
    materialsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      marginBottom: Spacing.xs,
    },
    fileCard: {
      backgroundColor: palette.surface,
      borderRadius: Radii.md,
      padding: Spacing.md,
      borderWidth: 1,
      borderColor: palette.border,
      gap: Spacing.sm,
      marginBottom: Spacing.sm,
    },
    fileHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    fileName: {
      flex: 1,
      fontSize: 14,
    },
    extractedBadge: {
      width: 20,
      height: 20,
      borderRadius: 10,
      backgroundColor: `${palette.success}14`,
      alignItems: 'center',
      justifyContent: 'center',
    },
    
    // Error
    errorText: {
      color: palette.danger,
      fontSize: 13,
    },
  });
