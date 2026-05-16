import {
  CANVAS_GROW_CHUNK,
  EDGE_THRESHOLD,
  INITIAL_CANVAS_HEIGHT,
  INITIAL_CANVAS_WIDTH,
} from "./study-session-constants";
import { CanvasStageInfo } from "./study-session-types";
import { CanvasPage, CanvasStrokeData } from "../../types";

export const buildInitialCanvasPage = (id = "page-1"): CanvasPage => ({
  id,
  titleStrokes: [],
  strokes: [],
  width: INITIAL_CANVAS_WIDTH,
  height: INITIAL_CANVAS_HEIGHT,
});

export const createStudyCanvasPage = ({
  id,
  stage,
  stagePageNumber,
}: {
  id: string;
  stage?: CanvasStageInfo | null;
  stagePageNumber?: number;
}): CanvasPage => ({
  ...buildInitialCanvasPage(id),
  ...(stage
    ? {
        stageKind: stage.stageKind,
        stageId: stage.stageId,
        stageLabel: stage.stageLabel,
        stagePageNumber,
      }
    : {}),
});

export const getStageInfoForPage = (
  page?: CanvasPage | null,
): CanvasStageInfo | null => {
  if (!page?.stageKind || !page.stageId || !page.stageLabel) return null;
  return {
    stageKind: page.stageKind,
    stageId: page.stageId,
    stageLabel: page.stageLabel,
  };
};

export const getNextStagePageNumber = (
  pages: CanvasPage[],
  stage: CanvasStageInfo,
) =>
  Math.max(
    0,
    ...pages
      .filter(
        (page) =>
          page.stageKind === stage.stageKind && page.stageId === stage.stageId,
      )
      .map((page) => page.stagePageNumber ?? 1),
  ) + 1;

export const replacePageStrokes = (
  pages: CanvasPage[],
  pageId: string,
  strokes: CanvasStrokeData[],
) => pages.map((page) => (page.id === pageId ? { ...page, strokes } : page));

export const replacePageTitleStrokes = (
  pages: CanvasPage[],
  pageId: string,
  titleStrokes: CanvasStrokeData[],
) =>
  pages.map((page) => (page.id === pageId ? { ...page, titleStrokes } : page));

export const clearPageStrokes = (pages: CanvasPage[], pageId: string) =>
  replacePageStrokes(pages, pageId, []);

/* node:coverage ignore next 31 */
export const growPageNearEdge = (
  pages: CanvasPage[],
  pageId: string,
  position: { x: number; y: number },
) => {
  const updatedPages: CanvasPage[] = [];

  for (const page of pages) {
    if (page.id !== pageId) {
      updatedPages.push(page);
      continue;
    }

    const nearRightEdge = position.x > page.width - EDGE_THRESHOLD;
    const nearBottomEdge = position.y > page.height - EDGE_THRESHOLD;
    if (!nearRightEdge && !nearBottomEdge) {
      updatedPages.push(page);
      continue;
    }

    updatedPages.push({
      ...page,
      width: nearRightEdge
        ? Math.max(page.width + CANVAS_GROW_CHUNK, position.x + EDGE_THRESHOLD)
        : page.width,
      height: nearBottomEdge
        ? Math.max(page.height + CANVAS_GROW_CHUNK, position.y + EDGE_THRESHOLD)
        : page.height,
    });
  }

  return updatedPages;
};
