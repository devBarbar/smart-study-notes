import * as FileSystem from "expo-file-system/legacy";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  LayoutChangeEvent,
  Linking,
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
  DEPTH_PASS_SCORE,
  buildDepthCheckProgressLine,
  buildDepthQuestion,
  canPassStudyPlanEntry,
  feedbackPassesDepthCheck,
  getNextTutorCheckType,
  getPassedDepthCheckTypes,
  REQUIRED_TUTOR_CHECK_TYPES,
  TUTOR_CHECK_DESCRIPTIONS,
  TUTOR_CHECK_LABELS,
  normalizeTutorCheckType,
} from "@/lib/depth-checks";

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
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { Colors } from "@/constants/theme";
import { useLanguage } from "@/contexts/language-context";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useLectures } from "@/hooks/use-lectures";
import { useMaterials } from "@/hooks/use-materials";
import { textToStrokes } from "@/lib/handwriting-font";
import { computeMasteryScore, computeNextReviewDate } from "@/lib/mastery";
import {
  ChatMessage,
  embedQuery,
  evaluateAnswer,
  generateQuestions,
  streamFeynmanChat,
} from "@/lib/openai";
import {
  createCanvasVisualBlock,
  estimateVisualBlockSize,
  parseAIResponse,
} from "@/lib/parse-visual-response";
import { parseLearningResponse } from "@/lib/parse-learning-response";
import { uploadCanvasImage } from "@/lib/storage";
import {
  LectureFileChunk,
  addReviewEvent,
  countLectureChunks,
  createSession,
  getSessionById,
  getStudyPlanEntry,
  getSupabase,
  getUserStreak,
  listAnswerLinks,
  listReviewEvents,
  listStudyDepthChecks,
  listSessionMessages,
  listStudyMisconceptions,
  saveAnswerLink,
  saveFlashcard,
  saveStudyDepthCheck,
  saveStudyMisconceptions,
  saveSessionMessage,
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
  CanvasStrokeData,
  CanvasVisualBlock as CanvasVisualBlockType,
  Lecture,
  LectureFile,
  Material,
  ReviewQuality,
  SectionStatus,
  StudyAnswerLink,
  StudyChatMessage,
  StudyCitation,
  StudyDepthCheck,
  StudyPlanEntry,
  StudyQuestion,
  StudySession,
} from "@/types";

// Estimated height for chat messages for scrollToIndex
const CHAT_ITEM_HEIGHT = 100;
const MEMORIZATION_SECONDS = 120;
const FINAL_QUIZ_QUESTION_COUNT = 5;
const FINAL_QUIZ_PASS_SCORE = DEPTH_PASS_SCORE;

// Initial canvas size (will grow as user draws near edges)
const INITIAL_CANVAS_WIDTH = 1400;
const INITIAL_CANVAS_HEIGHT = 1200;
// How much to grow the canvas when user reaches the edge
const CANVAS_GROW_CHUNK = 600;
// Threshold from edge to trigger growth (px)
const EDGE_THRESHOLD = 80;

const cleanSourceFileName = (nameOrUri: string) => {
  const withoutQuery = nameOrUri.split(/[?#]/)[0];
  const lastSegment = withoutQuery.split(/[\\/]/).filter(Boolean).pop() ?? nameOrUri;
  let decoded = lastSegment;

  try {
    decoded = decodeURIComponent(lastSegment);
  } catch {
    decoded = lastSegment;
  }

  return (
    decoded
      .replace(/\.(pdf|png|jpe?g|webp|heic|txt|docx?|pptx?|pages)$/i, "")
      .trim() || decoded
  );
};

type CitationSourceType = NonNullable<StudyCitation["sourceType"]>;

type CitationSourceMetadata = {
  name: string;
  sourceType: CitationSourceType;
};

type StudyPhase = "tutor" | "memorize" | "answer" | "grading" | "final_quiz";

type FinalQuizAnswer = {
  questionId: string;
  prompt: string;
  score?: number;
  checkType?: StudyQuestion["checkType"];
  summary: string;
};

type FinalQuizState = {
  status: "idle" | "generating" | "active" | "passed" | "failed";
  questions: StudyQuestion[];
  currentIndex: number;
  answers: FinalQuizAnswer[];
  averageScore?: number;
};

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? String(value);
};

const getVisualBlockSignature = (
  block: Pick<CanvasVisualBlockType, "type" | "data">,
) => `${block.type}:${stableStringify(block.data)}`;

const getVisualBlockInsertKey = (
  pageId: string,
  messageId: string,
  block: Pick<CanvasVisualBlockType, "type" | "data">,
) => `${pageId}:${messageId}:${getVisualBlockSignature(block)}`;

const getVisualBlockBottom = (block: CanvasVisualBlockType) =>
  block.position.y +
  (block.size?.height ?? estimateVisualBlockSize(block).height);

const dedupeVisualBlocks = (blocks: CanvasVisualBlockType[] = []) => {
  const seen = new Set<string>();

  return blocks.filter((block) => {
    const key = `${block.messageId}:${getVisualBlockSignature(block)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const normalizeCanvasPageVisualBlocks = (pages: CanvasPage[]) => {
  let changed = false;
  const normalizedPages = pages.map((page) => {
    if (!page.visualBlocks || page.visualBlocks.length === 0) {
      return page;
    }

    const dedupedBlocks = dedupeVisualBlocks(page.visualBlocks);
    if (dedupedBlocks.length === page.visualBlocks.length) {
      return page;
    }

    changed = true;
    return {
      ...page,
      visualBlocks: dedupedBlocks,
    };
  });

  return { changed, pages: normalizedPages };
};

const normalizeRepeatText = (value: string) =>
  value.replace(/\s+/g, " ").trim();

const collapseRepeatedTutorText = (text: string) => {
  const paragraphs = text
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length < 2 || paragraphs.length % 2 !== 0) {
    return text.trim();
  }

  const half = paragraphs.length / 2;
  const firstHalf = paragraphs.slice(0, half).join("\n\n");
  const secondHalf = paragraphs.slice(half).join("\n\n");

  if (
    normalizeRepeatText(firstHalf) &&
    normalizeRepeatText(firstHalf) === normalizeRepeatText(secondHalf)
  ) {
    return firstHalf;
  }

  return text.trim();
};

const PRACTICE_SOURCE_PATTERN =
  /\b(exercise|sheet|worksheet|practice|assignment|aufgabe|uebung|übung)\b/i;
const EXAM_SOURCE_PATTERN = /\b(exam|mock|klausur|probe)\b/i;

const getCitationSourceType = (file?: LectureFile): CitationSourceType => {
  if (!file?.isExam) return "lecture";

  const name = cleanSourceFileName(file.name || file.uri);
  if (PRACTICE_SOURCE_PATTERN.test(name) && !EXAM_SOURCE_PATTERN.test(name)) {
    return "exercise";
  }

  return "past_exam";
};

const uniqueChunksBySourcePage = (chunks: LectureFileChunk[]) => {
  const seen = new Set<string>();
  return chunks.filter((chunk) => {
    const key = `${chunk.lectureFileId}-${chunk.pageNumber ?? "unknown"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const tokenizeForCitationOverlap = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9äöüß]+/i)
      .filter((word) => word.length >= 5),
  );

const rankChunksByAnswerOverlap = (
  chunks: LectureFileChunk[],
  answerText?: string,
) => {
  if (!answerText?.trim()) return chunks;

  const answerTerms = tokenizeForCitationOverlap(answerText);
  if (answerTerms.size === 0) return chunks;

  const ranked = chunks
    .map((chunk, index) => {
      const chunkTerms = tokenizeForCitationOverlap(chunk.content);
      let overlap = 0;
      chunkTerms.forEach((term) => {
        if (answerTerms.has(term)) overlap += 1;
      });

      return {
        chunk,
        index,
        score: overlap * 10 + (chunk.similarity ?? 0),
      };
    })
    .filter((item) => item.score > (item.chunk.similarity ?? 0));

  if (ranked.length === 0) return chunks;

  const rankedIds = new Set(ranked.map((item) => item.chunk.id));
  return [
    ...ranked
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map((item) => item.chunk),
    ...chunks.filter((chunk) => !rankedIds.has(chunk.id)),
  ];
};

const balanceCitationChunks = (
  chunks: LectureFileChunk[],
  maxCount = 6,
  answerText?: string,
) => {
  const uniqueChunks = uniqueChunksBySourcePage(
    rankChunksByAnswerOverlap(chunks, answerText),
  );
  const lectureChunks = uniqueChunks.filter(
    (chunk) => chunk.sourceType === "lecture" || !chunk.sourceType,
  );
  const supportingChunks = uniqueChunks.filter(
    (chunk) => chunk.sourceType === "exercise" || chunk.sourceType === "past_exam",
  );

  const selected: LectureFileChunk[] = [];
  const addChunks = (sourceChunks: LectureFileChunk[], limit: number) => {
    for (const chunk of sourceChunks) {
      if (selected.length >= maxCount || limit <= 0) break;
      if (selected.some((existing) => existing.id === chunk.id)) continue;
      selected.push(chunk);
      limit -= 1;
    }
  };

  const lectureTarget = lectureChunks.length > 0 ? Math.min(4, maxCount) : 0;
  addChunks(lectureChunks, lectureTarget);
  addChunks(supportingChunks, maxCount - selected.length);
  addChunks(lectureChunks, maxCount - selected.length);
  addChunks(uniqueChunks, maxCount - selected.length);

  return selected;
};

export default function StudySessionScreen() {
  const { sessionId, materialId, lectureId, studyPlanEntryId } =
    useLocalSearchParams<{
      sessionId: string;
      materialId?: string;
      lectureId?: string;
      studyPlanEntryId?: string;
    }>();
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

  // Study plan entry for focused study
  const [studyPlanEntry, setStudyPlanEntry] = useState<StudyPlanEntry | null>(
    null,
  );
  const [loadingEntry, setLoadingEntry] = useState(false);
  const [recentMisconceptions, setRecentMisconceptions] = useState<string[]>([]);
  const [depthChecks, setDepthChecks] = useState<StudyDepthCheck[]>([]);

  // Load study plan entry if specified
  useEffect(() => {
    const loadEntry = async () => {
      if (!studyPlanEntryId) return;
      setLoadingEntry(true);
      try {
        const entry = await getStudyPlanEntry(studyPlanEntryId);
        setStudyPlanEntry(entry);
      } catch (err) {
        console.warn("[study] Failed to load study plan entry:", err);
      } finally {
        setLoadingEntry(false);
      }
    };
    loadEntry();
  }, [studyPlanEntryId]);

  useEffect(() => {
    const loadDepthChecks = async () => {
      if (!studyPlanEntryId) {
        setDepthChecks([]);
        return;
      }
      try {
        const checks = await listStudyDepthChecks(studyPlanEntryId);
        setDepthChecks(checks);
      } catch (err) {
        console.warn("[study] Failed to load depth checks:", err);
      }
    };

    loadDepthChecks();
  }, [studyPlanEntryId]);

  // Build the study title based on context
  const studyTitle = useMemo(() => {
    if (studyPlanEntry) {
      return `${lecture?.title || t("study.titleFallback")}: ${studyPlanEntry.title}`;
    }
    return lecture?.title ?? material?.title ?? t("study.titleFallback");
  }, [lecture, material, studyPlanEntry, t]);

  const nextDepthCheckType = useMemo(
    () => getNextTutorCheckType(depthChecks),
    [depthChecks],
  );

  const depthProgressLine = useMemo(
    () => buildDepthCheckProgressLine(depthChecks),
    [depthChecks],
  );

  const depthProgressItems = useMemo(() => {
    const passed = getPassedDepthCheckTypes(depthChecks);
    return REQUIRED_TUTOR_CHECK_TYPES.map((type) => ({
      type,
      label: TUTOR_CHECK_LABELS[type],
      passed: passed.has(type),
      current: nextDepthCheckType === type,
    }));
  }, [depthChecks, nextDepthCheckType]);

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
          "The topic should only be considered passed after recall, why, apply, transfer, and teach_back checks all score at least 90/100, followed by a final quiz.",
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
  }, [lecture, material, studyPlanEntry, recentMisconceptions, depthProgressLine, nextDepthCheckType]);

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
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [answerText, setAnswerText] = useState("");
  const [answerDraft, setAnswerDraft] = useState("");
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [grading, setGrading] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [answerLinks, setAnswerLinks] = useState<StudyAnswerLink[]>([]);

  // Multi-page canvas state
  const [canvasPages, setCanvasPages] = useState<CanvasPage[]>([]);
  const [activePageId, setActivePageId] = useState<string>("");

  // Get current page data
  const activePage = useMemo(
    () => canvasPages.find((p) => p.id === activePageId) || canvasPages[0],
    [canvasPages, activePageId],
  );

  // Canvas strokes for current page (derived from activePage)
  const canvasStrokes = useMemo(() => activePage?.strokes || [], [activePage]);

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

  // Scroll control for stylus drawing
  const [scrollEnabled, setScrollEnabled] = useState(true);

  // Drawing detection state
  const [hasDrawnAfterQuestion, setHasDrawnAfterQuestion] = useState(false);
  const [isCurrentlyDrawing, setIsCurrentlyDrawing] = useState(false);
  const [lastDrawingPosition, setLastDrawingPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);

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
  const [memorizationSecondsRemaining, setMemorizationSecondsRemaining] =
    useState<number | null>(null);
  const [memorizationMessageId, setMemorizationMessageId] = useState<
    string | null
  >(null);
  const [finalQuizState, setFinalQuizState] = useState<FinalQuizState>({
    status: "idle",
    questions: [],
    currentIndex: 0,
    answers: [],
  });
  const finalQuizStartedRef = useRef(false);
  const finalQuizPassedRef = useRef(false);

  // Flashcard added notification state
  const [flashcardAdded, setFlashcardAdded] = useState(false);
  const [lecturePassedToast, setLecturePassedToast] = useState(false);
  const hasShownLecturePassedToastRef = useRef(false);

  // Canvas size derived from active page (auto-grows as user draws near edges)
  const canvasSize = useMemo(
    () => ({
      width: activePage?.width || INITIAL_CANVAS_WIDTH,
      height: activePage?.height || INITIAL_CANVAS_HEIGHT,
    }),
    [activePage],
  );

  // Track if session messages have been loaded
  const [loadingMessages, setLoadingMessages] = useState(true);
  const hasLoadedMessagesRef = useRef(false);

  // Track if we should auto-explain on first load (new session with no messages)
  const shouldAutoExplainRef = useRef(false);
  const hasTriggeredAutoExplainRef = useRef(false);

  // Initial canvas strokes to restore (loaded from session) - for current active page
  const initialCanvasStrokes = useMemo(() => activePage?.strokes, [activePage]);

  // Visual blocks for the current active page
  const activeVisualBlocks = useMemo(
    () => dedupeVisualBlocks(activePage?.visualBlocks || []),
    [activePage],
  );

  useEffect(() => {
    messageIdsRef.current = new Set(messages.map((message) => message.id));
  }, [messages]);

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

  // Debounce timer for saving canvas data
  const saveCanvasDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const saveNotesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // Ref to track latest canvas pages for unmount save
  const canvasPagesRef = useRef<CanvasPage[]>([]);

  // Keep ref in sync with state
  useEffect(() => {
    canvasPagesRef.current = canvasPages;
  }, [canvasPages]);

  // Save on unmount - flush any pending saves
  useEffect(() => {
    return () => {
      // Clear pending debounced saves
      if (saveCanvasDebounceRef.current) {
        clearTimeout(saveCanvasDebounceRef.current);
      }
      if (saveNotesDebounceRef.current) {
        clearTimeout(saveNotesDebounceRef.current);
      }

      // Save canvas pages immediately on unmount
      if (sessionId && canvasPagesRef.current.length > 0) {
        // Use sync-like save (fire and forget since component is unmounting)
        updateSession(sessionId, { canvasPages: canvasPagesRef.current }).catch(
          (err) => {
            console.warn("[study] Failed to save canvas on unmount:", err);
          },
        );
        console.log("[study] Saving canvas pages on unmount");
      }
    };
  }, [sessionId]);

  // Create a new blank page
  const createNewPage = useCallback(
    (): CanvasPage => ({
      id: `page-${uuid()}`,
      titleStrokes: [],
      strokes: [],
      width: INITIAL_CANVAS_WIDTH,
      height: INITIAL_CANVAS_HEIGHT,
    }),
    [],
  );

  // Add a new page
  const handleAddPage = useCallback(() => {
    const newPage = createNewPage();
    setCanvasPages((prev) => [...prev, newPage]);
    setActivePageId(newPage.id);
    // Reset baseline for new page
    canvasBaselineRef.current = 0;
    hasInitializedCanvasRef.current = true;
    // New blank page should hide any previous check button position/state
    setHasDrawnAfterQuestion(false);
    setLastDrawingPosition(null);
  }, [createNewPage]);

  // Switch to a different page
  const handleSelectPage = useCallback(
    (pageId: string) => {
      if (pageId === activePageId) return;
      setActivePageId(pageId);
      // Update baseline for the new page
      const page = canvasPages.find((p) => p.id === pageId);
      canvasBaselineRef.current = page?.strokes.length || 0;
      hasInitializedCanvasRef.current = true;
    },
    [activePageId, canvasPages],
  );

  const canvasRef = useRef<HandwritingCanvasHandle>(null);
  const pageScrollRef = useRef<ScrollView>(null);
  const canvasScrollRef = useRef<ScrollView>(null);
  const canvasHScrollRef = useRef<ScrollView>(null);
  const chatListRef = useRef<FlatList<StudyChatMessage>>(null);
  const canvasBaselineRef = useRef(0);
  const hasInitializedCanvasRef = useRef(false);

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

        // Auto-grow canvas if drawing near edges (per-page)
        setCanvasPages((prev) =>
          prev.map((page) => {
            if (page.id !== activePageId) return page;

            let newWidth = page.width;
            let newHeight = page.height;

            // Check right edge
            if (lastPosition.x > page.width - EDGE_THRESHOLD) {
              newWidth = page.width + CANVAS_GROW_CHUNK;
            }
            // Check bottom edge
            if (lastPosition.y > page.height - EDGE_THRESHOLD) {
              newHeight = page.height + CANVAS_GROW_CHUNK;
            }

            // Only update if changed
            if (newWidth !== page.width || newHeight !== page.height) {
              return { ...page, width: newWidth, height: newHeight };
            }
            return page;
          }),
        );
      }

      // Show check button after drawing when there's conversation
      const hasAiMessages = messages.some((m) => m.role === "ai");
      if (hasAiMessages) {
        setHasDrawnAfterQuestion(true);
      }
    },
    [messages, activePageId],
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
    ) => {
      if (!activePage) return null;

      const existingBlock = activeVisualBlocks.find(
        (block) =>
          block.messageId === messageId &&
          getVisualBlockSignature(block) === getVisualBlockSignature(partialBlock),
      );
      if (existingBlock) {
        return { id: existingBlock.id, bottom: getVisualBlockBottom(existingBlock) };
      }

      const insertKey = getVisualBlockInsertKey(
        activePageId,
        messageId,
        partialBlock,
      );
      if (insertedVisualBlockKeysRef.current.has(insertKey)) {
        return null;
      }
      insertedVisualBlockKeysRef.current.add(insertKey);

      // Get current strokes directly from canvas ref (more reliable than state)
      const currentStrokes = canvasRef.current?.getStrokes() || canvasStrokes;

      // Calculate position - place below existing content
      const currentMaxY = customBaseY ?? getMaxYWithVisualBlocks(
        currentStrokes,
        activeVisualBlocks,
      );
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
          if (page.id !== activePageId) return page;

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
          updateSession(sessionId, { canvasPages: updatedPages })
            .catch((err) =>
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
      activeVisualBlocks,
      canvasStrokes,
      getMaxYWithVisualBlocks,
      sessionId,
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

  const writeQuestionToCanvas = useCallback(
    (questionText: string, customBaseY?: number) => {
      if (!activePage) return customBaseY ?? 0;

      const padding = 32;
      // Get fresh strokes from canvas ref and account for visual blocks
      const currentStrokes = canvasRef.current?.getStrokes() || canvasStrokes;
      
      // We add a safety buffer to ensure we don't overlap with recently added visual blocks
      const baseY = customBaseY ?? 
        (getMaxYWithVisualBlocks(currentStrokes, activeVisualBlocks) + 60);
      
      const availableWidth = Math.max(
        (activePage.width || canvasSize.width) - padding * 2,
        220,
      );

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

      if (generatedStrokes.length === 0) return baseY;

      const updatedStrokes = [...canvasStrokes, ...generatedStrokes];
      canvasRef.current?.setStrokes(updatedStrokes as CanvasStroke[]);

      setCanvasPages((prev) => {
        const updatedPages = prev.map((page) => {
          if (page.id !== activePageId) return page;
          const nextHeight = Math.max(page.height, baseY + textHeight + 60);
          const nextWidth = Math.max(page.width, padding + textWidth + 60);
          return {
            ...page,
            strokes: updatedStrokes,
            height: nextHeight,
            width: nextWidth,
          };
        });

        if (sessionId) {
          if (saveCanvasDebounceRef.current) {
            clearTimeout(saveCanvasDebounceRef.current);
          }
          saveCanvasDebounceRef.current = setTimeout(async () => {
            try {
              await updateSession(sessionId, { canvasPages: updatedPages });
              console.log(
                "[study] Canvas pages saved with",
                updatedPages.length,
                "pages (auto question)",
              );
            } catch (err) {
              console.warn(
                "[study] Failed to save canvas pages (auto question):",
                err,
              );
            }
          }, 800);
        }

        return updatedPages;
      });

      canvasBaselineRef.current = updatedStrokes.length;
      hasInitializedCanvasRef.current = true;

      setTimeout(() => {
        const scrollY = Math.max(baseY - 24, 0);
        canvasScrollRef.current?.scrollTo({ y: scrollY, animated: true });
        canvasHScrollRef.current?.scrollTo({ x: 0, animated: true });
      }, 150);

      return baseY + textHeight;
    },
    [
      activePage,
      activePageId,
      activeVisualBlocks,
      canvasColor,
      canvasSize.width,
      canvasStrokes,
      getMaxYWithVisualBlocks,
      sessionId,
      setCanvasPages,
    ],
  );

  // Load existing session data (messages, canvas, notes) from database
  useEffect(() => {
    const loadSessionData = async () => {
      if (!sessionId || hasLoadedMessagesRef.current) return;
      hasLoadedMessagesRef.current = true;
      setLoadingMessages(true);

      try {
        // Load session data (canvas + notes)
        const session = await getSessionById(sessionId);
        if (session) {
          // Restore canvas pages (prefer new format, fallback to old canvasData)
          if (session.canvasPages && session.canvasPages.length > 0) {
            const normalized = normalizeCanvasPageVisualBlocks(session.canvasPages);
            setCanvasPages(normalized.pages);
            setActivePageId(normalized.pages[0].id);
            canvasBaselineRef.current = normalized.pages[0].strokes.length;
            hasInitializedCanvasRef.current = true;
            if (normalized.changed) {
              updateSession(sessionId, { canvasPages: normalized.pages }).catch(
                (err) =>
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
            // Migrate old canvasData to new pages format
            const migratedPage: CanvasPage = {
              id: "page-1",
              titleStrokes: [],
              strokes: session.canvasData,
              width: INITIAL_CANVAS_WIDTH,
              height: INITIAL_CANVAS_HEIGHT,
            };
            setCanvasPages([migratedPage]);
            setActivePageId("page-1");
            canvasBaselineRef.current = session.canvasData.length;
            hasInitializedCanvasRef.current = true;
            console.log(
              "[study] Migrated canvas with",
              session.canvasData.length,
              "strokes to page format",
            );
          } else {
            // Create initial blank page
            const initialPage: CanvasPage = {
              id: "page-1",
              titleStrokes: [],
              strokes: [],
              width: INITIAL_CANVAS_WIDTH,
              height: INITIAL_CANVAS_HEIGHT,
            };
            setCanvasPages([initialPage]);
            setActivePageId("page-1");
            hasInitializedCanvasRef.current = true;
          }

          // Restore notes text
          if (session.notesText) {
            setAnswerText(session.notesText);
            console.log("[study] Restored notes text");
          }
        } else {
          // No session found, create initial blank page
          const initialPage: CanvasPage = {
            id: "page-1",
            titleStrokes: [],
            strokes: [],
            width: INITIAL_CANVAS_WIDTH,
            height: INITIAL_CANVAS_HEIGHT,
          };
          setCanvasPages([initialPage]);
          setActivePageId("page-1");
          hasInitializedCanvasRef.current = true;
        }

        // Load messages
        const savedMessages = await listSessionMessages(sessionId);

        if (savedMessages.length > 0) {
          // Restore messages from database
          setMessages(savedMessages);
          messageIdsRef.current = new Set(savedMessages.map((message) => message.id));

          // Rebuild chat history for AI context
          const history: ChatMessage[] = savedMessages
            .filter((m) => m.role !== "system")
            .map((m) => ({
              role: m.role === "ai" ? "assistant" : "user",
              content: m.text,
            }));
          setChatHistory(history);

          console.log(
            "[study] Restored session with",
            savedMessages.length,
            "messages",
          );
        }
      } catch (err) {
        console.warn("[study] Failed to load session data:", err);
      } finally {
        setLoadingMessages(false);
      }
    };

    loadSessionData();
  }, [sessionId]);

  // Mark that we should auto-explain when starting a new session (no saved messages)
  useEffect(() => {
    if (
      studyTitle &&
      messages.length === 0 &&
      !loadingEntry &&
      !loadingMessages &&
      !hasTriggeredAutoExplainRef.current
    ) {
      // Flag that we need to auto-explain once sendToFeynmanAI is ready
      shouldAutoExplainRef.current = true;
    }
  }, [studyTitle, messages.length, loadingEntry, loadingMessages]);

  useEffect(() => {
    const loadLinks = async () => {
      if (!sessionId) return;
      try {
        const links = await listAnswerLinks(sessionId as string);
        setAnswerLinks(links);
      } catch (err) {
        console.warn("[links] failed to load", err);
      }
    };
    loadLinks();
  }, [sessionId]);

  useEffect(() => {
    const loadMisconceptions = async () => {
      if (!lectureId) return;
      try {
        const rows = await listStudyMisconceptions({
          lectureId,
          studyPlanEntryId: studyPlanEntryId || undefined,
          limit: 8,
        });
        setRecentMisconceptions(
          rows.map((row) => `${row.concept}: ${row.note}`).filter(Boolean),
        );
      } catch (err) {
        console.warn("[study] Failed to load misconceptions:", err);
      }
    };

    loadMisconceptions();
  }, [lectureId, studyPlanEntryId]);

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

      const questionText = getQuestionTextForMessage(msg);
      if (!questionText) return;

      const trimmed = questionText.trim();
      const isLikelyQuestion = trimmed.endsWith("?") || Boolean(msg.questionId);
      if (!isLikelyQuestion) return;

      writtenQuestionIdsRef.current.add(msg.id);
      writeQuestionToCanvas(trimmed);
    });
  }, [
    messages,
    loadingMessages,
    getQuestionTextForMessage,
    writeQuestionToCanvas,
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
    setCanvasPages((prev) =>
      prev.map((page) =>
        page.id === activePageId ? { ...page, strokes: [] } : page,
      ),
    );
    canvasBaselineRef.current = 0;
    hasInitializedCanvasRef.current = true;
  }, [activePageId]);

  // Save canvas strokes to database (debounced) - per-page
  const handleCanvasStrokesChange = useCallback(
    (strokes: CanvasStroke[]) => {
      // Update strokes for the active page
      setCanvasPages((prev) => {
        const updatedPages = prev.map((page) =>
          page.id === activePageId
            ? { ...page, strokes: strokes as CanvasStrokeData[] }
            : page,
        );

        // Save to database (debounced)
        if (sessionId) {
          if (saveCanvasDebounceRef.current) {
            clearTimeout(saveCanvasDebounceRef.current);
          }

          saveCanvasDebounceRef.current = setTimeout(async () => {
            try {
              await updateSession(sessionId, { canvasPages: updatedPages });
              console.log(
                "[study] Canvas pages saved with",
                updatedPages.length,
                "pages",
              );
            } catch (err) {
              console.warn("[study] Failed to save canvas pages:", err);
            }
          }, 1000);
        }

        return updatedPages;
      });

      if (!hasInitializedCanvasRef.current) {
        canvasBaselineRef.current = strokes.length;
        hasInitializedCanvasRef.current = true;
      }
    },
    [sessionId, activePageId],
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
      setCanvasPages((prev) => {
        const updatedPages = prev.map((page) =>
          page.id === activePageId
            ? { ...page, titleStrokes: strokes as CanvasStrokeData[] }
            : page,
        );

        // Save to database (debounced)
        if (sessionId) {
          if (saveCanvasDebounceRef.current) {
            clearTimeout(saveCanvasDebounceRef.current);
          }

          saveCanvasDebounceRef.current = setTimeout(async () => {
            try {
              await updateSession(sessionId, { canvasPages: updatedPages });
              console.log("[study] Title strokes saved");
            } catch (err) {
              console.warn("[study] Failed to save title strokes:", err);
            }
          }, 1000);
        }

        return updatedPages;
      });
    },
    [sessionId, activePageId],
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
    return [...messages]
      .reverse()
      .find((message) => {
        if (message.role !== "ai" || !message.tutorQuestion?.question) {
          return false;
        }
        const questionKey = message.questionId ?? message.id;
        return !answeredQuestionIds.has(questionKey);
      });
  }, [answeredQuestionIds, messages]);

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

    const questionText = getQuestionTextForMessage(
      latestUnansweredTutorQuestionMessage,
    );
    if (
      questionText &&
      !writtenQuestionIdsRef.current.has(latestUnansweredTutorQuestionMessage.id)
    ) {
      writtenQuestionIdsRef.current.add(latestUnansweredTutorQuestionMessage.id);
      writeQuestionToCanvas(questionText);
    }

    setTutorCollapsed(false);
    setMemorizationMessageId(latestUnansweredTutorQuestionMessage.id);
    setMemorizationSecondsRemaining(MEMORIZATION_SECONDS);
    setStudyPhase(
      latestUnansweredTutorQuestionMessage.tutorQuestion?.assessmentKind ===
        "final_quiz"
        ? "final_quiz"
        : "memorize",
    );
  }, [
    getQuestionTextForMessage,
    grading,
    isChatting,
    latestUnansweredTutorQuestionMessage,
    loadingEntry,
    loadingMessages,
    memorizationMessageId,
    writeQuestionToCanvas,
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
            lectureMatches: chunks.filter((chunk) => chunk.sourceType === "lecture")
              .length,
            supportingMatches: chunks.filter(
              (chunk) =>
                chunk.sourceType === "exercise" ||
                chunk.sourceType === "past_exam",
            ).length,
          });
        }
        return balanceCitationChunks(chunks, matchCount);
      } catch (err) {
        console.warn("[study] retrieval failed, falling back to full context", err);
        return [];
      }
    },
    [buildRetrievalQuery, citationFileMetadata, lecture, lectureId],
  );

  const chunksToContextBlock = useCallback(
    (chunks: LectureFileChunk[]) =>
      `Use the following source snippets. Prefer lecture material for explanations, and use exercises or past exams as supporting high-yield examples. Cite only snippets that directly support the answer and keep answers concise.\n\n${chunks
        .map((chunk, idx) => {
          const source = citationFileMetadata.get(chunk.lectureFileId);
          const sourceName = source?.name ?? "Source";
          const sourceType = source?.sourceType ?? chunk.sourceType ?? "lecture";
          return `[${idx + 1}] ${sourceType.replace("_", " ")}: ${sourceName} (p${chunk.pageNumber}) ${chunk.content}`;
        })
        .join("\n\n")}`,
    [citationFileMetadata],
  );

  const chunksToCitations = useCallback(
    (chunks: LectureFileChunk[], answerText?: string): StudyCitation[] =>
      balanceCitationChunks(chunks, 6, answerText).map((chunk) => ({
        chunkId: chunk.id,
        lectureId: chunk.lectureId,
        lectureFileId: chunk.lectureFileId,
        pageNumber: chunk.pageNumber,
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
    ) => {
      if (!userMessage.trim()) return;

      // Add transcription cost suffix if provided (from voice input)
      const transcriptionCostSuffix = transcriptionCostUsd
        ? ` _${t("cost.label", { value: transcriptionCostUsd.toFixed(4) })}_`
        : "";

      const userMsgId = uuid();
      pushMessage(
        {
          id: userMsgId,
          role: "user",
          text: userMessage + transcriptionCostSuffix,
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

      try {
        const retrievedChunks = await fetchRelevantChunks(
          retrievalQuery ?? userMessage,
          6,
        );

        const contextBlock =
          retrievedChunks.length > 0
            ? chunksToContextBlock(retrievedChunks)
            : fullMaterialContext;

        // Use streaming chat - update message as chunks arrive
        const chatResult = await streamFeynmanChat(
          updatedHistory,
          contextBlock,
          agentLanguage,
          lectureId,
          {
            onChunk: (partialText) => {
              // Update the AI message with the partial text
              updateMessage(aiMsgId, { text: partialText });
            },
            onDone: (result) => {
              if (completedAiMessageIdsRef.current.has(aiMsgId)) {
                return;
              }
              completedAiMessageIdsRef.current.add(aiMsgId);

              const learningParsed = parseLearningResponse(result.message);
              const parsed = parseAIResponse(learningParsed.text);
              const visibleTutorText = collapseRepeatedTutorText(parsed.text);

              // Add cost footer if available
              const costSuffix = result.costUsd
                ? `\n\n_${t("cost.label", { value: result.costUsd.toFixed(4) })}_`
                : "";

              // Track visual block IDs added for this message
              const visualBlockIds: string[] = [];

              // Determine starting position on canvas
              const currentStrokes = canvasRef.current?.getStrokes() || canvasStrokes;
              let currentBatchY =
                getMaxYWithVisualBlocks(currentStrokes, activeVisualBlocks) + 40;

              // Extract any question from the AI response
              const tempMsg: StudyChatMessage = {
                id: aiMsgId,
                role: "ai",
                text: visibleTutorText,
                tutorQuestion: learningParsed.tutorQuestion,
              };
              const questionText =
                learningParsed.tutorQuestion?.question ||
                getQuestionTextForMessage(tempMsg);

              // 1. Add visual blocks first, stacked below existing content
              if (parsed.hasVisuals) {
                for (const partialBlock of parsed.visualBlocks) {
                  const result = addVisualBlockToCanvas(
                    partialBlock,
                    aiMsgId,
                    currentBatchY,
                  );
                  if (result) {
                    visualBlockIds.push(result.id);
                    // Add extra padding between blocks
                    currentBatchY = result.bottom + 20;
                  }
                }
                console.log(
                  "[study] Added",
                  parsed.visualBlocks.length,
                  "visual blocks from AI response",
                );
              }

              // 2. Place the question after the last inserted element
              if (questionText && !writtenQuestionIdsRef.current.has(aiMsgId)) {
                writtenQuestionIdsRef.current.add(aiMsgId);
                // writeQuestionToCanvas returns the bottom Y coordinate
                currentBatchY = writeQuestionToCanvas(questionText, currentBatchY);
              }

              // Final update with citations, cost, and visual block references
              const citations: StudyCitation[] | undefined =
                retrievedChunks.length > 0
                  ? chunksToCitations(retrievedChunks, visibleTutorText)
                  : undefined;

              const finalMessage: StudyChatMessage = {
                id: aiMsgId,
                role: "ai",
                text: visibleTutorText + costSuffix, // Use cleaned text without visual blocks
                citations,
                tutorQuestion: learningParsed.tutorQuestion,
                visualBlockIds:
                  visualBlockIds.length > 0 ? visualBlockIds : undefined,
              };
              updateMessage(aiMsgId, finalMessage);

              // Speak the cleaned message (without visual block JSON)
              speakMessage(visibleTutorText, aiMsgId);

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
        const historyParsed = parseAIResponse(historyLearningParsed.text);
        setChatHistory((prev) => [
          ...prev,
          {
            role: "assistant",
            content: collapseRepeatedTutorText(historyParsed.text),
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
      chunksToCitations,
      chunksToContextBlock,
      fetchRelevantChunks,
      fullMaterialContext,
      getMaxYWithVisualBlocks,
      getQuestionTextForMessage,
      lectureId,
      pushMessage,
      updateMessage,
      speakMessage,
      t,
      sessionId,
      addVisualBlockToCanvas,
      writeQuestionToCanvas,
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
        console.warn("[study] Failed to mark topic passed after final quiz", err);
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
          entry.id === studyPlanEntryId ? { ...entry, status: "passed" } : entry,
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
    if (finalQuizStartedRef.current || finalQuizPassedRef.current || !studyPlanEntry) {
      return;
    }

    finalQuizStartedRef.current = true;
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

      const quizQuestions = generatedQuizQuestions.slice(0, FINAL_QUIZ_QUESTION_COUNT).map(
        (question, index): StudyQuestion => {
          const checkType =
            REQUIRED_TUTOR_CHECK_TYPES[index % REQUIRED_TUTOR_CHECK_TYPES.length];
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
        },
      );

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
    setMemorizationSecondsRemaining(null);
    setTutorCollapsed(false);
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

      setStudyPhase("grading");

      const gradingChunks = await fetchRelevantChunks(
        `${questionToEvaluate.prompt}\n${answerDraft || answerText}`,
        6,
      );
      const gradingContext =
        gradingChunks.length > 0
          ? chunksToContextBlock(gradingChunks)
          : fullMaterialContext;
      const gradingCitations =
        gradingChunks.length > 0 ? chunksToCitations(gradingChunks) : undefined;

      const feedback = await evaluateAnswer(
        {
          question: questionToEvaluate,
          answerText: answerDraft,
          answerImageDataUrl: dataUrl,
          lectureId,
          gradingContext,
        },
        agentLanguage,
      );

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
        feedback.checkType || questionToEvaluate.checkType || nextDepthCheckType || "recall",
      );
      const depthCheckPassed =
        !isFinalQuizAnswer &&
        feedbackPassesDepthCheck({
          ...feedback,
          score: normalizedScore,
        });
      const canCountForPass =
        !isFinalQuizAnswer &&
        depthCheckPassed &&
        questionToEvaluate.requiredForPass !== false;
      const localDepthCheck: StudyDepthCheck | null = !isFinalQuizAnswer && studyPlanEntryId
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
          latestDepthChecks = [savedDepthCheck ?? localDepthCheck, ...depthChecks];
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
        if (canPassStudyPlanEntry(checks)) {
          return finalQuizPassedRef.current ? "passed" : "in_progress";
        }
        const passedDepthCount = getPassedDepthCheckTypes(checks).size;
        if (typeof score === "number" && score <= 40 && passedDepthCount === 0) {
          return "failed";
        }
        if (correctness === "incorrect" && passedDepthCount === 0) {
          return "failed";
        }
        return "in_progress";
      };

      // Update study plan entry status when focusing on a specific section
      if (studyPlanEntryId && !isFinalQuizAnswer) {
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
      const isCheckPassed =
        isFinalQuizAnswer
          ? typeof normalizedScore === "number" &&
            normalizedScore >= FINAL_QUIZ_PASS_SCORE
          : depthCheckPassed;
      const isTopicDepthPassed = studyPlanEntryId
        ? canPassStudyPlanEntry(latestDepthChecks)
        : isCheckPassed;
      const nextMissingCheckType = studyPlanEntryId
        ? getNextTutorCheckType(latestDepthChecks)
        : null;

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
          setRecentMisconceptions((prev) => [
            ...savedMisconceptions.map((item) => `${item.concept}: ${item.note}`),
            ...prev,
          ].slice(0, 8));
        } catch (err) {
          console.warn("[study] Failed to save misconceptions:", err);
        }
      }

      if (!isFinalQuizAnswer && isCheckPassed && lectureId) {
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

      const scoreText = typeof feedback.score === "number"
        ? `\n\n${t("study.scoreLabel", { score: feedback.score })}`
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
        finalQuizAverage >= FINAL_QUIZ_PASS_SCORE;
      const nextFinalQuizIndex = finalQuizState.currentIndex + 1;
      const nextFinalQuizQuestion =
        isFinalQuizAnswer && !finalQuizComplete
          ? finalQuizState.questions[nextFinalQuizIndex]
          : undefined;
      const weakestFinalQuizAnswer = nextFinalQuizAnswers.reduce<
        FinalQuizAnswer | null
      >((weakest, answer) => {
        if (!weakest) return answer;
        return (answer.score ?? 0) < (weakest.score ?? 0) ? answer : weakest;
      }, null);
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
        isCheckPassed &&
        isTopicDepthPassed &&
        Boolean(studyPlanEntry) &&
        !finalQuizStartedRef.current &&
        !finalQuizPassedRef.current;
      const followUpQuestion: StudyQuestion | null =
        finalQuizRestartQuestion
          ? finalQuizRestartQuestion
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
              isCheckPassed &&
              !isTopicDepthPassed &&
              nextMissingCheckType &&
              studyPlanEntry
            ? {
                id: `depth-${nextMissingCheckType}-${uuid()}`,
                prompt: buildDepthQuestion(nextMissingCheckType, studyPlanEntry),
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
      const followUpText =
        followUpQuestion
          ? `\n\n${t("study.feedback.followUpIntro")}\n${followUpQuestion.prompt}`
          : "";
      const costText = feedback.costUsd
        ? `\n\n_${t("cost.label", { value: feedback.costUsd.toFixed(4) })}_`
        : "";
      const depthProgressText = studyPlanEntryId
        ? `\n\n${t("study.depthProgress")}: ${buildDepthCheckProgressLine(latestDepthChecks)}`
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
                total: finalQuizState.questions.length || FINAL_QUIZ_QUESTION_COUNT,
              })}`
            : "";

      const feedbackText = `${correctnessText}\n\n${feedback.summary}${scoreText}${depthProgressText}${finalQuizText}${sourceNotesText}${improvementsText}${followUpText}\n\n${t("study.feedback.askExplain")}${costText}`;

      pushMessage({
        id: uuid(),
        role: "ai",
        text: feedbackText,
        questionId: followUpQuestion?.id ?? questionToEvaluate.id,
        answerLinkId: linkId,
        citations: gradingCitations,
        tutorQuestion: followUpQuestion
          ? {
              question: followUpQuestion.prompt,
              targetConcepts: followUpQuestion.targetConcepts,
              expectedAnswerPoints: followUpQuestion.expectedAnswerPoints,
              checkType: followUpQuestion.checkType,
              requiredForPass: followUpQuestion.requiredForPass,
              difficulty: followUpQuestion.difficulty,
              assessmentKind: followUpQuestion.assessmentKind,
            }
          : undefined,
      });

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
        setStudyPhase(finalQuizState.status === "active" ? "final_quiz" : "tutor");
      }
      setAnswerDraft("");
    } catch (error) {
      console.warn(error);
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
      ? `The next required pass-gate checkType is "${nextDepthCheckType}" (${TUTOR_CHECK_LABELS[nextDepthCheckType]}). The hidden learning_question must use that checkType, and the student needs 90+/100 for it to count.`
      : "All depth checks are already passed; ask a concise retention or exam-style review question.";
    const topicFocus = studyPlanEntry
      ? `Give me a concise (1-2 short paragraphs) explanation of the next key idea from "${studyPlanEntry.title}". Focus on ${studyPlanEntry.keyConcepts?.join(", ") || "the main ideas"}, cover one step only. ${nextCheckInstruction} ${visualInstruction} End with exactly one check-in question asking me to explain it back or apply it. Then stop and wait for my reply - I will answer on the canvas.`
      : `Give me a concise (1-2 short paragraphs) explanation of the first key idea in this topic. Cover one step only. ${visualInstruction} End with exactly one check-in question asking me to explain it back or apply it. Stop and wait for my reply—I will answer on the canvas.`;
    sendToFeynmanAI(topicFocus, undefined, retrievalFocus || topicFocus);
  }, [lecture, nextDepthCheckType, sendToFeynmanAI, studyPlanEntry]);

  // Auto-trigger explanation when starting a new session
  useEffect(() => {
    if (
      shouldAutoExplainRef.current &&
      !hasTriggeredAutoExplainRef.current &&
      !loadingMessages &&
      !loadingEntry &&
      studyTitle &&
      messages.length === 0
    ) {
      hasTriggeredAutoExplainRef.current = true;
      shouldAutoExplainRef.current = false;
      // Trigger the explanation automatically
      requestExplanation();
    }
  }, [loadingMessages, loadingEntry, studyTitle, messages.length, requestExplanation]);

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

      return citation.pageNumber ? `Source p. ${citation.pageNumber}` : "Source";
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
      const targetUrl = citation.pageNumber
        ? `${file.uri}#page=${citation.pageNumber}`
        : file.uri;
      Linking.openURL(targetUrl).catch((err) =>
        console.warn("[study] Failed to open source", err),
      );
    },
    [lecture],
  );

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

  const showCanvasSurface = studyPhase === "answer";
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

  return (
    <ThemedView style={styles.shell}>
      {showCanvasSurface ? (
        <StudyCanvasPanel
          styles={styles}
          palette={palette}
          t={t}
          tutorCollapsed
          lockedAnswerMode
          toggleTutor={toggleTutor}
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
          depthProgressItems={depthProgressItems}
        />
      ) : (
        <StudyChatPanel
          styles={styles}
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
          finalQuizProgressLabel={finalQuizProgressLabel}
          chatListRef={chatListRef}
          getItemLayout={getItemLayout}
          onToggleTutor={toggleTutor}
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
          answerDraft={answerDraft}
          onAnswerDraftChange={setAnswerDraft}
        />
      )}

      {flashcardAdded && <StudyFlashcardToast styles={styles} t={t} />}
      {lecturePassedToast && <StudyLecturePassedToast styles={styles} t={t} />}
    </ThemedView>
  );
}
