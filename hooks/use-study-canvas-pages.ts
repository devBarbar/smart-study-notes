import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';

import {
  buildInitialCanvasPage,
  clearPageStrokes,
  createStudyCanvasPage,
  getNextStagePageNumber as getNextStagePageNumberValue,
  getStageInfoForPage,
  growPageNearEdge,
  replacePageStrokes,
  replacePageTitleStrokes,
} from '@/lib/study/study-canvas-pages';
import { STAGE_LABELS } from '@/lib/study/study-session-constants';
import { CanvasStageInfo } from '@/lib/study/study-session-types';
import { dedupeVisualBlocks } from '@/lib/study/study-session-utils';
import { updateSession } from '@/lib/supabase';
import {
  CanvasPage,
  CanvasStageKind,
  CanvasStrokeData,
} from '@/types';

type UseStudyCanvasPagesParams = {
  sessionId?: string;
  onPageBaselineChange?: (baseline: number) => void;
  onPageInitialized?: () => void;
  onInteractionReset?: () => void;
};

export const useStudyCanvasPages = ({
  sessionId,
  onPageBaselineChange,
  onPageInitialized,
  onInteractionReset,
}: UseStudyCanvasPagesParams) => {
  const [canvasPages, setCanvasPages] = useState<CanvasPage[]>([]);
  const [activePageId, setActivePageId] = useState('');
  const [activeCanvasStage, setActiveCanvasStage] =
    useState<CanvasStageInfo | null>(null);

  const saveCanvasDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const canvasPagesRef = useRef<CanvasPage[]>([]);

  const activePage = useMemo(
    () => canvasPages.find((page) => page.id === activePageId) || canvasPages[0],
    [activePageId, canvasPages],
  );
  const canvasStrokes = useMemo(() => activePage?.strokes || [], [activePage]);
  const canvasSize = useMemo(
    () => ({
      width: activePage?.width || buildInitialCanvasPage().width,
      height: activePage?.height || buildInitialCanvasPage().height,
    }),
    [activePage],
  );
  const initialCanvasStrokes = useMemo(() => activePage?.strokes, [activePage]);
  const activeVisualBlocks = useMemo(
    () => dedupeVisualBlocks(activePage?.visualBlocks || []),
    [activePage],
  );

  useEffect(() => {
    canvasPagesRef.current = canvasPages;
  }, [canvasPages]);

  useEffect(() => {
    return () => {
      if (saveCanvasDebounceRef.current) {
        clearTimeout(saveCanvasDebounceRef.current);
      }

      if (sessionId && canvasPagesRef.current.length > 0) {
        updateSession(sessionId, { canvasPages: canvasPagesRef.current }).catch(
          (err) => {
            console.warn('[study] Failed to save canvas on unmount:', err);
          },
        );
        console.log('[study] Saving canvas pages on unmount');
      }
    };
  }, [sessionId]);

  const saveCanvasPagesNow = useCallback(
    (pages: CanvasPage[]) => {
      if (!sessionId) return;
      updateSession(sessionId, { canvasPages: pages }).catch((err) => {
        console.warn('[study] Failed to save canvas pages:', err);
      });
    },
    [sessionId],
  );

  const scheduleCanvasPagesSave = useCallback(
    (pages: CanvasPage[], logMessage: string) => {
      if (!sessionId) return;

      if (saveCanvasDebounceRef.current) {
        clearTimeout(saveCanvasDebounceRef.current);
      }

      saveCanvasDebounceRef.current = setTimeout(async () => {
        try {
          await updateSession(sessionId, { canvasPages: pages });
          console.log(logMessage);
        } catch (err) {
          console.warn('[study] Failed to save canvas pages:', err);
        }
      }, 1000);
    },
    [sessionId],
  );

  const createNewPage = useCallback(
    (stage?: CanvasStageInfo | null, stagePageNumber?: number): CanvasPage =>
      createStudyCanvasPage({
        id: `page-${uuid()}`,
        stage,
        stagePageNumber,
      }),
    [],
  );

  const activatePage = useCallback(
    (page: CanvasPage, stage: CanvasStageInfo | null = getStageInfoForPage(page)) => {
      setActivePageId(page.id);
      setActiveCanvasStage(stage);
      onPageBaselineChange?.(page.strokes.length);
      onPageInitialized?.();
    },
    [onPageBaselineChange, onPageInitialized],
  );

  const restoreCanvasPages = useCallback(
    (pages: CanvasPage[], activeId?: string) => {
      setCanvasPages(pages);
      const active = pages.find((page) => page.id === activeId) || pages[0];
      if (active) {
        activatePage(active);
      }
    },
    [activatePage],
  );

  const setInitialBlankPage = useCallback(() => {
    restoreCanvasPages([buildInitialCanvasPage()]);
  }, [restoreCanvasPages]);

  const getNextStagePageNumber = useCallback(
    (stage: CanvasStageInfo) => getNextStagePageNumberValue(canvasPages, stage),
    [canvasPages],
  );

  const ensureCanvasStagePage = useCallback(
    (
      stageKind: CanvasStageKind,
      stageId: string,
      options: { forceNew?: boolean; label?: string } = {},
    ) => {
      const stage: CanvasStageInfo = {
        stageKind,
        stageId,
        stageLabel: options.label ?? STAGE_LABELS[stageKind],
      };
      const existingPage = options.forceNew
        ? undefined
        : canvasPages.find(
            (page) =>
              page.stageKind === stageKind &&
              page.stageId === stageId &&
              (page.stagePageNumber ?? 1) === 1,
          );
      const page =
        existingPage ??
        createNewPage(stage, options.forceNew ? 1 : getNextStagePageNumber(stage));
      const updatedPages = existingPage ? canvasPages : [...canvasPages, page];

      setCanvasPages(updatedPages);
      activatePage(page, stage);
      onInteractionReset?.();
      saveCanvasPagesNow(updatedPages);

      return page;
    },
    [
      activatePage,
      canvasPages,
      createNewPage,
      getNextStagePageNumber,
      onInteractionReset,
      saveCanvasPagesNow,
    ],
  );

  const addPage = useCallback(() => {
    const stage = activeCanvasStage ?? getStageInfoForPage(activePage);
    const newPage = createNewPage(
      stage,
      stage ? getNextStagePageNumber(stage) : undefined,
    );
    const updatedPages = [...canvasPages, newPage];
    setCanvasPages(updatedPages);
    activatePage(newPage, stage);
    onInteractionReset?.();
    saveCanvasPagesNow(updatedPages);
  }, [
    activatePage,
    activeCanvasStage,
    activePage,
    canvasPages,
    createNewPage,
    getNextStagePageNumber,
    onInteractionReset,
    saveCanvasPagesNow,
  ]);

  const selectPage = useCallback(
    (pageId: string) => {
      if (pageId === activePageId) return;
      const page = canvasPages.find((item) => item.id === pageId);
      if (!page) return;
      activatePage(page);
    },
    [activatePage, activePageId, canvasPages],
  );

  const updateActivePageStrokes = useCallback(
    (strokes: CanvasStrokeData[]) => {
      setCanvasPages((prev) => {
        const updatedPages = replacePageStrokes(prev, activePageId, strokes);
        scheduleCanvasPagesSave(
          updatedPages,
          `[study] Canvas pages saved with ${updatedPages.length} pages`,
        );
        return updatedPages;
      });
    },
    [activePageId, scheduleCanvasPagesSave],
  );

  const updateActivePageTitleStrokes = useCallback(
    (strokes: CanvasStrokeData[]) => {
      setCanvasPages((prev) => {
        const updatedPages = replacePageTitleStrokes(prev, activePageId, strokes);
        scheduleCanvasPagesSave(updatedPages, '[study] Title strokes saved');
        return updatedPages;
      });
    },
    [activePageId, scheduleCanvasPagesSave],
  );

  const clearActivePageStrokes = useCallback(() => {
    setCanvasPages((prev) => clearPageStrokes(prev, activePageId));
  }, [activePageId]);

  const growActivePageNearEdge = useCallback(
    (position: { x: number; y: number }) => {
      setCanvasPages((prev) => growPageNearEdge(prev, activePageId, position));
    },
    [activePageId],
  );

  const flushPendingCanvasSave = useCallback(() => {
    if (saveCanvasDebounceRef.current) {
      clearTimeout(saveCanvasDebounceRef.current);
      saveCanvasDebounceRef.current = null;
    }
  }, []);

  return {
    canvasPages,
    setCanvasPages,
    activePageId,
    setActivePageId,
    activePage,
    activatePage,
    canvasStrokes,
    canvasSize,
    initialCanvasStrokes,
    activeVisualBlocks,
    activeCanvasStage,
    setActiveCanvasStage,
    canvasPagesRef,
    saveCanvasDebounceRef,
    saveCanvasPagesNow,
    scheduleCanvasPagesSave,
    flushPendingCanvasSave,
    createNewPage,
    restoreCanvasPages,
    setInitialBlankPage,
    getStageInfoForPage,
    getNextStagePageNumber,
    ensureCanvasStagePage,
    handleAddPage: addPage,
    handleSelectPage: selectPage,
    updateActivePageStrokes,
    updateActivePageTitleStrokes,
    clearActivePageStrokes,
    growActivePageNearEdge,
  };
};
