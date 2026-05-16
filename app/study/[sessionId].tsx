import * as FileSystem from "expo-file-system/legacy";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  LayoutChangeEvent,
  ScrollView,
} from "react-native";
import {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { v4 as uuid } from "uuid";

import { StreamingTTSPlayer, TTSPlayerState } from "@/lib/audio";
import {
  DepthProgressState,
  buildDepthCheckProgressLine,
  buildDepthQuestion,
  canPassStudyPlanEntry,
  feedbackPassesDepthCheck,
  findDepthProgressInText,
  getNextTutorCheckType,
  getPassedDepthCheckTypes,
  getTargetPassScore,
  REQUIRED_TUTOR_CHECK_TYPES,
  stripDepthProgressFromText,
  TUTOR_CHECK_DESCRIPTIONS,
  TUTOR_CHECK_LABELS,
  normalizeTutorCheckType,
} from "@/lib/depth-checks";
import {
  balanceCitationChunks,
  CitationSourceChunk,
  CitationSourceMetadata,
  cleanSourceFileName,
  getCitationSourceType,
} from "@/lib/study/study-citations";
import {
  buildSessionSummaryText,
  buildSocraticHint,
  buildStudyPrepContent,
  collapseRepeatedTutorText,
  getModeLabel,
  shuffleStudyWarmupOptions,
} from "@/lib/study/study-flow";
import { insertCanvasFeedbackBlockBelowAnswer } from "@/lib/study/canvas-feedback";
import {
  buildGuidedAudioReplayFromMessage,
  buildListeningNotesQuestion,
  getListeningNotesAudioText,
  shouldUseListeningNotesFlow,
} from "@/lib/study/listening-notes-flow";
import {
  CHAT_ITEM_HEIGHT,
  FINAL_QUIZ_QUESTION_COUNT,
  MEMORIZATION_SECONDS,
  STAGE_LABELS,
  WARMUP_QUESTION_COUNT,
} from "@/lib/study/study-session-constants";
import {
  CanvasStageInfo,
  FeynmanSendOptions,
  FinalQuizAnswer,
  FinalQuizState,
  GuidedAudioReplay,
  PendingGuidedQuestion,
  StudyPhase,
  WarmupAnswer,
  WarmupState,
} from "@/lib/study/study-session-types";
import {
  hasCanvasStudySurface,
  resolveStudySessionSurface,
  toggleStudySessionSurface,
  type StudySessionSurfacePreference,
} from "@/lib/study/study-view-toggle";
import {
  dedupeVisualBlocks,
  estimateTokenCount,
  getVisualBlockBottom,
  getVisualBlockInsertKey,
  getVisualBlockSignature,
  normalizeCanvasPageVisualBlocks,
  sessionHasInProgressCanvasWork,
} from "@/lib/study/study-session-utils";

import {
  CanvasMode,
  CanvasStroke,
  HandwritingCanvasHandle,
} from "@/components/handwriting-canvas";
import { StudyCanvasPanel } from "@/components/study/study-canvas-panel";
import { StudyChatPanel } from "@/components/study/study-chat-panel";
import { StudyFlashcardToast } from "@/components/study/study-flashcard-toast";
import { StudyLecturePassedToast } from "@/components/study/study-lecture-passed-toast";
import { createStudyStyles } from "@/components/study/study-styles";
import { PdfReferenceModal } from "../../components/pdf-reference-modal";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors } from "@/constants/theme";
import { useLanguage } from "@/contexts/language-context";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useLectures } from "@/hooks/use-lectures";
import { useMaterials } from "@/hooks/use-materials";
import { useStudyCanvasPages } from "@/hooks/use-study-canvas-pages";
import { useStudySessionQueries } from "@/hooks/use-study-session-queries";
import { textToStrokes } from "@/lib/handwriting-font";
import { getAISettings } from "@/lib/ai-settings";
import { computeMasteryScore, computeNextReviewDate } from "@/lib/mastery";
import {
  ChatMessage,
  embedQuery,
  enqueueCheatSheetRefresh,
  evaluateAnswer,
  generateQuestions,
  generateWarmupQuestions,
  streamFeynmanChat,
} from "@/lib/openai";
import {
  createCanvasVisualBlock,
  estimateVisualBlockSize,
  parseAIResponse,
} from "@/lib/parse-visual-response";
import { parseLearningResponse } from "@/lib/parse-learning-response";
import { buildCitationSnippet } from "@/lib/pdf-source";
import { parseSourceCitations } from "@/lib/source-citations";
import { uploadCanvasImage } from "@/lib/storage";
import {
  LectureFileChunk,
  addReviewEvent,
  countLectureChunks,
  createSession,
  getSupabase,
  getUserStreak,
  listReviewEvents,
  saveAnswerLink,
  saveFlashcard,
  saveStudyDepthCheck,
  saveStudyMisconceptions,
  saveSessionMessage,
  saveTutorAnswerEvaluation,
  markLectureCheatSheetPending,
  searchLectureChunks,
  updateSession,
  updateStudyPlanEntryMastery,
  updateStudyPlanEntryStatus,
  updateUserStreak,
} from "@/lib/supabase";
import {
  CanvasAnswerMarker,
  CanvasBounds,
  CanvasPage,
  CanvasStageKind,
  CanvasStrokeData,
  CanvasVisualBlock as CanvasVisualBlockType,
  Lecture,
  Material,
  ReviewQuality,
  SectionStatus,
  StudyAnswerLink,
  StudyChatMessage,
  StudyCitation,
  StudyDepthCheck,
  StudyPlanEntry,
  StudyQuestion,
  StudyMode,
  StudyMistakeNotebookItem,
  StudySession,
  StudyWarmupQuestion,
  TutorCheckType,
} from "@/types";

export default function StudySessionScreen() {
  const { sessionId, materialId, lectureId, studyPlanEntryId } =
    useLocalSearchParams<{
      sessionId: string;
      materialId?: string;
      lectureId?: string;
      studyPlanEntryId?: string;
    }>();
  const currentSessionId = sessionId as string;
  const studyQueries = useStudySessionQueries({
    sessionId: currentSessionId,
    lectureId,
    studyPlanEntryId,
  });
  const { data: materials = [], isFetching: loadingMaterials } = useMaterials();
  const { data: lectures = [], isFetching: loadingLectures } = useLectures();
  const { t, agentLanguage } = useLanguage();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme === "dark" ? "dark" : "light"];
  const styles = useMemo(() => createStudyStyles(palette), [palette]);

  const material = useMemo<Material | undefined>(
    () => materials.find((m) => m.id === materialId),
    [materials, materialId],
  );
  const lecture = useMemo<Lecture | undefined>(
    () => lectures.find((l) => l.id === lectureId),
    [lectures, lectureId],
  );
  const citationFileMetadata = useMemo(() => {
    const metadata = new Map<string, CitationSourceMetadata>();
    lecture?.files.forEach((file) => {
      metadata.set(file.id, {
        name: cleanSourceFileName(file.name || file.uri),
        sourceType: getCitationSourceType(file),
      });
    });
    return metadata;
  }, [lecture?.files]);

  const citationFileNames = useMemo(() => {
    const names = new Map<string, string>();
    citationFileMetadata.forEach((metadata, fileId) => {
      names.set(fileId, metadata.name);
    });
    return names;
  }, [citationFileMetadata]);
  const [activeCitation, setActiveCitation] = useState<StudyCitation | null>(
    null,
  );

  const activeCitationFile = useMemo(
    () =>
      activeCitation?.lectureFileId
        ? (lecture?.files.find(
            (file) => file.id === activeCitation.lectureFileId,
          ) ?? null)
        : null,
    [activeCitation, lecture?.files],
  );

  // Study plan entry for focused study
  const [studyPlanEntry, setStudyPlanEntry] = useState<StudyPlanEntry | null>(
    null,
  );
  const loadingEntry = studyQueries.studyPlanEntryQuery.isFetching;
  const [recentMisconceptions, setRecentMisconceptions] = useState<string[]>(
    [],
  );
  const [depthChecks, setDepthChecks] = useState<StudyDepthCheck[]>([]);

  useEffect(() => {
    setStudyPlanEntry(studyQueries.studyPlanEntryQuery.data ?? null);
  }, [studyQueries.studyPlanEntryQuery.data]);

  useEffect(() => {
    setDepthChecks(studyQueries.depthChecksQuery.data ?? []);
  }, [studyQueries.depthChecksQuery.data]);

  const targetPassScore = useMemo(
    () => getTargetPassScore(lecture?.planSettings?.targetGrade ?? "pass"),
    [lecture?.planSettings?.targetGrade],
  );

  // Build the study title based on context
  const studyTitle = useMemo(() => {
    if (studyPlanEntry) {
      return `${lecture?.title || t("study.titleFallback")}: ${studyPlanEntry.title}`;
    }
    return lecture?.title ?? material?.title ?? t("study.titleFallback");
  }, [lecture, material, studyPlanEntry, t]);

  const nextDepthCheckType = useMemo(
    () => getNextTutorCheckType(depthChecks, targetPassScore),
    [depthChecks, targetPassScore],
  );

  const depthProgressLine = useMemo(
    () => buildDepthCheckProgressLine(depthChecks, targetPassScore),
    [depthChecks, targetPassScore],
  );

  // Build comprehensive material context for the AI
  // This includes FULL extracted text from all PDFs for accurate tutoring
  const fullMaterialContext = useMemo(() => {
    const parts: string[] = [];

    // Add lecture info
    if (lecture) {
      parts.push(`# Lecture: ${lecture.title}`);
      if (lecture.description) {
        parts.push(`## Overview\n${lecture.description}`);
      }

      // Add FULL extracted text from all lecture files
      // This is crucial for university-level accuracy
      const filesWithText = lecture.files.filter((f) => f.extractedText);
      if (filesWithText.length > 0) {
        parts.push("\n## Complete Material Content");
        for (const file of filesWithText) {
          parts.push(`\n### ${file.name}\n${file.extractedText}`);
        }
      }
    }

    // Add material info for standalone materials
    if (material && !lecture) {
      parts.push(`# Material: ${material.title}`);
      if (material.description) {
        parts.push(`## Description\n${material.description}`);
      }
    }

    // If studying a specific topic, add focus context
    if (studyPlanEntry) {
      parts.push(`\n## Current Study Focus: ${studyPlanEntry.title}`);
      if (studyPlanEntry.description) {
        parts.push(`Focus Description: ${studyPlanEntry.description}`);
      }
      if (studyPlanEntry.keyConcepts && studyPlanEntry.keyConcepts.length > 0) {
        parts.push(
          `Key Concepts to Master: ${studyPlanEntry.keyConcepts.join(", ")}`,
        );
      }
      parts.push(
        "\nIMPORTANT: Focus your explanations, questions, and feedback specifically on this topic and its key concepts. Draw from the full material content above but emphasize this particular area.",
      );
      parts.push(
        [
          "\n## Depth Pass Gate",
          `Current depth progress: ${depthProgressLine}`,
          nextDepthCheckType
            ? `Next required checkType: ${nextDepthCheckType} (${TUTOR_CHECK_LABELS[nextDepthCheckType]})`
            : "All required depth checks are currently passed.",
          `The topic should only be considered passed after recall, why, apply, transfer, and teach_back checks all score at least ${targetPassScore}/100, followed by a final quiz.`,
        ].join("\n"),
      );
    }

    if (recentMisconceptions.length > 0) {
      parts.push(
        `\n## Recent Misconceptions To Revisit\n${recentMisconceptions
          .slice(0, 6)
          .map((item) => `- ${item}`)
          .join("\n")}`,
      );
    }

    return parts.join("\n\n");
  }, [
    lecture,
    material,
    studyPlanEntry,
    recentMisconceptions,
    depthProgressLine,
    nextDepthCheckType,
    targetPassScore,
  ]);

  // Simple outline for display (not for AI context)
  const studyOutline = useMemo(() => {
    if (studyPlanEntry) {
      const concepts = studyPlanEntry.keyConcepts?.join(", ") || "";
      const conceptsLabel = t("study.focusConceptsFallback");
      return `${studyPlanEntry.description || ""}${concepts ? `\n\n${conceptsLabel}: ${concepts}` : ""}`;
    }
    return (
      lecture?.description ?? material?.description ?? t("study.noDescription")
    );
  }, [lecture, material, studyPlanEntry, t]);

  const [questions, setQuestions] = useState<StudyQuestion[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<StudyQuestion | null>(
    null,
  );
  const [messages, setMessages] = useState<StudyChatMessage[]>([]);
  const [responseDepthProgress, setResponseDepthProgress] = useState<Partial<
    Record<TutorCheckType, DepthProgressState>
  > | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [answerText, setAnswerText] = useState("");
  const [answerDraft, setAnswerDraft] = useState("");
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [grading, setGrading] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [answerLinks, setAnswerLinks] = useState<StudyAnswerLink[]>([]);
  const [studySurfacePreference, setStudySurfacePreference] =
    useState<StudySessionSurfacePreference>(null);

  // Canvas state
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("pen");
  const [canvasColor, setCanvasColor] = useState("#0f172a");

  // Voice/TTS state
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [activeTtsMessageId, setActiveTtsMessageId] = useState<string | null>(
    null,
  );
  const [listeningMode, setListeningMode] = useState(false);
  const ttsPlayerRef = useRef<StreamingTTSPlayer | null>(null);
  const pendingTtsMessageIdRef = useRef<string | null>(null);
  const guidedQuestionReadyRef = useRef(false);
  const pendingGuidedQuestionRef = useRef<PendingGuidedQuestion | null>(null);
  const [guidedAudioReplay, setGuidedAudioReplay] =
    useState<GuidedAudioReplay | null>(null);
  const finishGuidedNotesStageRef = useRef<() => void>(() => undefined);

  // Scroll control for stylus drawing
  const [scrollEnabled, setScrollEnabled] = useState(true);

  // Drawing detection state
  const [hasDrawnAfterQuestion, setHasDrawnAfterQuestion] = useState(false);
  const [isCurrentlyDrawing, setIsCurrentlyDrawing] = useState(false);
  const [lastDrawingPosition, setLastDrawingPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const canvasBaselineRef = useRef(0);
  const hasInitializedCanvasRef = useRef(false);

  const resetCanvasInteractionState = useCallback(() => {
    setHasDrawnAfterQuestion(false);
    setLastDrawingPosition(null);
  }, []);

  const {
    canvasPages,
    setCanvasPages,
    activePageId,
    activePage,
    activatePage,
    canvasStrokes,
    canvasSize,
    initialCanvasStrokes,
    activeVisualBlocks,
    canvasPagesRef,
    saveCanvasDebounceRef,
    saveCanvasPagesNow,
    createNewPage,
    restoreCanvasPages,
    setInitialBlankPage,
    getStageInfoForPage,
    ensureCanvasStagePage,
    handleAddPage,
    handleSelectPage,
    updateActivePageStrokes,
    updateActivePageTitleStrokes,
    clearActivePageStrokes,
    growActivePageNearEdge,
  } = useStudyCanvasPages({
    sessionId: currentSessionId,
    onPageBaselineChange: (baseline) => {
      canvasBaselineRef.current = baseline;
    },
    onPageInitialized: () => {
      hasInitializedCanvasRef.current = true;
    },
    onInteractionReset: resetCanvasInteractionState,
  });

  // Answer markers for linking canvas to chat
  const [answerMarkers, setAnswerMarkers] = useState<CanvasAnswerMarker[]>([]);
  const questionIndexCounterRef = useRef(0);
  const canvasQuestionCounterRef = useRef(0);
  const writtenQuestionIdsRef = useRef<Set<string>>(new Set());
  const streamingAiMessageIdsRef = useRef<Set<string>>(new Set());
  const completedAiMessageIdsRef = useRef<Set<string>>(new Set());
  const messageIdsRef = useRef<Set<string>>(new Set());
  const insertedVisualBlockKeysRef = useRef<Set<string>>(new Set());
  const hasSeededQuestionWritesRef = useRef(false);

  // Highlight state for canvas area when clicking "View Notes" in chat
  const [highlightedAnswerLinkId, setHighlightedAnswerLinkId] = useState<
    string | null
  >(null);
  const [highlightedBounds, setHighlightedBounds] =
    useState<CanvasBounds | null>(null);
  const [canvasLayout, setCanvasLayout] = useState<{
    width: number;
    height: number;
  }>({ width: 0, height: 0 });

  // Visual blocks highlight state
  const [highlightedVisualBlockId, setHighlightedVisualBlockId] = useState<
    string | null
  >(null);

  // AI Tutor collapse state
  const [, setTutorCollapsed] = useState(false);
  const [studyPhase, setStudyPhase] = useState<StudyPhase>("tutor");
  const [studyMode, setStudyMode] = useState<StudyMode>("beginner");
  const [pendingGuidedQuestion, setPendingGuidedQuestion] =
    useState<PendingGuidedQuestion | null>(null);
  const [mistakeNotebook, setMistakeNotebook] = useState<
    StudyMistakeNotebookItem[]
  >([]);
  const [recallHintRevealed, setRecallHintRevealed] = useState(false);
  const [memorizationSecondsRemaining, setMemorizationSecondsRemaining] =
    useState<number | null>(null);
  const [memorizationMessageId, setMemorizationMessageId] = useState<
    string | null
  >(null);
  const [warmupState, setWarmupState] = useState<WarmupState>({
    status: "idle",
    questions: [],
    currentIndex: 0,
    answers: [],
    selectedOptionIndex: null,
  });
  const [finalQuizState, setFinalQuizState] = useState<FinalQuizState>({
    status: "idle",
    questions: [],
    currentIndex: 0,
    answers: [],
  });
  const finalQuizStartedRef = useRef(false);
  const finalQuizPassedRef = useRef(false);
  const endSummaryPushedRef = useRef(false);

  const latestDepthProgressFromMessages = useMemo(() => {
    if (responseDepthProgress) return responseDepthProgress;

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role !== "ai") continue;
      const parsed = findDepthProgressInText(message.text);
      if (parsed) return parsed;
    }

    return null;
  }, [messages, responseDepthProgress]);

  const depthProgressItems = useMemo(() => {
    const passed = getPassedDepthCheckTypes(depthChecks, targetPassScore);
    const passedTypes = new Set<TutorCheckType>(passed);

    if (latestDepthProgressFromMessages) {
      REQUIRED_TUTOR_CHECK_TYPES.forEach((type) => {
        if (latestDepthProgressFromMessages[type] === "done") {
          passedTypes.add(type);
        }
      });
    }

    const currentType =
      REQUIRED_TUTOR_CHECK_TYPES.find((type) => !passedTypes.has(type)) ?? null;

    return REQUIRED_TUTOR_CHECK_TYPES.map((type) => {
      const checksForType = depthChecks.filter(
        (check) => normalizeTutorCheckType(check.checkType) === type,
      );
      const scores = checksForType
        .map((check) => check.score)
        .filter((score): score is number => typeof score === "number");

      return {
        type,
        label: TUTOR_CHECK_LABELS[type],
        passed: passedTypes.has(type),
        current: currentType === type,
        attempts: checksForType.length,
        bestScore: scores.length > 0 ? Math.max(...scores) : undefined,
      };
    });
  }, [depthChecks, latestDepthProgressFromMessages, targetPassScore]);

  const studyPrepContent = useMemo(
    () =>
      buildStudyPrepContent(
        studyMode,
        studyPlanEntry?.title || studyTitle,
        studyPlanEntry?.keyConcepts ?? [],
        t,
        studyPlanEntry?.description,
      ),
    [
      studyMode,
      studyPlanEntry?.description,
      studyPlanEntry?.keyConcepts,
      studyPlanEntry?.title,
      studyTitle,
      t,
    ],
  );

  const addMistakeNotebookItems = useCallback(
    (
      items: {
        concept?: string;
        note?: string;
        source: StudyMistakeNotebookItem["source"];
      }[],
    ) => {
      const normalized = items
        .map((item) => ({
          concept: item.concept?.trim(),
          note: item.note?.trim(),
          source: item.source,
        }))
        .filter(
          (item): item is Omit<StudyMistakeNotebookItem, "id"> =>
            Boolean(item.concept) && Boolean(item.note),
        );

      if (normalized.length === 0) return;

      setMistakeNotebook((prev) => {
        const existing = new Set(
          prev.map((item) => `${item.source}:${item.concept.toLowerCase()}`),
        );
        const nextItems = normalized
          .filter((item) => {
            const key = `${item.source}:${item.concept.toLowerCase()}`;
            if (existing.has(key)) return false;
            existing.add(key);
            return true;
          })
          .map((item) => ({
            id: uuid(),
            ...item,
          }));

        return [...nextItems, ...prev].slice(0, 12);
      });
    },
    [],
  );

  // Flashcard added notification state
  const [flashcardAdded, setFlashcardAdded] = useState(false);
  const [lecturePassedToast, setLecturePassedToast] = useState(false);
  const hasShownLecturePassedToastRef = useRef(false);

  // Track if session messages have been loaded
  const [loadingMessages, setLoadingMessages] = useState(true);
  const hasLoadedMessagesRef = useRef(false);

  // Track if we should auto-explain on first load (new session with no messages)
  const shouldAutoExplainRef = useRef(false);
  const hasTriggeredAutoExplainRef = useRef(false);
  const shouldOpenCanvasOnResumeRef = useRef(false);
  const restoredMessageIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    messageIdsRef.current = new Set(messages.map((message) => message.id));
  }, [messages]);

  useEffect(() => {
    setResponseDepthProgress(null);
  }, [sessionId, studyPlanEntryId]);

  useEffect(() => {
    const nextKeys = new Set(insertedVisualBlockKeysRef.current);
    canvasPages.forEach((page) => {
      (page.visualBlocks || []).forEach((block) => {
        nextKeys.add(getVisualBlockInsertKey(page.id, block.messageId, block));
      });
    });
    insertedVisualBlockKeysRef.current = nextKeys;
  }, [canvasPages]);

  useEffect(() => {
    if (!lecture?.studyPlan || lecture.studyPlan.length === 0) return;
    if (lecture.studyPlan.every((entry) => entry.status === "passed")) {
      hasShownLecturePassedToastRef.current = true;
    }
  }, [lecture?.studyPlan]);

  // Title canvas ref for handwritten page titles
  const titleCanvasRef = useRef<HandwritingCanvasHandle>(null);

  const saveNotesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    return () => {
      if (saveNotesDebounceRef.current) {
        clearTimeout(saveNotesDebounceRef.current);
      }
    };
  }, []);

  const canvasRef = useRef<HandwritingCanvasHandle>(null);
  const pageScrollRef = useRef<ScrollView>(null);
  const canvasScrollRef = useRef<ScrollView>(null);
  const canvasHScrollRef = useRef<ScrollView>(null);
  const chatListRef = useRef<FlatList<StudyChatMessage>>(null);

  // Animation values for Check Answer button
  const checkButtonScale = useSharedValue(0);
  const checkButtonOpacity = useSharedValue(0);

  // Callbacks to control scrolling when drawing
  const handleDrawingStart = useCallback(() => {
    setScrollEnabled(false);
    setIsCurrentlyDrawing(true);
    // Hide button when starting to draw
    setHasDrawnAfterQuestion(false);
  }, []);

  const handleDrawingEnd = useCallback(
    (lastPosition?: { x: number; y: number }) => {
      setScrollEnabled(true);
      setIsCurrentlyDrawing(false);

      // Save the last drawing position
      if (lastPosition) {
        setLastDrawingPosition(lastPosition);
        growActivePageNearEdge(lastPosition);
      }

      // Show check button after drawing when there's conversation
      const hasAiMessages = messages.some((m) => m.role === "ai");
      if (hasAiMessages) {
        setHasDrawnAfterQuestion(true);
      }
    },
    [growActivePageNearEdge, messages],
  );

  // Animate check button when drawing ends
  useEffect(() => {
    const hasAiMessages = messages.some((m) => m.role === "ai");
    const shouldShow =
      hasDrawnAfterQuestion &&
      hasAiMessages &&
      !isCurrentlyDrawing &&
      lastDrawingPosition;

    if (shouldShow) {
      checkButtonScale.value = withSpring(1, { damping: 12, stiffness: 200 });
      checkButtonOpacity.value = withTiming(1, { duration: 200 });
    } else {
      checkButtonScale.value = withTiming(0, { duration: 100 });
      checkButtonOpacity.value = withTiming(0, { duration: 100 });
    }
  }, [
    hasDrawnAfterQuestion,
    isCurrentlyDrawing,
    lastDrawingPosition,
    messages,
    checkButtonScale,
    checkButtonOpacity,
  ]);

  // Animated style for check answer button
  const checkButtonAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkButtonScale.value }],
    opacity: checkButtonOpacity.value,
  }));

  const checkButtonPosition = useMemo(() => {
    if (!lastDrawingPosition) return null;

    const canvasWidth = canvasLayout.width || 720;
    const canvasHeight = canvasLayout.height || 680;
    const buttonWidth = 170;
    const buttonHeight = 60;
    const horizontalOffset = 140; // push further to the right of the pen

    const clampedLeft = Math.min(
      Math.max(lastDrawingPosition.x + horizontalOffset, 10),
      Math.max(canvasWidth - buttonWidth, 10),
    );
    const clampedTop = Math.min(
      Math.max(lastDrawingPosition.y + 20, 10),
      Math.max(canvasHeight - buttonHeight, 10),
    );

    return { top: clampedTop, left: clampedLeft };
  }, [canvasLayout.height, canvasLayout.width, lastDrawingPosition]);

  const handleCanvasLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setCanvasLayout({ width, height });
  }, []);

  const getMaxYFromStrokes = useCallback((strokes: CanvasStrokeData[]) => {
    let maxY = 0;
    strokes.forEach((stroke) => {
      stroke.points.forEach((p) => {
        if (p.y > maxY) {
          maxY = p.y;
        }
      });
    });
    return maxY;
  }, []);

  // Get maximum Y position including visual blocks
  const getMaxYWithVisualBlocks = useCallback(
    (strokes: CanvasStrokeData[], visualBlocks: CanvasVisualBlockType[]) => {
      let maxY = getMaxYFromStrokes(strokes);

      // Include visual blocks in the calculation
      visualBlocks.forEach((block) => {
        const blockBottom = block.position.y + (block.size?.height || 200);
        if (blockBottom > maxY) {
          maxY = blockBottom;
        }
      });

      return maxY;
    },
    [getMaxYFromStrokes],
  );

  // Add a visual block to the current canvas page
  const addVisualBlockToCanvas = useCallback(
    (
      partialBlock: Omit<
        CanvasVisualBlockType,
        "position" | "messageId" | "createdAt"
      >,
      messageId: string,
      customBaseY?: number,
      targetPageId = activePageId,
      targetPageOverride?: CanvasPage,
    ) => {
      const targetPage =
        targetPageOverride ??
        canvasPages.find((page) => page.id === targetPageId) ??
        activePage;
      if (!targetPage) return null;

      const targetVisualBlocks = dedupeVisualBlocks(
        targetPage.visualBlocks || [],
      );

      const existingBlock = targetVisualBlocks.find(
        (block) =>
          block.messageId === messageId &&
          getVisualBlockSignature(block) ===
            getVisualBlockSignature(partialBlock),
      );
      if (existingBlock) {
        return {
          id: existingBlock.id,
          bottom: getVisualBlockBottom(existingBlock),
        };
      }

      const insertKey = getVisualBlockInsertKey(
        targetPage.id,
        messageId,
        partialBlock,
      );
      if (insertedVisualBlockKeysRef.current.has(insertKey)) {
        return null;
      }
      insertedVisualBlockKeysRef.current.add(insertKey);

      // Get current strokes directly from canvas ref (more reliable than state)
      const currentStrokes =
        targetPage.id === activePageId
          ? canvasRef.current?.getStrokes() || canvasStrokes
          : targetPage.strokes;

      // Calculate position - place below existing content
      const currentMaxY =
        customBaseY ??
        getMaxYWithVisualBlocks(currentStrokes, targetVisualBlocks);
      const padding = customBaseY !== undefined ? 16 : 60;
      const position = { x: 40, y: currentMaxY + padding };

      // Estimate the size of the visual block
      const estimatedSize = estimateVisualBlockSize(partialBlock);

      // Create the full visual block
      const fullBlock = createCanvasVisualBlock(
        partialBlock,
        position,
        messageId,
      );
      fullBlock.size = estimatedSize;

      // Update canvas pages with the new visual block
      setCanvasPages((prev) => {
        const updatedPages = prev.map((page) => {
          if (page.id !== targetPage.id) return page;

          const existingBlocks = page.visualBlocks || [];
          if (
            existingBlocks.some(
              (block) =>
                block.messageId === messageId &&
                getVisualBlockSignature(block) ===
                  getVisualBlockSignature(fullBlock),
            )
          ) {
            return page;
          }

          const newBlocks = dedupeVisualBlocks([...existingBlocks, fullBlock]);

          // Grow canvas if needed to fit the new block
          const requiredHeight = position.y + estimatedSize.height + padding;
          const requiredWidth = position.x + estimatedSize.width + padding;
          const newHeight = Math.max(page.height, requiredHeight);
          const newWidth = Math.max(page.width, requiredWidth);

          return {
            ...page,
            visualBlocks: newBlocks,
            height: newHeight,
            width: newWidth,
          };
        });

        // Save to database IMMEDIATELY for visual blocks (they're important and infrequent)
        if (sessionId) {
          // Clear any pending debounced save to avoid conflicts
          if (saveCanvasDebounceRef.current) {
            clearTimeout(saveCanvasDebounceRef.current);
            saveCanvasDebounceRef.current = null;
          }
          // Save immediately
          updateSession(sessionId, { canvasPages: updatedPages }).catch((err) =>
            console.warn(
              "[study] Failed to save canvas pages with visual block:",
              err,
            ),
          );
        }

        return updatedPages;
      });

      // Scroll canvas to show the new visual block
      setTimeout(() => {
        const scrollY = Math.max(position.y - 24, 0);
        canvasScrollRef.current?.scrollTo({ y: scrollY, animated: true });
        canvasHScrollRef.current?.scrollTo({ x: 0, animated: true });
      }, 150);

      console.log(
        "[study] Added visual block to canvas:",
        fullBlock.type,
        fullBlock.id,
      );

      return { id: fullBlock.id, bottom: position.y + estimatedSize.height };
    },
    [
      activePage,
      activePageId,
      canvasStrokes,
      canvasPages,
      getMaxYWithVisualBlocks,
      sessionId,
      saveCanvasDebounceRef,
      setCanvasPages,
    ],
  );

  // Calculate bounds for a set of strokes
  const computeBounds = useCallback(
    (strokes: CanvasStrokeData[], padding = 16): CanvasBounds | null => {
      let minX = Number.POSITIVE_INFINITY;
      let minY = Number.POSITIVE_INFINITY;
      let maxX = Number.NEGATIVE_INFINITY;
      let maxY = Number.NEGATIVE_INFINITY;

      strokes.forEach((stroke) => {
        stroke.points.forEach((p) => {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        });
      });

      if (
        !Number.isFinite(minX) ||
        !Number.isFinite(minY) ||
        !Number.isFinite(maxX) ||
        !Number.isFinite(maxY)
      ) {
        return null;
      }

      const paddedX = Math.max(minX - padding, 0);
      const paddedY = Math.max(minY - padding, 0);
      const width = Math.min(
        maxX - minX + padding * 2,
        canvasSize.width - paddedX,
      );
      const height = Math.min(
        maxY - minY + padding * 2,
        canvasSize.height - paddedY,
      );

      return { x: paddedX, y: paddedY, width, height };
    },
    [canvasSize.width, canvasSize.height],
  );

  const getNewStrokeBounds = useCallback((): CanvasBounds | null => {
    const newStrokes = canvasStrokes.slice(canvasBaselineRef.current);
    const boundsFromNew = computeBounds(newStrokes);
    if (boundsFromNew) return boundsFromNew;

    if (lastDrawingPosition) {
      const size = 180;
      const x = Math.max(lastDrawingPosition.x - size / 2, 0);
      const y = Math.max(lastDrawingPosition.y - size / 2, 0);
      return { x, y, width: size, height: size };
    }

    return computeBounds(canvasStrokes);
  }, [canvasStrokes, computeBounds, lastDrawingPosition]);

  const getQuestionTextForMessage = useCallback(
    (message: StudyChatMessage): string | null => {
      if (message.tutorQuestion?.question) {
        return message.tutorQuestion.question.trim();
      }

      if (message.questionId) {
        const matched = questions.find((q) => q.id === message.questionId);
        if (matched?.prompt) {
          return matched.prompt.trim();
        }
      }

      const cleaned = message.text.replace(/_[^_]+_$/g, "").trim();
      const lineQuestions = cleaned
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.endsWith("?"));

      if (lineQuestions.length > 0) {
        return lineQuestions[lineQuestions.length - 1];
      }

      const match = cleaned.match(/([^?]+?\?)(?!.*\?)/s);
      return match ? match[1].trim() : null;
    },
    [questions],
  );

  const createStageAnswerPageWithQuestion = useCallback(
    (stageKind: CanvasStageKind, stageId: string, questionText: string) => {
      const stage: CanvasStageInfo = {
        stageKind,
        stageId,
        stageLabel: STAGE_LABELS[stageKind],
      };
      const page = createNewPage(stage, 1);
      const padding = 32;
      const baseY = 40;
      const availableWidth = Math.max(page.width - padding * 2, 220);
      const questionNumber = canvasQuestionCounterRef.current + 1;
      canvasQuestionCounterRef.current = questionNumber;
      const {
        strokes: generatedStrokes,
        width: textWidth,
        height: textHeight,
      } = textToStrokes(`Q${questionNumber}: ${questionText}`, padding, baseY, {
        color: canvasColor,
        strokeWidth: 2,
        charWidth: 12,
        charSpacing: 3,
        wordSpacing: 8,
        lineHeight: 12,
        maxWidth: availableWidth,
        jitter: 1,
      });
      const pageWithQuestion: CanvasPage = {
        ...page,
        strokes: generatedStrokes,
        height: Math.max(page.height, baseY + textHeight + 60),
        width: Math.max(page.width, padding + textWidth + 60),
      };

      setCanvasPages((prev) => {
        const updatedPages = [...prev, pageWithQuestion];
        saveCanvasPagesNow(updatedPages);
        return updatedPages;
      });
      activatePage(pageWithQuestion, stage);
      resetCanvasInteractionState();

      setTimeout(() => {
        pageScrollRef.current?.scrollTo({ y: 0, animated: true });
        canvasScrollRef.current?.scrollTo({ y: 0, animated: true });
        canvasHScrollRef.current?.scrollTo({ x: 0, animated: true });
      }, 150);

      return pageWithQuestion.id;
    },
    [
      activatePage,
      canvasColor,
      createNewPage,
      resetCanvasInteractionState,
      saveCanvasPagesNow,
      setCanvasPages,
    ],
  );

  // Load existing session data (messages, canvas, notes) from database
  useEffect(() => {
    if (
      !currentSessionId ||
      hasLoadedMessagesRef.current ||
      studyQueries.sessionQuery.isLoading ||
      studyQueries.messagesQuery.isLoading
    ) {
      return;
    }

    hasLoadedMessagesRef.current = true;
    setLoadingMessages(true);

    try {
      const session = studyQueries.sessionQuery.data ?? null;
      if (session) {
        if (sessionHasInProgressCanvasWork(session)) {
          shouldOpenCanvasOnResumeRef.current = true;
          shouldAutoExplainRef.current = false;
          setMemorizationSecondsRemaining(null);
          setTutorCollapsed(true);
          setStudyPhase("answer");
        }

        if (session.canvasPages && session.canvasPages.length > 0) {
          const normalized = normalizeCanvasPageVisualBlocks(
            session.canvasPages,
          );
          restoreCanvasPages(normalized.pages);
          if (normalized.changed) {
            updateSession(currentSessionId, {
              canvasPages: normalized.pages,
            }).catch((err) =>
              console.warn(
                "[study] Failed to save deduped visual blocks:",
                err,
              ),
            );
          }
          console.log(
            "[study] Restored",
            normalized.pages.length,
            "canvas pages",
          );
        } else if (session.canvasData && session.canvasData.length > 0) {
          const migratedPage: CanvasPage = {
            id: "page-1",
            titleStrokes: [],
            strokes: session.canvasData,
            width: canvasSize.width,
            height: canvasSize.height,
          };
          restoreCanvasPages([migratedPage]);
          console.log(
            "[study] Migrated canvas with",
            session.canvasData.length,
            "strokes to page format",
          );
        } else {
          setInitialBlankPage();
        }

        if (session.notesText) {
          setAnswerText(session.notesText);
          console.log("[study] Restored notes text");
        }
      } else {
        setInitialBlankPage();
      }

      const savedMessages = studyQueries.messagesQuery.data ?? [];

      if (savedMessages.length > 0) {
        setMessages(savedMessages);
        messageIdsRef.current = new Set(
          savedMessages.map((message) => message.id),
        );
        restoredMessageIdsRef.current = new Set(
          savedMessages.map((message) => message.id),
        );

        const history: ChatMessage[] = savedMessages
          .filter((m) => m.role !== "system")
          .map((m) => ({
            role: m.role === "ai" ? "assistant" : "user",
            content: m.text,
          }));
        setChatHistory(history);
        const restoredGuidedAudioReplay = [...savedMessages]
          .reverse()
          .map((message) => buildGuidedAudioReplayFromMessage(message))
          .find((replay): replay is GuidedAudioReplay => Boolean(replay));
        if (restoredGuidedAudioReplay) {
          setGuidedAudioReplay(restoredGuidedAudioReplay);
        }

        console.log(
          "[study] Restored session with",
          savedMessages.length,
          "messages",
        );
      }
    } catch (err) {
      console.warn("[study] Failed to restore session data:", err);
    } finally {
      setLoadingMessages(false);
    }
  }, [
    currentSessionId,
    studyQueries.messagesQuery.data,
    studyQueries.messagesQuery.isLoading,
    studyQueries.sessionQuery.data,
    studyQueries.sessionQuery.isLoading,
    canvasSize.height,
    canvasSize.width,
    restoreCanvasPages,
    setInitialBlankPage,
  ]);

  // Mark that we should auto-explain when starting a new session (no saved messages)
  useEffect(() => {
    if (
      studyTitle &&
      messages.length === 0 &&
      !loadingEntry &&
      !loadingMessages &&
      !hasTriggeredAutoExplainRef.current &&
      !shouldOpenCanvasOnResumeRef.current
    ) {
      // Flag that we need to auto-explain once sendToFeynmanAI is ready
      shouldAutoExplainRef.current = true;
    }
  }, [studyTitle, messages.length, loadingEntry, loadingMessages]);

  useEffect(() => {
    setAnswerLinks(studyQueries.answerLinksQuery.data ?? []);
  }, [studyQueries.answerLinksQuery.data]);

  useEffect(() => {
    const rows = studyQueries.misconceptionsQuery.data ?? [];
    setRecentMisconceptions(
      rows.map((row) => `${row.concept}: ${row.note}`).filter(Boolean),
    );
    setMistakeNotebook(
      rows.map((row) => ({
        id: row.id ?? uuid(),
        concept: row.concept,
        note: row.note,
        source: "recall" as const,
      })),
    );
  }, [studyQueries.misconceptionsQuery.data]);

  // Rebuild answer markers whenever messages or links change
  useEffect(() => {
    if (!messages || messages.length === 0) {
      setAnswerMarkers([]);
      questionIndexCounterRef.current = 0;
      return;
    }

    let qIndex = 0;
    const markers: CanvasAnswerMarker[] = [];

    for (const msg of messages) {
      if (msg.answerLinkId) {
        const link = answerLinks.find((l) => l.id === msg.answerLinkId);
        const questionId = msg.questionId || link?.questionId;
        if (!questionId) continue;
        qIndex += 1;
        markers.push({
          questionId,
          questionIndex: qIndex,
          messageId: msg.id,
          answerLinkId: msg.answerLinkId,
          pageId: link?.pageId,
          canvasBounds: link?.canvasBounds,
        });
      }
    }

    questionIndexCounterRef.current = qIndex;
    setAnswerMarkers(markers);
  }, [messages, answerLinks]);

  useEffect(() => {
    if (questions.length > 0) {
      setCurrentQuestion(questions[0]);
    }
  }, [questions]);

  // Seed existing AI messages to avoid rewriting old questions into the canvas
  useEffect(() => {
    if (loadingMessages || hasSeededQuestionWritesRef.current) return;
    if (messages.length > 0) {
      const aiIds = messages.filter((m) => m.role === "ai").map((m) => m.id);
      writtenQuestionIdsRef.current = new Set(aiIds);
    }
    hasSeededQuestionWritesRef.current = true;
  }, [loadingMessages, messages]);

  // When the AI asks a question, write it on the canvas as a handwritten note
  useEffect(() => {
    if (loadingMessages) return;

    messages.forEach((msg) => {
      if (msg.role !== "ai") return;
      if (streamingAiMessageIdsRef.current.has(msg.id)) return;
      if (writtenQuestionIdsRef.current.has(msg.id)) return;
      if (shouldUseListeningNotesFlow(msg.tutorQuestion)) return;

      const questionText = getQuestionTextForMessage(msg);
      if (!questionText) return;

      const trimmed = questionText.trim();
      const isLikelyQuestion = trimmed.endsWith("?") || Boolean(msg.questionId);
      if (!isLikelyQuestion) return;

      writtenQuestionIdsRef.current.add(msg.id);
      const stageKind =
        msg.tutorQuestion?.assessmentKind === "final_quiz"
          ? "final_quiz"
          : "recall";
      const existingStagePage = canvasPages.find(
        (page) => page.stageKind === stageKind && page.stageId === msg.id,
      );
      if (existingStagePage) {
        activatePage(existingStagePage);
      } else {
        createStageAnswerPageWithQuestion(stageKind, msg.id, trimmed);
      }
    });
  }, [
    canvasPages,
    activatePage,
    createStageAnswerPageWithQuestion,
    messages,
    loadingMessages,
    getQuestionTextForMessage,
    getStageInfoForPage,
  ]);

  // Handle canvas mode change
  const handleCanvasModeChange = useCallback((mode: CanvasMode) => {
    setCanvasMode(mode);
    canvasRef.current?.setMode(mode);
  }, []);

  // Handle canvas color change
  const handleCanvasColorChange = useCallback((color: string) => {
    setCanvasColor(color);
    canvasRef.current?.setColor(color);
  }, []);

  // Handle clear canvas (clears current page only)
  const handleClearCanvas = useCallback(() => {
    canvasRef.current?.clear();
    clearActivePageStrokes();
    canvasBaselineRef.current = 0;
    hasInitializedCanvasRef.current = true;
  }, [clearActivePageStrokes]);

  // Save canvas strokes to database (debounced) - per-page
  const handleCanvasStrokesChange = useCallback(
    (strokes: CanvasStroke[]) => {
      updateActivePageStrokes(strokes as CanvasStrokeData[]);

      if (!hasInitializedCanvasRef.current) {
        canvasBaselineRef.current = strokes.length;
        hasInitializedCanvasRef.current = true;
      }
    },
    [updateActivePageStrokes],
  );

  // Save notes text to database (debounced)
  const handleNotesChange = useCallback(
    (text: string) => {
      setAnswerText(text);

      if (!sessionId) return;

      // Clear any pending save
      if (saveNotesDebounceRef.current) {
        clearTimeout(saveNotesDebounceRef.current);
      }

      // Debounce save
      saveNotesDebounceRef.current = setTimeout(async () => {
        try {
          await updateSession(sessionId, { notesText: text });
          console.log("[study] Notes saved");
        } catch (err) {
          console.warn("[study] Failed to save notes:", err);
        }
      }, 1000);
    },
    [sessionId],
  );

  // Handle undo
  const handleUndo = useCallback(() => {
    canvasRef.current?.undo();
  }, []);

  // Handle title strokes change (for handwritten page titles)
  const handleTitleStrokesChange = useCallback(
    (strokes: CanvasStroke[]) => {
      updateActivePageTitleStrokes(strokes as CanvasStrokeData[]);
    },
    [updateActivePageTitleStrokes],
  );

  // Initialize TTS player
  useEffect(() => {
    const handleStateChange = (state: TTSPlayerState) => {
      const speaking = state.isPlaying || state.isLoading;
      setIsSpeaking(speaking);
      if (speaking && pendingTtsMessageIdRef.current) {
        setActiveTtsMessageId(pendingTtsMessageIdRef.current);
        pendingTtsMessageIdRef.current = null;
        return;
      }
      if (!speaking && !pendingTtsMessageIdRef.current) {
        setActiveTtsMessageId(null);
      }
    };

    const player = new StreamingTTSPlayer({
      onStateChange: handleStateChange,
      onPlaybackEnd: () => {
        finishGuidedNotesStageRef.current();
        // If listening mode is on, auto-rearm voice input after TTS completes
        // This is handled by the voice-input component
      },
    });
    player.setLanguage(agentLanguage);
    ttsPlayerRef.current = player;

    return () => {
      player.stop();
    };
  }, [agentLanguage]);

  // Update TTS player language when it changes
  useEffect(() => {
    ttsPlayerRef.current?.setLanguage(agentLanguage);
  }, [agentLanguage]);

  // Text-to-Speech for AI responses
  const speakMessage = useCallback(
    async (text: string, messageId?: string) => {
      if (!ttsEnabled) return;
      if (messageId) {
        pendingTtsMessageIdRef.current = messageId;
      }
      await ttsPlayerRef.current?.speak(text);
    },
    [ttsEnabled],
  );

  // Stop speech
  const stopSpeaking = useCallback(async () => {
    await ttsPlayerRef.current?.stop();
    setIsSpeaking(false);
    setActiveTtsMessageId(null);
    pendingTtsMessageIdRef.current = null;
  }, []);

  const stopGuidedAudioAndRevealAnswer = useCallback(async () => {
    await stopSpeaking();
    finishGuidedNotesStageRef.current();
  }, [stopSpeaking]);

  const replayGuidedAudio = useCallback(async () => {
    if (!guidedAudioReplay?.text) return;
    if (!ttsEnabled) {
      setTtsEnabled(true);
    }
    pendingTtsMessageIdRef.current = guidedAudioReplay.messageId;
    await ttsPlayerRef.current?.speak(guidedAudioReplay.text);
  }, [guidedAudioReplay, ttsEnabled]);

  const beginListeningNotesStage = useCallback(
    ({
      messageId,
      questionText,
      tutorQuestion,
      tutorText,
    }: {
      messageId: string;
      questionText: string;
      tutorQuestion: NonNullable<StudyChatMessage["tutorQuestion"]>;
      tutorText: string;
    }) => {
      const listeningQuestion = buildListeningNotesQuestion(tutorQuestion);
      const guidedQuestion = {
        messageId,
        questionText,
        tutorQuestion: listeningQuestion,
      };
      const audioText = getListeningNotesAudioText(tutorText, questionText);

      setGuidedAudioReplay({
        messageId,
        text: audioText,
      });
      guidedQuestionReadyRef.current = false;
      pendingGuidedQuestionRef.current = guidedQuestion;
      setPendingGuidedQuestion(guidedQuestion);
      setMemorizationMessageId(messageId);
      setMemorizationSecondsRemaining(null);
      setTutorCollapsed(true);
      setStudyPhase("guided_notes");
      writtenQuestionIdsRef.current.add(messageId);
      const page = ensureCanvasStagePage("guided_notes", messageId);
      pageScrollRef.current?.scrollTo({ y: 0, animated: true });

      return { audioText, page, pageId: page.id };
    },
    [ensureCanvasStagePage],
  );

  const finishGuidedNotesStage = useCallback(() => {
    const guidedQuestion =
      pendingGuidedQuestionRef.current ?? pendingGuidedQuestion;
    if (!guidedQuestion || guidedQuestionReadyRef.current) return;

    guidedQuestionReadyRef.current = true;
    const questionId = guidedQuestion.messageId;
    createStageAnswerPageWithQuestion(
      "answer",
      questionId,
      guidedQuestion.questionText,
    );
    writtenQuestionIdsRef.current.add(questionId);
    setCurrentQuestion({
      id: questionId,
      prompt: guidedQuestion.questionText,
      targetConcepts: guidedQuestion.tutorQuestion.targetConcepts,
      expectedAnswerPoints: guidedQuestion.tutorQuestion.expectedAnswerPoints,
      checkType:
        guidedQuestion.tutorQuestion.checkType ||
        nextDepthCheckType ||
        "recall",
      requiredForPass: guidedQuestion.tutorQuestion.requiredForPass ?? true,
      difficulty: guidedQuestion.tutorQuestion.difficulty || "basic",
      assessmentKind: guidedQuestion.tutorQuestion.assessmentKind || "depth",
    });
    pendingGuidedQuestionRef.current = null;
    setPendingGuidedQuestion(null);
    setMemorizationMessageId(questionId);
    setMemorizationSecondsRemaining(null);
    setTutorCollapsed(true);
    setStudyPhase("answer");
  }, [
    createStageAnswerPageWithQuestion,
    nextDepthCheckType,
    pendingGuidedQuestion,
  ]);

  useEffect(() => {
    pendingGuidedQuestionRef.current = pendingGuidedQuestion;
    finishGuidedNotesStageRef.current = finishGuidedNotesStage;
  }, [finishGuidedNotesStage, pendingGuidedQuestion]);

  const pushMessage = useCallback(
    (message: StudyChatMessage, speak = true) => {
      const alreadyExists = messageIdsRef.current.has(message.id);
      messageIdsRef.current.add(message.id);

      setMessages((prev) => {
        if (!prev.some((item) => item.id === message.id)) {
          return [...prev, message];
        }

        return prev.map((item) =>
          item.id === message.id ? { ...item, ...message } : item,
        );
      });

      if (!alreadyExists && speak && message.role === "ai") {
        speakMessage(message.text, message.id);
      }
      // Scroll to bottom
      setTimeout(() => {
        chatListRef.current?.scrollToEnd({ animated: true });
      }, 100);

      // Save message to database for persistence
      if (sessionId) {
        saveSessionMessage(sessionId, message).catch((err) => {
          console.warn("[study] Failed to save message:", err);
        });
      }
    },
    [speakMessage, sessionId],
  );

  // Update an existing message in the messages array (for streaming updates)
  const updateMessage = useCallback(
    (messageId: string, updates: Partial<StudyChatMessage>) => {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId ? { ...msg, ...updates } : msg,
        ),
      );
    },
    [],
  );

  const answeredQuestionIds = useMemo(
    () =>
      new Set(
        messages
          .filter((message) => message.role === "user" && message.questionId)
          .map((message) => message.questionId as string),
      ),
    [messages],
  );

  const latestUnansweredTutorQuestionMessage = useMemo(() => {
    return [...messages].reverse().find((message) => {
      if (message.role !== "ai" || !message.tutorQuestion?.question) {
        return false;
      }
      const questionKey = message.questionId ?? message.id;
      return !answeredQuestionIds.has(questionKey);
    });
  }, [answeredQuestionIds, messages]);

  const latestDiagnosticQuestionMessage = useMemo(() => {
    if (
      latestUnansweredTutorQuestionMessage?.tutorQuestion?.assessmentKind !==
      "diagnostic"
    ) {
      return null;
    }

    return latestUnansweredTutorQuestionMessage;
  }, [latestUnansweredTutorQuestionMessage]);

  useEffect(() => {
    if (
      loadingMessages ||
      loadingEntry ||
      isChatting ||
      grading ||
      !latestUnansweredTutorQuestionMessage ||
      latestUnansweredTutorQuestionMessage.id === memorizationMessageId
    ) {
      return;
    }

    if (
      latestUnansweredTutorQuestionMessage.tutorQuestion?.assessmentKind ===
      "diagnostic"
    ) {
      setMemorizationMessageId(latestUnansweredTutorQuestionMessage.id);
      setRecallHintRevealed(false);
      setMemorizationSecondsRemaining(null);
      setTutorCollapsed(false);
      setStudyPhase("diagnostic");
      return;
    }

    if (
      latestUnansweredTutorQuestionMessage.tutorQuestion?.assessmentKind ===
      "guided_notes"
    ) {
      const replay = buildGuidedAudioReplayFromMessage(
        latestUnansweredTutorQuestionMessage,
      );
      if (replay) {
        setGuidedAudioReplay(replay);
      }
      const questionText = getQuestionTextForMessage(
        latestUnansweredTutorQuestionMessage,
      );
      if (questionText) {
        const existingAnswerPage = canvasPages.find(
          (page) =>
            page.stageKind === "answer" &&
            page.stageId === latestUnansweredTutorQuestionMessage.id,
        );
        if (existingAnswerPage) {
          activatePage(existingAnswerPage);
        } else {
          createStageAnswerPageWithQuestion(
            "answer",
            latestUnansweredTutorQuestionMessage.id,
            questionText,
          );
        }
        writtenQuestionIdsRef.current.add(
          latestUnansweredTutorQuestionMessage.id,
        );
      }
      setMemorizationMessageId(latestUnansweredTutorQuestionMessage.id);
      setRecallHintRevealed(false);
      setMemorizationSecondsRemaining(null);
      setTutorCollapsed(true);
      setStudyPhase("answer");
      return;
    }

    const questionText = getQuestionTextForMessage(
      latestUnansweredTutorQuestionMessage,
    );
    const resumeDirectlyToAnswer =
      shouldOpenCanvasOnResumeRef.current ||
      restoredMessageIdsRef.current.has(
        latestUnansweredTutorQuestionMessage.id,
      );
    const restoredReplay = buildGuidedAudioReplayFromMessage(
      latestUnansweredTutorQuestionMessage,
    );
    if (restoredReplay && resumeDirectlyToAnswer) {
      setGuidedAudioReplay(restoredReplay);
    }
    if (
      questionText &&
      (resumeDirectlyToAnswer ||
        !writtenQuestionIdsRef.current.has(
          latestUnansweredTutorQuestionMessage.id,
        ))
    ) {
      writtenQuestionIdsRef.current.add(
        latestUnansweredTutorQuestionMessage.id,
      );
      const stageKind =
        resumeDirectlyToAnswer &&
        shouldUseListeningNotesFlow(
          latestUnansweredTutorQuestionMessage.tutorQuestion,
        )
          ? "answer"
          : latestUnansweredTutorQuestionMessage.tutorQuestion
                ?.assessmentKind === "final_quiz"
            ? "final_quiz"
            : "recall";
      const existingStagePage = canvasPages.find(
        (page) =>
          page.stageKind === stageKind &&
          page.stageId === latestUnansweredTutorQuestionMessage.id,
      );
      if (existingStagePage) {
        activatePage(existingStagePage);
      } else {
        createStageAnswerPageWithQuestion(
          stageKind,
          latestUnansweredTutorQuestionMessage.id,
          questionText,
        );
      }
    }

    setMemorizationMessageId(latestUnansweredTutorQuestionMessage.id);
    setRecallHintRevealed(false);
    if (resumeDirectlyToAnswer) {
      shouldOpenCanvasOnResumeRef.current = false;
      setMemorizationSecondsRemaining(null);
      setTutorCollapsed(true);
      setStudyPhase("answer");
      return;
    }

    setTutorCollapsed(false);
    setMemorizationSecondsRemaining(MEMORIZATION_SECONDS);
    setStudyPhase(
      latestUnansweredTutorQuestionMessage.tutorQuestion?.assessmentKind ===
        "final_quiz"
        ? "final_quiz"
        : "memorize",
    );
  }, [
    getQuestionTextForMessage,
    activatePage,
    canvasPages,
    createStageAnswerPageWithQuestion,
    grading,
    getStageInfoForPage,
    isChatting,
    latestUnansweredTutorQuestionMessage,
    loadingEntry,
    loadingMessages,
    memorizationMessageId,
  ]);

  useEffect(() => {
    if (
      memorizationSecondsRemaining === null ||
      studyPhase === "answer" ||
      studyPhase === "grading"
    ) {
      return;
    }

    if (memorizationSecondsRemaining <= 0) {
      setMemorizationSecondsRemaining(null);
      setTutorCollapsed(true);
      setStudyPhase("answer");
      stopSpeaking().catch((err) =>
        console.warn("[study] Failed to stop tutor audio before recall:", err),
      );
      pageScrollRef.current?.scrollTo({ y: 0, animated: true });
      return;
    }

    const timer = setTimeout(() => {
      setMemorizationSecondsRemaining((current) =>
        current === null ? null : Math.max(0, current - 1),
      );
    }, 1000);

    return () => clearTimeout(timer);
  }, [memorizationSecondsRemaining, stopSpeaking, studyPhase]);

  const buildRetrievalQuery = useCallback(
    (query: string) => {
      const focusParts = [
        lecture?.title,
        studyPlanEntry?.title,
        studyPlanEntry?.description,
        studyPlanEntry?.keyConcepts?.join(", "),
        query,
      ].filter(Boolean);

      return focusParts.join("\n");
    },
    [lecture?.title, studyPlanEntry],
  );

  const fetchRelevantChunks = useCallback(
    async (query: string, matchCount = 6): Promise<LectureFileChunk[]> => {
      if (!lectureId || !lecture) return [];

      try {
        const chunkCount = await countLectureChunks(lectureId);
        if ((chunkCount ?? 0) <= 0) return [];

        const queryEmbedding = await embedQuery(buildRetrievalQuery(query));
        const chunks = await searchLectureChunks(
          queryEmbedding,
          [lectureId],
          Math.max(matchCount * 3, 18),
          0.15,
        ).then((matches) =>
          matches.map((chunk) => ({
            ...chunk,
            sourceType:
              citationFileMetadata.get(chunk.lectureFileId)?.sourceType ??
              "lecture",
          })),
        );
        if (chunks.length > 0) {
          console.log("[study] retrieval matches", {
            matches: chunks.length,
            topSimilarity: chunks[0]?.similarity,
            lectureMatches: chunks.filter(
              (chunk) => chunk.sourceType === "lecture",
            ).length,
            supportingMatches: chunks.filter(
              (chunk) =>
                chunk.sourceType === "exercise" ||
                chunk.sourceType === "past_exam",
            ).length,
          });
        }
        return balanceCitationChunks(chunks, matchCount);
      } catch (err) {
        console.warn(
          "[study] retrieval failed, falling back to full context",
          err,
        );
        return [];
      }
    },
    [buildRetrievalQuery, citationFileMetadata, lecture, lectureId],
  );

  const chunksToCitationSourceChunks = useCallback(
    (chunks: LectureFileChunk[]): CitationSourceChunk[] =>
      chunks.map((chunk, index) => ({
        ...chunk,
        sourceId: `S${index + 1}`,
      })),
    [],
  );

  const chunksToContextBlock = useCallback(
    (chunks: CitationSourceChunk[] | LectureFileChunk[]) =>
      `Use the following source snippets. Prefer lecture material for explanations, and use exercises or past exams as supporting high-yield examples. Cite only snippets that directly support the answer and keep answers concise.\n\nWhen your answer uses one or more snippets, include a hidden source citation block at the end of the response using exactly this format:\n\`\`\`source_citations\n{"sourceIds":["S1"]}\n\`\`\`\nUse only source IDs listed below. If none of the snippets directly support the answer, use {"sourceIds":[]}.\n\n${chunks
        .map((chunk, idx) => {
          const sourceId = "sourceId" in chunk ? chunk.sourceId : `S${idx + 1}`;
          const source = citationFileMetadata.get(chunk.lectureFileId);
          const sourceName = source?.name ?? "Source";
          const sourceType =
            source?.sourceType ?? chunk.sourceType ?? "lecture";
          const lineRange = chunk.startLine
            ? chunk.endLine && chunk.endLine !== chunk.startLine
              ? `, lines ${chunk.startLine}-${chunk.endLine}`
              : `, line ${chunk.startLine}`
            : "";
          return `[${sourceId}] ${sourceType.replace("_", " ")}: ${sourceName} (p${chunk.pageNumber}${lineRange})\n${chunk.content}`;
        })
        .join("\n\n")}`,
    [citationFileMetadata],
  );

  const selectCitedChunks = useCallback(
    (chunks: CitationSourceChunk[], sourceIds: string[]) => {
      if (sourceIds.length === 0) return [];
      const requestedIds = new Set(sourceIds.map((id) => id.toUpperCase()));
      return chunks.filter((chunk) => requestedIds.has(chunk.sourceId));
    },
    [],
  );

  const citedChunksToCitations = useCallback(
    (chunks: CitationSourceChunk[]): StudyCitation[] =>
      chunks.map((chunk) => ({
        chunkId: chunk.id,
        lectureId: chunk.lectureId,
        lectureFileId: chunk.lectureFileId,
        pageNumber: chunk.pageNumber,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        snippet: buildCitationSnippet(chunk.content),
        similarity: chunk.similarity,
        sourceType:
          chunk.sourceType ??
          citationFileMetadata.get(chunk.lectureFileId)?.sourceType ??
          "lecture",
      })),
    [citationFileMetadata],
  );

  // Send message to Feynman AI with FULL material context (streaming enabled)
  const sendToFeynmanAI = useCallback(
    async (
      userMessage: string,
      transcriptionCostUsd?: number,
      retrievalQuery?: string,
      options: FeynmanSendOptions = {},
    ) => {
      if (!userMessage.trim()) return;

      // Add transcription cost suffix if provided (from voice input)
      const transcriptionCostSuffix = transcriptionCostUsd
        ? ` _${t("cost.label", { value: transcriptionCostUsd.toFixed(4) })}_`
        : "";
      const visibleUserText = options.displayText ?? userMessage;

      const userMsgId = uuid();
      pushMessage(
        {
          id: userMsgId,
          role: "user",
          text: visibleUserText + transcriptionCostSuffix,
          questionId: options.questionId,
        },
        false,
      );

      // Update chat history for context
      const newUserMessage: ChatMessage = {
        role: "user",
        content: userMessage,
      };
      const updatedHistory = [...chatHistory, newUserMessage];
      setChatHistory(updatedHistory);

      setIsChatting(true);

      // Create a placeholder AI message immediately for streaming
      const aiMsgId = uuid();
      streamingAiMessageIdsRef.current.add(aiMsgId);
      pushMessage({ id: aiMsgId, role: "ai", text: "" }, false);
      let tutorModelInfo: Pick<
        StudyChatMessage,
        "aiModel" | "aiPlatform" | "reasoning"
      > = {};

      try {
        try {
          const aiSettings = await getAISettings();
          const tutorConfig = aiSettings.modelConfig.tutor_chat;
          if (tutorConfig?.model) {
            tutorModelInfo = {
              aiModel: tutorConfig.model,
              aiPlatform: tutorConfig.platform,
              reasoning: {
                effort: tutorConfig.reasoningEffort ?? null,
              },
            };
            updateMessage(aiMsgId, tutorModelInfo);
          }
        } catch (error) {
          console.warn("[study] Failed to load tutor model metadata:", error);
        }

        const retrievedChunks = await fetchRelevantChunks(
          retrievalQuery ?? userMessage,
          6,
        );
        const citationSourceChunks =
          chunksToCitationSourceChunks(retrievedChunks);

        const contextBlock =
          citationSourceChunks.length > 0
            ? chunksToContextBlock(citationSourceChunks)
            : fullMaterialContext;

        // Use streaming chat - update message as chunks arrive
        const chatResult = await streamFeynmanChat(
          updatedHistory,
          contextBlock,
          agentLanguage,
          lectureId,
          {
            onChunk: (partialText) => {
              const learningParsed = parseLearningResponse(partialText);
              const parsedDepthProgress = findDepthProgressInText(
                learningParsed.text,
              );
              if (parsedDepthProgress) {
                setResponseDepthProgress(parsedDepthProgress);
              }
              const sourceCitationParsed = parseSourceCitations(
                learningParsed.text,
              );
              const parsed = parseAIResponse(sourceCitationParsed.text);
              const visibleTutorText = stripDepthProgressFromText(
                collapseRepeatedTutorText(parsed.text),
              );
              // Update the AI message with the partial text
              updateMessage(aiMsgId, {
                text: visibleTutorText,
                reasoning: {
                  ...tutorModelInfo.reasoning,
                  completionTokens: estimateTokenCount(visibleTutorText),
                },
              });
            },
            onDone: (result) => {
              if (completedAiMessageIdsRef.current.has(aiMsgId)) {
                return;
              }
              completedAiMessageIdsRef.current.add(aiMsgId);

              const learningParsed = parseLearningResponse(result.message);
              const parsedDepthProgress = findDepthProgressInText(
                learningParsed.text,
              );
              if (parsedDepthProgress) {
                setResponseDepthProgress(parsedDepthProgress);
              }
              const sourceCitationParsed = parseSourceCitations(
                learningParsed.text,
              );
              const parsed = parseAIResponse(sourceCitationParsed.text);
              const visibleTutorText = stripDepthProgressFromText(
                collapseRepeatedTutorText(parsed.text),
              );

              // Add cost footer if available
              const costSuffix = result.costUsd
                ? `\n\n_${t("cost.label", { value: result.costUsd.toFixed(4) })}_`
                : "";

              // Track visual block IDs added for this message
              const visualBlockIds: string[] = [];

              // Determine starting position on canvas
              const currentStrokes =
                canvasRef.current?.getStrokes() || canvasStrokes;
              let currentBatchY =
                getMaxYWithVisualBlocks(currentStrokes, activeVisualBlocks) +
                40;

              // Extract any question from the AI response
              const tempMsg: StudyChatMessage = {
                id: aiMsgId,
                role: "ai",
                text: visibleTutorText,
                ...tutorModelInfo,
                reasoning: {
                  ...tutorModelInfo.reasoning,
                  effort:
                    result.reasoningEffort ??
                    tutorModelInfo.reasoning?.effort ??
                    null,
                  ...result.usage,
                },
                tutorQuestion: learningParsed.tutorQuestion,
              };
              const questionText =
                learningParsed.tutorQuestion?.question ||
                getQuestionTextForMessage(tempMsg);
              const shouldUseListeningNotes =
                Boolean(questionText) &&
                shouldUseListeningNotesFlow(learningParsed.tutorQuestion);
              const tutorQuestionForMessage =
                shouldUseListeningNotes && learningParsed.tutorQuestion
                  ? buildListeningNotesQuestion(learningParsed.tutorQuestion)
                  : learningParsed.tutorQuestion;
              const explanationOnlyText =
                shouldUseListeningNotes && questionText
                  ? getListeningNotesAudioText(visibleTutorText, questionText)
                  : visibleTutorText;
              let listeningNotesPage: CanvasPage | undefined;
              let listeningNotesPageId: string | undefined;

              if (
                shouldUseListeningNotes &&
                questionText &&
                tutorQuestionForMessage
              ) {
                const listeningStage = beginListeningNotesStage({
                  messageId: aiMsgId,
                  questionText,
                  tutorQuestion: tutorQuestionForMessage,
                  tutorText: visibleTutorText,
                });
                listeningNotesPage = listeningStage.page;
                listeningNotesPageId = listeningStage.pageId;
                currentBatchY =
                  getMaxYWithVisualBlocks(
                    listeningNotesPage.strokes,
                    dedupeVisualBlocks(listeningNotesPage.visualBlocks || []),
                  ) + 40;
              } else {
                setGuidedAudioReplay(null);
              }

              // 1. Add visual blocks first, stacked below existing content
              if (parsed.hasVisuals) {
                for (const partialBlock of parsed.visualBlocks) {
                  const result = addVisualBlockToCanvas(
                    partialBlock,
                    aiMsgId,
                    currentBatchY,
                    listeningNotesPageId,
                    listeningNotesPage,
                  );
                  if (result) {
                    visualBlockIds.push(result.id);
                    // Add extra padding between blocks
                    currentBatchY = result.bottom + 12;
                  }
                }
                console.log(
                  "[study] Added",
                  parsed.visualBlocks.length,
                  "visual blocks from AI response",
                );
              }

              // 2. Place the question after the last inserted element
              if (
                questionText &&
                !shouldUseListeningNotes &&
                !writtenQuestionIdsRef.current.has(aiMsgId)
              ) {
                writtenQuestionIdsRef.current.add(aiMsgId);
                const stageKind =
                  tutorQuestionForMessage?.assessmentKind === "final_quiz"
                    ? "final_quiz"
                    : "recall";
                createStageAnswerPageWithQuestion(
                  stageKind,
                  aiMsgId,
                  questionText,
                );
              }

              // Final update with citations, cost, and visual block references
              const citedChunks = selectCitedChunks(
                citationSourceChunks,
                sourceCitationParsed.sourceIds,
              );
              const citations: StudyCitation[] | undefined =
                citedChunks.length > 0
                  ? citedChunksToCitations(citedChunks)
                  : undefined;

              const finalMessage: StudyChatMessage = {
                id: aiMsgId,
                role: "ai",
                text: visibleTutorText + costSuffix, // Use cleaned text without visual blocks
                aiModel: result.model ?? tutorModelInfo.aiModel,
                aiPlatform: result.aiPlatform ?? tutorModelInfo.aiPlatform,
                reasoning: {
                  ...tutorModelInfo.reasoning,
                  effort:
                    result.reasoningEffort ??
                    tutorModelInfo.reasoning?.effort ??
                    null,
                  ...result.usage,
                },
                citations,
                tutorQuestion: tutorQuestionForMessage,
                visualBlockIds:
                  visualBlockIds.length > 0 ? visualBlockIds : undefined,
              };
              updateMessage(aiMsgId, finalMessage);

              // Speak the cleaned message (without visual block JSON)
              speakMessage(explanationOnlyText, aiMsgId).catch((err) => {
                console.warn(
                  "[study] Failed to play listening notes audio:",
                  err,
                );
                if (shouldUseListeningNotes) {
                  finishGuidedNotesStageRef.current();
                }
              });
              if (shouldUseListeningNotes && !ttsEnabled) {
                setTimeout(() => finishGuidedNotesStageRef.current(), 0);
              }

              // Save the final message to database
              if (sessionId) {
                saveSessionMessage(sessionId, finalMessage).catch((err) => {
                  console.warn("[study] Failed to save message:", err);
                });
              }
            },
          },
        );

        // Add AI response to chat history (without cost suffix)
        const historyLearningParsed = parseLearningResponse(chatResult.message);
        const historySourceCitationParsed = parseSourceCitations(
          historyLearningParsed.text,
        );
        const historyParsed = parseAIResponse(historySourceCitationParsed.text);
        const historyText = stripDepthProgressFromText(
          collapseRepeatedTutorText(historyParsed.text),
        );
        setChatHistory((prev) => [
          ...prev,
          {
            role: "assistant",
            content: historyText,
          },
        ]);
      } catch (error) {
        console.warn("Feynman chat error:", error);
        // Update the placeholder message with error
        updateMessage(aiMsgId, { text: t("common.errorGeneric") });
      } finally {
        streamingAiMessageIdsRef.current.delete(aiMsgId);
        setIsChatting(false);
      }
    },
    [
      agentLanguage,
      activeVisualBlocks,
      canvasStrokes,
      chatHistory,
      chunksToCitationSourceChunks,
      chunksToContextBlock,
      citedChunksToCitations,
      fetchRelevantChunks,
      fullMaterialContext,
      getMaxYWithVisualBlocks,
      getQuestionTextForMessage,
      lectureId,
      pushMessage,
      selectCitedChunks,
      updateMessage,
      speakMessage,
      t,
      ttsEnabled,
      sessionId,
      addVisualBlockToCanvas,
      beginListeningNotesStage,
      createStageAnswerPageWithQuestion,
    ],
  );

  // Handle voice transcription
  const handleVoiceTranscription = useCallback(
    (text: string, transcriptionCostUsd?: number) => {
      // Pass transcription cost to sendToFeynmanAI so it can display it with the user message
      sendToFeynmanAI(text, transcriptionCostUsd);
    },
    [sendToFeynmanAI],
  );

  const requestQuestions = async () => {
    setLoadingQuestions(true);
    try {
      // Use full context for generating relevant questions
      const generated = await generateQuestions(
        studyTitle,
        fullMaterialContext,
        3,
        agentLanguage,
      );
      setQuestions(generated);
      setHasDrawnAfterQuestion(false); // Reset drawing detection
      questionIndexCounterRef.current = 0; // Reset question counter

      if (generated[0]) {
        const checkType = nextDepthCheckType ?? "recall";
        pushMessage({
          id: uuid(),
          role: "ai",
          text: t("study.firstQuestionIntro", {
            question: generated[0].prompt,
          }),
          questionId: generated[0].id,
          tutorQuestion: {
            question: generated[0].prompt,
            targetConcepts: studyPlanEntry?.keyConcepts,
            checkType,
            requiredForPass: true,
            difficulty: "basic",
            assessmentKind: "depth",
          },
        });
        setCurrentQuestion({
          ...generated[0],
          checkType,
          requiredForPass: true,
          difficulty: "basic",
          assessmentKind: "depth",
        });
      }
    } catch (error) {
      console.warn(error);
    } finally {
      setLoadingQuestions(false);
    }
  };

  const nextQuestion = () => {
    if (!currentQuestion || questions.length === 0) return;
    const idx = questions.findIndex((q) => q.id === currentQuestion.id);
    const next = questions[(idx + 1) % questions.length];
    const checkType = next.checkType || nextDepthCheckType || "recall";
    setCurrentQuestion({
      ...next,
      checkType,
      requiredForPass: true,
      assessmentKind: next.assessmentKind || "depth",
    });
    setHasDrawnAfterQuestion(false); // Reset drawing detection for new question
    pushMessage({
      id: uuid(),
      role: "ai",
      text: t("study.nextQuestionIntro", { question: next.prompt }),
      questionId: next.id,
      tutorQuestion: {
        question: next.prompt,
        targetConcepts: studyPlanEntry?.keyConcepts,
        checkType,
        requiredForPass: true,
        difficulty: next.difficulty || "basic",
        assessmentKind: "depth",
      },
    });
  };

  const markFinalQuizPassed = useCallback(
    async (averageScore: number) => {
      finalQuizPassedRef.current = true;
      if (!studyPlanEntryId) return;

      try {
        await updateStudyPlanEntryStatus(studyPlanEntryId, {
          status: "passed",
          statusScore: averageScore,
        });
      } catch (err) {
        console.warn(
          "[study] Failed to mark topic passed after final quiz",
          err,
        );
      }

      try {
        const history = await listReviewEvents(studyPlanEntryId, 50);
        const masteryScore = computeMasteryScore({ history });
        const reviewCount = history?.length ?? 0;
        const easeFactor = studyPlanEntry?.easeFactor ?? 2.5;
        const nextReviewAt = computeNextReviewDate({
          masteryScore,
          easeFactor,
          reviewCount,
        });

        await updateStudyPlanEntryMastery(studyPlanEntryId, {
          masteryScore: Math.round(Math.max(masteryScore, averageScore)),
          nextReviewAt,
          reviewCount,
          easeFactor,
          status: "passed",
          statusScore: averageScore,
        });
      } catch (err) {
        console.warn("[study] Failed to update mastery after final quiz", err);
      }

      if (
        !hasShownLecturePassedToastRef.current &&
        lecture?.studyPlan &&
        lecture.studyPlan.length > 0
      ) {
        const updatedPlan = lecture.studyPlan.map((entry) =>
          entry.id === studyPlanEntryId
            ? { ...entry, status: "passed" }
            : entry,
        );
        if (updatedPlan.every((entry) => entry.status === "passed")) {
          hasShownLecturePassedToastRef.current = true;
          setLecturePassedToast(true);
          setTimeout(() => setLecturePassedToast(false), 3500);
        }
      }
    },
    [lecture?.studyPlan, studyPlanEntry?.easeFactor, studyPlanEntryId],
  );

  const pushFinalQuizQuestion = useCallback(
    (question: StudyQuestion, index: number) => {
      pushMessage({
        id: uuid(),
        role: "ai",
        text: t("study.finalQuizQuestionIntro", {
          current: index + 1,
          total: FINAL_QUIZ_QUESTION_COUNT,
          question: question.prompt,
        }),
        questionId: question.id,
        tutorQuestion: {
          question: question.prompt,
          targetConcepts: question.targetConcepts,
          expectedAnswerPoints: question.expectedAnswerPoints,
          checkType: question.checkType,
          requiredForPass: false,
          difficulty: question.difficulty,
          assessmentKind: "final_quiz",
        },
      });
      setCurrentQuestion(question);
    },
    [pushMessage, t],
  );

  const startFinalQuiz = useCallback(async () => {
    if (
      finalQuizStartedRef.current ||
      finalQuizPassedRef.current ||
      !studyPlanEntry
    ) {
      return;
    }

    finalQuizStartedRef.current = true;
    endSummaryPushedRef.current = false;
    setStudyPhase("final_quiz");
    setTutorCollapsed(false);
    setMemorizationSecondsRemaining(null);
    setFinalQuizState({
      status: "generating",
      questions: [],
      currentIndex: 0,
      answers: [],
    });

    pushMessage({
      id: uuid(),
      role: "ai",
      text: t("study.finalQuizIntro"),
    });

    setLoadingQuestions(true);
    try {
      const finalQuizContext = [
        "Generate a final in-session mastery quiz. Cover the full focused study session, not a narrow subtopic.",
        `Topic: ${studyPlanEntry.title}`,
        studyPlanEntry.learningObjective
          ? `Learning objective: ${studyPlanEntry.learningObjective}`
          : null,
        studyPlanEntry.description
          ? `Description: ${studyPlanEntry.description}`
          : null,
        studyPlanEntry.keyConcepts?.length
          ? `Key concepts: ${studyPlanEntry.keyConcepts.join(", ")}`
          : null,
        "Include recall, why, apply, transfer, and teach-back style checks across the set.",
        fullMaterialContext,
      ]
        .filter(Boolean)
        .join("\n\n");
      const generated = await generateQuestions(
        studyPlanEntry.title,
        finalQuizContext,
        FINAL_QUIZ_QUESTION_COUNT,
        agentLanguage,
      );
      const generatedQuizQuestions = [...generated];
      while (generatedQuizQuestions.length < FINAL_QUIZ_QUESTION_COUNT) {
        const checkType =
          REQUIRED_TUTOR_CHECK_TYPES[
            generatedQuizQuestions.length % REQUIRED_TUTOR_CHECK_TYPES.length
          ];
        generatedQuizQuestions.push({
          id: `final-fallback-${generatedQuizQuestions.length}`,
          prompt: buildDepthQuestion(checkType, studyPlanEntry),
        });
      }

      const quizQuestions = generatedQuizQuestions
        .slice(0, FINAL_QUIZ_QUESTION_COUNT)
        .map((question, index): StudyQuestion => {
          const checkType =
            REQUIRED_TUTOR_CHECK_TYPES[
              index % REQUIRED_TUTOR_CHECK_TYPES.length
            ];
          return {
            ...question,
            id: `final-quiz-${uuid()}`,
            targetConcepts: studyPlanEntry.keyConcepts,
            expectedAnswerPoints: [TUTOR_CHECK_DESCRIPTIONS[checkType]],
            checkType,
            requiredForPass: false,
            difficulty: checkType === "transfer" ? "edge_case" : "exam",
            assessmentKind: "final_quiz",
          };
        });

      setFinalQuizState({
        status: "active",
        questions: quizQuestions,
        currentIndex: 0,
        answers: [],
      });

      if (quizQuestions[0]) {
        pushFinalQuizQuestion(quizQuestions[0], 0);
      }
    } catch (err) {
      console.warn("[study] Failed to generate final quiz", err);
      finalQuizStartedRef.current = false;
      setFinalQuizState({
        status: "idle",
        questions: [],
        currentIndex: 0,
        answers: [],
      });
      pushMessage({
        id: uuid(),
        role: "ai",
        text: t("common.errorGeneric"),
      });
    } finally {
      setLoadingQuestions(false);
    }
  }, [
    agentLanguage,
    fullMaterialContext,
    pushFinalQuizQuestion,
    pushMessage,
    studyPlanEntry,
    t,
  ]);

  const buildFallbackWarmupQuestions =
    useCallback((): StudyWarmupQuestion[] => {
      const concepts = studyPlanEntry?.keyConcepts?.length
        ? studyPlanEntry.keyConcepts
        : [studyPlanEntry?.title || studyTitle].filter(Boolean);
      const sourceConcepts = concepts.length > 0 ? concepts : [studyTitle];

      return Array.from({ length: WARMUP_QUESTION_COUNT }, (_, index) => {
        const concept =
          sourceConcepts[index % sourceConcepts.length] || studyTitle;
        return shuffleStudyWarmupOptions({
          id: `warmup-fallback-${index}`,
          prompt: t("study.warmupFallbackPrompt", { concept }),
          options: [
            t("study.warmupFallbackCorrect", { concept }),
            t("study.warmupFallbackDistractorDetail"),
            t("study.warmupFallbackDistractorUnrelated"),
            t("study.warmupFallbackDistractorMemorize"),
          ],
          correctOptionIndex: 0,
          explanation: t("study.warmupFallbackExplanation", { concept }),
          targetConcepts: [concept],
        });
      });
    }, [studyPlanEntry, studyTitle, t]);

  const finishWarmup = useCallback(
    (answers: WarmupAnswer[], questions: StudyWarmupQuestion[]) => {
      const correctCount = answers.filter((answer) => answer.correct).length;
      const missed = answers.filter((answer) => !answer.correct);
      const missedConcepts = Array.from(
        new Set(
          missed
            .flatMap((answer) => answer.targetConcepts ?? [])
            .filter(Boolean),
        ),
      );
      const selectedSummary = answers
        .map((answer, index) => {
          const question = questions.find(
            (item) => item.id === answer.questionId,
          );
          const selected = question?.options[answer.selectedOptionIndex] ?? "";
          const correct = question?.options[answer.correctOptionIndex] ?? "";
          return `${index + 1}. ${answer.correct ? "Correct" : "Missed"}: ${answer.prompt}\nSelected: ${selected}\nCorrect: ${correct}\nFeedback: ${answer.explanation}`;
        })
        .join("\n\n");
      const topic = studyPlanEntry?.title || studyTitle;
      const nextCheckInstruction = nextDepthCheckType
        ? `After the explanation, ask exactly one hidden learning_question for checkType "${nextDepthCheckType}" (${TUTOR_CHECK_LABELS[nextDepthCheckType]}).`
        : "After the explanation, ask exactly one focused retention or exam-style review question.";
      const retrievalFocus = [
        topic,
        studyPlanEntry?.description,
        studyPlanEntry?.keyConcepts?.join(", "),
        missedConcepts.join(", "),
      ]
        .filter(Boolean)
        .join("\n");
      const prompt = [
        "The student has just completed a 10-question multiple-choice warm-up before recall.",
        `Topic: ${topic}`,
        `Warm-up score: ${correctCount}/${questions.length}`,
        missedConcepts.length
          ? `Missed or shaky concepts: ${missedConcepts.join(", ")}`
          : "The student did not miss any warm-up concepts.",
        "Use the warm-up as orientation data, not as a pass/fail grade.",
        `Study mode: ${getModeLabel(studyMode)}. ${
          studyMode === "beginner"
            ? "Explain like the learner is new and avoid assuming prior knowledge."
            : studyMode === "exam"
              ? "Keep the teaching concise and exam-oriented, with traps and application in mind."
              : "Use a balanced pace with clear explanations and real recall."
        }`,
        "Start with a concise beginner primer that gives the prerequisite mental model before recall. If the score was low, slow down and explain the basics first. If the score was high, briefly connect the key ideas and move toward recall.",
        "Explicitly address the most important missed concept before asking the next recall/depth question.",
        "Teach one small idea clearly, using the source material. Do not dump the whole topic.",
        `${nextCheckInstruction} The check-in question should be answerable after this explanation and should not assume advanced prior knowledge.`,
        "Include a useful visual diagram using the ```visual block format when it would clarify relationships, steps, or a process.",
        `Warm-up details:\n${selectedSummary}`,
      ].join("\n\n");

      setStudyPhase("tutor");
      setCurrentQuestion(null);
      setMemorizationSecondsRemaining(null);
      sendToFeynmanAI(prompt, undefined, retrievalFocus || prompt, {
        displayText: t("study.warmupCompleteUserMessage", {
          correct: correctCount,
          total: questions.length,
        }),
      });

      if (missedConcepts.length > 0) {
        const missedItems = missedConcepts.map((concept) => ({
          concept,
          note: t("study.mistakeNotebookWarmupNote"),
          source: "warmup" as const,
        }));
        addMistakeNotebookItems(missedItems);
        if (lectureId) {
          saveStudyMisconceptions(
            missedItems.map((item) => ({
              lectureId,
              studyPlanEntryId: studyPlanEntryId ?? undefined,
              sessionId: sessionId as string,
              concept: item.concept,
              note: item.note,
            })),
          ).catch((err) => {
            console.warn("[study] Failed to save warm-up misconceptions:", err);
          });
        }
      }
    },
    [
      addMistakeNotebookItems,
      lectureId,
      nextDepthCheckType,
      sendToFeynmanAI,
      sessionId,
      studyMode,
      studyPlanEntry,
      studyPlanEntryId,
      studyTitle,
      t,
    ],
  );

  const startStudySetup = useCallback(() => {
    if (!studyTitle) return;
    setStudyPhase("setup");
    setTutorCollapsed(false);
    setCurrentQuestion(null);
    setMemorizationSecondsRemaining(null);
  }, [studyTitle]);

  const startWarmupQuiz = useCallback(async () => {
    if (!studyTitle || warmupState.status !== "idle") return;

    setStudyPhase("warmup");
    setTutorCollapsed(false);
    setMemorizationSecondsRemaining(null);
    setWarmupState({
      status: "generating",
      questions: [],
      currentIndex: 0,
      answers: [],
      selectedOptionIndex: null,
    });

    pushMessage({
      id: uuid(),
      role: "ai",
      text: t("study.warmupIntro", {
        count: WARMUP_QUESTION_COUNT,
        topic: studyPlanEntry?.title || studyTitle,
      }),
    });

    try {
      const warmupContext = [
        "Generate a recognition warm-up before recall. Cover beginner prerequisites, key terms, relationships, common misconceptions, and high-yield ideas.",
        `Study mode: ${getModeLabel(studyMode)}.`,
        studyMode === "beginner"
          ? "Start very accessible: vocabulary and prerequisite mental models first, then only light application near the end."
          : studyMode === "exam"
            ? "Use exam-style wording, plausible traps, and application-oriented questions while still staying recognition-based."
            : "Use a balanced progression from recognition to concept relationships to light application.",
        studyPlanEntry?.title ? `Topic: ${studyPlanEntry.title}` : null,
        studyPlanEntry?.learningObjective
          ? `Learning objective: ${studyPlanEntry.learningObjective}`
          : null,
        studyPlanEntry?.description
          ? `Description: ${studyPlanEntry.description}`
          : null,
        studyPlanEntry?.keyConcepts?.length
          ? `Key concepts: ${studyPlanEntry.keyConcepts.join(", ")}`
          : null,
        fullMaterialContext,
      ]
        .filter(Boolean)
        .join("\n\n");
      const generated = await generateWarmupQuestions(
        studyPlanEntry?.title || studyTitle,
        warmupContext,
        WARMUP_QUESTION_COUNT,
        agentLanguage,
      );
      const questions =
        generated.length >= WARMUP_QUESTION_COUNT
          ? generated.slice(0, WARMUP_QUESTION_COUNT)
          : [
              ...generated,
              ...buildFallbackWarmupQuestions().slice(
                0,
                WARMUP_QUESTION_COUNT - generated.length,
              ),
            ];

      setWarmupState({
        status: "active",
        questions,
        currentIndex: 0,
        answers: [],
        selectedOptionIndex: null,
      });
    } catch (err) {
      console.warn("[study] Failed to generate warm-up quiz", err);
      setWarmupState({
        status: "active",
        questions: buildFallbackWarmupQuestions(),
        currentIndex: 0,
        answers: [],
        selectedOptionIndex: null,
      });
    }
  }, [
    agentLanguage,
    buildFallbackWarmupQuestions,
    fullMaterialContext,
    pushMessage,
    studyPlanEntry,
    studyTitle,
    studyMode,
    t,
    warmupState.status,
  ]);

  const selectWarmupOption = useCallback((optionIndex: number) => {
    setWarmupState((prev) => {
      if (prev.status !== "active" || prev.selectedOptionIndex !== null) {
        return prev;
      }
      return { ...prev, selectedOptionIndex: optionIndex };
    });
  }, []);

  const continueWarmup = useCallback(() => {
    const question = warmupState.questions[warmupState.currentIndex];
    if (!question || warmupState.selectedOptionIndex === null) return;

    const answer: WarmupAnswer = {
      questionId: question.id,
      prompt: question.prompt,
      selectedOptionIndex: warmupState.selectedOptionIndex,
      correctOptionIndex: question.correctOptionIndex,
      correct: warmupState.selectedOptionIndex === question.correctOptionIndex,
      targetConcepts: question.targetConcepts,
      explanation: question.explanation,
    };
    const nextAnswers = [...warmupState.answers, answer];
    const nextIndex = warmupState.currentIndex + 1;

    if (nextIndex >= warmupState.questions.length) {
      setWarmupState({
        ...warmupState,
        status: "complete",
        answers: nextAnswers,
        selectedOptionIndex: null,
      });
      finishWarmup(nextAnswers, warmupState.questions);
      return;
    }

    setWarmupState({
      ...warmupState,
      currentIndex: nextIndex,
      answers: nextAnswers,
      selectedOptionIndex: null,
    });
  }, [finishWarmup, warmupState]);

  const buildDiagnosticQuestion = useCallback(() => {
    const topic = studyPlanEntry?.title || studyTitle;
    const conceptHint = studyPlanEntry?.keyConcepts?.length
      ? t("study.coldStartConceptHint", {
          concepts: studyPlanEntry.keyConcepts.slice(0, 4).join(", "),
        })
      : "";

    return t("study.coldStartQuestion", {
      topic,
      conceptHint,
    });
  }, [studyPlanEntry, studyTitle, t]);

  const submitDiagnosticAttempt = useCallback(
    (attemptText: string, noClue = false) => {
      const diagnosticMessage = latestDiagnosticQuestionMessage;
      const question =
        diagnosticMessage?.tutorQuestion?.question || buildDiagnosticQuestion();
      const questionId = diagnosticMessage?.questionId || diagnosticMessage?.id;
      const topic = studyPlanEntry?.title || studyTitle;
      const concepts =
        studyPlanEntry?.keyConcepts?.join(", ") || "the key ideas";
      const displayText =
        noClue || !attemptText.trim()
          ? t("study.noClueYet")
          : attemptText.trim();
      const learnerAttempt = noClue
        ? "The student selected 'No clue yet'. Treat this as useful diagnostic information, not as failure."
        : `Student's first attempt:\n${attemptText.trim()}`;
      const nextCheckInstruction = nextDepthCheckType
        ? `After the explanation, ask exactly one hidden learning_question for checkType "${nextDepthCheckType}" (${TUTOR_CHECK_LABELS[nextDepthCheckType]}).`
        : "After the explanation, ask exactly one focused retention or exam-style review question.";
      const visualInstruction =
        "Include a useful visual diagram using the ```visual block format when it would clarify relationships, steps, or a process.";
      const retrievalFocus = [
        topic,
        studyPlanEntry?.description,
        studyPlanEntry?.keyConcepts?.join(", "),
        question,
        attemptText,
      ]
        .filter(Boolean)
        .join("\n");

      const prompt = [
        "The student is beginning with an attempt-first, explanation-second flow.",
        `Topic: ${topic}`,
        `Key concepts: ${concepts}`,
        `Cold-start prompt: ${question}`,
        learnerAttempt,
        "Now give the explanation-second response. Do not grade the first attempt and do not assign a score. Use the attempt only to decide where to start.",
        "If the student had no clue, start from the simplest prerequisite and make the first explanation beginner-friendly. If the attempt was partly right or wrong, explicitly connect the explanation to that gap without making the student feel punished.",
        "Teach one small idea clearly, using the source material. Do not dump the whole topic.",
        `${nextCheckInstruction} The check-in question should be answerable after this explanation and should not assume advanced prior knowledge.`,
        visualInstruction,
      ].join("\n\n");

      setStudyPhase("tutor");
      setCurrentQuestion(null);
      setMemorizationSecondsRemaining(null);
      sendToFeynmanAI(prompt, undefined, retrievalFocus || prompt, {
        displayText,
        questionId,
      });
    },
    [
      buildDiagnosticQuestion,
      latestDiagnosticQuestionMessage,
      nextDepthCheckType,
      sendToFeynmanAI,
      studyPlanEntry,
      studyTitle,
      t,
    ],
  );

  const submitAnswer = async () => {
    // Get question context - either from formal quiz or last AI message
    const lastAiMessage = [...messages].reverse().find((m) => m.role === "ai");
    const lastAiQuestionText =
      lastAiMessage?.tutorQuestion?.question ||
      (lastAiMessage ? getQuestionTextForMessage(lastAiMessage) : null);

    // Prefer the latest answerable tutor question. A stale formal question should
    // not steal grading from a newer AI check-in.
    const questionToEvaluate: StudyQuestion | null = lastAiQuestionText
      ? {
          id: lastAiMessage?.questionId || lastAiMessage?.id || uuid(),
          prompt: lastAiQuestionText,
          targetConcepts:
            lastAiMessage?.tutorQuestion?.targetConcepts ||
            currentQuestion?.targetConcepts,
          expectedAnswerPoints:
            lastAiMessage?.tutorQuestion?.expectedAnswerPoints ||
            currentQuestion?.expectedAnswerPoints,
          checkType: normalizeTutorCheckType(
            lastAiMessage?.tutorQuestion?.checkType ||
              currentQuestion?.checkType ||
              nextDepthCheckType ||
              "recall",
          ),
          requiredForPass:
            lastAiMessage?.tutorQuestion?.requiredForPass ??
            currentQuestion?.requiredForPass ??
            true,
          difficulty:
            lastAiMessage?.tutorQuestion?.difficulty ||
            currentQuestion?.difficulty,
          assessmentKind:
            lastAiMessage?.tutorQuestion?.assessmentKind ||
            currentQuestion?.assessmentKind ||
            "depth",
        }
      : currentQuestion
        ? {
            ...currentQuestion,
            checkType: normalizeTutorCheckType(
              currentQuestion.checkType || nextDepthCheckType || "recall",
            ),
            requiredForPass: currentQuestion.requiredForPass ?? true,
            assessmentKind: currentQuestion.assessmentKind || "depth",
          }
        : null;

    if (!questionToEvaluate) return;

    const isFinalQuizAnswer =
      questionToEvaluate.assessmentKind === "final_quiz";
    const isGuidedNotesAnswer =
      questionToEvaluate.assessmentKind === "guided_notes";
    setMemorizationSecondsRemaining(null);
    setTutorCollapsed(false);
    setStudyPhase("grading");
    setStudySurfacePreference("canvas");
    stopSpeaking().catch((err) =>
      console.warn("[study] Failed to stop tutor audio before grading:", err),
    );

    setGrading(true);
    try {
      const imageUri = await canvasRef.current?.exportAsImage();
      const canvasBounds = getNewStrokeBounds();
      const base64 = imageUri
        ? await FileSystem.readAsStringAsync(imageUri, {
            encoding: FileSystem.EncodingType.Base64,
          })
        : undefined;
      const dataUrl = base64 ? `data:image/png;base64,${base64}` : undefined;

      const gradingChunks = await fetchRelevantChunks(
        `${questionToEvaluate.prompt}\n${answerDraft || answerText}`,
        6,
      );
      const gradingSourceChunks = chunksToCitationSourceChunks(gradingChunks);
      const gradingContext =
        gradingSourceChunks.length > 0
          ? chunksToContextBlock(gradingSourceChunks)
          : fullMaterialContext;

      const feedback = await evaluateAnswer(
        {
          question: questionToEvaluate,
          answerText: answerDraft,
          answerImageDataUrl: dataUrl,
          answerCanvasBounds: canvasBounds ?? undefined,
          lectureId,
          gradingContext,
          passScoreThreshold: targetPassScore,
        },
        agentLanguage,
      );
      const gradingCitedChunks = selectCitedChunks(
        gradingSourceChunks,
        feedback.sourceCitationIds ?? [],
      );
      const gradingCitations =
        gradingCitedChunks.length > 0
          ? citedChunksToCitations(gradingCitedChunks)
          : undefined;

      const normalizedScore =
        typeof feedback.score === "number"
          ? Math.round(feedback.score)
          : undefined;

      let uploadedImageUri: string | undefined;
      if (imageUri) {
        const uploaded = await uploadCanvasImage(imageUri);
        uploadedImageUri = uploaded.publicUrl;
      }

      const linkId = uuid();
      const link: StudyAnswerLink = {
        id: linkId,
        sessionId: sessionId as string,
        questionId: questionToEvaluate.id,
        pageId: activePageId,
        answerText: answerDraft,
        answerImageUri: uploadedImageUri,
        canvasBounds: canvasBounds ?? undefined,
        createdAt: new Date().toISOString(),
      };
      await saveAnswerLink(link);
      setAnswerLinks((prev) => [link, ...prev]);

      const evaluatedCheckType = normalizeTutorCheckType(
        feedback.checkType ||
          questionToEvaluate.checkType ||
          nextDepthCheckType ||
          "recall",
      );
      if (lectureId) {
        const currentLectureId = lectureId;
        saveTutorAnswerEvaluation({
          lectureId: currentLectureId,
          studyPlanEntryId: studyPlanEntryId ?? undefined,
          sessionId: sessionId as string,
          questionId: questionToEvaluate.id,
          questionText: questionToEvaluate.prompt,
          answerText: answerDraft,
          score: normalizedScore,
          correctness: feedback.correctness,
          checkType: evaluatedCheckType,
          feedback,
          misconceptions: feedback.misconceptions ?? [],
        })
          .then(async () => {
            if (!lecture?.cheatSheet?.enabled) return;
            await markLectureCheatSheetPending(currentLectureId);
            await enqueueCheatSheetRefresh({
              lectureId: currentLectureId,
              language: agentLanguage,
              force: false,
            });
          })
          .catch((err) => {
            console.warn("[study] Failed to save cheat sheet evidence:", err);
          });
      }
      const depthCheckPassed =
        !isFinalQuizAnswer &&
        !isGuidedNotesAnswer &&
        feedbackPassesDepthCheck(
          {
            ...feedback,
            score: normalizedScore,
          },
          targetPassScore,
        );
      const canCountForPass =
        !isFinalQuizAnswer &&
        !isGuidedNotesAnswer &&
        feedback.canCountForPass !== false &&
        questionToEvaluate.requiredForPass !== false;
      const localDepthCheck: StudyDepthCheck | null =
        !isFinalQuizAnswer && !isGuidedNotesAnswer && studyPlanEntryId
          ? {
              id: uuid(),
              lectureId,
              studyPlanEntryId,
              sessionId: sessionId as string,
              questionId: questionToEvaluate.id,
              questionText: questionToEvaluate.prompt,
              checkType: evaluatedCheckType,
              score: normalizedScore,
              correctness: feedback.correctness,
              passed: depthCheckPassed,
              canCountForPass,
              feedbackSummary: feedback.summary,
              createdAt: new Date().toISOString(),
            }
          : null;
      let latestDepthChecks = depthChecks;
      if (localDepthCheck) {
        try {
          const savedDepthCheck = await saveStudyDepthCheck(localDepthCheck);
          latestDepthChecks = [
            savedDepthCheck ?? localDepthCheck,
            ...depthChecks,
          ];
          setDepthChecks(latestDepthChecks);
        } catch (err) {
          console.warn("[study] Failed to save depth check", err);
          latestDepthChecks = [localDepthCheck, ...depthChecks];
          setDepthChecks(latestDepthChecks);
        }
      }

      const deriveSectionStatus = (
        score: number | undefined,
        correctness: string,
        checks: StudyDepthCheck[],
      ): SectionStatus => {
        if (canPassStudyPlanEntry(checks, targetPassScore)) {
          return finalQuizPassedRef.current ? "passed" : "in_progress";
        }
        const passedDepthCount = getPassedDepthCheckTypes(checks, targetPassScore).size;
        if (
          typeof score === "number" &&
          score <= 40 &&
          passedDepthCount === 0
        ) {
          return "failed";
        }
        if (correctness === "incorrect" && passedDepthCount === 0) {
          return "failed";
        }
        return "in_progress";
      };

      // Update study plan entry status when focusing on a specific section
      if (studyPlanEntryId && !isFinalQuizAnswer && !isGuidedNotesAnswer) {
        const nextStatus = deriveSectionStatus(
          normalizedScore,
          feedback.correctness,
          latestDepthChecks,
        );
        try {
          await updateStudyPlanEntryStatus(studyPlanEntryId, {
            status: nextStatus,
            statusScore: normalizedScore,
          });
        } catch (err) {
          console.warn("[study] Failed to update section status", err);
        }

        if (
          !hasShownLecturePassedToastRef.current &&
          nextStatus === "passed" &&
          lecture?.studyPlan &&
          lecture.studyPlan.length > 0
        ) {
          const updatedPlan = lecture.studyPlan.map((entry) =>
            entry.id === studyPlanEntryId
              ? { ...entry, status: nextStatus }
              : entry,
          );
          const lecturePassed = updatedPlan.every(
            (entry) => entry.status === "passed",
          );
          if (lecturePassed) {
            hasShownLecturePassedToastRef.current = true;
            setLecturePassedToast(true);
            setTimeout(() => setLecturePassedToast(false), 3500);
          }
        }

        // Record review + update mastery schedule
        try {
          const responseQuality: ReviewQuality =
            feedback.correctness === "correct"
              ? "correct"
              : feedback.correctness === "incorrect"
                ? "incorrect"
                : "partial";

          const reviewedAt = new Date().toISOString();
          await addReviewEvent({
            studyPlanEntryId,
            score: normalizedScore,
            responseQuality,
            reviewedAt,
          });

          const history = await listReviewEvents(studyPlanEntryId, 50);
          const masteryScore = computeMasteryScore({ history });
          const reviewCount = history?.length ?? 0;
          const easeFactor = studyPlanEntry?.easeFactor ?? 2.5;
          const nextReviewAt = computeNextReviewDate({
            masteryScore,
            easeFactor,
            reviewCount,
          });

          await updateStudyPlanEntryMastery(studyPlanEntryId, {
            masteryScore: Math.round(masteryScore),
            nextReviewAt,
            reviewCount,
            easeFactor,
            status: nextStatus,
            statusScore: normalizedScore,
          });

          // Update streak
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
              const diffDays = Math.floor(
                (today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24),
              );
              if (diffDays === 1) current = streak.current + 1;
            }
            const longest = Math.max(streak.longest, current);
            await updateUserStreak({
              current,
              longest,
              lastReviewDate: todayDate,
            });
          } catch (err) {
            console.warn("[study] Failed to update streak", err);
          }
        } catch (err) {
          console.warn("[study] Failed to update mastery schedule", err);
        }
      }

      // Create answer marker for linking canvas to chat
      questionIndexCounterRef.current += 1;
      // Find the message ID by questionId, or fall back to lastAiMessage
      const questionMessage = currentQuestion
        ? messages.find((m) => m.questionId === currentQuestion.id)
        : null;
      const messageIdForMarker = questionMessage?.id ?? lastAiMessage?.id ?? "";
      const newMarker: CanvasAnswerMarker = {
        questionId: questionToEvaluate.id,
        questionIndex: questionIndexCounterRef.current,
        messageId: messageIdForMarker,
        answerLinkId: linkId,
        pageId: activePageId,
        canvasBounds: canvasBounds ?? undefined,
      };
      setAnswerMarkers((prev) => [...prev, newMarker]);
      canvasBaselineRef.current = canvasStrokes.length;

      // Reset drawing detection after submission
      setHasDrawnAfterQuestion(false);
      setLastDrawingPosition(null);

      // Create flashcard if this depth check was answered well. Topic status
      // still requires the full depth ladder before it becomes passed.
      const isCheckPassed = isFinalQuizAnswer
        ? typeof normalizedScore === "number" &&
          normalizedScore >= targetPassScore
        : isGuidedNotesAnswer
          ? typeof normalizedScore === "number" &&
            normalizedScore >= targetPassScore
          : depthCheckPassed;
      const isTopicDepthPassed = studyPlanEntryId
        ? canPassStudyPlanEntry(latestDepthChecks, targetPassScore)
        : isCheckPassed;
      const nextMissingCheckType = studyPlanEntryId
        ? getNextTutorCheckType(latestDepthChecks, targetPassScore)
        : null;
      const feedbackMessageId = uuid();
      const feedbackInsertResult = insertCanvasFeedbackBlockBelowAnswer({
        pages:
          canvasPagesRef.current.length > 0
            ? canvasPagesRef.current
            : canvasPages,
        pageId: activePageId,
        messageId: feedbackMessageId,
        feedback: {
          ...feedback,
          score: normalizedScore,
        },
        isPassed: isCheckPassed,
        answerBounds: canvasBounds ?? undefined,
      });
      setCanvasPages(feedbackInsertResult.pages);
      const feedbackPage =
        feedbackInsertResult.pages.find((page) => page.id === activePageId) ??
        feedbackInsertResult.pages[0];
      if (feedbackPage) {
        activatePage(feedbackPage);
      }
      saveCanvasPagesNow(feedbackInsertResult.pages);
      setStudySurfacePreference("canvas");
      setTimeout(() => {
        canvasScrollRef.current?.scrollTo({
          y: Math.max(feedbackInsertResult.block.position.y - 24, 0),
          animated: true,
        });
        canvasHScrollRef.current?.scrollTo({
          x: Math.max(feedbackInsertResult.block.position.x - 24, 0),
          animated: true,
        });
      }, 150);

      if (!isCheckPassed && feedback.misconceptions?.length && lectureId) {
        const savedMisconceptions = feedback.misconceptions.map((item) => ({
          lectureId,
          studyPlanEntryId: studyPlanEntryId ?? undefined,
          sessionId: sessionId as string,
          concept: item,
          note: feedback.summary,
        }));
        try {
          await saveStudyMisconceptions(savedMisconceptions);
          setRecentMisconceptions((prev) =>
            [
              ...savedMisconceptions.map(
                (item) => `${item.concept}: ${item.note}`,
              ),
              ...prev,
            ].slice(0, 8),
          );
        } catch (err) {
          console.warn("[study] Failed to save misconceptions:", err);
        }
      }

      if (!isCheckPassed) {
        const notebookConcepts = feedback.misconceptions?.length
          ? feedback.misconceptions
          : questionToEvaluate.targetConcepts?.length
            ? questionToEvaluate.targetConcepts
            : [questionToEvaluate.prompt];
        addMistakeNotebookItems(
          notebookConcepts.slice(0, 4).map((concept) => ({
            concept,
            note:
              feedback.whatWentWrong?.[0] ||
              feedback.summary ||
              t("study.mistakeNotebookRecallNote"),
            source: isFinalQuizAnswer ? "final_quiz" : "recall",
          })),
        );
      }

      if (
        !isFinalQuizAnswer &&
        !isGuidedNotesAnswer &&
        isCheckPassed &&
        lectureId
      ) {
        try {
          // Collect AI explanation from previous messages (up to 3 messages before the question)
          const questionMsgIndex = messages.findIndex(
            (m) => m.id === lastAiMessage?.id,
          );
          const explanationMessages = messages
            .slice(Math.max(0, questionMsgIndex - 3), questionMsgIndex)
            .filter((m) => m.role === "ai");
          const aiExplanation = explanationMessages
            .map((m) => m.text)
            .join("\n\n");
          const fallbackExplanation = aiExplanation || feedback.summary || "";

          // Collect visual blocks from explanation messages
          const visualBlockIds = explanationMessages.flatMap(
            (m) => m.visualBlockIds || [],
          );
          const collectedVisualBlocks = activeVisualBlocks.filter((b) =>
            visualBlockIds.includes(b.id),
          );

          // Extract the actual question text
          const questionText = questionToEvaluate.prompt
            ? questionToEvaluate.prompt
            : lastAiMessage
              ? getQuestionTextForMessage(lastAiMessage) || lastAiMessage.text
              : "";

          await saveFlashcard({
            lectureId,
            sessionId: sessionId as string,
            studyPlanEntryId: studyPlanEntryId ?? undefined,
            questionText,
            answerText: answerDraft || undefined,
            answerImageUri: uploadedImageUri,
            aiExplanation: fallbackExplanation || undefined,
            visualBlocks:
              collectedVisualBlocks.length > 0
                ? collectedVisualBlocks
                : undefined,
          });

          // Show notification
          setFlashcardAdded(true);
          setTimeout(() => setFlashcardAdded(false), 3000);

          console.log("[study] Flashcard created for passed question");
        } catch (err) {
          console.warn("[study] Failed to create flashcard:", err);
        }
      }

      pushMessage(
        {
          id: uuid(),
          role: "user",
          text: answerDraft || t("study.handwrittenAnswerPlaceholder"),
          questionId: questionToEvaluate.id,
          answerLinkId: linkId,
        },
        false,
      );

      const correctnessText =
        feedback.correctness === "correct"
          ? t("study.feedback.correct")
          : feedback.correctness === "partially correct"
            ? t("study.feedback.partial")
            : t("study.feedback.incorrect");

      const scoreText =
        typeof feedback.score === "number"
          ? `\n\n${t("study.scoreLabel", { score: feedback.score })}`
          : "";
      const whatWentRightText =
        feedback.whatWentRight && feedback.whatWentRight.length
          ? `\n\n${t("study.feedback.whatWentRightIntro")}\n${feedback.whatWentRight.map((i) => `• ${i}`).join("\n")}`
          : "";
      const whatWentWrongText =
        !isCheckPassed && feedback.whatWentWrong?.length
          ? `\n\n${t("study.feedback.whatWentWrongIntro")}\n${feedback.whatWentWrong.map((i) => `• ${i}`).join("\n")}`
          : "";
      const correctAnswerText =
        !isCheckPassed && feedback.correctAnswer?.trim()
          ? `\n\n${t("study.feedback.correctAnswerIntro")}\n${feedback.correctAnswer.trim()}`
          : "";
      const rewriteExampleText =
        !isCheckPassed && feedback.rewriteExample?.trim()
          ? `\n\n${t("study.feedback.rewriteExampleIntro")}\n${feedback.rewriteExample.trim()}`
          : "";
      const improvementsText =
        feedback.improvements && feedback.improvements.length
          ? `\n\n${t("study.feedback.improveIntro")}\n${feedback.improvements.map((i) => `• ${i}`).join("\n")}`
          : "";
      const sourceNotesText =
        feedback.sourceNotes && feedback.sourceNotes.length
          ? `\n\n${t("study.feedback.sourceIntro")}\n${feedback.sourceNotes.map((i) => `• ${i}`).join("\n")}`
          : "";
      const finalQuizAnswer: FinalQuizAnswer | null = isFinalQuizAnswer
        ? {
            questionId: questionToEvaluate.id,
            prompt: questionToEvaluate.prompt,
            score: normalizedScore,
            checkType: evaluatedCheckType,
            summary: feedback.summary,
          }
        : null;
      const nextFinalQuizAnswers = finalQuizAnswer
        ? [...finalQuizState.answers, finalQuizAnswer]
        : finalQuizState.answers;
      const finalQuizComplete =
        isFinalQuizAnswer &&
        finalQuizState.questions.length > 0 &&
        nextFinalQuizAnswers.length >= finalQuizState.questions.length;
      const finalQuizAverage = finalQuizComplete
        ? Math.round(
            nextFinalQuizAnswers.reduce(
              (sum, answer) => sum + (answer.score ?? 0),
              0,
            ) / nextFinalQuizAnswers.length,
          )
        : undefined;
      const finalQuizPassed =
        finalQuizAverage !== undefined &&
        finalQuizAverage >= targetPassScore;
      const nextFinalQuizIndex = finalQuizState.currentIndex + 1;
      const nextFinalQuizQuestion =
        isFinalQuizAnswer && !finalQuizComplete
          ? finalQuizState.questions[nextFinalQuizIndex]
          : undefined;
      const weakestFinalQuizAnswer =
        nextFinalQuizAnswers.reduce<FinalQuizAnswer | null>(
          (weakest, answer) => {
            if (!weakest) return answer;
            return (answer.score ?? 0) < (weakest.score ?? 0)
              ? answer
              : weakest;
          },
          null,
        );
      const finalQuizRestartQuestion: StudyQuestion | null =
        finalQuizComplete &&
        !finalQuizPassed &&
        studyPlanEntry &&
        weakestFinalQuizAnswer
          ? {
              id: `final-quiz-retry-${uuid()}`,
              prompt: buildDepthQuestion(
                weakestFinalQuizAnswer.checkType || "recall",
                studyPlanEntry,
              ),
              targetConcepts: studyPlanEntry.keyConcepts,
              expectedAnswerPoints: [
                TUTOR_CHECK_DESCRIPTIONS[
                  weakestFinalQuizAnswer.checkType || "recall"
                ],
              ],
              checkType: weakestFinalQuizAnswer.checkType || "recall",
              requiredForPass: true,
              difficulty:
                weakestFinalQuizAnswer.checkType === "transfer"
                  ? "edge_case"
                  : "basic",
              assessmentKind: "depth",
            }
          : null;
      const shouldStartFinalQuiz =
        !isFinalQuizAnswer &&
        !isGuidedNotesAnswer &&
        isCheckPassed &&
        isTopicDepthPassed &&
        Boolean(studyPlanEntry) &&
        !finalQuizStartedRef.current &&
        !finalQuizPassedRef.current;
      const followUpQuestion: StudyQuestion | null = finalQuizRestartQuestion
        ? finalQuizRestartQuestion
        : isGuidedNotesAnswer
          ? {
              id: `guided-recall-${uuid()}`,
              prompt: studyPlanEntry
                ? buildDepthQuestion(
                    nextMissingCheckType || evaluatedCheckType || "recall",
                    studyPlanEntry,
                  )
                : feedback.followUpQuestion ||
                  `Explain this again from memory: ${questionToEvaluate.prompt}`,
              targetConcepts:
                studyPlanEntry?.keyConcepts ||
                questionToEvaluate.targetConcepts ||
                feedback.misconceptions,
              expectedAnswerPoints:
                questionToEvaluate.expectedAnswerPoints ||
                (nextMissingCheckType
                  ? [TUTOR_CHECK_DESCRIPTIONS[nextMissingCheckType]]
                  : undefined),
              checkType: nextMissingCheckType || evaluatedCheckType || "recall",
              requiredForPass: true,
              difficulty: "basic",
              assessmentKind: "depth",
            }
          : !isFinalQuizAnswer && !isCheckPassed
            ? {
                id: `follow-up-${uuid()}`,
                prompt:
                  feedback.followUpQuestion ||
                  (studyPlanEntry
                    ? buildDepthQuestion(evaluatedCheckType, studyPlanEntry)
                    : `Explain the missing part again, focusing on ${feedback.misconceptions?.[0] || questionToEvaluate.prompt}.`),
                targetConcepts:
                  questionToEvaluate.targetConcepts || feedback.misconceptions,
                expectedAnswerPoints: questionToEvaluate.expectedAnswerPoints,
                checkType: evaluatedCheckType,
                requiredForPass: questionToEvaluate.requiredForPass ?? true,
                difficulty: questionToEvaluate.difficulty,
                assessmentKind: "depth",
              }
            : !isFinalQuizAnswer &&
                !isGuidedNotesAnswer &&
                isCheckPassed &&
                !isTopicDepthPassed &&
                nextMissingCheckType &&
                studyPlanEntry
              ? {
                  id: `depth-${nextMissingCheckType}-${uuid()}`,
                  prompt: buildDepthQuestion(
                    nextMissingCheckType,
                    studyPlanEntry,
                  ),
                  targetConcepts: studyPlanEntry.keyConcepts,
                  expectedAnswerPoints: [
                    TUTOR_CHECK_DESCRIPTIONS[nextMissingCheckType],
                  ],
                  checkType: nextMissingCheckType,
                  requiredForPass: true,
                  difficulty:
                    nextMissingCheckType === "transfer" ? "edge_case" : "basic",
                  assessmentKind: "depth",
                }
              : null;
      const followUpText = followUpQuestion
        ? `\n\n${t("study.feedback.followUpIntro")}\n${followUpQuestion.prompt}`
        : "";
      const costText = feedback.costUsd
        ? `\n\n_${t("cost.label", { value: feedback.costUsd.toFixed(4) })}_`
        : "";
      const finalQuizText =
        isFinalQuizAnswer && finalQuizComplete && finalQuizAverage !== undefined
          ? `\n\n${
              finalQuizPassed
                ? t("study.finalQuizPassed", { score: finalQuizAverage })
                : t("study.finalQuizFailed", { score: finalQuizAverage })
            }`
          : isFinalQuizAnswer
            ? `\n\n${t("study.finalQuizProgress", {
                current: nextFinalQuizAnswers.length,
                total:
                  finalQuizState.questions.length || FINAL_QUIZ_QUESTION_COUNT,
              })}`
            : "";

      const feedbackBaseText = `${correctnessText}\n\n${feedback.summary}${whatWentRightText}${whatWentWrongText}${correctAnswerText}${rewriteExampleText}${improvementsText}${scoreText}${finalQuizText}${sourceNotesText}`;
      const feedbackText = followUpQuestion
        ? `${feedbackBaseText}\n\n${t("study.feedback.askExplain")}${costText}${followUpText}`
        : `${feedbackBaseText}\n\n${t("study.feedback.askExplain")}${costText}`;
      const followUpTutorQuestion = followUpQuestion
        ? {
            question: followUpQuestion.prompt,
            targetConcepts: followUpQuestion.targetConcepts,
            expectedAnswerPoints: followUpQuestion.expectedAnswerPoints,
            checkType: followUpQuestion.checkType,
            requiredForPass: followUpQuestion.requiredForPass,
            difficulty: followUpQuestion.difficulty,
            assessmentKind: followUpQuestion.assessmentKind,
          }
        : undefined;
      const shouldUseFeedbackListeningNotes =
        Boolean(followUpTutorQuestion) &&
        shouldUseListeningNotesFlow(followUpTutorQuestion);
      const feedbackMessage: StudyChatMessage = {
        id: feedbackMessageId,
        role: "ai",
        text: feedbackText,
        questionId: followUpQuestion?.id ?? questionToEvaluate.id,
        answerLinkId: linkId,
        aiModel: feedback.model,
        aiPlatform: feedback.aiPlatform,
        reasoning: {
          effort: feedback.reasoningEffort ?? null,
          ...feedback.usage,
        },
        citations: gradingCitations,
        tutorQuestion: followUpTutorQuestion,
      };
      pushMessage(feedbackMessage, !shouldUseFeedbackListeningNotes);

      if (
        shouldUseFeedbackListeningNotes &&
        followUpQuestion &&
        followUpTutorQuestion
      ) {
        const { audioText } = beginListeningNotesStage({
          messageId: feedbackMessageId,
          questionText: followUpQuestion.prompt,
          tutorQuestion: followUpTutorQuestion,
          tutorText: feedbackText,
        });
        speakMessage(audioText, feedbackMessageId).catch((err) => {
          console.warn("[study] Failed to play listening notes audio:", err);
          finishGuidedNotesStageRef.current();
        });
        if (!ttsEnabled) {
          setTimeout(() => finishGuidedNotesStageRef.current(), 0);
        }
      }

      if (isFinalQuizAnswer && finalQuizAnswer) {
        setFinalQuizState({
          status: finalQuizComplete
            ? finalQuizPassed
              ? "passed"
              : "failed"
            : "active",
          questions: finalQuizState.questions,
          currentIndex: finalQuizComplete
            ? finalQuizState.currentIndex
            : nextFinalQuizIndex,
          answers: nextFinalQuizAnswers,
          averageScore: finalQuizAverage,
        });

        if (finalQuizComplete && finalQuizAverage !== undefined) {
          if (finalQuizPassed) {
            await markFinalQuizPassed(finalQuizAverage);
          } else {
            finalQuizStartedRef.current = false;
            finalQuizPassedRef.current = false;
          }
          if (!endSummaryPushedRef.current) {
            endSummaryPushedRef.current = true;
            pushMessage({
              id: uuid(),
              role: "ai",
              text: buildSessionSummaryText({
                t,
                topic: studyPlanEntry?.title || studyTitle,
                warmupAnswers: warmupState.answers,
                finalQuizAnswers: nextFinalQuizAnswers,
                finalQuizAverage,
                mistakes: mistakeNotebook,
              }),
            });
          }
        } else if (nextFinalQuizQuestion) {
          pushFinalQuizQuestion(nextFinalQuizQuestion, nextFinalQuizIndex);
        }
      }

      if (followUpQuestion) {
        setQuestions((prev) => [...prev, followUpQuestion]);
        setCurrentQuestion(followUpQuestion);
      }
      if (shouldStartFinalQuiz) {
        await startFinalQuiz();
      } else if (!followUpQuestion && !nextFinalQuizQuestion) {
        setStudyPhase(
          finalQuizState.status === "active" ? "final_quiz" : "grading",
        );
      }
      setAnswerDraft("");
    } catch (error) {
      console.warn(error);
      setStudyPhase("answer");
    } finally {
      setGrading(false);
    }
  };

  // Request explanation with visual diagram
  const requestExplanation = useCallback(() => {
    const visualInstruction =
      "IMPORTANT: Include a visual diagram on the canvas showing how the concepts connect (use the ```visual block format). This helps me understand the relationships visually.";
    const retrievalFocus = studyPlanEntry
      ? [
          studyPlanEntry.title,
          studyPlanEntry.description,
          studyPlanEntry.keyConcepts?.join(", "),
        ]
          .filter(Boolean)
          .join("\n")
      : [
          lecture?.title,
          lecture?.description,
          lecture?.files
            .filter((file) => !file.isExam)
            .slice(0, 4)
            .map((file) => cleanSourceFileName(file.name || file.uri))
            .join(", "),
        ]
          .filter(Boolean)
          .join("\n");

    const nextCheckInstruction = nextDepthCheckType
      ? `The next required pass-gate checkType is "${nextDepthCheckType}" (${TUTOR_CHECK_LABELS[nextDepthCheckType]}). The hidden learning_question must use that checkType, and the student needs ${targetPassScore}+/100 for it to count.`
      : "All depth checks are already passed; ask a focused retention or exam-style review question.";
    const modeInstruction =
      studyMode === "beginner"
        ? "Explain like I am new: define prerequisites first, avoid unexplained jargon, and use one small example before testing."
        : studyMode === "exam"
          ? "Use exam mode: be concise, highlight likely traps, and push toward application after the core idea."
          : "Use normal mode: clear explanation, then recall and application at a balanced pace.";
    const topicFocus = studyPlanEntry
      ? `Give me a focused explanation of the next key idea from "${studyPlanEntry.title}". ${modeInstruction} Focus on ${studyPlanEntry.keyConcepts?.join(", ") || "the main ideas"}, cover one step only, and use enough detail for real understanding without dumping the whole topic. ${nextCheckInstruction} ${visualInstruction} End with exactly one check-in question asking me to explain it back or apply it. Then stop and wait for my reply - I will answer on the canvas.`
      : `Give me a focused explanation of the first key idea in this topic. ${modeInstruction} Cover one step only, and use enough detail for real understanding without dumping the whole topic. ${visualInstruction} End with exactly one check-in question asking me to explain it back or apply it. Stop and wait for my reply—I will answer on the canvas.`;
    sendToFeynmanAI(topicFocus, undefined, retrievalFocus || topicFocus);
  }, [lecture, nextDepthCheckType, sendToFeynmanAI, studyMode, studyPlanEntry, targetPassScore]);

  // Auto-trigger a recognition warm-up before recall when starting a new session
  useEffect(() => {
    if (
      shouldAutoExplainRef.current &&
      !hasTriggeredAutoExplainRef.current &&
      !loadingMessages &&
      !loadingEntry &&
      studyTitle &&
      messages.length === 0 &&
      !shouldOpenCanvasOnResumeRef.current
    ) {
      hasTriggeredAutoExplainRef.current = true;
      shouldAutoExplainRef.current = false;
      startStudySetup();
    }
  }, [
    loadingMessages,
    loadingEntry,
    studyTitle,
    messages.length,
    startStudySetup,
  ]);

  // Scroll chat to specific question message (called from canvas markers)
  const scrollToQuestionMessage = useCallback(
    (messageId: string) => {
      const index = messages.findIndex((m) => m.id === messageId);
      if (index !== -1 && chatListRef.current) {
        chatListRef.current.scrollToIndex({
          index,
          animated: true,
          viewPosition: 0.3, // Position it at 30% from top for visibility
        });
      }
    },
    [messages],
  );

  // Scroll canvas area and highlight when clicking "View Notes" in chat
  const scrollToCanvasAnswer = useCallback(
    (answerLinkId: string) => {
      const link = answerLinks.find((l) => l.id === answerLinkId);

      // Switch to the correct page if needed
      if (link?.pageId && link.pageId !== activePageId) {
        handleSelectPage(link.pageId);
      }

      // Bring canvas section into view
      pageScrollRef.current?.scrollTo({ y: 0, animated: true });

      // Use a small delay to allow page switch to complete
      setTimeout(
        () => {
          if (link?.canvasBounds) {
            const pad = 24;
            const targetX = Math.max(link.canvasBounds.x - pad, 0);
            const targetY = Math.max(link.canvasBounds.y - pad, 0);

            canvasHScrollRef.current?.scrollTo({ x: targetX, animated: true });
            canvasScrollRef.current?.scrollTo({ y: targetY, animated: true });

            setHighlightedBounds({
              x: targetX,
              y: targetY,
              width: Math.min(
                link.canvasBounds.width + pad * 2,
                canvasSize.width - targetX,
              ),
              height: Math.min(
                link.canvasBounds.height + pad * 2,
                canvasSize.height - targetY,
              ),
            });
          } else {
            // Fallback: scroll to top of canvas and highlight whole area
            canvasScrollRef.current?.scrollTo({ y: 0, animated: true });
            setHighlightedBounds(null);
          }

          setHighlightedAnswerLinkId(answerLinkId);
          setTimeout(() => {
            setHighlightedAnswerLinkId(null);
            setHighlightedBounds(null);
          }, 2500);
        },
        link?.pageId && link.pageId !== activePageId ? 100 : 0,
      );
    },
    [
      answerLinks,
      canvasSize.width,
      canvasSize.height,
      activePageId,
      handleSelectPage,
    ],
  );

  const handleViewDiagram = useCallback(
    (blockId: string) => {
      const block = activeVisualBlocks.find((b) => b.id === blockId);
      if (!block) return;

      pageScrollRef.current?.scrollTo({ y: 0, animated: true });
      setTimeout(() => {
        canvasScrollRef.current?.scrollTo({
          y: Math.max(block.position.y - 24, 0),
          animated: true,
        });
        canvasHScrollRef.current?.scrollTo({
          x: Math.max(block.position.x - 24, 0),
          animated: true,
        });
        setHighlightedVisualBlockId(blockId);
        setTimeout(() => setHighlightedVisualBlockId(null), 2500);
      }, 100);
    },
    [activeVisualBlocks],
  );

  const getCitationLabel = useCallback(
    (citation: StudyCitation) => {
      const sourceName = citation.lectureFileId
        ? citationFileNames.get(citation.lectureFileId)
        : undefined;

      if (sourceName) {
        return citation.pageNumber
          ? `${sourceName} p. ${citation.pageNumber}`
          : sourceName;
      }

      return citation.pageNumber
        ? `Source p. ${citation.pageNumber}`
        : "Source";
    },
    [citationFileNames],
  );

  const getCitationSourceLabel = useCallback(
    (citation: StudyCitation) => {
      const sourceType =
        citation.sourceType ||
        (citation.lectureFileId
          ? citationFileMetadata.get(citation.lectureFileId)?.sourceType
          : undefined) ||
        "lecture";

      if (sourceType === "past_exam") return t("study.citationPastExam");
      if (sourceType === "exercise") return t("study.citationExercise");
      return t("study.citationLecture");
    },
    [citationFileMetadata, t],
  );

  const openCitationSource = useCallback(
    (citation: StudyCitation) => {
      if (!lecture) return;
      const file = lecture.files.find((f) => f.id === citation.lectureFileId);
      if (!file) return;
      setActiveCitation(citation);
    },
    [lecture],
  );

  const canvasReferences = useMemo(() => {
    const seen = new Set<string>();

    return messages
      .flatMap((message) =>
        message.role === "ai"
          ? (message.citations ?? []).map((citation, index) => ({
              citation,
              index,
              messageId: message.id,
            }))
          : [],
      )
      .filter(({ citation }) => {
        const key = citation.lectureFileId
          ? `${citation.lectureFileId}-${citation.pageNumber ?? "unknown"}-${citation.startLine ?? "line"}-${citation.endLine ?? "line"}`
          : `${citation.chunkId ?? "chunk"}-${citation.pageNumber ?? "unknown"}-${citation.startLine ?? "line"}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(({ citation, index, messageId }) => ({
        key: `${messageId}-${citation.lectureFileId ?? citation.chunkId ?? index}-${citation.pageNumber ?? "source"}-${citation.startLine ?? "line"}`,
        citation,
        label: getCitationLabel(citation),
        sourceLabel: getCitationSourceLabel(citation),
      }));
  }, [getCitationLabel, getCitationSourceLabel, messages]);

  // FlatList getItemLayout for reliable scrollToIndex
  const getItemLayout = useCallback(
    (_: any, index: number) => ({
      length: CHAT_ITEM_HEIGHT,
      offset: CHAT_ITEM_HEIGHT * index + 8 * index, // account for gap
      index,
    }),
    [],
  );

  // Toggle AI tutor visibility
  const toggleTutor = useCallback(() => {
    setTutorCollapsed((prev) => !prev);
  }, []);

  const canvasSurfaceAvailable = hasCanvasStudySurface(studyPhase, grading);
  const activeStudySurface = resolveStudySessionSurface({
    studyPhase,
    grading,
    preferredSurface: studySurfacePreference,
  });

  useEffect(() => {
    if (!canvasSurfaceAvailable && studySurfacePreference !== null) {
      setStudySurfacePreference(null);
    }
  }, [canvasSurfaceAvailable, studySurfacePreference]);

  const toggleStudyView = useCallback(() => {
    setStudySurfacePreference((currentPreference) => {
      const currentSurface = resolveStudySessionSurface({
        studyPhase,
        grading,
        preferredSurface: currentPreference,
      });

      return toggleStudySessionSurface(currentSurface, canvasSurfaceAvailable);
    });
  }, [canvasSurfaceAvailable, grading, studyPhase]);

  const handleToggleTts = useCallback(() => {
    if (isSpeaking) {
      stopSpeaking();
    }
    setTtsEnabled((prev) => !prev);
  }, [isSpeaking, stopSpeaking]);

  const handleToggleListening = useCallback(() => {
    setListeningMode((prev) => !prev);
  }, []);

  const handleRestartSession = useCallback(async () => {
    if (!lecture && !material) return;

    if (isSpeaking) {
      await stopSpeaking();
    }

    const sessionId = uuid();
    const sessionTitle = studyPlanEntry
      ? `${lecture?.title || material?.title || t("study.titleFallback")}: ${studyPlanEntry.title}`
      : lecture
        ? `${lecture.title} - Full Study`
        : `${material?.title || t("study.titleFallback")} session`;

    const newSession: StudySession = {
      id: sessionId,
      lectureId: lecture?.id,
      materialId: material?.id,
      studyPlanEntryId: studyPlanEntryId || undefined,
      title: sessionTitle,
      status: "active",
      createdAt: new Date().toISOString(),
    };

    if (getSupabase()) {
      await createSession(newSession);
    }

    const params = new URLSearchParams();
    if (lecture?.id) params.set("lectureId", lecture.id);
    if (material?.id) params.set("materialId", material.id);
    if (studyPlanEntryId) params.set("studyPlanEntryId", studyPlanEntryId);

    router.replace(`/study/${sessionId}?${params.toString()}`);
  }, [
    lecture,
    material,
    studyPlanEntry,
    studyPlanEntryId,
    t,
    isSpeaking,
    stopSpeaking,
    router,
  ]);

  if (
    (loadingMaterials || loadingLectures || loadingEntry || loadingMessages) &&
    !material &&
    !lecture
  ) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
        <ThemedText>{t("study.loading")}</ThemedText>
      </ThemedView>
    );
  }

  if (!material && !lecture) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText>{t("study.empty")}</ThemedText>
      </ThemedView>
    );
  }

  const showCanvasSurface = activeStudySurface === "canvas";
  const finalQuizProgressLabel =
    finalQuizState.status === "generating"
      ? t("study.finalQuizGenerating")
      : finalQuizState.status === "active"
        ? t("study.finalQuizProgress", {
            current: Math.min(
              finalQuizState.currentIndex + 1,
              finalQuizState.questions.length || FINAL_QUIZ_QUESTION_COUNT,
            ),
            total: finalQuizState.questions.length || FINAL_QUIZ_QUESTION_COUNT,
          })
        : null;
  const activeWarmupQuestion =
    studyPhase === "warmup" && warmupState.status === "active"
      ? (warmupState.questions[warmupState.currentIndex] ?? null)
      : null;
  const activeRecallQuestion = latestUnansweredTutorQuestionMessage
    ? {
        id:
          latestUnansweredTutorQuestionMessage.questionId ||
          latestUnansweredTutorQuestionMessage.id,
        prompt:
          latestUnansweredTutorQuestionMessage.tutorQuestion?.question ||
          getQuestionTextForMessage(latestUnansweredTutorQuestionMessage) ||
          "",
        targetConcepts:
          latestUnansweredTutorQuestionMessage.tutorQuestion?.targetConcepts,
        expectedAnswerPoints:
          latestUnansweredTutorQuestionMessage.tutorQuestion
            ?.expectedAnswerPoints,
        checkType: normalizeTutorCheckType(
          latestUnansweredTutorQuestionMessage.tutorQuestion?.checkType ||
            currentQuestion?.checkType ||
            nextDepthCheckType ||
            "recall",
        ),
      }
    : currentQuestion;
  const recallHintText =
    showCanvasSurface && !grading
      ? buildSocraticHint(activeRecallQuestion, t)
      : null;
  const warmupProgressLabel =
    studyPhase === "warmup"
      ? warmupState.status === "generating"
        ? t("study.warmupGenerating")
        : warmupState.status === "active"
          ? t("study.warmupProgress", {
              current: Math.min(
                warmupState.currentIndex + 1,
                warmupState.questions.length || WARMUP_QUESTION_COUNT,
              ),
              total: warmupState.questions.length || WARMUP_QUESTION_COUNT,
            })
          : null
      : null;

  return (
    <ThemedView style={styles.shell}>
      {showCanvasSurface ? (
        <StudyCanvasPanel
          styles={styles}
          palette={palette}
          t={t}
          tutorCollapsed
          lockedAnswerMode
          guidedNotesMode={studyPhase === "guided_notes"}
          guidedAudioAvailable={Boolean(guidedAudioReplay?.text)}
          guidedAudioPlaying={
            Boolean(guidedAudioReplay?.messageId) &&
            activeTtsMessageId === guidedAudioReplay?.messageId &&
            isSpeaking
          }
          canSubmitAnswer={studyPhase !== "guided_notes"}
          toggleTutor={toggleStudyView}
          studyTitle={studyTitle}
          studyOutline={studyOutline}
          studyPlanEntry={studyPlanEntry}
          canvasPages={canvasPages}
          activePageId={activePageId}
          activePage={activePage}
          canvasSize={canvasSize}
          canvasMode={canvasMode}
          canvasColor={canvasColor}
          onCanvasModeChange={handleCanvasModeChange}
          onCanvasColorChange={handleCanvasColorChange}
          onClearCanvas={handleClearCanvas}
          onUndo={handleUndo}
          onAddPage={handleAddPage}
          onSelectPage={handleSelectPage}
          onTitleStrokesChange={handleTitleStrokesChange}
          titleCanvasRef={titleCanvasRef}
          canvasRef={canvasRef}
          pageScrollRef={pageScrollRef}
          canvasScrollRef={canvasScrollRef}
          canvasHScrollRef={canvasHScrollRef}
          scrollEnabled={scrollEnabled}
          onDrawingStart={handleDrawingStart}
          onDrawingEnd={handleDrawingEnd}
          initialCanvasStrokes={initialCanvasStrokes}
          onCanvasStrokesChange={handleCanvasStrokesChange}
          activeVisualBlocks={activeVisualBlocks}
          highlightedVisualBlockId={highlightedVisualBlockId}
          onHighlightVisualBlock={setHighlightedVisualBlockId}
          highlightedAnswerLinkId={highlightedAnswerLinkId}
          highlightedBounds={highlightedBounds}
          onCanvasLayout={handleCanvasLayout}
          checkButtonPosition={checkButtonPosition}
          checkButtonAnimatedStyle={checkButtonAnimatedStyle}
          lastDrawingPosition={lastDrawingPosition}
          onSubmitAnswer={submitAnswer}
          grading={grading}
          answerMarkers={answerMarkers}
          onMarkerPress={scrollToQuestionMessage}
          answerText={answerText}
          onNotesChange={handleNotesChange}
          references={canvasReferences}
          onOpenCitation={openCitationSource}
          depthProgressItems={depthProgressItems}
          passScoreThreshold={targetPassScore}
          recallHintText={recallHintText}
          recallHintRevealed={recallHintRevealed}
          onRevealRecallHint={() => setRecallHintRevealed(true)}
          onReplayGuidedAudio={replayGuidedAudio}
          onStopGuidedAudio={stopGuidedAudioAndRevealAnswer}
        />
      ) : (
        <StudyChatPanel
          styles={styles}
          palette={palette}
          t={t}
          studyPlanEntry={studyPlanEntry}
          ttsEnabled={ttsEnabled}
          listeningMode={listeningMode}
          isChatting={isChatting}
          isSpeaking={isSpeaking}
          activeTtsMessageId={activeTtsMessageId}
          loadingQuestions={loadingQuestions}
          grading={grading}
          currentQuestion={currentQuestion}
          messages={messages}
          answerMarkers={answerMarkers}
          fullScreen
          canCollapseTutor={false}
          memorizationSecondsRemaining={memorizationSecondsRemaining}
          memorizationTotalSeconds={MEMORIZATION_SECONDS}
          warmupQuestion={activeWarmupQuestion}
          warmupSelectedOptionIndex={warmupState.selectedOptionIndex}
          warmupProgressLabel={warmupProgressLabel}
          warmupGenerating={
            studyPhase === "warmup" && warmupState.status === "generating"
          }
          onSelectWarmupOption={selectWarmupOption}
          onContinueWarmup={continueWarmup}
          finalQuizProgressLabel={finalQuizProgressLabel}
          depthProgressItems={depthProgressItems}
          passScoreThreshold={targetPassScore}
          studyMode={studyMode}
          studyPrepContent={studyPrepContent}
          setupActive={studyPhase === "setup"}
          onStudyModeChange={setStudyMode}
          onStartWarmup={startWarmupQuiz}
          mistakeNotebook={mistakeNotebook}
          diagnosticQuestion={
            studyPhase === "diagnostic"
              ? (latestDiagnosticQuestionMessage?.tutorQuestion?.question ??
                null)
              : null
          }
          chatListRef={chatListRef}
          getItemLayout={getItemLayout}
          onToggleTutor={toggleTutor}
          canvasViewAvailable={canvasSurfaceAvailable}
          onShowCanvas={toggleStudyView}
          onToggleTts={handleToggleTts}
          onToggleListening={handleToggleListening}
          onStopSpeaking={stopSpeaking}
          onRestartSession={handleRestartSession}
          onRequestExplanation={requestExplanation}
          onRequestQuestions={requestQuestions}
          onAddPage={handleAddPage}
          onNextQuestion={nextQuestion}
          onSendQuickAction={sendToFeynmanAI}
          onVoiceTranscription={handleVoiceTranscription}
          onListeningModeEnd={() => setListeningMode(false)}
          ttsFinished={!isSpeaking && listeningMode}
          getCitationLabel={getCitationLabel}
          getCitationSourceLabel={getCitationSourceLabel}
          onReplayMessage={speakMessage}
          onOpenCitation={openCitationSource}
          onViewNotes={scrollToCanvasAnswer}
          onViewDiagram={handleViewDiagram}
          onSubmitAnswer={submitAnswer}
          onSubmitDiagnosticAttempt={(text) =>
            submitDiagnosticAttempt(text, false)
          }
          onDiagnosticNoClue={() => submitDiagnosticAttempt("", true)}
          answerDraft={answerDraft}
          onAnswerDraftChange={setAnswerDraft}
        />
      )}

      {flashcardAdded && <StudyFlashcardToast styles={styles} t={t} />}
      {lecturePassedToast && <StudyLecturePassedToast styles={styles} t={t} />}
      <PdfReferenceModal
        visible={Boolean(activeCitation && activeCitationFile)}
        file={activeCitationFile}
        citation={activeCitation}
        label={activeCitation ? getCitationLabel(activeCitation) : undefined}
        sourceLabel={
          activeCitation ? getCitationSourceLabel(activeCitation) : undefined
        }
        onClose={() => setActiveCitation(null)}
      />
    </ThemedView>
  );
}
