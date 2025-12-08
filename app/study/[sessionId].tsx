import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, LayoutChangeEvent, Linking, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming
} from 'react-native-reanimated';
import { v4 as uuid } from 'uuid';

import { StreamingTTSPlayer, TTSPlayerState } from '@/lib/audio';

import { CanvasToolbar } from '@/components/canvas-toolbar';
import { CanvasMode, CanvasStroke, HandwritingCanvas, HandwritingCanvasHandle } from '@/components/handwriting-canvas';
import { MarkdownText } from '@/components/markdown-text';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { VoiceInput } from '@/components/voice-input';
import { Colors, Radii, Shadows, Spacing } from '@/constants/theme';
import { useLanguage } from '@/contexts/language-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useLectures } from '@/hooks/use-lectures';
import { useMaterials } from '@/hooks/use-materials';
import { ChatMessage, embedQuery, evaluateAnswer, generateQuestions, streamFeynmanChat } from '@/lib/openai';
import { feynmanWelcomeMessage } from '@/lib/prompts';
import { uploadCanvasImage } from '@/lib/storage';
import { LectureFileChunk, addReviewEvent, countLectureChunks, getSessionById, getStudyPlanEntry, getUserStreak, listAnswerLinks, listReviewEvents, listSessionMessages, saveAnswerLink, saveSessionMessage, searchLectureChunks, updateSession, updateStudyPlanEntryMastery, updateStudyPlanEntryStatus, updateUserStreak } from '@/lib/supabase';
import { computeMasteryScore, computeNextReviewDate } from '@/lib/mastery';
import { CanvasAnswerMarker, CanvasBounds, CanvasPage, CanvasStrokeData, Lecture, Material, ReviewQuality, SectionStatus, StudyAnswerLink, StudyChatMessage, StudyCitation, StudyPlanEntry, StudyQuestion } from '@/types';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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
  const { sessionId, materialId, lectureId, studyPlanEntryId } = useLocalSearchParams<{ 
    sessionId: string; 
    materialId?: string; 
    lectureId?: string;
    studyPlanEntryId?: string;
  }>();
  const { data: materials = [], isFetching: loadingMaterials } = useMaterials();
  const { data: lectures = [], isFetching: loadingLectures } = useLectures();
  const { t, agentLanguage, speechLocale } = useLanguage();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  const styles = useMemo(() => createStyles(palette), [palette]);

  const material = useMemo<Material | undefined>(() => materials.find((m) => m.id === materialId), [materials, materialId]);
  const lecture = useMemo<Lecture | undefined>(() => lectures.find((l) => l.id === lectureId), [lectures, lectureId]);
  
  // Study plan entry for focused study
  const [studyPlanEntry, setStudyPlanEntry] = useState<StudyPlanEntry | null>(null);
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
        console.warn('[study] Failed to load study plan entry:', err);
      } finally {
        setLoadingEntry(false);
      }
    };
    loadEntry();
  }, [studyPlanEntryId]);

  // Build the study title based on context
  const studyTitle = useMemo(() => {
    if (studyPlanEntry) {
      return `${lecture?.title || t('study.titleFallback')}: ${studyPlanEntry.title}`;
    }
    return lecture?.title ?? material?.title ?? t('study.titleFallback');
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
      const filesWithText = lecture.files.filter(f => f.extractedText);
      if (filesWithText.length > 0) {
        parts.push('\n## Complete Material Content');
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
        parts.push(`Key Concepts to Master: ${studyPlanEntry.keyConcepts.join(', ')}`);
      }
      parts.push('\nIMPORTANT: Focus your explanations, questions, and feedback specifically on this topic and its key concepts. Draw from the full material content above but emphasize this particular area.');
    }
    
    return parts.join('\n\n');
  }, [lecture, material, studyPlanEntry]);

  // Simple outline for display (not for AI context)
  const studyOutline = useMemo(() => {
    if (studyPlanEntry) {
      const concepts = studyPlanEntry.keyConcepts?.join(', ') || '';
      const conceptsLabel = t('study.focusConceptsFallback');
      return `${studyPlanEntry.description || ''}${concepts ? `\n\n${conceptsLabel}: ${concepts}` : ''}`;
    }
    return lecture?.description ?? material?.description ?? t('study.noDescription');
  }, [lecture, material, studyPlanEntry, t]);

  const [questions, setQuestions] = useState<StudyQuestion[]>([]);
  const [currentQuestion, setCurrentQuestion] = useState<StudyQuestion | null>(null);
  const [messages, setMessages] = useState<StudyChatMessage[]>([]);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [answerText, setAnswerText] = useState('');
  const [loadingQuestions, setLoadingQuestions] = useState(false);
  const [grading, setGrading] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [answerLinks, setAnswerLinks] = useState<StudyAnswerLink[]>([]);
  
  // Multi-page canvas state
  const [canvasPages, setCanvasPages] = useState<CanvasPage[]>([]);
  const [activePageId, setActivePageId] = useState<string>('');
  
  // Get current page data
  const activePage = useMemo(() => 
    canvasPages.find(p => p.id === activePageId) || canvasPages[0],
    [canvasPages, activePageId]
  );
  
  // Canvas strokes for current page (derived from activePage)
  const canvasStrokes = useMemo(() => activePage?.strokes || [], [activePage]);
  
  // Canvas state
  const [canvasMode, setCanvasMode] = useState<CanvasMode>('pen');
  const [canvasColor, setCanvasColor] = useState('#0f172a');
  
  // Voice/TTS state
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(true);
  const [currentCaption, setCurrentCaption] = useState<string | null>(null);
  const [listeningMode, setListeningMode] = useState(false);
  const ttsPlayerRef = useRef<StreamingTTSPlayer | null>(null);
  
  // Scroll control for stylus drawing
  const [scrollEnabled, setScrollEnabled] = useState(true);
  
  // Drawing detection state
  const [hasDrawnAfterQuestion, setHasDrawnAfterQuestion] = useState(false);
  const [isCurrentlyDrawing, setIsCurrentlyDrawing] = useState(false);
  const [lastDrawingPosition, setLastDrawingPosition] = useState<{ x: number; y: number } | null>(null);
  
  // Answer markers for linking canvas to chat
  const [answerMarkers, setAnswerMarkers] = useState<CanvasAnswerMarker[]>([]);
  const questionIndexCounterRef = useRef(0);
  
  // Highlight state for canvas area when clicking "View Notes" in chat
  const [highlightedAnswerLinkId, setHighlightedAnswerLinkId] = useState<string | null>(null);
  const [highlightedBounds, setHighlightedBounds] = useState<CanvasBounds | null>(null);
  const [canvasLayout, setCanvasLayout] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  
  // Canvas size derived from active page (auto-grows as user draws near edges)
  const canvasSize = useMemo(() => ({
    width: activePage?.width || INITIAL_CANVAS_WIDTH,
    height: activePage?.height || INITIAL_CANVAS_HEIGHT,
  }), [activePage]);
  
  // Track if session messages have been loaded
  const [loadingMessages, setLoadingMessages] = useState(true);
  const hasLoadedMessagesRef = useRef(false);
  
  // Initial canvas strokes to restore (loaded from session) - for current active page
  const initialCanvasStrokes = useMemo(() => activePage?.strokes, [activePage]);
  
  // Title canvas ref for handwritten page titles
  const titleCanvasRef = useRef<HandwritingCanvasHandle>(null);
  
  // Debounce timer for saving canvas data
  const saveCanvasDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveNotesDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Create a new blank page
  const createNewPage = useCallback((): CanvasPage => ({
    id: `page-${uuid()}`,
    titleStrokes: [],
    strokes: [],
    width: INITIAL_CANVAS_WIDTH,
    height: INITIAL_CANVAS_HEIGHT,
  }), []);
  
  // Add a new page
  const handleAddPage = useCallback(() => {
    const newPage = createNewPage();
    setCanvasPages(prev => [...prev, newPage]);
    setActivePageId(newPage.id);
    // Reset baseline for new page
    canvasBaselineRef.current = 0;
    hasInitializedCanvasRef.current = true;
    // New blank page should hide any previous check button position/state
    setHasDrawnAfterQuestion(false);
    setLastDrawingPosition(null);
  }, [createNewPage]);
  
  // Switch to a different page
  const handleSelectPage = useCallback((pageId: string) => {
    if (pageId === activePageId) return;
    setActivePageId(pageId);
    // Update baseline for the new page
    const page = canvasPages.find(p => p.id === pageId);
    canvasBaselineRef.current = page?.strokes.length || 0;
    hasInitializedCanvasRef.current = true;
  }, [activePageId, canvasPages]);

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
  
  const handleDrawingEnd = useCallback((lastPosition?: { x: number; y: number }) => {
    setScrollEnabled(true);
    setIsCurrentlyDrawing(false);
    
    // Save the last drawing position
    if (lastPosition) {
      setLastDrawingPosition(lastPosition);
      
      // Auto-grow canvas if drawing near edges (per-page)
      setCanvasPages(prev => prev.map(page => {
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
      }));
    }
    
    // Show check button after drawing when there's conversation
    const hasAiMessages = messages.some((m) => m.role === 'ai');
    if (hasAiMessages) {
      setHasDrawnAfterQuestion(true);
    }
  }, [messages, activePageId]);
  
  // Animate check button when drawing ends
  useEffect(() => {
    const hasAiMessages = messages.some((m) => m.role === 'ai');
    const shouldShow = hasDrawnAfterQuestion && hasAiMessages && !isCurrentlyDrawing && lastDrawingPosition;
    
    if (shouldShow) {
      checkButtonScale.value = withSpring(1, { damping: 12, stiffness: 200 });
      checkButtonOpacity.value = withTiming(1, { duration: 200 });
    } else {
      checkButtonScale.value = withTiming(0, { duration: 100 });
      checkButtonOpacity.value = withTiming(0, { duration: 100 });
    }
  }, [hasDrawnAfterQuestion, isCurrentlyDrawing, lastDrawingPosition, messages, checkButtonScale, checkButtonOpacity]);
  
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
      Math.max(canvasWidth - buttonWidth, 10)
    );
    const clampedTop = Math.min(
      Math.max(lastDrawingPosition.y + 20, 10),
      Math.max(canvasHeight - buttonHeight, 10)
    );

    return { top: clampedTop, left: clampedLeft };
  }, [canvasLayout.height, canvasLayout.width, lastDrawingPosition]);

  const handleCanvasLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setCanvasLayout({ width, height });
  }, []);

  // Calculate bounds for a set of strokes
  const computeBounds = useCallback((strokes: CanvasStrokeData[], padding = 16): CanvasBounds | null => {
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

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return null;
    }

    const paddedX = Math.max(minX - padding, 0);
    const paddedY = Math.max(minY - padding, 0);
    const width = Math.min(maxX - minX + padding * 2, canvasSize.width - paddedX);
    const height = Math.min(maxY - minY + padding * 2, canvasSize.height - paddedY);

    return { x: paddedX, y: paddedY, width, height };
  }, [canvasSize.width, canvasSize.height]);

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
            console.log('[study] Restored', session.canvasPages.length, 'canvas pages');
          } else if (session.canvasData && session.canvasData.length > 0) {
            // Migrate old canvasData to new pages format
            const migratedPage: CanvasPage = {
              id: 'page-1',
              titleStrokes: [],
              strokes: session.canvasData,
              width: INITIAL_CANVAS_WIDTH,
              height: INITIAL_CANVAS_HEIGHT,
            };
            setCanvasPages([migratedPage]);
            setActivePageId('page-1');
            canvasBaselineRef.current = session.canvasData.length;
            hasInitializedCanvasRef.current = true;
            console.log('[study] Migrated canvas with', session.canvasData.length, 'strokes to page format');
          } else {
            // Create initial blank page
            const initialPage: CanvasPage = {
              id: 'page-1',
              titleStrokes: [],
              strokes: [],
              width: INITIAL_CANVAS_WIDTH,
              height: INITIAL_CANVAS_HEIGHT,
            };
            setCanvasPages([initialPage]);
            setActivePageId('page-1');
            hasInitializedCanvasRef.current = true;
          }
          
          // Restore notes text
          if (session.notesText) {
            setAnswerText(session.notesText);
            console.log('[study] Restored notes text');
          }
        } else {
          // No session found, create initial blank page
          const initialPage: CanvasPage = {
            id: 'page-1',
            titleStrokes: [],
            strokes: [],
            width: INITIAL_CANVAS_WIDTH,
            height: INITIAL_CANVAS_HEIGHT,
          };
          setCanvasPages([initialPage]);
          setActivePageId('page-1');
          hasInitializedCanvasRef.current = true;
        }
        
        // Load messages
        const savedMessages = await listSessionMessages(sessionId);
        
        if (savedMessages.length > 0) {
          // Restore messages from database
          setMessages(savedMessages);
          
          // Rebuild chat history for AI context
          const history: ChatMessage[] = savedMessages
            .filter(m => m.role !== 'system')
            .map(m => ({
              role: m.role === 'ai' ? 'assistant' : 'user',
              content: m.text,
            }));
          setChatHistory(history);
          
          console.log('[study] Restored session with', savedMessages.length, 'messages');
        }
      } catch (err) {
        console.warn('[study] Failed to load session data:', err);
      } finally {
        setLoadingMessages(false);
      }
    };
    
    loadSessionData();
  }, [sessionId]);

  // Initialize with Feynman welcome message (only if no saved messages)
  useEffect(() => {
    if (studyTitle && messages.length === 0 && !loadingEntry && !loadingMessages) {
      const welcomeText = feynmanWelcomeMessage(studyTitle, agentLanguage);
      const welcomeMsg: StudyChatMessage = { id: 'welcome', role: 'ai', text: welcomeText };
      setMessages([welcomeMsg]);
      
      // Save welcome message to database
      if (sessionId) {
        saveSessionMessage(sessionId, welcomeMsg).catch(err => {
          console.warn('[study] Failed to save welcome message:', err);
        });
      }
    }
  }, [agentLanguage, studyTitle, messages.length, loadingEntry, loadingMessages, sessionId]);

  useEffect(() => {
    const loadLinks = async () => {
      if (!sessionId) return;
      try {
        const links = await listAnswerLinks(sessionId as string);
        setAnswerLinks(links);
      } catch (err) {
        console.warn('[links] failed to load', err);
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
    setCanvasPages(prev => prev.map(page => 
      page.id === activePageId 
        ? { ...page, strokes: [] }
        : page
    ));
    canvasBaselineRef.current = 0;
    hasInitializedCanvasRef.current = true;
  }, [activePageId]);
  
  // Save canvas strokes to database (debounced) - per-page
  const handleCanvasStrokesChange = useCallback((strokes: CanvasStroke[]) => {
    // Update strokes for the active page
    setCanvasPages(prev => {
      const updatedPages = prev.map(page => 
        page.id === activePageId 
          ? { ...page, strokes: strokes as CanvasStrokeData[] }
          : page
      );
      
      // Save to database (debounced)
      if (sessionId) {
        if (saveCanvasDebounceRef.current) {
          clearTimeout(saveCanvasDebounceRef.current);
        }
        
        saveCanvasDebounceRef.current = setTimeout(async () => {
          try {
            await updateSession(sessionId, { canvasPages: updatedPages });
            console.log('[study] Canvas pages saved with', updatedPages.length, 'pages');
          } catch (err) {
            console.warn('[study] Failed to save canvas pages:', err);
          }
        }, 1000);
      }
      
      return updatedPages;
    });
    
    if (!hasInitializedCanvasRef.current) {
      canvasBaselineRef.current = strokes.length;
      hasInitializedCanvasRef.current = true;
    }
  }, [sessionId, activePageId]);
  
  // Save notes text to database (debounced)
  const handleNotesChange = useCallback((text: string) => {
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
        console.log('[study] Notes saved');
      } catch (err) {
        console.warn('[study] Failed to save notes:', err);
      }
    }, 1000);
  }, [sessionId]);

  // Handle undo
  const handleUndo = useCallback(() => {
    canvasRef.current?.undo();
  }, []);
  
  // Handle title strokes change (for handwritten page titles)
  const handleTitleStrokesChange = useCallback((strokes: CanvasStroke[]) => {
    setCanvasPages(prev => {
      const updatedPages = prev.map(page => 
        page.id === activePageId 
          ? { ...page, titleStrokes: strokes as CanvasStrokeData[] }
          : page
      );
      
      // Save to database (debounced)
      if (sessionId) {
        if (saveCanvasDebounceRef.current) {
          clearTimeout(saveCanvasDebounceRef.current);
        }
        
        saveCanvasDebounceRef.current = setTimeout(async () => {
          try {
            await updateSession(sessionId, { canvasPages: updatedPages });
            console.log('[study] Title strokes saved');
          } catch (err) {
            console.warn('[study] Failed to save title strokes:', err);
          }
        }, 1000);
      }
      
      return updatedPages;
    });
  }, [sessionId, activePageId]);

  // Initialize TTS player
  useEffect(() => {
    const handleStateChange = (state: TTSPlayerState) => {
      setIsSpeaking(state.isPlaying || state.isLoading);
      if (captionsEnabled && state.currentText) {
        setCurrentCaption(state.currentText);
      }
      if (!state.isPlaying && !state.isLoading) {
        // Delay clearing captions for readability
        setTimeout(() => setCurrentCaption(null), 2000);
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
  }, [agentLanguage, captionsEnabled]);

  // Update TTS player language when it changes
  useEffect(() => {
    ttsPlayerRef.current?.setLanguage(agentLanguage);
  }, [agentLanguage]);

  // Text-to-Speech for AI responses
  const speakMessage = useCallback(async (text: string) => {
    if (!ttsEnabled) return;
    
    if (captionsEnabled) {
      setCurrentCaption(text);
    }
    
    await ttsPlayerRef.current?.speak(text);
  }, [ttsEnabled, captionsEnabled]);

  // Stop speech
  const stopSpeaking = useCallback(async () => {
    await ttsPlayerRef.current?.stop();
    setIsSpeaking(false);
    setCurrentCaption(null);
  }, []);

  const pushMessage = useCallback((message: StudyChatMessage, speak = true) => {
    setMessages((prev) => [...prev, message]);
    if (speak && message.role === 'ai') {
      speakMessage(message.text);
    }
    // Scroll to bottom
    setTimeout(() => {
      chatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
    
    // Save message to database for persistence
    if (sessionId) {
      saveSessionMessage(sessionId, message).catch(err => {
        console.warn('[study] Failed to save message:', err);
      });
    }
  }, [speakMessage, sessionId]);

  // Update an existing message in the messages array (for streaming updates)
  const updateMessage = useCallback((messageId: string, updates: Partial<StudyChatMessage>) => {
    setMessages((prev) => prev.map((msg) => 
      msg.id === messageId ? { ...msg, ...updates } : msg
    ));
  }, []);

  // Send message to Feynman AI with FULL material context (streaming enabled)
  const sendToFeynmanAI = useCallback(async (userMessage: string, transcriptionCostUsd?: number) => {
    if (!userMessage.trim()) return;

    // Add transcription cost suffix if provided (from voice input)
    const transcriptionCostSuffix = transcriptionCostUsd 
      ? ` _${t('cost.label', { value: transcriptionCostUsd.toFixed(4) })}_`
      : '';
    
    const userMsgId = uuid();
    pushMessage({ id: userMsgId, role: 'user', text: userMessage + transcriptionCostSuffix }, false);

    // Update chat history for context
    const newUserMessage: ChatMessage = { role: 'user', content: userMessage };
    const updatedHistory = [...chatHistory, newUserMessage];
    setChatHistory(updatedHistory);

    setIsChatting(true);

    // Create a placeholder AI message immediately for streaming
    const aiMsgId = uuid();
    pushMessage({ id: aiMsgId, role: 'ai', text: '' }, false);

    try {
      let retrievedChunks: LectureFileChunk[] = [];
      if (lectureId && lecture) {
        try {
          const chunkCount = await countLectureChunks(lectureId);
          if ((chunkCount ?? 0) > 0) {
            const queryEmbedding = await embedQuery(
              studyPlanEntry ? `${studyPlanEntry.title}\n${userMessage}` : userMessage
            );
            retrievedChunks = await searchLectureChunks(queryEmbedding, [lectureId], 6, 0.15);
            if (retrievedChunks.length > 0) {
              console.log('[study] retrieval matches', {
                matches: retrievedChunks.length,
                topSimilarity: retrievedChunks[0]?.similarity,
              });
            }
          }
        } catch (err) {
          console.warn('[study] retrieval failed, falling back to full context', err);
        }
      }

      const contextBlock =
        retrievedChunks.length > 0
          ? `Use the following source snippets. Prefer citing the most relevant ones and keep answers concise.\n\n${retrievedChunks
              .map((chunk, idx) => `[${idx + 1}] (p${chunk.pageNumber}) ${chunk.content}`)
              .join('\n\n')}`
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
            // Add cost footer if available
            const costSuffix = result.costUsd 
              ? `\n\n_${t('cost.label', { value: result.costUsd.toFixed(4) })}_`
              : '';
            
            // Final update with citations and cost
            const finalMessage: StudyChatMessage = {
              id: aiMsgId,
              role: 'ai',
              text: result.message + costSuffix,
              citations,
            };
            updateMessage(aiMsgId, finalMessage);
            
            // Speak the final message
            speakMessage(result.message);
            
            // Save the final message to database
            if (sessionId) {
              saveSessionMessage(sessionId, finalMessage).catch(err => {
                console.warn('[study] Failed to save message:', err);
              });
            }
          },
        }
      );
      
      // Add AI response to chat history (without cost suffix)
      setChatHistory((prev) => [...prev, { role: 'assistant', content: chatResult.message }]);
    } catch (error) {
      console.warn('Feynman chat error:', error);
      // Update the placeholder message with error
      updateMessage(aiMsgId, { text: t('common.errorGeneric') });
    } finally {
      setIsChatting(false);
    }
  }, [agentLanguage, chatHistory, fullMaterialContext, lecture, lectureId, pushMessage, updateMessage, speakMessage, studyPlanEntry, t, sessionId]);

  // Handle voice transcription
  const handleVoiceTranscription = useCallback((text: string, transcriptionCostUsd?: number) => {
    // Pass transcription cost to sendToFeynmanAI so it can display it with the user message
    sendToFeynmanAI(text, transcriptionCostUsd);
  }, [sendToFeynmanAI]);

  const requestQuestions = async () => {
    setLoadingQuestions(true);
    try {
      // Use full context for generating relevant questions
      const generated = await generateQuestions(studyTitle, fullMaterialContext, 3, agentLanguage);
      setQuestions(generated);
      setHasDrawnAfterQuestion(false); // Reset drawing detection
      questionIndexCounterRef.current = 0; // Reset question counter

      if (generated[0]) {
        pushMessage({
          id: uuid(),
          role: 'ai',
          text: t('study.firstQuestionIntro', { question: generated[0].prompt }),
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
      role: 'ai',
      text: t('study.nextQuestionIntro', { question: next.prompt }),
      questionId: next.id,
    });
  };

  const submitAnswer = async () => {
    // Get question context - either from formal quiz or last AI message
    const lastAiMessage = [...messages].reverse().find((m) => m.role === 'ai');
    
    // Use current formal question or create one from the last AI message
    const questionToEvaluate: StudyQuestion = currentQuestion || {
      id: lastAiMessage?.id || uuid(),
      prompt: lastAiMessage?.text || t('study.defaultCheckPrompt'),
    };
    
    if (!lastAiMessage && !currentQuestion) return;
    
    setGrading(true);
    try {
      const imageUri = await canvasRef.current?.exportAsImage();
      const base64 = imageUri
        ? await FileSystem.readAsStringAsync(imageUri, { encoding: FileSystem.EncodingType.Base64 })
        : undefined;
      const dataUrl = base64 ? `data:image/png;base64,${base64}` : undefined;
      const feedback = await evaluateAnswer(
        {
          question: questionToEvaluate,
          answerText,
          answerImageDataUrl: dataUrl,
          lectureId,
        },
        agentLanguage
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

      const deriveSectionStatus = (score: number | undefined, correctness: string): SectionStatus => {
        if (typeof score === 'number') {
          if (score >= 70) return 'passed';
          if (score <= 40) return 'failed';
          return 'in_progress';
        }
        if (correctness === 'correct') return 'passed';
        if (correctness === 'incorrect') return 'failed';
        return 'in_progress';
      };

      // Update study plan entry status when focusing on a specific section
      if (studyPlanEntryId) {
        const nextStatus = deriveSectionStatus(feedback.score, feedback.correctness);
        try {
          await updateStudyPlanEntryStatus(studyPlanEntryId, {
            status: nextStatus,
            statusScore: feedback.score,
          });
        } catch (err) {
          console.warn('[study] Failed to update section status', err);
        }

        // Record review + update mastery schedule
        try {
          const responseQuality: ReviewQuality =
            feedback.correctness === 'correct'
              ? 'correct'
              : feedback.correctness === 'incorrect'
              ? 'incorrect'
              : 'partial';

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
            console.warn('[study] Failed to update streak', err);
          }
        } catch (err) {
          console.warn('[study] Failed to update mastery schedule', err);
        }
      }
      
      // Create answer marker for linking canvas to chat
      questionIndexCounterRef.current += 1;
      // Find the message ID by questionId, or fall back to lastAiMessage
      const questionMessage = currentQuestion 
        ? messages.find((m) => m.questionId === currentQuestion.id)
        : null;
      const messageIdForMarker = questionMessage?.id ?? lastAiMessage?.id ?? '';
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

      pushMessage({
        id: uuid(),
        role: 'user',
        text: answerText || t('study.handwrittenAnswerPlaceholder'),
        questionId: questionToEvaluate.id,
        answerLinkId: linkId,
      }, false);
      
      const correctnessText =
        feedback.correctness === 'correct'
          ? t('study.feedback.correct')
          : feedback.correctness === 'partially correct'
          ? t('study.feedback.partial')
          : t('study.feedback.incorrect');

      const scoreText = feedback.score ? `\n\n${t('study.scoreLabel', { score: feedback.score })}` : '';
      const improvementsText =
        feedback.improvements && feedback.improvements.length
          ? `\n\n${t('study.feedback.improveIntro')}\n${feedback.improvements.map((i) => `• ${i}`).join('\n')}`
          : '';
      const costText = feedback.costUsd 
        ? `\n\n_${t('cost.label', { value: feedback.costUsd.toFixed(4) })}_`
        : '';

      const feedbackText = `${correctnessText}\n\n${feedback.summary}${scoreText}${improvementsText}\n\n${t('study.feedback.askExplain')}${costText}`;
      
      pushMessage({
        id: uuid(),
        role: 'ai',
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

  // Request explanation
  const requestExplanation = () => {
    const topicFocus = studyPlanEntry 
      ? `Give me a concise (1-2 short paragraphs) explanation of the first key idea from "${studyPlanEntry.title}". Focus on ${studyPlanEntry.keyConcepts?.join(', ') || 'the main ideas'}, cover one step only, and end with exactly one check-in question asking me to explain it back or apply it. Then stop and wait for my reply—I will answer on the canvas.`
      : 'Give me a concise (1-2 short paragraphs) explanation of the first key idea in this topic. Cover one step only, then end with exactly one check-in question asking me to explain it back or apply it. Stop and wait for my reply—I will answer on the canvas.';
    sendToFeynmanAI(topicFocus);
  };
  
  // Scroll chat to specific question message (called from canvas markers)
  const scrollToQuestionMessage = useCallback((messageId: string) => {
    const index = messages.findIndex((m) => m.id === messageId);
    if (index !== -1 && chatListRef.current) {
      chatListRef.current.scrollToIndex({ 
        index, 
        animated: true,
        viewPosition: 0.3 // Position it at 30% from top for visibility
      });
    }
  }, [messages]);
  
  // Scroll canvas area and highlight when clicking "View Notes" in chat
  const scrollToCanvasAnswer = useCallback((answerLinkId: string) => {
    const link = answerLinks.find((l) => l.id === answerLinkId);

    // Switch to the correct page if needed
    if (link?.pageId && link.pageId !== activePageId) {
      handleSelectPage(link.pageId);
    }

    // Bring canvas section into view
    pageScrollRef.current?.scrollTo({ y: 0, animated: true });

    // Use a small delay to allow page switch to complete
    setTimeout(() => {
      if (link?.canvasBounds) {
        const pad = 24;
        const targetX = Math.max(link.canvasBounds.x - pad, 0);
        const targetY = Math.max(link.canvasBounds.y - pad, 0);

        canvasHScrollRef.current?.scrollTo({ x: targetX, animated: true });
        canvasScrollRef.current?.scrollTo({ y: targetY, animated: true });

        setHighlightedBounds({
          x: targetX,
          y: targetY,
          width: Math.min(link.canvasBounds.width + pad * 2, canvasSize.width - targetX),
          height: Math.min(link.canvasBounds.height + pad * 2, canvasSize.height - targetY),
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
    }, link?.pageId && link.pageId !== activePageId ? 100 : 0);
  }, [answerLinks, canvasSize.width, canvasSize.height, activePageId, handleSelectPage]);
  
  const openCitationSource = useCallback((citation: StudyCitation) => {
    if (!lecture) return;
    const file = lecture.files.find((f) => f.id === citation.lectureFileId);
    if (!file) return;
    const targetUrl = citation.pageNumber ? `${file.uri}#page=${citation.pageNumber}` : file.uri;
    Linking.openURL(targetUrl).catch((err) => console.warn('[study] Failed to open source', err));
  }, [lecture]);
  
  // FlatList getItemLayout for reliable scrollToIndex
  const getItemLayout = useCallback((_: any, index: number) => ({
    length: CHAT_ITEM_HEIGHT,
    offset: CHAT_ITEM_HEIGHT * index + 8 * index, // account for gap
    index,
  }), []);

  if ((loadingMaterials || loadingLectures || loadingEntry || loadingMessages) && !material && !lecture) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
        <ThemedText>{t('study.loading')}</ThemedText>
      </ThemedView>
    );
  }

  if (!material && !lecture) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText>{t('study.empty')}</ThemedText>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.shell}>
      <View style={styles.canvasColumn}>
        <ScrollView
          ref={pageScrollRef}
          contentContainerStyle={styles.canvasArea}
          scrollEnabled={scrollEnabled}
          showsVerticalScrollIndicator
        >
          <ThemedText type="title">{studyTitle}</ThemedText>
          
          {/* Show topic focus badge if studying specific entry */}
          {studyPlanEntry && (
            <View style={styles.topicFocusBadge}>
              <Ionicons name="locate" size={14} color="#10b981" />
              <ThemedText style={styles.topicFocusText}>
                {t('study.focusBadge', {
                  concepts: studyPlanEntry.keyConcepts?.slice(0, 3).join(', ') || t('study.focusConceptsFallback'),
                })}
              </ThemedText>
            </View>
          )}
          
          <ThemedText style={{ marginBottom: 8, color: '#64748b' }}>{studyOutline}</ThemedText>

          <ThemedText type="defaultSemiBold" style={{ marginTop: 12, marginBottom: 8 }}>
            {t('study.canvasTitle')}
          </ThemedText>
          
          {/* Page Navigation */}
          <View style={styles.pageNavContainer}>
            <ScrollView 
              horizontal 
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.pageTabsContent}
            >
              {canvasPages.map((page, index) => (
                <Pressable
                  key={page.id}
                  style={[
                    styles.pageTab,
                    page.id === activePageId && styles.pageTabActive,
                  ]}
                  onPress={() => handleSelectPage(page.id)}
                >
                  {page.titleStrokes.length > 0 ? (
                    <View style={styles.pageTitlePreview}>
                      <HandwritingCanvas
                        width={60}
                        height={20}
                        initialStrokes={page.titleStrokes}
                        mode="pen"
                      />
                    </View>
                  ) : (
                    <ThemedText style={[
                      styles.pageTabText,
                      page.id === activePageId && styles.pageTabTextActive,
                    ]}>
                      {t('study.pageLabel', { number: index + 1 })}
                    </ThemedText>
                  )}
                </Pressable>
              ))}
              <Pressable style={styles.addPageButton} onPress={handleAddPage}>
                <Ionicons name="add" size={20} color="#10b981" />
              </Pressable>
            </ScrollView>
          </View>
          
          {/* Page Title (Handwritten) */}
          <View style={styles.pageTitleContainer}>
            <ThemedText style={styles.pageTitleLabel}>{t('study.pageTitleLabel')}</ThemedText>
            <View style={styles.pageTitleCanvasWrapper}>
              <HandwritingCanvas
                key={activePage?.id ? `${activePage.id}-title` : 'title-default'}
                ref={titleCanvasRef}
                width={300}
                height={40}
                strokeColor={canvasColor}
                strokeWidth={2}
                initialStrokes={activePage?.titleStrokes}
                onStrokesChange={handleTitleStrokesChange}
              />
            </View>
          </View>
          
          <CanvasToolbar
            mode={canvasMode}
            color={canvasColor}
            onModeChange={handleCanvasModeChange}
            onColorChange={handleCanvasColorChange}
            onClear={handleClearCanvas}
            onUndo={handleUndo}
          />
          
          <View style={styles.canvasScrollShell}>
            <ScrollView
              ref={canvasHScrollRef}
              horizontal
              scrollEnabled={scrollEnabled}
              showsHorizontalScrollIndicator
              contentContainerStyle={{ paddingBottom: 4 }}
            >
              <ScrollView
                ref={canvasScrollRef}
                scrollEnabled={scrollEnabled}
                showsVerticalScrollIndicator
                contentContainerStyle={styles.canvasInnerVertical}
              >
                <View
                  style={[styles.canvasWrapper, { width: canvasSize.width, height: canvasSize.height }]}
                  onLayout={handleCanvasLayout}
                >
                  {highlightedAnswerLinkId && (
                    <View
                      style={[
                        styles.canvasHighlight,
                        highlightedBounds
                          ? {
                              top: highlightedBounds.y,
                              left: highlightedBounds.x,
                              width: highlightedBounds.width,
                              height: highlightedBounds.height,
                            }
                          : styles.canvasHighlightFull,
                        styles.canvasHighlightActive,
                      ]}
                      pointerEvents="none"
                    />
                  )}
                  <HandwritingCanvas 
                    key={activePage?.id || 'canvas-default'}
                    ref={canvasRef} 
                    width={canvasSize.width}
                    height={canvasSize.height} 
                    strokeColor={canvasColor}
                    onDrawingStart={handleDrawingStart}
                    onDrawingEnd={handleDrawingEnd}
                    initialStrokes={initialCanvasStrokes}
                    onStrokesChange={handleCanvasStrokesChange}
                  />
                  
                  {/* Animated Check Answer button - appears right after where user stopped writing */}
                  {lastDrawingPosition && (
                    <AnimatedPressable
                      style={[
                        styles.checkAnswerButton, 
                        checkButtonAnimatedStyle,
                        checkButtonPosition && {
                          // Position below and further to the right of where user stopped writing
                          top: checkButtonPosition.top,
                          left: checkButtonPosition.left,
                        },
                      ]}
                      onPress={submitAnswer}
                      disabled={grading}
                    >
                      {grading ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <>
                          <Ionicons name="checkmark-circle" size={20} color="#fff" />
                          <ThemedText style={styles.checkAnswerButtonText}>{t('study.checkAnswer')}</ThemedText>
                        </>
                      )}
                    </AnimatedPressable>
                  )}
                </View>
              </ScrollView>
            </ScrollView>
          </View>
          
          {/* Answer markers - links to chat questions */}
          {answerMarkers.length > 0 && (
            <View style={styles.answerMarkersContainer}>
              <ThemedText type="defaultSemiBold" style={styles.markersTitle}>
                {t('study.answerSectionTitle')}
              </ThemedText>
              <View style={styles.markersList}>
                {answerMarkers.map((marker) => (
                  <Pressable
                    key={`${marker.answerLinkId}-${marker.messageId}`}
                    style={[
                      styles.markerBadge,
                      highlightedAnswerLinkId === marker.answerLinkId && styles.markerBadgeHighlighted
                    ]}
                    onPress={() => scrollToQuestionMessage(marker.messageId)}
                  >
                    <ThemedText style={styles.markerBadgeText}>Q{marker.questionIndex}</ThemedText>
                    <Ionicons name="chatbubble-outline" size={12} color="#10b981" />
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          <ThemedText type="defaultSemiBold" style={{ marginTop: 16 }}>
            {t('study.typedNotes')}
          </ThemedText>
          <TextInput
            style={styles.input}
            placeholder={t('study.notesPlaceholder')}
            placeholderTextColor="#94a3b8"
            multiline
            value={answerText}
            onChangeText={handleNotesChange}
          />
        </ScrollView>
      </View>

      <View style={styles.chatColumn}>
        <View style={styles.chatHeader}>
          <View style={styles.chatTitleRow}>
            <ThemedText type="title" style={{ color: '#fff' }}>{t('study.aiTutor')}</ThemedText>
            <View style={styles.voiceControlsRow}>
              <Pressable
                style={[styles.ttsToggle, ttsEnabled && styles.ttsToggleActive]}
                onPress={() => {
                  if (isSpeaking) {
                    stopSpeaking();
                  }
                  setTtsEnabled(!ttsEnabled);
                }}
                accessibilityLabel={ttsEnabled ? t('voice.disableTts') : t('voice.enableTts')}
                accessibilityRole="button"
              >
                <Ionicons 
                  name={ttsEnabled ? 'volume-high' : 'volume-mute'} 
                  size={20} 
                  color={ttsEnabled ? '#10b981' : '#64748b'} 
                />
              </Pressable>
              <Pressable
                style={[styles.ttsToggle, captionsEnabled && styles.ttsToggleActive]}
                onPress={() => setCaptionsEnabled(!captionsEnabled)}
                accessibilityLabel={captionsEnabled ? t('voice.disableCaptions') : t('voice.enableCaptions')}
                accessibilityRole="button"
              >
                <Ionicons 
                  name={captionsEnabled ? 'text' : 'text-outline'} 
                  size={18} 
                  color={captionsEnabled ? '#10b981' : '#64748b'} 
                />
              </Pressable>
              <Pressable
                style={[styles.ttsToggle, listeningMode && styles.listeningModeActive]}
                onPress={() => setListeningMode(!listeningMode)}
                accessibilityLabel={listeningMode ? t('voice.disableListening') : t('voice.enableListening')}
                accessibilityRole="button"
              >
                <Ionicons 
                  name={listeningMode ? 'ear' : 'ear-outline'} 
                  size={18} 
                  color={listeningMode ? '#f59e0b' : '#64748b'} 
                />
              </Pressable>
            </View>
          </View>
          <ThemedText style={{ color: '#94a3b8', fontSize: 13 }}>
            {studyPlanEntry 
              ? t('study.focusedOn', { title: studyPlanEntry.title })
              : t('study.aiSubtitle')}
          </ThemedText>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chatToolbarScroll}
            contentContainerStyle={styles.chatToolbarContent}
          >
            <Pressable 
              style={styles.explainButton} 
              onPress={requestExplanation} 
              disabled={isChatting}
              accessibilityRole="button"
              accessibilityLabel={t('study.explainThis')}
              accessibilityState={{ disabled: isChatting }}
            >
              <Ionicons name="bulb-outline" size={18} color="#f59e0b" />
              <ThemedText style={styles.explainButtonText}>{t('study.explainThis')}</ThemedText>
            </Pressable>
            <Pressable 
              style={styles.primaryButton} 
              onPress={requestQuestions} 
              disabled={loadingQuestions}
              accessibilityRole="button"
              accessibilityLabel={t('study.quizMe')}
              accessibilityState={{ disabled: loadingQuestions, busy: loadingQuestions }}
            >
              {loadingQuestions ? <ActivityIndicator color="#fff" size="small" /> : <ThemedText style={styles.primaryButtonText}>{t('study.quizMe')}</ThemedText>}
            </Pressable>
            <Pressable 
              style={styles.secondaryButton} 
              onPress={handleAddPage}
              accessibilityRole="button"
              accessibilityLabel="Start a new blank page without deleting notes"
            >
              <ThemedText style={styles.secondaryButtonText}>New blank page</ThemedText>
            </Pressable>
            {currentQuestion && (
              <Pressable 
                style={styles.secondaryButton} 
                onPress={nextQuestion}
                accessibilityRole="button"
                accessibilityLabel={t('study.nextQuestion')}
              >
                <ThemedText style={styles.secondaryButtonText}>{t('study.nextQuestion')}</ThemedText>
              </Pressable>
            )}

            <View style={styles.toolbarDivider} />

            <Pressable 
              style={styles.quickActionChip} 
              onPress={() => sendToFeynmanAI(t('voice.quickSimpler'))}
              disabled={isChatting}
              accessibilityLabel={t('voice.quickSimpler')}
            >
              <Ionicons name="sparkles-outline" size={14} color="#a5b4fc" />
              <ThemedText style={styles.quickActionText}>{t('voice.simpler')}</ThemedText>
            </Pressable>
            <Pressable 
              style={styles.quickActionChip} 
              onPress={() => sendToFeynmanAI(t('voice.quickAnalogy'))}
              disabled={isChatting}
              accessibilityLabel={t('voice.quickAnalogy')}
            >
              <Ionicons name="swap-horizontal-outline" size={14} color="#a5b4fc" />
              <ThemedText style={styles.quickActionText}>{t('voice.analogy')}</ThemedText>
            </Pressable>
            <Pressable 
              style={styles.quickActionChip} 
              onPress={() => sendToFeynmanAI(t('voice.quickFormula'))}
              disabled={isChatting}
              accessibilityLabel={t('voice.quickFormula')}
            >
              <Ionicons name="calculator-outline" size={14} color="#a5b4fc" />
              <ThemedText style={styles.quickActionText}>{t('voice.formula')}</ThemedText>
            </Pressable>
          </ScrollView>
        </View>

        <FlatList
          ref={chatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          getItemLayout={getItemLayout}
          renderItem={({ item }) => {
            const marker = item.questionId ? answerMarkers.find((m) => m.questionId === item.questionId) : null;
            return (
              <ThemedView style={[styles.chatBubble, item.role === 'ai' ? styles.chatAI : styles.chatUser]}>
                <View style={styles.bubbleHeader}>
                  <View style={styles.bubbleTitleRow}>
                    <ThemedText type="defaultSemiBold" style={{ color: item.role === 'ai' ? '#10b981' : '#60a5fa' }}>
                      {item.role === 'ai' ? t('study.tutorLabel') : t('study.youLabel')}
                    </ThemedText>
                    {marker && (
                      <View style={styles.questionBadge}>
                        <ThemedText style={styles.questionBadgeText}>Q{marker.questionIndex}</ThemedText>
                      </View>
                    )}
                  </View>
                  {item.role === 'ai' && ttsEnabled && (
                    <Pressable 
                      onPress={() => speakMessage(item.text)} 
                      style={styles.replayButton}
                      accessibilityRole="button"
                      accessibilityLabel={t('voice.enableTts')}
                      accessibilityHint={t('study.speaking')}
                    >
                      <Ionicons name="play-circle" size={24} color="#94a3b8" />
                    </Pressable>
                  )}
                </View>
              {item.role === 'ai' ? (
                <MarkdownText content={item.text} />
              ) : (
                <ThemedText style={{ color: '#e2e8f0' }}>{item.text}</ThemedText>
              )}
                {item.role === 'ai' && item.citations && item.citations.length > 0 && (
                  <View style={styles.citationRow}>
                    {item.citations.map((citation, idx) => (
                      <Pressable
                        key={`${item.id}-citation-${idx}`}
                        style={styles.citationChip}
                        onPress={() => openCitationSource(citation)}
                      >
                        <Ionicons name="book-outline" size={12} color="#0ea5e9" />
                        <ThemedText style={styles.citationChipText}>
                          {citation.pageNumber ? `Source p${citation.pageNumber}` : 'Source'}
                        </ThemedText>
                      </Pressable>
                    ))}
                  </View>
                )}
                {item.answerLinkId && (
                  <Pressable 
                    style={styles.viewNotesButton}
                    onPress={() => scrollToCanvasAnswer(item.answerLinkId!)}
                  >
                    <Ionicons name="document-text-outline" size={14} color="#60a5fa" />
                    <ThemedText style={styles.viewNotesText}>{t('study.viewNotes')}</ThemedText>
                  </Pressable>
                )}
              </ThemedView>
            );
          }}
          style={styles.chatList}
          contentContainerStyle={{ gap: 8, paddingBottom: 8 }}
          onScrollToIndexFailed={(info) => {
            // Handle scroll to index failure gracefully
            setTimeout(() => {
              chatListRef.current?.scrollToIndex({ index: info.index, animated: true });
            }, 100);
          }}
        />

        {/* Caption Overlay */}
        {captionsEnabled && currentCaption && (
          <View style={styles.captionOverlay}>
            <Pressable onPress={stopSpeaking} style={styles.captionStopButton}>
              <Ionicons name="stop-circle" size={20} color="#ef4444" />
            </Pressable>
            <ScrollView style={styles.captionScroll} showsVerticalScrollIndicator={false}>
              <ThemedText style={styles.captionText} numberOfLines={4}>
                {currentCaption}
              </ThemedText>
            </ScrollView>
          </View>
        )}

        <View style={styles.inputArea}>
          <View style={styles.voiceRow}>
            <VoiceInput 
              onTranscription={handleVoiceTranscription} 
              disabled={isChatting}
              listeningMode={listeningMode}
              onListeningModeEnd={() => setListeningMode(false)}
              ttsFinished={!isSpeaking && listeningMode}
            />
            {isChatting && (
              <View style={styles.thinkingIndicator}>
                <ActivityIndicator color="#10b981" size="small" />
                <ThemedText style={{ color: '#94a3b8', fontSize: 12 }}>{t('study.thinking')}</ThemedText>
              </View>
            )}
            {isSpeaking && (
              <Pressable onPress={stopSpeaking} style={styles.stopSpeakingButton}>
                <Ionicons name="stop-circle" size={24} color="#ef4444" />
                <ThemedText style={styles.stopSpeakingText}>{t('study.stopSpeaking')}</ThemedText>
              </Pressable>
            )}
          </View>
          
          {currentQuestion && (
            <View style={styles.submitArea}>
              <Pressable 
                style={[styles.submitButton, grading && styles.disabledButton]} 
                onPress={submitAnswer} 
                disabled={grading}
              >
                {grading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle" size={18} color="#fff" />
                    <ThemedText style={styles.primaryButtonText}>{t('study.submitAnswer')}</ThemedText>
                  </>
                )}
              </Pressable>
              <ThemedText style={styles.metaText}>
                {t('study.gradingHint')}
              </ThemedText>
            </View>
          )}
        </View>
      </View>
    </ThemedView>
  );
}

const createStyles = (palette: typeof Colors.light) =>
  StyleSheet.create({
    shell: {
      flex: 1,
      flexDirection: 'row',
      padding: Spacing.md,
      gap: Spacing.md,
      backgroundColor: palette.background,
    },
    canvasColumn: {
      flex: 4,
      backgroundColor: palette.surface,
      borderRadius: Radii.lg,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: palette.border,
      ...Shadows.sm,
    },
    chatColumn: {
      flex: 1.5,
      backgroundColor: palette.surfaceAlt,
      borderRadius: Radii.lg,
      padding: Spacing.md,
      gap: Spacing.md,
      borderWidth: 1,
      borderColor: palette.border,
      ...Shadows.sm,
    },
    canvasArea: {
      padding: Spacing.md,
      gap: Spacing.sm,
    },
    pageNavContainer: {
      marginBottom: Spacing.sm,
    },
    pageTabsContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingVertical: 4,
    },
    pageTab: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: Radii.md,
      backgroundColor: palette.surface,
      borderWidth: 1,
      borderColor: palette.border,
      minWidth: 70,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pageTabActive: {
      backgroundColor: `${palette.primary}12`,
      borderColor: palette.primary,
    },
    pageTabText: {
      fontSize: 13,
      color: palette.textMuted,
      fontWeight: '500',
    },
    pageTabTextActive: {
      color: palette.primary,
      fontWeight: '600',
    },
    pageTitlePreview: {
      overflow: 'hidden',
      borderRadius: 4,
    },
    addPageButton: {
      padding: 10,
      borderRadius: Radii.md,
      backgroundColor: `${palette.success}12`,
      borderWidth: 1,
      borderColor: `${palette.success}33`,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pageTitleContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      marginBottom: Spacing.sm,
    },
    pageTitleLabel: {
      fontSize: 13,
      color: palette.textMuted,
      fontWeight: '500',
    },
    pageTitleCanvasWrapper: {
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: '#f8fafc',
      overflow: 'hidden',
    },
    canvasScrollShell: {
      marginTop: 8,
    },
    canvasInnerVertical: {
      paddingBottom: Spacing.sm,
    },
    canvasWrapper: {
      position: 'relative',
      // width and height are set dynamically via inline style
    },
    chatHeader: {
      gap: Spacing.xs,
    },
    chatTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    voiceControlsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    chatToolbarScroll: {
      marginHorizontal: -Spacing.xs,
    },
    chatToolbarContent: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingHorizontal: Spacing.xs,
      paddingVertical: 4,
    },
    ttsToggle: {
      padding: Spacing.sm,
      borderRadius: Radii.md,
      backgroundColor: palette.muted,
      borderWidth: 1,
      borderColor: palette.border,
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ttsToggleActive: {
      backgroundColor: `${palette.success}1a`,
      borderColor: `${palette.success}33`,
    },
    listeningModeActive: {
      backgroundColor: `${palette.warning}1a`,
      borderColor: `${palette.warning}33`,
    },
    toolbarDivider: {
      width: 1,
      height: 32,
      backgroundColor: palette.border,
      opacity: 0.6,
      marginHorizontal: 4,
    },
    quickActionChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: `${palette.primary}12`,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: Radii.pill,
      borderWidth: 1,
      borderColor: `${palette.primary}33`,
    },
    quickActionText: {
      color: palette.primary,
      fontSize: 12,
      fontWeight: '500',
    },
    captionOverlay: {
      backgroundColor: `${palette.surfaceAlt}f5`,
      borderRadius: Radii.md,
      padding: Spacing.sm,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.xs,
      borderWidth: 1,
      borderColor: `${palette.success}44`,
      maxHeight: 100,
    },
    captionStopButton: {
      padding: 4,
    },
    captionScroll: {
      flex: 1,
    },
    captionText: {
      color: palette.text,
      fontSize: 14,
      lineHeight: 20,
    },
    stopSpeakingButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingVertical: 8,
      paddingHorizontal: 12,
      backgroundColor: `${palette.danger}12`,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: `${palette.danger}44`,
    },
    stopSpeakingText: {
      color: palette.danger,
      fontSize: 12,
      fontWeight: '600',
    },
    explainButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      backgroundColor: `${palette.warning}12`,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: `${palette.warning}66`,
      minHeight: 44,
    },
    explainButtonText: {
      color: palette.warning,
      fontWeight: '600',
      fontSize: 15,
    },
    primaryButton: {
      backgroundColor: palette.primary,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: Radii.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 44,
    },
    primaryButtonText: {
      color: palette.textOnPrimary,
      fontWeight: '600',
      fontSize: 15,
    },
    secondaryButton: {
      borderRadius: Radii.md,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
      minHeight: 44,
    },
    secondaryButtonText: {
      color: palette.text,
      fontSize: 15,
    },
    chatList: {
      flex: 1,
    },
    chatBubble: {
      padding: 12,
      borderRadius: Radii.md,
      gap: 6,
      borderWidth: 1,
      borderColor: palette.border,
      backgroundColor: palette.surface,
    },
    bubbleHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    replayButton: {
      padding: 8,
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chatAI: {
      backgroundColor: palette.surfaceAlt,
      borderLeftWidth: 3,
      borderLeftColor: palette.success,
    },
    chatUser: {
      backgroundColor: palette.surface,
      borderLeftWidth: 3,
      borderLeftColor: palette.primary,
    },
    metaText: {
      fontSize: 11,
      color: palette.textMuted,
      marginTop: 4,
    },
    input: {
      borderWidth: 1,
      borderColor: palette.border,
      borderRadius: Radii.md,
      padding: 12,
      minHeight: 120,
      backgroundColor: palette.surface,
      marginTop: Spacing.sm,
      fontSize: 15,
    },
    inputArea: {
      gap: Spacing.sm,
    },
    voiceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    thinkingIndicator: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    submitArea: {
      gap: Spacing.xs,
    },
    submitButton: {
      backgroundColor: palette.primary,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: Radii.md,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
    },
    disabledButton: {
      opacity: 0.6,
    },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      padding: Spacing.md,
      backgroundColor: palette.background,
    },
    topicFocusBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      backgroundColor: `${palette.success}12`,
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: Radii.pill,
      alignSelf: 'flex-start',
      marginTop: 4,
      borderWidth: 1,
      borderColor: `${palette.success}33`,
    },
    topicFocusText: {
      color: palette.success,
      fontSize: 13,
      fontWeight: '500',
    },
    checkAnswerButton: {
      position: 'absolute',
      backgroundColor: palette.primary,
      paddingVertical: 12,
      paddingHorizontal: 16,
      borderRadius: 25,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      ...Shadows.md,
      zIndex: 100,
    },
    checkAnswerButtonText: {
      color: palette.textOnPrimary,
      fontWeight: '700',
      fontSize: 16,
    },
    canvasHighlight: {
      position: 'absolute',
      borderRadius: Radii.md,
      borderWidth: 3,
      borderColor: 'transparent',
      zIndex: 10,
    },
    canvasHighlightFull: {
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    canvasHighlightActive: {
      borderColor: palette.primary,
      backgroundColor: `${palette.primary}14`,
    },
    answerMarkersContainer: {
      marginTop: Spacing.md,
      padding: Spacing.md,
      backgroundColor: palette.surface,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: palette.border,
    },
    markersTitle: {
      fontSize: 13,
      color: palette.textMuted,
      marginBottom: Spacing.xs,
    },
    markersList: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.xs,
    },
    markerBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      backgroundColor: palette.surface,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: Radii.pill,
      borderWidth: 1,
      borderColor: palette.border,
    },
    markerBadgeHighlighted: {
      borderColor: palette.primary,
      backgroundColor: `${palette.primary}12`,
    },
    markerBadgeText: {
      color: palette.success,
      fontWeight: '600',
      fontSize: 13,
    },
    bubbleTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
    },
    questionBadge: {
      backgroundColor: `${palette.primary}18`,
      paddingVertical: 2,
      paddingHorizontal: 8,
      borderRadius: 10,
    },
    questionBadgeText: {
      color: palette.primary,
      fontSize: 11,
      fontWeight: '600',
    },
    viewNotesButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      marginTop: 8,
      alignSelf: 'flex-start',
      backgroundColor: `${palette.primary}10`,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: Radii.md,
    },
    viewNotesText: {
      color: palette.primary,
      fontSize: 12,
      fontWeight: '600',
    },
    citationRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.xs,
      marginTop: 6,
    },
    citationChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: `${palette.primary}10`,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: Radii.md,
      borderWidth: 1,
      borderColor: `${palette.primary}33`,
    },
    citationChipText: {
      color: palette.primary,
      fontSize: 12,
      fontWeight: '600',
    },
  });
