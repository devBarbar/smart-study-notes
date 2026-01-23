import * as FileSystem from "expo-file-system/legacy";
import { useLocalSearchParams } from "expo-router";
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
  CanvasMode,
  CanvasStroke,
  HandwritingCanvasHandle,
} from "@/components/handwriting-canvas";
import { StudyCanvasPanel } from "@/components/study/study-canvas-panel";
import { StudyChatCollapsed } from "@/components/study/study-chat-collapsed";
import { StudyChatPanel } from "@/components/study/study-chat-panel";
import { StudyFlashcardToast } from "@/components/study/study-flashcard-toast";
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
import { uploadCanvasImage } from "@/lib/storage";
import {
  LectureFileChunk,
  addReviewEvent,
  countLectureChunks,
  getSessionById,
  getStudyPlanEntry,
  getUserStreak,
  listAnswerLinks,
  listReviewEvents,
  listSessionMessages,
  saveAnswerLink,
  saveFlashcard,
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
  Material,
  ReviewQuality,
  SectionStatus,
  StudyAnswerLink,
  StudyChatMessage,
  StudyCitation,
  StudyPlanEntry,
  StudyQuestion,
} from "@/types";

// Estimated height for chat messages for scrollToIndex
const CHAT_ITEM_HEIGHT = 100;

// Initial canvas size (will grow as user draws near edges)
const INITIAL_CANVAS_WIDTH = 1400;
const INITIAL_CANVAS_HEIGHT = 1200;
// How much to grow the canvas when user reaches the edge
const CANVAS_GROW_CHUNK = 600;
// Threshold from edge to trigger growth (px)
const EDGE_THRESHOLD = 80;

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
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? "light"];
  const styles = useMemo(() => createStudyStyles(palette), [palette]);

  const material = useMemo<Material | undefined>(
    () => materials.find((m) => m.id === materialId),
    [materials, materialId],
  );
  const lecture = useMemo<Lecture | undefined>(
    () => lectures.find((l) => l.id === lectureId),
    [lectures, lectureId],
  );

  // Study plan entry for focused study
  const [studyPlanEntry, setStudyPlanEntry] = useState<StudyPlanEntry | null>(
    null,
  );
  const [loadingEntry, setLoadingEntry] = useState(false);

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

  // Build the study title based on context
  const studyTitle = useMemo(() => {
    if (studyPlanEntry) {
      return `${lecture?.title || t("study.titleFallback")}: ${studyPlanEntry.title}`;
    }
    return lecture?.title ?? material?.title ?? t("study.titleFallback");
  }, [lecture, material, studyPlanEntry, t]);

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
    }

    return parts.join("\n\n");
  }, [lecture, material, studyPlanEntry]);

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
  const [tutorCollapsed, setTutorCollapsed] = useState(false);

  // Flashcard added notification state
  const [flashcardAdded, setFlashcardAdded] = useState(false);

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
    () => activePage?.visualBlocks || [],
    [activePage],
  );

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
    ) => {
      if (!activePage) return;

      // Get current strokes directly from canvas ref (more reliable than state)
      const currentStrokes = canvasRef.current?.getStrokes() || canvasStrokes;

      // Calculate position - place below existing content
      const currentMaxY = getMaxYWithVisualBlocks(
        currentStrokes,
        activeVisualBlocks,
      );
      const padding = 40;
      const position = { x: padding, y: currentMaxY + padding };

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
          const newBlocks = [...existingBlocks, fullBlock];

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
            .then(() =>
              console.log("[study] Canvas pages saved with visual block"),
            )
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

      return fullBlock.id;
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
    (questionText: string) => {
      if (!activePage) return;

      const padding = 32;
      // Get fresh strokes from canvas ref and account for visual blocks
      const currentStrokes = canvasRef.current?.getStrokes() || canvasStrokes;
      const baseY =
        getMaxYWithVisualBlocks(currentStrokes, activeVisualBlocks) + 40;
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

      if (generatedStrokes.length === 0) return;

      const updatedStrokes = [...canvasStrokes, ...generatedStrokes];
      canvasRef.current?.setStrokes(updatedStrokes as CanvasStroke[]);

      setCanvasPages((prev) => {
        const updatedPages = prev.map((page) => {
          if (page.id !== activePageId) return page;
          const nextHeight = Math.max(page.height, baseY + textHeight + 48);
          const nextWidth = Math.max(page.width, padding + textWidth + 48);
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
            setCanvasPages(session.canvasPages);
            setActivePageId(session.canvasPages[0].id);
            canvasBaselineRef.current = session.canvasPages[0].strokes.length;
            hasInitializedCanvasRef.current = true;
            console.log(
              "[study] Restored",
              session.canvasPages.length,
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
      setMessages((prev) => [...prev, message]);
      if (speak && message.role === "ai") {
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

  // Send message to Feynman AI with FULL material context (streaming enabled)
  const sendToFeynmanAI = useCallback(
    async (userMessage: string, transcriptionCostUsd?: number) => {
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
      pushMessage({ id: aiMsgId, role: "ai", text: "" }, false);

      try {
        let retrievedChunks: LectureFileChunk[] = [];
        if (lectureId && lecture) {
          try {
            const chunkCount = await countLectureChunks(lectureId);
            if ((chunkCount ?? 0) > 0) {
              const queryEmbedding = await embedQuery(
                studyPlanEntry
                  ? `${studyPlanEntry.title}\n${userMessage}`
                  : userMessage,
              );
              retrievedChunks = await searchLectureChunks(
                queryEmbedding,
                [lectureId],
                6,
                0.15,
              );
              if (retrievedChunks.length > 0) {
                console.log("[study] retrieval matches", {
                  matches: retrievedChunks.length,
                  topSimilarity: retrievedChunks[0]?.similarity,
                });
              }
            }
          } catch (err) {
            console.warn(
              "[study] retrieval failed, falling back to full context",
              err,
            );
          }
        }

        const contextBlock =
          retrievedChunks.length > 0
            ? `Use the following source snippets. Prefer citing the most relevant ones and keep answers concise.\n\n${retrievedChunks
                .map(
                  (chunk, idx) =>
                    `[${idx + 1}] (p${chunk.pageNumber}) ${chunk.content}`,
                )
                .join("\n\n")}`
            : fullMaterialContext;

        const citations: StudyCitation[] | undefined =
          retrievedChunks.length > 0
            ? retrievedChunks.slice(0, 6).map((chunk) => ({
                chunkId: chunk.id,
                lectureId: chunk.lectureId,
                lectureFileId: chunk.lectureFileId,
                pageNumber: chunk.pageNumber,
                similarity: chunk.similarity,
              }))
            : undefined;

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
              // Parse the response for visual blocks
              const parsed = parseAIResponse(result.message);

              // Add cost footer if available
              const costSuffix = result.costUsd
                ? `\n\n_${t("cost.label", { value: result.costUsd.toFixed(4) })}_`
                : "";

              // Track visual block IDs added for this message
              const visualBlockIds: string[] = [];

              // Add visual blocks to canvas if present
              if (parsed.hasVisuals) {
                for (const partialBlock of parsed.visualBlocks) {
                  const blockId = addVisualBlockToCanvas(partialBlock, aiMsgId);
                  if (blockId) {
                    visualBlockIds.push(blockId);
                  }
                }
                console.log(
                  "[study] Added",
                  parsed.visualBlocks.length,
                  "visual blocks from AI response",
                );
              }

              // Final update with citations, cost, and visual block references
              const finalMessage: StudyChatMessage = {
                id: aiMsgId,
                role: "ai",
                text: parsed.text + costSuffix, // Use cleaned text without visual blocks
                citations,
                visualBlockIds:
                  visualBlockIds.length > 0 ? visualBlockIds : undefined,
              };
              updateMessage(aiMsgId, finalMessage);

              // Speak the cleaned message (without visual block JSON)
              speakMessage(parsed.text, aiMsgId);

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
        setChatHistory((prev) => [
          ...prev,
          { role: "assistant", content: chatResult.message },
        ]);
      } catch (error) {
        console.warn("Feynman chat error:", error);
        // Update the placeholder message with error
        updateMessage(aiMsgId, { text: t("common.errorGeneric") });
      } finally {
        setIsChatting(false);
      }
    },
    [
      agentLanguage,
      chatHistory,
      fullMaterialContext,
      lecture,
      lectureId,
      pushMessage,
      updateMessage,
      speakMessage,
      studyPlanEntry,
      t,
      sessionId,
      addVisualBlockToCanvas,
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
        pushMessage({
          id: uuid(),
          role: "ai",
          text: t("study.firstQuestionIntro", {
            question: generated[0].prompt,
          }),
          questionId: generated[0].id,
        });
        setCurrentQuestion(generated[0]);
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
    setCurrentQuestion(next);
    setHasDrawnAfterQuestion(false); // Reset drawing detection for new question
    pushMessage({
      id: uuid(),
      role: "ai",
      text: t("study.nextQuestionIntro", { question: next.prompt }),
      questionId: next.id,
    });
  };

  const submitAnswer = async () => {
    // Get question context - either from formal quiz or last AI message
    const lastAiMessage = [...messages].reverse().find((m) => m.role === "ai");

    // Use current formal question or create one from the last AI message
    const questionToEvaluate: StudyQuestion = currentQuestion || {
      id: lastAiMessage?.id || uuid(),
      prompt: lastAiMessage?.text || t("study.defaultCheckPrompt"),
    };

    if (!lastAiMessage && !currentQuestion) return;

    setGrading(true);
    try {
      const imageUri = await canvasRef.current?.exportAsImage();
      const base64 = imageUri
        ? await FileSystem.readAsStringAsync(imageUri, {
            encoding: FileSystem.EncodingType.Base64,
          })
        : undefined;
      const dataUrl = base64 ? `data:image/png;base64,${base64}` : undefined;
      const feedback = await evaluateAnswer(
        {
          question: questionToEvaluate,
          answerText,
          answerImageDataUrl: dataUrl,
          lectureId,
        },
        agentLanguage,
      );

      let uploadedImageUri: string | undefined;
      if (imageUri) {
        const uploaded = await uploadCanvasImage(imageUri);
        uploadedImageUri = uploaded.publicUrl;
      }

      const canvasBounds = getNewStrokeBounds();

      const linkId = uuid();
      const link: StudyAnswerLink = {
        id: linkId,
        sessionId: sessionId as string,
        questionId: questionToEvaluate.id,
        pageId: activePageId,
        answerText,
        answerImageUri: uploadedImageUri,
        canvasBounds: canvasBounds ?? undefined,
        createdAt: new Date().toISOString(),
      };
      await saveAnswerLink(link);
      setAnswerLinks((prev) => [link, ...prev]);

      const deriveSectionStatus = (
        score: number | undefined,
        correctness: string,
      ): SectionStatus => {
        if (typeof score === "number") {
          if (score >= 70) return "passed";
          if (score <= 40) return "failed";
          return "in_progress";
        }
        if (correctness === "correct") return "passed";
        if (correctness === "incorrect") return "failed";
        return "in_progress";
      };

      // Update study plan entry status when focusing on a specific section
      if (studyPlanEntryId) {
        const nextStatus = deriveSectionStatus(
          feedback.score,
          feedback.correctness,
        );
        try {
          await updateStudyPlanEntryStatus(studyPlanEntryId, {
            status: nextStatus,
            statusScore: feedback.score,
          });
        } catch (err) {
          console.warn("[study] Failed to update section status", err);
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
            score: feedback.score,
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
            masteryScore,
            nextReviewAt,
            reviewCount,
            easeFactor,
            status: nextStatus,
            statusScore: feedback.score,
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

      // Create flashcard if the answer was correct/passed
      const isPassed =
        (feedback.score !== undefined && feedback.score >= 70) ||
        feedback.correctness === "correct";
      if (isPassed && lectureId) {
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

          // Collect visual blocks from explanation messages
          const visualBlockIds = explanationMessages.flatMap(
            (m) => m.visualBlockIds || [],
          );
          const collectedVisualBlocks = activeVisualBlocks.filter((b) =>
            visualBlockIds.includes(b.id),
          );

          // Extract the actual question text
          const questionText =
            questionToEvaluate.prompt || lastAiMessage?.text || "";

          await saveFlashcard({
            lectureId,
            sessionId: sessionId as string,
            studyPlanEntryId: studyPlanEntryId ?? undefined,
            questionText,
            answerText: answerText || undefined,
            answerImageUri: uploadedImageUri,
            aiExplanation: aiExplanation || undefined,
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
          text: answerText || t("study.handwrittenAnswerPlaceholder"),
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

      const scoreText = feedback.score
        ? `\n\n${t("study.scoreLabel", { score: feedback.score })}`
        : "";
      const improvementsText =
        feedback.improvements && feedback.improvements.length
          ? `\n\n${t("study.feedback.improveIntro")}\n${feedback.improvements.map((i) => `• ${i}`).join("\n")}`
          : "";
      const costText = feedback.costUsd
        ? `\n\n_${t("cost.label", { value: feedback.costUsd.toFixed(4) })}_`
        : "";

      const feedbackText = `${correctnessText}\n\n${feedback.summary}${scoreText}${improvementsText}\n\n${t("study.feedback.askExplain")}${costText}`;

      pushMessage({
        id: uuid(),
        role: "ai",
        text: feedbackText,
        questionId: questionToEvaluate.id,
        answerLinkId: linkId,
      });
    } catch (error) {
      console.warn(error);
    } finally {
      setGrading(false);
    }
  };

  // Request explanation with visual diagram
  const requestExplanation = () => {
    const visualInstruction =
      "IMPORTANT: Include a visual diagram on the canvas showing how the concepts connect (use the ```visual block format). This helps me understand the relationships visually.";

    const topicFocus = studyPlanEntry
      ? `Give me a concise (1-2 short paragraphs) explanation of the first key idea from "${studyPlanEntry.title}". Focus on ${studyPlanEntry.keyConcepts?.join(", ") || "the main ideas"}, cover one step only. ${visualInstruction} End with exactly one check-in question asking me to explain it back or apply it. Then stop and wait for my reply—I will answer on the canvas.`
      : `Give me a concise (1-2 short paragraphs) explanation of the first key idea in this topic. Cover one step only. ${visualInstruction} End with exactly one check-in question asking me to explain it back or apply it. Stop and wait for my reply—I will answer on the canvas.`;
    sendToFeynmanAI(topicFocus);
  };

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
  }, [loadingMessages, loadingEntry, studyTitle, messages.length]);

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

  return (
    <ThemedView style={styles.shell}>
      <StudyCanvasPanel
        styles={styles}
        palette={palette}
        t={t}
        tutorCollapsed={tutorCollapsed}
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
      />

      {tutorCollapsed ? (
        <StudyChatCollapsed
          styles={styles}
          t={t}
          messagesCount={messages.length}
          isChatting={isChatting}
          loadingQuestions={loadingQuestions}
          onToggleTutor={toggleTutor}
          onRequestExplanation={requestExplanation}
          onRequestQuestions={requestQuestions}
          onVoiceTranscription={handleVoiceTranscription}
          listeningMode={listeningMode}
          onListeningModeEnd={() => setListeningMode(false)}
          ttsFinished={!isSpeaking && listeningMode}
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
          chatListRef={chatListRef}
          getItemLayout={getItemLayout}
          onToggleTutor={toggleTutor}
          onToggleTts={handleToggleTts}
          onToggleListening={handleToggleListening}
          onStopSpeaking={stopSpeaking}
          onRequestExplanation={requestExplanation}
          onRequestQuestions={requestQuestions}
          onAddPage={handleAddPage}
          onNextQuestion={nextQuestion}
          onSendQuickAction={sendToFeynmanAI}
          onVoiceTranscription={handleVoiceTranscription}
          onListeningModeEnd={() => setListeningMode(false)}
          ttsFinished={!isSpeaking && listeningMode}
          onReplayMessage={speakMessage}
          onOpenCitation={openCitationSource}
          onViewNotes={scrollToCanvasAnswer}
          onViewDiagram={handleViewDiagram}
          onSubmitAnswer={submitAnswer}
        />
      )}

      {flashcardAdded && <StudyFlashcardToast styles={styles} t={t} />}
    </ThemedView>
  );
}
